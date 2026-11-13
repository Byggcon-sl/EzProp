import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignmentParties,
  assignments,
  auditLog,
  contacts,
  events,
  orders,
} from "@/db/schema";
import { fakeAiProvider } from "../../../tests/ai";
import {
  TEST_NOW,
  createAssignmentParty,
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
  OrderChangedError,
  convertOrderToAssignment,
  createOrder,
  getOrder,
  rejectOrder,
  updateOrder,
  type OrderInput,
} from "./index";

/*
 * Endre en lagret ordre: `updateOrder` (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 2
 * og 7.1, 7.3–7.5). 2.25 (samme transaksjon) står i orders-transaction.test.ts.
 *
 * Fast tid: TEST_NOW (03.11.2026 kl. 11 i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (en feil rettes på stedet, i alle statuser), KI i bunnen (én
 * loggrad med feltkodene per lagring) og færre reklamasjoner (hvem endret hva, og oppdraget
 * endres ikke stille).
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
  vi.restoreAllMocks();
});

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const admin = await createUser({ name: "Test Admin" });
  const employee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, employee };
}

type Order = Awaited<ReturnType<typeof getOrder>>;

/** Skjemaet slik det åpnes: forhåndsutfylt fra `getOrder`. */
function formFrom(order: Order, overrides: Record<string, unknown> = {}): OrderInput {
  return {
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
  } as OrderInput;
}

/** Leser ordren og endrer den med skjemaet fra `getOrder` pluss `overrides`. */
async function edit(
  actor: Actor,
  organizationId: string,
  orderId: string,
  overrides: Record<string, unknown>,
) {
  const order = await getOrder(actor, organizationId, orderId);
  return updateOrder(actor, organizationId, orderId, formFrom(order, overrides), order.rowVersion);
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

async function updateAuditRows(orderId: string) {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "order"),
        eq(auditLog.entityId, orderId),
        eq(auditLog.action, "update"),
      ),
    );
}

async function updatedEvents() {
  return db.select().from(events).where(eq(events.type, "order.updated"));
}

async function auditCount() {
  const [row] = await db.select({ n: count() }).from(auditLog);
  return row?.n ?? 0;
}

async function captureError(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("forventet en feil");
}

describe("2.1–2.3 vellykket endring", () => {
  it.each(["received", "converted", "rejected"] as const)(
    "2.1 ordre med status %s kan endres",
    async (status) => {
      const { org, admin } = await setup();
      const overrides: Record<string, unknown> = { status };
      if (status === "converted") overrides.assignmentId = (await createAssignmentFor(org.id)).id;
      if (status === "rejected") overrides.rejectedReason = "Feil registrering";
      const inserted = await insertOrder(org.id, overrides);
      const before = await orderRow(inserted.id);

      vi.setSystemTime(new Date(TEST_NOW.getTime() + 60_000));
      const result = await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS });

      expect(result.addressText).toBe(NEW_ADDRESS);
      expect(result.status).toBe(status);
      expect(result.rowVersion).toBe(before.rowVersion + 1);
      const after = await getOrder(admin, org.id, inserted.id);
      expect(after.addressText).toBe(NEW_ADDRESS);
      expect(after.rowVersion).toBe(before.rowVersion + 1);
      const row = await orderRow(inserted.id);
      expect(row.updatedAt.getTime()).toBe(TEST_NOW.getTime() + 60_000);
    },
  );

  it("2.2 alle feltene i listen kan endres i én lagring", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const contact = await createContact(org.id, { firstName: "Kari", lastName: "Testesen", firmId: firm.id });
    const inserted = await insertOrder(org.id);

    const result = await edit(admin, org.id, inserted.id, {
      receivedAt: "2026-11-02T08:00:00.000Z",
      externalRef: "TEST-REF-77",
      orderedByText: "Kari Testesen, Testmegling Nord AS",
      orderedByContactId: contact.id,
      addressText: NEW_ADDRESS,
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: "Testtoppen borettslag",
      sellerDeclarationReceived: true,
    });

    expect(result).toMatchObject({
      externalRef: "TEST-REF-77",
      orderedByText: "Kari Testesen, Testmegling Nord AS",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      addressText: NEW_ADDRESS,
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: "Testtoppen borettslag",
      sellerDeclarationReceived: true,
    });
    expect(result.receivedAt.toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("2.3 valgfrie felt kan tømmes", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id, {
      externalRef: "TEST-REF-1",
      gnr: "1",
      bnr: "2",
      snr: "3",
      housingAssociationName: "Testtoppen borettslag",
    });

    const result = await edit(admin, org.id, inserted.id, {
      externalRef: "",
      gnr: "",
      bnr: null,
      snr: "  ",
      housingAssociationName: "",
    });

    expect(result).toMatchObject({
      externalRef: null,
      gnr: null,
      bnr: null,
      snr: null,
      housingAssociationName: null,
    });
  });

  it("2.3 adressen kan ikke tømmes", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    await expect(edit(admin, org.id, inserted.id, { addressText: "  " })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect((await orderRow(inserted.id)).addressText).toBe(OLD_ADDRESS);
  });

  it("tom mottatt-dato beholder den lagrede (ikke «nå»)", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id, { receivedAt: new Date("2026-11-01T07:00:00Z") });
    const result = await edit(admin, org.id, inserted.id, {
      receivedAt: "",
      addressText: NEW_ADDRESS,
    });
    expect(result.receivedAt.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    const [row] = await updateAuditRows(inserted.id);
    expect((row?.changes as { fields: string[] }).fields).toEqual(["addressText"]);
  });
});

