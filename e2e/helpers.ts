import { expect, type Locator, type Page } from "@playwright/test";

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

/** Venter til testkroken og den lokale databasen er klare på siden. */
export async function waitForTrialHook(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __offlineTrial?: OfflineTrialHook }).__offlineTrial?.db),
    undefined,
    { timeout: 15_000 },
  );
}

/** Kjører en spørring i den lokale databasen og gir radene tilbake. */
export async function queryLocal<T = Record<string, unknown>>(
  page: Page,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await waitForTrialHook(page);
  return page.evaluate(
    async ([statement, args]) => {
      const hook = (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial;
      const result = await hook.db.execute(statement, args);
      return (result.rows?._array ?? []) as never;
    },
    [sql, params] as const,
  );
}

/** Leser en verdi fra testkroken (`deviceId`, `organizationId`). */
export async function hookValue(page: Page, key: "deviceId" | "organizationId"): Promise<string> {
  await waitForTrialHook(page);
  const value = await page.evaluate(
    (name) => (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial[name],
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
  await waitForTrialHook(page);
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
