import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { ensureInspector, logIn, logInAsInspector, uniqueSuffix } from "./helpers";

/*
 * Eiendom og matrikkel på oppdraget (fase 2a).
 * Testplan: docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 7.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (7.8) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre og sitt
 * eget oppdrag (unik ending i adressen), fordi e2e-databasen ikke tømmes. Testdata er oppdiktet:
 * «Testveien 1», gnr 999, bnr 999, seksjonsnummer 9, «Borettslaget Test», «Forvalter Test».
 * Ingen e2e uten nett: eiendommen legges inn på kontoret med nett.
 *
 * Lokatorene bruker tilgjengelige roller: delene «Eiendom», «Team» og «Fellesdeler» er
 * landemerker (region) med overskriften som navn; feltene har synlige etiketter. Ja/Nei/Vet ikke
 * kan være nedtrekksliste eller radioknapper; hjelperen `chooseYesNo` tåler begge.
 *
 * Støtter hovedmål: tid (forhåndsutfylt fra ordren, tre valg og «Lagre eiendom», virker på iPad)
 * og reklamasjoner (boligtype og eierform påkrevd, fellesdeler for leilighet, ingenting slettes).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;

const PREFILL_LINE = "Fylt ut fra ordren. Kontroller før du lagrer.";
const ASSOCIATION = "Borettslaget Test";
const MANAGING_AGENT = "Forvalter Test";
const NOTES = "Sett trapperom og kjeller";

const CONDITION_REPORT = /^Finnes tilstandsrapport for fellesdelene/;
const MAINTENANCE_PLAN = /^Finnes vedlikeholdsplan/;

type OrderValues = { gnr?: string; bnr?: string; snr?: string; association?: string };

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

function section(page: Page, heading: "Eiendom" | "Team" | "Fellesdeler"): Locator {
  return page.getByRole("region", { name: heading, exact: true });
}

/** Feltene i «Eiendom», etter etiketten. */
const field = {
  address: (page: Page) => section(page, "Eiendom").getByLabel(/^Adresse/),
  postalCode: (page: Page) => section(page, "Eiendom").getByLabel(/^Postnummer/),
  city: (page: Page) => section(page, "Eiendom").getByLabel(/^Poststed/),
  municipalityNumber: (page: Page) => section(page, "Eiendom").getByLabel(/^Kommunenummer/),
  municipalityName: (page: Page) => section(page, "Eiendom").getByLabel(/^Kommune(?!nummer)/),
  housingType: (page: Page) => section(page, "Eiendom").getByLabel(/^Boligtype/),
  ownershipForm: (page: Page) => section(page, "Eiendom").getByLabel(/^Eierform/),
  gnr: (page: Page) => section(page, "Eiendom").getByLabel(/^(Gårdsnummer|Gnr)/i),
  bnr: (page: Page) => section(page, "Eiendom").getByLabel(/^(Bruksnummer|Bnr)/i),
  fnr: (page: Page) => section(page, "Eiendom").getByLabel(/^(Festenummer|Fnr)/i),
  snr: (page: Page) => section(page, "Eiendom").getByLabel(/^(Seksjonsnummer|Snr)/i),
  association: (page: Page) => section(page, "Eiendom").getByLabel(/^Borettslag/i),
  orgNumber: (page: Page) => section(page, "Eiendom").getByLabel(/^Organisasjonsnummer/),
  shareNumber: (page: Page) => section(page, "Eiendom").getByLabel(/^Andelsnummer/),
};

function savePropertyButton(page: Page): Locator {
  return section(page, "Eiendom").getByRole("button", { name: "Lagre eiendom", exact: true });
}

function saveCommonAreasButton(page: Page): Locator {
  return section(page, "Fellesdeler").getByRole("button", {
    name: "Lagre fellesdeler",
    exact: true,
  });
}

