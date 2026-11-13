import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { getAssignmentProperty } from "@/core/properties";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  contacts,
  employees,
  events,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createAssignment,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createProperty,
  createUser,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ORDER_EDITABLE_FIELDS } from "./codes";
import { OrderChangedError } from "./errors";
import {
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrderHistory,
  rejectOrder,
  updateOrder,
} from "./index";

/*
 * Endre en ordre etter at den er lagret (T1, Ståles svar 12.11.2026: «full redigeringstilgang.
 * alltid»). Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 1.4 og 2.1–2.7.
 * 2.6.11–2.6.12 og databasefeilen i 2.6.8 står i orders-transaction.test.ts (innpakningen).
 *
 * Avtalen om signaturer (testplanen): `updateOrder(actor, organizationId, orderId, input,
 * expectedRowVersion)` og `listOrderHistory(actor, organizationId, orderId)`. Input sendes alltid
 * komplett (alle feltene i skjemaet), fordi skjemaet er det samme som «Ny ordre».
 *
 * Testdata er oppdiktet: «Testveien 12, 8000 Bodø» → «Prøvegata 7, 8006 Bodø», «Megler Testesen»,
 * «Testtoppen borettslag», TEST-ORD-0001 → TEST-ORD-0002, e-post på example.com. Fast tid: TEST_NOW.
 * I lekkasjetestene brukes gnr/bnr med fem sifre, så de ikke forveksles med id-er og klokkeslett.
 *
 * Støtter hovedmål: de ansatte (feil rettes på stedet, ingenting går tapt), KI i bunnen
 * (`fields` med feltkoder i fast rekkefølge er grunnlaget for treffprosent per felt senere) og
 * færre reklamasjoner (ingen stille overskriving, oppdraget endres ikke, hvem og når står).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = TEST_NOW;
const OLD_ADDRESS = "Testveien 12, 8000 Bodø";
const NEW_ADDRESS = "Prøvegata 7, 8006 Bodø";
const ORDERED_BY = "Megler Testesen";
const NEW_ORDERED_BY = "Megler Prøvesen";
const HOUSING = "Testtoppen borettslag";
const EXTERNAL_REF = "TEST-ORD-0001";
const NEW_EXTERNAL_REF = "TEST-ORD-0002";
const RECEIVED_AT = "2026-11-02T08:00:00.000Z";
const NEW_RECEIVED_AT = "2026-11-01T07:30:00.000Z";
const LEAK_GNR = "98761";
const LEAK_BNR = "43219";
const CONFLICT_MESSAGE = "Ordren er endret av en annen. Last siden på nytt.";

/** Verdier som aldri skal stå i applikasjonslogg, hendelse eller feilmelding. */
const SECRET_VALUES = [
  OLD_ADDRESS,
  NEW_ADDRESS,
  "Testveien",
  "Prøvegata",
  ORDERED_BY,
  NEW_ORDERED_BY,
  "Testesen",
  "Prøvesen",
  HOUSING,
  "Testtoppen",
  EXTERNAL_REF,
  NEW_EXTERNAL_REF,
  LEAK_GNR,
  LEAK_BNR,
];

type UpdateInput = Parameters<typeof updateOrder>[3];
type CreateInput = Parameters<typeof createOrder>[2];

/** Komplett skjema som ved «Ny ordre». */
function fullInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    addressText: OLD_ADDRESS,
    receivedAt: RECEIVED_AT,
    externalRef: EXTERNAL_REF,
    orderedByText: ORDERED_BY,
    orderedByContactId: null,
    gnr: "12",
    bnr: "34",
    snr: "5",
    housingAssociationName: HOUSING,
    sellerDeclarationReceived: false,
    ...overrides,
  };
}

/** Skjemaet slik det åpnes for en lagret ordre (verdiene fra raden), med endringene. */
function editInput(
  row: typeof orders.$inferSelect,
  overrides: Record<string, unknown> = {},
): UpdateInput {
  return {
    addressText: row.addressText,
    receivedAt: row.receivedAt.toISOString(),
    externalRef: row.externalRef ?? "",
    orderedByText: row.orderedByText ?? "",
    orderedByContactId: row.orderedByContactId ?? "",
    gnr: row.gnr ?? "",
    bnr: row.bnr ?? "",
    snr: row.snr ?? "",
    housingAssociationName: row.housingAssociationName ?? "",
    sellerDeclarationReceived: row.sellerDeclarationReceived,
    ...overrides,
  } as UpdateInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  return { org, admin, adminEmployee, office };
}

async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

/** Ordre lagt inn med tjenesten (gir loggraden `create`). */
async function savedOrder(actor: Actor, organizationId: string, overrides = {}) {
  const row = await createOrder(actor, organizationId, fullInput(overrides) as CreateInput, NOW);
  return orderRow(row.id);
}

/** Gjort-om ordre med ekte oppdrag fra fabrikkene. */
async function insertConvertedOrder(
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const order = await insertOrder(organizationId, overrides);
  const assignment = await createAssignment(organizationId, { orderId: order.id });
  const [converted] = await db
    .update(orders)
    .set({ status: "converted", assignmentId: assignment.id })
    .where(eq(orders.id, order.id))
    .returning();
  if (!converted) throw new Error("kunne ikke gjøre om ordren");
  return { order: converted, assignment };
}

/** Endrer adressen med versjonen fra databasen. */
async function changeAddress(actor: Actor, organizationId: string, id: string, address: string) {
  const row = await orderRow(id);
  return updateOrder(
    actor,
    organizationId,
    id,
    editInput(row, { addressText: address }),
    row.rowVersion,
  );
}

