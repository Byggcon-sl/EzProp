import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";

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

/**
 * Venter til testkroken og lageret er klare på siden. Venter på `store` (finnes for alle kandidater;
 * PowerSync-kroken har i tillegg `db`, så dagens tester går som før).
 */
export async function waitForTrialHook(page: Page) {
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __offlineTrial?: { store?: unknown } }).__offlineTrial?.store,
      ),
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

/** Leser en verdi fra testkroken (`deviceId`, `organizationId`, `candidate`). */
export async function hookValue(
  page: Page,
  key: "deviceId" | "organizationId" | "candidate",
): Promise<string> {
  await waitForTrialHook(page);
  const value = await page.evaluate(
    (name) =>
      (window as unknown as { __offlineTrial: Record<string, unknown> }).__offlineTrial[name],
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
        // Bare filene; lageret `confirmed` har merknader om bekreftede bilder, ikke filer.
        const stores = Array.from(database.objectStoreNames).filter((name) => name === "photos");
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

// --- Kandidat 2, ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6) ---

export type TrialSyncCandidate = "powersync" | "electricsql" | "custom";
export type TrialTable = "trial_forms" | "trial_answers" | "trial_photos";
/**
 * ElectricSQL-lageret har i tillegg synkposisjonen (`shape_state`) og endringskøen som egne lagre;
 * egenbygd har `sync_state` (hentemarkøren) i stedet for `shape_state`.
 */
export type HookTable = TrialTable | "shape_state" | "sync_state" | "outbox";
export type LocalRow = Record<string, unknown>;

/**
 * Den delte testkroken `window.__offlineTrial` (`sync/test-hooks.ts`), lik for begge kandidater.
 * PowerSync har i tillegg `db` og `pendingOverride` (se `OfflineTrialHook`).
 */
export interface ElectricTrialHook {
  candidate: TrialSyncCandidate;
  store: {
    status(): Promise<{ online: boolean; pendingChanges: number; pendingPhotos: number }>;
  };
  deviceId: string;
  organizationId: string;
  applySyncedRows(table: TrialTable, rows: LocalRow[]): Promise<void>;
  readRows(table: HookTable, formId?: string): Promise<LocalRow[]>;
  simulateOrganizationChange(organizationId: string): Promise<void> | void;
  createTextState(text: string): string;
  db?: unknown;
}

/** Velger kandidat før hver side lastes (`localStorage.trial_sync_candidate`). Kalles før `logIn`. */
export async function useCandidate(context: BrowserContext, candidate: TrialSyncCandidate) {
  await context.addInitScript((value) => {
    window.localStorage.setItem("trial_sync_candidate", value);
  }, candidate);
}

/** Leser radene i et lokalt lager via testkroken (`hook.readRows`). */
export async function readRowsViaHook(
  page: Page,
  table: HookTable,
  formId?: string,
): Promise<LocalRow[]> {
  await waitForTrialHook(page);
  return page.evaluate(
    async ([name, id]) => {
      const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
      return hook.readRows(name, id ?? undefined);
    },
    [table, formId ?? null] as const,
  );
}

/**
 * Legger rader inn som om synk leverte dem fra serveren (`hook.applySyncedRows`, samme vei som en
 * shape-melding). Rader i snake_case; `trial_answers` upsertes på `(trial_form_id, field_key)`.
 */
export async function applySyncedRowsViaHook(page: Page, table: TrialTable, rows: LocalRow[]) {
  await waitForTrialHook(page);
  await page.evaluate(
    async ([name, list]) => {
      const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
      await hook.applySyncedRows(name, list);
    },
    [table, rows] as const,
  );
}

/** Antall endringer som venter på serverens bekreftelse (`store.status().pendingChanges`). */
export async function pendingChanges(page: Page): Promise<number> {
  await waitForTrialHook(page);
  return page.evaluate(async () => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    return (await hook.store.status()).pendingChanges;
  });
}

export interface RecordedRequest {
  url: URL;
  status: number | null;
}

/** Enkel glob: `**` er hva som helst, `*` hva som helst unntatt «/». */
function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i++;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Teller forespørsler fra siden mot adresser som passer `urlGlob` (f.eks. kall mot
 * `/api/prove/synk/shape`), med status når svaret er kommet. Registreres før `goto`.
 */
export function countRequests(page: Page, urlGlob: string) {
  const matcher = globToRegExp(urlGlob);
  const requests: RecordedRequest[] = [];
  const byRequest = new Map<unknown, RecordedRequest>();
  page.on("request", (request) => {
    if (!matcher.test(request.url())) return;
    const entry: RecordedRequest = { url: new URL(request.url()), status: null };
    requests.push(entry);
    byRequest.set(request, entry);
  });
  page.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.status = 0;
  });
  return {
    requests,
    count: () => requests.length,
    /** Antall kall per verdi av `param` i spørrestrengen (f.eks. `tabell`). */
    countBy: (param: string) => {
      const counts: Record<string, number> = {};
      for (const entry of requests) {
        const key = entry.url.searchParams.get(param) ?? "";
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
  };
}

// --- Kandidat 3, egenbygd (docs/funksjoner/fase1-kandidat-egenbygd-testplan.md avsnitt 6) ---

/** Hente-ruten for egenbygd. */
export const PULL_PATH = "/api/prove/synk/hent";

/** Treffer bare hente-ruten (brukes i `page.route` og `context.route`). */
export function isPullUrl(url: URL): boolean {
  return url.pathname === PULL_PATH;
}

export interface RecordedPull {
  /** `Date.now()` da kallet gikk ut. */
  at: number;
  /** `siden` i spørrestrengen, eller null. */
  siden: string | null;
  status: number | null;
  /** `ferdig` fra svaret, når svaret var 200 med JSON. */
  ferdig: boolean | null;
}

/**
 * Husker kall fra siden mot hente-ruten med tidspunkt, `siden` og `ferdig` fra svaret.
 * Registreres før `goto`. Ser ikke kall som går via service worker (bruk `serviceWorkers: "block"`).
 */
export function recordPulls(page: Page) {
  const pulls: RecordedPull[] = [];
  const byRequest = new Map<unknown, RecordedPull>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!isPullUrl(url)) return;
    const entry: RecordedPull = {
      at: Date.now(),
      siden: url.searchParams.get("siden"),
      status: null,
      ferdig: null,
    };
    pulls.push(entry);
    byRequest.set(request, entry);
  });
  page.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    if (response.status() !== 200) return;
    response
      .json()
      .then((body: unknown) => {
        const ferdig = (body as { ferdig?: unknown } | null)?.ferdig;
        if (typeof ferdig === "boolean") entry.ferdig = ferdig;
      })
      .catch(() => {});
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.status = 0;
  });
  return {
    pulls,
    count: () => pulls.length,
    /** Kall som gikk ut etter tidspunktet. */
    since: (at: number) => pulls.filter((entry) => entry.at > at),
  };
}

/**
 * En enhet til: ny nettleserkontekst (egen `localStorage`, egen IndexedDB og dermed egen
 * `deviceId`) med valgt kandidat og innlogget som admin. Kontekstvalgene (baseURL, skjermstørrelse)
 * sendes inn fra testen, fordi `browser.newContext` ikke arver prosjektets `use`.
 */
export async function openSecondDevice(
  browser: Browser,
  candidate: TrialSyncCandidate,
  options: BrowserContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO", ...options });
  // Samme som useCandidate (navnet med «use» tolkes som React-hook av lint utenfor testene)
  await context.addInitScript((value) => {
    window.localStorage.setItem("trial_sync_candidate", value);
  }, candidate);
  const page = await context.newPage();
  await logIn(page, ADMIN_EMAIL);
  return { context, page };
}
