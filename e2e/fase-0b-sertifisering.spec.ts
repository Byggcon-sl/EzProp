import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  ADMIN_EMAIL,
  expectAtLeast44,
  logIn,
  logInAsInspector,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * Sertifisering med utløpsdato (fase 0b), sett fra admin og takstmann.
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 6.
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Data: oppdiktet og unik per test (ny ansatt med e-post på eksempel.no). Databasen tømmes ikke,
 * så listen «Sertifiseringer» er sjelden tom; meldingen for tom liste er dekket i
 * src/app/(ansatt)/admin/sertifiseringer/page.test.ts. Seed-admin får aldri sertifisering her.
 * Ingen test uten nett: adminområdet krever nett.
 *
 * Støtter hovedmål: reklamasjoner (admin ser i tide hvem som må fornye, og ingen publiserer uten
 * gyldig sertifisering) og tid (ett skjema, ett trykk).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_VALID_TO = "Velg dato for gyldig til.";
const FROM_AFTER_TO = "Gyldig fra kan ikke være etter gyldig til.";

/** Dato `days` dager frem i norsk tid, som «ÅÅÅÅ-MM-DD». */
function isoDaysFromToday(days: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(
    new Date(Date.now() + days * DAY_MS),
  );
}

/** «2027-10-31» blir «31.10.2027». */
function norwegianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

/** Sertifiseringene på siden til den ansatte. */
function certificationItems(page: Page): Locator {
  return page.getByRole("list", { name: "Sertifiseringer" }).getByRole("listitem");
}

/** Linjen for en ansatt i listen /admin/sertifiseringer. */
function expiringRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: name });
}

/** Skjemaet «Legg til sertifisering» (siden har flere skjemaer med «Lagre …»). */
function certForm(page: Page): Locator {
  return page.locator("form").filter({
    has: page.getByRole("heading", { name: "Legg til sertifisering" }),
  });
}

function saveButton(page: Page): Locator {
  return certForm(page).getByRole("button", { name: /^Lagre/ });
}

function certField(page: Page, label: string): Locator {
  return certForm(page).getByLabel(label, { exact: true });
}

/** Ny nettleserkontekst med samme adresse og skjermstørrelse som prosjektet. */
async function newProjectPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { baseURL, viewport, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
  return context.newPage();
}

/**
 * Admin → Ansatte → «Ny ansatt» med rollene (standard: takstmann) → siden til den ansatte.
 * Gir navn, e-post og adressen til siden.
 */
async function createEmployee(page: Page, options: { admin?: boolean } = {}) {
  const suffix = uniqueSuffix();
  const name = `Sertifisert Testesen ${suffix}`;
  const email = `sertifisering-${suffix}@eksempel.no`;
  await page.goto("/admin/ansatte");
  await page.getByRole("link", { name: "Ny ansatt", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/ny$/);
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("E-post", { exact: true }).fill(email);
  if (options.admin) {
    await page.getByRole("group", { name: "Roller" }).getByLabel("Admin", { exact: true }).check();
  }
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=ny-ansatt$/);
  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return { name, email, url: new URL(page.url()).pathname };
}

/** Åpner skjemaet «Legg til sertifisering» og sjekker at området er forhåndsvalgt. */
async function openAddForm(page: Page) {
  await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
  const form = certForm(page);
  await expect(form.getByText("Tilstandsrapport bolig", { exact: true })).toBeVisible();
  return form;
}

async function addCertification(page: Page, data: { validTo: string; number?: string }) {
  await openAddForm(page);
  await certField(page, "Gyldig til").fill(data.validTo);
  if (data.number) {
    await certField(page, "Sertifikatnummer (valgfritt)").fill(data.number);
  }
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}\?lagret=sertifisering$/);
}

/** Feltet har `aria-invalid` og meldingen er koblet med `aria-describedby`. */
async function expectFieldError(page: Page, field: Locator, message: string) {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "feltet peker på meldingen").not.toBe("");
  const texts = await Promise.all(
    describedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => page.locator(`[id="${id}"]`).textContent()),
  );
  expect(texts.join(" ")).toContain(message);
}

