import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { brand } from "../src/shared/config/brand";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  createTrialForm,
  employeeByEmail,
  ensureDedicatedEmployee,
  fieldSaved,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  pendingQueue,
  serverTrialData,
  sessionCountForUser,
  sessionTokenOf,
  signInWithCode,
  syncNowButton,
  syncStatus,
  waitForTrialHook,
} from "./helpers";

/*
 * Mine innlogginger (docs/funksjoner/fase2a-mine-innlogginger.md, testplan avsnitt 9, E1–E13).
 * Kjøres i prosjektene pc og ipad. Alle tester som logger ut eller deaktiverer, bruker egne,
 * oppdiktede brukere fra `ensureDedicatedEmployee` (testplan avsnitt 0), aldri de delte
 * e2e-brukerne. Den faste admin brukes bare til å lese og til å logge ut eller deaktivere en egen
 * testbruker. «Annen enhet» er en egen nettleserkontekst med oppdiktet user-agent (merket
 * «Oppdiktet/9.9»), slik at radene kan skilles og rå user-agent kan søkes etter i svarene.
 *
 * Ingen axe i prosjektet (ingen ny avhengighet, regel 9): UU prøves med roller, tilgjengelige
 * navn, fokus, tastatur og knappestørrelse (minst 44 × 44 px), som i de andre e2e-filene.
 *
 * Støtter hovedmål: de ansatte (ser egne enheter og stenger en ukjent med ett trykk; admin
 * stenger alle enheter for en som slutter, uten å stenge seg selv ute) og færre reklamasjoner
 * (endringer uten nett går ikke tapt når iPaden logges ut fra en annen enhet).
 */

