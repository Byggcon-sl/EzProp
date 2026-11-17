import { and, count, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, type Actor } from "@/core/access";
import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  getRoomView,
  ReportTemplateMissingError,
  saveField,
  setTgDirect,
  startReport,
  type RoomReportView,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  aiUsageLog,
  auditLog,
  checkpointResults,
  deviationMeasures,
  deviations,
  fieldAnswers,
  floors,
  reportBuildings,
  reports,
  rooms,
  ruleSuggestionDecisions,
  tgiuDetails,
  assignments,
} from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createAssignmentParty,
  createOrganization,
  createTemplate,
  resetDatabase,
} from "../../../tests/factories";
import {
  answer,
  answerHole,
  answerMembrane1990,
  checkpointOf,
  CP,
  createBathroomFixture,
  createRoomOnNewAssignment,
  createStaff,
  RULE,
  startedBathroom,
  startedView,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Rapportkjernen: start, lesing, kjeden og tenant-isolasjon per spørring
 * (docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 4a, 4f B4.33 og 5 B5.3–B5.6). Alle data er
 * oppdiktede.
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function started(view: RoomReportView) {
  if (view.state !== "started") throw new Error("rapporten er ikke startet");
  return view;
}

// --- Data i rommet til tenant-testene ------------------------------------------------------------

type SeededRoom = {
  room: { assignmentId: string; roomId: string };
  reportId: string;
  templateVersionId: string;
  answerIds: string[];
  resultIds: string[];
  deviationIds: string[];
  measureIds: string[];
  tgiuIds: string[];
  decisionIds: string[];
  aiUsageIds: string[];
};

/** Et bad med alle sju tabellene fylt, i organisasjonen. */
async function seedFullRoom(organizationId: string): Promise<SeededRoom> {
  const f = await startedBathroom({ organizationId });
  await answerMembrane1990(f);
  const accepted = await decideSuggestion(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    ruleKey: RULE.before2000,
    decision: "accepted",
    deviationId: uuidv7(),
  });
  if (accepted.status !== "saved" || !accepted.deviationId) throw new Error("godta feilet");
  await addMeasure(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    deviationId: accepted.deviationId,
  });
  await answerHole(f, "not_done");
  await decideSuggestion(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    ruleKey: RULE.notDone,
    decision: "accepted",
  });
  const ai = await createAiUsageLog(organizationId, {
    reportId: f.reportId,
    targetRef: { type: "field_answer", id: uuidv7(), fieldKey: "wet_room.membrane_year" },
  });

  const ids = async (
    table:
      | typeof fieldAnswers
      | typeof checkpointResults
      | typeof deviations
      | typeof deviationMeasures
      | typeof tgiuDetails
      | typeof ruleSuggestionDecisions,
  ) =>
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.organizationId, organizationId), eq(table.reportId, f.reportId)))
    ).map((r) => r.id);
  return {
    room: f.room,
    reportId: f.reportId,
    templateVersionId: f.templateVersionId,
    answerIds: await ids(fieldAnswers),
    resultIds: await ids(checkpointResults),
    deviationIds: await ids(deviations),
    measureIds: await ids(deviationMeasures),
    tgiuIds: await ids(tgiuDetails),
    decisionIds: await ids(ruleSuggestionDecisions),
    aiUsageIds: [ai.id],
  };
}

/**
 * Tenant-test der spørringen er visningen av badet. `pick` henter id-ene fra svaret; `expected`
 * henter de samme fra det som ble lagt inn.
 */
async function expectViewIsolation(
  pick: (view: Extract<RoomReportView, { state: "started" }>) => string[],
  expected: (seeded: SeededRoom) => string[],
) {
  const seeded = new Map<string, SeededRoom>();
  await expectTenantIsolation({
    seed: async (grantA, grantB) => {
      const a = await seedFullRoom(grantA.organizationId);
      const b = await seedFullRoom(grantB.organizationId);
      seeded.set(grantA.organizationId, a);
      seeded.set(grantB.organizationId, b);
      return { a: expected(a), b: expected(b) };
    },
    query: async (actor: Actor, organizationId: string) => {
      // Mot en fremmed organisasjon brukes et rom fra den andre; tilgangen stopper før oppslaget
      const own = seeded.get(organizationId) ?? [...seeded.values()][0];
      if (!own) throw new Error("mangler data");
      return pick(started(await getRoomView(actor, organizationId, own.room)));
    },
    idOf: (id: string) => id,
  });
}

