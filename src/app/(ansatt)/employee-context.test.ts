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
  getActorForAction: vi.fn(async () => session.actor),
  LOGIN_PATH: "/logg-inn",
}));

const { getEmployeeContext, getEmployeeContextForAction } = await import("./employee-context");
const { requireActor } = await import("@/core/auth/session");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
  vi.clearAllMocks();
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
      canManageContacts: false,
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

  // «Nytt oppdrag» (docs/funksjoner/fase2a-nytt-oppdrag-testplan.md 1.4). Admin-raden skal aldri fjernes (regel 11).
  it.each([
    { roles: ["inspector"] as const, editAll: true, expected: true },
    { roles: ["inspector"] as const, editAll: false, expected: false },
    { roles: ["office"] as const, editAll: false, expected: true },
    { roles: ["manager"] as const, editAll: false, expected: true },
    { roles: ["admin"] as const, editAll: true, expected: true },
    { roles: ["admin"] as const, editAll: false, expected: true },
  ])(
    "canCreateAssignments for $roles med innstillingen $editAll er $expected",
    async ({ roles, editAll, expected }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const actor = await createUser();
      await createEmployee(actor, org.id, [...roles]);
      session.actor = actor;

      expect((await getEmployeeContext())?.canCreateAssignments).toBe(expected);
    },
  );

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

/*
 * Flagget for knappene «Fjern» og «Slå sammen med …» på /kontakter/[id] og /firma/[id]
 * (docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md 4.5). Regnes ut på serveren fra
 * rettigheten `contacts.manage`; selve sjekken skjer i kjernen. Støtter hovedmål: reklamasjoner
 * (takstmann og kontor ser ikke knappene, uansett innstillingen).
 */
describe("4.5 canManageContacts_per_role", () => {
  it.each([
    { role: "manager", inspectorsEditAll: false, expected: true },
    { role: "manager", inspectorsEditAll: true, expected: true },
    { role: "admin", inspectorsEditAll: false, expected: true },
    { role: "admin", inspectorsEditAll: true, expected: true },
    { role: "inspector", inspectorsEditAll: false, expected: false },
    { role: "inspector", inspectorsEditAll: true, expected: false },
    { role: "office", inspectorsEditAll: false, expected: false },
    { role: "office", inspectorsEditAll: true, expected: false },
  ] as const)(
    "$role med innstillingen $inspectorsEditAll gir canManageContacts = $expected",
    async ({ role, inspectorsEditAll, expected }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, inspectorsEditAll);
      const actor = await createUser();
      await createEmployee(actor, org.id, [role]);
      session.actor = actor;

      const context = await getEmployeeContext();
      expect(context?.organizationId).toBe(org.id);
      expect(context?.canManageContacts).toBe(expected);
    },
  );
});

/*
 * Rett T-0070 (docs/agenter/oppgaver/rett-t0070-t0071.md punkt 3, testplan 1d-2): konteksten for
 * serverhandlinger som tåler utløpt innlogging. Skiller «logget ut», «ingen tilgang» og «ok», og
 * videresender aldri. Organisasjonen kommer bare fra tilgangssjekken.
 */
describe("getEmployeeContextForAction", () => {
  it("uten økt: signed_out, uten videresending", async () => {
    await createOrganization();
    expect(await getEmployeeContextForAction()).toEqual({ status: "signed_out" });
    expect(requireActor).not.toHaveBeenCalled();
  });

  it("innlogget uten ansattrad: no_access", async () => {
    await createOrganization();
    session.actor = await createUser();
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
  });

  it("myk slettet ansattrad: no_access", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    session.actor = actor;
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
  });

  it("deaktivert ansatt: no_access", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    session.actor = actor;
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
  });

  it.each(["admin", "manager", "office", "inspector"] as const)(
    "%s: ok med samme kontekst som getEmployeeContext og organisasjonen fra tilgangssjekken",
    async (role) => {
      await createOrganization();
      const org = await createOrganization();
      const office = await createOffice(org.id);
      const actor = await createUser();
      await createEmployee(actor, org.id, [role], { officeId: office.id });
      session.actor = actor;

      const result = await getEmployeeContextForAction();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.context.organizationId).toBe(org.id);
      expect(result.context).toEqual(await getEmployeeContext());
    },
  );
});

describe("getEmployeeContext oppfører seg som før", () => {
  it("videresender (requireActor) uten økt", async () => {
    await expect(getEmployeeContext()).rejects.toThrow("ikke innlogget (test)");
    expect(requireActor).toHaveBeenCalled();
  });
});
