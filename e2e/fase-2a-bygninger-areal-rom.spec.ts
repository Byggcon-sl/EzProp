import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Bygninger, etasjer, areal per etasje og rom på oppdraget (fase 2a).
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 7.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (7.9) og tastaturtesten (7.10) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre, sitt
 * eget oppdrag og sin egen eiendom (unik ending i adressen), fordi e2e-databasen ikke tømmes.
 * Testdata er oppdiktet: «Testveien 1 <ending>», gnr/bnr 999, «Bolighus», «Kjeller»,
 * «1. etasje», arealene 56,7 og 123,4.
 * Ingen e2e uten nett: alt føres for hånd på PC.
 *
 * Lokatorene bruker tilgjengelige roller og etiketter. Antakelser om siden (kortet punkt 8), som
 * rettes her ved sammenslåingen hvis siden er bygget annerledes:
 * - hver bygning og hver etasje er et landemerke (region) med navnet som overskrift;
 * - «Legg til bygning», «Legg til etasje» og «Legg til rom» åpner et skjema med «Lagre»; det nye
 *   skjemaet er det siste i blokken (`.last()`);
 * - feltene heter «Navn», «Etasjenummer» (eller «Nivå»), «Under terreng», «BRA-i», «BRA-e»,
 *   «BRA-b», «ALH», «Målt av», «Metode», «Kommentar», «Romtype» og «Arealtype»;
 * - summene vises som tekst med komma («180,1»).
 *
 * Støtter hovedmål: tid (forslag til arealtype og «under terreng», «Målt av» forhåndsvalgt, sum
 * regnes ut, virker på iPad) og reklamasjoner (ikke-tomme rader kan ikke fjernes, feil vises ved
 * feltet, takstmann uten skriverett kan ikke endre).
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
const ROOMS_FIRST = "Fjern rommene først.";
const BUILDING = "Bolighus";
const BASEMENT = "Kjeller";
const FIRST_FLOOR = "1. etasje";

const LABEL = {
  name: /^Navn/,
  level: /^(Etasjenummer|Nivå)/,
  belowGround: /^Under terreng/,
  braI: /^BRA-i/,
  braE: /^BRA-e/,
  braB: /^BRA-b/,
  alh: /^ALH/,
  measuredBy: /^Målt av/,
  method: /^Metode/,
  comment: /^Kommentar/,
  roomType: /^Romtype/,
  areaType: /^Arealtype/,
} as const;

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

/** Blokken for en bygning eller en etasje, som landemerke med navnet. */
function block(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}

function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

/**
 * Trykk knappen og vent på svaret fra server-handlingen (POST med «next-action»), slik at en
 * `page.reload()` etterpå ikke avbryter lagringen.
 */
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

