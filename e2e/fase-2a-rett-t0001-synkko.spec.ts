import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  CHANGES_PATH,
  aiUsageRowsWithMarker,
  createTrialForm,
  indicator,
  logIn,
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
 * Retting av funn T-0001: én endring som ikke kan lagres, stopper ikke lenger resten av køen.
 * Testplan: docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 6 (E1–E6).
 * Kjører i prosjektene pc og ipad (liggende iPad Pro).
 * Støtter hovedmål: de ansatte (arbeid fra iPaden går ikke tapt, og takstmannen ser hvilket felt
 * som ikke ble sendt) og færre reklamasjoner (svarene kommer fram, så rapporten får ikke hull).
 *
 * Nulltegnet settes inn med page.evaluate (tastaturet gir det ikke), som når tekst limes inn fra
 * en PDF. Ingen faste ventetider: testene venter på statuslinjen, køen og serveren.
 * Alle data er oppdiktet.
 */

const CHANGES_ROUTE = `**${CHANGES_PATH}`;
const NUL = "\u0000";

const ALL_SAVED = "Alt er lagret";
const UNSENT = "Kunne ikke sendes";
const UNSENT_DESCRIPTION = "Kunne ikke sendes: Generell beskrivelse";
const FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";
const UNKNOWN_AI_ERROR = "Noe gikk galt";

const DESCRIPTION = "Generell beskrivelse";
const BUILDING_YEAR = "Byggeår";
const SUMMARY = "Samlet kommentar";

const DESCRIPTION_TEXT = `Oppdiktet beskrivelse${NUL} limt inn fra PDF`;
const DESCRIPTION_VISIBLE = /Oppdiktet beskrivelse.* limt inn fra PDF/;
const SUMMARY_TEXT = "Oppdiktet samlet kommentar";

function input(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

/**
 * Setter teksten i et tekstfelt slik et lim gjør, med nulltegnet med. Bruker den innebygde
 * verdisetteren og en input-hendelse, så React får endringen som fra tastaturet.
 */
async function pasteText(field: Locator, text: string) {
  await field.focus();
  await field.evaluate((element, value) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Fant ikke verdisetteren");
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  // Nulltegnet er faktisk med i feltet (ellers prøver testen ingenting).
  expect(await field.evaluate((element) => (element as HTMLTextAreaElement).value)).toContain(NUL);
}

/** Logger inn som admin, lager et nytt testskjema og venter på lageret. */
async function openNewForm(page: Page): Promise<string> {
  await logIn(page);
  const id = await createTrialForm(page);
  await waitForTrialHook(page);
  return id;
}

/** Fyller ut de tre feltene: nulltegn i Generell beskrivelse, Byggeår 1985 og Samlet kommentar. */
async function fillThree(page: Page) {
  await pasteText(input(page, DESCRIPTION), DESCRIPTION_TEXT);
  await input(page, BUILDING_YEAR).fill("1985");
  await input(page, SUMMARY).fill(SUMMARY_TEXT);
  await input(page, SUMMARY).blur();
}

/** Teller svar med status 500 fra skriveruten. */
function count500(page: Page): () => number {
  let count = 0;
  page.on("response", (response) => {
    if (response.url().includes(CHANGES_PATH) && response.status() === 500) count += 1;
  });
  return () => count;
}

/** Venter til køen er tom og statuslinjen sier «Alt er lagret». */
async function waitAllSaved(page: Page) {
  await expect
    .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
    .toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
}

/** Svarene serveren har for skjemaet, som feltkode → verdi i JSON. */
async function serverAnswers(formId: string): Promise<Record<string, string>> {
  const { answers } = await serverTrialData(formId);
  return Object.fromEntries(
    answers.map((answer) => [answer.fieldKey, JSON.stringify(answer.value)]),
  );
}

/** Venter til serveren har de tre svarene, og ingen av dem har nulltegn. */
async function expectThreeOnServer(formId: string) {
  await expect
    .poll(
      async () => {
        const answers = await serverAnswers(formId);
        return {
          description:
            (answers.general_description ?? "").includes("limt inn fra PDF") &&
            !(answers.general_description ?? "").includes("\\u0000"),
          year: answers.building_year?.includes("1985") ?? false,
          summary: answers.summary?.includes(SUMMARY_TEXT) ?? false,
        };
      },
      { timeout: 20_000, message: "tre svar uten nulltegn på serveren" },
    )
    .toEqual({ description: true, year: true, summary: true });
}

/** Etter omlasting står de tre verdiene i skjemaet. */
async function expectThreeAfterReload(page: Page) {
  await page.reload();
  await waitForTrialHook(page);
  await expect(input(page, DESCRIPTION)).toHaveValue(DESCRIPTION_VISIBLE);
  await expect(input(page, BUILDING_YEAR)).toHaveValue("1985");
  await expect(input(page, SUMMARY)).toHaveValue(SUMMARY_TEXT);
}

/**
 * Ruten som svarer 400 første gang en bunt har Generell beskrivelse, med `endring` som peker på
 * den. Alt annet slipper gjennom til serveren.
 */
function rejectDescriptionOnce() {
  let rejected = false;
  return async (route: Route) => {
    if (rejected || route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as {
      operations?: { table: string; id: string; data?: { field_key?: unknown } }[];
    };
    const operation = body.operations?.find(
      (op) => op.table === "trial_answers" && op.data?.field_key === "general_description",
    );
    if (!operation) return route.fallback();
    rejected = true;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        feil: "Endringen kan ikke lagres.",
        endring: { id: operation.id, table: "trial_answers", field_key: "general_description" },
      }),
    });
  };
}

