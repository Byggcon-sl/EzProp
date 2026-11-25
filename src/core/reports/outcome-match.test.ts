import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, type Actor } from "@/core/access";
import {
  OUTCOME_MATCH_CANDIDATES_MAX,
  OUTCOME_MATCH_NOTE_MAX,
  type AiCandidateRef,
} from "@/core/ai";
import {
  addDeviation,
  chooseOutcomeMatch,
  findOutcomes,
  rejectOutcomeMatch,
  saveField,
  setTgDirect,
  startReport,
  suggestPhrases,
  type RoomRef,
} from "@/core/reports";
import { db } from "@/db/client";
import { deviationMeasures, deviations, reports } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { REPORT_NEW_DEVIATION_FIELD_KEY } from "@/shared/config/ai-targets";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { NATIONAL_ID_MESSAGE } from "@/shared/validation/free-text";
import {
  aiRow,
  aiRowCount,
  allAiRows,
  allAuditRows,
  captureError,
  enableAi,
  fakeErrorInputs,
} from "../../../tests/ai";
import {
  createOrganization,
  createRoom,
  createTemplate,
  resetDatabase,
} from "../../../tests/factories";
import {
  addPlaceDeviation,
  countQueries,
  kiBathroom,
  outcomeIdOf,
  PLACE,
  type KiBathroom,
  type Place,
} from "../../../tests/report-ki-fixtures";
import {
  createBathroomFixture,
  createRoomOnNewAssignment,
  startedBathroom,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ReportValidationError } from "./errors";
import {
  chooseOutcomeMatchInputSchema,
  findOutcomesInputSchema,
  rejectOutcomeMatchInputSchema,
} from "./schemas";

/*
 * «Skriv det du ser» i rapportkjernen (docs/funksjoner/fase2a-skriv-det-du-ser-testplan.md avsnitt
 * 1d S1.32, 3, 4 og 5b): søket, valget og avvisningen gjennom `@/core/ai` med falsk leverandør.
 * Alle verdier er oppdiktede. Hovedmål: færre reklamasjoner (samme avvik som manuelt valg, og et
 * søk gir høyst ett avvik) og KI i bunnen (beslutningen i samme transaksjon som avviket).
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

/** Gulvflisene i badmalen. */
const FLOOR_TILES = {
  checkpointKey: "wet_room.floor",
  questionKey: "wet_room.floor.cracked_tiles_or_joints",
  outcomeKey: "tg2",
} as const as unknown as Place;

const NOTE = "sprekk i flis ved sluket, litt løs";
const MARKER = "Mxq-notat-ÆØ";

type Who = { actor: Actor; organizationId: string; room: RoomRef };

async function search(f: Who, note = NOTE, openCheckpointKey: string | null = null) {
  return findOutcomes(f.actor, f.organizationId, f.room, {
    requestId: uuidv7(),
    note,
    openCheckpointKey,
  });
}

async function ranked(f: Who, note = NOTE, openCheckpointKey: string | null = null) {
  const result = await search(f, note, openCheckpointKey);
  if (result.status !== "ranked") throw new Error(`fikk ${result.status}`);
  return result;
}

/** Treffet for utfallet, eller feil. */
function hitFor(result: Awaited<ReturnType<typeof ranked>>, place: Place) {
  const hit = result.hits.find(
    (h) =>
      h.checkpointKey === place.checkpointKey &&
      h.questionKey === place.questionKey &&
      h.outcomeKey === place.outcomeKey,
  );
  if (!hit) throw new Error("treffet mangler");
  return hit;
}

async function liveDeviations(reportId: string) {
  return db
    .select()
    .from(deviations)
    .where(and(eq(deviations.reportId, reportId), isNull(deviations.deletedAt)));
}

async function deviationRow(id: string) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
  if (!row) throw new Error("fant ikke avviket");
  return row;
}

/** Badmalen med `extra` ekstra spørsmål og utfall på gulvet (oppdiktet, for grensene). */
function bathroomWithExtraOutcomes(extra: number) {
  const questions = Array.from({ length: extra }, (_, i) => ({
    checkpoint_key: FLOOR_TILES.checkpointKey,
    key: `${FLOOR_TILES.checkpointKey}.extra_${i}`,
    text: `Er det oppdiktet funn nummer ${i} på gulvet?`,
    sort_order: 100 + i,
  }));
  return {
    ...wetRoomTemplate,
    deviation_questions: [...wetRoomTemplate.deviation_questions, ...questions],
    outcomes: [
      ...wetRoomTemplate.outcomes,
      ...questions.map((q, i) => ({
        checkpoint_key: q.checkpoint_key,
        question_key: q.key,
        key: "tg2",
        kind: "tg2" as const,
        deviation_text: `Det er oppdiktet funn nummer ${i} på gulvet.`,
        default_cause_text: null,
        default_cause_criterion: null,
        default_consequence_text: null,
        source_ref: null,
        text_status: "draft" as const,
        sort_order: 0,
      })),
    ],
  };
}