/** Ja/Nei/Vet ikke: nedtrekksliste eller radioknapper med spørsmålet som etikett. */
async function chooseYesNo(page: Page, question: RegExp, option: "Ja" | "Nei" | "Vet ikke") {
  const group = section(page, "Fellesdeler").getByRole("radiogroup", { name: question });
  if ((await group.count()) > 0) {
    await group.getByRole("radio", { name: option, exact: true }).check();
    return;
  }
  await section(page, "Fellesdeler").getByLabel(question).selectOption({ label: option });
}

async function expectYesNo(page: Page, question: RegExp, option: "Ja" | "Nei" | "Vet ikke") {
  const group = section(page, "Fellesdeler").getByRole("radiogroup", { name: question });
  if ((await group.count()) > 0) {
    await expect(group.getByRole("radio", { name: option, exact: true })).toBeChecked();
    return;
  }
  const select = section(page, "Fellesdeler").getByLabel(question);
  const selected = await select.evaluate(
    (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? "",
  );
  expect(selected).toBe(option);
}

/** Valgt etikett i en nedtrekksliste («» når ingenting er valgt). */
async function selectedLabel(select: Locator): Promise<string> {
  return select.evaluate((el) => {
    const s = el as HTMLSelectElement;
    return s.value === "" ? "" : (s.selectedOptions[0]?.textContent?.trim() ?? "");
  });
}

/** Ny ordre med adresse, matrikkel og borettslag → «Gjør om til oppdrag» (Bodø). */
async function createConvertedOrder(page: Page, address: string, values: OrderValues) {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(address);
  if (values.gnr) await page.getByLabel(/^(Gårdsnummer|Gnr)/i).fill(values.gnr);
  if (values.bnr) await page.getByLabel(/^(Bruksnummer|Bnr)/i).fill(values.bnr);
  if (values.snr) await page.getByLabel(/^(Seksjonsnummer|Snr)/i).fill(values.snr);
  if (values.association) await page.getByLabel(/^Borettslag/i).fill(values.association);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);

  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");
}

/** Ny ordre → gjør om → åpne oppdraget. Returnerer oppdrags-id og adressen. */
async function newAssignment(
  page: Page,
  values: OrderValues = { gnr: "999", bnr: "999", snr: "9", association: ASSOCIATION },
): Promise<{ assignmentId: string; address: string }> {
  const address = `Testveien 1 ${uniqueSuffix()}`;
  await createConvertedOrder(page, address, values);
  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return { assignmentId: ASSIGNMENT_URL.exec(page.url())![1]!, address };
}

/** Velger boligtype og eierform og lagrer eiendommen. */
async function saveProperty(page: Page, housingType: string, ownershipForm: string) {
  await field.housingType(page).selectOption({ label: housingType });
  await field.ownershipForm(page).selectOption({ label: ownershipForm });
  await savePropertyButton(page).click();
  await expect(page.getByText(PREFILL_LINE)).toHaveCount(0);
  await expect.poll(() => selectedLabel(field.housingType(page))).toBe(housingType);
}

async function fillCommonAreas(page: Page) {
  const areas = section(page, "Fellesdeler");
  await areas.getByLabel(/^Forretningsfører/).fill(MANAGING_AGENT);
  await chooseYesNo(page, CONDITION_REPORT, "Ja");
  await chooseYesNo(page, MAINTENANCE_PLAN, "Vet ikke");
  await areas.getByLabel(/^Hva er sett av fellesdelene/).fill(NOTES);
  await saveCommonAreasButton(page).click();
}

async function expectCommonAreasValues(page: Page) {
  const areas = section(page, "Fellesdeler");
  await expect(areas).toBeVisible();
  await expect(areas.getByLabel(/^Forretningsfører/)).toHaveValue(MANAGING_AGENT);
  await expectYesNo(page, CONDITION_REPORT, "Ja");
  await expectYesNo(page, MAINTENANCE_PLAN, "Vet ikke");
  await expect(areas.getByLabel(/^Hva er sett av fellesdelene/)).toHaveValue(NOTES);
}

