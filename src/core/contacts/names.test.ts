import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { REMOVED_CONTACT_LABEL, REMOVED_FIRM_LABEL, listOrderHistory } from "@/core/orders";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import {
  createContact,
  createEmployee,
  createFirm,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { lookupContactAndFirmNames } from "./index";

/*
 * Navn til ordrehistorikken via kontaktmodulen (T2, testplan avsnitt 9 nr. 3, 4 og 8).
 * Støtter hovedmål: færre reklamasjoner (historikken viser riktige navn) og tenant-isolasjon
 * (navn fra en annen organisasjon vises aldri). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-13T10:00:00Z");
const SHARED_FIRST_NAME = "Prøve";
const SHARED_LAST_NAME = "Megler";
const SHARED_FIRM_NAME = "Prøvemegling AS";

async function setupOffice() {
  const org = await createOrganization();
  const user = await createUser({ name: "Kontor Prøve" });
  const employee = await createEmployee(user, org.id, ["office"]);
  const order = await createOrder(org.id);
  return { org, user, employee, order };
}

/** Legger én «update»-rad i revisjonsloggen for ordren med bestiller og firma. */
async function logOrdererChange(
  organizationId: string,
  orderId: string,
  contactId: string,
  firmId: string,
) {
  await db.insert(auditLog).values({
    organizationId,
    entityType: "order",
    entityId: orderId,
    action: "update",
    occurredAt: NOW,
    changes: {
      fields: ["orderedByContactId", "orderedByFirmId"],
      values: {
        orderedByContactId: { from: null, to: contactId },
        orderedByFirmId: { from: null, to: firmId },
      },
    },
  });
}

describe("lookupContactAndFirmNames", () => {
  it("navn til ordrehistorikken: tenant-isolasjon", async () => {
    const contactIds: string[] = [];
    const firmIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          // Samme navn i begge organisasjonene, så bare id-en skiller dem.
          const firm = await createFirm(grant.organizationId, { name: SHARED_FIRM_NAME });
          const contact = await createContact(grant.organizationId, {
            firstName: SHARED_FIRST_NAME,
            lastName: SHARED_LAST_NAME,
            firmId: firm.id,
          });
          contactIds.push(contact.id);
          firmIds.push(firm.id);
          result[key].push(contact.id, firm.id);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
        // Spør etter id-ene fra begge organisasjonene; bare egne skal komme tilbake.
        const names = await lookupContactAndFirmNames(grant, { contactIds, firmIds });
        return [...names.contacts, ...names.firms].map(([id, name]) => ({ id, name }));
      },
      idOf: (row) => row.id,
    });
  });

  it("gir navn i samme form som før, og tomme eller ugyldige id-er krasjer ikke", async () => {
    const { org, user } = await setupOffice();
    const grant = await requireOrganizationAccess(user, org.id, "organization.read");
    const firm = await createFirm(org.id, { name: SHARED_FIRM_NAME });
    const contact = await createContact(org.id, {
      firstName: SHARED_FIRST_NAME,
      lastName: SHARED_LAST_NAME,
    });
    const withoutLastName = await createContact(org.id, { firstName: "Bare", lastName: null });

    const empty = await lookupContactAndFirmNames(grant, { contactIds: [], firmIds: [] });
    expect(empty.contacts.size).toBe(0);
    expect(empty.firms.size).toBe(0);

    const names = await lookupContactAndFirmNames(grant, {
      contactIds: [contact.id, withoutLastName.id, "ikke-en-id", contact.id],
      firmIds: [firm.id, ""],
    });
    expect(Object.fromEntries(names.contacts)).toEqual({
      [contact.id]: "Prøve Megler",
      [withoutLastName.id]: "Bare",
    });
    expect(Object.fromEntries(names.firms)).toEqual({ [firm.id]: SHARED_FIRM_NAME });
  });

  it("slettet kontakt og firma gir REMOVED_CONTACT_LABEL og REMOVED_FIRM_LABEL", async () => {
    const { org, user, employee, order } = await setupOffice();
    const firm = await createFirm(org.id, {
      name: SHARED_FIRM_NAME,
      deletedAt: NOW,
      deletedBy: employee.id,
    });
    const contact = await createContact(org.id, {
      firstName: SHARED_FIRST_NAME,
      lastName: SHARED_LAST_NAME,
      deletedAt: NOW,
      deletedBy: employee.id,
    });
    await logOrdererChange(org.id, order.id, contact.id, firm.id);

    const grant = await requireOrganizationAccess(user, org.id, "organization.read");
    const names = await lookupContactAndFirmNames(grant, {
      contactIds: [contact.id],
      firmIds: [firm.id],
    });
    expect(names.contacts.size).toBe(0);
    expect(names.firms.size).toBe(0);

    const [entry] = await listOrderHistory(user, org.id, order.id);
    expect(entry?.values).toEqual([
      { field: "orderedByContactId", from: null, to: REMOVED_CONTACT_LABEL },
      { field: "orderedByFirmId", from: null, to: REMOVED_FIRM_LABEL },
    ]);
  });

  it("navn til ordrehistorikken: kryss-kobling gir ikke navn fra B", async () => {
    const { org, user, order } = await setupOffice();
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id, { name: "Fremmed Megling AS" });
    const contactB = await createContact(orgB.id, {
      firstName: "Fremmed",
      lastName: "Megler",
      firmId: firmB.id,
    });
    await logOrdererChange(org.id, order.id, contactB.id, firmB.id);

    const [entry] = await listOrderHistory(user, org.id, order.id);
    expect(entry?.values).toEqual([
      { field: "orderedByContactId", from: null, to: REMOVED_CONTACT_LABEL },
      { field: "orderedByFirmId", from: null, to: REMOVED_FIRM_LABEL },
    ]);
    expect(JSON.stringify(entry)).not.toContain("Fremmed");
  });
});