async function auditFor(organizationId: string) {
  return db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

async function updateAuditFor(organizationId: string, orderId?: string) {
  const rows = await auditFor(organizationId);
  return rows.filter(
    (row) =>
      row.entityType === "order" &&
      row.action === "update" &&
      (orderId === undefined || row.entityId === orderId),
  );
}

async function eventsFor(organizationId: string) {
  return db.select().from(events).where(eq(events.organizationId, organizationId));
}

async function updatedEventsFor(organizationId: string) {
  return (await eventsFor(organizationId)).filter((row) => row.type === "order.updated");
}

/** Alt som ikke skal endres når en lagring avvises. */
async function snapshot(organizationId: string, orderId: string) {
  return {
    order: await orderRow(orderId),
    audit: (await auditFor(organizationId)).length,
    events: (await eventsFor(organizationId)).length,
  };
}

async function expectUnchanged(
  organizationId: string,
  orderId: string,
  before: Awaited<ReturnType<typeof snapshot>>,
) {
  expect(await snapshot(organizationId, orderId)).toEqual(before);
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Loggrad satt inn direkte (uten tjenesten), for tester av lesingen. */
async function insertAuditRow(values: {
  organizationId: string;
  entityId: string;
  entityType?: string;
  action?: string;
  changes?: Record<string, unknown>;
  actorEmployeeId?: string | null;
  occurredAt?: Date;
}) {
  const [row] = await db
    .insert(auditLog)
    .values({
      organizationId: values.organizationId,
      entityType: values.entityType ?? "order",
      entityId: values.entityId,
      action: values.action ?? "update",
      changes: values.changes ?? {},
      actorEmployeeId: values.actorEmployeeId ?? null,
      occurredAt: values.occurredAt ?? NOW,
    })
    .returning();
  if (!row) throw new Error("kunne ikke lage loggrad");
  return row;
}

// ---------------------------------------------------------------------------------------------
// 1.4 Samme skjema og samme meldinger som «Ny ordre»
// ---------------------------------------------------------------------------------------------

describe("1.4 skjemaet for endring er skjemaet for «Ny ordre»", () => {
  it.each([
    ["tom adresse", { addressText: "   " }],
    ["gnr med bokstav", { gnr: "12a" }],
    ["bnr med bokstav", { bnr: "3b" }],
    ["snr med bokstav", { snr: "x" }],
    ["ugyldig dato", { receivedAt: "ikke en dato" }],
    ["dato frem i tid", { receivedAt: "2099-01-01T08:00:00.000Z" }],
    ["fødselsnummer i bestiller", { orderedByText: "Testesen 01019912345" }],
    ["for lang adresse", { addressText: "x".repeat(301) }],
  ])("%s gir de samme feltene og meldingene som ved oppretting", async (_name, bad) => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);

    const created = await caught(createOrder(admin, org.id, fullInput(bad) as CreateInput, NOW));
    const updated = await caught(
      updateOrder(admin, org.id, order.id, editInput(order, bad), order.rowVersion),
    );
    expect(created).toBeInstanceOf(ZodError);
    expect(updated).toBeInstanceOf(ZodError);
    const issues = (error: unknown) =>
      (error as ZodError).issues
        .map((issue) => `${String(issue.path[0] ?? "")}: ${issue.message}`)
        .sort();
    expect(issues(updated)).toEqual(issues(created));
  });
});

// ---------------------------------------------------------------------------------------------
// 2.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };

const editorCases: RoleCase[] = [
  { name: "2.1.1 kontor", roles: ["office"], editAll: false },
  { name: "2.1.2 leder", roles: ["manager"], editAll: false },
  { name: "2.1.3 takstmann med innstillingen på", roles: ["inspector"], editAll: true },
  {
    name: "2.1.6 admin uten andre roller og med innstillingen av",
    roles: ["admin"],
    editAll: false,
  },
];