/** Bad med startet rapport på en egen (oppdiktet) mal, KI på. */
async function bathroomWith(document: typeof wetRoomTemplate) {
  const organizationId = (await createOrganization("Oppdiktet Takst Egen")).id;
  await createTemplate(organizationId, { status: "published", name: "Tilstandsrapport", document });
  const f = await createBathroomFixture({ organizationId, withTemplate: false });
  const { reportId } = await startReport(f.actor, f.organizationId, f.assignmentId);
  await enableAi(organizationId);
  return { ...f, reportId };
}

/** Bad med startet rapport på en mal med `extra` ekstra utfall, KI på. */
async function bigBathroom(extra: number) {
  return bathroomWith(bathroomWithExtraOutcomes(extra));
}

describe("S1.32 skjemaene", () => {
  const valid = {
    usageId: uuidv7(),
    candidate: { source: "template_outcome", id: uuidv7() },
    deviationId: uuidv7(),
    tg: null,
  };

  it("valget godtar bare bruk, kandidat, avviks-id og TG", () => {
    expect(chooseOutcomeMatchInputSchema.safeParse(valid).success).toBe(true);
    expect(
      chooseOutcomeMatchInputSchema.safeParse({ ...valid, tg: 3, tgiuChoice: "remove_tgiu" })
        .success,
    ).toBe(true);
  });

  it.each([
    ["checkpointKey", "wet_room.floor"],
    ["questionKey", "wet_room.floor.cracked_tiles_or_joints"],
    ["outcomeKey", "tg2"],
    ["organizationId", uuidv7()],
    ["reportId", uuidv7()],
    ["roomId", uuidv7()],
    ["note", "mxq"],
    ["ukjent", true],
  ])("valget avviser %s fra klienten", (key, value) => {
    expect(chooseOutcomeMatchInputSchema.safeParse({ ...valid, [key]: value }).success).toBe(false);
  });

  it.each([{ decision: "accepted" }, { decision: "undo" }, { candidate: valid.candidate }])(
    "avvisningen avviser %o",
    (extra) => {
      expect(rejectOutcomeMatchInputSchema.safeParse({ usageId: valid.usageId }).success).toBe(
        true,
      );
      expect(
        rejectOutcomeMatchInputSchema.safeParse({ usageId: valid.usageId, ...extra }).success,
      ).toBe(false);
    },
  );

  it("søket avviser fødselsnummer med den felles meldingen, ikke lengden", () => {
    const base = { requestId: uuidv7(), openCheckpointKey: null };
    const nationalId = findOutcomesInputSchema.safeParse({ ...base, note: "nr 01019912345" });
    expect(nationalId.success).toBe(false);
    expect(nationalId.error?.issues[0]?.message).toBe(NATIONAL_ID_MESSAGE);
    const long = "a".repeat(OUTCOME_MATCH_NOTE_MAX + 1);
    expect(findOutcomesInputSchema.safeParse({ ...base, note: long }).success).toBe(true);
  });
});