test.describe("T-0001: én avvist endring stopper ikke køen (pc og ipad)", () => {
  test("(a) tekst med nulltegn i Generell beskrivelse: alle tre svarene kommer fram", async ({
    page,
  }) => {
    const errors500 = count500(page);
    const formId = await openNewForm(page);
    await fillThree(page);
    await syncNowButton(page).click();

    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(UNSENT);
    await expectThreeOnServer(formId);
    expect(errors500()).toBe(0);

    await expectThreeAfterReload(page);
    await expect(syncStatus(page)).not.toContainText(UNSENT);
  });

  test("(b) og (b2) 400 for én endring: meldingen viser feltet, de andre blir kvittert, og meldingen står til ny endring har fått 200", async ({
    page,
  }) => {
    const handler = rejectDescriptionOnce();
    const formId = await openNewForm(page);
    await page.route(CHANGES_ROUTE, handler);
    try {
      await fillThree(page);
      await syncNowButton(page).click();

      // (b) Meldingen viser feltnavnet; de to andre er lagret, og ventetallet teller ikke den giftige
      await expect(syncStatus(page)).toContainText(UNSENT_DESCRIPTION, { timeout: 20_000 });
      await expect
        .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
        .toBe(0);
      await expect
        .poll(
          async () => {
            const answers = await serverAnswers(formId);
            return {
              description: "general_description" in answers,
              year: answers.building_year?.includes("1985") ?? false,
              summary: answers.summary?.includes(SUMMARY_TEXT) ?? false,
            };
          },
          { timeout: 20_000 },
        )
        .toEqual({ description: false, year: true, summary: true });

      // Endringen er lagt til side på iPaden, ikke slettet
      const outbox = await readRowsViaHook(page, "outbox");
      expect(outbox.filter((entry) => entry.setAside !== undefined)).toHaveLength(1);

      // (b2) Meldingen står etter omlasting
      await page.reload();
      await waitForTrialHook(page);
      await expect(syncStatus(page)).toContainText(UNSENT_DESCRIPTION, { timeout: 20_000 });
      await expect(input(page, DESCRIPTION)).toHaveValue(DESCRIPTION_VISIBLE);
    } finally {
      await page.unroute(CHANGES_ROUTE, handler);
    }

    // Uten ruten: feltet skrives om og synkes, meldingen forsvinner
    await input(page, DESCRIPTION).fill("Oppdiktet beskrivelse skrevet om");
    await input(page, DESCRIPTION).blur();
    await syncNowButton(page).click();
    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(UNSENT);
    await expect
      .poll(async () => (await serverAnswers(formId)).general_description ?? "", {
        timeout: 20_000,
      })
      .toContain("skrevet om");
    // Den gamle oppføringen er løst, men fortsatt ikke slettet
    const outbox = await readRowsViaHook(page, "outbox");
    expect(outbox.filter((entry) => entry.setAside !== undefined)).toHaveLength(1);
  });

  test("(c) uten nett: skriv, kom på nett, samme resultat som (a)", async ({ page, context }) => {
    const errors500 = count500(page);
    const formId = await openNewForm(page);
    try {
      await context.setOffline(true);
      await expect(indicator(page)).toHaveText("Uten nett");
      await fillThree(page);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThan(0);
    } finally {
      await context.setOffline(false);
    }
    await syncNowButton(page).click();

    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(UNSENT);
    await expectThreeOnServer(formId);
    expect(errors500()).toBe(0);
    await expectThreeAfterReload(page);
  });

  test("(d) 500 legger ingenting til side", async ({ page }) => {
    const handler = (route: Route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
        : route.fallback();
    const formId = await openNewForm(page);
    await page.route(CHANGES_ROUTE, handler);
    try {
      await fillThree(page);
      await syncNowButton(page).click();
      await expect(syncMessage(page)).toHaveText(FAILED_MESSAGE, { timeout: 20_000 });
      await expect(syncStatus(page)).not.toContainText(UNSENT);
      expect(await pendingChanges(page)).toBeGreaterThan(0);
      const outbox = await readRowsViaHook(page, "outbox");
      expect(outbox.filter((entry) => entry.setAside !== undefined)).toHaveLength(0);
    } finally {
      await page.unroute(CHANGES_ROUTE, handler);
    }

    await syncNowButton(page).click();
    await waitAllSaved(page);
    await expect(syncStatus(page)).not.toContainText(UNSENT);
    await expectThreeOnServer(formId);
  });
});

test.describe("T-0001: KI med nulltegn (pc og ipad)", () => {
  test("(e) /prove/ki med nulltegn gir forslag", async ({ page }) => {
    await logInAsSampleInspector(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();

    const tag = `m${randomUUID().slice(0, 8)}`;
    await pasteText(page.getByLabel("Setning"), `taket er${NUL} gammelt og har sprekker ${tag}`);
    await page.getByRole("button", { name: "Foreslå bedre språk" }).click();

    const card = page.getByRole("region", { name: "Forslag fra KI" });
    await expect(card.getByTestId("ai-suggestion-text")).toContainText(tag);
    await expect(page.getByText(UNKNOWN_AI_ERROR)).toHaveCount(0);
    await expect(page.getByTestId("ai-trial-logged")).toHaveText("Logget: forslag");

    // Forslaget er logget vasket, og klienten viser det samme som står i loggen
    const rows = await aiUsageRowsWithMarker(tag);
    expect(rows).toHaveLength(1);
    expect(await card.getByTestId("ai-suggestion-text").innerText()).not.toContain(NUL);
  });
});
