import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";

import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import { assignments, auditLog, contacts, events, orders } from "@/db/schema";
import {
  TEST_NOW,
  createAssignment,
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
  ORDER_EDITABLE_FIELDS,
  OrderChangedError,
  convertOrderToAssignment,
  createOrder,
  getOrder,
  listOrderHistory,
  listOrders,
  orderFieldLabel,
  rejectOrder,
  updateOrder,
} from "./index";

/*
 * Endre en ordre etter at den er lagret (T1): kjernen. Utviklerens egne tester for biten
 * «updateOrder, listOrderHistory, feltliste og T-0031». Testplanen i
 * docs/funksjoner/fase2a-rette-ordre-testplan.md dekkes i tillegg av testskriveren.
 *
 * Fast tid: TEST_NOW. Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (ordren kan endres i alle statuser), KI i bunnen (feltkoder i fast
 * rekkefølge i loggen) og færre reklamasjoner (hvem, hva og når står i loggen, oppdraget endres
 * ikke stille, ingen annen organisasjon kan lese eller endre).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const ADDRESS = "Testveien 12, 8000 Bodø";
const NEW_ADDRESS = "Testveien 14, 8000 Bodø";
const EARLIER = new Date("2026-11-01T08:00:00Z");

async function orgWithAdmin(name = "Test Admin") {
  const org = await createOrganization();
  const admin = await createUser({ name });
  const employee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, employee };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

async function orderAudit(orgId: string, id: string, action = "update") {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.organizationId, orgId),
        eq(auditLog.entityId, id),
        eq(auditLog.action, action),
      ),
    );
}

async function updatedEvents(orgId: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.organizationId, orgId), eq(events.type, "order.updated")));
}

/** Input slik skjemaet sender det: alle feltene, med verdiene fra raden. */
function sameAs(
  row: Awaited<ReturnType<typeof orderRow>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    receivedAt: row.receivedAt,
    externalRef: row.externalRef,
    orderedByText: row.orderedByText,
    orderedByContactId: row.orderedByContactId,
    addressText: row.addressText,
    gnr: row.gnr,
    bnr: row.bnr,
    snr: row.snr,
    housingAssociationName: row.housingAssociationName,
    sellerDeclarationReceived: row.sellerDeclarationReceived,
    ...overrides,
  } as Parameters<typeof updateOrder>[3];
}

describe("feltlisten og etikettene", () => {
  it("listen er fast og har norsk etikett for hver kode, uten «rett»", () => {
    expect([...ORDER_EDITABLE_FIELDS]).toEqual([
      "receivedAt",
      "externalRef",
      "orderedByText",
      "orderedByContactId",
      "orderedByFirmId",
      "addressText",
      "gnr",
      "bnr",
      "snr",
      "housingAssociationName",
      "sellerDeclarationReceived",
    ]);
    for (const code of ORDER_EDITABLE_FIELDS) {
      const label = orderFieldLabel(code);
      expect(label).not.toBe(code);
      expect(label.length).toBeGreaterThan(0);
      expect(label.toLowerCase()).not.toMatch(/\brett/);
    }
    expect(orderFieldLabel("ukjent")).toBe("ukjent");
    expect(orderFieldLabel("__proto__")).toBe("__proto__");
  });
});

