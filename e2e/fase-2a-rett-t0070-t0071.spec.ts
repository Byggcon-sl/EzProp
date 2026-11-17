import postgres from "postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  createAssignmentWithParty,
  e2eDatabaseUrl,
  INSPECTOR_EMAIL,
  logInAsInspector,
  logInFromCurrentPage,
  logInInDialog,
  logInInDialogWithKeyboard,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  signInDialog,
  uniqueSuffix,
} from "./helpers";

/*
 * Rett T-0070 og T-0071: utløpt innlogging og nettbrudd under lagring sletter ikke det som er
 * skrevet. Testplan: docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 2 (E1–E13).
 * Kjører i prosjektene pc og ipad.
 *
 * - Takstmannen fra e2e logger inn (`logInAsInspector`); hver test lager sitt eget oppdrag med
 *   `uniqueSuffix()`, fordi e2e-databasen ikke tømmes. Innstillingen
 *   `access.inspectors_edit_all` settes på og tilbake i hver test.
 * - «Utløpt innlogging»: `page.context().clearCookies()` etter at skjemaet er fylt ut.
 * - «Uten nett»: `page.context().setOffline(true)`.
 * - «Ikke lastet på nytt»: `window.__marker = 1` før Lagre, og den finnes etterpå.
 * - «Ingenting lagret» sjekkes i databasen.
 *
 * Testdata er oppdiktet («Oppdiktet sted», «Anneks test», «Oppdiktet Navn»).
 *
 * Støtter hovedmål: de ansatte (ingenting skrives på nytt, innlogging i dialog, norske meldinger)
 * og færre reklamasjoner (mindre ny skriving gir færre glemte opplysninger).
 */

const SIGNED_OUT = "Du er logget ut. Logg inn igjen.";
const SIGNED_OUT_ON_FOCUS = "Du er logget ut. Logg inn før du lagrer.";
const SIGNED_IN_AGAIN = "Du er logget inn igjen. Trykk Lagre.";
const OFFLINE = "Du er uten nett. Endringen er ikke lagret.";
const BACK_ONLINE = "Nettet er tilbake. Trykk Lagre.";
const ENGLISH_ERRORS =
  /Application error|client-side exception|Something went wrong|This page couldn.t load/i;

const CITY = "Oppdiktet sted";
const NEW_BUILDING = "Anneks test";

// --- Database (bare lokal database eller testdatabasen) ---

function dbSql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Eiendommen på oppdraget (ikke slettet), eller `null`. */
async function propertyOf(
  assignmentId: string,
): Promise<{ city: string | null; housing_type: string; updated_at: Date } | null> {
  const sql = dbSql();
  try {
    const [row] = await sql<{ city: string | null; housing_type: string; updated_at: Date }[]>`
      select p.city, p.housing_type, p.updated_at from assignments a
      join properties p on p.id = a.property_id and p.organization_id = a.organization_id
      where a.id = ${assignmentId} and p.deleted_at is null`;
    return row ?? null;
  } finally {
    await sql.end();
  }
}

/** Bygningene på oppdraget som ikke er slettet. */
async function buildingNames(assignmentId: string): Promise<string[]> {
  const sql = dbSql();
  try {
    const rows = await sql<{ name: string }[]>`
      select name from report_buildings
      where assignment_id = ${assignmentId} and deleted_at is null order by name`;
    return rows.map((row) => row.name);
  } finally {
    await sql.end();
  }
}

