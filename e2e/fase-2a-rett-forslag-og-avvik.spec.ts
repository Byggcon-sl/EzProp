import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import {
  BATHROOM_ADJACENT,
  BATHROOM_MEMBRANE,
  BATHROOM_MEMBRANE_NAME,
  chooseRoomOption,
  countServerActions,
  createSampleBathroom,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  fillMembraneForTg3,
  logIn,
  openRoomCheckpoint,
  openSampleBathroom,
  roomDeviationCard,
  roomReviewList,
  ruleSuggestionCard,
  sampleDecisions,
  sampleDeviationTgs,
} from "./helpers";

/*
 * Godtatt forslag og avvik henger alltid sammen (rett T-0113, T-0115, T-0116, T-0117).
 * Testplan: docs/agenter/oppgaver/rett-forslag-og-avvik-testplan.md avsnitt 4 (FA-E1–FA-E10).
 * Oppgavekort med de faste tekstene: docs/agenter/oppgaver/rett-forslag-og-avvik.md.
 *
 * Kjører i prosjektene `pc` og `ipad`. Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag`
 * (badmalen). Hver test lager sitt eget oppdrag med ett bad (oppdiktet, `createSampleBathroom`).
 * Forslaget TG3 kommer fra sjikt «Folie» med årstall 1990 (før 2000); TGIU-forslaget fra
 * hulltaking «Ikke utført» der eier ikke ga samtykke. Testene velger på tekst og rolle, ikke CSS.
 *
 * Støtter hovedmål: færre reklamasjoner (TG3 faller ikke stille ut, to vinduer gir ett avvik,
 * hver TG-endring fra et forslag har grunn), de ansatte (knappene står der straks, «Å se over»
 * kan bli tom, grunnvalget er universelt utformet) og KI i bunnen (beslutningsloggen blir sann;
 * reglene foreslår, takstmannen avgjør, og KI setter aldri TG).
 */

const REASON_GROUP = "Hvorfor endrer du TG fra forslaget?";
const REMOVED_OPEN_AGAIN = "Avviket er fjernet. Forslaget om TG3 er åpent igjen.";
const REASON_REQUIRED = "Velg en grunn for å endre TG fra forslaget.";
const TG_NOT_CHANGED = "TG er ikke endret.";
const OFFLINE = "Du er uten nett. TG er ikke endret. Prøv igjen når nettet er tilbake.";
const NEWER_DECISION =
  "Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.";
const OPEN_ON_DONE = "Punktet er ferdig, men forslaget om TG3 er ikke avgjort.";
const CHANGED_TO_TG2 = "Forslag TG3, endret til TG2: Synlig skade";
const ACCEPTED_ELSEWHERE = /Godtatt i et annet vindu kl\. \d{2}\.\d{2}: TG3/;
const REJECTED_ELSEWHERE = /Avvist i et annet vindu kl\. \d{2}\.\d{2}/;
const PORTRAIT = { width: 834, height: 1194 } as const;

// --- Siden ----------------------------------------------------------------------------------

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

function button(scope: Locator | Page, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

function suggestionButtons(scope: Locator) {
  return {
    accept: button(scope, "Godta"),
    change: button(scope, "Endre"),
    reject: button(scope, "Avvis"),
  };
}

async function expectSuggestionOpen(scope: Locator) {
  const { accept, change, reject } = suggestionButtons(scope);
  await expect(accept).toBeVisible();
  await expect(change).toBeVisible();
  await expect(reject).toBeVisible();
}

function tgGroup(deviation: Locator): Locator {
  return deviation.getByRole("group", { name: "TG", exact: true });
}

function reasonGroup(deviation: Locator): Locator {
  return deviation.getByRole("group", { name: REASON_GROUP, exact: true });
}

/** Meldingen etter «Fjern avviket» på et avvik fra et forslag. */
function removedStatus(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: REMOVED_OPEN_AGAIN });
}

