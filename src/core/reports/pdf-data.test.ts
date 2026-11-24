import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, type Actor } from "@/core/access";
import type { ReportPdfData } from "@/core/pdf";
import {
  addDeviation,
  getPublishCheck,
  getReportDraftPdfData,
  getRoomView,
  publishReport,
  saveField,
  setTgDirect,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  assignments,
  checkpointResults,
  companies,
  deviationMeasures,
  deviations,
  employees,
  reports,
  rooms,
  templateVersions,
  tgiuDetails,
  type EmployeeRole,
} from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createClaim,
  createCompany,
  createTemplate,
  nextFakeOrgNumber,
  resetDatabase,
} from "../../../tests/factories";
import {
  createPublishableBathroom,
  writeCounts,
  type PublishableBathroom,
} from "../../../tests/publish-fixtures";
import {
  answerHole,
  CP,
  createBathroomFixture,
  createStaff,
  setInspectorsEditAll,
  startedBathroom,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { publishFindingText } from "./logic";

/*
 * PDF-utkastet mot testdatabasen (docs/funksjoner/fase2a-pdf-badet-testplan.md 5.1–5.4, 10.1,
 * 10.4 og 11.5): tilgang, tenant-isolasjon, myk sletting, låst malversjon og at utkastet sier det
 * samme som publiseringssjekken. Alle data er oppdiktede.
 */

beforeEach(resetDatabase);

const TG2_FIXTURES = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.damaged_furniture",
  outcomeKey: "tg2",
};
const TG3_VENTILATION = {
  checkpointKey: "wet_room.ventilation",
  questionKey: "wet_room.ventilation.missing_ventilation",
  outcomeKey: "tg3",
};

type Who = Pick<PublishableBathroom, "actor" | "organizationId" | "room">;

async function addDev(f: Who, place: typeof TG2_FIXTURES): Promise<string> {
  const id = uuidv7();
  const result = await addDeviation(f.actor, f.organizationId, f.room, { id, ...place, tg: null });
  if (result.status !== "saved") throw new Error(`avviket ble ikke lagret: ${result.status}`);
  return id;
}

async function describe_(f: Who, checkpointKey: string, text: string) {
  const result = await saveField(f.actor, f.organizationId, f.room, {
    table: "checkpoint_results",
    checkpointKey,
    field: "description_text",
    value: text,
    base: null,
  });
  if (result.status !== "saved") throw new Error(`beskrivelsen ble ikke lagret: ${result.status}`);
}

async function draftOf(
  actor: Actor,
  f: Pick<PublishableBathroom, "organizationId" | "assignmentId">,
) {
  return getReportDraftPdfData(actor, f.organizationId, f.assignmentId);
}

function checkpointIn(data: ReportPdfData, key: string) {
  return data.rooms.flatMap((r) => r.checkpoints).find((c) => c.checkpointKey === key) ?? null;
}

async function setCompany(assignmentId: string, companyId: string | null) {
  await db.update(assignments).set({ companyId }).where(eq(assignments.id, assignmentId));
}

/**
 * Et bad med noe av alt: TG1 med beskrivelse på gulvet, TG3 uten kostnad på ventilasjonen, TG2
 * på innredningen, hull tatt med måling, og punkter uten innhold. Oppdraget har selskap med org.nr.
 */
async function richBathroom(options: { organizationId?: string; marker?: string } = {}) {
  const f = await createPublishableBathroom({
    complete: false,
    organizationId: options.organizationId,
  });
  await db
    .update(companies)
    .set({ legalName: "Testselskap takst AS", orgNumber: nextFakeOrgNumber() })
    .where(eq(companies.id, f.companyId));
  await db
    .update(assignments)
    .set({ addressText: "Prøvevegen 1\n8000 Bodø", gnr: "12", bnr: "34" })
    .where(eq(assignments.id, f.assignmentId));
  await answerHole(f, "done_no_findings", 12.4);
  await setTgDirect(f.actor, f.organizationId, f.room, {
    checkpointKey: CP.floor,
    tgDirect: "1",
    base: null,
  });
  await describe_(f, CP.floor, options.marker ?? "Gulvet har normal slitasje.");
  const tg3 = await addDev(f, TG3_VENTILATION);
  const tg2 = await addDev(f, TG2_FIXTURES);
  return { ...f, tg3, tg2 };
}

