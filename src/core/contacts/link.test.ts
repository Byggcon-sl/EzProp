import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import {
  createContact,
  createFirm,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ContactNotFoundError, findContactForLink } from "./index";

/*
 * Oppslaget når en kontakt kobles til en part eller en ordre
 * (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 2). Funksjonen tar
 * `organizationId` fra grant hos den som kaller; tenant-testen henter grant med
 * `requireOrganizationAccess`, slik kjernen gjør.
 *
 * Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (koblingen kan aldri peke på en
 * fremmed eller slettet kontakt) og KI først (kroken for e-post-til-ordre).
 */

beforeEach(resetDatabase);

const DELETED = new Date("2026-11-01T08:00:00Z");

describe("2. findContactForLink", () => {
  it("2.1 egen kontakt med firma gir { id, firmId } med kontaktens firma", async () => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });

    expect(await findContactForLink(db, org.id, contact.id)).toEqual({
      id: contact.id,
      firmId: firm.id,
    });
  });

  it("2.2 egen kontakt uten firma gir { id, firmId: null }", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);

    expect(await findContactForLink(db, org.id, contact.id)).toEqual({
      id: contact.id,
      firmId: null,
    });
  });

  it("2.3 slettet kontakt gir null", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id, { deletedAt: DELETED });

    expect(await findContactForLink(db, org.id, contact.id)).toBeNull();
  });

  it("2.4 kontakt med slettet firma gir { id, firmId: null }", async () => {
    const org = await createOrganization();
    const firm = await createFirm(org.id, { deletedAt: DELETED });
    const contact = await createContact(org.id, { firmId: firm.id });

    expect(await findContactForLink(db, org.id, contact.id)).toEqual({
      id: contact.id,
      firmId: null,
    });
  });

  it.each([
    ["ukjent uuid", randomUUID()],
    ["ugyldig id", "abc"],
  ])("2.5 %s gir null", async (_name, id) => {
    const org = await createOrganization();
    await createContact(org.id);

    expect(await findContactForLink(db, org.id, id)).toBeNull();
  });

  it("2.6 gir aldri en kontakt fra en annen organisasjon", async () => {
    const seededIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = [(await createContact(grantA.organizationId)).id];
        const b = [(await createContact(grantB.organizationId)).id];
        seededIds.push(...a, ...b);
        return { a, b };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return db.transaction(async (tx) => {
          const found = [];
          for (const id of seededIds) {
            const row = await findContactForLink(tx, grant.organizationId, id);
            if (row) found.push(row);
          }
          return found;
        });
      },
      idOf: (row) => row.id,
    });
  });

  it("ContactNotFoundError har meldingen «Kontakten finnes ikke.»", () => {
    const error = new ContactNotFoundError();
    expect(error.message).toBe("Kontakten finnes ikke.");
    expect(error.name).toBe("ContactNotFoundError");
  });
});
