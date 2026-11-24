import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Actor } from "@/core/access";
import {
  addRooms,
  removeBuilding,
  removeFloor,
  removeRoom,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  saveBuilding,
  saveFloor,
  saveFloorArea,
  saveRoom,
} from "@/core/buildings";
import {
  addDeviation,
  addMeasure,
  changeSuggestedDeviationTg,
  decideSuggestion,
  getPublishCheck,
  publishReport,
  removeDeviation,
  removeMeasure,
  restoreDeviation,
  saveField,
  setCheckpointDone,
  setTgDirect,
  startNewVersion,
  startReport,
} from "@/core/reports";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import { createBuilding, createFloor, createRoom, resetDatabase } from "../../../tests/factories";
import {
  addTg3WithoutCost,
  createPublishableBathroom,
  type PublishableBathroom,
} from "../../../tests/publish-fixtures";
import { CP, RULE } from "../../../tests/report-fixtures";

/*
 * Låst etter publisering (docs/funksjoner/fase2a-publisering-badet-testplan.md 4.2, kortets I5 og
 * A447): hver skrivende tjeneste i rapportkjernen og i bygninger, etasjer og rom avvises med
 * «Rapporten er publisert. Lag ny versjon for å rette.» og endrer ingenting. Etter «Lag ny versjon»
 * er alt åpent igjen. Alle data er oppdiktede.
 *
 * Hovedmål: færre reklamasjoner (en publisert rapport kan ikke endres i det stille) og de ansatte
 * (tydelig melding, ingen tapt arbeid).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MESSAGE = "Rapporten er publisert. Lag ny versjon for å rette.";

const TG2_FIXTURES = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.damaged_furniture",
  outcomeKey: "tg2",
};

type Prepared = PublishableBathroom & {
  deviationId: string;
  removedDeviationId: string;
  measureId: string;
  removedRoomId: string;
  removedFloorId: string;
  removedBuildingId: string;
};

/** Et bad med avvik, tiltak og slettede rader til «Angre», publisert av takstmannen. */
async function preparePublished(): Promise<Prepared> {
  const f = await createPublishableBathroom();
  const deviationId = await addTg3WithoutCost(f);
  const measureId = uuidv7();
  await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
  const removedDeviationId = uuidv7();
  await addDeviation(f.actor, f.organizationId, f.room, {
    id: removedDeviationId,
    ...TG2_FIXTURES,
    tg: null,
  });
  await removeDeviation(f.actor, f.organizationId, f.room, removedDeviationId);
  const removedRoom = await createRoom(f.organizationId, {
    floorId: f.floorId,
    roomType: "bedroom",
    deletedAt: new Date(),
  });
  const removedFloor = await createFloor(f.organizationId, {
    buildingId: f.buildingId,
    deletedAt: new Date(),
  });
  const removedBuilding = await createBuilding(f.organizationId, {
    assignmentId: f.assignmentId,
    deletedAt: new Date(),
  });
  await publishAll(f);
  return {
    ...f,
    deviationId,
    removedDeviationId,
    measureId,
    removedRoomId: removedRoom.id,
    removedFloorId: removedFloor.id,
    removedBuildingId: removedBuilding.id,
  };
}

async function publishAll(f: PublishableBathroom) {
  const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error("forventet draft");
  const result = await publishReport(f.actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: view.findings
      .filter((x) => x.severity === "blocker")
      .map((x) => ({ findingKey: x.key, reasonCode: "described_elsewhere" as const })),
  });
  if (result.status !== "published") throw new Error(`publisering feilet: ${result.status}`);
}

const LOCKED_TABLES = [
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
] as const;

/** Alle rader i tabellene for organisasjonen, som tekst. */
async function stateOf(organizationId: string): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const table of LOCKED_TABLES) {
    out[table] = await db.execute(
      sql`select * from ${sql.raw(`"${table}"`)} where organization_id = ${organizationId} order by id`,
    );
  }
  return JSON.stringify(out);
}

type Action = [string, (actor: Actor, p: Prepared) => Promise<unknown>];

