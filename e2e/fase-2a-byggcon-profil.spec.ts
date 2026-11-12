import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  ADMIN_EMAIL,
  createTrialForm,
  expireOwnSession,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  logInAsSampleInspector,
  chooseCodeLogin,
  syncNowButton,
  syncStatus,
} from "./helpers";

/*
 * Byggcon-profilen i EzProp (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 5 og 6).
 * Kjører i prosjektene pc og ipad (liggende 1194 × 834). Stående iPad (1024 × 1366) har egen
 * describe og kjøres bare i prosjektet ipad, så den ikke går to ganger.
 *
 * Skriftnavn: next/font/local gir familienavn som `__inter_abc123`, så testene sjekker mot
 * /inter/i og /schibsted/i og bruker første familie fra getComputedStyle i document.fonts.check.
 * Fargene for TG, synk og status leses fra globals.css (Tailwind skriver bare ut variabler som
 * brukes, så de finnes ikke nødvendigvis i siden).
 *
 * Testdata er oppdiktet (prøveorganisasjonen og e2e-brukerne i helpers.ts).
 * Støtter hovedmål: de ansatte (trykkflater og luft står, skriften virker uten nett), KI i bunnen
 * (KI-merket har eget uttrykk) og færre reklamasjoner (synkstatus ligner ikke TG).
 */

const PORTRAIT = { viewport: { width: 1024, height: 1366 }, hasTouch: true } as const;

const GLOBALS_CSS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "globals.css",
);

/** `--color-*` i `@theme` som `rgb(r, g, b)`, slik getComputedStyle skriver dem. */
function themeRgb(): Record<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const colors: Record<string, string> = {};
  for (const match of theme.matchAll(/--color-([a-z0-9-]+)\s*:\s*#([0-9a-fA-F]{6})\s*;/g)) {
    const hex = match[2]!;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    colors[match[1]!] = `rgb(${r}, ${g}, ${b})`;
  }
  return colors;
}

/** Fargene i temaet med navn som passer mønsteret. Feiler hvis ingen finnes. */
function themeColors(pattern: RegExp): Record<string, string> {
  const found = Object.fromEntries(
    Object.entries(themeRgb()).filter(([name]) => pattern.test(name)),
  );
  expect(Object.keys(found).length, `farger for ${pattern}`).toBeGreaterThan(0);
  return found;
}

function ipadOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "ipad", "Trykkflater og uten nett måles på iPad");
}

function appOrigin(testInfo: TestInfo): string {
  const base = testInfo.project.use.baseURL;
  if (!base) throw new Error("baseURL mangler i playwright.config.ts");
  return new URL(base).origin;
}

/** Alle forespørsler mot andre verter enn appen i hele konteksten (også /dev/epost-fanen). */
function recordForeignRequests(context: BrowserContext, testInfo: TestInfo): string[] {
  const origin = appOrigin(testInfo);
  const foreign: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (!/^https?:/.test(url)) return;
    if (new URL(url).origin !== origin) foreign.push(url);
  });
  return foreign;
}

type FontInfo = { family: string; first: string; loaded: boolean };

