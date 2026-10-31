import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN_EMAIL, logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Sertifisering med utløpsdato (fase 0b), skjermene.
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 6.
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Data: oppdiktet og unik per test (ny ansatt med e-post på eksempel.no). Databasen tømmes ikke,
 * så listen «Sertifiseringer» er sjelden tom; meldingen for tom liste testes i
 * src/app/(ansatt)/admin/sertifiseringer/page.test.ts. Seed-admin får aldri sertifisering her.
 *
 * Støtter hovedmål: reklamasjoner (admin ser i tide hvem som må fornye) og tid (ett skjema, ett
 * trykk på «Lagre sertifisering»).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Dato `days` dager frem i norsk tid, som «ÅÅÅÅ-MM-DD» (verdien i datofeltet). */
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

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

function certificationList(page: Page): Locator {
  return page.getByRole("list", { name: "Sertifiseringer" });
}

/** Raden i listen «Sertifiseringer» for en ansatt (én lenke per rad). */
function expiringRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: name });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

/** Admin lager en ny ansatt (takstmann) og åpner siden til den ansatte. Gir navnet. */
async function createEmployeeAndOpen(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const name = `Sertansatt ${suffix}`;
  await page.goto("/admin/ansatte/ny");
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("E-post", { exact: true }).fill(`sert-${suffix}@eksempel.no`);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=ny-ansatt$/);
  await page.getByRole("main").getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return name;
}

/** «Legg til sertifisering» → fyll ut → «Lagre sertifisering» → kvittering. */
async function addCertification(
  page: Page,
  data: { validTo: string; validFrom?: string; number?: string; issuer?: string },
) {
  await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
  const form = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Legg til sertifisering" }),
  });
  // Området er forhåndsvalgt (bare én kode)
  await expect(form.getByText("Tilstandsrapport bolig", { exact: true })).toBeVisible();
  await page.getByLabel("Gyldig til", { exact: true }).fill(data.validTo);
  if (data.validFrom) {
    await page.getByLabel("Gyldig fra (valgfritt)", { exact: true }).fill(data.validFrom);
  }
  if (data.number) {
    await page.getByLabel("Sertifikatnummer (valgfritt)", { exact: true }).fill(data.number);
  }
  if (data.issuer) await page.getByLabel("Utsteder (valgfritt)", { exact: true }).fill(data.issuer);
  await page.getByRole("button", { name: "Lagre sertifisering", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}\?lagret=sertifisering$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Sertifiseringen er lagret." }),
  ).toBeVisible();
}

