import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { FAKE_ERROR_INPUT } from "../src/core/ai/providers/fake";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  countServerActions,
  createSampleBathroom,
  e2eDatabaseUrl,
  ensureSampleOrgEmployee,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  logIn,
  logInAsSampleInspector,
  openSampleBathroom,
  restoreSampleAiEnabled,
  roomCheckpointHeading,
  roomDeviationCard,
  setSampleAiEnabled,
  type SampleBathroom,
} from "./helpers";

/*
 * «Skriv det du ser»: KI finner utfallet, på badskjermen (fase 2a-2, «Fra forbedreren», A384).
 * Testplan: docs/funksjoner/fase2a-skriv-det-du-ser-testplan.md avsnitt 7 (S7.1–S7.19), skissen
 * docs/funksjoner/fase2a-skriv-det-du-ser-skisse.md (tekster og `data-testid`, avsnitt 7 og 11).
 * Kjører i prosjektene `pc` (1280 × 720) og `ipad` (liggende 1194 × 834); stående iPad Pro
 * (1024 × 1366) prøves med `setViewportSize`.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (publisert badmal, KI på med den
 * falske leverandøren). Hver test lager sitt eget oppdrag med ett bad (`createSampleBathroom`) og
 * leser KI-loggen og avvikene bare for sitt eget oppdrag, fordi e2e-databasen deles. Notatene er
 * oppdiktet og har ingen gjetteord.
 *
 * Støtter hovedmål: KI i bunnen (KI rangerer malens utfall, takstmannen velger, KI setter aldri
 * TG), de ansatte (tre trykk fra notat til avvik, virker uten nett, tastatur og skjermleser, PC og
 * iPad) og færre reklamasjoner (samme avvik som manuelt valg, malens tekst står til takstmannen
 * ber om noe annet, «Registrert fra før» hindrer doble avvik).
 */

const FLOOR = "wet_room.floor";
const NOTE = "sprekk i flis ved sluket, litt løs";
const FLOOR_TILES_TEXT = "Det er sprukne fliser eller riss i fuger på gulvet i våtrommet.";
const FALL_NOTE = "fallet mot sluket er for lite";
const IPAD_PORTRAIT = { width: 1024, height: 1366 } as const;
const OFFICE_EMAIL = "kontor.skriv-det-du-ser.e2e@example.invalid";
/** Merke som ikke kan stå i en uuid eller et tidsstempel (testplanen, «Merket i notatet»). */
const MARKER = "Mxq-notat-ÆØ";
/** Oppdiktet fødselsnummer med gyldige kontrollsifre. Aldri et ekte nummer. */
const FAKE_NATIONAL_ID = "15019010063";

const TEXT = {
  field: "Skriv hva du ser, eller søk",
  find: "Finn med KI",
  findAgain: "Finn på nytt",
  groupHeading: "Forslag fra KI (velg ett)",
  noMatch: "Ingen utfall passer. Bruk søket eller punktlisten.",
  aiError: "KI svarte ikke. Bruk søket.",
  aiOff: "KI er av. Bruk søket.",
  offline: "Uten nett: bare tekstsøk.",
  outdated: "Forslagene er utdatert. Trykk «Finn med KI» på nytt.",
  nearest: "Nærmeste treff (uten KI)",
  registered: "Registrert fra før",
  chooseTg: "Velg TG2 eller TG3",
  nationalId: "Notatet ser ut til å ha et fødselsnummer. Ta det bort før du bruker KI.",
  noteAdded: "Notatet er lagt til.",
} as const;

// --- Database (bare lokal database eller testdatabasen) -------------------------------------

function sql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

type Ref = { source: string; id: string };
type AiRow = {
  id: string;
  feature: string;
  status: string | null;
  outcome: string;
  targetRef: { type: string; id: string; fieldKey: string };
  candidateRefs: Ref[] | null;
  chosenCandidate: Ref | null;
  outputText: string | null;
  all: string;
};

