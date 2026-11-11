import { createHash, randomUUID } from "node:crypto";
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
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
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

/** Venter til testkroken og lageret er klare på siden. */
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

/** Leser en verdi fra testkroken (`deviceId` eller `organizationId`). */
export async function hookValue(page: Page, key: "deviceId" | "organizationId"): Promise<string> {
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
 * Antall **originaler** som ligger i køen i IndexedDB (`offline-trial-photos`, lageret `photos`).
 * Visningskopiene (nøkler som slutter på `:display`, prøve D) telles ikke; de telles med
 * `localDisplayCopyCount`. 0 hvis databasen ikke finnes.
 */
export async function localPhotoFileCount(page: Page): Promise<number> {
  const keys = await localPhotoKeys(page, "photos");
  return keys.filter((key) => !key.endsWith(DISPLAY_COPY_SUFFIX)).length;
}

/**
 * Slutten på nøkkelen til en visningskopi i lageret `photos` (`displayCopyKey` i
 * `sync/photo-store.ts`). Skrevet her, ikke importert, fordi e2e ikke laster modulen.
 */
export const DISPLAY_COPY_SUFFIX = ":display";

/** Alle nøkler i et lager i `offline-trial-photos`. Åpner ikke en database som ikke finnes. */
async function localPhotoKeys(page: Page, storeName: "photos" | "confirmed"): Promise<string[]> {
  return page.evaluate(async (name) => {
    // Åpner ikke en database som ikke finnes (det ville laget den tom og forstyrret appen)
    const databases = await indexedDB.databases();
    if (!databases.some((info) => info.name === "offline-trial-photos")) return [];
    return new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open("offline-trial-photos");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(name)) {
          database.close();
          resolve([]);
          return;
        }
        const tx = database.transaction([name], "readonly");
        const reading = tx.objectStore(name).getAllKeys();
        tx.oncomplete = () => {
          database.close();
          resolve(reading.result.map(String));
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, storeName);
}

// --- Prøve D, bilder (docs/funksjoner/fase1-prove-d-bilder-testplan.md avsnitt 5.1) ---

/** Antall visningskopier (nøkler i `photos` som slutter på `:display`). 0 hvis databasen ikke finnes. */
export async function localDisplayCopyCount(page: Page): Promise<number> {
  const keys = await localPhotoKeys(page, "photos");
  return keys.filter((key) => key.endsWith(DISPLAY_COPY_SUFFIX)).length;
}

/** Alle nøkler i lageret `confirmed` (bilder serveren har bekreftet fra denne enheten). */
export async function localConfirmedKeys(page: Page): Promise<string[]> {
  return localPhotoKeys(page, "confirmed");
}

/** Mappen e2e-appen lagrer bilder i (`TRIAL_UPLOAD_DIR` i `playwright.config.ts`). */
export const E2E_TRIAL_UPLOAD_DIR = "var/uploads/trial";

/** Sti på disk til originalen eller visningskopien (`<id>.display.jpg`). */
export function trialUploadPath(organizationId: string, photoId: string, display = false): string {
  return path.resolve(
    E2E_TRIAL_UPLOAD_DIR,
    organizationId,
    display ? `${photoId}.display.jpg` : photoId,
  );
}

/** SHA-256 som heks av bytene. */
export function sha256Bytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 som heks av filen på disk. */
export function sha256File(file: string): string {
  return sha256Bytes(readFileSync(file));
}

/**
 * JPEG-merkene fram til bildedataene (`FF DA`, tatt med), for eksempel `[0xd8, 0xe0, 0xdb, …,
 * 0xda]`. Egen, liten gjennomgang, uavhengig av `hasMetadataSegment` i produktkoden, så testen
 * ikke sjekker koden med seg selv. Kaster ved ødelagt fil.
 */
export function jpegMarkers(bytes: Uint8Array | Buffer): number[] {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Ikke en JPEG (mangler FF D8)");
  }
  const markers = [0xd8];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(`Ventet FF ved byte ${i}`);
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) throw new Error("Fil slutter i fyllbytes");
    const marker = bytes[i]!;
    i++;
    markers.push(marker);
    if (marker === 0xda) return markers;
    if (marker === 0xd9) throw new Error("FF D9 før bildedataene");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > bytes.length) throw new Error("Avkuttet lengdefelt");
    const length = (bytes[i]! << 8) | bytes[i + 1]!;
    if (length < 2 || i + length > bytes.length) throw new Error("Ugyldig lengde");
    i += length;
  }
  throw new Error("Fant ikke FF DA");
}

export interface DecodedImage {
  width: number;
  height: number;
  /** `[r, g, b, a]` for hvert punkt testen ba om, i samme rekkefølge. */
  pixels: [number, number, number, number][];
}

/**
 * Henter bildet i siden (`fetch` med innloggingen), dekoder det med `createImageBitmap` og tegner
 * det på `OffscreenCanvas`. Gir mål og fargen i punktene testen ber om.
 */
