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
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  companyOrgNumbers,
  employeeByEmail,
  fakeOrgNumber,
  logIn,
  logInAsInspector,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * Admin: selskaper, kontorer, ansatte og roller (fase 0b).
 * Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md avsnitt 8.
 * Skisse: docs/funksjoner/fase0b-admin-organisasjon-skisse.md (etiketter og knappetekster).
 * Kjører i prosjektene pc og ipad (liggende). iPad stående har egen describe som bare kjører i ipad.
 *
 * Data: oppdiktet og unikt per kjøring (e-post på eksempel.no, org.nr. som starter med 000).
 * Databasen tømmes ikke mellom kjøringene, så listene er aldri tomme.
 * Seed-admin markeres aldri som sluttet og mister aldri rollen (siste admin prøves bare i
 * databasetestene). Ingen e2e uten nett: adminområdet krever nett.
 *
 * Støtter hovedmål: tid (admin legger inn en ansatt selv, uten utvikler) og reklamasjoner (den som
 * har sluttet, mister tilgang; riktig selskap og forsikring ligger klart til rapporten).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;

/** Hovedmenyen i rammen. */
function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

/** Undermenyen øverst i adminområdet. */
function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin" });
}

/** Raden i en adminliste: én lenke som inneholder teksten. */
function row(page: Page, text: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: text });
}

/** Siden «Ingen tilgang» eller 404: samme svar uansett, aldri data. */
function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

function expectNoServerError(response: Response | null, url: string) {
  expect(response, `${url} svarer`).not.toBeNull();
  expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
}