describe("updateOrder", () => {
  it.each(["received", "converted", "rejected"] as const)(
    "endrer adressen på en ordre med status %s, øker row_version og logger",
    async (status) => {
      const { org, admin, employee } = await orgWithAdmin();
      const assignment = status === "converted" ? await createAssignment(org.id) : undefined;
      const order = await insertOrder(org.id, {
        status,
        assignmentId: assignment?.id ?? null,
        rejectedReason: status === "rejected" ? "Dobbel bestilling" : null,
      });
      const before = await getOrder(admin, org.id, order.id);

      const result = await updateOrder(
        admin,
        org.id,
        order.id,
        sameAs(order, { addressText: NEW_ADDRESS }),
        before.rowVersion,
      );

      expect(result.addressText).toBe(NEW_ADDRESS);
      expect(result.rowVersion).toBe(before.rowVersion + 1);
      expect(result.status).toBe(status);
      const after = await orderRow(order.id);
      expect(after.status).toBe(status);
      expect(after.assignmentId).toBe(order.assignmentId);
      expect(after.rejectedReason).toBe(order.rejectedReason);
      expect(after.updatedBy).toBe(employee.id);

      const [audit] = await orderAudit(org.id, order.id);
      expect(audit?.actorEmployeeId).toBe(employee.id);
      expect(audit?.changes).toEqual({
        fields: ["addressText"],
        values: { addressText: { from: ADDRESS, to: NEW_ADDRESS } },
      });
      const evs = await updatedEvents(org.id);
      expect(evs).toHaveLength(1);
      expect(evs[0]?.data).toEqual({ orderId: order.id, fields: ["addressText"] });
    },
  );

  it("endrer flere felt: fields i fast rekkefølge, tom tekst blir null, dato som ISO", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { externalRef: "REF-1", gnr: "12" });
    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      {
        sellerDeclarationReceived: "on",
        gnr: "",
        addressText: NEW_ADDRESS,
        externalRef: "  ",
        receivedAt: EARLIER,
      },
      order.rowVersion,
    );
    expect(result).toMatchObject({ externalRef: null, gnr: null, sellerDeclarationReceived: true });
    const [audit] = await orderAudit(org.id, order.id);
    expect(audit?.changes).toEqual({
      fields: ["receivedAt", "externalRef", "addressText", "gnr", "sellerDeclarationReceived"],
      values: {
        receivedAt: { from: TEST_NOW.toISOString(), to: EARLIER.toISOString() },
        externalRef: { from: "REF-1", to: null },
        addressText: { from: ADDRESS, to: NEW_ADDRESS },
        gnr: { from: "12", to: null },
        sellerDeclarationReceived: { from: false, to: true },
      },
    });
  });

  it("adressen kan ikke tømmes, og ugyldig input gir samme feil som ved oppretting", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const bad = { addressText: "", gnr: "12a" };
    const updateError = await updateOrder(admin, org.id, order.id, bad, order.rowVersion).catch(
      (e: unknown) => e,
    );
    const createError = await createOrder(admin, org.id, bad).catch((e: unknown) => e);
    expect(updateError).toBeInstanceOf(ZodError);
    expect((updateError as ZodError).issues.map((i) => i.message)).toEqual(
      (createError as ZodError).issues.map((i) => i.message),
    );
    expect((await orderRow(order.id)).rowVersion).toBe(order.rowVersion);
    expect(await orderAudit(org.id, order.id)).toHaveLength(0);
  });

  it("lagring uten endring: ingen loggrad, ingen hendelse, row_version og updated_at uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { receivedAt: EARLIER, externalRef: null });
    const result = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { externalRef: "", receivedAt: new Date(EARLIER.getTime()) }),
      order.rowVersion,
    );
    expect(result.rowVersion).toBe(order.rowVersion);
    const after = await orderRow(order.id);
    expect(after.rowVersion).toBe(order.rowVersion);
    expect(after.updatedAt.getTime()).toBe(order.updatedAt.getTime());
    expect(await orderAudit(org.id, order.id)).toHaveLength(0);
    expect(await updatedEvents(org.id)).toHaveLength(0);
  });

  it("20b tom mottatt beholder verdien på raden, også når et annet felt endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { receivedAt: EARLIER });

    await updateOrder(admin, org.id, order.id, sameAs(order, { receivedAt: "" }), order.rowVersion);
    let after = await orderRow(order.id);
    expect(after.receivedAt.getTime()).toBe(EARLIER.getTime());
    expect(after.rowVersion).toBe(order.rowVersion);
    expect(await orderAudit(org.id, order.id)).toHaveLength(0);

    await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { receivedAt: undefined, addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    after = await orderRow(order.id);
    expect(after.receivedAt.getTime()).toBe(EARLIER.getTime());
    const [audit] = await orderAudit(org.id, order.id);
    expect((audit?.changes as { fields: string[] }).fields).toEqual(["addressText"]);
  });

  it("20c oppretting med tom mottatt gir fortsatt nå", async () => {
    const { org, admin } = await orgWithAdmin();
    const row = await createOrder(admin, org.id, { addressText: ADDRESS, receivedAt: "" });
    expect(row.receivedAt.getTime()).toBe(TEST_NOW.getTime());
  });

  it("bestilleren kobles, byttes og fjernes; firmaet følger kontakten", async () => {
    const { org, admin } = await orgWithAdmin();
    const firmA = await createFirm(org.id, { name: "Testmegling A AS" });
    const firmB = await createFirm(org.id, { name: "Testmegling B AS" });
    const contactA = await createContact(org.id, { firmId: firmA.id });
    const contactB = await createContact(org.id, { firstName: "Kari", firmId: firmB.id });
    const contactNoFirm = await createContact(org.id, { firstName: "Ola", firmId: null });
    const order = await insertOrder(org.id);

    let r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { orderedByContactId: contactA.id }),
      order.rowVersion,
    );
    expect(r).toMatchObject({ orderedByContactId: contactA.id, orderedByFirmId: firmA.id });

    r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { orderedByContactId: contactB.id }),
      r.rowVersion,
    );
    expect(r).toMatchObject({ orderedByContactId: contactB.id, orderedByFirmId: firmB.id });

    r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { orderedByContactId: contactNoFirm.id }),
      r.rowVersion,
    );
    expect(r).toMatchObject({ orderedByContactId: contactNoFirm.id, orderedByFirmId: null });

    r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { orderedByContactId: contactB.id }),
      r.rowVersion,
    );
    r = await updateOrder(admin, org.id, order.id, sameAs(order), r.rowVersion);
    expect(r).toMatchObject({ orderedByContactId: null, orderedByFirmId: null });

    const audits = await orderAudit(org.id, order.id);
    const last = audits.find(
      (a) =>
        (a.changes as { values: Record<string, { to: unknown }> }).values.orderedByContactId?.to ===
        null,
    );
    expect(last?.changes).toEqual({
      fields: ["orderedByContactId", "orderedByFirmId"],
      values: {
        orderedByContactId: { from: contactB.id, to: null },
        orderedByFirmId: { from: firmB.id, to: null },
      },
    });
    expect(JSON.stringify(audits.map((a) => a.changes))).not.toContain("Kari");
  });

  it("2.8 firma-id fra skjemaet ignoreres (fremmed, egen, uten kontakt)", async () => {
    const { org, admin } = await orgWithAdmin();
    const otherOrg = await createOrganization("Annen organisasjon");
    const foreignFirm = await createFirm(otherOrg.id);
    const ownFirm = await createFirm(org.id, { name: "Eget firma AS" });
    const contactFirm = await createFirm(org.id, { name: "Kontaktens firma AS" });
    const contact = await createContact(org.id, { firmId: contactFirm.id });

    for (const firmId of [foreignFirm.id, ownFirm.id]) {
      const order = await insertOrder(org.id);
      const r = await updateOrder(
        admin,
        org.id,
        order.id,
        sameAs(order, { orderedByContactId: contact.id, orderedByFirmId: firmId }),
        order.rowVersion,
      );
      expect(r.orderedByFirmId).toBe(contactFirm.id);
    }

    const order = await insertOrder(org.id);
    const r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { orderedByFirmId: foreignFirm.id }),
      order.rowVersion,
    );
    expect(r.orderedByFirmId).toBeNull();
    expect(r.rowVersion).toBe(order.rowVersion);
    expect(await orderAudit(org.id, order.id)).toHaveLength(0);
  });

  it("uendret kontakt som senere er fjernet stopper ikke endring av andre felt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, {
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
    await db.update(contacts).set({ deletedAt: TEST_NOW }).where(eq(contacts.id, contact.id));

    const r = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    );
    expect(r).toMatchObject({
      addressText: NEW_ADDRESS,
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
  });

  it("felt utenfor listen skrives aldri", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const other = await createOrganization("Annen");
    await updateOrder(
      admin,
      org.id,
      order.id,
      {
        ...sameAs(order, { addressText: NEW_ADDRESS }),
        status: "rejected",
        rejectedReason: "x",
        assignmentId: randomUUID(),
        source: "email",
        requestedReportType: "other",
        organizationId: other.id,
        deletedAt: TEST_NOW,
      } as Parameters<typeof updateOrder>[3],
      order.rowVersion,
    );
    const after = await orderRow(order.id);
    expect(after).toMatchObject({
      status: "received",
      rejectedReason: null,
      assignmentId: null,
      source: "manual",
      requestedReportType: "condition_report",
      organizationId: org.id,
      deletedAt: null,
      addressText: NEW_ADDRESS,
    });
  });

  it.each([
    ["annen organisasjon", "foreign"],
    ["ukjent", "unknown"],
    ["myk-slettet", "deleted"],
  ] as const)("kontakt %s gir ContactNotFoundError og ingen endring", async (_label, kind) => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Annen");
    const contactId =
      kind === "foreign"
        ? (await createContact(other.id)).id
        : kind === "deleted"
          ? (await createContact(org.id, { deletedAt: TEST_NOW })).id
          : randomUUID();
    const order = await insertOrder(org.id);
    await expect(
      updateOrder(
        admin,
        org.id,
        order.id,
        sameAs(order, { orderedByContactId: contactId, addressText: NEW_ADDRESS }),
        order.rowVersion,
      ),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
    const after = await orderRow(order.id);
    expect(after.addressText).toBe(ADDRESS);
    expect(after.rowVersion).toBe(order.rowVersion);
    expect(await orderAudit(org.id, order.id)).toHaveLength(0);
    expect(await updatedEvents(org.id)).toHaveLength(0);
  });

  it.each([
    ["myk-slettet", "deleted"],
    ["ukjent", "unknown"],
    ["ikke-uuid", "abc"],
    ["tom", ""],
  ] as const)("%s ordre gir AccessDeniedError", async (_label, kind) => {
    const { org, admin } = await orgWithAdmin();
    const deleted = await insertOrder(org.id, { deletedAt: TEST_NOW });
    const id = kind === "deleted" ? deleted.id : kind === "unknown" ? randomUUID() : kind;
    await expect(
      updateOrder(admin, org.id, id, { addressText: NEW_ADDRESS }, 1),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listOrderHistory(admin, org.id, id)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await orderAudit(org.id, deleted.id)).toHaveLength(0);
  });

  it("gammel rowVersion gir OrderChangedError; avvisning og konvertering øker row_version", async () => {
    const { org, admin } = await orgWithAdmin();
    const office = await createOffice(org.id);

    const order = await insertOrder(org.id);
    await updateOrder(admin, org.id, order.id, sameAs(order, { gnr: "1" }), order.rowVersion);
    const error = await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { addressText: NEW_ADDRESS }),
      order.rowVersion,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderChangedError);
    expect((error as Error).message).toBe("Ordren er endret av en annen. Last siden på nytt.");
    expect((error as Error).name).toBe("OrderChangedError");
    expect((await orderRow(order.id)).addressText).toBe(ADDRESS);

    const toReject = await insertOrder(org.id);
    await rejectOrder(admin, org.id, toReject.id, "Dobbel bestilling");
    expect((await orderRow(toReject.id)).rowVersion).toBe(toReject.rowVersion + 1);
    await expect(
      updateOrder(admin, org.id, toReject.id, sameAs(toReject, { gnr: "2" }), toReject.rowVersion),
    ).rejects.toBeInstanceOf(OrderChangedError);

    const toConvert = await insertOrder(org.id);
    await convertOrderToAssignment(admin, org.id, toConvert.id, { officeId: office.id });
    expect((await orderRow(toConvert.id)).rowVersion).toBe(toConvert.rowVersion + 1);
    await expect(
      updateOrder(
        admin,
        org.id,
        toConvert.id,
        sameAs(toConvert, { gnr: "2" }),
        toConvert.rowVersion,
      ),
    ).rejects.toBeInstanceOf(OrderChangedError);
  });

  it("to samtidige lagringer med samme rowVersion: nøyaktig én lykkes", async () => {
    vi.useRealTimers();
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { receivedAt: EARLIER });
    const results = await Promise.allSettled([
      updateOrder(admin, org.id, order.id, sameAs(order, { gnr: "1" }), order.rowVersion),
      updateOrder(admin, org.id, order.id, sameAs(order, { gnr: "2" }), order.rowVersion),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(OrderChangedError);
    expect((await orderRow(order.id)).rowVersion).toBe(order.rowVersion + 1);
    expect(await orderAudit(org.id, order.id)).toHaveLength(1);
  });

  it("oppdraget endres ikke når en gjort-om ordre endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const office = await createOffice(org.id);
    const order = await insertOrder(org.id);
    const { assignment } = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
    });
    const [before] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    const current = await getOrder(admin, org.id, order.id);
    await updateOrder(
      admin,
      org.id,
      order.id,
      sameAs(order, { addressText: NEW_ADDRESS }),
      current.rowVersion,
    );
    const [after] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(after).toEqual(before);
  });

  it("tenant-isolasjon: updateOrder endrer og gir bare egne ordre", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const list = await listOrders(actor, organizationId);
        const out = [];
        for (const item of list) {
          const current = await getOrder(actor, organizationId, item.id);
          out.push(
            await updateOrder(
              actor,
              organizationId,
              item.id,
              { addressText: current.addressText, externalRef: "TEST-REF-9" },
              current.rowVersion,
            ),
          );
        }
        return out;
      },
      idOf: (row) => row.id,
    });
  });

  it("tenant-isolasjon: ordre-id fra B under A sin organisasjon gir AccessDeniedError", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Admin A");
    const { org: orgB } = await orgWithAdmin("Admin B");
    const orderB = await insertOrder(orgB.id);
    await expect(
      updateOrder(adminA, orgA.id, orderB.id, sameAs(orderB, { gnr: "9" }), orderB.rowVersion),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateOrder(adminA, orgB.id, orderB.id, sameAs(orderB), 1)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(listOrderHistory(adminA, orgA.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await orderRow(orderB.id)).toEqual(orderB);
    expect(await orderAudit(orgB.id, orderB.id)).toHaveLength(0);
  });
});

