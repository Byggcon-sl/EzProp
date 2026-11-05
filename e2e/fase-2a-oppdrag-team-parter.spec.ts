import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  ADMIN_EMAIL,
  assignmentEventCount,
  employeeByEmail,
  INSPECTOR_COMPANY,
  INSPECTOR_EMAIL,
  logIn,
  logInAsInspector,
  ensureInspector,
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
 * Støtter hovedmål: tid (få trykk, mottar forhåndsutfylt etter rollen, virker på iPad) og
 * reklamasjoner (hvem som har ansvaret står på oppdraget).
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

/** Linjen «Utstedende selskap: …» under «Kontor» på oppdragssiden. */
function issuingCompany(page: Page): Locator {
  return page
    .getByRole("main")
    .getByText(/^\s*Utstedende selskap:/)
    .first();
}

const ISSUING_COMPANY_HELP =
  "Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn under Ansatte.";

/** Utstedende selskap viser `value` («Ikke satt» eller selskapsnavnet). */
async function expectIssuingCompany(page: Page, value: string) {
  await expect(issuingCompany(page)).toContainText(
    new RegExp(`^\\s*Utstedende selskap:\\s*${value}(?![\\p{L}\\d])`, "u"),
  );
}

/** Setter takstmannen fra e2e (med selskap) som ansvarlig og venter til det er lagret. */
async function setInspectorResponsible(page: Page, inspector: { id: string; name: string }) {
  const responsible = "Ansvarlig takstmann";
  await teamSelect(page, responsible).selectOption(inspector.id);
  await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(teamCurrent(page, responsible)).toHaveText(inspector.name);
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
    await ensureInspector();
    const admin = await employeeByEmail(ADMIN_EMAIL);
    const inspector = await employeeByEmail(INSPECTOR_EMAIL);
    await logIn(page);
    await newAssignment(page);

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

    // Utstedende selskap: tomt før ansvarlig er satt, med forklaring
    await expectIssuingCompany(page, "Ikke satt");
    await expect(page.getByRole("main").getByText(ISSUING_COMPANY_HELP)).toBeVisible();
    const office = page
      .getByRole("main")
      .getByText(/^\s*Kontor:/)
      .first();
    const officeBox = await office.boundingBox();
    const companyBox = await issuingCompany(page).boundingBox();
    expect(officeBox && companyBox, "Kontor og Utstedende selskap er synlige").toBeTruthy();
    expect(companyBox!.y, "Utstedende selskap står under Kontor").toBeGreaterThanOrEqual(
      officeBox!.y + officeBox!.height - 1,
    );

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
    // Takstmannen har selskap: oppdraget får det som utstedende selskap
    await expectIssuingCompany(page, INSPECTOR_COMPANY);
    await expect(page.getByRole("main").getByText(ISSUING_COMPANY_HELP)).toHaveCount(0);

    // «Ingen» fjerner personen fra rollen
    await teamSelect(page, responsible).selectOption({ label: "Ingen" });
    await teamLine(page, responsible).getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(teamCurrent(page, responsible)).toHaveText("Ikke satt");
    await expect(team.getByText("Ikke satt", { exact: true })).toHaveCount(5);
    await expect(teamSelect(page, responsible)).toHaveValue("");
    await expectIssuingCompany(page, "Ikke satt");
    await expect(page.getByRole("main").getByText(ISSUING_COMPANY_HELP)).toBeVisible();
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
    await ensureInspector();
    const inspector = await employeeByEmail(INSPECTOR_EMAIL);
    await logIn(page);
    const { assignmentId } = await newAssignment(page);
    // Selskapslinjen med forklaring (tomt) og med navnet skal ikke gi vannrett rulling
    await expectIssuingCompany(page, "Ikke satt");
    await expect(page.getByRole("main").getByText(ISSUING_COMPANY_HELP)).toBeVisible();
    await expectNoHorizontalScroll(page, `/oppdrag/${assignmentId} uten selskap`);
    await setInspectorResponsible(page, inspector);
    await expectIssuingCompany(page, INSPECTOR_COMPANY);
    const form = await openAddPartyForm(page);
    await form.getByLabel(/^Rolle/).selectOption({ label: "Megler" });
    await fillParty(form, { name: PARTY.name });
    await saveForm(form);
    await expect(partyCard(page, PARTY.name)).toHaveCount(1);

    const url = `/oppdrag/${assignmentId}`;
    await page.goto(url);
    await expectIssuingCompany(page, INSPECTOR_COMPANY);
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

// ---------------------------------------------------------------------------------------------
// Statusflyten, kansellering og merket «Rettet»
// (docs/funksjoner/fase2a-statusflyt-testplan.md avsnitt 5). Kjører i pc og ipad; 5.7 bare i
// ipad. Kortet «Status» er et landemerke (region) som «Team» og «Parter». Skjemaet for
// «Tilbake til …» har feltet «Grunn …» og «Lagre»; skjemaet for kansellering har feltet
// «Grunn …» og «Kanseller». Grunnene er oppdiktet. «Rettet» kan ikke vises før utgivelsene
// finnes (corrected er alltid false); det dekkes av enhetstestene 1.5 og 3.7.1.
// ---------------------------------------------------------------------------------------------

const BACK_REASON = "Feiltrykk";
const CANCEL_REASON = "Kunden trakk bestillingen";
const CONFLICT_MESSAGE = "Statusen er endret av noen andre. Last siden på nytt.";

function statusCard(page: Page): Locator {
  return page.getByRole("region", { name: "Status", exact: true });
}

/** Statusmerket i kortet (teksten står alene, ikke som del av en knapp). */
function statusBadge(page: Page, label: string): Locator {
  return statusCard(page).getByText(label, { exact: true });
}

function statusButton(page: Page, name: string): Locator {
  return statusCard(page).getByRole("button", { name, exact: true });
}

/** Skjemaet for «Tilbake til …» (har «Lagre»). */
function backForm(page: Page): Locator {
  return statusCard(page)
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Lagre", exact: true }) });
}

/** Skjemaet for kansellering (har «Kanseller»). */
function cancelForm(page: Page): Locator {
  return statusCard(page)
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Kanseller", exact: true }) });
}

async function assignmentNumber(page: Page): Promise<string> {
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  const match = NUMBER.exec(heading);
  expect(match, "oppdragsnummeret står i overskriften").not.toBeNull();
  return match![0];
}

/** Trykker hovedknappen «Sett til <neste>» og venter til merket viser den nye statusen. */
async function moveForward(page: Page, to: string) {
  await statusButton(page, `Sett til ${to}`).click();
  await expect(statusBadge(page, to)).toBeVisible();
}

async function moveBack(page: Page, to: string, reason: string) {
  await statusButton(page, `Tilbake til ${to}`).click();
  const form = backForm(page);
  await form.getByLabel(/Grunn/).fill(reason);
  await form.getByRole("button", { name: "Lagre", exact: true }).click();
}

async function cancelWithReason(page: Page, reason: string) {
  await statusButton(page, "Kanseller oppdraget").click();
  const form = cancelForm(page);
  await form.getByLabel(/Grunn/).fill(reason);
  await form.getByRole("button", { name: "Kanseller", exact: true }).click();
}

const WORK_QUEUE_URL = /\/arbeidskoe(\?.*)?$/;

test.describe("statusflyten på oppdraget (pc og ipad)", () => {
  test("5.1 hele flyten: Bestilt → Under arbeid → tilbake med grunn → kanseller → arbeidskøen", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    const number = await assignmentNumber(page);

    await expect(statusCard(page)).toBeVisible();
    await expect(statusBadge(page, "Bestilt")).toBeVisible();
    await expect(statusButton(page, "Sett til Under arbeid")).toBeVisible();

    await moveForward(page, "Under arbeid");
    await expect(statusButton(page, "Sett til Ferdig")).toBeVisible();

    await moveBack(page, "Bestilt", BACK_REASON);
    await expect(statusBadge(page, "Bestilt")).toBeVisible();
    await expect(statusButton(page, "Sett til Under arbeid")).toBeVisible();

    await cancelWithReason(page, CANCEL_REASON);

    await expect(page).toHaveURL(WORK_QUEUE_URL);
    await expect(page.getByText(`Oppdrag ${number} er kansellert.`)).toBeVisible();
    // Grunnen står ikke i adressen
    expect(decodeURIComponent(page.url())).not.toContain("Kunden");
  });

  test("5.2 tom grunn ved «Tilbake til …» gir norsk melding i kortet; statusen er uendret", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await moveForward(page, "Under arbeid");

    await statusButton(page, "Tilbake til Bestilt").click();
    const form = backForm(page);
    await form.getByLabel(/Grunn/).fill("   ");
    await form.getByRole("button", { name: "Lagre", exact: true }).click();
    const alert = statusCard(page).getByRole("alert").first();
    await expect(alert).toBeVisible();
    await expect(alert).not.toHaveText(/^\s*$/);
    await expect(alert).not.toHaveText(/Invalid|Too small|Expected/);

    await page.reload();
    await expect(statusBadge(page, "Under arbeid")).toBeVisible();
  });

  test("5.2 tom grunn ved kansellering: norsk melding, ingenting kansellert", async ({ page }) => {
    await logIn(page);
    const { assignmentId } = await newAssignment(page);

    await cancelWithReason(page, "");
    await expect(statusCard(page).getByRole("alert").first()).toBeVisible();

    const url = `/oppdrag/${assignmentId}`;
    expectNoServerError(await page.goto(url), url);
    await expect(statusBadge(page, "Bestilt")).toBeVisible();
  });

  test("5.3 Ferdig og Fakturert: ingen kansellering, og på Fakturert bare «Tilbake til Ferdig»", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await expect(statusButton(page, "Kanseller oppdraget")).toBeVisible();

    await moveForward(page, "Under arbeid");
    await expect(statusButton(page, "Kanseller oppdraget")).toBeVisible();

    await moveForward(page, "Ferdig");
    await expect(statusButton(page, "Kanseller oppdraget")).toHaveCount(0);
    await expect(statusButton(page, "Sett til Fakturert")).toBeVisible();
    await expect(statusButton(page, "Tilbake til Under arbeid")).toBeVisible();

    await moveForward(page, "Fakturert");
    await expect(statusButton(page, "Kanseller oppdraget")).toHaveCount(0);
    await expect(statusCard(page).getByRole("button", { name: /^Sett til / })).toHaveCount(0);
    await expect(statusButton(page, "Tilbake til Ferdig")).toBeVisible();
  });

  test("5.4 og 5.5 etter kansellering: ordresiden viser «(kansellert)» uten lenke, og oppdraget er borte", async ({
    page,
  }) => {
    await logIn(page);
    const { orderId, assignmentId } = await newAssignment(page);
    const number = await assignmentNumber(page);

    await cancelWithReason(page, CANCEL_REASON);
    await expect(page).toHaveURL(WORK_QUEUE_URL);

    // 5.4 ordresiden
    const orderUrl = `/ordre/${orderId}`;
    expectNoServerError(await page.goto(orderUrl), orderUrl);
    await expect(page.getByRole("main")).toContainText(
      `Gjort om til oppdrag ${number} (kansellert)`,
    );
    await expect(page.getByRole("main").getByRole("link", { name: NUMBER })).toHaveCount(0);
    await expect(page.locator(`a[href$="/oppdrag/${assignmentId}"]`)).toHaveCount(0);

    // 5.5 oppdraget direkte
    const url = `/oppdrag/${assignmentId}`;
    expectNoServerError(await page.goto(url), url);
    await expect(deniedHeading(page)).toBeVisible();
  });

  test("5.6 konflikt: to faner, flytt fram i den ene, trykk i den andre → konfliktmelding", async ({
    page,
    context,
  }) => {
    await logIn(page);
    const { assignmentId } = await newAssignment(page);
    const second = await context.newPage();
    await second.goto(`/oppdrag/${assignmentId}`);
    await expect(statusButton(second, "Sett til Under arbeid")).toBeVisible();

    await moveForward(page, "Under arbeid");

    await statusButton(second, "Sett til Under arbeid").click();
    await expect(statusCard(second)).toContainText(CONFLICT_MESSAGE);

    await second.reload();
    await expect(statusBadge(second, "Under arbeid")).toBeVisible();
    expect(await assignmentEventCount(assignmentId, "assignment.status_changed")).toBe(1);
    await second.close();
  });

  test("5.8 «Tilbake til …», grunnfeltet og «Lagre» nås og sendes med Tab og Enter", async ({
    page,
  }) => {
    await logIn(page);
    await newAssignment(page);
    await moveForward(page, "Under arbeid");

    async function tabTo(target: Locator, max: number) {
      for (let i = 0; i < max; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      await expect(target).toBeFocused();
    }

    await page.locator("body").focus();
    const back = statusButton(page, "Tilbake til Bestilt");
    await tabTo(back, 120);
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");

    const reason = backForm(page).getByLabel(/Grunn/);
    await expect(reason).toBeVisible();
    await tabTo(reason, 20);
    await expect(reason).toBeFocused();
    await page.keyboard.type(BACK_REASON);

    const save = backForm(page).getByRole("button", { name: "Lagre", exact: true });
    await tabTo(save, 20);
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(statusBadge(page, "Bestilt")).toBeVisible();
  });
});

