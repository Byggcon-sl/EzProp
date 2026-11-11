import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  CHANGES_PATH,
  createTrialForm,
  indicator,
  logIn,
  logInAsInspector,
  logInAsSampleInspector,
  pendingChanges,
  readRowsViaHook,
  serverTrialData,
  syncMessage,
  syncNowButton,
  syncStatus,
  waitForTrialHook,
} from "./helpers";

/*
 * Funn T-0001: én endring som ikke kan lagres, stopper ikke synkkøen
 * (docs/agenter/oppgaver/rett-t0001-giftig-endring.md, testplan avsnitt 6, E1–E7). Kjøres i
 * prosjektene pc og ipad. Nulltegnet (U+0000) settes inn med verdisetteren til tekstfeltet og en
 * `input`-hendelse, siden tastaturet ikke kan skrive det. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (takstmannen mister ikke arbeid og ser hvilket felt som ikke ble
 * sendt), KI i bunnen (/prove/ki virker med innlimt tekst) og færre reklamasjoner (svarene kommer
 * fram, så rapporten får ikke hull).
 */

const NUL = "\u0000";
const DESCRIPTION = "Generell beskrivelse";
const YEAR = "Byggeår";
const SUMMARY = "Samlet kommentar";
const ALL_SAVED = "Alt er lagret";
const FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";
const NOT_SENT = "Kunne ikke sendes";
const NOT_SENT_DESCRIPTION = `${NOT_SENT}: ${DESCRIPTION}`;
const CHANGES_ROUTE = `**${CHANGES_PATH}`;

const POISON_TEXT = `Fukt${NUL} i kjeller ved yttervegg`;
const CLEAN_TEXT = "Fukt i kjeller ved yttervegg";
const SUMMARY_TEXT = "Oppdiktet samlet kommentar";

function field(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

/** Setter teksten rett i feltet (også nulltegn) og sender `input`, slik innliming gjør. */
async function pasteText(locator: Locator, text: string) {
  await locator.focus();
  await locator.evaluate((element, value) => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  // Vis at nulltegnet faktisk står i feltet, så testen prøver det den skal
  if (text.includes(NUL)) {
    expect(await locator.evaluate((element) => (element as HTMLTextAreaElement).value)).toContain(
      NUL,
    );
  }
}

/** Nytt testskjema, venter til skjemaet selv er sendt. */
async function newForm(page: Page): Promise<string> {
  const formId = await createTrialForm(page);
  await waitForTrialHook(page);
  await expect.poll(() => pendingChanges(page), { timeout: 15_000 }).toBe(0);
  return formId;
}

/** Fyller ut de tre feltene uten nett, så de går i samme bunt med Generell beskrivelse først. */
async function fillThreeOffline(page: Page, context: BrowserContext, description: string) {
  await context.setOffline(true);
  try {
    await expect(indicator(page)).toHaveText("Uten nett");
    await pasteText(field(page, DESCRIPTION), description);
    await field(page, YEAR).fill("1985");
    await pasteText(field(page, SUMMARY), SUMMARY_TEXT);
    await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(3);
  } finally {
    await context.setOffline(false);
  }
}

/** Svarene på serveren for skjemaet, som `{ feltkode: verdi }`. */
async function serverAnswers(formId: string): Promise<Record<string, unknown>> {
  const { answers } = await serverTrialData(formId);
  return Object.fromEntries(answers.map((answer) => [answer.fieldKey, answer.value]));
}

/** Teller svar fra serveren med status 500 eller høyere på synkruten. */
function countServerErrors(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on("response", (response) => {
    if (response.url().includes(CHANGES_PATH) && response.status() >= 500) seen.count++;
  });
  return seen;
}

type Operation = { op: string; table: string; id: string; data: Record<string, unknown> };

/**
 * Serveren avviser Generell beskrivelse med 400 og `endring`, som den ekte serveren gjør for en
 * endring som ikke kan lagres. Alle bunter med samme rad avvises; andre sendes videre.
 */
async function rejectDescription(page: Page) {
  let poisonId: string | null = null;
  await page.route(CHANGES_ROUTE, async (route) => {
    const body = route.request().postDataJSON() as { operations?: Operation[] };
    const operations = body.operations ?? [];
    poisonId ??=
      operations.find(
        (operation) =>
          operation.table === "trial_answers" && operation.data.field_key === "general_description",
      )?.id ?? null;
    if (poisonId && operations.some((operation) => operation.id === poisonId)) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
          endring: { id: poisonId, table: "trial_answers", field_key: "general_description" },
        }),
      });
      return;
    }
    await route.continue();
  });
}

/** Felles for E2 og E7: 400 for Generell beskrivelse, de to andre kommer fram. */
async function expectRejectedDescriptionOnly(page: Page, formId: string) {
  await expect(syncStatus(page)).toContainText(NOT_SENT_DESCRIPTION, { timeout: 15_000 });
  await expect
    .poll(() => serverAnswers(formId), { timeout: 15_000 })
    .toEqual({ building_year: 1985, summary: SUMMARY_TEXT });
  // Ventetallet teller ikke den som er lagt til side
  await expect.poll(() => pendingChanges(page)).toBe(0);
  // Endringen ligger fortsatt på iPaden (slettes aldri)
  const queue = await readRowsViaHook(page, "outbox");
  expect(queue.some((entry) => (entry as { setAside?: unknown }).setAside)).toBe(true);
}

