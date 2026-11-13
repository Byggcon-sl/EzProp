import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { auditLog, employees } from "@/db/schema";
import {
  TEST_NOW,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  ORDER_HISTORY_LIMIT,
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrderHistory,
  rejectOrder,
  updateOrder,
  type OrderInput,
} from "./index";

/*
 * Endringene på en ordre: `listOrderHistory` (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * avsnitt 4 og 7.2). Fast form, aldri rå `changes`; ukjente koder og ødelagte verdier hoppes
 * over uten unntak. Testdata er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (hvem endret hva og når, per ordre) og de ansatte
 * (historikken kan leses på ordresiden).
 */

const OLD_ADDRESS = "Testveien 12, 8000 Bodø";
const NEW_ADDRESS = "Testveien 14, 8000 Bodø";

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const admin = await createUser({ name: "Kari Testesen" });
  const employee = await createEmployee(admin, org.id, ["admin"]);
  const grant = await requireOrganizationAccess(admin, org.id);
  return { org, admin, employee, grant };
}

async function edit(
  actor: Actor,
  organizationId: string,
  orderId: string,
  overrides: Record<string, unknown>,
) {
  const order = await getOrder(actor, organizationId, orderId);
  return updateOrder(
    actor,
    organizationId,
    orderId,
    {
      receivedAt: order.receivedAt,
      externalRef: order.externalRef,
      orderedByText: order.orderedByText,
      orderedByContactId: order.orderedByContactId,
      addressText: order.addressText,
      gnr: order.gnr,
      bnr: order.bnr,
      snr: order.snr,
      housingAssociationName: order.housingAssociationName,
      sellerDeclarationReceived: order.sellerDeclarationReceived,
      ...overrides,
    } as OrderInput,
    order.rowVersion,
  );
}

function pause(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("4.1–4.2 hendelser og form", () => {
  it("4.1 opprettet, endret og avvist: nyeste først, én etikett per handling", async () => {
    // Oppretting og avvisning får tiden fra databasen, endringen fra serveren: ekte klokke her
    vi.useRealTimers();
    const { org, admin } = await setup();
    const created = await createOrder(admin, org.id, { addressText: OLD_ADDRESS });
    await pause();
    await edit(admin, org.id, created.id, { addressText: NEW_ADDRESS });
    await pause();
    await rejectOrder(admin, org.id, created.id, "Feil registrering");

    const history = await listOrderHistory(admin, org.id, created.id);
    expect(history.map((entry) => [entry.action, entry.actionLabel])).toEqual([
      ["reject", "Avvist"],
      ["update", "Endret"],
      ["create", "Opprettet"],
    ]);
  });

  it("4.1 gjort om har egen etikett", async () => {
    const { org, admin } = await setup();
    const office = await createOffice(org.id);
    const order = await insertOrder(org.id);
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history.map((entry) => entry.actionLabel)).toEqual(["Gjort om til oppdrag"]);
    expect(history[0]?.changes).toEqual([]);
  });

  it("4.2 fast form: tid, navn, handling og endringer med etikett og verdier", async () => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    await edit(admin, org.id, order.id, {
      addressText: NEW_ADDRESS,
      sellerDeclarationReceived: true,
    });

    const [entry] = await listOrderHistory(admin, org.id, order.id);
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ["action", "actionLabel", "actorName", "changes", "id", "occurredAt", "orderId"].sort(),
    );
    expect(entry).toMatchObject({
      orderId: order.id,
      actorName: "Kari Testesen",
      action: "update",
      actionLabel: "Endret",
    });
    expect(entry?.occurredAt.getTime()).toBe(TEST_NOW.getTime());
    expect(entry?.changes).toEqual([
      { field: "addressText", label: "Adresse", from: OLD_ADDRESS, to: NEW_ADDRESS },
      {
        field: "sellerDeclarationReceived",
        label: "Egenerklæring mottatt",
        from: false,
        to: true,
      },
    ]);
  });

  it("4.2 oppretting med bestiller gir ingen rå changes", async () => {
    const { org, admin } = await setup();
    const contact = await createContact(org.id);
    const created = await createOrder(admin, org.id, {
      addressText: OLD_ADDRESS,
      orderedByContactId: contact.id,
    });
    const [entry] = await listOrderHistory(admin, org.id, created.id);
    expect(entry?.changes).toEqual([]);
  });
});

