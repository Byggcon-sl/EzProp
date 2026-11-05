import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  employeeByEmail,
  logIn,
  logInAsInspector,
  uniqueSuffix,
} from "./helpers";

/*
 * Bygninger, etasjer, areal per etasje og rom på oppdraget (fase 2a).
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 7.
 * Kjører i prosjektene pc og ipad. iPad-sjekken (7.9) bare i ipad; tastaturtesten (7.10) i begge.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre, sitt eget
 * oppdrag og sin egen eiendom (unik ending i adressen), fordi e2e-databasen ikke tømmes.
 * Testdata er oppdiktet: «Testveien 1 <ending>», «Bolighus», «Garasje test», «Kjeller»,
 * «1. etasje», arealene 56,7 og 123,4.
 * Ingen e2e uten nett: bygninger, areal og rom føres for hånd på PC.
 *
 * Etikettene og knappene er fra kortet punkt 8: lenken «Bygninger, areal og rom», knappene
 * «Legg til bygning», «Legg til etasje», «Legg til rom», «Lagre areal», «Fjern» og «Lagre», og
 * feltene «Romtype», «Arealtype», «Under terreng», «Målt av», «Metode», «BRA-i», «BRA-e»,
 * «BRA-b» og «ALH». Kortet låser ikke resten, så testen antar:
 * - hver bygning og hver etasje er en blokk (section, article, li, fieldset eller region) med
 *   navnet som overskrift; etasjene står inne i bygningens blokk;
 * - «Legg til …» åpner et tomt skjema sist i blokken (eller er selve skjemaet); feltet for navnet
 *   heter «Navn» (bygning, etasje og rom), etasjenummeret «Etasjenummer» eller «Nivå»; skjemaet
 *   sendes med «Lagre» (eller med «Legg til …» når det ikke finnes egen «Lagre»).
 * Avviker siden, rettes hjelperne under (`block`, `addBuilding`, `addFloor`, `addRoom`).
 *
 * Støtter hovedmål: tid (forslag til arealtype og «under terreng», «Målt av» forhåndsvalgt, sum
 * BRA uten regning, virker på iPad og med tastatur) og reklamasjoner (måler og metode lagres,
 * ikke-tomme rader kan ikke fjernes, takstmann uten skriverett kan ikke endre).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const BUILDINGS_URL = new RegExp(`/oppdrag/(${UUID})/bygninger$`);
const NUMBER = /\d{4}-\d{5}/;

const LINK = "Bygninger, areal og rom";
const NO_PROPERTY = "Legg inn eiendommen først.";
const AREA_ERROR = "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.";
const FLOOR_NOT_EMPTY = "Fjern rommene først.";
const HOUSE = "Bolighus";
const BASEMENT = "Kjeller";
const FIRST_FLOOR = "1. etasje";

const NAME_LABEL = /^Navn/;
const LEVEL_LABEL = /^(Etasjenummer|Nivå)/;
const COMMENT_LABEL = /^Kommentar/;

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

/** Tall slik siden kan vise dem: «56,7» eller «56.7». */
function decimal(value: string): RegExp {
  return new RegExp(`^${value.replace(/[,.]/, "[,.]")}$`);
}

/**
 * Blokken for en bygning eller etasje: den innerste delen (section, article, li, fieldset eller
 * region) som har navnet som overskrift.
 */
function block(scope: Page | Locator, name: string): Locator {
  return scope
    .locator(":is(section, article, li, fieldset, [role=region], [role=group])")
    .filter({ has: scope.getByRole("heading", { name, exact: true }) })
    .last();
}

/** Trykk knappen og vent på svaret fra server-handlingen (POST med «next-action»). */
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
 * Trykker «Legg til …» i blokken, slik at det nye skjemaet står sist, og gir funksjonen som
 * sender det: «Lagre» når den finnes, ellers «Legg til …».
 */
