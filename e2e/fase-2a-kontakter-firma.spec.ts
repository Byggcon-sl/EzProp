import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { fakeValidOrgNumber, logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Kontakter og firma (fase 2a).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 8.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (8.6) bare i ipad.
 *
 * Admin fra seed. Hver test lager egne data med `uniqueSuffix()` og `fakeValidOrgNumber()`,
 * fordi e2e-databasen ikke tømmes. Data er oppdiktet: «Testmegling … AS», «Megler Test…»,
 * megler@example.com, telefon 00000000. Ingen e2e uten nett: registeret brukes med nett.
 *
 * Lokatorene bruker etikettene fra kortet: feltene «Navn», «Organisasjonsnummer», «Type»,
 * «Notat», «Fornavn», «Etternavn», «E-post», «Telefon», «Firma»; søkefeltet er `type="search"`
 * (rollen searchbox); knappene «Lagre», «Nytt firma» og «Ny kontakt»; menypunktene «Firma» og
 * «Kontakter».
 *
 * Støtter hovedmål: tid (ett register, dubletten lenker til firmaet som finnes, søket finner
 * megleren, også på iPad) og reklamasjoner (kilden vises på kontakten).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIRM_URL = new RegExp(`/firma/(${UUID})$`);
const CONTACT_URL = new RegExp(`/kontakter/(${UUID})$`);
const HELP_TEXT = "Kort og saklig. Ikke skriv helseopplysninger eller fødselsnummer.";

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
  name: (page: Page) => page.getByLabel(/^Navn/),
  orgNumber: (page: Page) => page.getByLabel(/^Organisasjonsnummer/),
  firmType: (page: Page) => page.getByLabel(/^Type/),
  notes: (page: Page) => page.getByLabel(/^Notat/),
  firstName: (page: Page) => page.getByLabel(/^Fornavn/),
  lastName: (page: Page) => page.getByLabel(/^Etternavn/),
  email: (page: Page) => page.getByLabel(/^E-post/),
  phone: (page: Page) => page.getByLabel(/^Telefon/),
  firm: (page: Page) => page.getByLabel(/^Firma/),
  search: (page: Page) => page.getByRole("main").getByRole("searchbox"),
};

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre", exact: true });
}

/** «000 012 345» med mellomrom, slik en bruker ofte skriver det. */
function withSpaces(orgNumber: string): string {
  return `${orgNumber.slice(0, 3)} ${orgNumber.slice(3, 6)} ${orgNumber.slice(6)}`;
}

/** Verdien står i feltet når skjemaet vises, ellers som tekst på siden. */
async function expectShown(page: Page, input: Locator, value: string) {
  if ((await input.count()) > 0) await expect(input).toHaveValue(value);
  else await expect(page.getByRole("main")).toContainText(value);
}

/** Søk i listen på siden (søkefeltet, så Enter). */
async function search(page: Page, text: string) {
  const box = field.search(page);
  await box.fill(text);
  await box.press("Enter");
}

/** Lenkene til enkeltrader i hovedinnholdet (ikke «ny»). */
function rowLinks(page: Page, base: "/kontakter" | "/firma"): Locator {
  return page.getByRole("main").locator(`a[href^="${base}/"]:not([href="${base}/ny"])`);
}

/** Meny «Firma» → «Nytt firma» → navn, nummer, type → «Lagre». Returnerer URL-en etterpå. */
async function fillNewFirm(
  page: Page,
  data: { name: string; orgNumber: string; typeLabel?: string },
) {
  await mainNav(page).getByRole("link", { name: "Firma", exact: true }).click();
  await expect(page).toHaveURL(/\/firma(\?.*)?$/);
  await page.getByRole("link", { name: "Nytt firma", exact: true }).click();
  await expect(page).toHaveURL(/\/firma\/ny$/);
  await field.name(page).fill(data.name);
  await field.orgNumber(page).fill(data.orgNumber);
  await field.firmType(page).selectOption({ label: data.typeLabel ?? "Meglerforetak" });
  await saveButton(page).click();
}

async function createFirmViaUi(page: Page, data: { name: string; orgNumber: string }) {
  await fillNewFirm(page, data);
  await expect(page).toHaveURL(FIRM_URL);
  return FIRM_URL.exec(page.url())![1]!;
}

type ContactData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  firmName?: string;
  notes: string;
};