// --- 5 B5.3 Tenant-isolasjon per spørring --------------------------------------------------------

describe("B5.3 expectTenantIsolation per spørring", () => {
  it("B5.3 getRoomView og kjeden rom → etasje → bygning → oppdrag", async () => {
    await expectViewIsolation(
      (view) => [view.room.id],
      (s) => [s.room.roomId],
    );
  });

  it("B5.3 rapportoppslaget (startReport gir egen rapport)", async () => {
    const assignments = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedFullRoom(grantA.organizationId);
        const b = await seedFullRoom(grantB.organizationId);
        assignments.set(grantA.organizationId, a.room.assignmentId);
        assignments.set(grantB.organizationId, b.room.assignmentId);
        return { a: [a.reportId], b: [b.reportId] };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignments.get(organizationId) ?? [...assignments.values()][0]!;
        const { reportId } = await startReport(actor, organizationId, assignmentId);
        return [reportId];
      },
      idOf: (id) => id,
    });
  });

  it("B5.3 oppslaget av publisert systemmal og rapportens låste malversjon", async () => {
    const assignmentsByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createBathroomFixture({ organizationId: grantA.organizationId });
        const b = await createBathroomFixture({ organizationId: grantB.organizationId });
        assignmentsByOrg.set(grantA.organizationId, a.assignmentId);
        assignmentsByOrg.set(grantB.organizationId, b.assignmentId);
        return { a: [a.templateVersionId], b: [b.templateVersionId] };
      },
      query: async (actor, organizationId) => {
        const assignmentId =
          assignmentsByOrg.get(organizationId) ?? [...assignmentsByOrg.values()][0]!;
        const { reportId } = await startReport(actor, organizationId, assignmentId);
        const rows = await db
          .select({ templateVersionId: reports.templateVersionId })
          .from(reports)
          .where(and(eq(reports.id, reportId), eq(reports.organizationId, organizationId)));
        return rows.map((r) => r.templateVersionId);
      },
      idOf: (id) => id,
    });
  });

  it("B5.3 field_answers", async () => {
    await expectViewIsolation(
      (view) => view.answers.map((a) => a.id),
      (s) => s.answerIds,
    );
  });

  it("B5.3 checkpoint_results", async () => {
    await expectViewIsolation(
      (view) => view.checkpoints.flatMap((c) => (c.resultId ? [c.resultId] : [])),
      (s) => s.resultIds,
    );
  });

  it("B5.3 deviations", async () => {
    await expectViewIsolation(
      (view) => view.checkpoints.flatMap((c) => c.deviations.map((d) => d.id)),
      (s) => s.deviationIds,
    );
  });

  it("B5.3 deviation_measures", async () => {
    await expectViewIsolation(
      (view) =>
        view.checkpoints.flatMap((c) => c.deviations.flatMap((d) => d.measures.map((m) => m.id))),
      (s) => s.measureIds,
    );
  });

  it("B5.3 tgiu_details", async () => {
    await expectViewIsolation(
      (view) => view.checkpoints.flatMap((c) => (c.tgiuDetails ? [c.tgiuDetails.id] : [])),
      (s) => s.tgiuIds,
    );
  });

  it("B5.3 rule_suggestion_decisions", async () => {
    await expectViewIsolation(
      (view) => view.suggestions.flatMap((s) => (s.latestDecision ? [s.latestDecision.id] : [])),
      (s) => s.decisionIds,
    );
  });

  it("B5.3 oppslaget av suggested_by_rule_id (avvik med regelkode)", async () => {
    await expectViewIsolation(
      (view) =>
        view.checkpoints.flatMap((c) =>
          c.deviations.filter((d) => d.suggestedByRuleKey === RULE.before2000).map((d) => d.id),
        ),
      (s) => s.deviationIds,
    );
  });

  it("B5.3 ai_usage_log.report_id (oppslag per rapport med organisasjonen fra tilgangen)", async () => {
    const reportsByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedFullRoom(grantA.organizationId);
        const b = await seedFullRoom(grantB.organizationId);
        reportsByOrg.set(grantA.organizationId, a.reportId);
        reportsByOrg.set(grantB.organizationId, b.reportId);
        return { a: a.aiUsageIds, b: b.aiUsageIds };
      },
      query: async (actor, organizationId) => {
        // Tilgangen via visningen først, så oppslaget med organisasjonen derfra
        const { requireOrganizationAccess } = await import("@/core/access");
        const grant = await requireOrganizationAccess(actor, organizationId);
        const reportId = reportsByOrg.get(grant.organizationId)!;
        return (
          await db
            .select({ id: aiUsageLog.id })
            .from(aiUsageLog)
            .where(
              and(
                eq(aiUsageLog.organizationId, grant.organizationId),
                eq(aiUsageLog.reportId, reportId),
              ),
            )
        ).map((r) => r.id);
      },
      idOf: (id) => id,
    });
  });

  it("B5.3 ai_usage_log.report_id kan ikke peke på en rapport i en annen organisasjon", async () => {
    const a = await startedBathroom();
    const orgB = await createOrganization("Organisasjon B");
    await expect(createAiUsageLog(orgB.id, { reportId: a.reportId })).rejects.toThrow();
  });
});

