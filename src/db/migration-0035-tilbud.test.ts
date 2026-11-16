import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./run-migrations";

/*
 * Migreringen 0035: ordren blir tilbud med «Gyldig til» og fast avslagsgrunn (ADR 0012, F4;
 * testplan avsnitt 2). Lager en egen tom database (`ezprop_mig_<tilfeldig>`), kjører migreringene
 * til og med 0034 fra en kopi av mappen med kuttet journal, setter inn rader med rå SQL slik de
 * kan se ut i drift i dag (åpne, avslåtte, gjort om og mykt slettede, og mottak rundt midnatt norsk
 * tid vinter og sommer), og kjører så hele mappen. Databasen og kopien slettes i `afterAll`.
 *
 * Alle data er oppdiktet («Testveien», «Prøvegata»).
 *
 * Støtter hovedmål: de ansatte og færre reklamasjoner (ingen ordre mister data eller får ny
 * status; gamle åpne ordre vises som utløpt, og gamle avslag beholder grunnen).
 */

type Sql = ReturnType<typeof postgres>;

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL mangler (se .env.example)");
  return url;
}

const DB_NAME = `ezprop_mig_${randomBytes(6).toString("hex")}`;
const MIGRATED_THROUGH = "0034_oppdrag-bestilling";

function urlFor(database: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

let admin: Sql;
let target: Sql;
let partialFolder: string;

const ids = {
  org: randomUUID(),
  office: randomUUID(),
  assignment: randomUUID(),
  open: randomUUID(),
  oldOpen: randomUUID(),
  winter: randomUUID(),
  summer: randomUUID(),
  rejected: randomUUID(),
  rejectedDeleted: randomUUID(),
  converted: randomUUID(),
  openDeleted: randomUUID(),
};

/** Mottatt og forventet «Gyldig til» (norsk dato for mottaket + 30). */
const CASES: Record<
  Exclude<keyof typeof ids, "org" | "office" | "assignment">,
  [string, string]
> = {
  open: ["2026-10-20T08:00:00Z", "2026-11-19"],
  // 60 dager før TEST_NOW (03.11.2026): utløpt rett etter migreringen
  oldOpen: ["2026-09-04T10:00:00Z", "2026-10-04"],
  // Vinter: 23:30 UTC er 00:30 neste dag i Oslo
  winter: ["2026-03-10T23:30:00Z", "2026-04-10"],
  // Sommer: 22:30 UTC er 00:30 neste dag i Oslo
  summer: ["2026-07-10T22:30:00Z", "2026-08-10"],
  rejected: ["2026-09-15T09:00:00Z", "2026-10-15"],
  rejectedDeleted: ["2026-08-01T09:00:00Z", "2026-08-31"],
  converted: ["2026-10-01T07:00:00Z", "2026-10-31"],
  openDeleted: ["2026-10-02T07:00:00Z", "2026-11-01"],
};

const UPDATED_AT = "2026-10-25T12:00:00.000Z";
const DELETED_AT = "2026-10-26T12:00:00.000Z";

type OrderRow = Record<string, unknown> & { id: string };

let beforeRows = new Map<string, OrderRow>();
let afterRows = new Map<string, OrderRow>();
let migrationError: unknown;

async function rawOrders(sql: Sql): Promise<Map<string, OrderRow>> {
  const rows = await sql<OrderRow[]>`select * from orders order by id`;
  return new Map(rows.map((row) => [row.id, { ...row }]));
}

async function seedBeforeMigration(sql: Sql) {
  await sql`insert into organizations (id, name, brand_name)
    values (${ids.org}, 'Oppdiktet migrering', 'Oppdiktet migrering')`;
  await sql`insert into offices (id, organization_id, name) values (${ids.office}, ${ids.org}, 'Bodø')`;
  await sql`insert into assignments (id, organization_id, number, office_id, assignment_type,
      status, address_text, received_at)
    values (${ids.assignment}, ${ids.org}, 'MIG-035', ${ids.office}, 'condition_report', 'ordered',
      'Prøvegata 3, 8006 Bodø', ${CASES.converted[0]})`;
  const insert = async (
    id: string,
    receivedAt: string,
    extra: { status?: string; reason?: string | null; assignmentId?: string; deleted?: boolean },
  ) => {
    await sql`insert into orders (id, organization_id, received_at, address_text, gnr, bnr,
        ordered_by_text, status, rejected_reason, assignment_id, row_version, updated_at,
        deleted_at)
      values (${id}, ${ids.org}, ${receivedAt}, 'Testveien 12, 8000 Bodø', '9001', '1',
        'Megler Oppdiktet', ${extra.status ?? "received"}, ${extra.reason ?? null},
        ${extra.assignmentId ?? null}, 7, ${UPDATED_AT}, ${extra.deleted ? DELETED_AT : null})`;
  };
  await insert(ids.open, CASES.open[0], {});
  await insert(ids.oldOpen, CASES.oldOpen[0], {});
  await insert(ids.winter, CASES.winter[0], {});
  await insert(ids.summer, CASES.summer[0], {});
  await insert(ids.rejected, CASES.rejected[0], {
    status: "rejected",
    reason: "Feil registrering",
  });
  await insert(ids.rejectedDeleted, CASES.rejectedDeleted[0], {
    status: "rejected",
    reason: "Dobbelt registrert",
    deleted: true,
  });
  await insert(ids.converted, CASES.converted[0], {
    status: "converted",
    assignmentId: ids.assignment,
  });
  await insert(ids.openDeleted, CASES.openDeleted[0], { deleted: true });
}

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${DB_NAME}"`);
  target = postgres(urlFor(DB_NAME), { max: 1, onnotice: () => {} });

  partialFolder = mkdtempSync(join(tmpdir(), "ezprop-mig-0035-"));
  cpSync(MIGRATIONS_FOLDER, partialFolder, { recursive: true });
  const journalPath = join(partialFolder, "meta", "_journal.json");
  const journalJson = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journalJson.entries.findIndex((entry) => entry.tag === MIGRATED_THROUGH);
  if (cut < 0) throw new Error(`Fant ikke ${MIGRATED_THROUGH} i journalen`);
  journalJson.entries = journalJson.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journalJson));
  await runMigrations(urlFor(DB_NAME), partialFolder);

  await seedBeforeMigration(target);
  beforeRows = await rawOrders(target);
  migrationError = await runMigrations(urlFor(DB_NAME)).then(
    () => null,
    (error: unknown) => error,
  );
  afterRows = await rawOrders(target);
}, 120_000);

