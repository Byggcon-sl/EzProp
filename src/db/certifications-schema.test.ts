import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { certifications } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../tests/factories";

/*
 * Databasen selv avviser ugyldige sertifiseringer (testplan
 * docs/funksjoner/fase0b-sertifisering-testplan.md, del 6). Direkte innsetting med SQL, utenom
 * kjernen, slik at det er skranken i databasen som prøves. Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const inA = await createEmployee(await createUser({ name: "Kari Testdatter" }), orgA.id, [
    "inspector",
  ]);
  const inB = await createEmployee(await createUser({ name: "Ola Testsen" }), orgB.id, [
    "inspector",
  ]);
  return { orgA, orgB, inA, inB };
}

async function rowCount() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(certifications);
  return row?.n ?? 0;
}

describe("certifications i databasen", () => {
  it("1. ansatt fra en annen organisasjon avvises (sammensatt fremmednøkkel)", async () => {
    const { orgA, inB } = await setup();
    await expect(
      db.execute(sql`
        insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
        values (${orgA.id}, ${inB.id}, 'condition_report', '2026-01-01', '2027-01-01')`),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it("2. gyldig fra etter gyldig til avvises (CHECK)", async () => {
    const { orgA, inA } = await setup();
    await expect(
      db.execute(sql`
        insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
        values (${orgA.id}, ${inA.id}, 'condition_report', '2027-01-02', '2027-01-01')`),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it("3. gyldig til mangler avvises (NOT NULL)", async () => {
    const { orgA, inA } = await setup();
    await expect(
      db.execute(sql`
        insert into certifications (organization_id, employee_id, area, valid_from)
        values (${orgA.id}, ${inA.id}, 'condition_report', '2026-01-01')`),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it("4. gyldig fra tom godtas", async () => {
    const { orgA, inA } = await setup();
    await db.execute(sql`
      insert into certifications (organization_id, employee_id, area, valid_to)
      values (${orgA.id}, ${inA.id}, 'condition_report', '2027-01-01')`);
    const rows = await db.select().from(certifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.validFrom).toBeNull();
    expect(rows[0]?.validTo).toBe("2027-01-01");
  });
});