test.describe("sertifiseringer (pc og iPad liggende)", () => {
  test("1. admin legger til en sertifisering som går ut snart, og ser den i listen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const name = await createEmployeeAndOpen(page);
    const employeeUrl = page.url();
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();

    const validTo = isoDaysFromToday(20);
    await addCertification(page, {
      validTo,
      number: "TEST-CERT-0001",
      issuer: "Testsertifisering AS",
    });
    const item = certificationList(page).getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Tilstandsrapport bolig");
    await expect(item).toContainText(`Gyldig til ${norwegianDate(validTo)}`);
    await expect(item).toContainText("Nr. TEST-CERT-0001");
    await expect(item).toContainText("Testsertifisering AS");
    await expect(item).toContainText("Går ut snart");

    await adminNav(page).getByRole("link", { name: "Sertifiseringer", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/sertifiseringer$/);
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    const row = expiringRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Tilstandsrapport bolig");
    await expect(row).toContainText(`Gyldig til ${norwegianDate(validTo)}`);
    await expect(row).toContainText("Går ut snart");

    await row.click();
    await expect(page).toHaveURL(employeeUrl.replace(/\?.*$/, ""));
  });

  test("2. fornyelse ett år frem tar personen ut av listen, og begge radene står", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const name = await createEmployeeAndOpen(page);
    const employeeUrl = page.url();
    await addCertification(page, { validTo: isoDaysFromToday(10) });

    await page.goto("/admin/sertifiseringer");
    await expect(expiringRow(page, name)).toHaveCount(1);

    await page.goto(employeeUrl);
    const renewedTo = isoDaysFromToday(375);
    await addCertification(page, { validTo: renewedTo, validFrom: isoDaysFromToday(0) });
    const items = certificationList(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: norwegianDate(renewedTo) })).not.toContainText(
      "Går ut snart",
    );

    await page.goto("/admin/sertifiseringer");
    await expect(page.getByRole("heading", { name: "Sertifiseringer", level: 1 })).toBeVisible();
    await expect(expiringRow(page, name)).toHaveCount(0);
  });

  test("3. «Fjern» spør først; «Avbryt» lar raden stå, «Ja, fjern» tar den bort", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);
    await addCertification(page, { validTo: isoDaysFromToday(200) });
    const items = certificationList(page).getByRole("listitem");
    await expect(items).toHaveCount(1);

    await items.getByRole("button", { name: /^Fjern/ }).click();
    await expect(items).toContainText("Fjerne sertifiseringen");
    await items.getByRole("button", { name: "Avbryt", exact: true }).click();
    await expect(items.getByRole("button", { name: "Ja, fjern", exact: true })).toHaveCount(0);
    await expect(items).toHaveCount(1);

    await items.getByRole("button", { name: /^Fjern/ }).click();
    await items.getByRole("button", { name: "Ja, fjern", exact: true }).click();
    await expect(page).toHaveURL(/\?lagret=sertifisering-fjernet$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Sertifiseringen er fjernet." }),
    ).toBeVisible();
    await expect(certificationList(page)).toHaveCount(0);
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();
  });

  test("4. feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);

    await page.getByRole("button", { name: "Legg til sertifisering", exact: true }).click();
    await page.getByLabel("Sertifikatnummer (valgfritt)", { exact: true }).fill("TEST-CERT-0002");
    await page.getByRole("button", { name: "Lagre sertifisering", exact: true }).click();
    const validTo = page.getByLabel("Gyldig til", { exact: true });
    await expect(page.getByText("Velg dato for gyldig til.")).toBeVisible();
    await expect(validTo).toHaveAttribute("aria-invalid", "true");
    await expect(validTo).toHaveAttribute("aria-describedby", /validTo-error/);
    await expect(page.getByText("Rett feltene som er merket.")).toBeVisible();
    // Verdiene står
    await expect(page.getByLabel("Sertifikatnummer (valgfritt)", { exact: true })).toHaveValue(
      "TEST-CERT-0002",
    );

    await validTo.fill("2027-01-01");
    const validFrom = page.getByLabel("Gyldig fra (valgfritt)", { exact: true });
    await validFrom.fill("2027-01-02");
    await page.getByRole("button", { name: "Lagre sertifisering", exact: true }).click();
    await expect(page.getByText("Gyldig fra kan ikke være etter gyldig til.")).toBeVisible();
    await expect(validFrom).toHaveAttribute("aria-invalid", "true");
    await expect(validFrom).toHaveAttribute("aria-describedby", /validFrom-error/);

    await page.reload();
    await expect(page.getByText("Ingen sertifiseringer registrert.")).toBeVisible();
  });

  test("5. admin uten sertifisering kommer inn i adminområdet (regel 11)", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    for (const url of ["/admin", "/admin/ansatte", "/admin/sertifiseringer"]) {
      await page.goto(url);
      await expect(adminNav(page), url).toBeVisible();
      await expect(deniedHeading(page), url).toHaveCount(0);
    }
  });

  test("6. takstmann får ikke åpnet /admin/sertifiseringer", async ({ page }) => {
    await logInAsInspector(page);
    const response = await page.goto("/admin/sertifiseringer");
    expect(response?.status() ?? 500).toBeLessThan(500);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(adminNav(page)).toHaveCount(0);
    await expect(page.getByText("Går ut snart")).toHaveCount(0);
    await expect(page.getByText("Utgått")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Hovedmeny" }).getByRole("link", { name: "Admin" }),
    ).toHaveCount(0);
  });
});

test.describe("sertifiseringer, iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7. knappene er minst 44 px, datofeltet nås med tastaturet, og ingen vannrett rulling", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await createEmployeeAndOpen(page);
    const employeeUrl = page.url();

    const add = page.getByRole("button", { name: "Legg til sertifisering", exact: true });
    await expectAtLeast44(add, "Legg til sertifisering");
    await add.click();
    await expectAtLeast44(
      page.getByRole("button", { name: "Lagre sertifisering", exact: true }),
      "Lagre sertifisering",
    );

    // Tab fram til «Gyldig til»
    const validTo = page.getByLabel("Gyldig til", { exact: true });
    await page.getByRole("heading", { name: "Legg til sertifisering" }).click();
    for (let i = 0; i < 20; i++) {
      if (await validTo.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(validTo).toBeFocused();
    await validTo.fill(isoDaysFromToday(30));
    await page.getByRole("button", { name: "Lagre sertifisering", exact: true }).click();
    await expect(page).toHaveURL(/\?lagret=sertifisering$/);

    await expectAtLeast44(certificationList(page).getByRole("button", { name: /^Fjern/ }), "Fjern");

    for (const url of [employeeUrl, "/admin/sertifiseringer"]) {
      await page.goto(url);
      await expect(page.getByRole("main")).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `${url} ruller ikke vannrett`).toBeLessThanOrEqual(clientWidth);
    }
  });
});
