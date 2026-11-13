import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  assignmentAgreementId,
  assignmentEventCount,
  clientAgreementsByName,
  createClientAgreementRow,
  createFirmWithContact,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  softDeleteFirms,
  uniqueSuffix,
  convertedAssignmentLink,
} from "./helpers";

/*
 * Avtale med oppdragsgiver (fase 2a).
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 9 (sakene 1–8), og
 * avsnitt 7 punkt 7 (ingen knapper uten rett) i sak 6. Kjører i prosjektene pc og ipad; sak 8
 * bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sitt eget firma med
 * `uniqueSuffix()` og et gyldig, oppdiktet org.nr. (databasen tømmes ikke), så forslaget aldri ser
 * avtaler fra andre tester. Firmaene slettes mykt etter testen, slik at firmavelgeren ikke fylles
 * opp. Data er oppdiktet: «Avtaletest Forsikring … AS», «Testavtale …», premisseteksten
 * «Premiss for test. Ikke ekte tekst.», rapportprofilen «test-profil». Ingen e2e uten nett:
 * avtaler og oppdragssiden brukes med nett.
 *
 * Lokatorene følger kortet: admin-menyen «Avtaler», «Ny avtale», feltene Firma, Navn, Gyldig fra,
 * Gyldig til, Premissetekst, Rapportprofil, «Lagre avtalen», «Fjern avtalen» med bekreftelse,
 * merkene «Utløpt» og «Slettet»; på oppdraget kortet «Avtale» (landemerke) med «Forslag: …»,
 * «Bruk avtalen», «Bytt», «Fjern», velgeren «Avtale» med valget «Ingen avtale».
 *
 * Støtter hovedmål: tid (ett trykk på «Bruk avtalen», også på iPad) og reklamasjoner (merkene
 * «Utløpt»/«Slettet», bare admin kan lagre avtaler).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const EVENT = "assignment.agreement_changed";
const PREMISE = "Premiss for test. Ikke ekte tekst.";
const PROFILE = "test-profil";

/** Dagens dato i Norge (`YYYY-MM-DD`), som appen bruker (`todayInOslo`). */
function todayInOslo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

/** `YYYY-MM-DD` flyttet `days` dager. */
function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** «2026-11-06» blir «06.11.2026», som perioden vises. */
function norwegianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

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

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Kortet «Avtale» på oppdragssiden (landemerke med overskriften). */
function agreementCard(page: Page): Locator {
  return page.getByRole("region", { name: "Avtale", exact: true });
}

function cardButton(page: Page, name: "Bruk avtalen" | "Bytt" | "Fjern" | "Lagre"): Locator {
  return agreementCard(page).getByRole("button", { name, exact: true });
}

function agreementSelect(page: Page): Locator {
  return agreementCard(page).getByLabel("Avtale", { exact: true });
}

/** Teksten «Ingen avtale» i kortet (ikke valget i velgeren). */
function noAgreementText(page: Page): Locator {
  return agreementCard(page).locator("p", { hasText: /^\s*Ingen avtale\s*$/ });
}

function saveAgreementButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre avtalen", exact: true });
}