// --- 5.1 Tenant-isolasjon -----------------------------------------------------------------------

describe("5.1 tenant-isolasjon", () => {
  it("5.1.1 getReportDraftPdfData gir aldri data fra en annen organisasjon", async () => {
    const assignmentIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await startedBathroom({ organizationId: grantA.organizationId });
        const b = await startedBathroom({ organizationId: grantB.organizationId });
        assignmentIds.push(a.assignmentId, b.assignmentId);
        return { a: [a.reportId], b: [b.reportId] };
      },
      query: async (actor, organizationId) => {
        const rows: { reportId: string }[] = [];
        let denied: unknown = null;
        for (const assignmentId of assignmentIds) {
          try {
            rows.push(await getReportDraftPdfData(actor, organizationId, assignmentId));
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            denied = error;
          }
        }
        // Fremmed organisasjon: tilgangssjekken avviser alle kallene
        if (rows.length === 0 && denied) throw denied;
        return rows;
      },
      idOf: (row) => row.reportId,
    });
  });

  it("5.1.2 filtrerer på grant.organizationId: egen organisasjon og fremmed oppdrag gir 404", async () => {
    const a = await startedBathroom();
    const b = await startedBathroom();
    await expect(getReportDraftPdfData(a.actor, a.organizationId, b.assignmentId)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(getReportDraftPdfData(a.actor, b.organizationId, b.assignmentId)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("5.1.4 to selskaper i samme organisasjon: bunnteksten viser oppdragets selskap", async () => {
    const f = await richBathroom();
    await createCompany(f.organizationId, {
      legalName: "Annet selskap AS",
      orgNumber: nextFakeOrgNumber(),
    });
    const { data } = await draftOf(f.actor, f);
    expect(data.company?.legalName).toBe("Testselskap takst AS");
    expect(JSON.stringify(data)).not.toContain("Annet selskap AS");
  });

  it("5.1.5 to organisasjoner samtidig: hver har bare sitt eget merke", async () => {
    const a = await richBathroom({ marker: "Merke-ORG-A gulv" });
    const b = await richBathroom({ marker: "Merke-ORG-B gulv" });
    const [dataA, dataB] = await Promise.all([draftOf(a.actor, a), draftOf(b.actor, b)]);
    expect(JSON.stringify(dataA.data)).toContain("Merke-ORG-A");
    expect(JSON.stringify(dataA.data)).not.toContain("Merke-ORG-B");
    expect(JSON.stringify(dataB.data)).toContain("Merke-ORG-B");
    expect(JSON.stringify(dataB.data)).not.toContain("Merke-ORG-A");
  });
});

// --- 5.2 Tilgang per rolle ----------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const ROLE_CASES: RoleCase[] = [
  { name: "takstmann", roles: ["inspector"], editAll: true },
  { name: "kontor", roles: ["office"], editAll: true },
  { name: "leder", roles: ["manager"], editAll: true },
  { name: "admin", roles: ["admin"], editAll: true },
  { name: "takstmann med inspectors_edit_all av", roles: ["inspector"], editAll: false },
  { name: "kontor med inspectors_edit_all av", roles: ["office"], editAll: false },
  { name: "bare admin med inspectors_edit_all av", roles: ["admin"], editAll: false },
];

describe("5.2 tilgang per rolle", () => {
  it.each(ROLE_CASES)("$name får samme utkast, med og uten reklamasjon", async (c) => {
    const owner = await richBathroom();
    const expected = (await draftOf(owner.actor, owner)).data;
    await setInspectorsEditAll(owner.organizationId, c.editAll);
    const { actor, employee } = await createStaff(owner.organizationId, c.roles);

    // Samme utfall som badet på skjermen for samme ansatt
    const view = await getRoomView(actor, owner.organizationId, owner.room);
    expect(view.state).toBe("started");

    const without = await draftOf(actor, owner);
    expect(without.data).toEqual(expected);
    expect(without.employeeId).toBe(employee.id);
    expect(without.reportId).toBe(owner.reportId);

    await createClaim(owner.organizationId, {
      assignmentId: owner.assignmentId,
      description: "Merke-REKLAMASJON fukt i kjeller",
    });
    const withClaim = await draftOf(actor, owner);
    expect(withClaim.data).toEqual(without.data);
    expect(JSON.stringify(withClaim.data)).not.toContain("Merke-REKLAMASJON");
  });

  it("5.2.5 sluttet ansatt og ansatt uten organization.read avvises", async () => {
    const owner = await startedBathroom();
    const gone = await createStaff(owner.organizationId, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, gone.employee.id));
    const none = await createStaff(owner.organizationId, []);
    for (const actor of [gone.actor, none.actor]) {
      await expect(draftOf(actor, owner)).rejects.toThrow(AccessDeniedError);
    }
  });
});

