import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { companies, employees, offices, organizations, users } from "@/db/schema";
import { resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe("seed", () => {
  it("lager Byggcon og admin, og kan kjøres to ganger uten duplikater", async () => {
    const env = { SEED_ADMIN_EMAIL: "Admin@Example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    await runSeed(env);
    const orgs = await db.select().from(organizations);
    const people = await db.select().from(users);
    expect(orgs).toHaveLength(1);
    expect(people).toHaveLength(1);
    const admin = people[0]!;
    const grant = await requireOrganizationAccess(
      { id: admin.id, email: admin.email, name: admin.name },
      orgs[0]!.id,
      "organization.manage",
    );
    expect(grant.roles).toEqual(["admin"]);
  });

  it("skriver aldri e-postadressen i loggen", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { SEED_ADMIN_EMAIL: "Admin@Example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    const firstRun = log.mock.calls.map((args) => args.map(String).join(" "));
    log.mockClear();
    await runSeed(env);
    const secondRun = log.mock.calls.map((args) => args.map(String).join(" "));
    for (const line of [...firstRun, ...secondRun]) expect(line).not.toContain("@");
    expect(firstRun.some((line) => line.includes("opprettet"))).toBe(true);
    expect(secondRun.some((line) => line.includes("finnes fra før"))).toBe(true);
  });
});

// Selskaper og kontorer (fase 0b). Testplan
// docs/funksjoner/fase0b-organisasjon-selskap-kontor-testplan.md avsnitt 3. Navnene fra
// docs/05-domenemodell.md 4.1. Org.nr., adresse, forsikring og firmatekst fylles ut av admin (A16).
describe("seed av selskaper og kontorer", () => {
  const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
  const COMPANY_NAMES = [
    "Byggcon AS",
    "Byggcon Helgeland AS",
    "Byggcon Nord AS",
    "Byggcon Troms AS",
  ];
  const OFFICE_NAMES = ["Bodø", "Mo i Rana", "Mosjøen", "Narvik", "Tromsø"];

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("gir fire selskaper og fem kontorer, og en kjøring til gir ingen nye rader", async () => {
    await runSeed(env);
    const [organization] = await db.select().from(organizations);
    const firstCompanies = await db.select().from(companies);
    const firstOffices = await db.select().from(offices);
    expect(firstCompanies.map((row) => row.legalName).sort()).toEqual(COMPANY_NAMES);
    expect(firstOffices.map((row) => row.name).sort()).toEqual(OFFICE_NAMES);
    for (const row of [...firstCompanies, ...firstOffices]) {
      expect(row.organizationId).toBe(organization!.id);
      expect(row.deletedAt).toBeNull();
    }

    await runSeed(env);
    const secondCompanies = await db.select().from(companies);
    const secondOffices = await db.select().from(offices);
    expect(secondCompanies.map((row) => row.id).sort()).toEqual(
      firstCompanies.map((row) => row.id).sort(),
    );
    expect(secondOffices.map((row) => row.id).sort()).toEqual(
      firstOffices.map((row) => row.id).sort(),
    );
  });

  it("fyller ikke ut org.nr., adresse, forsikring eller firmatekst (A16)", async () => {
    await runSeed(env);
    for (const row of await db.select().from(companies)) {
      expect(row).toMatchObject({
        orgNumber: null,
        address: null,
        postalCode: null,
        city: null,
        companyText: null,
        liabilityInsurer: null,
        liabilityPolicyNumber: null,
        liabilityValidTo: null,
      });
    }
    for (const row of await db.select().from(offices)) {
      expect(row.address).toBeNull();
    }
  });

  it("lager ikke et slettet selskap på nytt", async () => {
    await runSeed(env);
    await db
      .update(companies)
      .set({ deletedAt: new Date() })
      .where(eq(companies.legalName, "Byggcon Troms AS"));

    await runSeed(env);
    const rows = await db.select().from(companies);
    expect(rows).toHaveLength(4);
    const troms = rows.filter((row) => row.legalName === "Byggcon Troms AS");
    expect(troms).toHaveLength(1);
    expect(troms[0]!.deletedAt).not.toBeNull();
  });

  it("gir ikke admin selskap eller kontor", async () => {
    await runSeed(env);
    await runSeed(env);
    const rows = await db.select().from(employees);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyId).toBeNull();
    expect(rows[0]!.officeId).toBeNull();
  });
});
