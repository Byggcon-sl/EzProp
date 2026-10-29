/**
 * Rolleskript for synkprøven i testmiljøet (fase 1, ADR 0003, oppgavekort
 * `docs/funksjoner/fase1-synk-i-azure.md` punkt 4). Kontrakt: `sync-trial-roles.types.ts`.
 *
 * Kjøres alltid av `deploy-azure.yml` etter migrering og seed:
 * - Bryteren på: lager `powersync_repl` og `electric_repl` (bare SELECT på de tre
 *   `trial_*`-tabellene), PowerSyncs lagringsdatabase, og sjekker at rollene ikke ser mer.
 * - Bryteren av: sletter bare ubrukte replikeringsplasser fra synktjenestene.
 *
 * Passord logges aldri og står aldri i SQL-tekst her. De settes inn på serveren med
 * `format(… %L, $1)`. Feilmeldinger nevner navn, aldri verdier.
 *
 * Fra kommandolinjen: `pnpm exec tsx scripts/azure/sync-trial-roles.ts`
 * (leser DATABASE_URL, ENABLE_SYNC_TRIAL, POWERSYNC_DB_PASSWORD, ELECTRIC_DB_PASSWORD).
 */
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  POWERSYNC_STORAGE_DATABASE,
  SYNC_TRIAL_PASSWORD_PATTERN,
  SYNC_TRIAL_ROLES,
  SYNC_TRIAL_SLOT_PATTERNS,
  SYNC_TRIAL_TABLES,
  type ApplySyncTrialRoles,
  type ReadSyncTrialRolesInput,
  type SyncTrialRoleName,
  type SyncTrialRolesResult,
  type ToPowerSyncJwtKey,
} from "./sync-trial-roles.types";

type Sql = postgres.Sql;

const PASSWORD_ENV_NAMES: Record<SyncTrialRoleName, string> = {
  powersync_repl: "POWERSYNC_DB_PASSWORD",
  electric_repl: "ELECTRIC_DB_PASSWORD",
};

