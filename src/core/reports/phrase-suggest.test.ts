import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/core/access";
import { AI_CANDIDATE_SOURCES } from "@/db/schema";
import { db } from "@/db/client";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import { enableAnthropic, fakeNoMatchInput } from "../../../tests/ai";
import { createTemplate, resetDatabase } from "../../../tests/factories";
import {
  addPlace,
  applyPhrase,
  candidateLines,
  DAMAGED_FURNITURE,
  DRAIN_CONNECTION,
  kiBathroom,
  kiBathroomIn,
  kiRows,
  OVERHEATING_HMS,
  PAST_LIFESPAN,
  promptOf,
  providerAnswers,
  providerSpy,
  recordDecisionWith,
  requestWithServerInput,
  suggestPhrases,
  writeDeviationText,
  type KiBathroom,
} from "../../../tests/ki-i-veien";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Fraseforslag (docs/funksjoner/fase2a-ki-i-veien-testplan.md K1.7–K1.9, 4a, K4.19, K4.21, K4.24
 * og 5b K5.8, K5.12a, K5.14, K5.15). Mot testdatabasen med den falske leverandøren. Kandidatene
 * kommer fra badmalen (utkast), alle andre verdier er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (riktig tekst fra frasebanken med to trykk), KI i bunnen (KI
 * rangerer bare kandidater serveren har valgt, og alt logges som id-er) og færre reklamasjoner
 * (tekstene er malens egne, aldri KI-skrevet, og TG endres aldri).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

async function ask(f: KiBathroom, deviationId: string, field = "cause_text" as const, text = "") {
  return suggestPhrases(f.actor, f.organizationId, f.room, {
    requestId: uuidv7(),
    deviationId,
    field,
    text,
  });
}

/** Bad med to TG2-avvik og ett TG3-avvik, så det finnes flere årsakstekster. */
async function bathroomWithDeviations() {
  const f = await kiBathroom();
  const deviationId = await addPlace(f, PAST_LIFESPAN);
  await addPlace(f, DRAIN_CONNECTION);
  await addPlace(f, DAMAGED_FURNITURE);
  return { f, deviationId };
}

describe("K1.7–K1.9 kandidatkontrakten", () => {
  it("K1.7 [\"K2\",\"K1\"] gir de to kandidatene i den rekkefølgen", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const spy = providerAnswers('["K2","K1"]');
    const result = await ask(f, deviationId);
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    const lines = candidateLines(promptOf(spy));
    expect(lines.size).toBeGreaterThanOrEqual(2);
    expect(result.candidates.map((c) => c.text)).toEqual([lines.get("K2"), lines.get("K1")]);
  });

  it("K1.7 ukjente, doble, tomme, ikke-strenger og feil form tas bort og telles i input_summary", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    providerAnswers('["K1","K99","K1","",7,"k2","X3",null,"K2"]');
    const result = await ask(f, deviationId);
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    expect(result.candidates).toHaveLength(2);
    const [row] = await kiRows("phrase_suggest");
    expect(row?.candidate_refs).toHaveLength(2);
    const summary = row!.input_summary;
    expect(summary.duplicate_labels).toBe(1);
    expect(Number(summary.unknown_labels)).toBeGreaterThanOrEqual(1);
    for (const value of Object.values(summary)) expect(typeof value).toBe("number");
  });

  it("K1.7 flere enn 5 gyldige gir de 5 første", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const spy = providerAnswers('["K1","K2","K3","K4","K5","K6","K7"]');
    const result = await ask(f, deviationId);
    const lines = candidateLines(promptOf(spy));
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    expect(result.candidates).toHaveLength(Math.min(5, lines.size));
    expect(result.candidates[0]?.text).toBe(lines.get("K1"));
  });

  it.each([
    ["ingen gyldige merker", '["K99"]'],
    ["tom liste", "[]"],
    ["ikke en liste", '{"K1":true}'],
    ["fritekst", "Jeg foreslår den første."],
  ])("K1.7 %s gir no_match, aldri unntak", async (_name, raw) => {
    const { f, deviationId } = await bathroomWithDeviations();
    providerAnswers(raw);
    const result = await ask(f, deviationId);
    expect(["no_match", "ai_error"]).toContain(result.status);
  });

  it("K1.8 id-ene sendes aldri til leverandøren, og klienten får ref med source og id", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const spy = providerAnswers('["K1"]');
    const result = await ask(f, deviationId);
    const prompt = promptOf(spy);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    for (const candidate of result.candidates) {
      expect(AI_CANDIDATE_SOURCES).toContain(candidate.ref.source);
      expect(candidate.ref.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.stringify(candidate)).not.toMatch(/"K\d+"/);
    }
  });

  it("K1.8 merke-tabellen lages på nytt for hvert kall", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const spy = providerAnswers('["K1"]');
    await ask(f, deviationId);
    await writeDeviationText(f, deviationId, "cause_text", "Oppdiktet egen årsak");
    await ask(f, deviationId, "cause_text", "Oppdiktet egen årsak");
    // Merkene starter på K1 i begge kall (ingen teller som fortsetter mellom kall).
    expect(candidateLines(promptOf(spy, 0)).has("K1")).toBe(true);
    expect(candidateLines(promptOf(spy, 1)).has("K1")).toBe(true);
  });

  it("K1.9 kildekodene er låst: template_outcome, template_measure, phrase", () => {
    expect([...AI_CANDIDATE_SOURCES]).toEqual(["template_outcome", "template_measure", "phrase"]);
  });
});

