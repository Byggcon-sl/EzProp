import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  INSPECTOR_EMAIL,
  e2eDatabaseUrl,
  employeeByEmail,
  fakeValidOrgNumber,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * Rette en ordre etter at den er lagret (fase 2a, T1).
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 5 (5.1–5.11). Kjører i
 * prosjektene pc og ipad; 5.10 og 5.11 bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre via
 * «Ny ordre» med en unik ending i adressen, fordi e2e-databasen ikke tømmes. Data er oppdiktet
 * (Testveien 12, 8000 Bodø → Prøvegata 7, 8006 Bodø). Ingen e2e uten nett: retting er en
 * kontoroppgave med nett, som oppretting.
 *
 * Grensesnittet: lenken «Rett ordren» åpner `?rett=1` på ordresiden, skjemaet har de samme
 * etikettene som «Ny ordre», «Lagre» sender til `?rettet=1` med beskjeden «Ordren er rettet.»
 * (`role="status"`), og delen «Endringer» har én linje per hendelse («Opprettet», «Rettet: adresse»).
 *
 * Støtter hovedmål: de ansatte (en skrivefeil rettes på stedet, på PC og iPad, i stedet for å avvise
 * og legge inn ordren på nytt) og færre reklamasjoner (det står hvem som rettet hva og når).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const EDIT_URL = new RegExp(`/ordre/${UUID}\\?rett=1$`);