/** Ny nettleserkontekst med samme adresse og skjermstørrelse som prosjektet. */
async function newProjectPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { baseURL, viewport, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
  return context.newPage();
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

type CompanyData = {
  legalName: string;
  orgNumber: string;
  insurer: string;
  policyNumber: string;
  validTo: string;
  companyText: string;
};

function newCompanyData(suffix: string): CompanyData {
  return {
    legalName: `Testselskap ${suffix} AS`,
    orgNumber: fakeOrgNumber(),
    insurer: "Testforsikring",
    policyNumber: `TEST-${suffix}`,
    validTo: "2027-12-31",
    companyText: `Oppdiktet firmatekst ${suffix}.`,
  };
}

/** «Admin» i menyen → «Selskaper» → «Nytt selskap» → alle feltene → «Lagre». */
async function createCompany(page: Page, data: CompanyData) {
  await mainNav(page).getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ansatte$/);
  await adminNav(page).getByRole("link", { name: "Selskaper", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/selskaper$/);
  await page.getByRole("link", { name: "Nytt selskap", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/selskaper\/ny$/);
  await expect(page.getByRole("heading", { name: "Nytt selskap", level: 1 })).toBeVisible();

  await page.getByLabel("Juridisk navn", { exact: true }).fill(data.legalName);
  await page.getByLabel("Org.nr. (valgfritt)", { exact: true }).fill(data.orgNumber);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill("Testveien 1");
  await page.getByLabel("Postnummer (valgfritt)", { exact: true }).fill("0001");
  await page.getByLabel("Sted (valgfritt)", { exact: true }).fill("Teststad");
  await page.getByLabel("Firmatekst (valgfritt)", { exact: true }).fill(data.companyText);
  const insurance = page.getByRole("group", { name: "Ansvarsforsikring" });
  await insurance.getByLabel("Forsikringsselskap (valgfritt)", { exact: true }).fill(data.insurer);
  await insurance.getByLabel("Polisenummer (valgfritt)", { exact: true }).fill(data.policyNumber);
  await insurance.getByLabel("Gyldig til (valgfritt)", { exact: true }).fill(data.validTo);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/selskaper\?lagret=selskap$/);
  await expect(page.getByRole("status").filter({ hasText: "Selskapet er lagret." })).toBeVisible();
}

/** «Kontorer» → «Nytt kontor» → navn, adresse og rekkefølge → «Lagre». */
async function createOffice(page: Page, name: string, address: string) {
  await page.goto("/admin/kontorer");
  await page.getByRole("link", { name: "Nytt kontor", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\/ny$/);
  await page.getByLabel("Navn", { exact: true }).fill(name);
  await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill(address);
  await page.getByLabel("Rekkefølge", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);
  await expect(page.getByRole("status").filter({ hasText: "Kontoret er lagret." })).toBeVisible();
}

/** Antall e-poster i utviklingspostkassen til adressen. */
async function mailsTo(page: Page, email: string): Promise<number> {
  const mailbox = await page.context().newPage();
  await mailbox.goto("/dev/epost");
  const count = await mailbox.getByTestId("dev-email-to").filter({ hasText: email }).count();
  await mailbox.close();
  return count;
}

test.describe("adminområdet (pc og iPad liggende)", () => {
  test("1. selskap: admin oppretter et selskap med firmatekst og ansvarsforsikring, og endrer polisenummeret", async ({
    page,
  }) => {
    const data = newCompanyData(uniqueSuffix());
    await logIn(page, ADMIN_EMAIL);
    await createCompany(page, data);

    const listed = row(page, data.legalName);
    await expect(listed).toHaveCount(1);
    const grouped = data.orgNumber.replace(/(\d{3})(?=\d)/g, "$1 ");
    await expect(listed).toContainText(`Org.nr. ${grouped}`);
    await expect(listed).toContainText("Forsikring gyldig til 31.12.2027");

    // «Endre»: alle feltene er lagret, også firmatekst og forsikring
    await listed.click();
    await expect(page).toHaveURL(/\/admin\/selskaper\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Endre selskap", level: 1 })).toBeVisible();
    const editUrl = page.url();
    await expect(page.getByLabel("Juridisk navn", { exact: true })).toHaveValue(data.legalName);
    await expect(page.getByLabel("Org.nr. (valgfritt)", { exact: true })).toHaveValue(
      data.orgNumber,
    );
    await expect(page.getByLabel("Firmatekst (valgfritt)", { exact: true })).toHaveValue(
      data.companyText,
    );
    await expect(page.getByLabel("Forsikringsselskap (valgfritt)", { exact: true })).toHaveValue(
      data.insurer,
    );
    await expect(page.getByLabel("Gyldig til (valgfritt)", { exact: true })).toHaveValue(
      data.validTo,
    );

    const newPolicy = `${data.policyNumber}-B`;
    await page.getByLabel("Polisenummer (valgfritt)", { exact: true }).fill(newPolicy);
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/selskaper\?lagret=selskap$/);

    await page.goto(editUrl);
    await expect(page.getByLabel("Polisenummer (valgfritt)", { exact: true })).toHaveValue(
      newPolicy,
    );
  });

  test("2. kontor: admin oppretter et kontor og endrer adressen", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `Testkontor ${suffix}`;
    await logIn(page, ADMIN_EMAIL);
    await createOffice(page, name, "Kontorveien 1");

    const listed = row(page, name);
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText("Kontorveien 1");

    await listed.click();
    await expect(page).toHaveURL(/\/admin\/kontorer\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Endre kontor", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Navn", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("Rekkefølge", { exact: true })).toHaveValue("90");
    await page.getByLabel("Adresse (valgfritt)", { exact: true }).fill("Kontorveien 2");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);
    await expect(row(page, name)).toContainText("Kontorveien 2");
  });

  test("3. ny ansatt logger inn uten «Admin», mister tilgangen når hen har sluttet, og får den igjen ved «Angre sluttet»", async ({
    page,
    browser,
  }, testInfo) => {
    const suffix = uniqueSuffix();
    const company = newCompanyData(suffix);
    const officeName = `Testkontor ${suffix}`;
    const employeeName = `Testansatt ${suffix}`;
    const email = `ansatt-${suffix}@eksempel.no`;

    // Admin lager selskap, kontor og en ansatt med rollen takstmann
    await logIn(page, ADMIN_EMAIL);
    await createCompany(page, company);
    await createOffice(page, officeName, "Kontorveien 3");

    await adminNav(page).getByRole("link", { name: "Ansatte", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/ansatte$/);
    await page.getByRole("link", { name: "Ny ansatt", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/ansatte\/ny$/);
    await expect(page.getByRole("heading", { name: "Ny ansatt", level: 1 })).toBeVisible();
    await page.getByLabel("Navn", { exact: true }).fill(employeeName);
    await page.getByLabel("E-post", { exact: true }).fill(email);
    await page.getByLabel("Stilling (valgfritt)", { exact: true }).fill("Takstingeniør");
    await page
      .getByRole("group", { name: "Selskap (valgfritt)" })
      .getByLabel(company.legalName, { exact: true })
      .check();
    await page
      .getByRole("group", { name: "Kontor (valgfritt)" })
      .getByLabel(officeName, { exact: true })
      .check();
    const roles = page.getByRole("group", { name: "Roller" });
    // «Takstmann» er avkrysset fra start (skissen), de andre ikke
    await expect(roles.getByLabel("Takstmann", { exact: true })).toBeChecked();
    await expect(roles.getByLabel("Admin", { exact: true })).not.toBeChecked();
    await page.getByRole("button", { name: "Lagre", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=ny-ansatt$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Den ansatte er lagt inn." }),
    ).toBeVisible();
    const listed = row(page, employeeName);
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText(email);
    await expect(listed).toContainText(`Takstingeniør · ${company.legalName} · ${officeName}`);
    await expect(listed).toContainText("Takstmann");
    // Ingen invitasjon: ingen e-post til den nye adressen
    expect(await mailsTo(page, email)).toBe(0);

    // Den nye ansatte logger inn i en egen nettleser og ser arbeidskøen uten «Admin»
    const employee = await newProjectPage(browser, testInfo);
    try {
      await employee.goto("/logg-inn");
      await signInWithCode(employee, email);
      await expect(employee).toHaveURL(/\/arbeidskoe$/);
      await expect(employee.getByRole("heading", { name: "Arbeidskø", level: 1 })).toBeVisible();
      await expect(employee.getByText("Ingenting venter på deg")).toBeVisible();
      await expect(mainNav(employee)).toBeVisible();
      await expect(mainNav(employee).getByRole("link", { name: "Admin" })).toHaveCount(0);

      // Admin markerer personen som sluttet
      await listed.click();
      await expect(page).toHaveURL(/\/admin\/ansatte\/[0-9a-f-]{36}$/);
      const employeeUrl = new URL(page.url()).pathname;
      await expect(page.getByRole("heading", { name: employeeName, level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Har sluttet", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=sluttet$/);
      await expect(
        page.getByRole("status").filter({ hasText: "Markert som sluttet." }),
      ).toBeVisible();
      // Nederst, under «Har sluttet», merket «Sluttet»
      const former = page.getByRole("region", { name: "Har sluttet" });
      await expect(former.getByRole("link").filter({ hasText: employeeName })).toContainText(
        "Sluttet",
      );
      await expect(row(page, employeeName)).toHaveCount(1);

      // Den åpne økten laster neste side: ingen arbeidskø-data og ingen organisasjon
      await employee.goto("/arbeidskoe");
      await expect(
        employee.getByRole("heading", {
          name: /^(Ingen tilgang|Du er ikke registrert som ansatt)$/,
        }),
      ).toBeVisible();
      await expect(employee.getByText("Ingenting venter på deg")).toHaveCount(0);
      await expect(employee.getByText("Du jobber for")).toHaveCount(0);
      // Adminområdet er stengt for personen
      const response = await employee.goto(employeeUrl);
      expectNoServerError(response, employeeUrl);
      await expect(deniedHeading(employee)).toBeVisible();
      expect(await employee.content()).not.toContain(ADMIN_EMAIL);

      // «Angre sluttet» gir tilgangen tilbake
      await page.goto(employeeUrl);
      await page.getByRole("button", { name: "Angre sluttet", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/ansatte\?lagret=angret$/);
      await expect(
        page.getByRole("status").filter({ hasText: "Sluttet er angret." }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Har sluttet" }).getByText(employeeName),
      ).toHaveCount(0);

      await employee.goto("/arbeidskoe");
      await expect(employee.getByText("Ingenting venter på deg")).toBeVisible();
      await expect(mainNav(employee).getByRole("link", { name: "Admin" })).toHaveCount(0);
    } finally {
      await employee.context().close();
    }
  });

  test("4. takstmann ser ikke «Admin» og får ingen data fra adminområdet", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    const orgNumbers = await companyOrgNumbers();
    await logInAsInspector(page);
    await expect(mainNav(page)).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Admin" })).toHaveCount(0);

    for (const url of [
      "/admin",
      "/admin/ansatte",
      "/admin/ansatte/ny",
      `/admin/ansatte/${admin.id}`,
      "/admin/selskaper",
      "/admin/selskaper/ny",
      "/admin/kontorer",
      "/admin/kontorer/ny",
    ]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page), url).toBeVisible();
      await expect(adminNav(page), url).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Lagre" }), url).toHaveCount(0);
      const html = await page.content();
      expect(html, `${url} viser ikke e-posten til admin`).not.toContain(ADMIN_EMAIL);
      expect(html, `${url} viser ikke e-posten til takstmannen`).not.toContain(INSPECTOR_EMAIL);
      expect(html, `${url} viser ikke navnet til admin`).not.toContain(admin.name);
      for (const orgNumber of orgNumbers) {
        expect(html, `${url} viser ikke org.nr.`).not.toContain(orgNumber);
      }
    }
  });

  test("5. ugyldig og ukjent id gir «Ingen tilgang» eller 404, aldri 500", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    for (const url of [
      "/admin/ansatte/ikke-en-id",
      `/admin/ansatte/${randomUUID()}`,
      "/admin/selskaper/ikke-en-id",
      `/admin/selskaper/${randomUUID()}`,
      "/admin/kontorer/ikke-en-id",
      `/admin/kontorer/${randomUUID()}`,
    ]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page), url).toBeVisible();
      await expect(page.getByRole("button", { name: "Lagre" }), url).toHaveCount(0);
    }
  });

  test("6. feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page, ADMIN_EMAIL);

    // Selskap: org.nr. med 8 siffer
    const legalName = `Feilselskap ${suffix} AS`;
    await page.goto("/admin/selskaper/ny");
    await page.getByLabel("Juridisk navn", { exact: true }).fill(legalName);
    const orgNumber = page.getByLabel("Org.nr. (valgfritt)", { exact: true });
    await orgNumber.fill("12345678");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Org.nr. må være 9 siffer.")).toBeVisible();
    await expect(orgNumber).toHaveAttribute("aria-invalid", "true");
    await expect(orgNumber).toHaveAttribute("aria-describedby", /orgNumber-error/);
    await expect(page.getByText("Rett feltene som er merket.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/selskaper\/ny$/);
    // Verdiene står
    await expect(page.getByLabel("Juridisk navn", { exact: true })).toHaveValue(legalName);

    // Selskap: tomt juridisk navn
    await page.goto("/admin/selskaper/ny");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    const legalNameField = page.getByLabel("Juridisk navn", { exact: true });
    await expect(page.getByText("Skriv inn det juridiske navnet.")).toBeVisible();
    await expect(legalNameField).toHaveAttribute("aria-invalid", "true");

    await page.goto("/admin/selskaper");
    await expect(row(page, legalName)).toHaveCount(0);

    // Ansatt: ugyldig e-post og tomt navn
    const email = page.getByLabel("E-post", { exact: true });
    const name = page.getByLabel("Navn", { exact: true });
    const badEmailName = `Feilansatt ${suffix}`;
    await page.goto("/admin/ansatte/ny");
    await name.fill(badEmailName);
    await email.fill("ola@");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Skriv inn en gyldig e-postadresse.")).toBeVisible();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute("aria-describedby", /email-error/);
    await expect(page).toHaveURL(/\/admin\/ansatte\/ny$/);

    const emptyNameEmail = `feil-${suffix}@eksempel.no`;
    await page.goto("/admin/ansatte/ny");
    await email.fill(emptyNameEmail);
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Skriv inn navnet.")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", /name-error/);

    await page.goto("/admin/ansatte");
    await expect(row(page, badEmailName)).toHaveCount(0);
    await expect(row(page, emptyNameEmail)).toHaveCount(0);
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  // Bare i prosjektet ipad (lite funn fra PR #51: blokken skal ikke kjøre to ganger)
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7a. «Admin», «Ny ansatt», «Lagre» og «Har sluttet» er minst 44 px", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page, ADMIN_EMAIL);
    await expectAtLeast44(mainNav(page).getByRole("link", { name: "Admin", exact: true }), "Admin");

    await page.goto("/admin/ansatte");
    await expectAtLeast44(page.getByRole("link", { name: "Ny ansatt", exact: true }), "Ny ansatt");

    for (const url of ["/admin/ansatte/ny", "/admin/selskaper/ny", "/admin/kontorer/ny"]) {
      await page.goto(url);
      await expectAtLeast44(
        page.getByRole("button", { name: "Lagre", exact: true }),
        `Lagre ${url}`,
      );
    }

    // Seed-admin: bare målt, aldri trykket
    await page.goto(`/admin/ansatte/${admin.id}`);
    await expectAtLeast44(
      page.getByRole("button", { name: "Lagre", exact: true }),
      "Lagre (opplysninger)",
    );
    await expectAtLeast44(
      page.getByRole("button", { name: "Har sluttet", exact: true }),
      "Har sluttet",
    );
  });

  test("7b. nytt kontor fylles ut og sendes med tastaturet alene", async ({ page }) => {
    const name = `Testkontor ${uniqueSuffix()}`;
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/admin/kontorer/ny");
    await expect(page.getByRole("heading", { name: "Nytt kontor", level: 1 })).toBeVisible();

    // Tab fram til «Navn»
    for (let i = 0; i < 40; i++) {
      if (
        await page
          .getByLabel("Navn", { exact: true })
          .evaluate((el) => el === document.activeElement)
      ) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(page.getByLabel("Navn", { exact: true })).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Adresse (valgfritt)", { exact: true })).toBeFocused();
    await page.keyboard.type("Tastaturveien 1");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Rekkefølge", { exact: true })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("91");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/admin\/kontorer\?lagret=kontor$/);
    await expect(row(page, name)).toHaveCount(1);
    await expect(row(page, name)).toContainText("Tastaturveien 1");
  });

  test("7c. ansattlisten og ansattskjemaet har ingen vannrett rulling", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    for (const url of ["/admin/ansatte", "/admin/ansatte/ny"]) {
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
