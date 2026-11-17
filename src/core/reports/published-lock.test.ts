import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import {
  addRooms,
  removeBuilding,
  removeFloor,
  removeRoom,
  ReportPublishedError,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  saveBuilding,
  saveFloor,
  saveFloorArea,
  saveRoom,
} from "@/core/buildings";
import * as reportsCore from "@/core/reports";
import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  isReportPublishedForAssignment,
  removeDeviation,
  removeMeasure,
  REPORT_PUBLISHED_MESSAGE,
  ReportValidationError,
  restoreDeviation,
  saveField,
  setCheckpointDone,
  setTgDirect,
  startReport,
} from "@/core/reports";
import { db } from "@/db/client";
import { reports, type ReportStatus } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createBuilding,
  createFloor,
  createProperty,
  createRoom,
  resetDatabase,
} from "../../../tests/factories";
import {
  answerHole,
  CP,
  createRoomOnNewAssignment,
  EMPTY,
  RULE,
  startedBathroom,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Låsen etter publisering (docs/funksjoner/fase2a-publisering-badet.md Omfang 10, testplanen 4.2,
 * ADR 0015 punkt 15, A447). Statusen settes direkte i databasen, så låsen prøves uten publiseringen.
 * Alle skrivetjenester i rapportkjernen og i bygningene avvises med `report_published` når
 * rapporten er publisert, og ingenting endres. Før publisering virker alt som før. Testdata er
 * oppdiktet.
 * Støtter hovedmål: færre reklamasjoner (en publisert rapport endres ikke i det stille og mister
 * ikke badet uten ny versjon).
 */

beforeEach(resetDatabase);

const FIXTURES = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.damaged_furniture",
  outcomeKey: "tg2",
};

/**
 * Et startet bad med eiendom og det tjenestene trenger: avvik med tiltak, et fjernet avvik, et fjernet
 * tiltak, et svar som gir regelforslag, en ekstra bygning med etasje og rom, og en bygning, en
 * etasje og et rom i papirkurven.
 */
async function lockFixture() {
  const f = await startedBathroom();
  // Ny bygning krever eiendom på oppdraget
  await createProperty(f.organizationId, { assignmentId: f.assignmentId });
  const deviationId = uuidv7();
  await addDeviation(f.actor, f.organizationId, f.room, {
    id: deviationId,
    ...FIXTURES,
    tg: null,
  });
  const measureId = uuidv7();
  await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
  const removedDeviationId = uuidv7();
  await addDeviation(f.actor, f.organizationId, f.room, {
    id: removedDeviationId,
    ...FIXTURES,
    tg: null,
  });
  await removeDeviation(f.actor, f.organizationId, f.room, removedDeviationId);
  await answerHole(f, "not_done");

  const extraBuilding = await createBuilding(f.organizationId, { assignmentId: f.assignmentId });
  const extraFloor = await createFloor(f.organizationId, { buildingId: extraBuilding.id });
  const extraRoom = await createRoom(f.organizationId, {
    floorId: extraFloor.id,
    roomType: "bedroom",
  });

  const trashBuilding = await createBuilding(f.organizationId, { assignmentId: f.assignmentId });
  await removeBuilding(f.actor, f.organizationId, trashBuilding.id);
  const trashFloor = await createFloor(f.organizationId, { buildingId: f.buildingId });
  await removeFloor(f.actor, f.organizationId, trashFloor.id);
  const trashRoom = await createRoom(f.organizationId, {
    floorId: f.floorId,
    roomType: "hallway",
  });
  await removeRoom(f.actor, f.organizationId, trashRoom.id);

  return {
    ...f,
    deviationId,
    measureId,
    removedDeviationId,
    extraBuildingId: extraBuilding.id,
    extraFloorId: extraFloor.id,
    extraRoomId: extraRoom.id,
    trashBuildingId: trashBuilding.id,
    trashFloorId: trashFloor.id,
    trashRoomId: trashRoom.id,
  };
}

type L = Awaited<ReturnType<typeof lockFixture>>;

async function setStatus(reportId: string, status: ReportStatus) {
  await db.update(reports).set({ status }).where(eq(reports.id, reportId));
}

/** Tabellene skrivingene kan røre. Hele innholdet sammenlignes før og etter. */
const WATCHED_TABLES = [
  "reports",
  "field_answers",
  "checkpoint_results",
  "deviations",
  "deviation_measures",
  "tgiu_details",
  "rule_suggestion_decisions",
  "report_buildings",
  "floors",
  "floor_areas",
  "rooms",
  "audit_log",
  "events",
] as const;

async function snapshotDatabase(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of WATCHED_TABLES) {
    const [row] = (await db.execute(
      sql`select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) as rows from ${sql.identifier(table)} t`,
    )) as unknown as { rows: unknown }[];
    result[table] = row?.rows;
  }
  return result;
}

// --- Skrivetjenestene -------------------------------------------------------------------------

type Write = (l: L) => Promise<unknown>;