const MARK = "Oppdiktet/9.9";
const UA_EDGE_WINDOWS = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0 ${MARK}`;
const UA_MAC_CHROME = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${MARK}`;
const UA_MAC_SAFARI = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15 ${MARK}`;
const UA_ANDROID_CHROME = `Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 ${MARK}`;

const OFFLINE_MESSAGE = "Du er uten nett. Prøv igjen når du har dekning.";
const CLOCK = /\b\d{1,2}[:.]\d{2}\b/;
const PORTRAIT = { width: 834, height: 1194 };

type Device = { context: BrowserContext; page: Page };

/** Ny nettleserkontekst med samme adresse og skjermstørrelse som prosjektet, og egen user-agent. */
async function newDevice(browser: Browser, testInfo: TestInfo, userAgent: string): Promise<Device> {
  const { baseURL, viewport, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    hasTouch,
    locale: "nb-NO",
    userAgent,
  });
  return { context, page: await context.newPage() };
}

async function loggedInDevice(
  browser: Browser,
  testInfo: TestInfo,
  email: string,
  userAgent: string,
): Promise<Device> {
  const device = await newDevice(browser, testInfo, userAgent);
  await logIn(device.page, email);
  return device;
}

async function closeAll(devices: Device[]) {
  for (const device of devices) await device.context.close().catch(() => {});
}

/** Lenken fra initialene/navnet øverst til profilen. */
function profileLink(page: Page): Locator {
  return page.locator('a[href="/profil"]').first();
}

/** Delen «Mine innlogginger» på /profil. */
function mySessions(page: Page): Locator {
  return page
    .getByRole("main")
    .locator("section, [role=region]")
    .filter({ has: page.getByRole("heading", { name: "Mine innlogginger" }) })
    .last();
}

/** Delen «Innlogginger» på /admin/ansatte/[id]. */
function employeeSessions(page: Page): Locator {
  return page
    .getByRole("main")
    .locator("section, [role=region]")
    .filter({ has: page.getByRole("heading", { name: "Innlogginger", exact: true }) })
    .last();
}

/** Radene i «Mine innlogginger»: én per økt, hver med en «Logg ut …»-knapp. */
function sessionRows(page: Page): Locator {
  return mySessions(page)
    .locator("li, tr")
    .filter({ has: page.getByRole("button", { name: /^Logg ut/ }) });
}

function rowWith(page: Page, text: string): Locator {
  return sessionRows(page).filter({ hasText: text });
}

function logOutAllOthers(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: "Logg ut av alle andre enheter" });
}

function logOutAllDevices(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: "Logg ut av alle enheter" });
}

function confirmDialog(page: Page): Locator {
  return page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
}

/** Bekreftknappen i dialogen (ikke «Avbryt»). */
function confirmButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: /^(Logg ut|Bekreft|Ja|Har sluttet)/ }).last();
}

async function openProfileViaHeader(page: Page) {
  await page.goto("/arbeidskoe");
  await profileLink(page).click();
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByRole("heading", { name: "Mine innlogginger" })).toBeVisible();
}

/** Neste side i konteksten havner på innloggingssiden. */
async function expectSignedOut(page: Page) {
  await page.goto("/arbeidskoe");
  await expect(page).toHaveURL(/\/logg-inn(\?|$)/);
}

async function expectStillSignedIn(page: Page) {
  await page.goto("/arbeidskoe");
  await expect(page).toHaveURL(/\/arbeidskoe$/);
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

async function expectAllButtonsAtLeast44(section: Locator, where: string) {
  const buttons = section.getByRole("button");
  const count = await buttons.count();
  expect(count, `${where} har knapper`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible())) continue;
    const name = (await button.getAttribute("aria-label")) ?? (await button.innerText());
    await expectAtLeast44(button, `${where}: «${name.trim()}»`);
  }
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll, `${where}: ingen vannrett rulling`).toBeLessThanOrEqual(sizes.client);
}

/** Bruker tastaturet (Tab) til fokus står på målet, og trykker Enter. */
async function tabToAndPress(page: Page, target: Locator, max = 80) {
  const handle = await target.elementHandle();
  if (!handle) throw new Error("Fant ikke målet for tastaturet");
  for (let step = 0; step < max; step += 1) {
    await page.keyboard.press("Tab");
    if (await handle.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
  }
  throw new Error("Nådde ikke knappen med Tab");
}

// --- E1–E4 egne innlogginger ---

test("E1 to enheter, én «Denne enheten», uten klokkeslett", async ({ browser }, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e1" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    await openProfileViaHeader(one.page);
    // Navn og e-post bare som tekst
    await expect(one.page.getByRole("main")).toContainText(x.name);
    await expect(one.page.getByRole("main")).toContainText(x.email);
    await expect(one.page.getByRole("main").getByRole("textbox")).toHaveCount(0);

    await expect(sessionRows(one.page)).toHaveCount(2);
    const current = rowWith(one.page, "Denne enheten");
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Mac");
    await expect(current).toContainText("Chrome");
    await expect(current).toContainText("Aktiv nå");
    await expect(current.getByRole("button", { name: /^Logg ut her/ })).toBeVisible();

    const other = rowWith(one.page, "Windows-PC");
    await expect(other).toHaveCount(1);
    await expect(other).toContainText("Edge");
    await expect(other).toContainText("Aktiv i dag");
    await expect(other).toContainText(/logget inn \d{1,2}\. [a-zæøå]+/);
    await expect(other).not.toContainText("Denne enheten");
    // Tilgjengelig navn sier hvilken enhet (8.3)
    await expect(other.getByRole("button", { name: /^Logg ut .*Windows-PC/ })).toBeVisible();

    const text = await mySessions(one.page).innerText();
    expect(text, "ingen klokkeslett i radene").not.toMatch(CLOCK);
    expect(text).not.toContain(MARK);
  } finally {
    await closeAll([one, two]);
  }
});

test("E2 «Logg ut» på en annen enhet: kvittering med fokus, den andre må logge inn", async ({
  browser,
}, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e2" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    await openProfileViaHeader(one.page);
    const other = rowWith(one.page, "Windows-PC");
    await other.getByRole("button", { name: /^Logg ut/ }).click();

    const receipt = one.page.getByRole("status").filter({ hasText: "Enheten er logget ut." });
    await expect(receipt).toBeVisible();
    await expect(receipt).toBeFocused();
    await expect(rowWith(one.page, "Windows-PC")).toHaveCount(0);
    await expect(sessionRows(one.page)).toHaveCount(1);
    expect(await sessionCountForUser(x.userId)).toBe(1);

    await expectSignedOut(two.page);
    await expectStillSignedIn(one.page);
  } finally {
    await closeAll([one, two]);
  }
});

test("E3 «Logg ut av alle andre enheter» med antall", async ({ browser }, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e3" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  const three = await loggedInDevice(browser, testInfo, x.email, UA_ANDROID_CHROME);
  try {
    await openProfileViaHeader(one.page);
    await expect(sessionRows(one.page)).toHaveCount(3);
    await logOutAllOthers(one.page).click();
    const receipt = one.page.getByRole("status").filter({ hasText: "2 enheter er logget ut." });
    await expect(receipt).toBeVisible();
    await expect(receipt).toBeFocused();
    await expect(logOutAllOthers(one.page)).toHaveCount(0);
    await expect(sessionRows(one.page)).toHaveCount(1);

    await expectSignedOut(two.page);
    await expectSignedOut(three.page);
    await expectStillSignedIn(one.page);
  } finally {
    await closeAll([one, two, three]);
  }
});

test("E3 knappen «alle andre» vises ikke med bare én enhet", async ({ browser }, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e3b" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  try {
    await openProfileViaHeader(one.page);
    await expect(sessionRows(one.page)).toHaveCount(1);
    await expect(logOutAllOthers(one.page)).toHaveCount(0);
  } finally {
    await closeAll([one]);
  }
});

test("E4 «Logg ut her» fører til innloggingssiden", async ({ browser }, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e4" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  try {
    await openProfileViaHeader(one.page);
    await rowWith(one.page, "Denne enheten")
      .getByRole("button", { name: /^Logg ut her/ })
      .click();
    await expect(one.page).toHaveURL(/\/logg-inn(\?|$)/);
    await one.page.goto("/profil");
    await expect(one.page).toHaveURL(/\/logg-inn\?neste=%2Fprofil$/);
    expect(await sessionCountForUser(x.userId)).toBe(0);
  } finally {
    await closeAll([one]);
  }
});

test("F3 «denne enheten» på iPad (Macintosh med berøring) og som app fra hjemskjermen", async ({
  browser,
}, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "f3" });
  const ipad = await newDevice(browser, testInfo, UA_MAC_SAFARI);
  await ipad.context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
  });
  await logIn(ipad.page, x.email);
  const mac = await loggedInDevice(browser, testInfo, x.email, UA_MAC_SAFARI);
  const home = await newDevice(browser, testInfo, UA_MAC_CHROME);
  await home.context.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone")
        ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
        : original(query);
  });
  await logIn(home.page, x.email);
  try {
    // iPad (berøring): «iPad» på denne enheten; den andre Safari-økten står som «iPad eller Mac»
    await openProfileViaHeader(ipad.page);
    const current = rowWith(ipad.page, "Denne enheten");
    await expect(current).toContainText("iPad");
    await expect(current).not.toContainText("iPad eller Mac");
    const others = sessionRows(ipad.page).filter({ hasNotText: "Denne enheten" });
    await expect(others.filter({ hasText: "iPad eller Mac" })).toHaveCount(1);

    // Mac uten berøring: «iPad eller Mac» står
    await openProfileViaHeader(mac.page);
    await expect(rowWith(mac.page, "Denne enheten")).toContainText("iPad eller Mac");

    // Fra hjemskjermen: appnavnet + «-appen» i stedet for nettleseren, bare på denne enheten
    await openProfileViaHeader(home.page);
    await expect(rowWith(home.page, "Denne enheten")).toContainText(`${brand.productName}-appen`);
    const notCurrent = sessionRows(home.page).filter({ hasNotText: "Denne enheten" });
    await expect(notCurrent.filter({ hasText: `${brand.productName}-appen` })).toHaveCount(0);
  } finally {
    await closeAll([ipad, mac, home]);
  }
});

// --- E5–E8 admin ---

test("E5 admin logger ut alle enheter for en takstmann etter bekreftelse", async ({
  page,
  browser,
}, testInfo) => {
  const y = await ensureDedicatedEmployee({ role: "inspector", prefix: "e5" });
  const yDevice = await loggedInDevice(browser, testInfo, y.email, UA_EDGE_WINDOWS);
  try {
    await logIn(page, ADMIN_EMAIL);
    await page.goto(`/admin/ansatte/${y.employeeId}`);
    await expect(page.getByRole("heading", { name: y.name, level: 1 })).toBeVisible();
    const section = employeeSessions(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText("Windows-PC");
    await expect(section).toContainText("Edge");
    await expect(section).toContainText("1");
    // Ingen «sist brukt» og ingen dato i admin-visningen (A428, spørsmål 89)
    await expect(section).not.toContainText("Aktiv");
    await expect(section).not.toContainText("logget inn ");
    expect(await section.innerText()).not.toMatch(/\d{1,2}\. [a-zæøå]{3,}/);

    // Avbryt endrer ingenting
    await logOutAllDevices(page).click();
    let dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Logg ut ${y.name} fra alle enheter?`);
    await expect(dialog).toContainText("Data som ligger lagret på iPaden slettes ikke.");
    await expect(dialog).not.toContainText("Du blir også logget ut her");
    await dialog.getByRole("button", { name: "Avbryt" }).click();
    await expect(dialog).toBeHidden();
    expect(await sessionCountForUser(y.userId)).toBe(1);
    await expectStillSignedIn(yDevice.page);

    // Bekreft
    await logOutAllDevices(page).click();
    dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await confirmButton(dialog).click();
    const receipt = page
      .getByRole("status")
      .filter({ hasText: "1 enhet er logget ut. Data som ligger på enhetene, er ikke slettet." });
    await expect(receipt).toBeVisible();
    expect(await sessionCountForUser(y.userId)).toBe(0);
    await expectSignedOut(yDevice.page);
    // Listen er tom, og knappen er borte
    await expect(logOutAllDevices(page)).toHaveCount(0);
    // Admin er fortsatt innlogget
    await expectStillSignedIn(page);
  } finally {
    await closeAll([yDevice]);
  }
});

