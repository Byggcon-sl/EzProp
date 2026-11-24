import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

/*
 * E2e-hjelperne kjører seed-funksjoner mot e2e-databasen. Produksjonsvakten for testdata
 * (src/db/seed/testdata-guard.ts) godtar bare development og test; verten sjekkes i tillegg
 * av assertLocalOrTestDatabase. Settes bare i testprosessen, ikke for appen.
 */
process.env.APP_ENVIRONMENT = "test";

/** Første admin fra seed (SEED_ADMIN_EMAIL i CI og .env.example). */
export const ADMIN_EMAIL = "admin@byggcon.no";

/**
 * Velger engangskoden når Microsoft-innlogging er satt opp (e2e-serveren har et oppdiktet
 * oppsett, ADR 0008). Uten oppsett vises kodeskjemaet med en gang, og ingenting skjer.
 */
export async function chooseCodeLogin(page: Page) {
  const codeInstead = page.getByRole("button", { name: "Logg inn med kode i stedet" });
  const email = page.getByLabel("E-postadresse");
  await expect(codeInstead.or(email).first()).toBeVisible();
  if (await codeInstead.isVisible()) await codeInstead.click();
  await expect(email).toBeVisible();
}

/** Logger inn med engangskode hentet fra utviklings-postkassen (/dev/epost). */
export async function logIn(page: Page, email = ADMIN_EMAIL) {
  await page.goto("/logg-inn");
  await chooseCodeLogin(page);
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
  /** Kontoret fra seed den ansatte skal høre til (for eksempel «Bodø»). Settes bare hvis kontor mangler. */
  officeName?: string;
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
async function ensureEmployee({
  email,
  name,
  role,
  roleLabel,
  label,
  officeName,
}: E2eEmployee): Promise<void> {
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
    if (officeName) {
      const [office] = await sql<{ id: string }[]>`
        select id from offices
        where organization_id = ${organizationId} and name = ${officeName} and deleted_at is null
        order by created_at limit 1`;
      if (!office) throw new Error(`Fant ikke kontoret ${officeName} fra seed (kjør pnpm db:seed)`);
      // Fast kontor: settes bare hvis den ansatte ikke har kontor fra før.
      await sql`
        update employees set office_id = ${office.id}
        where id = ${employee.id} and organization_id = ${organizationId} and office_id is null`;
    }
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

/** Oppdiktet takstmann med fast kontor (Bodø fra seed) for e2e. Ingen ekte navn eller adresser. */
export const INSPECTOR_WITH_OFFICE_EMAIL = "takstmann-kontor@example.com";

/**
 * Logger inn som den oppdiktede takstmannen med fast kontor (rolle `inspector`, kontoret «Bodø»).
 * Brukes der siden skal vise det forhåndsvalgte kontoret, ikke hele kontorlisten.
 */
export async function logInAsInspectorWithOffice(page: Page) {
  await ensureEmployee({
    email: INSPECTOR_WITH_OFFICE_EMAIL,
    name: "Oppdiktet takstmann med kontor",
    role: "inspector",
    roleLabel: "takstmann",
    label: "INSPECTOR_WITH_OFFICE_EMAIL",
    officeName: "Bodø",
  });
  await logIn(page, INSPECTOR_WITH_OFFICE_EMAIL);
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
  await chooseCodeLogin(page);
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

// --- Rett T-0070: innlogging i dialog over skjemaet (docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 2) ---

/**
 * Fyller ut kodeskjemaet på innloggingssiden man står på (for eksempel `/logg-inn?neste=…` etter
 * en sidevisning uten innlogging). Går ikke til `/logg-inn` og venter ikke på arbeidskøen; testen
 * sjekker selv hvor siden sender etterpå.
 */
export async function logInFromCurrentPage(page: Page, email: string) {
  await signInWithCode(page, email);
}

/** Den åpne innloggingsdialogen over skjemaet (den innerste når dialoger ligger i hverandre). */
export function signInDialog(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByLabel(/^(E-postadresse|Kode fra e-posten)$/) })
    .last();
}

/** Henter siste innloggingskode fra utviklings-postkassen i en egen side. */
async function latestLoginCode(page: Page): Promise<string> {
  const mailbox = await page.context().newPage();
  await mailbox.goto("/dev/epost");
  const subject = await mailbox.getByTestId("dev-email-subject").first().textContent();
  await mailbox.close();
  const code = /: (\d{6})$/.exec(subject ?? "")?.[1];
  if (!code) throw new Error(`Fant ingen innloggingskode i «${subject}»`);
  return code;
}

/**
 * Logger inn i dialogen over skjemaet: e-posten er fylt ut fra siden, så bare «Send meg en kode»
 * og koden trengs. Henter koden fra `/dev/epost` i en egen side, så skjemaet under står urørt.
 * Venter til dialogen er lukket.
 */
export async function logInInDialog(page: Page) {
  const dialog = signInDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Send meg en kode" }).click();
  const codeField = dialog.getByLabel("Kode fra e-posten");
  await expect(codeField).toBeVisible();
  await codeField.fill(await latestLoginCode(page));
  await dialog.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByLabel("Kode fra e-posten")).toHaveCount(0);
}

/** Som `logInInDialog`, men bare med tastaturet (fokus starter i dialogen). */
export async function logInInDialogWithKeyboard(page: Page) {
  const dialog = signInDialog(page);
  await expect(dialog).toBeVisible();
  // Fokus står i dialogen (e-postfeltet eller «Send meg en kode»); Enter sender koden
  await page.keyboard.press("Enter");
  const codeField = dialog.getByLabel("Kode fra e-posten");
  await expect(codeField).toBeFocused();
  await page.keyboard.type(await latestLoginCode(page));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Kode fra e-posten")).toHaveCount(0);
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
 * Myk sletting av kontorene som e2e-testene har laget («Testkontor …» og «Loggkontor …»).
 * Kontorene lages av fase-0b-admin.spec.ts og fase-0b-logg.spec.ts og blir liggende mellom
 * kjøringer i den lokale databasen, som ikke tømmes. Da vokser kontorlistene, og layout-tester blir
 * røde uten grunn. Kontorene fra seed (Bodø, Mo i Rana, Mosjøen, Narvik, Tromsø) røres ikke, og
 * ingenting slettes for godt (regel 3). Bare lokal database eller testdatabasen.
 */
export async function archiveLeftoverE2eOffices(): Promise<void> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [admin] = await sql<{ id: string }[]>`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.organization_id = ${organizationId}
        and e.deleted_at is null limit 1`;
    if (!admin) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    await sql`
      update offices set deleted_at = now(), deleted_by = ${admin.id}, updated_at = now(),
        row_version = row_version + 1
      where organization_id = ${organizationId} and deleted_at is null
        and (name like 'Testkontor %' or name like 'Loggkontor %')`;
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
    const address = `Reklamasjonsveien 1 ${suffix}, 8000 Bodø`;
    await sql`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(),
        'manual', 'received', 'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    // Bestillingsfeltene står også på oppdraget (ADR 0011, påkrevd fra migrering 0034).
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source)
      values (${assignmentId}, ${organizationId}, ${`E2E-REK-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual')`;
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

// --- Prøveorganisasjonen og badskjermen («KI i veien», docs/funksjoner/fase2a-ki-i-veien-testplan.md avsnitt 7) ---

/** Logger inn som prøvetakstmannen (prøveorganisasjonen, KI på med `fake`, `db:seed:testoppdrag`). */
export async function logInAsSampleInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

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
 * Sørger for at en oppdiktet ansatt finnes i prøveorganisasjonen med rollen. Idempotent. Bare
 * lokal database eller testdatabasen. Sletter og gjenoppretter ingenting.
 */
export async function ensureSampleOrgEmployee(input: {
  email: string;
  name: string;
  role: "inspector" | "admin" | "office";
}): Promise<void> {
  const sql = e2eSql();
  try {
    const organizationId = await sampleOrganizationId(sql);
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${input.name}, ${input.email}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${input.email}`;
    if (!user) throw new Error("Kunne ikke lage brukeren for e2e (prøveorganisasjonen)");
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
    if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e (prøveorganisasjonen)");
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

/** Avvikskort nummer `n` i punktet som er åpent. */
export function deviationCardOn(page: Page, n: number): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^Avvik ${n}\\b`) }) })
    .first();
}