describe("listOrderHistory", () => {
  it("viser handlingene nyeste først, med navn, etikett og verdier; kontakt og firma med navn", async () => {
    const { org, admin } = await orgWithAdmin("Kari Testesen");
    const firm = await createFirm(org.id, { name: "Testmegling AS" });
    const contact = await createContact(org.id, {
      firstName: "Ola",
      lastName: "Testmann",
      firmId: firm.id,
    });
    const created = await createOrder(admin, org.id, { addressText: ADDRESS });
    vi.setSystemTime(new Date(TEST_NOW.getTime() + 60_000));
    const current = await getOrder(admin, org.id, created.id);
    await updateOrder(
      admin,
      org.id,
      created.id,
      { addressText: NEW_ADDRESS, orderedByContactId: contact.id, receivedAt: current.receivedAt },
      current.rowVersion,
    );
    vi.setSystemTime(new Date(TEST_NOW.getTime() + 120_000));
    await rejectOrder(admin, org.id, created.id, "Dobbel bestilling");

    const history = await listOrderHistory(admin, org.id, created.id);
    expect(history.map((h) => [h.action, h.actionLabel])).toEqual([
      ["reject", "Avvist"],
      ["update", "Endret"],
      ["create", "Opprettet"],
    ]);
    expect(history.every((h) => h.actorName === "Kari Testesen")).toBe(true);
    expect(history.every((h) => h.orderId === created.id)).toBe(true);
    expect(history[0]?.changes).toEqual([]);
    expect(history[2]?.changes).toEqual([]);
    expect(history[1]?.changes).toEqual([
      { field: "orderedByContactId", label: "Bestiller", from: null, to: "Ola Testmann" },
      { field: "orderedByFirmId", label: "Firma", from: null, to: "Testmegling AS" },
      { field: "addressText", label: "Adresse", from: ADDRESS, to: NEW_ADDRESS },
    ]);
    expect(history[1]?.occurredAt).toBeInstanceOf(Date);
  });

  it("ukjente nøkler hoppes over, ødelagte verdier gir linje uten verdier, fjernet kontakt og firma", async () => {
    const { org, admin, employee } = await orgWithAdmin();
    const other = await createOrganization("Annen");
    const foreignContact = await createContact(other.id);
    const deletedFirm = await createFirm(org.id, { deletedAt: TEST_NOW });
    const order = await insertOrder(org.id);
    const insert = (changes: unknown, minutes: number) =>
      db.insert(auditLog).values({
        organizationId: org.id,
        actorEmployeeId: employee.id,
        entityType: "order",
        entityId: order.id,
        action: "update",
        changes: changes as Record<string, unknown>,
        occurredAt: new Date(TEST_NOW.getTime() + minutes * 60_000),
      });
    await insert(
      {
        fields: ["secretField", "gnr", 7],
        values: { secretField: { from: "x", to: "y" }, gnr: { from: "1", to: "2" } },
      },
      1,
    );
    await insert({ fields: ["addressText"], values: "ødelagt" }, 2);
    await insert({ fields: ["bnr"], values: { bnr: { to: "3" } } }, 3);
    await insert(
      {
        fields: ["orderedByContactId", "orderedByFirmId"],
        values: {
          orderedByContactId: { from: foreignContact.id, to: "ikke-en-id" },
          orderedByFirmId: { from: deletedFirm.id, to: null },
        },
      },
      4,
    );
    await insert("helt ødelagt", 5);
    // Annen ordre og annen entitetstype med samme id tas ikke med
    await db.insert(auditLog).values({
      organizationId: org.id,
      entityType: "assignment",
      entityId: order.id,
      action: "update",
      changes: {},
    });

    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(5);
    expect(history[0]?.changes).toEqual([]);
    expect(history[1]?.changes).toEqual([
      {
        field: "orderedByContactId",
        label: "Bestiller",
        from: "(fjernet kontakt)",
        to: "(fjernet kontakt)",
      },
      { field: "orderedByFirmId", label: "Firma", from: "(fjernet firma)", to: null },
    ]);
    expect(history[2]?.changes).toEqual([
      { field: "bnr", label: "Bruksnummer", from: null, to: null },
    ]);
    expect(history[3]?.changes).toEqual([
      { field: "addressText", label: "Adresse", from: null, to: null },
    ]);
    expect(history[4]?.changes).toEqual([
      { field: "gnr", label: "Gårdsnummer", from: "1", to: "2" },
    ]);
    expect(JSON.stringify(history)).not.toContain("secretField");
  });

  it("høyst 200 linjer, de nyeste", async () => {
    const { org, admin, employee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await db.insert(auditLog).values(
      Array.from({ length: 205 }, (_, i) => ({
        organizationId: org.id,
        actorEmployeeId: employee.id,
        entityType: "order",
        entityId: order.id,
        action: "update",
        changes: { fields: ["gnr"], values: { gnr: { from: String(i), to: String(i + 1) } } },
        occurredAt: new Date(TEST_NOW.getTime() + i * 1000),
      })),
    );
    const history = await listOrderHistory(admin, org.id, order.id);
    expect(history).toHaveLength(200);
    expect(history[0]?.changes[0]?.from).toBe("204");
    expect(history[199]?.changes[0]?.from).toBe("5");
  });

  it("tenant-isolasjon: bare egne linjer", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const out = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const order = await insertOrder(grant.organizationId);
          const [row] = await db
            .insert(auditLog)
            .values({
              organizationId: grant.organizationId,
              actorEmployeeId: grant.employeeId,
              entityType: "order",
              entityId: order.id,
              action: "update",
              changes: { fields: ["gnr"], values: { gnr: { from: null, to: "1" } } },
            })
            .returning({ id: auditLog.id });
          out[key].push(row!.id);
        }
        return out;
      },
      query: async (actor, organizationId) => {
        const list = await listOrders(actor, organizationId);
        const lines = [];
        for (const item of list)
          lines.push(...(await listOrderHistory(actor, organizationId, item.id)));
        return lines;
      },
      idOf: (row) => row.id,
    });
  });
});

describe("T-0031 listOrders viser kansellert oppdrag", () => {
  it("assignmentCancelled er sann for myk-slettet oppdrag, ellers usann", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Annen");
    const active = await createAssignment(org.id);
    const cancelled = await createAssignment(org.id, { deletedAt: TEST_NOW });
    const foreignCancelled = await createAssignment(other.id, { deletedAt: TEST_NOW });
    const withActive = await insertOrder(org.id, { status: "converted", assignmentId: active.id });
    const withCancelled = await insertOrder(org.id, {
      status: "converted",
      assignmentId: cancelled.id,
    });
    const without = await insertOrder(org.id);
    await insertOrder(other.id, { status: "converted", assignmentId: foreignCancelled.id });

    const list = await listOrders(admin, org.id);
    const byId = new Map(list.map((o) => [o.id, o.assignmentCancelled]));
    expect(list).toHaveLength(3);
    expect(byId.get(withActive.id)).toBe(false);
    expect(byId.get(withCancelled.id)).toBe(true);
    expect(byId.get(without.id)).toBe(false);
  });
});
