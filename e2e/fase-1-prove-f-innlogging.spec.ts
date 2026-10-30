import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  createTrialForm,
  e2eDatabaseUrl,
  indicator,
  logIn,
  logInAsInspector,
  pendingChanges,
  queryLocal,
  syncNowButton,
  syncStatus,
  useCandidate,
  waitForTrialHook,
  type RecordedRequest,
} from "./helpers";

// Prøve F – innlogging som har gått ut (docs/funksjoner/fase1-prove-f-innlogging.md).
// Testplan: docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 2. Støtter reklamasjoner
// (ingenting fra befaringen går tapt fordi innloggingen gikk ut uten nett) og tid (rett tilbake til
// skjemaet etter innlogging). Chromium, standardkandidaten PowerSync. Testene leser markøren
// `data-sync-state` på synkstatusen og venter på den, aldri på faste pauser (unntatt de 15
// sekundene i 2.2, som er selve målingen).
//
// Slik går innloggingen ut i testene (avgjørelse 2 i kortet):
// - Takstmannen: `expires_at` settes til passert tid bare på hans egen økt (token fra
//   informasjonskapselen). Ekte utløp: nettleseren sender kapselen, men serveren har ingen gyldig
//   økt. Aldri admin-økter, fordi andre tester bruker admin.
// - Admin: `context.clearCookies()`, det samme som «Logg ut» på ekte iPad (A6).
//
// PowerSync i e2e (som i fase-1-powersync.spec.ts og fase-1-synkstatus.spec.ts): det finnes ingen
// PowerSync-tjeneste, så SDK-en sender ikke køen av seg selv, og serveren kan aldri bekrefte en
// henting. «Synk nå» sender køen gjennom vår egen rute uten tjenesten. Derfor trykkes «Synk nå»
// etter innloggingen, og sluttilstanden er «Venter på kontakt med serveren» (awaitingServer), ikke
// «Alt er lagret». At alt er kommet fram, sjekkes i testdatabasen. Avvik fra testplanen 2.1 trinn
// 11 og 2.2 trinn 5, se testrapporten.
//
// Alle data er oppdiktet.

const TEST_IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "test-image.png",
);

const SIGN_IN_TEXT = "Logg inn på nytt for å sende. Alt er lagret på iPaden.";
const SESSION_PATH = "/api/auth/get-session";
const SESSION_ROUTE = `**${SESSION_PATH}`;
const FLOORS = "Antall etasjer";
const TEXT = "Generell beskrivelse";
const PHOTO = "Forsidebilde";
const TEXT_VALUE = "Oppdiktet tekst skrevet uten nett med utløpt innlogging";
const FLOORS_VALUE = 3;
const EVIL = "//evil.example";

function pcOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "pc", "Kjøres bare i pc (testplan 2.2–2.4)");
}

function counter(page: Page): Locator {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

/** Lenken «Logg inn» i synkstatusen (står der «Synk nå» sto). */
function signInLink(page: Page): Locator {
  return syncStatus(page).getByRole("link", { name: "Logg inn", exact: true });
}

function formPath(formId: string): string {
  return `/prove/testskjema/${formId}`;
}

/** Adressen er innloggingssiden med `neste` lik stien (kodet eller ikke). */
function expectSignInUrl(page: Page, next: string) {
  return expect
    .poll(() => {
      const url = new URL(page.url());
      return { path: url.pathname, neste: url.searchParams.get("neste"), hash: url.hash };
    })
    .toEqual({ path: "/logg-inn", neste: next, hash: "" });
}

/** Teller kall til `get-session` fra alle sidene i konteksten. */
function countSessionChecks(context: BrowserContext) {
  const requests: RecordedRequest[] = [];
  const byRequest = new Map<unknown, RecordedRequest>();
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== SESSION_PATH) return;
    const entry: RecordedRequest = { url, status: null };
    requests.push(entry);
    byRequest.set(request, entry);
  });
  context.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  context.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.status = 0;
  });
  return {
    count: () => requests.length,
    /** Alle kall har fått svar eller feilet. */
    allDone: () => requests.every((entry) => entry.status !== null),
  };
}