test("E6 admin logger ut seg selv fra alle enheter, logger inn igjen og når /admin", async ({
  browser,
}, testInfo) => {
  const z = await ensureDedicatedEmployee({ role: "admin", prefix: "e6-admin" });
  const zDevice = await loggedInDevice(browser, testInfo, z.email, UA_MAC_CHROME);
  const { page } = zDevice;
  try {
    const employeeUrl = `/admin/ansatte/${z.employeeId}`;
    await page.goto(employeeUrl);
    await expect(employeeSessions(page)).toBeVisible();
    await logOutAllDevices(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Du blir også logget ut her");

    // Uten bekreftelsessteget går det ikke
    const confirm = confirmButton(dialog);
    if (!(await confirm.isDisabled())) {
      await confirm.click();
      await expect(page).toHaveURL(new RegExp(`${employeeUrl}(\\?.*)?$`));
    }
    expect(await sessionCountForUser(z.userId)).toBe(1);

    await dialog.getByRole("checkbox").check();
    await confirm.click();
    await expect(page).toHaveURL(/\/logg-inn(\?|$)/);
    expect(await sessionCountForUser(z.userId)).toBe(0);

    await logIn(page, z.email);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin(\/|$)/);
    await expect(
      page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 }),
    ).toHaveCount(0);
  } finally {
    await closeAll([zDevice]);
  }
});

