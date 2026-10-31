import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  e2eDatabaseUrl,
  ensureInspector,
  logIn,
  logInAsInspector,
  signInWithCode,
} from "./helpers";

/*
 * Admin: selskaper, kontorer, ansatte og roller (fase 0b).
 * Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md avsnitt 8.
 * Skisse: docs/funksjoner/fase0b-admin-organisasjon-skisse.md (tekster, etiketter og adresser).
 * Kjører i prosjektene pc og ipad. iPad stående har egen describe.
 *
 * Unike data per kjøring (e2e-databasen tømmes ikke). Testdata er oppdiktet.
 * Seed-admin markeres ALDRI som sluttet og mister ALDRI rollen her; regelen om siste admin
 * prøves bare i databasetestene (src/core/organization/employees-admin.test.ts, 3.8).
 *
 * Støtter hovedmål: reklamasjoner (riktig selskap, forsikring og firmatekst; den som har sluttet,
 * mister tilgang) og tid (admin gjør endringene selv). KI først: rollene her styrer hvem som
 * kan publisere.
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;
const NO_ACCESS = /Ingen tilgang|Fant ikke siden/;

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;
}

/** Tilfeldig org.nr. med 9 siffer som begynner på 0 (finnes ikke i virkeligheten). */
function fakeOrgNumber(): string {
  let digits = "0";
  while (digits.length < 9) digits += Math.floor(Math.random() * 10).toString();
  return digits;
}

/** Org.nr. slik listen viser det: grupper på tre. */
function groupedOrgNumber(orgNumber: string): string {
  return orgNumber.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function mainNav(page: Page): Locator {
  return page
    .getByRole("navigation")
    .filter({ has: page.getByRole("link", { name: "Arbeidskø", exact: true }) });
}

function adminMenuLink(page: Page): Locator {
  return mainNav(page).getByRole("link", { name: "Admin", exact: true });
}

function adminSubnav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

function mainArea(page: Page): Locator {
  return page.getByRole("main");
}

async function withDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Id-en til den ansatte bak en e-post i organisasjonen til seed-admin. */
async function employeeIdFor(email: string): Promise<string> {
  return withDb(async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${email} and e.deleted_at is null
      order by e.created_at desc limit 1`;
    if (!row) throw new Error(`Fant ingen ansatt for ${email}`);
    return row.id;
  });
}

/** Antall e-poster i utviklingspostkassen, og om noen går til adressen. */
async function mailboxState(page: Page, address: string) {
  const mailbox = await page.context().newPage();
  await mailbox.goto("/dev/epost");
  const count = await mailbox.getByTestId("dev-email").count();
  const recipients = await mailbox.getByTestId("dev-email-to").allTextContents();
  await mailbox.close();
  return { count, toAddress: recipients.filter((to) => to.trim() === address).length };
}

/** Feltet er merket ugyldig og har meldingen i den tilgjengelige beskrivelsen. */
async function expectFieldError(field: Locator, message: string) {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escapeRegExp(message)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Slår av nettleserens egen sjekk, så serverens meldinger (Zod) prøves. */
async function disableBrowserValidation(page: Page) {
  await page.evaluate(() => {
    for (const form of Array.from(document.forms)) form.noValidate = true;
  });
}

/** Siden viser «Ingen tilgang» eller 404, aldri data og aldri 500. */
async function expectNoAccess(page: Page, url: string, forbidden: string[]) {
  const response = await page.goto(url);
  expect(response?.status(), `${url} ga 500`).not.toBe(500);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NO_ACCESS);
  const html = await page.content();
  for (const text of forbidden) {
    expect(html, `${url} viser «${text}»`).not.toContain(text);
  }
}

async function expectTouchTarget(target: Locator, name: string) {
  await expect(target, `${name} er synlig`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} har en boks`).not.toBeNull();
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "vannrett rulling").toBeLessThanOrEqual(clientWidth);
}