describe("4a fraseforslag", () => {
  it("K4.1 vanlig flyt: 3–5 kandidater med punkt, utfall og text_status, og én loggrad med bare id-er og tall", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    providerAnswers('["K1","K2","K3"]');
    const result = await ask(f, deviationId);
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    for (const candidate of result.candidates) {
      expect(candidate.checkpointKey).toMatch(/^wet_room\./);
      expect(candidate.checkpointName.length).toBeGreaterThan(0);
      expect(candidate.outcomeKey.length).toBeGreaterThan(0);
      expect(candidate.textStatus).toBe("draft");
    }
    const rows = await kiRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.feature).toBe("phrase_suggest");
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
    expect(row.output_text ?? "").toBe("");
    expect(row.candidate_refs).toEqual(result.candidates.map((c) => c.ref));
    expect(row.target_ref).toEqual({ type: "deviation", id: deviationId, fieldKey: "cause_text" });
    expect(row.report_id).toBe(f.reportId);
    expect(row.assignment_id).toBe(f.assignmentId);
    for (const value of Object.values(row.input_summary)) expect(typeof value).toBe("number");
  });

  it("K4.3 0 kandidater gir «Ingen treff» uten kall og uten loggrad", async () => {
    const f = await kiBathroom();
    // Bare ett avvik, og årsaken er alt satt til den eneste teksten som passer i et HMS-avvik.
    const deviationId = await addPlace(f, OVERHEATING_HMS);
    const spy = providerSpy();
    const [row] = (await db.execute(
      sql`select cause_text from deviations where id = ${deviationId}`,
    )) as unknown as { cause_text: string | null }[];
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "cause_text",
      text: row?.cause_text ?? "",
    });
    if (result.status === "no_match" && result.usageId === null) {
      expect(spy).not.toHaveBeenCalled();
      expect(await kiRows()).toHaveLength(0);
    } else {
      // Malen har flere HMS-årsaker enn ventet: testen må få et oppsett uten kandidater.
      expect.fail(`ventet no_match uten rad, fikk ${result.status}`);
    }
  });

  it("K4.4 falsk leverandør gir no_match: «Ingen treff», raden logges som no_match", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const result = await ask(f, deviationId, "cause_text", fakeNoMatchInput());
    expect(result.status).toBe("no_match");
    const [row] = await kiRows("phrase_suggest");
    expect(row?.outcome).toBe("no_match");
    expect(row?.candidate_refs).toBeNull();
  });

  it("K4.5 tomt felt er lov: kall og loggrad", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const spy = providerSpy();
    const result = await ask(f, deviationId, "cause_text", "");
    expect(["ranked", "no_match"]).toContain(result.status);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await kiRows("phrase_suggest")).toHaveLength(1);
  });

  it("K4.6 låst malversjon: tekst fra en nyere publisert versjon er aldri kandidat", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const marker = "Mxq-merke-ÆØ ny årsakstekst i neste versjon.";
    const newer = structuredClone(wetRoomTemplate) as typeof wetRoomTemplate;
    for (const outcome of newer.outcomes) {
      if (outcome.question_key === PAST_LIFESPAN.questionKey) {
        (outcome as { default_cause_text: string | null }).default_cause_text = marker;
      }
    }
    await createTemplate(f.organizationId, {
      status: "published",
      document: newer,
      name: "Tilstandsrapport",
    });
    const spy = providerAnswers('["K1"]');
    await ask(f, deviationId);
    expect(promptOf(spy)).not.toContain("Mxq-merke-ÆØ");
  });

  it("K4.7 mot ekte leverandør uten funksjonen i settings.features gir «KI er av» uten kall", async () => {
    const f = await kiBathroom();
    await db.execute(sql`delete from integration_connections where organization_id = ${f.organizationId}`);
    await enableAnthropic(f.organizationId);
    const deviationId = await addPlace(f, PAST_LIFESPAN);
    const result = await ask(f, deviationId);
    expect(result.status).toBe("ai_off");
  });
});

