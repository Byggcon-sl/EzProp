import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { trialForm } from "../src/modules/offline-trial/trial-form";
import { brand } from "../src/shared/config/brand";
import { ADMIN_EMAIL, createTrialForm, hookValue, logIn, useCandidate } from "./helpers";

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
  const link = page.getByRole("link", { name: "Prøve uten nett: testskjema" });
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