async function createAssignmentFor(organizationId: string) {
  const office = await createOffice(organizationId);
  const [row] = await db
    .insert(assignments)
    .values({
      organizationId,
      number: `TEST-${randomUUID().slice(0, 8)}`,
      assignmentType: "condition_report",
      status: "ordered",
      officeId: office.id,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette oppdrag");
  return row;
}

describe("2.4–2.8 bestilleren", () => {
  it("2.4 kobler kontakt på ordre uten bestiller; firmaet følger kontakten", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const inserted = await insertOrder(org.id);

    const result = await edit(admin, org.id, inserted.id, { orderedByContactId: contact.id });
    expect(result.orderedByContactId).toBe(contact.id);
    expect(result.orderedByFirmId).toBe(firm.id);
  });

  it("2.5 bytte til kontakt i et annet firma: firmaet følger", async () => {
    const { org, admin } = await setup();
    const firmA = await createFirm(org.id, { name: "Testmegling A AS" });
    const firmB = await createFirm(org.id, { name: "Testmegling B AS" });
    const contactA = await createContact(org.id, { firmId: firmA.id });
    const contactB = await createContact(org.id, { firstName: "Ola", firmId: firmB.id });
    const inserted = await insertOrder(org.id, {
      orderedByContactId: contactA.id,
      orderedByFirmId: firmA.id,
    });

    const result = await edit(admin, org.id, inserted.id, { orderedByContactId: contactB.id });
    expect(result.orderedByContactId).toBe(contactB.id);
    expect(result.orderedByFirmId).toBe(firmB.id);
  });

  it("2.6 bytte til kontakt uten firma: firmaet blir tomt", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id);
    const withFirm = await createContact(org.id, { firmId: firm.id });
    const withoutFirm = await createContact(org.id, { firstName: "Per", firmId: null });
    const inserted = await insertOrder(org.id, {
      orderedByContactId: withFirm.id,
      orderedByFirmId: firm.id,
    });

    const result = await edit(admin, org.id, inserted.id, { orderedByContactId: withoutFirm.id });
    expect(result.orderedByContactId).toBe(withoutFirm.id);
    expect(result.orderedByFirmId).toBeNull();
  });

  it("2.7 fjerne kontakten: begge tomme, fritekst står urørt", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const inserted = await insertOrder(org.id, {
      orderedByText: "Kari Testesen",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });

    const result = await edit(admin, org.id, inserted.id, { orderedByContactId: "" });
    expect(result.orderedByContactId).toBeNull();
    expect(result.orderedByFirmId).toBeNull();
    expect(result.orderedByText).toBe("Kari Testesen");
  });

  it("2.8 firma fra skjemaet overstyres ikke; samme oppførsel som createOrder", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id, { name: "Testmegling A AS" });
    const otherFirm = await createFirm(org.id, { name: "Testmegling B AS" });
    const contact = await createContact(org.id, { firmId: firm.id });
    const inserted = await insertOrder(org.id);

    const updated = await edit(admin, org.id, inserted.id, {
      orderedByContactId: contact.id,
      orderedByFirmId: otherFirm.id,
    });
    const created = await createOrder(admin, org.id, {
      addressText: OLD_ADDRESS,
      orderedByContactId: contact.id,
      orderedByFirmId: otherFirm.id,
    } as OrderInput);

    expect(updated.orderedByFirmId).toBe(firm.id);
    expect(created.orderedByFirmId).toBe(updated.orderedByFirmId);
  });

  it("samme kontakt som før, men slettet siden: andre felt kan fortsatt endres", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const inserted = await insertOrder(org.id, {
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
    await db.update(contacts).set({ deletedAt: TEST_NOW }).where(eq(contacts.id, contact.id));

    const result = await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS });
    expect(result.addressText).toBe(NEW_ADDRESS);
    expect(result.orderedByContactId).toBe(contact.id);
    expect(result.orderedByFirmId).toBe(firm.id);
  });
});

