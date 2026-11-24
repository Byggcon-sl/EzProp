import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  clearTestdataBathAnswer,
  e2eDatabaseUrl,
  expectNoAxeViolations,
  findE2eShowcaseBath,
  findE2eTestdataBath,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  restoreInspectorsEditAll,
  seedTestdataBathsForE2e,
  setInspectorsEditAll,
  testdataBathAnswer,
  testdataBathCheckpointDone,
  testdataBathDeviations,
  testdataBathUrl,
  type E2eTestdataBath,
} from "./helpers";

/*
 * Testdata, del 2: badene i testoppdragene, på badskjermen (fase 2a-2). Testplan:
 * docs/funksjoner/fase2a-testdata-del-2-testplan.md avsnitt 5. Kjører i prosjektene `pc` og
 * `ipad` (liggende 1194 × 834); stående prøves med `setViewportSize`.
 *
 * `beforeAll`: vakten (`assertLocalOrTestDatabase`), publisert systemmal i Byggcon (som i drift)
 * og `pnpm db:seed:testdata` (`seedTestdataBathsForE2e`). Skriptet skriver ingenting andre gang.
 * Badene finnes på innholdet med `findShowcaseBathReport` og `findTestdataBathReports`, aldri på
 * rekkefølge eller antall rader. De oppdiktede TD-ansatte kan ikke logge inn, så testene bruker
 * e2e-brukerne med riktig rolle i Byggcon.
 *
 * Testene endrer ikke testdataene, unntatt 7: admin lagrer ett svar på et urørt punkt i
 * visningsbadet, og svaret settes tilbake til tomt med `saveField` (aldri sletting) i `finally`,
 * sammen med innstillingen `access.inspectors_edit_all`.
 *
 * Støtter hovedmål: de ansatte (badskjermen prøvd på bad som ligner ekte befaringer, også på iPad
 * og uten nett, med universell utforming) og færre reklamasjoner (TG3 med kostnad, TGIU med
 * opplysningene, HMS uten TG og ingen ferdig rapport med advarslene som gir reklamasjoner).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;

/** Kontrollpunktene i badet i malens rekkefølge, med navnet på skjermen. */
const CHECKPOINTS = [
  ["wet_room.general", "Generelt"],
  ["wet_room.documentation", "Dokumentasjon for våtrom"],
  ["wet_room.walls_ceiling", "Overflater vegger og himling"],
  ["wet_room.floor", "Overflater gulv"],
  ["wet_room.membrane_drain", "Vanntett sjikt, membran og sluk"],
  ["wet_room.fixtures", "Sanitærutstyr og innredning"],
  ["wet_room.ventilation", "Ventilasjon"],
  ["wet_room.adjacent", "Tilliggende konstruksjoner våtrom"],
] as const;
type CheckpointKey = (typeof CHECKPOINTS)[number][0];

const MEMBRANE: CheckpointKey = "wet_room.membrane_drain";
const ADJACENT: CheckpointKey = "wet_room.adjacent";
const FIXTURES: CheckpointKey = "wet_room.fixtures";
const VENTILATION: CheckpointKey = "wet_room.ventilation";

/** De fire advarslene som ikke skal stå i et ferdig bad (testplanen 2.1.6). */
const DONE_BATH_WARNINGS = [
  /TG3 er satt bare på grunn av alder/,
  /Hulltaking er ikke utført\. Punktet bør ha TGIU\./,
  /Fyll ut dette for TGIU/,
  /Punktet er ferdig uten TG/,
] as const;

/** Telefonnummer med åtte sifre, med eller uten mellomrom og landskode. */
const PHONE = /(?<!\d)(?:\+47\s?)?(?:\d{2}\s?){3}\d{2}(?!\d)/;

let showcase: E2eTestdataBath;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  assertLocalOrTestDatabase(e2eDatabaseUrl(), process.env.TEST_DATABASE_URL);
  seedTestdataBathsForE2e();
  showcase = findE2eShowcaseBath();
});

// --- Siden ----------------------------------------------------------------------------------

function nameOf(key: CheckpointKey): string {
  return CHECKPOINTS.find(([k]) => k === key)![1];
}

/** Åpner badet på punktet og venter til punktet står på skjermen. */
async function openBath(page: Page, bath: E2eTestdataBath, key: CheckpointKey) {
  await page.goto(testdataBathUrl(bath, key));
  await expect(page.locator("#checkpoint-heading")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: nameOf(key) })).toBeVisible();
}