test.describe("statusflyten på iPad (prosjektet ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("5.7 stående: kortet «Status» øverst, ingen vannrett rulling, knapper minst 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await logIn(page);
    const { assignmentId } = await newAssignment(page);
    const url = `/oppdrag/${assignmentId}`;

    // Kortet står over «Team» og «Parter»
    const statusBox = await statusCard(page).boundingBox();
    const teamBox = await section(page, "Team").boundingBox();
    const partiesBox = await section(page, "Parter").boundingBox();
    expect(statusBox, "kortet «Status» er synlig").not.toBeNull();
    expect(statusBox!.y).toBeLessThan(teamBox!.y);
    expect(statusBox!.y).toBeLessThan(partiesBox!.y);
    await expectNoHorizontalScroll(page, url);

    await expectAtLeast44(statusButton(page, "Sett til Under arbeid"), "Sett til Under arbeid");
    await expectAtLeast44(statusButton(page, "Kanseller oppdraget"), "Kanseller oppdraget");

    await moveForward(page, "Under arbeid");
    await expectAtLeast44(statusButton(page, "Tilbake til Bestilt"), "Tilbake til Bestilt");

    await statusButton(page, "Kanseller oppdraget").click();
    await expectAtLeast44(
      cancelForm(page).getByRole("button", { name: "Kanseller", exact: true }),
      "Kanseller",
    );
    await expectNoHorizontalScroll(page, url);

    // Kortet viser ett grunnskjema om gangen: lukk kanselleringen før «Tilbake til …»
    await cancelForm(page).getByRole("button", { name: "Avbryt", exact: true }).click();
    await expect(cancelForm(page)).toHaveCount(0);
    await expect(statusButton(page, "Tilbake til Bestilt")).toBeVisible();

    await statusButton(page, "Tilbake til Bestilt").click();
    await expectAtLeast44(
      backForm(page).getByRole("button", { name: "Lagre", exact: true }),
      "Lagre (tilbake)",
    );
    await expectNoHorizontalScroll(page, url);
  });
});