describe("4a søket", () => {
  it("S4.1 vanlig flyt: 1–3 treff fra malen, én loggrad med mål på rapporten", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits.length).toBeLessThanOrEqual(3);
    const floor = hitFor(result, FLOOR_TILES);
    expect(floor.ref).toEqual({
      source: "template_outcome",
      id: await outcomeIdOf(f.organizationId, f.templateVersionId, FLOOR_TILES),
    });
    expect(floor.checkpointName).not.toBe("");
    expect(floor.deviationText).toContain("sprukne fliser");
    // Ingen er forhåndsvalgt
    expect(JSON.stringify(result)).not.toMatch(/selected|preselected|chosen/i);

    const row = await aiRow(result.usageId);
    expect(row).toMatchObject({
      feature: "outcome_match",
      report_id: f.reportId,
      assignment_id: f.assignmentId,
      target_ref: { type: "report", id: f.reportId, fieldKey: REPORT_NEW_DEVIATION_FIELD_KEY },
      outcome: "ok",
      status: "suggested",
    });
    expect(row?.output_text ?? "").toBe("");
    expect(row?.candidate_refs).toEqual(result.hits.map((h) => h.ref));
    expect(Object.values(row?.input_summary ?? {}).every((v) => typeof v === "number")).toBe(true);
  });

  it("S4.2 bare den låste malversjonen og rommets romtype", async () => {
    const f = await kiBathroom();
    const marker = "Det er oppdiktet sprekk i flis ved sluket som løsner fra gulvet.";
    await createTemplate(f.organizationId, {
      status: "published",
      name: "Tilstandsrapport ny",
      document: {
        ...wetRoomTemplate,
        outcomes: wetRoomTemplate.outcomes.map((o) => ({ ...o, deviation_text: marker })),
      },
    });
    const result = await ranked(f);
    expect(result.hits.every((h) => h.deviationText !== marker)).toBe(true);
    const own = await db.execute(
      sql`select o.id from outcomes o
        join deviation_questions q on q.id = o.deviation_question_id
        join checkpoints c on c.id = q.checkpoint_id
        where c.version_id = ${f.templateVersionId}`,
    );
    const ownIds = new Set((own as unknown as { id: string }[]).map((r) => r.id));
    expect(result.hits.every((h) => ownIds.has(h.ref.id))).toBe(true);
  });

  it("S4.3 «Ingen utfall passer» gir no_match og rad med tom liste", async () => {
    const f = await kiBathroom();
    const result = await search(f, "qqq zzz xyv");
    expect(result.status).toBe("no_match");
    if (result.status !== "no_match" || result.usageId === null) throw new Error("mangler rad");
    const row = await aiRow(result.usageId);
    expect(row?.outcome).toBe("no_match");
    expect(row?.candidate_refs ?? []).toEqual([]);
  });

  it("S4.3 romtype uten utfall i malen: no_match uten kall og uten rad", async () => {
    const f = await bathroomWith({
      ...wetRoomTemplate,
      deviation_questions: [],
      outcomes: [],
      standard_measures: [],
      rules: [],
      rule_conditions: [],
      rule_test_cases: [],
    });
    const before = await aiRowCount();
    expect(await search(f)).toEqual({ status: "no_match", usageId: null });
    expect(await aiRowCount()).toBe(before);
  });

  it("S4.4 for mange kandidater: egen melding, intet kall og ingen rad", async () => {
    const f = await bigBathroom(OUTCOME_MATCH_CANDIDATES_MAX);
    const before = await aiRowCount();
    expect(await search(f)).toEqual({ status: "too_many_candidates" });
    expect(await aiRowCount()).toBe(before);
  });

  it("S4.5 for langt notat: note_too_long, ingen rad; 500 tegn er lov", async () => {
    const f = await kiBathroom();
    const before = await aiRowCount();
    expect(await search(f, "a".repeat(OUTCOME_MATCH_NOTE_MAX + 1))).toEqual({
      status: "note_too_long",
    });
    expect(await aiRowCount()).toBe(before);
    const ok = await search(f, `sprekk i flis ${"a".repeat(OUTCOME_MATCH_NOTE_MAX - 14)}`);
    expect(ok.status).not.toBe("note_too_long");
  });

  it("S4.5b fødselsnummer: valideringsfeil uten kall og rad, feilen gjengir ikke sifrene", async () => {
    const f = await kiBathroom();
    const before = await aiRowCount();
    const error = await captureError(() => search(f, `${MARKER} eier 01019912345`));
    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as ReportValidationError).code).toBe("invalid_input");
    expect(error.message).toBe(NATIONAL_ID_MESSAGE);
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(
      /01019912345|Mxq-notat/,
    );
    expect(await aiRowCount()).toBe(before);
  });

  it("tomt notat og ukjent åpent punkt avvises uten rad", async () => {
    const f = await kiBathroom();
    const before = await aiRowCount();
    const empty = await captureError(() => search(f, "   "));
    expect((empty as ReportValidationError).code).toBe("invalid_input");
    const unknown = await captureError(() => search(f, MARKER, "wet_room.finnes_ikke"));
    expect((unknown as ReportValidationError).code).toBe("unknown_key");
    expect(unknown.message).not.toContain(MARKER);
    expect(await aiRowCount()).toBe(before);
  });

  it("det åpne punktet kommer først ved lik likhet", async () => {
    const f = await kiBathroom();
    const wall = await ranked(f, "sprekk i flis", "wet_room.walls_ceiling");
    const floor = await ranked(f, "sprekk i flis", FLOOR_TILES.checkpointKey);
    expect(wall.hits[0]?.checkpointKey).toBe("wet_room.walls_ceiling");
    expect(floor.hits[0]?.checkpointKey).toBe(FLOOR_TILES.checkpointKey);
  });

  it("S4.5a KI av gir ai_off; feil hos leverandøren gir ai_error og error-rad", async () => {
    const off = await startedBathroom();
    expect(await search(off)).toEqual({ status: "ai_off" });
    expect(await aiRowCount()).toBe(0);

    const f = await kiBathroom();
    const [errorInput] = fakeErrorInputs();
    if (!errorInput) throw new Error("mangler feilinndata");
    const requestId = uuidv7();
    const input = { requestId, note: `flis ${errorInput}`, openCheckpointKey: null };
    expect(await findOutcomes(f.actor, f.organizationId, f.room, input)).toEqual({
      status: "ai_error",
    });
    expect((await aiRow(requestId))?.outcome).toBe("error");
    // Samme forsøk på nytt gir ingen ny rad
    const rows = await aiRowCount();
    await findOutcomes(f.actor, f.organizationId, f.room, input);
    expect(await aiRowCount()).toBe(rows);
  });

  it("S4.21 fast antall spørringer, også i et bad med ca. 60 utfall", async () => {
    const small = await kiBathroom();
    const extra = OUTCOME_MATCH_CANDIDATES_MAX - wetRoomTemplate.outcomes.length;
    const big = await bigBathroom(extra);
    await addPlaceDeviation(small, PLACE.membraneTg2);
    const smallCount = await countQueries(() => search(small));
    const bigCount = await countQueries(() => search(big));
    expect(bigCount).toBe(smallCount);
  });
});

