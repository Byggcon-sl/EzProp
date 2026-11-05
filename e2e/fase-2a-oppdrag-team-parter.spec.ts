import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  ADMIN_EMAIL,
  employeeByEmail,
  ensureInspectorCompany,
  ensureLongCompanyEmployee,
  INSPECTOR_EMAIL,
  LONG_COMPANY_NAME,
  logIn,
  logInAsInspector,
  uniqueSuffix,
} from "./helpers";

/*
 * Team og parter på oppdraget (fase 2a).
 * Testplan: docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 7.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (7.8) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sin egen ordre og sitt
 * eget oppdrag (unik ending i adressen), fordi e2e-databasen ikke tømmes. Partene er oppdiktet:
 * «Megler Test», «Testmegling AS», megler@example.com, telefon 00000000, grunn «Ferie».
 * Ingen e2e uten nett: oppdraget settes opp på kontoret med nett.
 *
 * Lokatorene bruker tilgjengelige roller: seksjonene «Team» og «Parter» er landemerker (region);
 * hver rolle i teamet er et listeelement med rollens etikett som navn, med én nedtrekksliste,
 * feltet «Grunn ved bytte» og «Lagre»; partene er listeelementer (kort); skjemaet for part har
 * feltene «Rolle», «Navn», «Firma», «E-post», «Telefon» og avkrysningene «Rapport», «Faktura» og
 * «Kopi av meldinger».
 *
 * Utstedende selskap (docs/agenter/oppgaver/fase2a-utstedende-selskap-testplan.md avsnitt 7):
 * linjen «Utstedende selskap» under «Kontor» prøves i 7.2 og 7.8. Takstmannen for e2e får
 * «Byggcon Nord AS» fra seed (`ensureInspectorCompany`), og iPad-testen bruker et oppdiktet
 * selskap med langt navn (`ensureLongCompanyEmployee`).
 *
 * Støtter hovedmål: tid (få trykk, mottar forhåndsutfylt etter rollen, virker på iPad) og
 * reklamasjoner (hvem som har ansvaret står på oppdraget, og fra hvilket selskap).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;

const TEAM_LABELS = [
  "Ansvarlig takstmann",
  "Medansvarlig",
  "Befaringstakstmann",
  "Sidemann",
  "Saksbehandler",
];

const PARTY = {
  name: "Megler Test",
  firm: "Testmegling AS",
  email: "megler@example.com",
  phone: "00000000",
};

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

/** Seksjonen med overskriften (Team eller Parter), som landemerke. */
function section(page: Page, heading: "Team" | "Parter"): Locator {
  return page.getByRole("region", { name: heading, exact: true });
}

/** Linjen for én rolle i teamet (listeelement med rollens etikett som navn). */
function teamLine(page: Page, label: string): Locator {
  return section(page, "Team").getByRole("listitem", { name: label, exact: true });
}

/**
 * Den lagrede personen på linjen (teksten under rollens navn, eller «Ikke satt»). Den kommer fra
 * serveren, så den viser når lagringen er ferdig og skjemaet er tegnet på nytt.
 */
function teamCurrent(page: Page, label: string): Locator {
  return teamLine(page, label).locator("h3 + p");
}

/** Nedtrekkslisten med ansatte på linjen. */
function teamSelect(page: Page, label: string): Locator {
  return teamLine(page, label).getByRole("combobox");
}

function partyCards(page: Page): Locator {
  return section(page, "Parter").getByRole("listitem");
}

function partyCard(page: Page, name: string): Locator {
  return partyCards(page).filter({ hasText: name });
}

const EMPTY_PARTIES = "Ingen parter er lagt inn ennå.";

const COMPANY_LABEL = "Utstedende selskap";
const COMPANY_HELP =
  "Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn under Ansatte.";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Linjen «Utstedende selskap: <verdi>» (kolon og mellomrom er valgfrie i oppsettet). */
function companyLine(value: string): RegExp {
  return new RegExp(`${COMPANY_LABEL}:?\\s*${escapeRegExp(value)}`);
}

/** Linjen for utstedende selskap står under «Kontor» og over «Team». */
async function expectCompanyLineUnderOffice(page: Page) {
  const text = (await page.getByRole("main").textContent()) ?? "";
  const office = text.indexOf("Kontor");
  const company = text.indexOf(COMPANY_LABEL);
  const team = text.indexOf("Team");
  expect(office, "«Kontor» står på siden").toBeGreaterThanOrEqual(0);
  expect(company, "«Utstedende selskap» står under «Kontor»").toBeGreaterThan(office);
  expect(company, "«Utstedende selskap» står over teamet").toBeLessThan(team);
}

