import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, todayInOslo } from "../src/shared/lib/dates";
import { ADMIN_EMAIL, logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Sertifisering med utløpsdato (fase 0b).
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 8.
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Ekte klokke: datoene settes relativt til i dag i norsk tid. Hver test lager sin egen ansatt med
 * unikt navn, siden e2e-databasen ikke tømmes mellom kjøringene. Data er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (admin ser i god tid hvem som må fornye) og tid (fornyelse er
 * ett skjema og ett trykk).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;

/** Lager en ny takstmann i adminområdet og åpner siden til personen. Gir navnet tilbake. */
async function createEmployee(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const name = `Kari Sertifisert ${suffix}`;
  await page.goto("/admin/ansatte/ny");
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("E-post", { exact: true }).fill(`sert.${suffix}@eksempel.no`);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=ny-ansatt$/);
  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return name;
}

/** Radene i listen over sertifiseringer på den ansatte. */
function certificationItems(page: Page): Locator {
  return page.getByRole("list", { name: "Sertifiseringer" }).getByRole("listitem");
}

/** Åpner «Legg til sertifisering», fyller feltene og trykker «Lagre». */
async function addCertification(page: Page, validTo: string, validFrom = "") {
  await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
  await page.getByLabel("Gyldig til", { exact: true }).fill(validTo);
  if (validFrom) await page.getByLabel("Gyldig fra", { exact: true }).fill(validFrom);
  await page.getByLabel("Sertifikatnummer", { exact: true }).fill("TEST-CERT-0001");
  await page.getByLabel("Utsteder", { exact: true }).fill("Testsertifisering AS");
  await saveButton(page).click();
}

/** «Lagre» i skjemaet «Legg til sertifisering» (siden har også «Lagre» for opplysningene). */
function saveButton(page: Page): Locator {
  return page
    .getByRole("form", { name: "Legg til sertifisering" })
    .getByRole("button", { name: "Lagre", exact: true });
}

/** Raden for den ansatte i listen på /admin/sertifiseringer. */
function expiringRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: name });
}

