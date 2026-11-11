import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_ERROR_INPUT, FAKE_NO_MATCH_INPUT } from "../src/core/ai/providers/fake";
import {
  aiRedactedCountsWithMarker,
  aiUsageRowsForTarget,
  aiUsageRowsWithMarker,
  auditLinesFor,
  logIn,
  logInAsNoAiInspector,
  logInAsOffice,
  logInAsSampleInspector,
} from "./helpers";

/*
 * Forslagsmønsteret på /prove/ki (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 12).
 * Kjører i prosjektene pc og ipad (liggende); testene for stående iPad setter størrelsen selv.
 * Innlogging som prøvetakstmannen i prøveorganisasjonen (KI på med den falske leverandøren,
 * `pnpm db:seed:testoppdrag`). Hver test har sin egen markør i teksten, så radene i KI-loggen
 * kan finnes uten å telle andres. Teksten er oppdiktet.
 * Støtter hovedmål: KI i bunnen («Ferdig når» for 2a-1: forslaget vises, takstmannen godtar
 * eller avviser, og loggen viser det) og de ansatte (egen tekst går aldri tapt, også uten nett).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const OFFLINE_TEXT = "Krever nett. Teksten din er lagret og kan skrives videre.";
const FIXED_LINE =
  "Bruk oppdiktet tekst. Ikke skriv navn, adresse eller kundeopplysninger. Forslaget lagres i KI-loggen.";

function marker(): string {
  return `m${randomUUID().slice(0, 8)}`;
}

function sentence(tag: string): string {
  return `taket er gammelt og har noen sprekker ${tag}`;
}

/** Det falske forslaget for en setning: stor forbokstav og punktum. */
function polished(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

const field = (page: Page) => page.getByLabel("Setning");
const askButton = (page: Page) => page.getByRole("button", { name: "Foreslå bedre språk" });
const card = (page: Page) => page.getByRole("region", { name: "Forslag fra KI" });
const logged = (page: Page) => page.getByTestId("ai-trial-logged");
const mark = (page: Page) => page.getByText("Tekst fra KI, godkjent");

async function openTrial(page: Page) {
  await logInAsSampleInspector(page);
  await page.goto("/prove/ki");
  await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
}

/** Skriver setningen, ber om forslag og venter på kortet. Gir raden i KI-loggen. */
async function askFor(page: Page, text: string, tag: string) {
  await field(page).fill(text);
  await askButton(page).click();
  await expect(card(page).getByTestId("ai-suggestion-text")).toHaveText(polished(text));
  await expect(logged(page)).toHaveText("Logget: forslag");
  const rows = await aiUsageRowsWithMarker(tag);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

test.describe("forslagsmønsteret (pc og ipad)", () => {
  test("12.1 forslaget vises med merket «Forslag fra KI»", async ({ page }) => {
    await openTrial(page);
    await expect(page.getByText(FIXED_LINE)).toBeVisible();
    const tag = marker();
    const row = await askFor(page, sentence(tag), tag);
    await expect(card(page)).toContainText("Forslag fra KI · språkvask");
    await expect(card(page).getByTestId("ai-suggestion-own-text")).toHaveText(sentence(tag));
    expect(row.targetRef).toMatchObject({ type: "ai_trial", fieldKey: "text" });
    expect(row.status).toBe("suggested");
  });

  test("12.2 og 12.3 «Bruk» bytter teksten, «Angre» gir den tilbake", async ({ page }) => {
    await openTrial(page);
    const tag = marker();
    const row = await askFor(page, sentence(tag), tag);
    // Takstmannen skriver videre før «Bruk»; den teksten kommer tilbake ved «Angre» (valg B)
    const edited = `${sentence(tag)} og en takstein mangler`;
    await field(page).fill(edited);

    await card(page).getByRole("button", { name: "Bruk" }).click();
    await expect(logged(page)).toHaveText("Logget: godtatt");
    await expect(field(page)).toHaveValue(polished(sentence(tag)));
    await expect(mark(page)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Angre" })).toBeFocused();
    const accepted = (await aiUsageRowsForTarget(row.targetRef.id)).find((r) => r.id === row.id);
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.decidedBy).not.toBeNull();

    await card(page).getByRole("button", { name: "Angre" }).click();
    await expect(logged(page)).toHaveText("Logget: forslag");
    await expect(field(page)).toHaveValue(edited);
    await expect(mark(page)).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toBeFocused();
    const undone = (await aiUsageRowsForTarget(row.targetRef.id)).find((r) => r.id === row.id);
    expect(undone?.status).toBe("suggested");
    expect(undone?.decidedBy).toBeNull();
  });

  test("12.4 «Behold min tekst» og «Angre»", async ({ page }) => {
    await openTrial(page);
    const tag = marker();
    const row = await askFor(page, sentence(tag), tag);

    await card(page).getByRole("button", { name: "Behold min tekst" }).click();
    await expect(logged(page)).toHaveText("Logget: avvist");
    await expect(field(page)).toHaveValue(sentence(tag));
    await expect(card(page)).toContainText("Du beholdt din tekst.");
    expect((await aiUsageRowsWithMarker(tag))[0]?.status).toBe("rejected");

    await card(page).getByRole("button", { name: "Angre" }).click();
    await expect(logged(page)).toHaveText("Logget: forslag");
    await expect(field(page)).toHaveValue(sentence(tag));
    const rows = await aiUsageRowsForTarget(row.targetRef.id);
    expect(rows.find((r) => r.id === row.id)?.status).toBe("suggested");
  });

  test("12.5 «Nytt forslag» gir ny rad og avviser det gamle; feil lar det gamle stå", async ({
    page,
  }) => {
    await openTrial(page);
    const tag = marker();
    const first = await askFor(page, sentence(tag), tag);

    const second = `vinduet i stua er råttent ${tag}`;
    await field(page).fill(second);
    await card(page).getByRole("button", { name: "Nytt forslag" }).click();
    await expect(card(page).getByTestId("ai-suggestion-text")).toHaveText(polished(second));
    let rows = await aiUsageRowsForTarget(first.targetRef.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: first.id, status: "rejected" });
    expect(rows[1]?.status).toBe("suggested");

    await field(page).fill(`${FAKE_ERROR_INPUT} ${tag}`);
    await card(page).getByRole("button", { name: "Nytt forslag" }).click();
    await expect(card(page)).toContainText("KI svarte ikke. Prøv igjen.");
    await expect(card(page).getByTestId("ai-suggestion-text")).toHaveText(polished(second));
    rows = await aiUsageRowsForTarget(first.targetRef.id);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.status).toBe("suggested");
    expect(rows[2]?.outcome).toBe("error");
  });

  test("12.6 feil fra KI: «KI svarte ikke. Prøv igjen.», egen tekst uendret", async ({ page }) => {
    await openTrial(page);
    const text = `${FAKE_ERROR_INPUT} ${marker()}`;
    await field(page).fill(text);
    await askButton(page).click();
    await expect(card(page)).toContainText("KI svarte ikke. Prøv igjen.");
    await expect(field(page)).toHaveValue(text);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toHaveCount(0);
  });

  test("ingen forslag: kort tekst, egen tekst uendret", async ({ page }) => {
    await openTrial(page);
    const text = `${FAKE_NO_MATCH_INPUT} ${marker()}`;
    await field(page).fill(text);
    await askButton(page).click();
    await expect(card(page)).toContainText("KI hadde ikke noe forslag. Teksten din er uendret.");
    await expect(field(page)).toHaveValue(text);
  });

  test("12.7 KI er av i organisasjonen: «KI er av.» og ingen rad", async ({ page }) => {
    await logInAsNoAiInspector(page);
    await page.goto("/prove/ki");
    const tag = marker();
    await field(page).fill(sentence(tag));
    await askButton(page).click();
    await expect(page.getByText("KI er av.")).toBeVisible();
    await expect(askButton(page)).toBeDisabled();
    await expect(field(page)).toHaveValue(sentence(tag));
    expect(await aiUsageRowsWithMarker(tag)).toHaveLength(0);
  });

  test("12.8 og 12.13 uten nett: knappen sperret, feltet kan skrives i, nettstatus synlig", async ({
    page,
    context,
  }) => {
    await openTrial(page);
    const status = page.getByTestId("network-status");
    await expect(status).toHaveText("På nett");
    const tag = marker();
    await field(page).fill(sentence(tag));

    await context.setOffline(true);
    await expect(status).toHaveText("Uten nett", { timeout: 5_000 });
    await expect(page.getByText(OFFLINE_TEXT).first()).toBeVisible({ timeout: 5_000 });
    await expect(askButton(page)).toBeDisabled();
    await field(page).fill(`${sentence(tag)} og mer`);
    await expect(field(page)).toHaveValue(`${sentence(tag)} og mer`);

    await context.setOffline(false);
    await expect(status).toHaveText("På nett", { timeout: 5_000 });
    await expect(askButton(page)).toBeEnabled();
    await askButton(page).click();
    await expect(card(page).getByTestId("ai-suggestion-text")).toHaveText(
      polished(`${sentence(tag)} og mer`),
    );
  });

  test("12.9 nettet faller midt i et forslag: samme tekst, egen tekst uendret", async ({
    page,
    context,
  }) => {
    await openTrial(page);
    const tag = marker();
    const text = sentence(tag);
    let held = false;
    await page.route("**/prove/ki", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      held = true; // holdes igjen til testen er ferdig
    });
    await field(page).fill(text);
    await askButton(page).click();
    await expect.poll(() => held).toBe(true);
    await expect(card(page)).toContainText("KI jobber …");

    await context.setOffline(true);
    await expect(page.getByText(OFFLINE_TEXT).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("KI jobber …")).toHaveCount(0, { timeout: 5_000 });
    await expect(field(page)).toHaveValue(text);
    await expect(field(page)).toBeEditable();
    await context.setOffline(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("12.10 dobbelttrykk gir én rad og én linje i audit_log per handling", async ({ page }) => {
    await openTrial(page);
    const tag = marker();
    await field(page).fill(sentence(tag));
    await askButton(page).dblclick();
    await expect(card(page).getByTestId("ai-suggestion-text")).toHaveText(polished(sentence(tag)));
    await expect(logged(page)).toHaveText("Logget: forslag");
    const rows = await aiUsageRowsWithMarker(tag);
    expect(rows).toHaveLength(1);

    await card(page).getByRole("button", { name: "Bruk" }).dblclick();
    await expect(logged(page)).toHaveText("Logget: godtatt");
    await expect.poll(async () => (await auditLinesFor(rows[0]!.id)).length).toBe(1);
    expect(await aiUsageRowsWithMarker(tag)).toHaveLength(1);
  });

  test("12.11 trykkflater: «Bruk» 56–72, de andre minst 44", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "måles bare på iPad");
    await openTrial(page);
    const tag = marker();
    await askFor(page, sentence(tag), tag);
    const use = await card(page).getByRole("button", { name: "Bruk" }).boundingBox();
    expect(use?.height).toBeGreaterThanOrEqual(56);
    expect(use?.height).toBeLessThanOrEqual(72);
    for (const name of ["Behold min tekst", "Nytt forslag"]) {
      const box = await card(page).getByRole("button", { name }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
      expect(box?.width, name).toBeGreaterThanOrEqual(44);
    }
    const ask = await askButton(page).boundingBox();
    expect(ask?.height).toBeGreaterThanOrEqual(56);
    await card(page).getByRole("button", { name: "Behold min tekst" }).click();
    const undo = await card(page).getByRole("button", { name: "Angre" }).boundingBox();
    expect(undo?.height).toBeGreaterThanOrEqual(44);
  });

  test("12.12 side om side liggende og på PC, over hverandre på stående iPad", async ({ page }) => {
    await openTrial(page);
    const tag = marker();
    await askFor(page, sentence(tag), tag);
    const own = card(page).getByTestId("ai-suggestion-own-text");
    const suggestion = card(page).getByTestId("ai-suggestion-text");

    const ownBox = await own.boundingBox();
    const suggestionBox = await suggestion.boundingBox();
    expect(suggestionBox!.x).toBeGreaterThan(ownBox!.x + ownBox!.width);
    expect(Math.abs(suggestionBox!.y - ownBox!.y)).toBeLessThan(80);

    await page.setViewportSize(PORTRAIT);
    await expect(async () => {
      const ownPortrait = await own.boundingBox();
      const suggestionPortrait = await suggestion.boundingBox();
      expect(suggestionPortrait!.y).toBeGreaterThan(ownPortrait!.y + ownPortrait!.height);
    }).toPass();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("12.14 forslaget vises som tekst, aldri som HTML", async ({ page }) => {
    await openTrial(page);
    const tag = marker();
    const text = `<b>fet</b> ${tag}`;
    await field(page).fill(text);
    await askButton(page).click();
    const suggestion = card(page).getByTestId("ai-suggestion-text");
    await expect(suggestion).toHaveText(polished(text));
    await expect(card(page).locator("b")).toHaveCount(0);
  });

  test("12.15 tilgang: kontor uten report.edit får «Ingen tilgang», admin kommer inn", async ({
    page,
  }) => {
    await logInAsOffice(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Ingen tilgang" })).toBeVisible();
    await expect(askButton(page)).toHaveCount(0);

    await page.context().clearCookies();
    await logIn(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
    await expect(askButton(page)).toBeVisible();
  });

  /*
   * Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 9). Den falske
   * leverandøren får også bare vasket tekst, så forslaget viser plassholderne. Telefonnummer og
   * e-post er oppdiktet.
   */
  test("V9.1 telefon og e-post vaskes før KI: forslaget viser [telefon] og [e-post]", async ({
    page,
  }) => {
    await openTrial(page);
    const tag = marker();
    const text = `ring 12345678 eller skriv til ola.prove@example.no ${tag}`;
    await field(page).fill(text);
    await askButton(page).click();
    const suggestion = card(page).getByTestId("ai-suggestion-text");
    await expect(suggestion).toHaveText(polished(`ring [telefon] eller skriv til [e-post] ${tag}`));
    await expect(suggestion).not.toContainText("12345678");
    await expect(suggestion).not.toContainText("ola.prove@example.no");
    await expect(logged(page)).toHaveText("Logget: forslag");
    // Egen tekst i feltet står urørt; bare det som sendes til KI, vaskes
    await expect(field(page)).toHaveValue(text);
    expect(await aiRedactedCountsWithMarker(tag)).toEqual([{ outcome: "ok", redactedCount: 2 }]);
  });

  // Admin sin organisasjon (Byggcon) har KI av i seed (KI-modulen 13.7), så her vises at admin
  // kommer inn og ber om forslag uten å bli stengt ute (regel 11), og at teksten aldri lagres.
  // Vasket forslag for admin med falsk leverandør prøves i Vitest (access.test.ts, V7.4).
  test("V9.3 admin kommer inn og kan be om forslag; ingen rad og egen tekst står", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/prove/ki");
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
    const tag = marker();
    const text = `admin ringte 87654321 ${tag}`;
    await field(page).fill(text);
    await askButton(page).click();
    await expect(page.getByText("KI er av.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ingen tilgang" })).toHaveCount(0);
    await expect(field(page)).toHaveValue(text);
    expect(await aiUsageRowsWithMarker(tag)).toHaveLength(0);
  });
});