const CORRECTED_URL = new RegExp(`/ordre/${UUID}\\?rettet=1$`);
const FIRM_URL = new RegExp(`/firma/(${UUID})$`);
const CONTACT_URL = new RegExp(`/kontakter/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const CORRECTED = "Ordren er rettet.";
const CHANGED_BY_OTHER = "Ordren er endret av en annen. Last siden på nytt.";
const CONVERTED_NOTE =
  "Oppdraget endres ikke. Eiendom og bestiller på oppdraget rettes på oppdraget.";

const field = {
  address: (page: Page) => page.getByLabel(/^Adresse/),
  gnr: (page: Page) => page.getByLabel(/^(Gårdsnummer|Gnr)/i),
  bnr: (page: Page) => page.getByLabel(/^(Bruksnummer|Bnr)/i),
  orderedBy: (page: Page) => page.getByLabel(/^Hvem bestilte/),
  office: (page: Page) => page.getByLabel(/^Kontor/),
  reason: (page: Page) => page.getByLabel(/^Grunn/),
};

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function editLink(page: Page): Locator {
  return page.getByRole("main").getByRole("link", { name: "Rett ordren", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre", exact: true });
}

function cancelLink(page: Page): Locator {
  return page.getByRole("main").getByRole("link", { name: "Avbryt", exact: true });
}

function history(page: Page): Locator {
  return page.getByRole("region", { name: "Endringer", exact: true });
}

function historyLines(page: Page): Locator {
  return history(page).getByRole("listitem");
}

function oldAddress(suffix: string): string {
  return `Testveien 12 ${suffix}, 8000 Bodø`;
}

function newAddress(suffix: string): string {
  return `Prøvegata 7 ${suffix}, 8006 Bodø`;
}

/** «Ordre» i menyen → «Ny ordre» → adressen → «Lagre». Returnerer id-en til ordren. */
async function createOrderViaUi(page: Page, address: string): Promise<string> {
  await mainNav(page).getByRole("link", { name: "Ordre", exact: true }).click();
  await expect(page).toHaveURL(/\/ordre$/);
  await page.getByRole("link", { name: "Ny ordre", exact: true }).click();
  await expect(page).toHaveURL(/\/ordre\/ny$/);
  await field.address(page).fill(address);
  await field.orderedBy(page).fill("Megler Testesen, Testmegleren AS");
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  return ORDER_URL.exec(page.url())![1]!;
}

/** «Rett ordren» → skjemaet står på samme side. */
async function openEdit(page: Page) {
  await editLink(page).click();
  await expect(page).toHaveURL(EDIT_URL);
  await expect(field.address(page)).toBeVisible();
}

/** Rett adressen og lagre; venter på beskjeden. */
async function correctAddress(page: Page, address: string) {
  await openEdit(page);
  await field.address(page).fill(address);
  await saveButton(page).click();
  await expect(page).toHaveURL(CORRECTED_URL);
  await expect(page.getByRole("status").filter({ hasText: CORRECTED })).toBeVisible();
}

/** Første (nyeste) linje i «Endringer» har teksten, navnet og et tidspunkt. */
async function expectNewestLine(page: Page, text: string, name: string) {
  const newest = historyLines(page).first();
  await expect(newest).toContainText(text);
  await expect(newest).toContainText(name);
  const time = newest.locator("time");
  await expect(time).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  await expect(time).toHaveText(/\d/);
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/**
 * En oppdiktet innlogging uten ansattrad (innloggingen lager ikke brukere selv). Bare lokal
 * database eller testdatabasen. Returnerer e-posten.
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

test.describe("rette ordre (pc og ipad)", () => {
  test("5.1 ny ordre → «Rett ordren» → ny adresse → «Endringer» viser «Rettet: adresse»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    await createOrderViaUi(page, oldAddress(suffix));

    // Før retting: bare «Opprettet» i loggen
    await expect(history(page)).toBeVisible();
    await expect(historyLines(page)).toHaveCount(1);
    await expectNewestLine(page, "Opprettet", admin.name);

    await correctAddress(page, newAddress(suffix));
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(newAddress(suffix));
    await expect(main).not.toContainText(oldAddress(suffix));

    await expect(historyLines(page)).toHaveCount(2);
    await expectNewestLine(page, "Rettet: adresse", admin.name);
    await expect(historyLines(page).last()).toContainText("Opprettet");
  });

  test("5.2 «Avbryt» lukker skjemaet uten lagring", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    const id = await createOrderViaUi(page, oldAddress(suffix));
    await expect(historyLines(page)).toHaveCount(1);

    await openEdit(page);
    await field.address(page).fill(newAddress(suffix));
    await cancelLink(page).click();

    await expect(page).toHaveURL(new RegExp(`/ordre/${id}$`));
    await expect(saveButton(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: CORRECTED })).toHaveCount(0);
    const main = page.getByRole("main");
    await expect(main).toContainText(oldAddress(suffix));
    await expect(main).not.toContainText(newAddress(suffix));
    await expect(historyLines(page)).toHaveCount(1);
  });

  test("5.3 gjort-om ordre kan rettes, og oppdraget endres ikke", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    const id = await createOrderViaUi(page, oldAddress(suffix));
    await field.office(page).selectOption({ label: "Bodø" });
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
    const main = page.getByRole("main");
    await expect(main).toContainText("Gjort om til oppdrag");

    // Eiendommen lagres på oppdraget. Før det er skjemaet bare forhåndsutfylt fra ordren.
    await main.getByRole("link", { name: NUMBER }).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    const assignmentUrl = page.url();
    const property = page.getByRole("region", { name: "Eiendom", exact: true });
    await expect(property.getByLabel(/^Adresse/)).toHaveValue(oldAddress(suffix));
    await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
    await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
    await property.getByLabel(/^Gårdsnummer/).fill("12");
    await property.getByLabel(/^Bruksnummer/).fill("34");
    await property.getByRole("button", { name: "Lagre eiendom", exact: true }).click();
    await expect(property.getByText("Fylt ut fra ordren", { exact: false })).toHaveCount(0);
    await page.reload();
    await expect(property.getByLabel(/^Boligtype/).locator("option:checked")).toHaveText(
      "Enebolig",
    );

    await page.goto(`/ordre/${id}`);
    await openEdit(page);
    await expect(page.getByText(CONVERTED_NOTE)).toBeVisible();
    await field.address(page).fill(newAddress(suffix));
    await saveButton(page).click();
    await expect(page).toHaveURL(CORRECTED_URL);
    await expect(page.getByRole("status").filter({ hasText: CORRECTED })).toBeVisible();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(newAddress(suffix));
    await expect(historyLines(page).first()).toContainText("Rettet: adresse");

    // Lenken til oppdraget står, og oppdraget har fortsatt den gamle adressen (A251)
    const assignmentLink = main.getByRole("link", { name: NUMBER });
    await expect(assignmentLink).toBeVisible();
    await assignmentLink.click();
    await expect(page).toHaveURL(assignmentUrl);
    await expect(property.getByLabel(/^Adresse/)).toHaveValue(oldAddress(suffix));
    await expect(page.getByRole("main")).not.toContainText(newAddress(suffix));
  });

  test("5.4 avvist ordre kan rettes", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    await createOrderViaUi(page, oldAddress(suffix));
    await field.reason(page).fill("Feil registrering");
    await page.getByRole("button", { name: "Avvis", exact: true }).click();
    const main = page.getByRole("main");
    await expect(main.getByText("Avvist", { exact: true }).first()).toBeVisible();

    await correctAddress(page, newAddress(suffix));
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(newAddress(suffix));
    // Status og grunn står som før
    await expect(main.getByText("Avvist", { exact: true }).first()).toBeVisible();
    await expect(main).toContainText("Feil registrering");
    await expect(historyLines(page).first()).toContainText("Rettet: adresse");
  });

  test("5.5 tom adresse gir feilmeldingen ved feltet, og ingenting lagres", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    const id = await createOrderViaUi(page, oldAddress(suffix));

    await openEdit(page);
    await field.address(page).fill("");
    await saveButton(page).click();
    await expect(page.getByText("Skriv inn adressen.")).toBeVisible();
    const describedBy = await field.address(page).getAttribute("aria-describedby");
    expect(describedBy, "adressefeltet peker på meldingen").toBeTruthy();
    const ids = describedBy!.split(" ");
    const described = await Promise.all(
      ids.map((ref) => page.locator(`[id="${ref}"]`).first().textContent()),
    );
    expect(described.join(" ")).toContain("Skriv inn adressen.");

    await page.goto(`/ordre/${id}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
      oldAddress(suffix),
    );
    await expect(historyLines(page)).toHaveCount(1);
  });

  test("5.6 to faner: lagring i den andre gir «Ordren er endret av en annen»", async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    const id = await createOrderViaUi(page, oldAddress(suffix));

    const second = await context.newPage();
    await second.goto(`/ordre/${id}?rett=1`);
    await expect(field.address(second)).toBeVisible();
    await openEdit(page);

    // Første fane lagrer
    await field.address(page).fill(newAddress(suffix));
    await saveButton(page).click();
    await expect(page).toHaveURL(CORRECTED_URL);

    // Andre fane har gammel versjon
    await field.gnr(second).fill("99");
    await saveButton(second).click();
    await expect(second.getByText(CHANGED_BY_OTHER)).toBeVisible();
    await expect(second).toHaveURL(EDIT_URL);

    await second.goto(`/ordre/${id}`);
    await expect(second.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
      newAddress(suffix),
    );
    await expect(historyLines(second)).toHaveCount(2);
    await expect(historyLines(second).first()).not.toContainText("gårdsnummer");
    await second.close();
  });

  test("5.7 bestilleren kobles til en kontakt etter lagring", async ({ page }) => {
    const suffix = uniqueSuffix();
    const firmName = `Testmegling ${suffix} AS`;
    const lastName = `Retting${suffix}`;
    const fullName = `Megler ${lastName}`;
    await logIn(page);

    // Firma og kontakt først
    await page.goto("/firma/ny");
    await page.getByLabel(/^Navn/).fill(firmName);
    await page.getByLabel(/^Organisasjonsnummer/).fill(fakeValidOrgNumber());
    await page.getByLabel(/^Type/).selectOption({ label: "Meglerforetak" });
    await saveButton(page).click();
    await expect(page).toHaveURL(FIRM_URL);

    await mainNav(page).getByRole("link", { name: "Kontakter", exact: true }).click();
    await page.getByRole("link", { name: "Ny kontakt", exact: true }).click();
    await expect(page).toHaveURL(/\/kontakter\/ny$/);
    await page.getByLabel(/^Fornavn/).fill("Megler");
    await page.getByLabel(/^Etternavn/).fill(lastName);
    await page.getByLabel(/^E-post/).fill(`megler.${suffix}@example.com`);
    await page.getByLabel(/^Telefon/).fill("00000000");
    await page.getByLabel(/^Firma/).selectOption({ label: firmName });
    await saveButton(page).click();
    await expect(page).toHaveURL(CONTACT_URL);
    const contactId = CONTACT_URL.exec(page.url())![1]!;

    // Ordren uten kobling, så kobling via «Rett ordren»
    await createOrderViaUi(page, oldAddress(suffix));
    await expect(page.getByRole("main").locator(`a[href="/kontakter/${contactId}"]`)).toHaveCount(
      0,
    );
    await openEdit(page);
    await page.getByLabel(/^Søk i kontakter/).fill(lastName);
    const hit = page.getByRole("button", { name: new RegExp(lastName) });
    await expect(hit).toHaveCount(1);
    await hit.click();
    await expect(page.locator('[name="orderedByText"]')).toHaveValue(`${fullName}, ${firmName}`);
    await expect(page.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await saveButton(page).click();

    await expect(page).toHaveURL(CORRECTED_URL);
    await expect(page.getByRole("status").filter({ hasText: CORRECTED })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(`${fullName}, ${firmName}`);
    await expect(page.getByRole("main").locator(`a[href="/kontakter/${contactId}"]`)).toBeVisible();
    await expect(historyLines(page).first()).toContainText("kontakt i registeret");
  });

  test("5.8 takstmann (innstillingen på) ser «Rett ordren» og kan lagre", async ({ page }) => {
    const previous = await setInspectorsEditAll(true);
    try {
      const suffix = uniqueSuffix();
      await logInAsInspector(page);
      const inspector = await employeeByEmail(INSPECTOR_EMAIL);
      await createOrderViaUi(page, oldAddress(suffix));
      await expect(editLink(page)).toBeVisible();
      await correctAddress(page, newAddress(suffix));
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
        newAddress(suffix),
      );
      await expectNewestLine(page, "Rettet: adresse", inspector.name);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("5.9 bruker uten ansattrad får «Ingen tilgang» og ser ingen adresse eller endringer", async ({
    page,
    browser,
  }) => {
    const suffix = uniqueSuffix();
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const id = await createOrderViaUi(adminPage, oldAddress(suffix));
    await correctAddress(adminPage, newAddress(suffix));
    await adminContext.close();

    const email = await createUserWithoutEmployee();
    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));

    for (const url of [`/ordre/${id}`, `/ordre/${id}?rett=1`]) {
      const response = await page.goto(url);
      expect(response, `${url} svarer`).not.toBeNull();
      expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "Ingen tilgang", level: 1 })).toBeVisible();
      await expect(history(page)).toHaveCount(0);
      await expect(editLink(page)).toHaveCount(0);
      const html = await page.content();
      expect(html).not.toContain(oldAddress(suffix));
      expect(html).not.toContain(newAddress(suffix));
    }
  });
});

