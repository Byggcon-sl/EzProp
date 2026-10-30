import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { listTrialFields, trialForm } from "../src/modules/offline-trial/trial-form";

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

/**
 * Tilstanden i synkstatusen øverst («Uten nett», «Venter: …», «Venter på kontakt med serveren»
 * eller «Alt er lagret»). Erstatter måleindikatoren (docs/funksjoner/fase1-synkstatus.md pkt. 1).
 */
export function indicator(page: Page): Locator {
  return page.getByTestId("sync-status-state");
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

// --- Synkstatus (docs/funksjoner/fase1-synkstatus-testplan.md avsnitt 5.1) ---

/** Hele synkstatuslinjen øverst på listen og testskjemaet. */
export function syncStatus(page: Page): Locator {
  return page.getByTestId("sync-status");
}

/** «Lagret kl. 14:32», «Lagret 28.10. kl. 14:32» eller «Ikke lagret på serveren ennå». */
export function savedAt(page: Page): Locator {
  return page.getByTestId("sync-status-saved-at");
}

/** Knappen «Synk nå» (viser «Synker …» mens runden pågår). */
export function syncNowButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Synk nå|Synker …)$/ });
}

/** Beskjedfeltet under linjen (`aria-live`). */
export function syncMessage(page: Page): Locator {
  return page.getByTestId("sync-status-message");
}

/**
 * Legger «Lagret kl.» for kandidaten i `localStorage` før første lasting, som om enheten hadde
 * lagret alt da. Skrives bare én gang per fane (merket i `sessionStorage`), så en omlasting ikke
 * legger tidspunktet tilbake etter at appen har endret eller tømt det.
 */
export async function setSavedAt(
  context: BrowserContext,
  candidate: TrialSyncCandidate,
  iso: string,
) {
  await context.addInitScript(
    ({ key, value }) => {
      const marker = `e2e_set_${key}`;
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(key, value);
    },
    { key: `trial_saved_at_${candidate}`, value: iso },
  );
}

/** Skriveruten for endringskøen. */
export const CHANGES_PATH = "/api/prove/synk/endringer";

/** Oppdiktet takstmann for e2e. Ingen ekte navn eller adresser. */
export const INSPECTOR_EMAIL = "takstmann.e2e@eksempel.no";

/** Databasen appen i e2e bruker: `DATABASE_URL`, ellers `.env`, ellers standarden fra `.env.example`. */
export function e2eDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  }
  return "postgres://ezprop:ezprop@localhost:5432/ezprop";
}

/**
 * Sørger for at den oppdiktede takstmannen finnes som ansatt med rollen `inspector` i samme
 * organisasjon som admin fra seed (Byggcon). Idempotent.
 *
 * - Skriver bare til lokal database eller testdatabasen (`assertLocalOrTestDatabase`), og
 *   sjekker det før den kobler til.
 * - Bruker aldri slettede eller deaktiverte rader (admin, ansatt eller rolle). Finnes takstmannen
 *   eller rollen bare som slettet/deaktivert, kastes en feil som sier hva som må gjøres.
 * - Gjenoppretter, sletter eller endrer ingenting.
 */