test("E7 takstmann, kontor og leder ser ikke admin-delen, men ser «Mine innlogginger»", async ({
  page,
}) => {
  const target = await employeeByEmail(INSPECTOR_EMAIL);
  for (const logInAs of [logInAsInspector, logInAsOffice, logInAsManager]) {
    await page.context().clearCookies();
    await logInAs(page);
    await page.goto(`/admin/ansatte/${target.id}`);
    await expect(page.getByRole("heading", { name: "Innlogginger", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Logg ut av alle enheter" })).toHaveCount(0);
    await openProfileViaHeader(page);
    await expect(rowWith(page, "Denne enheten")).toHaveCount(1);
  }
});

test("E8 deaktivering logger ut alle enheter", async ({ page, browser }, testInfo) => {
  const w = await ensureDedicatedEmployee({ role: "inspector", prefix: "e8" });
  const wDevice = await loggedInDevice(browser, testInfo, w.email, UA_EDGE_WINDOWS);
  try {
    await logIn(page, ADMIN_EMAIL);
    await page.goto(`/admin/ansatte/${w.employeeId}`);
    await page.getByRole("button", { name: "Har sluttet", exact: true }).click();
    await expect(page.getByText("Hen blir også logget ut av alle enheter (1).")).toBeVisible();
    const dialog = confirmDialog(page);
    if (await dialog.isVisible()) await confirmButton(dialog).click();
    await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=sluttet$/);
    expect(await sessionCountForUser(w.userId)).toBe(0);
    await expectSignedOut(wDevice.page);
  } finally {
    await closeAll([wDevice]);
  }
});

// --- E9–E10 uten nett ---

test("E9 uten nett: «Logg ut» og «alle andre» gir tydelig melding, raden står", async ({
  browser,
}, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e9" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    await openProfileViaHeader(one.page);
    await expect(sessionRows(one.page)).toHaveCount(2);
    await one.context.setOffline(true);

    await rowWith(one.page, "Windows-PC")
      .getByRole("button", { name: /^Logg ut/ })
      .click();
    const message = one.page
      .getByRole("alert")
      .or(one.page.getByRole("status"))
      .filter({ hasText: OFFLINE_MESSAGE });
    await expect(message).toBeVisible();
    await expect(rowWith(one.page, "Windows-PC")).toHaveCount(1);

    await logOutAllOthers(one.page).click();
    await expect(message.first()).toBeVisible();
    await expect(rowWith(one.page, "Windows-PC")).toHaveCount(1);

    await one.context.setOffline(false);
    expect(await sessionCountForUser(x.userId)).toBe(2);
    await expectStillSignedIn(two.page);
  } finally {
    await closeAll([one, two]);
  }
});

const LIST_PATH = "/prove/testskjema";
const TEXT_LABEL = "Generell beskrivelse";
const TEXT_KEY = "general_description";
const TEXT_VALUE = "Oppdiktet tekst skrevet uten nett før ekstern utlogging";

test("E10 uten nett-køen tømmes ikke når iPaden logges ut fra en annen enhet (F5)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const v = await ensureDedicatedEmployee({ role: "inspector", prefix: "e10" });
  const ipad = await loggedInDevice(browser, testInfo, v.email, UA_MAC_SAFARI);
  const pc = await loggedInDevice(browser, testInfo, v.email, UA_EDGE_WINDOWS);
  try {
    // Skjema med kopi i hurtiglageret, så det kan åpnes uten nett
    const formId = await createTrialForm(ipad.page);
    const formPath = `${LIST_PATH}/${formId}`;
    await ipad.page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await ipad.page.goto(formPath);
    await waitForTrialHook(ipad.page);
    await expect
      .poll(
        () => ipad.page.evaluate(async (entry) => Boolean(await caches.match(entry)), formPath),
        {
          timeout: 15_000,
          message: "kopi av skjemaet",
        },
      )
      .toBe(true);

    // Endring uten nett
    await ipad.context.setOffline(true);
    await ipad.page.getByLabel(TEXT_LABEL, { exact: true }).fill(TEXT_VALUE);
    await ipad.page.getByLabel(TEXT_LABEL, { exact: true }).blur();
    await expect(fieldSaved(ipad.page, TEXT_LABEL)).toHaveAttribute("data-field-saved", "yes");
    expect((await pendingQueue(ipad.page)).changes).toBeGreaterThan(0);

    // PC-en logger ut iPaden
    await openProfileViaHeader(pc.page);
    await rowWith(pc.page, "iPad eller Mac")
      .getByRole("button", { name: /^Logg ut/ })
      .click();
    await expect(
      pc.page.getByRole("status").filter({ hasText: "Enheten er logget ut." }),
    ).toBeVisible();
    expect(await sessionCountForUser(v.userId)).toBe(1);

    // Køen ligger fortsatt på iPaden
    expect((await pendingQueue(ipad.page)).changes).toBeGreaterThan(0);

    // Nettet kommer: innlogging, så sendes endringen
    await ipad.context.setOffline(false);
    await expect(syncStatus(ipad.page)).toHaveAttribute("data-sync-state", "signInRequired", {
      timeout: 15_000,
    });
    expect((await pendingQueue(ipad.page)).changes).toBeGreaterThan(0);
    await syncStatus(ipad.page).getByRole("link", { name: "Logg inn", exact: true }).click();
    await signInWithCode(ipad.page, v.email);
    await expect(ipad.page).toHaveURL(new RegExp(`${formPath}$`));
    await expect(ipad.page.getByLabel(TEXT_LABEL, { exact: true })).toHaveValue(TEXT_VALUE);
    await waitForTrialHook(ipad.page);
    if ((await pendingQueue(ipad.page)).changes > 0) {
      await syncNowButton(ipad.page)
        .click()
        .catch(() => {});
    }
    await expect
      .poll(async () => (await pendingQueue(ipad.page)).changes, { timeout: 30_000 })
      .toBe(0);
    await expect
      .poll(
        async () =>
          (await serverTrialData(formId)).answers.find((row) => row.fieldKey === TEXT_KEY)?.value,
        { timeout: 30_000, message: "endringen kom fram på serveren" },
      )
      .toBe(TEXT_VALUE);
  } finally {
    await closeAll([ipad, pc]);
  }
});