/** Ny ordre → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. Gir oppdragets id. */
async function newAssignment(page: Page): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 1 ${uniqueSuffix()}`);
  await page.getByLabel(/^Gårdsnummer/).fill("999");
  await page.getByLabel(/^Bruksnummer/).fill("999");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);

  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");

  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

/** Oppdrag med eiendom (enebolig, selveier), lagret på oppdragssiden. */
async function newAssignmentWithProperty(page: Page): Promise<string> {
  const assignmentId = await newAssignment(page);
  const property = page.getByRole("region", { name: "Eiendom", exact: true });
  await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
  await clickAndWaitForSave(page, button(property, "Lagre eiendom"));
  await expect(property.getByLabel(/^Boligtype/).locator("option:checked")).toHaveText("Enebolig");
  return assignmentId;
}

/** Fra oppdragssiden: lenken «Bygninger, areal og rom». */
async function openBuildings(page: Page) {
  await page.getByRole("link", { name: LINK, exact: true }).click();
  await expect(page).toHaveURL(BUILDINGS_URL);
}

async function addBuilding(page: Page, name: string) {
  await button(page, "Legg til bygning").click();
  await page.getByLabel(LABEL.name).last().fill(name);
  await clickAndWaitForSave(page, button(page, "Lagre").last());
  await expect(block(page, name)).toBeVisible();
}

async function addFloor(
  page: Page,
  building: string,
  values: { name: string; level: string; belowGround: boolean },
) {
  const scope = block(page, building);
  await button(scope, "Legg til etasje").click();
  await scope.getByLabel(LABEL.name).last().fill(values.name);
  await scope.getByLabel(LABEL.level).last().fill(values.level);
  const below = scope.getByLabel(LABEL.belowGround).last();
  if (values.belowGround) await below.check();
  else await expect(below).not.toBeChecked();
  await clickAndWaitForSave(page, button(scope, "Lagre").last());
  await expect(block(scope, values.name)).toBeVisible();
}

/** Areal på en etasje: BRA-i og metode; «Målt av» skal være forhåndsvalgt. */
async function saveArea(page: Page, floor: Locator, braI: string) {
  await floor.getByLabel(LABEL.braI).fill(braI);
  await floor.getByLabel(LABEL.method).selectOption({ label: "Oppmålt med laser" });
  await clickAndWaitForSave(page, button(floor, "Lagre areal"));
}

/** Åpner «Legg til rom» i etasjen og velger romtypen. Gir skjemaets felt. */
async function startRoom(floor: Locator, roomType: string | RegExp) {
  await button(floor, "Legg til rom").click();
  const type = floor.getByLabel(LABEL.roomType).last();
  const label =
    typeof roomType === "string"
      ? roomType
      : await type.locator("option", { hasText: roomType }).first().innerText();
  await type.selectOption({ label });
  return {
    areaType: floor.getByLabel(LABEL.areaType).last(),
    belowGround: floor.getByLabel(LABEL.belowGround).last(),
    save: button(floor, "Lagre").last(),
  };
}

/** Bolighus med kjeller (56,7) og 1. etasje (123,4), bad i 1. etasje og kjellerstue i kjelleren. */
async function buildFullTree(page: Page) {
  await addBuilding(page, BUILDING);
  await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
  await addFloor(page, BUILDING, { name: BASEMENT, level: "-1", belowGround: true });
  const building = block(page, BUILDING);
  const basement = block(building, BASEMENT);
  const upper = block(building, FIRST_FLOOR);

  await expect(basement.getByLabel(LABEL.measuredBy).locator("option:checked")).not.toHaveText("");
  await saveArea(page, basement, "56,7");
  await saveArea(page, upper, "123,4");

  const bath = await startRoom(upper, "Bad");
  await expect(bath.areaType.locator("option:checked")).toHaveText("BRA-i");
  await expect(bath.belowGround).not.toBeChecked();
  await clickAndWaitForSave(page, bath.save);

  const living = await startRoom(basement, /^Kjellerstue/);
  await expect(living.belowGround).toBeChecked();
  await clickAndWaitForSave(page, living.save);
}

test.describe("bygninger, areal og rom (pc og ipad)", () => {
  test("7.1–7.2 hovedflyt: bygning, etasjer, areal og rom; sum 180,1; verdiene står etter ny lasting, og kjelleren står øverst", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildings(page);
    await expect(page.getByRole("main")).not.toContainText(NO_PROPERTY);

    await buildFullTree(page);

    const main = page.getByRole("main");
    const building = block(page, BUILDING);
    // «Målt av» er admin (den innloggede)
    await expect(
      block(building, BASEMENT).getByLabel(LABEL.measuredBy).locator("option:checked"),
    ).not.toHaveText(/^\s*$/);
    // Sum BRA per etasje, per bygning og totalt
    await expect(block(building, BASEMENT)).toContainText("56,7");
    await expect(block(building, FIRST_FLOOR)).toContainText("123,4");
    await expect(building).toContainText("180,1");
    await expect(main).toContainText("180,1");

    await page.reload();
    const after = block(page, BUILDING);
    const basement = block(after, BASEMENT);
    const upper = block(after, FIRST_FLOOR);
    await expect(basement.getByLabel(LABEL.braI)).toHaveValue(/^56[,.]7$/);
    await expect(upper.getByLabel(LABEL.braI)).toHaveValue(/^123[,.]4$/);
    await expect(basement.getByLabel(LABEL.method).locator("option:checked")).toHaveText(
      "Oppmålt med laser",
    );
    await expect(upper).toContainText("Bad");
    await expect(basement).toContainText("Kjellerstue");
    await expect(page.getByRole("main")).toContainText("180,1");

    // 7.2 Kjelleren (nivå −1) står over 1. etasje, selv om den ble lagt til sist
    const basementBox = await basement.boundingBox();
    const upperBox = await upper.boundingBox();
    expect(basementBox && upperBox, "begge etasjene er synlige").toBeTruthy();
    expect(basementBox!.y, "Kjeller står over 1. etasje").toBeLessThan(upperBox!.y);
  });

  test("7.3 forslaget kan endres: «Garasje» gir BRA-e, bytt til BRA-i før lagring → BRA-i lagres", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildings(page);
    await addBuilding(page, BUILDING);
    await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
    const upper = block(block(page, BUILDING), FIRST_FLOOR);

    const garage = await startRoom(upper, /^Garasje/);
    await expect(garage.areaType.locator("option:checked")).toHaveText("BRA-e");
    await garage.areaType.selectOption({ label: "BRA-i" });
    await clickAndWaitForSave(page, garage.save);

    await page.reload();
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await expect(floor).toContainText("Garasje");
    const areaType = floor.getByLabel(LABEL.areaType);
    if ((await areaType.count()) > 0) {
      await expect(areaType.first().locator("option:checked")).toHaveText("BRA-i");
    } else {
      await expect(floor).toContainText("BRA-i");
      await expect(floor).not.toContainText("BRA-e");
    }
  });

  test("7.4 fjerning: etasje med rom gir «Fjern rommene først.»; fjern rommet, så etasjen → borte", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildings(page);
    await addBuilding(page, BUILDING);
    await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
    const building = block(page, BUILDING);
    const upper = block(building, FIRST_FLOOR);
    const bath = await startRoom(upper, "Bad");
    await clickAndWaitForSave(page, bath.save);

    // «Fjern» på etasjen er den første i etasjeblokken; rommets «Fjern» er den siste
    const removeButtons = upper.getByRole("button", { name: /^Fjern/ });
    await expect(removeButtons).toHaveCount(2);
    await clickAndWaitForSave(page, removeButtons.first());
    await expect(upper.getByText(ROOMS_FIRST)).toBeVisible();

    await clickAndWaitForSave(page, removeButtons.last());
    await expect(upper.getByRole("button", { name: /^Fjern/ })).toHaveCount(1);
    await clickAndWaitForSave(page, upper.getByRole("button", { name: /^Fjern/ }));
    await expect(block(building, FIRST_FLOOR)).toHaveCount(0);

    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR)).toHaveCount(0);
  });

  test("7.5 uten eiendom: «Legg inn eiendommen først.» og ingen «Legg til bygning»", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await openBuildings(page);
    await expect(page.getByRole("main")).toContainText(NO_PROPERTY);
    await expect(button(page, "Legg til bygning")).toHaveCount(0);
  });

  test("7.6 feilmelding ved feltet: areal 12,34 gir kortets tekst, og ingenting lagres", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildings(page);
    await addBuilding(page, BUILDING);
    await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
    const upper = block(block(page, BUILDING), FIRST_FLOOR);

    await upper.getByLabel(LABEL.braI).fill("12,34");
    await button(upper, "Lagre areal").click();
    await expect(upper.getByText(AREA_ERROR)).toBeVisible();
    await expect(upper.getByLabel(LABEL.braI)).toHaveAttribute("aria-describedby", /.+/);

    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR).getByLabel(LABEL.braI)).toHaveValue("");
  });

  test("7.7 takstmann uten skriverett ser alt som tekst, uten «Legg til», «Lagre» og «Fjern»", async ({
    page,
    browser,
  }) => {
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const assignmentId = await newAssignmentWithProperty(adminPage);
    await openBuildings(adminPage);
    await buildFullTree(adminPage);
    await adminContext.close();

    const previous = await setInspectorsEditAll(false);
    try {
      await logInAsInspector(page);
      const url = `/oppdrag/${assignmentId}/bygninger`;
      const response = await page.goto(url);
      expectNoServerError(response, url);

      const main = page.getByRole("main");
      await expect(main).toContainText(BUILDING);
      await expect(main).toContainText(BASEMENT);
      await expect(main).toContainText(FIRST_FLOOR);
      await expect(main).toContainText("56,7");
      await expect(main).toContainText("123,4");
      await expect(main).toContainText("Bad");
      await expect(main).toContainText("Kjellerstue");
      await expect(main).toContainText("180,1");

      await expect(main.getByRole("button", { name: /^Legg til/ })).toHaveCount(0);
      await expect(main.getByRole("button", { name: /^Lagre/ })).toHaveCount(0);
      await expect(main.getByRole("button", { name: /^Fjern/ })).toHaveCount(0);
      await expect(main.getByRole("textbox")).toHaveCount(0);
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
      await expect(button(page, "Legg til bygning")).toHaveCount(0);
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
    await openBuildings(page);
    await buildFullTree(page);

    const url = `/oppdrag/${assignmentId}/bygninger`;
    await page.goto(url);
    await expectNoHorizontalScroll(page, url);

    // Én kolonne: arealfeltene i kjelleren starter likt og står under hverandre
    const basement = block(block(page, BUILDING), BASEMENT);
    const names = ["braI", "braE", "braB", "alh", "measuredBy", "method"] as const;
    const boxes = await Promise.all(
      names.map((name) => basement.getByLabel(LABEL[name]).boundingBox()),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box, `${names[index]} er synlig`).not.toBeNull();
      expect(Math.round(box!.x), `${names[index]} starter i samme kolonne`).toBe(
        Math.round(boxes[0]!.x),
      );
      if (index > 0) expect(box!.y).toBeGreaterThan(boxes[index - 1]!.y);
    }

    await expectAtLeast44(button(page, "Legg til bygning"), "Legg til bygning");
    await expectAtLeast44(button(block(page, BUILDING), "Legg til etasje"), "Legg til etasje");
    await expectAtLeast44(button(basement, "Legg til rom"), "Legg til rom");
    await expectAtLeast44(button(basement, "Lagre areal"), "Lagre areal");
    await expectAtLeast44(basement.getByLabel(LABEL.measuredBy), "Målt av");
    await expectAtLeast44(basement.getByLabel(LABEL.method), "Metode");
    const removeButtons = page.getByRole("button", { name: /^Fjern/ });
    for (let i = 0; i < (await removeButtons.count()); i++) {
      await expectAtLeast44(removeButtons.nth(i), `Fjern nr. ${i + 1}`);
    }
    const room = await startRoom(basement, "Bad");
    await expectAtLeast44(basement.getByLabel(LABEL.roomType).last(), "Romtype");
    await expectAtLeast44(room.areaType, "Arealtype");
    await expectAtLeast44(room.save, "Lagre rom");
  });

  test("7.10 tastaturet alene: bygning og rom legges til med Tab, piltaster og Enter", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignmentWithProperty(page);
    await openBuildings(page);

    async function tabTo(target: Locator, max = 120) {
      for (let i = 0; i < max; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      await expect(target).toBeFocused();
    }

    // Bygning: Tab til «Legg til bygning», Enter, skriv navnet, Enter
    await page.locator("body").focus();
    await tabTo(button(page, "Legg til bygning"));
    await page.keyboard.press("Enter");
    const name = page.getByLabel(LABEL.name).last();
    await tabTo(name, 10);
    await page.keyboard.type(BUILDING);
    await page.keyboard.press("Enter");
    await expect(block(page, BUILDING)).toBeVisible();

    // Etasje (med mus; testen gjelder bygning og rom)
    await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
    const upper = block(block(page, BUILDING), FIRST_FLOOR);

    // Rom: Tab til «Legg til rom», Enter, piltaster i romtypen, Tab til «Lagre», Enter
    await tabTo(button(upper, "Legg til rom"));
    await page.keyboard.press("Enter");
    const roomType = upper.getByLabel(LABEL.roomType).last();
    await tabTo(roomType, 10);
    for (let i = 0; i < 40; i++) {
      if ((await roomType.inputValue()) === "bathroom") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(roomType).toHaveValue("bathroom");
    await tabTo(button(upper, "Lagre").last(), 15);
    await page.keyboard.press("Enter");

    await expect(upper).toContainText("Bad");
    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR)).toContainText("Bad");
  });
});
