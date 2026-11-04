import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { db } from "@/db/client";
import { numberSequences, organizations } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import {
  createEmployee,
  createNumberSequence,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { nextAssignmentNumber } from "./number-sequence";

/*
 * Nummerserien for oppdrag (docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 2, med
 * runde 1 og 2: padding er minimum, lengre tidsgrense på samtidighet).
 *
 * Numre lages bare på serveren (D9). Én serie per organisasjon og år (A52), året i norsk tid.
 * `nextAssignmentNumber` tar `grant`, aldri en organisasjons-id.
 *
 * Støtter hovedmål: tid (nummeret kommer av seg selv) og reklamasjoner (aldri to oppdrag med
 * samme nummer, aldri et nummer fra en annen organisasjon).
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const TODAY = todayInOslo(NOW);

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const grant = await requireOrganizationAccess(admin, org.id, "assignment.edit");
  return { org, admin, grant };
}

function next(grant: EmployeeGrant, today = TODAY) {
  return db.transaction((tx) => nextAssignmentNumber(tx, grant, today));
}

async function sequencesFor(organizationId: string) {
  return db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.organizationId, organizationId));
}

describe("nextAssignmentNumber", () => {
  it("2.1 første nummer i året lager serien", async () => {
    const { org, grant } = await orgWithAdmin();
    expect(await sequencesFor(org.id)).toHaveLength(0);

    expect(await next(grant)).toBe("2026-00001");

    const rows = await sequencesFor(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      scope: "assignment",
      prefix: "2026-",
      nextValue: 2,
      padding: 5,
    });
  });

  it("2.2 neste nummer, og ti kall gir 00001–00010 i rekkefølge", async () => {
    const { grant } = await orgWithAdmin();
    const numbers: string[] = [];
    for (let i = 0; i < 10; i += 1) numbers.push(await next(grant));
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(5, "0")}`),
    );
  });

  it("2.3 formatet er ÅÅÅÅ-NNNNN, og padding er minimum: nummer 100 000 gir 2026-100000", async () => {
    const { org, grant } = await orgWithAdmin();
    const first = await next(grant);
    expect(first).toMatch(/^\d{4}-\d{5}$/);

    await db
      .update(numberSequences)
      .set({ nextValue: 100000 })
      .where(eq(numberSequences.organizationId, org.id));

    expect(await next(grant)).toBe("2026-100000");
  });

  it("2.4 året regnes i norsk tid: 31.12.2026 kl. 23:30 UTC gir 2027-00001, og 2026-serien står", async () => {
    const { org, grant } = await orgWithAdmin();
    await next(grant);
    await next(grant);

    const newYear = todayInOslo(new Date("2026-12-31T23:30:00Z"));
    expect(newYear.startsWith("2027-")).toBe(true);
    expect(await next(grant, newYear)).toBe("2027-00001");

    const rows = await sequencesFor(org.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.prefix === "2026-")?.nextValue).toBe(3);
    expect(rows.find((row) => row.prefix === "2027-")?.nextValue).toBe(2);
  });

  it("2.5 to organisasjoner får hver sin serie og begge 2026-00001", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");

    expect(await next(a.grant)).toBe("2026-00001");
    expect(await next(b.grant)).toBe("2026-00001");

    const rows = await db.select().from(numberSequences);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.organizationId))).toEqual(new Set([a.org.id, b.org.id]));
  });

  it(
    "2.6 20 samtidige kall gir nøyaktig 00001–00020, og next_value er 21 etterpå",
    { timeout: 30_000 },
    async () => {
      const { org, grant } = await orgWithAdmin();
      const numbers = await Promise.all(Array.from({ length: 20 }, () => next(grant)));

      expect(new Set(numbers).size).toBe(20);
      expect([...numbers].sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `2026-${String(i + 1).padStart(5, "0")}`),
      );
      const rows = await sequencesFor(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.nextValue).toBe(21);
    },
  );
});

/**
 * Innpakningen tenant-testen bruker (2.7): tilgangssjekk med `assignment.edit`, neste nummer i en
 * transaksjon, og seriens rader for `grant.organizationId`.
 */
async function nextNumberAndSequences(actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  await db.transaction((tx) => nextAssignmentNumber(tx, grant, TODAY));
  return db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.organizationId, grant.organizationId));
}

describe("number_sequences og andre organisasjoner", () => {
  it("2.7 A teller aldri opp serien til B", async () => {
    let seriesA = "";
    let seriesB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        seriesA = (await createNumberSequence(grantA.organizationId)).id;
        seriesB = (await createNumberSequence(grantB.organizationId)).id;
        return { a: [seriesA], b: [seriesB] };
      },
      query: nextNumberAndSequences,
      idOf: (row) => row.id,
    });

    // Hver serie er talt opp nøyaktig én gang, av sin egen organisasjon
    const rows = await db.select().from(numberSequences);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === seriesA)?.nextValue).toBe(2);
    expect(rows.find((row) => row.id === seriesB)?.nextValue).toBe(2);
  });

  it("2.8 takstmann med innstillingen av slipper ikke til, og serien er urørt", async () => {
    const org = await createOrganization();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    await createNumberSequence(org.id);
    const inspector = await createUser();
    await createEmployee(inspector, org.id, ["inspector"]);

    await expect(nextNumberAndSequences(inspector, org.id)).rejects.toThrow(AccessDeniedError);

    const [row] = await db
      .select()
      .from(numberSequences)
      .where(and(eq(numberSequences.organizationId, org.id), eq(numberSequences.prefix, "2026-")));
    expect(row?.nextValue).toBe(1);
  });

  it("2.8 nextAssignmentNumber tar executor, grant og dato, ingen organisasjons-id", () => {
    expect(nextAssignmentNumber.length).toBe(3);
  });
});
