import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, permissions, type Actor } from "@/core/access";
import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  getRoomView,
  removeDeviation,
  removeMeasure,
  restoreDeviation,
  saveField,
  setCheckpointDone,
  setTgDirect,
  startReport,
} from "@/core/reports";
import type { EmployeeRole } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { grantPermission, resetDatabase } from "../../../tests/factories";
import {
  answerMembrane1990,
  CP,
  createRoomOnNewAssignment,
  createStaff,
  RULE,
  setInspectorsEditAll,
  startedBathroom,
  startedView,
} from "../../../tests/report-fixtures";

/*
 * Tilgang per rolle (docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 5, B5.1, B5.2, B5.7 og
 * B5.8). Hver skrivende handling krever `report.edit` på serveren. Admin stenges aldri ute
 * (regel 11). Alle data er oppdiktede.
 */

beforeEach(resetDatabase);

type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Et startet bad med et avvik, et tiltak og TG3-forslaget, laget av admin. */
async function prepare() {
  const f = await startedBathroom({ roles: ["admin"] });
  await answerMembrane1990(f);
  const deviationId = uuidv7();
  await addDeviation(f.actor, f.organizationId, f.room, {
    id: deviationId,
    checkpointKey: CP.floor,
    questionKey: (await startedView(f)).document.deviation_questions.find(
      (q) => q.checkpoint_key === CP.floor,
    )!.key,
    outcomeKey: (await startedView(f)).document.outcomes.find((o) => o.checkpoint_key === CP.floor)!
      .key,
    tg: 2,
  });
  const measureId = uuidv7();
  await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
  const other = await createRoomOnNewAssignment(f.organizationId);
  return { ...f, deviationId, measureId, otherAssignmentId: other.assignmentId };
}

/** Hver skrivende handling (B5.1, B5.8). */
const ACTIONS: [string, (actor: Actor, p: Prepared) => Promise<unknown>][] = [
  ["start", (actor, p) => startReport(actor, p.organizationId, p.otherAssignmentId)],
  [
    "felt",
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
    "avvik",
    async (actor, p) => {
      const view = await startedView(p);
      const outcome = view.document.outcomes.find((o) => o.checkpoint_key === CP.general)!;
      return addDeviation(actor, p.organizationId, p.room, {
        id: uuidv7(),
        checkpointKey: CP.general,
        questionKey: outcome.question_key,
        outcomeKey: outcome.key,
        tg: outcome.kind === "choose_tg2_tg3" ? 2 : null,
      });
    },
  ],
  [
    "tiltak",
    (actor, p) =>
      addMeasure(actor, p.organizationId, p.room, { id: uuidv7(), deviationId: p.deviationId }),
  ],
  ["fjern tiltak", (actor, p) => removeMeasure(actor, p.organizationId, p.room, p.measureId)],
  [
    "Godta",
    (actor, p) =>
      decideSuggestion(actor, p.organizationId, p.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
      }),
  ],
  [
    "Endre med begrunnelseskode",
    (actor, p) =>
      decideSuggestion(actor, p.organizationId, p.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "changed",
        chosenTg: "1",
        overrideReasonCode: "documentation_present",
      }),
  ],
  [
    "Avvis",
    (actor, p) =>
      decideSuggestion(actor, p.organizationId, p.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "rejected",
        overrideReasonCode: "visible_damage",
      }),
  ],
  [
    "TGIU",
    (actor, p) =>
      setTgDirect(actor, p.organizationId, p.room, {
        checkpointKey: CP.adjacent,
        tgDirect: "IU",
        base: null,
      }),
  ],
  [
    "TG direkte",
    (actor, p) =>
      setTgDirect(actor, p.organizationId, p.room, {
        checkpointKey: CP.general,
        tgDirect: "1",
        base: null,
      }),
  ],
  [
    "ferdig",
    (actor, p) =>
      setCheckpointDone(actor, p.organizationId, p.room, { checkpointKey: CP.general, done: true }),
  ],
  ["fjern avvik", (actor, p) => removeDeviation(actor, p.organizationId, p.room, p.deviationId)],
  [
    "Angre",
    (actor, p) => restoreDeviation(actor, p.organizationId, p.room, { deviationId: p.deviationId }),
  ],
];

