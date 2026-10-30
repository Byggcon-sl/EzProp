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

// Databaseregler for organisasjon → selskap → kontor → ansatt.
// Testplan docs/funksjoner/fase0b-organisasjon-selskap-kontor-testplan.md avsnitt 2.
// Feilen sjekkes på SQLSTATE-koden, slik at testen ikke blir grønn av en annen feil:
// 23514 = sjekk, 23503 = fremmednøkkel, 23505 = unik.

beforeEach(resetDatabase);

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** Finner SQLSTATE-koden fra Postgres, også når feilen er pakket inn av Drizzle. */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectDbError(action: Promise<unknown>, sqlState: string) {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught, "databasen skulle avvist raden").toBeDefined();
  expect(sqlStateOf(caught)).toBe(sqlState);
}

async function twoOrganizations() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  return { orgA, orgB };
}

describe("ansatt som har sluttet uten innlogging (D18)", () => {
  it("avviser tom user_id uten deactivated_at", async () => {
    const org = await createOrganization();
    await expectDbError(
      db.insert(employees).values({ organizationId: org.id, userId: null, name: "Test Uten" }),
      CHECK_VIOLATION,
    );
  });

  it("godtar tom user_id med deactivated_at", async () => {
    const org = await createOrganization();
    const [row] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Test Sluttet",
        deactivatedAt: new Date(),
      })
      .returning();
    expect(row?.userId).toBeNull();
    expect(row?.deactivatedAt).toBeInstanceOf(Date);
  });

  it("avviser å fjerne innloggingen fra en aktiv ansatt", async () => {
    const org = await createOrganization();
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
    await expectDbError(
      db.update(employees).set({ userId: null }).where(eq(employees.id, employee.id)),
      CHECK_VIOLATION,
    );
  });
});

describe("selskap og kontor må høre til samme organisasjon som den ansatte", () => {
  it("avviser innsetting av ansatt i A med selskap fra B", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createCompany(orgB.id, { legalName: "Testselskap B AS" });
    await expectDbError(
      createEmployee(await createUser(), orgA.id, ["inspector"], { companyId: foreign.id }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("avviser oppdatering av ansatt i A til selskap fra B", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const own = await createCompany(orgA.id, { legalName: "Testselskap A AS" });
    const foreign = await createCompany(orgB.id, { legalName: "Testselskap B AS" });
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"], {
      companyId: own.id,
    });
    await expectDbError(
      db.update(employees).set({ companyId: foreign.id }).where(eq(employees.id, employee.id)),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("avviser innsetting av ansatt i A med kontor fra B", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const foreign = await createOffice(orgB.id, { name: "Testkontor Nord" });
    await expectDbError(
      createEmployee(await createUser(), orgA.id, ["inspector"], { officeId: foreign.id }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("avviser oppdatering av ansatt i A til kontor fra B", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const own = await createOffice(orgA.id, { name: "Testkontor Nord" });
    const foreign = await createOffice(orgB.id, { name: "Testkontor Nord" });
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"], {
      officeId: own.id,
    });
    await expectDbError(
      db.update(employees).set({ officeId: foreign.id }).where(eq(employees.id, employee.id)),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("avviser at den ansatte flyttes til en annen organisasjon med selskapet sitt", async () => {
    const { orgA, orgB } = await twoOrganizations();
    const own = await createCompany(orgA.id, { legalName: "Testselskap A AS" });
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"], {
      companyId: own.id,
    });
    await expectDbError(
      db.update(employees).set({ organizationId: orgB.id }).where(eq(employees.id, employee.id)),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("godtar selskap og kontor fra egen organisasjon", async () => {
    const { orgA } = await twoOrganizations();
    const company = await createCompany(orgA.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(orgA.id, { name: "Testkontor Nord" });
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });
    expect(employee.companyId).toBe(company.id);
    expect(employee.officeId).toBe(office.id);

    const otherCompany = await createCompany(orgA.id, { legalName: "Testselskap B AS" });
    const [updated] = await db
      .update(employees)
      .set({ companyId: otherCompany.id })
      .where(eq(employees.id, employee.id))
      .returning();
    expect(updated?.companyId).toBe(otherCompany.id);
  });

  it("dagens bruk av createEmployee uten selskap og kontor virker uendret", async () => {
    const org = await createOrganization();
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
    expect(employee.companyId).toBeNull();
    expect(employee.officeId).toBeNull();
  });
});

describe("org.nr. er unikt per organisasjon blant aktive selskaper", () => {
  it("avviser to aktive selskaper med samme org.nr. i samme organisasjon", async () => {
    const { orgA } = await twoOrganizations();
    await createCompany(orgA.id, { legalName: "Testselskap A AS", orgNumber: "000000001" });
    await expectDbError(
      createCompany(orgA.id, { legalName: "Testselskap B AS", orgNumber: "000000001" }),
      UNIQUE_VIOLATION,
    );
  });

  it("godtar samme org.nr. når det første selskapet er slettet", async () => {
    const { orgA } = await twoOrganizations();
    const first = await createCompany(orgA.id, {
      legalName: "Testselskap A AS",
      orgNumber: "000000001",
    });
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, first.id));
    const second = await createCompany(orgA.id, {
      legalName: "Testselskap B AS",
      orgNumber: "000000001",
    });
    expect(second.orgNumber).toBe("000000001");
  });

  it("godtar samme org.nr. i to organisasjoner", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await createCompany(orgA.id, { legalName: "Testselskap A AS", orgNumber: "000000002" });
    const b = await createCompany(orgB.id, {
      legalName: "Testselskap A AS",
      orgNumber: "000000002",
    });
    expect(b.organizationId).toBe(orgB.id);
  });

  it("godtar flere selskaper uten org.nr. i samme organisasjon", async () => {
    const { orgA } = await twoOrganizations();
    await createCompany(orgA.id, { legalName: "Testselskap A AS", orgNumber: null });
    const b = await createCompany(orgA.id, { legalName: "Testselskap B AS", orgNumber: null });
    expect(b.orgNumber).toBeNull();
  });
});

describe("kontornavn er unikt per organisasjon blant aktive kontorer", () => {
  it("avviser to aktive kontorer med samme navn i samme organisasjon", async () => {
    const { orgA } = await twoOrganizations();
    await createOffice(orgA.id, { name: "Testkontor Nord" });
    await expectDbError(createOffice(orgA.id, { name: "Testkontor Nord" }), UNIQUE_VIOLATION);
  });

  it("godtar samme navn når det første kontoret er slettet", async () => {
    const { orgA } = await twoOrganizations();
    const first = await createOffice(orgA.id, { name: "Testkontor Nord" });
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, first.id));
    const second = await createOffice(orgA.id, { name: "Testkontor Nord" });
    expect(second.id).not.toBe(first.id);
  });

  it("godtar samme navn i to organisasjoner", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await createOffice(orgA.id, { name: "Testkontor Nord" });
    const b = await createOffice(orgB.id, { name: "Testkontor Nord" });
    expect(b.organizationId).toBe(orgB.id);
  });
});