describe("4.3–4.4 ukjente nøkler og ødelagte verdier", () => {
  it("4.3 ukjente feltkoder hoppes over, ingen unntak", async () => {
    const { org, admin, grant } = await setup();
    const order = await insertOrder(org.id);
    await recordAuditEvent(db, grant, {
      entityType: "order",
      entityId: order.id,
      action: "update",
      changes: {
        fields: ["secretField", "addressText", "__proto__"],
        values: {
          secretField: { from: "hemmelig-a", to: "hemmelig-b" },
          addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
        },
        extra: "skal ikke vises",
      },
    });

    const [entry] = await listOrderHistory(admin, org.id, order.id);
    expect(entry?.changes).toEqual([
      { field: "addressText", label: "Adresse", from: OLD_ADDRESS, to: NEW_ADDRESS },
    ]);
    expect(JSON.stringify(entry)).not.toContain("hemmelig");
    expect(JSON.stringify(entry)).not.toContain("skal ikke vises");
  });

  it.each([
    ["values er tekst", { fields: ["addressText", "gnr"], values: "ødelagt" }],
    ["from mangler", { fields: ["addressText", "gnr"], values: { addressText: { to: "x" } } }],
    [
      "verdien er et objekt",
      { fields: ["addressText", "gnr"], values: { addressText: { from: {}, to: [] } } },
    ],
    ["values mangler", { fields: ["addressText", "gnr"] }],
  ])("4.4 %s: linjen vises med feltetiketter uten verdier", async (_name, changes) => {
    const { org, admin, grant } = await setup();
    const order = await insertOrder(org.id);
    await recordAuditEvent(db, grant, {
      entityType: "order",
      entityId: order.id,
      action: "update",
      changes,
    });

    const [entry] = await listOrderHistory(admin, org.id, order.id);
    expect(entry?.actionLabel).toBe("Endret");
    expect(entry?.changes).toEqual([
      { field: "addressText", label: "Adresse", from: null, to: null },
      { field: "gnr", label: "Gårdsnummer", from: null, to: null },
    ]);
  });

  it.each([
    ["changes er en liste", ["addressText"]],
    ["fields er tekst", { fields: "addressText" }],
    ["changes er tomt", {}],
  ])("4.4 %s: ingen unntak", async (_name, changes) => {
    const { org, admin } = await setup();
    const order = await insertOrder(org.id);
    await db.insert(auditLog).values({
      organizationId: org.id,
      entityType: "order",
      entityId: order.id,
      action: "update",
      changes: changes as Record<string, unknown>,
    });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(1);
    expect(Array.isArray(history[0]?.changes)).toBe(true);
  });
});

describe("4.5–4.6 navn", () => {
  it("4.5 myk-slettet ansatt vises med navnet", async () => {
    const { org, admin, employee } = await setup();
    const order = await insertOrder(org.id);
    await edit(admin, org.id, order.id, { addressText: NEW_ADDRESS });
    await db.update(employees).set({ deletedAt: TEST_NOW }).where(eq(employees.id, employee.id));

    const reader = await createUser({ name: "Test Leser" });
    await createEmployee(reader, org.id, ["office"]);
    const [entry] = await listOrderHistory(reader, org.id, order.id);
    expect(entry?.actorName).toBe("Kari Testesen");
  });

  it("4.6 bestilleren vises med navn; slettet, ukjent eller fremmed kontakt som «(fjernet kontakt)»", async () => {
    const { org, admin, grant } = await setup();
    const firm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const live = await createContact(org.id, {
      firstName: "Ola",
      lastName: "Testmann",
      firmId: firm.id,
    });
    const deleted = await createContact(org.id, {
      firstName: "Slettet",
      lastName: "Kontakt",
      deletedAt: TEST_NOW,
    });
    const other = await createOrganization("Oppdiktet Takst B");
    const foreign = await createContact(other.id, { firstName: "Fremmed", lastName: "Person" });
    const order = await insertOrder(org.id);

    const rows: [string | null, string | null][] = [
      [null, live.id],
      [live.id, deleted.id],
      [deleted.id, randomUUID()],
      [null, foreign.id],
    ];
    for (const [index, [from, to]] of rows.entries()) {
      await recordAuditEvent(db, grant, {
        entityType: "order",
        entityId: order.id,
        action: "update",
        changes: {
          fields: ["orderedByContactId", "orderedByFirmId"],
          values: {
            orderedByContactId: { from, to },
            orderedByFirmId: { from: null, to: index === 0 ? firm.id : randomUUID() },
          },
        },
        occurredAt: new Date(TEST_NOW.getTime() + index * 1000),
      });
    }

    const history = await listOrderHistory(admin, org.id, order.id);
    const contactChanges = history.map((entry) =>
      entry.changes.find((change) => change.field === "orderedByContactId"),
    );
    const firmChanges = history.map((entry) =>
      entry.changes.find((change) => change.field === "orderedByFirmId"),
    );
    // Nyeste først
    expect(contactChanges.map((change) => [change?.from, change?.to])).toEqual([
      [null, "(fjernet kontakt)"],
      ["(fjernet kontakt)", "(fjernet kontakt)"],
      ["Ola Testmann", "(fjernet kontakt)"],
      [null, "Ola Testmann"],
    ]);
    expect(contactChanges[0]?.label).toBe("Bestiller");
    expect(firmChanges.map((change) => change?.to)).toEqual([
      "(fjernet firma)",
      "(fjernet firma)",
      "(fjernet firma)",
      "Testmegling Nord AS",
    ]);
    expect(JSON.stringify(history)).not.toContain("Fremmed");
    expect(JSON.stringify(history)).not.toContain("Slettet");
  });
});

