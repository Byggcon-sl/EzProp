import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  createFirmWithContact,
  e2eDatabaseUrl,
  employeeByEmail,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  softDeleteFirms,
  uniqueSuffix,
} from "./helpers";

/*
 * Endre en ordre etter at den er lagret (T1, fase 2a).
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 11.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (11.10–11.14) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre med en unik
 * ending i adressen, fordi e2e-databasen ikke tømmes. Data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (tre trykk for å endre en ordre, ingenting går tapt ved konflikt
 * eller uten nett) og færre reklamasjoner (det står hvem som endret hva og når).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const NUMBER = /\d{4}-\d{5}/;
const ORDER_URL = /\/ordre\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\?.*)?$/;
const DATE_TIME = /\d{2}\.\d{2}\.\d{4} kl\. \d{2}:\d{2}/;
const ORDER_CHANGED = "Ordren er endret av en annen. Last siden på nytt.";
const OFFLINE = "Du er uten nett. Endringen er ikke lagret.";
const CONVERTED_NOTE =
  "Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.";

const address = (page: Page) => page.getByLabel(/^Adresse/);
const editButton = (page: Page) => page.getByRole("button", { name: "Endre ordren", exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: "Lagre", exact: true });
const cancelButton = (page: Page) => page.getByRole("button", { name: "Avbryt", exact: true });
const reloadButton = (page: Page) =>
  page.getByRole("button", { name: "Last siden på nytt", exact: true });
const editHeading = (page: Page) => page.getByRole("heading", { name: "Endre ordren", level: 2 });
const savedNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Endringene er lagret." });

function history(page: Page): Locator {
  return page.getByRole("region", { name: "Endringer" });
}

function historyEntries(page: Page): Locator {
  return history(page).locator("ol > li");
}

function orderHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 });
}

/** «Ny ordre» med adressen (og bestiller i fritekst). Returnerer id-en til ordren. */
async function createOrder(page: Page, addressText: string): Promise<string> {
  await page.goto("/ordre/ny");
  await address(page).fill(addressText);
  await page.getByLabel(/^Hvem bestilte/).fill("Megler Testesen, Testmegleren AS");
  await saveButton(page).click();
  await expect(page).toHaveURL(ORDER_URL);
  return ORDER_URL.exec(page.url())![1]!;
}

/** Åpner «Endre ordren» og venter på skjemaet. */
async function openEdit(page: Page) {
  await editButton(page).click();
  await expect(editHeading(page)).toBeVisible();
}