describe("2.1 tilgang per rolle", () => {
  it.each(editorCases)("$name kan endre og se endringene", async ({ roles, editAll }) => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, editAll);
    const order = await savedOrder(admin, org.id);
    const { actor } = await person(org.id, roles, "Oppdiktet Endrer");

    const updated = await updateOrder(
      actor,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    expect(updated.id).toBe(order.id);
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);

    const history = await listOrderHistory(actor, org.id, order.id);
    const update = history.find((row) => row.action === "update");
    expect(update?.actorName).toBe("Oppdiktet Endrer");
  });

  it("2.1.4 takstmann med innstillingen av: updateOrder gir AccessDeniedError, listOrderHistory virker; ingenting endres", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await savedOrder(admin, org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        actor,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expectUnchanged(org.id, order.id, before);

    const history = await listOrderHistory(actor, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["create"]);
  });

  it("2.1.5 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan endre", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await savedOrder(admin, org.id);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    await updateOrder(
      actor,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("2.1.6 admin uten andre roller og med innstillingen av kan endre og se (regel 11)", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await savedOrder(admin, org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);
    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["update", "create"]);
  });

  it("2.1.7 bruker uten ansattrad får AccessDeniedError på begge", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const stranger = await createUser({ name: "Oppdiktet uten ansattrad" });
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        stranger,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(stranger, org.id, order.id)).rejects.toThrow(AccessDeniedError);
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.1.7 ansatt uten roller får AccessDeniedError på begge", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const { actor } = await person(org.id, []);
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        actor,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(actor, org.id, order.id)).rejects.toThrow(AccessDeniedError);
    await expectUnchanged(org.id, order.id, before);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["myk-slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)("2.1.8 %s ansatt (admin) får AccessDeniedError på begge", async (_name, set) => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const { actor, employee } = await person(org.id, ["admin"]);
    await db.update(employees).set(set).where(eq(employees.id, employee.id));
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        actor,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(actor, org.id, order.id)).rejects.toThrow(AccessDeniedError);
    await expectUnchanged(org.id, order.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.2 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

describe("2.2 tenant-isolasjon", () => {
  it("2.2.1 expectTenantIsolation for updateOrder", async () => {
    const orderByOrg = new Map<string, string>();
    let counter = 0;
    await expectTenantIsolation({
      seed: async (grantA: EmployeeGrant, grantB: EmployeeGrant) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        orderByOrg.set(grantA.organizationId, a.id);
        orderByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      // Endrer én ordre i organisasjonen og gir raden. Versjonen leses fra databasen, slik at
      // avslaget mot den andre organisasjonen kommer fra updateOrder og ikke fra getOrder.
      query: async (actor, organizationId) => {
        const id = orderByOrg.get(organizationId);
        if (!id) throw new Error("ukjent organisasjon i testen");
        counter += 1;
        const row = await orderRow(id);
        const updated = await updateOrder(
          actor,
          organizationId,
          id,
          editInput(row, { addressText: `Prøvegata ${counter}, 8006 Bodø` }),
          row.rowVersion,
        );
        return [updated];
      },
      idOf: (row) => row.id,
    });
  });

  it("2.2.1 egen ordre: rowVersion fra getOrder godtas", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const opened = await getOrder(admin, org.id, order.id);
    const updated = await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      opened.rowVersion,
    );
    expect(updated.addressText).toBe(NEW_ADDRESS);
  });

  it("2.2.2 expectTenantIsolation for listOrderHistory", async () => {
    const orderByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA: EmployeeGrant, grantB: EmployeeGrant) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const editor = await createUser({ name: `Oppdiktet kontor ${side.toUpperCase()}` });
          await createEmployee(editor, grant.organizationId, ["office"]);
          const order = await savedOrder(editor, grant.organizationId);
          await changeAddress(editor, grant.organizationId, order.id, NEW_ADDRESS);
          orderByOrg.set(grant.organizationId, order.id);
          ids[side] = (await auditFor(grant.organizationId))
            .filter((row) => row.entityType === "order" && row.entityId === order.id)
            .map((row) => row.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const id = orderByOrg.get(organizationId);
        if (!id) throw new Error("ukjent organisasjon i testen");
        return listOrderHistory(actor, organizationId, id);
      },
      idOf: (row) => row.id,
    });
  });

  it("2.2.3 bruker i A med A sin id og ordre-id fra B: AccessDeniedError på begge; B er urørt", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderB = await savedOrder(b.admin, b.org.id);
    await changeAddress(b.admin, b.org.id, orderB.id, NEW_ADDRESS);
    const before = await snapshot(b.org.id, orderB.id);
    const fresh = await orderRow(orderB.id);

    await expect(
      updateOrder(
        a.admin,
        a.org.id,
        orderB.id,
        editInput(fresh, { addressText: "Prøvegata 99, 8006 Bodø" }),
        fresh.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(a.admin, a.org.id, orderB.id)).rejects.toThrow(AccessDeniedError);
    await expectUnchanged(b.org.id, orderB.id, before);
    expect(await auditFor(a.org.id)).toEqual([]);
    expect(await eventsFor(a.org.id)).toEqual([]);
  });

  it("2.2.4 loggrad i B med samme entity_id som A-ordren vises aldri for A", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const orderA = await savedOrder(a.admin, a.org.id);
    const foreign = await insertAuditRow({
      organizationId: b.org.id,
      entityId: orderA.id,
      changes: {
        fields: ["addressText"],
        values: { addressText: { from: "Hemmeligveien 1", to: "Hemmeligveien 2" } },
      },
    });

    const history = await listOrderHistory(a.admin, a.org.id, orderA.id);
    expect(history.map((row) => row.id)).not.toContain(foreign.id);
    expect(history.map((row) => row.action)).toEqual(["create"]);
    expect(JSON.stringify(history)).not.toContain("Hemmeligveien");
  });

  it("2.2.5 kontakt-id fra B i en loggrad i A vises som «(fjernet kontakt)», aldri med B-navnet", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const contactB = await createContact(b.org.id, { firstName: "Fremmed", lastName: "Hemmelig" });
    const orderA = await savedOrder(a.admin, a.org.id);
    await insertAuditRow({
      organizationId: a.org.id,
      entityId: orderA.id,
      changes: {
        fields: ["orderedByContactId"],
        values: { orderedByContactId: { from: null, to: contactB.id } },
      },
    });

    const history = await listOrderHistory(a.admin, a.org.id, orderA.id);
    const update = history.find((row) => row.action === "update");
    expect(update?.values).toEqual([
      { field: "orderedByContactId", from: null, to: "(fjernet kontakt)" },
    ]);
    expect(JSON.stringify(history)).not.toContain("Hemmelig");
    expect(JSON.stringify(history)).not.toContain("Fremmed");
  });

  it("2.2.6 kontakt fra B til ordre i A gir ContactNotFoundError; A er urørt", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const contactB = await createContact(b.org.id);
    const orderA = await savedOrder(a.admin, a.org.id);
    const before = await snapshot(a.org.id, orderA.id);

    await expect(
      updateOrder(
        a.admin,
        a.org.id,
        orderA.id,
        editInput(orderA, { orderedByContactId: contactB.id }),
        orderA.rowVersion,
      ),
    ).rejects.toThrow(ContactNotFoundError);
    await expectUnchanged(a.org.id, orderA.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.3 Fremmed, ukjent, slettet og ugyldig id
// ---------------------------------------------------------------------------------------------

describe("2.3 ukjent, slettet og ugyldig id", () => {
  it("2.3.1 ukjent uuid gir AccessDeniedError på begge", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const unknown = randomUUID();

    await expect(
      updateOrder(admin, org.id, unknown, editInput(order, { addressText: NEW_ADDRESS }), 1),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(admin, org.id, unknown)).rejects.toThrow(AccessDeniedError);
  });

  it("2.3.2 myk-slettet ordre gir AccessDeniedError på begge, og deleted_at står", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const deletedAt = new Date("2026-11-02T12:00:00Z");
    await db
      .update(orders)
      .set({ deletedAt, deletedBy: adminEmployee.id })
      .where(eq(orders.id, order.id));
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(before.order, { addressText: NEW_ADDRESS }),
        before.order.rowVersion,
      ),
    ).rejects.toThrow(AccessDeniedError);
    await expect(listOrderHistory(admin, org.id, order.id)).rejects.toThrow(AccessDeniedError);

    await expectUnchanged(org.id, order.id, before);
    expect((await orderRow(order.id)).deletedAt).toEqual(deletedAt);
  });

  it.each(["ikke-en-id", "", "1; drop table orders", "00000000-0000-0000-0000-00000000000g"])(
    "2.3.3 id «%s» gir AccessDeniedError, ikke databasefeil",
    async (badId) => {
      const { org, admin } = await orgWithAdmin();
      const order = await savedOrder(admin, org.id);
      await expect(
        updateOrder(admin, org.id, badId, editInput(order, { addressText: NEW_ADDRESS }), 1),
      ).rejects.toThrow(AccessDeniedError);
      await expect(listOrderHistory(admin, org.id, badId)).rejects.toThrow(AccessDeniedError);
    },
  );

  it.each([
    ["ukjent kontakt", async () => randomUUID()],
    [
      "myk-slettet kontakt",
      async (organizationId: string) =>
        (await createContact(organizationId, { deletedAt: new Date("2026-11-01T08:00:00Z") })).id,
    ],
  ] as const)("2.3.4 %s gir ContactNotFoundError; ingen endring", async (_name, makeId) => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const contactId = await makeId(org.id);
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { orderedByContactId: contactId, addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(ContactNotFoundError);
    await expectUnchanged(org.id, order.id, before);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.4 Endring
// ---------------------------------------------------------------------------------------------

describe("2.4 endring", () => {
  it("2.4.1 mottatt ordre: alle feltene endres, og getOrder viser de nye verdiene", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, {
        receivedAt: NEW_RECEIVED_AT,
        externalRef: NEW_EXTERNAL_REF,
        orderedByText: NEW_ORDERED_BY,
        orderedByContactId: contact.id,
        addressText: NEW_ADDRESS,
        gnr: "56",
        bnr: "78",
        snr: "9",
        housingAssociationName: "Prøvehøgda sameie",
        sellerDeclarationReceived: true,
      }),
      order.rowVersion,
    );

    const detail = await getOrder(admin, org.id, order.id);
    expect(detail).toMatchObject({
      receivedAt: new Date(NEW_RECEIVED_AT),
      externalRef: NEW_EXTERNAL_REF,
      orderedByText: NEW_ORDERED_BY,
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      addressText: NEW_ADDRESS,
      gnr: "56",
      bnr: "78",
      snr: "9",
      housingAssociationName: "Prøvehøgda sameie",
      sellerDeclarationReceived: true,
      status: "received",
    });
  });

  it("2.4.2 gjort-om ordre kan endres; status og assignmentId står; oppdraget er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await insertConvertedOrder(org.id, {
      externalRef: EXTERNAL_REF,
      orderedByText: ORDERED_BY,
    });
    const [assignmentBefore] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS, gnr: "56", bnr: "78" }),
      order.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.addressText).toBe(NEW_ADDRESS);
    expect(after.status).toBe("converted");
    expect(after.assignmentId).toBe(assignment.id);
    const [assignmentAfter] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    expect(assignmentAfter).toEqual(assignmentBefore);
  });

  it("2.4.3 avvist ordre kan endres; status og avvisningsgrunnen står", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const rejected = await orderRow(order.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(rejected, { addressText: NEW_ADDRESS }),
      rejected.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.addressText).toBe(NEW_ADDRESS);
    expect(after.status).toBe("rejected");
    expect(after.rejectedReason).toBe("Feil registrering");
  });

  it("2.4.4 status, avvisningsgrunn, assignmentId, source, rapporttype og organisasjon fra input brukes aldri", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");
    const foreignAssignment = await createAssignment(org.id);
    const order = await savedOrder(admin, org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, {
        addressText: NEW_ADDRESS,
        status: "rejected",
        rejectReason: "Tuklet grunn",
        rejectedReason: "Tuklet grunn",
        assignmentId: foreignAssignment.id,
        source: "email",
        requestedReportType: "energy_label",
        organizationId: other.id,
      }),
      order.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.addressText).toBe(NEW_ADDRESS);
    expect(after).toMatchObject({
      status: order.status,
      rejectedReason: order.rejectedReason,
      assignmentId: order.assignmentId,
      source: order.source,
      requestedReportType: order.requestedReportType,
      organizationId: org.id,
    });
    const [update] = await updateAuditFor(org.id, order.id);
    expect(update?.changes.fields).toEqual(["addressText"]);
  });

  it("2.4.5 koble kontakt etter lagring: kontakten og kontaktens firma lagres (A87)", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await savedOrder(admin, org.id);
    expect(order.orderedByContactId).toBeNull();

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { orderedByContactId: contact.id }),
      order.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.orderedByContactId).toBe(contact.id);
    expect(after.orderedByFirmId).toBe(firm.id);
    expect(after.orderedByText).toBe(ORDERED_BY);
  });

  it("2.4.6 bytte kontakt: nytt firma følger; uten firma gir null; slettet firma gir null", async () => {
    const { org, admin } = await orgWithAdmin();
    const firmOne = await createFirm(org.id, { name: "Testmegling En AS" });
    const firmTwo = await createFirm(org.id, { name: "Testmegling To AS" });
    const deletedFirm = await createFirm(org.id, {
      name: "Testmegling Slettet AS",
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    const first = await createContact(org.id, { firmId: firmOne.id });
    const second = await createContact(org.id, { firmId: firmTwo.id });
    const noFirm = await createContact(org.id, { firmId: null });
    const withDeletedFirm = await createContact(org.id, { firmId: deletedFirm.id });
    const order = await savedOrder(admin, org.id, { orderedByContactId: first.id });
    expect(order.orderedByFirmId).toBe(firmOne.id);

    const steps = [
      [second.id, firmTwo.id],
      [noFirm.id, null],
      [withDeletedFirm.id, null],
    ] as const;
    for (const [contactId, firmId] of steps) {
      const row = await orderRow(order.id);
      await updateOrder(
        admin,
        org.id,
        order.id,
        editInput(row, { orderedByContactId: contactId }),
        row.rowVersion,
      );
      const after = await orderRow(order.id);
      expect(after.orderedByContactId).toBe(contactId);
      expect(after.orderedByFirmId).toBe(firmId);
    }
  });

  it("2.4.7 fjerne kontakt: begge kolonnene null, fritekst-bestilleren står (A87)", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await savedOrder(admin, org.id, { orderedByContactId: contact.id });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { orderedByContactId: "" }),
      order.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.orderedByContactId).toBeNull();
    expect(after.orderedByFirmId).toBeNull();
    expect(after.orderedByText).toBe(ORDERED_BY);
  });

  it("2.4.8 orderedByFirmId fra input brukes aldri", async () => {
    const { org, admin } = await orgWithAdmin();
    const realFirm = await createFirm(org.id, { name: "Testmegling Ekte AS" });
    const otherFirm = await createFirm(org.id, { name: "Testmegling Tuklet AS" });
    const contact = await createContact(org.id, { firmId: realFirm.id });
    const order = await savedOrder(admin, org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { orderedByContactId: contact.id, orderedByFirmId: otherFirm.id }),
      order.rowVersion,
    );
    expect((await orderRow(order.id)).orderedByFirmId).toBe(realFirm.id);

    // Uten kontakt: firmaet fra input brukes heller ikke
    const row = await orderRow(order.id);
    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(row, { orderedByContactId: "", orderedByFirmId: otherFirm.id }),
      row.rowVersion,
    );
    expect((await orderRow(order.id)).orderedByFirmId).toBeNull();
  });

  it("2.4.9 ugyldige verdier gir ZodError; verdier, row_version, logg og hendelser er urørt", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const before = await snapshot(org.id, order.id);

    const error = await caught(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: "", gnr: "12a", receivedAt: "ikke en dato" }),
        order.rowVersion,
      ),
    );
    expect(error).toBeInstanceOf(ZodError);
    const messages = (error as ZodError).issues.map((issue) => issue.message);
    expect(messages).toContain("Skriv inn adressen.");
    expect(messages).toContain("Gårdsnummer kan bare ha sifre.");
    expect(messages).toContain("Mottatt må være en dato og et klokkeslett.");
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.4.10 updated_by blir den som endret; created_by og created_at står; row_version + 1", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const { actor, employee } = await person(org.id, ["office"]);

    await updateOrder(
      actor,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );

    const after = await orderRow(order.id);
    expect(after.updatedBy).toBe(employee.id);
    expect(after.createdBy).toBe(order.createdBy);
    expect(after.createdBy).toBe(adminEmployee.id);
    expect(after.createdAt).toEqual(order.createdAt);
    expect(after.rowVersion).toBe(order.rowVersion + 1);
  });

  it("2.4.11 valgfritt felt fra tomt til verdi og tilbake til tomt (tom tekst blir null)", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id, { housingAssociationName: null, snr: null });
    expect(order.housingAssociationName).toBeNull();

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { housingAssociationName: HOUSING, snr: "7" }),
      order.rowVersion,
    );
    const filled = await orderRow(order.id);
    expect(filled.housingAssociationName).toBe(HOUSING);
    expect(filled.snr).toBe("7");

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(filled, { housingAssociationName: "   ", snr: "" }),
      filled.rowVersion,
    );
    const emptied = await orderRow(order.id);
    expect(emptied.housingAssociationName).toBeNull();
    expect(emptied.snr).toBeNull();
  });

  it("2.4.12 eiendom som ikke er lagret: forhåndsutfyllingen viser den nye adressen", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await insertConvertedOrder(org.id, {
      gnr: "12",
      bnr: "34",
      housingAssociationName: HOUSING,
    });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, {
        addressText: NEW_ADDRESS,
        gnr: "56",
        bnr: "78",
        housingAssociationName: "Prøvehøgda sameie",
      }),
      order.rowVersion,
    );

    const view = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(view.property).toBeNull();
    expect(view.prefill).toMatchObject({
      address: NEW_ADDRESS,
      gnr: "56",
      bnr: "78",
      associationName: "Prøvehøgda sameie",
    });
  });

  it("2.4.12 lagret eiendom står uendret når ordren endres (A251)", async () => {
    const { org, admin } = await orgWithAdmin();
    const { order, assignment } = await insertConvertedOrder(org.id);
    await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Testveien 1",
      gnr: "999",
      bnr: "999",
    });
    const before = await getAssignmentProperty(admin, org.id, assignment.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS, gnr: "56", bnr: "78" }),
      order.rowVersion,
    );

    const after = await getAssignmentProperty(admin, org.id, assignment.id);
    expect(after).toEqual(before);
    expect(after.property?.address).toBe("Testveien 1");
  });
});