describe("4b valget", () => {
  it("S4.6 samme avvik som manuelt valg, uten regel", async () => {
    const manual = await kiBathroom();
    const manualId = await addPlaceDeviation(manual, FLOOR_TILES);
    const f = await kiBathroom();
    const result = await ranked(f);
    const hit = hitFor(result, FLOOR_TILES);
    const deviationId = uuidv7();
    const chosen = await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: hit.ref,
      deviationId,
      tg: null,
    });
    expect(chosen).toMatchObject({
      status: "saved",
      checkpointKey: FLOOR_TILES.checkpointKey,
      deviationId,
    });

    const pick = (row: Awaited<ReturnType<typeof deviationRow>>) => ({
      kind: row.kind,
      tg: row.tg,
      deviationText: row.deviationText,
      causeText: row.causeText,
      causeCriterion: row.causeCriterion,
      consequenceText: row.consequenceText,
      textSource: row.textSource,
      costType: row.costType,
      suggestedByRuleId: row.suggestedByRuleId,
    });
    const viaAi = await deviationRow(deviationId);
    expect(pick(viaAi)).toEqual(pick(await deviationRow(manualId)));
    expect(viaAi.suggestedByRuleId).toBeNull();
    const measuresOf = async (id: string) =>
      (await db.select().from(deviationMeasures).where(eq(deviationMeasures.deviationId, id))).map(
        (m) => m.text,
      );
    expect(await measuresOf(deviationId)).toEqual(await measuresOf(manualId));
  });

  it("S4.7 beslutningen i samme transaksjon; TGIU gir ingen avvik og ingen beslutning", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    const hit = hitFor(result, FLOOR_TILES);
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: FLOOR_TILES.checkpointKey,
      tgDirect: "IU",
      base: null,
    });
    const conflict = await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: hit.ref,
      deviationId: uuidv7(),
      tg: null,
    });
    expect(conflict).toEqual({ status: "tgiu_conflict" });
    expect(await liveDeviations(f.reportId)).toHaveLength(0);
    expect((await aiRow(result.usageId))?.status).toBe("suggested");

    const deviationId = uuidv7();
    const saved = await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: hit.ref,
      deviationId,
      tg: null,
      tgiuChoice: "remove_tgiu",
    });
    expect(saved.status).toBe("saved");
    const row = await aiRow(result.usageId);
    expect(row?.status).toBe("accepted");
    expect(row?.chosen_candidate).toEqual(hit.ref);
    expect(await liveDeviations(f.reportId)).toHaveLength(1);
  });

  it("S4.8 gjentatt valg gir ett avvik; annet utfall og brukt søk endrer ingenting", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    const hit = hitFor(result, FLOOR_TILES);
    const deviationId = uuidv7();
    const input = { usageId: result.usageId, candidate: hit.ref, deviationId, tg: null };
    expect((await chooseOutcomeMatch(f.actor, f.organizationId, f.room, input)).status).toBe(
      "saved",
    );
    const decided = await aiRow(result.usageId);
    expect((await chooseOutcomeMatch(f.actor, f.organizationId, f.room, input)).status).toBe(
      "saved",
    );
    expect(await aiRow(result.usageId)).toEqual(decided);
    expect(await liveDeviations(f.reportId)).toHaveLength(1);

    const other = result.hits.find((h) => h.ref.id !== hit.ref.id);
    if (other) {
      const error = await captureError(() =>
        chooseOutcomeMatch(f.actor, f.organizationId, f.room, { ...input, candidate: other.ref }),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
    }

    // Brukt søk (A564): ny avviks-id gir utdatert, og det nye avviket rulles tilbake
    const audits = (await allAuditRows()).length;
    const again = await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      ...input,
      deviationId: uuidv7(),
    });
    expect(again).toEqual({ status: "suggestion_outdated" });
    expect(await liveDeviations(f.reportId)).toHaveLength(1);
    expect(await aiRow(result.usageId)).toEqual(decided);
    expect((await allAuditRows()).length).toBe(audits);
  });

  it("S4.9 «velg TG2 eller TG3» uten TG gir avvik uten TG; TG fra takstmannen settes", async () => {
    const f = await kiBathroom();
    const note = "hulltaking bak dusjen, målt forhøyet fukt 22 vekt-%";
    const first = await ranked(f, `${note} dette er TG3`);
    const choose = first.hits.find((h) => h.outcomeKey === PLACE.adjacentChoose.outcomeKey);
    if (!choose) throw new Error("mangler «velg»-treffet");
    const noTg = uuidv7();
    await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: first.usageId,
      candidate: choose.ref,
      deviationId: noTg,
      tg: null,
    });
    expect((await deviationRow(noTg)).tg).toBeNull();

    const second = await ranked(f, note);
    const withTg = uuidv7();
    await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: second.usageId,
      candidate: choose.ref,
      deviationId: withTg,
      tg: 3,
    });
    expect((await deviationRow(withTg)).tg).toBe(3);
  });

  it("S4.10 kandidat utenfor listen, fra en annen malversjon eller romtype gir 404", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    const notListed = await outcomeIdOf(
      f.organizationId,
      f.templateVersionId,
      PLACE.overheatingHms,
    );
    const newer = await createTemplate(f.organizationId, {
      status: "published",
      name: "Tilstandsrapport ny",
      document: wetRoomTemplate,
    });
    const otherVersion = await outcomeIdOf(f.organizationId, newer.versionId, FLOOR_TILES);
    const before = await aiRow(result.usageId);
    for (const id of [notListed, otherVersion]) {
      // Selv om id-en settes inn i listen, gjelder malversjonen og rommet
      await db.execute(
        sql`update ai_usage_log set candidate_refs = candidate_refs || ${JSON.stringify([
          { source: "template_outcome", id },
        ])}::jsonb where id = ${result.usageId}`,
      );
    }
    const listedNow = await aiRow(result.usageId);
    for (const id of [otherVersion, uuidv7()]) {
      const error = await captureError(() =>
        chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
          usageId: result.usageId,
          candidate: { source: "template_outcome", id },
          deviationId: uuidv7(),
          tg: null,
        }),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
    }
    // Feil kilde
    const wrongSource = await captureError(() =>
      chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
        usageId: result.usageId,
        candidate: { source: "template_measure", id: result.hits[0]!.ref.id },
        deviationId: uuidv7(),
        tg: null,
      }),
    );
    expect(wrongSource).toBeInstanceOf(AccessDeniedError);
    expect(await liveDeviations(f.reportId)).toHaveLength(0);
    expect(await aiRow(result.usageId)).toEqual(listedNow);
    expect(before?.status).toBe("suggested");
  });

  it("S4.11 bindingen: annen rapport, annen organisasjon og phrase_suggest-rad gir 404", async () => {
    const f = await kiBathroom();
    const own = await ranked(f);
    const hit = hitFor(own, FLOOR_TILES);

    // En annen rapport i samme organisasjon
    const place = await createRoomOnNewAssignment(f.organizationId, {
      inspectionAt: new Date("2026-06-15T10:00:00Z"),
    });
    await startReport(f.actor, f.organizationId, place.assignmentId);
    const otherReport = await ranked({ ...f, room: place.room });

    // En annen organisasjon
    const foreign = await kiBathroom();
    const foreignSearch = await ranked(foreign);

    // Et fraseforslag på et avvik i rommet
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const phrase = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "new_measure",
      text: "",
    });
    if (phrase.status !== "ranked") throw new Error(`fikk ${phrase.status}`);

    const deviationsBefore = (await liveDeviations(f.reportId)).length;
    const rowsBefore = JSON.stringify(await allAiRows());
    for (const usageId of [otherReport.usageId, foreignSearch.usageId, phrase.usageId]) {
      const choose = await captureError(() =>
        chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
          usageId,
          candidate: hit.ref,
          deviationId: uuidv7(),
          tg: null,
        }),
      );
      expect(choose).toBeInstanceOf(AccessDeniedError);
      const reject = await captureError(() =>
        rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId }),
      );
      expect(reject).toBeInstanceOf(AccessDeniedError);
    }
    expect((await liveDeviations(f.reportId)).length).toBe(deviationsBefore);
    expect(JSON.stringify(await allAiRows())).toBe(rowsBefore);
  });

  it("S4.12 overlappende søk på samme rapport: det første er utdatert, uten avvik og beslutning", async () => {
    const f = await kiBathroom();
    const [roomRow] = (await db.execute(
      sql`select floor_id from rooms where id = ${f.roomId}`,
    )) as unknown as { floor_id: string }[];
    const roomB = await createRoom(f.organizationId, {
      floorId: roomRow!.floor_id,
      roomType: "bathroom",
    });
    const inB = { ...f, room: { assignmentId: f.assignmentId, roomId: roomB.id } };

    const first = await ranked(f);
    const second = await ranked(inB);
    expect((await aiRow(first.usageId))?.status).toBe("rejected");

    const outdated = await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: first.usageId,
      candidate: hitFor(first, FLOOR_TILES).ref,
      deviationId: uuidv7(),
      tg: null,
    });
    expect(outdated).toEqual({ status: "suggestion_outdated" });
    expect(await liveDeviations(f.reportId)).toHaveLength(0);
    expect((await aiRow(first.usageId))?.chosen_candidate ?? null).toBeNull();

    // Søk 2 gjelder rom B; valget gjøres i rommet der søket ble gjort
    const saved = await chooseOutcomeMatch(f.actor, f.organizationId, inB.room, {
      usageId: second.usageId,
      candidate: hitFor(second, FLOOR_TILES).ref,
      deviationId: uuidv7(),
      tg: null,
    });
    expect(saved.status).toBe("saved");
    expect(await liveDeviations(f.reportId)).toHaveLength(1);
  });

  it("S4.13 publisert rapport og slettet rom: avslag uten rad og avvik", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    const hit = hitFor(result, FLOOR_TILES);
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, f.reportId));
    const rows = await aiRowCount();
    for (const run of [
      () => search(f),
      () =>
        chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
          usageId: result.usageId,
          candidate: hit.ref,
          deviationId: uuidv7(),
          tg: null,
        }),
      () => rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId: result.usageId }),
    ]) {
      const error = await captureError(run);
      expect((error as ReportValidationError).code).toBe("report_published");
    }
    expect(await aiRowCount()).toBe(rows);
    expect(await liveDeviations(f.reportId)).toHaveLength(0);

    const g = await kiBathroom();
    await db.execute(sql`update rooms set deleted_at = now() where id = ${g.roomId}`);
    expect(await captureError(() => search(g))).toBeInstanceOf(AccessDeniedError);
  });
});

