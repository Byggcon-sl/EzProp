import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  fakeValidOrgNumber,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Fjerne og slå sammen like kontakter og firma (fase 2a).
 * Testplan: docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md avsnitt 5 (og 4.6,
 * som dekkes her fordi det ikke finnes noe mønster for sidetester av page.tsx).
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (5.6) bare i ipad; tastaturflyten bare i pc.
 *
 * Den oppdiktede lederen (leder@example.com, rollen manager) gjør alt, slik at testen viser at
 * rettigheten gjelder leder og ikke bare admin. Hver test lager egne data med `uniqueSuffix()`,
 * fordi e2e-databasen ikke tømmes. Data er oppdiktet: «Testmegling … AS», «Megler Dublett…»,
 * megler.…@example.com, telefon 00000000. Ingen e2e uten nett: registeret brukes med nett.
 *
 * Tekstene står i oppgavekortet, Omfang 3.
 *
 * Støtter hovedmål: tid (fjerning er 2 trykk, sammenslåing 4–5, på PC og iPad) og reklamasjoner
 * (takstmann og kontor kan verken fjerne eller slå sammen, og sidene gir 404).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIRM_URL = new RegExp(`/firma/(${UUID})$`);
const CONTACT_URL = new RegExp(`/kontakter/(${UUID})$`);
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const CONTACT_REMOVE_TEXT =
  "Kontakten vises ikke lenger i listen og søket. Oppdrag og ordrer beholder navnet som står på dem.";

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
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

/** iPad liggende og stående: ingen vannrett rulling, og knappene er minst 44 px høye. */
async function checkIpad(page: Page, where: string, buttons: Locator[]) {
  await expectNoHorizontalScroll(page, `${where} (liggende)`);
  for (const button of buttons) await expectAtLeast44(button, `knapp på ${where}`);
  await page.setViewportSize(PORTRAIT);
  await expectNoHorizontalScroll(page, `${where} (stående)`);
  for (const button of buttons) await expectAtLeast44(button, `knapp på ${where} (stående)`);
  await page.setViewportSize({ width: 1194, height: 834 });
}

/** Trykker Tab til målet har fokus (høyst `max` trykk), og så Enter. */
async function tabTo(page: Page, target: Locator, max = 15) {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target, "nås med Tab").toBeFocused();
  await page.keyboard.press("Enter");
}

function saveButton(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: "Lagre", exact: true });
}

/** Knappen «Fjern» på kontakt- eller firmasiden (før bekreftelsen). */
function removeButton(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: "Fjern", exact: true });
}

/** Knappen eller lenken «Slå sammen med …». */
function mergeLink(page: Page): Locator {
  return page.getByRole("main").getByRole("link", { name: /^Slå sammen med/ });
}