// --- 5.3 Myk sletting og ugyldig id -------------------------------------------------------------

describe("5.3 myk sletting og ugyldig id", () => {
  it.each(["abc", "", "' or 1=1 --", uuidv7()])(
    "5.3.1 ugyldig eller ukjent id %j gir 404",
    async (id) => {
      const f = await startedBathroom();
      await expect(getReportDraftPdfData(f.actor, f.organizationId, id)).rejects.toThrow(
        AccessDeniedError,
      );
    },
  );

  it("5.3.1 slettet rapport, erstattet rapport og slettet oppdrag gir samme 404", async () => {
    const deletedReport = await startedBathroom();
    await db
      .update(reports)
      .set({ deletedAt: new Date() })
      .where(eq(reports.id, deletedReport.reportId));
    const superseded = await startedBathroom();
    await db
      .update(reports)
      .set({ status: "superseded" })
      .where(eq(reports.id, superseded.reportId));
    const deletedAssignment = await startedBathroom();
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, deletedAssignment.assignmentId));
    const notStarted = await createBathroomFixture();

    const messages = new Set<string>();
    for (const f of [deletedReport, superseded, deletedAssignment, notStarted]) {
      const error = await draftOf(f.actor, f).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccessDeniedError);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
  });

  it("5.3.2 (T15) slettede rom, punkt, avvik, tiltak og TGIU er ikke med; TG regnes uten dem", async () => {
    const f = await richBathroom();
    // TGIU på tilliggende konstruksjoner, så slettes den mykt
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    await saveField(f.actor, f.organizationId, f.room, {
      table: "tgiu_details",
      checkpointKey: CP.adjacent,
      field: "reason",
      value: "Merke-TGIU-SLETTET",
      base: null,
    });
    const before = (await draftOf(f.actor, f)).data;
    expect(checkpointIn(before, "wet_room.ventilation")!.tg).toBe("3");
    expect(JSON.stringify(before)).toContain("Merke-TGIU-SLETTET");
    const measureCount = checkpointIn(before, "wet_room.fixtures")!.deviations[0]!.measures.length;
    expect(measureCount).toBeGreaterThan(0);

    const now = new Date();
    await db.update(deviations).set({ deletedAt: now }).where(eq(deviations.id, f.tg3));
    await db
      .update(deviationMeasures)
      .set({ deletedAt: now })
      .where(eq(deviationMeasures.deviationId, f.tg2));
    await db
      .update(tgiuDetails)
      .set({ deletedAt: now })
      .where(eq(tgiuDetails.reportId, f.reportId));
    const [floorResult] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .innerJoin(reports, eq(reports.id, checkpointResults.reportId))
      .where(and(eq(checkpointResults.reportId, f.reportId), eq(checkpointResults.tgDirect, "1")));
    await db
      .update(checkpointResults)
      .set({ deletedAt: now })
      .where(eq(checkpointResults.id, floorResult!.id));

    const after = (await draftOf(f.actor, f)).data;
    const json = JSON.stringify(after);
    expect(json).not.toContain(f.tg3);
    expect(json).not.toContain("Merke-TGIU-SLETTET");
    expect(checkpointIn(after, "wet_room.ventilation")).toBeNull();
    expect(checkpointIn(after, "wet_room.fixtures")!.deviations[0]!.measures).toEqual([]);
    expect(checkpointIn(after, CP.floor)?.descriptionText ?? null).toBeNull();
    expect(checkpointIn(after, CP.adjacent)?.tgiu ?? null).toBeNull();

    await db.update(rooms).set({ deletedAt: now }).where(eq(rooms.id, f.roomId));
    expect((await draftOf(f.actor, f)).data.rooms).toEqual([]);
  });

  it("5.3.3 slettet selskap gir company null; selskap uten org.nr. også", async () => {
    const f = await richBathroom();
    await db.update(companies).set({ orgNumber: null }).where(eq(companies.id, f.companyId));
    expect((await draftOf(f.actor, f)).data.company).toBeNull();
    await db
      .update(companies)
      .set({ orgNumber: nextFakeOrgNumber(), deletedAt: new Date() })
      .where(eq(companies.id, f.companyId));
    expect((await draftOf(f.actor, f)).data.company).toBeNull();
    await setCompany(f.assignmentId, null);
    expect((await draftOf(f.actor, f)).data.company).toBeNull();
  });

  it("5.3.4 lesingen endrer ingen rader", async () => {
    const f = await richBathroom();
    const [reportBefore] = await db.select().from(reports).where(eq(reports.id, f.reportId));
    const countsBefore = await writeCounts(f.organizationId);
    await draftOf(f.actor, f);
    const [reportAfter] = await db.select().from(reports).where(eq(reports.id, f.reportId));
    expect(reportAfter).toEqual(reportBefore);
    expect(await writeCounts(f.organizationId)).toEqual(countsBefore);
  });
});