describe("4c avvisningen", () => {
  it("S4.14 rejected; alt avvist er uendret; godtatt gir already_decided", async () => {
    const f = await kiBathroom();
    const result = await ranked(f);
    expect(
      await rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId: result.usageId }),
    ).toEqual({ status: "saved" });
    const rejected = await aiRow(result.usageId);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.chosen_candidate ?? null).toBeNull();
    expect(
      await rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId: result.usageId }),
    ).toEqual({ status: "saved" });
    expect(await aiRow(result.usageId)).toEqual(rejected);

    const second = await ranked(f);
    const deviationId = uuidv7();
    await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: second.usageId,
      candidate: hitFor(second, FLOOR_TILES).ref,
      deviationId,
      tg: null,
    });
    const accepted = await aiRow(second.usageId);
    expect(
      await rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId: second.usageId }),
    ).toEqual({ status: "already_decided" });
    expect(await aiRow(second.usageId)).toEqual(accepted);
    expect(await liveDeviations(f.reportId)).toHaveLength(1);
  });

  it("S4.14 no_match-rad kan ikke avvises", async () => {
    const f = await kiBathroom();
    const result = await search(f, "qqq zzz xyv");
    if (result.status !== "no_match" || result.usageId === null) throw new Error("mangler rad");
    const error = await captureError(() =>
      rejectOutcomeMatch(f.actor, f.organizationId, f.room, { usageId: result.usageId! }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
  });
});

