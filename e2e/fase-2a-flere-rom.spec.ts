import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Flere rom på én gang (T4). Dialogen «Legg til flere rom» på bygningssiden.
 * Testplan: docs/funksjoner/fase2a-flere-rom-testplan.md avsnitt E.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (E-iPad) og PC-sjekken (E-PC) er egne beskrivelser.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø». Hver test lager sin egen ordre, sitt eget oppdrag
 * og sin egen eiendom (unik ending i adressen), fordi e2e-databasen ikke tømmes.
 * Testdata er oppdiktet: «Testveien 1 <ending>», gnr/bnr 999, «Bolighus», «1. etasje», «Kjeller».
 *
 * Lokatorene bruker data-testid fra dialogen og tilgjengelige navn (rolle dialog «Legg til flere
 * rom», flisene har romtypens navn). Virker dialogen annerledes, rettes lokatorene ved
 * sammenslåingen.
 *
 * Støtter hovedmål: de ansatte (en leilighet med tre trykk), KI i bunnen (samme romutkast-liste
 * som KI-forslaget fra plantegning skal fylle i 2a-3) og færre reklamasjoner (navnene vises før
 * lagring, ingen dobbel lagring).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const BUILDINGS_URL = new RegExp(`/oppdrag/(${UUID})/bygninger$`);
const NUMBER = /\d{4}-\d{5}/;

const LINK = "Bygninger, areal og rom";
const BUILDING = "Bolighus";
const FIRST_FLOOR = "1. etasje";
const BASEMENT = "Kjeller";

const LABEL = {
  name: /^Navn/,
  floorName: /^(Navn|Etasje(?!nummer))/,
  level: /^(Etasjenummer|Nivå)/,
  belowGround: /^Under terreng/,
} as const;

function block(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}
function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

/** Trykk og vent på server-handlingen (POST med «next-action»), så en reload ikke avbryter. */
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

/** Ny ordre → oppdrag (Bodø) → åpne oppdraget. Gir oppdragets id. */
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

/** Oppdrag med eiendom av en gitt boligtype, lagret på oppdragssiden. */
async function newAssignmentWithHousing(page: Page, housingLabel: string): Promise<string> {
  const assignmentId = await newAssignment(page);
  const property = block(page, "Eiendom");
  await property.getByLabel(/^Boligtype/).selectOption({ label: housingLabel });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
  await clickAndWaitForSave(page, button(property, "Lagre eiendom"));
  await expect(property.getByLabel(/^Boligtype/).locator("option:checked")).toHaveText(
    housingLabel,
  );
  return assignmentId;
}

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
  buildingName: string,
  values: { name: string; level: string; belowGround: boolean },
) {
  const scope = block(page, buildingName);
  await button(scope, "Legg til etasje").click();
  await scope.getByLabel(LABEL.floorName).last().fill(values.name);
  await scope.getByLabel(LABEL.level).last().fill(values.level);
  const below = scope.getByLabel(LABEL.belowGround).last();
  if (values.belowGround) await below.check();
  await clickAndWaitForSave(page, button(scope, "Lagre").last());
  await expect(block(scope, values.name)).toBeVisible();
}

/** Dialogen. */
function dialog(page: Page): Locator {
  return page.getByTestId("add-rooms-dialog");
}

/** Åpner dialogen «Legg til flere rom» for etasjen. */
async function openDialog(page: Page, buildingName: string, floorName: string): Promise<Locator> {
  await block(block(page, buildingName), floorName).getByTestId("add-rooms-open").click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByTestId("add-rooms-floor")).toHaveText(floorName);
  return d;
}

/** Leilighet med én etasje over terreng, klar for dialogen. */
async function apartmentWithFloor(page: Page): Promise<string> {
  const assignmentId = await newAssignmentWithHousing(page, "Leilighet");
  await openBuildings(page);
  await addBuilding(page, BUILDING);
  await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
  return assignmentId;
}