test.describe("T-0001 giftig endring i synkkøen (pc og ipad)", () => {
  test("E1 (a) tekst med nulltegn i Generell beskrivelse: alle tre svarene kommer fram", async ({
    page,
    context,
  }) => {
    const errors = countServerErrors(page);
    await logIn(page);
    const formId = await newForm(page);

    await fillThreeOffline(page, context, POISON_TEXT);
    await syncNowButton(page).click();

    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 15_000 });
    expect(await pendingChanges(page)).toBe(0);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
    expect(await serverAnswers(formId)).toEqual({
      general_description: CLEAN_TEXT,
      building_year: 1985,
      summary: SUMMARY_TEXT,
    });

    await page.reload();
    await waitForTrialHook(page);
    await expect(field(page, YEAR)).toHaveValue("1985");
    await expect(field(page, SUMMARY)).toHaveValue(SUMMARY_TEXT);
    await expect(field(page, DESCRIPTION)).toHaveValue(/Fukt.? i kjeller ved yttervegg/);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
    expect(errors.count).toBe(0);
  });

  test("E2 (b) 400 for én endring: meldingen viser feltet og de andre blir kvittert", async ({
    page,
    context,
  }) => {
    await logIn(page);
    const formId = await newForm(page);
    await rejectDescription(page);
    try {
      await fillThreeOffline(page, context, "Oppdiktet tekst som serveren avviser");
      await syncNowButton(page).click();
      await expectRejectedDescriptionOnly(page, formId);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
  });

  test("E3 (b2) meldingen står etter omlasting og forsvinner etter 200 på ny endring", async ({
    page,
    context,
  }) => {
    await logIn(page);
    const formId = await newForm(page);
    await rejectDescription(page);
    try {
      await fillThreeOffline(page, context, "Oppdiktet tekst som serveren avviser");
      await syncNowButton(page).click();
      await expectRejectedDescriptionOnly(page, formId);

      await page.reload();
      await waitForTrialHook(page);
      await expect(syncStatus(page)).toContainText(NOT_SENT_DESCRIPTION, { timeout: 15_000 });
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    await pasteText(field(page, DESCRIPTION), "Oppdiktet tekst skrevet om");
    await syncNowButton(page).click();

    await expect(syncStatus(page)).not.toContainText(NOT_SENT, { timeout: 15_000 });
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 15_000 });
    await expect
      .poll(async () => (await serverAnswers(formId)).general_description, { timeout: 15_000 })
      .toBe("Oppdiktet tekst skrevet om");
    // Den gamle oppføringen er ikke slettet, bare løst
    const queue = await readRowsViaHook(page, "outbox");
    expect(queue.some((entry) => (entry as { setAside?: unknown }).setAside)).toBe(true);
  });

  test("E4 (c) uten nett: skriv, kom på nett, samme resultat som (a)", async ({
    page,
    context,
  }) => {
    const errors = countServerErrors(page);
    await logIn(page);
    const formId = await newForm(page);

    // Ingen trykk på «Synk nå»: køen sendes av seg selv når nettet kommer
    await fillThreeOffline(page, context, POISON_TEXT);

    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 30_000 });
    expect(await pendingChanges(page)).toBe(0);
    await expect(syncStatus(page)).not.toContainText(NOT_SENT);
    expect(await serverAnswers(formId)).toEqual({
      general_description: CLEAN_TEXT,
      building_year: 1985,
      summary: SUMMARY_TEXT,
    });
    expect(errors.count).toBe(0);
  });

  test("E5 (d) 500 legger ingenting til side", async ({ page, context }) => {
    await logIn(page);
    const formId = await newForm(page);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ feil: "Noe gikk galt på serveren. Prøv igjen senere." }),
      }),
    );
    try {
      await fillThreeOffline(page, context, POISON_TEXT);
      await syncNowButton(page).click();
      await expect(syncMessage(page)).toHaveText(FAILED_MESSAGE, { timeout: 15_000 });
      await expect(syncStatus(page)).not.toContainText(NOT_SENT);
      expect(await pendingChanges(page)).toBeGreaterThanOrEqual(3);
      const queue = await readRowsViaHook(page, "outbox");
      expect(queue.filter((entry) => (entry as { setAside?: unknown }).setAside)).toEqual([]);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    await syncNowButton(page).click();
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 15_000 });
    expect(await serverAnswers(formId)).toEqual({
      general_description: CLEAN_TEXT,
      building_year: 1985,
      summary: SUMMARY_TEXT,
    });
  });

  test("E6 (e) /prove/ki med nulltegn gir forslag", async ({ page }) => {
    await logInAsSampleInspector(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
    const tag = `m${Date.now().toString(36)}`;

    await pasteText(page.getByLabel("Setning"), `taket er gammelt${NUL} og har sprekker ${tag}`);
    await page.getByRole("button", { name: "Foreslå bedre språk" }).click();

    const card = page.getByRole("region", { name: "Forslag fra KI" });
    await expect(card.getByTestId("ai-suggestion-text")).toHaveText(
      `Taket er gammelt og har sprekker ${tag}.`,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("ai-trial-logged")).toHaveText("Logget: forslag");
    await expect(page.getByText("Noe gikk galt")).toHaveCount(0);
  });

  test("E7 (f) takstmann ser samme melding som admin", async ({ page, context }) => {
    await logInAsInspector(page);
    const formId = await newForm(page);
    await rejectDescription(page);
    try {
      await fillThreeOffline(page, context, "Oppdiktet tekst som serveren avviser");
      await syncNowButton(page).click();
      await expectRejectedDescriptionOnly(page, formId);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
  });
});
