import { and, eq, isNull } from "drizzle-orm";
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

  const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

  it("lager fire selskaper og fem kontorer, og ingen nye ved andre kjøring", async () => {
    await runSeed(env);
    await runSeed(env);
    const companyRows = await db.select().from(companies);
    const officeRows = await db.select().from(offices);
    expect(companyRows.map((row) => row.legalName).sort()).toEqual(
      ["Byggcon AS", "Byggcon Helgeland AS", "Byggcon Nord AS", "Byggcon Troms AS"].sort(),
    );
    expect(officeRows.map((row) => row.name).sort()).toEqual(
      ["Bodø", "Mo i Rana", "Mosjøen", "Narvik", "Tromsø"].sort(),
    );
  });

  it("fyller ikke ut org.nr., adresse, forsikring eller firmatekst", async () => {
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
    expect(await db.select().from(companies)).toHaveLength(4);
    const activeTroms = await db
      .select()
      .from(companies)
      .where(and(eq(companies.legalName, "Byggcon Troms AS"), isNull(companies.deletedAt)));
    expect(activeTroms).toHaveLength(0);
  });

  it("gir ikke admin selskap eller kontor", async () => {
    await runSeed(env);
    const rows = await db.select().from(employees);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: null, officeId: null });
  });
});