async function openAddForm(page: Page, scope: Locator | Page, addLabel: string, field: Locator) {
  const addButton = scope.getByRole("button", { name: addLabel, exact: true }).last();
  await addButton.click();
  await expect(field.last()).toBeVisible();
  return async () => {
    const save = scope.getByRole("button", { name: "Lagre", exact: true });
    const target = (await save.count()) > 0 ? save.last() : addButton;
    await clickAndWaitForSave(page, target);
  };
}

/** Ny ordre med adresse → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. */
async function newAssignment(page: Page): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 1 ${uniqueSuffix()}`);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);

  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");

  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

/** Oppdrag med lagret eiendom (enebolig, selveier, gnr/bnr 999). Står på oppdragssiden etterpå. */
async function newAssignmentWithProperty(page: Page): Promise<string> {
  const assignmentId = await newAssignment(page);
  const property = page.getByRole("region", { name: "Eiendom", exact: true });
  await property.getByLabel(/^Gårdsnummer/).fill("999");
  await property.getByLabel(/^Bruksnummer/).fill("999");
  await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
  await clickAndWaitForSave(
    page,
    property.getByRole("button", { name: "Lagre eiendom", exact: true }),
  );
  await expect(property.getByLabel(/^Boligtype/).locator("option:checked")).toHaveText("Enebolig");
  return assignmentId;
}

/** Fra oppdragssiden via lenken «Bygninger, areal og rom». */
async function openBuildingsPage(page: Page) {
  await page.getByRole("link", { name: LINK, exact: true }).click();
  await expect(page).toHaveURL(BUILDINGS_URL);
}

async function addBuilding(page: Page, name: string) {
  const main = page.getByRole("main");
  const submit = await openAddForm(page, main, "Legg til bygning", main.getByLabel(NAME_LABEL));
  await main.getByLabel(NAME_LABEL).last().fill(name);
  await submit();
  await expect(main.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function addFloor(
  page: Page,
  building: string,
  floor: { name: string; level: string; belowGround: boolean },
) {
  const scope = block(page, building);
  const submit = await openAddForm(page, scope, "Legg til etasje", scope.getByLabel(LEVEL_LABEL));
  await scope.getByLabel(NAME_LABEL).last().fill(floor.name);
  await scope.getByLabel(LEVEL_LABEL).last().fill(floor.level);
  await scope
    .getByLabel(/^Under terreng/)
    .last()
    .setChecked(floor.belowGround);
  await submit();
  await expect(scope.getByRole("heading", { name: floor.name, exact: true })).toBeVisible();
}

/** Velger romtypen og gir feltene for arealtype og «under terreng» i det nye skjemaet. */
async function startRoom(page: Page, floor: string, roomType: string) {
  const scope = block(page, floor);
  const submit = await openAddForm(page, scope, "Legg til rom", scope.getByLabel(/^Romtype/));
  await scope
    .getByLabel(/^Romtype/)
    .last()
    .selectOption({ label: roomType });
  return {
    scope,
    submit,
    areaType: scope.getByLabel(/^Arealtype/).last(),
    belowGround: scope.getByLabel(/^Under terreng/).last(),
  };
}

async function fillArea(
  page: Page,
  floor: string,
  values: { braI: string; method?: string; comment?: string },
) {
  const scope = block(page, floor);
  await scope.getByLabel("BRA-i", { exact: true }).fill(values.braI);
  if (values.method) {
    await scope.getByLabel(/^Metode/).selectOption({ label: values.method });
  }
  if (values.comment) await scope.getByLabel(COMMENT_LABEL).fill(values.comment);
  return scope;
}

async function saveArea(page: Page, floor: string) {
  await clickAndWaitForSave(
    page,
    block(page, floor).getByRole("button", { name: "Lagre areal", exact: true }),
  );
}

/** Bygning «Bolighus» med «1. etasje» (123,4) og «Kjeller» (56,7, under terreng), lagt til i den rekkefølgen. */
async function buildHouse(page: Page) {
  await addBuilding(page, HOUSE);
  await addFloor(page, HOUSE, { name: FIRST_FLOOR, level: "1", belowGround: false });
  await addFloor(page, HOUSE, { name: BASEMENT, level: "-1", belowGround: true });
  await fillArea(page, BASEMENT, { braI: "56,7", method: "Oppmålt med laser" });
  await saveArea(page, BASEMENT);
  await fillArea(page, FIRST_FLOOR, { braI: "123,4", method: "Oppmålt med laser" });
  await saveArea(page, FIRST_FLOOR);
}

// --- Innstillingen access.inspectors_edit_all i e2e-databasen (7.7) ---

const SETTING = "access.inspectors_edit_all";

function e2eSql() {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  return postgres(databaseUrl, { max: 1, onnotice: () => {} });
}

/** Setter innstillingen for organisasjonen til admin fra seed. Gir den gamle verdien tilbake. */
async function setInspectorsEditAll(value: boolean): Promise<{ had: boolean; old: unknown }> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; settings: Record<string, unknown> | null }[]>`
      select o.id, o.settings from organizations o
      where o.id = (
        select e.organization_id from employees e join users u on u.id = e.user_id
        where u.email = ${ADMIN_EMAIL} and e.deleted_at is null limit 1)`;
    if (!row) throw new Error("Fant ikke organisasjonen til admin fra seed (kjør pnpm db:seed)");
    const settings = row.settings ?? {};
    const had = Object.prototype.hasOwnProperty.call(settings, SETTING);
    await sql`
      update organizations set settings = ${sql.json({ ...settings, [SETTING]: value })}
      where id = ${row.id}`;
    return { had, old: settings[SETTING] };
  } finally {
    await sql.end();
  }
}

/** Setter innstillingen tilbake slik den var (fjerner nøkkelen når den ikke fantes). */
async function restoreInspectorsEditAll(previous: { had: boolean; old: unknown }) {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ id: string; settings: Record<string, unknown> | null }[]>`
      select o.id, o.settings from organizations o
      where o.id = (
        select e.organization_id from employees e join users u on u.id = e.user_id
        where u.email = ${ADMIN_EMAIL} and e.deleted_at is null limit 1)`;
    if (!row) return;
    const settings = { ...(row.settings ?? {}) };
    if (previous.had) settings[SETTING] = previous.old;
    else delete settings[SETTING];
    await sql`update organizations set settings = ${sql.json(settings as never)} where id = ${row.id}`;
  } finally {
    await sql.end();
  }
}

test.describe("bygninger, areal og rom (pc og ipad)", () => {
  test("7.1–7.2 hovedflyt: bygning, to etasjer, areal, rom med forslag; sum BRA 180,1; verdiene står etter ny lasting", async ({
    page,
  }) => {
    await logIn(page);
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await newAssignmentWithProperty(page);
    await openBuildingsPage(page);

    await addBuilding(page, HOUSE);
    await addFloor(page, HOUSE, { name: FIRST_FLOOR, level: "1", belowGround: false });
    await addFloor(page, HOUSE, { name: BASEMENT, level: "-1", belowGround: true });

    // Areal på begge; «Målt av» er forhåndsvalgt med den innloggede
    for (const [floor, braI] of [
      [BASEMENT, "56,7"],
      [FIRST_FLOOR, "123,4"],
    ] as const) {
      const scope = await fillArea(page, floor, { braI, method: "Oppmålt med laser" });
      await expect(scope.getByLabel(/^Målt av/).locator("option:checked")).toHaveText(admin.name);
      await saveArea(page, floor);
    }

    // Bad i 1. etasje: BRA-i, ikke under terreng
    const bath = await startRoom(page, FIRST_FLOOR, "Bad");
    await expect(bath.areaType.locator("option:checked")).toHaveText("BRA-i");
    await expect(bath.belowGround).not.toBeChecked();
    await bath.submit();

    // Kjellerstue i kjelleren: under terreng forhåndsvalgt
    const living = await startRoom(page, BASEMENT, "Kjellerstue");
    await expect(living.belowGround).toBeChecked();
    await living.submit();

    // Sum BRA per etasje, bygning og totalt
    await expect(block(page, BASEMENT)).toContainText(/56,7/);
    await expect(block(page, FIRST_FLOOR)).toContainText(/123,4/);
    await expect(block(page, HOUSE)).toContainText(/180,1/);
    expect(await page.getByRole("main").getByText(/180,1/).count()).toBeGreaterThanOrEqual(2);

    // 7.2 Kjelleren står over 1. etasje, selv om den ble lagt til sist
    const basementBox = await block(page, BASEMENT).boundingBox();
    const firstBox = await block(page, FIRST_FLOOR).boundingBox();
    expect(basementBox && firstBox, "begge etasjene er synlige").toBeTruthy();
    expect(basementBox!.y).toBeLessThan(firstBox!.y);

    // Last på nytt: alt står
    await page.reload();
    await expect(page.getByRole("heading", { name: HOUSE, exact: true })).toBeVisible();
    await expect(block(page, BASEMENT).getByLabel("BRA-i", { exact: true })).toHaveValue(
      decimal("56,7"),
    );
    await expect(block(page, FIRST_FLOOR).getByLabel("BRA-i", { exact: true })).toHaveValue(
      decimal("123,4"),
    );
    await expect(
      block(page, BASEMENT)
        .getByLabel(/^Metode/)
        .locator("option:checked"),
    ).toHaveText("Oppmålt med laser");
    await expect(
      block(page, BASEMENT)
        .getByLabel(/^Målt av/)
        .locator("option:checked"),
    ).toHaveText(admin.name);
    const rooms = page.getByLabel(/^Romtype/);
    await expect(
      block(page, FIRST_FLOOR)
        .getByLabel(/^Romtype/)
        .first()
        .locator("option:checked"),
    ).toHaveText("Bad");
    await expect(
      block(page, BASEMENT)
        .getByLabel(/^Romtype/)
        .first()
        .locator("option:checked"),
    ).toHaveText("Kjellerstue");
    await expect(
      block(page, BASEMENT)
        .getByLabel(/^Under terreng/)
        .first(),
    ).toBeChecked();
    expect(await rooms.count()).toBeGreaterThanOrEqual(2);
    await expect(block(page, HOUSE)).toContainText(/180,1/);
  });

  test("7.3 forslaget kan endres: «Garasje» gir BRA-e, byttes til BRA-i før lagring, og BRA-i lagres", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildingsPage(page);
    await addBuilding(page, HOUSE);
    await addFloor(page, HOUSE, { name: FIRST_FLOOR, level: "1", belowGround: false });

    const garage = await startRoom(page, FIRST_FLOOR, "Garasje");
    await expect(garage.areaType.locator("option:checked")).toHaveText("BRA-e");
    await garage.areaType.selectOption({ label: "BRA-i" });
    await garage.submit();

    await page.reload();
    const saved = block(page, FIRST_FLOOR)
      .getByLabel(/^Arealtype/)
      .first();
    await expect(saved.locator("option:checked")).toHaveText("BRA-i");
    await expect(
      block(page, FIRST_FLOOR)
        .getByLabel(/^Romtype/)
        .first()
        .locator("option:checked"),
    ).toHaveText("Garasje");
  });

  test("7.4 fjerning: etasje med rom gir «Fjern rommene først.»; rommet og så etasjen kan fjernes", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildingsPage(page);
    await addBuilding(page, HOUSE);
    await addFloor(page, HOUSE, { name: BASEMENT, level: "-1", belowGround: true });
    const room = await startRoom(page, BASEMENT, "Kryperom");
    await room.submit();

    const floor = block(page, BASEMENT);
    // Første «Fjern» i etasjeblokken hører til etasjen (overskriften står først)
    await clickAndWaitForSave(
      page,
      floor.getByRole("button", { name: "Fjern", exact: true }).first(),
    );
    await expect(page.getByText(FLOOR_NOT_EMPTY)).toBeVisible();
    await expect(page.getByRole("heading", { name: BASEMENT, exact: true })).toBeVisible();

    // Fjern rommet (siste «Fjern» i blokken), så etasjen
    await clickAndWaitForSave(
      page,
      floor.getByRole("button", { name: "Fjern", exact: true }).last(),
    );
    await expect(floor.getByLabel(/^Romtype/)).toHaveCount(0);
    await clickAndWaitForSave(
      page,
      floor.getByRole("button", { name: "Fjern", exact: true }).first(),
    );
    await expect(page.getByRole("heading", { name: BASEMENT, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: BASEMENT, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: HOUSE, exact: true })).toBeVisible();
  });

  test("7.5 oppdrag uten eiendom viser «Legg inn eiendommen først.» og ingen «Legg til bygning»", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await openBuildingsPage(page);

    await expect(page.getByText(NO_PROPERTY)).toBeVisible();
    await expect(page.getByRole("button", { name: "Legg til bygning", exact: true })).toHaveCount(
      0,
    );
  });

  test("7.6 areal 12,34 gir feilmeldingen ved feltet, og ingenting lagres", async ({ page }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildingsPage(page);
    await addBuilding(page, HOUSE);
    await addFloor(page, HOUSE, { name: FIRST_FLOOR, level: "1", belowGround: false });

    await fillArea(page, FIRST_FLOOR, { braI: "12,34" });
    await block(page, FIRST_FLOOR)
      .getByRole("button", { name: "Lagre areal", exact: true })
      .click();
    await expect(block(page, FIRST_FLOOR).getByText(AREA_ERROR)).toBeVisible();
    await expect(block(page, FIRST_FLOOR).getByLabel("BRA-i", { exact: true })).toHaveValue(
      "12,34",
    );

    await page.reload();
    await expect(block(page, FIRST_FLOOR).getByLabel("BRA-i", { exact: true })).toHaveValue("");
    await expect(block(page, HOUSE)).not.toContainText(/12,3/);
  });

  test("7.7 takstmann uten skriverett ser alt som tekst, uten «Legg til», «Lagre» eller «Fjern»", async ({
    page,
    browser,
  }) => {
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const assignmentId = await newAssignmentWithProperty(adminPage);
    await openBuildingsPage(adminPage);
    await buildHouse(adminPage);
    const room = await startRoom(adminPage, BASEMENT, "Kjellerstue");
    await room.submit();
    await adminContext.close();

    const previous = await setInspectorsEditAll(false);
    try {
      await logInAsInspector(page);
      const url = `/oppdrag/${assignmentId}/bygninger`;
      const response = await page.goto(url);
      expectNoServerError(response, url);

      const main = page.getByRole("main");
      await expect(main).toContainText(HOUSE);
      await expect(main).toContainText(BASEMENT);
      await expect(main).toContainText(FIRST_FLOOR);
      await expect(main).toContainText(/56,7/);
      await expect(main).toContainText(/123,4/);
      await expect(main).toContainText(/180,1/);
      await expect(main).toContainText("Kjellerstue");
      await expect(main).toContainText("Oppmålt med laser");

      await expect(main.getByRole("button", { name: /^Legg til/ })).toHaveCount(0);
      await expect(main.getByRole("button", { name: /^Lagre/ })).toHaveCount(0);
      await expect(main.getByRole("button", { name: "Fjern", exact: true })).toHaveCount(0);
      await expect(main.getByRole("textbox")).toHaveCount(0);
      await expect(main.getByRole("combobox")).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("7.8 ukjent id i adressen gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    for (const url of [`/oppdrag/${randomUUID()}/bygninger`, "/oppdrag/ikke-en-id/bygninger"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "Legg til bygning", exact: true })).toHaveCount(
        0,
      );
    }
  });

  test("7.10 bygning og rom kan legges til med tastaturet alene, og feltene har synlige etiketter", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildingsPage(page);
    const main = page.getByRole("main");

    /** Tab til elementet (høyst 150 trykk). */
    async function tabTo(target: Locator) {
      for (let i = 0; i < 150; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      await expect(target).toBeFocused();
    }

    // Bygning: Tab til «Legg til bygning», Enter, skriv navnet, Enter
    await page.locator("body").focus();
    const addBuildingButton = main.getByRole("button", { name: "Legg til bygning", exact: true });
    await tabTo(addBuildingButton);
    await page.keyboard.press("Enter");
    const nameField = main.getByLabel(NAME_LABEL).last();
    await tabTo(nameField);
    await page.keyboard.type(HOUSE);
    await page.keyboard.press("Enter");
    await expect(main.getByRole("heading", { name: HOUSE, exact: true })).toBeVisible();

    // Etasjen legges inn med musen (det er ikke det som prøves her)
    await addFloor(page, HOUSE, { name: FIRST_FLOOR, level: "1", belowGround: false });

    // Rom: Tab til «Legg til rom», Enter, Tab til romtypen, velg «Bad» med piltastene, Enter
    const floor = block(page, FIRST_FLOOR);
    await page.locator("body").focus();
    await tabTo(floor.getByRole("button", { name: "Legg til rom", exact: true }));
    await page.keyboard.press("Enter");
    const roomType = floor.getByLabel(/^Romtype/).last();
    await tabTo(roomType);
    for (let i = 0; i < 40; i++) {
      if ((await roomType.inputValue()) === "bathroom") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(roomType).toHaveValue("bathroom");
    const save = floor.getByRole("button", { name: "Lagre", exact: true });
    const submit =
      (await save.count()) > 0
        ? save.last()
        : floor.getByRole("button", { name: "Legg til rom", exact: true });
    await tabTo(submit);
    await page.keyboard.press("Enter");

    await page.reload();
    await expect(
      block(page, FIRST_FLOOR)
        .getByLabel(/^Romtype/)
        .first()
        .locator("option:checked"),
    ).toHaveText("Bad");

    // Feltene har synlige etiketter
    for (const label of ["BRA-i", "BRA-e", "BRA-b", "ALH"]) {
      await expect(block(page, FIRST_FLOOR).getByLabel(label, { exact: true })).toBeVisible();
    }
    for (const label of [/^Målt av/, /^Metode/, /^Romtype/, /^Arealtype/, /^Under terreng/]) {
      await expect(block(page, FIRST_FLOOR).getByLabel(label).first()).toBeVisible();
    }
  });
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7.9 stående: ingen vannrett rulling, én kolonne, knapper og nedtrekkslister minst 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const assignmentId = await newAssignmentWithProperty(page);
    await openBuildingsPage(page);
    await buildHouse(page);
    const room = await startRoom(page, FIRST_FLOOR, "Bad");
    await room.submit();

    const url = `/oppdrag/${assignmentId}/bygninger`;
    await page.goto(url);
    await expectNoHorizontalScroll(page, url);

    // Én kolonne: arealfeltene starter likt og står under hverandre
    const floor = block(page, FIRST_FLOOR);
    const fields = [
      floor.getByLabel("BRA-i", { exact: true }),
      floor.getByLabel("BRA-e", { exact: true }),
      floor.getByLabel("BRA-b", { exact: true }),
      floor.getByLabel("ALH", { exact: true }),
      floor.getByLabel(/^Målt av/),
      floor.getByLabel(/^Metode/),
    ];
    const boxes = await Promise.all(fields.map((field) => field.boundingBox()));
    for (const [index, box] of boxes.entries()) {
      expect(box, `felt ${index} er synlig`).not.toBeNull();
      expect(Math.round(box!.x), `felt ${index} starter i samme kolonne`).toBe(
        Math.round(boxes[0]!.x),
      );
      if (index > 0) expect(box!.y).toBeGreaterThan(boxes[index - 1]!.y);
    }

    // Alle knapper og nedtrekkslister på siden er minst 44 px høye
    const main = page.getByRole("main");
    const buttons = main.getByRole("button");
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      await expectAtLeast44(button, `knappen «${(await button.textContent())?.trim()}»`);
    }
    const selects = main.getByRole("combobox");
    for (let i = 0; i < (await selects.count()); i++) {
      const select = selects.nth(i);
      if (!(await select.isVisible())) continue;
      await expectAtLeast44(select, `nedtrekkslisten ${i}`);
    }
    for (const name of [
      "Legg til bygning",
      "Legg til etasje",
      "Legg til rom",
      "Lagre areal",
      "Fjern",
    ]) {
      await expectAtLeast44(main.getByRole("button", { name, exact: true }).first(), name);
    }
  });
});
