import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  employeeByEmail,
  logIn,
  logInAsInspector,
  uniqueSuffix,
} from "./helpers";

/*
 * Revisjonsloggen for admin på /admin/logg (fase 0b).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md avsnitt 6.
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Databasen tømmes ikke mellom kjøringene: hver test lager sitt eget kontor med unikt navn og
 * unik adresse («Testveien {suffix}»). Data er oppdiktet. Ingen e2e uten nett: adminområdet
 * krever nett.
 *
 * Støtter hovedmål: reklamasjoner (admin ser hvem som endret hva og når; takstmann ser ingenting).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const LOG_URL = "/admin/logg";

/** Undermenyen øverst i adminområdet. */
function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

/** Fanen «Logg» i undermenyen. */
function logTab(page: Page): Locator {
  return adminNav(page).getByRole("link", { name: "Logg", exact: true });
}

/** Siden «Ingen tilgang» eller 404: samme svar uansett, aldri data. */
function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

/** Radene i loggen (overskriftsraden er skjult for skjermleser og telles ikke). */
function logRows(page: Page): Locator {
  return page.getByRole("main").getByRole("listitem");
}

/** Raden med endringen til den nye adressen. */
function addressRow(page: Page, address: string): Locator {
  return logRows(page).filter({ hasText: `→ ${address}` });
}

function expectNoServerError(response: Response | null, url: string) {
  expect(response, `${url} svarer`).not.toBeNull();
  expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
}

/**
 * Lager et kontor og endrer adressen til «Testveien {suffix}» via /admin/kontorer.
 * Gir adressen tilbake.
 */
async function changeOfficeAddress(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const name = `Loggkontor ${suffix}`;
  const address = `Testveien ${suffix}`;

  await page.goto("/admin/kontorer/ny");
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill("Kontorveien 1");
  await page.getByLabel("Rekkefølge", { exact: true }).fill("95");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);

  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\/[0-9a-f-]{36}$/);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill(address);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);
  return address;
}

test.describe("revisjonsloggen (pc og iPad liggende)", () => {
  test("1. admin ser sin egen endring etter ett trykk på «Logg»", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    const address = await changeOfficeAddress(page);

    // Ett trykk fra adminområdet
    await logTab(page).click();
    await expect(page).toHaveURL(/\/admin\/logg$/);
    await expect(page.getByRole("heading", { name: "Logg", level: 1 })).toBeVisible();

    const row = addressRow(page, address);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(admin.name);
    await expect(row).toContainText(/Kontor – (Endret|Opprettet)/);
    await expect(row).toContainText(/\d{2}\.\d{2}\.\d{4}/);
    await expect(row).toContainText(`Kontorveien 1 → ${address}`);
  });

  test("2. fanen «Logg» er aktiv og minst 44 px høy", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto(LOG_URL);
    const tab = logTab(page);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("aria-current", "page");
    const box = await tab.boundingBox();
    expect(box, "Logg er synlig").not.toBeNull();
    expect(box!.height, "Logg er minst 44 px høy").toBeGreaterThanOrEqual(44);
    // Bare én fane er aktiv
    await expect(adminNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("4. takstmann får «Ingen tilgang» eller 404 og ser ingen rader", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logInAsInspector(page);
    const response = await page.goto(LOG_URL);
    expectNoServerError(response, LOG_URL);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Logg", level: 1 })).toHaveCount(0);
    await expect(adminNav(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Logg", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByText("→")).toHaveCount(0);
    const html = await page.content();
    expect(html, "viser ikke navnet til admin").not.toContain(admin.name);
    expect(html, "viser ikke e-posten til admin").not.toContain(ADMIN_EMAIL);
    expect(html, "viser ikke e-posten til takstmannen").not.toContain(INSPECTOR_EMAIL);
    expect(html, "viser ingen adresse fra loggen").not.toContain("Testveien");
  });

  test("6. ukjente søkeparametre gir samme side for admin, aldri 500", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    const address = await changeOfficeAddress(page);

    for (const url of [
      LOG_URL,
      `${LOG_URL}?limit=abc`,
      `${LOG_URL}?organizationId=${randomUUID()}`,
    ]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(page.getByRole("heading", { name: "Logg", level: 1 }), url).toBeVisible();
      await expect(deniedHeading(page), url).toHaveCount(0);
      await expect(logTab(page), url).toHaveAttribute("aria-current", "page");
      // Organisasjonen kommer fra tilgangssjekken: egen endring står der uansett parametre
      const row = addressRow(page, address);
      await expect(row, url).toHaveCount(1);
      await expect(row, url).toContainText(admin.name);
    }
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("3. loggen har ingen vannrett rulling, og raden er synlig", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    const address = await changeOfficeAddress(page);
    await logTab(page).click();
    await expect(page).toHaveURL(/\/admin\/logg$/);

    const row = addressRow(page, address);
    await expect(row).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${LOG_URL} ruller ikke vannrett`).toBeLessThanOrEqual(clientWidth);
  });
});