/** «x av 8 ferdig» fra fremdriften, som tall. */
async function progress(page: Page): Promise<{ done: number; total: number }> {
  const text = page
    .getByText(/^\d+ av \d+ ferdig$/)
    .filter({ visible: true })
    .first();
  await expect(text).toBeVisible();
  const match = /^(\d+) av (\d+) ferdig$/.exec(((await text.textContent()) ?? "").trim());
  expect(match, "fremdriften «x av y ferdig»").not.toBeNull();
  return { done: Number(match![1]), total: Number(match![2]) };
}

function checkpointList(page: Page): Locator {
  return page.getByRole("navigation", { name: "Kontrollpunkter" });
}

/** Lenken til punktet i listen over kontrollpunkter (liggende skjerm). */
function checkpointLink(page: Page, key: CheckpointKey): Locator {
  return checkpointList(page).getByRole("link", { name: new RegExp(`^${nameOf(key)}`) });
}

/** Overskriftene på avvikskortene i punktet som er åpent. */
function deviationHeadings(page: Page, name?: RegExp): Locator {
  return page.getByRole("heading", { level: 3, name: name ?? /^Avvik \d+/ });
}

/** Avvikskortet rundt overskriften (kortet er `section` med `aria-labelledby`). */
function cardOf(heading: Locator): Locator {
  return heading.locator("xpath=ancestor::section[1]");
}

function tgiuSection(page: Page): Locator {
  return cardOf(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ }));
}

function suggestionCards(page: Page): Locator {
  return page.getByRole("region", { name: /^Forslag fra reglene/ });
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

/**
 * Elementet er synlig og ikke dekket av noe annet: punktet midt i overskriften og midt i
 * elementet treffer elementet selv (ikke en fast topplinje, bunnlinje eller et annet kort).
 */
async function expectNotCovered(target: Locator, heading: Locator, where: string) {
  for (const part of [heading, target]) {
    await part.scrollIntoViewIfNeeded();
    await expect(part).toBeVisible();
    const hit = await part.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const x = box.left + Math.min(box.width / 2, 40);
      const y = box.top + Math.min(box.height / 2, 20);
      const top = document.elementFromPoint(x, y);
      return top !== null && (el === top || el.contains(top));
    });
    expect(hit, `${where} er ikke dekket av noe annet`).toBe(true);
  }
}

/** All tekst i avvikskortene på punktet: synlig tekst og verdiene i tekstfeltene. */
async function deviationCardTexts(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const heading of await deviationHeadings(page).all()) {
    const card = cardOf(heading);
    out.push(await card.innerText());
    out.push(
      ...(await card
        .locator("textarea, input")
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))),
    );
  }
  return out;
}

// --- 1 visningsbadet ------------------------------------------------------------------------

