import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { AI_CANDIDATES_MAX } from "@/core/ai";
import { fakeAiProvider, FAKE_NO_MATCH_INPUT } from "@/core/ai/providers/fake";
import {
  applyPhrase,
  getRoomView,
  loadPhraseCandidates,
  loadPhraseUsage,
  saveField,
  suggestPhrases,
} from "@/core/reports";
import { db } from "@/db/client";
import { deviationMeasures, deviations, outcomes } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRow, aiRowCount, captureError } from "../../../tests/ai";
import { createAiUsageLog, createTemplate, resetDatabase } from "../../../tests/factories";
import {
  addPlaceDeviation,
  chosenPhraseRows,
  countQueries,
  kiBathroom,
  measureIdsOf,
  outcomeIdOf,
  PLACE,
  type KiBathroom,
} from "../../../tests/report-ki-fixtures";
import { startedBathroom, startedView } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Forslag fra frasebanken i rapportkjernen (docs/funksjoner/fase2a-ki-i-veien-testplan.md 4a,
 * K4.1–K4.6, K4.21, K4.17b, K4.21b, K5.8, K5.12a, K5.14, K5.15 og K5.17). Falsk leverandør, alle
 * verdier er oppdiktede.
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function grantOf(f: Pick<KiBathroom, "actor" | "organizationId">) {
  return requireOrganizationAccess(f.actor, f.organizationId);
}

/** Tømmer et tekstfelt på avviket, slik at malens egen tekst blir kandidat. */
async function clearField(
  f: KiBathroom,
  deviationId: string,
  field: "deviation_text" | "cause_text" | "consequence_text",
) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
  const column = {
    deviation_text: "deviationText",
    cause_text: "causeText",
    consequence_text: "consequenceText",
  } as const;
  const result = await saveField(f.actor, f.organizationId, f.room, {
    table: "deviations",
    id: deviationId,
    field,
    value: null,
    base: row?.[column[field]] ?? null,
  });
  expect(result.status).toBe("saved");
}

async function deviationRow(id: string) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
  if (!row) throw new Error("fant ikke avviket");
  return row;
}