/** Åpner badet på sjiktet, fyller ut så forslaget TG3 kommer, og godtar det. */
async function acceptTg3(page: Page) {
  const bath = await createSampleBathroom();
  await logInAsInspector(page);
  await openSampleBathroom(page, bath, BATHROOM_MEMBRANE);
  await fillMembraneForTg3(page);
  await button(ruleSuggestionCard(page), "Godta").click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  return bath;
}

/** «Ferdig med punktet» går videre; åpner sjiktet igjen etterpå. */
async function markMembraneDone(page: Page) {
  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sanitærutstyr og innredning" }),
  ).toBeFocused();
  await openRoomCheckpoint(page, BATHROOM_MEMBRANE_NAME);
}

/** Alle felt er lagret, så et nytt vindu får svarene fra serveren. */
async function expectAllSaved(page: Page) {
  await expect(page.locator("header [role='status'][data-save-state]")).toContainText(
    "Alt er lagret",
  );
}

async function setMarker(page: Page) {
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
}

async function expectSamePage(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __marker?: number }).__marker),
    "siden er ikke lastet på nytt",
  ).toBe(1);
}

/** Fokus står i forslagskortet (kortet selv eller noe i det). */
async function focusIsInSuggestion(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return false;
    return [...document.querySelectorAll("section")].some(
      (section) =>
        [...section.querySelectorAll("h2, h3, h4")].some(
          (h) => h.textContent?.trim() === "Forslag fra reglene",
        ) && section.contains(active),
    );
  });
}

// --- FA-E1 T-0117 ---------------------------------------------------------------------------

test("FA-E1 T-0117: «Fjern avviket» viser forslaget med knappene straks, og «Angre» gir godtatt igjen", async ({
  page,
}) => {
  const bath = await acceptTg3(page);
  await setMarker(page);

  await button(roomDeviationCard(page, 1), "Fjern avviket").click();
  await expect(removedStatus(page)).toBeVisible();
  await expectSuggestionOpen(ruleSuggestionCard(page));
  await expect(button(page, "Angre")).toBeVisible();
  await expectSamePage(page);
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([]);
  // Ingen ny beslutningsrad når avviket fjernes; revisjonsloggen har slettingen.
  expect(await sampleDecisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);

  await button(page, "Angre").click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(ruleSuggestionCard(page)).toContainText("Godtatt");
  await expect(button(ruleSuggestionCard(page), "Godta")).toHaveCount(0);
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  expect(await sampleDecisions(bath.assignmentId)).toHaveLength(1);

  // Fjernet og punktet forlatt: forslaget står åpent også når man kommer tilbake.
  await button(roomDeviationCard(page, 1), "Fjern avviket").click();
  await expect(removedStatus(page)).toBeVisible();
  await openRoomCheckpoint(page, "Ventilasjon");
  await openRoomCheckpoint(page, BATHROOM_MEMBRANE_NAME);
  await expectSuggestionOpen(ruleSuggestionCard(page));
  await expect(button(page, "Angre")).toHaveCount(0);
  await expectSamePage(page);
  expect(await sampleDecisions(bath.assignmentId)).toHaveLength(1);
});

// --- FA-E2 T-0113 ---------------------------------------------------------------------------

