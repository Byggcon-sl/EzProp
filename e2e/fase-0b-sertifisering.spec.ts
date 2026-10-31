import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { addDays, todayInOslo } from "../src/shared/lib/dates";
import { ADMIN_EMAIL, logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Sertifisering med utløpsdato (fase 0b).
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 8.
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Ekte klokke: datoene settes relativt til i dag i norsk tid. Hver test lager sin egen ansatt med
 * unikt navn, fordi e2e-databasen ikke tømmes mellom kjøringene. Seed-admin får aldri
 * sertifisering her (admin uten sertifisering skal komme inn, regel 11). Data er oppdiktet.
 * Ingen e2e uten nett: adminområdet krever nett.
 *
 * Støtter hovedmål: reklamasjoner (ingen publiserer uten gyldig sertifisering, admin ser hvem som
 * må fornye) og tid (fornyelse er én ny rad, ingen regneark).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const LIST_URL = "/admin/sertifiseringer";

/** Undermenyen øverst i adminområdet. */
function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

/** «Ingen tilgang» eller 404: samme svar uansett, aldri data. */
function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

/** Kortet «Sertifiseringer» på siden til den ansatte (innerste element med overskriften). */
function certSection(page: Page): Locator {
  return page
    .getByRole("main")
    .locator("section, div")
    .filter({ has: page.getByRole("heading", { name: "Sertifiseringer", level: 2 }) })
    .last();
}

/** Radene i seksjonen. */
function certItems(page: Page): Locator {
  return certSection(page).getByRole("listitem");
}

/** Skjemaet «Legg til sertifisering». */
function addForm(page: Page): Locator {
  return page.getByRole("form", { name: "Legg til sertifisering" });
}

/** Linjen for navnet på /admin/sertifiseringer. */
function listRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: name });
}

/** «2026-12-30» blir «30.12.2026», slik skjermene viser datoen. */
function norwegianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
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

/**
 * Admin lager en ny takstmann i «Ny ansatt» og åpner siden til den ansatte. Returnerer navnet og
 * stien («/admin/ansatte/<id>»).
 */
async function createEmployeeAndOpen(page: Page): Promise<{ name: string; path: string }> {
  const suffix = uniqueSuffix();
  const name = `Sertansatt ${suffix}`;
  await page.goto("/admin/ansatte/ny");
  await expect(page.getByRole("heading", { name: "Ny ansatt", level: 1 })).toBeVisible();
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("E-post", { exact: true }).fill(`sert-${suffix}@eksempel.no`);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=ny-ansatt$/);

  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return { name, path: new URL(page.url()).pathname };
}

/** «Legg til sertifisering» → datoene → «Lagre». Tom `validTo` lar feltet stå tomt. */
async function addCertification(page: Page, validTo: string, validFrom?: string) {
  await certSection(page).getByRole("button", { name: "Legg til sertifisering" }).click();
  const form = addForm(page);
  await expect(form).toBeVisible();
  if (validTo) await form.getByLabel("Gyldig til", { exact: true }).fill(validTo);
  if (validFrom) await form.getByLabel("Gyldig fra", { exact: true }).fill(validFrom);
  await form.getByRole("button", { name: "Lagre", exact: true }).click();
}

/** Raden i seksjonen for datoen «Gyldig til». */
function certItem(page: Page, validTo: string): Locator {
  return certItems(page).filter({ hasText: norwegianDate(validTo) });
}

/** Teksten i elementene feltet peker på med `aria-describedby`. */
async function describedByText(page: Page, field: Locator): Promise<string> {
  const ids = ((await field.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  const texts = await Promise.all(
    ids.map((id) => page.locator(`[id="${id}"]`).first().textContent()),
  );
  return texts.join(" ");
}

/**
 * Om nettleserens datofelt har dagen først (31.12.2026) eller måneden først (12/31/2026). Finnes
 * med et midlertidig prøvefelt utenfor skjemaet, som fjernes igjen; skjemaet røres ikke.
 */
async function dateInputIsDayFirst(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    const probe = document.createElement("input");
    probe.type = "date";
    probe.id = "e2e-date-probe";
    document.body.append(probe);
  });
  const probe = page.locator("#e2e-date-probe");
  await probe.focus();
  await page.keyboard.type("01022026");
  const value = await probe.inputValue();
  await page.evaluate(() => document.getElementById("e2e-date-probe")?.remove());
  return value === "2026-02-01";
}

