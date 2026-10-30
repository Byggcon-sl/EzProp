import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { companies, employees, offices } from "@/db/schema";
import {
  createCompany,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

// Databasereglene for organisasjon → selskap → kontor → ansatt
// (docs/funksjoner/fase0b-organisasjon-selskap-kontor.md, punkt 4–6).

beforeEach(resetDatabase);

/**
 * Venter at databasen avviser med akkurat denne sjekken, indeksen eller fremmednøkkelen,
 * så testen ikke blir grønn av en annen feil.
 */
async function expectViolation(write: PromiseLike<unknown>, constraint: string) {
  const error: unknown = await Promise.resolve(write).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `forventet at ${constraint} avviste skrivingen`).toBeInstanceOf(Error);
  const cause = (error as { cause?: { constraint_name?: string } }).cause;
  expect(cause?.constraint_name).toBe(constraint);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { orgA, orgB };
}

describe("ansatt uten innlogging (D18)", () => {
  it("avviser tom user_id uten deactivated_at", async () => {
    const org = await createOrganization();
    await expectViolation(
      db.insert(employees).values({ organizationId: org.id, userId: null, name: "Ny Takstmann" }),
      "employees_user_or_deactivated_check",
    );
  });

  it("godtar tom user_id når deactivated_at er satt", async () => {
    const org = await createOrganization();
    const [row] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Takstmann",
        deactivatedAt: new Date(),
      })
      .returning();
    expect(row?.userId).toBeNull();
  });
});

describe("selskap og kontor må høre til samme organisasjon som den ansatte", () => {
  it("avviser innsetting med selskap fra en annen organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createCompany(orgB.id);
    await expectViolation(
      createEmployee(await createUser(), orgA.id, ["inspector"], { companyId: foreign.id }),
      "employees_company_fk",
    );
  });

  it("avviser oppdatering til selskap fra en annen organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createCompany(orgB.id);
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    await expectViolation(
      db.update(employees).set({ companyId: foreign.id }).where(eq(employees.id, employee.id)),
      "employees_company_fk",
    );
  });

  it("avviser innsetting med kontor fra en annen organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createOffice(orgB.id);
    await expectViolation(
      createEmployee(await createUser(), orgA.id, ["inspector"], { officeId: foreign.id }),
      "employees_office_fk",
    );
  });

  it("avviser oppdatering til kontor fra en annen organisasjon", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createOffice(orgB.id);
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    await expectViolation(
      db.update(employees).set({ officeId: foreign.id }).where(eq(employees.id, employee.id)),
      "employees_office_fk",
    );
  });

  it("godtar selskap og kontor fra egen organisasjon", async () => {
    const org = await createOrganization();
    const company = await createCompany(org.id);
    const office = await createOffice(org.id);
    const employee = await createEmployee(await createUser(), org.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });
    expect(employee).toMatchObject({ companyId: company.id, officeId: office.id });

    const other = await createEmployee(await createUser(), org.id, ["inspector"]);
    const [updated] = await db
      .update(employees)
      .set({ companyId: company.id, officeId: office.id })
      .where(eq(employees.id, other.id))
      .returning();
    expect(updated).toMatchObject({ companyId: company.id, officeId: office.id });
  });
});

describe("org.nr. er unikt per organisasjon blant aktive selskaper", () => {
  it("avviser to aktive selskaper med samme org.nr.", async () => {
    const org = await createOrganization();
    await createCompany(org.id, { orgNumber: "000000001" });
    await expectViolation(
      createCompany(org.id, { legalName: "Testselskap B AS", orgNumber: "000000001" }),
      "companies_organization_id_org_number_idx",
    );
  });

  it("er lov når det første selskapet er slettet", async () => {
    const org = await createOrganization();
    const first = await createCompany(org.id, { orgNumber: "000000001" });
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, first.id));
    const second = await createCompany(org.id, { orgNumber: "000000001" });
    expect(second.orgNumber).toBe("000000001");
  });

  it("er lov med samme org.nr. i to organisasjoner", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await createCompany(orgA.id, { orgNumber: "000000001" });
    const b = await createCompany(orgB.id, { orgNumber: "000000001" });
    expect(b.orgNumber).toBe("000000001");
  });
});

describe("kontornavn er unikt per organisasjon blant aktive kontorer", () => {
  it("avviser to aktive kontorer med samme navn", async () => {
    const org = await createOrganization();
    await createOffice(org.id, { name: "Testkontor Nord" });
    await expectViolation(
      createOffice(org.id, { name: "Testkontor Nord" }),
      "offices_organization_id_name_idx",
    );
  });

  it("er lov når det første kontoret er slettet", async () => {
    const org = await createOrganization();
    const first = await createOffice(org.id, { name: "Testkontor Nord" });
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, first.id));
    const second = await createOffice(org.id, { name: "Testkontor Nord" });
    expect(second.name).toBe("Testkontor Nord");
  });

  it("er lov med samme navn i to organisasjoner", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await createOffice(orgA.id, { name: "Testkontor Nord" });
    const b = await createOffice(orgB.id, { name: "Testkontor Nord" });
    expect(b.name).toBe("Testkontor Nord");
  });
});

describe("format på org.nr. (9 siffer når det er fylt ut)", () => {
  it.each(["12345678", "1234567890", "12345678A", "123 456 789"])(
    "avviser %j",
    async (orgNumber) => {
      const org = await createOrganization();
      await expectViolation(
        createCompany(org.id, { orgNumber }),
        "companies_org_number_format_check",
      );
    },
  );

  it.each([null, "000000001"])("godtar %j", async (orgNumber) => {
    const org = await createOrganization();
    const company = await createCompany(org.id, { orgNumber });
    expect(company.orgNumber).toBe(orgNumber);
  });
});

describe("standardverdier", () => {
  it("selskap er momsregistrert og kontor har rekkefølge 0 når ingenting er oppgitt", async () => {
    const org = await createOrganization();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, legalName: "Testselskap A AS" })
      .returning();
    const [office] = await db
      .insert(offices)
      .values({ organizationId: org.id, name: "Testkontor Nord" })
      .returning();
    expect(company?.vatRegistered).toBe(true);
    expect(office?.sortOrder).toBe(0);
  });
});
