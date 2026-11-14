import { inspect } from "node:util";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { assignments, contacts, firms, orders } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  TEST_NOW,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { seedKnownValues } from "../../../tests/known-values";
import {
  AssignmentChangedError,
  OfficeNotFoundError,
  PossibleDuplicatesLookupError,
  createAssignment,
  findPossibleDuplicatesFor,
  findPossibleDuplicatesForAssignment,
  updateAssignmentBooking,
} from "./index";

/*
 * Logger, hendelser og revisjonslogg uten bestillingsverdier (testplan for «Nytt oppdrag» 4.12).
 * Bruker merkene fra testplanen, som ikke kan forekomme tilfeldig, og `tests/known-values.ts`
 * (`onAssignment`) for et oppdrag med bestillingen bare på oppdraget. Loggeren og konsollen fanges.
 * Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (adresse, matrikkel og bestiller havner aldri i
 * loggene, hendelsene eller revisjonsloggen ved oppretting, heller ikke når noe feiler).
 */

const swap = vi.hoisted(() => ({ failLookup: false }));

const MARKS = {
  address: "MERKE-ADR-N7Q",
  orderedBy: "MERKE-BEST-N7Q",
  externalRef: "MERKE-REF-N7Q",
  association: "MERKE-BRL-N7Q",
  gnr: "7771",
  bnr: "7772",
  snr: "7773",
  contact: "MERKEKONTAKT-N7Q",
  firm: "MERKEFIRMA-N7Q",
} as const;
const ALL_MARKS = Object.values(MARKS);
const ADDRESS = `${MARKS.address} 5, 8000 Bodø`;

// Tvinger en databasefeil i dublettoppslaget. Feilen ligner en PostgreSQL-feil med SQL-tekst og
// parametre, slik at det vises at verken teksten eller parametrene når loggen.
vi.mock("./booking/duplicate-sql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./booking/duplicate-sql")>();
  return {
    ...actual,
    possibleDuplicatesQuery: (...args: Parameters<typeof actual.possibleDuplicatesQuery>) => {
      if (!swap.failLookup) return actual.possibleDuplicatesQuery(...args);
      const rawSql = `select ... where address_text = $1 -- params: ${ADDRESS}, ${MARKS.gnr}, ${MARKS.bnr}`;
      const failure = Object.assign(new Error(`Failed query: ${rawSql}`), {
        name: "PostgresError",
        code: "57014",
        query: rawSql,
        parameters: [ADDRESS, MARKS.gnr, MARKS.bnr, MARKS.snr],
        cause: new Error(`canceling statement due to statement timeout: ${ADDRESS}`),
      });
      return Promise.reject(failure) as unknown as ReturnType<
        typeof actual.possibleDuplicatesQuery
      >;
    },
  };
});

type Spy = { mock: { calls: unknown[][] } };
let spies: Spy[] = [];

function spyOnOutput(): Spy[] {
  return [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

/** Alt som er sendt til loggeren og konsollen, også feil med årsak. */
function loggedText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => inspect(args, { depth: 8 }))
    .join("\n");
}

function expectNoMarks(text: string, where: string) {
  for (const mark of ALL_MARKS) {
    expect(text, `${mark} i ${where}`).not.toContain(mark);
  }
}

async function tableText(table: "events" | "audit_log"): Promise<string> {
  const rows = (await db.execute(
    sql`select t::text as row from ${sql.identifier(table)} t`,
  )) as unknown as { row: string }[];
  return rows.map((row) => row.row).join("\n");
}

async function counts() {
  const [row] = await db.execute<{ a: number; o: number; c: number; f: number }>(sql`
    select (select count(*)::int from ${assignments}) as a,
      (select count(*)::int from ${orders}) as o,
      (select count(*)::int from ${contacts}) as c,
      (select count(*)::int from ${firms}) as f`);
  return row!;
}

