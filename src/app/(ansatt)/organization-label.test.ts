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

// «Du jobber for …» i rammen (grunnlayout design A «Fjord»).
// Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 1 og 2.
// Ingen ny spørring: layouten kaller listOrganizationsForActor, som har tenant-testen sin i
// src/core/access/guards.test.ts. Derfor ingen ny expectTenantIsolation her.
// Støtter tid og reklamasjoner: takstmannen ser alltid hvilken organisasjon hen jobber for.

describe("organizationLabel (ren)", () => {
  it("tom liste gir null", () => {
    expect(organizationLabel([])).toBeNull();
  });

  it("én organisasjon gir navnet uendret", () => {
    expect(organizationLabel([{ name: "Testfirma takst" }])).toBe("Testfirma takst");
  });

  it("to organisasjoner gir navnene med komma og mellomrom i rekkefølgen de kommer", () => {
    expect(organizationLabel([{ name: "Testfirma takst" }, { name: "Annen org AS" }])).toBe(
      "Testfirma takst, Annen org AS",
    );
  });
});

describe("organizationLabel med listOrganizationsForActor (testdatabasen)", () => {
  beforeEach(resetDatabase);

  async function labelFor(user: Awaited<ReturnType<typeof createUser>>) {
    return organizationLabel(await listOrganizationsForActor(user));
  }

  it("viser egen organisasjon og ikke den andre", async () => {
    const own = await createOrganization("Testfirma takst");
    const other = await createOrganization("Annen org AS");
    const user = await createUser();
    await createEmployee(user, own.id, ["inspector"]);
    const stranger = await createUser();
    await createEmployee(stranger, other.id, ["admin"]);

    const label = await labelFor(user);
    expect(label).toBe("Testfirma takst");
    expect(label).not.toContain("Annen org AS");
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
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    expect(await labelFor(user)).toBeNull();
  });

  it("ansatt i to organisasjoner gir begge navnene med komma", async () => {
    const first = await createOrganization("Annen org AS");
    const second = await createOrganization("Testfirma takst");
    const user = await createUser();
    await createEmployee(user, first.id, ["inspector"]);
    await createEmployee(user, second.id, ["office"]);
    // listOrganizationsForActor sorterer på navn
    expect(await labelFor(user)).toBe("Annen org AS, Testfirma takst");
  });

  // Rammen er lik for alle roller; admin stenges ikke ute. Bare rollene som finnes på main.
  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "rollen %s ser eget organisasjonsnavn",
    async (role) => {
      const own = await createOrganization("Testfirma takst");
      await createOrganization("Annen org AS");
      const user = await createUser();
      await createEmployee(user, own.id, [role]);
      expect(await labelFor(user)).toBe("Testfirma takst");
    },
  );
});
