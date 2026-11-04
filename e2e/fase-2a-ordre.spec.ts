import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn, logInAsInspector, signInWithCode, uniqueSuffix } from "./helpers";

/*
 * Manuell ordre og oppdragsnummer (fase 2a).
 * Testplan: docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 8, med runde 1 og 2 (ingen
 * «Bekreft» eller «Avbryt»: man velger kontor og trykker «Gjør om til oppdrag»; grunnen er
 * bekreftelsen ved «Avvis»). Kjører i prosjektene pc og ipad; 8.7 bare i ipad.
 *
 * Data: oppdiktet. Hver test lager sin egen ordre med `uniqueSuffix()` i adressen, fordi
 * e2e-databasen ikke tømmes mellom kjøringene. Nummeret sjekkes derfor bare mot formatet, aldri
 * mot `00001`. Tom liste og «uten assignment.edit ser siden uten knappene» testes i Vitest.
 *
 * Støtter hovedmål: tid (fire trykk fra ny ordre til oppdragsnummer: «Ny ordre», «Lagre», velg
 * kontor, «Gjør om til oppdrag») og reklamasjoner (avvisning med grunn, ingen tilgang uten ansattrad).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const NUMBER = /\d{4}-\d{5}/;
const ORDER_URL = /\/ordre\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

/** Raden i ordrelisten: lenken som inneholder adressen. */
function orderRow(page: Page, address: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: address });
}

