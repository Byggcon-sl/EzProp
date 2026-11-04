import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, organizations } from "@/db/schema";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Konteksten sidene og handlingene i /ordre bruker (docs/funksjoner/fase2a-manuell-ordre-testplan.md
 * 7.6, utvidet i runde 2 med `officeId`). Mot testdatabasen; bare innloggingen er byttet ut.
 * `canEditOrders` brukes bare til å vise knappene; selve sjekken skjer i kjernen.
 * Støtter hovedmål: reklamasjoner (organisasjonen kommer alltid fra serveren).
 */

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({
  requireActor: vi.fn(async () => {
    if (!session.actor) throw new Error("ikke innlogget (test)");
    return session.actor;
  }),
  getCurrentActor: vi.fn(async () => session.actor),
  LOGIN_PATH: "/logg-inn",
}));

const { getEmployeeContext } = await import("./employee-context");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

describe("getEmployeeContext", () => {
  it("kontoransatt med kontor gir organisasjonen, canEditOrders og kontoret", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["office"], { officeId: office.id });
    session.actor = actor;

    const context = await getEmployeeContext();
    expect(context).toMatchObject({
      organizationId: org.id,
      canEditOrders: true,
      officeId: office.id,
    });
    expect(context?.actor.id).toBe(actor.id);
  });

  it("ansatt uten kontor gir officeId = null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    await createEmployee(actor, org.id, ["admin"]);
    session.actor = actor;

    const context = await getEmployeeContext();
    expect(context?.officeId).toBeNull();
    expect(context?.canEditOrders).toBe(true);
  });

  it("takstmann med innstillingen av (uten assignment.edit) gir canEditOrders = false", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["inspector"]);
    session.actor = actor;

    const context = await getEmployeeContext();
    expect(context?.organizationId).toBe(org.id);
    expect(context?.canEditOrders).toBe(false);
  });

  it("takstmann med innstillingen på gir canEditOrders = true", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, true);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["inspector"]);
    session.actor = actor;

    expect((await getEmployeeContext())?.canEditOrders).toBe(true);
  });

  // Regel 11: admin stenges aldri ute
  it("admin med innstillingen av har canEditOrders = true", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["admin"]);
    session.actor = actor;

    expect((await getEmployeeContext())?.canEditOrders).toBe(true);
  });

  it("bruker uten ansattrad gir null", async () => {
    await createOrganization();
    session.actor = await createUser();
    expect(await getEmployeeContext()).toBeNull();
  });

  it("deaktivert ansatt gir null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["admin"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    session.actor = actor;

    expect(await getEmployeeContext()).toBeNull();
  });

  it("ansatt uten roller (ingen organization.read) gir null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    await createEmployee(actor, org.id, []);
    session.actor = actor;

    expect(await getEmployeeContext()).toBeNull();
  });
});
