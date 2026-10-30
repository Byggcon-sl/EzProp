import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  countRequests,
  createTrialForm,
  expireOwnSession,
  fieldSaved,
  indicator,
  logIn,
  logInAsInspector,
  organizationIdOf,
  pendingQueue,
  serverTrialData,
  signInWithCode,
  syncNowButton,
  syncStatus,
  useCandidate,
  waitForTrialHook,
} from "./helpers";

// Prøve F – innlogging som har gått ut (docs/funksjoner/fase1-prove-f-innlogging.md).
// Testplan: docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 2. Støtter reklamasjoner
// (ingenting fra befaringen går tapt når innloggingen går ut uten nett) og tid (rett tilbake til
// skjemaet etter ny innlogging). Chromium, standardkandidaten PowerSync.
//
// Testene leser markøren `data-sync-state` på `data-testid="sync-status"`, ikke norsk tekst
// (unntak: meldingen sjekkes ordrett én gang i 2.1). Ingen faste pauser, bortsett fra de 15
// sekundene i 2.2 som er selve målingen.
//
// PowerSync-tjenesten finnes ikke i e2e (se fase-1-synkstatus.spec.ts): serveren kan aldri
// bekrefte en henting, så «Alt er lagret» (`allSaved`) kan ikke nås her. Etter innlogging godtas
// derfor `allSaved` eller `awaitingServer` («Venter på kontakt med serveren») når køen er 0, og
// testdatabasen viser at alt kom fram. Uten tjenesten sender SDK-en heller ikke køen av seg selv,
// så testen trykker «Synk nå» én gang etter innlogging (samme vei som synkstatus-testene).
// Alle data er oppdiktet.

const TEST_IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "test-image.png",
);

const LIST_PATH = "/prove/testskjema";
const SESSION_ROUTE = "**/api/auth/get-session*";
const SIGN_IN_MESSAGE = "Logg inn på nytt for å sende. Alt er lagret på iPaden.";
/** Tilstandene som ikke er «Logg inn på nytt» når appen har nett. */
const ONLINE_NOT_SIGN_IN = /^(allSaved|pending|awaitingServer)$/;
/** Ferdig synket så langt e2e kan vise (se toppen av filen). */
const SAVED = /^(allSaved|awaitingServer)$/;
/** Meldingen skal komme innen ca. 10 s etter at nettet er tilbake (resultatmalen F3). */
const SIGN_IN_TIMEOUT = 15_000;

const TEXT_LABEL = "Generell beskrivelse";
const TEXT_KEY = "general_description";
const TEXT_VALUE = "Oppdiktet beskrivelse skrevet uten nett";
const NUMBER_LABEL = "Antall etasjer";
const NUMBER_KEY = "floors";
const PHOTO_LABEL = "Forsidebilde";
const PHOTO_KEY = "cover_photo";

function pcOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "pc", "Kjøres bare i pc (testplan 2.2–2.4)");
}

function formPath(formId: string): string {
  return `${LIST_PATH}/${formId}`;
}

function nextParam(formId: string): string {
  return encodeURIComponent(formPath(formId));
}