/** Skriften på elementet etter document.fonts.ready, og om den er lastet. */
async function fontOf(locator: Locator): Promise<FontInfo> {
  return locator.evaluate(async (element) => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    const first = style.fontFamily.split(",")[0]!.trim();
    const spec = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${first}`;
    return { family: style.fontFamily, first, loaded: document.fonts.check(spec) };
  });
}

/** 5.1 punkt 1: Inter på body og Schibsted Grotesk på h1, begge lastet. */
async function expectProfileFonts(page: Page) {
  const body = await fontOf(page.locator("body"));
  expect(body.family, "body").toMatch(/inter/i);
  expect(body.first, "første familie på body").toMatch(/inter/i);
  expect(body.loaded, `document.fonts.check for ${body.first}`).toBe(true);

  const heading = await fontOf(page.locator("h1").first());
  expect(heading.family, "h1").toMatch(/schibsted/i);
  expect(heading.first, "første familie på h1").toMatch(/schibsted/i);
  expect(heading.loaded, `document.fonts.check for ${heading.first}`).toBe(true);
}

async function openWorkQueue(page: Page) {
  await page.goto("/arbeidskoe");
  await expect(page.getByRole("heading", { name: "Arbeidskø", level: 1 })).toBeVisible();
}

/** Første oppdrag i arbeidskøen til prøvetakstmannen. Gir adressen til oppdraget. */
async function openFirstAssignment(page: Page): Promise<string> {
  await openWorkQueue(page);
  const card = page.getByTestId("work-queue-card").first();
  await expect(card, "prøvetakstmannen har oppdrag (pnpm db:seed:testoppdrag)").toBeVisible();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/oppdrag\/[0-9a-f-]{36}$/);
  await expect(page.locator("h1").first()).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Elementer med fargeovergang i bakgrunnen (getComputedStyle over alle elementer). */
async function elementsWithGradient(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("*"))
      .filter((element) => /gradient/i.test(getComputedStyle(element).backgroundImage))
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 120)),
  );
}

async function borderRadius(locator: Locator): Promise<number> {
  return locator.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius));
}

async function expectPill(locator: Locator, what: string) {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, what).not.toBeNull();
  expect(
    await borderRadius(locator),
    `${what}: border-radius minst halve høyden`,
  ).toBeGreaterThanOrEqual(box!.height / 2);
}

async function expectHeight(locator: Locator, min: number, what: string) {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

/** Bakgrunnsfargen til elementet slik nettleseren viser den. */
async function background(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

// --- KI-kortet på /prove/ki ---

const kiField = (page: Page) => page.getByLabel("Setning");
const kiCard = (page: Page) => page.getByRole("region", { name: "Forslag fra KI" });

/** Åpner /prove/ki som prøvetakstmannen og ber om et forslag. Teksten er oppdiktet. */
async function showSuggestion(page: Page, { signIn = true }: { signIn?: boolean } = {}) {
  if (signIn) await logInAsSampleInspector(page);
  await page.goto("/prove/ki");
  await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
  const tag = `profil${randomUUID().slice(0, 8)}`;
  await kiField(page).fill(`taket er gammelt og har noen sprekker ${tag}`);
  await page.getByRole("button", { name: "Foreslå bedre språk" }).click();
  await expect(kiCard(page).getByTestId("ai-suggestion-text")).toBeVisible();
}

// --- Rammen: topplinje, meny og hopplenken ---

function banner(page: Page): Locator {
  return page.getByRole("banner");
}

function mainNav(page: Page): Locator {
  return page
    .getByRole("navigation")
    .filter({ has: page.getByRole("link", { name: "Arbeidskø", exact: true }) });
}

const skipLink = (page: Page) => page.getByRole("link", { name: "Hopp til hovedinnhold" });

/** 5.3 punkt 5: lenker og knapper i topplinjen og menyen er minst 44 × 44 (som grunnlayouten). */
async function expectMenuTouchTargets(page: Page) {
  const targets = [
    ...(await banner(page).getByRole("link").all()),
    ...(await banner(page).getByRole("button").all()),
    ...(await mainNav(page).getByRole("link").all()),
    ...(await mainNav(page).getByRole("button").all()),
  ];
  expect(targets.length).toBeGreaterThanOrEqual(4);
  for (const target of targets) {
    if (!(await target.isVisible())) continue;
    const name = (await target.textContent())?.trim() ?? "";
    const box = await target.boundingBox();
    expect(box, `${name} er synlig`).not.toBeNull();
    expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  }
}

/** Trykker Tab fra toppen og gir hopplenken når den har fokus. */
async function focusSkipLink(page: Page): Promise<Locator> {
  await openWorkQueue(page);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.keyboard.press("Tab");
  const link = skipLink(page);
  await expect(link).toBeFocused();
  return link;
}

// --- 5.3 trykkflatene, felles for liggende og stående iPad ---

async function expectLoginTouchTargets(page: Page) {
  await page.goto("/logg-inn");
  await chooseCodeLogin(page);
  await expectHeight(
    page.getByRole("button", { name: "Send meg en kode" }),
    56,
    "«Send meg en kode»",
  );
  await page.getByLabel("E-postadresse").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await expect(page.getByLabel("Kode fra e-posten")).toBeVisible();
  await expectHeight(page.getByRole("button", { name: "Logg inn", exact: true }), 56, "«Logg inn»");
}

async function expectKiTouchTargets(page: Page) {
  await showSuggestion(page);
  const card = kiCard(page);
  await expectHeight(card.getByRole("button", { name: "Bruk", exact: true }), 56, "«Bruk»");
  await expectHeight(
    card.getByRole("button", { name: "Behold min tekst", exact: true }),
    44,
    "«Behold min tekst»",
  );
  await expectHeight(
    card.getByRole("button", { name: "Nytt forslag", exact: true }),
    44,
    "«Nytt forslag»",
  );
}

/** «Synk nå» i testskjemaet (hovedknappen der), og «Logg inn» i synkstatusen når økten er ute. */
async function expectSyncTouchTargets(page: Page, context: BrowserContext) {
  await logInAsInspector(page);
  await createTrialForm(page);
  await expectHeight(syncNowButton(page), 56, "«Synk nå»");

  await expireOwnSession(context);
  // Nettet går og kommer: synkstatusen spør serveren og viser «Logg inn» (prøve F).
  await context.setOffline(true);
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "offline");
  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "signInRequired", {
    timeout: 15_000,
  });
  await expectHeight(
    syncStatus(page).getByRole("link", { name: "Logg inn", exact: true }),
    56,
    "«Logg inn» i synkstatusen",
  );
}

async function expectFrameTouchTargets(page: Page) {
  await logIn(page, ADMIN_EMAIL);
  await openWorkQueue(page);
  await expectMenuTouchTargets(page);
  const link = await focusSkipLink(page);
  await expectHeight(link, 44, "hopplenken med fokus");
}

// ---------------------------------------------------------------------------------------------

test.describe("5.1 skrift (pc og iPad liggende)", () => {
  test("1 Inter på body og Schibsted Grotesk på h1 i /arbeidskoe, begge lastet", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await openWorkQueue(page);
    await expectProfileFonts(page);
  });

  test("2 ingen forespørsel mot andre verter enn appen (ingen Google-skrift)", async ({
    page,
    context,
  }, testInfo) => {
    const foreign = recordForeignRequests(context, testInfo);
    await page.goto("/logg-inn");
    await page.evaluate(() => document.fonts.ready);
    await logIn(page, ADMIN_EMAIL);
    await openWorkQueue(page);
    await page.evaluate(() => document.fonts.ready);
    await page.goto("/prove/testskjema");
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(foreign.filter((url) => /fonts\.(googleapis|gstatic)/.test(url))).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test("3 uten nett på iPad: skriftene kommer fra bufferen, og hovedknappen hopper ikke", async ({
    page,
    context,
  }, testInfo) => {
    ipadOnly(testInfo);
    test.setTimeout(120_000);
    await logInAsInspector(page);
    const formId = await createTrialForm(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(syncNowButton(page)).toBeVisible();
    await expectProfileFonts(page);
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
      .toBeGreaterThan(0);

    try {
      await context.setOffline(true);
      await page.goto(`/prove/testskjema/${formId}`, { waitUntil: "commit" });
      const button = syncNowButton(page);
      await expect(button).toBeVisible();
      const before = await button.boundingBox();
      await page.evaluate(() => document.fonts.ready);
      const after = await button.boundingBox();
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(after!.height, "høyden på «Synk nå» før og etter at skriften er klar").toBe(
        before!.height,
      );
      await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "offline");
      await expectProfileFonts(page);
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("5.2 former (pc og iPad liggende)", () => {
  test("1 hovedknappen i innloggingen og en knapp på /arbeidskoe er pilleformet", async ({
    page,
  }) => {
    await page.goto("/logg-inn");
    await chooseCodeLogin(page);
    await expectPill(page.getByRole("button", { name: "Send meg en kode" }), "«Send meg en kode»");
    await logIn(page, ADMIN_EMAIL);
    await openWorkQueue(page);
    await expectPill(page.getByRole("button", { name: "Søk", exact: true }), "«Søk» i arbeidskøen");
    await expectPill(banner(page).getByRole("button", { name: "Logg ut" }), "«Logg ut»");
  });

  test("2 kortet i arbeidskøen har 12 px hjørner, 1 px kant og ingen skygge", async ({ page }) => {
    await logInAsSampleInspector(page);
    await openWorkQueue(page);
    const card = page.getByTestId("work-queue-card").first().locator(":scope > div").first();
    await expect(card).toBeVisible();
    const style = await card.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        radius: computed.borderTopLeftRadius,
        border: computed.borderTopWidth,
        borderStyle: computed.borderTopStyle,
        shadow: computed.boxShadow,
      };
    });
    expect(style.radius).toBe("12px");
    expect(style.border).toBe("1px");
    expect(style.borderStyle).toBe("solid");
    expect(style.shadow).toBe("none");
  });

  test("3 skjemafeltet i testskjemaet har 8 px hjørner", async ({ page }) => {
    await logInAsInspector(page);
    await createTrialForm(page);
    const input = page.getByLabel("Antall etasjer", { exact: true });
    await expect(input).toBeVisible();
    expect(await input.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe(
      "8px",
    );
  });

  test("4 og 5 ingen fargeovergang og ingen nordlysstripe på fire sider", async ({ page }) => {
    await logInAsSampleInspector(page);
    await openWorkQueue(page);
    expect(await elementsWithGradient(page), "/arbeidskoe").toEqual([]);
    await expect(page.locator(".aurora-bar")).toHaveCount(0);

    const assignment = await openFirstAssignment(page);
    expect(await elementsWithGradient(page), assignment).toEqual([]);
    await expect(page.locator(".aurora-bar")).toHaveCount(0);

    await showSuggestion(page, { signIn: false });
    expect(await elementsWithGradient(page), "/prove/ki med forslag").toEqual([]);
    await expect(page.locator(".aurora-bar")).toHaveCount(0);

    await page.context().clearCookies();
    await logInAsInspector(page);
    await createTrialForm(page);
    expect(await elementsWithGradient(page), "/prove/testskjema/[id]").toEqual([]);
    await expect(page.locator(".aurora-bar")).toHaveCount(0);
  });
});

test.describe("5.3 trykkflater, iPad liggende (1194 × 834)", () => {
  test("1 «Send meg en kode» og «Logg inn» er minst 56 px", async ({ page }, testInfo) => {
    ipadOnly(testInfo);
    await expectLoginTouchTargets(page);
  });

  test("3 KI-kortet: «Bruk» minst 56 px, «Behold min tekst» og «Nytt forslag» minst 44 px", async ({
    page,
  }, testInfo) => {
    ipadOnly(testInfo);
    await expectKiTouchTargets(page);
  });

  test("2 og 4 «Synk nå» (hovedknappen i testskjemaet) og «Logg inn» i synkstatusen er minst 56 px", async ({
    page,
    context,
  }, testInfo) => {
    ipadOnly(testInfo);
    test.setTimeout(90_000);
    await expectSyncTouchTargets(page, context);
  });

  test("5 og 6 menyen og topplinjen minst 44 × 44, hopplenken med fokus minst 44 px", async ({
    page,
  }, testInfo) => {
    ipadOnly(testInfo);
    await expectFrameTouchTargets(page);
  });
});

test.describe("5.3 trykkflater, iPad stående (1024 × 1366)", () => {
  test.use(PORTRAIT);

  test("1 «Send meg en kode» og «Logg inn» er minst 56 px", async ({ page }, testInfo) => {
    ipadOnly(testInfo);
    await expectLoginTouchTargets(page);
  });

  test("3 KI-kortet: «Bruk» minst 56 px, «Behold min tekst» og «Nytt forslag» minst 44 px", async ({
    page,
  }, testInfo) => {
    ipadOnly(testInfo);
    await expectKiTouchTargets(page);
  });

  test("2 og 4 «Synk nå» og «Logg inn» i synkstatusen er minst 56 px", async ({
    page,
    context,
  }, testInfo) => {
    ipadOnly(testInfo);
    test.setTimeout(90_000);
    await expectSyncTouchTargets(page, context);
  });

  test("5 og 6 menyen og topplinjen minst 44 × 44, hopplenken med fokus minst 44 px", async ({
    page,
  }, testInfo) => {
    ipadOnly(testInfo);
    await expectFrameTouchTargets(page);
  });
});

test.describe("5.4 hopplenken (pc og iPad liggende)", () => {
  test("1 første Tab viser «Hopp til hovedinnhold» i visningen", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    const link = await focusSkipLink(page);
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    // Ikke klippet bort (sr-only gir 1 × 1 px)
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("2 Enter flytter fokus til main, og neste Tab går til innholdet, ikke menyen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await focusSkipLink(page);
    await page.keyboard.press("Enter");
    // Sidene har selv `<main>`, så målet for hopplenken er rammen `#hovedinnhold` rundt den
    // (layout.tsx). Fokus er riktig når det står i main eller på målet som holder main.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const active = document.activeElement;
            if (!active) return false;
            if (active.closest("main")) return true;
            return active.id === "hovedinnhold" && active.querySelector("main") !== null;
          }),
        { message: "fokus er i main (eller på målet rundt main) etter Enter" },
      )
      .toBe(true);

    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName.toLowerCase() ?? "",
        inMain: Boolean(active?.closest("main")),
        // Menyen og topplinjen utenfor main (en side kan ha egen nav inne i main, for eksempel faner)
        inNav: Boolean(
          active?.closest('nav[aria-label="Hovedmeny"]') ||
          (active?.closest("header") && !active?.closest("main")),
        ),
      };
    });
    expect(next.inMain, `neste Tab (${next.tag}) er i main`).toBe(true);
    expect(next.inNav, `neste Tab (${next.tag}) er ikke i menyen`).toBe(false);
  });

  test("3 fokusrammen på hopplenken er synlig (minst 2 px)", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    const link = await focusSkipLink(page);
    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});

