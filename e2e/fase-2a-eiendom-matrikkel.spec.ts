import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Eiendom og matrikkel på oppdraget, med fellesdeler for leilighet (fase 2a).
 * Testplan: docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 7.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (7.8) og tastaturtesten (7.9) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre og sitt
 * eget oppdrag (unik ending i adressen), fordi e2e-databasen ikke tømmes. Testdata er oppdiktet:
 * «Testveien 1 <ending>», gnr/bnr 999, seksjonsnummer 9, «Borettslaget Test», organisasjonsnummer
 * 000000000, «Forvalter Test».
 * Ingen e2e uten nett: eiendommen legges inn på kontoret med nett.
 *
 * Lokatorene bruker tilgjengelige roller: delene «Eiendom» og «Fellesdeler» er landemerker
 * (region) med overskriften som navn. Feltene finnes med etiketten (getByLabel). Spørsmålene om
 * tilstandsrapport og vedlikeholdsplan kan være nedtrekksliste eller radioknapper; hjelperen
 * `chooseYesNo` tåler begge.
 *
 * Støtter hovedmål: tid (forhåndsutfylt fra ordren, få trykk, virker på iPad) og reklamasjoner
 * (fellesdeler bare for leilighet, eierseksjon, borettslag og aksje, og ingenting slettes).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;

const PREFILL_LINE = "Fylt ut fra ordren. Kontroller før du lagrer.";
const ASSOCIATION = "Borettslaget Test";
const AGENT = "Forvalter Test";
const NOTES = "Sett trapperom og kjeller";
const CONDITION_REPORT = /^Finnes tilstandsrapport for fellesdelene/;
const MAINTENANCE_PLAN = /^Finnes vedlikeholdsplan/;

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

/** Delen med overskriften, som landemerke. */
function section(page: Page, heading: "Eiendom" | "Fellesdeler" | "Team"): Locator {
  return page.getByRole("region", { name: heading, exact: true });
}

/** Feltene i «Eiendom», i rekkefølgen fra kortet punkt 8. */
const FIELD = {
  address: /^Adresse/,
  postalCode: /^Postnummer/,
  city: /^Poststed/,
  municipalityNumber: /^Kommunenummer/,
  municipalityName: /^Kommune(?!nummer)/,
  housingType: /^Boligtype/,
  ownershipForm: /^Eierform/,
  gnr: /^Gårdsnummer/,
  bnr: /^Bruksnummer/,
  fnr: /^Festenummer/,
  snr: /^Seksjonsnummer/,
  associationName: /^Borettslag/,
  associationOrgNumber: /^Organisasjonsnummer/,
  shareNumber: /^Andelsnummer/,
} as const;

function field(page: Page, name: keyof typeof FIELD): Locator {
  return section(page, "Eiendom").getByLabel(FIELD[name]);
}

function saveProperty(page: Page): Locator {
  return section(page, "Eiendom").getByRole("button", { name: "Lagre eiendom", exact: true });
}

function saveCommon(page: Page): Locator {
  return section(page, "Fellesdeler").getByRole("button", {
    name: "Lagre fellesdeler",
    exact: true,
  });
}

/** Spørsmålet om ja/nei/vet ikke: nedtrekksliste eller gruppe med radioknapper. */
function yesNoSelect(region: Locator, question: RegExp): Locator {
  return region.getByRole("combobox", { name: question });
}

function yesNoGroup(region: Locator, question: RegExp): Locator {
  return region
    .getByRole("radiogroup", { name: question })
    .or(region.getByRole("group", { name: question }));
}

async function chooseYesNo(region: Locator, question: RegExp, label: "Ja" | "Nei" | "Vet ikke") {
  const select = yesNoSelect(region, question);
  if ((await select.count()) > 0) {
    await select.selectOption({ label });
    return;
  }
  await yesNoGroup(region, question).getByRole("radio", { name: label, exact: true }).check();
}

async function expectYesNo(region: Locator, question: RegExp, label: "Ja" | "Nei" | "Vet ikke") {
  const select = yesNoSelect(region, question);
  if ((await select.count()) > 0) {
    await expect(select.locator("option:checked")).toHaveText(label);
    return;
  }
  await expect(
    yesNoGroup(region, question).getByRole("radio", { name: label, exact: true }),
  ).toBeChecked();
}