async function createContactViaUi(page: Page, data: ContactData) {
  await mainNav(page).getByRole("link", { name: "Kontakter", exact: true }).click();
  await expect(page).toHaveURL(/\/kontakter(\?.*)?$/);
  await page.getByRole("link", { name: "Ny kontakt", exact: true }).click();
  await expect(page).toHaveURL(/\/kontakter\/ny$/);
  await field.firstName(page).fill(data.firstName);
  await field.lastName(page).fill(data.lastName);
  await field.email(page).fill(data.email);
  await field.phone(page).fill(data.phone);
  if (data.firmName) await field.firm(page).selectOption({ label: data.firmName });
  await field.notes(page).fill(data.notes);
  await saveButton(page).click();
  await expect(page).toHaveURL(CONTACT_URL);
  return CONTACT_URL.exec(page.url())![1]!;
}

test.describe("kontakter og firma (pc og ipad)", () => {
  test("8.1 hele flyten: firma, dublett med lenke, kontakt med kilde, søk, endre notat, firmasiden", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const firmName = `Testmegling ${suffix} AS`;
    const orgNumber = fakeValidOrgNumber();
    await logIn(page);

    // Nytt firma
    const firmId = await createFirmViaUi(page, { name: firmName, orgNumber });
    await expect(page.getByRole("main")).toContainText(firmName);

    // Samme nummer igjen, skrevet med mellomrom → dublettmeldingen med lenke
    await fillNewFirm(page, { name: `Annen ${firmName}`, orgNumber: withSpaces(orgNumber) });
    await expect(page).toHaveURL(/\/firma\/ny$/);
    await expect(
      page.getByText(`Et firma med dette organisasjonsnummeret finnes allerede: ${firmName}.`),
    ).toBeVisible();
    const link = page.getByRole("main").locator(`a[href="/firma/${firmId}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/firma/${firmId}$`));

    // Ny kontakt i firmaet
    const contact: ContactData = {
      firstName: "Megler",
      lastName: `Test${suffix}`,
      email: `megler.${suffix}@example.com`,
      phone: "00000000",
      firmName,
      notes: "Vil ha rapport før kl. 12",
    };
    const contactId = await createContactViaUi(page, contact);
    await expect(page.getByText("Kilde: Lagt inn for hånd")).toBeVisible();

    // Listen: søk på etternavnet finner kontakten
    await mainNav(page).getByRole("link", { name: "Kontakter", exact: true }).click();
    await search(page, contact.lastName);
    const rows = rowLinks(page, "/kontakter");
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText(firmName);
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));

    // Endre notatet
    const newNote = `Ring før befaring ${suffix}`;
    await field.notes(page).fill(newNote);
    await saveButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));
    await page.reload();
    await expect(field.notes(page)).toHaveValue(newNote);
    await expect(page.getByText("Kilde: Lagt inn for hånd")).toBeVisible();

    // Firmasiden viser kontakten med lenke
    await page.goto(`/firma/${firmId}`);
    const contactLink = page.getByRole("main").locator(`a[href="/kontakter/${contactId}"]`);
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toContainText(contact.lastName);
  });

  test("8.2 søk uten treff gir ingen rader, og hjelpeteksten står ved notatet", async ({
    page,
  }) => {
    const nothing = `Finnesikke${uniqueSuffix()}`;
    await logIn(page);

    await page.goto("/kontakter");
    await search(page, nothing);
    await expect(rowLinks(page, "/kontakter")).toHaveCount(0);

    await page.goto("/firma");
    await search(page, nothing);
    await expect(rowLinks(page, "/firma")).toHaveCount(0);

    await page.goto("/kontakter/ny");
    await expect(page.getByText(HELP_TEXT)).toBeVisible();
    await expect(field.notes(page)).toHaveAttribute("aria-describedby", /.+/);
  });

  test("8.3 feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);

    // Firma: tomt navn og ugyldig nummer
    await page.goto("/firma/ny");
    await field.orgNumber(page).fill("000000018");
    await saveButton(page).click();
    await expect(page.getByText("Skriv inn navnet.")).toBeVisible();
    await expect(page.getByText("Organisasjonsnummeret er ikke gyldig.")).toBeVisible();
    await expect(field.name(page)).toHaveAttribute("aria-describedby", /.+/);
    await expect(page).toHaveURL(/\/firma\/ny$/);

    // Kontakt: tomt fornavn, bokstaver i telefon, «fødselsnummer» i notatet
    const lastName = `Feil${suffix}`;
    await page.goto("/kontakter/ny");
    await field.lastName(page).fill(lastName);
    await field.phone(page).fill("abc");
    await field.notes(page).fill("12345678901");
    await saveButton(page).click();
    await expect(page.getByText("Skriv inn fornavnet.")).toBeVisible();
    await expect(
      page.getByText("Telefonnummeret kan bare ha sifre, mellomrom og +."),
    ).toBeVisible();
    await expect(page.getByText("Fødselsnummer skal ikke lagres her.")).toBeVisible();
    await expect(page).toHaveURL(/\/kontakter\/ny$/);

    // Ingenting er lagret
    await page.goto("/kontakter");
    await search(page, lastName);
    await expect(rowLinks(page, "/kontakter")).toHaveCount(0);
  });

  test("8.4 takstmann ser listen og kan åpne en kontakt", async ({ page }) => {
    const suffix = uniqueSuffix();
    const lastName = `Takst${suffix}`;
    await logIn(page);
    const contactId = await createContactViaUi(page, {
      firstName: "Megler",
      lastName,
      email: `megler.${suffix}@example.com`,
      phone: "00000000",
      notes: "Vil ha rapport før kl. 12",
    });
    await page.context().clearCookies();

    await logInAsInspector(page);
    await page.goto("/kontakter");
    await search(page, lastName);
    const rows = rowLinks(page, "/kontakter");
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));
    await expect(page.getByRole("main")).toContainText(lastName);
    // Med innstillingen på ser takstmannen skjemaet; uten står opplysningene som tekst
    await expectShown(page, field.phone(page), "00000000");
    await expectShown(page, field.notes(page), "Vil ha rapport før kl. 12");
  });

  test("8.5 ukjent id gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({ page }) => {
    await logIn(page);
    for (const url of [
      `/kontakter/${randomUUID()}`,
      "/kontakter/ikke-en-id",
      `/firma/${randomUUID()}`,
      "/firma/ikke-en-id",
    ]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page), url).toBeVisible();
    }
  });
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("8.6 i stående: ingen vannrett rulling, ingen avkuttet tekst i listene", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    const suffix = uniqueSuffix();
    const firmName = `Testmegling med et ganske langt navn ${suffix} AS`;
    await logIn(page);
    const firmId = await createFirmViaUi(page, { name: firmName, orgNumber: fakeValidOrgNumber() });
    await createContactViaUi(page, {
      firstName: "Megler",
      lastName: `Testesen-Langnavn${suffix}`,
      email: `megler.med.lang.adresse.${suffix}@example.com`,
      phone: "+47 000 00 000",
      firmName,
      notes: "Vil ha rapport før kl. 12",
    });

    for (const url of ["/kontakter", "/kontakter/ny", "/firma", `/firma/${firmId}`]) {
      await page.goto(url);
      await expectNoHorizontalScroll(page, url);
    }

    for (const [url, base] of [
      ["/kontakter", "/kontakter"],
      ["/firma", "/firma"],
    ] as const) {
      await page.goto(url);
      if (base === "/kontakter") await search(page, suffix);
      const links = rowLinks(page, base);
      expect(await links.count(), `${url} har rader`).toBeGreaterThan(0);
      const cut = await links.evaluateAll((elements) =>
        elements
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.textContent ?? ""),
      );
      expect(cut, `ingen avkuttet tekst i listen på ${url}`).toEqual([]);
    }
  });

  test("8.6 knapper og felt er minst 44 px høye, og søkefeltet kan brukes med skjermtastatur", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);

    await page.goto("/kontakter");
    await expectAtLeast44(
      page.getByRole("link", { name: "Ny kontakt", exact: true }),
      "Ny kontakt",
    );
    const box = field.search(page);
    await expect(box).toHaveAttribute("type", "search");
    await expectAtLeast44(box, "søkefeltet");
    await box.focus();
    await expect(box).toBeFocused();
    await page.keyboard.type("Testmegling");
    await expect(box).toHaveValue("Testmegling");

    await page.goto("/firma");
    await expectAtLeast44(
      page.getByRole("link", { name: "Nytt firma", exact: true }),
      "Nytt firma",
    );
    await expect(field.search(page)).toHaveAttribute("type", "search");

    await page.goto("/kontakter/ny");
    for (const [name, locator] of [
      ["Fornavn", field.firstName(page)],
      ["Etternavn", field.lastName(page)],
      ["E-post", field.email(page)],
      ["Telefon", field.phone(page)],
      ["Firma", field.firm(page)],
    ] as const) {
      await expectAtLeast44(locator, name);
    }
    await expectAtLeast44(saveButton(page), "Lagre");

    await page.goto("/firma/ny");
    for (const [name, locator] of [
      ["Navn", field.name(page)],
      ["Organisasjonsnummer", field.orgNumber(page)],
      ["Type", field.firmType(page)],
    ] as const) {
      await expectAtLeast44(locator, name);
    }
    await expectAtLeast44(saveButton(page), "Lagre");
  });
});