/** Statusmerket ved overskriften på ordresiden. */
function statusBadge(page: Page, label: string): Locator {
  return page.getByRole("heading", { level: 1 }).locator("..").getByText(label, { exact: true });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

function expectNoServerError(response: Response | null, url: string) {
  expect(response, `${url} svarer`).not.toBeNull();
  expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page, url: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${url} ruller ikke vannrett`).toBeLessThanOrEqual(clientWidth);
}

/** Ny nettleserkontekst med samme adresse og skjermstørrelse som prosjektet. */
async function newProjectPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { baseURL, viewport, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
  return context.newPage();
}

function newAddress(): string {
  return `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`;
}

/** «Ny ordre» → fyller bare adressen (og eventuelt mer) → «Lagre». Returnerer ordresidens adresse. */
async function createOrderViaForm(
  page: Page,
  address: string,
  fill: (page: Page) => Promise<void> = async () => {},
): Promise<string> {
  await page.goto("/ordre");
  await page.getByRole("link", { name: "Ny ordre", exact: true }).click();
  await expect(page).toHaveURL(/\/ordre\/ny$/);
  await expect(page.getByRole("heading", { name: "Ny ordre", level: 1 })).toBeVisible();
  await page.getByLabel("Adresse", { exact: true }).fill(address);
  await fill(page);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);
  await expect(page.getByRole("heading", { name: address, level: 1 })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe("ordre (pc og ipad)", () => {
  test("8.1 menypunktet «Ordre» finnes og er aktivt på /ordre", async ({ page }) => {
    await logIn(page);
    const link = mainNav(page).getByRole("link", { name: "Ordre", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/ordre$/);
    await expect(page.getByRole("heading", { name: "Ordre", level: 1 })).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("8.2 ny ordre → gjør om til oppdrag → nummeret vises", async ({ page }) => {
    const address = newAddress();
    await logIn(page);
    await mainNav(page).getByRole("link", { name: "Ordre", exact: true }).click();

    await createOrderViaForm(page, address, async (form) => {
      await form.getByLabel("Hvem bestilte (valgfritt)").fill("Megler Testesen, Testmegleren AS");
      await form.getByLabel("Gårdsnummer (valgfritt)").fill("12");
      await form.getByLabel("Bruksnummer (valgfritt)").fill("34");
      await form.getByLabel("Seksjonsnummer (valgfritt)").fill("5");
      await form.getByLabel("Borettslag eller sameie (valgfritt)").fill("Testtoppen borettslag");
      await form.getByLabel("Egenerklæring mottatt").check();
    });

    // Ordresiden viser feltene og merket «Mottatt»
    const main = page.getByRole("main");
    await expect(statusBadge(page, "Mottatt")).toBeVisible();
    await expect(main).toContainText("Megler Testesen, Testmegleren AS");
    await expect(main).toContainText("Testtoppen borettslag");
    const details = main.locator("dl");
    await expect(details).toContainText("12");
    await expect(details).toContainText("34");
    await expect(details).toContainText("Ja");

    // Velg kontor og trykk knappen, ingen dialog oppå
    await page.getByLabel("Kontor", { exact: true }).selectOption({ label: "Bodø" });
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();

    const converted = main.getByText(/^Gjort om til oppdrag \d{4}-\d{5}$/);
    await expect(converted).toBeVisible();
    const number = NUMBER.exec((await converted.textContent()) ?? "")?.[0];
    expect(number, "nummeret har formatet ÅÅÅÅ-NNNNN").toBeTruthy();
    await expect(statusBadge(page, "Gjort om til oppdrag")).toBeVisible();
    // Knappene er borte
    await expect(page.getByRole("button", { name: "Gjør om til oppdrag" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Avvis" })).toHaveCount(0);

    // Listen viser nummeret på raden
    await page.goto("/ordre");
    await expect(orderRow(page, address)).toHaveCount(1);
    await expect(orderRow(page, address)).toContainText(number!);
    await expect(orderRow(page, address)).toContainText("Gjort om til oppdrag");
  });

  test("8.3 ny ordre → avvis med grunn", async ({ page }) => {
    const address = newAddress();
    await logIn(page);
    const orderPath = await createOrderViaForm(page, address);

    // Tom grunn: feilmelding og ingen endring
    await page.getByRole("button", { name: "Avvis", exact: true }).click();
    await expect(page.getByText("Skriv inn en grunn.")).toBeVisible();
    await expect(page.getByLabel("Grunn", { exact: true })).toHaveAttribute(
      "aria-describedby",
      /reason-error/,
    );
    await page.goto(orderPath);
    await expect(statusBadge(page, "Mottatt")).toBeVisible();

    // Med grunn
    await page.getByLabel("Grunn", { exact: true }).fill("Feil registrering");
    await page.getByRole("button", { name: "Avvis", exact: true }).click();
    await expect(statusBadge(page, "Avvist")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Feil registrering");
    await expect(page.getByRole("button", { name: "Avvis" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Gjør om til oppdrag" })).toHaveCount(0);

    // Avvist ordre blir stående i listen
    await page.goto("/ordre");
    await expect(orderRow(page, address)).toContainText("Avvist");
  });

  test("8.4 feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    const address = newAddress();
    await logIn(page);
    await page.goto("/ordre/ny");

    await page.getByLabel("Adresse", { exact: true }).fill(address);
    await page.getByLabel("Gårdsnummer (valgfritt)").fill("12a");
    await page.getByLabel("Mottatt", { exact: true }).fill("2099-01-01T10:00");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();

    await expect(page.getByText("Gårdsnummer kan bare ha sifre.")).toBeVisible();
    await expect(page.getByText("Mottatt kan ikke være frem i tid.")).toBeVisible();
    await expect(page.getByLabel("Gårdsnummer (valgfritt)")).toHaveAttribute(
      "aria-describedby",
      /gnr-error/,
    );
    await expect(page.getByLabel("Mottatt", { exact: true })).toHaveAttribute(
      "aria-describedby",
      /receivedAt-error/,
    );
    await expect(page).toHaveURL(/\/ordre\/ny$/);

    await page.getByLabel("Adresse", { exact: true }).fill("");
    await page.getByLabel("Gårdsnummer (valgfritt)").fill("12");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Skriv inn adressen.")).toBeVisible();
    await expect(page.getByLabel("Adresse", { exact: true })).toHaveAttribute(
      "aria-describedby",
      /addressText-error/,
    );

    await page.goto("/ordre");
    await expect(orderRow(page, address)).toHaveCount(0);
  });

  test("8.5 takstmann ser ordrene og kan legge inn (innstillingen er på i seed)", async ({
    page,
  }) => {
    const address = newAddress();
    await logInAsInspector(page);
    await page.goto("/ordre");
    await expect(page.getByRole("heading", { name: "Ordre", level: 1 })).toBeVisible();
    await createOrderViaForm(page, address);
    await page.goto("/ordre");
    await expect(orderRow(page, address)).toHaveCount(1);
  });

  test("8.6 bruker uten ansattrad får ingen tilgang og ser ingen adresse", async ({
    page,
    browser,
  }, testInfo) => {
    // Admin legger inn en ordre som ikke skal synes
    const address = newAddress();
    const admin = await newProjectPage(browser, testInfo);
    try {
      await logIn(admin);
      await createOrderViaForm(admin, address);
    } finally {
      await admin.context().close();
    }

    // Oppdiktet innlogging uten ansattrad (innlogging lager ikke brukere selv)
    const email = `ingen-ansatt-${uniqueSuffix()}@eksempel.no`;
    const databaseUrl = e2eDatabaseUrl();
    assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        insert into users (id, name, email, email_verified)
        values (${randomUUID()}, 'Oppdiktet uten ansattrad', ${email}, true)`;
    } finally {
      await sql.end();
    }

    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));

    for (const url of ["/ordre", "/ordre/ny"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      expect(await page.content()).not.toContain(address);
    }
  });

  test("8.8 ukjent ordre-id gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    for (const url of [`/ordre/${randomUUID()}`, "/ordre/ikke-en-id"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
    }
  });
});