async function expectAtLeast(target: Locator, minimum: number, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${minimum} px høy`).toBeGreaterThanOrEqual(minimum);
}

async function expectNoHorizontalScroll(page: Page, what: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling ${what}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Oppdraget slik det står i databasen. Bare lesing, bare lokal database eller testdatabasen. */
async function assignmentRow(
  assignmentId: string,
): Promise<{ number: string; rowVersion: number; propertyId: string | null }> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ number: string; row_version: number; property_id: string | null }[]>`
      select number, row_version, property_id from assignments where id = ${assignmentId}`;
    if (!row) throw new Error("Fant ikke oppdraget");
    return { number: row.number, rowVersion: row.row_version, propertyId: row.property_id };
  } finally {
    await sql.end();
  }
}

test.describe("endre ordren (pc og ipad)", () => {
  test("11.1 endre adressen på en mottatt ordre → kvittering og linjen i «Endringer»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const before = `Testveien 12 ${suffix}, 8000 Bodø`;
    const after = `Testveien 14 ${suffix}, 8000 Bodø`;
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    await createOrder(page, before);

    await openEdit(page);
    await expect(editHeading(page)).toBeFocused();
    await expect(address(page)).toHaveValue(before);
    await address(page).fill(after);
    await saveButton(page).click();

    await expect(savedNotice(page)).toBeVisible();
    await expect(orderHeading(page)).toHaveText(after);
    await expect(editHeading(page)).toHaveCount(0);

    const latest = historyEntries(page).first();
    await expect(latest).toContainText("Endret");
    await expect(latest).toContainText(admin.name);
    await expect(latest).toContainText(DATE_TIME);
    await expect(latest).toContainText(`Adresse: ${before} → ${after}`);
    // Den eldste linjen er opprettelsen
    await expect(historyEntries(page).last()).toContainText("Opprettet");
  });

  test("11.2 endre en ordre som er gjort om → beskjeden vises, oppdraget er uendret", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const before = `Testveien 20 ${suffix}, 8000 Bodø`;
    const after = `Testveien 22 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, before);
    await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();

    const link = page.getByRole("link", { name: /Gjort om til oppdrag/ });
    await expect(link).toBeVisible();
    const number = NUMBER.exec((await link.textContent()) ?? "")![0];
    const href = (await link.getAttribute("href"))!;
    const assignmentId = href.split("/").pop()!;
    const assignmentBefore = await assignmentRow(assignmentId);

    await openEdit(page);
    await expect(page.getByText(CONVERTED_NOTE)).toBeVisible();
    await address(page).fill(after);
    await saveButton(page).click();
    await expect(savedNotice(page)).toBeVisible();
    await expect(orderHeading(page)).toHaveText(after);

    // Oppdragsnummeret og lenken er de samme, og oppdragsraden er ikke rørt (A251)
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toContainText(number);
    expect(await assignmentRow(assignmentId)).toEqual(assignmentBefore);
    await page.goto(href);
    await expect(page.getByRole("main")).toContainText(number);
  });

  test("11.3 mens skjemaet er åpent, er det bare én lagreknapp", async ({ page }) => {
    await logIn(page);
    await createOrder(page, `Testveien 30 ${uniqueSuffix()}, 8000 Bodø`);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toBeVisible();

    await openEdit(page);
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Avvis", exact: true })).toHaveCount(0);
    await expect(page.getByLabel(/^Grunn/)).toHaveCount(0);
    await expect(saveButton(page)).toHaveCount(1);
  });

  test("11.4 «Avbryt» lukker skjemaet uten å lagre", async ({ page }) => {
    const before = `Testveien 40 ${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, before);
    const entries = await historyEntries(page).count();

    await openEdit(page);
    await address(page).fill("Testveien 99, 8000 Bodø");
    await cancelButton(page).click();

    await expect(editHeading(page)).toHaveCount(0);
    await expect(editButton(page)).toBeFocused();
    await expect(orderHeading(page)).toHaveText(before);
    await expect(historyEntries(page)).toHaveCount(entries);

    await page.reload();
    await expect(orderHeading(page)).toHaveText(before);
    await expect(historyEntries(page)).toHaveCount(entries);
  });

  test("11.5 to faner: den andre får meldingen, beholder teksten og kan laste på nytt", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const first = `Testveien 51 ${suffix}, 8000 Bodø`;
    const second = `Testveien 52 ${suffix}, 8000 Bodø`;
    await logIn(page);
    const id = await createOrder(page, `Testveien 50 ${suffix}, 8000 Bodø`);
    const other = await page.context().newPage();
    await other.goto(`/ordre/${id}`);

    await openEdit(page);
    await openEdit(other);
    await address(page).fill(first);
    await address(other).fill(second);

    await saveButton(page).click();
    await expect(savedNotice(page)).toBeVisible();

    await saveButton(other).click();
    await expect(other.getByText(ORDER_CHANGED)).toBeVisible();
    await expect(reloadButton(other)).toBeVisible();
    await expect(address(other)).toHaveValue(second);
    // Meldingen står over feltene
    const messageBox = await other.getByText(ORDER_CHANGED).boundingBox();
    const fieldBox = await address(other).boundingBox();
    expect(messageBox!.y).toBeLessThan(fieldBox!.y);

    await reloadButton(other).click();
    await expect(orderHeading(other)).toHaveText(first);
    await expect(other.getByText(ORDER_CHANGED)).toHaveCount(0);
    await other.close();
  });

  test("11.6 uten nett: meldingen vises, teksten står, og lagring virker når nettet er tilbake", async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const after = `Testveien 62 ${suffix}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, `Testveien 60 ${suffix}, 8000 Bodø`);

    await openEdit(page);
    await address(page).fill(after);
    await context.setOffline(true);
    try {
      await saveButton(page).click();
      await expect(page.getByText(OFFLINE)).toBeVisible();
      await expect(address(page)).toHaveValue(after);
      await expect(editHeading(page)).toBeVisible();
    } finally {
      await context.setOffline(false);
    }

    await saveButton(page).click();
    await expect(savedNotice(page)).toBeVisible();
    await expect(orderHeading(page)).toHaveText(after);
  });

  test("11.7 bestilleren kobles med kontaktvelgeren og vises i «Endringer»", async ({ page }) => {
    const last = `Testesen${uniqueSuffix()}`;
    const { firmId } = await createFirmWithContact({
      firmName: `Testmegleren ${last} AS`,
      contactLastName: last,
    });
    try {
      await logIn(page);
      await createOrder(page, `Testveien 70 ${uniqueSuffix()}, 8000 Bodø`);
      await expect(page.getByRole("link", { name: "Kontakt i registeret" })).toHaveCount(0);

      await openEdit(page);
      await page.getByLabel("Søk i kontakter").fill(last);
      const hit = page
        .getByRole("list", { name: "Treff i kontakter" })
        .getByRole("button", { name: new RegExp(last) });
      await expect(hit).toHaveCount(1);
      await hit.click();
      await expect(page.getByText(`Koblet til Bestiller ${last}`)).toBeVisible();
      await saveButton(page).click();

      await expect(savedNotice(page)).toBeVisible();
      await expect(page.getByRole("link", { name: "Kontakt i registeret" })).toBeVisible();
      const latest = historyEntries(page).first();
      await expect(latest).toContainText("Endret");
      await expect(latest).toContainText(`Bestiller ${last}`);
      await expect(latest).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    } finally {
      await softDeleteFirms([firmId]);
    }
  });

  test("11.8 takstmann med innstillingen av ser ikke «Endre ordren», men ser «Endringer»", async ({
    page,
    browser,
  }) => {
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const id = await createOrder(adminPage, `Testveien 80 ${uniqueSuffix()}, 8000 Bodø`);
    await adminContext.close();

    const previous = await setInspectorsEditAll(false);
    try {
      await logInAsInspector(page);
      await page.goto(`/ordre/${id}`);
      await expect(orderHeading(page)).toContainText("Testveien 80");
      await expect(history(page)).toBeVisible();
      await expect(historyEntries(page).first()).toContainText("Opprettet");
      await expect(editButton(page)).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("11.9 ordet «Rettet» står ikke på ordresiden", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    await createOrder(page, `Testveien 90 ${suffix}, 8000 Bodø`);
    await openEdit(page);
    // Hele ord: «Opprettet» og «Borettslag» er lov, «Rett»/«Rettet» er rapportversjon 2
    await expect(page.getByRole("main")).not.toContainText(/\brett(e|et)?\b/i);
    await address(page).fill(`Testveien 91 ${suffix}, 8000 Bodø`);
    await saveButton(page).click();
    await expect(savedNotice(page)).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/\brett(e|et)?\b/i);
  });
});