const REPORT_ACTIONS: Action[] = [
  ["startReport", (actor, p) => startReport(actor, p.organizationId, p.assignmentId)],
  [
    "saveField",
    (actor, p) =>
      saveField(actor, p.organizationId, p.room, {
        table: "field_answers",
        id: uuidv7(),
        elementKey: "wet_room.build_year",
        field: "value",
        value: { text: null, number: 1995, optionKeys: null },
        base: { text: null, number: null, optionKeys: null },
      }),
  ],
  [
    "saveField (avvik: kostnad, «Rett nå»)",
    (actor, p) =>
      saveField(actor, p.organizationId, p.room, {
        table: "deviations",
        id: p.deviationId,
        field: "cost",
        value: { type: "band", bandKey: "from_20000_to_100000", amount: null },
        base: { type: "none", bandKey: null, amount: null },
      }),
  ],
  [
    "addDeviation",
    (actor, p) =>
      addDeviation(actor, p.organizationId, p.room, { id: uuidv7(), ...TG2_FIXTURES, tg: null }),
  ],
  [
    "removeDeviation",
    (actor, p) => removeDeviation(actor, p.organizationId, p.room, p.deviationId),
  ],
  [
    "restoreDeviation",
    (actor, p) =>
      restoreDeviation(actor, p.organizationId, p.room, { deviationId: p.removedDeviationId }),
  ],
  [
    "addMeasure",
    (actor, p) =>
      addMeasure(actor, p.organizationId, p.room, { id: uuidv7(), deviationId: p.deviationId }),
  ],
  ["removeMeasure", (actor, p) => removeMeasure(actor, p.organizationId, p.room, p.measureId)],
  [
    "decideSuggestion",
    (actor, p) =>
      decideSuggestion(actor, p.organizationId, p.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "rejected",
        overrideReasonCode: "documentation_present",
      }),
  ],
  [
    "changeSuggestedDeviationTg",
    (actor, p) =>
      changeSuggestedDeviationTg(actor, p.organizationId, p.room, {
        id: uuidv7(),
        deviationId: p.deviationId,
        tg: 2,
        base: 3,
        overrideReasonCode: "documentation_present",
      }),
  ],
  [
    "setTgDirect («Rett nå» for TG)",
    (actor, p) =>
      setTgDirect(actor, p.organizationId, p.room, {
        checkpointKey: CP.general,
        tgDirect: "0",
        base: "1",
      }),
  ],
  [
    "setCheckpointDone",
    (actor, p) =>
      setCheckpointDone(actor, p.organizationId, p.room, { checkpointKey: CP.general, done: true }),
  ],
];

/** Lesing og publisering, som ikke er skrivinger i badet. */
const NOT_ROOM_WRITES = new Set([
  "getRoomView",
  "getPublishCheck",
  "listReleases",
  "listPendingAiSuggestions",
  "isReportPublishedForAssignment",
  "publishReport",
  "startNewVersion",
  // Leser bare (KI i veien)
  "getReportSummary",
  "loadPhraseCandidates",
  "loadPhraseUsage",
  // KI i veien: låsen prøves i `published-lock.test.ts` (`AI_REPORT_WRITES`)
  "polishDeviation",
  "polishDescription",
  "suggestPhrases",
  "applyPhrase",
  "decideAiText",
  "draftSummary",
  "saveSummary",
]);

async function expectLocked(action: () => Promise<unknown>) {
  let error: unknown = null;
  try {
    await action();
  } catch (e) {
    error = e;
  }
  expect(error, "forventet avvisning").toBeInstanceOf(Error);
  expect((error as Error).message).toBe(MESSAGE);
}

describe("4.2 (I5) skrivetjenestene i rapportkjernen er låst etter publisering", () => {
  it.each(REPORT_ACTIONS)("%s avvises og endrer ingenting", async (_name, action) => {
    const p = await preparePublished();
    const before = await stateOf(p.organizationId);
    await expectLocked(() => action(p.actor, p));
    expect(await stateOf(p.organizationId)).toBe(before);
  });

  it("hver skrivetjeneste som eksporteres fra @/core/reports har en rad over", () => {
    const source = readFileSync(join(__dirname, "index.ts"), "utf8");
    const exported = [...source.matchAll(/export\s*\{([^}]*)\}\s*from/gu)]
      .flatMap((m) => m[1]!.split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type "))
      .map((name) =>
        name
          .split(/\s+as\s+/u)
          .pop()!
          .trim(),
      )
      // Funksjoner har liten forbokstav; feilklasser og konstanter står med stor
      .filter((name) => /^[a-z]/u.test(name));
    const covered = new Set(REPORT_ACTIONS.map(([name]) => name.split(" ")[0]!));
    const missing = exported.filter((name) => !covered.has(name) && !NOT_ROOM_WRITES.has(name));
    expect(missing).toEqual([]);
  });

  it("etter «Lag ny versjon» kan badet endres igjen", async () => {
    const p = await preparePublished();
    await startNewVersion(p.actor, p.organizationId, p.assignmentId);
    const result = await setCheckpointDone(p.actor, p.organizationId, p.room, {
      checkpointKey: CP.general,
      done: true,
    });
    expect(result.status).toBe("saved");
  });
});

