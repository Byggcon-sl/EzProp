import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  createFirmWithContact,
  e2eDatabaseUrl,
  employeeByEmail,
  logIn,
  logInAsOffice,
  OFFICE_EMAIL,
  signInWithCode,
  softDeleteFirms,
  uniqueSuffix,
  convertedAssignmentNumber,
} from "./helpers";

/*
 * Endre en ordre etter at den er lagret (T1, fase 2a). Testplan:
 * docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 5. Kjører i prosjektene pc og ipad;
 * 5.10–5.12 bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre med en unik
 * ending i adressen, fordi e2e-databasen ikke tømmes. Data er oppdiktet («Testveien 12 …»,
 * «Prøvegata 7 …», «Megler Testesen»).
 *
 * Ordene fra kortet: knappen «Endre ordren», «Lagre» og «Avbryt» nederst i skjemaet, beskjeden
 * «Endringene er lagret.», delen «Endringer» med handlingen «Endret» og linjer som
 * «Adresse: <gammel> → <ny>». Ved konflikt: «Ordren er endret av en annen. Last siden på nytt.»
 * med knappen «Last siden på nytt». Uten nett: «Du er uten nett. Endringen er ikke lagret.»
 *
 * Støtter hovedmål: de ansatte (en feil rettes med tre trykk, på PC og iPad, og ingenting som er
 * skrevet går tapt) og færre reklamasjoner (oppdraget endres ikke, og det står hvem som endret).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})(\\?.*)?$`);
const SAVED = "Endringene er lagret.";
const CONFLICT = "Ordren er endret av en annen. Last siden på nytt.";
const OFFLINE = "Du er uten nett. Endringen er ikke lagret.";
// Endret med «Nytt oppdrag» (ADR 0011): rettelser for oppdraget gjøres på oppdraget.
const CONVERTED_NOTE =
  "Rettelser for oppdraget gjøres på oppdraget. Endringer her flytter ikke oppdraget.";

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
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

function addressField(page: Page): Locator {
  return page.getByLabel(/^Adresse/);
}

/** Delen «Endringer» under ordren (en `section` eller region med overskriften). */
function changesSection(page: Page): Locator {
  return page
    .locator("section, [role=region]")
    .filter({ has: page.getByRole("heading", { name: "Endringer", exact: true }) })
    .last();
}

async function expectAtLeast(target: Locator, name: string, min: number) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

function newAddress(suffix: string) {
  return {
    old: `Testveien 12 ${suffix}, 8000 Bodø`,
    next: `Prøvegata 7 ${suffix}, 8006 Bodø`,
  };
}

/** «Ny ordre» med adresse og bestiller → «Lagre». Returnerer id-en til ordren. */
async function createOrderViaUi(page: Page, address: string): Promise<string> {
  await page.goto("/ordre/ny");
  await addressField(page).fill(address);
  await page.getByLabel(/^Hvem bestilte/).fill("Megler Testesen");
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  return ORDER_URL.exec(page.url())![1]!;
}

/** «Endre ordren» og venter på skjemaet. */
async function openEditForm(page: Page) {
  await editButton(page).click();
  await expect(saveButton(page)).toBeVisible();
  await expect(addressField(page)).toBeVisible();
}

/** Gjør om ordren til oppdrag på kontoret «Bodø» og gir nummeret. */
async function convert(page: Page): Promise<string> {
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  return await convertedAssignmentNumber(page);
}

/** Oppdiktet innlogging uten ansattrad. Bare lokal database eller testdatabasen. */
async function createUserWithoutEmployee(): Promise<string> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const email = `uten-ansatt-${uniqueSuffix()}@example.com`;
  try {
    await sql`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, 'Oppdiktet uten ansattrad', ${email}, true)`;
  } finally {
    await sql.end();
  }
  return email;
}