test.describe("endre ordren på iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("11.10 knappene er store nok, også «Last siden på nytt»", async ({ page }) => {
    const suffix = uniqueSuffix();
    await logIn(page);
    const id = await createOrder(page, `Testveien 100 ${suffix}, 8000 Bodø`);
    await expectAtLeast(editButton(page), 44, "Endre ordren");
    await openEdit(page);
    await expectAtLeast(saveButton(page), 56, "Lagre");
    await expectAtLeast(cancelButton(page), 44, "Avbryt");

    // Konflikt for å få fram «Last siden på nytt»
    const other = await page.context().newPage();
    await other.goto(`/ordre/${id}`);
    await openEdit(other);
    await address(other).fill(`Testveien 101 ${suffix}, 8000 Bodø`);
    await saveButton(other).click();
    await expect(savedNotice(other)).toBeVisible();
    await other.close();

    await address(page).fill(`Testveien 102 ${suffix}, 8000 Bodø`);
    await saveButton(page).click();
    await expectAtLeast(reloadButton(page), 44, "Last siden på nytt");
  });

  test("11.11 og 11.13 i stående: ingen vannrett rulling, og «Endringer» med lange verdier kan leses", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    const suffix = uniqueSuffix();
    const long = `Testveienmedetsværtlangtnavnutenmellomromforåprøvelinjebrytingen${suffix}`;
    await logIn(page);
    await createOrder(page, `${long} 1, 8000 Bodø`);

    await openEdit(page);
    await expectNoHorizontalScroll(page, "med skjemaet åpent");
    await address(page).fill(`${long} 2, 8000 Bodø ${"og en lang tilleggstekst ".repeat(6)}`);
    await saveButton(page).click();
    await expect(savedNotice(page)).toBeVisible();
    await expectNoHorizontalScroll(page, "med lange verdier i «Endringer»");

    const width = page.viewportSize()!.width;
    const lines = history(page).locator("li");
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const box = await lines.nth(index).boundingBox();
      expect(box, "linjen er synlig").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, "linjen er innenfor skjermen").toBeLessThanOrEqual(width);
    }
    // Ingen tekst kuttes: ingen linje er bredere enn plassen den har
    const clipped = await history(page)
      .locator("li")
      .evaluateAll((items) => items.filter((item) => item.scrollWidth > item.clientWidth).length);
    expect(clipped).toBe(0);
    await expect(historyEntries(page).first()).toContainText(`${long} 2`);
  });

  test("11.12 «Lagre» og «Avbryt» står i skjemaet, ikke i en fast bunnlinje", async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    await createOrder(page, `Testveien 120 ${uniqueSuffix()}, 8000 Bodø`);
    await openEdit(page);

    for (const button of [saveButton(page), cancelButton(page)]) {
      const fixed = await button.evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const position = getComputedStyle(node).position;
          if (position === "fixed" || position === "sticky") return true;
        }
        return false;
      });
      expect(fixed, "knappen står ikke fast").toBe(false);
      const inForm = await button.evaluate((element) => element.closest("form") !== null);
      expect(inForm, "knappen står i skjemaet").toBe(true);
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await saveButton(page).scrollIntoViewIfNeeded();
    await expect(saveButton(page)).toBeInViewport();
    await expect(cancelButton(page)).toBeInViewport();
  });

  test("11.14 skjemaet fylles ut og lagres med tastaturet alene", async ({ page }) => {
    const after = `Tastaturveien 2 ${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await createOrder(page, `Tastaturveien 1 ${uniqueSuffix()}, 8000 Bodø`);

    async function tabTo(target: Locator) {
      for (let i = 0; i < 60; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      await expect(target).toBeFocused();
    }

    await tabTo(editButton(page));
    await page.keyboard.press("Enter");
    await expect(editHeading(page)).toBeFocused();
    await tabTo(address(page));
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(after);
    await page.keyboard.press("Enter");

    await expect(savedNotice(page)).toBeVisible();
    await expect(orderHeading(page)).toHaveText(after);
  });
});