const BUILDING_ACTIONS: Action[] = [
  [
    "saveBuilding",
    (actor, p) =>
      saveBuilding(actor, p.organizationId, p.assignmentId, p.buildingId, { name: "Hus B" }),
  ],
  ["removeBuilding", (actor, p) => removeBuilding(actor, p.organizationId, p.buildingId)],
  [
    "saveFloor",
    (actor, p) =>
      saveFloor(actor, p.organizationId, p.buildingId, p.floorId, { name: "2. etasje", level: 2 }),
  ],
  ["removeFloor", (actor, p) => removeFloor(actor, p.organizationId, p.floorId)],
  ["saveFloorArea", (actor, p) => saveFloorArea(actor, p.organizationId, p.floorId, { braI: 42 })],
  [
    "saveRoom",
    (actor, p) =>
      saveRoom(actor, p.organizationId, p.floorId, p.roomId, {
        roomType: "bathroom",
        name: "Bad 2",
      }),
  ],
  [
    "addRooms",
    (actor, p) =>
      addRooms(actor, p.organizationId, p.floorId, {
        drafts: [{ roomType: "bedroom", count: 1 }],
        source: "manual",
      }),
  ],
  ["removeRoom", (actor, p) => removeRoom(actor, p.organizationId, p.roomId)],
  ["restoreRoom", (actor, p) => restoreRoom(actor, p.organizationId, p.removedRoomId, "trash")],
  ["restoreFloor", (actor, p) => restoreFloor(actor, p.organizationId, p.removedFloorId, "trash")],
  [
    "restoreBuilding",
    (actor, p) => restoreBuilding(actor, p.organizationId, p.removedBuildingId, "trash"),
  ],
];

describe("4.2.3 (A447) bygninger, etasjer og rom er låst når rapporten er publisert", () => {
  it.each(BUILDING_ACTIONS)("%s avvises og endrer ingenting", async (_name, action) => {
    const p = await preparePublished();
    const before = await stateOf(p.organizationId);
    await expectLocked(() => action(p.actor, p));
    expect(await stateOf(p.organizationId)).toBe(before);
  });

  it.each(BUILDING_ACTIONS)(
    "%s er lov når rapporten er i draft (ingen regresjon)",
    async (_name, action) => {
      const f = await createPublishableBathroom();
      const removedRoom = await createRoom(f.organizationId, {
        floorId: f.floorId,
        roomType: "bedroom",
        deletedAt: new Date(),
      });
      const removedFloor = await createFloor(f.organizationId, {
        buildingId: f.buildingId,
        deletedAt: new Date(),
      });
      const removedBuilding = await createBuilding(f.organizationId, {
        assignmentId: f.assignmentId,
        deletedAt: new Date(),
      });
      const p: Prepared = {
        ...f,
        deviationId: uuidv7(),
        removedDeviationId: uuidv7(),
        measureId: uuidv7(),
        removedRoomId: removedRoom.id,
        removedFloorId: removedFloor.id,
        removedBuildingId: removedBuilding.id,
      };
      let error: unknown = null;
      try {
        await action(f.actor, p);
      } catch (e) {
        error = e;
      }
      if (error) expect((error as Error).message).not.toBe(MESSAGE);
    },
  );

  it("lov på oppdrag uten rapport", async () => {
    const f = await createPublishableBathroom();
    const otherRoom = await createRoom(f.organizationId, {
      floorId: f.floorId,
      roomType: "bedroom",
    });
    // Et annet oppdrag uten rapport i samme organisasjon: lagres som før
    const { createRoomOnNewAssignment } = await import("../../../tests/report-fixtures");
    const place = await createRoomOnNewAssignment(f.organizationId, { roomType: "bedroom" });
    await expect(
      saveRoom(f.actor, f.organizationId, place.floorId, place.roomId, {
        roomType: "bedroom",
        name: "Soverom 9",
      }),
    ).resolves.toMatchObject({ id: place.roomId });
    expect(otherRoom.id).toBeTruthy();
  });
});
