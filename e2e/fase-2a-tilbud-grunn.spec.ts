import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  convertedAssignmentNumber,
  e2eDatabaseUrl,
  logIn,
  logInAsInspector,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * Tilbud og oppdragsnummer (fase 2a). Var «Manuell ordre»; gjort om til tilbud
 * (docs/funksjoner/fase2a-tilbud-testplan.md avsnitt 5: de gamle testene beholder innholdet, med ny
 * tekst og nye adresser). Opprinnelig testplan: docs/funksjoner/fase2a-manuell-ordre-testplan.md
 * avsnitt 8 (ingen bekreftelsesdialog ved avslag, ingen «Bekreft» ved «Gjør om til oppdrag»).
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (8.7) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sitt eget tilbud med en unik
 * ending i adressen, fordi e2e-databasen ikke tømmes. Nummeret sammenlignes bare med formatet,
 * aldri med 00001. Ingen e2e uten nett her: tilbud legges inn på kontoret med nett (D9).
 * Data er oppdiktet.
 *
 * Støtter hovedmål: tid (fire trykk fra e-post til oppdragsnummer) og reklamasjoner (avvisning
 * har grunn, behandlet tilbud kan ikke behandles igjen).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const ORDER_URL =
  /\/tilbud\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\?ny=1)?$/;

/**
 * En oppdiktet innlogging uten ansattrad (innloggingen lager ikke brukere selv,
 * `disableSignUp`). Bare lokal database eller testdatabasen. Returnerer e-posten.
 */
