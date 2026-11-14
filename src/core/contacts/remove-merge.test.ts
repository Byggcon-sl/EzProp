import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, or } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  auditLog,
  contacts,
  employees,
  firms,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  TEST_NOW,
  createAssignment,
  createAssignmentParty,
  createContact as insertContact,
  createEmployee,
  createFirm as insertFirm,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  MergeSameRecordError,
  createFirm,
  getContact,
  getFirm,
  listContacts,
  listFirms,
  mergeContacts,
  mergeFirms,
  removeContact,
  removeFirm,
} from "./index";

/*
 * Fjerne og slå sammen kontakter og firma: kjernen i src/core/contacts.
 * Testplan: docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md avsnitt 2.
 * Samtidigheten står i remove-merge-concurrency.test.ts, handlingene i actions.test.ts.
 *
 * Avvises uten: 2.1 (expectTenantIsolation for alle fire), 2.2 (tilgang per rolle), 2.3 (IDOR)
 * og 2.5.1/2.5.4 (raden finnes med deleted_at). Ingen test bruker `delete` for å vise fjerning.
 *
 * Testdata er oppdiktet: «Megler Test», «Testmegling AS», megler@example.com, 00000000,
 * organisasjonsnummer fra nextFakeOrgNumber(), notat «Testnotat».
 *
 * Støtter hovedmål: reklamasjoner (ingen rad peker på en fjernet kontakt etter sammenslåing, og
 * ingen kan endre data i en annen organisasjon) og KI først (ingen personopplysninger i
 * revisjonsloggen).
 */

// Pakket inn slik at 2.4.6 kan la revisjonsloggen feile én gang. Ellers kalles den ekte.
vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordAuditEvent).mockClear();
});

const FIRST = "Megler";
const LAST = "Test";
const OTHER_FIRST = "Annen";
const OTHER_LAST = "Meglersen";
const EMAIL = "megler@example.com";
const PHONE = "00000000";
const NOTE = "Testnotat";
const FIRM_NAME = "Testmegling AS";
const DELETED = new Date("2026-11-01T08:00:00Z");

const SERVICES = ["removeContact", "removeFirm", "mergeContacts", "mergeFirms"] as const;
type ServiceName = (typeof SERVICES)[number];

const EVENT_CODES: Record<ServiceName, string> = {
  removeContact: "contact.removed",
  removeFirm: "firm.removed",
  mergeContacts: "contact.merged",
  mergeFirms: "firm.merged",
};

const METADATA_KEYS: Record<ServiceName, string[]> = {
  removeContact: ["contactId"],
  removeFirm: ["contactCount", "firmId"],
  mergeContacts: ["assignmentCount", "keepId", "orderCount", "partyCount", "removeId"],
  mergeFirms: ["assignmentCount", "contactCount", "keepId", "orderCount", "partyCount", "removeId"],
};

// ---------------------------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------------------------

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** En person med rollene i organisasjonen. Gir innlogget bruker og ansattraden. */
async function person(organizationId: string, roles: EmployeeRole[], name = "Test Ansatt") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/**
 * Kontaktgrafen i én organisasjon:
 * - `firmKeep` og `firmRemove` (to like firma, ulike organisasjonsnummer),
 * - `contactKeep` i `firmKeep`, `contactRemove` i `firmRemove`, `contactOther` i `firmKeep`,
 *   og en myk-slettet kontakt i `firmRemove`,
 * - parter: én per kontakt (firmaet følger kontakten), én myk-slettet på `contactRemove`, og én
 *   med bare `firmRemove`,
 * - ordrer: én per kontakt, og én med bare `firmRemove`,
 * - oppdrag med bestiller (ADR 0011): ett på `contactKeep`, ett på `contactRemove`, ett kansellert
 *   (myk-slettet) på `contactRemove`, og ett med bare `firmRemove`.
 * Fritekstene er de oppdiktede verdiene over.
 */
async function createGraph(organizationId: string) {
  const firmKeep = await insertFirm(organizationId, { name: FIRM_NAME, notes: NOTE });
  const firmRemove = await insertFirm(organizationId, { name: FIRM_NAME, notes: NOTE });
  const contactFields = { email: EMAIL, phone: PHONE, notes: NOTE };
  const contactKeep = await insertContact(organizationId, {
    firstName: FIRST,
    lastName: LAST,
    firmId: firmKeep.id,
    ...contactFields,
  });
  const contactRemove = await insertContact(organizationId, {
    firstName: FIRST,
    lastName: LAST,
    firmId: firmRemove.id,
    ...contactFields,
  });
  const contactOther = await insertContact(organizationId, {
    firstName: OTHER_FIRST,
    lastName: OTHER_LAST,
    firmId: firmKeep.id,
    ...contactFields,
  });
  const contactDeleted = await insertContact(organizationId, {
    firstName: FIRST,
    lastName: LAST,
    firmId: firmRemove.id,
    deletedAt: DELETED,
    ...contactFields,
  });

  const partyText = { name: `${FIRST} ${LAST}`, firmName: FIRM_NAME, email: EMAIL, phone: PHONE };
  const partyKeep = await createAssignmentParty(organizationId, {
    ...partyText,
    contactId: contactKeep.id,
    firmId: firmKeep.id,
  });
  const partyRemove = await createAssignmentParty(organizationId, {
    ...partyText,
    contactId: contactRemove.id,
    firmId: firmRemove.id,
  });
  const partyRemoveDeleted = await createAssignmentParty(organizationId, {
    ...partyText,
    contactId: contactRemove.id,
    firmId: firmRemove.id,
    deletedAt: DELETED,
  });
  const partyFirmOnly = await createAssignmentParty(organizationId, {
    ...partyText,
    contactId: null,
    firmId: firmRemove.id,
  });
  const partyOther = await createAssignmentParty(organizationId, {
    ...partyText,
    name: `${OTHER_FIRST} ${OTHER_LAST}`,
    contactId: contactOther.id,
    firmId: firmKeep.id,
  });

  const orderedByText = `${FIRST} ${LAST}, ${FIRM_NAME}`;
  const orderKeep = await createOrder(organizationId, {
    orderedByText,
    orderedByContactId: contactKeep.id,
    orderedByFirmId: firmKeep.id,
  });
  const orderRemove = await createOrder(organizationId, {
    orderedByText,
    orderedByContactId: contactRemove.id,
    orderedByFirmId: firmRemove.id,
  });
  const orderFirmOnly = await createOrder(organizationId, {
    orderedByText,
    orderedByContactId: null,
    orderedByFirmId: firmRemove.id,
  });
  const orderOther = await createOrder(organizationId, {
    orderedByText: `${OTHER_FIRST} ${OTHER_LAST}, ${FIRM_NAME}`,
    orderedByContactId: contactOther.id,
    orderedByFirmId: firmKeep.id,
  });

  const assignmentKeep = await createAssignment(organizationId, {
    orderedByText,
    orderedByContactId: contactKeep.id,
    orderedByFirmId: firmKeep.id,
  });
  const assignmentRemove = await createAssignment(organizationId, {
    orderedByText,
    orderedByContactId: contactRemove.id,
    orderedByFirmId: firmRemove.id,
  });
  const assignmentRemoveCancelled = await createAssignment(organizationId, {
    orderedByText,
    orderedByContactId: contactRemove.id,
    orderedByFirmId: firmRemove.id,
    deletedAt: DELETED,
  });
  const assignmentFirmOnly = await createAssignment(organizationId, {
    orderedByText,
    orderedByContactId: null,
    orderedByFirmId: firmRemove.id,
  });

  return {
    organizationId,
    firmKeep,
    firmRemove,
    contactKeep,
    contactRemove,
    contactOther,
    contactDeleted,
    partyKeep,
    partyRemove,
    partyRemoveDeleted,
    partyFirmOnly,
    partyOther,
    orderKeep,
    orderRemove,
    orderFirmOnly,
    orderOther,
    assignmentKeep,
    assignmentRemove,
    assignmentRemoveCancelled,
    assignmentFirmOnly,
  };
}
type Graph = Awaited<ReturnType<typeof createGraph>>;