export async function ensureInspector(): Promise<void> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [admin] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e
      join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.deleted_at is null and e.deactivated_at is null
      limit 1`;
    if (!admin) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    const organizationId = admin.organization_id;
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, 'Oppdiktet takstmann', ${INSPECTOR_EMAIL}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<
      { id: string }[]
    >`select id from users where email = ${INSPECTOR_EMAIL}`;
    if (!user) throw new Error("Kunne ikke lage takstmannen for e2e");
    const found = await sql<{ id: string; deleted_at: Date | null; deactivated_at: Date | null }[]>`
      select id, deleted_at, deactivated_at from employees
      where user_id = ${user.id} and organization_id = ${organizationId}`;
    let employee: { id: string } | undefined = found.find(
      (row) => row.deleted_at === null && row.deactivated_at === null,
    );
    if (!employee && found.length > 0) {
      throw new Error(
        "Takstmannen for e2e (INSPECTOR_EMAIL) er slettet eller deaktivert i testdatabasen. " +
          "Tøm databasen eller kjør pnpm db:seed på nytt.",
      );
    }
    if (!employee) {
      [employee] = await sql<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organizationId}, ${user.id}, 'Oppdiktet takstmann')
        returning id`;
    }
    if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e");
    const roles = await sql<{ deleted_at: Date | null }[]>`
      select deleted_at from employee_roles
      where employee_id = ${employee.id} and role = 'inspector'`;
    if (roles.some((row) => row.deleted_at === null)) return;
    if (roles.length > 0) {
      throw new Error(
        "Rollen takstmann for e2e-takstmannen (INSPECTOR_EMAIL) er slettet i testdatabasen. " +
          "Tøm databasen eller kjør pnpm db:seed på nytt.",
      );
    }
    await sql`
      insert into employee_roles (organization_id, employee_id, role)
      values (${organizationId}, ${employee.id}, 'inspector')
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

/** Logger inn som den oppdiktede takstmannen (rolle `inspector`, ikke admin). */
export async function logInAsInspector(page: Page) {
  await ensureInspector();
  await logIn(page, INSPECTOR_EMAIL);
}

// --- Prøve E, regler uten nett (docs/funksjoner/fase1-prove-e-regler-testplan.md avsnitt 5.1) ---

/** Linjen med regelsvaret for en regelkode (`data-rule-key`, `data-rule-state`). */
export function ruleResult(page: Page, ruleKey: string): Locator {
  return page.locator(`[data-rule-key="${ruleKey}"]`);
}

/** Tallfeltet for en feltkode i testskjemaet, funnet på etiketten (som testskjema-testene). */
export function numberInput(page: Page, fieldKey: string): Locator {
  const field = listTrialFields(trialForm).find((entry) => entry.key === fieldKey);
  if (!field || field.type !== "number") throw new Error(`Fant ikke tallfeltet ${fieldKey}`);
  return page.getByLabel(field.label, { exact: true });
}

// --- Prøve C, lagring i Safari (docs/funksjoner/fase1-prove-c-lagring-testplan.md avsnitt 5.1) ---

/** 1 MB i byte (som `navigator.storage.estimate()` gir). */
export const MB = 1024 * 1024;

/**
 * Testkroken for lagring (`window.__offlineTrialStorage`, bare med
 * NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1). `estimate` erstatter `navigator.storage.estimate()`;
 * `fail` lar lagring av svar, bilder eller begge feile med `QuotaExceededError` til den slås av.
 */
export interface StorageOverride {
  estimate?: { usage: number; quota: number };
  fail?: "answer" | "photo" | "both" | null;
}

/** Setter kroken før siden lastes (`addInitScript`), så den gjelder fra første måling. */
export async function setStorageOverride(target: Page | BrowserContext, value: StorageOverride) {
  await target.addInitScript((override) => {
    (window as unknown as { __offlineTrialStorage?: unknown }).__offlineTrialStorage = override;
  }, value);
}

/** Endrer kroken på åpen side; neste måling eller lagring bruker den nye verdien. */
export async function updateStorageOverride(page: Page, patch: StorageOverride) {
  await page.evaluate((change) => {
    const target = window as unknown as { __offlineTrialStorage?: Record<string, unknown> };
    target.__offlineTrialStorage = { ...(target.__offlineTrialStorage ?? {}), ...change };
  }, patch);
}

/** Boksen «Lagring på denne iPaden» på listen (`data-storage-level`, `data-storage-persisted`). */
export function storageBox(page: Page): Locator {
  return page.getByTestId("storage-health");
}

/** Varselet om lite plass i den faste linjen øverst i skjemaet (`role="status"`). */
export function storageWarning(page: Page): Locator {
  return page.getByTestId("storage-low-warning");
}

/** Meldingen når lagring feiler, i den faste linjen øverst i skjemaet (`role="alert"`). */
export function storageError(page: Page): Locator {
  return page.getByTestId("storage-error");
}

/** Feltbeholderen for etiketten (har `data-field-saved="yes|no"`). */
export function fieldSaved(page: Page, label: string): Locator {
  const field = listTrialFields(trialForm).find((entry) => entry.label === label);
  if (!field) throw new Error(`Fant ikke feltet «${label}»`);
  return page.locator(`[data-field="${field.key}"]`);
}

// --- Prøve F, innlogging som har gått ut (docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 2) ---

/**
 * Skriver inn e-post og kode på innloggingssiden som allerede er åpen (f.eks. med `?neste=`).
 * Sjekker ikke hvor siden sender etterpå; det gjør testen selv med `toHaveURL`.
 */
export async function signInWithCode(page: Page, email: string) {
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
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
}

/** Better Auth kaller kapselen `better-auth.session_token` (med `__Secure-` foran over https). */
function isSessionCookie(name: string): boolean {
  return name.endsWith("session_token");
}

/** Kobler til databasen appen i e2e bruker, etter vakten (bare lokal database eller testdatabasen). */
function e2eSql() {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  return postgres(databaseUrl, { max: 1, onnotice: () => {} });
}

/**
 * Lar innloggingen i denne nettleserkonteksten gå ut, slik den gjør etter 30 dager: setter
 * `expires_at` til passert tid på nøyaktig den økten kapselen peker på. Kapselen blir liggende i
 * nettleseren, men serveren har ingen gyldig økt.
 *
 * - Tokenet er delen før første punktum i kapselen («token.signatur», URL-kodet).
 * - Bare lokal database eller testdatabasen (`assertLocalOrTestDatabase`).
 * - Aldri en admin-økt (andre tester kjører som admin): finnes ingen slik økt som ikke tilhører
 *   admin, kastes en feil og ingenting endres.
 */
export async function expireOwnSession(context: BrowserContext): Promise<void> {
  const cookie = (await context.cookies()).find((entry) => isSessionCookie(entry.name));
  if (!cookie) throw new Error("Fant ingen innloggingskapsel i nettleseren");
  const token = decodeURIComponent(cookie.value).split(".")[0];
  if (!token) throw new Error("Innloggingskapselen har ikke formen token.signatur");
  const sql = e2eSql();
  try {
    const updated = await sql<{ id: string }[]>`
      update sessions s set expires_at = now() - interval '1 minute'
      from users u
      where s.token = ${token}
        and u.id = s.user_id
        and u.email <> ${ADMIN_EMAIL}
        and not exists (
          select 1 from employees e
          join employee_roles r on r.employee_id = e.id
          where e.user_id = s.user_id and r.role = 'admin' and r.deleted_at is null
        )
      returning s.id`;
    if (updated.length !== 1) {
      throw new Error("Fant ikke egen økt, eller økten tilhører admin. Ingenting er endret.");
    }
  } finally {
    await sql.end();
  }
}

/** Organisasjonen til en oppdiktet testbruker, fra den aktive ansatt-raden. */
export async function organizationIdOf(email: string): Promise<string> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e
      join users u on u.id = e.user_id
      where u.email = ${email} and e.deleted_at is null and e.deactivated_at is null
      limit 1`;
    if (!row) throw new Error("Fant ikke den ansatte for testbrukeren");
    return row.organization_id;
  } finally {
    await sql.end();
  }
}