/**
 * Lager et TG3-avvik på «Vanntett sjikt, membran og sluk» slik takstmannen gjør: folie fra 1990
 * gir forslaget fra reglene, og «Godta» lager avviket med malens tekster. Badet må være åpent på
 * punktet (`openSampleBathroom(page, bath, "wet_room.membrane_drain")`).
 */
export async function addRuleTg3Deviation(page: Page): Promise<Locator> {
  await page
    .getByRole("group", { name: "Vanntett sjikt", exact: true })
    .locator("label")
    .filter({ hasText: /^Folie$/ })
    .first()
    .click();
  const year = page.getByLabel("Årstall for det vanntette sjiktet");
  await year.fill("1990");
  await year.blur();
  const suggestion = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forslag fra reglene" }) })
    .first();
  await expect(suggestion).toContainText("TG3");
  await suggestion.getByRole("button", { name: "Godta", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  return deviationCardOn(page, 1);
}

/** Lagrestatusen for hele badet i topplinjen. */
export function bathroomSaveState(page: Page): Locator {
  return page.locator("header [role='status'][data-save-state]");
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

// --- Testdata som ligner en ekte arbeidshverdag (docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 7) ---

/**
 * Kjører `pnpm db:seed:testdata` (inngangen `src/db/seed/testdata-index.ts`) mot e2e-databasen,
 * slik utrullingen gjør. Sjekker først at databasen er lokal eller testdatabasen
 * (`assertLocalOrTestDatabase`); produksjonsvakten i skriptet kjører i tillegg, med
 * `APP_ENVIRONMENT=test`. Skriver ingenting andre gang. Utskriften fra skriptet har bare antall og
 * `TD-`-nøkler, så den kan vises i feilmeldingen.
 */
export function seedTestdataForE2e(): void {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const result = spawnSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    [path.join(process.cwd(), "src/db/seed/testdata-index.ts")],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, APP_ENVIRONMENT: "test" },
      encoding: "utf8",
      timeout: 240_000,
    },
  );
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000);
    throw new Error(`pnpm db:seed:testdata feilet (kode ${result.status}): ${output}`);
  }
}

/** Et TD-oppdrag i Byggcon, med det e2e trenger for å finne det på skjermen. */
export type E2eTestdataAssignment = {
  externalRef: string;
  assignmentId: string;
  number: string;
  status: "ordered" | "in_progress" | "completed" | "invoiced";
  address: string;
  inspectionAt: Date | null;
  claimId: string | null;
  brokerLastName: string | null;
  buildingName: string | null;
  floorName: string | null;
  roomName: string | null;
};

/** TD-oppdragene i organisasjonen til admin fra seed (Byggcon). Bare lesing. */
export async function testdataAssignments(): Promise<E2eTestdataAssignment[]> {
  const sql = e2eSql();
  try {
    const found = await sql<
      {
        external_ref: string;
        assignment_id: string;
        number: string;
        status: E2eTestdataAssignment["status"];
        address: string;
        inspection_at: Date | null;
        claim_id: string | null;
        broker_last_name: string | null;
        building_name: string | null;
        floor_name: string | null;
        room_name: string | null;
      }[]
    >`
      with org as (
        select e.organization_id as id from employees e join users u on u.id = e.user_id
        where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
          and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
        limit 1)
      select o.external_ref, a.id as assignment_id, a.number, a.status,
        coalesce(p.address, o.address_text) as address, a.inspection_at,
        (select c.id from claims c where c.organization_id = a.organization_id
          and c.assignment_id = a.id and c.deleted_at is null limit 1) as claim_id,
        ct.last_name as broker_last_name,
        b.name as building_name, f.name as floor_name, r.name as room_name
      from orders o
      join org on org.id = o.organization_id
      join assignments a on a.id = o.assignment_id and a.organization_id = o.organization_id
      left join properties p on p.id = a.property_id and p.organization_id = a.organization_id
      left join contacts ct on ct.id = o.ordered_by_contact_id and ct.organization_id = o.organization_id
      left join lateral (select id, name from report_buildings
        where organization_id = a.organization_id and assignment_id = a.id and deleted_at is null
        order by name limit 1) b on true
      left join lateral (select id, name from floors
        where report_building_id = b.id and deleted_at is null order by level, name limit 1) f on true
      left join lateral (select name from rooms
        where floor_id = f.id and deleted_at is null order by name limit 1) r on true
      where o.external_ref like 'TD-%' and o.deleted_at is null and a.deleted_at is null
      order by o.external_ref`;
    return found.map((row) => ({
      externalRef: row.external_ref,
      assignmentId: row.assignment_id,
      number: row.number,
      status: row.status,
      address: row.address,
      inspectionAt: row.inspection_at === null ? null : new Date(row.inspection_at),
      claimId: row.claim_id,
      brokerLastName: row.broker_last_name,
      buildingName: row.building_name,
      floorName: row.floor_name,
      roomName: row.room_name,
    }));
  } finally {
    await sql.end();
  }
}

/** TD-ordrene som ikke er gjort om (status mottatt) i Byggcon. Bare lesing. */
export async function testdataOpenOrderRefs(): Promise<string[]> {
  const sql = e2eSql();
  try {
    const found = await sql<{ external_ref: string }[]>`
      select o.external_ref from orders o
      where o.external_ref like 'TD-%' and o.status = 'received' and o.deleted_at is null
        and o.organization_id = (
          select e.organization_id from employees e join users u on u.id = e.user_id
          where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
            and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
          limit 1)
      order by o.external_ref`;
    return found.map((row) => row.external_ref);
  } finally {
    await sql.end();
  }
}

/**
 * Setter en innstilling i Byggcon (organisasjonen til admin fra seed) og gir tilbake verdien som sto
 * der før (`undefined` når den manglet). Sett den tilbake med `restoreByggconSetting` i `finally`.
 */
export async function setByggconSetting(key: string, value: unknown): Promise<unknown> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; previous: unknown }[]>`
      select o.id, o.settings -> ${key} as previous from organizations o
      where o.id = (
        select e.organization_id from employees e join users u on u.id = e.user_id
        where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
          and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
        limit 1)`;
    if (!row) throw new Error("Fant ikke organisasjonen til admin fra seed (kjør pnpm db:seed)");
    await sql`
      update organizations set settings = settings || jsonb_build_object(${key}::text, ${sql.json(value as never)}::jsonb)
      where id = ${row.id}`;
    return row.previous ?? undefined;
  } finally {
    await sql.end();
  }
}

