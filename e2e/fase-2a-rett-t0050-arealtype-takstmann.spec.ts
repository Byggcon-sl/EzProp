import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  convertedAssignmentLink,
  ensureInspector,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  roomsOnAssignment,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Rett T-0050 (forsøk 2): arealtypen og «Under terreng» i «Legg til rom» står igjen etter en
 * feilmelding, og lagringen etterpå lagrer det som ble valgt
 * (docs/agenter/testlag/funn/T-0050-nedtrekkslister-hopper-tilbake-etter-feil.md).
 * Testplan: docs/agenter/oppgaver/rett-t0050-arealtype-testplan.md, sakene E1–E6. Kjører i pc og ipad.
 * Samme saker som fase-2a-rett-t0050-arealtype.spec.ts, men her legger takstmannen inn rommene
 * og lagringen sjekkes i databasen (begge beholdt ved sammenslåing av parallelle testbiter).
 *
 * E7 («Legg til flere rom») er utelatt: dialogen har bare tellere per romtype (styrt tilstand i
 * skjulte felt), ingen arealtype eller avkrysning som kan hoppe tilbake.
 *
 * Admin lager oppdraget med eiendom, bygning og én etasje over terreng i en egen kontekst; selve
 * rommene legges inn av takstmannen. Hver test lager sitt eget oppdrag med `uniqueSuffix()`.
 * Testdata er oppdiktet («Testveien 1 …», gnr/bnr 999). Navnet `12345678901` er oppdiktet og gir
 * feil fordi elleve sifre ligner et fødselsnummer.
 *
 * Støtter hovedmål: færre reklamasjoner (riktig BRA-i/BRA-e/BRA-b lagres) og best for de ansatte
 * (valget må ikke gjøres på nytt etter en feil).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const BUILDING = "Bolighus";
const FLOOR = "1. etasje";
const BAD_NAME = "12345678901";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

const LABEL = {
  roomType: /^Romtype/,
  roomName: /^Navn på rommet/,
  areaType: /^Arealtype/,
  belowGround: /^Under terreng/,
} as const;

function region(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}

function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

function selected(select: Locator): Locator {
  return select.locator("option:checked");
}

/** Trykk knappen og vent på svaret fra server-handlingen, slik at en ny lasting ikke avbryter. */
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

