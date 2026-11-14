import { expect, test, type Locator, type Page } from "@playwright/test";
import { logIn, uniqueSuffix, convertedAssignmentLink } from "./helpers";

/*
 * Rett T-0050 (forsøk 2): arealtypen og «Under terreng» i «Legg til rom» og «Endre» på rommet
 * står igjen etter en feilmelding, og lagringen etterpå lagrer det som ble valgt.
 * Testplan: docs/agenter/oppgaver/rett-t0050-arealtype-testplan.md, sakene E1–E6. Kjører i pc og ipad.
 *
 * E7 («Legg til flere rom») er droppet: dialogen (add-rooms-dialog.tsx) har ingen arealtype-liste
 * eller avkrysning i skjemaet. Valgene ligger i React-tilstand og sendes som skjulte felt (utkastene
 * som JSON), så tilbakestillingen av skjemaet etter et forsøk rører dem ikke.
 *
 * Feilen gis med navnet 12345678901 (oppdiktet, elleve sifre ligner fødselsnummer). Hver test lager
 * sitt eget oppdrag med `uniqueSuffix()`, fordi e2e-databasen ikke tømmes. Testdata er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (arealtypen takstmannen velger, er den som lagres) og best
 * for de ansatte (valget står igjen etter en feil og må ikke gjøres på nytt).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const BUILDINGS_URL = new RegExp(`/oppdrag/(${UUID})/bygninger$`);
const BUILDING = "Bolighus";
const FLOOR = "1. etasje";
const NATIONAL_ID_NAME = "12345678901";
const NATIONAL_ID_ERROR = "Fødselsnummer skal ikke lagres her.";

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

/**
 * Ny ordre → oppdrag (Bodø) med eiendom → «Bygninger, areal og rom» → bygning og én etasje over
 * terreng. Gir etasjen.
 */
async function floorReady(page: Page): Promise<Locator> {
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

  const property = region(page, "Eiendom");
  await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
  await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
  await clickAndWaitForSave(page, button(property, "Lagre eiendom"));
  await expect(selected(property.getByLabel(/^Boligtype/))).toHaveText("Enebolig");

  await page.getByRole("link", { name: "Bygninger, areal og rom", exact: true }).click();
  await expect(page).toHaveURL(BUILDINGS_URL);
  await button(page, "Legg til bygning").click();
  await page.getByLabel(/^Navn/).last().fill(BUILDING);
  await clickAndWaitForSave(page, button(page, "Lagre").last());
  const building = region(page, BUILDING);
  await expect(building).toBeVisible();
  await button(building, "Legg til etasje").click();
  await building
    .getByLabel(/^Etasje(?!nummer)/)
    .last()
    .fill(FLOOR);
  await building
    .getByLabel(/^Etasjenummer/)
    .last()
    .fill("1");
  await clickAndWaitForSave(page, button(building, "Lagre").last());
  const floor = region(building, FLOOR);
  await expect(floor).toBeVisible();
  return floor;
}

/** Etasjen etter `page.reload()`. */
function floorAfterReload(page: Page): Locator {
  return region(region(page, BUILDING), FLOOR);
}

/** Romskjemaet i et område (etasjen for «Legg til rom», listepunktet for «Endre»). */
function roomForm(page: Page, scope: Locator) {
  const form = scope.locator("form").filter({ has: page.getByLabel(/^Romtype/) });
  return {
    form,
    roomType: form.getByLabel(/^Romtype/),
    name: form.getByLabel(/^Navn på rommet/),
    areaType: form.getByLabel(/^Arealtype/),
    belowGround: form.getByRole("checkbox", { name: "Under terreng", exact: true }),
    save: button(form, "Lagre"),
    error: form.getByText(NATIONAL_ID_ERROR),
  };
}

type RoomForm = ReturnType<typeof roomForm>;

function roomItem(scope: Locator, name: string): Locator {
  return scope.getByRole("listitem", { name, exact: true });
}

/** «Legg til rom»: romtype, arealtype, «Under terreng» og navnet som gir feil. */
async function fillNewRoomWithError(
  page: Page,
  floor: Locator,
  roomType: string,
  areaType: string,
): Promise<RoomForm> {
  await button(floor, "Legg til rom").click();
  const room = roomForm(page, floor);
  await room.roomType.selectOption({ label: roomType });
  await room.areaType.selectOption({ label: areaType });
  await room.belowGround.check();
  await room.name.fill(NATIONAL_ID_NAME);
  return room;
}

async function expectKeptAfterError(
  room: RoomForm,
  values: { roomType: string; areaType: string; belowGround: boolean; name: string },
) {
  await expect(room.error).toBeVisible();
  await expect(selected(room.areaType)).toHaveText(values.areaType);
  if (values.belowGround) await expect(room.belowGround).toBeChecked();
  else await expect(room.belowGround).not.toBeChecked();
  await expect(selected(room.roomType)).toHaveText(values.roomType);
  await expect(room.name).toHaveValue(values.name);
}

/** Rommet i listen viser romtype, arealtype og «Under terreng». */
async function expectRoomShown(floor: Locator, name: string, parts: string[]) {
  const item = roomItem(floor, name);
  await expect(item).toBeVisible();
  for (const part of parts) await expect(item).toContainText(part);
}