test.describe("sertifisering i adminområdet (pc og iPad liggende)", () => {
  test("1. admin legger til en sertifisering og ser den i listen", async ({ page }) => {
    const validTo = addDays(todayInOslo(), 30);
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployeeAndOpen(page);

    // Merknaden ved «Publisere rapport»: avkrysningen alene er ikke nok
    await expect(page.getByRole("checkbox", { name: /^Publisere rapport\b/ })).toBeVisible();
    await expect(page.getByText("Krever gyldig sertifisering.")).toBeVisible();

    await addCertification(page, validTo);
    const item = certItem(page, validTo);
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Tilstandsrapport bolig");
    await expect(item).toContainText("Går ut snart");

    await page.goto(LIST_URL);
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    const row = listRow(page, employee.name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Går ut snart");
    await expect(row).toContainText(norwegianDate(validTo));
    await expect(row).toHaveAttribute("href", employee.path);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${employee.path}$`));
  });

  test("2. «Fjern» med bekreftelse; «Avbryt» fjerner ingenting", async ({ page }) => {
    const validTo = addDays(todayInOslo(), 20);
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployeeAndOpen(page);
    await addCertification(page, validTo);
    await expect(certItem(page, validTo)).toHaveCount(1);

    // «Avbryt» i bekreftelsen
    await certItem(page, validTo).getByRole("button", { name: "Fjern", exact: true }).click();
    await certItem(page, validTo).getByRole("button", { name: "Avbryt", exact: true }).click();
    await page.reload();
    await expect(certItem(page, validTo)).toHaveCount(1);

    // «Fjern» → bekreft
    await certItem(page, validTo).getByRole("button", { name: "Fjern", exact: true }).click();
    await certItem(page, validTo)
      .getByRole("button", { name: /^(Bekreft|Ja, fjern|Fjern sertifiseringen)$/ })
      .click();
    await expect(certItem(page, validTo)).toHaveCount(0);
    await page.reload();
    await expect(certItem(page, validTo)).toHaveCount(0);

    await page.goto(LIST_URL);
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(listRow(page, employee.name)).toHaveCount(0);
  });

  test("3. utgått vises som «Utgått»; fornyelse tar navnet ut av listen", async ({ page }) => {
    const today = todayInOslo();
    const yesterday = addDays(today, -1);
    const renewed = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployeeAndOpen(page);

    await addCertification(page, yesterday);
    await expect(certItem(page, yesterday)).toContainText("Utgått");

    await page.goto(LIST_URL);
    await expect(listRow(page, employee.name)).toContainText("Utgått");

    await page.goto(employee.path);
    await addCertification(page, renewed);
    await expect(certItem(page, renewed)).toHaveCount(1);
    // Den gamle står som historikk
    await expect(certItem(page, yesterday)).toContainText("Utgått");

    await page.goto(LIST_URL);
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(listRow(page, employee.name)).toHaveCount(0);
  });

  test("4. feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    const today = todayInOslo();
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);

    // Tom «Gyldig til»
    await addCertification(page, "");
    const validToField = addForm(page).getByLabel("Gyldig til", { exact: true });
    await expect(page.getByText("Velg dato for gyldig til.").first()).toBeVisible();
    expect(await describedByText(page, validToField)).toContain("Velg dato for gyldig til.");
    await expect(certItems(page)).toHaveCount(0);

    // «Gyldig fra» etter «Gyldig til»
    const form = addForm(page);
    await form.getByLabel("Gyldig til", { exact: true }).fill(addDays(today, 10));
    await form.getByLabel("Gyldig fra", { exact: true }).fill(addDays(today, 20));
    await form.getByRole("button", { name: "Lagre", exact: true }).click();
    const message = "Gyldig fra kan ikke være etter gyldig til.";
    await expect(page.getByText(message).first()).toBeVisible();
    const described =
      (await describedByText(page, addForm(page).getByLabel("Gyldig fra", { exact: true }))) +
      (await describedByText(page, addForm(page).getByLabel("Gyldig til", { exact: true })));
    expect(described).toContain(message);

    await page.reload();
    await expect(certItems(page)).toHaveCount(0);
  });

  test("5. takstmann får ikke se listen", async ({ page, browser }, testInfo) => {
    // Admin legger inn en som går ut snart, så listen har data
    const admin = await newProjectPage(browser, testInfo);
    let employeeName = "";
    try {
      await logIn(admin, ADMIN_EMAIL);
      const employee = await createEmployeeAndOpen(admin);
      employeeName = employee.name;
      await addCertification(admin, addDays(todayInOslo(), 15));
      await admin.goto(LIST_URL);
      await expect(listRow(admin, employeeName)).toHaveCount(1);
    } finally {
      await admin.context().close();
    }

    await logInAsInspector(page);
    const response = await page.goto(LIST_URL);
    expect(response, `${LIST_URL} svarer`).not.toBeNull();
    expect(response!.status(), `${LIST_URL} gir ikke 500`).toBeLessThan(500);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(adminNav(page)).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(employeeName);
    expect(html).not.toContain("Går ut snart");
    expect(html).not.toContain("Tilstandsrapport bolig");
  });

  test("6. admin uten sertifisering kommer inn i adminområdet (regel 11)", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/ansatte");
    await expect(page.getByRole("heading", { name: "Ansatte", level: 1 })).toBeVisible();
    await expect(deniedHeading(page)).toHaveCount(0);

    const response = await page.goto(LIST_URL);
    expect(response!.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(deniedHeading(page)).toHaveCount(0);
  });

  test("8. fanen «Sertifiseringer» vises i adminområdet og er aktiv på siden", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/ansatte");
    const tab = adminNav(page).getByRole("link", { name: "Sertifiseringer", exact: true });
    await expect(tab).toBeVisible();
    await expect(tab).not.toHaveAttribute("aria-current", "page");

    await tab.click();
    await expect(page).toHaveURL(/\/admin\/sertifiseringer$/);
    await expect(
      adminNav(page).getByRole("link", { name: "Sertifiseringer", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      adminNav(page).getByRole("link", { name: "Ansatte", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
  });
});

test.describe("iPad (bare prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7a. knappene er minst 44 px", async ({ page }) => {
    const validTo = addDays(todayInOslo(), 40);
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);

    await expectAtLeast44(
      certSection(page).getByRole("button", { name: "Legg til sertifisering" }),
      "Legg til sertifisering",
    );
    await certSection(page).getByRole("button", { name: "Legg til sertifisering" }).click();
    await expectAtLeast44(
      addForm(page).getByRole("button", { name: "Lagre", exact: true }),
      "Lagre",
    );
    await addForm(page).getByLabel("Gyldig til", { exact: true }).fill(validTo);
    await addForm(page).getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(certItem(page, validTo)).toHaveCount(1);
    await expectAtLeast44(
      certItem(page, validTo).getByRole("button", { name: "Fjern", exact: true }),
      "Fjern",
    );
  });

  test("7b. skjemaet fylles og sendes med tastaturet alene", async ({ page }) => {
    const validTo = addDays(todayInOslo(), 45);
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);
    // Rekkefølgen på delene i datofeltet finnes før skjemaet åpnes
    const dayFirst = await dateInputIsDayFirst(page);

    const open = certSection(page).getByRole("button", { name: "Legg til sertifisering" });
    for (let i = 0; i < 80; i++) {
      if (await open.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");

    // «Gyldig til»: datofeltet skrives i den rekkefølgen nettleseren viser delene
    const field = addForm(page).getByLabel("Gyldig til", { exact: true });
    for (let i = 0; i < 10; i++) {
      if (await field.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    const [year, month, day] = validTo.split("-") as [string, string, string];
    await page.keyboard.type(dayFirst ? `${day}${month}${year}` : `${month}${day}${year}`);
    await expect(field).toHaveValue(validTo);

    const save = addForm(page).getByRole("button", { name: "Lagre", exact: true });
    for (let i = 0; i < 20; i++) {
      if (await save.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(certItem(page, validTo)).toHaveCount(1);
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7c. ansattskjermen med sertifisering og listen har ingen vannrett rulling", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const employee = await createEmployeeAndOpen(page);
    await addCertification(page, addDays(todayInOslo(), 25));
    await expect(certItems(page)).toHaveCount(1);

    for (const url of [employee.path, LIST_URL]) {
      await page.goto(url);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalScroll(page, url);
    }
  });
});
