import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import {
  addRuleTg3Deviation,
  createSampleBathroom,
  createTrialForm,
  indicator,
  logIn,
  openSampleBathroom,
  waitForTrialHook,
} from "./helpers";

/*
 * Skjermbilder før og etter Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil.md, «Omfang»).
 * Fem skjermer i to størrelser: PC 1440 × 900 og iPad stående 1024 × 1366. Bildene lagres i
 * docs/design/byggcon-profil/bilder/ezprop-<SCREENSHOTS>-<skjerm>-<pc|ipad>.png.
 *
 * Kjøres bare når SCREENSHOTS er satt (verdi «for» eller «etter»), så vanlig `pnpm test:e2e`
 * hopper over den. Bare i prosjektet pc; størrelsene settes her.
 *
 * Før-bildene ble tatt fra main før temaet ble endret:
 *   SCREENSHOTS=for PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
 *     pnpm test:e2e e2e/byggcon-profil-skjermbilder.spec.ts --project=pc
 * Etter-bildene tas i integrasjonssteget, når temaet og felleskomponentene er inne:
 *   SCREENSHOTS=etter PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
 *     pnpm test:e2e e2e/byggcon-profil-skjermbilder.spec.ts --project=pc
 *
 * Bare oppdiktede data fra prøveorganisasjonen (`pnpm db:seed:testoppdrag`): innlogging som
 * prøvetakstmannen, ett av testoppdragene og et oppdiktet bad med utkast til sammendrag fra den
 * falske leverandøren.
 *
 * Støtter hovedmål: de ansatte (uttrykket kan sammenlignes før og etter, og luften og
 * trykkflatene på iPad kan sjekkes med øyet).
 */

const VARIANT = process.env.SCREENSHOTS ?? "";
const OUT_DIR = path.join("docs", "design", "byggcon-profil", "bilder");

const SIZES = [
  { name: "pc", viewport: { width: 1440, height: 900 }, hasTouch: false },
  { name: "ipad", viewport: { width: 1024, height: 1366 }, hasTouch: true },
] as const;

function file(screen: string, size: string): string {
  return path.join(OUT_DIR, `ezprop-${VARIANT}-${screen}-${size}.png`);
}

async function snap(page: Page, screen: string, size: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file(screen, size), fullPage: false, animations: "disabled" });
}

async function newPage(
  browser: Browser,
  size: (typeof SIZES)[number],
  baseURL: string | undefined,
) {
  const context = await browser.newContext({
    baseURL,
    viewport: size.viewport,
    hasTouch: size.hasTouch,
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
  });
  return { context, page: await context.newPage() };
}

test.describe("skjermbilder Byggcon-profilen", () => {
  test.skip(!process.env.SCREENSHOTS, "bare med SCREENSHOTS=for eller SCREENSHOTS=etter");
  test.setTimeout(240_000);

  test.beforeAll(() => {
    if (!["for", "etter"].includes(VARIANT)) {
      throw new Error("SCREENSHOTS må være «for» eller «etter»");
    }
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const size of SIZES) {
    test(`fem skjermer, ${size.name}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== "pc", "størrelsene settes i testen");
      const { context, page } = await newPage(browser, size, testInfo.project.use.baseURL);
      try {
        // 1 Innlogging (ikke logget inn)
        await page.goto("/logg-inn");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await snap(page, "innlogging", size.name);

        // 2 Arbeidskøen som prøvetakstmannen
        await logIn(page, SAMPLE_INSPECTOR.email);
        await page.goto("/arbeidskoe?status=in_progress&mine=0");
        const cards = page.getByTestId("work-queue-card");
        await expect(cards.first()).toBeVisible();
        await snap(page, "arbeidskoe", size.name);

        // 3 Ett oppdrag (det første testoppdraget under arbeid)
        await cards.first().getByRole("link").first().click();
        await expect(page).toHaveURL(/\/oppdrag\/[0-9a-f-]{36}$/);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await snap(page, "oppdrag", size.name);

        // 4 Testskjemaet med synkstatus
        await createTrialForm(page);
        await waitForTrialHook(page);
        await page.getByLabel("Antall etasjer", { exact: true }).fill("2");
        await expect(indicator(page)).toHaveText("Alt er lagret", { timeout: 20_000 });
        await snap(page, "skjema", size.name);

        // 5 Badskjermen med forslagskortet (utkast til sammendrag). Før «KI i veien» var dette
        // prøvesiden /prove/ki, som er fjernet (A487).
        const bath = await createSampleBathroom();
        await openSampleBathroom(page, bath, "wet_room.membrane_drain");
        await addRuleTg3Deviation(page);
        const summary = page.getByRole("region", { name: "Sammendrag for hele rapporten" });
        await expect(summary.getByRole("button", { name: "Lag utkast" })).toBeEnabled();
        await summary.getByRole("button", { name: "Lag utkast" }).click();
        const card = summary.getByRole("region", { name: "Forslag fra KI" });
        await expect(card.getByTestId("ai-suggestion-text")).toBeVisible();
        await card.scrollIntoViewIfNeeded();
        await snap(page, "ki", size.name);
      } finally {
        await context.close();
      }
    });
  }
});
