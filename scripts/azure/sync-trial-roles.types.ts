/**
 * Kontrakt for `scripts/azure/sync-trial-roles.ts` (ADR 0003, oppgavekort
 * `docs/funksjoner/fase1-synk-i-azure.md`). Utvikleren bygger skriptet mot disse typene,
 * testskriveren skriver integrasjonstesten mot dem. Bare testmiljøet, bare fase 1.
 *
 * Skriptet kjøres av `deploy-azure.yml` etter migrering og seed, mens brannmuren er åpen.
 * Det lager databaseroller for synktjenestene når bryteren er på, og rydder ubrukte
 * replikeringsplasser når bryteren er av. Passord logges aldri og står aldri i SQL-tekst
 * i filen: de settes inn på serveren med `format('… PASSWORD %L', $1)`.
 */

/** Databaserollene synktjenestene logger inn med. Aldri SUPERUSER, CREATEDB, CREATEROLE eller `azure_pg_admin`. */
export type SyncTrialRoleName = "powersync_repl" | "electric_repl";

export const SYNC_TRIAL_ROLES: readonly SyncTrialRoleName[] = ["powersync_repl", "electric_repl"];

/** De eneste tabellene rollene får SELECT på (i `public`). Ingen INSERT, UPDATE eller DELETE. */
export const SYNC_TRIAL_TABLES = ["trial_forms", "trial_answers", "trial_photos"] as const;
export type SyncTrialTable = (typeof SYNC_TRIAL_TABLES)[number];

/** PowerSyncs egen lagring. Eies av `powersync_repl`, `REVOKE ALL … FROM PUBLIC`. */
export const POWERSYNC_STORAGE_DATABASE = "powersync_storage";

/** Navnemønstre (LIKE) for replikeringsplasser som ryddes når de er ubrukte (`active = false`). */
export const SYNC_TRIAL_SLOT_PATTERNS = ["powersync%", "electric_slot%"] as const;

/** DB-passord brukes i URI-er: bare bokstaver og tall, minst 24 tegn (som admin-passordet). */
export const SYNC_TRIAL_PASSWORD_PATTERN = /^[A-Za-z0-9]{24,}$/;

export type SyncTrialRolesInput =
  | {
      /** Bryteren av: bare rydding av ubrukte replikeringsplasser. Ingen passord trengs. */
      enabled: false;
      /** Admin-tilkobling til databasen `ezprop` (`sslmode=verify-full` i Azure). */
      adminDatabaseUrl: string;
    }
  | {
      /** Bryteren på: roller, rettigheter, `powersync_storage` og sjekk. */
      enabled: true;
      adminDatabaseUrl: string;
      /** Må passe `SYNC_TRIAL_PASSWORD_PATTERN`, ellers kastes en feil med navnet, aldri verdien. */
      powerSyncDbPassword: string;
      electricDbPassword: string;
      /**
       * Navnet på PowerSyncs lagringsdatabase. Standard `POWERSYNC_STORAGE_DATABASE`.
       * Testen bruker `powersync_storage_test`, fordi Docker allerede har `powersync_storage`.
       * Databasen rollene får CONNECT på, tas fra tilkoblingen (`current_database()`).
       */
      storageDatabase?: string;
    };

export interface SyncTrialRolesResult {
  enabled: boolean;
  /** Rollene som finnes og har fått passord og rettigheter i denne kjøringen (tom når av). */
  rolesEnsured: SyncTrialRoleName[];
  /** `true` bare når `powersync_storage` ble laget nå; `false` når den fantes fra før eller bryteren er av. */
  storageDatabaseCreated: boolean;
  /** Navn på replikeringsplasser som ble slettet (bare når av). Aldri passord eller URI-er. */
  droppedSlots: string[];
}

/**
 * Tåler å kjøres flere ganger. Kaster `Error` med norsk melding hvis en rolle kan lese en
 * annen tabell i `public` enn `SYNC_TRIAL_TABLES` (sjekk med `has_table_privilege`).
 */
export type ApplySyncTrialRoles = (input: SyncTrialRolesInput) => Promise<SyncTrialRolesResult>;

/**
 * Leser miljøet når skriptet kjøres fra kommandolinjen:
 * `DATABASE_URL`, `ENABLE_SYNC_TRIAL` (bare nøyaktig `true` er på),
 * `POWERSYNC_DB_PASSWORD`, `ELECTRIC_DB_PASSWORD`.
 * Mangler noe når bryteren er på, kastes en feil med navnet på variabelen, aldri verdien.
 */
export type ReadSyncTrialRolesInput = (env: NodeJS.ProcessEnv) => SyncTrialRolesInput;

/**
 * Samme koding som Bicep bruker for `PS_JWT_SECRET_BASE64`: base64 av UTF-8-bytene i
 * `POWERSYNC_JWT_SECRET`, med `+`→`-`, `/`→`_` og uten `=`. Appen signerer med de samme
 * UTF-8-bytene (`sync-token.ts`). Brukes bare i testen som sammenligner med Bicep-uttrykket.
 */
export type ToPowerSyncJwtKey = (secret: string) => string;
