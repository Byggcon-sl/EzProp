import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { assignmentParties, orders } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createContact,
  createFirm,
  createOrder,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Databasen stopper kobling til kontakt og firma i en annen organisasjon
 * (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 1). Direkte innsetting med
 * `db.insert`, utenom kjernen, så det er de sammensatte fremmednøklene som prøves. Feilkoden
 * sjekkes, så en skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Ingen ny spørring med `organizationId` her (bare skrankene), så filen trenger ikke
 * expectTenantIsolation. Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (en part eller ordre kan aldri peke på en kontakt eller et
 * firma i en annen organisasjon).
 */

beforeEach(resetDatabase);

const FOREIGN_KEY = "23503";

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

/** To organisasjoner, hver med et oppdrag, et firma og en kontakt i firmaet. */
async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const assignmentA = await createAssignment(orgA.id);
  const firmA = await createFirm(orgA.id);
  const firmB = await createFirm(orgB.id);
  const contactA = await createContact(orgA.id, { firmId: firmA.id });
  const contactB = await createContact(orgB.id, { firmId: firmB.id });
  return { orgA, orgB, assignmentA, firmA, firmB, contactA, contactB };
}

function insertParty(
  organizationId: string,
  assignmentId: string,
  link: { contactId?: string | null; firmId?: string | null },
) {
  return db
    .insert(assignmentParties)
    .values({
      organizationId,
      assignmentId,
      role: "broker",
      name: "Megler Test",
      contactId: link.contactId ?? null,
      firmId: link.firmId ?? null,
    })
    .returning();
}

function insertOrder(
  organizationId: string,
  link: { orderedByContactId?: string | null; orderedByFirmId?: string | null },
) {
  return db
    .insert(orders)
    .values({
      organizationId,
      addressText: "Testveien 12, 8000 Bodø",
      orderedByContactId: link.orderedByContactId ?? null,
      orderedByFirmId: link.orderedByFirmId ?? null,
    })
    .returning();
}

describe("1. koblingen i databasen", () => {
  it("1.1 fk_rejects_foreign_contact_on_party: part i A med kontakt fra B avvises", async () => {
    const { orgA, assignmentA, contactB } = await twoOrgs();
    await expectPgError(
      insertParty(orgA.id, assignmentA.id, { contactId: contactB.id }),
      FOREIGN_KEY,
    );
  });

  it("1.2 fk_rejects_foreign_firm_on_party: part i A med firma fra B avvises", async () => {
    const { orgA, assignmentA, firmB } = await twoOrgs();
    await expectPgError(insertParty(orgA.id, assignmentA.id, { firmId: firmB.id }), FOREIGN_KEY);
  });

  it("1.3 fk_rejects_foreign_contact_on_order: ordre i A med bestiller fra B avvises", async () => {
    const { orgA, contactB } = await twoOrgs();
    await expectPgError(insertOrder(orgA.id, { orderedByContactId: contactB.id }), FOREIGN_KEY);
  });

  it("1.4 fk_rejects_foreign_firm_on_order: ordre i A med firma fra B avvises", async () => {
    const { orgA, firmB } = await twoOrgs();
    await expectPgError(insertOrder(orgA.id, { orderedByFirmId: firmB.id }), FOREIGN_KEY);
  });

  it("1.5 fk_accepts_own_contact_and_firm: samme innsetting med id-er fra A lykkes", async () => {
    const { orgA, assignmentA, firmA, contactA } = await twoOrgs();

    const [party] = await insertParty(orgA.id, assignmentA.id, {
      contactId: contactA.id,
      firmId: firmA.id,
    });
    expect(party).toMatchObject({ contactId: contactA.id, firmId: firmA.id });

    const [order] = await insertOrder(orgA.id, {
      orderedByContactId: contactA.id,
      orderedByFirmId: firmA.id,
    });
    expect(order).toMatchObject({ orderedByContactId: contactA.id, orderedByFirmId: firmA.id });
  });

  it("1.6 migration_keeps_existing_rows_null: part og ordre uten de nye feltene har null", async () => {
    const org = await createOrganization();
    const party = await createAssignmentParty(org.id);
    const order = await createOrder(org.id);

    const [partyRow] = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.id, party.id));
    expect(partyRow).toMatchObject({ contactId: null, firmId: null });

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRow).toMatchObject({ orderedByContactId: null, orderedByFirmId: null });
  });

  it("1.7 no_check_requires_link: fritekst uten kobling kan lagres (A60)", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);

    const [party] = await insertParty(org.id, assignment.id, {});
    expect(party).toMatchObject({ name: "Megler Test", contactId: null, firmId: null });

    const [order] = await insertOrder(org.id, {});
    expect(order).toMatchObject({ orderedByContactId: null, orderedByFirmId: null });
  });
});