/** Skrivetjenestene i rapportkjernen. Navnet er eksporten i `src/core/reports/index.ts`. */
const REPORT_WRITES: [string, Write][] = [
  ["startReport", (l) => startReport(l.actor, l.organizationId, l.assignmentId)],
  [
    "saveField",
    (l) =>
      saveField(l.actor, l.organizationId, l.room, {
        table: "field_answers",
        id: uuidv7(),
        elementKey: "wet_room.membrane_year",
        field: "value",
        value: { ...EMPTY, number: 2005 },
        base: EMPTY,
      }),
  ],
  [
    "addDeviation",
    (l) => addDeviation(l.actor, l.organizationId, l.room, { id: uuidv7(), ...FIXTURES, tg: null }),
  ],
  ["removeDeviation", (l) => removeDeviation(l.actor, l.organizationId, l.room, l.deviationId)],
  [
    "restoreDeviation",
    (l) =>
      restoreDeviation(l.actor, l.organizationId, l.room, { deviationId: l.removedDeviationId }),
  ],
  [
    "addMeasure",
    (l) =>
      addMeasure(l.actor, l.organizationId, l.room, { id: uuidv7(), deviationId: l.deviationId }),
  ],
  ["removeMeasure", (l) => removeMeasure(l.actor, l.organizationId, l.room, l.measureId)],
  [
    "decideSuggestion",
    (l) =>
      decideSuggestion(l.actor, l.organizationId, l.room, {
        id: uuidv7(),
        ruleKey: RULE.notDone,
        decision: "accepted",
      }),
  ],
  [
    "setTgDirect",
    (l) =>
      setTgDirect(l.actor, l.organizationId, l.room, {
        checkpointKey: CP.floor,
        tgDirect: "1",
        base: null,
      }),
  ],
  [
    "setCheckpointDone",
    (l) =>
      setCheckpointDone(l.actor, l.organizationId, l.room, {
        checkpointKey: CP.floor,
        done: true,
      }),
  ],
];

/** Skrivetjenestene i bygningene: lagring, fjerning og gjenoppretting (A447). */
const BUILDING_WRITES: [string, Write][] = [
  [
    "saveBuilding (ny)",
    (l) => saveBuilding(l.actor, l.organizationId, l.assignmentId, null, { name: "Garasje" }),
  ],
  [
    "saveBuilding (endre)",
    (l) =>
      saveBuilding(l.actor, l.organizationId, l.assignmentId, l.extraBuildingId, {
        name: "Anneks",
      }),
  ],
  ["removeBuilding", (l) => removeBuilding(l.actor, l.organizationId, l.extraBuildingId)],
  [
    "saveFloor",
    (l) => saveFloor(l.actor, l.organizationId, l.buildingId, null, { name: "Loft", level: 2 }),
  ],
  ["removeFloor", (l) => removeFloor(l.actor, l.organizationId, l.extraFloorId)],
  [
    "saveFloorArea",
    (l) => saveFloorArea(l.actor, l.organizationId, l.floorId, { braI: 42, method: null }),
  ],
  [
    "saveRoom (nytt)",
    (l) => saveRoom(l.actor, l.organizationId, l.floorId, null, { roomType: "bathroom" }),
  ],
  [
    "saveRoom (endre)",
    (l) =>
      saveRoom(l.actor, l.organizationId, l.extraFloorId, l.extraRoomId, {
        roomType: "bedroom",
        name: "Soverom 2",
      }),
  ],
  [
    "addRooms",
    (l) =>
      addRooms(l.actor, l.organizationId, l.floorId, {
        drafts: [{ roomType: "bedroom", count: 1 }],
        source: "manual",
      }),
  ],
  ["removeRoom", (l) => removeRoom(l.actor, l.organizationId, l.extraRoomId)],
  [
    "restoreBuilding",
    (l) => restoreBuilding(l.actor, l.organizationId, l.trashBuildingId, "trash"),
  ],
  ["restoreFloor", (l) => restoreFloor(l.actor, l.organizationId, l.trashFloorId, "trash")],
  ["restoreRoom", (l) => restoreRoom(l.actor, l.organizationId, l.trashRoomId, "trash")],
];

/**
 * Eksporterte funksjoner i rapportkjernen som ikke skriver i rapporten, eller som skal virke på en
 * publisert rapport (publisering og «Lag ny versjon» har egne tester).
 */
const NOT_REPORT_WRITES = new Set([
  "getRoomView",
  "isReportPublishedForAssignment",
  "getPublishCheck",
  "publishReport",
  "startNewVersion",
  "listReleases",
  "listPendingAiSuggestions",
  "guardReportErrors",
]);

