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
 * Oppslaget som kobler en part eller en ordre til en kontakt
 * (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 2).
 *
 * Avtalt signatur (testplanen, «Avtale om signaturer»):
 * findContactForLink(tx, organizationId, contactId) → { id, firmId } | null. Den tar
 * `organizationId` fra grant hos den som kaller, og filtrerer bort slettede kontakter. Et slettet
 * firma gir `firmId: null` (samme filter som `firmJoin`).
 *
 * Støtter hovedmål: reklamasjoner (en part kan aldri kobles til en kontakt i en annen
 * organisasjon eller en slettet kontakt) og KI først (koblingen er kroken for e-post-til-ordre).
 * Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const DELETED_AT = new Date("2026-11-01T08:00:00Z");

/** Alle kontakt-id-ene `seed` la inn i 2.6; spørringen slår opp hver av dem. */
let allIds: string[] = [];

function lookup(organizationId: string, contactId: string) {
  return db.transaction((tx) => findContactForLink(tx, organizationId, contactId));
}

describe("2. findContactForLink", () => {
  it("2.1 egen kontakt med firma gir { id, firmId } med kontaktens firma", async () => {
    const org = await createOrganization();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });

    expect(await lookup(org.id, contact.id)).toEqual({ id: contact.id, firmId: firm.id });
  });

  it("2.2 egen kontakt uten firma gir { id, firmId: null }", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);

    expect(await lookup(org.id, contact.id)).toEqual({ id: contact.id, firmId: null });
  });

  it("2.3 slettet kontakt gir null", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id, { deletedAt: DELETED_AT });

    expect(await lookup(org.id, contact.id)).toBeNull();
  });

  it("2.4 kontakt med slettet firma gir { id, firmId: null }", async () => {
    const org = await createOrganization();
    const firm = await createFirm(org.id, { deletedAt: DELETED_AT });
    const contact = await createContact(org.id, { firmId: firm.id });

    expect(await lookup(org.id, contact.id)).toEqual({ id: contact.id, firmId: null });
  });

  it("2.5 ukjent uuid gir null", async () => {
    const org = await createOrganization();
    await createContact(org.id);

    expect(await lookup(org.id, randomUUID())).toBeNull();
  });

  it("2.5b kontakt fra en annen organisasjon gir null, også når den har firma", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id);
    const contactB = await createContact(orgB.id, { firmId: firmB.id });

    expect(await lookup(orgA.id, contactB.id)).toBeNull();
  });

  it("2.6 tenant-isolasjon: A får aldri B sin kontakt og omvendt, og fremmed organisasjon nektes", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const firmA = await createFirm(grantA.organizationId);
        const firmB = await createFirm(grantB.organizationId);
        const a = [
          (await createContact(grantA.organizationId, { firmId: firmA.id })).id,
          (await createContact(grantA.organizationId)).id,
        ];
        const b = [
          (await createContact(grantB.organizationId, { firmId: firmB.id })).id,
          (await createContact(grantB.organizationId)).id,
        ];
        allIds = [...a, ...b];
        return { a, b };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const found = await db.transaction(async (tx) => {
          const rows = [];
          for (const id of allIds)
            rows.push(await findContactForLink(tx, grant.organizationId, id));
          return rows;
        });
        return found.filter((row) => row !== null);
      },
      idOf: (row) => row.id,
    });
  });
});

describe("ContactNotFoundError", () => {
  it("har meldingen «Kontakten finnes ikke.» og eget navn", () => {
    const error = new ContactNotFoundError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Kontakten finnes ikke.");
    expect(error.name).toBe("ContactNotFoundError");
  });
});
