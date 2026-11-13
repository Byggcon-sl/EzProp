import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { db } from "@/db/client";
import { aiUsageLog, assignmentParties, assignments, auditLog, events } from "@/db/schema";
import { fakeAiProvider } from "../../../tests/ai";
import {
  createAssignmentParty,
  createContact,
  createFirm,
  createOffice,
  createOrder as insertOrder,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import {
  CHANGED_MESSAGE,
  editInput,
  eventsOfType,
  insertConvertedOrder,
  NEW_ADDRESS,
  OLD_ADDRESS,
  orderAuditRows,
  orderRow,
  orgWithAdmin,
  tableCount,
  updateAuditRows,
} from "../../../tests/order-edit";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  convertOrderToAssignment,
  createOrder,
  getOrder,
  OrderChangedError,
  orderInputSchema,
  rejectOrder,
  updateOrder,
} from "./index";

/*
 * Endre en ordre etter at den er lagret (T1): tjenesten `updateOrder` mot testdatabasen.
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 2 og 7.1, 7.3–7.6, 8.1.
 * 2.25 (feil i loggen ruller tilbake) står i orders-transaction.test.ts. Tilgang per rolle står i
 * update-order-access.test.ts, verdier på avveie i update-order-no-leak.test.ts.
 *
 * Fast tid: TEST_NOW (03.11.2026 kl. 11 i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (en skrivefeil rettes på stedet i alle statuser), KI i bunnen
 * (én loggrad per lagring med feltkodene i fast rekkefølge, ingen KI-kall) og færre
 * reklamasjoner (hvem endret hva, oppdraget endres ikke stille, ingen annen organisasjon slipper til).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type UpdateInput = Parameters<typeof updateOrder>[3];

/** Kaller tjenesten med `rowVersion` fra `getOrder`, slik skjemaet gjør når det åpnes. */
async function save(
  actor: Actor,
  organizationId: string,
  orderId: string,
  overrides: Record<string, unknown> = {},
) {
  const { rowVersion } = await getOrder(actor, organizationId, orderId);
  const row = await orderRow(orderId);
  return updateOrder(
    actor,
    organizationId,
    orderId,
    editInput(row, overrides) as UpdateInput,
    rowVersion,
  );
}

