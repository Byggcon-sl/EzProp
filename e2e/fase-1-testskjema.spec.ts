import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { trialForm } from "../src/modules/offline-trial/trial-form";
import { brand } from "../src/shared/config/brand";
import {
  ADMIN_EMAIL,
  MB,
  createTrialForm,
  hookValue,
  indicator,
  logIn,
  setStorageOverride,
  storageWarning,
  useCandidate,
} from "./helpers";

// Testskjemaet for prøven uten nett (fase 1, oppgave 3).
// Testplan: docs/funksjoner/fase1-testskjema-testplan.md avsnitt 6. Kjører i både pc og ipad.
// Oppgave 4 (PowerSync): /prove/testskjema er nå en liste, og skjemaet åpnes fra «Nytt testskjema»
// (docs/funksjoner/fase1-kandidat-powersync-testplan.md avsnitt 6.1). Uten nett: fase-1-powersync.spec.ts.

const TEST_IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "test-image.png",
);
const fields = trialForm.groups.flatMap((group) => group.fields);
const numberFields = fields.filter((field) => field.type === "number");

function counter(page: Page): Locator {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

async function expectCount(page: Page, n: number) {
  await expect(counter(page)).toHaveText(`${n} av 40 felt utfylt`);
}

function fieldContainer(page: Page, key: string): Locator {
  return page.locator(`[data-field="${key}"]`);
}

function group(page: Page, label: string): Locator {
  return page.getByRole("group", { name: label, exact: true });
}

async function openTrialForm(page: Page) {
  await logIn(page, ADMIN_EMAIL);
  await createTrialForm(page);
  await expectCount(page, 0);
}

test("uinnlogget sendes til innlogging fra /prove/testskjema", async ({ page }) => {
  await page.goto("/prove/testskjema");
  await expect(page).toHaveURL(/\/logg-inn$/);
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
});

test("admin finner lenken Prøve uten nett: testskjema på arbeidskøen og ser 0 av 40 felt utfylt", async ({
  page,
}) => {
  await logIn(page, ADMIN_EMAIL);
  const link = page.getByRole("link", { name: "Testskjema uten nett" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/prove\/testskjema$/);
  // Listen først (oppgave 4), skjemaet etter trykk på «Nytt testskjema»
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  const create = page.getByRole("button", { name: "Nytt testskjema", exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page).toHaveURL(/\/prove\/testskjema\/[0-9a-f-]{36}$/);
  await expectCount(page, 0);
});

test("alle seks gruppene og alle 40 etiketter vises", async ({ page }) => {
  await openTrialForm(page);
  expect(trialForm.groups).toHaveLength(6);
  expect(fields).toHaveLength(40);
  for (const g of trialForm.groups) {
    await expect(page.getByRole("heading", { name: g.title, exact: true })).toBeVisible();
  }
  for (const field of fields) {
    switch (field.type) {
      case "text":
      case "number":
      case "photo":
        await expect(page.getByLabel(field.label, { exact: true }), field.key).toBeVisible();
        break;
      case "tg":
      case "choice":
        await expect(group(page, field.label), field.key).toBeVisible();
        break;
      case "table":
        await expect(fieldContainer(page, field.key).getByText(field.label)).toBeVisible();
        await expect(
          fieldContainer(page, field.key).getByRole("button", { name: "Legg til rad" }),
        ).toBeVisible();
        break;
    }
  }
});

test("ingen nedtrekksmenyer", async ({ page }) => {
  await openTrialForm(page);
  await expect(page.locator("select")).toHaveCount(0);
});

test("TG-knapp er minst 44 px høy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "Trykkflaten måles i iPad-størrelse");
  await openTrialForm(page);
  const button = group(page, "Tak – tilstandsgrad").getByRole("button", {
    name: "TG0",
    exact: true,
  });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test("tallfelt har inputMode decimal", async ({ page }) => {
  await openTrialForm(page);
  expect(numberFields).toHaveLength(9);
  for (const field of numberFields) {
    const input = page.getByLabel(field.label, { exact: true });
    await expect(input, field.key).toHaveAttribute("inputmode", "decimal");
    await expect(input, field.key).toHaveAttribute("type", "text");
    expect(await input.evaluate((el) => el.tagName), field.key).toBe("INPUT");
  }
});

test("valg er ett trykk og bare ett valg er trykket", async ({ page }) => {
  await openTrialForm(page);
  const choice = group(page, "Lekkasjestopper");
  const yes = choice.getByRole("button", { name: "Ja", exact: true });
  const no = choice.getByRole("button", { name: "Nei", exact: true });
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(no).toHaveAttribute("aria-pressed", "false");

  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(choice.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expectCount(page, 1);

  await no.click();
  await expect(no).toHaveAttribute("aria-pressed", "true");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(choice.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expectCount(page, 1);
});

test("TG er ett trykk og bare én TG er trykket", async ({ page }) => {
  await openTrialForm(page);
  const tg = group(page, "Tak – tilstandsgrad");
  await expect(tg.getByRole("button")).toHaveCount(5);
  for (const name of ["TG0", "TG1", "TG2", "TG3", "TGIU"]) {
    await expect(tg.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const tg2 = tg.getByRole("button", { name: "TG2", exact: true });
  const tg3 = tg.getByRole("button", { name: "TG3", exact: true });

  await tg2.click();
  await expect(tg2).toHaveAttribute("aria-pressed", "true");
  await expect(tg.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expectCount(page, 1);

  await tg3.click();
  await expect(tg3).toHaveAttribute("aria-pressed", "true");
  await expect(tg2).toHaveAttribute("aria-pressed", "false");
  await expect(tg.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expectCount(page, 1);
});

/** Fyller ut alle 40 felt ett for ett og sjekker at telleren går opp med nøyaktig ett for hvert. */
async function fillAllFields(page: Page) {
  let answered = 0;

  for (const field of fields) {
    switch (field.type) {
      case "text":
        await page.getByLabel(field.label, { exact: true }).fill("Oppdiktet tekst");
        break;
      case "tg": {
        const button = group(page, field.label).getByRole("button", { name: "TG1", exact: true });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(group(page, field.label).locator('button[aria-pressed="true"]')).toHaveCount(
          1,
        );
        break;
      }
      case "choice": {
        const first = field.options?.[0];
        expect(first, field.key).toBeDefined();
        const button = group(page, field.label).getByRole("button", {
          name: first!.label,
          exact: true,
        });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(group(page, field.label).locator('button[aria-pressed="true"]')).toHaveCount(
          1,
        );
        break;
      }
      case "number":
        await page.getByLabel(field.label, { exact: true }).fill("12,5");
        break;
      case "table": {
        const table = fieldContainer(page, field.key);
        const addRow = table.getByRole("button", { name: "Legg til rad" });
        await addRow.click();
        await addRow.click();
        await table.getByLabel("Sted, rad 1", { exact: true }).fill("Oppdiktet sted");
        await table.getByLabel("Verdi, rad 1", { exact: true }).fill("12,5");
        await table.getByLabel("Kommentar, rad 1", { exact: true }).fill("Oppdiktet kommentar");
        await table.getByLabel("Sted, rad 2", { exact: true }).fill("Annet sted");
        await table.getByRole("button", { name: "Slett rad 2", exact: true }).click();
        // Én rad igjen, og den beholder det som ble skrevet
        await expect(table.getByLabel("Sted, rad 2", { exact: true })).toHaveCount(0);
        await expect(table.getByRole("button", { name: "Slett rad 2", exact: true })).toHaveCount(
          0,
        );
        await expect(table.getByLabel("Sted, rad 1", { exact: true })).toHaveValue(
          "Oppdiktet sted",
        );
        await expect(table.getByLabel("Verdi, rad 1", { exact: true })).toHaveValue("12,5");
        await expect(table.getByRole("button", { name: "Slett rad 1", exact: true })).toBeVisible();
        break;
      }
      case "photo": {
        await page.getByLabel(field.label, { exact: true }).setInputFiles(TEST_IMAGE);
        const container = fieldContainer(page, field.key);
        await expect(container.getByText("1 bilde", { exact: true })).toBeVisible();
        await expect(container.getByText("test-image.png")).toBeVisible();
        break;
      }
    }
    answered += 1;
    // Telleren går opp med nøyaktig ett for hvert felt (også tabellen etter to lagt til og én slettet)
    await expectCount(page, answered);
  }

  expect(answered).toBe(40);
}

test("alle 40 felt fylles ut og telleren viser 40 av 40", async ({ page }) => {
  await openTrialForm(page);
  await fillAllFields(page);
  await expect(counter(page)).toHaveText("40 av 40 felt utfylt");
});

// Kandidat 2 (docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6.1): samme skjema og
// samme utfylling med ElectricSQL valgt. Resten av filen kjører med standardkandidaten (PowerSync).
test("alle 40 felt fylles ut og telleren viser 40 av 40 med ElectricSQL valgt", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  await openTrialForm(page);
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  await fillAllFields(page);
  await expect(counter(page)).toHaveText("40 av 40 felt utfylt");
});

// Kandidat 3 (docs/funksjoner/fase1-kandidat-egenbygd-testplan.md avsnitt 6.1). Obligatorisk.
test("alle 40 felt fylles ut og telleren viser 40 av 40 med Egenbygd valgt", async ({
  page,
  context,
}) => {
  await useCandidate(context, "custom");
  await openTrialForm(page);
  expect(await hookValue(page, "candidate")).toBe("custom");
  await fillAllFields(page);
  await expect(counter(page)).toHaveText("40 av 40 felt utfylt");
});

test("tall med bokstaver teller ikke", async ({ page }) => {
  await openTrialForm(page);
  const year = page.getByLabel("Byggeår", { exact: true });
  await year.fill("abc");
  await expectCount(page, 0);
  await year.fill("1985");
  await expectCount(page, 1);
  await year.fill("");
  await expectCount(page, 0);
});

test("tall med komma på slutten beholdes mens man skriver", async ({ page }) => {
  // Kjent svakhet fra oppgave 3, rettet i oppgave 4 (pkt. 20): «12,» skal ikke forsvinne
  await openTrialForm(page);
  const floors = page.getByLabel("Antall etasjer", { exact: true });
  await floors.fill("12,");
  await expect(floors).toHaveValue("12,");
  await expectCount(page, 0);
  await floors.fill("12,5");
  await expect(floors).toHaveValue("12,5");
  await expectCount(page, 1);
  await floors.blur();
  await expect(floors).toHaveValue("12,5");
  await expectCount(page, 1);
});

test("Nytt testskjema er minst 44 px høy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "Trykkflaten måles i iPad-størrelse");
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  const button = page.getByRole("button", { name: "Nytt testskjema", exact: true });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test("manifest.webmanifest svarer 200 med standalone, start_url /arbeidskoe og navn fra brand", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    display?: string;
    start_url?: string;
    name?: string;
    lang?: string;
    icons?: { src: string }[];
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/arbeidskoe");
  expect(manifest.name).toBe(brand.productName);
  expect(manifest.lang).toBe("nb");
  expect(manifest.icons?.[0]?.src).toContain("/apple-icon");
});

test("/apple-icon svarer 200 med image/png", async ({ request }) => {
  const response = await request.get("/apple-icon");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/png/);
});

test("innloggingssiden har link rel=manifest og apple-mobile-web-app-capable", async ({ page }) => {
  await page.goto("/logg-inn");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"][content="yes"]'),
  ).toHaveCount(1);
});

// --- UU-funn 6–9 fra nattløkken 30.10.2026 (docs/agenter/oppgaver/fase1-uu-nattlokken-testplan.md
// avsnitt 1). Kjører i pc og ipad. Alle data er oppdiktet.

const tableField = fields.find((field) => field.type === "table");
if (!tableField?.columns?.length) throw new Error("Testskjemaet mangler tabellfelt med kolonner");
const tableColumns = tableField.columns;

/** Kontrastforholdet mellom to farger etter WCAG 2.x (relativ luminans). */
function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const match = /rgba?\(([^)]+)\)/.exec(color);
    if (!match) throw new Error(`Ukjent farge «${color}»`);
    const [r, g, b] = match[1]!
      .split(/[,\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => {
        const c = Number(part) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Den faste linjen øverst i skjemaet (sticky-beholderen med synkstatusen). */
function stickyLine(page: Page): Locator {
  return page
    .locator('[data-testid="sticky-status-bar"], div.sticky')
    .filter({ has: indicator(page) })
    .first();
}

/**
 * Ruller helt ned og gir fokus til første tekst- eller tallfelt i andre gruppe, som da ligger over
 * synsfeltet. Feltet må komme ovenfra: et felt under synsfeltet rulles til nederkanten og kan aldri
 * treffe statuslinjen.
 *
 * To måter å rulle på: (1) vanlig `focus()`, slik Chromium gjør det (legger feltet midt i bildet,
 * så den alene biter ikke), og (2) fokus der feltet rulles til nærmeste kant, slik Safari på iPaden
 * gjør. Det er (2) som viser at `scroll-padding-top` virker.
 */
async function expectFocusedFieldBelowStatusBar(page: Page) {
  const target = trialForm.groups[1]!.fields.find(
    (field) => field.type === "text" || field.type === "number",
  );
  expect(target, "andre gruppe har et tekst- eller tallfelt").toBeDefined();
  const input = page.getByLabel(target!.label, { exact: true });
  const bar = stickyLine(page);
  await expect(bar).toBeVisible();
  await expect(input).toBeVisible();

  for (const mode of ["focus", "nearest-edge"] as const) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(async () => (await input.boundingBox())?.y ?? 0, {
        message: `${mode}: feltet ligger over synsfeltet før det får fokus`,
      })
      .toBeLessThan(0);

    if (mode === "focus") {
      await input.focus();
    } else {
      await input.evaluate((el) => {
        (el as HTMLElement).focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
      });
    }
    await expect(input).toBeFocused();
    // Vent til rullingen har stoppet
    let last = Number.NaN;
    await expect
      .poll(async () => {
        const y = (await input.boundingBox())?.y ?? Number.NaN;
        const stable = y === last;
        last = y;
        return stable;
      })
      .toBe(true);

    const fieldBox = await input.boundingBox();
    const barBox = await bar.boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(
      fieldBox!.y,
      `${mode}: feltet (${fieldBox!.y}) starter under statuslinjen (${barBox!.y + barBox!.height})`,
    ).toBeGreaterThanOrEqual(barBox!.y + barBox!.height - 1);
  }
}

test("tabellfeltet viser kolonnenavnet synlig over cellene i første rad, også etter utfylling", async ({
  page,
}) => {
  await openTrialForm(page);
  const table = fieldContainer(page, tableField.key);
  await table.getByRole("button", { name: "Legg til rad" }).click();
  for (const column of tableColumns) {
    await expect(table.getByText(column.label, { exact: true }).first(), column.key).toBeVisible();
  }
  await table.getByLabel("Sted, rad 1", { exact: true }).fill("Oppdiktet sted");
  await table.getByLabel("Verdi, rad 1", { exact: true }).fill("12,5");
  // Navnet er ikke bare plassholder: det står der også når cellen har verdi
  for (const column of tableColumns) {
    await expect(table.getByText(column.label, { exact: true }).first(), column.key).toBeVisible();
  }
});

test("kolonnenavnet over tabellcellene har kontrast minst 4,5:1", async ({ page }) => {
  await openTrialForm(page);
  const table = fieldContainer(page, tableField.key);
  await table.getByRole("button", { name: "Legg til rad" }).click();
  const label = table.getByText(tableColumns[0]!.label, { exact: true }).first();
  await expect(label).toBeVisible();
  const colors = await label.evaluate((el) => {
    // Tailwind v4 gir farger i lab()/oklab(). Et 1x1-canvas gjør dem om til sRGB.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Fikk ikke 2d-canvas");
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a!];
    };
    const rgb = ([r, g, b]: number[]) => `rgb(${r}, ${g}, ${b})`;
    const foreground = toRgba(getComputedStyle(el).color);
    let background = [255, 255, 255];
    let node: Element | null = el;
    while (node) {
      const [r, g, b, a] = toRgba(getComputedStyle(node).backgroundColor);
      if (a > 0) {
        // Halvgjennomsiktig bakgrunn (f.eks. bg-white/95) legges over hvit.
        background = [r, g, b].map((c) => Math.round((c * a) / 255 + 255 * (1 - a / 255)));
        break;
      }
      node = node.parentElement;
    }
    return { foreground: rgb(foreground), background: rgb(background) };
  });
  const ratio = contrastRatio(colors.foreground, colors.background);
  expect(ratio, `${colors.foreground} mot ${colors.background}`).toBeGreaterThanOrEqual(4.5);
});

test("hver tabellcelle har fortsatt et tilgjengelig navn med kolonne og rad", async ({ page }) => {
  await openTrialForm(page);
  const table = fieldContainer(page, tableField.key);
  const addRow = table.getByRole("button", { name: "Legg til rad" });
  await addRow.click();
  await addRow.click();
  for (const row of [1, 2]) {
    for (const column of tableColumns) {
      await expect(
        table.getByLabel(`${column.label}, rad ${row}`, { exact: true }),
        `${column.key} rad ${row}`,
      ).toHaveCount(1);
    }
  }
});

test("felt med fokus dekkes ikke av statuslinjen", async ({ page }) => {
  await openTrialForm(page);
  await expectFocusedFieldBelowStatusBar(page);
});

test("felt med fokus dekkes ikke av statuslinjen når varselet om lagring vises", async ({
  page,
  context,
}) => {
  // Lite plass gjør linjen høyere (samme oppsett som prøve C)
  await setStorageOverride(context, { estimate: { usage: 1948 * MB, quota: 2048 * MB } });
  await openTrialForm(page);
  await expect(stickyLine(page).getByTestId("storage-low-warning")).toHaveCount(1);
  await expect(storageWarning(page)).toBeVisible();
  await expectFocusedFieldBelowStatusBar(page);
});

test("Synkløsning har en tom statusregion når ingenting venter", async ({ page }) => {
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  const picker = group(page, "Synkløsning");
  await expect(picker).toBeVisible();
  // Synkstatusen er klar når de andre kandidatene kan velges
  for (const name of ["ElectricSQL", "Egenbygd"]) {
    await expect(picker.getByRole("button", { name, exact: true })).toBeEnabled({
      timeout: 20_000,
    });
  }
  const region = picker.getByRole("status");
  await expect(region).toHaveCount(1);
  await expect(region).toHaveText("");
  const box = await region.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBe(0);
  const margin = await region.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  });
  expect(margin, "tom region tar ingen marg").toBe(0);
});