describe("2.9–2.11 hva som ikke endres", () => {
  it.each([
    ["status", "rejected"],
    ["rejectedReason", "Skjult grunn"],
    ["assignmentId", randomUUID()],
    ["source", "email"],
    ["requestedReportType", "other_report"],
    ["organizationId", randomUUID()],
    ["deletedAt", new Date("2026-11-01T00:00:00Z")],
  ])("2.9 %s i skjemaet skrives aldri", async (key, value) => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    const before = await orderRow(inserted.id);

    await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS, [key]: value });

    const after = await orderRow(inserted.id);
    expect(after.addressText).toBe(NEW_ADDRESS);
    expect({
      status: after.status,
      rejectedReason: after.rejectedReason,
      assignmentId: after.assignmentId,
      source: after.source,
      requestedReportType: after.requestedReportType,
      organizationId: after.organizationId,
      deletedAt: after.deletedAt,
    }).toEqual({
      status: before.status,
      rejectedReason: before.rejectedReason,
      assignmentId: before.assignmentId,
      source: before.source,
      requestedReportType: before.requestedReportType,
      organizationId: before.organizationId,
      deletedAt: before.deletedAt,
    });
  });

  it("2.10 avvisning øker row_version, og den gamle gir OrderChangedError", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    const opened = await getOrder(admin, org.id, inserted.id);

    await rejectOrder(admin, org.id, inserted.id, "Feil registrering");
    expect((await orderRow(inserted.id)).rowVersion).toBe(opened.rowVersion + 1);

    await expect(
      updateOrder(
        admin,
        org.id,
        inserted.id,
        formFrom(opened, { addressText: NEW_ADDRESS }),
        opened.rowVersion,
      ),
    ).rejects.toBeInstanceOf(OrderChangedError);
    expect((await orderRow(inserted.id)).addressText).toBe(OLD_ADDRESS);
  });

  it("2.10 konvertering øker row_version, og den gamle gir OrderChangedError", async () => {
    const { org, admin } = await setup();
    const office = await createOffice(org.id);
    const inserted = await insertOrder(org.id);
    const opened = await getOrder(admin, org.id, inserted.id);

    await convertOrderToAssignment(admin, org.id, inserted.id, { officeId: office.id });
    expect((await orderRow(inserted.id)).rowVersion).toBe(opened.rowVersion + 1);

    await expect(
      updateOrder(
        admin,
        org.id,
        inserted.id,
        formFrom(opened, { addressText: NEW_ADDRESS }),
        opened.rowVersion,
      ),
    ).rejects.toBeInstanceOf(OrderChangedError);
  });

  it("2.11 oppdraget er uendret etter endring av en gjort-om ordre", async () => {
    const { org, admin } = await setup();
    const office = await createOffice(org.id);
    const inserted = await insertOrder(org.id);
    const { assignment } = await convertOrderToAssignment(admin, org.id, inserted.id, {
      officeId: office.id,
    });
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Megler Test" });
    const [assignmentBefore] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    const partiesBefore = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.assignmentId, assignment.id));

    vi.setSystemTime(new Date(TEST_NOW.getTime() + 60_000));
    const result = await edit(admin, org.id, inserted.id, {
      addressText: NEW_ADDRESS,
      gnr: "99",
    });

    expect(result.assignmentId).toBe(assignment.id);
    expect(result.assignmentNumber).toBe(assignment.number);
    const [assignmentAfter] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    const partiesAfter = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.assignmentId, assignment.id));
    expect(assignmentAfter).toEqual(assignmentBefore);
    expect(partiesAfter).toEqual(partiesBefore);
  });
});

