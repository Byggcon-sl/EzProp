import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applySyncTrialRoles,
  readSyncTrialRolesInput,
  toPowerSyncJwtKey,
} from "./sync-trial-roles";
import {
  SYNC_TRIAL_ROLES,
  SYNC_TRIAL_TABLES,
  type SyncTrialRolesInput,
} from "./sync-trial-roles.types";

/*
 * Rolleskriptet for synktjenestene i testmiljøet (ADR 0003). Kjøres mot testdatabasen, serielt
 * (én fil). Testplan: docs/funksjoner/fase1-synk-i-azure-testplan.md, avsnitt 4, og
 * docs/agenter/oppgaver/fase1-smafunn-synk-azure-testplan.md (A1–A4: replikeringsplasser).
 *
 * Rollene er tenant-grensen på databasenivå: synkreglene og shape-proxyen filtrerer per
 * organisasjon, men rollene skal heller ikke kunne lese brukere, sesjoner eller revisjonslogg.
 *
 * Merk: roller og databaser er felles for hele PostgreSQL-klyngen. Navnene står fast i kontrakten,
 * så to kjøringer av denne filen samtidig mot samme klynge kan forstyrre hverandre.
 */

const STORAGE = "powersync_storage_test";
const SIM_ROLE = "sync_trial_admin_sim";
const ROLES = [...SYNC_TRIAL_ROLES];
const TABLES = [...SYNC_TRIAL_TABLES];

/**
 * Testdatabasen. `testDatabaseUrl()` kan ikke brukes her: tests/setup-env.ts har allerede satt
 * DATABASE_URL lik den, så sjekken der slår til (samme mønster som changes-since.test.ts).
 */
const url = process.env.TEST_DATABASE_URL ?? "";
if (!url || !/test/.test(new URL(url).pathname)) {
  throw new Error("TEST_DATABASE_URL mangler eller peker ikke på en testdatabase");
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Bare bokstaver og tall, 36 tegn. Oppdiktet per kjøring. */
function newPassword(): string {
  return randomBytes(18).toString("hex");
}

let powerSyncPassword = newPassword();
let electricPassword = newPassword();
const allPasswords: string[] = [powerSyncPassword, electricPassword];

/** Alt som skrives til konsollen mens filen kjører (sjekkes til slutt for passord). */
const logged: string[] = [];
/** Alle feilmeldinger fra skriptet i filen (sjekkes til slutt for passord). */
const errors: string[] = [];

function onInput(overrides: Partial<Extract<SyncTrialRolesInput, { enabled: true }>> = {}) {
  return {
    enabled: true as const,
    adminDatabaseUrl: url,
    powerSyncDbPassword: powerSyncPassword,
    electricDbPassword: electricPassword,
    storageDatabase: STORAGE,
    ...overrides,
  };
}

/** Kjører skriptet og tar vare på feilmeldingen, så den kan sjekkes for passord til slutt. */
async function apply(input: SyncTrialRolesInput) {
  try {
    return await applySyncTrialRoles(input);
  } catch (error) {
    errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
    throw error;
  }
}

/** Miljø for kjøredelen. Next gjør NODE_ENV påkrevd i typen, ikke i virkeligheten. */
function asEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv;
}

function urlAs(role: string, password: string, database?: string): string {
  const target = new URL(url);
  target.username = role;
  target.password = password;
  if (database) target.pathname = `/${database}`;
  return target.toString();
}

/** Kobler til som `role` og kjører `query`. Lukker alltid tilkoblingen. */
async function queryAs(role: string, password: string, query: string, database?: string) {
  const client = postgres(urlAs(role, password, database), {
    max: 1,
    onnotice: () => {},
    connect_timeout: 5,
  });
  try {
    return await client.unsafe(query);
  } finally {
    await client.end({ timeout: 1 });
  }
}

async function roleExists(role: string): Promise<boolean> {
  const rows = await sql`select 1 from pg_roles where rolname = ${role}`;
  return rows.length > 0;
}

async function storageExists(): Promise<boolean> {
  const rows = await sql`select 1 from pg_database where datname = ${STORAGE}`;
  return rows.length > 0;
}

