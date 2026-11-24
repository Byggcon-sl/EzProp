import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  addDeviation,
  getPublishCheck,
  getRoomView,
  publishReport,
  setTgDirect,
  startNewVersion,
  type PublishCheckView,
} from "@/core/reports";
import { computePublishCheck, publishFindingKey } from "@/core/reports/logic";
import { db } from "@/db/client";
import { assignments, checkpointResults } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createCertification,
  createCompany,
  resetDatabase,
} from "../../../tests/factories";
import { answerHole, startedBathroom, startedView } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Det publiser-siden og rommet får fra kjernen (docs/funksjoner/fase2a-publisering-badet.md
 * Omfang 5 og 6, F2–F4, designet avsnitt 5, 11 og 14): `publishRoom` i rommets visning og etter
 * hver lagring (tellemerket regnes lokalt), avviksnummer og TG i funnet, «Gyldig til» i
 * «Dette publiseres», og feltet et KI-forslag gjelder. Alle data er oppdiktede.
 * Støtter hovedmål: de ansatte (riktige tall uten nytt kall), færre reklamasjoner (samme sjekk på
 * rommet og publiser-siden) og KI i bunnen (forslaget kan behandles der mangelen vises).
 */

beforeEach(resetDatabase);

const ALL_CHECKPOINTS = [
  "wet_room.general",
  "wet_room.documentation",
  "wet_room.walls_ceiling",
  "wet_room.floor",
  "wet_room.membrane_drain",
  "wet_room.fixtures",
  "wet_room.ventilation",
  "wet_room.adjacent",
] as const;

const TG3_VENTILATION = {
  checkpointKey: "wet_room.ventilation",
  questionKey: "wet_room.ventilation.missing_ventilation",
  outcomeKey: "tg3",
};

type Draft = Extract<PublishCheckView, { state: "draft" }>;

async function draft(f: {
  actor: Parameters<typeof getPublishCheck>[0];
  organizationId: string;
  assignmentId: string;
}): Promise<Draft> {
  const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error("rapporten er ikke et utkast");
  return view;
}

/** Nøklene til funnene i rommet, uten KI-forslag (de regnes ikke lokalt). */
function roomKeys(check: Draft, roomId: string): string[] {
  return check.findings
    .filter((f) => f.target.roomId === roomId && f.checkCode !== "ai_suggestion_pending")
    .map((f) => f.key)
    .sort();
}

describe("publishRoom i rommets visning og etter lagring", () => {
  it("lokal sjekk på publishRoom gir de samme funnene som serveren for rommet", async () => {
    const f = await startedBathroom();
    const view = await startedView(f);
    const local = computePublishCheck({
      hasInspectionDate: true,
      rooms: [view.publishRoom],
      pendingAiSuggestions: [],
    });
    const check = await draft(f);
    expect(local.map((x) => publishFindingKey(x)).sort()).toEqual(roomKeys(check, f.roomId));
    expect(local.some((x) => x.checkCode === "wet_or_below_ground_missing_hole")).toBe(true);
  });

  it("svaret på hulltaking oppdaterer publishRoom i svaret fra lagringen", async () => {
    const f = await startedBathroom();
    await answerHole(f, "done_no_findings", 10);
    const view = await getRoomView(f.actor, f.organizationId, f.room);
    if (view.state !== "started") throw new Error("ikke startet");
    expect(view.publishRoom.holeDrilling).toBe("ok");
    const result = await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: "wet_room.general",
      tgDirect: "1",
      base: null,
    });
    if (result.status !== "saved") throw new Error("ikke lagret");
    const local = computePublishCheck({
      hasInspectionDate: true,
      rooms: [result.refresh.publishRoom],
      pendingAiSuggestions: [],
    });
    expect(local.some((x) => x.checkCode === "wet_or_below_ground_missing_hole")).toBe(false);
    expect(
      local.some(
        (x) =>
          x.checkCode === "mandatory_without_tg" && x.target.checkpointKey === "wet_room.general",
      ),
    ).toBe(false);
    expect(local.map((x) => publishFindingKey(x)).sort()).toEqual(
      roomKeys(await draft(f), f.roomId),
    );
  });

  it("andre organisasjoner får verken rommet eller sjekken (tenant-isolasjon)", async () => {
    const fixtures = new Map<string, Awaited<ReturnType<typeof startedBathroom>>>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        fixtures.set(a.organizationId, await startedBathroom({ organizationId: a.organizationId }));
        fixtures.set(b.organizationId, await startedBathroom({ organizationId: b.organizationId }));
        return {
          a: [fixtures.get(a.organizationId)!.roomId],
          b: [fixtures.get(b.organizationId)!.roomId],
        };
      },
      query: async (actor, organizationId) => {
        const rooms: string[] = [];
        for (const f of fixtures.values()) {
          try {
            const view = await getRoomView(actor, organizationId, f.room);
            if (view.state === "started") rooms.push(view.publishRoom.roomId);
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId);
          }
        }
        return rooms;
      },
      idOf: (roomId) => roomId,
    });
  });
});