/** Kaster en feil med navnet på miljøvariabelen, aldri verdien. */
function assertValidPassword(envName: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${envName} mangler. Lag den som secret i GitHub (se testmiljo-azure.md).`);
  }
  if (!SYNC_TRIAL_PASSWORD_PATTERN.test(value)) {
    throw new Error(`${envName} er ugyldig: bare bokstaver og tall, minst 24 tegn.`);
  }
  return value;
}

export const toPowerSyncJwtKey: ToPowerSyncJwtKey = (secret) =>
  Buffer.from(secret, "utf8").toString("base64url");

export const readSyncTrialRolesInput: ReadSyncTrialRolesInput = (env) => {
  const adminDatabaseUrl = env.DATABASE_URL;
  if (!adminDatabaseUrl) throw new Error("DATABASE_URL mangler.");
  if (env.ENABLE_SYNC_TRIAL !== "true") return { enabled: false, adminDatabaseUrl };
  return {
    enabled: true,
    adminDatabaseUrl,
    powerSyncDbPassword: assertValidPassword("POWERSYNC_DB_PASSWORD", env.POWERSYNC_DB_PASSWORD),
    electricDbPassword: assertValidPassword("ELECTRIC_DB_PASSWORD", env.ELECTRIC_DB_PASSWORD),
  };
};

/** Sletter ubrukte replikeringsplasser fra PowerSync og Electric. Rører ingen andre. */
async function dropUnusedSlots(sql: Sql): Promise<string[]> {
  const [powerSyncPattern, electricPattern] = SYNC_TRIAL_SLOT_PATTERNS;
  const slots = await sql<{ slot_name: string }[]>`
    select slot_name from pg_replication_slots
    where not active and (slot_name like ${powerSyncPattern} or slot_name like ${electricPattern})
    order by slot_name`;
  const dropped: string[] = [];
  for (const { slot_name } of slots) {
    await sql`select pg_drop_replication_slot(${slot_name})`;
    dropped.push(slot_name);
  }
  return dropped;
}

/**
 * Lager rollen hvis den mangler, og setter alltid egenskaper og passord. Rollen lages uten
 * superbruker (standard). NOSUPERUSER står ikke i ALTER, fordi bare en superbruker får
 * endre den egenskapen (Azure-admin er ikke superbruker); `assertRoleAttributes` sjekker den.
 */
async function ensureRole(sql: Sql, role: SyncTrialRoleName, password: string): Promise<void> {
  const [existing] = await sql`select 1 from pg_roles where rolname = ${role}`;
  if (!existing) await sql`create role ${sql(role)}`;
  // Passordet settes inn på serveren (%L) og går aldri gjennom SQL-tekst i denne filen.
  const [statement] = await sql<{ stmt: string }[]>`
    select format(
      'ALTER ROLE %I LOGIN REPLICATION NOCREATEDB NOCREATEROLE PASSWORD %L',
      ${role}::text,
      ${password}::text
    ) as stmt`;
  try {
    await sql.unsafe(statement!.stmt);
  } catch (error) {
    // Feilobjektet fra driveren kan ha med SQL-teksten. Bare meldingen sendes videre.
    const reason = error instanceof Error ? error.message : "ukjent feil";
    throw new Error(`Kunne ikke sette egenskaper og passord for ${role}: ${reason}`);
  }
}

async function grantReadOnTrialTables(
  sql: Sql,
  role: SyncTrialRoleName,
  database: string,
): Promise<void> {
  const tableList = sql(SYNC_TRIAL_TABLES.map((table) => `public.${table}`));
  await sql`grant connect on database ${sql(database)} to ${sql(role)}`;
  await sql`grant usage on schema public to ${sql(role)}`;
  await sql`revoke insert, update, delete, truncate, references, trigger on ${tableList} from ${sql(role)}`;
  await sql`grant select on ${tableList} to ${sql(role)}`;
}

/** PowerSyncs lagring. Eies av `powersync_repl`; ingen andre kan koble til. */
async function ensureStorageDatabase(
  sql: Sql,
  storageDatabase: string,
  isSuperuser: boolean,
): Promise<boolean> {
  const owner: SyncTrialRoleName = "powersync_repl";
  if (!isSuperuser) {
    // PostgreSQL 16: admin må kunne bruke rollen for å gjøre den til eier (funn 5).
    await sql`grant ${sql(owner)} to current_user with inherit false, set true`;
  }
  const [existing] = await sql`select 1 from pg_database where datname = ${storageDatabase}`;
  let created = false;
  if (!existing) {
    // CREATE DATABASE kan ikke kjøres i en transaksjon.
    await sql`create database ${sql(storageDatabase)} owner ${sql(owner)}`;
    created = true;
  }
  await sql.begin(async (tx) => {
    if (!isSuperuser) await tx`set local role ${tx(owner)}`;
    await tx`revoke all on database ${tx(storageDatabase)} from public`;
  });
  const [ownerRow] = await sql<{ owner: string }[]>`
    select pg_get_userbyid(datdba) as owner from pg_database where datname = ${storageDatabase}`;
  if (ownerRow?.owner !== owner) {
    throw new Error(`Databasen ${storageDatabase} finnes, men eies ikke av ${owner}.`);
  }
  const [publicConnect] = await sql<{ open: boolean }[]>`
    select coalesce(bool_or(a.privilege_type = 'CONNECT'), false) as open
    from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    where d.datname = ${storageDatabase} and a.grantee = 0`;
  if (publicConnect?.open) {
    throw new Error(
      `Alle kan fortsatt koble til ${storageDatabase}. REVOKE fra PUBLIC virket ikke.`,
    );
  }
  const [electricConnect] = await sql<{ ok: boolean }[]>`
    select has_database_privilege('electric_repl', ${storageDatabase}, 'CONNECT') as ok`;
  if (electricConnect?.ok) {
    throw new Error(`electric_repl kan koble til ${storageDatabase}, men skal ikke kunne det.`);
  }
  return created;
}

/**
 * Stopper hvis en rolle har for mange rettigheter: superbruker, kan lage roller eller
 * databaser, eller er medlem av en annen rolle (som admin- eller lese-alt-rollene).
 */
async function assertRoleAttributes(sql: Sql): Promise<void> {
  const rows = await sql<{ rolname: string; ok: boolean; member_of: string[] | null }[]>`
    select r.rolname,
      r.rolcanlogin and r.rolreplication and not r.rolsuper
        and not r.rolcreatedb and not r.rolcreaterole and not r.rolbypassrls as ok,
      (select array_agg(g.rolname::text order by g.rolname) from pg_auth_members m
        join pg_roles g on g.oid = m.roleid where m.member = r.oid) as member_of
    from pg_roles r where r.rolname = any(${[...SYNC_TRIAL_ROLES]}::text[])`;
  for (const row of rows) {
    if (!row.ok) {
      throw new Error(
        `Rollen ${row.rolname} har feil egenskaper. Den skal kunne logge inn og replikere, og ikke være superbruker eller kunne lage roller eller databaser.`,
      );
    }
    if (row.member_of && row.member_of.length > 0) {
      throw new Error(
        `Rollen ${row.rolname} er medlem av ${row.member_of.join(", ")}, men skal ikke være medlem av noen rolle.`,
      );
    }
  }
}

/** Stopper hvis en rolle kan lese noe i `public` utenom de tre trial-tabellene. */
async function assertOnlyTrialTablesReadable(sql: Sql): Promise<void> {
  for (const role of SYNC_TRIAL_ROLES) {
    const leaks = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and c.relname <> all(${[...SYNC_TRIAL_TABLES]}::text[])
        and has_table_privilege(${role}, c.oid, 'SELECT')
      order by c.relname`;
    if (leaks.length > 0) {
      const names = leaks.map((leak) => leak.relname).join(", ");
      throw new Error(
        `Rollen ${role} kan lese tabeller den ikke skal se: ${names}. Fjern rettigheten før synkprøven slås på.`,
      );
    }
  }
}

