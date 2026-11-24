import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import {
  FAKE_ADD_TG_INPUT,
  FAKE_ERROR_INPUT,
  FAKE_NO_MATCH_INPUT,
} from "../src/core/ai/providers/fake";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  addRuleTg3Deviation,
  bathroomSaveState,
  createSampleBathroom,
  deviationCardOn,
  e2eDatabaseUrl,
  ensureSampleOrgEmployee,
  expectNoAxeViolations,
  logIn,
  logInAsSampleInspector,
  openSampleBathroom,
  restoreSampleAiEnabled,
  SAMPLE_ADMIN_ONLY_EMAIL,
  setSampleAiEnabled,
  type SampleBathroom,
} from "./helpers";

/*
 * KI i veien på badskjermen (fase 2a-2). Testplan: docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * avsnitt 7 (K7.1–K7.17), oppgavekortet docs/funksjoner/fase2a-ki-i-veien.md. Kjører i prosjektene
 * `pc` (1280 × 720) og `ipad` (liggende 1194 × 834); stående iPad prøves med `setViewportSize`.
 * Nederst står testene som er flyttet fra den fjernede prøvesiden `/prove/ki` (K6.3): det som
 * fortsatt gjelder for forslagskortet, prøvd på badskjermen.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (publisert badmal, KI på med den
 * falske leverandøren). Hver test lager sitt eget oppdrag med ett bad (`createSampleBathroom`),
 * og leser KI-loggen bare for sin egen rapport, fordi e2e-databasen deles. Alt er oppdiktet.
 * Innlogging med engangskode (`logIn` velger koden med `chooseCodeLogin`).
 *
 * Støtter hovedmål: KI i bunnen (forslag, språkvask og sammendrag går gjennom kjernen, logges og
 * godkjennes av takstmannen; KI setter aldri TG), de ansatte (to trykk fra «Forslag» til tekst og
 * til et språkvasket avvik, tekstsøk uten nett, tastatur og skjermleser, PC og iPad) og færre
 * reklamasjoner (TG og rekkefølge fra koden, vaktene stopper svar som endrer TG, advarsel når
 * sammendraget ikke stemmer med funnene).
 */

const MEMBRANE = "wet_room.membrane_drain";
const MEMBRANE_NAME = "Vanntett sjikt, membran og sluk";
const PORTRAITS = [
  { width: 834, height: 1194 },
  { width: 1024, height: 1366 },
] as const;
const OFFICE_EMAIL = "kontor.ki-i-veien.e2e@example.invalid";
const OFFLINE = "Trenger nett. Teksten din er lagret.";
const STOPPED =
  "KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret.";
const OTHER_TG3 = "Se over konsekvens og tiltak. Teksten hører til TG3.";

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
  errorCode: string | null;
  targetRef: { type: string; id: string; fieldKey: string };
  candidateRefs: Ref[] | null;
  chosenCandidate: Ref | null;
  outputText: string | null;
  redactedCount: number;
  tokensIn: number;
};

/** Radene i KI-loggen for rapporten i oppdraget, eldste først. Bare lesing. */
async function aiRows(bath: SampleBathroom, feature?: string): Promise<AiRow[]> {
  const db = sql();
  try {
    const rows = await db<AiRow[]>`
      select l.id, l.feature, l.status, l.outcome, l.error_code as "errorCode",
        l.target_ref as "targetRef", l.candidate_refs as "candidateRefs",
        l.chosen_candidate as "chosenCandidate", l.output_text as "outputText",
        l.redacted_count as "redactedCount", l.tokens_in as "tokensIn"
      from ai_usage_log l join reports r on r.id = l.report_id
      where r.assignment_id = ${bath.assignmentId}
      order by l.created_at, l.id`;
    return feature ? rows.filter((row) => row.feature === feature) : rows;
  } finally {
    await db.end();
  }
}

type DeviationRow = {
  id: string;
  tg: number | null;
  deviationText: string | null;
  causeText: string | null;
  consequenceText: string | null;
  measures: string[];
};

/** Avvikene i rapporten med tiltakene i rekkefølge. Bare lesing. */
async function deviations(bath: SampleBathroom): Promise<DeviationRow[]> {
  const db = sql();
  try {
    return await db<DeviationRow[]>`
      select d.id, d.tg, d.deviation_text as "deviationText", d.cause_text as "causeText",
        d.consequence_text as "consequenceText",
        coalesce((select array_agg(m.text order by m.sort_order) from deviation_measures m
          where m.deviation_id = d.id and m.deleted_at is null), '{}') as measures
      from deviations d join reports r on r.id = d.report_id
      where r.assignment_id = ${bath.assignmentId} and d.deleted_at is null
      order by d.created_at, d.id`;
  } finally {
    await db.end();
  }
}

/** Sammendraget slik det står i rapporten. Bare lesing. */
async function summaryOf(
  bath: SampleBathroom,
): Promise<{ text: string | null; basis: unknown[] | null }> {
  const db = sql();
  try {
    const [row] = await db<{ text: string | null; basis: unknown[] | null }[]>`
      select summary_text as text, summary_basis as basis from reports
      where assignment_id = ${bath.assignmentId} and deleted_at is null`;
    return row ?? { text: null, basis: null };
  } finally {
    await db.end();
  }
}

async function doneCount(bath: SampleBathroom): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count
      from checkpoint_results c join reports r on r.id = c.report_id
      where r.assignment_id = ${bath.assignmentId} and c.done and c.deleted_at is null`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

/** Linjene i `audit_log` for en rad i KI-loggen. Bare lesing. */
async function auditCount(entityId: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from audit_log where entity_id = ${entityId}`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

/**
 * Kopierer et avvik `copies` ganger i samme punkt (oppdiktet, bare for grensen «for mange funn»).
 * Ingen sletting; kopiene får nye id-er.
 */
async function copyDeviation(deviationId: string, copies: number): Promise<void> {
  const db = sql();
  try {
    await db`
      insert into deviations
      select (jsonb_populate_record(null::deviations, to_jsonb(d) || jsonb_build_object(
        'id', gen_random_uuid(), 'sort_order', d.sort_order + g))).*
      from deviations d cross join generate_series(1, ${copies}::int) g
      where d.id = ${deviationId}`;
  } finally {
    await db.end();
  }
}