test("FA-E2 T-0113: TG fra forslaget endres bare med grunn; «Avbryt» lagrer ingenting", async ({
  page,
}) => {
  const bath = await acceptTg3(page);
  const deviation = roomDeviationCard(page, 1);
  const actions = countServerActions(page);

  await chooseRoomOption(page, "TG", /^TG2$/, deviation);
  const reasons = reasonGroup(deviation);
  await expect(reasons).toBeVisible();
  await expect(reasons.getByRole("radio").first()).toBeFocused();
  await expect(deviation.getByText("TG2 er ikke lagret.")).toBeVisible();
  await expect(deviation.getByText(REASON_REQUIRED)).toBeVisible();
  // Grunnene står rett under TG-raden.
  const tgBox = await tgGroup(deviation).boundingBox();
  const reasonBox = await reasons.boundingBox();
  expect(tgBox && reasonBox).toBeTruthy();
  expect(reasonBox!.y).toBeGreaterThanOrEqual(tgBox!.y + tgBox!.height - 1);
  expect(reasonBox!.y - (tgBox!.y + tgBox!.height)).toBeLessThan(160);

  await button(deviation, "Avbryt").click();
  await expect(reasons).toHaveCount(0);
  await expect(tgGroup(deviation).getByRole("radio", { name: "TG3" })).toBeChecked();
  await expect(tgGroup(deviation).getByRole("radio", { name: "TG3" })).toBeFocused();
  await expect(page.locator("#room-announcer")).toHaveText(TG_NOT_CHANGED);
  expect(actions.count(), "«Avbryt» sender ingenting").toBe(0);
  expect(await sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  expect(await sampleDecisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);

  // Med grunn: TG og grunn går i ett kall, og kortet sier hva som er endret.
  await chooseRoomOption(page, "TG", /^TG2$/, deviation);
  await chooseRoomOption(page, REASON_GROUP, "Synlig skade", deviation);
  await expect(ruleSuggestionCard(page)).toContainText(CHANGED_TO_TG2);
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([2]);
  expect(actions.count(), "ett kall for TG og grunn").toBe(1);
  const decided = await sampleDecisions(bath.assignmentId);
  expect(decided).toMatchObject([
    { decision: "accepted" },
    { decision: "changed", override_reason_code: "visible_damage", chosen_tg: "2" },
  ]);
  expect(decided[1]?.deviation_id).toBe(decided[0]?.deviation_id);

  await page.reload();
  await expect(ruleSuggestionCard(page)).toContainText(CHANGED_TO_TG2);

  // Tilbake til forslagets TG spør ikke om grunn.
  const reloaded = roomDeviationCard(page, 1);
  await chooseRoomOption(page, "TG", /^TG3$/, reloaded);
  await expect(reasonGroup(reloaded)).toHaveCount(0);
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  await expect
    .poll(async () => (await sampleDecisions(bath.assignmentId)).map((d) => d.decision))
    .toEqual(["accepted", "changed", "accepted"]);
});

// --- FA-E3 T-0116 ---------------------------------------------------------------------------

for (const second of ["Endre", "Avvis"] as const) {
  test(`FA-E3 T-0116: Godta i ett vindu og ${second} i et annet gir ett avvik og «Godtatt i et annet vindu»`, async ({
    page,
    context,
  }) => {
    const bath = await createSampleBathroom();
    await logInAsInspector(page);
    await openSampleBathroom(page, bath, BATHROOM_MEMBRANE);
    await fillMembraneForTg3(page);
    await expectAllSaved(page);
    const other = await context.newPage();
    await openSampleBathroom(other, bath, BATHROOM_MEMBRANE);
    await expectSuggestionOpen(ruleSuggestionCard(other));

    await button(ruleSuggestionCard(page), "Godta").click();
    await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();

    const card = ruleSuggestionCard(other);
    if (second === "Endre") {
      await button(card, "Endre").click();
      await chooseRoomOption(other, "Velg TG", /^TG2$/, card);
      await chooseRoomOption(other, "Hvorfor endrer du?", "Synlig skade", card);
      await card.getByRole("button", { name: "Lagre endringen" }).click();
    } else {
      await button(card, "Avvis").click();
      await chooseRoomOption(
        other,
        "Hvorfor avviser du forslaget?",
        "Dokumentasjon er lagt fram",
        card,
      );
      await card.getByRole("button", { name: "Avvis forslaget" }).click();
    }
    await expect(other.getByText(ACCEPTED_ELSEWHERE)).toBeVisible();
    await expect(ruleSuggestionCard(other)).toContainText("Godtatt");
    await expect(button(ruleSuggestionCard(other), "Godta")).toHaveCount(0);

    expect(await sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
    expect(await sampleDecisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);
    for (const view of [page, other]) {
      await view.reload();
      await expect(roomDeviationCard(view, 1)).toBeVisible();
      await expect(view.getByRole("heading", { name: /^Avvik \d/ })).toHaveCount(1);
    }
    await other.close();
  });
}

test("FA-E3b T-0116: Avvis i ett vindu og Godta i et annet gir «Avvist i et annet vindu» og ingen avvik", async ({
  page,
  context,
}) => {
  const bath = await createSampleBathroom();
  await logInAsInspector(page);
  await openSampleBathroom(page, bath, BATHROOM_MEMBRANE);
  await fillMembraneForTg3(page);
  await expectAllSaved(page);
  const other = await context.newPage();
  await openSampleBathroom(other, bath, BATHROOM_MEMBRANE);
  await expectSuggestionOpen(ruleSuggestionCard(other));

  const card = ruleSuggestionCard(page);
  await button(card, "Avvis").click();
  await chooseRoomOption(page, "Hvorfor avviser du forslaget?", "Dokumentasjon er lagt fram", card);
  await card.getByRole("button", { name: "Avvis forslaget" }).click();
  await expect(ruleSuggestionCard(page)).toContainText("Avvist:");

  await button(ruleSuggestionCard(other), "Godta").click();
  await expect(other.getByText(REJECTED_ELSEWHERE)).toBeVisible();
  await expect(ruleSuggestionCard(other)).toContainText("Avvist");
  expect(await sampleDeviationTgs(bath.assignmentId)).toEqual([]);
  expect(await sampleDecisions(bath.assignmentId)).toMatchObject([{ decision: "rejected" }]);
  await other.reload();
  await expect(other.getByRole("heading", { name: /^Avvik \d/ })).toHaveCount(0);
  await other.close();
});

// --- FA-E4 «Å se over» ----------------------------------------------------------------------

test("FA-E4 «Å se over»: åpent TG3-forslag på ferdig punkt avgjøres fra listen, og listen blir tom", async ({
  page,
}) => {
  const bath = await acceptTg3(page);
  await button(roomDeviationCard(page, 1), "Fjern avviket").click();
  await expect(removedStatus(page)).toBeVisible();
  await markMembraneDone(page);

  const review = roomReviewList(page);
  const item = review.getByRole("listitem").filter({ hasText: OPEN_ON_DONE });
  await expect(item).toBeVisible();
  // Forslagets TG og regelens korte grunn (målingen) står i advarselen.
  await expect(item).toContainText("TG3");
  await expect(item).toContainText("1990");
  await expectSuggestionOpen(item);

  await button(item, "Godta").click();
  await expect(page.getByText(OPEN_ON_DONE)).toHaveCount(0);
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  expect(
    (await sampleDecisions(bath.assignmentId)).map((d) => d.decision),
    "Godta fra listen gir en ny beslutning, ikke to",
  ).toEqual(["accepted", "accepted"]);

  // Det som er igjen (kostnad for TG3), rettes, og listen blir tom.
  await chooseRoomOption(page, "Kostnad", /^20\s000–100\s000$/, roomDeviationCard(page, 1));
  await expect(roomReviewList(page)).toHaveCount(0);
  await expect(page.getByText(/Å se over \([1-9]\d*\)/)).toHaveCount(0);
});

// --- FA-E5 T-0115 ---------------------------------------------------------------------------

test("FA-E5 T-0115: etter «Fjern avvikene med TG og sett TGIU» står ingen «gjelder ikke lenger»", async ({
  page,
}) => {
  const bath = await createSampleBathroom();
  await logInAsInspector(page);
  await openSampleBathroom(page, bath, BATHROOM_ADJACENT);
  await chooseRoomOption(page, "Hulltaking", "Utført med funn");
  await chooseRoomOption(page, "Enhet for fuktmålingen", "Vekt-%");
  const reading = page.getByLabel("Fuktmåling i hullet");
  await reading.fill("15");
  await reading.blur();
  await expect(ruleSuggestionCard(page)).toContainText("TG2 eller TG3");
  await ruleSuggestionCard(page).getByRole("button", { name: "Godta som TG3" }).click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();

  await chooseRoomOption(page, "Hulltaking", "Ikke utført");
  await chooseRoomOption(page, "Hvorfor hull ikke er tatt", "Eier ga ikke samtykke");
  const tgiuCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forslag fra reglene" }) })
    .filter({ hasText: "Sett TGIU på punktet" });
  await button(tgiuCard, "Godta").click();
  await page.getByRole("button", { name: "Fjern avvikene med TG og sett TGIU" }).click();
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeVisible();
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([]);

  const fill = async (label: string, text: string) => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(text);
    await field.blur();
  };
  await fill(
    "Hva er ikke undersøkt, og hvorfor?",
    "Oppdiktet: hull ble ikke tatt i veggen mot gangen.",
  );
  await fill("Risiko", "Oppdiktet: skjult fukt kan gi råte.");
  await fill("Hva må til for å undersøke?", "Oppdiktet: hulltaking med samtykke.");
  await fill("Annen fuktkontroll", "Oppdiktet: overflatemåling.");
  await fill("Resultat av annen fuktkontroll", "Oppdiktet: ingen utslag.");
  await chooseRoomOption(page, "Skadeutsatt konstruksjon", "Ja");
  await page.getByLabel("Eier er informert om utvidet ansvar").check();

  await expect(page.getByText(/Forslaget gjelder ikke lenger/)).toHaveCount(0);
  await expect(page.getByText(/Et forslag fra reglene gjelder ikke lenger/)).toHaveCount(0);
  await expect(roomReviewList(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/gjelder ikke lenger/)).toHaveCount(0);
  await expect(roomReviewList(page)).toHaveCount(0);
});

// --- FA-E6 newer_decision -------------------------------------------------------------------

test("FA-E6 «Angre» etter at forslaget er godtatt på nytt gir meldingen og aldri to avvik", async ({
  page,
}) => {
  const bath = await acceptTg3(page);
  await button(roomDeviationCard(page, 1), "Fjern avviket").click();
  await expect(removedStatus(page)).toBeVisible();
  await button(ruleSuggestionCard(page), "Godta").click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);

  await button(page, "Angre").click();
  await expect(page.getByText(NEWER_DECISION)).toBeVisible();
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  await expect(page.getByRole("heading", { name: /^Avvik \d/ })).toHaveCount(1);

  const goTo = page
    .getByRole("button", { name: "Gå til forslaget" })
    .or(page.getByRole("link", { name: "Gå til forslaget" }))
    .first();
  await goTo.click();
  await expect.poll(() => focusIsInSuggestion(page)).toBe(true);
});