// --- E11–E13 persondata, UU og iPad-størrelse ---

/** Samler HTML- og RSC-svarene for stien i siden. */
function collectPageResponses(page: Page, pathname: string): string[] {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname !== pathname) return;
    const type = response.headers()["content-type"] ?? "";
    if (!/text\/html|text\/x-component/.test(type) && !url.searchParams.has("_rsc")) return;
    try {
      bodies.push(await response.text());
    } catch {
      // Omdirigering eller avbrutt svar har ingen tekst
    }
  });
  return bodies;
}

function expectNoSessionData(bodies: string[], tokens: (string | null)[], where: string) {
  expect(bodies.length, `${where}: svar er samlet`).toBeGreaterThan(0);
  for (const body of bodies) {
    for (const token of tokens) if (token) expect(body, `${where}: token`).not.toContain(token);
    expect(body, `${where}: IP`).not.toContain("192.0.2.");
    expect(body, `${where}: IP`).not.toContain("127.0.0.1");
    expect(body, `${where}: IP`).not.toMatch(/(^|[^:\w])::1([^\w:]|$)/);
    expect(body, `${where}: rå user-agent`).not.toContain(MARK);
    expect(body, `${where}: rå user-agent`).not.toContain("Mozilla/5.0");
  }
}

test("E11 ingen token, IP eller rå user-agent i HTML eller RSC", async ({
  page,
  browser,
}, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e11" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    const tokens = [await sessionTokenOf(one.context), await sessionTokenOf(two.context)];
    const profileBodies = collectPageResponses(one.page, "/profil");
    await openProfileViaHeader(one.page); // RSC
    await one.page.reload(); // HTML
    await expect(sessionRows(one.page)).toHaveCount(2);
    expectNoSessionData(profileBodies, tokens, "/profil");

    await logIn(page, ADMIN_EMAIL);
    const adminPath = `/admin/ansatte/${x.employeeId}`;
    const adminBodies = collectPageResponses(page, adminPath);
    await page.goto(adminPath);
    await expect(employeeSessions(page)).toContainText("Windows-PC");
    await page.goto("/admin/ansatte");
    await page.locator(`a[href="${adminPath}"]`).first().click(); // RSC
    await expect(page).toHaveURL(new RegExp(`${adminPath}$`));
    await expect(employeeSessions(page)).toBeVisible();
    expectNoSessionData(adminBodies, [...tokens, await sessionTokenOf(page.context())], adminPath);
  } finally {
    await closeAll([one, two]);
  }
});