/** Ny ordre med adresse og matrikkel → «Gjør om til oppdrag» (Bodø) → åpne oppdraget. */
async function newAssignmentFromOrder(
  page: Page,
  values: { address: string; gnr?: string; bnr?: string; snr?: string; association?: string },
): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(values.address);
  if (values.gnr) await page.getByLabel(/^Gårdsnummer/).fill(values.gnr);
  if (values.bnr) await page.getByLabel(/^Bruksnummer/).fill(values.bnr);
  if (values.snr) await page.getByLabel(/^Seksjonsnummer/).fill(values.snr);
  if (values.association) await page.getByLabel(/^Borettslag/).fill(values.association);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);

  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");

  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

/** Oppdrag fra en ordre med gnr, bnr, seksjonsnummer og borettslag. */
async function newPrefilledAssignment(page: Page) {
  const address = `Testveien 1 ${uniqueSuffix()}`;
  const assignmentId = await newAssignmentFromOrder(page, {
    address,
    gnr: "999",
    bnr: "999",
    snr: "9",
    association: ASSOCIATION,
  });
  return { address, assignmentId };
}

/**
 * Trykk knappen og vent på svaret fra server-handlingen (POST med «next-action»). Serveren sender
 * svaret først når handlingen har lagret, så en `page.reload()` etterpå kan ikke avbryte
 * lagringen.
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

/** Velg boligtype og eierform og lagre. Venter til lagringen er ferdig og siden er oppdatert. */
async function savePropertyAs(page: Page, housing: string, ownership: string) {
  await field(page, "housingType").selectOption({ label: housing });
  await field(page, "ownershipForm").selectOption({ label: ownership });
  await clickAndWaitForSave(page, saveProperty(page));
  await expect(section(page, "Eiendom")).not.toContainText(PREFILL_LINE);
  await expect(field(page, "housingType").locator("option:checked")).toHaveText(housing);
}

async function fillCommonAreas(page: Page) {
  const common = section(page, "Fellesdeler");
  await common.getByLabel(/^Forretningsfører/).fill(AGENT);
  await chooseYesNo(common, CONDITION_REPORT, "Ja");
  await chooseYesNo(common, MAINTENANCE_PLAN, "Vet ikke");
  await common.getByLabel(/^Hva er sett av fellesdelene/).fill(NOTES);
  await clickAndWaitForSave(page, saveCommon(page));
}

async function expectCommonAreasSaved(page: Page) {
  const common = section(page, "Fellesdeler");
  await expect(common.getByLabel(/^Forretningsfører/)).toHaveValue(AGENT);
  await expectYesNo(common, CONDITION_REPORT, "Ja");
  await expectYesNo(common, MAINTENANCE_PLAN, "Vet ikke");
  await expect(common.getByLabel(/^Hva er sett av fellesdelene/)).toHaveValue(NOTES);
}