// --- 5.4 Låst malversjon ------------------------------------------------------------------------

describe("5.4 låst malversjon", () => {
  it("etiketter fra rapportens malversjon, også når malen har fått ny versjon med andre etiketter", async () => {
    const f = await richBathroom();
    const [version] = await db
      .select({ familyId: templateVersions.familyId })
      .from(templateVersions)
      .where(eq(templateVersions.id, f.templateVersionId));
    await db
      .update(templateVersions)
      .set({ status: "retired" })
      .where(eq(templateVersions.id, f.templateVersionId));
    await createTemplate(f.organizationId, {
      status: "published",
      versionNumber: 2,
      familyId: version!.familyId,
      document: {
        ...wetRoomTemplate,
        checkpoints: wetRoomTemplate.checkpoints.map((c) => ({ ...c, name: `Ny ${c.name}` })),
        elements: wetRoomTemplate.elements.map((e) => ({ ...e, label: `Ny ${e.label}` })),
      },
    });
    const { data } = await draftOf(f.actor, f);
    const floor = checkpointIn(data, CP.floor)!;
    expect(floor.label).toBe("Overflater gulv");
    const answers = checkpointIn(data, CP.adjacent)!.answers;
    expect(answers.map((a) => a.label)).toContain("Hulltaking");
    expect(JSON.stringify(data)).not.toContain("Ny ");
  });
});

// --- Innhold fra databasen ----------------------------------------------------------------------