// --- 5 B5.4–B5.6 Kjeden og id-er -------------------------------------------------------------------

describe("B5.4 404 i kjeden", () => {
  it("B5.4 rom fra annen organisasjon gir AccessDeniedError", async () => {
    const a = await startedBathroom();
    const b = await startedBathroom();
    await expect(getRoomView(a.actor, a.organizationId, b.room)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      getRoomView(a.actor, a.organizationId, { assignmentId: a.assignmentId, roomId: b.roomId }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("B5.4 rom fra annet oppdrag i samme organisasjon gir AccessDeniedError", async () => {
    const a = await startedBathroom();
    const other = await createRoomOnNewAssignment(a.organizationId);
    await expect(
      getRoomView(a.actor, a.organizationId, {
        assignmentId: a.assignmentId,
        roomId: other.roomId,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      answer(
        { ...a, room: { assignmentId: a.assignmentId, roomId: other.roomId } },
        "wet_room.build_year",
        {
          number: 1990,
        },
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("B5.4 rom som ikke er våtrom gir AccessDeniedError", async () => {
    const a = await startedBathroom();
    const place = await createRoomOnNewAssignment(a.organizationId, { roomType: "bedroom" });
    await expect(getRoomView(a.actor, a.organizationId, place.room)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it.each([
    ["rom", rooms, (f: { roomId: string }) => f.roomId],
    ["etasje", floors, (f: { floorId: string }) => f.floorId],
    ["bygning", reportBuildings, (f: { buildingId: string }) => f.buildingId],
    ["oppdrag", assignments, (f: { assignmentId: string }) => f.assignmentId],
  ] as const)("B5.4 mykt slettet %s gir AccessDeniedError", async (_name, table, idOf) => {
    const a = await startedBathroom();
    await db
      .update(table)
      .set({ deletedAt: new Date() })
      .where(eq(table.id, (idOf as (f: typeof a) => string)(a)));
    await expect(getRoomView(a.actor, a.organizationId, a.room)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("B5.4 rapport fra annen organisasjon med gyldig id: ingen tilgang og ingen endring", async () => {
    const a = await startedBathroom();
    const b = await startedBathroom();
    await answerMembrane1990(b);
    // Rommet i A, men beslutning sendt mot Bs rom
    await expect(
      decideSuggestion(a.actor, a.organizationId, b.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const [row] = await db
      .select({ n: count() })
      .from(deviations)
      .where(eq(deviations.organizationId, b.organizationId));
    expect(row?.n).toBe(0);
  });
});

describe("B5.5 id fra skjemaet styrer aldri organisasjonen", () => {
  it("B5.5 Bs kall med As avvik, tiltak og rader gir 404 og ingen endring i A", async () => {
    const a = await seedFullRoom((await createOrganization("A")).id);
    const b = await startedBathroom();
    const before = await db.select().from(deviations).where(eq(deviations.id, a.deviationIds[0]!));
    const attempts = [
      () =>
        saveField(b.actor, b.organizationId, b.room, {
          table: "deviations",
          id: a.deviationIds[0]!,
          field: "deviation_text",
          value: "Endret",
          base: null,
        }),
      () =>
        saveField(b.actor, b.organizationId, b.room, {
          table: "deviation_measures",
          id: a.measureIds[0]!,
          field: "text",
          value: "Endret",
          base: "",
        }),
      () =>
        addMeasure(b.actor, b.organizationId, b.room, {
          id: uuidv7(),
          deviationId: a.deviationIds[0]!,
        }),
      () =>
        saveField(b.actor, b.organizationId, a.room, {
          table: "checkpoint_results",
          checkpointKey: CP.membrane,
          field: "description_text",
          value: "Endret",
          base: null,
        }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(AccessDeniedError);
    }
    const after = await db.select().from(deviations).where(eq(deviations.id, a.deviationIds[0]!));
    expect(after).toEqual(before);
    const [measures] = await db
      .select({ n: count() })
      .from(deviationMeasures)
      .where(eq(deviationMeasures.reportId, a.reportId));
    expect(measures?.n).toBe(a.measureIds.length);
  });

  it("B5.5 ny rad med en id som finnes i en annen organisasjon avvises uten å røre den", async () => {
    const a = await seedFullRoom((await createOrganization("A")).id);
    const b = await startedBathroom();
    await expect(
      addDeviation(b.actor, b.organizationId, b.room, {
        id: a.deviationIds[0]!,
        checkpointKey: CP.membrane,
        questionKey: "wet_room.membrane_drain.membrane_before_2000",
        outcomeKey: "tg3",
        tg: null,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      saveField(b.actor, b.organizationId, b.room, {
        table: "field_answers",
        id: a.answerIds[0]!,
        elementKey: "wet_room.build_year",
        field: "value",
        value: { text: null, number: 1995, optionKeys: null },
        base: { text: null, number: null, optionKeys: null },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const [answers] = await db
      .select({ n: count() })
      .from(fieldAnswers)
      .where(eq(fieldAnswers.organizationId, b.organizationId));
    expect(answers?.n).toBe(0);
  });
});

describe("B5.6 requireUuid før Zod", () => {
  it.each([
    ["assignmentId", { assignmentId: "ikke-en-id", roomId: uuidv7() }],
    ["roomId", { assignmentId: uuidv7(), roomId: "1; drop table rooms" }],
  ])("B5.6 ugyldig %s gir 404, ikke databasefeil", async (_name, room) => {
    const a = await startedBathroom();
    await expect(getRoomView(a.actor, a.organizationId, room)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      answer({ ...a, room }, "wet_room.build_year", { number: 1990 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("B5.6 ugyldig id på avvik, tiltak, beslutning og oppdrag gir 404", async () => {
    const a = await startedBathroom();
    await expect(startReport(a.actor, a.organizationId, "x")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      addMeasure(a.actor, a.organizationId, a.room, { id: "x", deviationId: uuidv7() }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      decideSuggestion(a.actor, a.organizationId, a.room, {
        id: "x",
        ruleKey: RULE.before2000,
        decision: "accepted",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      saveField(a.actor, a.organizationId, a.room, {
        table: "deviations",
        id: "x",
        field: "cost_text",
        value: null,
        base: null,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

// --- 4a Start og lesing ------------------------------------------------------------------------

describe("4a start og lesing", () => {
  it("B4.1 startReport lager én rapport under arbeid, låst til publisert systemmal", async () => {
    const f = await createBathroomFixture();
    const result = await startReport(f.actor, f.organizationId, f.assignmentId);
    expect(result.created).toBe(true);
    const rows = await db
      .select()
      .from(reports)
      .where(eq(reports.organizationId, f.organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.reportId,
      status: "draft",
      reportType: "condition_report",
      templateVersionId: f.templateVersionId,
      assignmentId: f.assignmentId,
    });
    const again = await startReport(f.actor, f.organizationId, f.assignmentId);
    expect(again).toEqual({ reportId: result.reportId, created: false });
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, result.reportId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes).toEqual({
      assignmentId: f.assignmentId,
      templateVersionId: f.templateVersionId,
    });
  });

  it("B4.2 to samtidige kall (hver sin forbindelse fra poolen) gir én rapport og samme id", async () => {
    const f = await createBathroomFixture();
    // Hver transaksjon tar sin egen forbindelse fra poolen, så den unike indeksen prøves
    const results = await Promise.all([
      startReport(f.actor, f.organizationId, f.assignmentId),
      startReport(f.actor, f.organizationId, f.assignmentId),
      startReport(f.actor, f.organizationId, f.assignmentId),
    ]);
    const ids = new Set(results.map((r) => r.reportId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const [row] = await db
      .select({ n: count() })
      .from(reports)
      .where(eq(reports.assignmentId, f.assignmentId));
    expect(row?.n).toBe(1);
  });

  it("B4.3 ny malversjon etter start: rapporten står på sin versjon, og skjermen leser den", async () => {
    const f = await startedBathroom();
    const [family] = await db
      .select({ familyId: reports.templateVersionId })
      .from(reports)
      .where(eq(reports.id, f.reportId));
    expect(family?.familyId).toBe(f.templateVersionId);
    const renamed = {
      ...wetRoomTemplate,
      checkpoints: wetRoomTemplate.checkpoints.map((c) =>
        c.key === CP.general ? { ...c, name: "Generelt, ny versjon" } : c,
      ),
    };
    const { versionId: newVersion } = await createTemplate(f.organizationId, {
      status: "published",
      document: renamed,
      versionNumber: 2,
      name: "Tilstandsrapport ny",
    });
    const view = await startedView(f);
    expect(view.document.checkpoints.find((c) => c.key === CP.general)?.name).toBe("Generelt");
    const [row] = await db.select().from(reports).where(eq(reports.id, f.reportId));
    expect(row?.templateVersionId).toBe(f.templateVersionId);
    // Et nytt oppdrag får den nye versjonen
    const place = await createRoomOnNewAssignment(f.organizationId);
    const { reportId } = await startReport(f.actor, f.organizationId, place.assignmentId);
    const [fresh] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(fresh?.templateVersionId).toBe(newVersion);
  });

  it("B4.4 uten publisert systemmal: tydelig norsk feilmelding og ingen rad", async () => {
    const f = await createBathroomFixture({ withTemplate: false });
    await createTemplate(f.organizationId, { status: "draft", document: wetRoomTemplate });
    const error = await startReport(f.actor, f.organizationId, f.assignmentId).catch((e) => e);
    expect(error).toBeInstanceOf(ReportTemplateMissingError);
    expect(error.message).toMatch(/publisert systemmal for tilstandsrapport/);
    const [row] = await db.select({ n: count() }).from(reports);
    expect(row?.n).toBe(0);
  });

  it("B4.5 getRoomView skriver aldri, heller ikke for kontor uten rapport", async () => {
    const f = await createBathroomFixture();
    const office = await createStaff(f.organizationId, ["office"]);
    const counts = async () => {
      const tables = [reports, checkpointResults, fieldAnswers, deviations, auditLog] as const;
      return Promise.all(tables.map(async (t) => (await db.select({ n: count() }).from(t))[0]?.n));
    };
    const before = await counts();
    expect(await getRoomView(office.actor, f.organizationId, f.room)).toEqual({
      state: "not_started",
      canStart: false,
    });
    expect(await getRoomView(f.actor, f.organizationId, f.room)).toEqual({
      state: "not_started",
      canStart: true,
    });
    expect(await counts()).toEqual(before);

    await startReport(f.actor, f.organizationId, f.assignmentId);
    const afterStart = await counts();
    const view = started(await getRoomView(office.actor, f.organizationId, f.room));
    expect(view.canEdit).toBe(false);
    started(await getRoomView(f.actor, f.organizationId, f.room));
    expect(await counts()).toEqual(afterStart);
  });

  it("B4.6 svaret har bare maldokumentet og svarene for rommet, ingen parter eller adresse", async () => {
    const f = await startedBathroom();
    await createAssignmentParty(f.organizationId, {
      assignmentId: f.assignmentId,
      role: "seller",
      name: "Åse Testesen",
      phone: "12345678",
    });
    await db
      .update(assignments)
      .set({ addressText: "Testveien 12, 8000 Bodø" })
      .where(eq(assignments.id, f.assignmentId));
    await answerMembrane1990(f);
    const view = await startedView(f);
    const text = JSON.stringify(view);
    for (const secret of ["Åse Testesen", "12345678", "Testveien", "Bodø", "8000"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(view.document).sort()).toEqual(
      [
        "checkpoints",
        "deviation_questions",
        "element_options",
        "elements",
        "outcomes",
        "sections",
        "standard_measures",
      ].sort(),
    );
    expect(view.document.checkpoints.every((c) => c.room_type_groups.includes("wet_room"))).toBe(
      true,
    );
    expect(view.document.checkpoints).toHaveLength(8);
  });

  it("B4.7 befaringsåret: oppdragets befaringstid, ellers dagens år i norsk tid", async () => {
    const f = await startedBathroom({ inspectionAt: new Date("2025-03-01T10:00:00Z") });
    expect((await startedView(f)).inspectionYear).toEqual({ year: 2025, source: "assignment" });

    const g = await startedBathroom({ inspectionAt: null });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    expect((await startedView(g)).inspectionYear).toEqual({ year: 2027, source: "today" });

    // Året står i det lagrede regelsvaret
    await answerMembrane1990(g);
    await decideSuggestion(g.actor, g.organizationId, g.room, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
    });
    const [decision] = await db
      .select({ inspectionYear: ruleSuggestionDecisions.inspectionYear })
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.reportId, g.reportId));
    expect(decision?.inspectionYear).toBe(2027);
  });
});

// --- B4.33 Ytelse ---------------------------------------------------------------------------------

/** Fyller alle åtte punktene med `perCheckpoint` avvik med 20 tiltak hver, rett i databasen. */
async function fillRoom(f: Awaited<ReturnType<typeof startedBathroom>>, perCheckpoint: number) {
  const view = await startedView(f);
  for (const checkpoint of view.document.checkpoints) {
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: checkpoint.key,
      tgDirect: "1",
      base: null,
    });
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: checkpoint.key,
      tgDirect: null,
      base: "1",
    });
  }
  const results = await db
    .select({ id: checkpointResults.id })
    .from(checkpointResults)
    .where(and(eq(checkpointResults.reportId, f.reportId), isNull(checkpointResults.deletedAt)));
  expect(results).toHaveLength(8);
  for (const result of results) {
    const deviationRows = Array.from({ length: perCheckpoint }, (_, i) => ({
      id: uuidv7(),
      organizationId: f.organizationId,
      reportId: f.reportId,
      checkpointResultId: result.id,
      kind: "tg" as const,
      tg: 2 as const,
      deviationText: "Oppdiktet avvik",
      textSource: "free" as const,
      sortOrder: i,
    }));
    await db.insert(deviations).values(deviationRows);
    const measureRows = deviationRows.flatMap((d) =>
      Array.from({ length: 20 }, (_, i) => ({
        id: uuidv7(),
        organizationId: f.organizationId,
        reportId: f.reportId,
        deviationId: d.id,
        text: "Oppdiktet tiltak",
        textSource: "free" as const,
        sortOrder: i,
      })),
    );
    for (let i = 0; i < measureRows.length; i += 500) {
      await db.insert(deviationMeasures).values(measureRows.slice(i, i + 500));
    }
  }
}

/** Antall spørringer `getRoomView` kjører. */
async function countQueries(f: Awaited<ReturnType<typeof startedBathroom>>) {
  // Drizzle kjører hver spørring som `unsafe` på postgres-klienten
  const client = (db as unknown as { $client: { unsafe: (...args: unknown[]) => unknown } })
    .$client;
  const spy = vi.spyOn(client, "unsafe");
  await getRoomView(f.actor, f.organizationId, f.room);
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

describe("B4.33 ytelse", () => {
  it("B4.33 getRoomView med 8 × 50 × 20 har fast antall spørringer og svarer under 500 ms", async () => {
    const small = await startedBathroom();
    await fillRoom(small, 1);
    const big = await startedBathroom();
    await fillRoom(big, 50);

    const smallCount = await countQueries(small);
    const bigCount = await countQueries(big);
    expect(bigCount).toBe(smallCount);

    const view = await startedView(big);
    expect(view.checkpoints.reduce((n, c) => n + c.deviations.length, 0)).toBe(400);

    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      await getRoomView(big.actor, big.organizationId, big.room);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(500);
  }, 60_000);
});

describe("B4.5 tilgang til lesing", () => {
  it("kontor ser badet skrivebeskyttet etter start", async () => {
    const f = await startedBathroom();
    const office = await createStaff(f.organizationId, ["office"]);
    const view = started(await getRoomView(office.actor, f.organizationId, f.room));
    expect(view.canEdit).toBe(false);
    expect(checkpointOf(view, CP.general).status).toBe("not_started");
  });
});