async function isSuperuser(): Promise<boolean> {
  const [row] = await sql<{ rolsuper: boolean }[]>`
    select rolsuper from pg_roles where rolname = current_user`;
  return row!.rolsuper;
}

/** Tåler at noe mangler. Feilkode 2BP01 (avhengigheter i en annen database) tåles. */
async function tolerate(action: () => Promise<unknown>, codes: string[] = []) {
  try {
    await action();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (!codes.includes(code)) throw error;
  }
}

/** Fjerner lagringsdatabasen og rollene (og simulert admin) fra testkjøringen. */
async function cleanup() {
  if (await storageExists()) {
    try {
      await sql.unsafe(`drop database if exists ${STORAGE} with (force)`);
    } catch {
      // Uten superbruker: som eierrollen (skriptet har gitt seg selv SET på den).
      const reserved = await sql.reserve();
      try {
        await reserved.unsafe("set role powersync_repl");
        await reserved.unsafe(`drop database if exists ${STORAGE}`);
      } finally {
        await reserved.unsafe("reset role").catch(() => {});
        reserved.release();
      }
    }
  }
  const [{ db }] = (await sql`select current_database() as db`) as unknown as [{ db: string }];
  for (const role of [...ROLES, SIM_ROLE]) {
    if (!(await roleExists(role))) continue;
    try {
      await sql.unsafe(`drop owned by ${role}`);
    } catch {
      await tolerate(() => sql.unsafe(`revoke all on all tables in schema public from ${role}`));
      await tolerate(() => sql.unsafe(`revoke all on schema public from ${role}`));
      await tolerate(() => sql.unsafe(`revoke all on database "${db}" from ${role}`));
    }
    await tolerate(() => sql.unsafe(`drop role if exists ${role}`), ["2BP01"]);
  }
}

async function dropSlot(name: string) {
  await sql`
    select pg_drop_replication_slot(slot_name)
    from pg_replication_slots where slot_name = ${name}`;
}

/** Fysiske testplasser (A1). Fysiske plasser hører ikke til noen database. */
const PHYSICAL_SLOTS = ["powersync_testplan_1", "electric_slot_testplan_1", "annen_testplan_1"];
/** Midlertidig database for A3. Aldri ezprop eller powersync_storage. */
const OTHER_DB = "ezprop_slottest_other";
const OTHER_SLOT = "powersync_testplan_3";
const ACTIVE_SLOT = "powersync_testplan_4";
/** Logiske testplasser i testdatabasen (A2 og A4). */
const LOGICAL_SLOTS = [
  "powersync_testplan_2",
  "electric_slot_testplan_2",
  "annen_testplan_2",
  ACTIVE_SLOT,
];

const [{ wal_level: walLevel }] = (await sql`show wal_level`) as unknown as [{ wal_level: string }];
/** Logiske plasser krever wal_level=logical. CI og vanlig lokal PostgreSQL har «replica». */
const logicalWal = walLevel === "logical";
const SKIP_REASON = logicalWal
  ? ""
  : ` (hoppes over: wal_level er «${walLevel}», logiske plasser krever «logical»)`;
const adminUser = decodeURIComponent(new URL(url).username);
const adminPassword = decodeURIComponent(new URL(url).password);

/**
 * Sletter logiske plasser i den andre databasen (må gjøres derfra) og så databasen.
 * Tåler at den ikke finnes.
 */
async function dropOtherDatabase() {
  const exists = await sql`select 1 from pg_database where datname = ${OTHER_DB}`;
  if (exists.length === 0) return;
  const other = postgres(urlAs(adminUser, adminPassword, OTHER_DB), {
    max: 1,
    onnotice: () => {},
    connect_timeout: 5,
  });
  try {
    await other`
      select pg_drop_replication_slot(slot_name) from pg_replication_slots
      where database = ${OTHER_DB} and not active`;
  } finally {
    await other.end({ timeout: 1 });
  }
  await sql.unsafe(`drop database if exists ${OTHER_DB} with (force)`);
}