export async function decodeInPage(
  page: Page,
  url: string,
  points: ReadonlyArray<readonly [number, number]> = [],
): Promise<DecodedImage> {
  return page.evaluate(
    async ({ address, wanted }) => {
      const response = await fetch(address, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Svar ${response.status} fra ${address}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Ingen 2d-kontekst");
      context.drawImage(bitmap, 0, 0);
      const pixels = wanted.map(([x, y]) => {
        const data = context.getImageData(x, y, 1, 1).data;
        return [data[0]!, data[1]!, data[2]!, data[3]!] as [number, number, number, number];
      });
      return { width: bitmap.width, height: bitmap.height, pixels };
    },
    { address: url, wanted: points.map(([x, y]) => [x, y] as [number, number]) },
  );
}

/** Lenken «Vis fra serveren» i raden for filnavnet i bildefeltet. */
export function viewFromServerLink(page: Page, fileName: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ hasText: fileName })
    .getByRole("link", { name: "Vis fra serveren" });
}

// --- Testkroken for lageret (egenbygd synk, ADR 0004) ---

export type TrialTable = "trial_forms" | "trial_answers" | "trial_photos";
/** Lageret har i tillegg hentemarkøren (`sync_state`) og endringskøen (`outbox`) som egne lagre. */
export type HookTable = TrialTable | "sync_state" | "outbox";
export type LocalRow = Record<string, unknown>;

/** Testkroken `window.__offlineTrial` (`sync/test-hooks.ts`, bare med NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1). */
export interface TrialHook {
  store: {
    status(): Promise<{ online: boolean; pendingChanges: number; pendingPhotos: number }>;
  };
  deviceId: string;
  organizationId: string;
  applySyncedRows(table: TrialTable, rows: LocalRow[]): Promise<void>;
  readRows(table: HookTable, formId?: string): Promise<LocalRow[]>;
  simulateOrganizationChange(organizationId: string): Promise<void> | void;
  createTextState(text: string): string;
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
      const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
      return hook.readRows(name, id ?? undefined);
    },
    [table, formId ?? null] as const,
  );
}

/**
 * Legger rader inn som om synk leverte dem fra serveren (`hook.applySyncedRows`, samme vei som en
 * henting). Rader i snake_case; `trial_answers` upsertes på `(trial_form_id, field_key)`.
 */
export async function applySyncedRowsViaHook(page: Page, table: TrialTable, rows: LocalRow[]) {
  await waitForTrialHook(page);
  await page.evaluate(
    async ([name, list]) => {
      const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
      await hook.applySyncedRows(name, list);
    },
    [table, rows] as const,
  );
}