export interface ServerTrialAnswer {
  fieldKey: string;
  value: unknown;
  organizationId: string;
}

export interface ServerTrialPhoto {
  id: string;
  fieldKey: string;
  organizationId: string;
  uploaded: boolean;
}

/** Det serveren har for ett testskjema (rader som ikke er slettet): svar og bilder. */
export async function serverTrialData(
  formId: string,
): Promise<{ answers: ServerTrialAnswer[]; photos: ServerTrialPhoto[] }> {
  const sql = e2eSql();
  try {
    const answers = await sql<{ field_key: string; value: unknown; organization_id: string }[]>`
      select field_key, value, organization_id from trial_answers
      where trial_form_id = ${formId} and deleted_at is null
      order by field_key`;
    const photos = await sql<
      { id: string; field_key: string; organization_id: string; uploaded_at: Date | null }[]
    >`
      select id, field_key, organization_id, uploaded_at from trial_photos
      where trial_form_id = ${formId} and deleted_at is null
      order by id`;
    return {
      answers: answers.map((row) => ({
        fieldKey: row.field_key,
        value: row.value,
        organizationId: row.organization_id,
      })),
      photos: photos.map((row) => ({
        id: row.id,
        fieldKey: row.field_key,
        organizationId: row.organization_id,
        uploaded: row.uploaded_at !== null,
      })),
    };
  } finally {
    await sql.end();
  }
}

/** Køen på enheten: endringer og bilder som venter (`store.status()` fra testkroken). */
export async function pendingQueue(page: Page): Promise<{ changes: number; photos: number }> {
  await waitForTrialHook(page);
  return page.evaluate(async () => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    const status = await hook.store.status();
    return { changes: status.pendingChanges, photos: status.pendingPhotos };
  });
}