const INVALID_CASES: [string, Record<string, unknown>][] = [
  ["tom adresse", { addressText: "" }],
  ["for lang adresse", { addressText: "a".repeat(301) }],
  ["mottatt frem i tid", { receivedAt: "2026-11-04T10:00:00.000Z" }],
  ["mottatt ugyldig", { receivedAt: "ikke en dato" }],
  ["gnr med bokstaver", { gnr: "12a" }],
  ["bnr med bokstaver", { bnr: "x" }],
  ["snr med bokstaver", { snr: "1-2" }],
  ["for lang ekstern referanse", { externalRef: "r".repeat(201) }],
  ["fødselsnummer i bestilt av", { orderedByText: "Kari 01019912345" }],
  ["for langt borettslag", { housingAssociationName: "b".repeat(201) }],
  ["kontakt som ikke er uuid", { orderedByContactId: "abc" }],
];

describe("2.12–2.13 validering", () => {
  it.each(INVALID_CASES)(
    "2.12 %s gir samme meldinger som «Ny ordre», og ingenting endres",
    async (_name, overrides) => {
      const { org, admin } = await setup();
      const inserted = await insertOrder(org.id);
      const before = await orderRow(inserted.id);
      const opened = await getOrder(admin, org.id, inserted.id);

      const updateError = await captureError(() =>
        updateOrder(admin, org.id, inserted.id, formFrom(opened, overrides), opened.rowVersion),
      );
      const createError = await captureError(() =>
        createOrder(admin, org.id, { addressText: OLD_ADDRESS, ...overrides } as OrderInput),
      );

      expect(updateError).toBeInstanceOf(ZodError);
      expect(createError).toBeInstanceOf(ZodError);
      // 2.13: gjenbruk, ikke kopi
      const messages = (error: unknown) => (error as ZodError).issues.map((issue) => issue.message);
      expect(messages(updateError)).toEqual(messages(createError));
      expect(messages(updateError).length).toBeGreaterThan(0);

      expect(await orderRow(inserted.id)).toEqual(before);
      expect(await updateAuditRows(inserted.id)).toEqual([]);
    },
  );
});

describe("2.14–2.17 samtidighet", () => {
  it("2.14 første endring etter oppretting godtas", async () => {
    const { org, admin } = await setup();
    const created = await createOrder(admin, org.id, { addressText: OLD_ADDRESS });
    const opened = await getOrder(admin, org.id, created.id);
    expect(opened.rowVersion).toBe(created.rowVersion);

    const result = await updateOrder(
      admin,
      org.id,
      created.id,
      formFrom(opened, { addressText: NEW_ADDRESS }),
      opened.rowVersion,
    );
    expect(result.addressText).toBe(NEW_ADDRESS);
  });

  it("2.15 gammel rowVersion etter en annen endring gir OrderChangedError; ingenting endres", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    const opened = await getOrder(admin, org.id, inserted.id);
    await edit(admin, org.id, inserted.id, { externalRef: "TEST-REF-1" });
    const before = await orderRow(inserted.id);
    const auditBefore = await auditCount();
    const eventsBefore = (await updatedEvents()).length;

    const error = await captureError(() =>
      updateOrder(
        admin,
        org.id,
        inserted.id,
        formFrom(opened, { addressText: NEW_ADDRESS }),
        opened.rowVersion,
      ),
    );

    expect(error).toBeInstanceOf(OrderChangedError);
    expect((error as Error).message).toBe("Ordren er endret av en annen. Last siden på nytt.");
    expect(await orderRow(inserted.id)).toEqual(before);
    expect(await auditCount()).toBe(auditBefore);
    expect((await updatedEvents()).length).toBe(eventsBefore);
  });

  it("2.17 to samtidige lagringer med samme rowVersion: nøyaktig én lykkes", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    const opened = await getOrder(admin, org.id, inserted.id);

    const results = await Promise.allSettled([
      updateOrder(
        admin,
        org.id,
        inserted.id,
        formFrom(opened, { addressText: "Testveien 14, 8000 Bodø" }),
        opened.rowVersion,
      ),
      updateOrder(
        admin,
        org.id,
        inserted.id,
        formFrom(opened, { addressText: "Testveien 16, 8000 Bodø" }),
        opened.rowVersion,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderChangedError);
    expect(await updateAuditRows(inserted.id)).toHaveLength(1);
    expect((await orderRow(inserted.id)).rowVersion).toBe(opened.rowVersion + 1);
  });
});