/** Antall endringer som venter på serverens bekreftelse (`store.status().pendingChanges`). */
export async function pendingChanges(page: Page): Promise<number> {
  await waitForTrialHook(page);
  return page.evaluate(async () => {
    const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
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
 * `/api/prove/synk/hent`), med status når svaret er kommet. Registreres før `goto`.
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
 * `deviceId`), innlogget som admin. Kontekstvalgene (baseURL, skjermstørrelse)
 * sendes inn fra testen, fordi `browser.newContext` ikke arver prosjektets `use`.
 */
export async function openSecondDevice(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO", ...options });
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
 * Legger «Lagret kl.» i `localStorage` før første lasting, som om enheten hadde
 * lagret alt da. Skrives bare én gang per fane (merket i `sessionStorage`), så en omlasting ikke
 * legger tidspunktet tilbake etter at appen har endret eller tømt det.
 */
export async function setSavedAt(context: BrowserContext, iso: string) {
  await context.addInitScript(
    ({ key, value }) => {
      const marker = `e2e_set_${key}`;
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(key, value);
    },
    { key: "trial_saved_at", value: iso },
  );
}

/** Skriveruten for endringskøen. */
export const CHANGES_PATH = "/api/prove/synk/endringer";

/** Oppdiktet takstmann for e2e. Ingen ekte navn eller adresser. */
export const INSPECTOR_EMAIL = "takstmann.e2e@eksempel.no";

/** Selskapet fra seed som e2e-takstmannen hører til (utstedende selskap på oppdraget). */
export const INSPECTOR_COMPANY = "Byggcon Nord AS";

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

/** Oppdiktet leder for e2e (rollen `manager`). Ingen ekte navn eller adresser. */
export const MANAGER_EMAIL = "leder@example.com";

/** En oppdiktet ansatt for e2e: e-post, navn og rollen som skal finnes. */
type E2eEmployee = {
  email: string;
  name: string;
  role: "inspector" | "manager" | "office";
  /** Rollen på norsk i feilmeldingene («takstmann», «leder», «kontor»). */
  roleLabel: string;
  /** Navnet på konstanten i feilmeldingene, slik at det er lett å finne ut hva som må gjøres. */
  label: string;
};

/**
 * Sørger for at den oppdiktede ansatte finnes med rollen i samme organisasjon som admin fra seed
 * (Byggcon). Idempotent.
 *
 * - Skriver bare til lokal database eller testdatabasen (`assertLocalOrTestDatabase`), og
 *   sjekker det før den kobler til.
 * - Bruker aldri slettede eller deaktiverte rader (admin, ansatt eller rolle). Finnes den ansatte
 *   eller rollen bare som slettet/deaktivert, kastes en feil som sier hva som må gjøres.
 * - Gjenoppretter, sletter eller endrer ingenting.
 */
async function ensureEmployee({ email, name, role, roleLabel, label }: E2eEmployee): Promise<void> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [admin] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e
      join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and e.deleted_at is null and e.deactivated_at is null
      limit 1`;
    if (!admin) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    const organizationId = admin.organization_id;
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${name}, ${email}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
    if (!user) throw new Error(`Kunne ikke lage brukeren for e2e (${label})`);
    const found = await sql<{ id: string; deleted_at: Date | null; deactivated_at: Date | null }[]>`
      select id, deleted_at, deactivated_at from employees
      where user_id = ${user.id} and organization_id = ${organizationId}`;
    let employee: { id: string } | undefined = found.find(
      (row) => row.deleted_at === null && row.deactivated_at === null,
    );
    if (!employee && found.length > 0) {
      throw new Error(
        `Den ansatte for e2e (${label}) er slettet eller deaktivert i testdatabasen. ` +
          "Tøm databasen eller kjør pnpm db:seed på nytt.",
      );
    }
    if (!employee) {
      [employee] = await sql<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organizationId}, ${user.id}, ${name})
        returning id`;
    }
    if (!employee) throw new Error(`Kunne ikke lage den ansatte for e2e (${label})`);
    // Utstedende selskap: den ansatte får «Byggcon Nord AS» fra seed, bare hvis selskap mangler.
    await sql`
      update employees set company_id = (
        select c.id from companies c
        where c.organization_id = ${organizationId} and c.legal_name = ${INSPECTOR_COMPANY}
          and c.deleted_at is null
        order by c.created_at limit 1)
      where id = ${employee.id} and organization_id = ${organizationId} and company_id is null`;
    const roles = await sql<{ deleted_at: Date | null }[]>`
      select deleted_at from employee_roles
      where employee_id = ${employee.id} and role = ${role}::employee_role`;
    if (roles.some((row) => row.deleted_at === null)) return;
    if (roles.length > 0) {
      throw new Error(
        `Rollen ${roleLabel} for den ansatte for e2e (${label}) er slettet i testdatabasen. ` +
          "Tøm databasen eller kjør pnpm db:seed på nytt.",
      );
    }
    await sql`
      insert into employee_roles (organization_id, employee_id, role)
      values (${organizationId}, ${employee.id}, ${role}::employee_role)
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

/** Sørger for at den oppdiktede takstmannen finnes med rollen `inspector` (se `ensureEmployee`). */
export async function ensureInspector(): Promise<void> {
  await ensureEmployee({
    email: INSPECTOR_EMAIL,
    name: "Oppdiktet takstmann",
    role: "inspector",
    roleLabel: "takstmann",
    label: "INSPECTOR_EMAIL",
  });
}

/** Logger inn som den oppdiktede takstmannen (rolle `inspector`, ikke admin). */
export async function logInAsInspector(page: Page) {
  await ensureInspector();
  await logIn(page, INSPECTOR_EMAIL);
}

/**
 * Sørger for at den oppdiktede lederen finnes med rollen `manager` og ingen andre roller fra
 * denne hjelperen (se `ensureEmployee`). Brukes der leder skal gjøre noe admin også kan, slik at
 * testen viser at rettigheten gjelder leder og ikke bare admin.
 */
export async function ensureManager(): Promise<void> {
  await ensureEmployee({
    email: MANAGER_EMAIL,
    name: "Oppdiktet leder",
    role: "manager",
    roleLabel: "leder",
    label: "MANAGER_EMAIL",
  });
}

/** Logger inn som den oppdiktede lederen (rolle `manager`, ikke admin). */
export async function logInAsManager(page: Page) {
  await ensureManager();
  await logIn(page, MANAGER_EMAIL);
}

/** Oppdiktet kontoransatt for e2e (rollen `office`). Ingen ekte navn eller adresser. */
export const OFFICE_EMAIL = "kontor@example.com";

/** Logger inn som den oppdiktede kontoransatte (rolle `office`, ikke admin). */
export async function logInAsOffice(page: Page) {
  await ensureEmployee({
    email: OFFICE_EMAIL,
    name: "Oppdiktet kontoransatt",
    role: "office",
    roleLabel: "kontor",
    label: "OFFICE_EMAIL",
  });
  await logIn(page, OFFICE_EMAIL);
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

export interface ServerTrialAnswer {
  fieldKey: string;
  value: unknown;
  organizationId: string;
}

export interface ServerTrialPhoto {
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
      { field_key: string; organization_id: string; uploaded_at: Date | null }[]
    >`
      select field_key, organization_id, uploaded_at from trial_photos
      where trial_form_id = ${formId} and deleted_at is null
      order by id`;
    return {
      answers: answers.map((row) => ({
        fieldKey: row.field_key,
        value: row.value,
        organizationId: row.organization_id,
      })),
      photos: photos.map((row) => ({
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
    const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
    const status = await hook.store.status();
    return { changes: status.pendingChanges, photos: status.pendingPhotos };
  });
}

// --- Admin: selskaper, kontorer og ansatte (docs/funksjoner/fase0b-admin-organisasjon-testplan.md avsnitt 8) ---

/**
 * Unik ending per kjøring (e2e-databasen tømmes ikke, og navn, org.nr. og e-post er unike blant
 * aktive rader): tid i base 36 og et tilfeldig tall.
 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Oppdiktet org.nr. som ikke finnes: 9 siffer som starter med 000. */
export function fakeOrgNumber(): string {
  return `000${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
}

/** Vektene for kontrollsifferet i organisasjonsnummeret (modulus 11). */
const ORG_NUMBER_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Oppdiktet org.nr. som er gyldig etter modulus 11 og ikke finnes: «0», sju tilfeldige sifre og
 * kontrollsifferet. Blir kontrollsifferet 10, trekkes nye sifre. E2e-databasen tømmes ikke mellom
 * kjøringene, så tallrommet må være stort for at nye firmaer ikke skal treffe et nummer som finnes.
 */
export function fakeValidOrgNumber(): string {
  for (;;) {
    const base = `0${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const sum = ORG_NUMBER_WEIGHTS.reduce(
      (total, weight, index) => total + weight * Number(base[index]),
      0,
    );
    const rest = sum % 11;
    const check = rest === 0 ? 0 : 11 - rest;
    if (check !== 10) return `${base}${check}`;
  }
}

/**
 * Id og navn til en ansatt (ikke slettet) med e-posten, i samme organisasjon som admin fra seed.
 * Bare lesing, bare lokal database eller testdatabasen.
 */
export async function employeeByEmail(email: string): Promise<{ id: string; name: string }> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; name: string }[]>`
      select e.id, e.name from employees e
      join users u on u.id = e.user_id
      where u.email = ${email} and e.deleted_at is null
        and e.organization_id = (
          select a.organization_id from employees a join users au on au.id = a.user_id
          where au.email = ${ADMIN_EMAIL} and a.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and a.deleted_at is null limit 1)
      limit 1`;
    if (!row) throw new Error("Fant ikke den ansatte (kjør pnpm db:seed)");
    return row;
  } finally {
    await sql.end();
  }
}

/** Org.nr. til alle selskapene i organisasjonen til admin fra seed. Bare lesing. */
export async function companyOrgNumbers(): Promise<string[]> {
  const sql = e2eSql();
  try {
    const rows = await sql<{ org_number: string }[]>`
      select c.org_number from companies c
      where c.org_number is not null
        and c.organization_id = (
          select a.organization_id from employees a join users au on au.id = a.user_id
          where au.email = ${ADMIN_EMAIL} and a.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and a.deleted_at is null limit 1)`;
    return rows.map((row) => row.org_number);
  } finally {
    await sql.end();
  }
}

/**
 * Setter innstillingen `access.inspectors_edit_all` i organisasjonen til admin fra seed, og gir
 * tilbake verdien som sto der før (`undefined` når den ikke var satt). Sett den tilbake med
 * `restoreInspectorsEditAll` i `finally`. Playwright kjører med én arbeider, så ingen annen test
 * ser endringen. Bare lokal database eller testdatabasen.
 */
export async function setInspectorsEditAll(value: boolean): Promise<boolean | undefined> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; previous: boolean | null }[]>`
      select o.id, (o.settings ->> 'access.inspectors_edit_all')::boolean as previous
      from organizations o
      where o.id = (
        select a.organization_id from employees a join users au on au.id = a.user_id
        where au.email = ${ADMIN_EMAIL} and a.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and a.deleted_at is null limit 1)`;
    if (!row) throw new Error("Fant ikke organisasjonen til admin fra seed (kjør pnpm db:seed)");
    await sql`
      update organizations
      set settings = settings || jsonb_build_object('access.inspectors_edit_all', ${value}::boolean)
      where id = ${row.id}`;
    return row.previous ?? undefined;
  } finally {
    await sql.end();
  }
}

/** Setter innstillingen tilbake til verdien fra `setInspectorsEditAll` (fjerner den når den manglet). */
export async function restoreInspectorsEditAll(previous: boolean | undefined): Promise<void> {
  if (previous !== undefined) {
    await setInspectorsEditAll(previous);
    return;
  }
  const sql = e2eSql();
  try {
    await sql`
      update organizations
      set settings = settings - 'access.inspectors_edit_all'
      where id = (
        select a.organization_id from employees a join users au on au.id = a.user_id
        where au.email = ${ADMIN_EMAIL} and a.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and a.deleted_at is null limit 1)`;
  } finally {
    await sql.end();
  }
}

/**
 * Antall hendelser av typen på oppdraget (statusflyten, docs/funksjoner/fase2a-statusflyt-testplan.md
 * 5.6). Bare lesing, bare lokal database eller testdatabasen.
 */
export async function assignmentEventCount(assignmentId: string, type: string): Promise<number> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from events
      where assignment_id = ${assignmentId} and type = ${type}`;
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
}

// --- Avtale med oppdragsgiver (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 9) ---

/** Organisasjonen til admin fra seed. */
async function seedOrganizationId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ organization_id: string }[]>`
    select a.organization_id from employees a join users au on au.id = a.user_id
    where au.email = ${ADMIN_EMAIL} and a.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and a.deleted_at is null and a.deactivated_at is null
    limit 1`;
  if (!row) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
  return row.organization_id;
}