/** Admin: ordre → oppdrag (Bodø) → eiendom → bygning «Bolighus» → «1. etasje» (nummer 1). */
async function prepareAssignment(page: Page): Promise<string> {
  await logIn(page);
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 1 ${uniqueSuffix()}`);
  await page.getByLabel(/^Gårdsnummer/).fill("999");
  await page.getByLabel(/^Bruksnummer/).fill("999");
  await button(page, "Lagre").click();
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await button(page, "Gjør om til oppdrag").click();
  await expect(convertedAssignmentLink(page)).toBeVisible();
  await convertedAssignmentLink(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  const assignmentId = ASSIGNMENT_URL.exec(page.url())![1]!;

  const property = region(page, "Eiendom");
  await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
  await clickAndWaitForSave(page, button(property, "Lagre eiendom"));
  await expect(selected(property.getByLabel(/^Boligtype/))).toHaveText("Enebolig");

  await page.getByRole("link", { name: "Bygninger, areal og rom", exact: true }).click();
  await button(page, "Legg til bygning").click();
  await page.getByLabel(/^Navn/).last().fill(BUILDING);
  await clickAndWaitForSave(page, button(page, "Lagre").last());
  const building = region(page, BUILDING);
  await expect(building).toBeVisible();
  await button(building, "Legg til etasje").click();
  await building
    .getByLabel(/^(Navn|Etasje(?!nummer))/)
    .last()
    .fill(FLOOR);
  await building
    .getByLabel(/^(Etasjenummer|Nivå)/)
    .last()
    .fill("1");
  await clickAndWaitForSave(page, button(building, "Lagre").last());
  await expect(region(building, FLOOR)).toBeVisible();
  return assignmentId;
}

/** Oppdraget klargjort av admin; takstmannen står på «Bygninger, areal og rom». Gir etasjen. */
async function openAsInspector(page: Page, assignmentId: string): Promise<Locator> {
  await logInAsInspector(page);
  await page.goto(`/oppdrag/${assignmentId}/bygninger`);
  const floor = region(region(page, BUILDING), FLOOR);
  await expect(floor).toBeVisible();
  return floor;
}

/** Skjemaets felt i etasjen (det siste skjemaet er det åpne). */
function roomForm(floor: Locator) {
  return {
    roomType: floor.getByLabel(LABEL.roomType).last(),
    name: floor.getByLabel(LABEL.roomName).last(),
    areaType: floor.getByLabel(LABEL.areaType).last(),
    belowGround: floor.getByLabel(LABEL.belowGround).last(),
    save: button(floor, "Lagre").last(),
  };
}

type Setup = { page: Page; assignmentId: string; floor: Locator };

/**
 * Lager oppdraget som admin i en egen kontekst, og åpner det som takstmann på `page`.
 * «Alle takstmenn kan endre alt» slås på mens testen går, og settes tilbake etterpå.
 */
async function withInspectorOnFloor(
  page: Page,
  browser: Browser,
  run: (setup: Setup) => Promise<void>,
) {
  test.slow();
  await ensureInspector();
  const { baseURL, viewport, hasTouch } = test.info().project.use;
  const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
  let assignmentId: string;
  try {
    assignmentId = await prepareAssignment(await adminContext.newPage());
  } finally {
    await adminContext.close();
  }
  const previous = await setInspectorsEditAll(true);
  try {
    const floor = await openAsInspector(page, assignmentId);
    await run({ page, assignmentId, floor });
  } finally {
    await restoreInspectorsEditAll(previous);
  }
}

/**
 * «Legg til rom»: romtype, arealtype, «Under terreng» og navnet med elleve sifre → Lagre gir
 * feilmelding. Sjekker at alt som ble valgt, står igjen.
 */
async function addRoomWithError(
  page: Page,
  floor: Locator,
  values: { roomType: string; suggested: string; areaType: string },
) {
  await button(floor, "Legg til rom").click();
  const form = roomForm(floor);
  await form.roomType.selectOption({ label: values.roomType });
  // Forslaget for romtypen (A97) settes først
  await expect(selected(form.areaType)).toHaveText(values.suggested);
  await expect(form.belowGround).not.toBeChecked();

  await form.areaType.selectOption({ label: values.areaType });
  await form.belowGround.check();
  await form.name.fill(BAD_NAME);
  await clickAndWaitForSave(page, form.save);

  await expectErrorWithChoicesKept(floor, values);
  return form;
}

async function expectErrorWithChoicesKept(
  floor: Locator,
  values: { roomType: string; areaType: string },
  belowGround = true,
) {
  const form = roomForm(floor);
  await expect(floor.getByText(NATIONAL_ID).first()).toBeVisible();
  await expect(selected(form.roomType)).toHaveText(values.roomType);
  await expect(form.name).toHaveValue(BAD_NAME);
  await expect(selected(form.areaType), "arealtypen står igjen etter feil").toHaveText(
    values.areaType,
  );
  if (belowGround) await expect(form.belowGround, "«Under terreng» står igjen").toBeChecked();
  else await expect(form.belowGround, "«Under terreng» står igjen").not.toBeChecked();
}

/** Rett navnet, lagre, og sjekk listen, ny lasting og databasen. */
async function fixNameAndExpectSaved(
  setup: Setup,
  values: { roomType: string; name: string; areaType: string; areaTypeCode: string },
  belowGround = true,
) {
  const { page, assignmentId, floor } = setup;
  const form = roomForm(floor);
  await form.name.fill(values.name);
  await clickAndWaitForSave(page, form.save);
  await expect(floor.getByText(NATIONAL_ID)).toHaveCount(0);

  const expectedLine = [values.roomType, values.areaType, belowGround ? "Under terreng" : null]
    .filter(Boolean)
    .join(" · ");
  const item = floor.getByRole("listitem", { name: values.name, exact: true });
  await expect(item).toContainText(expectedLine);

  await page.reload();
  const after = region(region(page, BUILDING), FLOOR);
  await expect(after.getByRole("listitem", { name: values.name, exact: true })).toContainText(
    expectedLine,
  );

  const rows = await roomsOnAssignment(assignmentId);
  const row = rows.find((candidate) => candidate.name === values.name);
  expect(row, "rommet er lagret").toBeDefined();
  expect(row!.areaType, "arealtypen i databasen").toBe(values.areaTypeCode);
  expect(row!.belowGround, "«Under terreng» i databasen").toBe(belowGround);
}

test.describe("T-0050 forsøk 2: arealtypen i «Legg til rom» står etter feil (pc og ipad)", () => {
  test("E1–E2 Kjøkken + BRA-e og «Under terreng» står etter feil, og lagres når navnet er rettet", async ({
    page,
    browser,
  }) => {
    await withInspectorOnFloor(page, browser, async (setup) => {
      await addRoomWithError(page, setup.floor, {
        roomType: "Kjøkken",
        suggested: "BRA-i",
        areaType: "BRA-e",
      });
      await fixNameAndExpectSaved(setup, {
        roomType: "Kjøkken",
        name: "Kjøkken test",
        areaType: "BRA-e",
        areaTypeCode: "bra_e",
      });
    });
  });

  test("E3 «Bod, inne» + BRA-b og «Under terreng» står etter feil, og lagres når navnet er rettet", async ({
    page,
    browser,
  }) => {
    await withInspectorOnFloor(page, browser, async (setup) => {
      await addRoomWithError(page, setup.floor, {
        roomType: "Bod, inne",
        suggested: "BRA-i",
        areaType: "BRA-b",
      });
      await fixNameAndExpectSaved(setup, {
        roomType: "Bod, inne",
        name: "Bod test",
        areaType: "BRA-b",
        areaTypeCode: "bra_b",
      });
    });
  });

  test("E4 etter feil gir bytte av romtype fortsatt forslaget for den nye romtypen (A97)", async ({
    page,
    browser,
  }) => {
    await withInspectorOnFloor(page, browser, async (setup) => {
      const form = await addRoomWithError(page, setup.floor, {
        roomType: "Kjøkken",
        suggested: "BRA-i",
        areaType: "BRA-e",
      });
      // Kryperom: forslaget er «Ikke del av BRA» og ikke under terreng (etasjen er over terreng)
      await form.roomType.selectOption({ label: "Kryperom" });
      await expect(selected(form.areaType)).toHaveText("Ikke del av BRA");
      await expect(form.belowGround).not.toBeChecked();

      await fixNameAndExpectSaved(
        setup,
        {
          roomType: "Kryperom",
          name: "Kryperom test",
          areaType: "Ikke del av BRA",
          areaTypeCode: "not_bra",
        },
        false,
      );
    });
  });

  test("E5 feil to ganger på rad: arealtypen står på BRA-e etter begge, og lagres", async ({
    page,
    browser,
  }) => {
    await withInspectorOnFloor(page, browser, async (setup) => {
      const values = { roomType: "Kjøkken", suggested: "BRA-i", areaType: "BRA-e" };
      const form = await addRoomWithError(page, setup.floor, values);
      await clickAndWaitForSave(page, form.save);
      await expectErrorWithChoicesKept(setup.floor, values);

      await fixNameAndExpectSaved(setup, {
        roomType: "Kjøkken",
        name: "Kjøkken to feil",
        areaType: "BRA-e",
        areaTypeCode: "bra_e",
      });
    });
  });

  test("E6 «Endre rom»: ny arealtype og «Under terreng» står etter feil, og lagres", async ({
    page,
    browser,
  }) => {
    await withInspectorOnFloor(page, browser, async (setup) => {
      const { floor } = setup;
      // Lagret rom uten feil: Kjøkken med forslaget BRA-i, ikke under terreng
      await button(floor, "Legg til rom").click();
      const first = roomForm(floor);
      await first.roomType.selectOption({ label: "Kjøkken" });
      await first.name.fill("Kjøkken endres");
      await clickAndWaitForSave(page, first.save);
      const item = floor.getByRole("listitem", { name: "Kjøkken endres", exact: true });
      await expect(item).toContainText("Kjøkken · BRA-i");

      await button(item, "Endre").click();
      const form = roomForm(floor);
      await expect(selected(form.areaType)).toHaveText("BRA-i");
      await form.areaType.selectOption({ label: "BRA-b" });
      await form.belowGround.check();
      await form.name.fill(BAD_NAME);
      await clickAndWaitForSave(page, form.save);
      await expectErrorWithChoicesKept(floor, { roomType: "Kjøkken", areaType: "BRA-b" });

      await fixNameAndExpectSaved(setup, {
        roomType: "Kjøkken",
        name: "Kjøkken endret",
        areaType: "BRA-b",
        areaTypeCode: "bra_b",
      });
    });
  });
});
