import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  e2eDatabaseUrl,
  expectNoAxeViolations,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  restoreByggconSetting,
  seedTestdataBathsForE2e,
  setByggconSetting,
} from "./helpers";
import {
  bathUrl,
  checkpointState,
  findBathWithoutDeviations,
  findFinishedBath,
  findRejectedSuggestionBath,
  findShowcaseBath,
  findUnknownYearBath,
  openCheckpointKeys,
  type E2eBath,
  type ShowcaseFacts,
} from "./testdata-bath";

/*
 * Testdata del 2 i appen: badene i testoppdragene, fylt ut med funn, TG og målinger (fase 2a-2).
 * Testplan: docs/funksjoner/fase2a-testdata-del-2-testplan.md avsnitt 5 (5.1–5.11). Kjører i
 * prosjektene pc og ipad (liggende 1194 × 834); stående prøves med `setViewportSize`.
 *
 * `beforeAll` kjører `pnpm db:seed:testdata` mot e2e-databasen (etter `assertLocalOrTestDatabase`,
 * og produksjonsvakten i skriptet med `APP_ENVIRONMENT=test`). Badene finnes på innholdet med
 * oppslagene i `e2e/testdata-bath.ts` (samme kriterier som `findShowcaseBathReport`), aldri med
 * rekkefølge eller antall. Admin-testen gjenoppretter innstillingen og svaret, så visningsbadet er
 * likt for de andre testene og for neste kjøring.
 *
 * Støtter hovedmål: de ansatte (badskjermen kan prøves på bad som ligner ekte befaringer, også på
 * iPad og uten nett), færre reklamasjoner (TG3 med kostnad, TGIU og HMS uten TG vises riktig) og
 * KI i bunnen (ingen persondata i avvikstekstene).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;
const MEMBRANE = "wet_room.membrane_drain";
const ADJACENT = "wet_room.adjacent";
const FIXTURES = "wet_room.fixtures";
const WALLS_CEILING = "wet_room.walls_ceiling";
const ADMIN_NOTE = "Lagt inn av admin i e2e (oppdiktet)";

/** Etikettene på kostnadsintervallene (`COST_BAND_LABELS`), med vilkårlig mellomrom i tallene. */
const COST_BAND_TEXT: Record<string, RegExp> = {
  under_20000: /Under 20\s000/,
  from_20000_to_100000: /20\s000–100\s000/,
  from_100000_to_200000: /100\s000–200\s000/,
  from_200000_to_500000: /200\s000–500\s000/,
  over_500000: /Over 500\s000/,
};

/** Advarslene som aldri skal stå på et ferdig bad (`WARNING_TEXTS`). */
const BLOCKED_WARNINGS = [
  /TG3 er satt bare på grunn av alder/,
  /Hulltaking er ikke utført\. Punktet bør ha TGIU\./,
  /Fyll ut dette for TGIU/,
  /Punktet er ferdig uten TG/,
];

let showcase: ShowcaseFacts;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  assertLocalOrTestDatabase(e2eDatabaseUrl(), process.env.TEST_DATABASE_URL);
  seedTestdataBathsForE2e(); // publisert systemmal først, ellers hoppes badene over (A516)
  showcase = await findShowcaseBath();
});

// --- Siden ----------------------------------------------------------------------------------

async function openBath(page: Page, bath: E2eBath, punkt?: string) {
  await page.goto(bathUrl(bath, punkt));
  await expect(page.locator("#checkpoint-heading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start rapporten" })).toHaveCount(0);
}

function checkpointNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Kontrollpunkter" });
}

function navLink(page: Page, name: string): Locator {
  return checkpointNav(page).getByRole("link", { name: new RegExp(`^${name}`) });
}

function deviationCards(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Avvik \d+\b/ }) });
}

function totalSaveState(page: Page): Locator {
  return page.locator("header [role='status'][data-save-state]");
}