describe("4a kandidatkilden", () => {
  it("K1.10/K4.1 eget utfall først, bare fra den låste malversjonen, med id fra databasen", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    await clearField(f, deviationId, "cause_text");
    const { candidates, cut } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "cause_text",
    });
    const own = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg2);
    expect(candidates[0]?.ref).toEqual({ source: "template_outcome", id: own });
    expect(candidates[0]?.text).toContain("Funksjonen er usikker på grunn av alder");
    expect(candidates.length).toBeGreaterThan(5);
    expect(candidates.length).toBeLessThanOrEqual(AI_CANDIDATES_MAX);
    expect(cut).toBe(0);
    // HMS-utfallet har ingen årsak, og HMS er aldri kandidat for et TG-avvik (A463)
    expect(candidates.every((c) => c.outcomeKind !== "hms")).toBe(true);
    expect(candidates.every((c) => c.textStatus === "draft")).toBe(true);
    expect(new Set(candidates.map((c) => c.ref.id)).size).toBe(candidates.length);
  });

  it("K1.12 teksten som står i feltet er ikke kandidat", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "cause_text",
    });
    expect(candidates.map((c) => c.text)).not.toContain(before.causeText);
  });

  it("K4.6 en tekst i en nyere malversjon er ikke kandidat", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const marker = "Mxq-merke-ÆØ ny årsak fra en nyere versjon";
    await createTemplate(f.organizationId, {
      status: "published",
      name: "Tilstandsrapport ny",
      document: {
        ...wetRoomTemplate,
        outcomes: wetRoomTemplate.outcomes.map((o) => ({ ...o, default_cause_text: marker })),
      },
    });
    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "cause_text",
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.map((c) => c.text)).not.toContain(marker);
  });

  it("K1.13/K5.17 mykt slettet utfall er ikke kandidat; mykt slettet avvik gir 404", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const removed = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.ventilationTg3);
    await db.update(outcomes).set({ deletedAt: new Date() }).where(eq(outcomes.id, removed));
    const grant = await grantOf(f);
    const input = {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "deviation_text",
    } as const;
    const { candidates } = await loadPhraseCandidates(grant, input);
    expect(candidates.map((c) => c.ref.id)).not.toContain(removed);

    await db
      .update(deviations)
      .set({ deletedAt: new Date() })
      .where(eq(deviations.id, deviationId));
    await expect(loadPhraseCandidates(grant, input)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("K1.17 HMS-avvik får bare HMS-tekster", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.overheatingHms);
    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "new_measure",
    });
    // Det ene HMS-tiltaket står alt på avviket
    expect(candidates).toEqual([]);
  });

  it("K1.17b new_measure gir standardtiltak med egen kilde", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.furnitureTg2);
    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "new_measure",
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.ref.source === "template_measure")).toBe(true);
    expect(candidates.every((c) => c.measureSortOrder !== null)).toBe(true);
  });

  it("K5.8 kandidatkilden: en annen organisasjon får verken rader eller tilgang", async () => {
    const byOrg = new Map<string, { reportId: string; roomId: string; deviationId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await startedBathroom({ organizationId: grant.organizationId });
          const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
          await clearField(f as KiBathroom, deviationId, "cause_text");
          byOrg.set(grant.organizationId, { reportId: f.reportId, roomId: f.roomId, deviationId });
          ids[side].push(
            await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg2),
          );
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const own = byOrg.get(organizationId);
        if (!own) throw new Error("mangler oppsett");
        return (await loadPhraseCandidates(grant, { ...own, field: "cause_text" })).candidates;
      },
      idOf: (row) => row.ref.id,
    });
    // A sin grant med B sine id-er gir 404 (K5.15)
    const [a, b] = [...byOrg.entries()];
    if (!a || !b) throw new Error("mangler oppsett");
    const f = await startedBathroom({ organizationId: a[0] });
    const grantA = await grantOf(f);
    await expect(
      loadPhraseCandidates(grantA, { ...b[1], field: "cause_text" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("K4.21b fast antall spørringer uansett antall valg i loggen og avvik i rommet", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const input = {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "cause_text",
    } as const;
    const grant = await grantOf(f);
    const small = await countQueries(() => loadPhraseCandidates(grant, input));
    const own = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.ventilationTg3);
    await chosenPhraseRows(f.organizationId, {
      field: "cause_text",
      candidate: { source: "template_outcome", id: own },
      count: 30,
    });
    for (const place of [PLACE.furnitureTg2, PLACE.ventilationTg3, PLACE.membraneTg3]) {
      await addPlaceDeviation(f, place);
    }
    const big = await countQueries(() => loadPhraseCandidates(grant, input));
    expect(big).toBe(small);
    const usage = await countQueries(() =>
      loadPhraseUsage(grant, { reportId: f.reportId, roomId: f.roomId }),
    );
    expect(usage).toBeLessThanOrEqual(small);
  });
});

describe("«Mest brukt» (A468)", () => {
  it("K1.17a tellingen er samlet for organisasjonen, og flest valg kommer først ved lik plass", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.furnitureTg2);
    const ventilation = await outcomeIdOf(
      f.organizationId,
      f.templateVersionId,
      PLACE.ventilationTg3,
    );
    const membrane = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg3);
    await chosenPhraseRows(f.organizationId, {
      field: "deviation_text",
      candidate: { source: "template_outcome", id: ventilation },
      count: 3,
    });
    await chosenPhraseRows(f.organizationId, {
      field: "deviation_text",
      candidate: { source: "template_outcome", id: membrane },
      count: 1,
    });
    // Slettet rad og annet felt teller ikke
    await chosenPhraseRows(f.organizationId, {
      field: "deviation_text",
      candidate: { source: "template_outcome", id: membrane },
      count: 5,
      deletedAt: new Date(),
    });
    await chosenPhraseRows(f.organizationId, {
      field: "cause_text",
      candidate: { source: "template_outcome", id: membrane },
      count: 5,
    });

    const usage = await loadPhraseUsage(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
    });
    const deviationUsage = usage.filter((u) => u.field === "deviation_text");
    expect(deviationUsage).toEqual(
      expect.arrayContaining([
        { field: "deviation_text", ...PLACE.ventilationTg3, measureSortOrder: null, count: 3 },
        { field: "deviation_text", ...PLACE.membraneTg3, measureSortOrder: null, count: 1 },
      ]),
    );
    expect(deviationUsage).toHaveLength(2);
    // Ingen ansatt i svaret
    expect(JSON.stringify(usage)).not.toContain(f.employeeId);

    const view = await startedView(f);
    expect(view.phraseUsage).toEqual(expect.arrayContaining(usage));

    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "deviation_text",
    });
    const ventilationIndex = candidates.findIndex((c) => c.ref.id === ventilation);
    expect(candidates[ventilationIndex]?.chosenCount).toBe(3);
    // Ventilasjon er på et annet punkt og annen TG; blant de andre punktene står den først
    const otherCheckpoints = candidates.filter(
      (c) => c.checkpointKey !== PLACE.furnitureTg2.checkpointKey,
    );
    expect(otherCheckpoints[0]?.ref.id).toBe(ventilation);
  });

  it("K1.17a standardtiltak telles på utfallets koder og lik tekst", async () => {
    const f = await kiBathroom();
    const measures = await measureIdsOf(f.organizationId, f.templateVersionId, PLACE.membraneTg2);
    const second = measures[1];
    if (!second) throw new Error("mangler tiltak");
    await chosenPhraseRows(f.organizationId, {
      field: "new_measure",
      candidate: { source: "template_measure", id: second.id },
      count: 2,
    });
    const usage = await loadPhraseUsage(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
    });
    expect(usage).toEqual([
      { field: "new_measure", ...PLACE.membraneTg2, measureSortOrder: 1, count: 2 },
    ]);
  });

  it("K5.12a valg i organisasjon B teller aldri for A", async () => {
    const byOrg = new Map<string, { reportId: string; roomId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant, count] of [
          ["a", grantA, 2],
          ["b", grantB, 3],
        ] as const) {
          const f = await startedBathroom({ organizationId: grant.organizationId });
          byOrg.set(grant.organizationId, { reportId: f.reportId, roomId: f.roomId });
          const id = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg3);
          await chosenPhraseRows(f.organizationId, {
            field: "deviation_text",
            candidate: { source: "template_outcome", id },
            count,
          });
          ids[side].push(`${PLACE.membraneTg3.questionKey}:${count}`);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const own = byOrg.get(organizationId);
        if (!own) throw new Error("mangler oppsett");
        return loadPhraseUsage(grant, own);
      },
      idOf: (row) => `${row.questionKey}:${row.count}`,
    });
  });
});