describe("funnene på publiser-siden", () => {
  it("avvik uten kostnad får avviksnummer og TG til teksten «Avvik 1 (TG3)»", async () => {
    const f = await startedBathroom();
    const id = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, { id, ...TG3_VENTILATION, tg: null });
    const check = await draft(f);
    const cost = check.findings.find((x) => x.checkCode === "tg3_missing_cost");
    expect(cost).toMatchObject({ deviationNumber: 1, deviationTg: 3 });
    const point = check.findings.find(
      (x) => x.checkCode === "mandatory_without_tg" && x.target.deviationId === null,
    );
    expect(point).toMatchObject({ deviationNumber: null, deviationTg: null });
  });

  it("«Gyldig til» er befaringsdato + ett år, og tom uten befaringsdato", async () => {
    const f = await startedBathroom();
    expect(await draft(f)).toMatchObject({
      nextVersionNumber: 1,
      validUntil: "2027-06-15",
      validUntilInherited: false,
    });
    const g = await startedBathroom({ organizationId: f.organizationId, inspectionAt: null });
    expect(await draft(g)).toMatchObject({ validUntil: null, validUntilInherited: false });
  });

  it("versjon 2 arver «Gyldig til» fra versjon 1, også når befaringsdatoen endres", async () => {
    const f = await startedBathroom();
    const company = await createCompany(f.organizationId);
    await db
      .update(assignments)
      .set({ companyId: company.id })
      .where(eq(assignments.id, f.assignmentId));
    await createCertification({ id: f.employeeId, organizationId: f.organizationId });
    await answerHole(f, "done_no_findings", 10);
    for (const checkpointKey of ALL_CHECKPOINTS) {
      await setTgDirect(f.actor, f.organizationId, f.room, {
        checkpointKey,
        tgDirect: "1",
        base: null,
      });
    }
    const v1 = await draft(f);
    const published = await publishReport(f.actor, f.organizationId, {
      assignmentId: f.assignmentId,
      fingerprint: v1.fingerprint,
      overrides: [],
    });
    expect(published.status).toBe("published");
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    await db
      .update(assignments)
      .set({ inspectionAt: new Date("2026-09-01T10:00:00Z") })
      .where(eq(assignments.id, f.assignmentId));
    expect(await draft(f)).toMatchObject({
      nextVersionNumber: 2,
      validUntil: "2027-06-15",
      validUntilInherited: true,
    });
  });

  it("et KI-forslag som venter, sier hvilket felt det gjelder", async () => {
    const f = await startedBathroom();
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: "wet_room.general",
      tgDirect: "1",
      base: null,
    });
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .where(eq(checkpointResults.reportId, f.reportId));
    const targetRef = { type: "checkpoint_result", id: result!.id, fieldKey: "description_text" };
    const pending = await createAiUsageLog(f.organizationId, {
      employeeId: f.employeeId,
      reportId: f.reportId,
      assignmentId: f.assignmentId,
      targetRef,
      outputText: "Oppdiktet forslag 7HJ2.",
    });
    const check = await draft(f);
    expect(check.pendingAiSuggestions).toEqual([
      expect.objectContaining({ aiUsageId: pending.id, field: targetRef }),
    ]);
  });
});