// --- FA-E7 iPad -----------------------------------------------------------------------------

test("FA-E7 iPad: grunnknappene og knappene i «Å se over» er minst 44 px, uten vannrett rulling", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "iPad-størrelsen prøves i prosjektet ipad");
  await acceptTg3(page);
  const deviation = roomDeviationCard(page, 1);

  await tgGroup(deviation).locator("label").filter({ hasText: /^TG2$/ }).tap();
  const reasons = reasonGroup(deviation);
  await expect(reasons).toBeVisible();
  for (const label of await reasons.locator("label").all()) {
    const box = await label.boundingBox();
    expect(box, "grunnknappen er synlig").not.toBeNull();
    expect(box!.height, `${await label.textContent()} er minst 44 px`).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page, "liggende med grunnvalget");
  await page.setViewportSize(PORTRAIT);
  await expectNoHorizontalScroll(page, "stående med grunnvalget");
  await button(deviation, "Avbryt").tap();
  await expect(reasons).toHaveCount(0);

  await button(deviation, "Fjern avviket").tap();
  await expect(removedStatus(page)).toBeVisible();
  await expectNoHorizontalScroll(page, "stående etter «Fjern avviket»");
  await page.getByRole("button", { name: "Ferdig med punktet" }).tap();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sanitærutstyr og innredning" }),
  ).toBeFocused();
  await openRoomCheckpoint(page, BATHROOM_MEMBRANE_NAME);
  const item = roomReviewList(page).getByRole("listitem").filter({ hasText: OPEN_ON_DONE });
  const { accept, change, reject } = suggestionButtons(item);
  for (const target of [accept, change, reject]) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box!.height, `${await target.textContent()} er minst 44 px`).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page, "stående med «Å se over»");
  await accept.tap();
  await expect(page.getByText(OPEN_ON_DONE)).toHaveCount(0);
});

