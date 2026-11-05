import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeValidOrgNumber, logIn, uniqueSuffix } from "./helpers";

/*
 * Koble partene og bestilleren til kontakter i registeret (fase 2a).
 * Testplan: docs/funksjoner/fase2a-koble-kontakter-testplan.md punkt 10.1. Én sammenhengende
 * test (beslutning 8), kjøres i prosjektene pc og ipad. iPad-sjekkene (steg 10) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Firma, kontakt, ordre og oppdrag lages
 * med unik ending, fordi e2e-databasen ikke tømmes. Søket bruker det unike etternavnet, slik at
 * treffet alltid er blant de ti første. Kontakten er oppdiktet: «Megler Kobling…»,
 * «Testmegling … AS», e-post på example.com, telefon 00000000. Ingen test uten nett.
 *
 * Støtter hovedmål: tid (megleren søkes opp og feltene fylles ut av seg selv, med tastatur på PC
 * og iPad) og reklamasjoner (riktig e-post og navn på parten).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIRM_URL = new RegExp(`/firma/(${UUID})$`);
const CONTACT_URL = new RegExp(`/kontakter/(${UUID})$`);
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const PORTRAIT = { width: 834, height: 1194 } as const;
const NO_HITS =
  "Ingen kontakter passer. Skriv inn opplysningene under, eller legg inn kontakten i registeret.";

function saveButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Lagre", exact: true });
}

function searchField(scope: Page | Locator): Locator {
  return scope.getByLabel(/^Søk i kontakter/);
}

/** Knappen for treffet i kontaktvelgeren (navn og firma i knappen). */
function hitButton(scope: Page | Locator, name: string): Locator {
  return scope
    .getByRole("list", { name: "Treff i kontakter" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
}

function partiesSection(page: Page): Locator {
  return page.getByRole("region", { name: "Parter", exact: true });
}

function registryLink(scope: Page | Locator): Locator {
  return scope.getByRole("link", { name: "Kontakt i registeret", exact: true });
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

async function createFirm(page: Page, name: string) {
  await page.goto("/firma/ny");
  await page.getByLabel(/^Navn/).fill(name);
  await page.getByLabel(/^Organisasjonsnummer/).fill(fakeValidOrgNumber());
  await page.getByLabel(/^Type/).selectOption({ label: "Meglerforetak" });
  await saveButton(page).click();
  await expect(page).toHaveURL(FIRM_URL);
}

async function createContact(
  page: Page,
  data: { firstName: string; lastName: string; email: string; phone: string; firmName: string },
): Promise<string> {
  await page.goto("/kontakter/ny");
  await page.getByLabel(/^Fornavn/).fill(data.firstName);
  await page.getByLabel(/^Etternavn/).fill(data.lastName);
  await page.getByLabel(/^E-post/).fill(data.email);
  await page.getByLabel(/^Telefon/).fill(data.phone);
  await page.getByLabel(/^Firma/).selectOption({ label: data.firmName });
  await saveButton(page).click();
  await expect(page).toHaveURL(CONTACT_URL);
  return CONTACT_URL.exec(page.url())![1]!;
}

/** Ny ordre med unik adresse → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. */
async function newAssignment(page: Page, suffix: string) {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 14 ${suffix}, 8000 Bodø`);
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
}

test.describe("koble parter og bestiller til kontakter (pc og ipad)", () => {
  test("10.1 kontakt fra registeret som part og bestiller", async ({ page }) => {
    const ipad = test.info().project.name === "ipad";
    if (ipad) await page.setViewportSize(PORTRAIT);
    const suffix = uniqueSuffix();
    const firmName = `Testmegling ${suffix} AS`;
    const contact = {
      firstName: "Megler",
      lastName: `Kobling${suffix}`,
      email: `megler.${suffix}@example.com`,
      phone: "00000000",
      firmName,
    };
    const fullName = `${contact.firstName} ${contact.lastName}`;

    // 1. Firma og kontakt i registeret
    await logIn(page);
    await createFirm(page, firmName);
    const contactId = await createContact(page, contact);

    // 2. Oppdraget, «Legg til part»
    await newAssignment(page, suffix);
    await page.getByRole("button", { name: "Legg til part", exact: true }).click();
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel(/^Rolle/) })
      .first();
    await expect(form).toBeVisible();
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });

    // 3. Søk uten treff: meldingen og lenken til /kontakter/ny
    await searchField(form).fill(`Finnesikke${suffix}`);
    await expect(form.getByText(NO_HITS)).toBeVisible();
    await expect(
      form.getByRole("link", { name: "legg inn kontakten i registeret", exact: true }),
    ).toHaveAttribute("href", "/kontakter/ny");

    // 4. Søk på kontakten; treffet nås med Tab og velges med Enter
    await searchField(form).fill(contact.lastName);
    const hit = hitButton(form, fullName);
    await expect(hit).toBeVisible();
    await expect(hit).toContainText(firmName);
    // 10. iPad: trefflisten er åpen, ingen vannrett rulling, treffknappen er minst 44 px
    if (ipad) {
      await expectNoHorizontalScroll(page, "oppdragssiden med trefflisten åpen");
      await expectAtLeast44(hit, "treffet i kontaktvelgeren");
    }
    await searchField(form).press("Tab");
    await expect(hit).toBeFocused();
    await page.keyboard.press("Enter");

    // 5. Feltene er fylt ut, og koblingen vises
    await expect(form.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await expect(form.getByLabel(/^Navn/)).toHaveValue(fullName);
    await expect(form.getByLabel(/^Firma/)).toHaveValue(firmName);
    await expect(form.getByLabel(/^E-post/)).toHaveValue(contact.email);
    await expect(form.getByLabel(/^Telefon/)).toHaveValue(contact.phone);
    if (ipad)
      await expectAtLeast44(form.getByRole("button", { name: "Fjern kobling" }), "Fjern kobling");

    // 6. Lagre: partskortet lenker til kontakten
    await saveButton(form).click();
    const card = partiesSection(page).getByRole("listitem").filter({ hasText: fullName });
    await expect(card).toHaveCount(1);
    await expect(registryLink(card)).toHaveAttribute("href", `/kontakter/${contactId}`);

    // 7. Endre parten, «Fjern kobling», lagre: lenken er borte, friteksten står
    await card.getByRole("button", { name: "Endre", exact: true }).click();
    const editForm = page
      .locator("form")
      .filter({ has: page.getByLabel(/^Rolle/) })
      .first();
    await expect(editForm.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await editForm.getByRole("button", { name: "Fjern kobling", exact: true }).click();
    await expect(searchField(editForm)).toBeVisible();
    await expect(editForm.getByLabel(/^Navn/)).toHaveValue(fullName);
    await saveButton(editForm).click();
    const savedCard = partiesSection(page).getByRole("listitem").filter({ hasText: fullName });
    await expect(savedCard.getByRole("button", { name: "Endre", exact: true })).toBeVisible();
    await expect(registryLink(savedCard)).toHaveCount(0);
    for (const value of [fullName, firmName, contact.email, contact.phone]) {
      await expect(savedCard).toContainText(value);
    }

    // 8. Ny ordre med bestiller fra registeret: «Hvem bestilte» blir «Navn, Firma»
    await page.goto("/ordre/ny");
    await page.getByLabel(/^Adresse/).fill(`Testveien 16 ${suffix}, 8000 Bodø`);
    await searchField(page).fill(contact.lastName);
    const orderHit = hitButton(page, fullName);
    await expect(orderHit).toBeVisible();
    if (ipad) {
      await expectNoHorizontalScroll(page, "/ordre/ny med trefflisten åpen");
      await expectAtLeast44(orderHit, "treffet på ny ordre");
    }
    await orderHit.click();
    await expect(page.getByText(`Koblet til ${fullName}`)).toBeVisible();
    await expect(page.getByLabel(/^Hvem bestilte/)).toHaveValue(`${fullName}, ${firmName}`);
    await saveButton(page).click();
    await expect(page).toHaveURL(ORDER_URL);

    // 9. Ordresiden lenker til kontakten
    const main = page.getByRole("main");
    await expect(main).toContainText(`${fullName}, ${firmName}`);
    await expect(registryLink(main)).toHaveAttribute("href", `/kontakter/${contactId}`);
    await registryLink(main).click();
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));
  });
});