describe("format på org.nr. (regeltest som data)", () => {
  const rejected = ["12345678", "1234567890", "12345678A", "123 456 789"];
  const accepted = [null, "000000001"];

  it.each(rejected)("avviser %j", async (orgNumber) => {
    const org = await createOrganization();
    await expectDbError(
      createCompany(org.id, { legalName: "Testselskap A AS", orgNumber }),
      CHECK_VIOLATION,
    );
  });

  it.each(accepted)("godtar %j", async (orgNumber) => {
    const org = await createOrganization();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS", orgNumber });
    expect(company.orgNumber).toBe(orgNumber);
  });
});

describe("standardverdier", () => {
  it("vat_registered er true og sort_order er 0 når de ikke er oppgitt", async () => {
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

  it("selskapet kan lagres med bare navn; resten fylles ut av admin senere", async () => {
    const org = await createOrganization();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, legalName: "Testselskap A AS" })
      .returning();
    expect(company).toMatchObject({
      orgNumber: null,
      address: null,
      postalCode: null,
      city: null,
      companyText: null,
      liabilityInsurer: null,
      liabilityPolicyNumber: null,
      liabilityValidTo: null,
      deletedAt: null,
      rowVersion: 1,
    });
  });

  it("lagrer ansvarsforsikring og firmatekst per selskap", async () => {
    const org = await createOrganization();
    const company = await createCompany(org.id, {
      legalName: "Testselskap A AS",
      orgNumber: "000000003",
      companyText: "Oppdiktet firmatekst for test.",
      liabilityInsurer: "Testforsikring",
      liabilityPolicyNumber: "TEST-0001",
      liabilityValidTo: "2027-12-31",
    });
    const [row] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(row).toMatchObject({
      companyText: "Oppdiktet firmatekst for test.",
      liabilityInsurer: "Testforsikring",
      liabilityPolicyNumber: "TEST-0001",
    });
    // `liability_valid_to` er en dato (uten klokkeslett), lagret som tekst «ÅÅÅÅ-MM-DD»
    expect(row?.liabilityValidTo).toBe("2027-12-31");
  });
});