describe("2.18 kontakt som ikke kan kobles", () => {
  it.each(["annen organisasjon", "ukjent uuid", "myk-slettet"] as const)(
    "%s gir ContactNotFoundError, og ingenting endres",
    async (variant) => {
      const { org, admin } = await setup();
      let contactId: string;
      if (variant === "annen organisasjon") {
        const other = await createOrganization("Oppdiktet Takst B");
        contactId = (await createContact(other.id)).id;
      } else if (variant === "ukjent uuid") {
        contactId = randomUUID();
      } else {
        contactId = (await createContact(org.id, { deletedAt: new Date("2026-11-01T00:00:00Z") }))
          .id;
      }
      const inserted = await insertOrder(org.id);
      const before = await orderRow(inserted.id);

      await expect(
        edit(admin, org.id, inserted.id, { orderedByContactId: contactId, addressText: NEW_ADDRESS }),
      ).rejects.toBeInstanceOf(ContactNotFoundError);

      expect(await orderRow(inserted.id)).toEqual(before);
      expect(await auditCount()).toBe(0);
      expect(await updatedEvents()).toEqual([]);
    },
  );
});

describe("2.19 slettet, ukjent eller ugyldig ordre-id", () => {
  it.each(["myk-slettet", "ukjent uuid", "abc", ""] as const)(
    "%s gir AccessDeniedError, ingen databasefeil og ingen loggrad",
    async (variant) => {
      const { org, admin } = await setup();
      let orderId: string = variant;
      if (variant === "myk-slettet") {
        orderId = (await insertOrder(org.id, { deletedAt: new Date("2026-11-01T00:00:00Z") })).id;
      } else if (variant === "ukjent uuid") {
        orderId = randomUUID();
      }

      await expect(
        updateOrder(admin, org.id, orderId, { addressText: NEW_ADDRESS }, 1),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await auditCount()).toBe(0);
    },
  );
});

describe("2.20 lagring uten endring", () => {
  it("samme verdier (dato som Date og som tekst, tom tekst mot null): ingen spor", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id, { externalRef: null, gnr: "7" });
    const before = await orderRow(inserted.id);
    const opened = await getOrder(admin, org.id, inserted.id);

    vi.setSystemTime(new Date(TEST_NOW.getTime() + 60_000));
    const asDate = await updateOrder(
      admin,
      org.id,
      inserted.id,
      formFrom(opened, { externalRef: "", housingAssociationName: "  " }),
      opened.rowVersion,
    );
    const asText = await updateOrder(
      admin,
      org.id,
      inserted.id,
      formFrom(opened, { receivedAt: TEST_NOW.toISOString(), gnr: " 7 " }),
      opened.rowVersion,
    );

    expect(asDate.rowVersion).toBe(before.rowVersion);
    expect(asText.rowVersion).toBe(before.rowVersion);
    expect(await orderRow(inserted.id)).toEqual(before);
    expect(await auditCount()).toBe(0);
    expect(await updatedEvents()).toEqual([]);
  });
});

describe("2.21–2.24 revisjonsloggen", () => {
  it("2.21 én rad per lagring med hvem og når", async () => {
    const { org, admin, employee } = await setup();
    const inserted = await insertOrder(org.id);

    await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS });
    await edit(admin, org.id, inserted.id, { gnr: "5" });

    const rows = await updateAuditRows(inserted.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.entityType).toBe("order");
      expect(row.action).toBe("update");
      expect(row.entityId).toBe(inserted.id);
      expect(row.actorEmployeeId).toBe(employee.id);
      expect(row.occurredAt.getTime()).toBe(TEST_NOW.getTime());
    }
  });

  it("2.22–2.24 fields i fast rekkefølge, values med from/to, ingen andre nøkler", async () => {
    const { org, admin } = await setup();
    const firm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const contact = await createContact(org.id, {
      firstName: "Kari",
      lastName: "Testesen",
      firmId: firm.id,
    });
    const inserted = await insertOrder(org.id, { externalRef: "TEST-REF-1" });
    const opened = await getOrder(admin, org.id, inserted.id);

    // Annen rekkefølge i input enn i feltlisten
    await updateOrder(
      admin,
      org.id,
      inserted.id,
      {
        sellerDeclarationReceived: true,
        addressText: NEW_ADDRESS,
        orderedByContactId: contact.id,
        externalRef: "",
        receivedAt: "2026-11-02T08:00:00.000Z",
        orderedByText: opened.orderedByText,
      },
      opened.rowVersion,
    );

    const [row] = await updateAuditRows(inserted.id);
    const changes = row?.changes as Record<string, unknown>;
    expect(Object.keys(changes).sort()).toEqual(["fields", "values"]);
    expect(changes.fields).toEqual([
      "receivedAt",
      "externalRef",
      "orderedByContactId",
      "orderedByFirmId",
      "addressText",
      "sellerDeclarationReceived",
    ]);
    expect(changes.values).toEqual({
      receivedAt: { from: TEST_NOW.toISOString(), to: "2026-11-02T08:00:00.000Z" },
      externalRef: { from: "TEST-REF-1", to: null },
      orderedByContactId: { from: null, to: contact.id },
      orderedByFirmId: { from: null, to: firm.id },
      addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
      sellerDeclarationReceived: { from: false, to: true },
    });
    // jsonb tar ikke vare på rekkefølgen på nøklene; `fields` er listen med fast rekkefølge
    expect(Object.keys(changes.values as object).sort()).toEqual(
      [...(changes.fields as string[])].sort(),
    );
    // Bestilleren som id, aldri navn
    expect(JSON.stringify(changes)).not.toContain("Kari");
    expect(JSON.stringify(changes)).not.toContain("Testmegling");
  });
});