test("E12 UU: knapper minst 44 px, tilgjengelige navn, tastatur og fokus", async ({
  page,
  browser,
}, testInfo) => {
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e12" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_CHROME);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    await openProfileViaHeader(one.page);
    await expectAllButtonsAtLeast44(mySessions(one.page), "/profil");
    await expectAtLeast44(profileLink(one.page), "lenken til profilen");
    // «Denne enheten» står som tekst, ikke bare som farge
    await expect(rowWith(one.page, "Denne enheten")).toHaveCount(1);
    // Overskriftene i rekkefølge
    await expect(one.page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // Hele E2 med bare tastatur
    const target = rowWith(one.page, "Windows-PC").getByRole("button", { name: /^Logg ut/ });
    await tabToAndPress(one.page, target);
    const receipt = one.page.getByRole("status").filter({ hasText: "Enheten er logget ut." });
    await expect(receipt).toBeFocused();
    await expectSignedOut(two.page);

    // Admin-delen og dialogen
    const y = await ensureDedicatedEmployee({ role: "inspector", prefix: "e12-y" });
    const yDevice = await loggedInDevice(browser, testInfo, y.email, UA_EDGE_WINDOWS);
    try {
      await logIn(page, ADMIN_EMAIL);
      await page.goto(`/admin/ansatte/${y.employeeId}`);
      await expectAllButtonsAtLeast44(employeeSessions(page), "Innlogginger");
      await logOutAllDevices(page).click();
      const dialog = confirmDialog(page);
      await expect(dialog).toBeVisible();
      // Dialogen har navn og fokus inni seg
      expect(
        (await dialog.getAttribute("aria-labelledby")) ?? (await dialog.getAttribute("aria-label")),
      ).toBeTruthy();
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      await expectAllButtonsAtLeast44(dialog, "dialogen");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      expect(await sessionCountForUser(y.userId)).toBe(1);
    } finally {
      await closeAll([yDevice]);
    }
  } finally {
    await closeAll([one, two]);
  }
});