/** Antallene grafen over gir, skrevet ut for hånd (også myk-slettede rader). */
const GRAPH_COUNTS = {
  mergeContacts: { partyCount: 2, orderCount: 1, assignmentCount: 2 },
  mergeFirms: { contactCount: 2, partyCount: 3, orderCount: 2, assignmentCount: 3 },
  removeFirm: { contactCount: 1 },
};

/** Kjører tjenesten mot grafen: fjerner eller slår sammen «remove» inn i «keep». */
function runService(name: ServiceName, actor: Actor, organizationId: string, graph: Graph) {
  switch (name) {
    case "removeContact":
      return removeContact(actor, organizationId, graph.contactRemove.id);
    case "removeFirm":
      return removeFirm(actor, organizationId, graph.firmRemove.id);
    case "mergeContacts":
      return mergeContacts(actor, organizationId, {
        keepId: graph.contactKeep.id,
        removeId: graph.contactRemove.id,
      });
    case "mergeFirms":
      return mergeFirms(actor, organizationId, {
        keepId: graph.firmKeep.id,
        removeId: graph.firmRemove.id,
      });
  }
}

/**
 * Alt fjerning og sammenslåing kan endre, i alle organisasjoner, sortert på id: `deleted_at`,
 * `updated_at` og firma på kontakter, `deleted_at` og `updated_at` på firma, koblingene på
 * parter og ordrer. Sammenlignes før og etter et avvist kall.
 */
async function snapshotContactGraph() {
  return {
    contacts: await db
      .select({
        id: contacts.id,
        deletedAt: contacts.deletedAt,
        updatedAt: contacts.updatedAt,
        firmId: contacts.firmId,
      })
      .from(contacts)
      .orderBy(asc(contacts.id)),
    firms: await db
      .select({ id: firms.id, deletedAt: firms.deletedAt, updatedAt: firms.updatedAt })
      .from(firms)
      .orderBy(asc(firms.id)),
    parties: await db
      .select({
        id: assignmentParties.id,
        contactId: assignmentParties.contactId,
        firmId: assignmentParties.firmId,
      })
      .from(assignmentParties)
      .orderBy(asc(assignmentParties.id)),
    orders: await db
      .select({
        id: orders.id,
        orderedByContactId: orders.orderedByContactId,
        orderedByFirmId: orders.orderedByFirmId,
      })
      .from(orders)
      .orderBy(asc(orders.id)),
    assignments: await db
      .select({
        id: assignments.id,
        orderedByContactId: assignments.orderedByContactId,
        orderedByFirmId: assignments.orderedByFirmId,
        rowVersion: assignments.rowVersion,
      })
      .from(assignments)
      .orderBy(asc(assignments.id)),
  };
}

/** Radene i revisjonsloggen for kontakter og firma (alle organisasjoner). */
async function contactAuditRows() {
  return db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.entityType, ["contact", "firm"]))
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
}

/**
 * Hendelseskoden på en rad. Kjernen kan skrive hele koden i `action` («contact.removed») eller
 * dele den på `entity_type` («contact») og `action` («removed»); begge gir samme kode.
 */
function eventCode(row: { entityType: string; action: string }) {
  return row.action.includes(".") ? row.action : `${row.entityType}.${row.action}`;
}

async function expectDenied(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AccessDeniedError);
}

async function contactRow(id: string) {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  return row;
}

async function firmRow(id: string) {
  const [row] = await db.select().from(firms).where(eq(firms.id, id));
  return row;
}

async function partyRow(id: string) {
  const [row] = await db.select().from(assignmentParties).where(eq(assignmentParties.id, id));
  return row!;
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

async function assignmentRow(id: string) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
  return row!;
}

/** Loggradene `update` for bestillingen på ordre og oppdrag (alle organisasjoner). */
async function bookingAuditRows() {
  return db
    .select()
    .from(auditLog)
    .where(
      and(inArray(auditLog.entityType, ["order", "assignment"]), eq(auditLog.action, "update")),
    )
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
}

/** Ett oppsett: organisasjon A med admin og graf, og organisasjon B med graf. */
async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const admin = await person(orgA.id, ["admin"], "Test Admin");
  const graphA = await createGraph(orgA.id);
  const graphB = await createGraph(orgB.id);
  return { orgA, orgB, admin, graphA, graphB };
}

// ---------------------------------------------------------------------------------------------
// 2.1 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