/** Skriver e-post og kode på innloggingssiden som allerede er åpen (med `neste`). */
async function enterCode(page: Page, email: string) {
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

/** Kobler til e2e-databasen, bare lokal eller testdatabasen. */
function openDatabase() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/**
 * Setter innloggingen som utløpt bare for denne konteksten: finner økten fra informasjonskapselen
 * (`token.signatur`) og setter `expires_at` til passert tid. Rører aldri andre økter.
 */
async function expireOwnSession(context: BrowserContext) {
  const cookie = (await context.cookies()).find((entry) => entry.name.endsWith("session_token"));
  if (!cookie) throw new Error("Fant ingen innloggingskapsel");
  const token = decodeURIComponent(cookie.value).split(".")[0];
  if (!token) throw new Error("Innloggingskapselen mangler token");
  const sql = openDatabase();
  try {
    const rows = await sql<{ email: string }[]>`
      update sessions s set expires_at = now() - interval '1 minute'
      from users u
      where s.token = ${token} and u.id = s.user_id
      returning u.email`;
    expect(rows, "nøyaktig én økt, takstmannens egen").toHaveLength(1);
    expect(rows[0]!.email).toBe(INSPECTOR_EMAIL);
  } finally {
    await sql.end();
  }
}

interface ServerAnswer {
  field_key: string;
  value: unknown;
  organization_id: string;
}

/** Svar, bilder og skjema på serveren for skjemaet (ikke slettede rader). */
async function serverRows(formId: string) {
  const sql = openDatabase();
  try {
    const answers = await sql<ServerAnswer[]>`
      select field_key, value, organization_id from trial_answers
      where trial_form_id = ${formId} and deleted_at is null
      order by field_key`;
    const photos = await sql<
      { field_key: string; sha256: string | null; organization_id: string }[]
    >`
      select field_key, sha256, organization_id from trial_photos
      where trial_form_id = ${formId} and deleted_at is null`;
    const forms = await sql<{ organization_id: string }[]>`
      select organization_id from trial_forms where id = ${formId} and deleted_at is null`;
    return { answers, photos, forms };
  } finally {
    await sql.end();
  }
}

async function organizationOf(email: string): Promise<string> {
  const sql = openDatabase();
  try {
    const [row] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e join users u on u.id = e.user_id
      where u.email = ${email} and e.deleted_at is null and e.deactivated_at is null
      limit 1`;
    if (!row) throw new Error(`Fant ingen ansatt for ${email}`);
    return row.organization_id;
  } finally {
    await sql.end();
  }
}

/** Service worker klar, og siden og listen ligger i hurtiglageret (åpnet med nett). */
async function cacheListAndForm(page: Page, formId: string) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Siden må styres av service worker før kopiene lages
  await page.reload();
  await expect(counter(page)).toBeVisible();
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await page.goto(formPath(formId));
  await expect(counter(page)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          async (paths) => {
            const hits = await Promise.all(paths.map((entry) => caches.match(entry)));
            return hits.every(Boolean);
          },
          ["/prove/testskjema", formPath(formId)],
        ),
      { timeout: 15_000, message: "listen og skjemaet ligger i hurtiglageret" },
    )
    .toBe(true);
}

async function expectFormContent(page: Page, formId: string) {
  await expect(page.getByLabel(FLOORS, { exact: true })).toHaveValue(String(FLOORS_VALUE));
  await expect(page.getByLabel(TEXT, { exact: true })).toHaveValue(TEXT_VALUE);
  await expect(counter(page)).toHaveText("3 av 40 felt utfylt");
  await expect
    .poll(
      async () =>
        (await queryLocal(page, "SELECT id FROM trial_photos WHERE trial_form_id = ?", [formId]))
          .length,
    )
    .toBe(1);
}

test.beforeEach(async ({ context }) => {
  await useCandidate(context, "powersync");
});

// --- 2.1 Hovedflyt som takstmann (pc og ipad) ---

test("innlogging utløpt uten nett: skjemaet åpnes og fylles ut, Logg inn når nettet kommer, alt synkes etter innlogging", async ({
  page: firstPage,
  context,
}, testInfo) => {
  test.setTimeout(240_000);

  // 1. Takstmann, nytt skjema, listen og skjemaet åpnet med nett
  await logInAsInspector(firstPage);
  const formId = await createTrialForm(firstPage);
  await cacheListAndForm(firstPage, formId);
  await waitForTrialHook(firstPage);
  await expect(syncStatus(firstPage)).toHaveAttribute(
    "data-sync-state",
    /^(pending|awaitingServer|allSaved)$/,
  );
  await expect(signInLink(firstPage)).toHaveCount(0);

  // 2. Telling av sjekker starter
  const checks = countSessionChecks(context);

  // 3. Egen økt utløpt
  await expireOwnSession(context);

  let form: Page = firstPage;
  let list: Page | null = null;
  try {
    // 4. Uten nett: skjemaet åpnes fra kopien, ingen melding om innlogging
    await context.setOffline(true);
    const checksBeforeOffline = checks.count();
    await firstPage.reload();
    await expect(counter(firstPage)).toHaveText("0 av 40 felt utfylt");
    await expect(syncStatus(firstPage)).toHaveAttribute("data-sync-state", "offline");
    await expect(signInLink(firstPage)).toHaveCount(0);

    // 5. Fyller ut svar og ett bilde, lukker og åpner på nytt uten nett
    const floors = firstPage.getByLabel(FLOORS, { exact: true });
    await floors.fill(String(FLOORS_VALUE));
    await floors.blur();
    await firstPage.getByLabel(TEXT, { exact: true }).fill(TEXT_VALUE);
    await firstPage.getByLabel(PHOTO, { exact: true }).setInputFiles(TEST_IMAGE);
    await expectFormContent(firstPage, formId);
    await firstPage.close();

    form = await context.newPage();
    await form.goto(formPath(formId));
    await expectFormContent(form, formId);
    await expect(syncStatus(form)).toHaveAttribute("data-sync-state", "offline");
    await expect(signInLink(form)).toHaveCount(0);

    list = await context.newPage();
    await list.goto("/prove/testskjema");
    await expect(list.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    await expect(syncStatus(list)).toHaveAttribute("data-sync-state", "offline");

    // 6. Ingen sjekk av innloggingen uten nett
    expect(checks.count() - checksBeforeOffline, "kall til get-session uten nett").toBe(0);
  } finally {
    // 7. Nettet kommer
    await context.setOffline(false);
  }

  await expect(syncStatus(form)).toHaveAttribute("data-sync-state", "signInRequired", {
    timeout: 15_000,
  });
  await expect(indicator(form)).toHaveText(SIGN_IN_TEXT);
  await expect(indicator(form)).toHaveAttribute("role", "status");
  await expect(signInLink(form)).toBeVisible();
  await expect(syncNowButton(form)).toHaveCount(0);
  await expect(form.getByLabel(FLOORS, { exact: true })).toHaveValue(String(FLOORS_VALUE));
  await expect(form.getByLabel(TEXT, { exact: true })).toHaveValue(TEXT_VALUE);
  await expect(syncStatus(list!)).toHaveAttribute("data-sync-state", "signInRequired", {
    timeout: 15_000,
  });
  await expect(signInLink(list!)).toBeVisible();
  await expect(syncNowButton(list!)).toHaveCount(0);

  // 8. Serveren har ingenting fått, køen venter
  const before = await serverRows(formId);
  expect(before.answers, "ingen svar på serveren før innlogging").toEqual([]);
  expect(before.photos, "ingen bilder på serveren før innlogging").toEqual([]);
  expect(await pendingChanges(form)).toBeGreaterThan(0);

  // 9. Bare ipad: «Logg inn» er minst 44 px høy i skjemaet og på listen
  if (testInfo.project.name === "ipad") {
    for (const [where, target] of [
      ["skjemaet", form],
      ["listen", list!],
    ] as const) {
      const box = await signInLink(target).boundingBox();
      expect(box, where).not.toBeNull();
      expect(box!.height, `høyde på Logg inn i ${where}`).toBeGreaterThanOrEqual(44);
    }
  }
  await list!.close();

  // 10. «Logg inn» går til innloggingssiden med neste = skjemaet
  await signInLink(form).click();
  await expectSignInUrl(form, formPath(formId));
  await enterCode(form, INSPECTOR_EMAIL);

  // 11. Tilbake i samme skjema
  await expect(form).toHaveURL(new RegExp(`${formPath(formId)}$`));
  await waitForTrialHook(form);
  await expectFormContent(form, formId);
  await expect(syncStatus(form)).not.toHaveAttribute("data-sync-state", "signInRequired");
  // PowerSync uten tjeneste i e2e sender ikke køen av seg selv (se toppen av filen)
  await syncNowButton(form).click();
  await expect
    .poll(() => pendingChanges(form), { timeout: 30_000, message: "køen tømmes" })
    .toBe(0);
  await expect(syncStatus(form)).toHaveAttribute("data-sync-state", /^(allSaved|awaitingServer)$/, {
    timeout: 30_000,
  });
  await expect(signInLink(form)).toHaveCount(0);

  // 12. Alt finnes på serveren, nøyaktig én gang, i takstmannens organisasjon
  const organizationId = await organizationOf(INSPECTOR_EMAIL);
  await expect
    .poll(async () => (await serverRows(formId)).photos.filter((row) => row.sha256).length, {
      timeout: 30_000,
      message: "bildet er lastet opp",
    })
    .toBe(1);
  const after = await serverRows(formId);
  expect(after.forms.map((row) => row.organization_id)).toEqual([organizationId]);
  const byField = new Map(after.answers.map((row) => [row.field_key, row]));
  expect(after.answers.map((row) => row.field_key).sort(), "ingen doble svar").toEqual(
    [...new Set(after.answers.map((row) => row.field_key))].sort(),
  );
  expect(byField.get("floors")?.value).toBe(FLOORS_VALUE);
  expect(byField.get("general_description")?.value).toBe(TEXT_VALUE);
  // Bildet er en rad i trial_photos (ikke et svar i trial_answers)
  expect(after.answers.map((row) => row.field_key).sort()).toEqual([
    "floors",
    "general_description",
  ]);
  expect(after.photos).toHaveLength(1);
  expect(after.photos[0]!.field_key).toBe("cover_photo");
  for (const row of [...after.answers, ...after.photos]) {
    expect(row.organization_id).toBe(organizationId);
  }
  expect(await pendingChanges(form)).toBe(0);
});

// --- 2.2 Admin, «Synk nå» og ingen sjekk uten grunn (pc) ---

test("admin: ingen sjekk uten grunn, Synk nå gir Logg inn, og admin havner i skjemaet etter innlogging", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  test.setTimeout(180_000);
  await logIn(page, ADMIN_EMAIL);
  const formId = await createTrialForm(page);
  await waitForTrialHook(page);
  await expect(syncStatus(page)).toHaveAttribute(
    "data-sync-state",
    /^(pending|awaitingServer|allSaved)$/,
  );

  // 1. 15 sekunder med nett uten noe som utløser: ingen sjekk (selve målingen, derfor fast tid)
  const checks = countSessionChecks(context);
  await page.waitForTimeout(15_000);
  expect(checks.count(), "kall til get-session uten utløser").toBe(0);

  // 2. Ett svar uten nett, så køen har noe
  await context.setOffline(true);
  try {
    await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "offline");
    const floors = page.getByLabel(FLOORS, { exact: true });
    await floors.fill("2");
    await floors.blur();
    await expect(counter(page)).toHaveText("1 av 40 felt utfylt");

    // 3. Det samme som «Logg ut» på ekte iPad (A6): nettleseren sender ingen kapsel. Kapsel som har
    //    gått ut, dekkes av hovedflyten.
    await context.clearCookies();
    expect(checks.count(), "kall til get-session uten nett").toBe(0);

    // Sjekkene som `online` og overgangen til nett utløser, får nettverksfeil (gir `unknown`, ingen
    // melding). Da er det «Synk nå» som gir meldingen under.
    await context.route(SESSION_ROUTE, (route) => route.abort());
  } finally {
    await context.setOffline(false);
  }

  // 4. Nettet er tilbake, men ingen melding før «Synk nå»
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "pending", { timeout: 15_000 });
  await expect
    .poll(() => checks.allDone(), { message: "sjekkene etter online er ferdige" })
    .toBe(true);
  await context.unroute(SESSION_ROUTE);
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "pending");
  const beforeSyncNow = checks.count();
  await syncNowButton(page).click();
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "signInRequired", {
    timeout: 20_000,
  });
  expect(checks.count(), "Synk nå utløste en sjekk").toBeGreaterThan(beforeSyncNow);
  await expect(syncNowButton(page)).toHaveCount(0);
  await expect(signInLink(page)).toBeVisible();
  await expect(page.getByLabel(FLOORS, { exact: true })).toHaveValue("2");

  // 5. «Logg inn», kode, tilbake i skjemaet. Admin stenges ikke ute.
  await signInLink(page).click();
  await expectSignInUrl(page, formPath(formId));
  await enterCode(page, ADMIN_EMAIL);
  await expect(page).toHaveURL(new RegExp(`${formPath(formId)}$`));
  await waitForTrialHook(page);
  await expect(page.getByLabel(FLOORS, { exact: true })).toHaveValue("2");
  await expect(syncStatus(page)).not.toHaveAttribute("data-sync-state", "signInRequired");
  // PowerSync uten tjeneste i e2e sender ikke køen av seg selv (se toppen av filen)
  await syncNowButton(page).click();
  await expect
    .poll(() => pendingChanges(page), { timeout: 30_000, message: "køen tømmes" })
    .toBe(0);
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", /^(allSaved|awaitingServer)$/, {
    timeout: 30_000,
  });
  const organizationId = await organizationOf(ADMIN_EMAIL);
  const rows = await serverRows(formId);
  const floorsRow = rows.answers.find((row) => row.field_key === "floors");
  expect(floorsRow?.value).toBe(2);
  expect(floorsRow?.organization_id).toBe(organizationId);
});

// --- 2.3 Kopien av skjemaet blir ikke ødelagt (pc) ---

test("omdirigering til innlogging lagres ikke som kopi av skjemaet", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await logInAsInspector(page);
  const formId = await createTrialForm(page);
  await cacheListAndForm(page, formId);

  await expireOwnSession(context);
  // Med nett sender serveren til innlogging (requireActor)
  await page.goto(formPath(formId));
  await expect(page).toHaveURL(/\/logg-inn(\?|$)/);
  await expect(page.getByLabel("E-postadresse")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.goto(formPath(formId));
    await expect(page).toHaveURL(new RegExp(`${formPath(formId)}$`));
    await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
    await expect(page.getByLabel("E-postadresse")).toHaveCount(0);
    await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "offline");
    const cached = await page.evaluate(async (target) => {
      const hit = await caches.match(target);
      if (!hit) return null;
      return { redirected: hit.redirected, url: hit.url, body: await hit.text() };
    }, formPath(formId));
    expect(cached, "kopien finnes").not.toBeNull();
    expect(cached!.redirected).toBe(false);
    expect(new URL(cached!.url).pathname).toBe(formPath(formId));
    expect(cached!.body).not.toContain("Send meg en kode");
  } finally {
    await context.setOffline(false);
  }
});

// --- 2.4 `neste` på begge veier (pc) ---

test.describe("neste på innloggingssiden", () => {
  test("allerede innlogget: trygg sti går til skjemaet, //evil.example går til arbeidskøen", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    await logInAsInspector(page);
    const formId = await createTrialForm(page);

    await page.goto(`/logg-inn?neste=${encodeURIComponent(formPath(formId))}`);
    await expect(page).toHaveURL(new RegExp(`^http://localhost:\\d+${formPath(formId)}$`));

    await page.goto(`/logg-inn?neste=${encodeURIComponent(EVIL)}`);
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/arbeidskoe$/);
  });

  test("ikke innlogget: etter koden går trygg sti til skjemaet, //evil.example til arbeidskøen", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await logInAsInspector(page);
    const formId = await createTrialForm(page);

    await context.clearCookies();
    await page.goto(`/logg-inn?neste=${encodeURIComponent(formPath(formId))}`);
    await enterCode(page, INSPECTOR_EMAIL);
    await expect(page).toHaveURL(new RegExp(`^http://localhost:\\d+${formPath(formId)}$`));

    await context.clearCookies();
    await page.goto(`/logg-inn?neste=${encodeURIComponent(EVIL)}`);
    await enterCode(page, INSPECTOR_EMAIL);
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/arbeidskoe$/);
  });
});