test.describe("eiendom og matrikkel på oppdraget (pc og ipad)", () => {
  test("7.1 «Eiendom» står over «Team» og er forhåndsutfylt fra ordren", async ({ page }) => {
    await logIn(page);
    const { address } = await newAssignment(page);

    const property = section(page, "Eiendom");
    await expect(property).toBeVisible();
    await expect(property).toContainText(PREFILL_LINE);
    const propertyBox = await property.boundingBox();
    const teamBox = await section(page, "Team").boundingBox();
    expect(propertyBox && teamBox, "Eiendom og Team er synlige").toBeTruthy();
    expect(propertyBox!.y, "Eiendom står over Team").toBeLessThan(teamBox!.y);

    await expect(field.address(page)).toHaveValue(address);
    await expect(field.gnr(page)).toHaveValue("999");
    await expect(field.bnr(page)).toHaveValue("999");
    await expect(field.snr(page)).toHaveValue("9");
    await expect(field.association(page)).toHaveValue(ASSOCIATION);
    await expect(field.postalCode(page)).toHaveValue("");
    await expect(field.city(page)).toHaveValue("");
    await expect(field.fnr(page)).toHaveValue("");
    expect(await selectedLabel(field.housingType(page))).toBe("");
    expect(await selectedLabel(field.ownershipForm(page))).toBe("");
    await expect(section(page, "Fellesdeler")).toHaveCount(0);
  });

  test("7.2 «Lagre eiendom» uten boligtype og eierform gir feil ved feltene, og ingenting lagres", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);

    await savePropertyButton(page).click();
    await expect(section(page, "Eiendom").getByText("Velg boligtype.")).toBeVisible();
    await expect(section(page, "Eiendom").getByText("Velg eierform.")).toBeVisible();
    await expect(field.housingType(page)).toHaveAttribute("aria-describedby", /.+/);

    await page.reload();
    await expect(section(page, "Eiendom")).toContainText(PREFILL_LINE);
    expect(await selectedLabel(field.housingType(page))).toBe("");
  });

  test("7.3 leilighet i borettslag: lagre eiendom, fyll ut og lagre fellesdeler, verdiene står etter ny lasting", async ({
    page,
  }) => {
    await logIn(page);
    const { address } = await newAssignment(page);

    await saveProperty(page, "Leilighet", "Andel i borettslag");
    await expect(section(page, "Fellesdeler")).toBeVisible();
    await fillCommonAreas(page);
    await expect(section(page, "Fellesdeler").getByLabel(/^Forretningsfører/)).toHaveValue(
      MANAGING_AGENT,
    );

    await page.reload();
    await expect(section(page, "Eiendom")).not.toContainText(PREFILL_LINE);
    await expect(field.address(page)).toHaveValue(address);
    await expect(field.gnr(page)).toHaveValue("999");
    await expect(field.association(page)).toHaveValue(ASSOCIATION);
    expect(await selectedLabel(field.housingType(page))).toBe("Leilighet");
    expect(await selectedLabel(field.ownershipForm(page))).toBe("Andel i borettslag");
    await expectCommonAreasValues(page);
  });

  test("7.4 bytte til enebolig skjuler «Fellesdeler»; bytte tilbake viser de gamle verdiene", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await saveProperty(page, "Leilighet", "Andel i borettslag");
    await fillCommonAreas(page);
    await page.reload();
    await expectCommonAreasValues(page);

    await saveProperty(page, "Enebolig", "Selveier");
    await expect(section(page, "Fellesdeler")).toHaveCount(0);
    await page.reload();
    await expect(section(page, "Fellesdeler")).toHaveCount(0);

    await field.housingType(page).selectOption({ label: "Leilighet" });
    await savePropertyButton(page).click();
    await expect(section(page, "Fellesdeler")).toBeVisible();
    await page.reload();
    await expectCommonAreasValues(page);
  });

  test("7.5 feilmeldinger står ved feltet", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);

    await field.housingType(page).selectOption({ label: "Enebolig" });
    await field.ownershipForm(page).selectOption({ label: "Selveier" });
    await field.gnr(page).fill("12a");
    await field.postalCode(page).fill("123");
    await field.address(page).fill("Testveien 12345678901");
    await savePropertyButton(page).click();

    const property = section(page, "Eiendom");
    await expect(property.getByText("Gårdsnummer kan bare ha sifre.")).toBeVisible();
    await expect(property.getByText("Postnummeret må ha fire sifre.")).toBeVisible();
    await expect(property.getByText("Fødselsnummer skal ikke lagres her.")).toBeVisible();
    await expect(field.gnr(page)).toHaveAttribute("aria-describedby", /.+/);

    await page.reload();
    await expect(section(page, "Eiendom")).toContainText(PREFILL_LINE);
  });

  test("7.6 takstmann ser «Eiendom» med verdiene", async ({ page, browser }) => {
    await ensureInspector();
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const { assignmentId, address } = await newAssignment(adminPage);
    await saveProperty(adminPage, "Leilighet", "Andel i borettslag");
    await adminContext.close();

    await logInAsInspector(page);
    const url = `/oppdrag/${assignmentId}`;
    const response = await page.goto(url);
    expectNoServerError(response, url);
    const property = section(page, "Eiendom");
    await expect(property).toBeVisible();
    // Verdien står enten i et felt (kan endre) eller som tekst (bare se)
    const asInput = await field.address(page).count();
    if (asInput > 0) await expect(field.address(page)).toHaveValue(address);
    else await expect(property).toContainText(address);
    await expect(property).toContainText("Leilighet");
  });

  test("7.7 ukjent oppdrags-id gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    for (const url of [`/oppdrag/${randomUUID()}`, "/oppdrag/ikke-en-id"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
    }
  });
});

