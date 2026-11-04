import { asc, eq } from "drizzle-orm";
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
import { nextAssignmentNumber } from "./index";

/*
 * Nummerserien for oppdrag (testplan docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 2,
 * med runde 1 og 2). Alle kall skjer i en transaksjon med et `grant` fra
 * `requireOrganizationAccess(…, "assignment.edit")`, slik kjernen gjør det.
 * Støtter hovedmål: reklamasjoner (aldri to like numre, også ved samtidige kall og ved årsskiftet)
 * og tid (nummeret kommer fra serveren uten oppslag i et regneark).
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const TODAY = todayInOslo(NOW);
const NUMBER_FORMAT = /^\d{4}-\d{5}$/;

async function adminGrant(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const grant = await requireOrganizationAccess(admin, org.id, "assignment.edit");
  return { org, admin, grant };
}

function next(grant: EmployeeGrant, today = TODAY) {
  return db.transaction((tx) => nextAssignmentNumber(tx, grant, today));
}

async function sequences(organizationId: string) {
  return db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.organizationId, organizationId))
    .orderBy(asc(numberSequences.prefix));
}

describe("nextAssignmentNumber", () => {
  it("2.0 i dag er 03.11.2026 i Oslo med den faste tiden", () => {
    expect(TODAY).toBe("2026-11-03");
  });

  it("2.1 første nummer i året lager serien", async () => {
    const { org, grant } = await adminGrant();
    expect(await sequences(org.id)).toEqual([]);

    expect(await next(grant)).toBe("2026-00001");

    const rows = await sequences(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      scope: "assignment",
      prefix: "2026-",
      nextValue: 2,
      padding: 5,
    });
  });

  it("2.2 neste nummer: andre kall gir 00002, ti kall gir 00001–00010 i rekkefølge", async () => {
    const { org, grant } = await adminGrant();
    const numbers: string[] = [];
    for (let i = 0; i < 10; i += 1) numbers.push(await next(grant));

    expect(numbers[1]).toBe("2026-00002");
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(5, "0")}`),
    );
    expect((await sequences(org.id))[0]?.nextValue).toBe(11);
  });

  it("2.3 format ÅÅÅÅ-NNNNN; padding er minimum, så nummer 100 000 blir 2026-100000", async () => {
    const { org, grant } = await adminGrant();
    const first = await next(grant);
    expect(first).toMatch(NUMBER_FORMAT);

    // Satt direkte i testen (produktkoden skriver bare via nextAssignmentNumber)
    await db
      .update(numberSequences)
      .set({ nextValue: 100000 })
      .where(eq(numberSequences.organizationId, org.id));

    expect(await next(grant)).toBe("2026-100000");
    expect(await next(grant)).toBe("2026-100001");
  });

  it("2.3 en serie med padding 5 og next_value 1 laget av fabrikken gir 2026-00001", async () => {
    const { org, grant } = await adminGrant();
    await createNumberSequence(org.id);
    expect(await next(grant)).toBe("2026-00001");
    expect((await sequences(org.id))[0]?.nextValue).toBe(2);
  });

  it("2.4 året fra norsk tid: 31.12.2026 23:30 UTC er 2027 i Oslo og gir ny serie", async () => {
    const { org, grant } = await adminGrant();
    expect(await next(grant)).toBe("2026-00001");
    expect(await next(grant)).toBe("2026-00002");

    const newYear = todayInOslo(new Date("2026-12-31T23:30:00Z"));
    expect(newYear).toBe("2027-01-01");
    expect(await next(grant, newYear)).toBe("2027-00001");

    const rows = await sequences(org.id);
    expect(rows.map((row) => [row.prefix, row.nextValue])).toEqual([
      ["2026-", 3],
      ["2027-", 2],
    ]);
  });

  it("2.5 to organisasjoner får hver sin serie", async () => {
    const a = await adminGrant("Organisasjon A");
    const b = await adminGrant("Organisasjon B");

    expect(await next(a.grant)).toBe("2026-00001");
    expect(await next(b.grant)).toBe("2026-00001");
    expect(await next(a.grant)).toBe("2026-00002");

    const all = await db.select().from(numberSequences);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((row) => row.organizationId))).toEqual(new Set([a.org.id, b.org.id]));
    expect((await sequences(b.org.id))[0]?.nextValue).toBe(2);
  });

  it(
    "2.6 tjue samtidige kall gir nøyaktig 00001–00020, og next_value er 21",
    { timeout: 30_000 },
    async () => {
      const { org, grant } = await adminGrant();

      const numbers = await Promise.all(Array.from({ length: 20 }, () => next(grant)));

      expect(new Set(numbers).size).toBe(20);
      expect([...numbers].sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `2026-${String(i + 1).padStart(5, "0")}`),
      );
      expect((await sequences(org.id))[0]?.nextValue).toBe(21);
    },
  );

  it("2.7 tenant-isolasjon: A teller aldri opp serien til B", async () => {
    /**
     * Innpakning som en tjeneste i kjernen: tilgangen sjekkes først, så hentes neste nummer med
     * `grant`, og seriens rader leses for `grant.organizationId`.
     */
    async function nextNumberAndSequences(actor: Actor, organizationId: string) {
      const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
      await db.transaction((tx) => nextAssignmentNumber(tx, grant, TODAY));
      return sequences(grant.organizationId);
    }

    let seeded: { a: string; b: string; orgA: string; orgB: string } | undefined;
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createNumberSequence(grantA.organizationId);
        const b = await createNumberSequence(grantB.organizationId);
        seeded = { a: a.id, b: b.id, orgA: grantA.organizationId, orgB: grantB.organizationId };
        return { a: [a.id], b: [b.id] };
      },
      query: nextNumberAndSequences,
      idOf: (row) => row.id,
    });

    // Hver organisasjon talte bare sin egen serie én gang; de avviste kallene endret ingenting
    expect(seeded).toBeDefined();
    const [rowA] = await sequences(seeded!.orgA);
    const [rowB] = await sequences(seeded!.orgB);
    expect(rowA).toMatchObject({ id: seeded!.a, nextValue: 2 });
    expect(rowB).toMatchObject({ id: seeded!.b, nextValue: 2 });
    expect(await db.select().from(numberSequences)).toHaveLength(2);
  });

  it("2.8 takstmann med innstillingen av får aldri et grant med assignment.edit", async () => {
    const org = await createOrganization();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const inspector = await createUser();
    await createEmployee(inspector, org.id, ["inspector"]);

    await expect(requireOrganizationAccess(inspector, org.id, "assignment.edit")).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await sequences(org.id)).toEqual([]);
  });

  it("2.8 nextAssignmentNumber tar executor, grant og dato, aldri en organisasjons-id", () => {
    expect(nextAssignmentNumber.length).toBe(3);
  });
});
