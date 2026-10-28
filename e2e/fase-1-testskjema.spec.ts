import { expect, test, type Page } from "@playwright/test";
import { brand } from "../src/shared/config/brand";
import { listTrialFields, trialForm } from "../src/modules/offline-trial/trial-form";
import { logIn } from "./helpers";

/*
 * Fase 1, oppgave 3: testskjemaet for prøven uten nett og appen på hjemskjermen.
 * Testplan: docs/funksjoner/fase1-testskjema-testplan.md avsnitt 6. Kjører i både pc og ipad.
 * Ingen test uten nett her (oppgave 4 og 5).
 */

const FORM_URL = "/prove/testskjema";
const TEST_IMAGE = "e2e/fixtures/test-image.png";
const fields = listTrialFields(trialForm);

async function openTrialForm(page: Page) {
  await logIn(page);
  await page.goto(FORM_URL);
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
}

function counter(page: Page) {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

function group(page: Page, name: string) {
  return page.getByRole("group", { name, exact: true });
}

test("uinnlogget sendes til innlogging fra /prove/testskjema", async ({ page }) => {
  await page.goto(FORM_URL);
  await expect(page).toHaveURL(/\/logg-inn$/);
});

test("admin finner lenken Prøve uten nett: testskjema på arbeidskøen og ser 0 av 40 felt utfylt", async ({
  page,
}) => {
  await logIn(page);
  await page.getByRole("link", { name: "Prøve uten nett: testskjema" }).click();
  await expect(page).toHaveURL(/\/prove\/testskjema$/);
  await expect(page.getByText("0 av 40 felt utfylt", { exact: true })).toBeVisible();
});

test("alle seks gruppene og alle 40 etiketter vises", async ({ page }) => {
  await openTrialForm(page);
  for (const g of trialForm.groups) {
    await expect(page.getByRole("heading", { name: g.title, exact: true })).toBeVisible();
  }
  for (const field of fields) {
    switch (field.type) {
      case "text":
      case "number":
      case "photo":
        await expect(page.getByLabel(field.label, { exact: true })).toBeVisible();
        break;
      case "tg":
      case "choice":
        await expect(group(page, field.label)).toBeVisible();
        break;
      case "table":
        await expect(page.getByText(field.label, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Legg til rad" })).toBeVisible();
        break;
    }
  }
});

test("ingen nedtrekksmenyer", async ({ page }) => {
  await openTrialForm(page);
  await expect(page.locator("select")).toHaveCount(0);
});

test("TG-knapp er minst 44 px høy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "Måles bare i iPad-størrelse");
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
  const numberFields = fields.filter((f) => f.type === "number");
  expect(numberFields).toHaveLength(9);
  for (const field of numberFields) {
    const input = page.getByLabel(field.label, { exact: true });
    await expect(input).toHaveAttribute("inputmode", "decimal");
    await expect(input).toHaveAttribute("type", "text");
    expect(await input.evaluate((el) => el.tagName)).toBe("INPUT");
  }
});

test("valg er ett trykk og bare ett valg er trykket", async ({ page }) => {
  await openTrialForm(page);
  const leakStopper = group(page, "Lekkasjestopper");
  const yes = leakStopper.getByRole("button", { name: "Ja", exact: true });
  const no = leakStopper.getByRole("button", { name: "Nei", exact: true });

  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(counter(page)).toHaveText("1 av 40 felt utfylt");

  await no.click();
  await expect(no).toHaveAttribute("aria-pressed", "true");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(counter(page)).toHaveText("1 av 40 felt utfylt");
});

test("TG er ett trykk og bare én TG er trykket", async ({ page }) => {
  await openTrialForm(page);
  const roof = group(page, "Tak – tilstandsgrad");
  const pressed = roof.locator('button[aria-pressed="true"]');

  await roof.getByRole("button", { name: "TG2", exact: true }).click();
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toHaveText("TG2");
  await expect(counter(page)).toHaveText("1 av 40 felt utfylt");

  await roof.getByRole("button", { name: "TG3", exact: true }).click();
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toHaveText("TG3");
  await expect(counter(page)).toHaveText("1 av 40 felt utfylt");
});

test("alle 40 felt fylles ut og telleren viser 40 av 40", async ({ page }) => {
  await openTrialForm(page);
  let filled = 0;

  for (const field of fields) {
    const container = page.locator(`[data-field="${field.key}"]`);
    switch (field.type) {
      case "text":
        await page.getByLabel(field.label, { exact: true }).fill("Oppdiktet tekst");
        break;
      case "tg":
        await group(page, field.label).getByRole("button", { name: "TG1", exact: true }).click();
        break;
      case "choice": {
        const first = field.options?.[0];
        if (!first) throw new Error(`Valgfeltet ${field.key} har ingen valg`);
        await group(page, field.label)
          .getByRole("button", { name: first.label, exact: true })
          .click();
        break;
      }
      case "number":
        await page.getByLabel(field.label, { exact: true }).fill("12,5");
        break;
      case "table": {
        const addRow = container.getByRole("button", { name: "Legg til rad" });
        await addRow.click();
        await addRow.click();
        await container.getByLabel("Sted, rad 1", { exact: true }).fill("Ved sluk");
        await container.getByLabel("Verdi, rad 1", { exact: true }).fill("12,5");
        await container.getByLabel("Kommentar, rad 1", { exact: true }).fill("Oppdiktet");
        await container.getByLabel("Sted, rad 2", { exact: true }).fill("Ved dør");
        await container.getByRole("button", { name: "Slett rad 2" }).click();
        await expect(container.getByLabel("Sted, rad 2", { exact: true })).toHaveCount(0);
        await expect(container.getByLabel("Sted, rad 1", { exact: true })).toHaveValue("Ved sluk");
        await expect(container.getByRole("button", { name: /^Slett rad \d+$/ })).toHaveCount(1);
        break;
      }
      case "photo":
        await page.getByLabel(field.label, { exact: true }).setInputFiles(TEST_IMAGE);
        await expect(container.getByText("1 bilde", { exact: true })).toBeVisible();
        await expect(container.getByText("test-image.png", { exact: true })).toBeVisible();
        break;
    }
    filled += 1;
    // Mellomsjekk etter hvert felt (også tabellen: to rader lagt til, én slettet, feltet teller)
    await expect(counter(page)).toHaveText(`${filled} av 40 felt utfylt`);
  }

  await expect(page.getByText("40 av 40 felt utfylt", { exact: true })).toBeVisible();
});

test("tall med bokstaver teller ikke", async ({ page }) => {
  await openTrialForm(page);
  const buildingYear = page.getByLabel("Byggeår", { exact: true });

  await buildingYear.fill("abc");
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");

  await buildingYear.fill("1985");
  await expect(counter(page)).toHaveText("1 av 40 felt utfylt");
});

test("manifest.webmanifest svarer 200 med standalone, start_url /arbeidskoe og navn fra brand", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/arbeidskoe");
  expect(manifest.name).toBe(brand.productName);
  expect(manifest.lang).toBe("nb");
  expect(manifest.icons[0].src).toContain("/apple-icon");
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