test.describe("flere rom på én gang (pc og ipad)", () => {
  test("E1 open_with_suggestion: dialogen åpner med «Leilighet» merket «Foreslått»", async ({
    page,
  }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);

    const suggested = d.getByTestId("preset-apartment");
    await expect(suggested).toBeVisible();
    await expect(suggested).toContainText("Foreslått");
    // Settet står først blant settene
    const presets = d.locator('[data-testid^="preset-"]');
    await expect(presets.first()).toHaveAttribute("data-testid", "preset-apartment");
  });

  test("E2 three_taps: sett + lagre gir 7 rom som står etter ny lasting", async ({ page }) => {
    test.slow();
    await logIn(page);
    await apartmentWithFloor(page);
    let taps = 0;

    await block(block(page, BUILDING), FIRST_FLOOR).getByTestId("add-rooms-open").click();
    taps += 1; // åpne
    const d = dialog(page);
    await expect(d).toBeVisible();

    await d.getByTestId("preset-apartment").click();
    taps += 1; // sett

    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));
    taps += 1; // lagre
    expect(taps, "åpne + sett + lagre = 3 trykk").toBe(3);

    await expect(d).toBeHidden();
    await page.reload();
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await expect(floor).toContainText("Soverom 1");
    await expect(floor).toContainText("Soverom 2");
    await expect(floor.getByRole("listitem")).toHaveCount(7);
  });

  test("E3 counter_up_down: flisen teller opp og ned, og hovedknappen følger med", async ({
    page,
  }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);

    const tile = d.getByTestId("tile-bedroom");
    const count = d.getByTestId("tile-count-bedroom");
    const minus = d.getByTestId("tile-minus-bedroom");
    const submit = d.getByTestId("add-rooms-submit");

    await tile.click();
    await tile.click();
    await expect(count).toHaveText("2");
    await expect(submit).toContainText("2 rom");
    await minus.click();
    await expect(count).toHaveText("1");
    await minus.click();
    await expect(count).toHaveText("0");
    // «–» på 0 gjør ingenting, og knappen er av
    await expect(minus).toBeDisabled();
    await expect(submit).toBeDisabled();
  });

  test("E4 preset_replaces: nytt trykk på settet erstatter tellerne", async ({ page }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);

    await d.getByTestId("preset-apartment").click();
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("2");
    await d.getByTestId("tile-bedroom").click();
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("3");
    await d.getByTestId("preset-apartment").click();
    // Erstatter, legger ikke til
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("2");
  });

  test("E5 more_types: «Flere romtyper» folder ut gruppene, og «Garasje» kommer med", async ({
    page,
  }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);

    await d.getByTestId("add-rooms-more").click();
    await expect(d.getByRole("heading", { name: "Andre rom" })).toBeVisible();
    const garage = d.getByTestId("tile-garage");
    await garage.scrollIntoViewIfNeeded();
    await garage.click();
    await expect(d.getByTestId("tile-count-garage")).toHaveText("1");
    await expect(d.getByTestId("add-rooms-preview")).toContainText("Garasje");

    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));
    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR)).toContainText("Garasje");
  });

  test("E6 basement_suggested: etasje under terreng foreslår kjeller og gir «Under terreng»", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    await newAssignmentWithHousing(page, "Enebolig");
    await openBuildings(page);
    await addBuilding(page, BUILDING);
    await addFloor(page, BUILDING, { name: BASEMENT, level: "-1", belowGround: true });
    const d = await openDialog(page, BUILDING, BASEMENT);

    await expect(d.getByTestId("preset-basement")).toContainText("Foreslått");
    await d.getByTestId("preset-basement").click();
    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));

    await page.reload();
    const floor = block(block(page, BUILDING), BASEMENT);
    // Lagrede rom er under terreng (avkrysningen i rad-redigeringen er på)
    await expect(floor).toContainText("Under terreng");
  });

  test("E7 existing_and_numbering: «allerede N rom» og nummerering fortsetter", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    await apartmentWithFloor(page);

    // Legg inn to soverom med dialogen først
    let d = await openDialog(page, BUILDING, FIRST_FLOOR);
    await d.getByTestId("tile-bedroom").click();
    await d.getByTestId("tile-bedroom").click();
    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));
    await expect(d).toBeHidden();

    // Åpne på nytt: «allerede 2 rom», +1 soverom gir «Soverom 3» i forhåndsvisningen
    d = await openDialog(page, BUILDING, FIRST_FLOOR);
    await expect(d.getByTestId("add-rooms-existing")).toContainText("allerede 2 rom");
    await d.getByTestId("tile-bedroom").click();
    await expect(d.getByTestId("add-rooms-preview")).toContainText("Soverom 3");
    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));

    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR)).toContainText("Soverom 3");
  });

  test("E8 max_20: telleren stopper på 20 og flisen blir av", async ({ page }) => {
    test.slow();
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);
    const tile = d.getByTestId("tile-bedroom");
    const count = d.getByTestId("tile-count-bedroom");

    for (let i = 0; i < 20; i += 1) await tile.click();
    await expect(count).toHaveText("20");
    await expect(tile).toBeDisabled();
    // 21. trykk endrer ingenting
    await tile.click({ force: true }).catch(() => {});
    await expect(count).toHaveText("20");
  });

  test("E9 server_max_40: 41 rom gir serverens norske melding, og tellerne står igjen", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);

    for (let i = 0; i < 20; i += 1) await d.getByTestId("tile-bedroom").click();
    for (let i = 0; i < 20; i += 1) await d.getByTestId("tile-storage").click();
    await d.getByTestId("tile-kitchen").click();

    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));
    // Dialogen er fortsatt åpen, med serverens melding om høyst 40 rom
    await expect(d).toBeVisible();
    await expect(d).toContainText(/40/);
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("20");
    await expect(d.getByTestId("tile-count-storage")).toHaveText("20");
    await expect(d.getByTestId("tile-count-kitchen")).toHaveText("1");

    // Ingen rom ble lagret
    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR).getByRole("listitem")).toHaveCount(0);
  });

  test("E10 no_double_save: hovedknappen sperres, dobbelttrykk gir bare 7 rom", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);
    await d.getByTestId("preset-apartment").click();

    // Forsink svaret fra server-handlingen med kontrollert slipp
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/oppdrag/**/bygninger", async (route) => {
      if (route.request().method() === "POST") {
        await gate;
      }
      await route.continue();
    });

    const submit = d.getByTestId("add-rooms-submit");
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    // Dobbelttrykk og Enter mens den jobber
    await submit.click({ force: true }).catch(() => {});
    await page.keyboard.press("Enter");
    release();
    await page.unroute("**/oppdrag/**/bygninger");

    await expect(d).toBeHidden();
    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR).getByRole("listitem")).toHaveCount(7);
  });

  test("E11 discard_prompt: lukking med tellere over 0 spør «Forkaste N rom?»", async ({
    page,
  }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);
    await d.getByTestId("tile-bedroom").click();
    await d.getByTestId("tile-bedroom").click();

    // Avbryt → spørsmål; «Fortsett» beholder tellerne
    await button(d, "Avbryt").click();
    await expect(d.getByText("Forkaste 2 rom?")).toBeVisible();
    await button(d, "Fortsett").click();
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("2");

    // Escape → spørsmål; «Forkast» lukker uten å lagre
    await page.keyboard.press("Escape");
    await expect(d.getByText("Forkaste 2 rom?")).toBeVisible();
    await button(d, "Forkast").click();
    await expect(d).toBeHidden();

    await page.reload();
    await expect(block(block(page, BUILDING), FIRST_FLOOR).getByRole("listitem")).toHaveCount(0);
  });

  test("E11 discard_prompt: lukking med tellere på 0 spør ikke", async ({ page }) => {
    await logIn(page);
    await apartmentWithFloor(page);
    const d = await openDialog(page, BUILDING, FIRST_FLOOR);
    await button(d, "Avbryt").click();
    await expect(d).toBeHidden();
  });

  test("E12 no_access_ui: takstmann uten skriverett ser ikke «Legg til flere rom»", async ({
    page,
    browser,
  }) => {
    test.slow();
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const assignmentId = await apartmentWithFloor(adminPage);
    await adminContext.close();

    const previous = await setInspectorsEditAll(false);
    try {
      await logInAsInspector(page);
      await page.goto(`/oppdrag/${assignmentId}/bygninger`);
      await expect(page.getByRole("main")).toContainText(FIRST_FLOOR);
      await expect(page.getByTestId("add-rooms-open")).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  /** Leilighet med én etasje, dialogen åpen, i stående iPad. */
  async function portraitDialog(page: Page): Promise<Locator> {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    await apartmentWithFloor(page);
    return openDialog(page, BUILDING, FIRST_FLOOR);
  }

  test("E-iPad.1 touch_targets: fliser minst 56 px, «–» og knapper minst 44 px", async ({
    page,
  }) => {
    test.slow();
    const d = await portraitDialog(page);
    const tile = d.getByTestId("tile-bedroom");
    const minus = d.getByTestId("tile-minus-bedroom");

    const tileBox = await tile.boundingBox();
    const minusBox = await minus.boundingBox();
    expect(tileBox, "flisen er synlig").not.toBeNull();
    expect(minusBox, "«–» er synlig").not.toBeNull();
    expect(tileBox!.height, "flis minst 56 px").toBeGreaterThanOrEqual(56);
    expect(minusBox!.height, "«–» minst 44 px").toBeGreaterThanOrEqual(44);
    expect(minusBox!.width, "«–» minst 44 px bred").toBeGreaterThanOrEqual(44);
    // Avstand mellom flis og «–» minst 8 px
    expect(
      minusBox!.x - (tileBox!.x + tileBox!.width),
      "avstand minst 8 px",
    ).toBeGreaterThanOrEqual(8 - 1);

    const submit = d.getByTestId("add-rooms-submit");
    const submitBox = await submit.boundingBox();
    expect(submitBox!.height, "hovedknapp minst 44 px").toBeGreaterThanOrEqual(44);
  });

  test("E-iPad.2 sticky_main_button: hovedknappen er synlig uten å rulle, 56–72 px høy", async ({
    page,
  }) => {
    test.slow();
    const d = await portraitDialog(page);
    const submit = d.getByTestId("add-rooms-submit");
    await expect(submit).toBeInViewport();
    const box = await submit.boundingBox();
    expect(box!.height, "56–72 px").toBeGreaterThanOrEqual(56);
    expect(box!.height, "56–72 px").toBeLessThanOrEqual(72);

    // Også etter at «Flere romtyper» er åpnet
    await d.getByTestId("add-rooms-more").click();
    await expect(submit).toBeInViewport();
  });

  test("E-iPad.3 no_horizontal_scroll: ingen vannrett rulling med dialogen åpen", async ({
    page,
  }) => {
    test.slow();
    const d = await portraitDialog(page);
    await d.getByTestId("add-rooms-more").click();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test("E-iPad.4 keyboard: Tab, Enter og Escape virker, fokus går tilbake til knappen", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    await apartmentWithFloor(page);
    const openButton = block(block(page, BUILDING), FIRST_FLOOR).getByTestId("add-rooms-open");
    await openButton.focus();
    await page.keyboard.press("Enter");
    const d = dialog(page);
    await expect(d).toBeVisible();

    // Velg settet med tastaturet (Tab til knappen, Enter), så lagre
    await d.getByTestId("preset-apartment").focus();
    await page.keyboard.press("Enter");
    await expect(d.getByTestId("tile-count-bedroom")).toHaveText("2");

    // Escape gir forkast-spørsmålet (fokus fanges i dialogen)
    await page.keyboard.press("Escape");
    await expect(d.getByText(/Forkaste \d+ rom\?/)).toBeVisible();
    await button(d, "Forkast").click();
    await expect(d).toBeHidden();
    // Fokus går tilbake til knappen som åpnet dialogen
    await expect(openButton).toBeFocused();
  });
});

test.describe("PC (prosjektet pc)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "pc", "Bare i prosjektet pc");
  });

  test("E-PC.1 one_dialog: høyst én dialog i DOM-en, og rommene havner i riktig etasje", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    await newAssignmentWithHousing(page, "Enebolig");
    await openBuildings(page);
    await addBuilding(page, BUILDING);
    await addFloor(page, BUILDING, { name: FIRST_FLOOR, level: "1", belowGround: false });
    await addFloor(page, BUILDING, { name: "2. etasje", level: "2", belowGround: false });
    await addFloor(page, BUILDING, { name: BASEMENT, level: "-1", belowGround: true });

    // Bare én dialog i DOM-en, selv med tre etasjer (T-0058)
    await expect(dialog(page)).toHaveCount(1);

    // Åpne for 2. etasje og legg til ett soverom; det havner i 2. etasje
    const d = await openDialog(page, BUILDING, "2. etasje");
    await d.getByTestId("tile-bedroom").click();
    await clickAndWaitForSave(page, d.getByTestId("add-rooms-submit"));

    await page.reload();
    await expect(block(block(page, BUILDING), "2. etasje")).toContainText("Soverom");
    await expect(block(block(page, BUILDING), FIRST_FLOOR).getByRole("listitem")).toHaveCount(0);
  });
});