test("1 visningsbadet (takstmann): TG3 med kostnad, TGIU, HMS uten TG, TG2 med endret tekst og «x av 8»", async ({
  page,
}) => {
  const deviations = await testdataBathDeviations(showcase);
  const edited = deviations.find((d) => d.kind === "tg" && d.tg === 2 && d.textSource === "edited");
  expect(edited, "visningsbadet har en TG2 med endret tekst").toBeTruthy();
  const tg3 = deviations.find((d) => d.kind === "tg" && d.tg === 3);
  expect(tg3?.costType, "TG3 har kostnadsintervall").toBe("band");
  const hms = deviations.find((d) => d.kind === "hms");
  expect(hms, "visningsbadet har et HMS-avvik").toBeTruthy();

  await logInAsInspector(page);

  // TG3 med kostnadsintervall
  await openBath(page, showcase, tg3!.checkpointKey as CheckpointKey);
  const { done, total } = await progress(page);
  expect(total).toBe(8);
  expect(done).toBeLessThan(8);
  const tg3Heading = deviationHeadings(page, /^Avvik \d+\s*TG3 Store eller alvorlige avvik/);
  await expect(tg3Heading).toHaveCount(1);
  const tg3Card = cardOf(tg3Heading);
  await expect(
    tg3Card.getByRole("group", { name: "Kostnad" }).getByRole("radio", { checked: true }),
  ).toHaveAccessibleName(/200\s000–500\s000/);

  // TGIU med opplysningene, uten advarsel om felt som mangler
  await openBath(page, showcase, ADJACENT);
  const tgiu = tgiuSection(page);
  await expect(tgiu).toBeVisible();
  for (const label of [
    "Hva er ikke undersøkt, og hvorfor?",
    "Risiko",
    "Hva må til for å undersøke?",
    "Annen fuktkontroll",
    "Resultat av annen fuktkontroll",
  ]) {
    await expect(tgiu.getByLabel(label, { exact: true }), label).not.toHaveValue("");
  }
  await expect(
    tgiu.getByRole("group", { name: "Skadeutsatt konstruksjon" }).getByRole("radio", {
      checked: true,
    }),
  ).toHaveCount(1);
  await expect(tgiu.getByLabel("Eier er informert om utvidet ansvar")).toBeChecked();
  await expect(page.getByText(/Fyll ut dette for TGIU/)).toHaveCount(0);
  await expect(checkpointLink(page, ADJACENT)).not.toContainText("Ferdig");

  // HMS uten TG-merke og uten TG-valg
  await openBath(page, showcase, hms!.checkpointKey as CheckpointKey);
  const hmsHeading = deviationHeadings(page, /^Avvik \d+\s*HMS$/);
  await expect(hmsHeading).toHaveCount(1);
  await expect(hmsHeading).not.toContainText("TG");
  await expect(cardOf(hmsHeading).getByRole("group", { name: "TG", exact: true })).toHaveCount(0);

  // TG2 med endret tekst: teksten fra testdataene står i feltet
  await openBath(page, showcase, edited!.checkpointKey as CheckpointKey);
  const tg2Heading = deviationHeadings(page, /^Avvik \d+\s*TG2 Vesentlige avvik/);
  await expect(tg2Heading).toHaveCount(1);
  await expect(cardOf(tg2Heading).getByLabel("Avvik", { exact: true })).toHaveValue(
    edited!.deviationText!,
  );
});

// --- 2 badet uten avvik ---------------------------------------------------------------------

test("2 badet uten avvik: 8 ferdige, sju TG1 og tilliggende TG0, ingen avvikskort eller advarsler", async ({
  page,
}) => {
  const bath = await findE2eTestdataBath("no_deviations");
  await logInAsInspector(page);
  await openBath(page, bath, "wet_room.general");
  expect(await progress(page)).toEqual({ done: 8, total: 8 });
  const list = checkpointList(page);
  await expect(list.getByRole("img", { name: "TG1 Mindre avvik" })).toHaveCount(7);
  await expect(list.getByRole("img", { name: /^TG[023]|^TGIU/ })).toHaveCount(1);
  await expect(
    checkpointLink(page, ADJACENT).getByRole("img", { name: "TG0 Ingen avvik" }),
  ).toBeVisible();
  for (const [key] of CHECKPOINTS) {
    await expect(checkpointLink(page, key), key).toContainText("Ferdig");
  }
  await expect(page.getByRole("button", { name: /å se over/ })).toHaveCount(0);
  for (const [key] of CHECKPOINTS) {
    await openBath(page, bath, key);
    await expect(deviationHeadings(page), `ingen avvikskort på ${key}`).toHaveCount(0);
    await expect(page.getByRole("region", { name: /^Å se over/ }), key).toHaveCount(0);
  }
});

// --- 3 ferdig bad ---------------------------------------------------------------------------

for (const kind of ["done_with_tgiu", "done_with_tg3"] as const) {
  test(`3 ferdig bad (${kind === "done_with_tgiu" ? "med TGIU" : "med TG3"}): 8 av 8 uten de fire advarslene`, async ({
    page,
  }) => {
    const bath = await findE2eTestdataBath(kind);
    await logInAsInspector(page);
    await openBath(page, bath, "wet_room.general");
    expect(await progress(page)).toEqual({ done: 8, total: 8 });
    for (const [key] of CHECKPOINTS) {
      await openBath(page, bath, key);
      for (const warning of DONE_BATH_WARNINGS) {
        await expect(page.getByText(warning), `${String(warning)} på ${key}`).toHaveCount(0);
      }
    }
  });
}

// --- 4 «Ukjent» byggeår ---------------------------------------------------------------------