/** `access.inspectors_edit_all` i prøveorganisasjonen. Gir verdien som sto der før. */
async function setSampleInspectorsEditAll(value: boolean | null): Promise<boolean | null> {
  const db = sql();
  try {
    const [org] = await db<{ id: string; previous: boolean | null }[]>`
      select id, (settings ->> 'access.inspectors_edit_all')::boolean as previous
      from organizations where settings ->> 'sampleData' = 'true' and deleted_at is null
      order by created_at limit 1`;
    if (!org) throw new Error("Fant ikke prøveorganisasjonen (pnpm db:seed:testoppdrag)");
    if (value === null) {
      await db`update organizations set settings = settings - 'access.inspectors_edit_all'
        where id = ${org.id}`;
    } else {
      await db`update organizations
        set settings = settings || jsonb_build_object('access.inspectors_edit_all', ${value}::boolean)
        where id = ${org.id}`;
    }
    return org.previous;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

/** Den falske leverandørens språkvask: stor forbokstav og punktum til slutt. */
function polished(text: string): string {
  const trimmed = text.replace(/[ \t]+/g, " ").trim();
  const capitalized = trimmed.charAt(0).toLocaleUpperCase("nb-NO") + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Unik, oppdiktet markør uten sifre (tallvakten skal ikke slå til på merket). */
function marker(): string {
  return `merke${randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 6)}`;
}

function field(scope: Locator, label: string): Locator {
  return scope.getByLabel(label, { exact: true });
}

function phraseButton(scope: Locator, name: "avvik" | "årsak" | "konsekvens" | "tiltak") {
  return scope.getByRole("button", { name: `Forslag til ${name} (/)`, exact: true });
}

function phraseList(scope: Locator): Locator {
  return scope.getByTestId("phrase-list");
}

function candidates(scope: Locator): Locator {
  return phraseList(scope).getByTestId("phrase-candidate");
}

/** Teksten slik den havner i feltet (første linje i kandidaten). */
async function candidateText(candidate: Locator): Promise<string> {
  return (await candidate.locator("span").first().textContent()) ?? "";
}

function polishButton(scope: Locator): Locator {
  return scope.getByRole("button", { name: "Språkvask avviket", exact: true });
}

function polishCard(scope: Locator, n = 1): Locator {
  return scope.getByRole("region", { name: `Forslag fra KI · språkvask av avvik ${n}` });
}

function polishRow(card: Locator, label: string): Locator {
  return card
    .getByTestId("ai-suggestion-group-row")
    .filter({ has: card.page().getByRole("heading", { name: label, exact: true }) });
}

function summarySection(page: Page): Locator {
  return page.getByRole("region", { name: "Sammendrag for hele rapporten" });
}

function summaryCard(page: Page): Locator {
  return summarySection(page).getByRole("region", { name: "Forslag fra KI" });
}

async function choose(scope: Locator | Page, group: string, option: string | RegExp) {
  await scope
    .getByRole("group", { name: group, exact: true })
    .locator("label")
    .filter({ hasText: option })
    .first()
    .click();
}

async function openCheckpoint(page: Page, name: string) {
  const portrait = (page.viewportSize()?.width ?? 1200) < 1024;
  if (portrait) {
    await page.getByRole("button", { name: /^Punkter \(\d+ av \d+\)$/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Kontrollpunkter" })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  }
  await expect(page.getByRole("heading", { level: 2, name })).toBeFocused();
}

/** «+ Avvik» på punktet som er åpent, og valget med teksten. */
async function addDeviation(page: Page, outcome: RegExp) {
  await page.getByRole("button", { name: "+ Avvik" }).click();
  await page.getByRole("button", { name: outcome }).click();
}

/** Venter til avvikets tekster står i databasen (lagret når feltet ble forlatt). */
async function expectSaved(
  bath: SampleBathroom,
  expected: Partial<Pick<DeviationRow, "deviationText" | "causeText" | "consequenceText">> & {
    measures?: string[];
  },
  index = 0,
) {
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

/** Skriver teksten i feltet og forlater det, så det lagres. */
async function write(target: Locator, text: string) {
  await target.fill(text);
  await target.blur();
}

/** Fyller avviket med egne, oppdiktede tekster og venter til de er lagret. */
async function writeOwnTexts(
  bath: SampleBathroom,
  deviation: Locator,
  texts: { deviation: string; cause: string; consequence: string; measure: string },
) {
  await write(field(deviation, "Avvik"), texts.deviation);
  await write(field(deviation, "Årsak"), texts.cause);
  await write(field(deviation, "Konsekvens"), texts.consequence);
  await write(field(deviation, "Tiltak 1"), texts.measure);
  await expectSaved(bath, {
    deviationText: texts.deviation,
    causeText: texts.cause,
    consequenceText: texts.consequence,
    measures: [texts.measure],
  });
}

/** Tømmer feltet og venter til den tomme verdien er lagret. */
async function clearSaved(
  bath: SampleBathroom,
  deviation: Locator,
  label: "Avvik" | "Årsak" | "Konsekvens",
) {
  await write(field(deviation, label), "");
  const key = { Avvik: "deviationText", Årsak: "causeText", Konsekvens: "consequenceText" }[label];
  await expectSaved(bath, { [key]: null });
}

/** Serverhandlingene (POST med `next-action`) siden sender, med innholdet. */
function recordActions(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) {
      bodies.push(request.postData() ?? "");
    }
  });
  return bodies;
}

const isPhraseRequest = (body: string) => body.includes('"requestId"') && body.includes('"field"');
const isPolishRequest = (body: string) => body.includes('"items"');

/** Holder igjen serverhandlingene som passer, til `release` kalles. */
async function holdActions(page: Page, matches: (body: string) => boolean) {
  const held: (() => void)[] = [];
  let holding = true;
  await page.route(
    (url) => url.pathname.includes("/rom/"),
    async (route) => {
      const request = route.request();
      if (
        holding &&
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        matches(request.postData() ?? "")
      ) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return route.continue().catch(() => {});
    },
  );
  return {
    count: () => held.length,
    release: () => {
      holding = false;
      for (const next of held.splice(0)) next();
    },
  };
}

/** Lagrer hver overskrift forslagslisten har hatt, i rekkefølge (byttet én gang, A485). */
async function recordListHeadings(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __phraseHeadings: string[] }).__phraseHeadings = seen;
    const record = () => {
      const heading = document.querySelector('[data-testid="phrase-list-heading"]');
      const text = heading?.textContent?.trim() ?? "";
      if (text !== "" && seen[seen.length - 1] !== text) seen.push(text);
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __phraseHeadings: string[] }).__phraseHeadings ?? [],
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

async function expectTouchTarget(target: Locator, min: number, what: string) {
  await expect(target, what).toBeVisible();
  const box = await target.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
  expect(box!.width, `${what} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
}

/** Alle synlige knapper i området er minst 44 × 44. */
async function expectButtonsAtLeast44(scope: Locator, where: string) {
  const buttons = await scope.getByRole("button").all();
  expect(buttons.length, where).toBeGreaterThan(0);
  for (const button of buttons) {
    if (!(await button.isVisible())) continue;
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    await expectTouchTarget(button, 44, `${where}: ${name.trim()}`);
  }
}

/** Badet med ett TG3-avvik fra reglene på «Vanntett sjikt, membran og sluk». */
async function bathWithTg3(page: Page): Promise<{ bath: SampleBathroom; deviation: Locator }> {
  const bath = await createSampleBathroom();
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, MEMBRANE);
  const deviation = await addRuleTg3Deviation(page);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  // Sammendraget har lest funnet på nytt (skjer like etter at avviket er lagt til)
  await expect(summarySection(page).getByRole("button", { name: "Lag utkast" })).toBeEnabled();
  return { bath, deviation };
}

/** Åpner «Forslag» og venter på KI-listen. */
async function openRankedList(deviation: Locator, name: Parameters<typeof phraseButton>[1]) {
  await phraseButton(deviation, name).click();
  await expect(phraseList(deviation)).toHaveAttribute("data-phase", "ranked");
}

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO" });
  return { context, page: await context.newPage() };
}

// --- K7.1–K7.5 fraseforslag -------------------------------------------------------------------

test("K7.1 fraseforslag: listen under feltet, tekstsøk og så KI, 3–5 linjer, to trykk til tekst i feltet", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  await clearSaved(bath, deviation, "Årsak");
  const cause = field(deviation, "Årsak");
  const hold = await holdActions(page, isPhraseRequest);
  const headings = await recordListHeadings(page);

  let taps = 0;
  await phraseButton(deviation, "årsak").click();
  taps += 1;
  const list = phraseList(deviation);
  await expect(list.getByTestId("phrase-list-heading")).toHaveText("Tekstsøk");
  await expect.poll(() => hold.count()).toBe(1);

  // Listen står i flyten rett under feltet, ikke som sprettopp eller dialog.
  const fieldBox = await cause.boundingBox();
  const listBox = await list.boundingBox();
  expect(listBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height);
  expect(await list.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  await expect(list.locator("xpath=ancestor::dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  hold.release();
  await expect(list).toHaveAttribute("data-phase", "ranked");
  await expect(list.getByTestId("phrase-list-heading")).toHaveText("Sortert av KI");
  expect(await headings()).toEqual(["Tekstsøk", "Sortert av KI"]);

  const items = candidates(deviation);
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    await expectTouchTarget(item, 44, `kandidat ${i + 1}`);
    // Punkt, utfall og «Utkast» (malens tekster er ikke godkjent ennå)
    await expect(item).toContainText(/·/);
    await expect(item).toContainText("Utkast");
    await expect(item).toContainText("Sett inn");
  }
  // TG står på kandidatene fra utfall med fast TG (utfallene «velg TG2 eller TG3» har ingen)
  await expect(items.filter({ hasText: /TG[23]/ }).first()).toBeVisible();

  const chosen = await candidateText(items.first());
  await items.first().click();
  taps += 1;
  await expect(cause).toHaveValue(chosen);
  await expect(deviation.getByRole("button", { name: "Angre", exact: true })).toBeVisible();
  await expect(deviation.getByText("Teksten er satt inn.")).toBeVisible();
  expect(taps, "to trykk fra «Forslag» til tekst i feltet").toBe(2);

  await expectSaved(bath, { causeText: chosen });
  await expect
    .poll(async () => (await aiRows(bath, "phrase_suggest")).map((row) => row.status))
    .toEqual(["accepted"]);
  const [row] = await aiRows(bath, "phrase_suggest");
  expect(row!.outcome).toBe("ok");
  expect(row!.outputText ?? "").toBe("");
  expect(row!.candidateRefs!.length).toBe(count);
  expect(row!.candidateRefs).toContainEqual(row!.chosenCandidate);
  expect(row!.targetRef).toMatchObject({ type: "deviation", fieldKey: "cause_text" });

  // Teksten er malens, merket «Utkast», også etter ny innlasting
  await page.reload();
  const again = deviationCardOn(page, 1);
  await expect(field(again, "Årsak")).toHaveValue(chosen);
  await expect(
    again
      .locator("label", { hasText: /^Årsak$/ })
      .locator("xpath=..")
      .getByText("Utkast"),
  ).toBeVisible();
});

test("K7.2 «Bytt ut teksten» når feltet har egen tekst; «Angre» setter tilbake og forsvinner når feltet forlates", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  const own = "uten klemring er overgangen mellom sjikt og sluk ikke sikker";
  await write(field(deviation, "Årsak"), own);
  await expectSaved(bath, { causeText: own });

  await openRankedList(deviation, "årsak");
  const first = candidates(deviation).first();
  await expect(first).toContainText("Bytt ut teksten");
  // Navnet er den synlige teksten i samme rekkefølge (WCAG 2.5.3): kandidaten først, handlingen sist
  await expect(first).toHaveAccessibleName(/Bytt ut teksten$/);
  const chosen = await candidateText(first);
  await first.click();
  await expect(field(deviation, "Årsak")).toHaveValue(chosen);
  await expect(deviation.getByText("Teksten er byttet ut.")).toBeVisible();

  await deviation.getByRole("button", { name: "Angre", exact: true }).click();
  await expect(field(deviation, "Årsak")).toHaveValue(own);
  await expect(deviation.getByRole("button", { name: "Angre", exact: true })).toHaveCount(0);
  await expectSaved(bath, { causeText: own });
  // Listen er lukket, så ingen rad blir stående som forslag etter «Angre»
  await expect
    .poll(async () => (await aiRows(bath, "phrase_suggest")).map((row) => row.status))
    .toEqual(["rejected"]);

  // Velg igjen, og gå til et annet felt: «Angre» forsvinner, teksten står.
  await openRankedList(deviation, "årsak");
  const again = candidates(deviation).first();
  const second = await candidateText(again);
  await again.click();
  await expect(deviation.getByRole("button", { name: "Angre", exact: true })).toBeVisible();
  await field(deviation, "Konsekvens").focus();
  await expect(deviation.getByRole("button", { name: "Angre", exact: true })).toHaveCount(0);
  await expect(field(deviation, "Årsak")).toHaveValue(second);
});

test("K7.3 tiltak: valget legger til et nytt tiltak, det som finnes er uendret", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  const before = await field(deviation, "Tiltak 1").inputValue();
  await openRankedList(deviation, "tiltak");
  const first = candidates(deviation).first();
  await expect(first).toContainText("Legg til som tiltak");
  const chosen = await candidateText(first);
  await first.click();
  await expect(field(deviation, "Tiltak 2")).toHaveValue(chosen);
  await expect(field(deviation, "Tiltak 1")).toHaveValue(before);
  await expect(deviation.getByText("Tiltaket er lagt til.")).toBeVisible();
  await expectSaved(bath, { measures: [before, chosen] });
  await expect
    .poll(async () => (await aiRows(bath, "phrase_suggest")).map((row) => row.status))
    .toEqual(["accepted"]);
  const [row] = await aiRows(bath, "phrase_suggest");
  expect(row!.targetRef).toMatchObject({ type: "deviation", fieldKey: "new_measure" });
});

test("K7.4 annen TG: tekst fra et TG3-utfall på et TG2-avvik gir advarselen", async ({ page }) => {
  const { bath, deviation } = await bathWithTg3(page);
  await choose(deviation, "TG", /^TG2$/);
  // Avviket kom fra et TG3-forslag: TG2 krever grunn (A490), og TG og grunn lagres sammen
  await choose(deviation, "Hvorfor endrer du TG fra forslaget?", "Synlig skade");
  await expect.poll(async () => (await deviations(bath))[0]?.tg).toBe(2);
  await clearSaved(bath, deviation, "Avvik");

  const warning = deviation.getByText(OTHER_TG3);
  const before = await warning.count();
  await openRankedList(deviation, "avvik");
  const tg3 = phraseList(deviation).getByRole("button", { name: /TG3/ }).first();
  await expect(tg3).toBeVisible();
  await tg3.click();
  await expect(deviation.getByRole("button", { name: "Angre", exact: true })).toBeVisible();
  await expect(warning).toHaveCount(before + 1);
});

test("K7.5 «Ingen treff» vises som tekst når ingen tekst passer", async ({ page }) => {
  const { bath, deviation } = await bathWithTg3(page);
  const text = `${FAKE_NO_MATCH_INPUT} ${marker()}`;
  await write(field(deviation, "Årsak"), text);
  await expectSaved(bath, { causeText: text });
  await phraseButton(deviation, "årsak").click();
  const list = phraseList(deviation);
  await expect(list).toHaveAttribute("data-phase", "no_match");
  await expect(list.getByText("Ingen treff. KI fant ingen tekst som passer.")).toBeVisible();
  await expect(candidates(deviation)).toHaveCount(0);
  await expect(field(deviation, "Årsak")).toHaveValue(text);
  const rows = await aiRows(bath, "phrase_suggest");
  expect(rows.map((row) => row.outcome)).toEqual(["no_match"]);
});

// --- K7.6–K7.7 språkvask ---------------------------------------------------------------------

test("K7.6 «Språkvask avviket»: ett kall, før og etter per felt, «Bruk alle», angre, «Behold min» og «Nytt forslag»", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  const tag = marker();
  const own = {
    deviation: `sjiktet under flisene er gammelt ${tag}`,
    cause: `sjiktet er lagt for lenge siden ${tag}`,
    consequence: `vann kan komme inn i gulvet ${tag}`,
    measure: `sjiktet bør skiftes ${tag}`,
  };
  await writeOwnTexts(bath, deviation, own);

  const actions = recordActions(page);
  let taps = 0;
  await polishButton(deviation).click();
  taps += 1;
  const card = polishCard(deviation);
  await expect(card).toBeVisible();
  const rows: [string, string][] = [
    ["Avvik", own.deviation],
    ["Årsak", own.cause],
    ["Konsekvens", own.consequence],
    ["Tiltak 1", own.measure],
  ];
  for (const [label, text] of rows) {
    const row = polishRow(card, label);
    await expect(row.getByTestId("ai-suggestion-text")).toHaveText(polished(text));
    await expect(row).toContainText("Din tekst");
    await expect(row).toContainText(text);
  }
  expect(actions.filter(isPolishRequest), "ett kall til serveren for hele avviket").toHaveLength(1);

  await card.getByRole("button", { name: "Bruk alle", exact: true }).click();
  taps += 1;
  expect(taps, "to trykk til hele avviket er språkvasket").toBe(2);
  await expect(field(deviation, "Avvik")).toHaveValue(polished(own.deviation));
  await expect(field(deviation, "Årsak")).toHaveValue(polished(own.cause));
  await expect(field(deviation, "Konsekvens")).toHaveValue(polished(own.consequence));
  await expect(field(deviation, "Tiltak 1")).toHaveValue(polished(own.measure));
  await expect(polishRow(card, "Avvik").getByText("Tekst fra KI, godkjent")).toBeVisible();

  // Angre per felt: bare årsaken går tilbake.
  await card.getByRole("button", { name: "Angre: Årsak", exact: true }).click();
  await expect(field(deviation, "Årsak")).toHaveValue(own.cause);
  await expect(field(deviation, "Avvik")).toHaveValue(polished(own.deviation));
  await expectSaved(bath, {
    deviationText: polished(own.deviation),
    causeText: own.cause,
    consequenceText: polished(own.consequence),
    measures: [polished(own.measure)],
  });
  // Én loggrad per felt, med egen target_ref
  await expect
    .poll(async () =>
      (await aiRows(bath, "language_polish"))
        .map((row) => `${row.targetRef.type}/${row.targetRef.fieldKey}:${row.status}`)
        .sort(),
    )
    .toEqual(
      [
        "deviation/deviation_text:accepted",
        "deviation/cause_text:suggested",
        "deviation/consequence_text:accepted",
        "deviation_measure/text:accepted",
      ].sort(),
    );

  // Lagret: står etter ny innlasting
  await page.reload();
  const reloaded = deviationCardOn(page, 1);
  await expect(field(reloaded, "Avvik")).toHaveValue(polished(own.deviation));
  await expect(field(reloaded, "Årsak")).toHaveValue(own.cause);

  // «Bruk» på ett felt, «Behold min» på et annet, og «Nytt forslag»
  const cause2 = `fugene i sluket er sprukne ${tag}`;
  const consequence2 = `vann kan renne under terskelen ${tag}`;
  await write(field(reloaded, "Årsak"), cause2);
  await write(field(reloaded, "Konsekvens"), consequence2);
  await expectSaved(bath, { causeText: cause2, consequenceText: consequence2 });
  await polishButton(reloaded).click();
  const card2 = polishCard(reloaded);
  await expect(polishRow(card2, "Årsak").getByTestId("ai-suggestion-text")).toHaveText(
    polished(cause2),
  );
  await expect(polishRow(card2, "Avvik")).toContainText("Ingen endring.");
  await card2.getByRole("button", { name: "Bruk: Årsak", exact: true }).click();
  await expect(field(reloaded, "Årsak")).toHaveValue(polished(cause2));
  await expect(card2.getByRole("button", { name: "Angre: Årsak", exact: true })).toBeFocused();
  await card2.getByRole("button", { name: "Behold min: Konsekvens", exact: true }).click();
  await expect(field(reloaded, "Konsekvens")).toHaveValue(consequence2);
  await expect(polishRow(card2, "Konsekvens")).toContainText("Du beholdt din tekst.");
  const consequenceRows = async () =>
    (await aiRows(bath, "language_polish")).filter(
      (row) => row.targetRef.fieldKey === "consequence_text",
    );
  await expect.poll(async () => (await consequenceRows()).at(-1)?.status).toBe("rejected");
  const before = (await consequenceRows()).length;
  await card2.getByRole("button", { name: "Nytt forslag", exact: true }).click();
  await expect.poll(async () => (await consequenceRows()).length).toBe(before + 1);
  expect((await consequenceRows()).at(-1)?.status).toBe("suggested");
  await expect(
    polishRow(card2, "Konsekvens").getByRole("button", { name: "Bruk: Konsekvens" }),
  ).toBeVisible();

  // Beskrivelsen på punktet har egen «Språkvask» med eget kall
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  const descriptionText = `sluket ble sett over ${tag}`;
  await write(description, descriptionText);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  await page.getByTestId("polish-description-wet_room-membrane_drain").click();
  const descriptionCard = page.getByRole("region", {
    name: "Forslag fra KI · språkvask",
    exact: true,
  });
  await expect(descriptionCard.getByTestId("ai-suggestion-text")).toHaveText(
    polished(descriptionText),
  );
  await expect
    .poll(async () =>
      (await aiRows(bath, "language_polish")).some(
        (row) =>
          row.targetRef.type === "checkpoint_result" &&
          row.targetRef.fieldKey === "description_text",
      ),
    )
    .toBe(true);
});

test("K7.7 stoppet svar: bare konsekvensen stoppes, meldingen står ved feltet, de andre feltene kan brukes", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  const tag = marker();
  const own = {
    deviation: `sjiktet under flisene er gammelt ${tag}`,
    cause: `sjiktet er lagt for lenge siden ${tag}`,
    consequence: `vann kan komme inn ${FAKE_ADD_TG_INPUT} ${tag}`,
    measure: `sjiktet bør skiftes ${tag}`,
  };
  await writeOwnTexts(bath, deviation, own);
  await polishButton(deviation).click();
  const card = polishCard(deviation);
  const stopped = polishRow(card, "Konsekvens");
  // Meldingen står i aria-live ved feltet (testplanen K7.7), ikke bare i kortraden
  await expect(stopped.locator("[aria-live]")).toContainText(STOPPED);
  await expect(stopped.getByRole("button", { name: /^Bruk/ })).toHaveCount(0);
  await expect(card).not.toContainText("Satt til TG3");
  await expect(card.locator("[aria-live]").filter({ hasText: "1 stoppet" })).toHaveCount(1);

  await card.getByRole("button", { name: "Bruk alle", exact: true }).click();
  await expect(field(deviation, "Avvik")).toHaveValue(polished(own.deviation));
  await expect(field(deviation, "Årsak")).toHaveValue(polished(own.cause));
  await expect(field(deviation, "Tiltak 1")).toHaveValue(polished(own.measure));
  await expect(field(deviation, "Konsekvens")).toHaveValue(own.consequence);

  await expect
    .poll(
      async () =>
        (await aiRows(bath, "language_polish")).filter((row) => row.status === "accepted").length,
    )
    .toBe(3);
  const row = (await aiRows(bath, "language_polish")).find(
    (r) => r.targetRef.fieldKey === "consequence_text",
  );
  expect(row).toMatchObject({ outcome: "stopped", errorCode: "tg_guard", status: null });
  expect(row!.tokensIn).toBeGreaterThan(0);
  await expectSaved(bath, { consequenceText: own.consequence });
});

// --- K7.8–K7.9 sammendrag --------------------------------------------------------------------

test("K7.8 og K7.9 sammendrag: «Ingen avvik med TG ennå», utkast med TG3, TG2, TGIU, HMS, «Bruk», advarsler uten sperre", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bath = await createSampleBathroom();
  await logInAsSampleInspector(page);
  await openSampleBathroom(page, bath, MEMBRANE);

  // Uten funn: forklaringen står ved knappen
  const section = summarySection(page);
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(
    "Sammendrag for hele rapporten",
  );
  await expect(section.getByText("Ingen avvik med TG ennå.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Lag utkast" })).toBeDisabled();

  // TG3 (reglene), TG2, TGIU, HMS og ett avvik uten valgt TG
  await addRuleTg3Deviation(page);
  await openCheckpoint(page, "Ventilasjon");
  await addDeviation(page, /^Avtrekket i våtrommet trekker svakt/);
  await expect(deviationCardOn(page, 1)).toBeVisible();
  await openCheckpoint(page, "Overflater vegger og himling");
  await choose(page, "TG uten avvik", /^TGIU$/);
  await write(
    page.getByLabel("Hva er ikke undersøkt, og hvorfor?"),
    "Oppdiktet: veggen var tildekket av et skap.",
  );
  await openCheckpoint(page, "Sanitærutstyr og innredning");
  await addDeviation(page, /^Det er merker etter varmgang/);
  await expect(deviationCardOn(page, 1)).toBeVisible();
  await openCheckpoint(page, "Tilliggende konstruksjoner våtrom");
  await addDeviation(page, /^Ved hulltaking i konstruksjonen/);
  await expect(deviationCardOn(page, 1)).toBeVisible();
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");

  const summaryField = section.getByLabel("Sammendrag", { exact: true });
  await expect(summaryField).toHaveValue("");
  await section.getByRole("button", { name: "Lag utkast" }).click();
  const card = summaryCard(page);
  const draft = card.getByTestId("ai-suggestion-text");
  await expect(draft).toBeVisible();
  await expect(section.getByText("1 avvik mangler TG og er ikke med.")).toBeVisible();
  // Utkastet overskriver aldri: feltet er uendret til «Bruk»
  await expect(summaryField).toHaveValue("");
  expect((await summaryOf(bath)).text).toBeNull();

  const text = (await draft.textContent()) ?? "";
  const at = (pattern: RegExp) => text.search(pattern);
  const order = [at(/^TG3\b/m), at(/^TG2\b/m), at(/^TGIU\b/m), at(/^HMS\b/m)];
  expect(
    order.every((index) => index >= 0),
    `alle fire overskriftene i «${text}»`,
  ).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(text).toContain(MEMBRANE_NAME);
  expect(text).toContain("Oppdiktet: veggen var tildekket av et skap.");

  await card.getByRole("button", { name: "Bruk", exact: true }).click();
  await expect(summaryField).toHaveValue(text);
  await expect(card.getByText("Tekst fra KI, godkjent")).toBeVisible();
  await expect.poll(async () => (await summaryOf(bath)).text).toBe(text);
  expect((await summaryOf(bath)).basis).toHaveLength(4);
  await expect
    .poll(async () => (await aiRows(bath, "summary_draft")).map((row) => row.status))
    .toEqual(["accepted"]);

  // K7.9: endret TG etter «Bruk» gir advarselen med funnet
  await openCheckpoint(page, "Ventilasjon");
  await choose(deviationCardOn(page, 1), "TG", /^TG3$/);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  const changed = section.getByText("Funnene er endret etter sammendraget. Lag nytt utkast.");
  await expect(changed).toBeVisible();
  await expect(section.getByText("Ventilasjon: endret, nå TG3")).toBeVisible();

  // Tekst skrevet for hånd uten TG3-punktet gir advarsel; ingen sperre
  await write(summaryField, "Oppdiktet sammendrag skrevet for hånd.");
  await expect
    .poll(async () => (await summaryOf(bath)).text)
    .toBe("Oppdiktet sammendrag skrevet for hånd.");
  await expect(
    section.getByText(`${MEMBRANE_NAME} har TG3 og er ikke nevnt i sammendraget.`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect.poll(() => doneCount(bath)).toBe(1);
});

// --- K7.10–K7.11a uten nett, KI av og meldinger ------------------------------------------------

test("K7.10 uten nett: «Forslag» gir tekstsøk uten kall og uten loggrad; språkvask og utkast sier «Trenger nett»", async ({
  page,
  context,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  const actions = recordActions(page);
  await context.setOffline(true);
  try {
    await expect(bathroomSaveState(page)).toContainText("Uten nett");
    await phraseButton(deviation, "årsak").click();
    const list = phraseList(deviation);
    await expect(list).toHaveAttribute("data-phase", "fallback");
    await expect(list.getByTestId("phrase-list-heading")).toHaveText("Uten KI: treff fra tekstsøk");
    expect(await candidates(deviation).count()).toBeGreaterThanOrEqual(1);
    await list.getByRole("button", { name: "Lukk", exact: true }).click();

    await polishButton(deviation).click();
    await expect(deviation.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
    const section = summarySection(page);
    await section.getByRole("button", { name: "Lag utkast" }).click();
    await expect(section.getByText(OFFLINE)).toBeVisible();
    await expect(bathroomSaveState(page)).toContainText("Uten nett");
    expect(actions, "ingen kall til serveren uten nett").toEqual([]);
  } finally {
    await context.setOffline(false);
  }
  expect(await aiRows(bath)).toEqual([]);
});

test("K7.11 KI av for organisasjonen: tekstsøket uten loggrad; språkvask og utkast sier «KI er av.»", async ({
  page,
}) => {
  const previous = await setSampleAiEnabled(false);
  try {
    const { bath, deviation } = await bathWithTg3(page);
    await phraseButton(deviation, "årsak").click();
    const list = phraseList(deviation);
    await expect(list).toHaveAttribute("data-phase", "fallback");
    await expect(list.getByTestId("phrase-list-heading")).toHaveText("Uten KI: treff fra tekstsøk");
    expect(await candidates(deviation).count()).toBeGreaterThanOrEqual(1);
    await list.getByRole("button", { name: "Lukk", exact: true }).click();

    await write(field(deviation, "Årsak"), `sjiktet er gammelt ${marker()}`);
    await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
    await polishButton(deviation).click();
    await expect(deviation.getByRole("status").filter({ hasText: "KI er av." })).toBeVisible();
    const section = summarySection(page);
    await section.getByRole("button", { name: "Lag utkast" }).click();
    await expect(section.getByText("KI er av.")).toBeVisible();
    expect(await aiRows(bath, "phrase_suggest")).toEqual([]);
  } finally {
    await restoreSampleAiEnabled(previous);
  }
});

test("K7.11a meldingene «for lang tekst» og «for mange funn» vises på skjermen", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  // For lang tekst til språkvask (grensen er 5 000 tegn; feltet tar 10 000)
  const long = `${"sjiktet er gammelt og ".repeat(230)}slutt`.slice(0, 5_001);
  await write(field(deviation, "Konsekvens"), long);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  await polishButton(deviation).click();
  await expect(
    deviation.getByText(/^Teksten er for lang for språkvask\. Grensen er 5\s000 tegn\.$/),
  ).toBeVisible();

  // For mange funn til utkastet (61 avvik med TG, grensen er 60)
  const [row] = await deviations(bath);
  await copyDeviation(row!.id, 60);
  await openSampleBathroom(page, bath, "wet_room.general");
  const section = summarySection(page);
  await section.getByRole("button", { name: "Lag utkast" }).click();
  await expect(
    section.getByText(
      "Rapporten har flere enn 60 funn. Utkastet kan ikke lages. Skriv sammendraget selv.",
    ),
  ).toBeVisible();
  await expect(summaryCard(page)).toHaveCount(0);
});

test("K7.11a «Mest brukt» står på kandidaten som er valgt flest ganger i organisasjonen", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  // Velg samme kandidat for konsekvensen to ganger (bare denne testen velger konsekvens).
  let chosen = "";
  for (let round = 0; round < 2; round++) {
    await clearSaved(bath, deviation, "Konsekvens");
    await openRankedList(deviation, "konsekvens");
    const first = candidates(deviation).first();
    const text = await candidateText(first);
    if (round === 0) chosen = text;
    expect(text).toBe(chosen);
    await first.click();
    await expectSaved(bath, { consequenceText: chosen });
  }
  await expect
    .poll(
      async () =>
        (await aiRows(bath, "phrase_suggest")).filter((row) => row.status === "accepted").length,
    )
    .toBe(2);

  await clearSaved(bath, deviation, "Konsekvens");
  await page.reload();
  const reloaded = deviationCardOn(page, 1);
  await phraseButton(reloaded, "konsekvens").click();
  const marked = candidates(reloaded).filter({ hasText: "Mest brukt" });
  await expect(marked).toHaveCount(1);
  await expect(marked.locator("span").first()).toHaveText(chosen);
  await expect(marked).toHaveAccessibleName(/mest brukt/i);
  await expect(phraseList(reloaded)).toHaveAttribute("data-phase", "ranked");
  await expect(candidates(reloaded).filter({ hasText: "Mest brukt" })).toHaveCount(1);
});

// --- K7.12–K7.14 tastatur, skjermleser og kontrollene i kortet --------------------------------

test("K7.12 tastatur på PC: «/» først i tomt felt og Ctrl+. åpner, piltast og Enter velger, Escape lukker", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pc", "snarveiene prøves på PC");
  const { bath, deviation } = await bathWithTg3(page);
  await clearSaved(bath, deviation, "Årsak");
  const cause = field(deviation, "Årsak");
  await cause.focus();
  await page.keyboard.press("/");
  const list = phraseList(deviation);
  await expect(list).toBeVisible();
  await expect(cause).toHaveValue("");
  await expect(list).toHaveAttribute("data-phase", "ranked");
  const items = candidates(deviation);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  const second = await candidateText(items.nth(1));
  await page.keyboard.press("Enter");
  await expect(cause).toHaveValue(second);
  await expect(cause).toBeFocused();

  // «/» midt i tekst skrives som vanlig
  const consequence = field(deviation, "Konsekvens");
  await consequence.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" a/b");
  await expect(consequence).toHaveValue(/ a\/b$/);
  await expect(phraseList(deviation)).toHaveCount(0);

  // Ctrl+. i et felt med tekst åpner; Escape lukker og gir fokus tilbake til feltet
  const text = field(deviation, "Avvik");
  await text.focus();
  await page.keyboard.press("Control+.");
  await expect(phraseList(deviation)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(phraseList(deviation)).toHaveCount(0);
  await expect(text).toBeFocused();

  // Snarveiene står i «?»-listen
  await page.locator("#checkpoint-heading").focus();
  await page.keyboard.press("?");
  const help = page.getByRole("region", { name: "Snarveier" });
  await expect(help).toContainText("/ først i tomt felt, eller Ctrl + .");
  await expect(help).toContainText("Forslag til feltet");
});

test("K7.13 skjermleser og universell utforming: navn, liste, aria-live og axe uten brudd", async ({
  page,
}) => {
  const { bath, deviation } = await bathWithTg3(page);
  for (const name of ["avvik", "årsak", "konsekvens", "tiltak"] as const) {
    await expect(phraseButton(deviation, name)).toBeVisible();
  }
  await expect(polishButton(deviation)).toBeVisible();

  await clearSaved(bath, deviation, "Årsak");
  await openRankedList(deviation, "årsak");
  const list = phraseList(deviation);
  await expect(phraseButton(deviation, "årsak")).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("list")).toBeVisible();
  const count = await candidates(deviation).count();
  await expect(list.getByRole("listitem")).toHaveCount(count);
  await expect(list.getByRole("listitem").getByRole("button")).toHaveCount(count);
  await expect(list.locator("[aria-live='polite']")).toHaveText(`Sortert av KI. ${count} forslag.`);
  await expectNoAxeViolations(page, "åpen forslagsliste");
  await list.getByRole("button", { name: "Lukk", exact: true }).click();
  await expect(phraseButton(deviation, "årsak")).toBeFocused();

  await write(field(deviation, "Årsak"), `sjiktet er gammelt ${marker()}`);
  await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
  await polishButton(deviation).click();
  const card = polishCard(deviation);
  await expect(card.getByTestId("ai-suggestion-text").first()).toBeVisible();
  await expect(card.locator("[aria-live='polite']")).toContainText("Språkvask klar");
  await expectNoAxeViolations(page, "åpent forslagskort for språkvask");

  const section = summarySection(page);
  await section.getByRole("button", { name: "Lag utkast" }).click();
  await expect(summaryCard(page).getByTestId("ai-suggestion-text")).toBeVisible();
  await expect(section.locator("[aria-live='polite']").first()).toHaveText("Utkast klart");
  await expectNoAxeViolations(page, "sammendraget med utkast");
});

test("K7.14 fem KI-kontroller per avvikskort: én «Språkvask avviket» og fire «Forslag»", async ({
  page,
}) => {
  const { deviation } = await bathWithTg3(page);
  const controls = deviation.locator("[data-ai-control]");
  await expect(controls).toHaveCount(5);
  await expect(deviation.locator("[data-ai-control='polish']")).toHaveCount(1);
  await expect(deviation.locator("[data-ai-control='phrase']")).toHaveCount(4);
});

// --- K7.15–K7.17 kontor, prøvesiden og iPad stående ------------------------------------------

test("K7.15 kontor ser sammendraget, men ingen «Forslag», «Språkvask» eller «Lag utkast»", async ({
  page,
  browser,
}) => {
  const { bath } = await bathWithTg3(page);
  const section = summarySection(page);
  await section.getByRole("button", { name: "Lag utkast" }).click();
  await summaryCard(page).getByRole("button", { name: "Bruk", exact: true }).click();
  await expect.poll(async () => (await summaryOf(bath)).text).not.toBeNull();
  const text = (await summaryOf(bath)).text!;

  await ensureSampleOrgEmployee({
    email: OFFICE_EMAIL,
    name: "Oppdiktet kontor KI i veien",
    role: "office",
  });
  const office = await newPage(browser);
  try {
    await logIn(office.page, OFFICE_EMAIL);
    await office.page.goto(`/oppdrag/${bath.assignmentId}/rom/${bath.roomId}?punkt=${MEMBRANE}`);
    await expect(office.page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
    const officeSection = summarySection(office.page);
    await expect(officeSection).toBeVisible();
    await expect(officeSection).toContainText(text.split("\n")[0]!);
    await expect(office.page.getByRole("button", { name: /^Forslag til / })).toHaveCount(0);
    await expect(office.page.getByRole("button", { name: /^Språkvask/ })).toHaveCount(0);
    await expect(office.page.getByRole("button", { name: "Lag utkast" })).toHaveCount(0);
    await expect(office.page.locator("[data-ai-control]")).toHaveCount(0);
  } finally {
    await office.context.close();
  }
});

test("K7.16 /prove/ki gir 404", async ({ page }) => {
  await logInAsSampleInspector(page);
  const response = await page.goto("/prove/ki");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Fant ikke siden", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Prøv KI/ })).toHaveCount(0);
});

for (const viewport of PORTRAITS) {
  test(`K7.17 iPad stående ${viewport.width} × ${viewport.height}: listen og kortene holder seg innenfor bredden, knappene er minst 44 × 44`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "iPad stående prøves i prosjektet ipad");
    await page.setViewportSize(viewport);
    const { bath, deviation } = await bathWithTg3(page);
    await clearSaved(bath, deviation, "Årsak");
    await openRankedList(deviation, "årsak");
    await expectNoHorizontalScroll(page, "forslagslisten");
    await expectButtonsAtLeast44(phraseList(deviation), "forslagslisten");
    for (const name of ["avvik", "årsak", "konsekvens", "tiltak"] as const) {
      await expectTouchTarget(phraseButton(deviation, name), 44, `«Forslag til ${name}»`);
    }
    await phraseList(deviation).getByRole("button", { name: "Lukk", exact: true }).tap();

    await write(field(deviation, "Årsak"), `sjiktet er gammelt ${marker()}`);
    await expect(bathroomSaveState(page)).toContainText("Alt er lagret");
    await polishButton(deviation).tap();
    const card = polishCard(deviation);
    await expect(card.getByTestId("ai-suggestion-text").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "forslagskortet for språkvask");
    await expectButtonsAtLeast44(card, "forslagskortet for språkvask");
    await expectTouchTarget(polishButton(deviation), 44, "«Språkvask avviket»");
    await expectTouchTarget(
      card.getByRole("button", { name: "Bruk alle", exact: true }),
      56,
      "«Bruk alle»",
    );

    const section = summarySection(page);
    await section.getByRole("button", { name: "Lag utkast" }).tap();
    const summary = summaryCard(page);
    await expect(summary.getByTestId("ai-suggestion-text")).toBeVisible();
    await expectNoHorizontalScroll(page, "utkastet til sammendrag");
    await expectButtonsAtLeast44(summary, "utkastet til sammendrag");
    await expectTouchTarget(
      summary.getByRole("button", { name: "Bruk", exact: true }),
      56,
      "«Bruk»",
    );
  });
}

// --- Flyttet fra /prove/ki (K6.3): forslagskortet på badskjermen -----------------------------

test.describe("flyttet fra /prove/ki: forslagskortet på badskjermen", () => {
  test("12.5, 12.6 og ingen forslag: feil og «ingen endring» per felt, egen tekst uendret; «Nytt forslag» avviser det gamle", async ({
    page,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const tag = marker();
    const own = {
      deviation: `${FAKE_ERROR_INPUT} sjiktet er gammelt ${tag}`,
      cause: `${FAKE_NO_MATCH_INPUT} ${tag}`,
      consequence: `vann kan komme inn i gulvet ${tag}`,
      measure: `sjiktet bør skiftes ${tag}`,
    };
    await writeOwnTexts(bath, deviation, own);
    await polishButton(deviation).click();
    const card = polishCard(deviation);
    await expect(polishRow(card, "Avvik")).toContainText("KI svarte ikke. Prøv igjen.");
    await expect(polishRow(card, "Årsak")).toContainText("Ingen endring.");
    await expect(polishRow(card, "Konsekvens").getByTestId("ai-suggestion-text")).toHaveText(
      polished(own.consequence),
    );
    await expect(field(deviation, "Avvik")).toHaveValue(own.deviation);
    await expect(field(deviation, "Årsak")).toHaveValue(own.cause);
    const outcomes = async () =>
      Object.fromEntries(
        (await aiRows(bath, "language_polish")).map((row) => [
          row.targetRef.fieldKey === "text" ? "measure" : row.targetRef.fieldKey,
          row.outcome,
        ]),
      );
    expect(await outcomes()).toMatchObject({
      deviation_text: "error",
      cause_text: "no_match",
      consequence_text: "ok",
    });

    // «Nytt forslag»: ny rad for konsekvensen, og den gamle er avvist
    await card.getByRole("button", { name: "Nytt forslag", exact: true }).click();
    const consequenceRows = async () =>
      (await aiRows(bath, "language_polish")).filter(
        (row) => row.targetRef.fieldKey === "consequence_text",
      );
    await expect
      .poll(async () => (await consequenceRows()).map((row) => row.status))
      .toEqual(["rejected", "suggested"]);
  });

  test("T-0004: skriver takstmannen videre etter forslaget, forsvinner «Bruk», og egen tekst står", async ({
    page,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const tag = marker();
    const own = `vann kan komme inn i gulvet ${tag}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    await polishButton(deviation).click();
    const row = polishRow(polishCard(deviation), "Konsekvens");
    await expect(row.getByRole("button", { name: "Bruk: Konsekvens" })).toBeVisible();
    await field(deviation, "Konsekvens").fill(`${own} og under terskelen`);
    await expect(row.getByRole("button", { name: "Bruk: Konsekvens" })).toHaveCount(0);
    await expect(row).toContainText("Forslaget gjelder teksten før du skrev videre.");
    await expect(field(deviation, "Konsekvens")).toHaveValue(`${own} og under terskelen`);
  });

  test("12.9 nettet faller midt i en språkvask: «Trenger nett», ingen «KI jobber …», feltet kan skrives i", async ({
    page,
    context,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const own = `vann kan komme inn i gulvet ${marker()}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    const hold = await holdActions(page, isPolishRequest);
    await polishButton(deviation).click();
    await expect.poll(() => hold.count()).toBe(1);
    const card = polishCard(deviation);
    await expect(card).toContainText("KI jobber …");
    await context.setOffline(true);
    try {
      await expect(card).toContainText(OFFLINE, { timeout: 5_000 });
      await expect(card.getByText("KI jobber …")).toHaveCount(0);
      await expect(field(deviation, "Konsekvens")).toHaveValue(own);
      await expect(field(deviation, "Konsekvens")).toBeEditable();
    } finally {
      await context.setOffline(false);
      hold.release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("12.10 dobbelttrykk gir én rad per felt og én linje i audit_log per beslutning", async ({
    page,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const own = `vann kan komme inn i gulvet ${marker()}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    await polishButton(deviation).dblclick();
    const card = polishCard(deviation);
    await expect(polishRow(card, "Konsekvens").getByTestId("ai-suggestion-text")).toHaveText(
      polished(own),
    );
    const rows = (await aiRows(bath, "language_polish")).filter(
      (row) => row.targetRef.fieldKey === "consequence_text",
    );
    expect(rows).toHaveLength(1);

    await card.getByRole("button", { name: "Bruk: Konsekvens", exact: true }).dblclick();
    await expect(field(deviation, "Konsekvens")).toHaveValue(polished(own));
    await expect.poll(() => auditCount(rows[0]!.id)).toBe(1);
    expect(
      (await aiRows(bath, "language_polish")).filter(
        (row) => row.targetRef.fieldKey === "consequence_text",
      ),
    ).toHaveLength(1);
  });

  test("12.12 egen tekst og forslag side om side på PC og liggende, over hverandre på stående iPad", async ({
    page,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const own = `vann kan komme inn i gulvet ${marker()}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    await polishButton(deviation).click();
    const row = polishRow(polishCard(deviation), "Konsekvens");
    const ownText = row.getByText(own, { exact: true });
    const suggestion = row.getByTestId("ai-suggestion-text");
    await expect(suggestion).toBeVisible();
    const ownBox = await ownText.boundingBox();
    const suggestionBox = await suggestion.boundingBox();
    expect(suggestionBox!.x).toBeGreaterThan(ownBox!.x + ownBox!.width);

    await page.setViewportSize(PORTRAITS[0]);
    await expect(async () => {
      const ownPortrait = await ownText.boundingBox();
      const suggestionPortrait = await suggestion.boundingBox();
      expect(suggestionPortrait!.y).toBeGreaterThan(ownPortrait!.y + ownPortrait!.height);
    }).toPass();
    await expectNoHorizontalScroll(page, "stående med forslagskort");
  });

  test("12.14 forslaget vises som tekst, aldri som HTML", async ({ page }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const own = `<b>fet</b> skrift i teksten ${marker()}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    await polishButton(deviation).click();
    const card = polishCard(deviation);
    await expect(polishRow(card, "Konsekvens").getByTestId("ai-suggestion-text")).toHaveText(
      polished(own),
    );
    await expect(card.locator("b")).toHaveCount(0);
  });

  test("V9.1 telefon og e-post vaskes før KI: loggen har plassholderne, skjermen får verdiene tilbake (A466)", async ({
    page,
  }) => {
    const { bath, deviation } = await bathWithTg3(page);
    const own = `eier ringte 12345678 og skrev til ola.prove@example.no ${marker()}`;
    await write(field(deviation, "Konsekvens"), own);
    await expectSaved(bath, { consequenceText: own });
    await polishButton(deviation).click();
    const suggestion = polishRow(polishCard(deviation), "Konsekvens").getByTestId(
      "ai-suggestion-text",
    );
    await expect(suggestion).toHaveText(polished(own));
    await expect(suggestion).not.toContainText("[telefon]");
    const row = (await aiRows(bath, "language_polish")).find(
      (r) => r.targetRef.fieldKey === "consequence_text",
    );
    expect(row!.outputText).toContain("[telefon]");
    expect(row!.outputText).toContain("[e-post]");
    expect(row!.outputText).not.toContain("12345678");
    expect(row!.outputText).not.toContain("ola.prove@example.no");
    expect(row!.redactedCount).toBe(2);
  });

  test("12.15, V9.3 og K8.12 admin stenges ikke ute: bare rollen admin, innstillingen for takstmenn av", async ({
    page,
  }) => {
    await ensureSampleOrgEmployee({
      email: SAMPLE_ADMIN_ONLY_EMAIL,
      name: "Oppdiktet admin KI i veien",
      role: "admin",
    });
    const previous = await setSampleInspectorsEditAll(false);
    try {
      const bath = await createSampleBathroom();
      await logIn(page, SAMPLE_ADMIN_ONLY_EMAIL);
      await openSampleBathroom(page, bath, MEMBRANE);
      const deviation = await addRuleTg3Deviation(page);
      const own = `vann kan komme inn i gulvet ${marker()}`;
      await write(field(deviation, "Konsekvens"), own);
      await expectSaved(bath, { consequenceText: own });
      await polishButton(deviation).click();
      const card = polishCard(deviation);
      await card.getByRole("button", { name: "Bruk: Konsekvens", exact: true }).click();
      await expect(field(deviation, "Konsekvens")).toHaveValue(polished(own));
      await expect
        .poll(async () => (await aiRows(bath, "language_polish")).map((row) => row.status))
        .toContain("accepted");
    } finally {
      await setSampleInspectorsEditAll(previous);
    }
  });
});