function norwegian(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

async function expectNoHorizontalScroll(page: Page, url: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${url} ruller ikke vannrett`).toBeLessThanOrEqual(clientWidth);
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

test.describe("Sertifiseringer (admin)", () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
  });

  test("8.1 admin legger til en sertifisering og ser den i listen", async ({ page }) => {
    const name = await createEmployee(page);
    await expect(page.getByText("Krever gyldig sertifisering.")).toBeVisible();
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();

    const validTo = addDays(todayInOslo(), 30);
    await addCertification(page, validTo);
    await expect(page).toHaveURL(/\?lagret=sertifisering$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Sertifiseringen er lagret." }),
    ).toBeVisible();
    const item = certificationItems(page);
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Tilstandsrapport bolig");
    await expect(item).toContainText(`Gyldig til ${norwegian(validTo)}`);
    await expect(item).toContainText("TEST-CERT-0001");
    await expect(item).toContainText("Går ut snart");
    const employeeUrl = new URL(page.url()).pathname;

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    const row = expiringRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Går ut snart");
    await expect(row).toHaveAttribute("href", employeeUrl);
    await row.click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  });

  test("8.2 fjerne med bekreftelse; «Avbryt» fjerner ingenting", async ({ page }) => {
    const name = await createEmployee(page);
    await addCertification(page, addDays(todayInOslo(), 10));
    await expect(certificationItems(page)).toHaveCount(1);

    await certificationItems(page).getByRole("button", { name: "Fjern", exact: true }).click();
    await page.getByRole("button", { name: "Avbryt", exact: true }).click();
    await expect(certificationItems(page)).toHaveCount(1);
    await page.reload();
    await expect(certificationItems(page)).toHaveCount(1);

    await certificationItems(page).getByRole("button", { name: "Fjern", exact: true }).click();
    await page.getByRole("button", { name: "Bekreft", exact: true }).click();
    await expect(page).toHaveURL(/\?lagret=sertifisering-fjernet$/);
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(expiringRow(page, name)).toHaveCount(0);
  });

  test("8.3 utgått vises som «Utgått»; fornyelse tar navnet ut av listen", async ({ page }) => {
    const name = await createEmployee(page);
    const employeeUrl = new URL(page.url()).pathname;
    await addCertification(page, addDays(todayInOslo(), -1));
    await expect(certificationItems(page)).toContainText("Utgått");

    await page.goto("/admin/sertifiseringer");
    await expect(expiringRow(page, name)).toContainText("Utgått");

    await page.goto(employeeUrl);
    await addCertification(page, addDays(todayInOslo(), 365));
    await expect(certificationItems(page)).toHaveCount(2);

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(expiringRow(page, name)).toHaveCount(0);
  });

  test("8.4 feilmeldinger ved feltet, og ingenting lagres", async ({ page }) => {
    await createEmployee(page);
    await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
    await saveButton(page).click();
    const validTo = page.getByLabel("Gyldig til", { exact: true });
    await expect(page.getByText("Velg dato for gyldig til.")).toBeVisible();
    await expect(validTo).toHaveAttribute("aria-invalid", "true");
    await expect(validTo).toHaveAttribute("aria-describedby", /validTo-error/);

    const today = todayInOslo();
    await validTo.fill(addDays(today, 10));
    await page.getByLabel("Gyldig fra", { exact: true }).fill(addDays(today, 20));
    await saveButton(page).click();
    const validFrom = page.getByLabel("Gyldig fra", { exact: true });
    await expect(page.getByText("Gyldig fra kan ikke være etter gyldig til.")).toBeVisible();
    await expect(validFrom).toHaveAttribute("aria-describedby", /validFrom-error/);

    await page.reload();
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();
  });

  test("8.6 admin uten sertifisering kommer inn i adminområdet", async ({ page }) => {
    for (const url of ["/admin/ansatte", "/admin/sertifiseringer"]) {
      const response = await page.goto(url);
      expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "Ingen tilgang" })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
  });

  test("8.8 fanen «Sertifiseringer» vises og er aktiv på siden", async ({ page }) => {
    await page.goto("/admin/ansatte");
    const tab = page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Sertifiseringer", exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/\/admin\/sertifiseringer$/);
    await expect(tab).toHaveAttribute("aria-current", "page");
  });
});

test("8.5 takstmann får ikke se listen", async ({ page }) => {
  await logInAsInspector(page);
  const response = await page.goto("/admin/sertifiseringer");
  expect(response, "siden svarer").not.toBeNull();
  expect(response!.status(), "gir ikke 500").toBeLessThan(500);
  await expect(
    page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 }),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("Går ut snart");
  expect(html).not.toContain("Utgått");
  expect(html).not.toContain("Kari Sertifisert");
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
    await logIn(page, ADMIN_EMAIL);
  });

  test("8.7a trykkflatene er minst 44 px, og skjemaet går med tastatur alene", async ({ page }) => {
    await createEmployee(page);
    const open = page.getByRole("button", { name: "Legg til sertifisering", exact: true });
    await expectAtLeast44(open, "Legg til sertifisering");

    // Tastatur alene: Enter på knappen flytter fokus til «Gyldig til».
    await open.focus();
    await page.keyboard.press("Enter");
    const validTo = page.getByLabel("Gyldig til", { exact: true });
    await expect(validTo).toBeFocused();
    await expectAtLeast44(saveButton(page), "Lagre");
    const date = addDays(todayInOslo(), 30);
    // Datofeltet fylles som tekst (rekkefølgen på delene i Chromium varierer med språket).
    await validTo.fill(date);
    await expect(validTo).toHaveValue(date);
    // Tab videre (også gjennom delene av datofeltet) til «Lagre», og send med Enter.
    const save = saveButton(page);
    for (let step = 0; step < 20; step += 1) {
      if (await save.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?lagret=sertifisering$/);
    await expect(certificationItems(page)).toHaveCount(1);
    await expectAtLeast44(
      certificationItems(page).getByRole("button", { name: "Fjern", exact: true }),
      "Fjern",
    );
  });
});

test.describe("iPad stående (prosjektet ipad)", () => {
  test.use(PORTRAIT);
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
    await logIn(page, ADMIN_EMAIL);
  });

  test("8.7b ansattsiden og /admin/sertifiseringer har ingen vannrett rulling", async ({
    page,
  }) => {
    await createEmployee(page);
    await addCertification(page, addDays(todayInOslo(), 5));
    await expect(certificationItems(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
    await expectNoHorizontalScroll(page, "ansattsiden");

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, "/admin/sertifiseringer");
  });
});
