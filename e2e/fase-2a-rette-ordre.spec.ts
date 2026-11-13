import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  createFirmWithContact,
  employeeByEmail,
  logIn,
  uniqueSuffix,
} from "./helpers";

/*
 * Endre en ordre etter at den er lagret (T1, fase 2a).
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 11. Kjører i prosjektene pc og
 * ipad; 11.10–11.14 bare i ipad, 11.15 (T-0031) bare i pc. 11.8 utgår (runde 4: dekket av
 * rettighetsmatrisen og can-edit-orders.test.ts).
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager egen ordre med en unik
 * ending i adressen, fordi e2e-databasen ikke tømmes. Adresser og navn er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (en skrivefeil rettes på stedet, på PC og iPad, uten at noe som er
 * skrevet går tapt) og færre reklamasjoner (det står hvem som endret hva, oppdraget endres ikke).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const NUMBER = /\d{4}-\d{5}/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const SAVED = "Endringene er lagret.";
const CHANGED = "Ordren er endret av en annen. Last siden på nytt.";
const OFFLINE = "Du er uten nett. Endringen er ikke lagret.";
const CONVERTED_NOTE =
  "Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.";
const PREFILL_LINE = "Fylt ut fra ordren. Kontroller før du lagrer.";

function addressField(scope: Page | Locator): Locator {
  return scope.getByLabel(/^Adresse/);
}

function editButton(page: Page): Locator {
  return page.getByRole("button", { name: "Endre ordren", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre", exact: true });
}

function cancelButton(page: Page): Locator {
  return page.getByRole("button", { name: "Avbryt", exact: true });
}

function reloadButton(page: Page): Locator {
  return page.getByRole("button", { name: "Last siden på nytt", exact: true });
}

/** Delen «Endringer» under ordren (landemerke eller seksjon med overskriften). */
function changesSection(page: Page): Locator {
  return page
    .locator("section, [role=region]")
    .filter({ has: page.getByRole("heading", { name: "Endringer", exact: true }) })
    .last();
}

async function expectMinHeight(target: Locator, name: string, min: number) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

async function expectNoHorizontalScroll(page: Page, what: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling: ${what}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** «Ny ordre» med adressen → «Lagre». Returnerer id-en. */
async function createOrder(page: Page, address: string): Promise<string> {
  await page.goto("/ordre/ny");
  await addressField(page).fill(address);
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  return ORDER_URL.exec(page.url())![1]!;
}

/** «Gjør om til oppdrag» (Bodø) på ordresiden. Returnerer oppdragsnummeret. */
async function convert(page: Page): Promise<string> {
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  const main = page.getByRole("main");
  await expect(main).toContainText("Gjort om til oppdrag");
  await expect(main).toContainText(NUMBER);
  return NUMBER.exec((await main.textContent()) ?? "")![0];
}

/** «Endre ordren» → skjemaet er åpent. */
async function openEditForm(page: Page) {
  await editButton(page).click();
  await expect(saveButton(page)).toBeVisible();
}

/** Delen «Eiendom» på oppdragssiden. */
function propertySection(page: Page): Locator {
  return page.getByRole("region", { name: "Eiendom", exact: true });
}

/**
 * Trykk knappen og vent på svaret fra server-handlingen (POST med «next-action»). Kopiert fra
 * e2e/fase-2a-eiendom-matrikkel.spec.ts.
 */
async function clickAndWaitForSave(page: Page, button: Locator) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await button.click();
  const response = await saved;
  expect(response.status(), "lagringen gir ikke 500").toBeLessThan(500);
}

/**
 * På oppdragssiden: oppdiktet gnr/bnr 999 (ordren har ingen matrikkel), første gyldige boligtype
 * og eierform → «Lagre eiendom».
 */
async function saveAssignmentProperty(page: Page) {
  const property = propertySection(page);
  await property.getByLabel(/^Gårdsnummer/).fill("999");
  await property.getByLabel(/^Bruksnummer/).fill("999");
  await property.getByLabel(/^Boligtype/).selectOption({ index: 1 });
  await property.getByLabel(/^Eierform/).selectOption({ index: 1 });
  await clickAndWaitForSave(
    page,
    property.getByRole("button", { name: "Lagre eiendom", exact: true }),
  );
  await expect(property).not.toContainText(PREFILL_LINE);
}