/** Radene for `outcome_match` i oppdragets rapport, eldste først. Bare lesing. */
async function matchRows(bath: SampleBathroom): Promise<AiRow[]> {
  const db = sql();
  try {
    return await db<AiRow[]>`
      select l.id, l.feature, l.status, l.outcome, l.target_ref as "targetRef",
        l.candidate_refs as "candidateRefs", l.chosen_candidate as "chosenCandidate",
        l.output_text as "outputText", to_jsonb(l)::text as "all"
      from ai_usage_log l join reports r on r.id = l.report_id
      where r.assignment_id = ${bath.assignmentId} and l.feature = 'outcome_match'
      order by l.created_at, l.id`;
  } finally {
    await db.end();
  }
}

type DeviationRow = {
  id: string;
  tg: number | null;
  checkpointKey: string;
  deviationText: string | null;
  textSource: string;
};

/** Avvikene i oppdragets rapport som ikke er slettet. Bare lesing. */
async function deviations(bath: SampleBathroom): Promise<DeviationRow[]> {
  const db = sql();
  try {
    return await db<DeviationRow[]>`
      select d.id, d.tg, c.key as "checkpointKey", d.deviation_text as "deviationText",
        d.text_source as "textSource"
      from deviations d
        join reports r on r.id = d.report_id
        join checkpoint_results cr on cr.id = d.checkpoint_result_id
        join checkpoints c on c.id = cr.checkpoint_id
      where r.assignment_id = ${bath.assignmentId} and d.deleted_at is null
      order by d.created_at, d.id`;
  } finally {
    await db.end();
  }
}

