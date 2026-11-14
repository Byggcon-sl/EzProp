import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  checkpointResults,
  deviations,
  fieldAnswers,
  reports,
  ruleSuggestionDecisions,
  tgiuDetails,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createAssignment,
  createCheckpointResultRow,
  createCheckpointRow,
  createDeviationMeasureRow,
  createDeviationRow,
  createEmployee,
  createFieldAnswerRow,
  createOrganization,
  createReportRow,
  createRoom,
  createRuleSuggestionDecisionRow,
  createStandardMeasureRow,
  createTemplateElementRow,
  createTgiuDetailsRow,
  createUser,
  resetDatabase,
} from "../../tests/factories";

/*
 * Databasen selv holder rapportdataene riktige (migrering `0035_badet-pc`, ADR 0013,
 * docs/funksjoner/fase2a-badet-pc.md): ingen rad peker inn i en annen organisasjon eller en annen
 * rapport, unike nøkler holder også når bygning eller rom er tom, og CHECK-reglene stopper
 * ugyldig TG, kostnad og beslutning. Direkte innsetting med radbyggerne, utenom kjernen og Zod.
 * Feilkoden sjekkes, så en skrivefeil gir ikke falsk grønn test.
 *
 * Støtter hovedmål: færre reklamasjoner (TG og beslutninger kan ikke lagres i ugyldig form) og
 * KI i bunnen (strukturerte data med faste koder). Testdata er oppdiktet og uten fagtekst.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const DELETED_AT = new Date("2026-11-14T09:00:00Z");

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(action: () => Promise<unknown>, code: string) {
  let found: string | undefined = "ingen feil";
  try {
    await action();
  } catch (error) {
    found = pgCode(error);
  }
  expect(found).toBe(code);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Oppdiktet Takst A");
  const orgB = await createOrganization("Oppdiktet Takst B");
  return { orgA, orgB };
}

describe("reports", () => {
  it("én gjeldende rapport per oppdrag; erstattet og mykt slettet teller ikke", async () => {
    const { orgA } = await twoOrganizations();
    const assignment = await createAssignment(orgA.id);
    const first = await createReportRow(orgA.id, { assignmentId: assignment.id });
    await expectPgError(() => createReportRow(orgA.id, { assignmentId: assignment.id }), UNIQUE);

    await db.update(reports).set({ status: "superseded" }).where(eq(reports.id, first.id));
    const second = await createReportRow(orgA.id, { assignmentId: assignment.id });
    await db.update(reports).set({ deletedAt: DELETED_AT }).where(eq(reports.id, second.id));
    await createReportRow(orgA.id, { assignmentId: assignment.id });
  });

  it("to samtidige start gir én rapport med `on conflict do nothing`", async () => {
    const { orgA } = await twoOrganizations();
    const assignment = await createAssignment(orgA.id);
    const version = (await createReportRow(orgA.id)).templateVersionId;
    const start = () =>
      db
        .insert(reports)
        .values({
          id: uuidv7(),
          organizationId: orgA.id,
          assignmentId: assignment.id,
          templateVersionId: version,
          reportType: "condition_report",
        })
        .onConflictDoNothing()
        .returning();
    const results = await Promise.all([start(), start()]);
    expect(results.flat()).toHaveLength(1);
  });

  it("oppdrag og malversjon må høre til samme organisasjon; ukjent status og type avvises", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreignAssignment = await createAssignment(orgB.id);
    const foreignVersion = (await createReportRow(orgB.id)).templateVersionId;
    await expectPgError(
      () => createReportRow(orgA.id, { assignmentId: foreignAssignment.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () => createReportRow(orgA.id, { templateVersionId: foreignVersion }),
      FOREIGN_KEY,
    );
    await expectPgError(() => createReportRow(orgA.id, { status: "sent" as never }), CHECK);
    await expectPgError(() => createReportRow(orgA.id, { reportType: "valuation" }), CHECK);
  });
});

describe("checkpoint_results", () => {
  it("ett resultat per kontrollpunkt og rom, også med tom bygning; mykt slettet teller ikke", async () => {
    const { orgA } = await twoOrganizations();
    const report = await createReportRow(orgA.id);
    const checkpoint = await createCheckpointRow(orgA.id);
    const room = await createRoom(orgA.id);
    const place = { reportId: report.id, checkpointId: checkpoint.id, roomId: room.id };
    const first = await createCheckpointResultRow(orgA.id, place);
    await expectPgError(() => createCheckpointResultRow(orgA.id, place), UNIQUE);

    // Annet rom er et annet sted
    await createCheckpointResultRow(orgA.id, { ...place, roomId: (await createRoom(orgA.id)).id });

    await db
      .update(checkpointResults)
      .set({ deletedAt: DELETED_AT })
      .where(eq(checkpointResults.id, first.id));
    await createCheckpointResultRow(orgA.id, place);
  });

  it("nøyaktig én av bygning og rom; TG direkte er bare 0, 1 eller IU; ferdig krever hvem og når", async () => {
    const { orgA } = await twoOrganizations();
    await expectPgError(() => createCheckpointResultRow(orgA.id, { roomId: null }), CHECK);
    for (const tg of ["2", "3", "iu"]) {
      await expectPgError(
        () => createCheckpointResultRow(orgA.id, { tgDirect: tg as never }),
        CHECK,
      );
    }
    for (const tg of ["0", "1", "IU"] as const) {
      await createCheckpointResultRow(orgA.id, { tgDirect: tg });
    }
    await expectPgError(() => createCheckpointResultRow(orgA.id, { done: true }), CHECK);
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    await createCheckpointResultRow(orgA.id, {
      done: true,
      doneBy: employee.id,
      doneAt: new Date("2026-11-14T10:00:00Z"),
    });
  });

  it("rapport, kontrollpunkt, rom og ansatt må høre til samme organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreignReport = await createReportRow(orgB.id);
    const foreignCheckpoint = await createCheckpointRow(orgB.id);
    const foreignRoom = await createRoom(orgB.id);
    const foreignEmployee = await createEmployee(await createUser(), orgB.id, ["inspector"]);
    await expectPgError(
      () => createCheckpointResultRow(orgA.id, { reportId: foreignReport.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () => createCheckpointResultRow(orgA.id, { checkpointId: foreignCheckpoint.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () => createCheckpointResultRow(orgA.id, { roomId: foreignRoom.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () =>
        createCheckpointResultRow(orgA.id, {
          done: true,
          doneBy: foreignEmployee.id,
          doneAt: new Date("2026-11-14T10:00:00Z"),
        }),
      FOREIGN_KEY,
    );
  });
});

describe("field_answers", () => {
  it("ett svar per felt og sted, også når bygning og kontrollpunkt er tomme", async () => {
    const { orgA } = await twoOrganizations();
    const report = await createReportRow(orgA.id);
    const element = await createTemplateElementRow(orgA.id);
    const room = await createRoom(orgA.id);
    const place = { reportId: report.id, elementId: element.id, roomId: room.id };
    const first = await createFieldAnswerRow(orgA.id, place);
    await expectPgError(() => createFieldAnswerRow(orgA.id, place), UNIQUE);

    await createFieldAnswerRow(orgA.id, { ...place, repeatIndex: 1 });
    await expectPgError(() => createFieldAnswerRow(orgA.id, { ...place, repeatIndex: -1 }), CHECK);

    await db
      .update(fieldAnswers)
      .set({ deletedAt: DELETED_AT })
      .where(eq(fieldAnswers.id, first.id));
    await createFieldAnswerRow(orgA.id, place);
  });

  it("felt, rom og KI-logg må høre til samme organisasjon; kontrollpunktet til samme rapport", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreignElement = await createTemplateElementRow(orgB.id);
    const foreignRoom = await createRoom(orgB.id);
    const foreignAi = await createAiUsageLog(orgB.id);
    await expectPgError(
      () => createFieldAnswerRow(orgA.id, { elementId: foreignElement.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () => createFieldAnswerRow(orgA.id, { roomId: foreignRoom.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      () => createFieldAnswerRow(orgA.id, { aiUsageId: foreignAi.id }),
      FOREIGN_KEY,
    );
    const ownAi = await createAiUsageLog(orgA.id);
    await createFieldAnswerRow(orgA.id, { aiUsageId: ownAi.id });

    const otherReportResult = await createCheckpointResultRow(orgA.id);
    await expectPgError(
      () => createFieldAnswerRow(orgA.id, { checkpointResultId: otherReportResult.id }),
      FOREIGN_KEY,
    );
  });
});

describe("deviations og deviation_measures", () => {
  it("TG er 2 eller 3 på avvik med TG, kan vente på valg, og er alltid tom for HMS", async () => {
    const { orgA } = await twoOrganizations();
    await createDeviationRow(orgA.id, { kind: "tg", tg: 2 });
    await createDeviationRow(orgA.id, { kind: "tg", tg: 3 });
    await createDeviationRow(orgA.id, { kind: "tg", tg: null });
    await createDeviationRow(orgA.id, { kind: "hms", tg: null });
    await expectPgError(() => createDeviationRow(orgA.id, { kind: "tg", tg: 1 as never }), CHECK);
    await expectPgError(() => createDeviationRow(orgA.id, { kind: "tg", tg: 0 as never }), CHECK);
    await expectPgError(() => createDeviationRow(orgA.id, { kind: "hms", tg: 3 }), CHECK);
    await expectPgError(() => createDeviationRow(orgA.id, { kind: "tgiu" as never }), CHECK);
  });

  it("kostnad: intervall krever kode, eget beløp krever beløp over 0, ingen har ingen av delene", async () => {
    const { orgA } = await twoOrganizations();
    await createDeviationRow(orgA.id, { costType: "band", costBandKey: "under_20000" });
    await createDeviationRow(orgA.id, { costType: "approx", costAmount: 37500 });
    await createDeviationRow(orgA.id, { costType: "none" });
    const invalid = [
      { costType: "band" as const },
      { costType: "band" as const, costBandKey: "under_20000", costAmount: 10000 },
      { costType: "band" as const, costBandKey: "Under 20 000" },
      { costType: "approx" as const },
      { costType: "approx" as const, costAmount: 0 },
      { costType: "approx" as const, costAmount: -10000 },
      { costType: "approx" as const, costAmount: 40000, costBandKey: "under_20000" },
      { costType: "none" as const, costAmount: 40000 },
      { costType: "none" as const, costBandKey: "under_20000" },
      { costType: "range" as never },
    ];
    for (const values of invalid) {
      await expectPgError(() => createDeviationRow(orgA.id, values), CHECK);
    }
  });

  it("ukjent årsakskriterium og ukjent tekstkilde avvises", async () => {
    const { orgA } = await twoOrganizations();
    await createDeviationRow(orgA.id, { causeCriterion: "missing_documentation" });
    await expectPgError(
      () => createDeviationRow(orgA.id, { causeCriterion: "guess" as never }),
      CHECK,
    );
    await expectPgError(() => createDeviationRow(orgA.id, { textSource: "ai" as never }), CHECK);
    await expectPgError(
      () => createDeviationMeasureRow(orgA.id, { textSource: "ai" as never }),
      CHECK,
    );
  });

  it("avviket henger på et kontrollpunkt i samme rapport, og tiltaket på et avvik i samme rapport", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const report = await createReportRow(orgA.id);
    const otherReportResult = await createCheckpointResultRow(orgA.id);
    await expectPgError(
      () =>
        createDeviationRow(orgA.id, {
          reportId: report.id,
          checkpointResultId: otherReportResult.id,
        }),
      FOREIGN_KEY,
    );
    const foreignResult = await createCheckpointResultRow(orgB.id);
    await expectPgError(
      () =>
        createDeviationRow(orgA.id, {
          reportId: foreignResult.reportId,
          checkpointResultId: foreignResult.id,
        }),
      FOREIGN_KEY,
    );

    const otherReportDeviation = await createDeviationRow(orgA.id);
    await expectPgError(
      () =>
        createDeviationMeasureRow(orgA.id, {
          reportId: report.id,
          deviationId: otherReportDeviation.id,
        }),
      FOREIGN_KEY,
    );
    const measure = await createDeviationMeasureRow(orgA.id);
    expect(measure.sortOrder).toBe(0);
  });

  it("KI-logg fra en annen organisasjon avvises på avviket", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreignAi = await createAiUsageLog(orgB.id);
    await expectPgError(
      () => createDeviationRow(orgA.id, { aiUsageId: foreignAi.id }),
      FOREIGN_KEY,
    );
  });

  it("myk sletting: raden står igjen med deleted_at", async () => {
    const { orgA } = await twoOrganizations();
    const deviation = await createDeviationRow(orgA.id);
    await db
      .update(deviations)
      .set({ deletedAt: DELETED_AT })
      .where(eq(deviations.id, deviation.id));
    const [row] = await db.select().from(deviations).where(eq(deviations.id, deviation.id));
    expect(row?.deletedAt).toEqual(DELETED_AT);
  });
});

describe("tgiu_details", () => {
  it("ett sett per kontrollpunkt; etter myk sletting kan et nytt lages", async () => {
    const { orgA } = await twoOrganizations();
    const first = await createTgiuDetailsRow(orgA.id);
    const parent = { reportId: first.reportId, checkpointResultId: first.checkpointResultId };
    await expectPgError(() => createTgiuDetailsRow(orgA.id, parent), UNIQUE);
    await db.update(tgiuDetails).set({ deletedAt: DELETED_AT }).where(eq(tgiuDetails.id, first.id));
    await createTgiuDetailsRow(orgA.id, parent);
  });

  it("ukjent verdi for utsatt konstruksjon avvises, og tidspunkt krever at eier er informert", async () => {
    const { orgA } = await twoOrganizations();
    await createTgiuDetailsRow(orgA.id, { constructionVulnerable: "unknown" });
    await expectPgError(
      () => createTgiuDetailsRow(orgA.id, { constructionVulnerable: "maybe" as never }),
      CHECK,
    );
    await expectPgError(
      () => createTgiuDetailsRow(orgA.id, { ownerInformedAt: new Date("2026-11-14T10:00:00Z") }),
      CHECK,
    );
    await createTgiuDetailsRow(orgA.id, {
      ownerInformed: true,
      ownerInformedAt: new Date("2026-11-14T10:00:00Z"),
    });
  });
});

describe("rule_suggestion_decisions", () => {
  it("endret og avvist krever begrunnelse; godtatt gjør det ikke", async () => {
    const { orgA } = await twoOrganizations();
    await createRuleSuggestionDecisionRow(orgA.id, { decision: "accepted" });
    for (const overrideReason of [null, "", "   "]) {
      await expectPgError(
        () =>
          createRuleSuggestionDecisionRow(orgA.id, {
            decision: "changed",
            chosenTg: "1",
            overrideReason,
          }),
        CHECK,
      );
      await expectPgError(
        () =>
          createRuleSuggestionDecisionRow(orgA.id, {
            decision: "rejected",
            chosenTg: null,
            overrideReason,
          }),
        CHECK,
      );
    }
    await createRuleSuggestionDecisionRow(orgA.id, {
      decision: "rejected",
      chosenTg: null,
      overrideReason: "Oppdiktet begrunnelse",
    });
  });

  it("avvist forslag har verken TG, utfall eller avvik", async () => {
    const { orgA } = await twoOrganizations();
    const rejected = { decision: "rejected" as const, overrideReason: "Oppdiktet begrunnelse" };
    await expectPgError(
      () => createRuleSuggestionDecisionRow(orgA.id, { ...rejected, chosenTg: "IU" }),
      CHECK,
    );
    await expectPgError(
      () =>
        createRuleSuggestionDecisionRow(orgA.id, {
          ...rejected,
          chosenTg: null,
          chosenOutcomeKey: "test.outcome",
        }),
      CHECK,
    );
  });

  it("forslag og begrunnelse har fast form; ukjente koder og for stort regelsvar avvises", async () => {
    const { orgA } = await twoOrganizations();
    const invalid = [
      { suggestion: { kind: "tg3", checkpoint_key: "test.checkpoint" } as never },
      { suggestion: ["tgiu"] as never },
      { reasons: { fritekst: "x" } as never },
      { reasons: [{ fyll: "x".repeat(16001) }] },
      { decision: "edited" as never },
      { chosenTg: "4" as never },
      { ruleKey: "Ikke en kode" },
      { chosenOutcomeKey: "Ikke en kode" },
      { lifespanSetKey: "Ikke en kode" },
      { thresholdSetKey: "Ikke en kode" },
      { inspectionYear: 1800 },
    ];
    for (const values of invalid) {
      await expectPgError(() => createRuleSuggestionDecisionRow(orgA.id, values), CHECK);
    }
  });

  it("avviket må høre til samme rapport, og den som avgjorde til samme organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const otherReportDeviation = await createDeviationRow(orgA.id);
    await expectPgError(
      () => createRuleSuggestionDecisionRow(orgA.id, { deviationId: otherReportDeviation.id }),
      FOREIGN_KEY,
    );
    const foreignEmployee = await createEmployee(await createUser(), orgB.id, ["inspector"]);
    await expectPgError(
      () => createRuleSuggestionDecisionRow(orgA.id, { decidedBy: foreignEmployee.id }),
      FOREIGN_KEY,
    );

    const deviation = await createDeviationRow(orgA.id);
    const decision = await createRuleSuggestionDecisionRow(orgA.id, {
      reportId: deviation.reportId,
      checkpointResultId: deviation.checkpointResultId,
      deviationId: deviation.id,
      suggestion: {
        kind: "outcome",
        checkpoint_key: "test.checkpoint",
        question_key: "test.question",
        outcome_key: "test.outcome",
      },
      chosenTg: "3",
      chosenOutcomeKey: "test.outcome",
    });
    const [row] = await db
      .select()
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.id, decision.id));
    expect(row?.deviationId).toBe(deviation.id);
    expect(row?.inspectionYear).toBe(2026);
  });
});

describe("standard_measures.applies_to_tg (T-0060)", () => {
  it("tom, 2 og 3 er lov; andre verdier avvises", async () => {
    const { orgA } = await twoOrganizations();
    expect((await createStandardMeasureRow(orgA.id)).appliesToTg).toBeNull();
    await createStandardMeasureRow(orgA.id, { appliesToTg: 2 });
    await createStandardMeasureRow(orgA.id, { appliesToTg: 3 });
    await expectPgError(
      () => createStandardMeasureRow(orgA.id, { appliesToTg: 1 as never }),
      CHECK,
    );
  });
});