/** Ny adresse i skjemaet → «Lagre» → «Endringene er lagret.» */
async function changeAddress(page: Page, address: string) {
  await openEditForm(page);
  await addressField(page).fill(address);
  await saveButton(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();
}

test.describe("endre ordren (pc og ipad)", () => {
  test("11.1 endre mottatt ordre: ny adresse, «Endringer» viser hvem, når og gammel → ny", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const oldAddress = `Testveien 12 ${suffix}, 8000 Bodø`;
    const newAddress = `Testveien 14 ${suffix}, 8000 Bodø`;
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    await createOrder(page, oldAddress);

    await editButton(page).click();
    // Fokus flyttes til skjemaets overskrift
    const focused = page.locator(":focus");
    await expect(focused).toHaveCount(1);
    expect(await focused.evaluate((el) => /^H[1-6]$/.test(el.tagName))).toBe(true);
    await expect(focused).toContainText(/Endre/);

    await addressField(page).fill(newAddress);
    await saveButton(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(newAddress);

    const changes = changesSection(page);
    await expect(changes).toBeVisible();
    await expect(changes).toContainText("Endret");
    await expect(changes).toContainText(admin.name);
    await expect(changes).toContainText(/\d{2}\.\d{2}\.\d{4}/);
    await expect(changes).toContainText(/\d{2}[:.]\d{2}/);
    await expect(changes).toContainText(`Adresse: ${oldAddress} → ${newAddress}`);
  });

  test("11.2 endre gjort-om ordre: linjen om oppdraget vises, nummeret og lenken er uendret, lagret eiendom på oppdraget har gammel adresse", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const oldAddress = `Testveien 12 ${suffix}, 8000 Bodø`;
    const newAddress = `Testveien 14 ${suffix}, 8000 Bodø`;
    await logIn(page);
    const orderId = await createOrder(page, oldAddress);
    const number = await convert(page);
    const link = page.getByRole("main").getByRole("link", { name: NUMBER });
    const hrefBefore = await link.getAttribute("href");

    // Lagre eiendommen på oppdraget først (adressen er fylt ut fra ordren)
    await link.click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    await expect(addressField(propertySection(page))).toHaveValue(oldAddress);
    await saveAssignmentProperty(page);

    await page.goto(`/ordre/${orderId}`);
    await openEditForm(page);
    await expect(page.getByText(CONVERTED_NOTE)).toBeVisible();
    await addressField(page).fill(newAddress);
    await saveButton(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();

    await expect(page.getByRole("main")).toContainText(number);
    await expect(link).toHaveAttribute("href", hrefBefore!);
    expect(page.url()).toContain(`/ordre/${orderId}`);

    await link.click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    const html = await page.content();
    expect(html, "oppdraget viser fortsatt gammel adresse").toContain(oldAddress);
    expect(html, "oppdraget har ikke fått ny adresse").not.toContain(newAddress);
  });

  test("11.2b gjort-om ordre uten lagret eiendom: oppdraget foreslår den rettede adressen", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const oldAddress = `Testveien 12 ${suffix}, 8000 Bodø`;
    const newAddress = `Testveien 14 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, oldAddress);
    await convert(page);
    await changeAddress(page, newAddress);

    await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    const property = propertySection(page);
    await expect(addressField(property)).toHaveValue(newAddress);
    await expect(property).toContainText(PREFILL_LINE);
  });

  test("11.3 én lagreknapp: mens skjemaet er åpent, finnes ikke «Gjør om» og «Avvis»", async ({
    page,
  }) => {
    await logIn(page);
    await createOrder(page, `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toBeVisible();

    await openEditForm(page);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Avvis", exact: true })).toHaveCount(0);
    await expect(saveButton(page)).toHaveCount(1);
  });

  test("11.4 «Avbryt» lukker skjemaet og lagrer ingenting", async ({ page }) => {
    const suffix = uniqueSuffix();
    const oldAddress = `Testveien 12 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, oldAddress);
    const linesBefore = await changesSection(page).getByRole("listitem").count();

    await openEditForm(page);
    await addressField(page).fill(`Avbrutt ${suffix}`);
    await cancelButton(page).click();

    await expect(saveButton(page)).toHaveCount(0);
    await expect(editButton(page)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(oldAddress);
    await expect(page.getByRole("main")).not.toContainText(`Avbrutt ${suffix}`);
    expect(await changesSection(page).getByRole("listitem").count()).toBe(linesBefore);
  });

  test("11.5 konflikt i én fane: meldingen, «Last siden på nytt» og det som er skrevet står igjen", async ({
    page,
    context,
  }, testInfo) => {
    const suffix = uniqueSuffix();
    const typed = `Testveien 16 ${suffix}, 8000 Bodø`;
    await logIn(page);
    const orderId = await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);

    await openEditForm(page);
    await addressField(page).fill(typed);

    // Endre ordren på serveren uten fanen: «Avvis» i en egen side i samme kontekst
    const other = await context.newPage();
    await other.goto(`/ordre/${orderId}`);
    await other.getByLabel(/^Grunn/).fill("Feil registrering");
    await other.getByRole("button", { name: "Avvis", exact: true }).click();
    await expect(other.getByRole("main")).toContainText("Avvist");
    await other.close();

    await saveButton(page).click();
    await expect(page.getByText(CHANGED)).toBeVisible();
    await expect(reloadButton(page)).toBeVisible();
    await expect(addressField(page)).toHaveValue(typed);

    if (testInfo.project.name === "ipad") {
      await expectMinHeight(reloadButton(page), "Last siden på nytt", 44);
    }
  });

  test("11.6 uten nett: melding, feltene beholder verdiene, og «Lagre» virker når nettet er tilbake", async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const typed = `Testveien 18 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);

    await openEditForm(page);
    await addressField(page).fill(typed);
    await context.setOffline(true);
    try {
      await saveButton(page).click();
      await expect(page.getByText(OFFLINE)).toBeVisible();
      await expect(addressField(page)).toHaveValue(typed);
    } finally {
      await context.setOffline(false);
    }

    await saveButton(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(typed);
  });

  test("11.6b ingen lokal lagring: markøren finnes ikke i localStorage, sessionStorage, IndexedDB eller adressen", async ({
    page,
  }) => {
    const marker = `MARKOR-LOKAL-${uniqueSuffix()}`;
    await logIn(page);
    await createOrder(page, `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
    await openEditForm(page);
    await addressField(page).fill(marker);
    await addressField(page).blur();

    const stored = await page.evaluate(async () => {
      const dump = (storage: Storage) =>
        Array.from({ length: storage.length }, (_, i) => {
          const key = storage.key(i) ?? "";
          return `${key}=${storage.getItem(key) ?? ""}`;
        }).join("\n");
      const databases =
        typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      return {
        local: dump(window.localStorage),
        session: dump(window.sessionStorage),
        indexedDb: databases.map((db) => db.name ?? "").join("\n"),
      };
    });
    expect(stored.local).not.toContain(marker);
    expect(stored.session).not.toContain(marker);
    expect(stored.indexedDb).not.toContain(marker);
    expect(decodeURIComponent(page.url())).not.toContain(marker);
  });

  test("11.7 bestiller: koble kontakt med kontaktvelgeren; «Endringer» viser kontaktnavnet", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const lastName = `Endresen${suffix}`;
    await createFirmWithContact({
      firmName: `Testmegling ${suffix} AS`,
      contactLastName: lastName,
    });
    await logIn(page);
    await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);

    await openEditForm(page);
    await page.getByLabel(/^Søk i kontakter/).fill(lastName);
    const hit = page.getByRole("button", { name: new RegExp(lastName) });
    await expect(hit).toHaveCount(1);
    await hit.click();
    await expect(page.getByText(new RegExp(`Koblet til .*${lastName}`))).toBeVisible();
    await saveButton(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();

    await expect(
      page.getByRole("main").getByRole("link", { name: "Kontakt i registeret" }),
    ).toBeVisible();
    await expect(changesSection(page)).toContainText(lastName);
  });

  test("11.9 ordet «Rettet» finnes ikke på ordresiden, heller ikke etter en endring", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);
    await expect(page.getByRole("main")).not.toContainText(/\bRettet\b/);
    await changeAddress(page, `Testveien 14 ${suffix}, 8000 Bodø`);
    await expect(page.getByRole("main")).not.toContainText(/\bRettet\b/);
  });
});

test.describe("iPad (prosjektet ipad, stående)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("11.10 «Endre ordren», «Avbryt» minst 44 px; «Lagre» minst 56 px", async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    await createOrder(page, `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
    await expectMinHeight(editButton(page), "Endre ordren", 44);
    await openEditForm(page);
    await expectMinHeight(saveButton(page), "Lagre", 56);
    await expectMinHeight(cancelButton(page), "Avbryt", 44);
  });

  test("11.11/11.13 ingen vannrett rulling med skjemaet åpent og med lange verdier; «Endringer» bryter linjene", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    const suffix = uniqueSuffix();
    const long = `Testveienmedetsværtlangtnavnutenmellomromsomikkekanbrytesnaturlig${suffix}`;
    await logIn(page);
    const orderId = await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);

    await openEditForm(page);
    await expectNoHorizontalScroll(page, `/ordre/${orderId} med skjemaet åpent`);
    await addressField(page).fill(`${long} ${long}, 8000 Bodø`);
    await saveButton(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();

    await expectNoHorizontalScroll(page, `/ordre/${orderId} med lange verdier i «Endringer»`);
    const section = changesSection(page);
    await expect(section).toContainText(long);
    const width = page.viewportSize()!.width;
    const overflowing = await section.evaluate((root, viewport) => {
      const bad: string[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        // Går utenfor visningsflaten, eller teksten kuttes (skjult overflyt)
        const hidden = ["hidden", "clip"].includes(getComputedStyle(el).overflowX);
        if (box.right > viewport + 1 || (hidden && el.scrollWidth > el.clientWidth + 1)) {
          bad.push(el.tagName);
        }
      }
      return bad;
    }, width);
    expect(overflowing, "ingen tekst i «Endringer» går utenfor eller kuttes").toEqual([]);
  });

  test("11.12 «Lagre» og «Avbryt» står i skjemaet (ikke fast plassert) og er synlige etter rulling til bunnen", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    await createOrder(page, `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
    await openEditForm(page);

    for (const button of [saveButton(page), cancelButton(page)]) {
      const positions = await button.evaluate((el) => {
        const found: string[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          found.push(getComputedStyle(node).position);
        }
        return found;
      });
      expect(positions).not.toContain("fixed");
      expect(await button.evaluate((el) => el.closest("form") !== null)).toBe(true);
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await saveButton(page).scrollIntoViewIfNeeded();
    await expect(saveButton(page)).toBeInViewport();
    await expect(cancelButton(page)).toBeInViewport();
  });

  test("11.14 skjemaet fylles ut og lagres med tastaturet alene (Tab og Enter)", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    const suffix = uniqueSuffix();
    const newAddress = `Tastaturveien 3 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, `Testveien 12 ${suffix}, 8000 Bodø`);

    const button = editButton(page);
    for (let i = 0; i < 60; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(saveButton(page)).toBeVisible();

    const field = addressField(page);
    for (let i = 0; i < 40; i++) {
      if (await field.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(newAddress);

    const save = saveButton(page);
    for (let i = 0; i < 40; i++) {
      if (await save.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(newAddress);
  });
});

test.describe("T-0031 ordrelisten (prosjektet pc)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "pc", "Bare i prosjektet pc");
  });

  test("11.15 kansellert oppdrag: raden viser «kansellert» og nummeret uten lenke, som ordresiden", async ({
    page,
  }) => {
    const address = `Testveien 12 ${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, address);
    const number = await convert(page);
    await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);

    const status = page.getByRole("region", { name: "Status", exact: true });
    await status.getByRole("button", { name: "Kanseller oppdraget", exact: true }).click();
    const cancelForm = status
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Kanseller", exact: true }) });
    await cancelForm.getByLabel(/Grunn/).fill("Kunden trakk bestillingen");
    await cancelForm.getByRole("button", { name: "Kanseller", exact: true }).click();
    await expect(page.getByText(`Oppdrag ${number} er kansellert.`)).toBeVisible();

    await page.goto("/ordre");
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: address });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(number);
    await expect(row).toContainText(/kansellert/i);
    await expect(row.locator('a[href^="/oppdrag/"]')).toHaveCount(0);
  });
});