/** Antall rom (ikke slettet) på oppdraget. */
async function roomCount(assignmentId: string): Promise<number> {
  const sql = dbSql();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from rooms r
      join floors f on f.id = r.floor_id
      join report_buildings b on b.id = f.report_building_id
      where b.assignment_id = ${assignmentId} and r.deleted_at is null
        and f.deleted_at is null and b.deleted_at is null`;
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
}

// --- Siden ---

function region(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}

function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

function signInLink(scope: Page | Locator): Locator {
  return scope.getByRole("link", { name: "Logg inn", exact: true });
}

function alertWith(scope: Page | Locator, text: string): Locator {
  return scope.getByRole("alert").filter({ hasText: text });
}

/** Trykk og vent på svaret fra server-handlingen (POST med «next-action»). */
async function clickAndWaitForSave(page: Page, target: Locator) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await target.click();
  const response = await saved;
  expect(response.status(), "lagringen gir ikke 500").toBeLessThan(500);
}

async function setMarker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __marker?: number }).__marker = 1;
  });
}

async function expectNotReloaded(page: Page) {
  const marker = await page.evaluate(() => (window as unknown as { __marker?: number }).__marker);
  expect(marker, "siden er ikke lastet på nytt").toBe(1);
}

async function expectNoEnglishErrorPage(page: Page) {
  await expect(page.locator("body")).not.toContainText(ENGLISH_ERRORS);
}

/** Innstillingen på for testen, og tilbake etterpå. */
let previousEditAll: boolean | undefined;
test.beforeEach(async () => {
  previousEditAll = await setInspectorsEditAll(true);
});
test.afterEach(async ({ page }) => {
  await page.context().setOffline(false);
  await restoreInspectorsEditAll(previousEditAll);
});

/** Eget oppdrag, takstmannen logget inn, og oppdragssiden åpen. */
async function openNewAssignment(page: Page): Promise<string> {
  const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
  await logInAsInspector(page);
  await page.goto(`/oppdrag/${assignmentId}`);
  await expect(region(page, "Eiendom")).toBeVisible();
  return assignmentId;
}

/** Fyller ut eiendomsskjemaet (uten å lagre). */
async function fillProperty(page: Page) {
  const property = region(page, "Eiendom");
  await property.getByLabel(/^Postnummer/).fill("8000");
  await property.getByLabel(/^Poststed/).fill(CITY);
  await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
}

async function expectPropertyValues(page: Page) {
  const property = region(page, "Eiendom");
  await expect(property.getByLabel(/^Postnummer/)).toHaveValue("8000");
  await expect(property.getByLabel(/^Poststed/)).toHaveValue(CITY);
  await expect(property.getByLabel(/^Boligtype/).locator("option:checked")).toHaveText("Enebolig");
  await expect(property.getByLabel(/^Eierform/).locator("option:checked")).toHaveText("Selveier");
}

function saveProperty(page: Page): Locator {
  return button(region(page, "Eiendom"), "Lagre eiendom");
}

/** Lagrer eiendommen med nett (forutsetning for bygningene) og går til bygningssiden. */
async function propertySavedAndBuildingsOpen(page: Page, assignmentId: string) {
  await fillProperty(page);
  await clickAndWaitForSave(page, saveProperty(page));
  await expect.poll(() => propertyOf(assignmentId)).not.toBeNull();
  await page.goto(`/oppdrag/${assignmentId}/bygninger`);
  await expect(button(page, "Legg til bygning")).toBeVisible();
}

/** Bygning og etasje lagt til med nett. */
async function buildingWithFloor(page: Page) {
  await button(page, "Legg til bygning").click();
  await page.getByLabel(/^Navn/).last().fill("Bolighus");
  await clickAndWaitForSave(page, button(page, "Lagre").last());
  const building = region(page, "Bolighus");
  await expect(building).toBeVisible();
  await button(building, "Legg til etasje").click();
  await building
    .getByLabel(/^(Navn|Etasje(?!nummer))/)
    .last()
    .fill("1. etasje");
  await building
    .getByLabel(/^(Etasjenummer|Nivå)/)
    .last()
    .fill("1");
  await clickAndWaitForSave(page, button(building, "Lagre").last());
  await expect(region(building, "1. etasje")).toBeVisible();
}

/** Åpner «Legg til flere rom» og setter tellerne: 2 soverom og 1 bad. */
async function openAddRoomsWithCounts(page: Page): Promise<Locator> {
  await region(region(page, "Bolighus"), "1. etasje").getByTestId("add-rooms-open").click();
  const dialog = page.getByTestId("add-rooms-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("tile-bedroom").click();
  await dialog.getByTestId("tile-bedroom").click();
  await dialog.getByTestId("tile-bathroom").click();
  await expectCounts(dialog);
  return dialog;
}

async function expectCounts(dialog: Locator) {
  await expect(dialog.getByTestId("tile-count-bedroom")).toHaveText("2");
  await expect(dialog.getByTestId("tile-count-bathroom")).toHaveText("1");
  await expect(dialog.getByTestId("add-rooms-submit")).toContainText("3 rom");
}

test.describe("rett T-0070: utløpt innlogging (pc og ipad)", () => {
  test("E1 og E2 «Lagre eiendom»: verdiene står, «Logg inn» åpner dialogen, og Lagre lagrer uten ny lasting", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await fillProperty(page);
    await page.context().clearCookies();
    await setMarker(page);

    // E1
    await clickAndWaitForSave(page, saveProperty(page));
    await expect(alertWith(page, SIGNED_OUT)).toBeVisible();
    const link = signInLink(region(page, "Eiendom"));
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/logg-inn?neste=%2Foppdrag%2F${assignmentId}`);
    await expectPropertyValues(page);
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}$`));
    expect(await propertyOf(assignmentId), "eiendommen er ikke lagret").toBeNull();
    await expectNotReloaded(page);

    // E2
    await link.click();
    const dialog = signInDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("E-postadresse")).toHaveValue(INSPECTOR_EMAIL);
    await expect(dialog).not.toContainText("Microsoft");
    await logInInDialog(page);
    await expect(dialog).toBeHidden();
    await expectPropertyValues(page);
    await expect(saveProperty(page)).toBeFocused();
    await expect(page.getByText(SIGNED_IN_AGAIN)).toBeVisible();
    expect(await propertyOf(assignmentId), "ingenting lagres av seg selv").toBeNull();
    await expectNotReloaded(page);

    await clickAndWaitForSave(page, saveProperty(page));
    await expect.poll(async () => (await propertyOf(assignmentId))?.city).toBe(CITY);
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
    await expectNotReloaded(page);
  });

  test("E3 «Legg til flere rom»: dialog, tellere og valg står; ingen rom før ny innlogging og Lagre", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await propertySavedAndBuildingsOpen(page, assignmentId);
    await buildingWithFloor(page);
    const dialog = await openAddRoomsWithCounts(page);
    const roomsBefore = await roomCount(assignmentId);
    await page.context().clearCookies();
    await setMarker(page);

    await clickAndWaitForSave(page, dialog.getByTestId("add-rooms-submit"));
    await expect(dialog).toBeVisible();
    await expectCounts(dialog);
    await expect(alertWith(page, SIGNED_OUT)).toBeVisible();
    await expect(signInLink(page).first()).toBeVisible();
    expect(await roomCount(assignmentId), "ingen rom er lagt til").toBe(roomsBefore);

    await signInLink(page).first().click();
    await logInInDialog(page);
    await expect(dialog).toBeVisible();
    await expectCounts(dialog);
    await clickAndWaitForSave(page, dialog.getByTestId("add-rooms-submit"));
    await expect.poll(() => roomCount(assignmentId)).toBe(roomsBefore + 3);
    await expectNotReloaded(page);
  });

  test("E4 bygninger: navnet står, og etter innlogging i dialogen lagres bygningen uten ny lasting", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await propertySavedAndBuildingsOpen(page, assignmentId);
    await button(page, "Legg til bygning").click();
    const name = page.getByLabel(/^Navn/).last();
    await name.fill(NEW_BUILDING);
    await page.context().clearCookies();
    await setMarker(page);

    await clickAndWaitForSave(page, button(page, "Lagre").last());
    await expect(alertWith(page, SIGNED_OUT)).toBeVisible();
    await expect(signInLink(page).first()).toHaveAttribute(
      "href",
      `/logg-inn?neste=%2Foppdrag%2F${assignmentId}%2Fbygninger`,
    );
    await expect(page.getByLabel(/^Navn/).last()).toHaveValue(NEW_BUILDING);
    expect(await buildingNames(assignmentId)).toEqual([]);

    await signInLink(page).first().click();
    await logInInDialog(page);
    await expect(page.getByLabel(/^Navn/).last()).toHaveValue(NEW_BUILDING);
    await clickAndWaitForSave(page, button(page, "Lagre").last());
    await expect.poll(() => buildingNames(assignmentId)).toEqual([NEW_BUILDING]);
    await expect(region(page, NEW_BUILDING)).toBeVisible();
    await expectNotReloaded(page);
  });

  test("E11 tastatur og skjermleser: «Logg inn» nås med Tab, dialogen får fokus, Esc lukker og fokus går tilbake til Lagre", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await fillProperty(page);
    await page.context().clearCookies();
    await clickAndWaitForSave(page, saveProperty(page));
    await expect(alertWith(page, SIGNED_OUT)).toBeVisible();

    // Tab fra Lagre (fram eller tilbake) til «Logg inn»
    const link = signInLink(region(page, "Eiendom"));
    await saveProperty(page).focus();
    let reached = false;
    for (const key of ["Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      if (await link.evaluate((element) => element === document.activeElement)) {
        reached = true;
        break;
      }
    }
    if (!reached) {
      await saveProperty(page).focus();
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await link.evaluate((element) => element === document.activeElement);
      }
    }
    expect(reached, "«Logg inn» nås med tastaturet").toBe(true);

    // Runde 1: Enter åpner, fokus er i dialogen, Esc lukker, fokus tilbake på Lagre
    await page.keyboard.press("Enter");
    const dialog = signInDialog(page);
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await expect(dialog.getByRole("heading").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(saveProperty(page)).toBeFocused();
    await expectPropertyValues(page);

    // Runde 2: åpne med tastaturet og logg inn bare med tastaturet
    await link.focus();
    await page.keyboard.press("Enter");
    await logInInDialogWithKeyboard(page);
    await expect(saveProperty(page)).toBeFocused();
    await expect(page.getByText(SIGNED_IN_AGAIN)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await propertyOf(assignmentId))?.city).toBe(CITY);
  });

  test("E12 utlogget ved fokus: «Du er logget ut. Logg inn før du lagrer.» med «Logg inn», og skjemaet er urørt", async ({
    page,
  }) => {
    const assignmentId = await openNewAssignment(page);
    await fillProperty(page);
    await page.context().clearCookies();

    await page.evaluate(() => {
      const set = (state: "hidden" | "visible") => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => state === "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      set("hidden");
      set("visible");
    });

    await expect(page.getByText(SIGNED_OUT_ON_FOCUS)).toBeVisible();
    await expect(signInLink(page).first()).toBeVisible();
    await expectPropertyValues(page);
    expect(await propertyOf(assignmentId)).toBeNull();
  });
});

test.describe("rett T-0071: uten nett under lagring (pc og ipad)", () => {
  test("E5 «Lagre eiendom»: norsk melding, verdiene står, ingenting lagres før Lagre når nettet er tilbake", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await fillProperty(page);
    await setMarker(page);
    await page.context().setOffline(true);

    await saveProperty(page).click();
    await expect(alertWith(page, OFFLINE)).toBeVisible();
    await expectPropertyValues(page);
    await expectNoEnglishErrorPage(page);
    expect(await propertyOf(assignmentId)).toBeNull();

    await page.context().setOffline(false);
    await expect(page.getByText(BACK_ONLINE)).toBeVisible();
    // Ingenting lagres av seg selv
    await page.waitForTimeout(1000);
    expect(await propertyOf(assignmentId)).toBeNull();

    await clickAndWaitForSave(page, saveProperty(page));
    await expect.poll(async () => (await propertyOf(assignmentId))?.city).toBe(CITY);
    await expectNotReloaded(page);
  });

  test("E6 «Legg til flere rom»: melding, dialog og tellere står; ingen rom før Lagre med nett", async ({
    page,
  }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await propertySavedAndBuildingsOpen(page, assignmentId);
    await buildingWithFloor(page);
    const dialog = await openAddRoomsWithCounts(page);
    const roomsBefore = await roomCount(assignmentId);
    await page.context().setOffline(true);

    await dialog.getByTestId("add-rooms-submit").click();
    await expect(alertWith(page, OFFLINE)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expectCounts(dialog);
    await expectNoEnglishErrorPage(page);
    expect(await roomCount(assignmentId)).toBe(roomsBefore);

    await page.context().setOffline(false);
    await expect(page.getByText(BACK_ONLINE)).toBeVisible();
    expect(await roomCount(assignmentId)).toBe(roomsBefore);
    await clickAndWaitForSave(page, dialog.getByTestId("add-rooms-submit"));
    await expect.poll(() => roomCount(assignmentId)).toBe(roomsBefore + 3);
  });

  test("E7 bygninger: melding, skjemaet står, og databasen er uendret", async ({ page }) => {
    test.slow();
    const assignmentId = await openNewAssignment(page);
    await propertySavedAndBuildingsOpen(page, assignmentId);
    await button(page, "Legg til bygning").click();
    await page.getByLabel(/^Navn/).last().fill(NEW_BUILDING);
    await page.context().setOffline(true);

    await button(page, "Lagre").last().click();
    await expect(alertWith(page, OFFLINE)).toBeVisible();
    await expect(page.getByLabel(/^Navn/).last()).toHaveValue(NEW_BUILDING);
    await expectNoEnglishErrorPage(page);
    expect(await buildingNames(assignmentId)).toEqual([]);

    await page.context().setOffline(false);
    await expect(page.getByText(BACK_ONLINE)).toBeVisible();
    await clickAndWaitForSave(page, button(page, "Lagre").last());
    await expect.poll(() => buildingNames(assignmentId)).toEqual([NEW_BUILDING]);
  });
});

test.describe("rett T-0070: sidevisning uten innlogging (pc og ipad)", () => {
  test("E8 bygningssiden uten innlogging sender til /logg-inn?neste=… og tilbake etter innlogging", async ({
    page,
  }) => {
    const assignmentId = await openNewAssignment(page);
    await page.context().clearCookies();
    await page.goto(`/oppdrag/${assignmentId}/bygninger`);
    await expect(page).toHaveURL(
      new RegExp(`/logg-inn\\?neste=%2Foppdrag%2F${assignmentId}%2Fbygninger$`),
    );
    await logInFromCurrentPage(page, INSPECTOR_EMAIL);
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}/bygninger$`));
  });

  test("E9 ingen persondata i neste: søket i arbeidskøen kommer ikke med", async ({ page }) => {
    await logInAsInspector(page);
    await page.context().clearCookies();
    await page.goto("/arbeidskoe?q=Oppdiktet%20Navn");
    await expect(page).toHaveURL(/\/logg-inn/);
    const url = page.url();
    expect(url).not.toContain("q=");
    expect(url).not.toContain("q%3D");
    expect(url).not.toContain("Oppdiktet");
    expect(url).not.toContain("Navn");
  });

  for (const next of ["//evil.example", "/%5Cevil.example", "/api/auth/get-session"]) {
    test(`E10 åpen videresending: neste=${next} ender i arbeidskøen`, async ({ page }) => {
      await logInAsInspector(page);
      await page.context().clearCookies();
      await page.goto(`/logg-inn?neste=${next}`);
      await logInFromCurrentPage(page, INSPECTOR_EMAIL);
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/arbeidskoe$/);
      expect(page.url()).not.toContain("evil");
    });
  }
});

test.describe("rett T-0071: norsk feilside (pc og ipad)", () => {
  test("E13 en feil under lagring gir norsk feilside med «Prøv igjen» og lenke til arbeidskøen", async ({
    page,
  }) => {
    test.slow();
    await openNewAssignment(page);
    await fillProperty(page);

    // Serveren svarer 500 på server-handlingen (ikke nettbrudd og ikke «logget ut»)
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
        await route.fulfill({ status: 500, contentType: "text/plain", body: "feil i test" });
        return;
      }
      await route.continue();
    });
    await saveProperty(page).click();

    const retry = button(page, "Prøv igjen");
    await expect(retry).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('main a[href="/arbeidskoe"]')).toBeVisible();
    await expectNoEnglishErrorPage(page);
    await expect(page.locator("body")).not.toContainText("feil i test");
    await expect(page.locator("html")).toHaveAttribute("lang", "nb");
    const box = await retry.boundingBox();
    expect(box!.height, "«Prøv igjen» er minst 44 px høy").toBeGreaterThanOrEqual(44);

    await page.unroute("**/*");
    await retry.click();
    await expect(region(page, "Eiendom")).toBeVisible();
  });
});
