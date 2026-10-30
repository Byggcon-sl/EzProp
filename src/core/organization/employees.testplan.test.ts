import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { companies, employees, offices, type EmployeeRole } from "@/db/schema";
import {
  createCompany,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listEmployees } from "./index";

// Testplan docs/funksjoner/fase0b-organisasjon-selskap-kontor-testplan.md avsnitt 1.
// Oppdiktede navn. Ingen e-post eller innloggings-id i svaret.

beforeEach(resetDatabase);

const ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

/** En organisasjon med en leser (takstmann) som kaller spørringen. */
async function setup() {
  const org = await createOrganization();
  const reader = await createUser({ name: "Test Leser" });
  const readerEmployee = await createEmployee(reader, org.id, ["inspector"]);
  return { org, reader, readerEmployee };
}

describe("listEmployees", () => {
  it("viser aldri ansatte fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const company = await createCompany(grant.organizationId, {
            legalName: "Testselskap A AS",
          });
          const office = await createOffice(grant.organizationId, { name: "Testkontor Nord" });
          const person = await createUser({ name: `Test Takstmann ${side}` });
          const employee = await createEmployee(person, grant.organizationId, ["inspector"], {
            companyId: company.id,
            officeId: office.id,
          });
          ids[side].push(employee.id);
        }
        return ids;
      },
      query: (actor, organizationId) => listEmployees(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it.each(ROLES)("rollen %s kan lese de ansatte", async (role) => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, [role]);

    const rows = await listEmployees(user, org.id);
    expect(rows.map((row) => row.id)).toContain(employee.id);
  });

  it("en ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, []);

    await expect(listEmployees(user, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(listEmployees(user, org.id, { includeDeactivated: true })).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("gir nøyaktig de lovede feltene, ingen e-post eller innloggings-id", async () => {
    const { org, reader } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(org.id, { name: "Testkontor Nord" });
    const person = await createUser({ name: "Test Takstmann" });
    await createEmployee(person, org.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });

    for (const options of [undefined, { includeDeactivated: true }]) {
      const rows = await listEmployees(reader, org.id, options);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          "companyName",
          "deactivatedAt",
          "id",
          "jobTitle",
          "name",
          "officeName",
        ]);
      }
    }
  });

  it("viser selskaps- og kontornavn, og null for en ansatt uten selskap og kontor", async () => {
    const { org, reader, readerEmployee } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(org.id, { name: "Testkontor Nord" });
    const person = await createUser({ name: "Test Takstmann" });
    const placed = await createEmployee(person, org.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });

    const rows = await listEmployees(reader, org.id);
    expect(rows.find((row) => row.id === placed.id)).toMatchObject({
      name: "Test Takstmann",
      companyName: "Testselskap A AS",
      officeName: "Testkontor Nord",
      deactivatedAt: null,
    });
    expect(rows.find((row) => row.id === readerEmployee.id)).toMatchObject({
      companyName: null,
      officeName: null,
    });
  });

  it("viser ikke slettede ansatte, heller ikke med includeDeactivated", async () => {
    const { org, reader, readerEmployee } = await setup();
    const removedUser = await createUser({ name: "Test Fjernet" });
    const removed = await createEmployee(removedUser, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, removed.id));
    // Slettet og sluttet uten innlogging
    const [removedGone] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Test Fjernet Sluttet",
        deactivatedAt: new Date(),
        deletedAt: new Date(),
      })
      .returning();

    for (const options of [undefined, { includeDeactivated: true }]) {
      const ids = (await listEmployees(reader, org.id, options)).map((row) => row.id);
      expect(ids).toEqual([readerEmployee.id]);
      expect(ids).not.toContain(removed.id);
      expect(ids).not.toContain(removedGone!.id);
    }
  });

  it("slettet selskap gir tomt selskapsnavn, slettet kontor gir tomt kontornavn", async () => {
    const { org, reader } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(org.id, { name: "Testkontor Nord" });
    const otherCompany = await createCompany(org.id, { legalName: "Testselskap B AS" });
    const otherOffice = await createOffice(org.id, { name: "Testkontor Sør" });
    const first = await createEmployee(
      await createUser({ name: "Test En" }),
      org.id,
      ["inspector"],
      {
        companyId: company.id,
        officeId: otherOffice.id,
      },
    );
    const second = await createEmployee(
      await createUser({ name: "Test To" }),
      org.id,
      ["inspector"],
      { companyId: otherCompany.id, officeId: office.id },
    );
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, company.id));
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, office.id));

    const rows = await listEmployees(reader, org.id);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      companyName: null,
      officeName: "Testkontor Sør",
    });
    expect(rows.find((row) => row.id === second.id)).toMatchObject({
      companyName: "Testselskap B AS",
      officeName: null,
    });
  });

  it("viser bare aktive som standard, og også de som har sluttet med includeDeactivated", async () => {
    const { org, reader, readerEmployee } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const goneWithLogin = await createEmployee(
      await createUser({ name: "Test Sluttet Med Innlogging" }),
      org.id,
      ["inspector"],
    );
    const goneAt = new Date("2026-09-01T08:00:00Z");
    await db
      .update(employees)
      .set({ deactivatedAt: goneAt })
      .where(eq(employees.id, goneWithLogin.id));
    // D18: sluttet og står uten innlogging, men står fortsatt på gamle rapporter
    const [goneWithoutLogin] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Test Sluttet Uten Innlogging",
        companyId: company.id,
        deactivatedAt: goneAt,
      })
      .returning();

    const active = await listEmployees(reader, org.id);
    expect(active.map((row) => row.id)).toEqual([readerEmployee.id]);

    const explicitlyActive = await listEmployees(reader, org.id, { includeDeactivated: false });
    expect(explicitlyActive.map((row) => row.id)).toEqual([readerEmployee.id]);

    const all = await listEmployees(reader, org.id, { includeDeactivated: true });
    expect(all.map((row) => row.id).sort()).toEqual(
      [readerEmployee.id, goneWithLogin.id, goneWithoutLogin!.id].sort(),
    );
    expect(all.find((row) => row.id === goneWithoutLogin!.id)).toMatchObject({
      name: "Test Sluttet Uten Innlogging",
      companyName: "Testselskap A AS",
      deactivatedAt: goneAt,
    });
  });
});