describe("4.7–4.8 grense og utvalg", () => {
  it("4.7 205 loggrader gir 200 linjer, de nyeste", async () => {
    const { org, admin, grant } = await setup();
    const order = await insertOrder(org.id);
    for (let i = 0; i < 205; i += 1) {
      await recordAuditEvent(db, grant, {
        entityType: "order",
        entityId: order.id,
        action: "update",
        changes: { fields: ["gnr"], values: { gnr: { from: String(i), to: String(i + 1) } } },
        occurredAt: new Date(TEST_NOW.getTime() + i * 1000),
      });
    }

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(ORDER_HISTORY_LIMIT).toBe(200);
    expect(history).toHaveLength(200);
    expect(history[0]?.changes[0]?.to).toBe("205");
    expect(history[199]?.changes[0]?.to).toBe("6");
  });

  it("4.8 bare denne ordren og bare entity_type order", async () => {
    const { org, admin, grant } = await setup();
    const order = await insertOrder(org.id);
    const otherOrder = await insertOrder(org.id);
    await edit(admin, org.id, order.id, { addressText: NEW_ADDRESS });
    await edit(admin, org.id, otherOrder.id, { addressText: NEW_ADDRESS });
    await recordAuditEvent(db, grant, {
      entityType: "assignment",
      entityId: order.id,
      action: "update",
      changes: { fields: ["addressText"] },
    });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.orderId).toBe(order.id);
  });
});

describe("4.9 slettet, ukjent eller ugyldig ordre-id", () => {
  it.each(["myk-slettet", "ukjent uuid", "abc", ""] as const)(
    "%s gir AccessDeniedError",
    async (variant) => {
      const { org, admin } = await setup();
      let orderId: string = variant;
      if (variant === "myk-slettet") {
        const order = await insertOrder(org.id, { deletedAt: TEST_NOW });
        orderId = order.id;
      } else if (variant === "ukjent uuid") {
        orderId = randomUUID();
      }
      await expect(listOrderHistory(admin, org.id, orderId)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    },
  );
});

describe("7. tenant-isolasjon for listOrderHistory", () => {
  it("7.2 expectTenantIsolation: bare egne linjer", async () => {
    const orgOf = new Map<string, string>();
    const orderOfEntry = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const order = await insertOrder(grant.organizationId);
          orgOf.set(order.id, grant.organizationId);
          await recordAuditEvent(db, grant, {
            entityType: "order",
            entityId: order.id,
            action: "update",
            changes: { fields: ["gnr"], values: { gnr: { from: null, to: "1" } } },
          });
          const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, order.id));
          if (!row) throw new Error("fant ikke loggraden");
          orderOfEntry.set(row.id, order.id);
          result[side].push(row.id);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        const entries = [];
        for (const [orderId, owner] of orgOf) {
          if (owner === organizationId) {
            entries.push(...(await listOrderHistory(actor, organizationId, orderId)));
          } else {
            try {
              entries.push(...(await listOrderHistory(actor, organizationId, orderId)));
            } catch (error) {
              if (!(error instanceof AccessDeniedError)) throw error;
            }
          }
        }
        for (const entry of entries) expect(orderOfEntry.get(entry.id)).toBe(entry.orderId);
        return entries;
      },
      idOf: (entry) => entry.id,
    });
  });

  it("7.3 ansatt i A med A sin organisasjons-id og B sin ordre-id får AccessDeniedError", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    const userA = await createUser({ name: "Test Ansatt A" });
    const userB = await createUser({ name: "Test Ansatt B" });
    await createEmployee(userA, orgA.id, ["admin"]);
    await createEmployee(userB, orgB.id, ["admin"]);
    const orderB = await insertOrder(orgB.id);
    await edit(userB, orgB.id, orderB.id, { addressText: NEW_ADDRESS });

    await expect(listOrderHistory(userA, orgA.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(listOrderHistory(userA, orgB.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });
});
