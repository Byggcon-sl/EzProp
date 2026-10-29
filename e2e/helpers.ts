import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

/** Første admin fra seed (SEED_ADMIN_EMAIL i CI og .env.example). */
export const ADMIN_EMAIL = "admin@byggcon.no";

/** Logger inn med engangskode hentet fra utviklings-postkassen (/dev/epost). */
export async function logIn(page: Page, email = ADMIN_EMAIL) {
  await page.goto("/logg-inn");
  await page.getByLabel("E-postadresse").fill(email);
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await expect(page.getByLabel("Kode fra e-posten")).toBeVisible();

  const mailbox = await page.context().newPage();
  await mailbox.goto("/dev/epost");
  const subject = await mailbox.getByTestId("dev-email-subject").first().textContent();
  await mailbox.close();
  const code = /: (\d{6})$/.exec(subject ?? "")?.[1];
  if (!code) throw new Error(`Fant ingen innloggingskode i «${subject}»`);

  await page.getByLabel("Kode fra e-posten").fill(code);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page).toHaveURL(/\/arbeidskoe$/);
}

// --- Prøven uten nett (oppgave 4, docs/funksjoner/fase1-kandidat-powersync-testplan.md avsnitt 6) ---

const FORM_URL =
  /\/prove\/testskjema\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Går til listen, trykker «Nytt testskjema» og returnerer id-en til det nye skjemaet. */