/** Linjene i revisjonsloggen som nevner merket (alle kolonner som tekst). Bare lesing. */
async function auditRowsWith(text: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from audit_log a
      where to_jsonb(a)::text like ${`%${text}%`}
        and a.created_at > now() - interval '1 hour'`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

function noteField(page: Page): Locator {
  return page.getByLabel(TEXT.field, { exact: true });
}

function findButton(page: Page): Locator {
  return page.getByTestId("outcome-match-find");
}

function matchGroup(page: Page): Locator {
  return page.getByTestId("outcome-match-group");
}

function matchHits(page: Page): Locator {
  return matchGroup(page).getByTestId("outcome-match-hit");
}

function matchMessage(page: Page): Locator {
  return page.getByTestId("outcome-match-message");
}

function nearestGroup(page: Page): Locator {
  return page.getByTestId("outcome-nearest-group");
}

function addDeviationButton(page: Page): Locator {
  return page.getByRole("button", { name: "+ Avvik", exact: true });
}

/** Badet åpent på gulvet, innlogget som prøvetakstmannen. */
async function openFloor(page: Page): Promise<SampleBathroom> {
  const bath = await createSampleBathroom();
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, FLOOR);
  return bath;
}

/** «+ Avvik»: fokus skal stå i feltet. */
async function openPanel(page: Page) {
  await addDeviationButton(page).click();
  await expect(noteField(page)).toBeFocused();
}

/** Skriver notatet og trykker «Finn med KI». Venter på gruppen med treff. */
async function findWithAi(page: Page, note = NOTE) {
  await noteField(page).fill(note);
  await findButton(page).click();
  await expect(matchGroup(page)).toBeVisible();
}

/** Treffet for gulvflisene blant KI-treffene. */
function floorTilesHit(page: Page): Locator {
  return matchHits(page)
    .filter({ hasText: FLOOR_TILES_TEXT })
    .and(page.locator(`[data-checkpoint='${FLOOR}']`));
}

function deviationText(card: Locator): Locator {
  return card.getByLabel("Avvik", { exact: true });
}

/** Venter til avviket står slik i databasen. */
async function expectDeviation(bath: SampleBathroom, expected: Partial<DeviationRow>, index = 0) {
  await expect
    .poll(async () => {
      const row = (await deviations(bath))[index];
      if (!row) return null;
      const picked: Record<string, unknown> = {};
      for (const key of Object.keys(expected)) picked[key] = row[key as keyof DeviationRow];
      return picked;
    })
    .toEqual(expected);
}

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO" });
  return { context, page: await context.newPage() };
}

/** Alt nettleseren har lagret: adressen, `localStorage` og innholdet i IndexedDB. */
async function browserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [window.location.href, JSON.stringify({ ...window.localStorage })];
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const info of databases) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error);
        });
        parts.push(JSON.stringify(values));
      }
      db.close();
    }
    return parts.join("\n");
  });
}

async function expectHeightAtLeast(target: Locator, min: number, what: string) {
  const box = await target.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

// --- S7.1–S7.8 hovedflyten, notatet og treffene ----------------------------------------------

test("S7.1 hovedflyten: skriv, «Finn med KI», velg; 1–3 treff uten forhåndsvalg, tre trykk", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  const actions = countServerActions(page);
  actions.reset();

  let taps = 0;
  await noteField(page).fill(NOTE);
  taps += 1;
  await expect(findButton(page)).toHaveText(TEXT.find);
  await findButton(page).click();
  taps += 1;
  const group = matchGroup(page);
  await expect(group).toBeVisible();
  await expect(group.getByRole("heading", { name: TEXT.groupHeading })).toBeVisible();

  const hits = matchHits(page);
  const count = await hits.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  for (let i = 0; i < count; i++) {
    const hit = hits.nth(i);
    // Ingen er markert som valgt
    for (const attribute of ["aria-selected", "aria-checked", "aria-pressed", "aria-current"]) {
      expect(await hit.getAttribute(attribute), `${attribute} på treff ${i + 1}`).not.toBe("true");
    }
    // Punktnavnet først, så malens tekst, så TG med tekst
    await expect(hit).toContainText(/TG2|TG3|Velg TG2 eller TG3|HMS/);
  }
  const floor = floorTilesHit(page);
  await expect(floor).toHaveCount(1);
  const floorText = (await floor.innerText()).trim();
  expect(floorText.indexOf("Overflater gulv")).toBe(0);
  expect(floorText.indexOf("Overflater gulv")).toBeLessThan(floorText.indexOf(FLOOR_TILES_TEXT));
  await expect(matchMessage(page)).toContainText(/forslag fra KI/);

  await floor.click();
  taps += 1;
  const card = roomDeviationCard(page, 1);
  await expect(card.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(roomCheckpointHeading(page)).toHaveText("Overflater gulv");
  await expect(deviationText(card)).toHaveValue(FLOOR_TILES_TEXT);
  expect(taps, "tre trykk fra notat til avvik").toBe(3);
  expect(actions.count(), "to serverhandlinger: søket og valget").toBe(2);

  await expectDeviation(bath, {
    checkpointKey: FLOOR,
    tg: 2,
    deviationText: FLOOR_TILES_TEXT,
    textSource: "template",
  });
  await expect.poll(async () => (await matchRows(bath)).map((r) => r.status)).toEqual(["accepted"]);
  const [row] = await matchRows(bath);
  expect(row!.outcome).toBe("ok");
  expect(row!.outputText ?? "").toBe("");
  expect(row!.targetRef).toMatchObject({ type: "report", fieldKey: "new_deviation" });
  expect(row!.candidateRefs!.length).toBe(count);
  expect(row!.candidateRefs).toContainEqual(row!.chosenCandidate);
});

test("S7.2 «Legg notatet til» gir malens tekst og notatet; «Angre» setter malens tekst tilbake, også etter ny innlasting", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page);
  await floorTilesHit(page).click();
  const card = roomDeviationCard(page, 1);
  const offer = card.getByTestId("note-offer");
  await expect(offer).toBeVisible();
  await expect(offer).toContainText(`«${NOTE}»`);

  const withNote = `${FLOOR_TILES_TEXT} Sprekk i flis ved sluket, litt løs.`;
  await offer.getByTestId("note-offer-add").click();
  await expect(deviationText(card)).toHaveValue(withNote);
  await expect(card.getByTestId("note-offer")).toContainText(TEXT.noteAdded);
  await expect(card.getByTestId("note-offer-undo")).toBeFocused();
  // «Språkvask avviket» står rett ved siden av «Angre»
  await expect(
    card.getByTestId("note-offer").getByRole("button", { name: "Språkvask avviket" }),
  ).toBeVisible();
  await expectDeviation(bath, { deviationText: withNote, textSource: "edited" });

  await card.getByTestId("note-offer-undo").click();
  await expect(deviationText(card)).toHaveValue(FLOOR_TILES_TEXT);
  await expectDeviation(bath, { deviationText: FLOOR_TILES_TEXT, textSource: "template" });

  await page.reload();
  await expect(deviationText(roomDeviationCard(page, 1))).toHaveValue(FLOOR_TILES_TEXT);
});

test("S7.2 «Legg notatet til» står etter ny innlasting", async ({ page }) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page);
  await floorTilesHit(page).click();
  const card = roomDeviationCard(page, 1);
  await card.getByTestId("note-offer-add").click();
  const withNote = `${FLOOR_TILES_TEXT} Sprekk i flis ved sluket, litt løs.`;
  await expectDeviation(bath, { deviationText: withNote, textSource: "edited" });
  await page.reload();
  await expect(deviationText(roomDeviationCard(page, 1))).toHaveValue(withNote);
});

test("S7.3 «Bruk bare notatet» finnes uten flettefelt og mangler for fallet (måling i malens tekst)", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page);
  await floorTilesHit(page).click();
  const card = roomDeviationCard(page, 1);
  await expect(card.getByTestId("note-offer-only")).toBeVisible();
  await card.getByTestId("note-offer-only").click();
  await expect(deviationText(card)).toHaveValue("Sprekk i flis ved sluket, litt løs.");
  await expectDeviation(bath, {
    deviationText: "Sprekk i flis ved sluket, litt løs.",
    textSource: "edited",
  });

  await openPanel(page);
  await findWithAi(page, FALL_NOTE);
  const fall = matchHits(page).filter({ hasText: "Målt fall mot sluk" });
  await expect(fall).toHaveCount(1);
  await fall.click();
  const fallCard = roomDeviationCard(page, 2);
  const offer = fallCard.getByTestId("note-offer");
  await expect(offer).toBeVisible();
  await expect(offer.getByTestId("note-offer-add")).toBeVisible();
  await expect(offer.getByTestId("note-offer-only")).toHaveCount(0);
  await expect(offer).toContainText(
    "Malens tekst har en måling eller et årstall, så notatet kan bare legges til.",
  );
});

test("S7.4 uten trykk beholdes malens tekst, også etter ny innlasting", async ({ page }) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page);
  await floorTilesHit(page).click();
  await expect(roomDeviationCard(page, 1).getByTestId("note-offer")).toBeVisible();
  await expectDeviation(bath, { deviationText: FLOOR_TILES_TEXT, textSource: "template" });
  await page.reload();
  const card = roomDeviationCard(page, 1);
  await expect(deviationText(card)).toHaveValue(FLOOR_TILES_TEXT);
  // Tilbudet forsvinner uten å endre noe
  await expect(card.getByTestId("note-offer")).toHaveCount(0);
  await expectDeviation(bath, { deviationText: FLOOR_TILES_TEXT, textSource: "template" });
});

test("S7.5 Enter med null tekstsøk-treff kjører «Finn med KI»", async ({ page }) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await noteField(page).fill(NOTE);
  await expect(page.getByText("Ingen avvik passer.").or(page.getByText("0 treff"))).toBeVisible();
  await noteField(page).press("Enter");
  await expect(matchGroup(page)).toBeVisible();
  await expect.poll(async () => (await matchRows(bath)).length).toBe(1);
});

test("S7.6 «Ingen utfall passer»: nøytral tekst uten TG, notatet står i feltet", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  const note = "qqq zzz xyv";
  await noteField(page).fill(note);
  await findButton(page).click();
  const message = matchMessage(page);
  await expect(message).toHaveText(TEXT.noMatch);
  await expect(message).not.toContainText("TG");
  await expect(message).not.toContainText(/ingen avvik/i);
  await expect(matchGroup(page)).toHaveCount(0);
  await expect(noteField(page)).toHaveValue(note);
  await expect
    .poll(async () => (await matchRows(bath)).map((r) => r.outcome))
    .toEqual(["no_match"]);
});

test("S7.7 «Velg TG2 eller TG3»: takstmannen velger TG selv, ingen forhåndsvalg selv om notatet sier TG3", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page, `${FALL_NOTE}, dette er TG3`);
  const fall = matchHits(page).filter({ hasText: "Målt fall mot sluk" });
  await expect(fall).toHaveCount(1);
  await expect(fall).toContainText(TEXT.chooseTg);
  // Ingen TG-merke ved siden av «Velg TG2 eller TG3», selv om notatet sier TG3
  expect((await fall.innerText()).replace(TEXT.chooseTg, "")).not.toMatch(/TG\s?[23]/);
  await expect(fall.getByRole("img", { name: /TG/ })).toHaveCount(0);
  await fall.click();
  const card = roomDeviationCard(page, 1);
  const tg = card.getByRole("group", { name: "TG", exact: true });
  await expect(tg).toBeVisible();
  await expect(tg.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(tg.getByRole("radio").first()).toBeFocused();
  await expectDeviation(bath, { tg: null });
});

test("S7.8 «Registrert fra før»: samme søk merker treffet, trykk åpner avviket som finnes", async ({
  page,
}) => {
  const bath = await openFloor(page);
  await openPanel(page);
  await findWithAi(page);
  await floorTilesHit(page).click();
  await expect(roomDeviationCard(page, 1)).toBeVisible();

  await openPanel(page);
  await findWithAi(page);
  const again = floorTilesHit(page);
  await expect(again).toHaveAttribute("data-registered", "true");
  await expect(again).toContainText(TEXT.registered);
  await again.click();
  await expect(roomDeviationCard(page, 1).getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(roomDeviationCard(page, 2)).toHaveCount(0);
  expect(await deviations(bath)).toHaveLength(1);
  // Søket som ikke ble brukt, er avvist
  await expect
    .poll(async () => (await matchRows(bath)).map((r) => r.status))
    .toEqual(["accepted", "rejected"]);
});

// --- S7.9–S7.13 uten nett, KI av, feil, utdatert og lekkasje --------------------------------

test("S7.9 uten nett: ingen «Finn med KI», «Nærmeste treff (uten KI)» og ingen loggrad; «Forslag» gir treff med egen tekst (T-0146)", async ({
  page,
  context,
}) => {
  const bath = await openFloor(page);
  // Et avvik fra punktlisten (med nett), så «Forslag» kan prøves uten nett etterpå
  await openPanel(page);
  await page
    .getByRole("button", { name: /^Det er sprukne fliser eller riss i fuger på gulvet/ })
    .click();
  const card = roomDeviationCard(page, 1);
  await expect(card).toBeVisible();

  await context.setOffline(true);
  try {
    await openPanel(page);
    await noteField(page).fill(NOTE);
    await expect(findButton(page)).toHaveCount(0);
    await expect(matchMessage(page)).toHaveText(TEXT.offline);
    const nearest = nearestGroup(page);
    await expect(nearest).toBeVisible();
    await expect(nearest.getByRole("heading", { name: TEXT.nearest })).toBeVisible();
    const hits = nearest.getByTestId("outcome-match-hit");
    expect(await hits.count()).toBeGreaterThanOrEqual(1);
    expect(await hits.count()).toBeLessThanOrEqual(3);
    await expect(hits.filter({ hasText: FLOOR_TILES_TEXT }).first()).toBeVisible();
    await page.getByRole("button", { name: "Avbryt", exact: true }).click();

    // T-0146: «Forslag» med egen tekst gir treff uten nett
    const cause = card.getByLabel("Årsak", { exact: true });
    await cause.fill("vann kan trenge inn i bjelkelaget");
    await card.getByRole("button", { name: "Forslag til årsak (/)", exact: true }).click();
    const list = card.getByTestId("phrase-list");
    await expect(list).toHaveAttribute("data-phase", "fallback");
    expect(await list.getByTestId("phrase-candidate").count()).toBeGreaterThanOrEqual(1);
  } finally {
    await context.setOffline(false);
  }
  expect(await matchRows(bath)).toEqual([]);
});

test("S7.10 KI av: ingen «Finn med KI», «KI er av», «Nærmeste treff (uten KI)» og ingen loggrad", async ({
  page,
}) => {
  const previous = await setSampleAiEnabled(false);
  try {
    const bath = await openFloor(page);
    await openPanel(page);
    await noteField(page).fill(NOTE);
    await expect(nearestGroup(page)).toBeVisible();
    await expect(
      nearestGroup(page).getByTestId("outcome-match-hit").filter({ hasText: FLOOR_TILES_TEXT }),
    ).toHaveCount(1);
    // Kortet og skissen 3.8: ingen KI-knapp når KI er av, heller ikke før første forsøk
    await expect(findButton(page)).toHaveCount(0);
    await expect(matchMessage(page)).toHaveText(TEXT.aiOff);
    expect(await matchRows(bath)).toEqual([]);
  } finally {
    await restoreSampleAiEnabled(previous);
  }
});

test("S7.11 «KI svarte ikke»: melding, notatet står, dobbelttrykk gir én rad", async ({ page }) => {
  const bath = await openFloor(page);
  await openPanel(page);
  const note = `sprekk i flis ${FAKE_ERROR_INPUT}`;
  await noteField(page).fill(note);
  await findButton(page).dblclick();
  await expect(matchMessage(page)).toHaveText(TEXT.aiError);
  await expect(noteField(page)).toHaveValue(note);
  await expect(matchGroup(page)).toHaveCount(0);
  await expect.poll(async () => (await matchRows(bath)).length).toBe(1);
  // Ingen rad nummer to kommer etter en stund
  await page.waitForTimeout(500);
  const rows = await matchRows(bath);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.outcome).toBe("error");
});

test("S7.12 utdatert: søk i fane 1, så i fane 2; valg i fane 1 gir meldingen og lager ikke avvik", async ({
  page,
  context,
}) => {
  const bath = await openFloor(page);
  const second = await context.newPage();
  await openSampleBathroom(second, bath, FLOOR);

  await openPanel(page);
  await findWithAi(page);
  await openPanel(second);
  await findWithAi(second);

  await floorTilesHit(page).click();
  await expect(matchMessage(page)).toHaveText(TEXT.outdated);
  await expect(matchHits(page)).toHaveCount(0);
  expect(await deviations(bath)).toHaveLength(0);

  // Søket i fane 2 virker
  await floorTilesHit(second).click();
  await expect(roomDeviationCard(second, 1)).toBeVisible();
  await expect.poll(async () => (await deviations(bath)).length).toBe(1);
  await second.close();
});

test("S7.13 notatet lekker ikke: ikke i adressen, localStorage, IndexedDB, KI-loggen eller revisjonsloggen", async ({
  page,
}) => {
  const bath = await openFloor(page);
  const note = `${MARKER} 77 7 2 ${NOTE}`;
  await openPanel(page);
  await findWithAi(page, note);
  expect(await browserStorage(page)).not.toContain(MARKER);
  // Hvilket treff som velges, er uten betydning her
  await matchHits(page).first().click();
  await expect(roomDeviationCard(page, 1)).toBeVisible();
  expect(await browserStorage(page)).not.toContain(MARKER);

  // Nytt søk som lukkes med «Avbryt» (avvisningen går i bakgrunnen)
  await openPanel(page);
  await findWithAi(page, note);
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await expect.poll(async () => (await matchRows(bath)).length).toBe(2);
  expect(await browserStorage(page)).not.toContain(MARKER);
  expect(page.url()).not.toContain(encodeURIComponent(MARKER));
  for (const row of await matchRows(bath)) expect(row.all).not.toContain(MARKER);
  expect(await auditRowsWith(MARKER)).toBe(0);
});

// --- S7.14–S7.19 tastatur, iPad, kontor, diktering, notatet i rommet, fødselsnummer ---------

test("S7.14 tastatur og skjermleser: Tab-rekkefølge, Escape, aria-live og axe uten brudd", async ({
  page,
}) => {
  await openFloor(page);
  await openPanel(page);
  const note = "sprukne fliser";
  await noteField(page).fill(note);
  // Før svaret: felt → «Finn med KI»
  await page.keyboard.press("Tab");
  await expect(findButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(matchGroup(page)).toBeVisible();
  const live = matchMessage(page);
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toHaveText(/^\d forslag fra KI\.( Ingen er valgt\.)?$/);

  // Etter svaret: felt → KI-treffene → «Finn på nytt» → tekstsøkets treff (skissen avsnitt 2)
  const aiCount = await matchHits(page).count();
  await noteField(page).focus();
  const order: string[] = [];
  for (let i = 0; i < aiCount + 2; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "ingen";
        if (el.closest("[data-testid='outcome-match-group']")) return "ki-treff";
        if (el.getAttribute("data-testid") === "outcome-match-find") return "finn";
        if (el.getAttribute("data-testid") === "outcome-match-hit") return "søketreff";
        return el.tagName.toLowerCase();
      }),
    );
  }
  expect(order).toEqual([...Array<string>(aiCount).fill("ki-treff"), "finn", "søketreff"]);
  await expectNoAxeViolations(page, "åpen treffliste fra KI");

  await page.keyboard.press("Escape");
  await expect(noteField(page)).toHaveCount(0);
  await expect(addDeviationButton(page)).toBeFocused();

  // Notattilbudet i avvikskortet
  await openPanel(page);
  await findWithAi(page, NOTE);
  await floorTilesHit(page).click();
  await expect(roomDeviationCard(page, 1).getByTestId("note-offer")).toBeVisible();
  await expectNoAxeViolations(page, "notattilbudet i avvikskortet");
});

test("S7.15 iPad stående: knappene og treffene er minst 56 px, ingen vannrett rulling, tekstsøket tar ikke imot trykk rett etter KI-svaret", async ({
  page,
}) => {
  await page.setViewportSize(IPAD_PORTRAIT);
  await openFloor(page);
  await openPanel(page);
  await noteField(page).fill("sprukne fliser");
  await expectHeightAtLeast(findButton(page), 56, "«Finn med KI»");
  const textHits = page
    .getByTestId("outcome-match-hit")
    .and(page.locator(":not([data-testid='outcome-match-group'] *)"));
  await expect(textHits.first()).toBeVisible();
  await findButton(page).click();
  await expect(matchGroup(page)).toBeVisible();
  // Skissen avsnitt 2: tekstsøkets liste flyttes ned én gang og er sperret mot trykk en kort
  // stund, så et trykk på vei ikke treffer et annet treff
  const list = textHits.first().locator("xpath=ancestor::ul[1]");
  expect(await list.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await expect
    .poll(() => list.evaluate((el) => getComputedStyle(el).pointerEvents))
    .not.toBe("none");
  const hits = matchHits(page);
  for (let i = 0; i < (await hits.count()); i++) {
    await expectHeightAtLeast(hits.nth(i), 56, `KI-treff ${i + 1}`);
  }
  await expectHeightAtLeast(findButton(page), 56, "«Finn på nytt»");
  await expectNoHorizontalScroll(page, "iPad stående med KI-treff");
  await expectNoAxeViolations(page, "iPad stående med KI-treff");
});

test("S7.16 kontor ser ikke «Finn med KI» og kan ikke lage avvik", async ({ browser, page }) => {
  const bath = await openFloor(page);
  await ensureSampleOrgEmployee({
    email: OFFICE_EMAIL,
    name: "Oppdiktet kontor Skriv det du ser",
    role: "office",
  });
  const office = await newPage(browser);
  try {
    await logIn(office.page, OFFICE_EMAIL);
    await office.page.goto(`/oppdrag/${bath.assignmentId}/rom/${bath.roomId}?punkt=${FLOOR}`);
    await expect(office.page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
    await expect(addDeviationButton(office.page)).toHaveCount(0);
    await expect(findButton(office.page)).toHaveCount(0);
    await expect(office.page.getByLabel(TEXT.field)).toHaveCount(0);
  } finally {
    await office.context.close();
  }
  expect(await matchRows(bath)).toEqual([]);
  expect(await deviations(bath)).toEqual([]);
});

test("S7.17 ingen diktering: ingen mikrofonknapp og ingen tekst om diktering i panelet", async ({
  page,
}) => {
  await openFloor(page);
  await openPanel(page);
  await noteField(page).fill(NOTE);
  await findButton(page).click();
  await expect(matchGroup(page)).toBeVisible();
  const panel = page.locator("section[aria-labelledby='add-deviation-heading']");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /mikrofon|dikter|tale/i })).toHaveCount(0);
  expect((await panel.innerText()).toLowerCase()).not.toMatch(/dikter|mikrofon/);
});

test("S7.18 notatet i rommet (iPad stående): står ved lukk, «Avbryt» og Escape; tomt etter annet rom og etter ny innlogging", async ({
  page,
}) => {
  await page.setViewportSize(IPAD_PORTRAIT);
  const bath = await openFloor(page);
  const note = "løs flis ved terskelen";
  await openPanel(page);
  await noteField(page).fill(note);
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await openPanel(page);
  await expect(noteField(page)).toHaveValue(note);
  await page.keyboard.press("Escape");
  await openPanel(page);
  await expect(noteField(page)).toHaveValue(note);
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();

  // Ut av rommet og tilbake til badet med navigering i appen (ingen ny innlasting av siden, så
  // bare at rommet tas ned kan tømme notatet). Merket på `window` viser at siden ikke lastes.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
  });
  const navigate = async (url: string) => {
    await page.evaluate((target) => {
      const next = (window as unknown as { next?: { router?: { push(url: string): void } } }).next;
      if (!next?.router) throw new Error("fant ikke ruteren i appen");
      next.router.push(target);
    }, url);
    await page.waitForURL((current) => `${current.pathname}${current.search}` === url);
  };
  // Soverommet har ingen badskjerm (gir «Fant ikke siden»), så rommet forlates via oppdraget
  await page.getByRole("link", { name: "Tilbake til oppdraget" }).click();
  await page.waitForURL(new RegExp(`/oppdrag/${bath.assignmentId}$`));
  await expect(roomCheckpointHeading(page)).toHaveCount(0);
  await navigate(`/oppdrag/${bath.assignmentId}/rom/${bath.roomId}?punkt=${FLOOR}`);
  await expect(roomCheckpointHeading(page)).toHaveText("Overflater gulv");
  expect(
    await page.evaluate(
      () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
    ),
    "samme side, ingen ny innlasting",
  ).toBe(true);
  await openPanel(page);
  await expect(noteField(page)).toHaveValue("");

  // Logg ut og inn igjen
  await noteField(page).fill(note);
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.getByRole("button", { name: "Logg ut" }).click();
  await expect(page).toHaveURL(/\/logg-inn/);
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, FLOOR);
  await openPanel(page);
  await expect(noteField(page)).toHaveValue("");
});

test("S7.19 fødselsnummer: meldingen i panelet, ingen kall og ingen loggrad", async ({ page }) => {
  const bath = await openFloor(page);
  await openPanel(page);
  const actions = countServerActions(page);
  actions.reset();
  await noteField(page).fill(`sprekk i flis hos ${FAKE_NATIONAL_ID}`);
  await expect(page.getByText(TEXT.nationalId)).toBeVisible();
  await expect(page.locator("section[aria-labelledby='add-deviation-heading']")).not.toContainText(
    FAKE_NATIONAL_ID.slice(0, 6),
  );
  await expect(findButton(page)).toBeDisabled();
  await noteField(page).press("Enter");
  await page.waitForTimeout(300);
  expect(actions.count(), "ingen serverhandling med fødselsnummer i notatet").toBe(0);
  expect(await matchRows(bath)).toEqual([]);
});