test.describe("iPad og tastatur (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7.8 stående: ingen vannrett rulling, én kolonne, knapper og nedtrekkslister minst 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const { assignmentId } = await newAssignment(page);
    await saveProperty(page, "Leilighet", "Andel i borettslag");

    const url = `/oppdrag/${assignmentId}`;
    await page.goto(url);
    await expectNoHorizontalScroll(page, url);

    // Én kolonne: feltene i «Eiendom» starter likt og står under hverandre
    const boxes = [];
    for (const make of [
      field.address,
      field.postalCode,
      field.city,
      field.housingType,
      field.ownershipForm,
      field.gnr,
      field.bnr,
    ]) {
      const box = await make(page).boundingBox();
      expect(box, "feltet er synlig").not.toBeNull();
      boxes.push(box!);
    }
    for (const box of boxes) expect(Math.round(box.x)).toBe(Math.round(boxes[0]!.x));
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
    }

    await expectAtLeast44(field.housingType(page), "Boligtype");
    await expectAtLeast44(field.ownershipForm(page), "Eierform");
    await expectAtLeast44(savePropertyButton(page), "Lagre eiendom");
    await expectAtLeast44(saveCommonAreasButton(page), "Lagre fellesdeler");
  });

  test("7.9 eiendomsskjemaet fylles ut og sendes med tastaturet alene", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);
    const housingType = field.housingType(page);
    const ownershipForm = field.ownershipForm(page);

    // Tab til boligtype, velg «Leilighet» med piltastene
    await page.locator("body").focus();
    for (let i = 0; i < 80; i++) {
      if (await housingType.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(housingType).toBeFocused();
    for (let i = 0; i < 10; i++) {
      if ((await housingType.inputValue()) === "apartment") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(housingType).toHaveValue("apartment");

    // Tab til eierform, velg «Andel i borettslag»
    for (let i = 0; i < 5; i++) {
      if (await ownershipForm.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(ownershipForm).toBeFocused();
    for (let i = 0; i < 6; i++) {
      if ((await ownershipForm.inputValue()) === "cooperative") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(ownershipForm).toHaveValue("cooperative");

    // Tab til gårdsnummer og send med Enter
    const gnr = field.gnr(page);
    for (let i = 0; i < 5; i++) {
      if (await gnr.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(gnr).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(section(page, "Fellesdeler")).toBeVisible();
    await expect(page.getByText(PREFILL_LINE)).toHaveCount(0);
  });
});
