import { eq } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, type EmployeeRole } from "@/db/schema";
import { applyTrialChanges } from "@/modules/offline-trial/server/apply-changes";
import type { TrialChangeOperation } from "@/modules/offline-trial/server/types";
import { uuidv7 } from "@/shared/lib/uuid";
import { createEmployee, createOrganization, createUser } from "./factories";

/**
 * Testhjelpere for prøven uten nett (trial_*-tabellene, oppgave 4). Ingen egne fabrikker med
 * `db.insert`: rader lages gjennom `applyTrialChanges`, så kontrakten testes samtidig
 * (docs/funksjoner/fase1-kandidat-powersync-testplan.md avsnitt 1). Alle data er oppdiktet.
 */

export const ALL_ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

/** En organisasjon med én ansatt i rollen. */
export async function setupOrganization(role: EmployeeRole = "admin", name = "Oppdiktet takst AS") {
  const organization = await createOrganization(name);
  const actor = await createUser({ name: `Oppdiktet ${role}` });
  const employee = await createEmployee(actor, organization.id, [role]);
  const grant = await requireOrganizationAccess(actor, organization.id);
  return { organization, organizationId: organization.id, actor, employee, grant };
}

/** En ansatt som har sluttet (deaktivert) i organisasjonen. */
export async function createDeactivatedEmployee(organizationId: string): Promise<Actor> {
  const actor = await createUser({ name: "Oppdiktet sluttet" });
  const employee = await createEmployee(actor, organizationId, ["inspector"]);
  await db
    .update(employees)
    .set({ deactivatedAt: new Date() })
    .where(eq(employees.id, employee.id));
  return actor;
}

export function formOp(
  id: string = uuidv7(),
  data: Record<string, unknown> = {},
  op: TrialChangeOperation["op"] = "PUT",
): TrialChangeOperation {
  return { op, table: "trial_forms", id, data: { name: "Testskjema 1", ...data } };
}

/** `value` sendes som JSON-tekst, slik den ligger i den lokale databasen. */
export function answerOp(
  trialFormId: string,
  fieldKey: string,
  value: unknown,
  extra: Record<string, unknown> = {},
  id: string = uuidv7(),
  op: TrialChangeOperation["op"] = "PUT",
): TrialChangeOperation {
  return {
    op,
    table: "trial_answers",
    id,
    data: {
      trial_form_id: trialFormId,
      field_key: fieldKey,
      value: JSON.stringify(value),
      text_state: null,
      device_id: "enhet-1",
      ...extra,
    },
  };
}

export function photoOp(
  trialFormId: string,
  fieldKey = "cover_photo",
  extra: Record<string, unknown> = {},
  id: string = uuidv7(),
  op: TrialChangeOperation["op"] = "PUT",
): TrialChangeOperation {
  return {
    op,
    table: "trial_photos",
    id,
    data: {
      trial_form_id: trialFormId,
      field_key: fieldKey,
      name: "test-image.png",
      size_bytes: 120,
      device_id: "enhet-1",
      ...extra,
    },
  };
}

/** Lager et testskjema i organisasjonen og returnerer id-en. */
export async function putTrialForm(actor: Actor, organizationId: string, name = "Testskjema 1") {
  const id = uuidv7();
  await applyTrialChanges(actor, organizationId, [formOp(id, { name })]);
  return id;
}