/**
 * Oppdiktet firma (type forsikringsselskap, gyldig org.nr. som ikke finnes) i organisasjonen til
 * admin fra seed, og en kontakt i firmaet når `contactLastName` er gitt. Kontakten kan velges som
 * bestiller på en ny ordre. Bare lokal database eller testdatabasen.
 */
export async function createFirmWithContact(input: {
  firmName: string;
  contactLastName?: string;
}): Promise<{ firmId: string; contactId: string | null }> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [firm] = await sql<{ id: string }[]>`
      insert into firms (organization_id, name, org_number, firm_type)
      values (${organizationId}, ${input.firmName}, ${fakeValidOrgNumber()}, 'insurer')
      returning id`;
    if (!firm) throw new Error("Kunne ikke lage firmaet for e2e");
    if (!input.contactLastName) return { firmId: firm.id, contactId: null };
    const [contact] = await sql<{ id: string }[]>`
      insert into contacts (organization_id, first_name, last_name, email, phone, firm_id)
      values (${organizationId}, 'Bestiller', ${input.contactLastName},
        ${`bestiller.${input.contactLastName.toLowerCase()}@example.com`}, '00000000', ${firm.id})
      returning id`;
    if (!contact) throw new Error("Kunne ikke lage kontakten for e2e");
    return { firmId: firm.id, contactId: contact.id };
  } finally {
    await sql.end();
  }
}

