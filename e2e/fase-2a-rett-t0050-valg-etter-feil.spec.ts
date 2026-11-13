import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createAssignmentWithParty,
  ensureInspector,
  logIn,
  logInAsManager,
  uniqueSuffix,
} from "./helpers";

/*
 * Rett T-0050: nedtrekkslister og avkrysninger står igjen etter en feilmelding, og lagringen
 * etterpå lagrer det som ble valgt (docs/agenter/testlag/funn/T-0050-…).
 * Sakene A (areal), B (eiendom), C (reklamasjon) og D (part) fra funnet. Kjører i pc og ipad.
 *
 * Hver test lager sitt eget oppdrag med `uniqueSuffix()`, fordi e2e-databasen ikke tømmes.
 * Testdata er oppdiktet («Testveien 1 …», gnr/bnr 999, «Oppdiktet takstmann», «Megler Test»).
 *
 * Støtter hovedmål: færre reklamasjoner (feil metode, måler, eierform eller sakstype lagres ikke
 * uten varsel) og best for de ansatte (valgene må ikke gjøres på nytt etter en feil).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const AREA_ERROR = "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.";
const INSPECTOR_NAME = "Oppdiktet takstmann";

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

/** Ny ordre med adresse og matrikkel → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. */
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

test.describe("T-0050 valgene står etter en feilmelding (pc og ipad)", () => {
  test("A areal: metode og «Målt av» står etter feil, og lagres når tallet er rettet", async ({
    page,
  }) => {
    test.slow();
    await ensureInspector();
    await logIn(page);
    await newAssignment(page);
    const property = region(page, "Eiendom");
    await property.getByLabel(/^Boligtype/).selectOption({ label: "Enebolig" });
    await property.getByLabel(/^Eierform/).selectOption({ label: "Selveier" });
    await clickAndWaitForSave(page, button(property, "Lagre eiendom"));

    await page.getByRole("link", { name: "Bygninger, areal og rom", exact: true }).click();
    await button(page, "Legg til bygning").click();
    await page.getByLabel(/^Navn/).last().fill("Bolighus");
    await clickAndWaitForSave(page, button(page, "Lagre").last());
    const building = region(page, "Bolighus");
    await button(building, "Legg til etasje").click();
    await building
      .getByLabel(/^Etasje(?!nummer)/)
      .last()
      .fill("1. etasje");
    await building
      .getByLabel(/^Etasjenummer/)
      .last()
      .fill("1");
    await clickAndWaitForSave(page, button(building, "Lagre").last());
    const floor = region(building, "1. etasje");

    await floor.getByLabel(/^BRA-i/).fill("12,345");
    await floor.getByLabel(/^Metode/).selectOption({ label: "Fra tegning" });
    await floor.getByLabel(/^Målt av/).selectOption({ label: INSPECTOR_NAME });
    await clickAndWaitForSave(page, button(floor, "Lagre areal"));

    await expect(floor.getByText(AREA_ERROR)).toBeVisible();
    await expect(floor.getByLabel(/^BRA-i/)).toHaveValue("12,345");
    await expect(selected(floor.getByLabel(/^Metode/))).toHaveText("Fra tegning");
    await expect(selected(floor.getByLabel(/^Målt av/))).toHaveText(INSPECTOR_NAME);

    await floor.getByLabel(/^BRA-i/).fill("12,3");
    await clickAndWaitForSave(page, button(floor, "Lagre areal"));
    await expect(floor.getByText(AREA_ERROR)).toHaveCount(0);

    await page.reload();
    const after = region(region(page, "Bolighus"), "1. etasje");
    await expect(after.getByLabel(/^BRA-i/)).toHaveValue(/^12[,.]3$/);
    await expect(selected(after.getByLabel(/^Metode/))).toHaveText("Fra tegning");
    await expect(selected(after.getByLabel(/^Målt av/))).toHaveText(INSPECTOR_NAME);
  });

  test("B eiendom: boligtype og eierform står etter feil, og lagres når postnummeret er rettet", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    const property = region(page, "Eiendom");
    const housingType = property.getByLabel(/^Boligtype/);
    const ownershipForm = property.getByLabel(/^Eierform/);

    await housingType.selectOption({ label: "Rekkehus" });
    await ownershipForm.selectOption({ label: "Eierseksjon i sameie" });
    await property.getByLabel(/^Postnummer/).fill("80");
    await clickAndWaitForSave(page, button(property, "Lagre eiendom"));

    await expect(property.getByText("Postnummeret må ha fire sifre.")).toBeVisible();
    await expect(selected(housingType)).toHaveText("Rekkehus");
    await expect(selected(ownershipForm)).toHaveText("Eierseksjon i sameie");

    await property.getByLabel(/^Postnummer/).fill("8000");
    await clickAndWaitForSave(page, button(property, "Lagre eiendom"));
    await expect(property.getByText("Postnummeret må ha fire sifre.")).toHaveCount(0);

    await page.reload();
    const after = region(page, "Eiendom");
    await expect(selected(after.getByLabel(/^Boligtype/))).toHaveText("Rekkehus");
    await expect(selected(after.getByLabel(/^Eierform/))).toHaveText("Eierseksjon i sameie");
  });

  test("C reklamasjon: type og part står etter feil, og saken lagres som forsikringskrav", async ({
    page,
  }) => {
    await logInAsManager(page);
    const { assignmentId, partyId, partyName } = await createAssignmentWithParty(uniqueSuffix());
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);
    const type = page.getByLabel(/^Type/);
    const party = page.getByLabel(/^Part/);

    await type.selectOption({ label: "Forsikringskrav" });
    await party.selectOption(partyId);
    await clickAndWaitForSave(page, button(page, "Lagre"));

    await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}/reklamasjoner/ny$`));
    await expect(page.getByLabel(/^Beskrivelse/)).toHaveAttribute("aria-invalid", "true");
    await expect(selected(type)).toHaveText("Forsikringskrav");
    await expect(party).toHaveValue(partyId);

    const description = `Fukt i kjeller ikke nevnt ${uniqueSuffix()}`;
    await page.getByLabel(/^Beskrivelse/).fill(description);
    await button(page, "Lagre").click();
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}$`));

    await region(page, "Reklamasjoner").getByRole("link").filter({ hasText: description }).click();
    await expect(page).toHaveURL(/\/reklamasjoner\/[0-9a-f-]{36}$/);
    await expect(selected(page.getByLabel(/^Type/))).toHaveText("Forsikringskrav");
    await expect(selected(page.getByLabel(/^Part/))).toHaveText(new RegExp(partyName));
  });

  test("D part: rollen og «Mottar» står etter feil i e-posten, og lagres når den er rettet", async ({
    page,
  }) => {
    await logIn(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    await page.goto(`/oppdrag/${assignmentId}`);
    const parties = region(page, "Parter");
    await button(parties, "Legg til part").click();
    const form = parties.locator("form").filter({ has: page.getByLabel(/^Rolle/) });
    const role = form.getByLabel(/^Rolle/);
    const report = form.getByRole("checkbox", { name: "Rapport", exact: true });
    const messages = form.getByRole("checkbox", { name: "Kopi av meldinger", exact: true });

    await role.selectOption({ label: "Megler" });
    await expect(report).toBeChecked();
    await messages.uncheck();
    await form.getByLabel(/^Navn/).fill("Megler Test");
    await form.getByLabel(/^E-post/).fill("feil@");
    await clickAndWaitForSave(page, button(form, "Lagre"));

    await expect(form.getByText("E-postadressen er ikke gyldig.")).toBeVisible();
    await expect(selected(role)).toHaveText("Megler");
    await expect(report).toBeChecked();
    await expect(messages).not.toBeChecked();

    await form.getByLabel(/^E-post/).fill("megler.test@example.com");
    await clickAndWaitForSave(page, button(form, "Lagre"));

    await page.reload();
    const card = region(page, "Parter").getByRole("listitem").filter({ hasText: "Megler Test" });
    await expect(card).toContainText("Megler");
    await expect(card).toContainText("Rapport");
    await expect(card).not.toContainText("Kopi av meldinger");
  });
});
