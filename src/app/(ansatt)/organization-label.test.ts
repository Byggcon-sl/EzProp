import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listOrganizationsForActor } from "@/core/access";
import { db } from "@/db/client";
import { employees, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { organizationLabel } from "./organization-label";

/*
 * «Du jobber for …» i rammen (grunnlayout Fjord).
 * Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 1 og 2.
 * Ingen ny spørring: layouten kaller organizationLabel(await listOrganizationsForActor(actor)).
 * Tenant-isolasjonen for listOrganizationsForActor står i src/core/access/guards.test.ts.
 * Støtter hovedmål: reklamasjoner (takstmannen ser alltid hvilken organisasjon han jobber for).
 */

describe("organizationLabel (ren funksjon)", () => {
  it("tom liste gir null", () => {
    expect(organizationLabel([])).toBeNull();
  });

  it("én organisasjon gir navnet uendret", () => {
    expect(organizationLabel([{ name: "Testfirma takst" }])).toBe("Testfirma takst");
  });

  it("to organisasjoner gir navnene med komma og mellomrom, i rekkefølgen de kommer inn", () => {
    expect(organizationLabel([{ name: "Testfirma takst" }, { name: "Annen org AS" }])).toBe(
      "Testfirma takst, Annen org AS",
    );
    expect(organizationLabel([{ name: "Annen org AS" }, { name: "Testfirma takst" }])).toBe(
      "Annen org AS, Testfirma takst",
    );
  });
});

describe("organizationLabel med listOrganizationsForActor (testdatabasen)", () => {
  beforeEach(resetDatabase);

  async function labelFor(actor: Awaited<ReturnType<typeof createUser>>) {
    return organizationLabel(await listOrganizationsForActor(actor));
  }

  it("egen organisasjon vises, ikke den andre", async () => {
    const own = await createOrganization("Testfirma takst");
    await createOrganization("Annen org AS");
    const user = await createUser();
    await createEmployee(user, own.id, ["inspector"]);

    const label = await labelFor(user);
    expect(label).toBe("Testfirma takst");
    expect(label).not.toContain("Annen org AS");
  });

  it("den andre organisasjonen ser bare sitt eget navn", async () => {
    await createOrganization("Testfirma takst");
    const other = await createOrganization("Annen org AS");
    const user = await createUser();
    await createEmployee(user, other.id, ["admin"]);

    const label = await labelFor(user);
    expect(label).toBe("Annen org AS");
    expect(label).not.toContain("Testfirma takst");
  });

  it("bruker uten ansattrad gir null", async () => {
    await createOrganization("Testfirma takst");
    const user = await createUser();
    expect(await labelFor(user)).toBeNull();
  });

  it("sluttet ansatt (deactivated_at) gir null", async () => {
    const org = await createOrganization("Testfirma takst");
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));

    expect(await labelFor(user)).toBeNull();
  });

  it("myk-slettet ansatt (deleted_at) gir null", async () => {
    const org = await createOrganization("Testfirma takst");
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));

    expect(await labelFor(user)).toBeNull();
  });

  it("sluttet i én organisasjon, aktiv i en annen: bare den aktive vises", async () => {
    const left = await createOrganization("Annen org AS");
    const active = await createOrganization("Testfirma takst");
    const user = await createUser();
    const old = await createEmployee(user, left.id, ["inspector"]);
    await createEmployee(user, active.id, ["inspector"]);
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, old.id));

    expect(await labelFor(user)).toBe("Testfirma takst");
  });

  it("ansatt i to organisasjoner gir begge navnene med komma", async () => {
    const a = await createOrganization("Testfirma takst");
    const b = await createOrganization("Annen org AS");
    const user = await createUser();
    await createEmployee(user, a.id, ["inspector"]);
    await createEmployee(user, b.id, ["office"]);

    // listOrganizationsForActor sorterer på navn
    expect(await labelFor(user)).toBe("Annen org AS, Testfirma takst");
  });

  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "rollen %s får eget navn (rammen er lik for alle, admin stenges ikke ute)",
    async (role) => {
      const org = await createOrganization("Testfirma takst");
      await createOrganization("Annen org AS");
      const user = await createUser();
      await createEmployee(user, org.id, [role]);

      expect(await labelFor(user)).toBe("Testfirma takst");
    },
  );
});
