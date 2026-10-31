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
 * Oppgavekort: docs/funksjoner/fase0b-revisjon-hendelser.md (Omfang 4).
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Data: oppdiktet og unikt per kjøring («Testveien {suffix}»). Databasen tømmes ikke mellom
 * kjøringene. Endringen er adressen på et kontor, fordi kontorer logger «fra → til».
 * Ingen e2e uten nett: adminområdet krever nett.
 *
 * Støtter hovedmål: reklamasjoner (admin ser hvem som endret hva og når, uten å spørre utviklerne).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

function expectNoServerError(response: Response | null, url: string) {
  expect(response, `${url} svarer`).not.toBeNull();
  expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
}

/** Raden i loggen (tabellrad på PC, listepunkt på iPad stående) som inneholder teksten. */
function logRow(page: Page, text: string): Locator {
  return page.getByRole("main").locator("tr, li").filter({ hasText: text });
}

/**
 * Lager et kontor med adressen «Kontorveien 1 {suffix}» og endrer adressen til
 * «Testveien {suffix}». Returnerer gammel og ny adresse.
 */
async function changeOfficeAddress(page: Page, suffix: string) {
  const name = `Testkontor logg ${suffix}`;
  const oldAddress = `Kontorveien 1 ${suffix}`;
  const newAddress = `Testveien ${suffix}`;

  await page.goto("/admin/kontorer/ny");
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill(oldAddress);
  await page.getByLabel("Rekkefølge", { exact: true }).fill("91");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);

  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\/[0-9a-f-]{36}$/);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill(newAddress);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);
  return { oldAddress, newAddress };
}

async function expectAdminChangeRow(
  page: Page,
  change: { oldAddress: string; newAddress: string },
  adminName: string,
) {
  const listed = logRow(page, `→ ${change.newAddress}`).first();
  await expect(listed).toBeVisible();
  await expect(listed).toContainText(adminName);
  await expect(listed).toContainText("Kontor");
  await expect(listed).toContainText(/Endret|Opprettet/);
  await expect(listed).toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await expect(listed).toContainText(`${change.oldAddress} → ${change.newAddress}`);
}

test.describe("revisjonsloggen (pc og iPad liggende)", () => {
  test("1. admin ser sin egen endring etter 1 trykk på «Logg»", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    const change = await changeOfficeAddress(page, uniqueSuffix());

    // Fra adminområdet: 1 trykk på fanen «Logg»
    await adminNav(page).getByRole("link", { name: "Logg", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/logg$/);
    await expectAdminChangeRow(page, change, admin.name);
  });

  test("2. fanen «Logg» er aktiv på /admin/logg og minst 44 px høy", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/logg");
    const tab = adminNav(page).getByRole("link", { name: "Logg", exact: true });
    await expect(tab).toHaveAttribute("aria-current", "page");
    const box = await tab.boundingBox();
    expect(box, "fanen «Logg» er synlig").not.toBeNull();
    expect(box!.height, "fanen «Logg» er minst 44 px høy").toBeGreaterThanOrEqual(44);
  });

  test("4. takstmann får «Ingen tilgang» eller 404 og ser ingen rader", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logInAsInspector(page);
    await expect(mainNav(page)).toBeVisible();

    const url = "/admin/logg";
    const response = await page.goto(url);
    expectNoServerError(response, url);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(adminNav(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Logg", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);

    const html = await page.content();
    expect(html, "viser ikke navnet til admin").not.toContain(admin.name);
    expect(html, "viser ikke e-posten til admin").not.toContain(ADMIN_EMAIL);
    expect(html, "viser ikke e-posten til takstmannen").not.toContain(INSPECTOR_EMAIL);
    expect(html, "viser ingen adresse fra loggen").not.toContain("Testveien");
    expect(html, "viser ingen adresse fra loggen").not.toContain("Kontorveien");
    expect(html, "viser ingen endring fra loggen").not.toContain("→");
  });

  test("6. ukjente parametre i adressen gir samme side for admin, aldri 500", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    const change = await changeOfficeAddress(page, uniqueSuffix());

    await page.goto("/admin/logg");
    const heading = await page.getByRole("heading", { level: 1 }).textContent();
    expect(heading).toBeTruthy();

    for (const url of ["/admin/logg?limit=abc", `/admin/logg?organizationId=${randomUUID()}`]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page), url).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 }), url).toHaveText(heading!);
      // Organisasjonen kommer fra getAdminContext, ikke fra adressen: egen endring vises fortsatt.
      await expectAdminChangeRow(page, change, admin.name);
    }
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("3. /admin/logg har ingen vannrett rulling, og endringen er synlig", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    const change = await changeOfficeAddress(page, uniqueSuffix());

    await page.goto("/admin/logg");
    await expect(page.getByRole("main")).toBeVisible();
    await expectAdminChangeRow(page, change, admin.name);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "/admin/logg ruller ikke vannrett").toBeLessThanOrEqual(clientWidth);
  });
});