describe("4a fraseforslag gjennom KI-grunnmuren", () => {
  it("K4.1 vanlig flyt: 1–5 kandidater rangert av falsk leverandør, én loggrad uten tekst", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    await clearField(f, deviationId, "cause_text");
    const requestId = uuidv7();
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId,
      deviationId,
      field: "cause_text",
      text: "funksjonen er usikker på grunn av alder",
    });
    if (result.status !== "ranked") throw new Error(`fikk ${result.status}`);
    expect(result.usageId).toBe(requestId);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    const own = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg2);
    expect(result.candidates[0]?.ref.id).toBe(own);
    expect(result.candidates[0]).toMatchObject({
      checkpointKey: PLACE.membraneTg2.checkpointKey,
      outcomeKey: "tg2",
      textStatus: "draft",
    });

    const row = await aiRow(requestId);
    expect(row).toMatchObject({
      feature: "phrase_suggest",
      outcome: "ok",
      status: "suggested",
      output_text: null,
      report_id: f.reportId,
      assignment_id: f.assignmentId,
      target_ref: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
    });
    expect(row?.candidate_refs).toEqual(result.candidates.map((c) => c.ref));
    for (const value of Object.values(row?.input_summary ?? {})) {
      expect(typeof value).toBe("number");
    }
  });

  it("K4.2 færre enn 3 kandidater: alle som passer vises", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.overheatingHms);
    await clearField(f, deviationId, "consequence_text");
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "consequence_text",
      text: "",
    });
    if (result.status !== "ranked") throw new Error(`fikk ${result.status}`);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.outcomeKind).toBe("hms");
  });

  it("K4.3 0 kandidater gir «Ingen treff» uten kall og uten loggrad", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.overheatingHms);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "cause_text",
      text: "Mxq varme",
    });
    expect(result).toEqual({ status: "no_match", usageId: null });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("K4.4 falsk leverandør gir no_match: «Ingen treff», raden logges som no_match", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const requestId = uuidv7();
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId,
      deviationId,
      field: "cause_text",
      text: FAKE_NO_MATCH_INPUT,
    });
    expect(result).toEqual({ status: "no_match", usageId: requestId });
    expect((await aiRow(requestId))?.outcome).toBe("no_match");
  });

  it("K4.5 tomt felt er lov: avvikets faste koder brukes, kall og loggrad", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const requestId = uuidv7();
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId,
      deviationId,
      field: "new_measure",
      text: "",
    });
    expect(result.status).toBe("ranked");
    const row = await aiRow(requestId);
    expect(row?.source_fields).toEqual(expect.arrayContaining(["outcome_key", "group"]));
  });

  it("K4.7 KI av i organisasjonen gir ai_off uten rad", async () => {
    const f = await startedBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "cause_text",
      text: "",
    });
    expect(result).toEqual({ status: "ai_off" });
    expect(await aiRowCount()).toBe(0);
  });

  it("K5.15 avvik fra en annen organisasjon eller et annet rom gir 404 uten rad", async () => {
    const a = await kiBathroom();
    const b = await kiBathroom();
    const foreign = await addPlaceDeviation(b, PLACE.membraneTg2);
    const error = await captureError(() =>
      suggestPhrases(a.actor, a.organizationId, a.room, {
        requestId: uuidv7(),
        deviationId: foreign,
        field: "cause_text",
        text: "",
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await aiRowCount()).toBe(0);
  });
});