/** Setter innstillingen tilbake til verdien fra `setByggconSetting` (fjerner den når den manglet). */
export async function restoreByggconSetting(key: string, previous: unknown): Promise<void> {
  if (previous !== undefined) {
    await setByggconSetting(key, previous);
    return;
  }
  const sql = e2eSql();
  try {
    await sql`
      update organizations set settings = settings - ${key}::text
      where id = (
        select e.organization_id from employees e join users u on u.id = e.user_id
        where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
          and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
        limit 1)`;
  } finally {
    await sql.end();
  }
}

/**
 * Lenken i kortet «Gjort om til oppdrag» på ordresiden. Navnet er «Gjort om til oppdrag
 * 2026-NNNNN». Lenkene i varselet «Mulig dublett» begynner med adressen, så det forankrede
 * uttrykket treffer bare kortet.
 */
export const ASSIGNMENT_LINK_NAME = /^Gjort om til oppdrag\s+(\d{4}-\d{5})$/;

export function convertedAssignmentLink(page: Page) {
  return page.getByRole("main").getByRole("link", { name: ASSIGNMENT_LINK_NAME });
}

/** Venter på kortlenken og gir oppdragsnummeret i den. */
export async function convertedAssignmentNumber(page: Page): Promise<string> {
  await expect(convertedAssignmentLink(page)).toBeVisible();
  const text = ((await convertedAssignmentLink(page).textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return ASSIGNMENT_LINK_NAME.exec(text)![1]!;
}

// --- Tilbud → oppdrag (docs/funksjoner/fase2a-tilbud.md)

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Siden til ett lagret tilbud. «Lagre» på /tilbud/ny går via `?ny=1` hit. */
export const OFFER_URL = new RegExp(`/tilbud/(${UUID_PATTERN})$`);

/** Siden til ett oppdrag (med eller uten spørring og anker). */
export const ASSIGNMENT_PAGE_URL = new RegExp(`/oppdrag/(${UUID_PATTERN})(\\?.*)?(#.*)?$`);

/** «Gjør om til oppdrag» på tilbudssiden (teksten skifter mens oppdraget lages). */
export function convertOfferButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Gjør om til oppdrag|Lager oppdraget …)$/ });
}

/** Velger «Bodø» når kontoret må velges (admin uten kontor); ellers er det forhåndsvalgt. */
export async function chooseOfficeIfNeeded(page: Page) {
  // Vent til handlingsblokken er tegnet, ellers kan kontorvalget komme etter sjekken
  await expect(convertOfferButton(page)).toBeVisible();
  const radio = page.getByRole("radio", { name: "Bodø", exact: true });
  if (await radio.isVisible()) await radio.check();
}

/** Ett trykk på «Gjør om til oppdrag» og venter på oppdraget. Gir id-en til oppdraget. */
export async function convertOfferWithOneTap(page: Page): Promise<string> {
  await chooseOfficeIfNeeded(page);
  await convertOfferButton(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_PAGE_URL);
  return ASSIGNMENT_PAGE_URL.exec(page.url())![1]!;
}

/** «Lagre» på /tilbud/ny (feltene er fylt ut) og venter på tilbudssiden. Gir id-en til tilbudet. */
export async function saveNewOffer(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(OFFER_URL);
  return OFFER_URL.exec(page.url())![1]!;
}

/**
 * Nytt tilbud med en unik adresse → «Gjør om til oppdrag» (Bodø) → oppdraget er åpent.
 * Gir id-ene til tilbudet og oppdraget.
 */
export async function newAssignmentFromOffer(
  page: Page,
  address = `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`,
): Promise<{ offerId: string; assignmentId: string }> {
  await page.goto("/tilbud/ny");
  await page.getByLabel(/^Adresse/).fill(address);
  const offerId = await saveNewOffer(page);
  const assignmentId = await convertOfferWithOneTap(page);
  return { offerId, assignmentId };
}

// --- Rom på oppdraget (rett T-0050 forsøk 2, docs/agenter/oppgaver/rett-t0050-arealtype-testplan.md)

export type E2eRoomRow = { name: string | null; areaType: string; belowGround: boolean };

/** Rommene (ikke slettede) på oppdraget med navn, arealtype og «Under terreng». Bare lesing. */
export async function roomsOnAssignment(assignmentId: string): Promise<E2eRoomRow[]> {
  const sql = e2eSql();
  try {
    return await sql<E2eRoomRow[]>`
      select r.name, r.area_type as "areaType", r.below_ground as "belowGround"
      from rooms r
      join floors f on f.id = r.floor_id and f.organization_id = r.organization_id
      join report_buildings b on b.id = f.report_building_id
        and b.organization_id = f.organization_id
      where b.assignment_id = ${assignmentId}
        and r.deleted_at is null
      order by r.created_at`;
  } finally {
    await sql.end();
  }
}

// --- Papirkurv og «Angre» (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 10) ---------

export type E2eStructure = {
  assignmentId: string;
  partyId: string;
  partyName: string;
  buildingId: string;
  /** «1. etasje»: areal BRA-i 64,0 og rommene «Bad» og «Soverom». */
  firstFloorId: string;
  /** «2. etasje»: fire rom. */
  secondFloorId: string;
  /** Rommene i 1. etasje, i rekkefølgen på skjermen. */
  firstFloorRoomIds: [string, string];
  /** Rommet som allerede er fjernet (bare med `withRemovedRoom`). */
  removedRoomId: string | null;
};

/**
 * Et oppdrag med én part (som `createAssignmentWithParty`) og bygningen «Bolighus test» med
 * «1. etasje» (BRA-i 64,0, rommene «Bad» og «Soverom») og «2. etasje» (fire rom), og «Garasje
 * test» uten etasjer. Med `withRemovedRoom` ligger rommet «Vaskerom test» i papirkurven, fjernet
 * av admin fra seed. Oppdiktede data, satt inn direkte uten tilgangssjekk. Bare lokal database
 * eller testdatabasen.
 */