function counter(page: Page): Locator {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

function input(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

/** Lenken «Logg inn» i synkstatusen. */
function signInLink(page: Page): Locator {
  return syncStatus(page).getByRole("link", { name: "Logg inn", exact: true });
}

async function expectState(page: Page, state: string | RegExp, timeout?: number) {
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", state, { timeout });
}

/**
 * Venter til service workeren styrer siden og kopiene av listen og skjemaet ligger i
 * hurtiglageret (samme vei som prøve C og fase-1-powersync.spec.ts).
 */
async function cacheListAndForm(page: Page, formId: string) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(LIST_PATH);
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await page.goto(formPath(formId));
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
  await expect
    .poll(
      () =>
        page.evaluate(
          async (paths) =>
            Promise.all(paths.map(async (entry) => Boolean(await caches.match(entry)))),
          [LIST_PATH, formPath(formId)],
        ),
      { timeout: 15_000, message: "kopi av listen og skjemaet" },
    )
    .toEqual([true, true]);
}

/** Svarene fra 2.1 trinn 5 står i skjemaet. */
async function expectFormContent(page: Page) {
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await expect(input(page, TEXT_LABEL)).toHaveValue(TEXT_VALUE);
  await expect(input(page, NUMBER_LABEL)).toHaveValue("3");
  await expect(fieldSaved(page, PHOTO_LABEL).getByText("1 bilde", { exact: true })).toBeVisible();
  await expect(counter(page)).toHaveText("3 av 40 felt utfylt");
}

/**
 * Etter innlogging: synker til køen er 0. Uten PowerSync-tjenesten sendes svarene først etter
 * «Synk nå» (se toppen av filen); bildet sendes av bildekøen selv.
 */
async function syncAfterSignIn(page: Page, testInfo: TestInfo) {
  await waitForTrialHook(page);
  await expectState(page, ONLINE_NOT_SIGN_IN, SIGN_IN_TIMEOUT);
  if ((await pendingQueue(page)).changes > 0) {
    testInfo.annotations.push({
      type: "vei",
      description: "Synk nå etter innlogging (ingen tjeneste)",
    });
    await syncNowButton(page).click();
  }
  await expect
    .poll(() => pendingQueue(page), { timeout: 30_000, message: "køen er tom" })
    .toEqual({ changes: 0, photos: 0 });
  await expectState(page, SAVED);
  await expect(signInLink(page)).toHaveCount(0);
}

test.beforeEach(async ({ context }) => {
  await useCandidate(context, "powersync");
});

// --- 2.1 Hovedflyt som takstmann (pc og ipad) ---

test("2.1 takstmann med utløpt innlogging fyller ut uten nett, logger inn og alt synkes", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);

  // 1. Innlogget takstmann, kopi av listen og skjemaet lages med nett
  await logInAsInspector(page);
  const formId = await createTrialForm(page);
  await cacheListAndForm(page, formId);
  await waitForTrialHook(page);
  await expectState(page, ONLINE_NOT_SIGN_IN);

  // 2. Tell kall til sjekken av økten fra hver side som åpnes
  const sessionChecks = [countRequests(page, SESSION_ROUTE)];
  const totalChecks = () => sessionChecks.reduce((sum, counted) => sum + counted.count(), 0);

  // 3. Egen økt går ut (aldri admin-økter)
  await expireOwnSession(context);

  try {
    // 4. Uten nett åpnes skjemaet fra kopien, uten melding om innlogging
    // Samme som å laste siden på nytt; åpnes fra kopien i service workeren
    await context.setOffline(true);
    await page.goto(formPath(formId));
    await expect(page).toHaveURL(new RegExp(`${formPath(formId)}$`));
    await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
    await expectState(page, "offline");
    await expect(signInLink(page)).toHaveCount(0);

    // 5. Svar og ett bilde; lukk siden helt og åpne igjen uten nett
    await input(page, TEXT_LABEL).fill(TEXT_VALUE);
    const floors = input(page, NUMBER_LABEL);
    await floors.fill("3");
    await floors.blur();
    await input(page, PHOTO_LABEL).setInputFiles(TEST_IMAGE);
    for (const label of [TEXT_LABEL, NUMBER_LABEL, PHOTO_LABEL]) {
      await expect(fieldSaved(page, label), `${label} lagret`).toHaveAttribute(
        "data-field-saved",
        "yes",
      );
    }
    await expect(counter(page)).toHaveText("3 av 40 felt utfylt");
    await page.close();

    const form = await context.newPage();
    sessionChecks.push(countRequests(form, SESSION_ROUTE));
    await form.goto(formPath(formId));
    await expectFormContent(form);
    await expectState(form, "offline");

    // Listen i en tredje side, åpen når nettet kommer
    const list = await context.newPage();
    sessionChecks.push(countRequests(list, SESSION_ROUTE));
    await list.goto(LIST_PATH);
    await expect(list.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    await expectState(list, "offline");
    await expect(signInLink(list)).toHaveCount(0);

    // 6. Ingen sjekk av økten mens nettet var av
    expect(totalChecks(), "kall til get-session uten nett").toBe(0);

    // 7. Nettet kommer: «Logg inn på nytt», «Synk nå» skjult, svarene står
    await context.setOffline(false);
    for (const target of [form, list]) {
      await expectState(target, "signInRequired", SIGN_IN_TIMEOUT);
      await expect(signInLink(target)).toBeVisible();
      await expect(syncNowButton(target)).toBeHidden();
    }
    await expect(form.getByText(SIGN_IN_MESSAGE, { exact: true })).toHaveCount(1);
    await expect(form.getByText(SIGN_IN_MESSAGE, { exact: true })).toBeVisible();
    await expect(indicator(form)).toHaveText(SIGN_IN_MESSAGE);
    await expect(indicator(form)).toHaveAttribute("role", "status");
    await expect(signInLink(form)).toHaveAttribute("href", `/logg-inn?neste=${nextParam(formId)}`);
    await expectFormContent(form);
    // Telleren ser sjekken (ellers ville trinn 6 ikke bety noe)
    expect(totalChecks(), "kall til get-session med nett").toBeGreaterThan(0);

    // 8. Serveren har ingenting fra skjemaet ennå; køen på enheten venter
    const before = await serverTrialData(formId);
    expect(before.answers.filter((row) => [TEXT_KEY, NUMBER_KEY].includes(row.fieldKey))).toEqual(
      [],
    );
    expect(before.photos).toEqual([]);
    expect((await pendingQueue(form)).changes).toBeGreaterThan(0);

    // 9. iPad: «Logg inn» er minst 44 px høy i skjemaet og på listen
    if (testInfo.project.name === "ipad") {
      for (const [where, target] of [
        ["skjemaet", form],
        ["listen", list],
      ] as const) {
        const box = await signInLink(target).boundingBox();
        expect(box, where).not.toBeNull();
        expect(box!.height, where).toBeGreaterThanOrEqual(44);
      }
    }
    await list.close();

    // 10. «Logg inn» går til innloggingssiden med `neste`, kode fra utviklingspostkassen
    await signInLink(form).click();
    await expect(form).toHaveURL(new RegExp(`/logg-inn\\?neste=${nextParam(formId)}$`));
    await signInWithCode(form, INSPECTOR_EMAIL);

    // 11. Tilbake i samme skjema; den lokale lagringen er ikke tømt, og køen sendes
    await expect(form).toHaveURL(new RegExp(`${formPath(formId)}$`));
    await expectFormContent(form);
    await syncAfterSignIn(form, testInfo);

    // 12. Serveren har alle svar og nøyaktig ett bilde, i takstmannens organisasjon
    const organizationId = await organizationIdOf(INSPECTOR_EMAIL);
    await expect
      .poll(
        async () => {
          const data = await serverTrialData(formId);
          return data.photos.filter((photo) => photo.uploaded).length;
        },
        { timeout: 30_000, message: "bildet er lastet opp" },
      )
      .toBe(1);
    const after = await serverTrialData(formId);
    const keys = after.answers.map((row) => row.fieldKey);
    expect(new Set(keys).size, "ingen doble svar").toBe(keys.length);
    const byKey = new Map(after.answers.map((row) => [row.fieldKey, row]));
    expect(byKey.get(TEXT_KEY)?.value).toBe(TEXT_VALUE);
    expect(byKey.get(NUMBER_KEY)?.value).toBe(3);
    expect(after.photos).toHaveLength(1);
    expect(after.photos[0]).toMatchObject({ fieldKey: PHOTO_KEY, uploaded: true });
    for (const row of [...after.answers, ...after.photos]) {
      expect(row.organizationId, "organisasjonen til takstmannen").toBe(organizationId);
    }
    expect(await pendingQueue(form)).toEqual({ changes: 0, photos: 0 });
  } finally {
    await context.setOffline(false);
  }
});