describe("4d innsetting av valgt kandidat (A437, A469, A470)", () => {
  async function ranked(f: KiBathroom, deviationId: string, field: "cause_text" | "new_measure") {
    const result = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field,
      text: "",
    });
    if (result.status !== "ranked") throw new Error(`fikk ${result.status}`);
    return result;
  }

  it("K4.21 valgt tekst erstatter feltet, text_source og TG står, og valget logges", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const suggestion = await ranked(f, deviationId, "cause_text");
    const chosen = suggestion.candidates[1] ?? suggestion.candidates[0];
    if (!chosen) throw new Error("mangler kandidat");
    const result = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: suggestion.usageId,
      candidate: chosen.ref,
      base: before.causeText,
    });
    if (result.status !== "saved") throw new Error(`fikk ${result.status}`);
    expect(result.id).toBe(deviationId);
    const after = await deviationRow(deviationId);
    expect(after.causeText).toBe(result.text);
    expect(result.text).not.toMatch(/[{}]/);
    expect(after.textSource).toBe(before.textSource);
    expect(after.tg).toBe(before.tg);
    expect(after.kind).toBe(before.kind);
    const row = await aiRow(suggestion.usageId);
    expect(row).toMatchObject({ status: "accepted", chosen_candidate: chosen.ref });
  });

  it("K4.21 new_measure legger til et nytt tiltak, likt «+ Standardtiltak»", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const existing = await db
      .select()
      .from(deviationMeasures)
      .where(eq(deviationMeasures.deviationId, deviationId));
    const suggestion = await ranked(f, deviationId, "new_measure");
    const chosen = suggestion.candidates[0];
    if (!chosen) throw new Error("mangler kandidat");
    const measureId = uuidv7();
    const result = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: suggestion.usageId,
      candidate: chosen.ref,
      base: null,
      measureId,
    });
    expect(result.status).toBe("saved");
    const measures = await db
      .select()
      .from(deviationMeasures)
      .where(eq(deviationMeasures.deviationId, deviationId));
    expect(measures).toHaveLength(existing.length + 1);
    const added = measures.find((m) => m.id === measureId);
    expect(added).toMatchObject({ textSource: "template" });
    expect(added?.sortOrder).toBe(Math.max(...existing.map((m) => m.sortOrder)) + 1);
    for (const old of existing) {
      expect(measures.find((m) => m.id === old.id)?.text).toBe(old.text);
    }
    expect((await aiRow(suggestion.usageId))?.status).toBe("accepted");
  });

  it("K4.17b «Endret av andre»: ingenting lagres, og raden står fortsatt suggested", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const suggestion = await ranked(f, deviationId, "cause_text");
    const chosen = suggestion.candidates[0];
    if (!chosen) throw new Error("mangler kandidat");
    const result = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: suggestion.usageId,
      candidate: chosen.ref,
      base: "Mxq gammel tekst",
    });
    expect(result).toMatchObject({ status: "conflict", current: before.causeText });
    expect((await deviationRow(deviationId)).causeText).toBe(before.causeText);
    expect((await aiRow(suggestion.usageId))?.status).toBe("suggested");
  });

  it("K4.17b avviser beslutningen kandidaten, er teksten ikke lagret", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const suggestion = await ranked(f, deviationId, "cause_text");
    // En kandidat fra samme malversjon som ikke ble vist
    const shown = new Set(suggestion.candidates.map((c) => c.ref.id));
    const { candidates } = await loadPhraseCandidates(await grantOf(f), {
      reportId: f.reportId,
      roomId: f.roomId,
      deviationId,
      field: "cause_text",
    });
    const hidden = candidates.find((c) => !shown.has(c.ref.id));
    if (!hidden) throw new Error("mangler skjult kandidat");
    await expect(
      applyPhrase(f.actor, f.organizationId, f.room, {
        usageId: suggestion.usageId,
        candidate: hidden.ref,
        base: before.causeText,
      }),
    ).rejects.toThrow();
    expect((await deviationRow(deviationId)).causeText).toBe(before.causeText);
    expect((await aiRow(suggestion.usageId))?.status).toBe("suggested");
  });

  it("A470 loggrad med feil funksjon eller mål i et annet rom kan ikke brukes", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const own = await outcomeIdOf(f.organizationId, f.templateVersionId, PLACE.membraneTg2);
    const polish = await createAiUsageLog(f.organizationId, {
      reportId: f.reportId,
      targetRef: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
    });
    const wrongFeature = await captureError(() =>
      applyPhrase(f.actor, f.organizationId, f.room, {
        usageId: polish.id,
        candidate: { source: "template_outcome", id: own },
        base: before.causeText,
      }),
    );
    expect(wrongFeature).toBeInstanceOf(AccessDeniedError);

    // Samme organisasjon, annet bad på et annet oppdrag
    const other = await startedBathroom({ organizationId: f.organizationId });
    const otherDeviation = await addPlaceDeviation(other, PLACE.membraneTg2);
    const [otherRow] = await chosenPhraseRows(f.organizationId, {
      field: "cause_text",
      candidate: { source: "template_outcome", id: own },
      reportId: other.reportId,
      deviationId: otherDeviation,
    });
    await db.execute(
      sql`update ai_usage_log set status = 'suggested', chosen_candidate = null where id = ${otherRow ?? ""}`,
    );
    const wrongRoom = await captureError(() =>
      applyPhrase(f.actor, f.organizationId, f.room, {
        usageId: otherRow ?? "",
        candidate: { source: "template_outcome", id: own },
        base: null,
      }),
    );
    expect(wrongRoom).toBeInstanceOf(AccessDeniedError);
    expect((await deviationRow(deviationId)).causeText).toBe(before.causeText);
    expect((await deviationRow(otherDeviation)).causeText).not.toBeNull();
  });

  it("K5.14 kandidat-id fra en annen organisasjons mal gir 404, og ingenting lagres", async () => {
    const a = await kiBathroom();
    const b = await kiBathroom();
    const deviationId = await addPlaceDeviation(a, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    const suggestion = await ranked(a, deviationId, "cause_text");
    const foreign = await outcomeIdOf(b.organizationId, b.templateVersionId, PLACE.membraneTg2);
    const error = await captureError(() =>
      applyPhrase(a.actor, a.organizationId, a.room, {
        usageId: suggestion.usageId,
        candidate: { source: "template_outcome", id: foreign },
        base: before.causeText,
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((await deviationRow(deviationId)).causeText).toBe(before.causeText);
    expect((await aiRow(suggestion.usageId))?.status).toBe("suggested");
  });

  it("K5.15 B kan ikke bruke A sin loggrad", async () => {
    const a = await kiBathroom();
    const b = await kiBathroom();
    const deviationId = await addPlaceDeviation(a, PLACE.membraneTg2);
    const suggestion = await ranked(a, deviationId, "cause_text");
    const chosen = suggestion.candidates[0];
    if (!chosen) throw new Error("mangler kandidat");
    const error = await captureError(() =>
      applyPhrase(b.actor, b.organizationId, b.room, {
        usageId: suggestion.usageId,
        candidate: chosen.ref,
        base: null,
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((await aiRow(suggestion.usageId))?.status).toBe("suggested");
  });
});

describe("D4 «Utkast» per felt i visningen", () => {
  it("malens tekst gir draft; egen tekst gir null", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const before = await deviationRow(deviationId);
    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id: deviationId,
      field: "consequence_text",
      value: "Mxq egen konsekvens",
      base: before.consequenceText,
    });
    const view = await getRoomView(f.actor, f.organizationId, f.room);
    if (view.state !== "started") throw new Error("ikke startet");
    const deviation = view.checkpoints
      .flatMap((c) => c.deviations)
      .find((d) => d.id === deviationId);
    // Avviksteksten har flettefeltet {årstall} fylt inn som manglende
    expect(deviation?.textStatus).toEqual({
      deviationText: "draft",
      causeText: "draft",
      consequenceText: null,
    });
    expect(deviation?.measures.every((m) => m.textStatus === "draft")).toBe(true);
  });
});