export async function createAssignmentWithBuildings(
  suffix: string,
  { withRemovedRoom = false }: { withRemovedRoom?: boolean } = {},
): Promise<E2eStructure> {
  const { assignmentId, partyId, partyName } = await createAssignmentWithParty(suffix);
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [admin] = await sql<{ id: string }[]>`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.organization_id = ${organizationId}
        and e.deleted_at is null limit 1`;
    const buildingId = randomUUID();
    const garageId = randomUUID();
    const firstFloorId = randomUUID();
    const secondFloorId = randomUUID();
    const base = Date.now() - 60_000;
    const at = (offset: number) => new Date(base + offset * 1000).toISOString();
    await sql`
      insert into report_buildings (id, organization_id, assignment_id, name, created_at)
      values (${buildingId}, ${organizationId}, ${assignmentId}, 'Bolighus test', ${at(0)}),
             (${garageId}, ${organizationId}, ${assignmentId}, 'Garasje test', ${at(1)})`;
    await sql`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground,
        created_at)
      values (${firstFloorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false, ${at(2)}),
             (${secondFloorId}, ${organizationId}, ${buildingId}, '2. etasje', 2, false, ${at(3)})`;
    await sql`
      insert into floor_areas (organization_id, floor_id, bra_i, measured_by, method)
      values (${organizationId}, ${firstFloorId}, 64.0, ${admin?.id ?? null}, 'laser')`;
    const bathId = randomUUID();
    const bedroomId = randomUUID();
    await sql`
      insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground,
        created_at)
      values (${bathId}, ${organizationId}, ${firstFloorId}, 'bathroom', null, 'bra_i', false, ${at(4)}),
             (${bedroomId}, ${organizationId}, ${firstFloorId}, 'bedroom', null, 'bra_i', false, ${at(5)})`;
    const upper = [
      ["bedroom", "Soverom 1"],
      ["bedroom", "Soverom 2"],
      ["living_room", "Stue oppe"],
      ["bathroom", "Bad oppe"],
    ] as const;
    for (const [index, [roomType, name]] of upper.entries()) {
      await sql`
        insert into rooms (organization_id, floor_id, room_type, name, area_type, below_ground,
          created_at)
        values (${organizationId}, ${secondFloorId}, ${roomType}, ${name}, 'bra_i', false,
          ${at(6 + index)})`;
    }
    let removedRoomId: string | null = null;
    if (withRemovedRoom) {
      removedRoomId = randomUUID();
      await sql`
        insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground,
          created_at, deleted_at, deleted_by)
        values (${removedRoomId}, ${organizationId}, ${firstFloorId}, 'laundry', 'Vaskerom test',
          'bra_i', false, ${at(10)}, ${at(20)}, ${admin?.id ?? null})`;
    }
    return {
      assignmentId,
      partyId,
      partyName,
      buildingId,
      firstFloorId,
      secondFloorId,
      firstFloorRoomIds: [bathId, bedroomId],
      removedRoomId,
    };
  } finally {
    await sql.end();
  }
}

// --- Papirkurv og angre (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 10) -------------

export type E2eTrashTree = {
  assignmentId: string;
  buildingId: string;
  buildingName: string;
  firstFloorId: string;
  secondFloorId: string;
  /** Rommene i 1. etasje i rekkefølge: «Bad <suffix>», «Soverom 1 <suffix>», «Stue <suffix>». */
  firstFloorRooms: { id: string; name: string }[];
  /** Fire rom i 2. etasje. */
  secondFloorRooms: { id: string; name: string }[];
  partyId: string;
  partyName: string;
};

/**
 * Et oppdrag (med ordre og eiendom) i organisasjonen til admin fra seed, med bygningen
 * «Bolighus test <suffix>», «1. etasje» (BRA-i 50, BRA-e 10, BRA-b 4) med tre rom, «2. etasje»
 * med fire rom, og kjøperen «Ola Testmann <suffix>». Rommene får `created_at` med ett sekunds
 * mellomrom, så rekkefølgen er fast. Oppdiktede data. Bare lokal database eller testdatabasen.
 */