test.describe("sertifiseringer (pc og iPad liggende)", () => {
  test("6.1 admin legger til en sertifisering og ser den på den ansatte og i listen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployee(page);
    const validTo = isoDaysFromToday(20);
    await addCertification(page, { validTo, number: "TEST-CERT-0001" });

    const items = certificationItems(page);
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Tilstandsrapport bolig");
    await expect(items).toContainText(`Gyldig til ${norwegianDate(validTo)}`);
    await expect(items).toContainText("TEST-CERT-0001");
    await expect(items).toContainText("Går ut snart");

    await adminNav(page).getByRole("link", { name: "Sertifiseringer", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/sertifiseringer$/);
    const row = expiringRow(page, employee.name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Gyldig til ${norwegianDate(validTo)}`);
    await expect(row).toContainText("Går ut snart");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${employee.url}$`));
  });

  test("6.2 fornyelse ett år frem tar den ansatte ut av listen, og begge radene står", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployee(page);
    await addCertification(page, { validTo: isoDaysFromToday(20) });
    await page.goto("/admin/sertifiseringer");
    await expect(expiringRow(page, employee.name)).toHaveCount(1);

    await page.goto(employee.url);
    const renewed = isoDaysFromToday(365);
    await addCertification(page, { validTo: renewed });
    await expect(certificationItems(page)).toHaveCount(2);
    // Nyeste først, og den nye har ikke merke
    await expect(certificationItems(page).first()).toContainText(
      `Gyldig til ${norwegianDate(renewed)}`,
    );
    await expect(certificationItems(page).first()).not.toContainText(/Går ut snart|Utgått/);

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(expiringRow(page, employee.name)).toHaveCount(0);
  });

  test("6.3 «Fjern» spør først; «Avbryt» lar raden stå, bekreftelse fjerner den", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await createEmployee(page);
    const validTo = isoDaysFromToday(200);
    await addCertification(page, { validTo });
    await expect(certificationItems(page)).toHaveCount(1);

    await certificationItems(page)
      .getByRole("button", { name: /^Fjern/ })
      .click();
    await certificationItems(page).getByRole("button", { name: "Avbryt", exact: true }).click();
    await expect(certificationItems(page)).toHaveCount(1);

    await certificationItems(page)
      .getByRole("button", { name: /^Fjern/ })
      .click();
    await certificationItems(page)
      .getByRole("button", { name: /^Ja, fjern/ })
      .click();
    await expect(page).toHaveURL(/\?lagret=sertifisering-fjernet$/);
    await expect(certificationItems(page)).toHaveCount(0);
    await expect(page.getByText(`Gyldig til ${norwegianDate(validTo)}`)).toHaveCount(0);
  });

  test("6.4 feilmeldingene står ved feltet og er koblet til det", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await createEmployee(page);

    await openAddForm(page);
    await saveButton(page).click();
    const validTo = certField(page, "Gyldig til");
    await expect(page.getByText(MISSING_VALID_TO)).toBeVisible();
    await expectFieldError(page, validTo, MISSING_VALID_TO);

    await validTo.fill("2027-01-01");
    const validFrom = certField(page, "Gyldig fra (valgfritt)");
    await validFrom.fill("2027-01-02");
    await saveButton(page).click();
    await expect(page.getByText(FROM_AFTER_TO)).toBeVisible();
    await expectFieldError(page, validFrom, FROM_AFTER_TO);
    await expect(certificationItems(page)).toHaveCount(0);
  });

  test("6.5 admin uten sertifisering kommer inn i adminområdet (regel 11)", async ({
    page,
    browser,
  }, testInfo) => {
    // Seed-admin får aldri sertifisering i e2e
    await logIn(page, ADMIN_EMAIL);
    for (const url of ["/admin", "/admin/ansatte", "/admin/sertifiseringer"]) {
      await page.goto(url);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(deniedHeading(page)).toHaveCount(0);
    }

    // En helt ny admin har garantert ingen sertifisering
    const newAdmin = await createEmployee(page, { admin: true });
    const other = await newProjectPage(browser, testInfo);
    try {
      await other.goto("/logg-inn");
      await signInWithCode(other, newAdmin.email);
      await expect(other).toHaveURL(/\/arbeidskoe$/);
      await expect(mainNav(other).getByRole("link", { name: "Admin", exact: true })).toBeVisible();
      for (const url of ["/admin", "/admin/ansatte", "/admin/sertifiseringer"]) {
        await other.goto(url);
        await expect(other.getByRole("main")).toBeVisible();
        await expect(deniedHeading(other)).toHaveCount(0);
      }
      await expect(other.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    } finally {
      await other.context().close();
    }
  });

  test("6.6 takstmann får ikke åpnet /admin/sertifiseringer og ser ikke «Admin»", async ({
    page,
  }) => {
    await logInAsInspector(page);
    await expect(mainNav(page)).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Admin" })).toHaveCount(0);
    const response = await page.goto("/admin/sertifiseringer");
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(page.getByText("Går ut snart")).toHaveCount(0);
    await expect(page.getByText("Utgått")).toHaveCount(0);
  });

  test("6.8 iPad: knappene er minst 44 px, ingen vannrett rulling, datofeltet fylles med tastatur", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
    await logIn(page, ADMIN_EMAIL);
    await createEmployee(page);
    await expectAtLeast44(
      page.getByRole("button", { name: "Legg til sertifisering", exact: true }),
      "Legg til sertifisering",
    );
    await openAddForm(page);
    await expectAtLeast44(saveButton(page), "Lagre");
    await expectNoHorizontalScroll(page);

    const validTo = certField(page, "Gyldig til");
    await typeDateWithKeyboard(page, validTo, "2027", "12", "31");
    await expect(validTo).toHaveValue("2027-12-31");
    await saveButton(page).click();
    await expect(page).toHaveURL(/\?lagret=sertifisering$/);
    await expectAtLeast44(
      certificationItems(page).getByRole("button", { name: /^Fjern/ }),
      "Fjern",
    );
    await expectNoHorizontalScroll(page);
  });
});

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${page.url()} ruller ikke vannrett`).toBeLessThanOrEqual(clientWidth);
}

/**
 * Fyller datofeltet bare med tastaturet. Rekkefølgen på dag, måned og år i feltet følger språket
 * til nettleseren (ikke alltid `locale`), så de vanlige rekkefølgene prøves til verdien stemmer.
 */
async function typeDateWithKeyboard(
  page: Page,
  field: Locator,
  year: string,
  month: string,
  day: string,
) {
  const expected = `${year}-${month}-${day}`;
  const orders = [
    [day, month, year],
    [month, day, year],
    [year, month, day],
  ];
  for (const order of orders) {
    await field.fill("");
    // Trykk helt til venstre i feltet, slik at første del (dag, måned eller år) er valgt
    const box = await field.boundingBox();
    await field.click({ position: { x: 12, y: (box?.height ?? 44) / 2 } });
    await page.keyboard.type(order.join(""));
    if ((await field.inputValue()) === expected) return;
  }
  expect(await field.inputValue(), "datofeltet kan fylles med tastatur").toBe(expected);
}

test.describe("sertifiseringer på iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("6.8 stående: skjemaet uten vannrett rulling, knappene minst 44 px, listen kan åpnes", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployee(page);
    await openAddForm(page);
    await expectAtLeast44(saveButton(page), "Lagre");
    await expectNoHorizontalScroll(page);
    await certField(page, "Gyldig til").fill(isoDaysFromToday(10));
    await saveButton(page).click();
    await expect(page).toHaveURL(/\?lagret=sertifisering$/);
    await expectAtLeast44(
      certificationItems(page).getByRole("button", { name: /^Fjern/ }),
      "Fjern",
    );

    await page.goto("/admin/sertifiseringer");
    await expect(expiringRow(page, employee.name)).toHaveCount(1);
    await expectNoHorizontalScroll(page);
  });
});
