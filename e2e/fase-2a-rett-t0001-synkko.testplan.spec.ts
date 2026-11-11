import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  ADMIN_EMAIL,
  CHANGES_PATH,
  createTrialForm,
  indicator,
  logIn,
  logInAsSampleInspector,
  pendingChanges,
  serverTrialData,
  syncMessage,
  syncNowButton,
  syncStatus,
  waitForTrialHook,
} from "./helpers";

/*
 * Funn T-0001: én endring som ikke kan lagres, stopper ikke lenger resten av køen
 * (docs/agenter/oppgaver/rett-t0001-synkko.md, testplan avsnitt 6, E1–E6). Kjører i prosjektene
 * pc og ipad. Innlogging som admin (regel 11: admin synker og ser meldingen). Nulltegnet settes inn
 * med `evaluate` (som innliming fra PDF), siden tastaturet ikke gir det. Ingen fast venting: vi
 * venter på statuslinjen, køen eller serveren. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (takstmannen mister ikke arbeid og ser hvilket felt som ikke ble
 * sendt), KI i bunnen (/prove/ki virker med innlimt tekst) og færre reklamasjoner (svarene kommer
 * fram, så rapporten får ikke hull).
 */

const CHANGES_ROUTE = `**${CHANGES_PATH}`;
const ALL_SAVED = "Alt er lagret";
const FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";
const NOT_SENT = "Kunne ikke sendes";
const NOT_SENT_DESCRIPTION = "Kunne ikke sendes: Generell beskrivelse";
const DESCRIPTION = "Generell beskrivelse";
const YEAR = "Byggeår";
const SUMMARY = "Samlet kommentar";

function poisoned(tag: string): string {
  return `Fukt\u0000 i kjeller ${tag}`;
}

function cleaned(tag: string): string {
  return `Fukt i kjeller ${tag}`;
}

function field(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

/** Limer inn tekst med nulltegn slik nettleseren gjør: verdien settes og `input` sendes. */
async function pasteText(target: Locator, text: string) {
  await target.focus();
  await target.evaluate((element, value) => {
    const input = element as HTMLTextAreaElement | HTMLInputElement;
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  // Teksten skrives til lageret når feltet forlates
  await target.blur();
}

/** Nulltegn i Generell beskrivelse først, så byggeår og samlet kommentar (stegene i funnet). */
async function fillThree(page: Page, tag: string) {
  await pasteText(field(page, DESCRIPTION), poisoned(tag));
  await field(page, YEAR).fill("1985");
  await field(page, SUMMARY).fill(`Oppdiktet kommentar ${tag}`);
  await field(page, SUMMARY).blur();
}

async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const formId = await createTrialForm(page);
  await waitForTrialHook(page);
  return formId;
}

/** Svarene serveren har for skjemaet, som feltkode → verdi. */
async function serverAnswers(formId: string): Promise<Map<string, unknown>> {
  const { answers } = await serverTrialData(formId);
  return new Map(answers.map((answer) => [answer.fieldKey, answer.value]));
}

async function expectAllThreeOnServer(formId: string, tag: string) {
  await expect
    .poll(async () => (await serverAnswers(formId)).size, {
      timeout: 20_000,
      message: "tre svar på serveren",
    })
    .toBe(3);
  const answers = await serverAnswers(formId);
  expect(answers.get("general_description")).toBe(cleaned(tag));
  expect(answers.get("building_year")).toBe(1985);
  expect(answers.get("summary")).toBe(`Oppdiktet kommentar ${tag}`);
}

async function waitAllSaved(page: Page) {
  await expect
    .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
    .toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
}

/** Statuskodene fra skriveruten mens testen går. */
function recordChangeStatuses(page: Page): number[] {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === CHANGES_PATH) statuses.push(response.status());
  });
  return statuses;
}

type Operation = { id: string; table: string; data: Record<string, unknown> };

/**
 * Svarer 400 med `endring` for bunter som har Generell beskrivelse (som serveren gjør for en
 * verdi den ikke tar). Andre bunter går til serveren. Gir antallet 400-svar.
 */
async function rejectDescription(page: Page): Promise<() => number> {
  let rejected = 0;
  await page.route(CHANGES_ROUTE, async (route: Route) => {
    const body = route.request().postDataJSON() as { operations?: Operation[] } | null;
    const target = body?.operations?.find(
      (operation) =>
        operation.table === "trial_answers" && operation.data.field_key === "general_description",
    );
    if (!target) return route.continue();
    rejected++;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({
        feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
        endring: { id: target.id, table: target.table, field_key: "general_description" },
      }),
    });
  });
  return () => rejected;
}

