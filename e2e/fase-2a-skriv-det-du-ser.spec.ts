import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { FAKE_ERROR_INPUT, FAKE_NO_MATCH_INPUT } from "../src/core/ai/providers/fake";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  addRuleTg3Deviation,
  bathroomSaveState,
  countServerActions,
  createSampleBathroom,
  deviationCardOn,
  e2eDatabaseUrl,
  ensureSampleOrgEmployee,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  logIn,
  logInAsSampleInspector,
  openSampleBathroom,
  restoreSampleAiEnabled,
  sampleBathroomUrl,
  setSampleAiEnabled,
  type SampleBathroom,
} from "./helpers";

/*
 * «Skriv det du ser»: KI finner utfallet i «+ Avvik» på badskjermen (fase 2a-2). Testplan:
 * docs/funksjoner/fase2a-skriv-det-du-ser-testplan.md avsnitt 7 (S7.1–S7.19), skissen
 * docs/funksjoner/fase2a-skriv-det-du-ser-skisse.md avsnitt 11 (data-testid), oppgavekortet
 * docs/funksjoner/fase2a-skriv-det-du-ser.md. Kjører i prosjektene `pc` (1280 × 720) og `ipad`
 * (liggende 1194 × 834); stående iPad (1024 × 1366) prøves med `setViewportSize`.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (publisert badmal, KI på med den falske
 * leverandøren). Hver test lager sitt eget oppdrag med ett bad (`createSampleBathroom`) og leser
 * KI-loggen og avvikene bare for sin egen rapport, fordi e2e-databasen deles. Alle notater er
 * oppdiktet og uten gjetteord.
 *
 * Støtter hovedmål: KI i bunnen (KI rangerer malens utfall, takstmannen velger, ingen er valgt på
 * forhånd, KI setter aldri TG), de ansatte (tre trykk fra notat til avvik på PC og iPad, samme hjelp
 * uten nett og med KI av, tastatur og skjermleser) og færre reklamasjoner (valgt treff gir malens
 * tekst og samme avvik som manuelt valg, «Registrert fra før» hindrer doble avvik).
 */

const GENERAL = "wet_room.general";
const FLOOR = "wet_room.floor";
const FLOOR_NAME = "Overflater gulv";
const MEMBRANE = "wet_room.membrane_drain";
const FIELD_LABEL = "Skriv hva du ser, eller søk";

/** Hovedeksemplet i kortet. */
const NOTE = "sprekk i flis ved sluket, litt løs";
/** Malens tekst for sprukne fliser på gulvet (badmalen i seed-dataene, utkast). */
const FLOOR_CRACKS_TEXT = "Det er sprukne fliser eller riss i fuger på gulvet i våtrommet.";
/** Gir «for lite fall» (utfall med flettefelt og «velg TG2 eller TG3»). */
const FALL_NOTE = "motfall ved sluket";
/** Merket som viser at notatet ikke lagres (testplanen, lærdom fra 4.10.3). */
const LEAK_MARK = "Mxq-notat-ÆØ";
const LEAK_DIGITS = "77 7 2";
/** Oppdiktet, elleve sifre med gyldig form: samme som skjermlogikken prøver i S6.6. */
const FAKE_NATIONAL_ID = "01019912345";
const OFFICE_EMAIL = "kontor.skriv-det-du-ser.e2e@example.invalid";
const PORTRAIT = { width: 1024, height: 1366 } as const;

const T = {
  noMatch: "Ingen utfall passer. Bruk søket eller punktlisten.",
  aiError: "KI svarte ikke. Bruk søket.",
  aiOff: "KI er av. Bruk søket.",
  offline: "Uten nett: bare tekstsøk.",
  outdated: "Forslagene er utdatert. Trykk «Finn med KI» på nytt.",
  nationalId: "Notatet ser ut til å ha et fødselsnummer. Ta det bort før du bruker KI.",
  noteOnlyBlocked: "Malens tekst har en måling eller et årstall, så notatet kan bare legges til.",
} as const;

// --- Database (bare lokal database eller testdatabasen) -------------------------------------

function sql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