let before: Awaited<ReturnType<typeof counts>>;

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const inspectorUser = await createUser({ name: "Test Takstmann" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"]);
  const firm = await createFirm(org.id, { name: `${MARKS.firm} Megling AS` });
  const contact = await createContact(org.id, {
    firstName: MARKS.contact,
    lastName: "Testesen",
    firmId: firm.id,
  });
  return { org, office, admin, inspector, firm, contact };
}

function fullInput(
  office: { id: string },
  inspector: { id: string },
  contact: { id: string },
  extra: Record<string, unknown> = {},
) {
  return {
    addressText: ADDRESS,
    gnr: MARKS.gnr,
    bnr: MARKS.bnr,
    snr: MARKS.snr,
    orderedByText: MARKS.orderedBy,
    orderedByContactId: contact.id,
    externalRef: MARKS.externalRef,
    housingAssociationName: MARKS.association,
    officeId: office.id,
    responsibleEmployeeId: inspector.id,
    ...extra,
  };
}

/** Midlertidig trigger som stopper innsetting i tabellen. Fjernes alltid etterpå. */
async function withFailingInsert<T>(table: "events" | "assignments", run: () => Promise<T>) {
  const fn = `test_fail_${table}_n7q`;
  await db.execute(
    sql.raw(`create or replace function ${fn}() returns trigger language plpgsql as $$
      begin raise exception 'oppdiktet feil i testen'; end $$`),
  );
  await db.execute(
    sql.raw(`create trigger ${fn} before insert on ${table} for each row execute function ${fn}()`),
  );
  try {
    return await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists ${fn} on ${table}`));
    await db.execute(sql.raw(`drop function if exists ${fn}()`));
  }
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeEach(async () => {
  await resetDatabase();
  swap.failLookup = false;
  spies = spyOnOutput();
  before = await counts();
});

afterEach(async () => {
  swap.failLookup = false;
  vi.restoreAllMocks();
  // 4.13: ingen tjeneste i oppgaven sletter rader
  const now = await counts();
  expect(now.a).toBeGreaterThanOrEqual(before.a);
  expect(now.o).toBeGreaterThanOrEqual(before.o);
  expect(now.c).toBeGreaterThanOrEqual(before.c);
  expect(now.f).toBeGreaterThanOrEqual(before.f);
});

describe("4.12.1 oppretting lykkes", () => {
  it("ingen merke i events, audit_log (hele raden) eller logglinjene", async () => {
    const { org, office, admin, inspector, contact } = await setup();
    before = await counts();
    const result = await createAssignment(admin, org.id, fullInput(office, inspector, contact), {
      now: TEST_NOW,
    });

    const [row] = await db.select().from(assignments).where(eq(assignments.id, result.id));
    expect(row?.addressText).toBe(ADDRESS);
    expect(row?.externalRef).toBe(MARKS.externalRef);
    expectNoMarks(await tableText("events"), "events");
    expectNoMarks(await tableText("audit_log"), "audit_log");
    expectNoMarks(loggedText(), "loggen");
  });

  it("endring etterpå: hendelsen har bare feltkoder, og loggen har ingen merker", async () => {
    const { org, office, admin, inspector, contact } = await setup();
    const { id } = await createAssignment(admin, org.id, fullInput(office, inspector, contact), {
      now: TEST_NOW,
    });
    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: `${MARKS.address} 6, 8000 Bodø`, gnr: MARKS.gnr, bnr: MARKS.bnr },
      1,
      TEST_NOW,
    );
    expectNoMarks(await tableText("events"), "events");
    expectNoMarks(loggedText(), "loggen");
  });
});

describe("4.12.2 oppretting feiler", () => {
  it("fremmed kontor: feilen og loggen har ingen merker, ingenting lagret", async () => {
    const { org, admin, inspector, contact } = await setup();
    const orgB = await createOrganization("Oppdiktet Takst B");
    const foreignOffice = await createOffice(orgB.id);
    before = await counts();

    const error = await caught(
      createAssignment(admin, org.id, fullInput(foreignOffice, inspector, contact)),
    );

    expect(error).toBeInstanceOf(OfficeNotFoundError);
    expectNoMarks(inspect(error, { depth: 8 }), "feilen");
    expectNoMarks(loggedText(), "loggen");
    expect((await counts()).a).toBe(before.a);
    expectNoMarks(await tableText("events"), "events");
    expectNoMarks(await tableText("audit_log"), "audit_log");
  });

  it.each(["events", "assignments"] as const)(
    "databasefeil ved innsetting i %s: loggen har ingen merker, ingenting lagret",
    async (table) => {
      const { org, office, admin, inspector, contact } = await setup();
      before = await counts();

      const error = await withFailingInsert(table, () =>
        caught(createAssignment(admin, org.id, fullInput(office, inspector, contact))),
      );

      expect(error).toBeInstanceOf(Error);
      expectNoMarks(loggedText(), "loggen");
      expect((await counts()).a).toBe(before.a);
      expectNoMarks(await tableText("events"), "events");
      expectNoMarks(await tableText("audit_log"), "audit_log");
    },
  );

  it("valideringsfeil (elleve sifre, bokstaver i gnr): Zod-feilen og loggen har ingen merker", async () => {
    const { org, office, admin, inspector, contact } = await setup();
    before = await counts();

    const error = await caught(
      createAssignment(
        admin,
        org.id,
        fullInput(office, inspector, contact, {
          gnr: `${MARKS.gnr}x`,
          orderedByText: `${MARKS.orderedBy} 01020312345`,
          externalRef: `${MARKS.externalRef} 010203 12345`,
        }),
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("ZodError");
    expectNoMarks(inspect(error, { depth: 8 }), "Zod-feilen");
    expect(inspect(error, { depth: 8 })).not.toContain("01020312345");
    expectNoMarks(loggedText(), "loggen");
    expect((await counts()).a).toBe(before.a);
  });

  it("konflikt ved endring: feilen og loggen har ingen merker", async () => {
    const { org, office, admin, inspector, contact } = await setup();
    const { id } = await createAssignment(admin, org.id, fullInput(office, inspector, contact));
    const error = await caught(
      updateAssignmentBooking(admin, org.id, id, { addressText: `${MARKS.address} 9` }, 99),
    );
    expect(error).toBeInstanceOf(AssignmentChangedError);
    expectNoMarks(inspect(error, { depth: 8 }), "feilen");
    expectNoMarks(loggedText(), "loggen");
  });
});

describe("4.12.3 dublettoppslaget feiler", () => {
  it("utkast og lagret oppdrag: egen feil uten merker, og loggen har bare feilnavn og kode", async () => {
    const { org, admin } = await setup();
    const assignmentId = await seedKnownValues(
      org.id,
      {
        order: {
          addressText: ADDRESS,
          gnr: MARKS.gnr,
          bnr: MARKS.bnr,
          snr: MARKS.snr,
          orderedByText: MARKS.orderedBy,
          housingAssociationName: MARKS.association,
        },
      },
      { onAssignment: true },
    );
    swap.failLookup = true;

    const errors = [
      await caught(
        findPossibleDuplicatesFor(admin, org.id, {
          addressText: ADDRESS,
          gnr: MARKS.gnr,
          bnr: MARKS.bnr,
          snr: MARKS.snr,
          receivedAt: TEST_NOW,
        }),
      ),
      await caught(findPossibleDuplicatesForAssignment(admin, org.id, assignmentId)),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(PossibleDuplicatesLookupError);
      expectNoMarks(inspect(error, { depth: 8 }), "feilen");
    }
    const logged = loggedText();
    expect(logged).toContain("57014");
    expectNoMarks(logged, "loggen");
    expect(logged).not.toContain("address_text = $1");
  });
});

describe("4.12.4 dublettsvaret", () => {
  it("har en fast nøkkelliste uten matrikkel, bestiller, kontakt eller reklamasjon", async () => {
    const { org, office, admin, inspector, contact } = await setup();
    await createAssignment(admin, org.id, fullInput(office, inspector, contact));
    await createOrder(org.id, {
      addressText: ADDRESS,
      gnr: MARKS.gnr,
      bnr: MARKS.bnr,
      orderedByText: MARKS.orderedBy,
      externalRef: MARKS.externalRef,
      orderedByContactId: contact.id,
    });

    const result = await findPossibleDuplicatesFor(admin, org.id, {
      addressText: ADDRESS,
      gnr: MARKS.gnr,
      bnr: MARKS.bnr,
      snr: null,
      receivedAt: new Date(),
    });

    expect(result.items.map((item) => item.kind).sort()).toEqual(["assignment", "order"]);
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["addressText", "id", "kind", "number", "reasons", "receivedAt", "status"].sort(),
      );
    }
    // Adressen vises på skjermen i samme organisasjon (A290); ingen andre merker
    const shown = JSON.stringify(result.items.map(({ addressText: _a, ...rest }) => rest));
    expectNoMarks(shown, "svaret utenom adressen");
    expectNoMarks(loggedText(), "loggen");
  });
});