describe("utkastet fra lagrede data", () => {
  it("forside, svar (T17), avvik og TG fra databasen", async () => {
    const f = await richBathroom();
    const result = await draftOf(f.actor, f);
    const { data } = result;
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(data.kind).toBe("draft");
    expect(data.reportId).toBe(f.reportId);
    expect(data.cover.addressLines).toEqual(["Prøvevegen 1", "8000 Bodø"]);
    expect(data.cover.cadastralText).toBe("Gnr. 12, bnr. 34");
    expect(data.cover.inspectionDate).toBe("2026-06-15");
    expect(data.company).toMatchObject({ legalName: "Testselskap takst AS" });
    expect(checkpointIn(data, CP.floor)).toMatchObject({
      tg: "1",
      descriptionText: "Gulvet har normal slitasje.",
    });
    expect(checkpointIn(data, CP.adjacent)!.answers.map((a) => a.valueText)).toEqual([
      "Utført uten funn",
      "12,4",
      "Vekt-%",
    ]);
    const ventilation = checkpointIn(data, "wet_room.ventilation")!;
    expect(ventilation.tg).toBe("3");
    expect(ventilation.deviations[0]).toMatchObject({ kind: "tg", tg: "3" });
    expect(ventilation.deviations[0]!.causeLabel).toBe("Svikt i funksjon");
    expect(data.missing!.emptyCheckpoints.map((c) => c.label)).toContain("Generelt");
  });

  it("T24 hvert funn fra publiseringssjekken står på målet med skjermens tekst, og ingenting annet", async () => {
    const f = await richBathroom();
    await db
      .update(assignments)
      .set({ inspectionAt: null })
      .where(eq(assignments.id, f.assignmentId));
    // Avvik med TG valgt av «velg TG2 eller TG3» uten valg: sett TG tom direkte
    await db.update(deviations).set({ tg: null }).where(eq(deviations.id, f.tg2));

    const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    if (view.state !== "draft") throw new Error("forventet utkast");
    const { data } = await draftOf(f.actor, f);
    const checkpoints = data.rooms.flatMap((r) => r.checkpoints);
    const deviationsById = new Map(
      checkpoints.flatMap((c) => c.deviations).map((d) => [d.deviationId, d]),
    );

    let placedNotes = 0;
    expect(view.findings.length).toBeGreaterThan(3);
    for (const item of view.findings) {
      const { target } = item;
      if (item.checkCode === "mandatory_without_tg" && !target.missing.includes("reason")) {
        if (target.deviationId) {
          expect(deviationsById.get(target.deviationId)?.tgNotSet).toBe(true);
        } else {
          const placed = checkpoints.find((c) => c.checkpointId === target.checkpointId);
          const empty = data.missing!.emptyCheckpoints.some(
            (c) => c.checkpointId === target.checkpointId,
          );
          expect(placed?.tgNotSet === true || empty).toBe(true);
        }
        continue;
      }
      const text = publishFindingText(item, {
        deviationNumber: item.deviationNumber,
        deviationTg: item.deviationTg,
      });
      const kind = item.severity === "blocker" ? "missing" : "check";
      const notes = target.deviationId
        ? deviationsById.get(target.deviationId)!.notes
        : target.checkpointId
          ? checkpoints.find((c) => c.checkpointId === target.checkpointId)!.notes
          : data.missing!.reportNotes;
      expect(notes).toContainEqual({ kind, checkCode: item.checkCode, text });
      placedNotes += 1;
    }
    const allNotes = [
      ...checkpoints.flatMap((c) => c.notes),
      ...checkpoints.flatMap((c) => c.deviations.flatMap((d) => d.notes)),
      ...data.missing!.reportNotes,
    ];
    expect(allNotes).toHaveLength(placedNotes);
    expect(data.missing!.reportNotes.map((n) => n.checkCode)).toContain("inspection_date_missing");
  });

  it("T14 ventende KI-forslag, sammendrag og reklamasjon med merketekst gir ingen spor", async () => {
    const f = await richBathroom();
    const marker = "Merke-T14-KI-FORSLAG";
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(and(eq(checkpointResults.reportId, f.reportId), eq(checkpointResults.tgDirect, "1")));
    for (const feature of ["language_polish", "phrase_suggest", "summary_draft"]) {
      await createAiUsageLog(f.organizationId, {
        feature,
        reportId: f.reportId,
        assignmentId: f.assignmentId,
        status: "suggested",
        outputText: `${marker} ${feature}`,
        targetRef: { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" },
      });
    }
    await createAiUsageLog(f.organizationId, {
      reportId: f.reportId,
      status: "rejected",
      outputText: `${marker} avvist`,
      targetRef: { type: "deviation", id: f.tg3, fieldKey: "deviation_text" },
    });
    await db
      .update(reports)
      .set({ summaryText: `${marker} sammendrag` })
      .where(eq(reports.id, f.reportId));
    await createClaim(f.organizationId, {
      assignmentId: f.assignmentId,
      description: `${marker} reklamasjon`,
    });
    const json = JSON.stringify((await draftOf(f.actor, f)).data);
    expect(json).not.toContain(marker);
    for (const key of ["ai_usage_id", "text_source", "summary", "rule_decisions", "claim"]) {
      expect(json).not.toContain(key);
    }
  });
});

// --- 10.1 Publisert rapport (A541) --------------------------------------------------------------

describe("10.1 publisert rapport", () => {
  it("published gir utkast fra de låste radene", async () => {
    const f = await createPublishableBathroom();
    const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    if (view.state !== "draft") throw new Error("forventet utkast");
    const published = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: view.fingerprint,
      overrides: [],
    });
    expect(published.status).toBe("published");
    const { data } = await draftOf(f.actor, f);
    expect(data.kind).toBe("draft");
    expect(data.versionNumber).toBeNull();
    expect(data.rooms[0]!.checkpoints.every((c) => c.tg === "1")).toBe(true);
  });
});