// --- 2.2 Admin, «Synk nå» og ingen sjekk uten grunn (pc) ---

test.describe("admin og Synk nå", () => {
  // page.route og page.on("request") ser ikke forespørsler som går via service worker
  test.use({ serviceWorkers: "block" });

  test("2.2 Synk nå gir Logg inn på nytt, og admin kommer tilbake til skjemaet", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    test.setTimeout(120_000);

    // 1. Admin åpner skjemaet med nett; ingen sjekk av økten uten noe som utløser den
    await logIn(page, ADMIN_EMAIL);
    const formId = await createTrialForm(page);
    await waitForTrialHook(page);
    await expectState(page, ONLINE_NOT_SIGN_IN);
    const checks = countRequests(page, SESSION_ROUTE);
    // Selve målingen: 15 sekunder uten å gjøre noe
    await page.waitForTimeout(15_000);
    expect(checks.count(), "kall til get-session på 15 s uten utløser").toBe(0);

    // 2. Ett svar uten nett, så køen har noe
    await context.setOffline(true);
    await expectState(page, "offline");
    const floors = input(page, NUMBER_LABEL);
    await floors.fill("4");
    await floors.blur();
    await expect(counter(page)).toHaveText("1 av 40 felt utfylt");

    // 3. Kapselen fjernes. Det er det samme som «Logg ut» på ekte iPad (A6): nettleseren sender
    // ingen kapsel. Hovedflyten (2.1) dekker kapsel som sendes, men har gått ut.
    await context.clearCookies();

    // 4. Nettet kommer. Sjekken som `online` utløser, slipper ikke gjennom (nettverksfeil gir
    // `unknown`, ingen endring), så det er «Synk nå» som gir meldingen.
    let blockCheck = true;
    await page.route(SESSION_ROUTE, (route) => (blockCheck ? route.abort() : route.fallback()));
    try {
      await context.setOffline(false);
      await expectState(page, "pending", SIGN_IN_TIMEOUT);
      await expect(syncNowButton(page)).toBeVisible();
      // Sjekken fra `online` er avvist og ferdig før sperren slippes
      await expect
        .poll(() => checks.requests.length > 0 && checks.requests.every((r) => r.status !== null))
        .toBe(true);
      blockCheck = false;
      const before = checks.count();
      await syncNowButton(page).click();
      await expectState(page, "signInRequired", SIGN_IN_TIMEOUT);
      expect(checks.count(), "sjekk etter Synk nå").toBeGreaterThan(before);
      await expect(syncNowButton(page)).toBeHidden();
      await expect(signInLink(page)).toBeVisible();
    } finally {
      await page.unroute(SESSION_ROUTE);
    }

    // 5. «Logg inn», kode, tilbake i skjemaet: admin stenges ikke ute
    await signInLink(page).click();
    await expect(page).toHaveURL(new RegExp(`/logg-inn\\?neste=${nextParam(formId)}$`));
    await signInWithCode(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(new RegExp(`${formPath(formId)}$`));
    await expect(input(page, NUMBER_LABEL)).toHaveValue("4");
    await syncAfterSignIn(page, testInfo);
    const data = await serverTrialData(formId);
    expect(data.answers.find((row) => row.fieldKey === NUMBER_KEY)?.value).toBe(4);
  });
});