describe("4d notatet i avviket og text_source", () => {
  async function chosenDeviation(f: KiBathroom) {
    const result = await ranked(f);
    const deviationId = uuidv7();
    await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: hitFor(result, FLOOR_TILES).ref,
      deviationId,
      tg: null,
    });
    return deviationRow(deviationId);
  }

  async function saveText(
    f: KiBathroom,
    id: string,
    field: "deviation_text" | "cause_text" | "consequence_text",
    value: string | null,
    base: string | null,
  ) {
    const result = await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id,
      field,
      value,
      base,
    });
    expect(result.status).toBe("saved");
  }

  it("S4.19 uten trykk: malens tekst og template", async () => {
    const f = await kiBathroom();
    expect((await chosenDeviation(f)).textSource).toBe("template");
  });

  it("S4.16/S4.18 «Legg notatet til» gir edited, «Angre» gir template igjen", async () => {
    const f = await kiBathroom();
    const original = await chosenDeviation(f);
    const withNote = `${original.deviationText} ${NOTE}`;
    await saveText(f, original.id, "deviation_text", withNote, original.deviationText);
    const edited = await deviationRow(original.id);
    expect(edited.textSource).toBe("edited");
    expect(edited.rowVersion).toBeGreaterThan(original.rowVersion);

    await saveText(f, original.id, "deviation_text", original.deviationText, withNote);
    expect((await deviationRow(original.id)).textSource).toBe("template");
  });

  it.each([
    ["deviation_text", "deviationText"],
    ["cause_text", "causeText"],
    ["consequence_text", "consequenceText"],
  ] as const)(
    "S1.21 text_source: endret %s gir edited, tilbake til malens tekst gir template",
    async (field, column) => {
      const f = await kiBathroom();
      const original = await chosenDeviation(f);
      expect(original.textSource).toBe("template");
      const changed = `${original[column] ?? ""} Mxq egen tekst.`;
      await saveText(f, original.id, field, changed, original[column]);
      expect((await deviationRow(original.id)).textSource).toBe("edited");
      await saveText(f, original.id, field, original[column], changed);
      expect((await deviationRow(original.id)).textSource).toBe("template");
    },
  );

  it("S4.18 «Angre» gir edited når årsaken er endret av takstmannen", async () => {
    const f = await kiBathroom();
    const original = await chosenDeviation(f);
    await saveText(f, original.id, "cause_text", "Mxq egen årsak.", original.causeText);
    const withNote = `${original.deviationText} ${NOTE}`;
    await saveText(f, original.id, "deviation_text", withNote, original.deviationText);
    await saveText(f, original.id, "deviation_text", original.deviationText, withNote);
    expect((await deviationRow(original.id)).textSource).toBe("edited");
    // Årsaken tilbake til malens: alle tre er lik malen igjen
    await saveText(f, original.id, "cause_text", original.causeText, "Mxq egen årsak.");
    expect((await deviationRow(original.id)).textSource).toBe("template");
  });

  it("text_source: free endres aldri, og flettefelt fylles som ved oppretting", async () => {
    const f = await kiBathroom();
    const id = uuidv7();
    const added = await addDeviation(f.actor, f.organizationId, f.room, {
      id,
      ...PLACE.membraneTg2,
      tg: null,
    });
    expect(added.status).toBe("saved");
    const original = await deviationRow(id);
    await saveText(f, id, "deviation_text", "Mxq", original.deviationText);
    await saveText(f, id, "deviation_text", original.deviationText, "Mxq");
    expect((await deviationRow(id)).textSource).toBe("template");

    await db.update(deviations).set({ textSource: "free" }).where(eq(deviations.id, id));
    await saveText(f, id, "deviation_text", "Mxq fri", original.deviationText);
    await saveText(f, id, "deviation_text", original.deviationText, "Mxq fri");
    expect((await deviationRow(id)).textSource).toBe("free");
  });

  it("S4.20 notatet står aldri i ai_usage_log, audit_log, logger eller feilsvar", async () => {
    const calls: unknown[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    const f = await kiBathroom();
    const note = `${MARKER} ${NOTE}, sprukne fliser og riss i fuger på gulvet`;
    const result = await ranked(f, note);
    const deviationId = uuidv7();
    await chooseOutcomeMatch(f.actor, f.organizationId, f.room, {
      usageId: result.usageId,
      candidate: hitFor(result, FLOOR_TILES).ref,
      deviationId,
      tg: null,
    });
    await ranked(f, note);
    const unknown = await captureError(() => search(f, note, "wet_room.finnes_ikke"));
    const [errorInput] = fakeErrorInputs();
    await search(f, `${note} ${errorInput}`);

    expect(JSON.stringify(await allAiRows())).not.toContain(MARKER);
    const audit = await allAuditRows();
    expect(JSON.stringify(audit)).not.toContain(MARKER);
    expect(JSON.stringify(calls)).not.toContain(MARKER);
    expect(`${unknown.message} ${JSON.stringify(unknown)}`).not.toContain(MARKER);
    // Revisjonsloggen for avviket har bare `usageId`
    expect(JSON.stringify(audit)).toContain(result.usageId);
    expect((await deviationRow(deviationId)).deviationText).not.toContain(MARKER);
  });
});