/**
 * Myk sletting av firmaene testen laget, slik at firmavelgeren i /admin/avtaler/ny ikke fylles opp
 * av gamle testfirma (e2e-databasen tømmes ikke). Bare lokal database eller testdatabasen.
 */
export async function softDeleteFirms(firmIds: readonly string[]): Promise<void> {
  if (firmIds.length === 0) return;
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    await sql`
      update firms set deleted_at = now()
      where organization_id = ${organizationId} and id in ${sql(firmIds)} and deleted_at is null`;
  } finally {
    await sql.end();
  }
}

/**
 * Oppdiktet avtale for firmaet, lagt rett i databasen (uten premissetekst). Datoene er
 * `YYYY-MM-DD`. Returnerer id-en. Bare lokal database eller testdatabasen.
 */
export async function createClientAgreementRow(input: {
  firmId: string;
  name: string;
  validFrom: string;
  validTo?: string | null;
}): Promise<string> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [row] = await sql<{ id: string }[]>`
      insert into client_agreements (organization_id, firm_id, name, valid_from, valid_to,
        report_profile_code)
      values (${organizationId}, ${input.firmId}, ${input.name}, ${input.validFrom},
        ${input.validTo ?? null}, 'test-profil')
      returning id`;
    if (!row) throw new Error("Kunne ikke lage avtalen for e2e");
    return row.id;
  } finally {
    await sql.end();
  }
}

/** Avtalene med navnet i organisasjonen til admin fra seed (også slettede). Bare lesing. */
export async function clientAgreementsByName(
  name: string,
): Promise<{ id: string; deletedAt: Date | null; premiseText: string | null }[]> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    return await sql<{ id: string; deletedAt: Date | null; premiseText: string | null }[]>`
      select id, deleted_at as "deletedAt", premise_text as "premiseText"
      from client_agreements
      where organization_id = ${organizationId} and name = ${name}`;
  } finally {
    await sql.end();
  }
}

/** Avtalen som står på oppdraget (`client_agreement_id`), eller `null`. Bare lesing. */
export async function assignmentAgreementId(assignmentId: string): Promise<string | null> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ client_agreement_id: string | null }[]>`
      select client_agreement_id from assignments where id = ${assignmentId}`;
    return row?.client_agreement_id ?? null;
  } finally {
    await sql.end();
  }
}

// --- Reklamasjoner (docs/funksjoner/fase2a-reklamasjoner-testplan.md avsnitt 5) ---------------

/**
 * Et oppdrag (med ordre) i organisasjonen til admin fra seed, med én part: kjøper
 * «Kjøper Test <suffix>». Nummeret og adressen har endingen i seg. Oppdiktede data. Bare lokal
 * database eller testdatabasen.
 */