test.describe("adminområdet (pc og iPad liggende)", () => {
  test.describe.configure({ mode: "serial" });

  const data = {
    suffix: "",
    companyName: "",
    orgNumber: "",
    officeName: "",
    employeeName: "",
    employeeEmail: "",
  };

  test.beforeAll(async ({}, testInfo) => {
    const suffix = `${testInfo.project.name}${uniqueSuffix()}`;
    data.suffix = suffix;
    data.companyName = `Testselskap ${suffix} AS`;
    data.orgNumber = fakeOrgNumber();
    data.officeName = `Testkontor ${suffix}`;
    data.employeeName = `Testansatt ${suffix}`;
    data.employeeEmail = `ansatt-${suffix}@eksempel.no`;
  });

  test("1. selskap: admin oppretter med firmatekst og ansvarsforsikring, og endrer polisenummer", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await adminMenuLink(page).click();
    await expect(page).toHaveURL(/\/admin(\/ansatte)?(\?[^/]*)?$/);
    await adminSubnav(page).getByRole("link", { name: "Selskaper", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Selskaper", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Nytt selskap" }).click();
    await expect(page.getByRole("heading", { name: "Nytt selskap", level: 1 })).toBeVisible();
    await page.getByLabel("Juridisk navn").fill(data.companyName);
    await page.getByLabel(/^Org\.nr\./).fill(data.orgNumber);
    await page.getByLabel("Registrert i MVA-registeret").check();
    await page.getByLabel(/^Adresse/).fill("Testveien 1");
    await page.getByLabel(/^Postnummer/).fill("0001");
    await page.getByLabel(/^Sted/).fill("Testby");
    await page.getByLabel(/^Firmatekst/).fill("Firmatekst for testselskapet.");
    await page.getByLabel(/^Forsikringsselskap/).fill("Testforsikring");
    await page.getByLabel(/^Polisenummer/).fill("TEST-0001");
    await page.getByLabel(/^Gyldig til/).fill("2027-06-30");
    await page.getByRole("button", { name: "Lagre" }).click();

    await expect(page).toHaveURL(/\/admin\/selskaper(\?[^/]*)?$/);
    await expect(page.getByRole("status")).toContainText("Selskapet er lagret.");
    const row = mainArea(page).getByRole("listitem").filter({ hasText: data.companyName });
    await expect(row).toBeVisible();
    await expect(row).toContainText(groupedOrgNumber(data.orgNumber));
    await expect(row).toContainText("30.06.2027");

    await row.getByRole("link").click();
    await expect(page).toHaveURL(/\/admin\/selskaper\/[0-9a-f-]{36}(\?[^/]*)?$/);
    await expect(page.getByRole("heading", { name: "Endre selskap", level: 1 })).toBeVisible();
    await expect(page.getByLabel(/^Firmatekst/)).toHaveValue("Firmatekst for testselskapet.");
    await page.getByLabel(/^Polisenummer/).fill("TEST-0002");
    await page.getByRole("button", { name: "Lagre" }).click();
    await expect(page).toHaveURL(/\/admin\/selskaper(\?[^/]*)?$/);

    await mainArea(page)
      .getByRole("listitem")
      .filter({ hasText: data.companyName })
      .getByRole("link")
      .click();
    await expect(page.getByLabel(/^Polisenummer/)).toHaveValue("TEST-0002");
    await expect(page.getByLabel(/^Forsikringsselskap/)).toHaveValue("Testforsikring");
    await expect(page.getByLabel(/^Gyldig til/)).toHaveValue("2027-06-30");
  });

  test("2. kontor: admin oppretter med navn, adresse og rekkefølge, og endrer adressen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/kontorer");
    await expect(page.getByRole("heading", { name: "Kontorer", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Nytt kontor" }).click();
    await page.getByLabel("Navn", { exact: true }).fill(data.officeName);
    await page.getByLabel(/^Adresse/).fill("Testgata 2");
    await page.getByLabel(/^Rekkefølge/).fill("90");
    await page.getByRole("button", { name: "Lagre" }).click();

    await expect(page).toHaveURL(/\/admin\/kontorer(\?[^/]*)?$/);
    await expect(page.getByRole("status")).toContainText("Kontoret er lagret.");
    const row = mainArea(page).getByRole("listitem").filter({ hasText: data.officeName });
    await expect(row).toContainText("Testgata 2");

    await row.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Endre kontor", level: 1 })).toBeVisible();
    await expect(page.getByLabel(/^Rekkefølge/)).toHaveValue("90");
    await page.getByLabel(/^Adresse/).fill("Testgata 3");
    await page.getByRole("button", { name: "Lagre" }).click();
    await expect(page).toHaveURL(/\/admin\/kontorer(\?[^/]*)?$/);
    await expect(
      mainArea(page).getByRole("listitem").filter({ hasText: data.officeName }),
    ).toContainText("Testgata 3");
  });

  test("3. ny ansatt logger inn, mister tilgangen når admin markerer sluttet, og får den igjen ved angring", async ({
    page,
    browser,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const mailBefore = await mailboxState(page, data.employeeEmail);

    // Admin → Ansatte → Ny ansatt → Lagre
    await adminMenuLink(page).click();
    await page.goto("/admin/ansatte");
    await page.getByRole("link", { name: "Ny ansatt" }).click();
    await expect(page.getByRole("heading", { name: "Ny ansatt", level: 1 })).toBeVisible();
    await page.getByLabel("Navn", { exact: true }).fill(data.employeeName);
    await page.getByLabel("E-post", { exact: true }).fill(data.employeeEmail);
    await page.getByLabel(/^Stilling/).fill("Testtakstmann");
    await page.getByRole("radio", { name: data.companyName }).check();
    await page.getByRole("radio", { name: data.officeName }).check();
    await page.getByRole("checkbox", { name: /^Takstmann/ }).check();
    await page.getByRole("button", { name: "Lagre" }).click();

    await expect(page).toHaveURL(/\/admin\/ansatte(\?[^/]*)?$/);
    await expect(page.getByRole("status")).toContainText("Den ansatte er lagt inn.");
    const activeRow = mainArea(page).getByRole("listitem").filter({ hasText: data.employeeName });
    await expect(activeRow).toContainText(data.employeeEmail);
    await expect(activeRow).toContainText("Takstmann");

    // Ingen invitasjon: utviklingspostkassen er uendret
    const mailAfter = await mailboxState(page, data.employeeEmail);
    expect(mailAfter.count).toBe(mailBefore.count);
    expect(mailAfter.toAddress).toBe(0);

    // Den nye ansatte logger inn i en egen nettleserkontekst
    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    try {
      await employeePage.goto("/logg-inn");
      await signInWithCode(employeePage, data.employeeEmail);
      await expect(employeePage).toHaveURL(/\/arbeidskoe$/);
      await expect(employeePage.getByText("Ingenting venter på deg")).toBeVisible();
      await expect(adminMenuLink(employeePage)).toHaveCount(0);

      // Admin markerer personen som sluttet
      await activeRow.getByRole("link").click();
      await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}(\?[^/]*)?$/);
      const employeeUrl = page.url().replace(/\?.*$/, "");
      await page.getByRole("button", { name: "Har sluttet" }).click();
      await expect(page.getByRole("status")).toContainText("Markert som sluttet.");
      await page.goto(employeeUrl);
      await expect(page.getByRole("button", { name: "Angre sluttet" })).toBeVisible();

      await page.goto("/admin/ansatte");
      await expect(page.getByRole("heading", { name: "Har sluttet", level: 2 })).toBeVisible();
      const leftRow = mainArea(page).getByRole("listitem").filter({ hasText: data.employeeName });
      await expect(leftRow).toContainText("Sluttet");
      const text = await mainArea(page).innerText();
      expect(text.indexOf(data.employeeName)).toBeGreaterThan(text.indexOf("Har sluttet"));

      // Den åpne økten til den ansatte: neste side gir ingen tilgang og ingen arbeidskø-data
      await employeePage.goto("/arbeidskoe");
      await expect(
        employeePage.getByText(/Ingen tilgang|Du er ikke registrert som ansatt/).first(),
      ).toBeVisible();
      await expect(employeePage.getByText("Ingenting venter på deg")).toHaveCount(0);
      await expect(adminMenuLink(employeePage)).toHaveCount(0);

      // Admin angrer
      await page.goto(employeeUrl);
      await page.getByRole("button", { name: "Angre sluttet" }).click();
      await expect(page.getByRole("status")).toContainText("Sluttet er angret.");
      await page.goto(employeeUrl);
      await expect(page.getByRole("button", { name: "Har sluttet" })).toBeVisible();

      await employeePage.goto("/arbeidskoe");
      await expect(employeePage.getByText("Ingenting venter på deg")).toBeVisible();
    } finally {
      await employeeContext.close();
    }
  });

  test("4. takstmann ser ikke «Admin» og får ingen data fra /admin", async ({ page }) => {
    await ensureInspector();
    const adminEmployeeId = await employeeIdFor(ADMIN_EMAIL);
    await logInAsInspector(page);
    await expect(adminMenuLink(page)).toHaveCount(0);

    const forbidden = [ADMIN_EMAIL, INSPECTOR_EMAIL];
    if (data.orgNumber) forbidden.push(data.orgNumber, groupedOrgNumber(data.orgNumber));
    for (const url of [
      "/admin",
      "/admin/selskaper",
      "/admin/kontorer",
      "/admin/ansatte",
      "/admin/ansatte/ny",
      `/admin/ansatte/${adminEmployeeId}`,
    ]) {
      await expectNoAccess(page, url, forbidden);
    }
  });

  test("5. ugyldig og ukjent id gir «Ingen tilgang» eller 404 for admin, aldri 500", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    for (const url of [
      "/admin/ansatte/ikke-en-id",
      `/admin/ansatte/${randomUUID()}`,
      "/admin/selskaper/ikke-en-id",
      `/admin/selskaper/${randomUUID()}`,
      "/admin/kontorer/ikke-en-id",
      `/admin/kontorer/${randomUUID()}`,
    ]) {
      await expectNoAccess(page, url, []);
    }
  });

  test("6. feilmeldinger på norsk ved feltet, og ingenting lagres", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);

    // Org.nr. med 8 siffer
    const companyName = `Testselskap feil ${data.suffix} AS`;
    await page.goto("/admin/selskaper/ny");
    await page.getByLabel("Juridisk navn").fill(companyName);
    await page.getByLabel(/^Org\.nr\./).fill("01234567");
    await page.getByRole("button", { name: "Lagre" }).click();
    await expectFieldError(page.getByLabel(/^Org\.nr\./), "Org.nr. må være 9 siffer.");
    await expect(page.getByLabel("Juridisk navn")).toHaveValue(companyName);
    await page.goto("/admin/selskaper");
    await expect(mainArea(page)).not.toContainText(companyName);

    // Ugyldig e-post og tomt navn (nettleserens egen sjekk slått av, så serveren svarer)
    const badEmail = `feil-${data.suffix}@`;
    await page.goto("/admin/ansatte/ny");
    await disableBrowserValidation(page);
    await page.getByLabel("Navn", { exact: true }).fill("");
    await page.getByLabel("E-post", { exact: true }).fill(badEmail);
    await page.getByRole("button", { name: "Lagre" }).click();
    await expectFieldError(
      page.getByLabel("E-post", { exact: true }),
      "Skriv inn en gyldig e-postadresse.",
    );
    await expectFieldError(page.getByLabel("Navn", { exact: true }), "Skriv inn navnet.");
    await page.goto("/admin/ansatte");
    await expect(mainArea(page)).not.toContainText(badEmail);
  });
});