describe("2.26 hendelsen order.updated", () => {
  it("én hendelse per lagring med nøyaktig { orderId, fields }", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);

    await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS, gnr: "5" });

    const rows = await updatedEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(org.id);
    expect(rows[0]?.data).toEqual({ orderId: inserted.id, fields: ["addressText", "gnr"] });
  });
});

describe("2.28 ingen KI", () => {
  it("endring gir ingen rad i ai_usage_log, og KI-leverandøren er ikke kalt", async () => {
    const { org, admin } = await setup();
    const inserted = await insertOrder(org.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    await edit(admin, org.id, inserted.id, { addressText: NEW_ADDRESS });

    expect(spy).not.toHaveBeenCalled();
    const [row] = await db.select({ n: count() }).from(aiUsageLog);
    expect(row?.n ?? 0).toBe(0);
  });
});

describe("7. tenant-isolasjon for updateOrder", () => {
  it("7.1 expectTenantIsolation: endrer bare egne ordre", async () => {
    const orgOf = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        orgOf.set(a.id, grantA.organizationId);
        orgOf.set(b.id, grantB.organizationId);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const rows: Order[] = [];
        for (const [orderId, owner] of orgOf) {
          const rowVersion = (await orderRow(orderId)).rowVersion;
          const input = { addressText: OLD_ADDRESS, externalRef: `TEST-${rowVersion}` };
          if (owner === organizationId) {
            rows.push(await updateOrder(actor, organizationId, orderId, input, rowVersion));
          } else {
            try {
              rows.push(await updateOrder(actor, organizationId, orderId, input, rowVersion));
            } catch (error) {
              if (!(error instanceof AccessDeniedError)) throw error;
            }
          }
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });

  async function twoOrganizations() {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    const userA = await createUser({ name: "Test Ansatt A" });
    const userB = await createUser({ name: "Test Ansatt B" });
    await createEmployee(userA, orgA.id, ["admin"]);
    await createEmployee(userB, orgB.id, ["admin"]);
    const orderB = await insertOrder(orgB.id);
    await edit(userB, orgB.id, orderB.id, { externalRef: "TEST-B-1" });
    return { orgA, orgB, userA, orderB };
  }

  it("7.3 ansatt i A med A sin organisasjons-id og B sin ordre-id får AccessDeniedError", async () => {
    const { orgA, orgB, userA, orderB } = await twoOrganizations();
    const before = await orderRow(orderB.id);
    const auditBefore = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgB.id));

    await expect(
      updateOrder(userA, orgA.id, orderB.id, { addressText: NEW_ADDRESS }, before.rowVersion),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    expect(await orderRow(orderB.id)).toEqual(before);
    expect(await db.select().from(auditLog).where(eq(auditLog.organizationId, orgB.id))).toEqual(
      auditBefore,
    );
  });

  it("7.4 organisasjons-id fra B med ansatt i A gir AccessDeniedError", async () => {
    const { orgB, userA, orderB } = await twoOrganizations();
    const before = await orderRow(orderB.id);

    await expect(
      updateOrder(userA, orgB.id, orderB.id, { addressText: NEW_ADDRESS }, before.rowVersion),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await orderRow(orderB.id)).toEqual(before);
  });

  it("7.5 kontakt fra B på ordre i A gir ContactNotFoundError", async () => {
    const { orgA, orgB, userA } = await twoOrganizations();
    const contactB = await createContact(orgB.id);
    const orderA = await insertOrder(orgA.id);

    await expect(
      edit(userA, orgA.id, orderA.id, { orderedByContactId: contactB.id }),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
    expect((await orderRow(orderA.id)).orderedByContactId).toBeNull();
  });
});