/** Sant når en av tekstboksene i hovedinnholdet har nøyaktig teksten. */
async function hasTextboxValue(page: Page, text: string): Promise<boolean> {
  return page
    .locator("main textarea, main input[type=text]")
    .evaluateAll(
      (elements, expected) =>
        elements.some((e) => (e as HTMLTextAreaElement | HTMLInputElement).value === expected),
      text,
    );
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling (${where})`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

async function expectButtonsAtLeast44(page: Page) {
  for (const button of await page.locator("main button:visible, main a:visible").all()) {
    const box = await button.boundingBox();
    if (box) {
      expect(box.height, `${await button.textContent()} er minst 44 px`).toBeGreaterThanOrEqual(44);
    }
  }
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// --- 5.1 visningsbadet -----------------------------------------------------------------------

test("5.1 visningsbadet (takstmann): TG3 med kostnad, TGIU med opplysningene, HMS uten TG, TG2 med endret tekst og fremdrift x av 8", async ({
  page,
}) => {
  expect(showcase.doneCount, "visningsbadet står ikke ferdig").toBeLessThan(8);
  expect(showcase.tg3CostBandKey, "TG3 har kostnadsintervall").not.toBeNull();
  await logInAsInspector(page);

  await openBath(page, showcase, MEMBRANE);
  await expect(
    page.getByText(`${showcase.doneCount} av 8 ferdig`).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    navLink(page, "Vanntett sjikt").getByRole("img", { name: "TG3 Store eller alvorlige avvik" }),
  ).toBeVisible();
  const tg3 = deviationCards(page).filter({ hasText: "TG3" }).first();
  await expect(tg3).toBeVisible();
  await expect(tg3.getByText(COST_BAND_TEXT[showcase.tg3CostBandKey!]!).first()).toBeVisible();

  await openBath(page, showcase, ADJACENT);
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeVisible();
  await expect(navLink(page, "Tilliggende").getByRole("img", { name: /^TGIU/ })).toBeVisible();
  await expect(page.getByText(/Fyll ut dette for TGIU/)).toHaveCount(0);

  await openBath(page, showcase, FIXTURES);
  const hms = deviationCards(page).filter({ hasText: "HMS" }).first();
  await expect(hms).toBeVisible();
  await expect(hms.getByText(/^TG[0-3]/)).toHaveCount(0);

  // TG2 med endret tekst ligger på vegger og himling i visningsbadet (DEV_WALL_JOINTS_EDITED)
  await openBath(page, showcase, WALLS_CEILING);
  await expect(
    navLink(page, "Overflater vegger").getByRole("img", { name: "TG2 Vesentlige avvik" }),
  ).toBeVisible();
  expect(showcase.editedTg2Text, "TG2 med endret tekst").not.toBeNull();
  await expect.poll(() => hasTextboxValue(page, showcase.editedTg2Text!)).toBe(true);
});

// --- 5.2 og 5.3 ferdige bad ----------------------------------------------------------------

test("5.2 badet uten avvik: åtte punkt ferdige, sju med TG1 og tilliggende med TG0, ingen avvikskort og ingen advarsler", async ({
  page,
}) => {
  const bath = await findBathWithoutDeviations();
  await logInAsInspector(page);
  await openBath(page, bath, ADJACENT);
  await expect(page.getByText("8 av 8 ferdig").filter({ visible: true }).first()).toBeVisible();
  await expect(checkpointNav(page).getByRole("img", { name: "TG1 Mindre avvik" })).toHaveCount(7);
  await expect(
    navLink(page, "Tilliggende").getByRole("img", { name: "TG0 Ingen avvik" }),
  ).toBeVisible();
  await expect(deviationCards(page)).toHaveCount(0);
  for (const warning of BLOCKED_WARNINGS) await expect(page.getByText(warning)).toHaveCount(0);
});

test("5.3 ferdig bad: 8 av 8, ingen av de fire advarslene vises", async ({ page }) => {
  const bath = await findFinishedBath();
  await logInAsInspector(page);
  await openBath(page, bath, MEMBRANE);
  await expect(page.getByText("8 av 8 ferdig").filter({ visible: true }).first()).toBeVisible();
  for (const warning of BLOCKED_WARNINGS) await expect(page.getByText(warning)).toHaveCount(0);
  await openBath(page, bath, ADJACENT);
  for (const warning of BLOCKED_WARNINGS) await expect(page.getByText(warning)).toHaveCount(0);
});

// --- 5.4 og 5.5 under arbeid ---------------------------------------------------------------

test("5.4 «Ukjent» byggeår: punktet for sjikt står ikke ferdig og viser «ikke vurdert»", async ({
  page,
}) => {
  const bath = await findUnknownYearBath();
  expect((await checkpointState(bath, MEMBRANE))?.done ?? false).toBe(false);
  await logInAsInspector(page);
  await openBath(page, bath, MEMBRANE);
  await expect(navLink(page, "Vanntett sjikt").getByRole("img")).toHaveCount(0);
  await expect(page.getByText(/Ikke vurdert/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toBeVisible();
});

test("5.5 avvist forslag: forslaget står som avvist med grunnen, og punktet står ikke ferdig", async ({
  page,
}) => {
  const bath = await findRejectedSuggestionBath();
  expect((await checkpointState(bath, ADJACENT))?.done ?? false).toBe(false);
  await logInAsInspector(page);
  await openBath(page, bath, ADJACENT);
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forslag fra reglene" }) })
    .first();
  await expect(card).toContainText("Avvist:");
  await expect(card).toContainText("Målt på nytt");
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toBeVisible();
});

// --- 5.6 og 5.7 roller --------------------------------------------------------------------

test("5.6 kontor: åpner visningsbadet skrivebeskyttet med kostnaden, uten Godta og Avvis", async ({
  page,
}) => {
  await logInAsOffice(page);
  await openBath(page, showcase, MEMBRANE);
  await expect(page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
  await expect(page.getByText(COST_BAND_TEXT[showcase.tg3CostBandKey!]!).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Godta", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Avvis", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toHaveCount(0);
});

test("5.7 leder og admin åpner visningsbadet; admin lagrer et svar med innstillingen for takstmenn av, og alt gjenopprettes", async ({
  page,
}) => {
  await logInAsManager(page);
  await openBath(page, showcase, MEMBRANE);
  await expect(page.getByText("Du kan se badet, men ikke endre det.")).toHaveCount(0);

  const [punkt] = await openCheckpointKeys(showcase);
  expect(punkt, "visningsbadet har et punkt som ikke står ferdig").toBeTruthy();
  const before = (await checkpointState(showcase, punkt!))?.description ?? null;
  const previous = await setByggconSetting("access.inspectors_edit_all", false);
  try {
    await page.context().clearCookies(); // ny innlogging som admin
    await logIn(page);
    await openBath(page, showcase, punkt);
    const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
    await description.fill(ADMIN_NOTE);
    await description.blur();
    await expect(totalSaveState(page)).toContainText("Alt er lagret");
    await expect
      .poll(async () => (await checkpointState(showcase, punkt!))?.description)
      .toBe(ADMIN_NOTE);
    // Gjenopprettes med lagring til tomt (ikke sletting)
    await description.fill(before ?? "");
    await description.blur();
    await expect(totalSaveState(page)).toContainText("Alt er lagret");
    await expect
      .poll(async () => (await checkpointState(showcase, punkt!))?.description ?? null)
      .toBe(before === "" ? null : before);
  } finally {
    await restoreByggconSetting("access.inspectors_edit_all", previous);
  }
});

// --- 5.8 iPad ------------------------------------------------------------------------------

for (const viewport of [LANDSCAPE, PORTRAIT]) {
  const name = viewport === PORTRAIT ? "stående" : "liggende";
  test(`5.8 iPad ${name}: visningsbadet uten vannrett rulling, knapper minst 44 px, TG3-kortet og TGIU synlige uten overlapp`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "iPad-størrelsen prøves i prosjektet ipad");
    await page.setViewportSize(viewport);
    await logInAsInspector(page);

    await openBath(page, showcase, MEMBRANE);
    const tg3 = deviationCards(page).filter({ hasText: "TG3" }).first();
    await expect(tg3).toBeVisible();
    await expectNoHorizontalScroll(page, `${name}, TG3`);
    await expectButtonsAtLeast44(page);
    const heading = await page.locator("#checkpoint-heading").boundingBox();
    const card = await tg3.boundingBox();
    expect(heading && card).toBeTruthy();
    expect(overlaps(heading!, card!), "TG3-kortet ligger ikke over overskriften").toBe(false);

    await openBath(page, showcase, ADJACENT);
    const tgiu = page.getByRole("heading", { name: /TGIU – ikke undersøkt/ });
    await expect(tgiu).toBeVisible();
    await expectNoHorizontalScroll(page, `${name}, TGIU`);
    await expectButtonsAtLeast44(page);
    const tgiuBox = await tgiu.boundingBox();
    const headingBox = await page.locator("#checkpoint-heading").boundingBox();
    expect(tgiuBox && headingBox).toBeTruthy();
    expect(overlaps(tgiuBox!, headingBox!), "TGIU ligger ikke over overskriften").toBe(false);
    if (viewport === PORTRAIT) {
      await expect(
        page.getByRole("button", { name: `Punkter (${showcase.doneCount} av 8)` }),
      ).toBeVisible();
    }
  });
}

// --- 5.9 uten nett -------------------------------------------------------------------------

test("5.9 uten nett: visningsbadet står, og ingen rapportdata lagres lokalt", async ({
  page,
  context,
}) => {
  await logInAsInspector(page);
  await openBath(page, showcase, MEMBRANE);
  const tg3 = deviationCards(page).filter({ hasText: "TG3" }).first();
  await expect(tg3).toBeVisible();
  await context.setOffline(true);
  try {
    await expect(tg3).toBeVisible();
    await expect(page.locator("#checkpoint-heading")).toBeVisible();
    const local = await page.evaluate(async () => ({
      storage: Object.keys(localStorage).filter((k) => /rapport|report|badet|deviation/i.test(k)),
      databases: (await indexedDB.databases()).map((d) => d.name ?? ""),
    }));
    expect(local.storage).toEqual([]);
    expect(local.databases.filter((n) => /report|rapport/i.test(n))).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

// --- 5.10 axe og 5.11 persondata ------------------------------------------------------------

test("5.10 axe uten feil på visningsbadet (PC og iPad stående)", async ({ page }, testInfo) => {
  if (testInfo.project.name === "ipad") await page.setViewportSize(PORTRAIT);
  await logInAsInspector(page);
  for (const punkt of [MEMBRANE, ADJACENT, FIXTURES]) {
    await openBath(page, showcase, punkt);
    await expectNoAxeViolations(page, `visningsbadet, ${punkt}`);
  }
});

test("5.11 ingen persondata i avvikskortene (ingen @ eller telefonnummer)", async ({ page }) => {
  await logInAsInspector(page);
  for (const punkt of [MEMBRANE, FIXTURES, WALLS_CEILING]) {
    await openBath(page, showcase, punkt);
    const cards = deviationCards(page);
    expect(await cards.count(), `avvikskort på ${punkt}`).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      const values = await card
        .locator("textarea, input")
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      const content = [(await card.innerText()) ?? "", ...values].join("\n");
      expect(content).not.toContain("@");
      expect(content).not.toMatch(/(\+47\s?)?\b\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b/);
    }
  }
});