test.describe("adminområdet på iPad (prosjektet ipad)", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7a. trykkflatene er minst 44x44 px", async ({ page }) => {
    await ensureInspector();
    const inspectorId = await employeeIdFor(INSPECTOR_EMAIL);
    await logIn(page, ADMIN_EMAIL);

    await page.goto("/admin/ansatte");
    await expectTouchTarget(adminMenuLink(page), "Admin");
    await expectTouchTarget(page.getByRole("link", { name: "Ny ansatt" }), "Ny ansatt");

    for (const url of ["/admin/selskaper/ny", "/admin/kontorer/ny", "/admin/ansatte/ny"]) {
      await page.goto(url);
      await expectTouchTarget(page.getByRole("button", { name: "Lagre" }), `Lagre på ${url}`);
    }

    // Bare måling: knappen trykkes ikke (e2e-takstmannen skal fortsatt være aktiv)
    await page.goto(`/admin/ansatte/${inspectorId}`);
    await expectTouchTarget(page.getByRole("button", { name: "Har sluttet" }), "Har sluttet");
  });

  test("7b. nytt kontor fylles ut og sendes med tastaturet alene", async ({ page }) => {
    const officeName = `Testkontor tast ${uniqueSuffix()}`;
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/kontorer/ny");

    await page.getByLabel("Navn", { exact: true }).focus();
    await page.keyboard.type(officeName);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/^Adresse/)).toBeFocused();
    await page.keyboard.type("Tastaturveien 1");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/^Rekkefølge/)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("91");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/admin\/kontorer(\?[^/]*)?$/);
    await expect(
      mainArea(page).getByRole("listitem").filter({ hasText: officeName }),
    ).toBeVisible();
  });
});

test.describe("adminområdet på iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7c. ansattlisten og ansattskjemaet har ingen vannrett rulling", async ({ page }) => {
    await ensureInspector();
    const inspectorId = await employeeIdFor(INSPECTOR_EMAIL);
    await logIn(page, ADMIN_EMAIL);

    for (const url of ["/admin/ansatte", "/admin/ansatte/ny", `/admin/ansatte/${inspectorId}`]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});
