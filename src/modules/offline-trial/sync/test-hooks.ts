/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Testkroken `window.__offlineTrial` for e2e, bare med `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`
 * (aldri i Azure). Lik for begge kandidater (`TrialTestHooks` i `sync/types.ts`); PowerSync har i
 * tillegg `db` og `pendingOverride`, så dagens e2e står uendret. Importerer ingen kandidat.
 */
import { createTextState } from "../text-merge";
import {
  TRIAL_LAST_ORGANIZATION_KEY,
  type OpenedTrialStore,
  type TrialSyncStatus,
  type TrialSyncTestable,
  type TrialTableName,
  type TrialTestHooks,
} from "./types";

export interface PendingOverride {
  changes: number;
  photos: number;
}

export interface TrialTestHookExtras {
  /** PowerSyncs lokale database (`execute(sql, params)`), for dagens e2e. */
  db?: unknown;
  /** Bare PowerSync: kroken får `pendingOverride`, som overstyrer antallet i `status()`. */
  pendingOverride?: boolean;
}

export type InstalledTrialTestHooks = TrialTestHooks & {
  createTextState(text: string): string;
  db?: unknown;
  pendingOverride?: PendingOverride | null;
};

declare global {
  interface Window {
    __offlineTrial?: InstalledTrialTestHooks;
  }
}

export function trialTestHooksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1";
}

/** Setter `window.__offlineTrial`. Gjør ingenting uten miljøvariabelen. */
export function installTrialTestHooks(
  opened: OpenedTrialStore,
  testable: TrialSyncTestable,
  extras: TrialTestHookExtras = {},
): void {
  if (!trialTestHooksEnabled() || typeof window === "undefined") return;
  const { store } = opened;
  const hooks: InstalledTrialTestHooks = {
    candidate: opened.candidate,
    store,
    deviceId: opened.deviceId,
    organizationId: opened.organizationId,
    applySyncedRows: (table, rows) => testable.applySyncedRows(table, rows),
    readRows: (table, formId) => testable.readRows(table, formId),
    simulateOrganizationChange(organizationId: string) {
      localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, organizationId);
    },
    createTextState,
  };
  if (extras.db !== undefined) hooks.db = extras.db;

  if (extras.pendingOverride) {
    // Overstyrer antallet i status() for indikatortesten (entall og flertall).
    let override: PendingOverride | null = null;
    const listeners = new Set<() => void>();
    const originalStatus = store.status.bind(store);
    const originalOnStatusChange = store.onStatusChange.bind(store);
    store.status = async (): Promise<TrialSyncStatus> => {
      const status = await originalStatus();
      if (!override) return status;
      return { ...status, pendingChanges: override.changes, pendingPhotos: override.photos };
    };
    store.onStatusChange = (listener) => {
      listeners.add(listener);
      const dispose = originalOnStatusChange(listener);
      return () => {
        listeners.delete(listener);
        dispose();
      };
    };
    Object.defineProperty(hooks, "pendingOverride", {
      enumerable: true,
      get: () => override,
      set(value: PendingOverride | null) {
        override = value ?? null;
        for (const listener of listeners) listener();
      },
    });
  }

  window.__offlineTrial = hooks;
}

/** Minste del av PowerSync-databasen kroken trenger (ingen import av SDK-en). */
interface SqlDatabase {
  execute(sql: string, params?: unknown[]): Promise<{ rows?: { _array?: unknown[] } }>;
}

const TABLES: readonly string[] = ["trial_forms", "trial_answers", "trial_photos"];
const COLUMN_NAME = /^[a-z_]+$/;

/**
 * `TrialSyncTestable` for PowerSync: vanlig SQL i den lokale databasen. Går via `ps_crud` (bare
 * Electric-e2e bruker `applySyncedRows`; står i PR-en).
 */
export function createSqlTestable(db: SqlDatabase): TrialSyncTestable {
  return {
    async applySyncedRows(table: TrialTableName, rows: Record<string, unknown>[]) {
      if (!TABLES.includes(table)) throw new Error("Ukjent tabell.");
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => COLUMN_NAME.test(column));
        const values = columns.map((column) => row[column] ?? null);
        let existingId: string | undefined;
        if (table === "trial_answers") {
          const found = await db.execute(
            "SELECT id FROM trial_answers WHERE trial_form_id = ? AND field_key = ?",
            [row.trial_form_id, row.field_key],
          );
          existingId = (found.rows?._array?.[0] as { id?: string } | undefined)?.id;
        } else {
          const found = await db.execute(`SELECT id FROM ${table} WHERE id = ?`, [row.id]);
          existingId = (found.rows?._array?.[0] as { id?: string } | undefined)?.id;
        }
        if (existingId) {
          const updates = columns.filter((column) => column !== "id");
          if (updates.length === 0) continue;
          await db.execute(
            `UPDATE ${table} SET ${updates.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
            [...updates.map((column) => row[column] ?? null), existingId],
          );
        } else {
          await db.execute(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
            values,
          );
        }
      }
    },
    async readRows(table: TrialTableName, formId?: string) {
      if (!TABLES.includes(table)) throw new Error("Ukjent tabell.");
      const column = table === "trial_forms" ? "id" : "trial_form_id";
      const result =
        formId === undefined
          ? await db.execute(`SELECT * FROM ${table}`)
          : await db.execute(`SELECT * FROM ${table} WHERE ${column} = ?`, [formId]);
      return (result.rows?._array ?? []) as Record<string, unknown>[];
    },
  };
}