/** Bekreftelsen på siden: området med spørsmålet «Fjerne <navn>?» som navn. */
function confirmation(page: Page, question: string): Locator {
  return page.getByRole("main").getByRole("region", { name: question });
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

type Contact = { firstName: string; lastName: string; email: string; firm?: string };

/** Kontakt via skjermen, eventuelt i et firma. Returnerer id-en. */
async function createContactViaUi(page: Page, contact: Contact): Promise<string> {
  await page.goto("/kontakter/ny");
  await page.getByLabel(/^Fornavn/).fill(contact.firstName);
  await page.getByLabel(/^Etternavn/).fill(contact.lastName);
  await page.getByLabel(/^E-post/).fill(contact.email);
  await page.getByLabel(/^Telefon/).fill("00000000");
  if (contact.firm) await page.getByLabel(/^Firma/).selectOption({ label: contact.firm });
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

/** Legger kontakten til som megler på oppdraget som er åpent, via kontaktvelgeren (søk på e-post). */
async function addBrokerParty(page: Page, email: string, fullName: string) {
  const button = page.getByRole("button", { name: "Legg til part", exact: true });
  const formFilter = page.locator("form").filter({ has: page.getByLabel(/^Rolle/) });
  if ((await formFilter.count()) === 0 && (await button.count()) > 0) await button.first().click();
  const form = formFilter.first();
  await expect(form).toBeVisible();
  await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
  await form.getByLabel(/^Søk i kontakter/).fill(email);
  const hit = form.getByRole("button", { name: new RegExp(fullName) });
  await expect(hit).toHaveCount(1);
  await hit.click();
  await expect(form.getByText(`Koblet til ${fullName}`)).toBeVisible();
  await saveButton(form).click();
  await expect(
    partiesSection(page).getByRole("listitem").filter({ hasText: fullName }),
  ).toHaveCount(1);
}

/** Søkefeltet på sammenslåingssiden (`type="search"`). */
function mergeSearch(page: Page): Locator {
  return page.getByRole("main").getByRole("searchbox");
}

/** Søker på sammenslåingssiden (vanlig GET-skjema: skriv og trykk Enter). */
async function searchForMerge(page: Page, text: string) {
  await mergeSearch(page).fill(text);
  await mergeSearch(page).press("Enter");
  await expect(page).toHaveURL(/[?&]q=/);
}

/** Treffene i søket på sammenslåingssiden (lenker i listen «Treff»). */
function mergeHits(page: Page): Locator {
  return page.getByRole("main").getByRole("list", { name: "Treff" }).getByRole("link");
}

/** Treffet med navnet (navnet står først i lenken). */
function mergeHit(page: Page, name: string): Locator {
  return mergeHits(page).filter({ hasText: name });
}

/** Valget «Behold denne» i kortet med navnet. */
function keepChoice(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .getByRole("group", { name, exact: true })
    .getByRole("radio", { name: "Behold denne" });
}

function mergeButton(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: "Slå sammen", exact: true });
}

