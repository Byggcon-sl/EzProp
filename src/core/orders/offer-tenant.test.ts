import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { findPossibleDuplicatesFor } from "@/core/assignments";
import { db } from "@/db/client";
import { employees, orders, organizations, users, type EmployeeRole } from "@/db/schema";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import {
  TEST_NOW,
  createAssignment,
  createEmployee,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { OFFER_LIST_FILTERS, type OfferListFilter } from "./codes";
import { OFFER_VALID_DAYS } from "./contract";
import {
  convertOrderToAssignment,
  createOrder,
  findPossibleDuplicateOrders,
  getOrder,
  listOrders,
  rejectOrder,
  updateOrder,
} from "./index";

/*
 * Tilgang og tenant-isolasjon for tilbud (regel 2; testplan 3.9, 3.10, 7.1.6, 7.2.7 og 7.3.6).
 * Alle spørringene filtrerer på `grant.organizationId`. Fast tid: TEST_NOW (03.11.2026).
 * Oppdiktede adresser. Samme adresse i A og B, så en lekkasje i dublettvarselet ville synes.
 *
 * Støtter hovedmål: de ansatte (alle roller som skal, får jobbe med tilbud, også admin uten
 * kontor) og færre reklamasjoner (ingen ser eller endrer en annen organisasjons tilbud).
 */

beforeEach(resetDatabase);

const ADDRESS = "Felles gate 1, 8000 Bodø";
const TODAY = "2026-11-03";

/** Et tilbud i riktig visningsstatus, laget med fabrikkene. */
async function offerIn(organizationId: string, filter: OfferListFilter) {
  switch (filter) {
    case "open":
    case "all":
      return insertOrder(organizationId, { addressText: ADDRESS, validUntil: "2026-11-20" });
    case "expired":
      return insertOrder(organizationId, { addressText: ADDRESS, validUntil: "2026-10-20" });
    case "rejected":
      return insertOrder(organizationId, {
        addressText: ADDRESS,
        status: "rejected",
        rejectedReasonKey: "price",
      });
    case "converted": {
      const order = await insertOrder(organizationId, { addressText: ADDRESS });
      const assignment = await createAssignment(organizationId, { orderId: order.id });
      const [converted] = await db
        .update(orders)
        .set({ status: "converted", assignmentId: assignment.id })
        .where(eq(orders.id, order.id))
        .returning();
      return converted!;
    }
  }
}

/** Brukeren bak tilgangen (admin fra `expectTenantIsolation`). */
async function actorOf(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke brukeren");
  return row;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Tilbud per organisasjon, slik at tjenestene kan kalles med egen id. */
function perOrganization() {
  const ids = new Map<string, string>();
  return {
    set: (grant: EmployeeGrant, id: string) => ids.set(grant.organizationId, id),
    get: (organizationId: string) => ids.get(organizationId) ?? randomUUID(),
  };
}

describe("3.10 tenant-isolasjon", () => {
  it.each([...OFFER_LIST_FILTERS])("3.10.1 listOrders med filteret %s", async (filter) => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await offerIn(grantA.organizationId, filter);
        const b = await offerIn(grantB.organizationId, filter);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) =>
        (await listOrders(actor, organizationId, { status: filter, now: TEST_NOW })).items,
      idOf: (row) => row.id,
    });
  });

  it("7.3.6 tellingen per filter tar bare med egen organisasjon", async () => {
    const counted = new Map<string, Record<OfferListFilter, number>>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = [await offerIn(grantA.organizationId, "open")];
        const b = [];
        for (const filter of ["open", "open", "expired", "rejected", "converted"] as const) {
          b.push(await offerIn(grantB.organizationId, filter));
        }
        return { a: a.map((row) => row.id), b: b.map((row) => row.id) };
      },
      query: async (actor, organizationId) => {
        const result = await listOrders(actor, organizationId, {
          status: "all",
          query: "Felles",
          now: TEST_NOW,
        });
        counted.set(organizationId, result.counts);
        return result.items;
      },
      idOf: (row) => row.id,
    });
    const [countsA, countsB] = [...counted.values()];
    expect(countsA).toEqual({ open: 1, expired: 0, rejected: 0, converted: 0, all: 1 });
    expect(countsB).toEqual({ open: 2, expired: 1, rejected: 1, converted: 1, all: 5 });
  });

  it("3.10.2 getOrder", async () => {
    const offers = perOrganization();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await offerIn(grantA.organizationId, "expired");
        const b = await offerIn(grantB.organizationId, "expired");
        offers.set(grantA, a.id);
        offers.set(grantB, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await getOrder(actor, organizationId, offers.get(organizationId), TEST_NOW),
      ],
      idOf: (row) => row.id,
    });
  });

  it("3.10.3 og 7.1.6 updateOrder med ny «Gyldig til» (også «Forleng 30 dager»)", async () => {
    const offers = perOrganization();
    const extended = addDays(todayInOslo(TEST_NOW), OFFER_VALID_DAYS);
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await offerIn(grantA.organizationId, "expired");
        const b = await offerIn(grantB.organizationId, "expired");
        offers.set(grantA, a.id);
        offers.set(grantB, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await updateOrder(
          actor,
          organizationId,
          offers.get(organizationId),
          { addressText: ADDRESS, validUntil: extended },
          1,
          TEST_NOW,
        ),
      ],
      idOf: (row) => row.id,
    });
    const rows = await db.select().from(orders);
    expect(rows.map((row) => row.validUntil)).toEqual([extended, extended]);
  });

  it("3.10.4 convertOrderToAssignment", async () => {
    const offers = perOrganization();
    const officeFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const offer = await offerIn(grant.organizationId, "expired");
          officeFor.set(grant.organizationId, (await createOffice(grant.organizationId)).id);
          offers.set(grant, offer.id);
          result[key].push(offer.id);
        }
        return result;
      },
      query: async (actor, organizationId) => [
        (
          await convertOrderToAssignment(actor, organizationId, offers.get(organizationId), {
            officeId: officeFor.get(organizationId) ?? randomUUID(),
            now: TEST_NOW,
          })
        ).order,
      ],
      idOf: (row) => row.id,
    });
  });

  it("3.10.5 rejectOrder med fast grunn", async () => {
    const offers = perOrganization();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await offerIn(grantA.organizationId, "open");
        const b = await offerIn(grantB.organizationId, "open");
        offers.set(grantA, a.id);
        offers.set(grantB, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await rejectOrder(actor, organizationId, offers.get(organizationId), {
          reasonKey: "customer_withdrew",
        }),
      ],
      idOf: (row) => row.id,
    });
  });

  it("3.10.6 dublettvarselet på tilbudet: utløpte tilbud med samme adresse i A og B", async () => {
    const offers = perOrganization();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const self = await insertOrder(grant.organizationId, { addressText: ADDRESS });
          const expired = await insertOrder(grant.organizationId, {
            addressText: ADDRESS,
            validUntil: "2026-10-20",
            receivedAt: new Date("2026-10-01T10:00:00Z"),
          });
          offers.set(grant, self.id);
          result[key].push(expired.id);
        }
        return result;
      },
      query: async (actor, organizationId) =>
        (
          await findPossibleDuplicateOrders(
            actor,
            organizationId,
            offers.get(organizationId),
            TEST_NOW,
          )
        ).items,
      idOf: (row) => row.id,
    });
  });

  it("3.10.6 og 7.2.7 dublettvarselet på «Nytt oppdrag»: treff har displayStatus, aldri fra B", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await offerIn(grantA.organizationId, "expired");
        const b = await offerIn(grantB.organizationId, "open");
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const { items } = await findPossibleDuplicatesFor(
          actor,
          organizationId,
          { addressText: ADDRESS, gnr: null, bnr: null, snr: null, receivedAt: TEST_NOW },
          TEST_NOW,
        );
        for (const item of items) {
          expect(item.kind).toBe("order");
          expect(["open", "expired"]).toContain(item.displayStatus);
        }
        return items;
      },
      idOf: (row) => row.id,
    });
  });

  it("3.10.7 IDOR: tilbud-id fra B med egen organisasjon gir AccessDeniedError, og B er urørt", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminA = await createUser({ name: "Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    const officeA = await createOffice(orgA.id);
    const offerB = await offerIn(orgB.id, "expired");

    const attempts = [
      () => getOrder(adminA, orgA.id, offerB.id, TEST_NOW),
      () =>
        updateOrder(
          adminA,
          orgA.id,
          offerB.id,
          { addressText: ADDRESS, validUntil: "2026-12-01" },
          offerB.rowVersion,
          TEST_NOW,
        ),
      () =>
        convertOrderToAssignment(adminA, orgA.id, offerB.id, {
          officeId: officeA.id,
          now: TEST_NOW,
        }),
      () => rejectOrder(adminA, orgA.id, offerB.id, { reasonKey: "price" }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow(AccessDeniedError);
    const [after] = await db.select().from(orders).where(eq(orders.id, offerB.id));
    expect(after).toMatchObject({
      status: "received",
      rowVersion: offerB.rowVersion,
      validUntil: "2026-10-20",
    });
  });

  it("3.10.8 feil organisasjon i argumentet gir AccessDeniedError", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminA = await createUser({ name: "Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    const offerB = await offerIn(orgB.id, "open");
    await expect(listOrders(adminA, orgB.id, { status: "all" })).rejects.toThrow(AccessDeniedError);
    await expect(getOrder(adminA, orgB.id, offerB.id)).rejects.toThrow(AccessDeniedError);
    await expect(createOrder(adminA, orgB.id, { addressText: ADDRESS }, TEST_NOW)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("3.10.9 og F2 a: organizationId i skjemadataene blir ignorert ved createOrder", async () => {
    const created = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant, other] of [
          ["a", grantA, grantB],
          ["b", grantB, grantA],
        ] as const) {
          const form = {
            addressText: ADDRESS,
            organizationId: other.organizationId,
            // Felt som bare gjelder oppdraget, tas bort av skjemaet (F2 a)
            responsibleEmployeeId: randomUUID(),
            inspectionAt: "2026-11-10T10:00",
            officeId: randomUUID(),
          } as Parameters<typeof createOrder>[2];
          const actor = await actorOf(grant);
          const offer = await createOrder(actor, grant.organizationId, form, TEST_NOW);
          created.set(grant.organizationId, offer.id);
          result[key].push(offer.id);
        }
        return result;
      },
      query: async (actor, organizationId) =>
        (await listOrders(actor, organizationId, { status: "all", now: TEST_NOW })).items,
      idOf: (row) => row.id,
    });
    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(created.get(row.organizationId)).toBe(row.id);
      expect(row.validUntil).toBe("2026-12-03");
      expect(row.assignmentId).toBeNull();
    }
  });
});

