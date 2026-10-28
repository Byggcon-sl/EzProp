import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { employees, trialAnswers, trialForms, users } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createEmployee, createUser, resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  answerOp,
  createDeactivatedEmployee,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import { applyTrialChanges } from "./apply-changes";
import { listTrialAnswers, listTrialForms } from "./queries";

// Lesefunksjonene er tenant-isolasjonsbeviset for trial_*-tabellene (CLAUDE.md regel 2).
// Testplan avsnitt 3.1. Ingen side bruker dem.

beforeEach(resetDatabase);

/** Admin-innloggingen i grant-ens organisasjon (expectTenantIsolation bruker admin i begge). */
async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke den ansatte");
  return row;
}

describe("listTrialForms og listTrialAnswers", () => {
  it("listTrialForms gir aldri skjemaer fra en annen organisasjon (expectTenantIsolation)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await putTrialForm(await actorFor(grantA), grantA.organizationId, "Skjema A");
        const b = await putTrialForm(await actorFor(grantB), grantB.organizationId, "Skjema B");
        return { a: [a], b: [b] };
      },
      query: listTrialForms,
      idOf: (row) => row.id,
    });
  });

  it("listTrialAnswers gir aldri svar fra en annen organisasjon (expectTenantIsolation)", async () => {
    const formIds = new Map<string, string>();
    const formIdFor = (organizationId: string) => formIds.get(organizationId) ?? uuidv7();

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const actor = await actorFor(grant);
          const formId = await putTrialForm(actor, grant.organizationId);
          formIds.set(grant.organizationId, formId);
          const answerId = uuidv7();
          await applyTrialChanges(actor, grant.organizationId, [
            answerOp(formId, "floors", 2, {}, answerId),
          ]);
          ids[side].push(answerId);
        }
        return ids;
      },
      // Skjema-id-en følger organisasjonen det spørres mot, så steg 3 og 4 (fremmed
      // organisasjon) treffer tilgangssjekken og ikke bare en tom liste.
      query: (actor, organizationId) =>
        listTrialAnswers(actor, organizationId, formIdFor(organizationId)),
      idOf: (row) => row.id,
    });
  });

  it("listTrialAnswers med skjema-id fra en annen organisasjon gir tom liste, ikke fremmede rader", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const formB = await putTrialForm(b.actor, b.organizationId);
    await applyTrialChanges(b.actor, b.organizationId, [answerOp(formB, "floors", 3)]);

    expect(await listTrialAnswers(a.actor, a.organizationId, formB)).toEqual([]);
    // B ser fortsatt sine egne
    expect(await listTrialAnswers(b.actor, b.organizationId, formB)).toHaveLength(1);
  });

  it("listTrialForms og listTrialAnswers hopper over myk slettede rader", async () => {
    const { actor, organizationId } = await setupOrganization();
    const kept = await putTrialForm(actor, organizationId, "Beholdt");
    const removed = await putTrialForm(actor, organizationId, "Slettet");
    const keptAnswer = uuidv7();
    const removedAnswer = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      answerOp(kept, "floors", 2, {}, keptAnswer),
      answerOp(kept, "roof_tg", "TG2", {}, removedAnswer),
    ]);

    const now = new Date();
    await db
      .update(trialForms)
      .set({ deletedAt: now, deletedBy: actor.id })
      .where(eq(trialForms.id, removed));
    await db
      .update(trialAnswers)
      .set({ deletedAt: now, deletedBy: actor.id })
      .where(eq(trialAnswers.id, removedAnswer));

    expect((await listTrialForms(actor, organizationId)).map((row) => row.id)).toEqual([kept]);
    expect((await listTrialAnswers(actor, organizationId, kept)).map((row) => row.id)).toEqual([
      keptAnswer,
    ]);

    // Regel 3: radene finnes fortsatt i databasen
    expect(await db.select().from(trialForms).where(eq(trialForms.id, removed))).toHaveLength(1);
    expect(
      await db.select().from(trialAnswers).where(eq(trialAnswers.id, removedAnswer)),
    ).toHaveLength(1);
  });

  it("alle fire roller kan lese, deaktivert ansatt nektes", async () => {
    const owner = await setupOrganization("admin");
    const formId = await putTrialForm(owner.actor, owner.organizationId);
    await applyTrialChanges(owner.actor, owner.organizationId, [answerOp(formId, "floors", 1)]);

    for (const role of ALL_ROLES) {
      const actor = await createUser({ name: `Oppdiktet ${role}` });
      await createEmployee(actor, owner.organizationId, [role]);
      expect(
        (await listTrialForms(actor, owner.organizationId)).map((r) => r.id),
        role,
      ).toEqual([formId]);
      expect(await listTrialAnswers(actor, owner.organizationId, formId), role).toHaveLength(1);
    }

    const gone = await createDeactivatedEmployee(owner.organizationId);
    await expect(listTrialForms(gone, owner.organizationId)).rejects.toThrow(AccessDeniedError);
    await expect(listTrialAnswers(gone, owner.organizationId, formId)).rejects.toThrow(
      AccessDeniedError,
    );
  });
});