/** Ny ordre med en unik adresse → «Gjør om til oppdrag» (Bodø). Returnerer ordre-id. */
async function createConvertedOrder(page: Page): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Testveien 12 ${uniqueSuffix()}, 8000 Bodø`);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);
  const orderId = ORDER_URL.exec(page.url())![1]!;

  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");
  return orderId;
}

/** Fra ordresiden: lenken til oppdraget. Returnerer oppdrags-id. */
async function openAssignmentFromOrder(page: Page): Promise<string> {
  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

/** Ny ordre → gjør om → åpne oppdraget. */
async function newAssignment(page: Page): Promise<{ orderId: string; assignmentId: string }> {
  const orderId = await createConvertedOrder(page);
  const assignmentId = await openAssignmentFromOrder(page);
  return { orderId, assignmentId };
}

/** Skjemaet «Legg til part». Åpner det først hvis «Legg til part» er en knapp. */
async function openAddPartyForm(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: "Legg til part", exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    const form = page.locator("form").filter({ has: page.getByLabel(/^Rolle/) });
    if ((await form.count()) === 0) await button.first().click();
  }
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel(/^Rolle/) })
    .first();
  await expect(form).toBeVisible();
  return form;
}

function checkbox(form: Locator, label: "Rapport" | "Faktura" | "Kopi av meldinger"): Locator {
  return form.getByRole("checkbox", { name: label, exact: true });
}

async function fillParty(form: Locator, values: Partial<typeof PARTY>) {
  if (values.name !== undefined) await form.getByLabel(/^Navn/).fill(values.name);
  if (values.firm !== undefined) await form.getByLabel(/^Firma/).fill(values.firm);
  if (values.email !== undefined) await form.getByLabel(/^E-post/).fill(values.email);
  if (values.phone !== undefined) await form.getByLabel(/^Telefon/).fill(values.phone);
}

async function saveForm(form: Locator) {
  await form.getByRole("button", { name: "Lagre", exact: true }).click();
}

test.describe("team og parter på oppdraget (pc og ipad)", () => {
  test("7.1 ordre → gjør om → oppdraget; lenkene går begge veier", async ({ page }) => {
    await logIn(page);
    const { orderId, assignmentId } = await newAssignment(page);

    const main = page.getByRole("main");
    await expect(main).toContainText(NUMBER);
    await expect(main).toContainText("Bodø");
    await expect(main.getByText("Bestilt", { exact: true }).first()).toBeVisible();

    await main.getByRole("link", { name: "Ordren", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/ordre/${orderId}$`));

    await openAssignmentFromOrder(page);
    expect(page.url()).toContain(`/oppdrag/${assignmentId}`);
  });

  test("7.2 team: fem linjer i fast rekkefølge; sett, bytt med grunn og fjern ansvarlig", async ({
    page,
  }) => {
    const inspectorCompany = await ensureInspectorCompany();
    const admin = await employeeByEmail(ADMIN_EMAIL);
    const inspector = await employeeByEmail(INSPECTOR_EMAIL);
    await logIn(page);
    await newAssignment(page);

    // Utstedende selskap: «Ikke satt» med forklaring før ansvarlig er satt, under «Kontor»
    const main = page.getByRole("main");
    await expect(main).toContainText(companyLine("Ikke satt"));
    await expect(main).toContainText(COMPANY_HELP);
    await expectCompanyLineUnderOffice(page);

    const team = section(page, "Team");
    await expect(team).toBeVisible();
    const text = (await team.textContent()) ?? "";
    const positions = TEAM_LABELS.map((label) => text.indexOf(label));
    expect(
      positions.every((p) => p >= 0),
      `alle fem rollene står: ${positions}`,
    ).toBe(true);
    expect(
      [...positions].sort((a, b) => a - b),
      "fast rekkefølge",
    ).toEqual(positions);
    await expect(team.getByText("Ikke satt", { exact: true })).toHaveCount(5);

    // Sett admin som ansvarlig
    const responsible = "Ansvarlig takstmann";
    await teamSelect(page, responsible).selectOption(admin.id);
    await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(teamCurrent(page, responsible)).toHaveText(admin.name);
    await expect(team.getByText("Ikke satt", { exact: true })).toHaveCount(4);
    await expect(teamLine(page, responsible).getByText("Ikke satt", { exact: true })).toHaveCount(
      0,
    );
    await expect(teamSelect(page, responsible)).toHaveValue(admin.id);

    // Bytt til takstmannen med grunn «Ferie»
    await teamSelect(page, responsible).selectOption(inspector.id);
    await teamLine(page, responsible)
      .getByLabel(/^Grunn ved bytte/)
      .fill("Ferie");
    await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
    // Vent til byttet er lagret: linjen viser takstmannen og «Grunn ved bytte» er tømt
    await expect(teamCurrent(page, responsible)).toHaveText(inspector.name);
    await expect(teamLine(page, responsible).getByLabel(/^Grunn ved bytte/)).toHaveValue("");
    await expect(teamSelect(page, responsible)).toHaveValue(inspector.id);
    await expect(team.getByText("Ikke satt", { exact: true })).toHaveCount(4);
    // Takstmannen har selskap: navnet står som utstedende selskap
    await expect(main).toContainText(companyLine(inspectorCompany));
    await expectCompanyLineUnderOffice(page);

    // «Ingen» fjerner personen fra rollen
    await teamSelect(page, responsible).selectOption({ label: "Ingen" });
    await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(teamCurrent(page, responsible)).toHaveText("Ikke satt");
    await expect(team.getByText("Ikke satt", { exact: true })).toHaveCount(5);
    await expect(teamSelect(page, responsible)).toHaveValue("");
    // Uten ansvarlig er selskapet tomt igjen (A66)
    await expect(main).toContainText(companyLine("Ikke satt"));
    await expect(main).toContainText(COMPANY_HELP);
    await expect(main).not.toContainText(companyLine(inspectorCompany));
  });

  test("7.3 parter: tom liste, forhåndsutfylte mottar-valg, legg til megler", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);

    await expect(section(page, "Parter")).toContainText(EMPTY_PARTIES);
    const form = await openAddPartyForm(page);
    const role = form.getByLabel(/^Rolle/);

    await role.selectOption({ label: "Megler" });
    await expect(checkbox(form, "Rapport")).toBeChecked();
    await expect(checkbox(form, "Kopi av meldinger")).toBeChecked();
    await expect(checkbox(form, "Faktura")).not.toBeChecked();

    await role.selectOption({ label: "Fakturamottaker" });
    await expect(checkbox(form, "Faktura")).toBeChecked();
    await expect(checkbox(form, "Rapport")).not.toBeChecked();
    await expect(checkbox(form, "Kopi av meldinger")).not.toBeChecked();

    await role.selectOption({ label: "Megler" });
    await expect(checkbox(form, "Rapport")).toBeChecked();
    await expect(checkbox(form, "Faktura")).not.toBeChecked();
    // Navnet fylles aldri ut fra ordren
    await expect(form.getByLabel(/^Navn/)).toHaveValue("");
    await fillParty(form, PARTY);
    await saveForm(form);

    const card = partyCard(page, PARTY.name);
    await expect(card).toHaveCount(1);
    for (const value of ["Megler", PARTY.name, PARTY.firm, PARTY.email, PARTY.phone]) {
      await expect(card).toContainText(value);
    }
    await expect(card).toContainText("Rapport");
    await expect(card).toContainText("Kopi av meldinger");
    await expect(card).not.toContainText("Faktura");
    await expect(section(page, "Parter")).not.toContainText(EMPTY_PARTIES);
  });

  test("7.4 endre og fjerne en part", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);
    const form = await openAddPartyForm(page);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
    await fillParty(form, { name: PARTY.name, email: PARTY.email });
    await saveForm(form);
    await expect(partyCard(page, PARTY.name)).toHaveCount(1);

    // Endre: skjemaet med navnet som verdi
    await partyCard(page, PARTY.name).getByRole("button", { name: "Endre", exact: true }).click();
    const edit = partyCards(page).filter({ has: page.getByLabel(/^Navn/) });
    await expect(edit).toHaveCount(1);
    await expect(edit.getByLabel(/^Navn/)).toHaveValue(PARTY.name);
    await edit.getByLabel(/^Navn/).fill("Megler Endret");
    await saveForm(edit);
    await expect(partyCard(page, "Megler Endret")).toHaveCount(1);
    await expect(partyCards(page)).toHaveCount(1);

    // Fjern: ingen dialog, kortet er borte
    await partyCard(page, "Megler Endret")
      .getByRole("button", { name: "Fjern", exact: true })
      .click();
    await expect(partyCard(page, "Megler Endret")).toHaveCount(0);
    await expect(section(page, "Parter")).toContainText(EMPTY_PARTIES);
  });

  test("7.5 feilmeldinger står ved feltet, og ingenting lagres", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);

    let form = await openAddPartyForm(page);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
    await saveForm(form);
    await expect(page.getByText("Skriv inn navnet.")).toBeVisible();
    form = await openAddPartyForm(page);
    await expect(form.getByLabel(/^Navn/)).toHaveAttribute("aria-describedby", /.+/);

    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
    await fillParty(form, { name: PARTY.name, phone: "abc" });
    await saveForm(form);
    await expect(
      page.getByText("Telefonnummeret kan bare ha sifre, mellomrom og +."),
    ).toBeVisible();

    await page.reload();
    await expect(section(page, "Parter")).toContainText(EMPTY_PARTIES);
    await expect(partyCards(page).filter({ hasText: PARTY.name })).toHaveCount(0);
  });

  test("7.6 takstmann ser team og parter", async ({ page, browser }) => {
    // Admin lager oppdraget og legger inn en part
    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const adminContext = await browser.newContext({ baseURL, viewport, hasTouch, locale: "nb-NO" });
    const adminPage = await adminContext.newPage();
    await logIn(adminPage);
    const { assignmentId } = await newAssignment(adminPage);
    const form = await openAddPartyForm(adminPage);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Selger" });
    await fillParty(form, { name: "Selger Test" });
    await saveForm(form);
    await expect(partyCard(adminPage, "Selger Test")).toHaveCount(1);
    await adminContext.close();

    await logInAsInspector(page);
    const url = `/oppdrag/${assignmentId}`;
    const response = await page.goto(url);
    expectNoServerError(response, url);
    await expect(section(page, "Team")).toBeVisible();
    for (const label of TEAM_LABELS) await expect(section(page, "Team")).toContainText(label);
    await expect(partyCard(page, "Selger Test")).toHaveCount(1);
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

test.describe("iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("7.8 stående: ingen vannrett rulling, én kolonne, parter som kort, knapper minst 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    const longCompanyEmployee = await ensureLongCompanyEmployee();
    await logIn(page);
    const { assignmentId } = await newAssignment(page);

    // Ansvarlig i et selskap med langt navn, så selskapslinjen er så lang som den kan bli
    const responsible = "Ansvarlig takstmann";
    await teamSelect(page, responsible).selectOption(longCompanyEmployee.id);
    await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(teamCurrent(page, responsible)).toHaveText(longCompanyEmployee.name);

    const form = await openAddPartyForm(page);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
    await fillParty(form, { name: PARTY.name });
    await saveForm(form);
    await expect(partyCard(page, PARTY.name)).toHaveCount(1);

    const url = `/oppdrag/${assignmentId}`;
    await page.goto(url);
    await expect(page.getByRole("main")).toContainText(companyLine(LONG_COMPANY_NAME));
    await expectNoHorizontalScroll(page, url);

    // Én kolonne: Team og Parter står under hverandre og starter likt
    const teamBox = await section(page, "Team").boundingBox();
    const partiesBox = await section(page, "Parter").boundingBox();
    expect(teamBox && partiesBox, "begge seksjonene er synlige").toBeTruthy();
    expect(Math.round(teamBox!.x)).toBe(Math.round(partiesBox!.x));
    expect(partiesBox!.y).toBeGreaterThanOrEqual(teamBox!.y + teamBox!.height - 1);

    await expect(partyCards(page)).toHaveCount(1);
    const card = partyCard(page, PARTY.name);
    await expectAtLeast44(card.getByRole("button", { name: "Endre", exact: true }), "Endre");
    await expectAtLeast44(card.getByRole("button", { name: "Fjern", exact: true }), "Fjern");
    await expectAtLeast44(teamSelect(page, "Ansvarlig takstmann"), "nedtrekkslisten i teamet");
    await expectAtLeast44(
      teamLine(page, "Ansvarlig takstmann").getByRole("button", { name: "Lagre", exact: true }),
      "Lagre (team)",
    );
    const addForm = await openAddPartyForm(page);
    await expectAtLeast44(
      addForm.getByRole("button", { name: "Lagre", exact: true }),
      "Lagre (part)",
    );
  });

  test("7.9 «Legg til part» fylles ut og sendes med tastaturet alene", async ({ page }) => {
    await logIn(page);
    await newAssignment(page);
    const form = await openAddPartyForm(page);
    const role = form.getByLabel(/^Rolle/);
    const name = form.getByLabel(/^Navn/);

    // Tab til rollen, velg «Megler» med piltastene
    await page.locator("body").focus();
    for (let i = 0; i < 80; i++) {
      if (await role.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(role).toBeFocused();
    for (let i = 0; i < 8; i++) {
      if ((await role.inputValue()) === "broker") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(role).toHaveValue("broker");

    for (let i = 0; i < 20; i++) {
      if (await name.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(name).toBeFocused();
    await page.keyboard.type("Tastatur Test");
    await page.keyboard.press("Enter");

    await expect(partyCard(page, "Tastatur Test")).toHaveCount(1);
  });
});