export async function createAssignmentWithTrashTree(suffix: string): Promise<E2eTrashTree> {
  const sql = e2eSql();
  try {
    const organizationId = await seedOrganizationId(sql);
    const [office] = await sql<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error("Fant ikke et kontor fra seed (kjør pnpm db:seed)");
    const assignmentId = randomUUID();
    const buildingId = randomUUID();
    const firstFloorId = randomUUID();
    const secondFloorId = randomUUID();
    const partyId = randomUUID();
    const address = `Papirkurvveien 1 ${suffix}, 8000 Bodø`;
    const buildingName = `Bolighus test ${suffix}`;
    const partyName = `Ola Testmann ${suffix}`;
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        address_text, received_at, source)
      values (${assignmentId}, ${organizationId}, ${`E2E-PK-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${address}, now(), 'manual')`;
    await sql`
      insert into report_buildings (id, organization_id, assignment_id, name)
      values (${buildingId}, ${organizationId}, ${assignmentId}, ${buildingName})`;
    await sql`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground)
      values (${firstFloorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false),
             (${secondFloorId}, ${organizationId}, ${buildingId}, '2. etasje', 2, false)`;
    await sql`
      insert into floor_areas (organization_id, floor_id, bra_i, bra_e, bra_b, method)
      values (${organizationId}, ${firstFloorId}, 50, 10, 4, 'laser'),
             (${organizationId}, ${secondFloorId}, 40, 0, 0, 'laser')`;
    const rooms = async (floorId: string, names: [string, string][]) => {
      const out: { id: string; name: string }[] = [];
      for (const [index, [roomType, name]] of names.entries()) {
        const id = randomUUID();
        await sql`
          insert into rooms (id, organization_id, floor_id, room_type, name, area_type,
            below_ground, created_at)
          values (${id}, ${organizationId}, ${floorId}, ${roomType}, ${name}, 'bra_i', false,
            now() + (${index} || ' seconds')::interval)`;
        out.push({ id, name });
      }
      return out;
    };
    const firstFloorRooms = await rooms(firstFloorId, [
      ["bathroom", `Bad ${suffix}`],
      ["bedroom", `Soverom 1 ${suffix}`],
      ["living_room", `Stue ${suffix}`],
    ]);
    const secondFloorRooms = await rooms(secondFloorId, [
      ["bedroom", `Soverom 2 ${suffix}`],
      ["bedroom", `Soverom 3 ${suffix}`],
      ["bathroom", `Bad 2 ${suffix}`],
      ["storage", `Bod ${suffix}`],
    ]);
    await sql`
      insert into assignment_parties (id, organization_id, assignment_id, role, name, email, phone)
      values (${partyId}, ${organizationId}, ${assignmentId}, 'buyer', ${partyName},
        'ola.testmann@example.invalid', '90000000')`;
    return {
      assignmentId,
      buildingId,
      buildingName,
      firstFloorId,
      secondFloorId,
      firstFloorRooms,
      secondFloorRooms,
      partyId,
      partyName,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Hvor mange rader som er fjernet (myk sletting) på oppdraget, per tabell, telt direkte i
 * databasen. Bare lesing, bare lokal database eller testdatabasen.
 */
export async function trashCountsFor(assignmentId: string): Promise<{
  buildings: number;
  floors: number;
  floorAreas: number;
  rooms: number;
  parties: number;
}> {
  const sql = e2eSql();
  try {
    const [row] = await sql<
      { buildings: number; floors: number; floorAreas: number; rooms: number; parties: number }[]
    >`
      select
        (select count(*)::int from report_buildings b
          where b.assignment_id = ${assignmentId} and b.deleted_at is not null) as buildings,
        (select count(*)::int from floors f
          join report_buildings b on b.id = f.report_building_id
          where b.assignment_id = ${assignmentId} and f.deleted_at is not null) as floors,
        (select count(*)::int from floor_areas a
          join floors f on f.id = a.floor_id
          join report_buildings b on b.id = f.report_building_id
          where b.assignment_id = ${assignmentId} and a.deleted_at is not null) as "floorAreas",
        (select count(*)::int from rooms r
          join floors f on f.id = r.floor_id
          join report_buildings b on b.id = f.report_building_id
          where b.assignment_id = ${assignmentId} and r.deleted_at is not null) as rooms,
        (select count(*)::int from assignment_parties p
          where p.assignment_id = ${assignmentId} and p.deleted_at is not null) as parties`;
    return row!;
  } finally {
    await sql.end();
  }
}

// --- Mine innlogginger (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 0) ---

/** En egen, oppdiktet ansatt for tester som logger ut (aldri de delte e2e-brukerne). */
export type DedicatedEmployee = { email: string; name: string; employeeId: string; userId: string };

/**
 * Lager en ny oppdiktet ansatt med én rolle i Byggcon (organisasjonen til admin fra seed), med
 * unik e-post `<prefix>-<uniqueSuffix()>@example.com`. Brukes av alle tester som logger ut av
 * alle enheter eller deaktiverer, så de delte brukerne (ADMIN_EMAIL, INSPECTOR_EMAIL …) aldri
 * logges ut midt i en annen test. Bare lokal database eller testdatabasen. Sletter og deaktiverer
 * ingenting; radene blir liggende som oppdiktede rader i e2e-databasen.
 */
export async function ensureDedicatedEmployee(input: {
  role: "inspector" | "manager" | "office" | "admin";
  prefix?: string;
  name?: string;
}): Promise<DedicatedEmployee> {
  const suffix = uniqueSuffix();
  const email = `${input.prefix ?? "innlogging"}-${suffix}@example.com`;
  const name = input.name ?? `Oppdiktet ansatt ${suffix}`;
  const sql = e2eSql();
  try {
    const [admin] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e
      join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and e.deleted_at is null and e.deactivated_at is null
      limit 1`;
    if (!admin) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    const organizationId = admin.organization_id;
    const userId = randomUUID();
    await sql`
      insert into users (id, name, email, email_verified)
      values (${userId}, ${name}, ${email}, true)`;
    const [employee] = await sql<{ id: string }[]>`
      insert into employees (organization_id, user_id, name)
      values (${organizationId}, ${userId}, ${name})
      returning id`;
    if (!employee) throw new Error("Kunne ikke lage den egne ansatte for e2e");
    await sql`
      update employees set company_id = (
        select c.id from companies c
        where c.organization_id = ${organizationId} and c.legal_name = ${INSPECTOR_COMPANY}
          and c.deleted_at is null
        order by c.created_at limit 1)
      where id = ${employee.id} and organization_id = ${organizationId}`;
    await sql`
      insert into employee_roles (organization_id, employee_id, role)
      values (${organizationId}, ${employee.id}, ${input.role}::employee_role)`;
    return { email, name, employeeId: employee.id, userId };
  } finally {
    await sql.end();
  }
}

/** Antall økter som står for brukeren i e2e-databasen (også utløpte). Bare lesing. */
export async function sessionCountForUser(userId: string): Promise<number> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from sessions where user_id = ${userId}`;
    return row?.count ?? 0;
  } finally {
    await sql.end();
  }
}

/** Tokenet i innloggingskapselen til konteksten (delen før første punktum), eller `null`. */
export async function sessionTokenOf(context: BrowserContext): Promise<string | null> {
  const cookie = (await context.cookies()).find((entry) => isSessionCookie(entry.name));
  if (!cookie) return null;
  return decodeURIComponent(cookie.value).split(".")[0] ?? null;
}

/** axe-core fra pakken lint-oppsettet alt har (ingen ny avhengighet). */
function axeSource(): string {
  const fromRoot = createRequire(`${process.cwd()}/package.json`);
  const nextConfig = createRequire(fromRoot.resolve("eslint-config-next"));
  const jsxA11y = createRequire(nextConfig.resolve("eslint-plugin-jsx-a11y"));
  return jsxA11y.resolve("axe-core/axe.min.js");
}

/** Kjører axe (WCAG 2.1 A og AA) i siden og krever null brudd. */
export async function expectNoAxeViolations(page: Page, where: string) {
  await page.addScriptTag({ path: axeSource() });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            o: unknown,
          ) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const result = await axe.run({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  });
  expect(violations, `axe uten feil (${where})`).toEqual([]);
}

// --- Badet i prøveorganisasjonen (samme oppsett som e2e/fase-2a-badet-pc.spec.ts) ------------

const MISSING_SAMPLE_BATHROOM =
  "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";

/** Kontrollpunktet «Vanntett sjikt, membran og sluk» i badmalen. */
export const BATHROOM_MEMBRANE = "wet_room.membrane_drain";
export const BATHROOM_MEMBRANE_NAME = "Vanntett sjikt, membran og sluk";
/** Kontrollpunktet «Tilliggende konstruksjoner» (hulltaking) i badmalen. */
export const BATHROOM_ADJACENT = "wet_room.adjacent";

export type SampleBathroom = {
  assignmentId: string;
  roomId: string;
  bedroomId: string;
  suffix: string;
};

function bathroomSql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

async function sampleOrganizationIdFor(db: postgres.Sql): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from organizations
    where settings ->> 'sampleData' = 'true' and deleted_at is null
    order by created_at limit 1`;
  if (!row) throw new Error(MISSING_SAMPLE_BATHROOM);
  return row.id;
}

/** Et oppdrag i prøveorganisasjonen med ett bad og ett soverom. Oppdiktet. */
export async function createSampleBathroom(): Promise<SampleBathroom> {
  const db = bathroomSql();
  const suffix = uniqueSuffix();
  try {
    const organizationId = await sampleOrganizationIdFor(db);
    const [office] = await db<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error(MISSING_SAMPLE_BATHROOM);
    const orderId = randomUUID();
    const assignmentId = randomUUID();
    const buildingId = randomUUID();
    const floorId = randomUUID();
    const roomId = randomUUID();
    const bedroomId = randomUUID();
    const address = `Badeveien 2 ${suffix}, 8000 Bodø`;
    await db`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    await db`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source)
      values (${assignmentId}, ${organizationId}, ${`E2E-FA-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual')`;
    await db`
      insert into report_buildings (id, organization_id, assignment_id, name)
      values (${buildingId}, ${organizationId}, ${assignmentId}, 'Bolighus')`;
    await db`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground)
      values (${floorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false)`;
    await db`
      insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground)
      values (${roomId}, ${organizationId}, ${floorId}, 'bathroom', ${`Bad E2E ${suffix}`},
        'bra_i', false),
        (${bedroomId}, ${organizationId}, ${floorId}, 'bedroom', ${`Soverom E2E ${suffix}`},
        'bra_i', false)`;
    return { assignmentId, roomId, bedroomId, suffix };
  } finally {
    await db.end();
  }
}

export type SampleDecisionRow = {
  decision: string;
  override_reason_code: string | null;
  deviation_id: string | null;
  chosen_tg: string | null;
};

/** Beslutningene på regelforslag i oppdraget, eldste først. */
export async function sampleDecisions(assignmentId: string): Promise<SampleDecisionRow[]> {
  const db = bathroomSql();
  try {
    return await db<SampleDecisionRow[]>`
      select d.decision, d.override_reason_code, d.deviation_id, d.chosen_tg
      from rule_suggestion_decisions d join reports r on r.id = d.report_id
      where r.assignment_id = ${assignmentId} and d.deleted_at is null
      order by d.decided_at, d.id`;
  } finally {
    await db.end();
  }
}

/** TG på avvikene som står (ikke mykt slettet) i oppdraget, eldste først. */
export async function sampleDeviationTgs(assignmentId: string): Promise<(number | null)[]> {
  const db = bathroomSql();
  try {
    const rows = await db<{ tg: number | null }[]>`
      select d.tg from deviations d join reports r on r.id = d.report_id
      where r.assignment_id = ${assignmentId} and d.deleted_at is null
      order by d.created_at`;
    return rows.map((row) => row.tg);
  } finally {
    await db.end();
  }
}

/** Adressen til badet, eventuelt med et kontrollpunkt åpent. */
export function sampleBathroomUrl(bath: SampleBathroom, checkpoint?: string): string {
  const base = `/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`;
  return checkpoint ? `${base}?punkt=${encodeURIComponent(checkpoint)}` : base;
}

/** Overskriften til kontrollpunktet som er åpent. */
export function roomCheckpointHeading(page: Page): Locator {
  return page.locator("#checkpoint-heading");
}

/** Åpner badet og starter rapporten når den ikke finnes. */
export async function openSampleBathroom(page: Page, bath: SampleBathroom, checkpoint?: string) {
  await page.goto(sampleBathroomUrl(bath, checkpoint));
  const start = page.getByRole("button", { name: "Start rapporten" });
  const heading = roomCheckpointHeading(page);
  await expect(start.or(heading).first()).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(heading).toBeVisible();
}

/** «Å se over (n)» på punktet som er åpent. Finnes ikke når listen er tom. */
export function roomReviewList(page: Page): Locator {
  return page.getByRole("region", { name: /^Å se over/ });
}

/** Det første forslagskortet («Forslag fra reglene») på punktet. */
export function ruleSuggestionCard(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forslag fra reglene" }) })
    .first();
}

/** Avvikskortet med overskriften «Avvik n». */
export function roomDeviationCard(page: Page, n: number): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^Avvik ${n}\\b`) }) })
    .first();
}

/** Velger et valg i en gruppe med pilleknapper (trykk på pillen). */
export async function chooseRoomOption(
  page: Page,
  group: string,
  option: string | RegExp,
  scope?: Locator,
) {
  await (scope ?? page)
    .getByRole("group", { name: group, exact: true })
    .locator("label")
    .filter({ hasText: option })
    .first()
    .click();
}

/** Åpner et kontrollpunkt fra listen (i skuffen når skjermen er smal). */
export async function openRoomCheckpoint(page: Page, name: string) {
  const portrait = (page.viewportSize()?.width ?? 1200) < 1024;
  if (portrait) {
    await page.getByRole("button", { name: /^Punkter \(\d+ av \d+\)$/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Kontrollpunkter" })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  }
  await expect(page.getByRole("heading", { level: 2, name })).toBeFocused();
}

/** Sjikt «Folie» med årstall 1990: gir TG3-forslaget for sjikt før 2000. Oppdiktet. */
export async function fillMembraneForTg3(page: Page) {
  await chooseRoomOption(page, "Vanntett sjikt", /^Folie$/);
  const year = page.getByLabel("Årstall for det vanntette sjiktet");
  await year.fill("1990");
  await year.blur();
  await expect(ruleSuggestionCard(page)).toContainText("TG3");
}

/** Krever at siden ikke kan rulles vannrett. */
export async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling (${where})`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/**
 * Teller kall til serverhandlingene (server actions er POST med `next-action`) fra siden.
 * `count()` gir antallet siden telleren ble startet eller nullstilt.
 */
export function countServerActions(page: Page): { count(): number; reset(): void } {
  let calls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) calls += 1;
  });
  return {
    count: () => calls,
    reset: () => {
      calls = 0;
    },
  };
}