type AiRow = {
  id: string;
  status: string | null;
  outcome: string;
  outputText: string | null;
  chosenCandidate: { source: string; id: string } | null;
};

/** Radene for `outcome_match` i KI-loggen for rapporten i oppdraget, eldste først. Bare lesing. */
async function matchRows(bath: SampleBathroom): Promise<AiRow[]> {
  const db = sql();
  try {
    return await db<AiRow[]>`
      select l.id, l.status, l.outcome, l.output_text as "outputText",
        l.chosen_candidate as "chosenCandidate"
      from ai_usage_log l join reports r on r.id = l.report_id
      where r.assignment_id = ${bath.assignmentId} and l.feature = 'outcome_match'
      order by l.created_at, l.id`;
  } finally {
    await db.end();
  }
}

/** Alle radene i KI-loggen for rapporten (alle funksjoner). Bare lesing. */
async function allAiRowCount(bath: SampleBathroom): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count
      from ai_usage_log l join reports r on r.id = l.report_id
      where r.assignment_id = ${bath.assignmentId}`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

type DeviationRow = {
  id: string;
  tg: number | null;
  kind: string;
  deviationText: string | null;
  textSource: string;
};

/** Avvikene som står (ikke mykt slettet) i rapporten, eldste først. Bare lesing. */
async function deviations(bath: SampleBathroom): Promise<DeviationRow[]> {
  const db = sql();
  try {
    return await db<DeviationRow[]>`
      select d.id, d.tg, d.kind, d.deviation_text as "deviationText",
        d.text_source as "textSource"
      from deviations d join reports r on r.id = d.report_id
      where r.assignment_id = ${bath.assignmentId} and d.deleted_at is null
      order by d.created_at, d.id`;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

function noteField(page: Page): Locator {
  return page.getByLabel(FIELD_LABEL, { exact: true });
}
function findButton(page: Page): Locator {
  return page.getByTestId("outcome-match-find");
}
function aiGroup(page: Page): Locator {
  return page.getByTestId("outcome-match-group");
}
function aiHits(page: Page): Locator {
  return aiGroup(page).getByTestId("outcome-match-hit");
}
function matchMessage(page: Page): Locator {
  return page.getByTestId("outcome-match-message");
}
function nearestGroup(page: Page): Locator {
  return page.getByTestId("outcome-nearest-group");
}
function addPanel(page: Page): Locator {
  return page.getByRole("region", { name: "Legg til avvik" });
}
function addButton(page: Page): Locator {
  return page.getByRole("button", { name: "+ Avvik" });
}

/** Badet åpnet på et punkt, innlogget som prøvetakstmannen. */
async function openBath(page: Page, checkpoint = GENERAL): Promise<SampleBathroom> {
  const bath = await createSampleBathroom();
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, checkpoint);
  return bath;
}

/** «+ Avvik» og notatet i feltet. */
async function writeNote(page: Page, note: string) {
  await addButton(page).click();
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill(note);
}

/** «Finn med KI» og venter på treffene fra KI. */
async function findWithAi(page: Page) {
  await findButton(page).click();
  await expect(aiGroup(page)).toBeVisible();
}

/** Ingen treff er markert som valgt (skisse avsnitt 11). */
async function expectNoPreselection(hits: Locator) {
  const count = await hits.count();
  for (let i = 0; i < count; i++) {
    for (const attribute of ["aria-pressed", "aria-selected", "aria-current", "aria-checked"]) {
      expect(await hits.nth(i).getAttribute(attribute), `treff ${i + 1}: ${attribute}`).toBeNull();
    }
  }
}

/** Treffet fra KI for sprukne fliser på «Overflater gulv». */
function floorHit(page: Page): Locator {
  return aiHits(page)
    .and(page.locator(`[data-checkpoint="${FLOOR}"]`))
    .filter({ hasText: FLOOR_CRACKS_TEXT })
    .first();
}

/** Hovedflyten fram til avviket på gulvet er laget. Gir avvikskortet. */
async function chooseFloorCracks(page: Page): Promise<Locator> {
  await writeNote(page, NOTE);
  await findWithAi(page);
  await floorHit(page).click();
  await expect(page.locator("#checkpoint-heading")).toHaveText(FLOOR_NAME);
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  return deviationCardOn(page, 1);
}

async function expectDeviationText(bath: SampleBathroom, text: string, textSource?: string) {
  await expect
    .poll(async () => {
      const [row] = await deviations(bath);
      return textSource === undefined
        ? row?.deviationText
        : `${row?.deviationText}|${row?.textSource}`;
    })
    .toBe(textSource === undefined ? text : `${text}|${textSource}`);
}

/** Alt i `localStorage` og IndexedDB for siden, som én tekst. */
async function browserStorageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      parts.push(key, localStorage.getItem(key) ?? "");
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? "";
      parts.push(key, sessionStorage.getItem(key) ?? "");
    }
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const info of databases) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error);
        });
        parts.push(store, JSON.stringify(rows));
      }
      db.close();
    }
    return parts.join("\n");
  });
}

async function expectTouchTarget(target: Locator, min: number, what: string) {
  await expect(target, what).toBeVisible();
  const box = await target.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO" });
  return { context, page: await context.newPage() };
}

// --- S7.1–S7.8 hovedflyten, notatet og treffene ---------------------------------------------

test("S7.1 hovedflyten: notat, «Finn med KI», 1–3 treff uten forhåndsvalg, valg lager avviket med malens tekst på tre trykk", async ({
  page,
}) => {
  const bath = await openBath(page);
  const actions = countServerActions(page);
  let taps = 0;

  await addButton(page).click();
  taps += 1;
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill(NOTE);
  actions.reset();
  await findButton(page).click();
  taps += 1;
  await expect(aiGroup(page)).toBeVisible();
  await expect(
    aiGroup(page).getByRole("heading", { name: "Forslag fra KI (velg ett)" }),
  ).toBeVisible();

  const hits = aiHits(page);
  const count = await hits.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  await expectNoPreselection(hits);
  // Punktnavnet først, så malens tekst; TG med tekst
  const hit = floorHit(page);
  await expect(hit).toBeVisible();
  const text = (await hit.innerText()).trim();
  expect(text.startsWith(FLOOR_NAME)).toBe(true);
  expect(text).toContain(FLOOR_CRACKS_TEXT);
  expect(text).toContain("TG2");
  await expect(hit).toHaveAttribute("data-registered", "false");
  await expect(matchMessage(page)).toHaveText(/forslag fra KI/);

  await hit.click();
  taps += 1;
  await expect(page.locator("#checkpoint-heading")).toHaveText(FLOOR_NAME);
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(deviationCardOn(page, 1).getByLabel("Avvik", { exact: true })).toHaveValue(
    FLOOR_CRACKS_TEXT,
  );

  expect(taps, "tre trykk fra notat til avvik").toBe(3);
  // Søket og valget: to kall til serveren
  expect(actions.count()).toBe(2);
  const [row] = await deviations(bath);
  expect(row).toMatchObject({ tg: 2, deviationText: FLOOR_CRACKS_TEXT, textSource: "template" });
  const [log] = await matchRows(bath);
  expect(log).toMatchObject({ status: "accepted", outcome: "ok" });
  expect(log!.outputText ?? "").toBe("");
  expect(log!.chosenCandidate?.source).toBe("template_outcome");
});

test("S7.2 notatet: «Legg notatet til» gir malens tekst + notatet, «Angre» setter malens tekst tilbake, står etter ny innlasting", async ({
  page,
}) => {
  const bath = await openBath(page);
  const card = await chooseFloorCracks(page);
  const offer = card.getByTestId("note-offer");
  await expect(offer).toContainText(`«${NOTE}»`);
  const withNote = `${FLOOR_CRACKS_TEXT} Sprekk i flis ved sluket, litt løs.`;

  await offer.getByTestId("note-offer-add").click();
  await expect(card.getByLabel("Avvik", { exact: true })).toHaveValue(withNote);
  await expect(card.getByTestId("note-offer-undo")).toBeFocused();
  await expect(card.getByTestId("note-offer")).toContainText("Notatet er lagt til.");
  // «Språkvask avviket» står ved siden av «Angre» rett etterpå
  await expect(
    card.getByTestId("note-offer").getByRole("button", { name: "Språkvask avviket" }),
  ).toBeVisible();
  await expectDeviationText(bath, withNote, "edited");

  await card.getByTestId("note-offer-undo").click();
  await expect(card.getByLabel("Avvik", { exact: true })).toHaveValue(FLOOR_CRACKS_TEXT);
  await expect(card.getByTestId("note-offer")).toContainText("Malens tekst er satt tilbake.");
  await expect(card.getByTestId("note-offer-add")).toBeFocused();
  await expectDeviationText(bath, FLOOR_CRACKS_TEXT, "template");

  await card.getByTestId("note-offer-add").click();
  await expectDeviationText(bath, withNote, "edited");
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  await page.reload();
  await expect(deviationCardOn(page, 1).getByLabel("Avvik", { exact: true })).toHaveValue(withNote);
  // Notatet lever bare i minnet: etter ny innlasting finnes ikke tilbudet
  await expect(page.getByTestId("note-offer")).toHaveCount(0);
});

test("S7.3 «Bruk bare notatet» finnes for sprukne fliser og mangler for for lite fall (flettefelt)", async ({
  page,
}) => {
  const bath = await openBath(page);
  const card = await chooseFloorCracks(page);
  await card.getByTestId("note-offer-only").click();
  await expect(card.getByLabel("Avvik", { exact: true })).toHaveValue(
    "Sprekk i flis ved sluket, litt løs.",
  );
  await expect(card.getByTestId("note-offer")).toContainText("Notatet er brukt som avvikstekst.");
  await expectDeviationText(bath, "Sprekk i flis ved sluket, litt løs.", "edited");

  // For lite fall: malens tekst har {måleverdi}, så notatet kan bare legges til
  await writeNote(page, FALL_NOTE);
  await findWithAi(page);
  await aiHits(page).filter({ hasText: "Velg TG2 eller TG3" }).first().click();
  const fallCard = deviationCardOn(page, 2);
  await expect(fallCard.getByTestId("note-offer")).toBeVisible();
  await expect(fallCard.getByTestId("note-offer-add")).toBeVisible();
  await expect(fallCard.getByTestId("note-offer-only")).toHaveCount(0);
  await expect(fallCard.getByTestId("note-offer")).toContainText(T.noteOnlyBlocked);
});

test("S7.4 uten trykk på tilbudet beholdes malens tekst, også etter ny innlasting", async ({
  page,
}) => {
  const bath = await openBath(page);
  await chooseFloorCracks(page);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  await page.reload();
  await expect(deviationCardOn(page, 1).getByLabel("Avvik", { exact: true })).toHaveValue(
    FLOOR_CRACKS_TEXT,
  );
  const [row] = await deviations(bath);
  expect(row).toMatchObject({ deviationText: FLOOR_CRACKS_TEXT, textSource: "template" });
});

test("S7.5 Enter med null treff i tekstsøket kjører «Finn med KI»", async ({ page }) => {
  const bath = await openBath(page);
  await writeNote(page, NOTE);
  await expect(addPanel(page)).toContainText("Ingen avvik passer.");
  await noteField(page).press("Enter");
  await expect(aiGroup(page)).toBeVisible();
  await expect(aiHits(page).first()).toBeVisible();
  expect(await matchRows(bath)).toHaveLength(1);
});

test("S7.6 «Ingen utfall passer»: nøytral tekst uten TG og uten «ingen avvik», notatet står", async ({
  page,
}) => {
  await openBath(page);
  const note = `ingenting her ${FAKE_NO_MATCH_INPUT}`;
  await writeNote(page, note);
  await findButton(page).click();
  await expect(matchMessage(page)).toHaveText(T.noMatch);
  const message = (await matchMessage(page).textContent()) ?? "";
  expect(message).not.toMatch(/TG/);
  expect(message.toLowerCase()).not.toContain("ingen avvik");
  await expect(aiGroup(page)).toHaveCount(0);
  await expect(noteField(page)).toHaveValue(note);
});

test("S7.7 «Velg TG2 eller TG3»-treff: takstmannen velger TG, ingen er forhåndsvalgt, også når notatet sier TG3", async ({
  page,
}) => {
  const bath = await openBath(page);
  await writeNote(page, `${FALL_NOTE}, dette er TG3`);
  await findWithAi(page);
  await expectNoPreselection(aiHits(page));
  const hit = aiHits(page).filter({ hasText: "Velg TG2 eller TG3" }).first();
  await expect(hit).toBeVisible();
  // Merket er «Velg TG2 eller TG3», aldri et TG-merke alene
  expect((await hit.innerText()).replace("Velg TG2 eller TG3", "")).not.toMatch(/TG[23]/);
  await hit.click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeVisible();

  await expect.poll(async () => (await deviations(bath)).length).toBe(1);
  const [row] = await deviations(bath);
  expect(row).toMatchObject({ kind: "tg", tg: null });
  const card = deviationCardOn(page, 1);
  // Fokus på TG-valget, og ingen TG er valgt
  const tgChoice = card.getByRole("group", { name: "TG", exact: true });
  await expect(tgChoice.locator(":focus").or(tgChoice.and(page.locator(":focus")))).toHaveCount(1);
  await expect(tgChoice.getByRole("radio")).toHaveCount(2);
  await expect(tgChoice.getByRole("radio", { checked: true })).toHaveCount(0);
  const [log] = await matchRows(bath);
  expect(log?.status).toBe("accepted");
});

test("S7.8 «Registrert fra før»: samme søk merker treffet, trykk åpner avviket som finnes, ingen nytt avvik", async ({
  page,
}) => {
  const bath = await openBath(page);
  await chooseFloorCracks(page);
  expect(await deviations(bath)).toHaveLength(1);

  await writeNote(page, NOTE);
  await findWithAi(page);
  const hit = floorHit(page);
  await expect(hit).toHaveAttribute("data-registered", "true");
  await expect(hit).toContainText("Registrert fra før");
  const label = (await hit.getAttribute("aria-label")) ?? "";
  expect(label).toContain("Registrert fra før.");
  expect(label).toMatch(/Åpner avvik 1\.$/);
  await hit.click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(addPanel(page)).toHaveCount(0);
  expect(await deviations(bath)).toHaveLength(1);
  // Det andre søket er avvist i bakgrunnen
  await expect
    .poll(async () => (await matchRows(bath)).map((r) => r.status))
    .toEqual(["accepted", "rejected"]);
});

// --- S7.9–S7.13 uten nett, KI av, feil, utdatert og lekkasje -----------------------------------

test("S7.9 uten nett: ingen «Finn med KI», «Nærmeste treff (uten KI)», ingen loggrad; «Forslag» med egen tekst gir treff (T-0146)", async ({
  page,
  context,
}) => {
  const bath = await openBath(page, MEMBRANE);
  const deviation = await addRuleTg3Deviation(page);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  const before = await allAiRowCount(bath);
  const actions = countServerActions(page);
  await context.setOffline(true);
  try {
    await expect(bathroomSaveState(page)).toContainText("Uten nett");
    await writeNote(page, NOTE);
    await expect(findButton(page)).toHaveCount(0);
    await expect(matchMessage(page)).toHaveText(T.offline);
    await expect(nearestGroup(page)).toBeVisible();
    await expect(
      nearestGroup(page).getByRole("heading", { name: "Nærmeste treff (uten KI)" }),
    ).toBeVisible();
    const nearest = nearestGroup(page).getByTestId("outcome-match-hit");
    expect(await nearest.count()).toBeGreaterThanOrEqual(1);
    expect(await nearest.count()).toBeLessThanOrEqual(3);
    await expect(nearest.and(page.locator(`[data-checkpoint="${FLOOR}"]`))).toHaveCount(1);
    await page.keyboard.press("Escape");

    // «Forslag» i avvikskortet med egen tekst gir kandidater uten nett (T-0146)
    const cause = deviation.getByLabel("Årsak", { exact: true });
    await cause.fill("vann kan trenge inn i bjelkelaget");
    await deviation.getByRole("button", { name: "Forslag til årsak (/)", exact: true }).click();
    const list = deviation.getByTestId("phrase-list");
    await expect(list).toHaveAttribute("data-phase", "fallback");
    expect(await list.getByTestId("phrase-candidate").count()).toBeGreaterThanOrEqual(1);
    expect(actions.count(), "ingen kall til serveren uten nett").toBe(0);
  } finally {
    await context.setOffline(false);
  }
  expect(await matchRows(bath)).toEqual([]);
  expect(await allAiRowCount(bath)).toBe(before);
});

test("S7.10 KI av: «KI er av. Bruk søket.», ingen knapp etter svaret, «Nærmeste treff (uten KI)», ingen loggrad", async ({
  page,
}) => {
  const previous = await setSampleAiEnabled(false);
  try {
    const bath = await openBath(page);
    await writeNote(page, NOTE);
    // Skjermen vet at KI er av først når serveren har svart (som språkvasken i «KI i veien»).
    if ((await findButton(page).count()) > 0) await findButton(page).click();
    await expect(matchMessage(page)).toHaveText(T.aiOff);
    await expect(findButton(page)).toHaveCount(0);
    await expect(nearestGroup(page)).toBeVisible();
    await expect(
      nearestGroup(page)
        .getByTestId("outcome-match-hit")
        .and(page.locator(`[data-checkpoint="${FLOOR}"]`)),
    ).toHaveCount(1);
    // Valg fra «Nærmeste treff» lager avviket som et manuelt valg
    await nearestGroup(page)
      .getByTestId("outcome-match-hit")
      .and(page.locator(`[data-checkpoint="${FLOOR}"]`))
      .click();
    await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
    const [row] = await deviations(bath);
    expect(row).toMatchObject({ deviationText: FLOOR_CRACKS_TEXT, textSource: "template" });
    expect(await allAiRowCount(bath)).toBe(0);
  } finally {
    await restoreSampleAiEnabled(previous);
  }
});

test("S7.11 «KI svarte ikke»: meldingen, notatet står, dobbelttrykk gir én rad", async ({
  page,
}) => {
  const bath = await openBath(page);
  const note = `flis løs ved sluket ${FAKE_ERROR_INPUT}`;
  await writeNote(page, note);
  await findButton(page).dblclick();
  await expect(matchMessage(page)).toHaveText(T.aiError);
  await expect(noteField(page)).toHaveValue(note);
  await expect(findButton(page)).toHaveText(/Prøv igjen/);
  await expect(aiGroup(page)).toHaveCount(0);
  await expect.poll(async () => (await matchRows(bath)).length).toBe(1);
  const [row] = await matchRows(bath);
  expect(row?.outcome).toBe("error");
});

test("S7.12 utdatert: søk i to faner, valg i den første viser meldingen og lager ikke avvik", async ({
  page,
  context,
}) => {
  const bath = await openBath(page);
  await writeNote(page, NOTE);
  await findWithAi(page);

  const second = await context.newPage();
  await openSampleBathroom(second, bath, GENERAL);
  await writeNote(second, NOTE);
  await findWithAi(second);

  await floorHit(page).click();
  await expect(matchMessage(page)).toHaveText(T.outdated);
  await expect(aiGroup(page)).toHaveCount(0);
  expect(await deviations(bath)).toHaveLength(0);
  await second.close();
});

test("S7.13 notatet lekker ikke: merket finnes ikke i adressen, localStorage eller IndexedDB etter søk, valg og lukk", async ({
  page,
}) => {
  const bath = await openBath(page);
  const note = `${NOTE} ${LEAK_MARK} ${LEAK_DIGITS}`;
  await writeNote(page, note);
  await findWithAi(page);
  await page.keyboard.press("Escape");
  await expect(addPanel(page)).toHaveCount(0);
  await addButton(page).click();
  await findWithAi(page);
  // Merket i notatet endrer rangeringen; hvilket treff som velges, spiller ingen rolle her
  await aiHits(page).first().click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeVisible();
  await expect.poll(async () => (await deviations(bath)).length).toBe(1);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");

  for (const needle of [LEAK_MARK, LEAK_DIGITS]) {
    expect(page.url()).not.toContain(needle);
    expect(decodeURIComponent(page.url())).not.toContain(needle);
    expect(await browserStorageDump(page)).not.toContain(needle);
  }
  expect(await deviations(bath)).toHaveLength(1);
});

// --- S7.14–S7.19 tastatur, iPad, kontor, diktering, notatet i rommet og fødselsnummer ----------

test("S7.14 tastatur og skjermleser: Tab-rekkefølgen, Escape gir fokus tilbake, aria-live og axe uten brudd", async ({
  page,
}) => {
  await openBath(page);
  // «flis» gir både treff i tekstsøket og treff fra KI
  await writeNote(page, "flis");
  await page.keyboard.press("Tab");
  await expect(findButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(aiGroup(page)).toBeVisible();
  // Fokus flyttes ikke når svaret kommer: det står på knappen, nå «Finn på nytt» (skisse 5)
  await expect(findButton(page)).toBeFocused();
  await expect(findButton(page)).toHaveText(/Finn på nytt/);
  await expect(matchMessage(page)).toHaveAttribute("aria-live", "polite");
  await expect(matchMessage(page)).toHaveText(/forslag fra KI\.( Ingen er valgt\.)?$/);

  // Felt → KI-treff → «Finn på nytt» → tekstsøkets treff
  await noteField(page).focus();
  const aiCount = await aiHits(page).count();
  for (let i = 0; i < aiCount; i++) {
    await page.keyboard.press("Tab");
    await expect(aiHits(page).nth(i)).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(findButton(page)).toBeFocused();
  await page.keyboard.press("Tab");
  const firstTextHit = addPanel(page)
    .getByTestId("outcome-match-hit")
    .and(page.locator(":not([data-testid=outcome-match-group] *)"))
    .first();
  await expect(firstTextHit).toBeFocused();
  // Pil ned fra feltet går til første KI-treff
  await noteField(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(aiHits(page).first()).toBeFocused();

  await expectNoAxeViolations(page, "åpen treffliste fra KI");
  await page.keyboard.press("Escape");
  await expect(addPanel(page)).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();

  await writeNote(page, NOTE);
  await findWithAi(page);
  await floorHit(page).click();
  await expect(page.getByTestId("note-offer")).toBeVisible();
  await expectNoAxeViolations(page, "tilbudet om notatet");
});

test("S7.15 iPad stående: «Finn med KI» og treffene minst 56 px, ingen vannrett rulling, tekstsøkets treff tar ikke imot trykk når KI-treffene kommer", async ({
  page,
}) => {
  await page.setViewportSize(PORTRAIT);
  await openBath(page);
  await writeNote(page, "flis");
  await expectTouchTarget(findButton(page), 56, "«Finn med KI»");
  await expectNoHorizontalScroll(page, "panelet før svaret");

  const textHit = addPanel(page).getByTestId("outcome-match-hit").first();
  const before = await textHit.boundingBox();
  // Registrerer om tekstsøkets liste tar imot trykk i det KI-gruppen settes inn
  await page.evaluate(() => {
    const record = window as unknown as { __pointerAtInsert?: string };
    const observer = new MutationObserver(() => {
      const group = document.querySelector('[data-testid="outcome-match-group"]');
      if (!group || record.__pointerAtInsert !== undefined) return;
      const textList = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="outcome-match-hit"]'),
      )
        .find((hit) => !group.contains(hit))
        ?.closest("ul");
      record.__pointerAtInsert = textList ? getComputedStyle(textList).pointerEvents : "ingen";
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true });
  });
  await findWithAi(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { __pointerAtInsert?: string }).__pointerAtInsert,
    ),
  ).toBe("none");

  const hits = aiHits(page);
  const count = await hits.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < count; i++) await expectTouchTarget(hits.nth(i), 56, `KI-treff ${i + 1}`);
  await expectTouchTarget(findButton(page), 56, "«Finn på nytt»");
  await expectNoHorizontalScroll(page, "panelet med treff fra KI");

  // Tekstsøkets treff flyttes ned én gang når svaret kommer, og står så stille
  const textHitAfter = addPanel(page)
    .getByTestId("outcome-match-hit")
    .and(page.locator(":not([data-testid=outcome-match-group] *)"))
    .first();
  const after = await textHitAfter.boundingBox();
  expect(after!.y).toBeGreaterThanOrEqual(before!.y);
  await page.waitForTimeout(400);
  expect((await textHitAfter.boundingBox())!.y).toBe(after!.y);
  await expect(textHitAfter).toBeEnabled();
});

test("S7.16 kontor ser ikke «Finn med KI» og kan ikke lage avvik", async ({ page, browser }) => {
  const bath = await createSampleBathroom();
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, GENERAL);
  await ensureSampleOrgEmployee({
    email: OFFICE_EMAIL,
    name: "Oppdiktet kontor skriv det du ser",
    role: "office",
  });
  const office = await newPage(browser);
  try {
    await logIn(office.page, OFFICE_EMAIL);
    await office.page.goto(sampleBathroomUrl(bath, GENERAL));
    await expect(office.page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
    await expect(addButton(office.page)).toHaveCount(0);
    await expect(findButton(office.page)).toHaveCount(0);
    await expect(noteField(office.page)).toHaveCount(0);
  } finally {
    await office.context.close();
  }
  expect(await deviations(bath)).toHaveLength(0);
});

test("S7.17 ingen diktering: ingen mikrofonknapp og ingen tekst om diktering i panelet", async ({
  page,
}) => {
  await openBath(page);
  await writeNote(page, NOTE);
  await findWithAi(page);
  const panel = addPanel(page);
  const text = ((await panel.innerText()) ?? "").toLowerCase();
  for (const word of ["dikter", "diktat", "mikrofon", "tale"]) {
    expect(text, `ingen «${word}» i panelet`).not.toMatch(new RegExp(`\\b${word}`));
  }
  await expect(panel.getByRole("button", { name: /mikrofon|dikter|diktat|tale/i })).toHaveCount(0);
  await expect(panel.locator("[x-webkit-speech], [speech]")).toHaveCount(0);
});

test("S7.18 notatet i rommet, iPad stående: står etter lukk, «Avbryt» og Escape; tomt etter annet rom og etter ny innlogging", async ({
  page,
}) => {
  await page.setViewportSize(PORTRAIT);
  const bath = await openBath(page);
  const note = "løs flis ved døra";
  await writeNote(page, note);

  await addPanel(page).getByRole("button", { name: "Avbryt" }).click();
  await expect(addPanel(page)).toHaveCount(0);
  await addButton(page).click();
  await expect(noteField(page)).toHaveValue(note);

  await page.keyboard.press("Escape");
  await expect(addButton(page)).toBeFocused();
  await addButton(page).click();
  await expect(noteField(page)).toHaveValue(note);

  // Et annet rom og tilbake: feltet er tomt
  await page.goto(`/oppdrag/${bath.assignmentId}/rom/${bath.bedroomId}`);
  await expect(
    page
      .locator("#checkpoint-heading")
      .or(page.getByRole("heading", { level: 1 }))
      .first(),
  ).toBeVisible();
  await openSampleBathroom(page, bath, GENERAL);
  await addButton(page).click();
  await expect(noteField(page)).toHaveValue("");
  await noteField(page).fill(note);

  // Logg ut og inn: feltet er tomt
  await page.getByRole("button", { name: "Logg ut", exact: true }).click();
  await expect(page).toHaveURL(/\/logg-inn$/);
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, GENERAL);
  await addButton(page).click();
  await expect(noteField(page)).toHaveValue("");
  expect(await browserStorageDump(page)).not.toContain(note);
});

test("S7.19 fødselsnummer: meldingen i panelet, ingen kall til søket og ingen loggrad", async ({
  page,
}) => {
  const bath = await openBath(page);
  await writeNote(page, `løs flis ved sluket ${FAKE_NATIONAL_ID}`);
  const actions = countServerActions(page);
  await expect(addPanel(page)).toContainText(T.nationalId);
  await expect(findButton(page)).toBeDisabled();
  await noteField(page).press("Enter");
  await findButton(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(actions.count()).toBe(0);
  const panelText = await addPanel(page).innerText();
  expect(panelText.replace(await noteField(page).inputValue(), "")).not.toContain(FAKE_NATIONAL_ID);
  expect(await matchRows(bath)).toEqual([]);
});