// ---------------------------------------------------------------------------------------------
// 2.5 Låsen med row_version (A253)
// ---------------------------------------------------------------------------------------------

describe("2.5 låsen med row_version", () => {
  it("2.5.1 første endring rett etter oppretting med rowVersion fra getOrder godtas", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, fullInput() as CreateInput, NOW);
    const opened = await getOrder(admin, org.id, created.id);
    expect(typeof opened.rowVersion).toBe("number");

    const updated = await updateOrder(
      admin,
      org.id,
      created.id,
      editInput(await orderRow(created.id), { addressText: NEW_ADDRESS }),
      opened.rowVersion,
    );
    expect(updated.addressText).toBe(NEW_ADDRESS);
    expect(updated.rowVersion).toBe(opened.rowVersion + 1);
  });

  it("2.5.2 to endringer etter hverandre med samme versjon: den andre gir OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    const before = await snapshot(org.id, order.id);
    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: "Prøvegata 8, 8006 Bodø" }),
        order.rowVersion,
      ),
    ).rejects.toThrow(OrderChangedError);

    await expectUnchanged(org.id, order.id, before);
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);
    expect(await updateAuditFor(org.id, order.id)).toHaveLength(1);
  });

  it("2.5.3 versjonen fra før avvisning gir OrderChangedError; ordren er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const before = await snapshot(org.id, order.id);
    expect(before.order.rowVersion).toBeGreaterThan(order.rowVersion);

    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(OrderChangedError);
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.5.4 versjonen fra før konvertering gir OrderChangedError", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });
    const before = await snapshot(org.id, order.id);
    expect(before.order.rowVersion).toBeGreaterThan(order.rowVersion);

    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toThrow(OrderChangedError);
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.5.5 to samtidige lagringer med samme versjon: nøyaktig én lykkes", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);

    const results = await Promise.allSettled([
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: "Prøvegata 1, 8006 Bodø" }),
        order.rowVersion,
      ),
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: "Prøvegata 2, 8006 Bodø" }),
        order.rowVersion,
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderChangedError);
    expect(await updateAuditFor(org.id, order.id)).toHaveLength(1);
    expect(await updatedEventsFor(org.id)).toHaveLength(1);
    expect((await orderRow(order.id)).rowVersion).toBe(order.rowVersion + 1);
  });

  it("2.5.6 for høy versjon gir OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const before = await snapshot(org.id, order.id);

    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        editInput(order, { addressText: NEW_ADDRESS }),
        order.rowVersion + 1,
      ),
    ).rejects.toThrow(OrderChangedError);
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.5 OrderChangedError har fast melding og navn (1.5)", () => {
    const error = new OrderChangedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(CONFLICT_MESSAGE);
    expect(error.name).toBe("OrderChangedError");
  });
});