type Case = { role: EmployeeRole; editAll: boolean; single: boolean; allowed: boolean };

const CASES: Case[] = [
  { role: "inspector", editAll: true, single: false, allowed: true },
  { role: "inspector", editAll: false, single: false, allowed: false },
  { role: "inspector", editAll: false, single: true, allowed: true },
  { role: "office", editAll: true, single: false, allowed: false },
  { role: "office", editAll: false, single: false, allowed: false },
  { role: "manager", editAll: true, single: false, allowed: true },
  { role: "manager", editAll: false, single: false, allowed: true },
  { role: "admin", editAll: true, single: false, allowed: true },
  { role: "admin", editAll: false, single: false, allowed: true },
];

describe("B5.1 tilgangsmatrisen", () => {
  const matrix = CASES.flatMap((c) => ACTIONS.map(([name, run]) => ({ ...c, name, run })));

  it.each(matrix)(
    "B5.1 $role, inspectors_edit_all $editAll, enkeltrettighet $single: $name (lov: $allowed)",
    async ({ role, editAll, single, allowed, run }) => {
      const p = await prepare();
      await setInspectorsEditAll(p.organizationId, editAll);
      const { actor, employee } = await createStaff(p.organizationId, [role]);
      if (single) await grantPermission(employee, "report.edit");
      if (allowed) {
        await expect(run(actor, p)).resolves.toBeDefined();
      } else {
        await expect(run(actor, p)).rejects.toBeInstanceOf(AccessDeniedError);
      }
      // Alle kan lese
      const view = await getRoomView(actor, p.organizationId, p.room);
      expect(view.state).toBe("started");
      if (view.state === "started") expect(view.canEdit).toBe(allowed);
    },
  );
});

describe("B5.2 admin stenges aldri ute", () => {
  it("B5.2 admin uten andre roller starter, godtar, endrer, avviser og merker ferdig når takstmenn er sperret", async () => {
    const f = await startedBathroom({ roles: ["admin"] });
    await setInspectorsEditAll(f.organizationId, false);
    const inspector = await createStaff(f.organizationId, ["inspector"]);
    const admin = await createStaff(f.organizationId, ["admin"]);
    await answerMembrane1990(f);

    await expect(
      decideSuggestion(inspector.actor, f.organizationId, f.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const other = await createRoomOnNewAssignment(f.organizationId);
    expect((await startReport(admin.actor, f.organizationId, other.assignmentId)).created).toBe(
      true,
    );
    for (const input of [
      {
        decision: "rejected" as const,
        overrideReasonCode: "other" as const,
        overrideReason: "Sjekket på stedet",
      },
      {
        decision: "changed" as const,
        chosenTg: "1" as const,
        overrideReasonCode: "measured_again" as const,
      },
      { decision: "accepted" as const },
    ]) {
      const result = await decideSuggestion(admin.actor, f.organizationId, f.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        ...input,
      });
      expect(result.status).toBe("saved");
    }
    const done = await setCheckpointDone(admin.actor, f.organizationId, f.room, {
      checkpointKey: CP.membrane,
      done: true,
    });
    expect(done.status).toBe("saved");
    const view = await getRoomView(admin.actor, f.organizationId, f.room);
    expect(view.state === "started" && view.canEdit).toBe(true);
  });
});

describe("B5.7 ingen nye rettigheter", () => {
  it("B5.7 listen i src/core/access er uendret, og report.read finnes ikke", () => {
    expect([...permissions]).toEqual([
      "organization.read",
      "organization.manage",
      "claims.read",
      "claims.manage",
      "staff.manage",
      "assignment.edit",
      "report.edit",
      "report.publish",
      "template.edit_structure",
      "invoice.send",
      "contacts.manage",
      "statistics.read",
    ]);
    expect(permissions as readonly string[]).not.toContain("report.read");
  });
});
