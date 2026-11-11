import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  aiUsageRowsWithMarker,
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
 * Funn T-0001: én endring som ikke kan lagres, stopper ikke resten av køen (testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 6, E1–E6). Kjøres i pc og ipad.
 * Nulltegnet (U+0000) kan ikke skrives på tastaturet; det settes inn med `fill`, og testen sjekker
 * først at feltet faktisk har tegnet. Ingen fast venting: testene venter på statuslinjen, køen og
 * serveren. Hver test rydder sine egne `page.route`. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (takstmannen mister ikke arbeid fra iPaden og ser hvilket felt som
 * ikke ble sendt), KI i bunnen (innlimt tekst gir forslag på /prove/ki) og færre reklamasjoner
 * (svarene kommer fram, så rapporten får ikke hull).
 */

const NUL = "\u0000";
const ALL_SAVED = "Alt er lagret";
const FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";
const UNSENT_TEXT = "Kunne ikke sendes: Generell beskrivelse";
const CHANGES_ROUTE = `**${CHANGES_PATH}`;
const SYNC_TIMEOUT = 30_000;

test.use({ serviceWorkers: "block" });

function tag(): string {
  return `t${randomUUID().slice(0, 8)}`;
}

function textField(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

function unsentMessage(page: Page): Locator {
  return page.getByText(/Kunne ikke sendes/);
}

interface Answers {
  description: string;
  summary: string;
}

/** Fyller ut som i funnet: nulltegn i Generell beskrivelse, så byggeår og samlet kommentar. */
async function fillThree(page: Page, marker: string): Promise<Answers> {
  const answers = {
    description: `Fukt${NUL} i kjeller ${marker}`,
    summary: `Oppdiktet samlet kommentar ${marker}`,
  };
  const description = textField(page, "Generell beskrivelse");
  await description.fill(answers.description);
  // Forutsetning: feltet har nulltegnet (ellers prøver testen ikke funnet)
  expect(await description.inputValue(), "feltet har nulltegnet").toContain(NUL);
  await description.blur();
  await textField(page, "Byggeår").fill("1985");
  await textField(page, "Byggeår").blur();
  await textField(page, "Samlet kommentar").fill(answers.summary);
  await textField(page, "Samlet kommentar").blur();
  return answers;
}

/** Svarene på serveren for skjemaet, som oppslag på feltkode. */
async function serverAnswers(formId: string): Promise<Record<string, unknown>> {
  const { answers } = await serverTrialData(formId);
  return Object.fromEntries(answers.map((answer) => [answer.fieldKey, answer.value]));
}

/** Venter til de tre svarene er på serveren, uten nulltegn. */
async function expectThreeOnServer(formId: string, answers: Answers) {
  await expect
    .poll(async () => Object.keys(await serverAnswers(formId)).sort(), {
      timeout: SYNC_TIMEOUT,
      message: "tre svar på serveren",
    })
    .toEqual(["building_year", "general_description", "summary"]);
  const stored = await serverAnswers(formId);
  expect(stored.general_description).toBe(answers.description.replaceAll(NUL, ""));
  expect(stored.building_year).toBe(1985);
  expect(stored.summary).toBe(answers.summary);
  expect(JSON.stringify(stored)).not.toContain("\\u0000");
}

async function waitAllSaved(page: Page) {
  await expect
    .poll(() => pendingChanges(page), { timeout: SYNC_TIMEOUT, message: "køen er tom" })
    .toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: SYNC_TIMEOUT });
}

/** Teller svar fra serveren på 500 eller mer for skriveruten. */
function recordServerErrors(page: Page): number[] {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes(CHANGES_PATH) && response.status() >= 500) {
      statuses.push(response.status());
    }
  });
  return statuses;
}

/**
 * Svarer 400 med `endring` for den første bunten som har Generell beskrivelse; alt annet går
 * videre til serveren. Gir id-en til endringen som ble avvist.
 */
async function rejectDescriptionOnce(page: Page): Promise<{ rejectedId: () => string | null }> {
  let rejectedId: string | null = null;
  await page.route(CHANGES_ROUTE, async (route: Route) => {
    const body = route.request().postDataJSON() as {
      operations?: { id: string; table: string; data?: { field_key?: string } }[];
    } | null;
    const hit = body?.operations?.find(
      (operation) =>
        operation.table === "trial_answers" && operation.data?.field_key === "general_description",
    );
    if (rejectedId === null && hit) {
      rejectedId = hit.id;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
          endring: { id: hit.id, table: "trial_answers", field_key: "general_description" },
        }),
      });
      return;
    }
    await route.continue();
  });
  return { rejectedId: () => rejectedId };
}

/** E2-oppsettet: 400 for Generell beskrivelse, de to andre blir lagret. */
async function rejectOneAndSendRest(page: Page) {
  await logIn(page);
  const formId = await createTrialForm(page);
  await waitForTrialHook(page);
  const marker = tag();
  const rejection = await rejectDescriptionOnce(page);
  const answers = await fillThree(page, marker);
  await syncNowButton(page).click();

  await expect(page.getByText(UNSENT_TEXT)).toBeVisible({ timeout: SYNC_TIMEOUT });
  expect(rejection.rejectedId()).not.toBeNull();
  await expect
    .poll(async () => Object.keys(await serverAnswers(formId)).sort(), {
      timeout: SYNC_TIMEOUT,
      message: "byggeår og samlet kommentar er lagret",
    })
    .toEqual(["building_year", "summary"]);
  // Ventetallet teller ikke den som er lagt til side
  await expect
    .poll(() => pendingChanges(page), { timeout: SYNC_TIMEOUT, message: "ventetallet er 0" })
    .toBe(0);
  return { formId, answers, marker };
}