function update(
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: Record<string, unknown>,
  rowVersion: number,
) {
  return updateOrder(actor, organizationId, orderId, input as UpdateInput, rowVersion);
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Ingenting skjedde med ordren: samme rad, ingen loggrad, ingen hendelse. */
async function expectUntouched(orderId: string, before: Awaited<ReturnType<typeof orderRow>>) {
  expect(await orderRow(orderId)).toEqual(before);
  expect(await updateAuditRows(orderId)).toEqual([]);
  expect(await eventsOfType("order.updated")).toEqual([]);
}

const DELETED_AT = new Date("2026-11-01T08:00:00Z");

// ---------------------------------------------------------------------------------------------
// Vellykket endring (AK 1)
// ---------------------------------------------------------------------------------------------

const statusCases = [
  ["received", async (orgId: string) => insertOrder(orgId)],
  ["converted", async (orgId: string) => (await insertConvertedOrder(orgId)).order],
  [
    "rejected",
    async (orgId: string) =>
      insertOrder(orgId, { status: "rejected", rejectedReason: "Feil registrering" }),
  ],
] as const;

describe("2. updateOrder: vellykket endring", () => {
  it.each(statusCases)(
    "2.1 %s: ny adresse i returen og i getOrder, row_version +1, updated_at satt",
    async (status, make) => {
      const { org, admin } = await orgWithAdmin();
      const order = await make(org.id);
      const before = await orderRow(order.id);
      expect(before.status).toBe(status);

      const result = await save(admin, org.id, order.id, { addressText: NEW_ADDRESS });

      expect(result).toMatchObject({ id: order.id, addressText: NEW_ADDRESS });
      expect((await getOrder(admin, org.id, order.id)).addressText).toBe(NEW_ADDRESS);
      const after = await orderRow(order.id);
      expect(after.rowVersion).toBe(before.rowVersion + 1);
      expect(after.updatedAt.getTime()).toBe(TEST_NOW.getTime());
      expect(after.status).toBe(status);
    },
  );

  it("2.2 alle feltene i listen kan endres i én lagring, og alle står i returen", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const contact = await createContact(org.id, {
      firstName: "Kari",
      lastName: "Testesen",
      firmId: firm.id,
    });
    const order = await insertOrder(org.id, {
      externalRef: "TEST-ORD-0001",
      orderedByText: "Megler Testesen",
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: "Testtoppen borettslag",
      sellerDeclarationReceived: false,
    });

    const changed = {
      receivedAt: "2026-11-02T08:00:00.000Z",
      externalRef: "TEST-ORD-0002",
      orderedByText: "Megler Testesen, Testmegleren AS",
      orderedByContactId: contact.id,
      addressText: NEW_ADDRESS,
      gnr: "13",
      bnr: "35",
      snr: "6",
      housingAssociationName: "Testdalen sameie",
      sellerDeclarationReceived: true,
    };
    const result = await save(admin, org.id, order.id, changed);

    expect(result).toMatchObject({
      ...changed,
      receivedAt: new Date(changed.receivedAt),
      orderedByFirmId: firm.id,
    });
    const after = await orderRow(order.id);
    expect(after).toMatchObject({
      ...changed,
      receivedAt: new Date(changed.receivedAt),
      orderedByFirmId: firm.id,
    });
  });

  it("2.3 valgfrie felt kan tømmes; adressen kan ikke", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, {
      externalRef: "TEST-ORD-0001",
      gnr: "12",
      bnr: "34",
      snr: "5",
      housingAssociationName: "Testtoppen borettslag",
    });

    await save(admin, org.id, order.id, {
      externalRef: "",
      gnr: "",
      bnr: "",
      snr: "",
      housingAssociationName: "",
    });
    expect(await orderRow(order.id)).toMatchObject({
      externalRef: null,
      gnr: null,
      bnr: null,
      snr: null,
      housingAssociationName: null,
    });

    const before = await orderRow(order.id);
    const error = await caught(save(admin, org.id, order.id, { addressText: "   " }));
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues.map((issue) => issue.message)).toContain(
      "Skriv inn adressen.",
    );
    await expect(orderRow(order.id)).resolves.toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Bestilleren (AK 2 og 3)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: bestilleren", () => {
  it("2.4 koble kontakt på ordre uten bestiller: firmaet følger kontakten", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id);

    await save(admin, org.id, order.id, { orderedByContactId: contact.id });
    expect(await orderRow(order.id)).toMatchObject({
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
  });

  it("2.5 bytte til kontakt i et annet firma: firmaet følger", async () => {
    const { org, admin } = await orgWithAdmin();
    const firmA = await createFirm(org.id, { name: "Testmegling A AS" });
    const firmB = await createFirm(org.id, { name: "Testmegling B AS" });
    const first = await createContact(org.id, { firmId: firmA.id });
    const second = await createContact(org.id, { lastName: "Testesen", firmId: firmB.id });
    const order = await insertOrder(org.id, {
      orderedByContactId: first.id,
      orderedByFirmId: firmA.id,
    });

    await save(admin, org.id, order.id, { orderedByContactId: second.id });
    expect(await orderRow(order.id)).toMatchObject({
      orderedByContactId: second.id,
      orderedByFirmId: firmB.id,
    });
  });

  it("2.6 bytte til kontakt uten firma: firmaet blir tomt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const first = await createContact(org.id, { firmId: firm.id });
    const second = await createContact(org.id, { lastName: "Uten Firma" });
    const order = await insertOrder(org.id, {
      orderedByContactId: first.id,
      orderedByFirmId: firm.id,
    });

    await save(admin, org.id, order.id, { orderedByContactId: second.id });
    expect(await orderRow(order.id)).toMatchObject({
      orderedByContactId: second.id,
      orderedByFirmId: null,
    });
  });

  it("2.7 fjerne kontakten: begge tomme, friteksten står urørt", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const order = await insertOrder(org.id, {
      orderedByText: "Megler Testesen",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });

    await save(admin, org.id, order.id, { orderedByContactId: "" });
    expect(await orderRow(order.id)).toMatchObject({
      orderedByContactId: null,
      orderedByFirmId: null,
      orderedByText: "Megler Testesen",
    });
  });

  // Alvorlig funn hvis denne mangler (testplanen, krav for godkjenning)
  it.each([
    ["a: firma i en annen organisasjon", "foreign"],
    ["b: et annet firma i egen organisasjon", "own-other"],
    ["c: firma-id uten kontakt", "no-contact"],
  ] as const)(
    "2.8 firma-id fra skjemaet ignoreres (%s): ingen feil, ingen loggrad, row_version lik",
    async (_name, variant) => {
      const { org, admin } = await orgWithAdmin("Organisasjon A");
      const { org: orgB } = await orgWithAdmin("Organisasjon B");
      const ownFirm = await createFirm(org.id, { name: "Testmegling A AS" });
      const otherOwnFirm = await createFirm(org.id, { name: "Testmegling A2 AS" });
      const foreignFirm = await createFirm(orgB.id, { name: "Testmegling B AS" });
      const contact = await createContact(org.id, { firmId: ownFirm.id });

      const order =
        variant === "no-contact"
          ? await insertOrder(org.id)
          : await insertOrder(org.id, {
              orderedByContactId: contact.id,
              orderedByFirmId: ownFirm.id,
            });
      const sentFirm = variant === "own-other" ? otherOwnFirm.id : foreignFirm.id;
      const before = await orderRow(order.id);

      await save(admin, org.id, order.id, { orderedByFirmId: sentFirm });

      const after = await orderRow(order.id);
      expect(after.orderedByFirmId).toBe(variant === "no-contact" ? null : ownFirm.id);
      expect(after.orderedByFirmId).not.toBe(sentFirm);
      expect(after.rowVersion).toBe(before.rowVersion);
      expect(await updateAuditRows(order.id)).toEqual([]);
    },
  );

  it("2.8 a/7.6 firma fra B sendt sammen med ny kontakt: firmaet er kontaktens, aldri B sitt", async () => {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const ownFirm = await createFirm(org.id);
    const foreignFirm = await createFirm(orgB.id);
    const contact = await createContact(org.id, { firmId: ownFirm.id });
    const order = await insertOrder(org.id);

    await save(admin, org.id, order.id, {
      orderedByContactId: contact.id,
      orderedByFirmId: foreignFirm.id,
    });
    const after = await orderRow(order.id);
    expect(after.orderedByFirmId).toBe(ownFirm.id);
    expect(JSON.stringify(await orderAuditRows(order.id))).not.toContain(foreignFirm.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Hva som ikke endres (AK 5)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: felt som ikke endres", () => {
  it.each([
    ["status", { status: "rejected" }],
    ["rejectReason", { rejectReason: "Oppdiktet grunn" }],
    ["rejectedReason", { rejectedReason: "Oppdiktet grunn" }],
    ["assignmentId", { assignmentId: "0190a000-0000-7000-8000-0000000000aa" }],
    ["source", { source: "email" }],
    ["requestedReportType", { requestedReportType: "value_assessment" }],
    ["organizationId", { organizationId: "0190a000-0000-7000-8000-0000000000bb" }],
    ["deletedAt", { deletedAt: "2026-11-01T08:00:00.000Z" }],
  ])("2.9 %s fra input skrives aldri", async (_name, extra) => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const before = await orderRow(order.id);

    await caught(save(admin, org.id, order.id, { addressText: NEW_ADDRESS, ...extra }));

    const after = await orderRow(order.id);
    expect(after).toMatchObject({
      status: before.status,
      rejectedReason: before.rejectedReason,
      assignmentId: before.assignmentId,
      source: before.source,
      requestedReportType: before.requestedReportType,
      organizationId: org.id,
      deletedAt: null,
    });
  });

  it("2.10 rejectOrder øker row_version; den gamle verdien gir OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);

    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    expect((await getOrder(admin, org.id, order.id)).rowVersion).toBe(rowVersion + 1);

    const row = await orderRow(order.id);
    await expect(
      update(admin, org.id, order.id, editInput(row, { addressText: NEW_ADDRESS }), rowVersion),
    ).rejects.toThrow(OrderChangedError);
  });

  it("2.10 convertOrderToAssignment øker row_version; den gamle verdien gir OrderChangedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const office = await createOffice(org.id);
    const order = await insertOrder(org.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);

    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id, now: TEST_NOW });
    expect((await getOrder(admin, org.id, order.id)).rowVersion).toBe(rowVersion + 1);

    const row = await orderRow(order.id);
    await expect(
      update(admin, org.id, order.id, editInput(row, { addressText: NEW_ADDRESS }), rowVersion),
    ).rejects.toThrow(OrderChangedError);
  });

  it("2.11 oppdraget og partene er uendret etter endring av gjort-om ordre", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id);
    const contact = await createContact(org.id, { firmId: firm.id });
    const { order, assignment } = await insertConvertedOrder(org.id);
    await createAssignmentParty(org.id, { assignmentId: assignment.id, name: "Megler Testesen" });

    const assignmentBefore = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    const partiesBefore = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.assignmentId, assignment.id));

    await save(admin, org.id, order.id, {
      addressText: NEW_ADDRESS,
      orderedByContactId: contact.id,
      gnr: "99",
    });

    expect(await db.select().from(assignments).where(eq(assignments.id, assignment.id))).toEqual(
      assignmentBefore,
    );
    expect(
      await db
        .select()
        .from(assignmentParties)
        .where(eq(assignmentParties.assignmentId, assignment.id)),
    ).toEqual(partiesBefore);
    const after = await orderRow(order.id);
    expect(after).toMatchObject({ status: "converted", assignmentId: assignment.id });
    expect((await getOrder(admin, org.id, order.id)).assignmentNumber).toBe(assignment.number);
  });
});