/** Ny ordre med unik adresse, valgfritt med bestiller fra registeret → gjør om → oppdraget. */
async function newAssignment(page: Page, ordererLastName?: string): Promise<string> {
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(`Avtaleveien 3 ${uniqueSuffix()}, 8000 Bodø`);
  if (ordererLastName) {
    await page.getByLabel(/^Søk i kontakter/).fill(ordererLastName);
    const hit = page.getByRole("button", { name: new RegExp(ordererLastName) });
    await expect(hit).toHaveCount(1);
    await hit.click();
    await expect(page.getByText(new RegExp(`Koblet til .*${ordererLastName}`))).toBeVisible();
  }
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(convertedAssignmentLink(page)).toBeVisible();
  await convertedAssignmentLink(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

/** Fyller skjemaet for ny avtale. */
async function fillAgreementForm(
  page: Page,
  values: { firmName: string; name: string; validFrom: string; validTo?: string },
) {
  await page.getByLabel(/^Firma/).selectOption({ label: values.firmName });
  await page.getByLabel(/^Navn/).fill(values.name);
  await page.getByLabel(/^Gyldig fra/).fill(values.validFrom);
  await page.getByLabel(/^Gyldig til/).fill(values.validTo ?? "");
  await page.getByLabel(/^Premissetekst/).fill(PREMISE);
  await page.getByLabel(/^Rapportprofil/).fill(PROFILE);
}

/** Navn på firma og avtale for testen, og listen over firma som slettes mykt etterpå. */
const createdFirms: string[] = [];

async function ownFirm(contact: boolean) {
  const suffix = uniqueSuffix();
  const firmName = `Avtaletest Forsikring ${suffix} AS`;
  const contactLastName = contact ? `Avtalebestiller${suffix}` : undefined;
  const { firmId } = await createFirmWithContact({ firmName, contactLastName });
  createdFirms.push(firmId);
  return { suffix, firmId, firmName, contactLastName, agreementName: `Testavtale ${suffix}` };
}

test.afterEach(async () => {
  await softDeleteFirms(createdFirms.splice(0));
});

test.describe("avtale med oppdragsgiver (pc og ipad)", () => {
  test("9.1 hele flyten: ny avtale → forslag på oppdraget → «Bruk avtalen» → «Fjern»", async ({
    page,
  }) => {
    const own = await ownFirm(true);
    const today = todayInOslo();

    // Admin: menyen «Avtaler» → «Ny avtale» → skjemaet → «Lagre avtalen»
    await logIn(page);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Avtaler", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/avtaler$/);
    await page.getByRole("link", { name: "Ny avtale", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/avtaler\/ny$/);
    await fillAgreementForm(page, {
      firmName: own.firmName,
      name: own.agreementName,
      validFrom: today,
    });
    await saveAgreementButton(page).click();

    // Listen viser avtalen med firma og periode, uten merket «Utløpt»
    await expect(page).toHaveURL(/\/admin\/avtaler(\?.*)?$/);
    const row = page.getByRole("link").filter({ hasText: own.agreementName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(own.firmName);
    await expect(row).toContainText(`Fra ${norwegianDate(today)}`);
    await expect(row).not.toContainText("Utløpt");
    const [saved] = await clientAgreementsByName(own.agreementName);
    expect(saved, "avtalen er lagret").toBeDefined();
    expect(saved!.premiseText).toBe(PREMISE);

    // Ny ordre med bestiller fra firmaet → «Gjør om til oppdrag» → forslaget i kortet
    const assignmentId = await newAssignment(page, own.contactLastName);
    const card = agreementCard(page);
    await expect(card).toContainText(
      `Forslag: ${own.agreementName} (bestilleren er fra ${own.firmName})`,
    );
    expect(await assignmentAgreementId(assignmentId), "ingenting settes automatisk").toBeNull();

    // Ett trykk: «Bruk avtalen» → navn og periode, én hendelse
    await cardButton(page, "Bruk avtalen").click();
    await expect(cardButton(page, "Fjern")).toBeVisible();
    await expect(card).toContainText(own.agreementName);
    await expect(card).toContainText(`Fra ${norwegianDate(today)}`);
    await expect(cardButton(page, "Bytt")).toBeVisible();
    await expect(cardButton(page, "Bruk avtalen")).toHaveCount(0);
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);
    expect(await assignmentAgreementId(assignmentId)).toBe(saved!.id);

    // «Fjern» → «Ingen avtale», to hendelser
    await cardButton(page, "Fjern").click();
    await expect(noAgreementText(page)).toBeVisible();
    await expect(cardButton(page, "Fjern")).toHaveCount(0);
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(2);
    expect(await assignmentAgreementId(assignmentId)).toBeNull();
  });

  test("9.2 velg for hånd: oppdrag uten bestillerfirma, ingen forslag, avtalen fra velgeren", async ({
    page,
  }) => {
    const own = await ownFirm(false);
    const agreementId = await createClientAgreementRow({
      firmId: own.firmId,
      name: own.agreementName,
      validFrom: shiftDays(todayInOslo(), -30),
    });

    await logIn(page);
    const assignmentId = await newAssignment(page);
    const card = agreementCard(page);
    await expect(noAgreementText(page)).toBeVisible();
    await expect(card).not.toContainText("Forslag:");
    await expect(cardButton(page, "Bruk avtalen")).toHaveCount(0);

    // Velgeren har «Ingen avtale» og avtalen; velg den og lagre
    const select = agreementSelect(page);
    await expect(select.locator("option").first()).toHaveText("Ingen avtale");
    await select.selectOption(agreementId);
    await cardButton(page, "Lagre").click();

    await expect(cardButton(page, "Fjern")).toBeVisible();
    await expect(card).toContainText(own.agreementName);
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);
    expect(await assignmentAgreementId(assignmentId)).toBe(agreementId);
  });

  test("9.3 til-dato før fra-dato → norsk feilmelding ved feltet, ingenting lagret", async ({
    page,
  }) => {
    const own = await ownFirm(false);

    await logIn(page);
    await page.goto("/admin/avtaler/ny");
    await fillAgreementForm(page, {
      firmName: own.firmName,
      name: own.agreementName,
      validFrom: "2026-03-01",
      validTo: "2026-02-28",
    });
    await saveAgreementButton(page).click();

    await expect(page.getByText("Til-datoen kan ikke være før fra-datoen.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/avtaler\/ny$/);
    // Feltene beholder verdiene, og feltet er merket
    await expect(page.getByLabel(/^Navn/)).toHaveValue(own.agreementName);
    await expect(page.getByLabel(/^Gyldig til/)).toHaveAttribute("aria-invalid", "true");
    expect(await clientAgreementsByName(own.agreementName)).toEqual([]);
  });

  test("9.4 fjerne avtalen i admin med bekreftelse; oppdraget viser merket «Slettet»", async ({
    page,
  }) => {
    const own = await ownFirm(false);
    const agreementId = await createClientAgreementRow({
      firmId: own.firmId,
      name: own.agreementName,
      validFrom: shiftDays(todayInOslo(), -10),
    });

    await logIn(page);
    const assignmentId = await newAssignment(page);
    await agreementSelect(page).selectOption(agreementId);
    await cardButton(page, "Lagre").click();
    await expect(agreementCard(page)).toContainText(own.agreementName);
    await expect(agreementCard(page)).not.toContainText("Slettet");

    // «Fjern avtalen» → bekreftelse → «Ja, fjern avtalen»
    await page.goto(`/admin/avtaler/${agreementId}`);
    await expect(page.getByLabel(/^Navn/)).toHaveValue(own.agreementName);
    await page.getByRole("button", { name: "Fjern avtalen", exact: true }).click();
    await expect(page.getByText("Vil du fjerne avtalen?")).toBeVisible();
    await page.getByRole("button", { name: "Ja, fjern avtalen", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/avtaler(\?.*)?$/);
    await expect(page.locator(`a[href="/admin/avtaler/${agreementId}"]`)).toHaveCount(0);
    const [row] = await clientAgreementsByName(own.agreementName);
    expect(row?.deletedAt, "myk sletting: raden finnes med deleted_at").toBeTruthy();

    // Oppdraget beholder avtalen med merket «Slettet»; den kan ikke velges på nytt
    await page.goto(`/oppdrag/${assignmentId}`);
    const card = agreementCard(page);
    await expect(card).toContainText(own.agreementName);
    await expect(card.getByText("Slettet", { exact: true })).toBeVisible();
    expect(await assignmentAgreementId(assignmentId)).toBe(agreementId);
    await cardButton(page, "Bytt").click();
    await expect(agreementSelect(page).locator(`option[value="${agreementId}"]`)).toHaveCount(0);
  });

  test("9.5 ikke-admin ser ikke «Lagre avtalen» og kan ikke lagre", async ({ page }) => {
    const own = await ownFirm(false);

    // Takstmannen ser ingen skjema på admin-sidene
    await logInAsInspector(page);
    for (const url of ["/admin/avtaler", "/admin/avtaler/ny"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      await expect(saveAgreementButton(page)).toHaveCount(0);
    }

    // Direkte innsending av lagre-handlingen med takstmannens innlogging: skjemaet hentes som
    // admin, innloggingen byttes til takstmannen, og «Lagre avtalen» trykkes.
    await page.context().clearCookies();
    await logIn(page);
    await page.goto("/admin/avtaler/ny");
    await fillAgreementForm(page, {
      firmName: own.firmName,
      name: own.agreementName,
      validFrom: todayInOslo(),
    });
    await page.context().clearCookies();
    const other = await page.context().newPage();
    await logInAsInspector(other);
    await other.close();

    await saveAgreementButton(page).click();
    await expect(page.getByText("Du har ikke tilgang til dette.")).toBeVisible();
    expect(await clientAgreementsByName(own.agreementName)).toEqual([]);
  });

  test("9.6 takstmannen: uten innstillingen ingen knapper; med den kan forslaget brukes", async ({
    page,
  }) => {
    const own = await ownFirm(true);
    await createClientAgreementRow({
      firmId: own.firmId,
      name: own.agreementName,
      validFrom: shiftDays(todayInOslo(), -1),
    });

    await logIn(page);
    const assignmentId = await newAssignment(page, own.contactLastName);
    await expect(agreementCard(page)).toContainText(`Forslag: ${own.agreementName}`);
    await page.context().clearCookies();

    const previous = await setInspectorsEditAll(false);
    try {
      // Av: kortet vises, men uten «Bruk avtalen», «Bytt», «Fjern» og velger (testplan 7.7)
      await logInAsInspector(page);
      await page.goto(`/oppdrag/${assignmentId}`);
      await expect(agreementCard(page)).toBeVisible();
      for (const name of ["Bruk avtalen", "Bytt", "Fjern", "Lagre"] as const) {
        await expect(cardButton(page, name)).toHaveCount(0);
      }
      await expect(agreementSelect(page)).toHaveCount(0);

      // På: forslaget med ett trykk
      await setInspectorsEditAll(true);
      await page.reload();
      await expect(agreementCard(page)).toContainText(
        `Forslag: ${own.agreementName} (bestilleren er fra ${own.firmName})`,
      );
      await cardButton(page, "Bruk avtalen").click();
      await expect(cardButton(page, "Fjern")).toBeVisible();
      await expect(agreementCard(page)).toContainText(own.agreementName);
      await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("9.7 ukjent id på /admin/avtaler/<id> → «Fant ikke siden», aldri 500", async ({ page }) => {
    await logIn(page);
    for (const url of [`/admin/avtaler/${randomUUID()}`, "/admin/avtaler/ikke-en-id"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      await expect(saveAgreementButton(page)).toHaveCount(0);
    }
  });

  test("9.8 iPad stående: ingen vannrett rulling, knappene minst 44 px, «Lagre avtalen» nås med tastatur", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad-størrelse");
    const own = await ownFirm(true);
    await createClientAgreementRow({
      firmId: own.firmId,
      name: own.agreementName,
      validFrom: shiftDays(todayInOslo(), -1),
    });

    await logIn(page);
    await page.setViewportSize(PORTRAIT);
    const assignmentId = await newAssignment(page, own.contactLastName);
    const where = `/oppdrag/${assignmentId}`;

    // Forslaget: «Bruk avtalen»
    await expect(agreementCard(page)).toContainText(`Forslag: ${own.agreementName}`);
    await expectNoHorizontalScroll(page, `${where} med forslaget`);
    await expectAtLeast44(cardButton(page, "Bruk avtalen"), "«Bruk avtalen»");
    await expectAtLeast44(agreementSelect(page), "velgeren «Avtale»");
    await cardButton(page, "Bruk avtalen").click();

    // Avtalen satt: «Bytt» og «Fjern», så velgeren
    await expectAtLeast44(cardButton(page, "Fjern"), "«Fjern»");
    await expectAtLeast44(cardButton(page, "Bytt"), "«Bytt»");
    await cardButton(page, "Bytt").click();
    await expectAtLeast44(agreementSelect(page), "velgeren «Avtale» etter «Bytt»");
    await expectNoHorizontalScroll(page, `${where} med avtalen og velgeren`);

    // Skjemaet: ingen vannrett rulling; med skjermtastatur (lavere vindu) kan premisseteksten
    // skrives og «Lagre avtalen» nås
    await page.goto("/admin/avtaler/ny");
    await expectNoHorizontalScroll(page, "/admin/avtaler/ny");
    await expectAtLeast44(page.getByLabel(/^Firma/), "firmavelgeren");
    await page.setViewportSize({ width: PORTRAIT.width, height: PORTRAIT.height - 420 });
    const premise = page.getByLabel(/^Premissetekst/);
    await premise.tap();
    await page.keyboard.type(PREMISE);
    await expect(premise).toHaveValue(PREMISE);
    await expectNoHorizontalScroll(page, "/admin/avtaler/ny med skjermtastatur");
    const save = saveAgreementButton(page);
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expectAtLeast44(save, "«Lagre avtalen»");
  });
});