test.describe("T-0050 arealtypen i rommet står etter en feilmelding (pc og ipad)", () => {
  test("E1/E2 Kjøkken: BRA-e og «Under terreng» står etter feil og lagres", async ({ page }) => {
    test.slow();
    await logIn(page);
    const floor = await floorReady(page);

    const room = await fillNewRoomWithError(page, floor, "Kjøkken", "BRA-e");
    await clickAndWaitForSave(page, room.save);
    await expectKeptAfterError(room, {
      roomType: "Kjøkken",
      areaType: "BRA-e",
      belowGround: true,
      name: NATIONAL_ID_NAME,
    });

    await room.name.fill("Kjøkken test");
    await clickAndWaitForSave(page, room.save);
    await expect(room.form).toHaveCount(0);
    await expectRoomShown(floor, "Kjøkken test", ["Kjøkken", "BRA-e", "Under terreng"]);
    await expect(roomItem(floor, "Kjøkken test")).not.toContainText("BRA-i");

    await page.reload();
    const after = floorAfterReload(page);
    await expectRoomShown(after, "Kjøkken test", ["Kjøkken", "BRA-e", "Under terreng"]);
    await expect(roomItem(after, "Kjøkken test")).not.toContainText("BRA-i");
  });

  test("E3 Bod, inne: BRA-b og «Under terreng» står etter feil og lagres", async ({ page }) => {
    test.slow();
    await logIn(page);
    const floor = await floorReady(page);

    const room = await fillNewRoomWithError(page, floor, "Bod, inne", "BRA-b");
    await clickAndWaitForSave(page, room.save);
    await expectKeptAfterError(room, {
      roomType: "Bod, inne",
      areaType: "BRA-b",
      belowGround: true,
      name: NATIONAL_ID_NAME,
    });

    await room.name.fill("Bod test");
    await clickAndWaitForSave(page, room.save);
    await expect(room.form).toHaveCount(0);
    await expectRoomShown(floor, "Bod test", ["Bod, inne", "BRA-b", "Under terreng"]);

    await page.reload();
    await expectRoomShown(floorAfterReload(page), "Bod test", [
      "Bod, inne",
      "BRA-b",
      "Under terreng",
    ]);
  });

  test("E4 forslaget virker etter feil: ny romtype gir sin arealtype og «Under terreng» (A97)", async ({
    page,
  }) => {
    test.slow();
    await logIn(page);
    const floor = await floorReady(page);

    const room = await fillNewRoomWithError(page, floor, "Kjøkken", "BRA-e");
    await clickAndWaitForSave(page, room.save);
    await expect(room.error).toBeVisible();

    // «Innglasset balkong» har forslaget BRA-b og ikke under terreng; etasjen er over terreng.
    await room.roomType.selectOption({ label: "Innglasset balkong" });
    await expect(selected(room.areaType)).toHaveText("BRA-b");
    await expect(room.belowGround).not.toBeChecked();

    await room.name.fill("Balkong test");
    await clickAndWaitForSave(page, room.save);
    await expect(room.form).toHaveCount(0);
    await page.reload();
    const item = roomItem(floorAfterReload(page), "Balkong test");
    await expect(item).toContainText("BRA-b");
    await expect(item).not.toContainText("Under terreng");
  });

  test("E5 feil to ganger på rad: BRA-e og «Under terreng» står etter begge", async ({ page }) => {
    test.slow();
    await logIn(page);
    const floor = await floorReady(page);
    const values = {
      roomType: "Kjøkken",
      areaType: "BRA-e",
      belowGround: true,
      name: NATIONAL_ID_NAME,
    };

    const room = await fillNewRoomWithError(page, floor, "Kjøkken", "BRA-e");
    await clickAndWaitForSave(page, room.save);
    await expectKeptAfterError(room, values);
    await clickAndWaitForSave(page, room.save);
    await expectKeptAfterError(room, values);
  });

  test("E6 «Endre» rommet: ny arealtype står etter feil og lagres", async ({ page }) => {
    test.slow();
    await logIn(page);
    const floor = await floorReady(page);

    // Lagret rom med forslaget: Kjøkken, BRA-i, ikke under terreng.
    await button(floor, "Legg til rom").click();
    const created = roomForm(page, floor);
    await created.roomType.selectOption({ label: "Kjøkken" });
    await expect(selected(created.areaType)).toHaveText("BRA-i");
    await created.name.fill("Kjøkken endre");
    await clickAndWaitForSave(page, created.save);
    await expect(created.form).toHaveCount(0);

    const item = roomItem(floor, "Kjøkken endre");
    await button(item, "Endre").click();
    const room = roomForm(page, item);
    await room.areaType.selectOption({ label: "BRA-e" });
    await room.belowGround.check();
    await room.name.fill(NATIONAL_ID_NAME);
    await clickAndWaitForSave(page, room.save);
    await expectKeptAfterError(room, {
      roomType: "Kjøkken",
      areaType: "BRA-e",
      belowGround: true,
      name: NATIONAL_ID_NAME,
    });

    await room.name.fill("Kjøkken endret");
    await clickAndWaitForSave(page, room.save);
    await expect(floor.locator("form").filter({ has: page.getByLabel(/^Romtype/) })).toHaveCount(0);
    await expectRoomShown(floor, "Kjøkken endret", ["Kjøkken", "BRA-e", "Under terreng"]);

    await page.reload();
    const after = roomItem(floorAfterReload(page), "Kjøkken endret");
    await expect(after).toContainText("BRA-e");
    await expect(after).toContainText("Under terreng");
    await expect(after).not.toContainText("BRA-i");
  });
});