test.describe("rette ordre på iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("5.10 i stående: ingen vannrett rulling, én kolonne og knapper på minst 44 px", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const id = await createOrderViaUi(page, oldAddress(suffix));

    await expectAtLeast44(editLink(page), "Rett ordren");
    await openEdit(page);
    await expectNoHorizontalScroll(page, `/ordre/${id}?rett=1`);
    await expectAtLeast44(saveButton(page), "Lagre");
    await expectAtLeast44(cancelLink(page), "Avbryt");

    const boxes = await Promise.all(
      [field.address(page), field.gnr(page), field.bnr(page), field.orderedBy(page)].map((f) =>
        f.boundingBox(),
      ),
    );
    const lefts = boxes.map((box) => Math.round(box!.x));
    expect(new Set(lefts).size, "alle feltene starter i samme kolonne").toBe(1);
    const tops = boxes.map((box) => Math.round(box!.y)).sort((a, b) => a - b);
    expect(new Set(tops).size, "feltene står under hverandre, ett per rad").toBe(tops.length);

    await field.address(page).fill(newAddress(suffix));
    await saveButton(page).click();
    await expect(page).toHaveURL(CORRECTED_URL);
    await expect(history(page)).toBeVisible();
    await history(page).scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page, `/ordre/${id}?rettet=1 med «Endringer»`);
  });

  test("5.11 ordren rettes og lagres med tastaturet alene", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    await createOrderViaUi(page, oldAddress(suffix));

    // Tab til «Rett ordren» og Enter
    const link = editLink(page);
    for (let i = 0; i < 60; i++) {
      if (await link.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(link, "«Rett ordren» nås med Tab").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(EDIT_URL);

    // Tab til adressen, tøm, skriv og send med Enter
    const address = field.address(page);
    await expect(address).toBeVisible();
    for (let i = 0; i < 60; i++) {
      if (await address.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(address, "adressefeltet nås med Tab").toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(newAddress(suffix));
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(CORRECTED_URL);
    await expect(page.getByRole("status").filter({ hasText: CORRECTED })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
      newAddress(suffix),
    );
    await expect(historyLines(page).first()).toContainText("Rettet: adresse");
  });
});