// --- Testdata, del 2: badene i testoppdragene (docs/funksjoner/fase2a-testdata-del-2-testplan.md avsnitt 5) ---

/*
 * Oppslagene bruker funksjonene i `src/db/seed/testdata-bath.ts` (`findShowcaseBathReport` og
 * `findTestdataBathReports`), slik testplanen sier. De laster databaseklienten til appen, som
 * krever miljøvariablene til appen, så de kjøres i en egen `tsx`-prosess mot e2e-databasen
 * (samme mønster som `seedTestdataForE2e`). Playwright-prosessen laster dem aldri. Badene finnes
 * alltid på innholdet, aldri på rekkefølge eller antall rader.
 */

/** Et bad i et testoppdrag i Byggcon, med det e2e trenger for å åpne det. */
export type E2eTestdataBath = {
  reportId: string;
  assignmentId: string;
  assignmentNumber: string;
  roomId: string;
  roomName: string | null;
};

type NodeTaskInput = Record<string, unknown>;

/** Aktøren for brukeren med e-posten i organisasjonen (bare i oppgavene under). */
async function actorByEmail(
  email: string,
  organizationId: string,
): Promise<{ id: string; email: string; name: string }> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; email: string; name: string }[]>`
      select u.id, u.email, u.name from users u
      join employees e on e.user_id = u.id and e.organization_id = ${organizationId}
        and e.deleted_at is null and e.deactivated_at is null
      where u.email = ${email} limit 1`;
    if (!row) throw new Error("Fant ikke den ansatte for e2e i Byggcon");
    return row;
  } finally {
    await sql.end();
  }
}

/**
 * Oppgavene som kjøres i egen prosess (`runNodeTask`). Bare for e2e. Hver oppgave laster
 * modulene i `src/` selv, med dynamisk import, så Playwright-prosessen ikke laster dem.
 */