async function createUserWithoutEmployee(): Promise<string> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const email = `uten-ansatt-${uniqueSuffix()}@eksempel.no`;
  try {
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, 'Oppdiktet uten ansattrad', ${email}, true)`;
  } finally {
    await sql.end();
  }
  return email;
}

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
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
}

async function expectNoHorizontalScroll(page: Page, url: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${url}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

const field = {
  address: (page: Page) => page.getByLabel(/^Adresse/),
  gnr: (page: Page) => page.getByLabel(/^(Gårdsnummer|Gnr)/i),
  bnr: (page: Page) => page.getByLabel(/^(Bruksnummer|Bnr)/i),
  snr: (page: Page) => page.getByLabel(/^(Seksjonsnummer|Snr)/i),
  housing: (page: Page) => page.getByLabel(/^Borettslag/i),
  orderedBy: (page: Page) => page.getByLabel(/^Hvem bestilte/),
  externalRef: (page: Page) => page.getByLabel(/^Meglerens ordrenummer/i),
  declaration: (page: Page) => page.getByLabel(/egenerklæring/i),
  receivedAt: (page: Page) => page.getByLabel(/^Mottatt/),
  reasonText: (page: Page) => page.getByLabel(/^Mer om grunnen/),
};

type OrderData = {
  address: string;
  gnr: string;
  bnr: string;
  snr: string;
  housing: string;
  orderedBy: string;
};

function newOrderData(suffix: string): OrderData {
  return {
    address: `Tilbudsveien 12 ${suffix}, 8000 Bodø`,
    gnr: "12",
    bnr: "34",
    snr: "5",
    housing: "Testtoppen borettslag",
    orderedBy: "Megler Testesen, Testmegleren AS",
  };
}

/** «Tilbud» i menyen → «Nytt tilbud» → feltene → «Lagre». Returnerer id-en til tilbudet. */
async function createOrderViaUi(page: Page, data: OrderData): Promise<string> {
  await mainNav(page).getByRole("link", { name: "Tilbud", exact: true }).click();
  await expect(page).toHaveURL(/\/tilbud$/);
  await page.getByRole("link", { name: "Nytt tilbud", exact: true }).click();
  await expect(page).toHaveURL(/\/tilbud\/ny$/);

  await field.address(page).fill(data.address);
  await field.gnr(page).fill(data.gnr);
  await field.bnr(page).fill(data.bnr);
  await field.snr(page).fill(data.snr);
  await field.housing(page).fill(data.housing);
  await field.orderedBy(page).fill(data.orderedBy);
  await field.declaration(page).check();
  await page.getByRole("button", { name: "Lagre", exact: true }).click();

  await expect(page).toHaveURL(ORDER_URL);
  await expect(page.getByText(/^Tilbudet er laget\. Gyldig til /)).toBeVisible();
  return ORDER_URL.exec(page.url())![1]!;
}

/** Velger kontoret «Bodø» når det må velges (admin uten kontor); ellers er det forhåndsvalgt. */
async function chooseOfficeIfNeeded(page: Page) {
  const radio = page.getByRole("radio", { name: "Bodø", exact: true });
  if (await radio.isVisible()) await radio.check();
}

/** Verdi for feltet «Mottatt» etter typen (datetime-local eller date). */
async function receivedAtValue(target: Locator, date: Date): Promise<string> {
  const type = await target.getAttribute("type");
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(" ", "T");
  return type === "date" ? local.slice(0, 10) : local;
}

test.describe("tilbud (pc og ipad)", () => {
  test("8.1 menypunktet «Tilbud» finnes og er aktivt på /tilbud", async ({ page }) => {
    await logIn(page);
    const link = mainNav(page).getByRole("link", { name: "Tilbud", exact: true });
    await expect(link).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Ordre", exact: true })).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(/\/tilbud$/);
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("8.2 nytt tilbud → gjør om til oppdrag → nummeret vises", async ({ page }) => {
    const data = newOrderData(uniqueSuffix());
    await logIn(page);
    const id = await createOrderViaUi(page, data);

    const main = page.getByRole("main");
    for (const value of [data.address, data.housing, data.orderedBy]) {
      await expect(main).toContainText(value);
    }
    await expect(main.getByText("Åpent", { exact: true }).first()).toBeVisible();

    // Kontoret er forhåndsvalgt (eller velges), ett trykk; ingen «Bekreft» (runde 2)
    await chooseOfficeIfNeeded(page);
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
    await expect(page).toHaveURL(/\/oppdrag\/[0-9a-f-]{36}/);

    await page.goto(`/tilbud/${id}`);
    const number = await convertedAssignmentNumber(page);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Avslå tilbud", exact: true })).toHaveCount(0);

    await page.goto("/tilbud?status=converted");
    const row = page.getByRole("main").getByRole("link").filter({ hasText: data.address });
    await expect(row).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText(number);
  });

  test("8.3 nytt tilbud → avslå med grunn (F4)", async ({ page }) => {
    const data = newOrderData(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, data);

    // Uten valg: melding og ingen endring
    await page.getByRole("button", { name: "Avslå tilbud", exact: true }).click();
    await page.getByRole("button", { name: "Avslå tilbudet", exact: true }).click();
    await expect(page.getByText("Velg en grunn.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toBeVisible();

    // «Annet» uten tekst
    await page.getByRole("radio", { name: "Annet", exact: true }).check();
    await page.getByRole("button", { name: "Avslå tilbudet", exact: true }).click();
    await expect(page.getByText("Skriv grunnen.")).toBeVisible();

    await field.reasonText(page).fill("Feil registrering");
    await page.getByRole("button", { name: "Avslå tilbudet", exact: true }).click();

    const main = page.getByRole("main");
    await expect(main.getByText("Avslått: Annet", { exact: true })).toBeVisible();
    await expect(main).toContainText("Feil registrering");
    await expect(page.getByRole("button", { name: "Avslå tilbud", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toHaveCount(0);
  });

  test("8.4 feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);

    // Tom adresse
    await page.goto("/tilbud/ny");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Skriv inn adressen.")).toBeVisible();
    await expect(field.address(page)).toHaveAttribute("aria-describedby", /.+/);
    await expect(page).toHaveURL(/\/tilbud\/ny$/);

    // Gnr med bokstav
    const badGnr = `Testveien gnr ${suffix}`;
    await field.address(page).fill(badGnr);
    await field.gnr(page).fill("12a");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Gårdsnummer kan bare ha sifre.")).toBeVisible();
    const gnrDescribedBy = await field.gnr(page).getAttribute("aria-describedby");
    expect(gnrDescribedBy, "gnr peker på meldingen").toBeTruthy();
    await expect(page.locator(`[id="${gnrDescribedBy!.split(" ")[0]}"]`).first()).toBeAttached();
    await expect(page).toHaveURL(/\/tilbud\/ny$/);

    // Mottatt frem i tid
    const future = `Testveien fremtid ${suffix}`;
    await page.goto("/tilbud/ny");
    await field.address(page).fill(future);
    const received = field.receivedAt(page);
    await received.fill(
      await receivedAtValue(received, new Date(Date.now() + 3 * 24 * 3600 * 1000)),
    );
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Mottatt kan ikke være frem i tid.")).toBeVisible();
    await expect(received).toHaveAttribute("aria-describedby", /.+/);

    await page.goto("/tilbud?status=all");
    await expect(page.getByRole("main")).not.toContainText(badGnr);
    await expect(page.getByRole("main")).not.toContainText(future);
  });

  test("8.5 takstmann ser listen og kan legge inn et tilbud", async ({ page }) => {
    const data = newOrderData(uniqueSuffix());
    await logInAsInspector(page);
    const id = await createOrderViaUi(page, data);
    // Søk på adressen: «Åpne» er sortert etter «Gyldig til», så et nytt tilbud kan stå utenfor
    // første side når testdatabasen har mange åpne tilbud.
    await page.goto(`/tilbud?q=${encodeURIComponent(data.address)}`);
    await expect(page.getByRole("main")).toContainText(data.address);
    expect(id).toBeTruthy();
  });

  test("8.6 bruker uten ansattrad får ingen tilgang og ser ingen adresse", async ({
    page,
    browser,
  }) => {
    // Lag et tilbud som admin, slik at listen har noe som ikke skal lekke
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    const data = newOrderData(uniqueSuffix());
    await logIn(adminPage);
    await createOrderViaUi(adminPage, data);
    await adminContext.close();

    const email = await createUserWithoutEmployee();
    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));
    const response = await page.goto("/tilbud");
    expectNoServerError(response, "/tilbud");
    await expect(deniedHeading(page)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(data.address);
    expect(html).not.toContain("Tilbudsveien");
  });

  test("8.8 ukjent tilbud-id gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    const url = `/tilbud/${randomUUID()}`;
    const response = await page.goto(url);
    expectNoServerError(response, url);
    await expect(deniedHeading(page)).toBeVisible();

    const bad = "/tilbud/ikke-en-id";
    const badResponse = await page.goto(bad);
    expectNoServerError(badResponse, bad);
    await expect(deniedHeading(page)).toBeVisible();
  });
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("8.7 knappene er minst 44 px høye", async ({ page }) => {
    await logIn(page);
    await page.goto("/tilbud");
    await expectAtLeast44(
      page.getByRole("link", { name: "Nytt tilbud", exact: true }),
      "Nytt tilbud",
    );
    await page.goto("/tilbud/ny");
    await expectAtLeast44(page.getByRole("button", { name: "Lagre", exact: true }), "Lagre");

    const data = newOrderData(uniqueSuffix());
    await createOrderViaUi(page, data);
    await expectAtLeast44(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
      "Gjør om til oppdrag",
    );
    await expectAtLeast44(
      page.getByRole("button", { name: "Avslå tilbud", exact: true }),
      "Avslå tilbud",
    );
  });

  test("8.7 skjemaet fylles ut og sendes med tastaturet alene", async ({ page }) => {
    const address = `Tastaturveien 1 ${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await page.goto("/tilbud/ny");

    const target = field.address(page);
    for (let i = 0; i < 40; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(target).toBeFocused();
    await page.keyboard.type(address);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(ORDER_URL);
    await expect(page.getByRole("main")).toContainText(address);
  });

  test("8.7 i stående har /tilbud, /tilbud/ny og /tilbud/<id> ingen vannrett rulling, og skjemaet står i én kolonne", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const id = await createOrderViaUi(page, newOrderData(uniqueSuffix()));

    for (const url of ["/tilbud", "/tilbud/ny", `/tilbud/${id}`]) {
      await page.goto(url);
      await expectNoHorizontalScroll(page, url);
    }

    await page.goto("/tilbud/ny");
    const boxes = await Promise.all(
      [field.address(page), field.gnr(page), field.bnr(page), field.orderedBy(page)].map((f) =>
        f.boundingBox(),
      ),
    );
    const lefts = boxes.map((box) => Math.round(box!.x));
    expect(new Set(lefts).size, "alle feltene starter i samme kolonne").toBe(1);
    // Rekkefølgen i skjemaet bestemmer utvikleren; to felt står aldri på samme rad
    const tops = boxes.map((box) => Math.round(box!.y)).sort((a, b) => a - b);
    expect(new Set(tops).size, "feltene står under hverandre, ett per rad").toBe(tops.length);
  });
});
