import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, offices, organizations } from "@/db/schema";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";

/*
 * `getEmployeeContext()` for /ordre (testplan docs/funksjoner/fase2a-manuell-ordre-testplan.md
 * 7.6, runde 1 og 2). Bare innloggingen er byttet ut; `findEmployeeGrant` og tilgangslaget er
 * ekte og går mot testdatabasen. `canEditOrders` styrer bare om knappene vises; selve sjekken
 * skjer i kjernen. Testdata er oppdiktet.
 * Støtter hovedmål: tid (eget kontor er forhåndsvalgt) og reklamasjoner (organisasjonen kommer
 * alltid fra serveren).
 */

const mocks = vi.hoisted(() => ({ requireActor: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({ requireActor: mocks.requireActor }));

const { getEmployeeContext } = await import("./employee-context");

beforeEach(async () => {
  await resetDatabase();
  mocks.requireActor.mockReset();
});

function signedIn(actor: Actor) {
  mocks.requireActor.mockResolvedValue(actor);
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

describe("7.6 getEmployeeContext", () => {
  it("kontor med eget kontor: organisasjonen, canEditOrders og officeId", async () => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    const actor = await createUser({ name: "Kontor Testdatter" });
    await createEmployee(actor, org.id, ["office"], { officeId: office.id });
    signedIn(actor);

    expect(await getEmployeeContext()).toEqual({
      actor,
      organizationId: org.id,
      canEditOrders: true,
      officeId: office.id,
    });
  });

  it("takstmann med innstillingen av (uten assignment.edit) får canEditOrders = false", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["inspector"]);
    signedIn(actor);

    const context = await getEmployeeContext();
    expect(context?.organizationId).toBe(org.id);
    expect(context?.canEditOrders).toBe(false);
  });

  it("takstmann med innstillingen av og enkeltrettigheten assignment.edit får canEditOrders = true", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");
    signedIn(actor);

    expect((await getEmployeeContext())?.canEditOrders).toBe(true);
  });

  it("ansatt uten kontor gir officeId = null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    await createEmployee(actor, org.id, ["admin"]);
    signedIn(actor);

    const context = await getEmployeeContext();
    expect(context?.officeId).toBeNull();
    expect(context?.canEditOrders).toBe(true);
  });

  it("officeId er den ansattes eget kontor, ikke et annet kontor i organisasjonen", async () => {
    const org = await createOrganization();
    await createOffice(org.id);
    const own = await createOffice(org.id);
    const actor = await createUser();
    await createEmployee(actor, org.id, ["office"], { officeId: own.id });
    signedIn(actor);

    expect((await getEmployeeContext())?.officeId).toBe(own.id);
    expect((await db.select().from(offices)).length).toBe(2);
  });

  it("uten ansattrad gir null", async () => {
    await createOrganization();
    signedIn(await createUser());
    expect(await getEmployeeContext()).toBeNull();
  });

  it("deaktivert ansatt gir null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["office"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    signedIn(actor);
    expect(await getEmployeeContext()).toBeNull();
  });

  it("ansatt uten roller (ingen organization.read) gir null", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    await createEmployee(actor, org.id, []);
    signedIn(actor);
    expect(await getEmployeeContext()).toBeNull();
  });
});