describe("K4.19 og K4.21 valg og innsetting", () => {
  async function ranked() {
    const { f, deviationId } = await bathroomWithDeviations();
    providerAnswers('["K1","K2"]');
    const result = await ask(f, deviationId);
    if (result.status !== "ranked") throw new Error(`ventet ranked, fikk ${result.status}`);
    return { f, deviationId, result };
  }

  it("K4.21 valgt tekst lagres i feltet med text_source = template; TG er uendret; raden er accepted med chosen_candidate", async () => {
    const { f, deviationId, result } = await ranked();
    const [before] = (await db.execute(
      sql`select tg, cause_text from deviations where id = ${deviationId}`,
    )) as unknown as { tg: number; cause_text: string | null }[];
    const chosen = result.candidates[1] ?? result.candidates[0]!;
    const applied = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: chosen.ref,
      base: before?.cause_text ?? null,
    });
    expect(applied.status).toBe("saved");
    const [after] = (await db.execute(
      sql`select tg, cause_text, text_source from deviations where id = ${deviationId}`,
    )) as unknown as { tg: number; cause_text: string; text_source: string }[];
    expect(after?.tg).toBe(before?.tg);
    expect(after?.cause_text).toBe(chosen.text);
    expect(after?.text_source).toBe("template");
    const [row] = await kiRows("phrase_suggest");
    expect(row?.status).toBe("accepted");
    expect(row?.chosen_candidate).toEqual(chosen.ref);
  });

  it("K4.21 new_measure: valget legger til et nytt tiltak, eksisterende tiltak er uendret", async () => {
    const { f, deviationId } = await bathroomWithDeviations();
    const before = (await db.execute(
      sql`select id, text from deviation_measures where deviation_id = ${deviationId} and deleted_at is null order by sort_order`,
    )) as unknown as { id: string; text: string }[];
    providerAnswers('["K1"]');
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "new_measure",
      text: "",
    });
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    const measureId = uuidv7();
    const applied = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: result.candidates[0]!.ref,
      base: null,
      measureId,
    });
    expect(applied.status).toBe("saved");
    const after = (await db.execute(
      sql`select id, text from deviation_measures where deviation_id = ${deviationId} and deleted_at is null order by sort_order`,
    )) as unknown as { id: string; text: string }[];
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)?.id).toBe(measureId);
    expect(after.at(-1)?.text).toBe(result.candidates[0]!.text);
    const [row] = await kiRows("phrase_suggest");
    expect(row?.target_ref).toEqual({ type: "deviation", id: deviationId, fieldKey: "new_measure" });
  });

  it("K4.19 kandidat som ikke står i candidate_refs avvises, og ingenting lagres (A469)", async () => {
    const { f, deviationId, result } = await ranked();
    const [before] = (await db.execute(
      sql`select cause_text, row_version from deviations where id = ${deviationId}`,
    )) as unknown as { cause_text: string | null; row_version: number }[];
    await expect(
      applyPhrase(f.actor, f.organizationId, f.room, {
        usageId: result.usageId,
        candidate: { source: "template_outcome", id: uuidv7() },
        base: before?.cause_text ?? null,
      }),
    ).rejects.toThrow();
    const [after] = (await db.execute(
      sql`select cause_text, row_version from deviations where id = ${deviationId}`,
    )) as unknown as { cause_text: string | null; row_version: number }[];
    expect(after).toEqual(before);
    expect((await kiRows("phrase_suggest"))[0]?.status).toBe("suggested");
  });

  it("K4.17b konflikt på feltet: ingenting lagres, og raden står fortsatt suggested", async () => {
    const { f, deviationId, result } = await ranked();
    await writeDeviationText(f, deviationId, "cause_text", "Oppdiktet tekst fra en annen fane");
    const applied = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: result.candidates[0]!.ref,
      base: "Gammel verdi klienten så",
    });
    expect(applied.status).toBe("conflict");
    expect((await kiRows("phrase_suggest"))[0]?.status).toBe("suggested");
  });

  it("K4.19 lukket liste gir rejected, og beslutning to ganger gir samme svar", async () => {
    const { f, result } = await ranked();
    await recordDecisionWith(f.grant, result.usageId, "rejected");
    await recordDecisionWith(f.grant, result.usageId, "rejected");
    const [row] = await kiRows("phrase_suggest");
    expect(row?.status).toBe("rejected");
    expect(row?.chosen_candidate).toBeNull();
  });

  it("K4.19 accepted uten kandidat og edited på en kandidatrad avvises", async () => {
    const { f, result } = await ranked();
    await expect(recordDecisionWith(f.grant, result.usageId, "accepted")).rejects.toThrow();
    await expect(recordDecisionWith(f.grant, result.usageId, "edited")).rejects.toThrow();
    expect((await kiRows("phrase_suggest"))[0]?.status).toBe("suggested");
  });

  it("K4.19 kandidat på en language_polish-rad avvises", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlace(f, PAST_LIFESPAN);
    await writeDeviationText(f, deviationId, "deviation_text", "Membranen er gamell.");
    const polish = await requestWithServerInput(f.grant, {
      requestId: uuidv7(),
      feature: "language_polish",
      assignmentId: null,
      reportId: null,
      target: { type: "deviation", id: deviationId, fieldKey: "deviation_text" },
      fields: { text: "Membranen er gamell." },
    });
    expect(polish.kind).toBe("suggestion");
    await expect(
      recordDecisionWith(f.grant, String(polish.usageId), "accepted", {
        candidate: { source: "template_outcome", id: uuidv7() },
      }),
    ).rejects.toThrow();
  });

  it("K4.24 candidate_refs og chosen_candidate har bare source og id", async () => {
    const { f, deviationId, result } = await ranked();
    await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: result.candidates[0]!.ref,
      base: null,
    }).catch(() => undefined);
    void deviationId;
    const [row] = await kiRows("phrase_suggest");
    for (const ref of row?.candidate_refs ?? []) {
      expect(Object.keys(ref).sort()).toEqual(["id", "source"]);
    }
    if (row?.chosen_candidate) {
      expect(Object.keys(row.chosen_candidate).sort()).toEqual(["id", "source"]);
    }
  });
});