describe("låsen etter publisering i rapportkjernen", () => {
  it("hver eksporterte skrivetjeneste står i listen (ny tjeneste uten rad gjør testen rød)", () => {
    const exported = Object.entries(reportsCore)
      .filter(([name, value]) => typeof value === "function" && /^[a-z]/.test(name))
      .map(([name]) => name)
      .filter((name) => !NOT_REPORT_WRITES.has(name))
      .sort();
    expect(exported).toEqual(REPORT_WRITES.map(([name]) => name).sort());
  });

  it.each(REPORT_WRITES)(
    "%s avvises med report_published, og ingenting endres",
    async (_name, write) => {
      const l = await lockFixture();
      await setStatus(l.reportId, "published");
      const before = await snapshotDatabase();

      const error = await write(l).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ReportValidationError);
      expect((error as ReportValidationError).code).toBe("report_published");
      expect((error as Error).message).toBe("Rapporten er publisert. Lag ny versjon for å rette.");

      expect(await snapshotDatabase()).toEqual(before);
    },
  );

  it.each(REPORT_WRITES)("%s virker som før når rapporten er utkast", async (_name, write) => {
    const l = await lockFixture();
    await expect(write(l)).resolves.toBeDefined();
  });
});

describe("låsen etter publisering i bygningene (A447)", () => {
  it.each(BUILDING_WRITES)(
    "%s avvises med samme melding, og ingenting endres",
    async (_name, write) => {
      const l = await lockFixture();
      await setStatus(l.reportId, "published");
      const before = await snapshotDatabase();

      const error = await write(l).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ReportPublishedError);
      expect((error as ReportPublishedError).code).toBe("report_published");
      expect((error as Error).message).toBe(REPORT_PUBLISHED_MESSAGE);

      expect(await snapshotDatabase()).toEqual(before);
    },
  );

  it.each(BUILDING_WRITES)("%s virker som før når rapporten er utkast", async (_name, write) => {
    const l = await lockFixture();
    await expect(write(l)).resolves.toBeDefined();
  });

  it.each(BUILDING_WRITES)("%s virker på oppdrag uten rapport", async (_name, write) => {
    const l = await lockFixture();
    // Rapporten fjernes mykt: oppdraget har da ingen gjeldende rapport
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, l.reportId));
    await expect(write(l)).resolves.toBeDefined();
  });

  it("en ny versjon (status tilbake til utkast) åpner låsen igjen", async () => {
    const l = await lockFixture();
    await setStatus(l.reportId, "published");
    await expect(removeRoom(l.actor, l.organizationId, l.extraRoomId)).rejects.toBeInstanceOf(
      ReportPublishedError,
    );
    await setStatus(l.reportId, "draft");
    await expect(removeRoom(l.actor, l.organizationId, l.extraRoomId)).resolves.toEqual({
      id: l.extraRoomId,
    });
  });
});

describe("isReportPublishedForAssignment", () => {
  it("er sann bare for publisert gjeldende rapport; uten rapport er den usann", async () => {
    const f = await startedBathroom();
    expect(await isReportPublishedForAssignment(db, f.organizationId, f.assignmentId)).toBe(false);
    await setStatus(f.reportId, "published");
    expect(await isReportPublishedForAssignment(db, f.organizationId, f.assignmentId)).toBe(true);
    // Erstattet rapport er ikke gjeldende
    await setStatus(f.reportId, "superseded");
    expect(await isReportPublishedForAssignment(db, f.organizationId, f.assignmentId)).toBe(false);

    const other = await createRoomOnNewAssignment(f.organizationId);
    expect(await isReportPublishedForAssignment(db, f.organizationId, other.assignmentId)).toBe(
      false,
    );
  });

  it("filtrerer på organisasjonen fra tilgangssjekken (tenant-isolasjon)", async () => {
    const assignmentOf = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await startedBathroom({ organizationId: grant.organizationId });
          await setStatus(f.reportId, "published");
          assignmentOf.set(grant.organizationId, f.assignmentId);
          ids[side].push(f.assignmentId);
        }
        return ids;
      },
      // Som skrivetjenestene: tilgangen først, så oppslaget med `grant.organizationId`
      query: async (actor: Actor, organizationId: string) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
        const results: { id: string }[] = [];
        for (const assignmentId of assignmentOf.values()) {
          if (await isReportPublishedForAssignment(db, grant.organizationId, assignmentId)) {
            results.push({ id: assignmentId });
          }
        }
        return results;
      },
      idOf: (row) => row.id,
    });
  });

  it("en publisert rapport i en annen organisasjon låser aldri dette oppdraget", async () => {
    const f = await startedBathroom();
    const other = await startedBathroom();
    await setStatus(other.reportId, "published");
    // Oppdraget i den andre organisasjonen slås opp med denne organisasjonen: aldri treff
    expect(await isReportPublishedForAssignment(db, f.organizationId, other.assignmentId)).toBe(
      false,
    );
    await expect(
      saveRoom(f.actor, f.organizationId, f.floorId, null, { roomType: "bedroom" }),
    ).resolves.toBeDefined();
    await expect(
      saveRoom(f.actor, f.organizationId, other.floorId, null, { roomType: "bedroom" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