// ---------------------------------------------------------------------------------------------
// Validering (AK 6, regeltest)
// ---------------------------------------------------------------------------------------------

const validationCases = [
  ["tom adresse", { addressText: "" }, "addressText", "Skriv inn adressen."],
  [
    "adresse over 300 tegn",
    { addressText: "a".repeat(301) },
    "addressText",
    "Adressen kan ha høyst 300 tegn.",
  ],
  [
    "mottatt frem i tid",
    { receivedAt: "2026-11-04T10:00:00.000Z" },
    "receivedAt",
    "Mottatt kan ikke være frem i tid.",
  ],
  [
    "mottatt som ikke er en dato",
    { receivedAt: "i går" },
    "receivedAt",
    "Mottatt må være en dato og et klokkeslett.",
  ],
  ["gnr med bokstav", { gnr: "12a" }, "gnr", "Gårdsnummer kan bare ha sifre."],
  ["bnr med mellomrom", { bnr: "1 2" }, "bnr", "Bruksnummer kan bare ha sifre."],
  ["snr negativt", { snr: "-1" }, "snr", "Seksjonsnummer kan bare ha sifre."],
  [
    "ekstern referanse for lang",
    { externalRef: "b".repeat(201) },
    "externalRef",
    "Teksten kan ha høyst 200 tegn.",
  ],
  [
    "borettslag for langt",
    { housingAssociationName: "b".repeat(201) },
    "housingAssociationName",
    "Teksten kan ha høyst 200 tegn.",
  ],
  [
    "fødselsnummer i bestilleren",
    { orderedByText: "Megler 01019912345" },
    "orderedByText",
    "Fødselsnummer skal ikke lagres her.",
  ],
  [
    "kontakt-id som ikke er uuid",
    { orderedByContactId: "abc" },
    "orderedByContactId",
    "Kontakten finnes ikke.",
  ],
] as const;

