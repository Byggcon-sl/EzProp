import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, contacts, orders } from "@/db/schema";
import {
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  OrderChangedError,
  REMOVED_CONTACT_LABEL,
  createOrder,
  getOrder,
  listOrderHistory,
  orderHistoryActionLabel,
  updateOrder,
} from "./index";

/*
 * Utviklerens egne tester for `listOrderHistory` og hovedflyten i `updateOrder` (T1). Den fulle
 * testplanen (docs/funksjoner/fase2a-rette-ordre-testplan.md) står i `update-order.test.ts`.
 * Støtter hovedmål: de ansatte (ordren rettes i stedet for å legges inn på nytt) og færre
 * reklamasjoner (det står hvem som endret hva). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const OLD_ADDRESS = "Prøveveien 1, 8000 Bodø";
const NEW_ADDRESS = "Prøveveien 11, 8000 Bodø";

async function setup() {
  const org = await createOrganization();
  const user = await createUser({ name: "Kontor Prøve" });
  await createEmployee(user, org.id, ["office"]);
  const order = await createOrder(user, org.id, { addressText: OLD_ADDRESS }, NOW);
  return { org, user, order };
}

async function edit(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: Record<string, unknown>,
) {
  const current = await getOrder(actor, organizationId, orderId);
  return updateOrder(
    actor,
    organizationId,
    orderId,
    {
      addressText: current.addressText,
      receivedAt: current.receivedAt,
      orderedByContactId: current.orderedByContactId,
      ...input,
    },
    current.rowVersion,
    NOW,
  );
}

describe("updateOrder og listOrderHistory", () => {
  it("endring gir én loggrad med feltkoder og verdier, og historikken viser gammel og ny verdi", async () => {
    const { org, user, order } = await setup();
    const firm = await createFirm(org.id, { name: "Prøvemegling AS" });
    const contact = await createContact(org.id, {
      firstName: "Prøve",
      lastName: "Megler",
      firmId: firm.id,
    });

    const updated = await edit(user, org.id, order.id, {
      addressText: NEW_ADDRESS,
      orderedByContactId: contact.id,
    });
    expect(updated.addressText).toBe(NEW_ADDRESS);
    expect(updated.orderedByFirmId).toBe(firm.id);
    expect(updated.rowVersion).toBe(order.rowVersion + 1);

    const [row] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, order.id), eq(auditLog.action, "update")));
    expect(row?.changes).toEqual({
      fields: ["orderedByContactId", "orderedByFirmId", "addressText"],
      values: {
        orderedByContactId: { from: null, to: contact.id },
        orderedByFirmId: { from: null, to: firm.id },
        addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
      },
    });

    const history = await listOrderHistory(user, org.id, order.id);
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0]).toEqual({
      id: expect.any(String),
      action: "update",
      actorName: "Kontor Prøve",
      occurredAt: expect.any(Date),
      fields: ["orderedByContactId", "orderedByFirmId", "addressText"],
      values: [
        { field: "orderedByContactId", from: null, to: "Prøve Megler" },
        { field: "orderedByFirmId", from: null, to: "Prøvemegling AS" },
        { field: "addressText", from: OLD_ADDRESS, to: NEW_ADDRESS },
      ],
    });
    expect(orderHistoryActionLabel("update")).toBe("Endret");
    expect(orderHistoryActionLabel("convert")).toBe("Gjort om til oppdrag");

    // Fjernet kontakt vises uten navn
    await db.update(contacts).set({ deletedAt: NOW }).where(eq(contacts.id, contact.id));
    const [latest] = await listOrderHistory(user, org.id, order.id);
    expect(latest?.values[0]).toEqual({
      field: "orderedByContactId",
      from: null,
      to: REMOVED_CONTACT_LABEL,
    });
  });

  it("lagring uten endring gir ingen loggrad og samme versjon; gammel versjon gir OrderChangedError", async () => {
    const { org, user, order } = await setup();
    const same = await edit(user, org.id, order.id, { addressText: `  ${OLD_ADDRESS}  ` });
    expect(same.rowVersion).toBe(order.rowVersion);
    expect(await listOrderHistory(user, org.id, order.id)).toHaveLength(1);

    await edit(user, org.id, order.id, { addressText: NEW_ADDRESS });
    await expect(
      updateOrder(user, org.id, order.id, { addressText: OLD_ADDRESS }, order.rowVersion, NOW),
    ).rejects.toBeInstanceOf(OrderChangedError);
    const [stored] = await db
      .select({ addressText: orders.addressText })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(stored?.addressText).toBe(NEW_ADDRESS);
  });

  it("ukjente feltkoder og verdier i feil form hoppes over uten unntak", async () => {
    const { org, user, order } = await setup();
    const [employee] = await db.query.employees.findMany({ limit: 1 });
    await db.insert(auditLog).values({
      organizationId: org.id,
      actorEmployeeId: employee?.id,
      entityType: "order",
      entityId: order.id,
      action: "update",
      changes: {
        fields: ["status", "addressText", 42, "__proto__"],
        values: {
          status: { from: "received", to: "rejected" },
          addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
          gnr: "ikke et objekt",
          bnr: { from: "1" },
        },
      },
    });
    const [entry] = await listOrderHistory(user, org.id, order.id);
    expect(entry?.fields).toEqual(["addressText"]);
    expect(entry?.values).toEqual([{ field: "addressText", from: OLD_ADDRESS, to: NEW_ADDRESS }]);
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ["action", "actorName", "fields", "id", "occurredAt", "values"].sort(),
    );
  });

  it("ikke-uuid og myk-slettet ordre gir AccessDeniedError", async () => {
    const { org, user, order } = await setup();
    await expect(listOrderHistory(user, org.id, "ikke-en-id")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await db.update(orders).set({ deletedAt: NOW }).where(eq(orders.id, order.id));
    await expect(listOrderHistory(user, org.id, order.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("tenant-isolasjon: listOrderHistory gir bare loggrader fra egen organisasjon", async () => {
    const orderIds = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const [order] = await db
            .insert(orders)
            .values({
              organizationId: grant.organizationId,
              addressText: OLD_ADDRESS,
              receivedAt: NOW,
              source: "manual",
              requestedReportType: "condition_report",
              status: "received",
            })
            .returning();
          if (!order) throw new Error("mangler ordre");
          orderIds.set(grant.organizationId, order.id);
          const [log] = await db
            .insert(auditLog)
            .values({
              organizationId: grant.organizationId,
              actorEmployeeId: grant.employeeId,
              entityType: "order",
              entityId: order.id,
              action: "create",
            })
            .returning({ id: auditLog.id });
          if (log) result[key].push(log.id);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        // Fremmed organisasjon: tilgangssjekken skal stoppe før ordre-id-en betyr noe.
        const orderId = orderIds.get(organizationId) ?? [...orderIds.values()][0] ?? "";
        return listOrderHistory(actor, organizationId, orderId);
      },
      idOf: (row) => row.id,
    });
  });
});
