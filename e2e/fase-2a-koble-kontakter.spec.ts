import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeValidOrgNumber, logIn, uniqueSuffix } from "./helpers";

/*
 * Koble partene og bestilleren til kontakter og firma (fase 2a).
 * Testplan: docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 10. Én sammenhengende
 * test (beslutning 8) som kjøres i prosjektene pc og ipad; iPad-sjekkene (punkt 10) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Testen lager eget firma, egen kontakt,
 * egen ordre og eget oppdrag med `uniqueSuffix()`, fordi e2e-databasen ikke tømmes. Data er
 * oppdiktet: «Testmegling … AS», «Megler Kobling…», megler.…@example.com, telefon 00000000. Ingen
 * e2e uten nett: kontoret legger inn parter og ordre på PC.
 *
 * Lokatorene følger kortet punkt 5: søkefeltet «Søk i kontakter» med treffene som vanlige
 * knapper under, «Koblet til <navn>» med knappen «Fjern kobling», meldingen «Ingen kontakter
 * passer …» med lenke til /kontakter/ny, lenken «Kontakt i registeret» på partskortet og en
 * lenke til /kontakter/<id> på ordresiden. «Bestilt av» er feltet `orderedByText`.
 *
 * Støtter hovedmål: tid (noen bokstaver og ett trykk i stedet for fire felt, også med tastatur
 * og på iPad) og reklamasjoner (rett megler, rett e-post).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIRM_URL = new RegExp(`/firma/(${UUID})$`);
const CONTACT_URL = new RegExp(`/kontakter/(${UUID})$`);
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const NO_HITS = "Ingen kontakter passer.";

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
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

function saveButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Lagre", exact: true });
}

/** Firma via skjermen. Returnerer id-en. */
async function createFirmViaUi(page: Page, name: string): Promise<string> {
  await page.goto("/firma/ny");
  await page.getByLabel(/^Navn/).fill(name);
  await page.getByLabel(/^Organisasjonsnummer/).fill(fakeValidOrgNumber());
  await page.getByLabel(/^Type/).selectOption({ label: "Meglerforetak" });
  await saveButton(page).click();
  await expect(page).toHaveURL(FIRM_URL);
  return FIRM_URL.exec(page.url())![1]!;
}

type Contact = { firstName: string; lastName: string; email: string; phone: string; firm: string };

/** Kontakt i firmaet via skjermen. Returnerer id-en. */
async function createContactViaUi(page: Page, contact: Contact): Promise<string> {
  await mainNav(page).getByRole("link", { name: "Kontakter", exact: true }).click();
  await page.getByRole("link", { name: "Ny kontakt", exact: true }).click();
  await expect(page).toHaveURL(/\/kontakter\/ny$/);
  await page.getByLabel(/^Fornavn/).fill(contact.firstName);
  await page.getByLabel(/^Etternavn/).fill(contact.lastName);
  await page.getByLabel(/^E-post/).fill(contact.email);
  await page.getByLabel(/^Telefon/).fill(contact.phone);
  await page.getByLabel(/^Firma/).selectOption({ label: contact.firm });
  await saveButton(page).click();
  await expect(page).toHaveURL(CONTACT_URL);
  return CONTACT_URL.exec(page.url())![1]!;
}

/** Ny ordre med unik adresse → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. */
async function newAssignment(page: Page): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");
  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

function partiesSection(page: Page): Locator {
  return page.getByRole("region", { name: "Parter", exact: true });
}

function partyCard(page: Page, name: string): Locator {
  return partiesSection(page).getByRole("listitem").filter({ hasText: name });
}

/** Skjemaet «Legg til part». Åpner det først hvis «Legg til part» er en knapp. */
async function openAddPartyForm(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: "Legg til part", exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    const form = page.locator("form").filter({ has: page.getByLabel(/^Rolle/) });
    if ((await form.count()) === 0) await button.first().click();
  }
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel(/^Rolle/) })
    .first();
  await expect(form).toBeVisible();
  return form;
}

function searchBox(scope: Page | Locator): Locator {
  return scope.getByLabel(/^Søk i kontakter/);
}

/** Treffknappen for kontakten (navnet står i knappen). */
function hit(scope: Page | Locator, lastName: string): Locator {
  return scope.getByRole("button", { name: new RegExp(lastName) });
}

/** Tab fra søkefeltet til treffet (høyst noen trykk), og Enter. */
async function chooseWithKeyboard(page: Page, scope: Page | Locator, lastName: string) {
  const target = hit(scope, lastName);
  await expect(target).toBeVisible();
  for (let i = 0; i < 5; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target, "treffet nås med Tab").toBeFocused();
  await page.keyboard.press("Enter");
}