describe("3.9 tilgang per rolle", () => {
  const ROLES: EmployeeRole[][] = [["inspector"], ["office"], ["manager"], ["admin"]];

  async function orgWith(roles: EmployeeRole[]) {
    const org = await createOrganization("Oppdiktet Takst");
    await setInspectorsEditAll(org.id, true);
    const office = await createOffice(org.id);
    const user = await createUser();
    await createEmployee(user, org.id, roles);
    return { org, office, user };
  }

  it.each(ROLES)("3.9.1 %s kan lese, lage, endre, forlenge, gjøre om og avslå", async (role) => {
    const { org, office, user } = await orgWith([role]);
    const created = await createOrder(user, org.id, { addressText: ADDRESS }, TEST_NOW);
    expect(created.validUntil).toBe("2026-12-03");
    expect((await listOrders(user, org.id, { now: TEST_NOW })).total).toBe(1);
    const updated = await updateOrder(
      user,
      org.id,
      created.id,
      { addressText: ADDRESS, validUntil: "2026-11-10" },
      created.rowVersion,
      TEST_NOW,
    );
    const extended = await updateOrder(
      user,
      org.id,
      created.id,
      { addressText: ADDRESS, validUntil: addDays(TODAY, OFFER_VALID_DAYS) },
      updated.rowVersion,
      TEST_NOW,
    );
    expect(extended.validUntil).toBe("2026-12-03");
    const second = await createOrder(user, org.id, { addressText: ADDRESS }, TEST_NOW);
    await rejectOrder(user, org.id, second.id, { reasonKey: "timing" });
    const { order } = await convertOrderToAssignment(user, org.id, created.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    expect(order.status).toBe("converted");
  });

  it("3.9.2 admin uten kontor kan alt med valgt kontor (regel 11)", async () => {
    const { org, office, user } = await orgWith(["admin"]);
    const grant = await requireOrganizationAccess(user, org.id);
    expect(grant.roles).toEqual(["admin"]);
    const offer = await createOrder(user, org.id, { addressText: ADDRESS }, TEST_NOW);
    const { order } = await convertOrderToAssignment(user, org.id, offer.id, {
      officeId: office.id,
      now: TEST_NOW,
    });
    expect(order.status).toBe("converted");
  });

  it.each([
    ["uten roller", [] as EmployeeRole[], {}],
    ["deaktivert", ["office"] as EmployeeRole[], { deactivatedAt: TEST_NOW }],
    ["myk-slettet", ["office"] as EmployeeRole[], { deletedAt: TEST_NOW }],
  ])("3.9.3 ansatt %s avvises ved endring", async (_name, roles, overrides) => {
    const org = await createOrganization("Oppdiktet Takst");
    const office = await createOffice(org.id);
    const user = await createUser();
    const employee = await createEmployee(user, org.id, roles);
    if (Object.keys(overrides).length > 0) {
      await db.update(employees).set(overrides).where(eq(employees.id, employee.id));
    }
    const offer = await insertOrder(org.id);
    await expect(createOrder(user, org.id, { addressText: ADDRESS }, TEST_NOW)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      updateOrder(
        user,
        org.id,
        offer.id,
        { addressText: ADDRESS, validUntil: "2026-11-30" },
        1,
        TEST_NOW,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(rejectOrder(user, org.id, offer.id, { reasonKey: "price" })).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      convertOrderToAssignment(user, org.id, offer.id, { officeId: office.id, now: TEST_NOW }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("3.9.3 bruker uten ansattrad avvises", async () => {
    const org = await createOrganization("Oppdiktet Takst");
    const stranger = await createUser();
    await expect(listOrders(stranger, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(createOrder(stranger, org.id, { addressText: ADDRESS })).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("3.9.4 takstmann uten «alle kan endre» følger assignment.edit som før", async () => {
    const { org, user } = await orgWith(["inspector"]);
    await setInspectorsEditAll(org.id, false);
    const offer = await insertOrder(org.id);
    // Lesing virker alltid
    expect((await listOrders(user, org.id, { status: "all" })).total).toBe(1);
    await expect(
      updateOrder(
        user,
        org.id,
        offer.id,
        { addressText: ADDRESS, validUntil: "2026-11-30" },
        1,
        TEST_NOW,
      ),
    ).rejects.toThrow(AccessDeniedError);
  });
});