export const E2E_NODE_TASKS = {
  /**
   * Sørger for at Byggcon har en publisert systemmal for tilstandsrapport med badet, slik
   * organisasjonen har i drift; uten den fyller `pnpm db:seed:testdata` ikke ut badene. Bruker
   * maltjenestene med admin fra seed som aktør. Finnes en publisert systemmal alt, endres
   * ingenting. Sletter ingenting.
   */
  async ensureByggconTemplate(input: NodeTaskInput): Promise<"created" | "existing"> {
    const { db } = await import("../src/db/client");
    const { findTestdataOrganization } = await import("../src/db/seed/testdata-anchor");
    const { wetRoomTemplate } = await import("../src/db/seed/templates/wet-room");
    const templates = await import("../src/core/templates");
    const organization = await findTestdataOrganization(db);
    if (!organization) throw new Error("Fant ikke Byggcon (kjør pnpm db:seed)");
    const actor = await actorByEmail(String(input.adminEmail), organization.id);
    const isSystemReport = (family: { kind: string; reportType: string }) =>
      family.kind === "system" && family.reportType === "condition_report";
    let families = (await templates.listTemplateFamilies(actor, organization.id)).filter(
      isSystemReport,
    );
    if (families.some((family) => family.versions.some((v) => v.status === "published"))) {
      return "existing";
    }
    const parsed = templates.parseTemplateDocument(wetRoomTemplate);
    if (!parsed.success) throw new Error("Malen for badet er ugyldig");
    const now = new Date();
    if (families.length === 0) {
      await templates.createTemplateFamily(actor, organization.id, {
        name: "Tilstandsrapport bolig",
        kind: "system",
        report_type: "condition_report",
      });
      families = (await templates.listTemplateFamilies(actor, organization.id)).filter(
        isSystemReport,
      );
    }
    const family = families[0];
    if (!family) throw new Error("Fant ikke malfamilien etter at den ble laget");
    // Et utkast som finnes (også fra en avbrutt kjøring), brukes; ellers lages et nytt
    const draft = family.versions.find((version) => version.status === "draft");
    const versionId =
      draft?.id ??
      (await templates.createDraftVersion(actor, organization.id, family.id, now)).versionId;
    await templates.saveDraftContent(actor, organization.id, versionId, parsed.document, now);
    await templates.publishVersion(
      actor,
      organization.id,
      versionId,
      "Lagt inn av e2e i testdatabasen. Tekstene er utkast, ikke godkjent av fagrådet.",
      now,
    );
    return "created";
  },

  /** Visningsbadet og badene i testoppdragene i Byggcon, fra oppslagene i seed-modulen. */
  async testdataBaths(): Promise<{
    showcase: E2eTestdataBath | null;
    reports: (E2eTestdataBath & { assignmentStatus: string })[];
  }> {
    const { db } = await import("../src/db/client");
    const { findTestdataOrganization } = await import("../src/db/seed/testdata-anchor");
    const { findShowcaseBathReport, findTestdataBathReports } =
      await import("../src/db/seed/testdata-bath");
    const organization = await findTestdataOrganization(db);
    if (!organization) throw new Error("Fant ikke Byggcon (kjør pnpm db:seed)");
    const showcase = await findShowcaseBathReport(db, organization.id);
    const reports = await findTestdataBathReports(db, organization.id);
    return {
      showcase: showcase && {
        reportId: showcase.reportId,
        assignmentId: showcase.assignmentId,
        assignmentNumber: showcase.assignmentNumber,
        roomId: showcase.roomId,
        roomName: showcase.roomName,
      },
      reports: reports.map((row) => ({
        reportId: row.reportId,
        assignmentId: row.assignmentId,
        assignmentNumber: row.assignmentNumber,
        assignmentStatus: row.assignmentStatus,
        roomId: row.roomId,
        roomName: row.roomName,
      })),
    };
  },

  /**
   * Setter svaret på feltet tilbake til tomt med `saveField` (aldri sletting), som den ansatte
   * med e-posten. Brukes for å gjenopprette visningsbadet etter at en test har lagret et svar.
   * Har feltet ikke noe svar, gjøres ingenting.
   */
  async clearFieldAnswer(input: NodeTaskInput): Promise<"saved" | "nothing"> {
    const { db } = await import("../src/db/client");
    const { findTestdataOrganization } = await import("../src/db/seed/testdata-anchor");
    const { getRoomView } = await import("../src/core/reports/room-view");
    const { saveField } = await import("../src/core/reports/save-field");
    const organization = await findTestdataOrganization(db);
    if (!organization) throw new Error("Fant ikke Byggcon (kjør pnpm db:seed)");
    const actor = await actorByEmail(String(input.email), organization.id);
    const room = { assignmentId: String(input.assignmentId), roomId: String(input.roomId) };
    const view = await getRoomView(actor, organization.id, room);
    if (view.state !== "started") throw new Error("Rapporten i badet er ikke startet");
    const answer = view.answers.find((a) => a.elementKey === input.elementKey);
    if (!answer) return "nothing";
    const result = await saveField(actor, organization.id, room, {
      table: "field_answers",
      id: answer.id,
      elementKey: answer.elementKey,
      field: "value",
      value: { text: null, number: null, optionKeys: null },
      base: answer.value,
    });
    if (result.status !== "saved") {
      throw new Error("Svaret ble ikke satt tilbake (endret av andre)");
    }
    return "saved";
  },
} as const;

type NodeTaskName = keyof typeof E2E_NODE_TASKS;

/**
 * Kjører en oppgave fra `E2E_NODE_TASKS` i en egen `tsx`-prosess mot e2e-databasen og gir svaret
 * tilbake. Bare lokal database eller testdatabasen (`assertLocalOrTestDatabase`), og
 * `APP_ENVIRONMENT=test`. Feilmeldingen har bare utskriften fra prosessen, og oppgavene skriver
 * bare id-er og koder.
 */
function runNodeTask<T>(name: NodeTaskName, input: NodeTaskInput = {}): T {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const helpersUrl = pathToFileURL(path.join(process.cwd(), "e2e/helpers.ts")).href;
  const marker = "E2E_NODE_TASK_RESULT:";
  const script = `
    (async () => {
      await import("dotenv/config");
      const { E2E_NODE_TASKS } = await import(${JSON.stringify(helpersUrl)});
      const input = JSON.parse(process.env.E2E_NODE_TASK_INPUT ?? "{}");
      const result = await E2E_NODE_TASKS[${JSON.stringify(name)}](input);
      process.stdout.write("\\n${marker}" + JSON.stringify(result ?? null) + "\\n");
      process.exit(0);
    })().catch((error) => {
      console.error(error instanceof Error ? error.name + ": " + error.message : String(error));
      process.exit(1);
    });`;
  const result = spawnSync(path.join(process.cwd(), "node_modules/.bin/tsx"), ["--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      APP_ENVIRONMENT: "test",
      E2E_NODE_TASK_INPUT: JSON.stringify(input),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  const line = (result.stdout ?? "").split("\n").find((entry) => entry.startsWith(marker));
  if (result.status !== 0 || line === undefined) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000);
    throw new Error(`E2e-oppgaven ${name} feilet (kode ${result.status}): ${output}`);
  }
  return JSON.parse(line.slice(marker.length)) as T;
}

/**
 * Gjør testmiljøet klart for testdata del 2: publisert systemmal i Byggcon (som i drift) og
 * `pnpm db:seed:testdata`. Andre kjøring skriver ingenting (A508).
 */
export function seedTestdataBathsForE2e(): void {
  runNodeTask("ensureByggconTemplate", { adminEmail: ADMIN_EMAIL });
  seedTestdataForE2e();
}

/** Visningsbadet, funnet med `findShowcaseBathReport` (under arbeid, TG3 og TGIU i samme bad). */
export function findE2eShowcaseBath(): E2eTestdataBath {
  const { showcase } = runNodeTask<{ showcase: E2eTestdataBath | null }>("testdataBaths");
  if (!showcase) {
    throw new Error("Fant ikke visningsbadet etter pnpm db:seed:testdata (findShowcaseBathReport)");
  }
  return showcase;
}

/**
 * Badene testene trenger, funnet på innholdet med `findTestdataBathReports`:
 * - `no_deviations`: ferdig eller fakturert, 8 punkt ferdige, sju med TG1, tilliggende med TG0,
 *   ingen avvik og ingen TGIU.
 * - `done_with_tgiu` og `done_with_tg3`: ferdig eller fakturert, 8 punkt ferdige, med TGIU eller
 *   med et avvik med TG3.
 * - `rejected_measured_again`: under arbeid, med et regelforslag avvist med `measured_again`.
 * - `unknown_build_year`: under arbeid, med «Ukjent» som kilde for byggeåret.
 */
export type E2eTestdataBathKind =
  | "no_deviations"
  | "done_with_tgiu"
  | "done_with_tg3"
  | "rejected_measured_again"
  | "unknown_build_year";

type BathFacts = {
  report_id: string;
  room_id: string;
  done_count: number;
  tg1_count: number;
  adjacent_tg0: boolean;
  has_tgiu: boolean;
  deviation_count: number;
  has_tg3: boolean;
  rejected_measured_again: boolean;
  unknown_build_year: boolean;
};

const DONE_ASSIGNMENT_STATUSES = new Set(["completed", "invoiced"]);

function matchesBathKind(kind: E2eTestdataBathKind, status: string, facts: BathFacts): boolean {
  const done = DONE_ASSIGNMENT_STATUSES.has(status) && facts.done_count === 8;
  switch (kind) {
    case "no_deviations":
      return (
        done &&
        facts.tg1_count === 7 &&
        facts.adjacent_tg0 &&
        facts.deviation_count === 0 &&
        !facts.has_tgiu
      );
    case "done_with_tgiu":
      return done && facts.has_tgiu;
    case "done_with_tg3":
      return done && facts.has_tg3;
    case "rejected_measured_again":
      return status === "in_progress" && facts.rejected_measured_again;
    case "unknown_build_year":
      return status === "in_progress" && facts.unknown_build_year;
  }
}