describe("K1.14 grensen og sikringen i kjernen", () => {
  it("K1.14 mer enn AI_CANDIDATES_MAX sendt rett til requestSuggestion gir too_many_candidates uten kall og uten rad", async () => {
    const { AI_CANDIDATES_MAX, AiInputTooLargeError } = await import("@/core/ai");
    const f = await kiBathroom();
    const deviationId = await addPlace(f, PAST_LIFESPAN);
    const spy = providerSpy();
    const candidates = Array.from({ length: AI_CANDIDATES_MAX + 1 }, (_, i) => ({
      source: "template_outcome",
      id: uuidv7(),
      text: `Oppdiktet kandidat ${String.fromCharCode(65 + (i % 26))}`,
    }));
    const error = await requestWithServerInput(
      f.grant,
      {
        requestId: uuidv7(),
        feature: "phrase_suggest",
        assignmentId: null,
        reportId: null,
        target: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
        fields: { text: "" },
      },
      { candidates, candidatesCut: 0 },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AiInputTooLargeError);
    expect((error as { reason?: string }).reason).toBe("too_many_candidates");
    expect(spy).not.toHaveBeenCalled();
    expect(await kiRows()).toHaveLength(0);
  });
});

describe("5b tenant-isolasjon for fraseforslag", () => {
  it("K5.8 kandidatkilden: B får aldri kandidater fra A sin malversjon (expectTenantIsolation)", async () => {
    const places = new Map<string, Awaited<ReturnType<typeof kiBathroomIn>> & { deviationId: string }>();
    await expectTenantIsolation<{ id: string }>({
      seed: async (grantA, grantB) => {
        const out: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await kiBathroomIn(grant.organizationId);
          const deviationId = await addPlace(f, PAST_LIFESPAN);
          await addPlace(f, DRAIN_CONNECTION);
          places.set(grant.organizationId, { ...f, deviationId });
          out[side].push(deviationId);
        }
        return out;
      },
      query: async (actor, organizationId) => {
        const place = [...places.values()].find((p) => p.organizationId === organizationId)
          ?? [...places.values()].find((p) => p.organizationId !== organizationId)!;
        const result = await suggestPhrases(actor, organizationId, place.room, {
          requestId: uuidv7(),
          deviationId: place.deviationId,
          field: "cause_text",
          text: "",
        });
        if (result.status !== "ranked") return [];
        // Hver kandidat må høre til malversjonen i organisasjonen som spurte.
        for (const candidate of result.candidates) {
          const [owner] = (await db.execute(
            sql`select organization_id from outcomes where id = ${candidate.ref.id}
                union all select organization_id from standard_measures where id = ${candidate.ref.id}`,
          )) as unknown as { organization_id: string }[];
          expect(owner?.organization_id).toBe(organizationId);
        }
        return [{ id: place.deviationId }];
      },
      idOf: (row) => row.id,
    });
  });

  it("K5.15 serverinngangen: A sin id i B sin rapport gir «ikke funnet», uten kall og uten rad", async () => {
    // A ber om forslag på et avvik i B sin rapport, med sitt eget rom: «ikke funnet».
    const a = await kiBathroom();
    const b = await kiBathroom();
    const deviationB = await addPlace(b, PAST_LIFESPAN);
    const spy = providerSpy();
    await expect(
      suggestPhrases(a.actor, a.organizationId, a.room, {
        requestId: uuidv7(),
        deviationId: deviationB,
        field: "cause_text",
        text: "",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      suggestPhrases(a.actor, b.organizationId, b.room, {
        requestId: uuidv7(),
        deviationId: deviationB,
        field: "cause_text",
        text: "",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(spy).not.toHaveBeenCalled();
    expect(await kiRows()).toHaveLength(0);
  });

  it("K5.13 og K5.14 B kan ikke avgjøre A sin rad eller velge A sin kandidat", async () => {
    const a = await kiBathroom();
    const deviationA = await addPlace(a, PAST_LIFESPAN);
    await addPlace(a, DRAIN_CONNECTION);
    providerAnswers('["K1","K2"]');
    const result = await suggestPhrases(a.actor, a.organizationId, a.room, {
      requestId: uuidv7(),
      deviationId: deviationA,
      field: "cause_text",
      text: "",
    });
    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") return;
    const b = await kiBathroom();
    await expect(
      recordDecisionWith(b.grant, result.usageId, "accepted", { candidate: result.candidates[0]!.ref }),
    ).rejects.toThrow();
    await expect(
      applyPhrase(b.actor, b.organizationId, b.room, {
        usageId: result.usageId,
        candidate: result.candidates[0]!.ref,
        base: null,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await kiRows("phrase_suggest"))[0]?.status).toBe("suggested");

    // A velger en kandidat-id fra B sin malversjon: avvises.
    const deviationB = await addPlace(b, PAST_LIFESPAN);
    await addPlace(b, DRAIN_CONNECTION);
    providerAnswers('["K1"]');
    const fromB = await suggestPhrases(b.actor, b.organizationId, b.room, {
      requestId: uuidv7(),
      deviationId: deviationB,
      field: "cause_text",
      text: "",
    });
    if (fromB.status !== "ranked") throw new Error("ventet ranked for B");
    await expect(
      applyPhrase(a.actor, a.organizationId, a.room, {
        usageId: result.usageId,
        candidate: fromB.candidates[0]!.ref,
        base: null,
      }),
    ).rejects.toThrow();
    expect((await kiRows("phrase_suggest")).find((r) => r.id === result.usageId)?.status).toBe(
      "suggested",
    );
  });

  it("K5.12a «Mest brukt»: valg i B teller aldri for A", async () => {
    const a = await kiBathroom();
    const b = await kiBathroom();
    for (let i = 0; i < 3; i += 1) {
      const deviationB = await addPlace(b, i === 0 ? PAST_LIFESPAN : DRAIN_CONNECTION);
      providerAnswers('["K1"]');
      const r = await suggestPhrases(b.actor, b.organizationId, b.room, {
        requestId: uuidv7(),
        deviationId: deviationB,
        field: "new_measure",
        text: "",
      });
      if (r.status === "ranked") {
        await applyPhrase(b.actor, b.organizationId, b.room, {
          usageId: r.usageId,
          candidate: r.candidates[0]!.ref,
          base: null,
          measureId: uuidv7(),
        });
      }
    }
    const { getRoomView } = await import("@/core/reports");
    const viewB = await getRoomView(b.actor, b.organizationId, b.room);
    const viewA = await getRoomView(a.actor, a.organizationId, a.room);
    if (viewA.state !== "started" || viewB.state !== "started") throw new Error("ikke startet");
    expect(viewB.phraseUsage.length).toBeGreaterThan(0);
    expect(viewA.phraseUsage).toEqual([]);
  });
});