export async function createAssignmentWithParty(
  suffix: string,
): Promise<{ assignmentId: string; partyId: string; partyName: string }> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [office] = await sql<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error("Fant ikke et kontor fra seed (kjør pnpm db:seed)");
    const orderId = randomUUID();
    const assignmentId = randomUUID();
    const partyId = randomUUID();
    const partyName = `Kjøper Test ${suffix}`;
    await sql`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type)
      values (${orderId}, ${organizationId}, ${`Reklamasjonsveien 1 ${suffix}, 8000 Bodø`}, now(),
        'manual', 'received', 'condition_report')`;
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id)
      values (${assignmentId}, ${organizationId}, ${`E2E-REK-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${orderId})`;
    await sql`
      insert into assignment_parties (id, organization_id, assignment_id, role, name)
      values (${partyId}, ${organizationId}, ${assignmentId}, 'buyer', ${partyName})`;
    return { assignmentId, partyId, partyName };
  } finally {
    await sql.end();
  }
}

/**
 * En reklamasjonssak satt inn direkte på oppdraget (uten tilgangssjekk). Standard: reklamasjon
 * mottatt 2026-11-02, klager «Kjøper Test», beskrivelsen «Fukt i kjeller ikke nevnt», åpen.
 */
export async function insertClaimRow(
  assignmentId: string,
  overrides: { description?: string; outcome?: string; amount?: number | null } = {},
): Promise<string> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into claims (organization_id, assignment_id, claim_type, received_at, claimant_text,
        description, outcome, amount, closed_at, created_by)
      select a.organization_id, a.id, 'complaint', '2026-11-02', 'Kjøper Test',
        ${overrides.description ?? "Fukt i kjeller ikke nevnt"}, ${overrides.outcome ?? "open"},
        ${overrides.amount ?? null},
        ${(overrides.outcome ?? "open") === "open" ? null : new Date()}, gen_random_uuid()
      from assignments a where a.id = ${assignmentId}
      returning id`;
    if (!row) throw new Error("Kunne ikke lage reklamasjonssaken for e2e");
    return row.id;
  } finally {
    await sql.end();
  }
}

/** Sakene på oppdraget (også fjernede), eldste først. Bare lesing. */
export async function claimRowsFor(assignmentId: string): Promise<
  {
    id: string;
    outcome: string;
    amount: number | null;
    claimantPartyId: string | null;
    claimantText: string | null;
    description: string;
    deletedAt: Date | null;
  }[]
> {
  const sql = e2eSql();
  try {
    const rows = await sql<
      {
        id: string;
        outcome: string;
        amount: number | null;
        claimantPartyId: string | null;
        claimantText: string | null;
        description: string;
        deletedAt: Date | null;
      }[]
    >`
      select id, outcome, amount, claimant_party_id as "claimantPartyId",
        claimant_text as "claimantText", description, deleted_at as "deletedAt"
      from claims where assignment_id = ${assignmentId}
      order by created_at`;
    return rows.map((row) => ({ ...row, amount: row.amount === null ? null : Number(row.amount) }));
  } finally {
    await sql.end();
  }
}

// --- Forslagsmønsteret, /prove/ki (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 12) ---

/** Oppdiktet organisasjon uten KI slått på (verken `ai.enabled` eller tilkobling). */
export const NO_AI_ORGANIZATION_NAME = "Oppdiktet takst uten KI (e2e)";

/** Oppdiktet takstmann i organisasjonen uten KI. */
export const NO_AI_INSPECTOR_EMAIL = "uten.ki.e2e@example.invalid";

const NO_AI_INSPECTOR_NAME = "Oppdiktet takstmann uten KI";

/**
 * Sørger for at organisasjonen uten KI finnes med én takstmann. Idempotent. Bare lokal database
 * eller testdatabasen. Rører ikke andre organisasjoner, og slår aldri KI på.
 */
export async function ensureNoAiInspector(): Promise<void> {
  const sql = e2eSql();
  try {
    let [organization] = await sql<{ id: string }[]>`
      select id from organizations where name = ${NO_AI_ORGANIZATION_NAME} and deleted_at is null
      order by created_at limit 1`;
    if (!organization) {
      [organization] = await sql<{ id: string }[]>`
        insert into organizations (name, brand_name)
        values (${NO_AI_ORGANIZATION_NAME}, ${NO_AI_ORGANIZATION_NAME})
        returning id`;
    }
    if (!organization) throw new Error("Kunne ikke lage organisasjonen uten KI for e2e");
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${NO_AI_INSPECTOR_NAME}, ${NO_AI_INSPECTOR_EMAIL}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<{ id: string }[]>`
      select id from users where email = ${NO_AI_INSPECTOR_EMAIL}`;
    if (!user) throw new Error("Kunne ikke lage brukeren uten KI for e2e");
    let [employee] = await sql<{ id: string }[]>`
      select id from employees
      where user_id = ${user.id} and organization_id = ${organization.id}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) {
      [employee] = await sql<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organization.id}, ${user.id}, ${NO_AI_INSPECTOR_NAME})
        returning id`;
    }
    if (!employee) throw new Error("Kunne ikke lage den ansatte uten KI for e2e");
    const roles = await sql<{ id: string }[]>`
      select id from employee_roles
      where employee_id = ${employee.id} and role = 'inspector'::employee_role
        and deleted_at is null`;
    if (roles.length === 0) {
      await sql`
        insert into employee_roles (organization_id, employee_id, role)
        values (${organization.id}, ${employee.id}, 'inspector'::employee_role)
        on conflict do nothing`;
    }
  } finally {
    await sql.end();
  }
}

/** Logger inn som takstmannen i organisasjonen uten KI. */
export async function logInAsNoAiInspector(page: Page) {
  await ensureNoAiInspector();
  await logIn(page, NO_AI_INSPECTOR_EMAIL);
}

/** Logger inn som prøvetakstmannen (prøveorganisasjonen, KI på med `fake`, `db:seed:testoppdrag`). */
export async function logInAsSampleInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

export type E2eAiUsageRow = {
  id: string;
  status: string | null;
  outcome: string;
  decidedBy: string | null;
  targetRef: { type: string; id: string; fieldKey: string };
};

/** Radene i KI-loggen der forslaget inneholder markøren, eldste først. Bare lesing. */
export async function aiUsageRowsWithMarker(marker: string): Promise<E2eAiUsageRow[]> {
  const sql = e2eSql();
  try {
    return await sql<E2eAiUsageRow[]>`
      select id, status, outcome, decided_by as "decidedBy", target_ref as "targetRef"
      from ai_usage_log where output_text like ${`%${marker}%`}
      order by created_at, id`;
  } finally {
    await sql.end();
  }
}

/**
 * Antall vaskede treff (`redacted_count`) og utfallet for radene der forslaget inneholder
 * markøren (vask før KI, V9.1). Bare lesing; aldri verdiene.
 */
export async function aiRedactedCountsWithMarker(
  marker: string,
): Promise<{ outcome: string; redactedCount: number }[]> {
  const sql = e2eSql();
  try {
    return await sql<{ outcome: string; redactedCount: number }[]>`
      select outcome, redacted_count as "redactedCount"
      from ai_usage_log where output_text like ${`%${marker}%`}
      order by created_at, id`;
  } finally {
    await sql.end();
  }
}

/** Radene i KI-loggen for målet (`target_ref.id`), eldste først. Bare lesing. */
export async function aiUsageRowsForTarget(targetId: string): Promise<E2eAiUsageRow[]> {
  const sql = e2eSql();
  try {
    return await sql<E2eAiUsageRow[]>`
      select id, status, outcome, decided_by as "decidedBy", target_ref as "targetRef"
      from ai_usage_log where target_ref ->> 'id' = ${targetId}
      order by created_at, id`;
  } finally {
    await sql.end();
  }
}

/** Linjene i `audit_log` for en rad i KI-loggen. Bare lesing. */
export async function auditLinesFor(entityId: string): Promise<{ changes: unknown }[]> {
  const sql = e2eSql();
  try {
    return await sql<{ changes: unknown }[]>`
      select changes from audit_log where entity_id = ${entityId} order by occurred_at, id`;
  } finally {
    await sql.end();
  }
}

// --- KI-kø uten nett (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 8) ---

/** Databasen og lageret for KI-køen. Skrevet her, ikke importert, fordi e2e ikke laster modulen. */
export const AI_QUEUE_DB = "local-ai-queue";
export const AI_QUEUE_STORE = "ai_queue";

/**
 * Alle poster i KI-køen på enheten, rått fra IndexedDB. Åpner ikke en database som ikke finnes
 * (det ville laget den tom og forstyrret appen), og lukker tilkoblingen med en gang.
 */
export async function aiQueueEntries(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    async ([dbName, storeName]) => {
      const databases = await indexedDB.databases();
      if (!databases.some((info) => info.name === dbName)) return [];
      return new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open(dbName!);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName!)) {
            database.close();
            resolve([]);
            return;
          }
          const tx = database.transaction([storeName!], "readonly");
          const reading = tx.objectStore(storeName!).getAll();
          tx.oncomplete = () => {
            database.close();
            resolve(reading.result as Record<string, unknown>[]);
          };
          tx.onerror = () => {
            database.close();
            reject(tx.error);
          };
        };
      });
    },
    [AI_QUEUE_DB, AI_QUEUE_STORE] as const,
  );
}

/** Oppdiktet takstmann nr. 2 i prøveorganisasjonen (KI på), for delt iPad. */
export const SAMPLE_SECOND_INSPECTOR_EMAIL = "ki-ko-takstmann.e2e@example.com";
/** Oppdiktet admin i prøveorganisasjonen med bare rollen admin. */
export const SAMPLE_ADMIN_ONLY_EMAIL = "ki-ko-admin.e2e@example.com";

/** Id-en til prøveorganisasjonen (`settings.sampleData = true`, `pnpm db:seed:testoppdrag`). */
async function sampleOrganizationId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from organizations
    where settings ->> 'sampleData' = 'true' and deleted_at is null
    order by created_at limit 1`;
  if (!row) throw new Error("Fant ikke prøveorganisasjonen (kjør pnpm db:seed:testoppdrag)");
  return row.id;
}