// --- 2.3 Kopien av skjemaet blir ikke ødelagt (pc) ---

test("2.3 omdirigering til innlogging erstatter ikke kopien av skjemaet", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);

  // 1. Kopi av skjemaet lages med nett
  await logInAsInspector(page);
  const formId = await createTrialForm(page);
  await cacheListAndForm(page, formId);

  // 2. Egen økt går ut; med nett sender serveren til innlogging
  await expireOwnSession(context);
  await page.goto(formPath(formId));
  await expect(page).toHaveURL(/\/logg-inn(\?|$)/);

  // 3. Uten nett: skjemaet vises fra kopien, ikke innloggingssiden
  try {
    await context.setOffline(true);
    await page.goto(formPath(formId));
    await expect(page).toHaveURL(new RegExp(`${formPath(formId)}$`));
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
    await expect(page.getByLabel("Kode fra e-posten")).toHaveCount(0);
    await expect(page.getByLabel("E-postadresse")).toHaveCount(0);
    await expectState(page, "offline");

    // 4. Kopien i hurtiglageret er skjemaet, ikke en omdirigering til innloggingssiden
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
  test("2.4 neste sender til skjemaet, og aldri til en annen nettside", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    pcOnly(testInfo);
    const origin = new URL(baseURL!).origin;
    const evil = encodeURIComponent("//evil.example");

    await logIn(page, ADMIN_EMAIL);
    const formId = await createTrialForm(page);

    // Allerede innlogget, trygg sti: rett til skjemaet
    await page.goto(`/logg-inn?neste=${nextParam(formId)}`);
    await expect(page).toHaveURL(`${origin}${formPath(formId)}`);

    // Allerede innlogget, sti til en annen nettside: arbeidskøen
    await page.goto(`/logg-inn?neste=${evil}`);
    await expect(page).toHaveURL(`${origin}/arbeidskoe`);

    // Ikke innlogget, trygg sti: skjemaet etter koden
    await context.clearCookies();
    await page.goto(`/logg-inn?neste=${nextParam(formId)}`);
    await signInWithCode(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(`${origin}${formPath(formId)}`);

    // Ikke innlogget, sti til en annen nettside: arbeidskøen etter koden
    await context.clearCookies();
    await page.goto(`/logg-inn?neste=${evil}`);
    await signInWithCode(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(`${origin}/arbeidskoe`);
  });
});