async function slotNames(): Promise<string[]> {
  const rows = await sql<{ slot_name: string }[]>`select slot_name from pg_replication_slots`;
  return rows.map((row) => row.slot_name);
}

/** Rolleegenskaper og medlemskap for alle roller unntatt synkrollene og den simulerte admin. */
async function otherRolesSnapshot() {
  const excluded = [...ROLES, SIM_ROLE];
  const roles = await sql`
    select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
           rolreplication, rolbypassrls, rolconnlimit
    from pg_roles
    where rolname <> all(${excluded})
    order by rolname`;
  const memberships = await sql`
    select g.rolname as role_name, m.rolname as member_name,
           am.admin_option, am.inherit_option, am.set_option
    from pg_auth_members am
    join pg_roles g on g.oid = am.roleid
    join pg_roles m on m.oid = am.member
    where g.rolname <> all(${excluded}) and m.rolname <> all(${excluded})
    order by 1, 2`;
  return { roles: [...roles], memberships: [...memberships] };
}

let snapshotBefore: Awaited<ReturnType<typeof otherRolesSnapshot>>;

beforeAll(async () => {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
    });
  }
  await cleanup();
  snapshotBefore = await otherRolesSnapshot();
});

afterAll(async () => {
  // Logiske plasser først (de holder på WAL), så fysiske, så den andre databasen.
  for (const name of LOGICAL_SLOTS) await tolerate(() => dropSlot(name));
  await dropOtherDatabase();
  for (const name of PHYSICAL_SLOTS) await tolerate(() => dropSlot(name));
  await tolerate(() => sql`revoke select on users from electric_repl`);
  await cleanup();
  await sql.end({ timeout: 1 });
  vi.restoreAllMocks();
});