function issueMessages(error: unknown, field: string): string[] {
  expect(error).toBeInstanceOf(ZodError);
  return (error as ZodError).issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

describe("2. updateOrder: validering som «Ny ordre»", () => {
  it.each(validationCases)(
    "2.12 %s gir samme melding som orderInputSchema; ingen endring, ingen loggrad",
    async (_name, overrides, field, message) => {
      const { org, admin } = await orgWithAdmin();
      const order = await insertOrder(org.id, { addressText: OLD_ADDRESS });
      const before = await orderRow(order.id);

      // Fasiten fra schemaet for «Ny ordre» stemmer med tabellen
      const fromSchema = orderInputSchema(TEST_NOW).safeParse(editInput(before, overrides));
      expect(fromSchema.success).toBe(false);
      expect(issueMessages(fromSchema.error, field)).toContain(message);

      const error = await caught(save(admin, org.id, order.id, overrides));
      expect(issueMessages(error, field)).toContain(message);
      await expectUntouched(order.id, before);
    },
  );

  it.each(validationCases)(
    "2.13 %s: updateOrder og createOrder gir samme meldinger",
    async (_name, overrides) => {
      const { org, admin } = await orgWithAdmin();
      const order = await insertOrder(org.id, { addressText: OLD_ADDRESS });
      const input = editInput(await orderRow(order.id), overrides);

      const fromCreate = await caught(createOrder(admin, org.id, input as never, TEST_NOW));
      const fromUpdate = await caught(save(admin, org.id, order.id, overrides));
      expect(fromCreate).toBeInstanceOf(ZodError);
      expect(fromUpdate).toBeInstanceOf(ZodError);
      const messages = (error: unknown) =>
        (error as ZodError).issues
          .map((issue) => `${String(issue.path[0])}: ${issue.message}`)
          .sort();
      expect(messages(fromUpdate)).toEqual(messages(fromCreate));
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Samtidighet (AK 7, A253)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: samtidighet med row_version", () => {
  it("2.14 første endring etter oppretting med rowVersion fra getOrder godtas", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(admin, org.id, { addressText: OLD_ADDRESS }, TEST_NOW);
    const { rowVersion } = await getOrder(admin, org.id, created.id);
    expect(typeof rowVersion).toBe("number");

    const row = await orderRow(created.id);
    const result = await update(
      admin,
      org.id,
      created.id,
      editInput(row, { addressText: NEW_ADDRESS }),
      rowVersion,
    );
    expect(result.addressText).toBe(NEW_ADDRESS);
  });

  it("2.15 gammel rowVersion etter en annen endring gir OrderChangedError med fast tekst; ingenting endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);
    await save(admin, org.id, order.id, { externalRef: "TEST-ORD-0009" });

    const before = await orderRow(order.id);
    const auditBefore = await orderAuditRows(order.id);
    const eventsBefore = await db.select().from(events);

    const error = await caught(
      update(admin, org.id, order.id, editInput(before, { addressText: NEW_ADDRESS }), rowVersion),
    );
    expect(error).toBeInstanceOf(OrderChangedError);
    expect((error as Error).message).toBe(CHANGED_MESSAGE);
    expect(await orderRow(order.id)).toEqual(before);
    expect(await orderAuditRows(order.id)).toEqual(auditBefore);
    expect(await db.select().from(events)).toEqual(eventsBefore);
  });

  it("2.16 gammel rowVersion etter avvisning gir OrderChangedError (også dekket i 2.10)", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);
    await rejectOrder(admin, org.id, order.id, "Feil registrering");
    const row = await orderRow(order.id);
    await expect(
      update(admin, org.id, order.id, editInput(row, { gnr: "77" }), rowVersion),
    ).rejects.toBeInstanceOf(OrderChangedError);
    expect((await orderRow(order.id)).gnr).toBeNull();
  });

  it("2.17 to samtidige lagringer med samme rowVersion: nøyaktig én lykkes, én loggrad, row_version +1", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);
    const row = await orderRow(order.id);

    const results = await Promise.allSettled([
      update(
        admin,
        org.id,
        order.id,
        editInput(row, { addressText: "Testveien 14, 8000 Bodø" }),
        rowVersion,
      ),
      update(
        admin,
        org.id,
        order.id,
        editInput(row, { addressText: "Testveien 16, 8000 Bodø" }),
        rowVersion,
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderChangedError);
    expect(await updateAuditRows(order.id)).toHaveLength(1);
    expect((await orderRow(order.id)).rowVersion).toBe(row.rowVersion + 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Kontakt (AK 8) og fremmed, ukjent og slettet ordre (AK 9)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: kontakt som ikke kan kobles", () => {
  it.each([
    ["kontakt i en annen organisasjon", "foreign"],
    ["ukjent uuid", "unknown"],
    ["myk-slettet kontakt", "deleted"],
  ] as const)(
    "2.18/7.5 %s gir ContactNotFoundError; ingen endring, logg eller hendelse",
    async (_name, variant) => {
      const { org, admin } = await orgWithAdmin("Organisasjon A");
      const { org: orgB } = await orgWithAdmin("Organisasjon B");
      const contactId =
        variant === "foreign"
          ? (await createContact(orgB.id, { lastName: "Fremmed" })).id
          : variant === "deleted"
            ? (await createContact(org.id, { deletedAt: DELETED_AT })).id
            : randomUUID();
      const order = await insertOrder(org.id);
      const before = await orderRow(order.id);

      const error = await caught(
        save(admin, org.id, order.id, { addressText: NEW_ADDRESS, orderedByContactId: contactId }),
      );
      expect(error).toBeInstanceOf(ContactNotFoundError);
      await expectUntouched(order.id, before);
    },
  );
});

describe("2. updateOrder: fremmed, ukjent og slettet ordre", () => {
  it.each([
    ["myk-slettet ordre", "deleted"],
    ["ukjent uuid", "unknown"],
    ["ikke-uuid «abc»", "abc"],
    ["tom id", ""],
  ] as const)(
    "2.19/8.1 %s gir AccessDeniedError, ikke databasefeil; ingen loggrad",
    async (_name, variant) => {
      const { org, admin } = await orgWithAdmin();
      const deleted = await insertOrder(org.id, { deletedAt: DELETED_AT });
      const orderId =
        variant === "deleted" ? deleted.id : variant === "unknown" ? randomUUID() : variant;
      const before = await orderRow(deleted.id);

      const error = await caught(
        update(
          admin,
          org.id,
          orderId,
          editInput(before, { addressText: NEW_ADDRESS }),
          before.rowVersion,
        ),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await orderRow(deleted.id)).toEqual(before);
      expect(await tableCount(auditLog)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Lagring uten endring (AK 4 og 10)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: lagring uten endring", () => {
  it("2.20 samme verdier (dato som Date, tom tekst mot null): ingen loggrad, ingen hendelse, row_version og updated_at lik", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { externalRef: null, housingAssociationName: null });
    const before = await orderRow(order.id);

    await save(admin, org.id, order.id, {
      receivedAt: new Date(before.receivedAt.getTime()),
      externalRef: "",
      housingAssociationName: "   ",
      gnr: "",
    });
    await expectUntouched(order.id, before);
  });

  // Alvorlig funn hvis denne mangler (testplanen, krav for godkjenning)
  it("2.20b tom receivedAt beholder verdien: ingen loggrad; med annen endring er fields bare addressText", async () => {
    const { org, admin } = await orgWithAdmin();
    const earlier = new Date("2026-11-01T08:00:00Z");
    const order = await insertOrder(org.id, { receivedAt: earlier });
    const before = await orderRow(order.id);

    await save(admin, org.id, order.id, { receivedAt: "" });
    await expectUntouched(order.id, before);
    expect((await orderRow(order.id)).receivedAt.getTime()).toBe(earlier.getTime());

    await save(admin, org.id, order.id, { receivedAt: "", addressText: NEW_ADDRESS });
    const after = await orderRow(order.id);
    expect(after.receivedAt.getTime()).toBe(earlier.getTime());
    const [audit] = await updateAuditRows(order.id);
    expect((audit?.changes as { fields?: unknown }).fields).toEqual(["addressText"]);
  });

  it("2.20c createOrder med tom receivedAt gir fortsatt nå (TEST_NOW)", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createOrder(
      admin,
      org.id,
      { addressText: OLD_ADDRESS, receivedAt: "" },
      TEST_NOW,
    );
    expect((await orderRow(created.id)).receivedAt.getTime()).toBe(TEST_NOW.getTime());
  });
});

// ---------------------------------------------------------------------------------------------
// Revisjonsloggen (AK 11, A252) og hendelsen (AK 12 og 13)
// ---------------------------------------------------------------------------------------------

describe("2. updateOrder: revisjonsloggen og hendelsen", () => {
  it("2.21 én rad per lagring med order/update, entity_id, den ansatte og occurred_at", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    await save(admin, org.id, order.id, { addressText: NEW_ADDRESS });
    await save(admin, org.id, order.id, { gnr: "12" });

    const rows = await updateAuditRows(order.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        organizationId: org.id,
        entityType: "order",
        entityId: order.id,
        action: "update",
        actorEmployeeId: adminEmployee.id,
      });
      // Tidspunktet settes av databasen, som for opprettet og avvist ordre, slik at
      // «Endringer» står i riktig rekkefølge. Derfor ikke TEST_NOW her (falsk klokke gjelder bare Date).
      expect(row.occurredAt).toBeInstanceOf(Date);
    }
  });

  it("2.22 fields har bare de endrede feltkodene i fast rekkefølge, også når input kommer i annen rekkefølge", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id, { sellerDeclarationReceived: false });
    const row = await orderRow(order.id);
    const { rowVersion } = await getOrder(admin, org.id, order.id);

    // Nøklene i omvendt rekkefølge
    const input = Object.fromEntries(
      Object.entries(
        editInput(row, {
          sellerDeclarationReceived: true,
          gnr: "12",
          addressText: NEW_ADDRESS,
          externalRef: "TEST-ORD-0003",
        }),
      ).reverse(),
    );
    await update(admin, org.id, order.id, input, rowVersion);

    const [audit] = await updateAuditRows(order.id);
    expect((audit?.changes as { fields?: unknown }).fields).toEqual([
      "externalRef",
      "addressText",
      "gnr",
      "sellerDeclarationReceived",
    ]);
  });

  it("2.23 values har samme nøkler som fields med {from, to}; tom er null, dato som ISO, bestilleren som id uten navn", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await createFirm(org.id, { name: "Testmegling Nord AS" });
    const contact = await createContact(org.id, {
      firstName: "Kari",
      lastName: "Testesen",
      firmId: firm.id,
    });
    const order = await insertOrder(org.id, { externalRef: "TEST-ORD-0001" });

    await save(admin, org.id, order.id, {
      receivedAt: "2026-11-02T08:00:00.000Z",
      externalRef: "",
      orderedByContactId: contact.id,
      addressText: NEW_ADDRESS,
    });

    const [audit] = await updateAuditRows(order.id);
    const changes = audit?.changes as { fields: string[]; values: Record<string, unknown> };
    expect(changes.fields).toEqual([
      "receivedAt",
      "externalRef",
      "orderedByContactId",
      "orderedByFirmId",
      "addressText",
    ]);
    expect(Object.keys(changes.values).sort()).toEqual([...changes.fields].sort());
    expect(changes.values).toEqual({
      receivedAt: { from: TEST_NOW.toISOString(), to: "2026-11-02T08:00:00.000Z" },
      externalRef: { from: "TEST-ORD-0001", to: null },
      orderedByContactId: { from: null, to: contact.id },
      orderedByFirmId: { from: null, to: firm.id },
      addressText: { from: OLD_ADDRESS, to: NEW_ADDRESS },
    });
    const text = JSON.stringify(changes);
    expect(text).not.toContain("Kari");
    expect(text).not.toContain("Testesen");
    expect(text).not.toContain("Testmegling");
  });

  it("2.24 ingen andre nøkler i changes enn fields og values; ingen kode utenfor feltlisten", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await save(admin, org.id, order.id, {
      addressText: NEW_ADDRESS,
      bnr: "34",
      status: "rejected",
      secretField: "MARKOR",
    });

    const [audit] = await updateAuditRows(order.id);
    const changes = audit?.changes as { fields: string[]; values: Record<string, unknown> };
    expect(Object.keys(changes).sort()).toEqual(["fields", "values"]);
    const allowed: readonly string[] = [
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
    ];
    for (const field of changes.fields) expect(allowed).toContain(field);
    for (const field of Object.keys(changes.values)) expect(allowed).toContain(field);
    expect(JSON.stringify(changes)).not.toContain("MARKOR");
  });

  it("2.26 order.updated én gang per lagring, data nøyaktig { orderId, fields }", async () => {
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await save(admin, org.id, order.id, { addressText: NEW_ADDRESS, gnr: "12" });

    const rows = await eventsOfType("order.updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(org.id);
    expect(rows[0]?.data).toEqual({ orderId: order.id, fields: ["addressText", "gnr"] });
  });

  it("2.28 endring kaller ikke KI og gir ingen rad i ai_usage_log", async () => {
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await save(admin, org.id, order.id, {
      addressText: NEW_ADDRESS,
      orderedByText: "Megler Testesen",
    });

    expect(spy).not.toHaveBeenCalled();
    const [row] = await db.select({ n: count() }).from(aiUsageLog);
    expect(row?.n ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Tenant-isolasjon (AK 18)
// ---------------------------------------------------------------------------------------------

describe("7. updateOrder: tenant-isolasjon", () => {
  it("7.1 updateOrder endrer bare egen ordre (expectTenantIsolation)", async () => {
    const orderFor = new Map<string, string>();
    let call = 0;
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertOrder(grantA.organizationId);
        const b = await insertOrder(grantB.organizationId);
        orderFor.set(grantA.organizationId, a.id);
        orderFor.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        call += 1;
        const orderId = orderFor.get(organizationId) ?? randomUUID();
        const { rowVersion } = await getOrder(actor, organizationId, orderId);
        const row = await orderRow(orderId);
        return [
          await update(
            actor,
            organizationId,
            orderId,
            editInput(row, { externalRef: `TEST-ORD-${call}` }),
            rowVersion,
          ),
        ];
      },
      idOf: (row) => row.id,
    });
  });

  it("7.3 ansatt i A med A sin organisasjons-id og B sin ordre-id: AccessDeniedError; B er urørt", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const orderB = await insertOrder(orgB.id);
    const before = await orderRow(orderB.id);

    const error = await caught(
      update(
        adminA,
        orgA.id,
        orderB.id,
        editInput(before, { addressText: NEW_ADDRESS }),
        before.rowVersion,
      ),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await orderRow(orderB.id)).toEqual(before);
    expect(await orderAuditRows(orderB.id)).toEqual([]);
    expect(await tableCount(auditLog)).toBe(0);
  });

  it("7.4 organisasjons-id fra B med ansatt i A: AccessDeniedError fra tilgangssjekken", async () => {
    const { admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const orderB = await insertOrder(orgB.id);
    const before = await orderRow(orderB.id);

    await expect(
      update(
        adminA,
        orgB.id,
        orderB.id,
        editInput(before, { addressText: NEW_ADDRESS }),
        before.rowVersion,
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await orderRow(orderB.id)).toEqual(before);
  });
});
