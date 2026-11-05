import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
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
 * Koblingen mellom parter/ordre og kontakter/firma i databasen
 * (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 1). Direkte innsetting med SQL,
 * utenom kjernen, så det er de sammensatte fremmednøklene `(organization_id, contact_id)` og
 * `(organization_id, firm_id)` som prøves. Feilkoden sjekkes, så en skrivefeil i et kolonnenavn
 * ikke gir en falsk grønn test (1.5 viser at samme innsetting med egne id-er går).
 *
 * Støtter hovedmål: reklamasjoner (en part eller en ordre kan aldri peke på en kontakt eller et
 * firma i en annen organisasjon, heller ikke utenom tjenestene). Testdata er oppdiktet.
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

type Link = { contactId?: string | null; firmId?: string | null };

function insertPartySql(organizationId: string, assignmentId: string, link: Link) {
  return db.execute(sql`
    insert into assignment_parties (organization_id, assignment_id, role, name, contact_id, firm_id)
    values (${organizationId}, ${assignmentId}, 'broker', 'Megler Test',
      ${link.contactId ?? null}, ${link.firmId ?? null})
    returning id, contact_id, firm_id`);
}

function insertOrderSql(organizationId: string, link: Link) {
  return db.execute(sql`
    insert into orders (
      organization_id, received_at, source, address_text, requested_report_type,
      seller_declaration_received, status, ordered_by_contact_id, ordered_by_firm_id
    ) values (
      ${organizationId}, now(), 'manual', 'Testveien 12, 8000 Bodø', 'condition_report', false,
      'received', ${link.contactId ?? null}, ${link.firmId ?? null}
    )
    returning id, ordered_by_contact_id, ordered_by_firm_id`);
}

/** To organisasjoner, hver med et firma, en kontakt i firmaet og et oppdrag. */
async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const firmA = await createFirm(orgA.id);
  const firmB = await createFirm(orgB.id);
  const contactA = await createContact(orgA.id, { firmId: firmA.id });
  const contactB = await createContact(orgB.id, { firmId: firmB.id });
  const assignmentA = await createAssignment(orgA.id);
  return { orgA, orgB, firmA, firmB, contactA, contactB, assignmentA };
}

async function partyLinkColumns(partyId: string) {
  const result = await db.execute(sql`
    select contact_id, firm_id from assignment_parties where id = ${partyId}`);
  return result[0] as { contact_id: string | null; firm_id: string | null };
}

async function orderLinkColumns(orderId: string) {
  const result = await db.execute(sql`
    select ordered_by_contact_id, ordered_by_firm_id from orders where id = ${orderId}`);
  return result[0] as {
    ordered_by_contact_id: string | null;
    ordered_by_firm_id: string | null;
  };
}

describe("1. koblingen i databasen", () => {
  it("1.1 fk_rejects_foreign_contact_on_party: part i A med contact_id fra B avvises", async () => {
    const s = await twoOrgs();
    await expectPgError(
      insertPartySql(s.orgA.id, s.assignmentA.id, { contactId: s.contactB.id }),
      FOREIGN_KEY,
    );
  });

  it("1.2 fk_rejects_foreign_firm_on_party: part i A med firm_id fra B avvises", async () => {
    const s = await twoOrgs();
    await expectPgError(
      insertPartySql(s.orgA.id, s.assignmentA.id, { firmId: s.firmB.id }),
      FOREIGN_KEY,
    );
  });

  it("1.3 fk_rejects_foreign_contact_on_order: ordre i A med ordered_by_contact_id fra B avvises", async () => {
    const s = await twoOrgs();
    await expectPgError(insertOrderSql(s.orgA.id, { contactId: s.contactB.id }), FOREIGN_KEY);
  });

  it("1.4 fk_rejects_foreign_firm_on_order: ordre i A med ordered_by_firm_id fra B avvises", async () => {
    const s = await twoOrgs();
    await expectPgError(insertOrderSql(s.orgA.id, { firmId: s.firmB.id }), FOREIGN_KEY);
  });

  it("1.4b part i A med kontakt fra A og firma fra B avvises (begge nøklene sjekkes hver for seg)", async () => {
    const s = await twoOrgs();
    await expectPgError(
      insertPartySql(s.orgA.id, s.assignmentA.id, { contactId: s.contactA.id, firmId: s.firmB.id }),
      FOREIGN_KEY,
    );
    await expectPgError(
      insertOrderSql(s.orgA.id, { contactId: s.contactA.id, firmId: s.firmB.id }),
      FOREIGN_KEY,
    );
  });

  it("1.4c ukjent kontakt- eller firma-id avvises", async () => {
    const s = await twoOrgs();
    const unknown = "0190a000-0000-7000-8000-0000000000ff";
    await expectPgError(
      insertPartySql(s.orgA.id, s.assignmentA.id, { contactId: unknown }),
      FOREIGN_KEY,
    );
    await expectPgError(insertOrderSql(s.orgA.id, { firmId: unknown }), FOREIGN_KEY);
  });

  it("1.5 fk_accepts_own_contact_and_firm: samme innsetting med id-er fra A lykkes", async () => {
    const s = await twoOrgs();
    const party = await insertPartySql(s.orgA.id, s.assignmentA.id, {
      contactId: s.contactA.id,
      firmId: s.firmA.id,
    });
    expect(party[0]).toMatchObject({ contact_id: s.contactA.id, firm_id: s.firmA.id });

    const order = await insertOrderSql(s.orgA.id, {
      contactId: s.contactA.id,
      firmId: s.firmA.id,
    });
    expect(order[0]).toMatchObject({
      ordered_by_contact_id: s.contactA.id,
      ordered_by_firm_id: s.firmA.id,
    });
  });

  it("1.6 migration_keeps_existing_rows_null: part og ordre uten de nye feltene har null i alle fire kolonnene", async () => {
    const org = await createOrganization();
    const party = await createAssignmentParty(org.id, {
      name: "Megler Test",
      firmName: "Testmegling AS",
      email: "megler@example.com",
      phone: "00000000",
    });
    const order = await createOrder(org.id, { orderedByText: "Megler Test, Testmegling AS" });

    expect(await partyLinkColumns(party.id)).toEqual({ contact_id: null, firm_id: null });
    expect(await orderLinkColumns(order.id)).toEqual({
      ordered_by_contact_id: null,
      ordered_by_firm_id: null,
    });
  });

  it("1.7 no_check_requires_link: fritekst med alle fire kolonnene null kan lagres (ingen CHECK, A60)", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);

    const party = await insertPartySql(org.id, assignment.id, { contactId: null, firmId: null });
    expect(party[0]).toMatchObject({ contact_id: null, firm_id: null });

    const order = await insertOrderSql(org.id, { contactId: null, firmId: null });
    expect(order[0]).toMatchObject({
      ordered_by_contact_id: null,
      ordered_by_firm_id: null,
    });
  });

  it("1.7b kontakt uten firma og firma uten kontakt kan begge lagres hver for seg", async () => {
    const s = await twoOrgs();
    const onlyContact = await insertPartySql(s.orgA.id, s.assignmentA.id, {
      contactId: s.contactA.id,
    });
    expect(onlyContact[0]).toMatchObject({ contact_id: s.contactA.id, firm_id: null });
    const onlyFirm = await insertOrderSql(s.orgA.id, { firmId: s.firmA.id });
    expect(onlyFirm[0]).toMatchObject({
      ordered_by_contact_id: null,
      ordered_by_firm_id: s.firmA.id,
    });
  });
});