test.describe("5.5 KI-merket (pc og iPad liggende)", () => {
  test("1 forslaget og merket har «KI» i teksten og en bakgrunn ulik TG, synk og status", async ({
    page,
  }) => {
    const forbidden = themeColors(/^(tg.*-bg|sync-.+-bg|(ok|watch|urgent|unknown)-fill)$/);
    const forbiddenValues = new Set(Object.values(forbidden));

    await showSuggestion(page);
    await expect(kiCard(page)).toContainText("Forslag fra KI");
    const box = kiCard(page).getByTestId("ai-suggestion-text");
    const boxBackground = await background(box);
    expect(forbiddenValues.has(boxBackground), `forslagsboksen ${boxBackground}`).toBe(false);
    expect(boxBackground).toBe(themeRgb()["ai-50"]);

    await kiCard(page).getByRole("button", { name: "Bruk", exact: true }).click();
    const mark = kiCard(page).getByText("Tekst fra KI, godkjent");
    await expect(mark).toBeVisible();
    await expect(mark).toContainText("KI");
    const markBackground = await background(mark);
    expect(forbiddenValues.has(markBackground), `KI-merket ${markBackground}`).toBe(false);
    expect(markBackground).toBe(themeRgb()["ai-50"]);
  });
});

test.describe("5.6 synkstatusen (pc og iPad liggende)", () => {
  test("1 «Uten nett» er ikke TG2, TG3 eller feil, og har ikon og tekst", async ({
    page,
    context,
  }) => {
    const forbidden = themeColors(/^(tg2-bg|tg3-bg|urgent-fill|watch-fill)$/);
    await logInAsInspector(page);
    await createTrialForm(page);
    try {
      await context.setOffline(true);
      await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "offline");
      const pill = page.getByTestId("sync-status-state");
      await expect(pill).toHaveText("Uten nett");
      await expect(pill.locator("svg")).toHaveCount(1);
      const color = await background(pill);
      expect(Object.values(forbidden), `«Uten nett» har ${color}`).not.toContain(color);
      expect(color).toBe(themeRgb()["sync-offline-bg"]);
    } finally {
      await context.setOffline(false);
    }
  });

  test("2 «Alt er lagret» er ikke TG0-grønn, og har ikon og tekst", async ({ page }) => {
    const forbidden = themeColors(/^(tg0-bg|tg1-bg|ok-fill)$/);
    await logInAsInspector(page);
    await createTrialForm(page);
    await expect(syncStatus(page)).toHaveAttribute("data-sync-state", "allSaved", {
      timeout: 20_000,
    });
    const pill = page.getByTestId("sync-status-state");
    await expect(pill).not.toHaveText("");
    await expect(pill.locator("svg")).toHaveCount(1);
    const color = await background(pill);
    expect(Object.values(forbidden), `«Alt er lagret» har ${color}`).not.toContain(color);
    expect(color).toBe(themeRgb()["sync-saved-bg"]);
  });
});

test.describe("6 tilgang per rolle og admin (pc og iPad liggende)", () => {
  test("1 admin stenges ikke ute: arbeidskøen, /admin og selskaper", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/arbeidskoe$/);
    await openWorkQueue(page);
    await page.goto("/admin");
    await expect(page.locator("h1").first()).toBeVisible();
    await page.goto("/admin/selskaper");
    await expect(page.getByRole("heading", { name: "Selskaper", level: 1 })).toBeVisible();
  });

  const roles: [string, (page: Page) => Promise<void>][] = [
    ["takstmann", logInAsInspector],
    ["kontor", logInAsOffice],
    ["leder", logInAsManager],
  ];

  for (const [role, logInAs] of roles) {
    test(`2 ${role} logger inn, åpner arbeidskøen og ser samme skrift`, async ({ page }) => {
      await logInAs(page);
      await openWorkQueue(page);
      await expectProfileFonts(page);
    });
  }
});