/**
 * Sørger for at en oppdiktet ansatt finnes i prøveorganisasjonen med nøyaktig én aktiv rolle.
 * Idempotent. Bare lokal database eller testdatabasen. Sletter og gjenoppretter ingenting.
 */
export async function ensureSampleOrgEmployee(input: {
  email: string;
  name: string;
  role: "inspector" | "admin";
}): Promise<void> {
  const sql = e2eSql();
  try {
    const organizationId = await sampleOrganizationId(sql);
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${input.name}, ${input.email}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${input.email}`;
    if (!user) throw new Error("Kunne ikke lage brukeren for e2e (KI-kø)");
    let [employee] = await sql<{ id: string }[]>`
      select id from employees
      where user_id = ${user.id} and organization_id = ${organizationId}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) {
      [employee] = await sql<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organizationId}, ${user.id}, ${input.name})
        returning id`;
    }
    if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e (KI-kø)");
    const roles = await sql<{ id: string }[]>`
      select id from employee_roles
      where employee_id = ${employee.id} and role = ${input.role}::employee_role
        and deleted_at is null`;
    if (roles.length === 0) {
      await sql`
        insert into employee_roles (organization_id, employee_id, role)
        values (${organizationId}, ${employee.id}, ${input.role}::employee_role)
        on conflict do nothing`;
    }
  } finally {
    await sql.end();
  }
}

/** Logger inn som takstmann nr. 2 i prøveorganisasjonen. */
export async function logInAsSecondSampleInspector(page: Page) {
  await ensureSampleOrgEmployee({
    email: SAMPLE_SECOND_INSPECTOR_EMAIL,
    name: "Oppdiktet takstmann to",
    role: "inspector",
  });
  await logIn(page, SAMPLE_SECOND_INSPECTOR_EMAIL);
}

/** Logger inn som admin (bare rollen admin) i prøveorganisasjonen. */
export async function logInAsSampleAdminOnly(page: Page) {
  await ensureSampleOrgEmployee({
    email: SAMPLE_ADMIN_ONLY_EMAIL,
    name: "Oppdiktet admin",
    role: "admin",
  });
  await logIn(page, SAMPLE_ADMIN_ONLY_EMAIL);
}

/** Ansatt-id-en til e-posten i prøveorganisasjonen. Bare lesing. */
export async function sampleEmployeeId(email: string): Promise<string> {
  const sql = e2eSql();
  try {
    const organizationId = await sampleOrganizationId(sql);
    const [row] = await sql<{ id: string }[]>`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${email.toLowerCase()} and e.organization_id = ${organizationId}
        and e.deleted_at is null
      limit 1`;
    if (!row) throw new Error("Fant ikke den ansatte i prøveorganisasjonen");
    return row.id;
  } finally {
    await sql.end();
  }
}

/**
 * Setter `ai.enabled` i prøveorganisasjonen og gir tilbake verdien før. Sett den tilbake med
 * `restoreSampleAiEnabled` i `finally`. Playwright kjører med én arbeider.
 */
export async function setSampleAiEnabled(value: boolean): Promise<boolean | undefined> {
  const sql = e2eSql();
  try {
    const organizationId = await sampleOrganizationId(sql);
    const [row] = await sql<{ previous: boolean | null }[]>`
      select (settings ->> 'ai.enabled')::boolean as previous from organizations
      where id = ${organizationId}`;
    await sql`
      update organizations
      set settings = settings || jsonb_build_object('ai.enabled', ${value}::boolean)
      where id = ${organizationId}`;
    return row?.previous ?? undefined;
  } finally {
    await sql.end();
  }
}

export async function restoreSampleAiEnabled(previous: boolean | undefined): Promise<void> {
  if (previous !== undefined) {
    await setSampleAiEnabled(previous);
    return;
  }
  const sql = e2eSql();
  try {
    const organizationId = await sampleOrganizationId(sql);
    await sql`
      update organizations set settings = settings - 'ai.enabled' where id = ${organizationId}`;
  } finally {
    await sql.end();
  }
}

/** Radene i KI-loggen med id-en, med eier. Bare lesing. */
export async function aiUsageRowsById(
  id: string,
): Promise<{ id: string; outcome: string; employeeId: string; organizationId: string }[]> {
  const sql = e2eSql();
  try {
    return await sql<{ id: string; outcome: string; employeeId: string; organizationId: string }[]>`
      select id, outcome, employee_id as "employeeId", organization_id as "organizationId"
      from ai_usage_log where id = ${id}`;
  } finally {
    await sql.end();
  }
}

/** Radene i KI-loggen der den ansatte er eier og målet er `targetId`. Bare lesing. */
export async function aiUsageRowCountForEmployee(employeeId: string, targetId: string) {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ai_usage_log
      where employee_id = ${employeeId} and target_ref ->> 'id' = ${targetId}`;
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
}