test.describe("T-0001 synkkøen stopper ikke ved én avvist endring (pc og ipad)", () => {
  test("(a) tekst med nulltegn i Generell beskrivelse: alle tre svarene kommer fram", async ({
    page,
  }) => {
    const serverErrors = recordServerErrors(page);
    await logIn(page);
    const formId = await createTrialForm(page);
    await waitForTrialHook(page);

    const answers = await fillThree(page, tag());
    await syncNowButton(page).click();

    await expectThreeOnServer(formId, answers);
    await waitAllSaved(page);
    await expect(unsentMessage(page)).toHaveCount(0);
    expect(serverErrors).toEqual([]);

    // Etter ny innlasting står de tre verdiene i skjemaet
    await page.reload();
    await waitForTrialHook(page);
    await expect
      .poll(async () =>
        (await textField(page, "Generell beskrivelse").inputValue()).replaceAll(NUL, ""),
      )
      .toBe(answers.description.replaceAll(NUL, ""));
    await expect(textField(page, "Byggeår")).toHaveValue("1985");
    await expect(textField(page, "Samlet kommentar")).toHaveValue(answers.summary);
    await expect(unsentMessage(page)).toHaveCount(0);
    expect(serverErrors).toEqual([]);
  });

  test("(b) 400 for én endring: meldingen viser feltet og de andre blir kvittert", async ({
    page,
  }) => {
    const { formId } = await rejectOneAndSendRest(page);
    // Meldingen står i statuslinjen, sammen med ventetallet
    await expect(syncStatus(page)).toContainText(UNSENT_TEXT);
    expect(Object.keys(await serverAnswers(formId))).not.toContain("general_description");
    await page.unroute(CHANGES_ROUTE);
  });

  test("(b2) meldingen står etter omlasting og forsvinner etter 200 på ny endring", async ({
    page,
  }) => {
    const { formId, marker } = await rejectOneAndSendRest(page);

    await page.reload();
    await waitForTrialHook(page);
    await expect(page.getByText(UNSENT_TEXT)).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Ruten fjernes, takstmannen skriver feltet om og synker
    await page.unroute(CHANGES_ROUTE);
    const rewritten = `Fukt i kjeller, skrevet om ${marker}`;
    await textField(page, "Generell beskrivelse").fill(rewritten);
    await textField(page, "Generell beskrivelse").blur();
    await syncNowButton(page).click();

    await expect
      .poll(async () => (await serverAnswers(formId)).general_description, {
        timeout: SYNC_TIMEOUT,
        message: "feltet er lagret",
      })
      .toBe(rewritten);
    await expect(unsentMessage(page)).toHaveCount(0, { timeout: SYNC_TIMEOUT });
    await waitAllSaved(page);
  });

  test("(c) uten nett: skriv, kom på nett, samme resultat som (a)", async ({ page, context }) => {
    const serverErrors = recordServerErrors(page);
    await logIn(page);
    const formId = await createTrialForm(page);
    await waitForTrialHook(page);

    await context.setOffline(true);
    await expect(indicator(page)).toHaveText("Uten nett", { timeout: SYNC_TIMEOUT });
    const answers = await fillThree(page, tag());
    expect(await pendingChanges(page)).toBeGreaterThan(0);

    await context.setOffline(false);
    await expectThreeOnServer(formId, answers);
    await waitAllSaved(page);
    await expect(unsentMessage(page)).toHaveCount(0);
    expect(serverErrors).toEqual([]);
  });

  test("(d) 500 legger ingenting til side", async ({ page }) => {
    await logIn(page);
    const formId = await createTrialForm(page);
    await waitForTrialHook(page);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ feil: "Noe gikk galt på serveren. Prøv igjen senere." }),
      }),
    );
    try {
      const marker = tag();
      await textField(page, "Byggeår").fill("1985");
      await textField(page, "Byggeår").blur();
      await textField(page, "Samlet kommentar").fill(`Oppdiktet samlet kommentar ${marker}`);
      await textField(page, "Samlet kommentar").blur();
      await syncNowButton(page).click();

      await expect(syncMessage(page)).toHaveText(FAILED_MESSAGE, { timeout: SYNC_TIMEOUT });
      await expect(unsentMessage(page)).toHaveCount(0);
      expect(await pendingChanges(page)).toBeGreaterThan(0);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    await syncNowButton(page).click();
    await expect
      .poll(async () => Object.keys(await serverAnswers(formId)).sort(), {
        timeout: SYNC_TIMEOUT,
        message: "alt kommer fram når serveren svarer igjen",
      })
      .toEqual(["building_year", "summary"]);
    await waitAllSaved(page);
    await expect(unsentMessage(page)).toHaveCount(0);
  });

  test("(e) /prove/ki med nulltegn gir forslag", async ({ page }) => {
    await logInAsSampleInspector(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();

    const marker = tag();
    const text = `taket er gammelt${NUL} og har noen sprekker ${marker}`;
    const field = page.getByLabel("Setning");
    await field.fill(text);
    expect(await field.inputValue(), "feltet har nulltegnet").toContain(NUL);
    await page.getByRole("button", { name: "Foreslå bedre språk" }).click();

    const card = page.getByRole("region", { name: "Forslag fra KI" });
    await expect(card.getByTestId("ai-suggestion-text")).toHaveText(
      `Taket er gammelt og har noen sprekker ${marker}.`,
      { timeout: SYNC_TIMEOUT },
    );
    await expect(page.getByText("Noe gikk galt", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("ai-trial-logged")).toHaveText("Logget: forslag");
    const rows = await aiUsageRowsWithMarker(marker);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("suggested");
  });
});
