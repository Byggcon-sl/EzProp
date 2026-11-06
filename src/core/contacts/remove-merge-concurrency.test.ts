import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { assignmentParties, auditLog, contacts, firms, orders } from "@/db/schema";
import {
  createAssignmentParty,
  createContact as insertContact,
  createEmployee,
  createFirm as insertFirm,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { mergeContacts, mergeFirms, removeContact } from "./index";

/*
 * Fjerne og slå sammen samtidig (testplan
 * docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md avsnitt 3). To kall går på hver
 * sin tilkobling (`db` har en pool) og startes med `Promise.allSettled`. Hver sak kjøres i fem
 * runder, så rekkefølgen varierer.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation (den står i
 * remove-merge.test.ts). Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (ingen part eller ordre peker på en fjernet kontakt eller et
 * fjernet firma, uansett rekkefølge).
 */

beforeEach(resetDatabase);

const ROUNDS = 5;

async function orgWithTwoManagers() {
  const org = await createOrganization();
  const first = await createUser({ name: "Test Leder En" });
  const second = await createUser({ name: "Test Leder To" });
  await createEmployee(first, org.id, ["manager"]);
  await createEmployee(second, org.id, ["admin"]);
  return { org, first, second };
}

/** To like kontakter i hvert sitt firma, med parter (én myk-slettet) og ordrer på begge. */
async function seed(organizationId: string) {
  const firmA = await insertFirm(organizationId);
  const firmB = await insertFirm(organizationId);
  const contactA = await insertContact(organizationId, {
    firmId: firmA.id,
    email: "megler@example.com",
  });
  const contactB = await insertContact(organizationId, {
    firmId: firmB.id,
    email: "megler@example.com",
  });
  // Kontakt uten egne koblinger, men i firma A, så contacts.firm_id også prøves
  await insertContact(organizationId, { firstName: "Annen", firmId: firmA.id });
  for (const [contact, firm] of [
    [contactA, firmA],
    [contactB, firmB],
  ] as const) {
    await createAssignmentParty(organizationId, { contactId: contact.id, firmId: firm.id });
    await createAssignmentParty(organizationId, {
      contactId: contact.id,
      firmId: firm.id,
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    await createOrder(organizationId, {
      orderedByText: "Megler Test, Testmegling AS",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
  }
  return { firmA, firmB, contactA, contactB };
}

function split(results: PromiseSettledResult<unknown>[]) {
  return {
    fulfilled: results.filter((r) => r.status === "fulfilled"),
    rejected: results.filter((r): r is PromiseRejectedResult => r.status === "rejected"),
  };
}

/** Rader i parter og ordrer (også myk-slettede) som peker på en fjernet kontakt. */
async function rowsPointingToRemovedContact() {
  const parties = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .innerJoin(contacts, eq(contacts.id, assignmentParties.contactId))
    .where(isNotNull(contacts.deletedAt));
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(contacts, eq(contacts.id, orders.orderedByContactId))
    .where(isNotNull(contacts.deletedAt));
  return [...parties, ...orderRows];
}

/** Rader i kontakter, parter og ordrer som peker på et fjernet firma. */
async function rowsPointingToRemovedFirm() {
  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .innerJoin(firms, eq(firms.id, contacts.firmId))
    .where(isNotNull(firms.deletedAt));
  const parties = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .innerJoin(firms, eq(firms.id, assignmentParties.firmId))
    .where(isNotNull(firms.deletedAt));
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(firms, eq(firms.id, orders.orderedByFirmId))
    .where(isNotNull(firms.deletedAt));
  return [...contactRows, ...parties, ...orderRows];
}

async function auditCount(entityType: string, codes: string[]) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityType, entityType));
  // Koden kan stå hel i `action` eller delt på `entity_type` og `action`
  return rows.filter((row) =>
    codes.includes(row.action.includes(".") ? row.action : `${row.entityType}.${row.action}`),
  ).length;
}

describe("3 samtidighet", () => {
  it("3.1 merge_contacts_A_to_B_and_B_to_A", async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await resetDatabase();
      const { org, first, second } = await orgWithTwoManagers();
      const { contactA, contactB } = await seed(org.id);

      const { fulfilled, rejected } = split(
        await Promise.allSettled([
          mergeContacts(first, org.id, { keepId: contactA.id, removeId: contactB.id }),
          mergeContacts(second, org.id, { keepId: contactB.id, removeId: contactA.id }),
        ]),
      );

      expect(fulfilled, `runde ${round}: nøyaktig ett kall skal lykkes`).toHaveLength(1);
      expect(rejected, `runde ${round}: nøyaktig ett kall skal avvises`).toHaveLength(1);
      expect(rejected[0]!.reason, `runde ${round}`).toBeInstanceOf(AccessDeniedError);

      const removed = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, org.id),
            isNotNull(contacts.deletedAt),
            or(eq(contacts.id, contactA.id), eq(contacts.id, contactB.id)),
          ),
        );
      expect(removed, `runde ${round}: nøyaktig én kontakt er fjernet`).toHaveLength(1);
      expect(await rowsPointingToRemovedContact(), `runde ${round}`).toEqual([]);
      expect(await auditCount("contact", ["contact.merged"]), `runde ${round}`).toBe(1);
    }
  });

  it("3.2 merge_firms_A_to_B_and_B_to_A", async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await resetDatabase();
      const { org, first, second } = await orgWithTwoManagers();
      const { firmA, firmB } = await seed(org.id);

      const { fulfilled, rejected } = split(
        await Promise.allSettled([
          mergeFirms(first, org.id, { keepId: firmA.id, removeId: firmB.id }),
          mergeFirms(second, org.id, { keepId: firmB.id, removeId: firmA.id }),
        ]),
      );

      expect(fulfilled, `runde ${round}: nøyaktig ett kall skal lykkes`).toHaveLength(1);
      expect(rejected, `runde ${round}: nøyaktig ett kall skal avvises`).toHaveLength(1);
      expect(rejected[0]!.reason, `runde ${round}`).toBeInstanceOf(AccessDeniedError);

      const active = await db
        .select({ id: firms.id })
        .from(firms)
        .where(and(eq(firms.organizationId, org.id), isNull(firms.deletedAt)));
      expect(active, `runde ${round}: nøyaktig ett firma står igjen`).toHaveLength(1);
      // Også contacts.firm_id er flyttet
      expect(await rowsPointingToRemovedFirm(), `runde ${round}`).toEqual([]);
      expect(await auditCount("firm", ["firm.merged"]), `runde ${round}`).toBe(1);
    }
  });

  it("3.3 remove_and_merge_same_contact", async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await resetDatabase();
      const { org, first, second } = await orgWithTwoManagers();
      const { contactA, contactB } = await seed(org.id);

      const { fulfilled, rejected } = split(
        await Promise.allSettled([
          removeContact(first, org.id, contactB.id),
          mergeContacts(second, org.id, { keepId: contactA.id, removeId: contactB.id }),
        ]),
      );

      for (const failure of rejected) {
        expect(failure.reason, `runde ${round}: bare AccessDeniedError`).toBeInstanceOf(
          AccessDeniedError,
        );
      }
      // Kontakt B er fjernet uansett rekkefølge, A står
      const [b] = await db.select().from(contacts).where(eq(contacts.id, contactB.id));
      const [a] = await db.select().from(contacts).where(eq(contacts.id, contactA.id));
      expect(b!.deletedAt, `runde ${round}`).toBeInstanceOf(Date);
      expect(a!.deletedAt, `runde ${round}`).toBeNull();
      expect(fulfilled, `runde ${round}: nøyaktig ett kall skal lykkes`).toHaveLength(1);
      // Vant sammenslåingen, peker ingen rad på B. Vant fjerningen, blir koblingene stående på B
      // med vilje (fjerning lar koblingene stå, kortet Omfang 2), og sammenslåingen er avvist.
      const mergeWon = (await auditCount("contact", ["contact.merged"])) === 1;
      if (mergeWon) {
        expect(await rowsPointingToRemovedContact(), `runde ${round}`).toEqual([]);
      }
    }
  });
});