describe("readSyncTrialRolesInput (kjøredelen leser miljøet)", () => {
  const base = { DATABASE_URL: "postgres://oppdiktet@localhost:5432/ezprop" };

  it("bryteren er av uten ENABLE_SYNC_TRIAL og for alt annet enn nøyaktig true", () => {
    for (const value of [undefined, "", "false", "TRUE", "ja", "1", "true "]) {
      const env = value === undefined ? { ...base } : { ...base, ENABLE_SYNC_TRIAL: value };
      const input = readSyncTrialRolesInput(asEnv(env));
      expect(input.enabled, `ENABLE_SYNC_TRIAL=«${value}»`).toBe(false);
      expect(input.adminDatabaseUrl).toBe(base.DATABASE_URL);
    }
  });

  it("bryteren på leser begge passordene", () => {
    const ps = newPassword();
    const el = newPassword();
    const input = readSyncTrialRolesInput(
      asEnv({
        ...base,
        ENABLE_SYNC_TRIAL: "true",
        POWERSYNC_DB_PASSWORD: ps,
        ELECTRIC_DB_PASSWORD: el,
      }),
    );
    expect(input).toMatchObject({
      enabled: true,
      adminDatabaseUrl: base.DATABASE_URL,
      powerSyncDbPassword: ps,
      electricDbPassword: el,
    });
  });

  it("bryteren på uten et passord stopper med navnet, aldri verdien", () => {
    const ps = newPassword();
    const el = newPassword();
    const cases: [string, Record<string, string>, string][] = [
      ["POWERSYNC_DB_PASSWORD", { ELECTRIC_DB_PASSWORD: el }, el],
      ["ELECTRIC_DB_PASSWORD", { POWERSYNC_DB_PASSWORD: ps }, ps],
    ];
    for (const [missing, passwords, present] of cases) {
      let message = "";
      try {
        readSyncTrialRolesInput(asEnv({ ...base, ENABLE_SYNC_TRIAL: "true", ...passwords }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, missing).toContain(missing);
      expect(message).not.toContain(present);
    }
  });

  it("uten DATABASE_URL stopper den med navnet", () => {
    expect(() => readSyncTrialRolesInput(asEnv({}))).toThrow(/DATABASE_URL/);
  });
});

describe("toPowerSyncJwtKey", () => {
  it("gir base64url av UTF-8, uten =", () => {
    for (const key of [
      "oppdiktet-testnokkel-for-bicep-0123456789abcdef",
      "oppdiktet-nøkkel-med-æøå-ÆØÅ-for-utf8-0123456789",
      "~~~?>?>oppdiktet-nokkel-som-gir-pluss-og-skraastrek",
      "oppdiktet-nokkel-med-lengde-som-gir-likhetstegn-1",
    ]) {
      const expected = Buffer.from(key, "utf8").toString("base64url");
      expect(toPowerSyncJwtKey(key), key).toBe(expected);
      expect(toPowerSyncJwtKey(key)).not.toMatch(/[+/=]/);
    }
  });
});

describe("skriptfilen", () => {
  it("passordet står ikke i skriptfilen", () => {
    const text = readFileSync(
      path.resolve(process.cwd(), "scripts/azure/sync-trial-roles.ts"),
      "utf8",
    );
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("format(");
    expect(code).toContain("%L");
    expect(code).not.toMatch(/PASSWORD\s+'/i);
    expect(code).not.toMatch(/PASSWORD\s*\$\{/i);
    expect(code).not.toMatch(/GRANT\s+(azure_pg_admin|pg_read_all_data|pg_write_all_data)\b/i);
    // Ingen ROLE-setning gir SUPERUSER, CREATEDB, CREATEROLE eller BYPASSRLS (NO… er lov).
    for (const statement of code.match(/\b(CREATE|ALTER)\s+ROLE\b[^`;]*/gi) ?? []) {
      expect(statement).not.toMatch(/\b(SUPERUSER|CREATEDB|CREATEROLE|BYPASSRLS)\b/i);
    }
  });
});

describe("rolleskriptet mot testdatabasen", () => {
  it("lager rollene og lagringsdatabasen og kan kjøres to ganger", async () => {
    const first = await apply(onInput());
    const second = await apply(onInput());
    expect(first.enabled).toBe(true);
    expect([...first.rolesEnsured].sort()).toEqual([...ROLES].sort());
    expect(first.storageDatabaseCreated).toBe(true);
    expect(first.droppedSlots).toEqual([]);
    expect([...second.rolesEnsured].sort()).toEqual([...ROLES].sort());
    expect(second.storageDatabaseCreated).toBe(false);
    for (const role of ROLES) expect(await roleExists(role), role).toBe(true);
    const [owner] = await sql<{ owner: string }[]>`
      select pg_get_userbyid(datdba) as owner from pg_database where datname = ${STORAGE}`;
    expect(owner?.owner).toBe("powersync_repl");
  });

  it("rollene har REPLICATION, men ikke SUPERUSER, CREATEDB eller CREATEROLE", async () => {
    const rows = await sql`
      select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin, rolbypassrls
      from pg_roles where rolname = any(${ROLES})`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row, row.rolname as string).toMatchObject({
        rolreplication: true,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
      });
    }
    const memberships = await sql<{ member: string; role: string }[]>`
      select m.rolname as member, g.rolname as role
      from pg_auth_members am
      join pg_roles g on g.oid = am.roleid
      join pg_roles m on m.oid = am.member
      where m.rolname = any(${ROLES})`;
    const forbidden = ["azure_pg_admin", "pg_read_all_data", "pg_write_all_data"];
    expect(memberships.filter((row) => forbidden.includes(row.role))).toEqual([]);
  });

  it("rollene kan lese de tre trial-tabellene, men ikke skrive", async () => {
    for (const role of ROLES) {
      for (const table of TABLES) {
        const [row] = await sql`
          select
            has_table_privilege(${role}, ${`public.${table}`}, 'SELECT') as can_select,
            has_table_privilege(${role}, ${`public.${table}`}, 'INSERT') as can_insert,
            has_table_privilege(${role}, ${`public.${table}`}, 'UPDATE') as can_update,
            has_table_privilege(${role}, ${`public.${table}`}, 'DELETE') as can_delete,
            has_table_privilege(${role}, ${`public.${table}`}, 'TRUNCATE') as can_truncate`;
        expect(row, `${role} på ${table}`).toEqual({
          can_select: true,
          can_insert: false,
          can_update: false,
          can_delete: false,
          can_truncate: false,
        });
      }
    }
  });

  it("rollene kan ikke lese andre tabeller i public", async () => {
    const tables = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and c.relname <> all(${TABLES})
      order by 1`;
    const names = tables.map((t) => t.name);
    for (const expected of ["users", "sessions", "employees", "audit_log", "organizations"]) {
      expect(names).toContain(expected);
    }
    for (const role of ROLES) {
      for (const name of names) {
        const [row] = await sql<{ ok: boolean }[]>`
          select has_table_privilege(${role}, ${`public.${name}`}, 'SELECT') as ok`;
        expect(row!.ok, `${role} kan lese ${name}`).toBe(false);
      }
    }
  });

  it("innlogging med passordet virker, og rollen ser bare trial-tabellene", async () => {
    const passwords: Record<string, string> = {
      powersync_repl: powerSyncPassword,
      electric_repl: electricPassword,
    };
    for (const role of ROLES) {
      await expect(
        queryAs(role, passwords[role]!, "select 1 from trial_forms limit 1"),
        role,
      ).resolves.toBeDefined();
      await expect(
        queryAs(role, passwords[role]!, "select 1 from users limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("passordbytte virker", async () => {
    const oldPowerSync = powerSyncPassword;
    powerSyncPassword = newPassword();
    electricPassword = newPassword();
    allPasswords.push(powerSyncPassword, electricPassword);
    await apply(onInput());
    await expect(
      queryAs("powersync_repl", powerSyncPassword, "select 1 from trial_forms limit 1"),
    ).resolves.toBeDefined();
    await expect(
      queryAs("electric_repl", electricPassword, "select 1 from trial_forms limit 1"),
    ).resolves.toBeDefined();
    // Det gamle passordet virker ikke lenger.
    await expect(queryAs("powersync_repl", oldPowerSync, "select 1")).rejects.toMatchObject({
      code: "28P01",
    });
  });

  it("electric_repl kan ikke koble til lagringsdatabasen", async () => {
    const [row] = await sql<{ ok: boolean }[]>`
      select has_database_privilege('electric_repl', ${STORAGE}, 'CONNECT') as ok`;
    expect(row!.ok).toBe(false);
    const [publicConnect] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
      where d.datname = ${STORAGE} and a.grantee = 0 and a.privilege_type = 'CONNECT'`;
    expect(publicConnect!.count, "PUBLIC har CONNECT på lagringsdatabasen").toBe(0);
    await expect(queryAs("electric_repl", electricPassword, "select 1", STORAGE)).rejects.toThrow();
    // PowerSync selv kan bruke sin lagring.
    await expect(
      queryAs("powersync_repl", powerSyncPassword, "select 1", STORAGE),
    ).resolves.toBeDefined();
  });

  it("sjekken stopper hvis en rolle kan lese en annen tabell", async () => {
    await sql`grant select on users to electric_repl`;
    try {
      let message = "";
      try {
        await apply(onInput());
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, "skriptet stoppet ikke").not.toBe("");
      expect(message).toContain("electric_repl");
      expect(message).toContain("users");
      for (const password of allPasswords) expect(message).not.toContain(password);
    } finally {
      await sql`revoke select on users from electric_repl`;
    }
    // Uten den ekstra rettigheten går det igjen.
    await expect(apply(onInput())).resolves.toMatchObject({ enabled: true });
  });

  it("bryteren på uten passord stopper med navnet", async () => {
    const cases: [string, Partial<Extract<SyncTrialRolesInput, { enabled: true }>>][] = [
      ["POWERSYNC_DB_PASSWORD", { powerSyncDbPassword: "" }],
      ["ELECTRIC_DB_PASSWORD", { electricDbPassword: "" }],
      // Passord som ikke kan stå i en URI eller er for kort, stopper også.
      ["POWERSYNC_DB_PASSWORD", { powerSyncDbPassword: "oppdiktet@passord/0123456789abc" }],
      ["ELECTRIC_DB_PASSWORD", { electricDbPassword: "kort1234" }],
    ];
    for (const [name, override] of cases) {
      const input = onInput(override);
      await expect(apply(input), name).rejects.toThrow(name);
    }
  });

  it("bryteren av rører ikke fysiske plasser, selv med synknavn", async () => {
    // Regresjonstest for småfunn 1 etter PR #17: fysiske plasser hører ikke til noen database
    // og skal aldri slettes av skriptet. Kjører alltid (trenger ikke wal_level=logical).
    for (const name of PHYSICAL_SLOTS) {
      await tolerate(() => dropSlot(name));
      await sql`select pg_create_physical_replication_slot(${name})`;
    }
    try {
      const result = await apply({ enabled: false, adminDatabaseUrl: url });
      expect(result.enabled).toBe(false);
      expect(result.rolesEnsured).toEqual([]);
      expect(result.storageDatabaseCreated).toBe(false);
      expect(result.droppedSlots).toEqual([]);
      const left = await slotNames();
      for (const name of PHYSICAL_SLOTS) expect(left, name).toContain(name);
      // Rollene og lagringen blir stående (Bicep og Ståle sletter containerne, ikke data).
      for (const role of ROLES) expect(await roleExists(role), role).toBe(true);
      expect(await storageExists()).toBe(true);
    } finally {
      for (const name of PHYSICAL_SLOTS) await tolerate(() => dropSlot(name));
    }
  });

  it.skipIf(!logicalWal)(
    `bryteren av sletter ubrukte logiske plasser i egen database${SKIP_REASON}`,
    async () => {
      const names = ["powersync_testplan_2", "electric_slot_testplan_2", "annen_testplan_2"];
      for (const name of names) {
        await tolerate(() => dropSlot(name));
        await sql`select pg_create_logical_replication_slot(${name}, 'pgoutput')`;
      }
      try {
        const result = await apply({ enabled: false, adminDatabaseUrl: url });
        expect([...result.droppedSlots].sort()).toEqual(
          ["electric_slot_testplan_2", "powersync_testplan_2"].sort(),
        );
        const left = await slotNames();
        expect(left).not.toContain("powersync_testplan_2");
        expect(left).not.toContain("electric_slot_testplan_2");
        expect(left).toContain("annen_testplan_2");

        const again = await apply({ enabled: false, adminDatabaseUrl: url });
        expect(again.droppedSlots).toEqual([]);
      } finally {
        for (const name of names) await tolerate(() => dropSlot(name));
      }
    },
  );

  it.skipIf(!logicalWal)(
    `bryteren av rører ikke plasser i en annen database${SKIP_REASON}`,
    async () => {
      await dropOtherDatabase();
      await sql.unsafe(`create database ${OTHER_DB}`);
      const other = postgres(urlAs(adminUser, adminPassword, OTHER_DB), {
        max: 1,
        onnotice: () => {},
      });
      try {
        await other`select pg_create_logical_replication_slot(${OTHER_SLOT}, 'pgoutput')`;
        const result = await apply({ enabled: false, adminDatabaseUrl: url });
        expect(result.droppedSlots).not.toContain(OTHER_SLOT);
        const [row] = await sql<{ database: string }[]>`
          select database from pg_replication_slots where slot_name = ${OTHER_SLOT}`;
        expect(row?.database, "plassen i den andre databasen er borte").toBe(OTHER_DB);
      } finally {
        await other.end({ timeout: 1 });
        await dropOtherDatabase();
      }
    },
  );

  it.skipIf(!logicalWal)(`bryteren av rører ikke aktive plasser${SKIP_REASON}`, async () => {
    // En midlertidig plass er aktiv så lenge økten som lagde den, lever, og forsvinner
    // av seg selv når økten lukkes. Den kan derfor ikke bli liggende.
    const holder = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await holder`select pg_create_logical_replication_slot(${ACTIVE_SLOT}, 'pgoutput', true)`;
      const [before] = await sql<{ active: boolean }[]>`
        select active from pg_replication_slots where slot_name = ${ACTIVE_SLOT}`;
      expect(before?.active, "plassen er ikke aktiv").toBe(true);
      const result = await apply({ enabled: false, adminDatabaseUrl: url });
      expect(result.droppedSlots).not.toContain(ACTIVE_SLOT);
      expect(await slotNames()).toContain(ACTIVE_SLOT);
    } finally {
      await holder.end({ timeout: 1 });
    }
  });

  it("rører ikke andre roller", async () => {
    await apply(onInput());
    await apply({ enabled: false, adminDatabaseUrl: url });
    expect(await otherRolesSnapshot()).toEqual(snapshotBefore);
  });

  it("bryteren av lager ingen roller og trenger ingen passord", async () => {
    await cleanup();
    const rolesBefore = await Promise.all(ROLES.map((role) => roleExists(role)));
    expect(await storageExists()).toBe(false);
    const result = await apply({ enabled: false, adminDatabaseUrl: url });
    expect(result).toMatchObject({
      enabled: false,
      rolesEnsured: [],
      storageDatabaseCreated: false,
    });
    expect(await storageExists()).toBe(false);
    const rolesAfter = await Promise.all(ROLES.map((role) => roleExists(role)));
    expect(rolesAfter).toEqual(rolesBefore);
    // Finnes rollene likevel (avhengigheter i en annen database på samme maskin), har de ikke
    // fått noen rettigheter her.
    for (const [index, role] of ROLES.entries()) {
      if (!rolesAfter[index]) continue;
      for (const table of TABLES) {
        const [row] = await sql<{ ok: boolean }[]>`
          select has_table_privilege(${role}, ${`public.${table}`}, 'SELECT') as ok`;
        expect(row!.ok, `${role} på ${table}`).toBe(false);
      }
    }
    // Mange databasekall etter hverandre; kan bli treg når hele testpakken kjører samtidig.
  }, 20_000);

  it("virker uten superbruker, slik som i Azure", async () => {
    await cleanup();
    let adminDatabaseUrl = url;
    if (await isSuperuser()) {
      // CI og Docker: lag en admin som i Azure (ikke superbruker), og kjør skriptet som den.
      // Admin i Azure eier tabellene; her får den rettighetene til eieren gjennom medlemskap.
      const simPassword = newPassword();
      allPasswords.push(simPassword);
      const [{ owner }] = (await sql`
        select tableowner as owner from pg_tables
        where schemaname = 'public' and tablename = 'trial_forms'`) as unknown as [
        { owner: string },
      ];
      await sql.unsafe(
        `create role ${SIM_ROLE} login createrole createdb replication nosuperuser password '${simPassword}'`,
      );
      await sql.unsafe(`grant "${owner}" to ${SIM_ROLE}`);
      adminDatabaseUrl = urlAs(SIM_ROLE, simPassword);
      const [{ rolsuper }] = (await sql`
        select rolsuper from pg_roles where rolname = ${SIM_ROLE}`) as unknown as [
        { rolsuper: boolean },
      ];
      expect(rolsuper).toBe(false);
    }
    const result = await apply(onInput({ adminDatabaseUrl }));
    expect([...result.rolesEnsured].sort()).toEqual([...ROLES].sort());
    expect(result.storageDatabaseCreated).toBe(true);
    const [owner] = await sql<{ owner: string }[]>`
      select pg_get_userbyid(datdba) as owner from pg_database where datname = ${STORAGE}`;
    expect(owner?.owner).toBe("powersync_repl");
    await expect(
      queryAs("powersync_repl", powerSyncPassword, "select 1 from trial_forms limit 1"),
    ).resolves.toBeDefined();
  });

  it("passord står ikke i loggen eller i feilmeldinger", () => {
    // Siste test i filen: ser på alt som ble logget og alle feil fra skriptet over.
    expect(errors.length, "testene over skulle gi feil fra skriptet").toBeGreaterThan(0);
    for (const password of allPasswords) {
      for (const line of logged) expect(line).not.toContain(password);
      for (const message of errors) expect(message).not.toContain(password);
    }
  });
});