describe("2.1 tenant-isolasjon", () => {
  // `seed` lager raden(e) per organisasjon og husker id-ene her, `query` slår opp på organisasjonen.
  it("2.1.1 removeContact_tenant_isolation", async () => {
    const seeded = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const contact = await insertContact(grant.organizationId, { email: EMAIL });
          seeded.set(grant.organizationId, contact.id);
        }
        return { a: [seeded.get(grantA.organizationId)!], b: [seeded.get(grantB.organizationId)!] };
      },
      query: async (actor, organizationId) => {
        const id = seeded.get(organizationId) ?? randomUUID();
        await removeContact(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });
    // Begge er fjernet av egen organisasjon, og radene finnes
    for (const id of seeded.values()) expect((await contactRow(id))?.deletedAt).not.toBeNull();
  });

  it("2.1.2 removeFirm_tenant_isolation", async () => {
    const seeded = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const firm = await insertFirm(grant.organizationId);
          seeded.set(grant.organizationId, firm.id);
        }
        return { a: [seeded.get(grantA.organizationId)!], b: [seeded.get(grantB.organizationId)!] };
      },
      query: async (actor, organizationId) => {
        const id = seeded.get(organizationId) ?? randomUUID();
        await removeFirm(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });
    for (const id of seeded.values()) expect((await firmRow(id))?.deletedAt).not.toBeNull();
  });

  it("2.1.3 mergeContacts_tenant_isolation", async () => {
    const seeded = new Map<string, { keepId: string; removeId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const keep = await insertContact(grant.organizationId);
          const remove = await insertContact(grant.organizationId);
          await createAssignmentParty(grant.organizationId, { contactId: remove.id });
          seeded.set(grant.organizationId, { keepId: keep.id, removeId: remove.id });
        }
        return {
          a: [seeded.get(grantA.organizationId)!.removeId],
          b: [seeded.get(grantB.organizationId)!.removeId],
        };
      },
      query: async (actor, organizationId) => {
        const ids = seeded.get(organizationId) ?? { keepId: randomUUID(), removeId: randomUUID() };
        await mergeContacts(actor, organizationId, ids);
        return [{ id: ids.removeId }];
      },
      idOf: (row) => row.id,
    });
    for (const { keepId, removeId } of seeded.values()) {
      expect((await contactRow(removeId))?.deletedAt).not.toBeNull();
      expect((await contactRow(keepId))?.deletedAt).toBeNull();
    }
  });

  it("2.1.4 mergeFirms_tenant_isolation", async () => {
    const seeded = new Map<string, { keepId: string; removeId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const keep = await insertFirm(grant.organizationId);
          const remove = await insertFirm(grant.organizationId);
          await insertContact(grant.organizationId, { firmId: remove.id });
          seeded.set(grant.organizationId, { keepId: keep.id, removeId: remove.id });
        }
        return {
          a: [seeded.get(grantA.organizationId)!.removeId],
          b: [seeded.get(grantB.organizationId)!.removeId],
        };
      },
      query: async (actor, organizationId) => {
        const ids = seeded.get(organizationId) ?? { keepId: randomUUID(), removeId: randomUUID() };
        await mergeFirms(actor, organizationId, ids);
        return [{ id: ids.removeId }];
      },
      idOf: (row) => row.id,
    });
    for (const { keepId, removeId } of seeded.values()) {
      expect((await firmRow(removeId))?.deletedAt).not.toBeNull();
      expect((await firmRow(keepId))?.deletedAt).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2.2 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("2.2 tilgang per rolle", () => {
  const deniedCases = SERVICES.flatMap((service) => [
    {
      label: "2.2.1 inspector_denied (innstillingen på)",
      role: "inspector" as const,
      editAll: true,
      service,
    },
    {
      label: "2.2.1 inspector_denied (innstillingen av)",
      role: "inspector" as const,
      editAll: false,
      service,
    },
    { label: "2.2.2 office_denied", role: "office" as const, editAll: true, service },
  ]);

  it.each(deniedCases)("$label: $service", async ({ role, editAll, service }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const { actor } = await person(org.id, [role]);
    const graph = await createGraph(org.id);
    const before = await snapshotContactGraph();

    await expectDenied(runService(service, actor, org.id, graph));

    expect(await snapshotContactGraph()).toEqual(before);
    const [audit] = await db.select({ n: count() }).from(auditLog);
    expect(audit?.n).toBe(0);
  });

  const allowedCases = SERVICES.flatMap((service) => [
    { label: "2.2.3 manager_allowed", roles: ["manager"] as EmployeeRole[], service },
    { label: "2.2.3 admin_allowed", roles: ["admin"] as EmployeeRole[], service },
  ]);

  it.each(allowedCases)("$label: $service", async ({ roles, service }) => {
    const org = await createOrganization();
    const { actor } = await person(org.id, roles);
    const graph = await createGraph(org.id);

    await runService(service, actor, org.id, graph);

    const isFirm = service === "removeFirm" || service === "mergeFirms";
    const row = isFirm
      ? await firmRow(graph.firmRemove.id)
      : await contactRow(graph.contactRemove.id);
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await contactAuditRows()).toHaveLength(1);
  });

  it.each(SERVICES)("2.2.4 deleted_employee_denied: %s", async (service) => {
    const org = await createOrganization();
    const { actor, employee } = await person(org.id, ["manager"]);
    await db.update(employees).set({ deletedAt: DELETED }).where(eq(employees.id, employee.id));
    const graph = await createGraph(org.id);
    const before = await snapshotContactGraph();

    await expectDenied(runService(service, actor, org.id, graph));

    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(0);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it.each(SERVICES.flatMap((service) => [true, false].map((editAll) => ({ service, editAll }))))(
    "2.2.5 admin_never_locked_out: admin uten lederrolle, innstillingen $editAll: $service",
    async ({ service, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, ["admin"]);
      const graph = await createGraph(org.id);

      await runService(service, actor, org.id, graph);
      expect(await contactAuditRows()).toHaveLength(1);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 2.3 IDOR i egen organisasjon
// ---------------------------------------------------------------------------------------------

type IdorCase = {
  name: string;
  run: (actor: Actor, organizationId: string, a: Graph, b: Graph) => Promise<unknown>;
};

const idorCases: IdorCase[] = [
  {
    name: "2.3.1 mergeContacts_foreign_keepId",
    run: (actor, org, a, b) =>
      mergeContacts(actor, org, { keepId: b.contactKeep.id, removeId: a.contactRemove.id }),
  },
  {
    name: "2.3.2 mergeContacts_foreign_removeId",
    run: (actor, org, a, b) =>
      mergeContacts(actor, org, { keepId: a.contactKeep.id, removeId: b.contactRemove.id }),
  },
  {
    name: "2.3.3 mergeContacts_both_foreign",
    run: (actor, org, _a, b) =>
      mergeContacts(actor, org, { keepId: b.contactKeep.id, removeId: b.contactRemove.id }),
  },
  {
    name: "2.3.4 removeContact_foreign_id",
    run: (actor, org, _a, b) => removeContact(actor, org, b.contactRemove.id),
  },
  {
    name: "2.3.5 mergeFirms_foreign_keepId",
    run: (actor, org, a, b) =>
      mergeFirms(actor, org, { keepId: b.firmKeep.id, removeId: a.firmRemove.id }),
  },
  {
    name: "2.3.6 mergeFirms_foreign_removeId",
    run: (actor, org, a, b) =>
      mergeFirms(actor, org, { keepId: a.firmKeep.id, removeId: b.firmRemove.id }),
  },
  {
    name: "2.3.7 mergeFirms_both_foreign",
    run: (actor, org, _a, b) =>
      mergeFirms(actor, org, { keepId: b.firmKeep.id, removeId: b.firmRemove.id }),
  },
  {
    name: "2.3.8 removeFirm_foreign_id",
    run: (actor, org, _a, b) => removeFirm(actor, org, b.firmRemove.id),
  },
];

describe("2.3 IDOR: admin i A med id-er fra B", () => {
  it.each(idorCases)("$name", async ({ run }) => {
    const { orgA, admin, graphA, graphB } = await twoOrgs();
    const before = await snapshotContactGraph();

    await expectDenied(run(admin.actor, orgA.id, graphA, graphB));

    // Uendret i begge organisasjoner
    expect(await snapshotContactGraph()).toEqual(before);
    const [audit] = await db.select({ n: count() }).from(auditLog);
    expect(audit?.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.4 Feilsaker
// ---------------------------------------------------------------------------------------------

type FailureCase = {
  name: string;
  run: (actor: Actor, organizationId: string, graph: Graph) => Promise<unknown>;
};

const unknownIdCases: FailureCase[] = [
  { name: "removeContact", run: (a, o) => removeContact(a, o, randomUUID()) },
  { name: "removeFirm", run: (a, o) => removeFirm(a, o, randomUUID()) },
  {
    name: "mergeContacts (ukjent removeId)",
    run: (a, o, g) => mergeContacts(a, o, { keepId: g.contactKeep.id, removeId: randomUUID() }),
  },
  {
    name: "mergeContacts (ukjent keepId)",
    run: (a, o, g) => mergeContacts(a, o, { keepId: randomUUID(), removeId: g.contactRemove.id }),
  },
  {
    name: "mergeFirms (ukjent removeId)",
    run: (a, o, g) => mergeFirms(a, o, { keepId: g.firmKeep.id, removeId: randomUUID() }),
  },
  {
    name: "mergeFirms (ukjent keepId)",
    run: (a, o, g) => mergeFirms(a, o, { keepId: randomUUID(), removeId: g.firmRemove.id }),
  },
  // Ugyldig id (ikke uuid) gir samme avslag, ikke en databasefeil
  { name: "removeContact (ikke uuid)", run: (a, o) => removeContact(a, o, "abc") },
  { name: "removeFirm (ikke uuid)", run: (a, o) => removeFirm(a, o, "abc") },
  {
    name: "mergeContacts (ikke uuid)",
    run: (a, o, g) => mergeContacts(a, o, { keepId: g.contactKeep.id, removeId: "abc" }),
  },
  {
    name: "mergeFirms (ikke uuid)",
    run: (a, o, g) => mergeFirms(a, o, { keepId: "", removeId: g.firmRemove.id }),
  },
];

/** Myk-sletter én rad i grafen (aldri `delete`). */
async function softDeleteContact(id: string) {
  await db.update(contacts).set({ deletedAt: DELETED }).where(eq(contacts.id, id));
}
async function softDeleteFirm(id: string) {
  await db.update(firms).set({ deletedAt: DELETED }).where(eq(firms.id, id));
}

const alreadyRemovedCases: (FailureCase & { prepare: (g: Graph) => Promise<void> })[] = [
  {
    name: "2.4.2 already_removed_removeId_denied (kontakt)",
    prepare: (g) => softDeleteContact(g.contactRemove.id),
    run: (a, o, g) =>
      mergeContacts(a, o, { keepId: g.contactKeep.id, removeId: g.contactRemove.id }),
  },
  {
    name: "2.4.2 already_removed_keepId_denied (kontakt)",
    prepare: (g) => softDeleteContact(g.contactKeep.id),
    run: (a, o, g) =>
      mergeContacts(a, o, { keepId: g.contactKeep.id, removeId: g.contactRemove.id }),
  },
  {
    name: "2.4.2 already_removed_removeId_denied (firma)",
    prepare: (g) => softDeleteFirm(g.firmRemove.id),
    run: (a, o, g) => mergeFirms(a, o, { keepId: g.firmKeep.id, removeId: g.firmRemove.id }),
  },
  {
    name: "2.4.2 already_removed_keepId_denied (firma)",
    prepare: (g) => softDeleteFirm(g.firmKeep.id),
    run: (a, o, g) => mergeFirms(a, o, { keepId: g.firmKeep.id, removeId: g.firmRemove.id }),
  },
];

const sameRecordCases: (FailureCase & { message: string })[] = [
  {
    name: "kontakt",
    message: "Velg to ulike kontakter.",
    run: (a, o, g) => mergeContacts(a, o, { keepId: g.contactKeep.id, removeId: g.contactKeep.id }),
  },
  {
    name: "firma",
    message: "Velg to ulike firma.",
    run: (a, o, g) => mergeFirms(a, o, { keepId: g.firmKeep.id, removeId: g.firmKeep.id }),
  },
];

/** Én organisasjon med admin og graf. */
async function oneOrg() {
  const org = await createOrganization();
  const admin = await person(org.id, ["admin"], "Test Admin");
  const graph = await createGraph(org.id);
  return { org, admin, graph };
}

describe("2.4 feilsaker", () => {
  it.each(unknownIdCases)("2.4.1 unknown_uuid_denied: $name", async ({ run }) => {
    const { org, admin, graph } = await oneOrg();
    const before = await snapshotContactGraph();
    await expectDenied(run(admin.actor, org.id, graph));
    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(0);
  });

  it.each(alreadyRemovedCases)("$name", async ({ prepare, run }) => {
    const { org, admin, graph } = await oneOrg();
    await prepare(graph);
    const before = await snapshotContactGraph();
    await expectDenied(run(admin.actor, org.id, graph));
    // Partene og ordrene til den aktive (og alle andre rader) er uendret
    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(0);
  });

  it("2.4.3 removeContact_twice_denied", async () => {
    const { org, admin, graph } = await oneOrg();
    await removeContact(admin.actor, org.id, graph.contactRemove.id);
    const first = (await contactRow(graph.contactRemove.id))!.deletedAt;
    expect(first).not.toBeNull();
    const before = await snapshotContactGraph();

    await expectDenied(removeContact(admin.actor, org.id, graph.contactRemove.id));

    expect((await contactRow(graph.contactRemove.id))!.deletedAt).toEqual(first);
    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(1);
  });

  it("2.4.3 removeFirm_twice_denied", async () => {
    const { org, admin, graph } = await oneOrg();
    await removeFirm(admin.actor, org.id, graph.firmRemove.id);
    const first = (await firmRow(graph.firmRemove.id))!.deletedAt;
    expect(first).not.toBeNull();
    const before = await snapshotContactGraph();

    await expectDenied(removeFirm(admin.actor, org.id, graph.firmRemove.id));

    expect((await firmRow(graph.firmRemove.id))!.deletedAt).toEqual(first);
    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(1);
  });

  it.each(sameRecordCases)("2.4.4 merge_same_record: $name", async ({ run, message }) => {
    const { org, admin, graph } = await oneOrg();
    const before = await snapshotContactGraph();

    const error = await run(admin.actor, org.id, graph).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(MergeSameRecordError);
    expect((error as Error).message).toBe(message);

    expect(await snapshotContactGraph()).toEqual(before);
    expect(await contactAuditRows()).toHaveLength(0);
  });

  it("2.4.5 failed_attempts_not_audited: alle avviste forsøk i 2.3 og 2.4 etter hverandre", async () => {
    const { orgA, admin, graphA, graphB } = await twoOrgs();
    for (const { run } of idorCases) {
      await expectDenied(run(admin.actor, orgA.id, graphA, graphB));
    }
    for (const { run } of unknownIdCases) {
      await expectDenied(run(admin.actor, orgA.id, graphA));
    }
    for (const { run } of sameRecordCases) {
      await expect(run(admin.actor, orgA.id, graphA)).rejects.toBeInstanceOf(MergeSameRecordError);
    }
    // Til slutt de allerede fjernede (B sin graf brukes ikke; egne rader i A myk-slettes)
    await softDeleteContact(graphA.contactDeleted.id);
    await expectDenied(
      mergeContacts(admin.actor, orgA.id, {
        keepId: graphA.contactKeep.id,
        removeId: graphA.contactDeleted.id,
      }),
    );
    await expectDenied(
      mergeContacts(admin.actor, orgA.id, {
        keepId: graphA.contactDeleted.id,
        removeId: graphA.contactRemove.id,
      }),
    );
    const removedFirm = await insertFirm(orgA.id, { deletedAt: DELETED });
    await expectDenied(
      mergeFirms(admin.actor, orgA.id, { keepId: graphA.firmKeep.id, removeId: removedFirm.id }),
    );
    await expectDenied(
      mergeFirms(admin.actor, orgA.id, { keepId: removedFirm.id, removeId: graphA.firmRemove.id }),
    );

    const rows = await db.select().from(auditLog);
    expect(rows.filter((row) => /^(contact|firm)\./.test(eventCode(row)))).toEqual([]);
    expect(await contactAuditRows()).toEqual([]);
  });

  describe("2.4.6 audit_failure_rolls_back", () => {
    it.each(SERVICES)("%s: ingenting er endret når revisjonsloggen feiler", async (service) => {
      const { org, admin, graph } = await oneOrg();
      const before = await snapshotContactGraph();
      vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
        throw new Error("revisjonsloggen feilet (test)");
      });

      await expect(runService(service, admin.actor, org.id, graph)).rejects.toThrow(
        "revisjonsloggen feilet (test)",
      );

      // Verken deleted_at satt eller koblinger flyttet
      expect(await snapshotContactGraph()).toEqual(before);
      expect(await contactAuditRows()).toHaveLength(0);

      // Etterpå går det (ingen halvferdig lås eller rad står igjen)
      await runService(service, admin.actor, org.id, graph);
      expect(await contactAuditRows()).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 2.5 Fjerning
// ---------------------------------------------------------------------------------------------

describe("2.5 fjerning", () => {
  it("2.5.1 removeContact_sets_deleted_at_row_kept", async () => {
    const { org, admin, graph } = await oneOrg();
    const [{ n: before } = { n: 0 }] = await db.select({ n: count() }).from(contacts);

    await expect(
      removeContact(admin.actor, org.id, graph.contactRemove.id),
    ).resolves.toBeUndefined();

    const row = await contactRow(graph.contactRemove.id);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.updatedBy).not.toBeNull();
    // Felt og navn står (ingen anonymisering, ingen permanent sletting)
    expect(row!.firstName).toBe(FIRST);
    expect(row!.email).toBe(EMAIL);
    const [{ n: after } = { n: 0 }] = await db.select({ n: count() }).from(contacts);
    expect(after).toBe(before);
  });

  it("2.5.2 removeContact_keeps_links", async () => {
    const { org, admin, graph } = await oneOrg();
    const parties = [graph.partyRemove.id, graph.partyRemoveDeleted.id];
    const partiesBefore = await Promise.all(parties.map(partyRow));
    const orderBefore = await orderRow(graph.orderRemove.id);

    await removeContact(admin.actor, org.id, graph.contactRemove.id);

    for (const [index, id] of parties.entries()) {
      const after = await partyRow(id);
      const before = partiesBefore[index]!;
      expect(after.contactId).toBe(graph.contactRemove.id);
      expect(after.firmId).toBe(graph.firmRemove.id);
      expect([after.name, after.firmName, after.email, after.phone]).toEqual([
        before.name,
        before.firmName,
        before.email,
        before.phone,
      ]);
    }
    const order = await orderRow(graph.orderRemove.id);
    expect(order.orderedByContactId).toBe(graph.contactRemove.id);
    expect(order.orderedByFirmId).toBe(graph.firmRemove.id);
    expect(order.orderedByText).toBe(orderBefore.orderedByText);
  });

  it("2.5.3 removed_contact_hidden", async () => {
    const { org, admin, graph } = await oneOrg();
    await removeContact(admin.actor, org.id, graph.contactRemove.id);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    // Listen på /kontakter
    expect(ids(await listContacts(admin.actor, org.id))).not.toContain(graph.contactRemove.id);
    expect(ids(await listContacts(admin.actor, org.id))).toContain(graph.contactKeep.id);
    // Søket
    expect(ids(await listContacts(admin.actor, org.id, { query: FIRST }))).not.toContain(
      graph.contactRemove.id,
    );
    expect(ids(await listContacts(admin.actor, org.id, { query: EMAIL }))).not.toContain(
      graph.contactRemove.id,
    );
    // Kontaktvelgeren (searchContactsAction kaller listContacts med høyst 10 treff)
    // («Megler» treffer også etternavnet «Meglersen» på den tredje kontakten.) Før fjerningen
    // ga søket tre treff, nå to.
    expect(
      ids(await listContacts(admin.actor, org.id, { query: FIRST, limit: 10 })).sort(),
    ).toEqual([graph.contactKeep.id, graph.contactOther.id].sort());
    // Siden gir 404
    await expectDenied(getContact(admin.actor, org.id, graph.contactRemove.id));
    // Firmasiden viser den ikke
    const firm = await getFirm(admin.actor, org.id, graph.firmRemove.id);
    expect(ids(firm.contacts)).not.toContain(graph.contactRemove.id);
  });

  it("2.5.4 removeFirm_sets_deleted_at_row_kept", async () => {
    const { org, admin, graph } = await oneOrg();
    const [{ n: before } = { n: 0 }] = await db.select({ n: count() }).from(firms);

    await removeFirm(admin.actor, org.id, graph.firmRemove.id);

    const row = await firmRow(graph.firmRemove.id);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.name).toBe(FIRM_NAME);
    expect(row!.orgNumber).toBe(graph.firmRemove.orgNumber);
    const [{ n: after } = { n: 0 }] = await db.select({ n: count() }).from(firms);
    expect(after).toBe(before);
  });

  it("2.5.5 removeFirm_returns_active_contact_count", async () => {
    const org = await createOrganization();
    const admin = await person(org.id, ["admin"]);
    const firm = await insertFirm(org.id);
    await insertContact(org.id, { firmId: firm.id });
    await insertContact(org.id, { firmId: firm.id });
    await insertContact(org.id, { firmId: firm.id, deletedAt: DELETED });
    // Kontakt i et annet firma og i en annen organisasjon teller ikke
    await insertContact(org.id, { firmId: (await insertFirm(org.id)).id });
    const other = await createOrganization("Organisasjon B");
    await insertContact(other.id, { firmId: (await insertFirm(other.id)).id });

    await expect(removeFirm(admin.actor, org.id, firm.id)).resolves.toEqual({ contactCount: 2 });
  });

  it("2.5.6 removeFirm_contacts_kept_without_firm", async () => {
    const { org, admin, graph } = await oneOrg();
    await removeFirm(admin.actor, org.id, graph.firmRemove.id);

    const row = await contactRow(graph.contactRemove.id);
    expect(row!.deletedAt).toBeNull();
    // Koblingen står urørt i databasen
    expect(row!.firmId).toBe(graph.firmRemove.id);

    const listed = (await listContacts(admin.actor, org.id)).find(
      (contact) => contact.id === graph.contactRemove.id,
    );
    expect(listed).toBeDefined();
    expect(listed!.firmName).toBeNull();
    const shown = await getContact(admin.actor, org.id, graph.contactRemove.id);
    expect(shown.firmName).toBeNull();
    expect(shown.firmId).toBeNull();
    // Kontakten i firmaet som står, har fortsatt firma
    expect((await getContact(admin.actor, org.id, graph.contactKeep.id)).firmName).toBe(FIRM_NAME);
  });

  it("2.5.7 removed_firm_hidden", async () => {
    const { org, admin, graph } = await oneOrg();
    await removeFirm(admin.actor, org.id, graph.firmRemove.id);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    // Firmavelgeren på kontaktsiden og listen på /firma
    expect(ids(await listFirms(admin.actor, org.id))).toEqual([graph.firmKeep.id]);
    // Firmasøket, på navn og på organisasjonsnummer
    expect(ids(await listFirms(admin.actor, org.id, { query: FIRM_NAME }))).toEqual([
      graph.firmKeep.id,
    ]);
    expect(
      ids(await listFirms(admin.actor, org.id, { query: graph.firmRemove.orgNumber! })),
    ).toEqual([]);
    await expectDenied(getFirm(admin.actor, org.id, graph.firmRemove.id));
  });

  it("2.5.8 removeFirm_frees_org_number", async () => {
    const { org, admin, graph } = await oneOrg();
    const orgNumber = graph.firmRemove.orgNumber!;
    await removeFirm(admin.actor, org.id, graph.firmRemove.id);

    const created = await createFirm(admin.actor, org.id, { name: FIRM_NAME, orgNumber });
    expect(created.orgNumber).toBe(orgNumber);
    expect(created.id).not.toBe(graph.firmRemove.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.6 Sammenslåing av kontakter
// ---------------------------------------------------------------------------------------------

/** Ingen rad i parter eller ordrer peker på kontakten (også myk-slettede rader). */
async function rowsPointingToContact(contactId: string) {
  const parties = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .where(eq(assignmentParties.contactId, contactId));
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderedByContactId, contactId));
  const assignmentRows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.orderedByContactId, contactId));
  return [...parties, ...orderRows, ...assignmentRows];
}

describe("2.6 sammenslåing av kontakter", () => {
  async function merge(graph: Graph, actor: Actor) {
    return mergeContacts(actor, graph.organizationId, {
      keepId: graph.contactKeep.id,
      removeId: graph.contactRemove.id,
    });
  }

  it("2.6.1 moves_parties_and_orders", async () => {
    const { admin, graph } = await oneOrg();
    const result = await merge(graph, admin.actor);

    expect(result).toEqual(GRAPH_COUNTS.mergeContacts);
    expect((await partyRow(graph.partyRemove.id)).contactId).toBe(graph.contactKeep.id);
    expect((await partyRow(graph.partyRemoveDeleted.id)).contactId).toBe(graph.contactKeep.id);
    expect((await orderRow(graph.orderRemove.id)).orderedByContactId).toBe(graph.contactKeep.id);
    // Det som alt sto på den som beholdes, står
    expect((await partyRow(graph.partyKeep.id)).contactId).toBe(graph.contactKeep.id);
    expect((await orderRow(graph.orderKeep.id)).orderedByContactId).toBe(graph.contactKeep.id);
  });

  it("2.6.2 firm_follows_kept_contact", async () => {
    const { admin, graph } = await oneOrg();
    // Fjernet kontakt i firma X (firmRemove), beholdt i firma Y (firmKeep)
    await merge(graph, admin.actor);

    expect((await partyRow(graph.partyRemove.id)).firmId).toBe(graph.firmKeep.id);
    expect((await partyRow(graph.partyRemoveDeleted.id)).firmId).toBe(graph.firmKeep.id);
    expect((await orderRow(graph.orderRemove.id)).orderedByFirmId).toBe(graph.firmKeep.id);
    // Rader med bare firmaet (uten kontakt) er ikke flyttet
    expect((await partyRow(graph.partyFirmOnly.id)).firmId).toBe(graph.firmRemove.id);
    expect((await orderRow(graph.orderFirmOnly.id)).orderedByFirmId).toBe(graph.firmRemove.id);
  });

  it.each([
    {
      name: "2.6.3 kept_without_firm_gives_null",
      prepare: (g: Graph) =>
        db.update(contacts).set({ firmId: null }).where(eq(contacts.id, g.contactKeep.id)),
    },
    {
      name: "2.6.3 kept_with_removed_firm_gives_null",
      prepare: (g: Graph) => softDeleteFirm(g.firmKeep.id),
    },
  ])("$name", async ({ prepare }) => {
    const { admin, graph } = await oneOrg();
    await prepare(graph);

    await merge(graph, admin.actor);

    expect((await partyRow(graph.partyRemove.id)).firmId).toBeNull();
    expect((await partyRow(graph.partyRemoveDeleted.id)).firmId).toBeNull();
    expect((await orderRow(graph.orderRemove.id)).orderedByFirmId).toBeNull();
    expect((await partyRow(graph.partyRemove.id)).contactId).toBe(graph.contactKeep.id);
  });

  it("2.6.4 moves_soft_deleted_parties", async () => {
    const { admin, graph } = await oneOrg();
    await merge(graph, admin.actor);

    const party = await partyRow(graph.partyRemoveDeleted.id);
    expect(party.contactId).toBe(graph.contactKeep.id);
    expect(party.deletedAt).toEqual(DELETED);
  });

  it("2.6.5 free_text_unchanged", async () => {
    const { admin, graph } = await oneOrg();
    const partyIds = [graph.partyRemove.id, graph.partyRemoveDeleted.id, graph.partyKeep.id];
    const text = (row: Awaited<ReturnType<typeof partyRow>>) => ({
      name: row.name,
      firmName: row.firmName,
      email: row.email,
      phone: row.phone,
    });
    const partiesBefore = await Promise.all(partyIds.map(async (id) => text(await partyRow(id))));
    const orderBefore = (await orderRow(graph.orderRemove.id)).orderedByText;

    await merge(graph, admin.actor);

    expect(await Promise.all(partyIds.map(async (id) => text(await partyRow(id))))).toEqual(
      partiesBefore,
    );
    expect((await orderRow(graph.orderRemove.id)).orderedByText).toBe(orderBefore);
  });

  it("2.6.6 removed_soft_deleted_kept_unchanged", async () => {
    const { admin, graph } = await oneOrg();
    const keepBefore = await contactRow(graph.contactKeep.id);

    await merge(graph, admin.actor);

    const removed = await contactRow(graph.contactRemove.id);
    expect(removed).toBeDefined();
    expect(removed!.deletedAt).toBeInstanceOf(Date);
    // Den som beholdes er helt uendret (også updated_at og row_version)
    expect(await contactRow(graph.contactKeep.id)).toEqual(keepBefore);
  });

  it("2.6.7 other_rows_untouched", async () => {
    const orgB = await createOrganization("Organisasjon B");
    const { admin, graph } = await oneOrg();
    const graphB = await createGraph(orgB.id);
    const otherIds = {
      parties: [graph.partyOther.id, graph.partyFirmOnly.id],
      orders: [graph.orderOther.id, graph.orderFirmOnly.id],
    };
    const otherParties = await Promise.all(otherIds.parties.map(partyRow));
    const otherOrders = await Promise.all(otherIds.orders.map(orderRow));
    const otherContact = await contactRow(graph.contactOther.id);
    const snapshotB = async () => {
      const all = await snapshotContactGraph();
      const inB = (id: string | null) =>
        id !== null &&
        [
          graphB.contactKeep.id,
          graphB.contactRemove.id,
          graphB.contactOther.id,
          graphB.contactDeleted.id,
          graphB.firmKeep.id,
          graphB.firmRemove.id,
        ].includes(id);
      return {
        contacts: all.contacts.filter((row) => inB(row.id)),
        firms: all.firms.filter((row) => inB(row.id)),
        parties: all.parties.filter((row) => inB(row.contactId) || inB(row.firmId)),
        orders: all.orders.filter((row) => inB(row.orderedByContactId) || inB(row.orderedByFirmId)),
      };
    };
    const beforeB = await snapshotB();
    const partiesB = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.organizationId, orgB.id))
      .orderBy(asc(assignmentParties.id));
    const ordersB = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, orgB.id))
      .orderBy(asc(orders.id));

    await merge(graph, admin.actor);

    expect(await Promise.all(otherIds.parties.map(partyRow))).toEqual(otherParties);
    expect(await Promise.all(otherIds.orders.map(orderRow))).toEqual(otherOrders);
    expect(await contactRow(graph.contactOther.id)).toEqual(otherContact);
    expect(await snapshotB()).toEqual(beforeB);
    expect(beforeB.parties.length).toBeGreaterThan(0);
    expect(
      await db
        .select()
        .from(assignmentParties)
        .where(eq(assignmentParties.organizationId, orgB.id))
        .orderBy(asc(assignmentParties.id)),
    ).toEqual(partiesB);
    expect(
      await db
        .select()
        .from(orders)
        .where(eq(orders.organizationId, orgB.id))
        .orderBy(asc(orders.id)),
    ).toEqual(ordersB);
  });

  it("2.6.8 no_row_points_to_removed", async () => {
    const { admin, graph } = await oneOrg();
    expect(await rowsPointingToContact(graph.contactRemove.id)).not.toHaveLength(0);
    await merge(graph, admin.actor);
    expect(await rowsPointingToContact(graph.contactRemove.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.7 Sammenslåing av firma
// ---------------------------------------------------------------------------------------------

/** Rader i kontakter, parter og ordrer som peker på firmaet (også myk-slettede rader). */
async function rowsPointingToFirm(firmId: string) {
  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.firmId, firmId));
  const parties = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .where(eq(assignmentParties.firmId, firmId));
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderedByFirmId, firmId));
  const assignmentRows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.orderedByFirmId, firmId));
  return [...contactRows, ...parties, ...orderRows, ...assignmentRows];
}

describe("2.7 sammenslåing av firma", () => {
  async function merge(graph: Graph, actor: Actor) {
    return mergeFirms(actor, graph.organizationId, {
      keepId: graph.firmKeep.id,
      removeId: graph.firmRemove.id,
    });
  }

  it("2.7.1 moves_contacts_parties_orders", async () => {
    const { admin, graph } = await oneOrg();
    const result = await merge(graph, admin.actor);

    expect(result).toEqual(GRAPH_COUNTS.mergeFirms);
    expect((await contactRow(graph.contactRemove.id))!.firmId).toBe(graph.firmKeep.id);
    for (const id of [graph.partyRemove.id, graph.partyRemoveDeleted.id, graph.partyFirmOnly.id]) {
      expect((await partyRow(id)).firmId).toBe(graph.firmKeep.id);
    }
    for (const id of [graph.orderRemove.id, graph.orderFirmOnly.id]) {
      expect((await orderRow(id)).orderedByFirmId).toBe(graph.firmKeep.id);
    }
  });

  it("2.7.2 moves_soft_deleted_contacts", async () => {
    const { admin, graph } = await oneOrg();
    await merge(graph, admin.actor);

    const row = await contactRow(graph.contactDeleted.id);
    expect(row!.firmId).toBe(graph.firmKeep.id);
    expect(row!.deletedAt).toEqual(DELETED);
  });

  it("2.7.3 kept_firm_unchanged", async () => {
    const { admin, graph } = await oneOrg();
    const before = await firmRow(graph.firmKeep.id);

    await merge(graph, admin.actor);

    const after = await firmRow(graph.firmKeep.id);
    expect(after).toEqual(before);
    expect(after!.orgNumber).toBe(graph.firmKeep.orgNumber);
  });

  it("2.7.4 removed_firm_soft_deleted", async () => {
    const { admin, graph } = await oneOrg();
    await merge(graph, admin.actor);

    const row = await firmRow(graph.firmRemove.id);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.orgNumber).toBe(graph.firmRemove.orgNumber);
  });

  it("2.7.5 org_number_reusable", async () => {
    const { org, admin, graph } = await oneOrg();
    const orgNumber = graph.firmRemove.orgNumber!;
    await merge(graph, admin.actor);

    const created = await createFirm(admin.actor, org.id, { name: FIRM_NAME, orgNumber });
    expect(created.orgNumber).toBe(orgNumber);
  });

  it("2.7.6 contact_link_still_consistent", async () => {
    const { admin, graph } = await oneOrg();
    await merge(graph, admin.actor);

    const party = await partyRow(graph.partyRemove.id);
    expect(party.contactId).toBe(graph.contactRemove.id);
    expect(party.firmId).toBe(graph.firmKeep.id);
    // Firmaet følger kontakten
    expect((await contactRow(graph.contactRemove.id))!.firmId).toBe(party.firmId);
    const order = await orderRow(graph.orderRemove.id);
    expect(order.orderedByContactId).toBe(graph.contactRemove.id);
    expect(order.orderedByFirmId).toBe(graph.firmKeep.id);
  });

  it("2.7.7 no_row_points_to_removed_firm", async () => {
    const { admin, graph } = await oneOrg();
    expect(await rowsPointingToFirm(graph.firmRemove.id)).not.toHaveLength(0);
    await merge(graph, admin.actor);
    expect(await rowsPointingToFirm(graph.firmRemove.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.11 Bestilleren på oppdrag og ordre (docs/funksjoner/fase2a-nytt-oppdrag-testplan.md 4.11)
// ---------------------------------------------------------------------------------------------

describe("4.11 sammenslåing flytter bestilleren på oppdrag og ordre", () => {
  it("4.11.1 kontakt: bestilleren flyttes på oppdrag (også kansellert), firmaet følger kontakten", async () => {
    const { admin, graph } = await oneOrg();
    await mergeContacts(admin.actor, graph.organizationId, {
      keepId: graph.contactKeep.id,
      removeId: graph.contactRemove.id,
    });
    for (const id of [graph.assignmentRemove.id, graph.assignmentRemoveCancelled.id]) {
      const row = await assignmentRow(id);
      expect(row.orderedByContactId).toBe(graph.contactKeep.id);
      expect(row.orderedByFirmId).toBe(graph.firmKeep.id);
      expect(row.rowVersion).toBe(2);
    }
    // Bare firmaet: ikke flyttet ved sammenslåing av kontakter
    const firmOnly = await assignmentRow(graph.assignmentFirmOnly.id);
    expect(firmOnly.orderedByFirmId).toBe(graph.firmRemove.id);
    expect(firmOnly.rowVersion).toBe(1);
    expect((await assignmentRow(graph.assignmentKeep.id)).rowVersion).toBe(1);
    // Friteksten røres ikke
    expect((await assignmentRow(graph.assignmentRemove.id)).orderedByText).toBe(
      graph.assignmentRemove.orderedByText,
    );
  });

  it("4.11.2 firma: bestillerfirmaet flyttes på oppdrag og ordre, row_version øker", async () => {
    const { admin, graph } = await oneOrg();
    await mergeFirms(admin.actor, graph.organizationId, {
      keepId: graph.firmKeep.id,
      removeId: graph.firmRemove.id,
    });
    for (const id of [
      graph.assignmentRemove.id,
      graph.assignmentRemoveCancelled.id,
      graph.assignmentFirmOnly.id,
    ]) {
      const row = await assignmentRow(id);
      expect(row.orderedByFirmId).toBe(graph.firmKeep.id);
      expect(row.rowVersion).toBe(2);
    }
    expect((await assignmentRow(graph.assignmentRemove.id)).orderedByContactId).toBe(
      graph.contactRemove.id,
    );
    for (const id of [graph.orderRemove.id, graph.orderFirmOnly.id]) {
      expect((await orderRow(id)).rowVersion).toBe(2);
    }
    expect((await orderRow(graph.orderKeep.id)).rowVersion).toBe(1);
  });

  it("4.11.4 kontakt: ordren får høyere row_version og én loggrad med feltkoder og id-er (var rødt før)", async () => {
    const { admin, graph } = await oneOrg();
    await mergeContacts(admin.actor, graph.organizationId, {
      keepId: graph.contactKeep.id,
      removeId: graph.contactRemove.id,
    });
    expect((await orderRow(graph.orderRemove.id)).rowVersion).toBe(2);
    expect((await orderRow(graph.orderKeep.id)).rowVersion).toBe(1);

    const rows = await bookingAuditRows();
    const byEntity = new Map(rows.map((row) => [`${row.entityType}:${row.entityId}`, row]));
    expect(rows).toHaveLength(3);
    const expected = {
      fields: ["orderedByContactId", "orderedByFirmId"],
      values: {
        orderedByContactId: { from: graph.contactRemove.id, to: graph.contactKeep.id },
        orderedByFirmId: { from: graph.firmRemove.id, to: graph.firmKeep.id },
      },
    };
    for (const key of [
      `order:${graph.orderRemove.id}`,
      `assignment:${graph.assignmentRemove.id}`,
      `assignment:${graph.assignmentRemoveCancelled.id}`,
    ]) {
      const row = byEntity.get(key);
      expect(row, key).toBeDefined();
      expect(row!.changes).toEqual(expected);
      expect(row!.actorEmployeeId).toBe(admin.employee.id);
      expect(row!.organizationId).toBe(graph.organizationId);
    }
    // Bare id-er, aldri navn eller fritekst
    const text = JSON.stringify(rows.map((row) => row.changes));
    for (const value of [FIRST, LAST, FIRM_NAME, EMAIL, PHONE, NOTE]) {
      expect(text).not.toContain(value);
    }
  });

  it("4.11.4 kontakt med samme firma: loggraden har bare kontakten", async () => {
    const { admin, graph } = await oneOrg();
    await db
      .update(contacts)
      .set({ firmId: graph.firmRemove.id })
      .where(eq(contacts.id, graph.contactKeep.id));
    await mergeContacts(admin.actor, graph.organizationId, {
      keepId: graph.contactKeep.id,
      removeId: graph.contactRemove.id,
    });
    const rows = await bookingAuditRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.changes).toEqual({
        fields: ["orderedByContactId"],
        values: { orderedByContactId: { from: graph.contactRemove.id, to: graph.contactKeep.id } },
      });
    }
  });

  it("4.11.2 firma: én loggrad per flyttet ordre og oppdrag", async () => {
    const { admin, graph } = await oneOrg();
    await mergeFirms(admin.actor, graph.organizationId, {
      keepId: graph.firmKeep.id,
      removeId: graph.firmRemove.id,
    });
    const rows = await bookingAuditRows();
    expect(rows.map((row) => `${row.entityType}:${row.entityId}`).sort()).toEqual(
      [
        `order:${graph.orderRemove.id}`,
        `order:${graph.orderFirmOnly.id}`,
        `assignment:${graph.assignmentRemove.id}`,
        `assignment:${graph.assignmentRemoveCancelled.id}`,
        `assignment:${graph.assignmentFirmOnly.id}`,
      ].sort(),
    );
    for (const row of rows) {
      expect(row.changes).toEqual({
        fields: ["orderedByFirmId"],
        values: { orderedByFirmId: { from: graph.firmRemove.id, to: graph.firmKeep.id } },
      });
    }
  });

  it("4.11 tenant: sammenslåing i A rører ikke oppdrag, ordre eller logg i B", async () => {
    const { orgA, orgB, admin, graphA, graphB } = await twoOrgs();
    const before = await db
      .select()
      .from(assignments)
      .where(eq(assignments.organizationId, orgB.id))
      .orderBy(asc(assignments.id));
    await mergeContacts(admin.actor, orgA.id, {
      keepId: graphA.contactKeep.id,
      removeId: graphA.contactRemove.id,
    });
    await mergeFirms(admin.actor, orgA.id, {
      keepId: graphA.firmKeep.id,
      removeId: graphA.firmRemove.id,
    });
    const after = await db
      .select()
      .from(assignments)
      .where(eq(assignments.organizationId, orgB.id))
      .orderBy(asc(assignments.id));
    expect(after).toEqual(before);
    expect((await assignmentRow(graphB.assignmentRemove.id)).orderedByContactId).toBe(
      graphB.contactRemove.id,
    );
    const rowsB = (await bookingAuditRows()).filter((row) => row.organizationId === orgB.id);
    expect(rowsB).toEqual([]);
  });

  it("4.11 B sin kontakt kan ikke slås sammen fra A, og B sine oppdrag står urørt", async () => {
    const { orgA, admin, graphB } = await twoOrgs();
    const before = await snapshotContactGraph();
    await expectDenied(
      mergeContacts(admin.actor, orgA.id, {
        keepId: graphB.contactKeep.id,
        removeId: graphB.contactRemove.id,
      }),
    );
    expect(await snapshotContactGraph()).toEqual(before);
    expect(await bookingAuditRows()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2.8 Revisjonslogg uten personopplysninger
// ---------------------------------------------------------------------------------------------

describe("2.8 revisjonslogg", () => {
  async function runAndReadAudit(service: ServiceName) {
    const { org, admin, graph } = await oneOrg();
    // Fjernet kontakt i firmaet og en annen organisasjon, så tallene må filtreres riktig
    const orgB = await createOrganization("Organisasjon B");
    await createGraph(orgB.id);
    const result = await runService(service, admin.actor, org.id, graph);
    const rows = await contactAuditRows();
    expect(rows).toHaveLength(1);
    return { org, admin, graph, result, row: rows[0]! };
  }

  it.each(SERVICES)("2.8.1 audit_codes_and_actor: %s", async (service) => {
    const { org, admin, row } = await runAndReadAudit(service);
    expect(eventCode(row)).toBe(EVENT_CODES[service]);
    expect(row.actorEmployeeId).toBe(admin.employee.id);
    expect(row.organizationId).toBe(org.id);
  });

  it("2.8.2 audit_counts_correct", async () => {
    const removeFirmRun = await runAndReadAudit("removeFirm");
    expect(removeFirmRun.row.changes).toMatchObject(GRAPH_COUNTS.removeFirm);
    expect(removeFirmRun.result).toEqual(GRAPH_COUNTS.removeFirm);

    await resetDatabase();
    const contactsRun = await runAndReadAudit("mergeContacts");
    expect(contactsRun.row.changes).toEqual({
      keepId: contactsRun.graph.contactKeep.id,
      removeId: contactsRun.graph.contactRemove.id,
      ...GRAPH_COUNTS.mergeContacts,
    });
    expect(contactsRun.result).toEqual(GRAPH_COUNTS.mergeContacts);

    await resetDatabase();
    const firmsRun = await runAndReadAudit("mergeFirms");
    expect(firmsRun.row.changes).toEqual({
      keepId: firmsRun.graph.firmKeep.id,
      removeId: firmsRun.graph.firmRemove.id,
      ...GRAPH_COUNTS.mergeFirms,
    });
    expect(firmsRun.result).toEqual(GRAPH_COUNTS.mergeFirms);

    await resetDatabase();
    const removeContactRun = await runAndReadAudit("removeContact");
    expect(removeContactRun.row.changes).toEqual({
      contactId: removeContactRun.graph.contactRemove.id,
    });
  });

  it.each(SERVICES)("2.8.3 audit_metadata_exact_keys: %s", async (service) => {
    const { row } = await runAndReadAudit(service);
    expect(Object.keys(row.changes).sort()).toEqual(METADATA_KEYS[service]);
  });

  it.each(SERVICES)("2.8.4 audit_contains_no_pii: %s", async (service) => {
    const { graph, row } = await runAndReadAudit(service);
    const text = JSON.stringify(row.changes);
    const forbidden = [
      FIRST,
      LAST,
      OTHER_FIRST,
      OTHER_LAST,
      FIRM_NAME,
      EMAIL,
      PHONE,
      NOTE,
      graph.firmKeep.orgNumber!,
      graph.firmRemove.orgNumber!,
    ];
    for (const value of forbidden) {
      expect(text, `metadata inneholder «${value}»`).not.toContain(value);
    }
    // Bare id-er (uuid) og antall
    for (const value of Object.values(row.changes)) {
      const isId =
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
      const isCount = typeof value === "number" && Number.isInteger(value) && value >= 0;
      expect(isId || isCount, `uventet verdi ${JSON.stringify(value)}`).toBe(true);
    }
  });
});

// Grafen selv: antallene i GRAPH_COUNTS stemmer med radene som lages, og tiden er fast.
it("grafen har radene antallene bygger på", async () => {
  const org = await createOrganization();
  const graph = await createGraph(org.id);
  expect(graph.orderRemove.receivedAt).toEqual(TEST_NOW);
  expect(graph.firmKeep.orgNumber).not.toBe(graph.firmRemove.orgNumber);
  const deletedRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.organizationId, org.id), isNotNull(contacts.deletedAt)));
  expect(deletedRows.map((row) => row.id)).toEqual([graph.contactDeleted.id]);
  expect(
    await db
      .select({ id: assignmentParties.id })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, org.id),
          or(
            eq(assignmentParties.contactId, graph.contactRemove.id),
            eq(assignmentParties.firmId, graph.firmRemove.id),
          ),
        ),
      ),
  ).toHaveLength(GRAPH_COUNTS.mergeFirms.partyCount);
});