afterAll(async () => {
  await target?.end();
  if (admin) {
    await admin.unsafe(`drop database if exists "${DB_NAME}" with (force)`);
    await admin.end();
  }
  if (partialFolder) rmSync(partialFolder, { recursive: true, force: true });
});

function after(id: string): OrderRow {
  const found = afterRows.get(id);
  if (!found) throw new Error("Fant ikke ordren etter migreringen");
  return found;
}

/** `date` kommer som tekst eller `Date` fra driveren; begge gjøres om til «ÅÅÅÅ-MM-DD». */
function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

describe("2 migreringen 0035", () => {
  it("kjører uten feil", () => {
    expect(migrationError).toBeNull();
  });

  it.each(Object.entries(CASES))(
    "2.1 og 2.2 %s får norsk dato for mottaket + 30",
    (key, [, expected]) => {
      expect(isoDate(after(ids[key as keyof typeof CASES]).valid_until)).toBe(expected);
    },
  );

  it("2.3, 2.4 og 2.14 ingen rader slettet, og alle andre kolonner er uendret felt for felt", () => {
    expect(afterRows.size).toBe(beforeRows.size);
    for (const [id, before] of beforeRows) {
      const { valid_until: _validUntil, rejected_reason_key: _key, ...rest } = after(id);
      expect(rest, id).toEqual(before);
    }
  });

  it("2.5 valid_until er påkrevd uten standardverdi, og innsetting uten den feiler", async () => {
    const [column] = await target<{ is_nullable: string; column_default: string | null }[]>`
      select is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'valid_until'`;
    expect(column).toEqual({ is_nullable: "NO", column_default: null });
    const error = await target`insert into orders (organization_id, address_text)
      values (${ids.org}, 'Testveien 12, 8000 Bodø')`.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { code?: string } | null)?.code).toBe("23502");
  });

  it("2.6 ingen CHECK mellom dato og status, og CHECK på status er uendret", async () => {
    const checks = await target<{ conname: string; def: string }[]>`
      select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'orders'::regclass and contype = 'c'`;
    for (const check of checks) expect(check.def, check.conname).not.toContain("valid_until");
    const status = checks.find((check) => check.conname === "orders_status_check");
    expect(status?.def).toMatch(/received.*converted.*rejected/);
  });

  it("2.7 indeksen (organization_id, status, valid_until) uten slettede finnes", async () => {
    const [index] = await target<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'orders_organization_id_status_valid_until_idx'`;
    expect(index?.indexdef.replace(/\s+/g, " ").toLowerCase()).toContain(
      "(organization_id, status, valid_until) where (deleted_at is null)",
    );
  });

  it("2.9 gammel åpen ordre er utløpt etter migreringen (i dag 03.11.2026)", () => {
    expect(after(ids.oldOpen).status).toBe("received");
    expect(isoDate(after(ids.oldOpen).valid_until) < "2026-11-03").toBe(true);
    expect(isoDate(after(ids.open).valid_until) >= "2026-11-03").toBe(true);
  });

  it("2.12 avslåtte rader, også mykt slettede, får «other» og beholder teksten; andre får null", () => {
    expect(after(ids.rejected)).toMatchObject({
      rejected_reason_key: "other",
      rejected_reason: "Feil registrering",
    });
    expect(after(ids.rejectedDeleted)).toMatchObject({
      rejected_reason_key: "other",
      rejected_reason: "Dobbelt registrert",
    });
    for (const key of ["open", "oldOpen", "converted", "openDeleted"] as const) {
      expect(after(ids[key]).rejected_reason_key, key).toBeNull();
    }
  });

  it("2.13 CHECK etter migreringen: kode påkrevd, «Annet» krever tekst, ukjent kode avvises", async () => {
    const tryInsert = (key: string | null, reason: string | null) =>
      target`insert into orders (organization_id, address_text, valid_until, status,
          rejected_reason_key, rejected_reason)
        values (${ids.org}, 'Testveien 12, 8000 Bodø', '2026-12-03', 'rejected', ${key}, ${reason})`.then(
        () => "ok",
        (caught: { code?: string }) => caught.code,
      );
    expect(await tryInsert(null, "Tekst")).toBe("23514");
    expect(await tryInsert("other", null)).toBe("23514");
    expect(await tryInsert("other", "  ")).toBe("23514");
    expect(await tryInsert("pris", "Tekst")).toBe("23514");
    expect(await tryInsert("price", null)).toBe("ok");
    expect(await tryInsert("other", "Annen grunn")).toBe("ok");
  });

  it("2.8 tom tabell: migreringen kjører uten feil", async () => {
    const emptyName = `ezprop_mig_${randomBytes(6).toString("hex")}`;
    await admin.unsafe(`create database "${emptyName}"`);
    try {
      await runMigrations(urlFor(emptyName));
    } finally {
      await admin.unsafe(`drop database if exists "${emptyName}" with (force)`);
    }
  }, 120_000);
});