test.describe("eiendom og matrikkel på oppdraget (pc og ipad)", () => {
  test("7.1 forhåndsutfylling: «Eiendom» over «Team», ordrens verdier, ingen boligtype eller eierform valgt", async ({
    page,
  }) => {
    await logIn(page);
    const { address } = await newPrefilledAssignment(page);

    const property = section(page, "Eiendom");
    await expect(property).toBeVisible();
    await expect(property).toContainText(PREFILL_LINE);

    const propertyBox = await property.boundingBox();
    const teamBox = await section(page, "Team").boundingBox();
    expect(propertyBox && teamBox, "Eiendom og Team er synlige").toBeTruthy();
    expect(propertyBox!.y, "Eiendom står over Team").toBeLessThan(teamBox!.y);

    // Adressen er én tekst, ikke delt opp (A68)
    await expect(field(page, "address")).toHaveValue(address);
    await expect(field(page, "gnr")).toHaveValue("999");
    await expect(field(page, "bnr")).toHaveValue("999");
    await expect(field(page, "snr")).toHaveValue("9");
    await expect(field(page, "associationName")).toHaveValue(ASSOCIATION);
    await expect(field(page, "postalCode")).toHaveValue("");
    await expect(field(page, "city")).toHaveValue("");
    await expect(field(page, "housingType")).toHaveValue("");
    await expect(field(page, "ownershipForm")).toHaveValue("");

    // Feltene står i kortets rekkefølge
    const order = await Promise.all(
      (Object.keys(FIELD) as (keyof typeof FIELD)[]).map(async (name) => {
        const box = await field(page, name).boundingBox();
        expect(box, `${name} er synlig`).not.toBeNull();
        return { name, y: Math.round(box!.y), x: Math.round(box!.x) };
      }),
    );
    for (let i = 1; i < order.length; i++) {
      const before = order[i - 1]!;
      const current = order[i]!;
      // Samme rad når forskjellen i høyde er liten (to kolonner på PC)
      const sameRow = Math.abs(current.y - before.y) <= 4;
      expect(
        sameRow ? current.x > before.x : current.y > before.y,
        `${current.name} står etter ${before.name}`,
      ).toBe(true);
    }

    // Uten lagret eiendom vises ikke fellesdeler
    await expect(section(page, "Fellesdeler")).toHaveCount(0);
  });

  test("7.2 påkrevd: «Lagre eiendom» uten boligtype og eierform gir feil ved feltene, og ingenting lagres", async ({
    page,
  }) => {
    await logIn(page);
    await newPrefilledAssignment(page);

    await saveProperty(page).click();
    const property = section(page, "Eiendom");
    await expect(property.getByText("Velg boligtype.")).toBeVisible();
    await expect(property.getByText("Velg eierform.")).toBeVisible();
    await expect(field(page, "housingType")).toHaveAttribute("aria-describedby", /.+/);

    await page.reload();
    await expect(section(page, "Eiendom")).toContainText(PREFILL_LINE);
    await expect(section(page, "Fellesdeler")).toHaveCount(0);
  });

  test("7.3–7.4 leilighet i borettslag → fellesdeler lagres og står etter ny lasting; enebolig skjuler dem, og de kommer tilbake", async ({
    page,
  }) => {
    await logIn(page);
    const { address } = await newPrefilledAssignment(page);

    await savePropertyAs(page, "Leilighet", "Andel i borettslag");
    await expect(section(page, "Fellesdeler")).toBeVisible();
    await fillCommonAreas(page);

    await page.reload();
    await expect(section(page, "Eiendom")).not.toContainText(PREFILL_LINE);
    await expect(field(page, "address")).toHaveValue(address);
    await expect(field(page, "gnr")).toHaveValue("999");
    await expect(field(page, "associationName")).toHaveValue(ASSOCIATION);
    await expect(field(page, "housingType").locator("option:checked")).toHaveText("Leilighet");
    await expect(field(page, "ownershipForm").locator("option:checked")).toHaveText(
      "Andel i borettslag",
    );
    await expectCommonAreasSaved(page);

    // 7.4 Bytt til enebolig og selveier: «Fellesdeler» er borte
    await savePropertyAs(page, "Enebolig", "Selveier");
    await expect(section(page, "Fellesdeler")).toHaveCount(0);
    await page.reload();
    await expect(section(page, "Fellesdeler")).toHaveCount(0);

    // Bytt tilbake: de gamle verdiene står (ingenting slettet)
    await savePropertyAs(page, "Leilighet", "Andel i borettslag");
    await expect(section(page, "Fellesdeler")).toBeVisible();
    await expectCommonAreasSaved(page);
  });

  test("7.5 feilmeldinger ved feltet: gnr med bokstav, postnummer med tre sifre, fødselsnummer i adressen", async ({
    page,
  }) => {
    await logIn(page);
    await newPrefilledAssignment(page);
    const property = section(page, "Eiendom");

    await field(page, "housingType").selectOption({ label: "Enebolig" });
    await field(page, "ownershipForm").selectOption({ label: "Selveier" });
    await field(page, "gnr").fill("12a");
    await field(page, "postalCode").fill("123");
    await field(page, "address").fill("Testveien 12345678901");
    await saveProperty(page).click();

    await expect(property.getByText("Gårdsnummer kan bare ha sifre.")).toBeVisible();
    await expect(property.getByText("Postnummeret må ha fire sifre.")).toBeVisible();
    await expect(property.getByText("Fødselsnummer skal ikke lagres her.")).toBeVisible();
    // Verdiene står igjen
    await expect(field(page, "gnr")).toHaveValue("12a");

    await page.reload();
    await expect(section(page, "Eiendom")).toContainText(PREFILL_LINE);
  });

  test("7.6 takstmann ser «Eiendom» med lagret adresse", async ({ page, browser }) => {
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const { address, assignmentId } = await newPrefilledAssignment(adminPage);
    await savePropertyAs(adminPage, "Rekkehus", "Selveier");
    await adminContext.close();

    await logInAsInspector(page);
    const url = `/oppdrag/${assignmentId}`;
    const response = await page.goto(url);
    expectNoServerError(response, url);
    const property = section(page, "Eiendom");
    await expect(property).toBeVisible();
    const addressField = property.getByLabel(FIELD.address);
    if ((await addressField.count()) > 0) {
      await expect(addressField).toHaveValue(address);
    } else {
      await expect(property).toContainText(address);
      await expect(property).toContainText("Rekkehus");
    }
  });

  test("7.7 ukjent oppdrags-id gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    for (const url of [`/oppdrag/${randomUUID()}`, "/oppdrag/ikke-en-id"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      await expect(section(page, "Eiendom")).toHaveCount(0);
    }
  });
});

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7.8 stående: ingen vannrett rulling, én kolonne, knapper og nedtrekkslister minst 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const { assignmentId } = await newPrefilledAssignment(page);
    await savePropertyAs(page, "Leilighet", "Eierseksjon i sameie");

    const url = `/oppdrag/${assignmentId}`;
    await page.goto(url);
    await expectNoHorizontalScroll(page, url);

    // Én kolonne: feltene starter likt og står under hverandre
    const names = ["address", "postalCode", "city", "housingType", "ownershipForm", "gnr"] as const;
    const boxes = await Promise.all(names.map((name) => field(page, name).boundingBox()));
    for (const [index, box] of boxes.entries()) {
      expect(box, `${names[index]} er synlig`).not.toBeNull();
      expect(Math.round(box!.x), `${names[index]} starter i samme kolonne`).toBe(
        Math.round(boxes[0]!.x),
      );
      if (index > 0) expect(box!.y).toBeGreaterThan(boxes[index - 1]!.y);
    }

    // Eiendom og Fellesdeler står under hverandre
    const propertyBox = await section(page, "Eiendom").boundingBox();
    const commonBox = await section(page, "Fellesdeler").boundingBox();
    expect(propertyBox && commonBox, "begge delene er synlige").toBeTruthy();
    expect(commonBox!.y).toBeGreaterThanOrEqual(propertyBox!.y + propertyBox!.height - 1);

    await expectAtLeast44(saveProperty(page), "Lagre eiendom");
    await expectAtLeast44(saveCommon(page), "Lagre fellesdeler");
    await expectAtLeast44(field(page, "housingType"), "Boligtype");
    await expectAtLeast44(field(page, "ownershipForm"), "Eierform");
    const common = section(page, "Fellesdeler");
    const conditionSelect = yesNoSelect(common, CONDITION_REPORT);
    if ((await conditionSelect.count()) > 0) {
      await expectAtLeast44(conditionSelect, "Finnes tilstandsrapport");
    }
  });

  test("7.9 eiendomsskjemaet fylles ut og sendes med tastaturet alene", async ({ page }) => {
    await logIn(page);
    await newPrefilledAssignment(page);
    const housing = field(page, "housingType");
    const ownership = field(page, "ownershipForm");
    const gnr = field(page, "gnr");

    // Tab til boligtypen, velg «Leilighet» med piltastene
    await page.locator("body").focus();
    for (let i = 0; i < 120; i++) {
      if (await housing.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(housing).toBeFocused();
    for (let i = 0; i < 10; i++) {
      if ((await housing.inputValue()) === "apartment") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(housing).toHaveValue("apartment");

    // Tab til eierformen, velg «Andel i borettslag»
    for (let i = 0; i < 10; i++) {
      if (await ownership.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(ownership).toBeFocused();
    for (let i = 0; i < 6; i++) {
      if ((await ownership.inputValue()) === "cooperative") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(ownership).toHaveValue("cooperative");

    // Tab til gårdsnummeret (forhåndsutfylt) og send med Enter
    for (let i = 0; i < 10; i++) {
      if (await gnr.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(gnr).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(section(page, "Fellesdeler")).toBeVisible();
    await expect(section(page, "Eiendom")).not.toContainText(PREFILL_LINE);
  });
});