test.describe("endre ordren (pc og ipad)", () => {
  test("5.1 «Endre ordren» → endre adressen → «Lagre»; «Endringer» viser hvem, når og gammel → ny", async ({
    page,
  }) => {
    const { old, next } = newAddress(uniqueSuffix());
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    await createOrderViaUi(page, old);

    await openEditForm(page);
    // Fokus flyttes til skjemaets overskrift
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(focusedTag, "fokus står på en overskrift").toMatch(/^H[1-6]$/);
    await expect(addressField(page)).toHaveValue(old);

    await addressField(page).fill(next);
    await saveButton(page).click();

    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expect(saveButton(page)).toHaveCount(0);
    const main = page.getByRole("main");
    await expect(main).toContainText(next);

    const changes = changesSection(page);
    await expect(changes).toBeVisible();
    await expect(changes).toContainText("Endret");
    await expect(changes).toContainText(admin.name);
    await expect(changes).toContainText(`Adresse: ${old} → ${next}`);
    await expect(changes).toContainText(/\d{1,2}\.\s?\d{1,2}\.\s?\d{4}/);
    await expect(changes).toContainText(/\d{2}[:.]\d{2}/);

    // Etter ny lasting står endringen fortsatt
    await page.reload();
    await expect(page.getByRole("main")).toContainText(next);
    await expect(changesSection(page)).toContainText(`Adresse: ${old} → ${next}`);
  });

  test("5.2 mens skjemaet er åpent, er «Gjør om» og «Avvis» skjult; bare én «Lagre»", async ({
    page,
  }) => {
    const { old } = newAddress(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, old);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toBeVisible();

    await openEditForm(page);
    await expect(saveButton(page)).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toBeHidden();
    await expect(page.getByRole("button", { name: "Avvis", exact: true })).toBeHidden();
  });

  test("5.3 «Avbryt» lukker skjemaet uten lagring", async ({ page }) => {
    const { old, next } = newAddress(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, old);
    const changesBefore = (await changesSection(page).textContent()) ?? "";

    await openEditForm(page);
    await addressField(page).fill(next);
    await cancelButton(page).click();

    await expect(saveButton(page)).toHaveCount(0);
    await expect(page.getByText(SAVED, { exact: true })).toHaveCount(0);
    const main = page.getByRole("main");
    await expect(main).toContainText(old);
    await expect(main).not.toContainText(next);
    await expect(changesSection(page)).toHaveText(changesBefore);

    await page.reload();
    await expect(page.getByRole("main")).toContainText(old);
    await expect(page.getByRole("main")).not.toContainText(next);
  });

  test("5.4 gjort-om ordre kan endres; linjen om oppdraget vises, og nummeret står uendret", async ({
    page,
  }) => {
    const { old, next } = newAddress(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, old);
    const number = await convert(page);
    const link = page.getByRole("main").getByRole("link", { name: number });
    const href = await link.getAttribute("href");

    await openEditForm(page);
    await expect(page.getByText(CONVERTED_NOTE, { exact: true })).toBeVisible();
    await addressField(page).fill(next);
    await saveButton(page).click();

    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText(next);
    await expect(main).toContainText("Gjort om til oppdrag");
    const linkAfter = main.getByRole("link", { name: number });
    await expect(linkAfter).toBeVisible();
    expect(await linkAfter.getAttribute("href")).toBe(href);
  });

  test("5.5 bestilleren kobles til en kontakt etter lagring; navnet vises på ordren og i «Endringer»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const lastName = `Kobling${suffix}`;
    const { firmId } = await createFirmWithContact({
      firmName: `Testmegling ${suffix} AS`,
      contactLastName: lastName,
    });
    try {
      const { old } = newAddress(suffix);
      await logIn(page);
      await createOrderViaUi(page, old);

      await openEditForm(page);
      await page.getByLabel(/^Søk i kontakter/).fill(lastName);
      await page.getByRole("button", { name: new RegExp(lastName) }).click();
      await expect(page.getByText(new RegExp(`Koblet til .*${lastName}`))).toBeVisible();
      await saveButton(page).click();

      await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
      await expect(page.getByRole("main")).toContainText(lastName);
      await expect(changesSection(page)).toContainText(lastName);
    } finally {
      await softDeleteFirms([firmId]);
    }
  });

  test("5.6 to faner: konfliktmelding med «Last siden på nytt», og teksten står; uten nett det samme", async ({
    page,
    context,
  }) => {
    const { old, next } = newAddress(uniqueSuffix());
    const typed = `Skrevet i andre fane ${uniqueSuffix()}, 8006 Bodø`;
    await logIn(page);
    const id = await createOrderViaUi(page, old);

    const second = await context.newPage();
    await second.goto(`/ordre/${id}`);
    await openEditForm(second);
    await openEditForm(page);

    // Første fane lagrer
    await addressField(page).fill(next);
    await saveButton(page).click();
    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();

    // Andre fane lagrer med gammel versjon
    await addressField(second).fill(typed);
    await saveButton(second).click();
    await expect(second.getByText(CONFLICT, { exact: true })).toBeVisible();
    await expect(reloadButton(second)).toBeVisible();
    await expect(addressField(second)).toHaveValue(typed);

    // Uten nett: melding, og teksten står
    await context.setOffline(true);
    try {
      await saveButton(second).click();
      await expect(second.getByText(OFFLINE, { exact: true })).toBeVisible();
      await expect(addressField(second)).toHaveValue(typed);
    } finally {
      await context.setOffline(false);
    }

    // Den første endringen står; den andre er ikke lagret
    await reloadButton(second).click();
    await expect(second.getByRole("main")).toContainText(next);
    await expect(second.getByRole("main")).not.toContainText(typed);
    await second.close();
  });

  test("5.7 tom adresse gir samme melding som «Ny ordre» ved feltet; ingenting lagres", async ({
    page,
  }) => {
    const { old } = newAddress(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, old);

    await openEditForm(page);
    await addressField(page).fill("");
    await saveButton(page).click();

    await expect(page.getByText("Skriv inn adressen.")).toBeVisible();
    await expect(addressField(page)).toHaveAttribute("aria-describedby", /.+/);
    const describedBy = (await addressField(page).getAttribute("aria-describedby")) ?? "";
    const describedText = await page.evaluate(
      (ids) =>
        ids
          .split(/\s+/)
          .map((part) => document.getElementById(part)?.textContent ?? "")
          .join(" "),
      describedBy,
    );
    expect(describedText).toContain("Skriv inn adressen.");
    await expect(page.getByText(SAVED, { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("main")).toContainText(old);
    await expect(changesSection(page)).not.toContainText("Endret");
  });

  test("5.8 kontoret ser «Endre ordren» og kan lagre", async ({ page }) => {
    const { old, next } = newAddress(uniqueSuffix());
    await logInAsOffice(page);
    const office = await employeeByEmail(OFFICE_EMAIL);
    await createOrderViaUi(page, old);

    await expect(editButton(page)).toBeVisible();
    await openEditForm(page);
    await addressField(page).fill(next);
    await saveButton(page).click();

    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(next);
    await expect(changesSection(page)).toContainText(office.name);
  });

  test("5.9 bruker uten ansattrad får «Ingen tilgang» og ser ingen adresse, knapp eller endringer", async ({
    page,
    browser,
  }) => {
    const { old } = newAddress(uniqueSuffix());
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const id = await createOrderViaUi(adminPage, old);
    await adminContext.close();

    const email = await createUserWithoutEmployee();
    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));
    const response = await page.goto(`/ordre/${id}`);
    expect(response?.status() ?? 0).toBeLessThan(500);

    await expect(deniedHeading(page)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(old);
    expect(html).not.toContain("Testveien");
    await expect(editButton(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Endringer", exact: true })).toHaveCount(0);
  });
});

test.describe("endre ordren på iPad (prosjektet ipad)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
    await page.setViewportSize(PORTRAIT);
  });

  test("5.10 stående: knappene er minst 44 px, «Lagre» minst 56 px", async ({ page, context }) => {
    const { old, next } = newAddress(uniqueSuffix());
    await logIn(page);
    const id = await createOrderViaUi(page, old);

    await expectAtLeast(editButton(page), "Endre ordren", 44);
    await openEditForm(page);
    await expectAtLeast(saveButton(page), "Lagre", 56);
    await expectAtLeast(cancelButton(page), "Avbryt", 44);

    // «Last siden på nytt» kommer ved konflikt: lagre fra en annen fane først
    const second = await context.newPage();
    await second.setViewportSize(PORTRAIT);
    await second.goto(`/ordre/${id}`);
    await openEditForm(second);
    await addressField(second).fill(next);
    await saveButton(second).click();
    await expect(second.getByText(SAVED, { exact: true })).toBeVisible();
    await second.close();

    await addressField(page).fill(`${next} igjen`);
    await saveButton(page).click();
    await expect(page.getByText(CONFLICT, { exact: true })).toBeVisible();
    await expectAtLeast(reloadButton(page), "Last siden på nytt", 44);
  });

  test("5.11 stående: ingen vannrett rulling, skjemaet i én kolonne, «Endringer» kan leses", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const old = `Testveien 12 med et ganske langt navn på adressen ${suffix}, 8000 Bodø`;
    const next = `Prøvegata 7 med et ganske langt navn på adressen ${suffix}, 8006 Bodø`;
    await logIn(page);
    await createOrderViaUi(page, old);

    await openEditForm(page);
    await expectNoHorizontalScroll(page, "med skjemaet åpent");

    // Én kolonne: adresse og gårdsnummer står under hverandre, ikke ved siden av
    const addressBox = await addressField(page).boundingBox();
    const gnrBox = await page.getByLabel(/^(Gårdsnummer|Gnr)/i).boundingBox();
    expect(addressBox).not.toBeNull();
    expect(gnrBox).not.toBeNull();
    expect(gnrBox!.y, "gårdsnummer står under adressen").toBeGreaterThanOrEqual(
      addressBox!.y + addressBox!.height - 1,
    );

    await addressField(page).fill(next);
    await saveButton(page).click();
    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "med «Endringer»");

    const line = changesSection(page).getByText(`Adresse: ${old} → ${next}`);
    await expect(line).toBeVisible();
    const clipped = await line.evaluate((el) => {
      const style = getComputedStyle(el);
      const cut = el.scrollWidth > el.clientWidth + 1;
      return cut && (style.overflow === "hidden" || style.textOverflow === "ellipsis");
    });
    expect(clipped, "linjen i «Endringer» er ikke avkuttet").toBe(false);
    const box = await line.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(PORTRAIT.width);
  });

  test("5.12 skjemaet kan endres og lagres med tastaturet alene", async ({ page }) => {
    const { old, next } = newAddress(uniqueSuffix());
    await logIn(page);
    await createOrderViaUi(page, old);

    const button = editButton(page);
    for (let i = 0; i < 60; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button, "«Endre ordren» nås med Tab").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(saveButton(page)).toBeVisible();

    const field = addressField(page);
    for (let i = 0; i < 30; i++) {
      if (await field.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(field, "adressen nås med Tab").toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(next);

    const save = saveButton(page);
    for (let i = 0; i < 40; i++) {
      if (await save.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(save, "«Lagre» nås med Tab").toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(next);
  });
});