export const applySyncTrialRoles: ApplySyncTrialRoles = async (input) => {
  const passwords: Record<SyncTrialRoleName, string> | null = input.enabled
    ? {
        powersync_repl: assertValidPassword(
          PASSWORD_ENV_NAMES.powersync_repl,
          input.powerSyncDbPassword,
        ),
        electric_repl: assertValidPassword(
          PASSWORD_ENV_NAMES.electric_repl,
          input.electricDbPassword,
        ),
      }
    : null;

  const sql = postgres(input.adminDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    if (!input.enabled || !passwords) {
      const droppedSlots = await dropUnusedSlots(sql);
      return { enabled: false, rolesEnsured: [], storageDatabaseCreated: false, droppedSlots };
    }

    const [session] = await sql<{ database: string; superuser: boolean }[]>`
      select current_database() as database,
        (select rolsuper from pg_roles where rolname = current_user) as superuser`;
    const database = session!.database;
    const isSuperuser = session!.superuser;

    const rolesEnsured: SyncTrialRoleName[] = [];
    for (const role of SYNC_TRIAL_ROLES) {
      await ensureRole(sql, role, passwords[role]);
      await grantReadOnTrialTables(sql, role, database);
      rolesEnsured.push(role);
    }
    const storageDatabaseCreated = await ensureStorageDatabase(
      sql,
      input.storageDatabase ?? POWERSYNC_STORAGE_DATABASE,
      isSuperuser,
    );
    await assertRoleAttributes(sql);
    await assertOnlyTrialTablesReadable(sql);

    const result: SyncTrialRolesResult = {
      enabled: true,
      rolesEnsured,
      storageDatabaseCreated,
      droppedSlots: [],
    };
    return result;
  } finally {
    await sql.end();
  }
};

/** Tynn kjøredel: bare når filen kjøres direkte, ikke ved import fra testen. */
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const result = await applySyncTrialRoles(readSyncTrialRolesInput(process.env));
    if (result.enabled) {
      console.log(
        `Synkprøven er på. Roller klare: ${result.rolesEnsured.join(", ")}. ` +
          `Lagringsdatabase laget nå: ${result.storageDatabaseCreated ? "ja" : "nei (fantes)"}.`,
      );
    } else {
      console.log(
        result.droppedSlots.length > 0
          ? `Synkprøven er av. Slettet ubrukte replikeringsplasser: ${result.droppedSlots.join(", ")}.`
          : "Synkprøven er av. Ingen replikeringsplasser å rydde.",
      );
    }
  } catch (error) {
    // Bare meldingen: feilobjektet fra driveren kan ha med SQL-tekst.
    console.error(error instanceof Error ? error.message : "Rolleskriptet feilet.");
    process.exitCode = 1;
  }
}