test.describe("iPad liggende (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("8.7 «Ny ordre», «Lagre», «Gjør om til oppdrag» og «Avvis» er minst 44 px", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/ordre");
    await expectAtLeast44(page.getByRole("link", { name: "Ny ordre", exact: true }), "Ny ordre");
    await page.goto("/ordre/ny");
    await expectAtLeast44(page.getByRole("button", { name: "Lagre", exact: true }), "Lagre");

    await createOrderViaForm(page, newAddress());
    await expectAtLeast44(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
      "Gjør om til oppdrag",
    );
    await expectAtLeast44(page.getByRole("button", { name: "Avvis", exact: true }), "Avvis");
  });

  test("8.7 skjemaet fylles ut og sendes med tastaturet alene", async ({ page }) => {
    const address = newAddress();
    await logIn(page);
    await page.goto("/ordre/ny");
    const field = page.getByLabel("Adresse", { exact: true });
    for (let i = 0; i < 40; i++) {
      if (await field.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    await page.keyboard.type(address);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(ORDER_URL);
    await expect(page.getByRole("heading", { name: address, level: 1 })).toBeVisible();
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("8.7 /ordre, /ordre/ny og ordresiden har ingen vannrett rulling, skjemaet i én kolonne", async ({
    page,
  }) => {
    await logIn(page);
    const orderPath = await createOrderViaForm(page, newAddress());
    for (const url of ["/ordre", "/ordre/ny", orderPath]) {
      await page.goto(url);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalScroll(page, url);
    }

    // Én kolonne: feltene står under hverandre med samme venstrekant
    await page.goto("/ordre/ny");
    const boxes = await Promise.all(
      ["Adresse", "Mottatt", "Gårdsnummer (valgfritt)", "Bruksnummer (valgfritt)"].map((label) =>
        page.getByLabel(label, { exact: true }).boundingBox(),
      ),
    );
    const lefts = boxes.map((box) => Math.round(box!.x));
    const tops = boxes.map((box) => box!.y);
    expect(new Set(lefts).size, "feltene har samme venstrekant").toBe(1);
    for (let i = 1; i < tops.length; i++) expect(tops[i]!).toBeGreaterThan(tops[i - 1]!);
  });
});