// --- FA-E8 axe ------------------------------------------------------------------------------

test("FA-E8 axe uten feil: grunnvalget, kortet etter «Fjern avviket» og «Å se over»", async ({
  page,
}) => {
  await acceptTg3(page);
  const deviation = roomDeviationCard(page, 1);

  await chooseRoomOption(page, "TG", /^TG2$/, deviation);
  await expect(reasonGroup(deviation)).toBeVisible();
  await expectNoAxeViolations(page, "grunnvalget");
  await button(deviation, "Avbryt").click();

  await button(deviation, "Fjern avviket").click();
  await expect(removedStatus(page)).toBeVisible();
  await expectNoAxeViolations(page, "forslagskortet etter «Fjern avviket»");

  await markMembraneDone(page);
  await expect(roomReviewList(page)).toContainText(OPEN_ON_DONE);
  await expect(page.getByRole("button", { name: "Åpne punktet igjen" })).toBeVisible();
  await expectNoAxeViolations(page, "«Å se over» med åpent forslag");
});

// --- FA-E9 tastatur -------------------------------------------------------------------------

test("FA-E9 tastatur: grunnvalget nås med Tab og velges med mellomrom; Escape og «Avbryt» gir TG tilbake", async ({
  page,
}) => {
  const bath = await acceptTg3(page);
  const deviation = roomDeviationCard(page, 1);
  const tg3 = tgGroup(deviation).getByRole("radio", { name: "TG3" });
  const reasons = reasonGroup(deviation);

  // Escape: TG tilbake og fokus tilbake til TG-valget.
  await tg3.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(reasons.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reasons).toHaveCount(0);
  await expect(tg3).toBeChecked();
  await expect(tg3).toBeFocused();

  // «Avbryt» med Enter.
  await page.keyboard.press("ArrowLeft");
  await expect(reasons.getByRole("radio").first()).toBeFocused();
  const cancel = button(deviation, "Avbryt");
  for (let i = 0; i < 6 && !(await cancel.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(reasons).toHaveCount(0);
  await expect(tg3).toBeChecked();
  await expect(tg3).toBeFocused();
  expect(await sampleDeviationTgs(bath.assignmentId)).toEqual([3]);

  // Shift+Tab tilbake til TG-valget og Tab inn i grunnvalget; mellomrom velger grunnen.
  await page.keyboard.press("ArrowLeft");
  await expect(reasons.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tgGroup(deviation).getByRole("radio", { name: "TG2" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reasons.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(() => sampleDeviationTgs(bath.assignmentId)).toEqual([2]);
  await expect
    .poll(async () => (await sampleDecisions(bath.assignmentId)).at(-1))
    .toMatchObject({ decision: "changed", override_reason_code: "documentation_present" });
});

// --- FA-E10 uten nett -----------------------------------------------------------------------

test("FA-E10 uten nett: TG med grunn gir norsk melding, ingenting lagres, ingen rapportdata lokalt", async ({
  page,
  context,
}) => {
  const bath = await acceptTg3(page);
  const deviation = roomDeviationCard(page, 1);
  await context.setOffline(true);
  try {
    await chooseRoomOption(page, "TG", /^TG2$/, deviation);
    await chooseRoomOption(page, REASON_GROUP, "Synlig skade", deviation);
    await expect(deviation.getByText(OFFLINE)).toBeVisible();
    await expect(deviation.getByText("TG2 er lagret.")).toHaveCount(0);
    await expect(ruleSuggestionCard(page)).not.toContainText("endret til");
  } finally {
    await context.setOffline(false);
  }
  expect(await sampleDeviationTgs(bath.assignmentId)).toEqual([3]);
  expect(await sampleDecisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);
  const local = await page.evaluate(async () => ({
    storage: Object.keys(localStorage).filter((k) => /rapport|report|badet|deviation/i.test(k)),
    databases: (await indexedDB.databases()).map((d) => d.name ?? ""),
  }));
  expect(local.storage).toEqual([]);
  expect(local.databases.filter((name) => /report|rapport/i.test(name))).toEqual([]);
});