test("4 «Ukjent» byggeår: sjiktpunktet står ikke ferdig og viser «ikke vurdert»", async ({
  page,
}) => {
  const bath = await findE2eTestdataBath("unknown_build_year");
  expect(await testdataBathCheckpointDone(bath, MEMBRANE)).toBe(false);
  await logInAsInspector(page);
  await openBath(page, bath, "wet_room.general");
  await expect(
    page.getByRole("group", { name: "Kilde for byggeåret" }).getByRole("radio", { name: "Ukjent" }),
  ).toBeChecked();
  await openBath(page, bath, MEMBRANE);
  await expect(checkpointLink(page, MEMBRANE)).not.toContainText("Ferdig");
  await expect(checkpointLink(page, MEMBRANE).getByRole("img")).toHaveCount(0);
  await expect(page.getByText(/Ikke vurdert:/).first()).toBeVisible();
  await expect(deviationHeadings(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toHaveCount(0);
});

// --- 5 avvist forslag -----------------------------------------------------------------------

test("5 avvist forslag: vises som avvist med grunnen «Målt på nytt», og punktet står ikke ferdig", async ({
  page,
}) => {
  const bath = await findE2eTestdataBath("rejected_measured_again");
  expect(await testdataBathCheckpointDone(bath, ADJACENT)).toBe(false);
  await logInAsInspector(page);
  await openBath(page, bath, ADJACENT);
  const rejected = suggestionCards(page).filter({ hasText: "Avvist:" });
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toContainText("Grunn: Målt på nytt");
  await expect(rejected.getByRole("button", { name: "Godta", exact: true })).toHaveCount(0);
  await expect(checkpointLink(page, ADJACENT)).not.toContainText("Ferdig");
  await expect(deviationHeadings(page)).toHaveCount(0);
});

// --- 6 kontor -------------------------------------------------------------------------------

test("6 kontor: visningsbadet er skrivebeskyttet med kostnaden, uten Godta og Avvis", async ({
  page,
}) => {
  await logInAsOffice(page);
  await openBath(page, showcase, MEMBRANE);
  await expect(page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
  const tg3 = cardOf(deviationHeadings(page, /^Avvik \d+\s*TG3/));
  await expect(tg3).toContainText(/200\s000–500\s000 kr/);
  await expect(page.getByRole("button", { name: "Godta", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Avvis", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toHaveCount(0);
  await expect(page.locator("main textarea, main input:not([type=hidden])")).toHaveCount(0);
  await openBath(page, showcase, ADJACENT);
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fjern TGIU" })).toHaveCount(0);
});

// --- 7 leder og admin -----------------------------------------------------------------------

test("7 leder og admin åpner visningsbadet; admin lagrer på et urørt punkt med innstillingen av", async ({
  page,
  browser,
}) => {
  await logInAsManager(page);
  await openBath(page, showcase, MEMBRANE);
  await expect(deviationHeadings(page, /^Avvik \d+\s*TG3/)).toHaveCount(1);

  // Ventilasjon er urørt i visningsbadet (befaringen er avbrutt før punktet)
  expect(await testdataBathAnswer(showcase, "wet_room.ventilation_type")).toBeNull();
  expect(await testdataBathCheckpointDone(showcase, VENTILATION)).toBe(false);

  const previous = await setInspectorsEditAll(false);
  const admin = await browser.newContext({ locale: "nb-NO" });
  try {
    const adminPage = await admin.newPage();
    await logIn(adminPage, ADMIN_EMAIL);
    await openBath(adminPage, showcase, VENTILATION);
    await expect(adminPage.getByText("Du kan se badet, men ikke endre det.")).toHaveCount(0);
    await adminPage
      .getByRole("group", { name: "Ventilasjon", exact: true })
      .locator("label")
      .filter({ hasText: /^Mekanisk avtrekk$/ })
      .first()
      .click();
    await expect(adminPage.locator("header [role='status'][data-save-state]")).toContainText(
      "Alt er lagret",
    );
    await expect
      .poll(() => testdataBathAnswer(showcase, "wet_room.ventilation_type"))
      .toEqual(["mechanical_extract"]);
  } finally {
    await admin.close();
    // Visningsbadet gjenopprettes: svaret settes til tomt med saveField, aldri sletting
    clearTestdataBathAnswer(showcase, "wet_room.ventilation_type", ADMIN_EMAIL);
    await restoreInspectorsEditAll(previous);
  }
  expect(await testdataBathAnswer(showcase, "wet_room.ventilation_type")).toBeNull();
});

// --- 8 iPad liggende og stående -------------------------------------------------------------

for (const viewport of [LANDSCAPE, PORTRAIT]) {
  const name = viewport === PORTRAIT ? "stående" : "liggende";
  test(`8 iPad ${name}: visningsbadet uten vannrett rulling, knapper minst 44 × 44, TG3 og TGIU uten overlapp`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "iPad-størrelsen prøves i prosjektet ipad");
    await page.setViewportSize(viewport);
    await logInAsInspector(page);

    await openBath(page, showcase, MEMBRANE);
    await expectNoHorizontalScroll(page, `${name}, sjiktet med TG3`);
    const tg3Heading = deviationHeadings(page, /^Avvik \d+\s*TG3/);
    await expectNotCovered(cardOf(tg3Heading), tg3Heading, `TG3-kortet (${name})`);
    for (const button of await page.locator("main button:visible").all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      const label = ((await button.textContent()) ?? "").trim();
      expect(box.height, `«${label}» er minst 44 px høy`).toBeGreaterThanOrEqual(44);
      expect(box.width, `«${label}» er minst 44 px bred`).toBeGreaterThanOrEqual(44);
    }

    await openBath(page, showcase, ADJACENT);
    await expectNoHorizontalScroll(page, `${name}, tilliggende med TGIU`);
    const tgiuHeading = page.getByRole("heading", { name: /TGIU – ikke undersøkt/ });
    await expectNotCovered(tgiuSection(page), tgiuHeading, `TGIU (${name})`);
    for (const button of await page.locator("main button:visible").all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      const label = ((await button.textContent()) ?? "").trim();
      expect(box.height, `«${label}» er minst 44 px høy`).toBeGreaterThanOrEqual(44);
      expect(box.width, `«${label}» er minst 44 px bred`).toBeGreaterThanOrEqual(44);
    }
  });
}

// --- 9 uten nett ----------------------------------------------------------------------------

test("9 uten nett: visningsbadet står, punktbytte virker, og ingen rapportdata lagres lokalt", async ({
  page,
  context,
}) => {
  await logInAsInspector(page);
  await openBath(page, showcase, MEMBRANE);
  const portrait = (page.viewportSize()?.width ?? 1200) < 1024;
  try {
    await context.setOffline(true);
    await expect(deviationHeadings(page, /^Avvik \d+\s*TG3/)).toBeVisible();
    expect((await progress(page)).total).toBe(8);
    if (!portrait) {
      await checkpointLink(page, ADJACENT).click();
      await expect(page.getByRole("heading", { level: 2, name: nameOf(ADJACENT) })).toBeFocused();
      await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeVisible();
    }
    // Samme sjekk som B6.8: ingen rapportdata i localStorage eller IndexedDB
    const local = await page.evaluate(async () => ({
      storage: Object.keys(localStorage).filter((k) => /rapport|report|badet|deviation/i.test(k)),
      databases: (await indexedDB.databases()).map((d) => d.name ?? ""),
    }));
    expect(local.storage).toEqual([]);
    expect(local.databases.filter((name) => /report|rapport/i.test(name))).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

// --- 10 axe ---------------------------------------------------------------------------------

test("10 axe uten feil på visningsbadet: TG3, HMS og TGIU", async ({ page }, testInfo) => {
  if (testInfo.project.name === "ipad") await page.setViewportSize(PORTRAIT);
  await logInAsInspector(page);
  for (const key of [MEMBRANE, FIXTURES, ADJACENT]) {
    await openBath(page, showcase, key);
    await expectNoAxeViolations(page, `visningsbadet, ${nameOf(key)}`);
  }
});

// --- 11 ingen persondata i avvikskortene ----------------------------------------------------

test("11 ingen @ eller telefonnummer i avvikskortene", async ({ page }) => {
  const done = await findE2eTestdataBath("done_with_tg3");
  await logInAsInspector(page);
  for (const bath of [showcase, done]) {
    const keys = [...new Set((await testdataBathDeviations(bath)).map((d) => d.checkpointKey))];
    expect(keys.length, "badet har avvik").toBeGreaterThan(0);
    for (const key of keys) {
      await openBath(page, bath, key as CheckpointKey);
      await expect(deviationHeadings(page).first()).toBeVisible();
      for (const text of await deviationCardTexts(page)) {
        expect(text, `ingen @ i avvikskortet (${key})`).not.toContain("@");
        expect(text, `ingen telefonnummer i avvikskortet (${key})`).not.toMatch(PHONE);
      }
    }
  }
});