test.describe("T-0001: én endring som ikke kan lagres, stopper ikke køen", () => {
  test("(a) tekst med nulltegn i Generell beskrivelse: alle tre svarene kommer fram", async ({
    page,
  }) => {
    const statuses = recordChangeStatuses(page);
    const formId = await openNewForm(page);
    const tag = `e1-${randomUUID().slice(0, 8)}`;

    await fillThree(page, tag);
    await syncNowButton(page).click();

    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
    await expectAllThreeOnServer(formId, tag);
    expect(statuses.filter((status) => status >= 500)).toEqual([]);

    // Etter omlasting vises de tre verdiene, uten melding
    await page.reload();
    await waitForTrialHook(page);
    await expect(field(page, YEAR)).toHaveValue("1985");
    await expect(field(page, SUMMARY)).toHaveValue(`Oppdiktet kommentar ${tag}`);
    await expect(field(page, DESCRIPTION)).toHaveValue(/Fukt\u0000? i kjeller/);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
  });

  test("(b) 400 for én endring: meldingen viser feltet og de andre blir kvittert", async ({
    page,
  }) => {
    const formId = await openNewForm(page);
    const rejected = await rejectDescription(page);
    const tag = `e2-${randomUUID().slice(0, 8)}`;

    try {
      await fillThree(page, tag);
      await syncNowButton(page).click();

      await expect(syncStatus(page)).toContainText(NOT_SENT_DESCRIPTION, { timeout: 20_000 });
      expect(rejected()).toBeGreaterThan(0);
      // Ventetallet teller ikke den som er lagt til side
      await expect
        .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
        .toBe(0);
      await expect
        .poll(async () => [...(await serverAnswers(formId)).keys()].sort(), { timeout: 20_000 })
        .toEqual(["building_year", "summary"]);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
  });

  test("(b2) meldingen står etter omlasting og forsvinner etter 200 på ny endring", async ({
    page,
  }) => {
    const formId = await openNewForm(page);
    await rejectDescription(page);
    const tag = `e3-${randomUUID().slice(0, 8)}`;

    try {
      await fillThree(page, tag);
      await syncNowButton(page).click();
      await expect(syncStatus(page)).toContainText(NOT_SENT_DESCRIPTION, { timeout: 20_000 });

      await page.reload();
      await waitForTrialHook(page);
      await expect(syncStatus(page)).toContainText(NOT_SENT_DESCRIPTION, { timeout: 20_000 });
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    // Takstmannen skriver feltet om; nå tar serveren imot
    await field(page, DESCRIPTION).fill(cleaned(tag));
    await field(page, DESCRIPTION).blur();
    await syncNowButton(page).click();

    await expect(syncStatus(page)).not.toContainText(NOT_SENT, { timeout: 20_000 });
    await waitAllSaved(page);
    await expect
      .poll(async () => (await serverAnswers(formId)).get("general_description"), {
        timeout: 20_000,
      })
      .toBe(cleaned(tag));
  });

  test("(c) uten nett: skriv, kom på nett, samme resultat som (a)", async ({ page, context }) => {
    const statuses = recordChangeStatuses(page);
    const formId = await openNewForm(page);
    const tag = `e4-${randomUUID().slice(0, 8)}`;

    try {
      await context.setOffline(true);
      await expect(indicator(page)).toHaveText("Uten nett");
      await fillThree(page, tag);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThan(0);
    } finally {
      await context.setOffline(false);
    }

    await expectAllThreeOnServer(formId, tag);
    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
  });

  test("(d) 500 legger ingenting til side", async ({ page }) => {
    const formId = await openNewForm(page);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ feil: "Noe gikk galt på serveren. Prøv igjen senere." }),
      }),
    );
    const tag = `e5-${randomUUID().slice(0, 8)}`;

    try {
      await fillThree(page, tag);
      await syncNowButton(page).click();
      await expect(syncMessage(page)).toHaveText(FAILED_MESSAGE, { timeout: 20_000 });
      await expect(syncStatus(page)).not.toContainText(NOT_SENT);
      // De tre svarene (og skjemaet, om det ikke var sendt ennå) venter fortsatt
      expect(await pendingChanges(page)).toBeGreaterThanOrEqual(3);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    await syncNowButton(page).click();
    await expectAllThreeOnServer(formId, tag);
    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
  });
});

test.describe("T-0001: /prove/ki med nulltegn", () => {
  test("(e) /prove/ki med nulltegn gir forslag", async ({ page }) => {
    await logInAsSampleInspector(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
    const tag = `m${randomUUID().slice(0, 8)}`;

    await pasteText(page.getByLabel("Setning"), `taket\u0000 er gammelt ${tag}`);
    await page.getByRole("button", { name: "Foreslå bedre språk" }).click();

    const card = page.getByRole("region", { name: "Forslag fra KI" });
    await expect(card.getByTestId("ai-suggestion-text")).toHaveText(`Taket er gammelt ${tag}.`);
    await expect(page.getByTestId("ai-trial-logged")).toHaveText("Logget: forslag");
    await expect(page.getByText("Noe gikk galt. Teksten din er uendret. Prøv igjen.")).toHaveCount(
      0,
    );
  });
});