test("E13 iPad-størrelse: ingen vannrett rulling, knappene innenfor skjermen", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "Bare i ipad-prosjektet (testplan E13)");
  const x = await ensureDedicatedEmployee({ role: "inspector", prefix: "e13" });
  const one = await loggedInDevice(browser, testInfo, x.email, UA_MAC_SAFARI);
  const two = await loggedInDevice(browser, testInfo, x.email, UA_EDGE_WINDOWS);
  try {
    for (const [name, size] of [
      ["liggende", testInfo.project.use.viewport!],
      ["stående", PORTRAIT],
    ] as const) {
      await one.page.setViewportSize(size);
      await openProfileViaHeader(one.page);
      await expectNoHorizontalScroll(one.page, `/profil ${name}`);
      const buttons = mySessions(one.page).getByRole("button");
      for (let index = 0; index < (await buttons.count()); index += 1) {
        const box = await buttons.nth(index).boundingBox();
        expect(box, `knapp ${index} ${name}`).not.toBeNull();
        expect(box!.x + box!.width, `knapp ${index} ${name}`).toBeLessThanOrEqual(size.width);
      }

      await page.setViewportSize(size);
      if (!page.url().includes("/admin/")) await logIn(page, ADMIN_EMAIL);
      await page.goto(`/admin/ansatte/${x.employeeId}`);
      await expect(employeeSessions(page)).toBeVisible();
      await expectNoHorizontalScroll(page, `admin ${name}`);
      const adminButton = logOutAllDevices(page);
      const box = await adminButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }
  } finally {
    await closeAll([one, two]);
  }
});