// ---------------------------------------------------------------------------------------------
// 2.6 Revisjonslogg, hendelse og applikasjonslogg (A252)
// ---------------------------------------------------------------------------------------------

describe("2.6 revisjonslogg, hendelse og applikasjonslogg", () => {
  it("2.6.1 én lagring gir nøyaktig én loggrad med hvem og når", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const { actor, employee } = await person(org.id, ["office"]);
    const auditBefore = (await auditFor(org.id)).length;

    await updateOrder(
      actor,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );

    const rows = await auditFor(org.id);
    expect(rows).toHaveLength(auditBefore + 1);
    const updates = await updateAuditFor(org.id);
    expect(updates).toHaveLength(1);
    const [row] = updates;
    expect(row).toMatchObject({
      entityType: "order",
      action: "update",
      entityId: order.id,
      organizationId: org.id,
      actorEmployeeId: employee.id,
    });
    expect(row?.occurredAt).toBeInstanceOf(Date);
  });

  it("2.6.2 changes er nøyaktig { fields, values }; fields i fast rekkefølge uansett input", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);

    // Rekkefølgen i input er bevisst baklengs
    const input = {
      sellerDeclarationReceived: true,
      housingAssociationName: "Prøvehøgda sameie",
      bnr: "78",
      gnr: "56",
      addressText: NEW_ADDRESS,
      externalRef: NEW_EXTERNAL_REF,
      receivedAt: NEW_RECEIVED_AT,
    };
    await updateOrder(admin, org.id, order.id, editInput(order, input), order.rowVersion);

    const [row] = await updateAuditFor(org.id, order.id);
    const changes = row?.changes as { fields: string[]; values: Record<string, unknown> };
    expect(Object.keys(changes).sort()).toEqual(["fields", "values"]);
    const expectedFields = ORDER_EDITABLE_FIELDS.filter((code) => code in input);
    expect(changes.fields).toEqual(expectedFields);
    expect(changes.fields).toEqual([
      "receivedAt",
      "externalRef",
      "addressText",
      "gnr",
      "bnr",
      "housingAssociationName",
      "sellerDeclarationReceived",
    ]);
    expect(Object.keys(changes.values).sort()).toEqual([...expectedFields].sort());
    for (const code of expectedFields) {
      expect(Object.keys(changes.values[code] as object).sort(), code).toEqual(["from", "to"]);
    }
    expect(changes.values.addressText).toEqual({ from: OLD_ADDRESS, to: NEW_ADDRESS });
    expect(changes.values.gnr).toEqual({ from: "12", to: "56" });
    expect(changes.values.sellerDeclarationReceived).toEqual({ from: false, to: true });
    for (const code of changes.fields) {
      expect(ORDER_EDITABLE_FIELDS as readonly string[]).toContain(code);
    }
  });

  it("2.6.3 bestilleren som id-er, receivedAt som ISO-tekst, tom verdi som null", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, {
      firstName: "Megler",
      lastName: "Kontaktesen",
      firmId: firm.id,
    });
    const order = await savedOrder(admin, org.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, {
        orderedByContactId: contact.id,
        receivedAt: NEW_RECEIVED_AT,
        externalRef: "",
      }),
      order.rowVersion,
    );

    const [row] = await updateAuditFor(org.id, order.id);
    const values = (row?.changes as { values: Record<string, unknown> }).values;
    expect(values.orderedByContactId).toEqual({ from: null, to: contact.id });
    expect(values.orderedByFirmId).toEqual({ from: null, to: firm.id });
    expect(values.receivedAt).toEqual({
      from: new Date(RECEIVED_AT).toISOString(),
      to: new Date(NEW_RECEIVED_AT).toISOString(),
    });
    expect(values.externalRef).toEqual({ from: EXTERNAL_REF, to: null });
    expect(JSON.stringify(row?.changes)).not.toContain("Kontaktesen");
  });

  it("2.6.4 hendelsen order.updated har bare { orderId, fields } og ingen av verdiene", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, {
      firstName: "Megler",
      lastName: "Kontaktesen",
      firmId: firm.id,
    });
    const order = await savedOrder(admin, org.id, { gnr: LEAK_GNR, bnr: LEAK_BNR });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, {
        addressText: NEW_ADDRESS,
        orderedByText: NEW_ORDERED_BY,
        orderedByContactId: contact.id,
        gnr: "56",
        bnr: "78",
        snr: "",
        housingAssociationName: "",
        externalRef: NEW_EXTERNAL_REF,
      }),
      order.rowVersion,
    );

    const updated = await updatedEventsFor(org.id);
    expect(updated).toHaveLength(1);
    const [event] = updated;
    expect(event?.organizationId).toBe(org.id);
    expect(event?.data).toEqual({
      orderId: order.id,
      fields: [
        "externalRef",
        "orderedByText",
        "orderedByContactId",
        "orderedByFirmId",
        "addressText",
        "gnr",
        "bnr",
        "snr",
        "housingAssociationName",
      ],
    });
    const json = JSON.stringify(event);
    for (const value of [...SECRET_VALUES, "Kontaktesen", "Prøvehøgda"]) {
      expect(json, value).not.toContain(value);
    }
  });

  it.each([
    ["samme verdier", {}],
    [
      "samme verdier med annen trimming",
      {
        addressText: `  ${OLD_ADDRESS}  `,
        orderedByText: ` ${ORDERED_BY}`,
        externalRef: `${EXTERNAL_REF}   `,
        gnr: " 12 ",
        housingAssociationName: `${HOUSING} `,
      },
    ],
  ])(
    "2.6.5 lagring uten endring (%s): ingen loggrad, ingen hendelse, samme row_version",
    async (_name, overrides) => {
      const { org, admin } = await orgWithAdmin();
      const order = await savedOrder(admin, org.id);
      const before = await snapshot(org.id, order.id);

      await updateOrder(admin, org.id, order.id, editInput(order, overrides), order.rowVersion);

      await expectUnchanged(org.id, order.id, before);
      expect(await updateAuditFor(org.id)).toEqual([]);
      expect(await updatedEventsFor(org.id)).toEqual([]);
    },
  );

  it("2.6.5b «Mottatt» med sekunder: samme minutt fra skjemaet er ingen endring, nytt minutt er det", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id, { receivedAt: "2026-11-02T08:00:37.000Z" });
    const before = await snapshot(org.id, order.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { receivedAt: "2026-11-02T08:00:00.000Z" }),
      order.rowVersion,
    );
    await expectUnchanged(org.id, order.id, before);
    expect(await updateAuditFor(org.id)).toEqual([]);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { receivedAt: "2026-11-02T08:01:00.000Z" }),
      order.rowVersion,
    );
    const updates = await updateAuditFor(org.id, order.id);
    expect(updates.map((update) => update.changes.fields)).toEqual([["receivedAt"]]);
  });

  it("2.6.6 bare kontakten byttes: firmaet med i fields bare når firmaet også endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const firmOne = await createFirm(org.id, { name: "Testmegling En AS" });
    const firmTwo = await createFirm(org.id, { name: "Testmegling To AS" });
    const first = await createContact(org.id, { lastName: "Først", firmId: firmOne.id });
    const sameFirm = await createContact(org.id, { lastName: "Sammefirma", firmId: firmOne.id });
    const otherFirm = await createContact(org.id, { lastName: "Annetfirma", firmId: firmTwo.id });
    const order = await savedOrder(admin, org.id, { orderedByContactId: first.id });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { orderedByContactId: sameFirm.id }),
      order.rowVersion,
    );
    const row = await orderRow(order.id);
    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(row, { orderedByContactId: otherFirm.id }),
      row.rowVersion,
    );

    const updates = (await updateAuditFor(org.id, order.id)).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    expect(updates.map((update) => update.changes.fields)).toEqual([
      ["orderedByContactId"],
      ["orderedByContactId", "orderedByFirmId"],
    ]);
  });

  it("2.6.7 ingen loggrad og ingen hendelse ved avslag, ZodError, ContactNotFoundError og OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await savedOrder(admin, org.id);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const before = await snapshot(org.id, order.id);

    const attempts: [string, () => Promise<unknown>, new (...args: never[]) => Error][] = [
      [
        "avslag",
        () =>
          updateOrder(
            inspector,
            org.id,
            order.id,
            editInput(order, { addressText: NEW_ADDRESS }),
            order.rowVersion,
          ),
        AccessDeniedError,
      ],
      [
        "ZodError",
        () =>
          updateOrder(admin, org.id, order.id, editInput(order, { gnr: "x" }), order.rowVersion),
        ZodError,
      ],
      [
        "ContactNotFoundError",
        () =>
          updateOrder(
            admin,
            org.id,
            order.id,
            editInput(order, { orderedByContactId: randomUUID(), addressText: NEW_ADDRESS }),
            order.rowVersion,
          ),
        ContactNotFoundError,
      ],
      [
        "OrderChangedError",
        () =>
          updateOrder(
            admin,
            org.id,
            order.id,
            editInput(order, { addressText: NEW_ADDRESS }),
            order.rowVersion + 5,
          ),
        OrderChangedError,
      ],
    ];
    for (const [name, run, type] of attempts) {
      expect(await caught(run()), name).toBeInstanceOf(type);
    }
    await expectUnchanged(org.id, order.id, before);
  });

  it("2.6.8 og 2.6.9 ingen verdier i applikasjonsloggen eller i feilmeldingene, også i feilgrenene", async () => {
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id, { gnr: LEAK_GNR, bnr: LEAK_BNR });
    const leakyInput = {
      addressText: NEW_ADDRESS,
      orderedByText: NEW_ORDERED_BY,
      externalRef: NEW_EXTERNAL_REF,
      housingAssociationName: "Testtoppen borettslag nord",
    };

    // Vellykket lagring
    await updateOrder(admin, org.id, order.id, editInput(order, leakyInput), order.rowVersion);
    const saved = await orderRow(order.id);

    // Feilgrenene
    const errors = [
      await caught(
        updateOrder(
          admin,
          org.id,
          order.id,
          editInput(saved, { ...leakyInput, addressText: "", gnr: `${LEAK_GNR}x` }),
          saved.rowVersion,
        ),
      ),
      await caught(
        updateOrder(
          admin,
          org.id,
          order.id,
          editInput(order, { addressText: OLD_ADDRESS }),
          order.rowVersion,
        ),
      ),
      await caught(
        updateOrder(
          admin,
          org.id,
          order.id,
          editInput(saved, { orderedByContactId: randomUUID(), addressText: OLD_ADDRESS }),
          saved.rowVersion,
        ),
      ),
    ];
    expect(errors[0]).toBeInstanceOf(ZodError);
    expect(errors[1]).toBeInstanceOf(OrderChangedError);
    expect(errors[2]).toBeInstanceOf(ContactNotFoundError);

    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const value of SECRET_VALUES) {
      expect(logged, `applikasjonsloggen har ${value}`).not.toContain(value);
    }
    for (const error of errors) {
      const message = (error as Error).message;
      for (const value of SECRET_VALUES) {
        expect(message, `feilmeldingen har ${value}`).not.toContain(value);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2.7 Endringene (listOrderHistory)
// ---------------------------------------------------------------------------------------------

describe("2.7 endringene på ordren", () => {
  it("2.7.1 opprettet, endret to ganger og gjort om gir fire rader, nyeste først", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await changeAddress(admin, org.id, order.id, NEW_ADDRESS);
    await changeAddress(admin, org.id, order.id, "Prøvegata 8, 8006 Bodø");
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: NOW });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["convert", "update", "update", "create"]);
    const times = history.map((row) => row.occurredAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const row of history) {
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.actorName).toBe("Test Admin");
    }
  });

  it("2.7.1 avvist ordre har raden reject", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["reject", "create"]);
  });

  it("2.7.2 én verdi-linje per felt med from og to; kontakt med navn; slettet kontakt som «(fjernet kontakt)»", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const first = await createContact(org.id, { firstName: "Megler", lastName: "Førstesen" });
    const second = await createContact(org.id, { firstName: "Megler", lastName: "Andresen" });
    const order = await savedOrder(admin, org.id, { orderedByContactId: first.id });

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(order, { addressText: NEW_ADDRESS, orderedByContactId: second.id }),
      order.rowVersion,
    );

    let [update] = (await listOrderHistory(admin, org.id, order.id)).filter(
      (row) => row.action === "update",
    );
    expect(update?.fields).toEqual(["orderedByContactId", "addressText"]);
    expect(update?.values).toHaveLength(2);
    const address = update?.values.find((value) => value.field === "addressText");
    expect(address).toEqual({ field: "addressText", from: OLD_ADDRESS, to: NEW_ADDRESS });
    const contact = update?.values.find((value) => value.field === "orderedByContactId");
    expect(String(contact?.from)).toContain("Førstesen");
    expect(String(contact?.to)).toContain("Andresen");

    // Den første kontakten slettes (myk sletting): navnet vises ikke lenger
    await db
      .update(contacts)
      .set({ deletedAt: new Date("2026-11-04T08:00:00Z"), deletedBy: adminEmployee.id })
      .where(eq(contacts.id, first.id));
    [update] = (await listOrderHistory(admin, org.id, order.id)).filter(
      (row) => row.action === "update",
    );
    const afterDelete = update?.values.find((value) => value.field === "orderedByContactId");
    expect(afterDelete?.from).toBe("(fjernet kontakt)");
    expect(String(afterDelete?.to)).toContain("Andresen");
  });

  it("2.7.3 actorName er navnet også når den ansatte er myk-slettet; raden står", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const { actor, employee } = await person(org.id, ["office"], "Oppdiktet Sluttet");
    await changeAddress(actor, org.id, order.id, NEW_ADDRESS);
    await db
      .update(employees)
      .set({ deletedAt: new Date("2026-11-04T08:00:00Z") })
      .where(eq(employees.id, employee.id));

    const history = await listOrderHistory(admin, org.id, order.id);
    const update = history.find((row) => row.action === "update");
    expect(update?.actorName).toBe("Oppdiktet Sluttet");
    expect(history).toHaveLength(2);
  });

  it("2.7.4 rader for en annen ordre og rader med annen entity_type og samme id står ikke i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const other = await savedOrder(admin, org.id);
    await changeAddress(admin, org.id, other.id, NEW_ADDRESS);
    const sameIdOtherType = await insertAuditRow({
      organizationId: org.id,
      entityId: order.id,
      entityType: "assignment",
      changes: { fields: ["addressText"] },
    });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.map((row) => row.action)).toEqual(["create"]);
    expect(history.map((row) => row.id)).not.toContain(sameIdOtherType.id);
  });

  it("2.7.5 ukjente feltkoder og rare values hoppes over, ingen unntak", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    const rows = [
      {
        fields: ["hemmeligFelt", "addressText"],
        values: {
          hemmeligFelt: { from: "a", to: "b" },
          addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
        },
      },
      { fields: ["addressText"], values: "ikke et objekt" },
      { fields: ["addressText"], values: { addressText: { from: OLD_ADDRESS } } },
      { fields: ["addressText"], values: { addressText: "Prøvegata 1" } },
      { fields: "ikke en liste", values: null },
      { fields: [42, null, { a: 1 }], values: [] },
      {},
    ];
    for (const [index, changes] of rows.entries()) {
      await insertAuditRow({
        organizationId: org.id,
        entityId: order.id,
        changes: changes as Record<string, unknown>,
        occurredAt: new Date(NOW.getTime() + (index + 1) * 60_000),
      });
    }

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(rows.length + 1);
    const json = JSON.stringify(history);
    expect(json).not.toContain("hemmeligFelt");
    for (const row of history) {
      expect(Array.isArray(row.fields)).toBe(true);
      expect(Array.isArray(row.values)).toBe(true);
      for (const code of row.fields) {
        expect(ORDER_EDITABLE_FIELDS as readonly string[]).toContain(code);
      }
      for (const value of row.values) {
        expect(ORDER_EDITABLE_FIELDS as readonly string[]).toContain(value.field);
        expect(Object.keys(value).sort()).toEqual(["field", "from", "to"]);
      }
    }
    // Den første raden (eldst av de innsatte) har én gyldig verdi-linje
    const valid = history.find((row) => row.values.some((value) => value.to === NEW_ADDRESS));
    expect(valid?.values).toEqual([{ field: "addressText", from: OLD_ADDRESS, to: NEW_ADDRESS }]);
  });

  it("2.7.6 svaret har faste nøkler, ingen changes og ingen organizationId", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await savedOrder(admin, org.id);
    await changeAddress(admin, org.id, order.id, NEW_ADDRESS);

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.length).toBeGreaterThan(0);
    for (const row of history) {
      for (const key of ["id", "action", "actorName", "occurredAt", "fields", "values"]) {
        expect(row).toHaveProperty(key);
      }
      for (const key of ["changes", "organizationId", "actorEmployeeId", "deviceId"]) {
        expect(row).not.toHaveProperty(key);
      }
    }
  });

  it("2.7.7 201 loggrader gir høyst 200, de nyeste", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const base = NOW.getTime();
    const values = Array.from({ length: 201 }, (_, index) => ({
      organizationId: org.id,
      entityType: "order",
      entityId: order.id,
      action: "update",
      changes: { fields: ["gnr"], values: { gnr: { from: String(index), to: String(index + 1) } } },
      occurredAt: new Date(base + index * 1000),
    }));
    const inserted = await db.insert(auditLog).values(values).returning({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
    });
    const oldest = inserted.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b));

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(200);
    expect(history.map((row) => row.id)).not.toContain(oldest.id);
    expect(history[0]?.occurredAt).toEqual(new Date(base + 200 * 1000));
  });

  it("2.7.8 getOrder gir rowVersion som tall, lik raden", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const detail = await getOrder(admin, org.id, order.id);
    expect(detail.rowVersion).toBe(order.rowVersion);
    await changeAddress(admin, org.id, order.id, NEW_ADDRESS);
    expect((await getOrder(admin, org.id, order.id)).rowVersion).toBe(order.rowVersion + 1);
  });
});