export async function createTrialForm(page: Page): Promise<string> {
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nytt testskjema", exact: true }).click();
  await expect(page).toHaveURL(FORM_URL);
  const id = FORM_URL.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Fant ingen skjema-id i ${page.url()}`);
  return id;
}

/** Måleindikatoren over telleren. */
export function indicator(page: Page): Locator {
  return page.getByTestId("sync-indicator");
}

/**
 * Testkroken `window.__offlineTrial` (bare med NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1).
 * `db` er den lokale databasen; `execute(sql, params)` som i PowerSync-SDK-en.
 */
export interface OfflineTrialHook {
  db: { execute(sql: string, params?: unknown[]): Promise<{ rows?: { _array?: unknown[] } }> };
  deviceId: string;
  organizationId?: string;
  pendingOverride?: { changes: number; photos: number } | null;
  simulateOrganizationChange?: (organizationId: string) => Promise<void> | void;
}

// --- Kandidat 2: ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6) ---

export type SyncCandidate = "powersync" | "electricsql";
/** Tabellene `readRows` godtar. `shape_state` og `outbox` bare for ElectricSQL. */
export type HookTable = "trial_forms" | "trial_answers" | "trial_photos" | "shape_state" | "outbox";

/**
 * Den delte testkroken (`sync/test-hooks.ts`) for begge kandidater. Rader i snake_case.
 * PowerSync har i tillegg `db` og `pendingOverride` (`OfflineTrialHook`).
 */
export interface TrialHook {
  candidate: SyncCandidate;
  store: {
    status(): Promise<{ online: boolean; pendingChanges: number; pendingPhotos: number }>;
  };
  deviceId: string;
  organizationId: string;
  applySyncedRows(table: HookTable, rows: Record<string, unknown>[]): Promise<void>;
  readRows(table: HookTable, formId?: string): Promise<Record<string, unknown>[]>;
  simulateOrganizationChange(organizationId: string): Promise<void> | void;
  /** Fra `text-merge.ts`: ny Yjs-tilstand (base64) med teksten. */
  createTextState?(text: string): string;
}
/** Samme krok sett fra ElectricSQL-testene. */
export type ElectricTrialHook = TrialHook;

/**
 * Velger kandidat før hver side lastes (`localStorage.trial_sync_candidate`). Kalles før `logIn`.
 * Gjelder hele konteksten, også etter `reload`.
 */
export async function useCandidate(context: BrowserContext, candidate: SyncCandidate) {
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem("trial_sync_candidate", value);
    } catch {
      // about:blank o.l. har ikke localStorage
    }
  }, candidate);
}

/** Leser rader fra lageret via testkroken (`hook.readRows`). */
export async function readRowsViaHook(
  page: Page,
  table: HookTable,
  formId?: string,
): Promise<Record<string, unknown>[]> {
  await waitForTrialHook(page);
  return page.evaluate(
    async ([name, id]) => {
      const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
      return hook.readRows(name, id ?? undefined);
    },
    [table, formId ?? null] as const,
  );
}

/**
 * Legger rader inn som om synk leverte dem fra serveren (`hook.applySyncedRows`). Upsert på
 * `(trial_form_id, field_key)` for `trial_answers`, ellers på `id`.
 */
export async function applySyncedRowsViaHook(
  page: Page,
  table: "trial_forms" | "trial_answers" | "trial_photos",
  rows: Record<string, unknown>[],
) {
  await waitForTrialHook(page);
  await page.evaluate(
    async ([name, list]) => {
      const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
      await hook.applySyncedRows(name, list);
    },
    [table, rows] as const,
  );
}

/** Antall endringer i køen (`store.status().pendingChanges`). */
export async function pendingChanges(page: Page): Promise<number> {
  await waitForTrialHook(page);
  return page.evaluate(async () => {
    const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
    return (await hook.store.status()).pendingChanges;
  });
}

/** Teller forespørsler mot adresser som matcher `urlGlob` fra nå av. Gir de registrerte adressene. */
export function countRequests(page: Page, urlGlob: string | RegExp) {
  const pattern =
    typeof urlGlob === "string"
      ? new RegExp(
          "^" +
            urlGlob
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*\*/g, "\u0000")
              .replace(/\*/g, "[^/]*")
              .replace(/\u0000/g, ".*")
              .replace(/\?/g, "\\?") +
            "$",
        )
      : urlGlob;
  const urls: string[] = [];
  page.on("request", (request) => {
    if (pattern.test(request.url())) urls.push(request.url());
  });
  return {
    urls,
    get count() {
      return urls.length;
    },
  };
}

/**
 * Venter til testkroken og lageret er klare på siden. Venter på `store` (felles for begge
 * kandidater, docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6); PowerSync-kroken
 * har i tillegg `db`.
 */
export async function waitForTrialHook(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __offlineTrial?: TrialHook }).__offlineTrial?.store),
    undefined,
    { timeout: 15_000 },
  );
}

/** Venter til PowerSync-kroken har den lokale SQLite-databasen (`db`). Bare PowerSync. */
async function waitForPowerSyncDb(page: Page) {
  await waitForTrialHook(page);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __offlineTrial?: OfflineTrialHook }).__offlineTrial?.db),
    undefined,
    { timeout: 15_000 },
  );
}

/** Kjører en spørring i den lokale databasen og gir radene tilbake (bare PowerSync). */
export async function queryLocal<T = Record<string, unknown>>(
  page: Page,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await waitForPowerSyncDb(page);
  return page.evaluate(
    async ([statement, args]) => {
      const hook = (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial;
      const result = await hook.db.execute(statement, args);
      return (result.rows?._array ?? []) as never;
    },
    [sql, params] as const,
  );
}

/** Leser en verdi fra testkroken (`deviceId`, `organizationId`, `candidate`). */
export async function hookValue(
  page: Page,
  key: "deviceId" | "organizationId" | "candidate",
): Promise<string> {
  await waitForTrialHook(page);
  const value = await page.evaluate(
    (name) => (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial[name],
    key,
  );
  if (typeof value !== "string" || value === "") throw new Error(`Testkroken mangler ${key}`);
  return value;
}

/**
 * Skriver et svar rett i den lokale databasen, slik synk ville levert det fra en annen enhet.
 * Upsert på `(trial_form_id, field_key)`. PowerSync-tabellene er visninger, så det gjøres som
 * oppslag + UPDATE eller INSERT i stedet for ON CONFLICT.
 */
export async function setAnswerViaHook(
  page: Page,
  formId: string,
  fieldKey: string,
  value: unknown,
  deviceId: string,
  textState: string | null = null,
) {
  await waitForPowerSyncDb(page);
  await page.evaluate(
    async ({ formId, fieldKey, json, deviceId, textState }) => {
      const hook = (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial;
      const now = new Date().toISOString();
      const found = await hook.db.execute(
        "SELECT id FROM trial_answers WHERE trial_form_id = ? AND field_key = ?",
        [formId, fieldKey],
      );
      const existing = (found.rows?._array?.[0] as { id?: string } | undefined)?.id;
      if (existing) {
        await hook.db.execute(
          "UPDATE trial_answers SET value = ?, text_state = ?, device_id = ?, updated_at = ? WHERE id = ?",
          [json, textState, deviceId, now, existing],
        );
      } else {
        await hook.db.execute(
          "INSERT INTO trial_answers (id, trial_form_id, field_key, value, text_state, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [crypto.randomUUID(), formId, fieldKey, json, textState, deviceId, now, now],
        );
      }
    },
    { formId, fieldKey, json: JSON.stringify(value), deviceId, textState },
  );
}

/** Antall bildefiler som ligger i køen i IndexedDB (`offline-trial-photos`). 0 hvis den ikke finnes. */
export async function localPhotoFileCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // Åpner ikke en database som ikke finnes (det ville laget den tom og forstyrret appen)
    const databases = await indexedDB.databases();
    if (!databases.some((info) => info.name === "offline-trial-photos")) return 0;
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("offline-trial-photos");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const stores = Array.from(database.objectStoreNames);
        if (stores.length === 0) {
          database.close();
          resolve(0);
          return;
        }
        let total = 0;
        const tx = database.transaction(stores, "readonly");
        for (const store of stores) {
          const counting = tx.objectStore(store).count();
          counting.onsuccess = () => {
            total += counting.result;
          };
        }
        tx.oncomplete = () => {
          database.close();
          resolve(total);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}