test.describe("fjerne og slå sammen kontakter og firma (pc og ipad)", () => {
  test("5.1 leder fjerner en kontakt", async ({ page }, testInfo) => {
    const isIpad = testInfo.project.name === "ipad";
    const suffix = uniqueSuffix();
    const contact = {
      firstName: "Megler",
      lastName: `Fjern${suffix}`,
      email: `megler.${suffix}@example.com`,
    };
    const name = `${contact.firstName} ${contact.lastName}`;
    const question = `Fjerne ${name}?`;

    await logInAsManager(page);
    const contactId = await createContactViaUi(page, contact);

    // «Fjern» viser bekreftelsen med navnet og teksten fra kortet
    await removeButton(page).click();
    const box = confirmation(page, question);
    await expect(box).toBeVisible();
    await expect(box).toContainText(CONTACT_REMOVE_TEXT);
    const confirmButton = box.getByRole("button", { name: "Fjern", exact: true });
    const cancelButton = box.getByRole("button", { name: "Avbryt", exact: true });
    if (isIpad) await checkIpad(page, "bekreftelsen for kontakt", [confirmButton, cancelButton]);

    // «Avbryt» lar kontakten stå
    await cancelButton.click();
    await expect(page.getByText(question)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/kontakter/${contactId}$`));
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

    // «Fjern» igjen og bekreft (på PC med Tab og Enter)
    if (isIpad) {
      await removeButton(page).click();
      await confirmation(page, question)
        .getByRole("button", { name: "Fjern", exact: true })
        .click();
    } else {
      await removeButton(page).focus();
      await page.keyboard.press("Enter");
      const again = confirmation(page, question);
      await expect(again).toBeVisible();
      await tabTo(page, again.getByRole("button", { name: "Fjern", exact: true }));
    }

    // Tilbake på listen med beskjeden
    await expect(page).toHaveURL(/\/kontakter(\?.*)?$/);
    await expect(page.getByText(`${name} er fjernet.`)).toBeVisible();

    // Søket finner den ikke, og siden gir «finnes ikke»
    await page.goto(`/kontakter?q=${encodeURIComponent(contact.lastName)}`);
    await expect(page.getByText("Ingen kontakter passer med søket.")).toBeVisible();
    await expect(page.locator(`a[href="/kontakter/${contactId}"]`)).toHaveCount(0);
    await page.goto(`/kontakter/${contactId}`);
    await expect(deniedHeading(page)).toBeVisible();
    await expect(page.getByText(contact.email)).toHaveCount(0);

    // 4.6: sammenslåingssiden for en fjernet kontakt gir 404
    const response = await page.goto(`/kontakter/${contactId}/sla-sammen`);
    expect(response?.status()).toBe(404);
  });

  test("5.2 leder fjerner et firma", async ({ page }, testInfo) => {
    const isIpad = testInfo.project.name === "ipad";
    const suffix = uniqueSuffix();
    const firmName = `Testmegling Fjern${suffix} AS`;

    await logInAsManager(page);
    const firmId = await createFirmViaUi(page, firmName);
    const contactId = await createContactViaUi(page, {
      firstName: "Megler",
      lastName: `Firmafjern${suffix}`,
      email: `megler.${suffix}@example.com`,
      firm: firmName,
    });

    await page.goto(`/firma/${firmId}`);
    await removeButton(page).click();
    const box = confirmation(page, `Fjerne ${firmName}?`);
    await expect(box).toBeVisible();
    await expect(box).toContainText(
      "1 kontakter er koblet til firmaet. De beholdes, men står uten firma.",
    );
    const confirmButton = box.getByRole("button", { name: "Fjern", exact: true });
    if (isIpad) {
      await checkIpad(page, "bekreftelsen for firma", [
        confirmButton,
        box.getByRole("button", { name: "Avbryt", exact: true }),
      ]);
    }
    await confirmButton.click();

    await expect(page).toHaveURL(/\/firma(\?.*)?$/);
    await expect(page.getByText(`${firmName} er fjernet.`)).toBeVisible();

    // Firmaet er borte fra søket, og kontakten står uten firma
    await page.goto(`/firma?q=${encodeURIComponent(`Fjern${suffix}`)}`);
    await expect(page.locator(`a[href="/firma/${firmId}"]`)).toHaveCount(0);
    await page.goto(`/kontakter/${contactId}`);
    await expect(page.getByLabel(/^Firma/)).toHaveValue("");
    await expect(page.getByRole("main")).not.toContainText(firmName);
  });

  test("5.3 leder slår sammen to kontakter", async ({ page }, testInfo) => {
    const isIpad = testInfo.project.name === "ipad";
    const suffix = uniqueSuffix();
    const lastName = `Dublett${suffix}`;
    const keep = { firstName: "Megler", lastName, email: `megler.${suffix}@example.com` };
    const other = { firstName: "Megl", lastName, email: `megl.${suffix}@example.com` };
    const keepName = `${keep.firstName} ${lastName}`;
    const otherName = `${other.firstName} ${lastName}`;

    await logInAsManager(page);
    const keepId = await createContactViaUi(page, keep);
    const otherId = await createContactViaUi(page, other);

    // Den som fjernes, er megler på et oppdrag
    const assignmentId = await newAssignment(page);
    await addBrokerParty(page, other.email, otherName);

    // «Slå sammen med …» fra kontakten som beholdes
    await page.goto(`/kontakter/${keepId}`);
    if (isIpad) {
      await expectAtLeast44(mergeLink(page), "«Slå sammen med …»");
      await mergeLink(page).click();
    } else {
      await tabTo(page, mergeLink(page), 40);
    }
    await expect(page).toHaveURL(new RegExp(`/kontakter/${keepId}/sla-sammen$`));

    // Søket viser ikke den åpne kontakten, bare den andre
    await searchForMerge(page, lastName);
    await expect(mergeHits(page)).toHaveCount(1);
    await expect(mergeHit(page, otherName)).toHaveCount(1);
    await expect(page.getByRole("main").locator(`a[href*="med=${keepId}"]`)).toHaveCount(0);
    if (isIpad) {
      await expectAtLeast44(mergeHit(page, otherName), "treffet i søket");
      await mergeHit(page, otherName).click();
    } else {
      await mergeSearch(page).focus();
      await tabTo(page, mergeHit(page, otherName), 5);
    }
    await expect(page).toHaveURL(new RegExp(`med=${otherId}`));

    // De to side om side, med antall oppdrag; den åpne er valgt som standard
    const main = page.getByRole("main");
    await expect(main).toContainText(keepName);
    await expect(main).toContainText(otherName);
    await expect(main).toContainText(keep.email);
    await expect(main).toContainText(other.email);
    const keepRadio = keepChoice(page, keepName);
    const otherRadio = keepChoice(page, otherName);
    await expect(page.getByRole("group", { name: otherName, exact: true })).toContainText(
      /Oppdrag\s*1/,
    );
    await expect(keepRadio).toBeChecked();
    await expect(main).toContainText(
      `${otherName} fjernes. Oppdrag og ordrer flyttes til ${keepName}.`,
    );

    // Bytt hvem som beholdes, og tilbake
    await otherRadio.check();
    await expect(otherRadio).toBeChecked();
    await expect(main).toContainText(
      `${keepName} fjernes. Oppdrag og ordrer flyttes til ${otherName}.`,
    );
    await keepRadio.check();
    await expect(keepRadio).toBeChecked();

    if (isIpad) {
      await checkIpad(page, "sammenslåingssiden for kontakter", [mergeButton(page)]);
      await mergeButton(page).click();
    } else {
      await tabTo(page, mergeButton(page), 10);
    }

    // Siden for den som beholdes, med beskjeden
    await expect(page).toHaveURL(new RegExp(`/kontakter/${keepId}(\\?.*)?$`));
    await expect(page.getByText("Kontaktene er slått sammen.")).toBeVisible();

    // Oppdraget lenker til den som beholdes, og søket gir ett treff
    await page.goto(`/oppdrag/${assignmentId}`);
    const card = partiesSection(page).getByRole("listitem").filter({ hasText: otherName });
    await expect(card.getByRole("link", { name: "Kontakt i registeret" })).toHaveAttribute(
      "href",
      `/kontakter/${keepId}`,
    );
    await page.goto(`/kontakter?q=${encodeURIComponent(lastName)}`);
    await expect(page.locator(`a[href="/kontakter/${keepId}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="/kontakter/${otherId}"]`)).toHaveCount(0);

    // 4.7: søket på sammenslåingssiden viser verken den åpne eller den som er fjernet
    await page.goto(`/kontakter/${keepId}/sla-sammen`);
    await mergeSearch(page).fill(lastName);
    await mergeSearch(page).press("Enter");
    await expect(page.getByText("Ingen andre kontakter passer med søket.")).toBeVisible();
    await expect(mergeHits(page)).toHaveCount(0);
  });

  test("5.4 leder slår sammen to firma", async ({ page }, testInfo) => {
    const isIpad = testInfo.project.name === "ipad";
    const suffix = uniqueSuffix();
    const keepFirm = `Testmegling Behold${suffix} AS`;
    const otherFirm = `Testmegling Dublett${suffix} AS`;

    await logInAsManager(page);
    const keepId = await createFirmViaUi(page, keepFirm);
    const otherId = await createFirmViaUi(page, otherFirm);
    const contactId = await createContactViaUi(page, {
      firstName: "Megler",
      lastName: `Firmasammen${suffix}`,
      email: `megler.${suffix}@example.com`,
      firm: otherFirm,
    });

    await page.goto(`/firma/${keepId}`);
    await mergeLink(page).click();
    await expect(page).toHaveURL(new RegExp(`/firma/${keepId}/sla-sammen$`));

    await searchForMerge(page, `Dublett${suffix}`);
    await expect(mergeHits(page)).toHaveCount(1);
    await expect(mergeHit(page, otherFirm)).toHaveCount(1);
    await mergeHit(page, otherFirm).click();

    const main = page.getByRole("main");
    await expect(main).toContainText(keepFirm);
    await expect(main).toContainText(otherFirm);
    await expect(keepChoice(page, keepFirm)).toBeChecked();
    await expect(main).toContainText(
      `${otherFirm} fjernes. Oppdrag og ordrer flyttes til ${keepFirm}.`,
    );
    if (isIpad) await checkIpad(page, "sammenslåingssiden for firma", [mergeButton(page)]);
    await mergeButton(page).click();

    await expect(page).toHaveURL(new RegExp(`/firma/${keepId}(\\?.*)?$`));
    await expect(page.getByText("Firmaene er slått sammen.")).toBeVisible();

    // Kontakten står nå i firmaet som beholdes, og det fjernede firmaet gir «finnes ikke»
    await expect(page.locator(`a[href="/kontakter/${contactId}"]`)).toHaveCount(1);
    await page.goto(`/kontakter/${contactId}`);
    await expect(page.getByLabel(/^Firma/)).toHaveValue(keepId);
    await page.goto(`/firma/${otherId}`);
    await expect(deniedHeading(page)).toBeVisible();
  });

  test("5.5 takstmann og kontor ser ingen knapper, og sidene gir 404", async ({ page }) => {
    const suffix = uniqueSuffix();
    const firmName = `Testmegling Takst${suffix} AS`;

    await logInAsManager(page);
    const firmId = await createFirmViaUi(page, firmName);
    const contactId = await createContactViaUi(page, {
      firstName: "Megler",
      lastName: `Takst${suffix}`,
      email: `megler.${suffix}@example.com`,
      firm: firmName,
    });

    const pages = [`/kontakter/${contactId}`, `/firma/${firmId}`];
    const mergePages = [
      `/kontakter/${contactId}/sla-sammen`,
      `/firma/${firmId}/sla-sammen`,
      // Fremmed eller ukjent id (4.6): samme svar
      `/kontakter/${randomUUID()}/sla-sammen`,
      `/firma/${randomUUID()}/sla-sammen`,
    ];

    async function expectNoButtons(target: Page, who: string) {
      for (const url of pages) {
        await target.goto(url);
        await expect(target.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(removeButton(target), `${who}: «Fjern» på ${url}`).toHaveCount(0);
        await expect(
          target.getByRole("main").getByRole("button", { name: /^Slå sammen/ }),
        ).toHaveCount(0);
        await expect(mergeLink(target), `${who}: «Slå sammen med …» på ${url}`).toHaveCount(0);
      }
      for (const url of mergePages) {
        const response = await target.goto(url);
        expect(response?.status(), `${who}: ${url} gir 404`).toBe(404);
        await expect(target.getByRole("button", { name: "Slå sammen", exact: true })).toHaveCount(
          0,
        );
      }
    }

    // Leder ser knappene (kontrollen på at lokatorene treffer)
    await page.goto(pages[0]!);
    await expect(removeButton(page)).toHaveCount(1);
    await expect(mergeLink(page)).toHaveCount(1);
    // Fremmed id gir 404 også for leder
    expect((await page.goto(mergePages[2]!))?.status()).toBe(404);

    // Takstmann, med innstillingen «alle takstmenn kan endre alt» på (det sterkeste tilfellet)
    const previous = await setInspectorsEditAll(true);
    try {
      await page.context().clearCookies();
      await logInAsInspector(page);
      await expectNoButtons(page, "takstmann (innstillingen på)");
    } finally {
      await restoreInspectorsEditAll(previous);
    }

    // Kontor
    await page.context().clearCookies();
    await logInAsOffice(page);
    await expectNoButtons(page, "kontor");
  });
});