/** Det første badet (etter oppdragsnummer) som passer innholdet. Kaster når ingen passer. */
export async function findE2eTestdataBath(kind: E2eTestdataBathKind): Promise<E2eTestdataBath> {
  const { reports } = runNodeTask<{
    reports: (E2eTestdataBath & { assignmentStatus: string })[];
  }>("testdataBaths");
  if (reports.length === 0) throw new Error("Ingen bad i testoppdragene (pnpm db:seed:testdata)");
  const sql = e2eSql();
  try {
    const facts = await sql<BathFacts[]>`
      select x.report_id, x.room_id,
        (select count(*) from checkpoint_results c where c.report_id = x.report_id
          and c.room_id = x.room_id and c.deleted_at is null and c.done)::int as done_count,
        (select count(*) from checkpoint_results c where c.report_id = x.report_id
          and c.room_id = x.room_id and c.deleted_at is null and c.done
          and c.tg_direct = '1')::int as tg1_count,
        exists (select 1 from checkpoint_results c join checkpoints k on k.id = c.checkpoint_id
          where c.report_id = x.report_id and c.room_id = x.room_id and c.deleted_at is null
            and c.done and k.key = 'wet_room.adjacent' and c.tg_direct = '0') as adjacent_tg0,
        exists (select 1 from checkpoint_results c where c.report_id = x.report_id
          and c.room_id = x.room_id and c.deleted_at is null and c.tg_direct = 'IU') as has_tgiu,
        (select count(*) from deviations d
          join checkpoint_results c on c.id = d.checkpoint_result_id
          where d.report_id = x.report_id and c.room_id = x.room_id
            and d.deleted_at is null)::int as deviation_count,
        exists (select 1 from deviations d
          join checkpoint_results c on c.id = d.checkpoint_result_id
          where d.report_id = x.report_id and c.room_id = x.room_id and d.deleted_at is null
            and d.kind = 'tg' and d.tg = 3) as has_tg3,
        exists (select 1 from rule_suggestion_decisions r
          join checkpoint_results c on c.id = r.checkpoint_result_id
          where r.report_id = x.report_id and c.room_id = x.room_id and r.deleted_at is null
            and r.decision = 'rejected'
            and r.override_reason_code = 'measured_again') as rejected_measured_again,
        exists (select 1 from field_answers f join template_elements e on e.id = f.element_id
          where f.report_id = x.report_id and f.room_id = x.room_id and f.deleted_at is null
            and e.key = 'wet_room.build_year_source'
            and ('unknown' = any(f.value_option_keys) or f.value_text = 'unknown'))
          as unknown_build_year
      from unnest(string_to_array(${reports.map((r) => r.reportId).join(",")}, ',')::uuid[],
        string_to_array(${reports.map((r) => r.roomId).join(",")}, ',')::uuid[])
        as x(report_id, room_id)`;
    const byKey = new Map(facts.map((row) => [`${row.report_id}|${row.room_id}`, row]));
    const found = reports.find((report) => {
      const row = byKey.get(`${report.reportId}|${report.roomId}`);
      return row !== undefined && matchesBathKind(kind, report.assignmentStatus, row);
    });
    if (!found) throw new Error(`Fant ikke et bad av typen ${kind} i testoppdragene`);
    return {
      reportId: found.reportId,
      assignmentId: found.assignmentId,
      assignmentNumber: found.assignmentNumber,
      roomId: found.roomId,
      roomName: found.roomName,
    };
  } finally {
    await sql.end();
  }
}

/** Adressen til badskjermen for et bad i testoppdragene, eventuelt med et punkt åpent. */
export function testdataBathUrl(bath: E2eTestdataBath, punkt?: string): string {
  const base = `/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`;
  return punkt ? `${base}?punkt=${encodeURIComponent(punkt)}` : base;
}

/** Et avvik i badet slik det står i databasen: koder og teksten fra testdataene. */
export type E2eBathDeviation = {
  checkpointKey: string;
  kind: "tg" | "hms";
  tg: number | null;
  textSource: string;
  deviationText: string | null;
  costType: string;
  costBandKey: string | null;
};

/** Avvikene i badet (uten myk-slettede). Bare lesing. */
export async function testdataBathDeviations(bath: E2eTestdataBath): Promise<E2eBathDeviation[]> {
  const sql = e2eSql();
  try {
    const rows = await sql<
      {
        checkpoint_key: string;
        kind: "tg" | "hms";
        tg: number | null;
        text_source: string;
        deviation_text: string | null;
        cost_type: string;
        cost_band_key: string | null;
      }[]
    >`
      select k.key as checkpoint_key, d.kind, d.tg, d.text_source, d.deviation_text, d.cost_type,
        d.cost_band_key
      from deviations d
      join checkpoint_results c on c.id = d.checkpoint_result_id
      join checkpoints k on k.id = c.checkpoint_id
      where d.report_id = ${bath.reportId} and c.room_id = ${bath.roomId}
        and d.deleted_at is null
      order by k.key, d.sort_order`;
    return rows.map((row) => ({
      checkpointKey: row.checkpoint_key,
      kind: row.kind,
      tg: row.tg,
      textSource: row.text_source,
      deviationText: row.deviation_text,
      costType: row.cost_type,
      costBandKey: row.cost_band_key,
    }));
  } finally {
    await sql.end();
  }
}

/** Valgene i svaret på feltet i badet, eller `null` når svaret mangler eller er tomt. Bare lesing. */
export async function testdataBathAnswer(
  bath: E2eTestdataBath,
  elementKey: string,
): Promise<string[] | null> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ value_option_keys: string[] | null; value_text: string | null }[]>`
      select f.value_option_keys, f.value_text
      from field_answers f join template_elements e on e.id = f.element_id
      where f.report_id = ${bath.reportId} and f.room_id = ${bath.roomId}
        and f.deleted_at is null and e.key = ${elementKey}
      limit 1`;
    if (!row) return null;
    if (row.value_option_keys && row.value_option_keys.length > 0) return row.value_option_keys;
    return row.value_text ? [row.value_text] : null;
  } finally {
    await sql.end();
  }
}

/** Om punktet i badet står ferdig. Bare lesing. */
export async function testdataBathCheckpointDone(
  bath: E2eTestdataBath,
  checkpointKey: string,
): Promise<boolean> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ done: boolean }[]>`
      select c.done from checkpoint_results c join checkpoints k on k.id = c.checkpoint_id
      where c.report_id = ${bath.reportId} and c.room_id = ${bath.roomId}
        and c.deleted_at is null and k.key = ${checkpointKey}
      limit 1`;
    return row?.done ?? false;
  } finally {
    await sql.end();
  }
}

/** Setter svaret på feltet tilbake til tomt med `saveField` som den ansatte (aldri sletting). */
export function clearTestdataBathAnswer(
  bath: E2eTestdataBath,
  elementKey: string,
  email: string,
): void {
  runNodeTask("clearFieldAnswer", {
    assignmentId: bath.assignmentId,
    roomId: bath.roomId,
    elementKey,
    email,
  });
}