test.describe("koble partene og bestilleren til kontakter (pc og ipad)", () => {
  test("10.1 kontakt fra registeret som part og bestiller", async ({ page }, testInfo) => {
    const isIpad = testInfo.project.name === "ipad";
    const suffix = uniqueSuffix();
    const firmName = `Testmegling ${suffix} AS`;
    const contact: Contact = {
      firstName: "Megler",
      lastName: `Kobling${suffix}`,
      email: `megler.${suffix}@example.com`,
      phone: "00000000",
      firm: firmName,
    };
    const fullName = `${contact.firstName} ${contact.lastName}`;

    // 1. Admin logger inn og lager firma og kontakt
    await logIn(page);
    await createFirmViaUi(page, firmName);
    const contactId = await createContactViaUi(page, contact);

    // 2. Oppdraget (ordre → gjør om), «Legg til part»
    await newAssignment(page);
    const form = await openAddPartyForm(page);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });

    // 3. Søk på noe som ikke finnes: meldingen og lenken til /kontakter/ny
    await searchBox(form).fill(`Finnesikke${suffix}`);
    await expect(form.getByText(NO_HITS)).toBeVisible();
    await expect(form.locator('a[href="/kontakter/ny"]')).toBeVisible();

    // 4. Søk på noen bokstaver (gir en liste), så på kontakten; velg treffet med Tab og Enter
    await searchBox(form).fill("Meg");
    await expect(form.getByText(NO_HITS)).toHaveCount(0);
    await searchBox(form).fill(contact.lastName);
    await expect(hit(form, contact.lastName)).toHaveCount(1);
    await expect(hit(form, contact.lastName)).toContainText(firmName);

    if (isIpad) {
      // 10. iPad: trefflisten åpen uten vannrett rulling, treffknappen minst 44 px
      await expectAtLeast44(hit(form, contact.lastName), "treffet i søket");
      await expectNoHorizontalScroll(page, "oppdragssiden med trefflisten (liggende)");
      await page.setViewportSize(PORTRAIT);
      await expectNoHorizontalScroll(page, "oppdragssiden med trefflisten (stående)");
      await expectAtLeast44(hit(form, contact.lastName), "treffet i søket (stående)");
    }

    await searchBox(form).focus();
    await chooseWithKeyboard(page, form, contact.lastName);

    // 5. Feltene er fylt ut, og «Koblet til <navn>» vises
    await expect(form.getByLabel(/^Navn/)).toHaveValue(fullName);
    await expect(form.getByLabel(/^Firma/)).toHaveValue(firmName);
    await expect(form.getByLabel(/^E-post/)).toHaveValue(contact.email);
    await expect(form.getByLabel(/^Telefon/)).toHaveValue(contact.phone);
    await expect(form.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await expect(form.getByRole("button", { name: "Fjern kobling", exact: true })).toBeVisible();

    // 6. Lagre: partskortet lenker til kontakten
    await saveButton(form).click();
    const card = partyCard(page, fullName);
    await expect(card).toHaveCount(1);
    const registryLink = card.getByRole("link", { name: "Kontakt i registeret" });
    await expect(registryLink).toHaveAttribute("href", `/kontakter/${contactId}`);
    for (const value of [firmName, contact.email, contact.phone]) {
      await expect(card).toContainText(value);
    }

    // 7. Endre parten, «Fjern kobling», lagre: lenken er borte, friteksten står
    await card.getByRole("button", { name: "Endre", exact: true }).click();
    const edit = partiesSection(page)
      .getByRole("listitem")
      .filter({ has: page.getByLabel(/^Navn/) });
    await expect(edit).toHaveCount(1);
    await expect(edit.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await edit.getByRole("button", { name: "Fjern kobling", exact: true }).click();
    await expect(edit.getByText(`Koblet til ${fullName}`)).toHaveCount(0);
    await expect(edit.getByLabel(/^Navn/)).toHaveValue(fullName);
    await saveButton(edit).click();
    const unlinked = partyCard(page, fullName);
    await expect(unlinked).toHaveCount(1);
    await expect(unlinked.getByRole("button", { name: "Endre", exact: true })).toBeVisible();
    await expect(unlinked.getByRole("link", { name: "Kontakt i registeret" })).toHaveCount(0);
    await expect(unlinked.locator(`a[href="/kontakter/${contactId}"]`)).toHaveCount(0);
    for (const value of [firmName, contact.email, contact.phone]) {
      await expect(unlinked).toContainText(value);
    }
    if (isIpad) await expectNoHorizontalScroll(page, "oppdragssiden etter lagring (stående)");

    // 8. Ny ordre med bestiller fra registeret: «Bestilt av» blir «Navn, Firma»
    if (isIpad) await page.setViewportSize({ width: 1194, height: 834 });
    await page.goto("/ordre/ny");
    await page.getByLabel(/^Adresse/).fill(`Testveien 14 ${suffix}, 8000 Bodø`);
    await searchBox(page).fill(contact.lastName);
    await expect(hit(page, contact.lastName)).toHaveCount(1);
    if (isIpad) {
      await expectAtLeast44(hit(page, contact.lastName), "treffet på ny ordre");
      await expectNoHorizontalScroll(page, "/ordre/ny med trefflisten (liggende)");
      await page.setViewportSize(PORTRAIT);
      await expectNoHorizontalScroll(page, "/ordre/ny med trefflisten (stående)");
    }
    await hit(page, contact.lastName).click();
    await expect(page.locator('[name="orderedByText"]')).toHaveValue(`${fullName}, ${firmName}`);
    await expect(page.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await saveButton(page).click();
    await expect(page).toHaveURL(ORDER_URL);

    // 9. Ordresiden lenker til kontakten
    const contactLink = page.getByRole("main").locator(`a[href="/kontakter/${contactId}"]`);
    await expect(contactLink).toBeVisible();
    await contactLink.click();
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));
  });
});