describe("5b tenant-isolasjon", () => {
  type Seeded = { f: KiBathroom; usageId: string; candidate: AiCandidateRef };

  async function seedOrgs(grantA: { organizationId: string }, grantB: { organizationId: string }) {
    const byOrg = new Map<string, Seeded & { deviationId: string; outcomeId: string }>();
    const ids = { a: [] as string[], b: [] as string[] };
    for (const [side, grant] of [
      ["a", grantA],
      ["b", grantB],
    ] as const) {
      const f = await kiBathroom({ organizationId: grant.organizationId });
      const result = await ranked(f);
      const hit = hitFor(result, FLOOR_TILES);
      const seeded = {
        f,
        usageId: result.usageId,
        candidate: hit.ref,
        deviationId: uuidv7(),
        outcomeId: hit.ref.id,
      };
      byOrg.set(grant.organizationId, seeded);
      ids[side].push(seeded.outcomeId);
    }
    return { byOrg, ids };
  }

  function ownOf<T>(byOrg: Map<string, T>, organizationId: string): T {
    const own = byOrg.get(organizationId);
    if (!own) throw new Error("mangler oppsett");
    return own;
  }

  it("S5.7/S5.8 søket og kandidatene", async () => {
    let byOrg = new Map<string, Seeded>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const seeded = await seedOrgs(grantA, grantB);
        byOrg = seeded.byOrg;
        return seeded.ids;
      },
      query: async (actor, organizationId) => {
        const own = ownOf(byOrg, organizationId);
        const result = await findOutcomes(actor, organizationId, own.f.room, {
          requestId: uuidv7(),
          note: NOTE,
          openCheckpointKey: null,
        });
        return result.status === "ranked" ? result.hits : [];
      },
      idOf: (hit) => hit.ref.id,
    });
  });

  it("S5.9 valget", async () => {
    let byOrg = new Map<string, Seeded & { deviationId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const seeded = await seedOrgs(grantA, grantB);
        byOrg = seeded.byOrg;
        return seeded.ids;
      },
      query: async (actor, organizationId) => {
        const own = ownOf(byOrg, organizationId);
        const result = await chooseOutcomeMatch(actor, organizationId, own.f.room, {
          usageId: own.usageId,
          candidate: own.candidate,
          deviationId: own.deviationId,
          tg: null,
        });
        if (result.status !== "saved") return [];
        const row = await deviationRow(result.deviationId);
        return row.outcomeId ? [row.outcomeId] : [];
      },
      idOf: (id) => id,
    });

    // A sin grant og eget rom med B sin rad og kandidat: 404, og ingenting endres
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    const second = await ranked(a.f);
    const rowsBefore = JSON.stringify(await allAiRows());
    for (const input of [
      { usageId: b.usageId, candidate: b.candidate },
      { usageId: second.usageId, candidate: b.candidate },
    ]) {
      const error = await captureError(() =>
        chooseOutcomeMatch(a.f.actor, a.f.organizationId, a.f.room, {
          ...input,
          deviationId: uuidv7(),
          tg: null,
        }),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
    }
    expect(JSON.stringify(await allAiRows())).toBe(rowsBefore);
    expect(await liveDeviations(a.f.reportId)).toHaveLength(1);
  });

  it("S5.10 avvisningen", async () => {
    let byOrg = new Map<string, Seeded>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const seeded = await seedOrgs(grantA, grantB);
        byOrg = seeded.byOrg;
        return {
          a: [byOrg.get(grantA.organizationId)!.usageId],
          b: [byOrg.get(grantB.organizationId)!.usageId],
        };
      },
      query: async (actor, organizationId) => {
        const own = ownOf(byOrg, organizationId);
        const result = await rejectOutcomeMatch(actor, organizationId, own.f.room, {
          usageId: own.usageId,
        });
        return result.status === "saved" ? [own.usageId] : [];
      },
      idOf: (id) => id,
    });
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    const before = await aiRow(b.usageId);
    const error = await captureError(() =>
      rejectOutcomeMatch(a.f.actor, a.f.organizationId, a.f.room, { usageId: b.usageId }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await aiRow(b.usageId)).toEqual(before);
  });
});

describe("S5.13 og S5.15 statisk", () => {
  it("de nye filene filtrerer på organisasjonen fra tilgangen og sletter aldri", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const name of ["outcome-match.ts", "outcome-match-choice.ts"]) {
      const text = readFileSync(path.resolve(process.cwd(), "src/core/reports", name), "utf8");
      expect(text, name).not.toMatch(/\.delete\(|\bdelete\s+from\b/i);
      expect(text, name).not.toMatch(/eq\([^)]*,\s*(?:input|values)\.organizationId\)/);
    }
  });
});
