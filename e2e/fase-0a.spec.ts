import { expect, test } from "@playwright/test";
import packageJson from "../package.json" with { type: "json" };
import { ADMIN_EMAIL, logIn } from "./helpers";

test("helsesjekken svarer med versjonen fra package.json uten innlogging", async ({ request }) => {
  const response = await request.get("/api/helse");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    versjon: packageJson.version,
    database: "ok",
  });
});

test("uinnlogget sendes til innlogging", async ({ page }) => {
  await page.goto("/arbeidskoe");
  await expect(page).toHaveURL(/\/logg-inn$/);
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
});

test("admin logger inn med kode på e-post og ser en tom arbeidskø, og kan logge ut", async ({
  page,
}) => {
  await logIn(page, ADMIN_EMAIL);
  await expect(page.getByRole("heading", { name: "Arbeidskø" })).toBeVisible();
  await expect(page.getByText("Ingenting venter på deg")).toBeVisible();
  await page.getByRole("button", { name: "Logg ut" }).click();
  await expect(page).toHaveURL(/\/logg-inn$/);
});

test("feil kode avvises", async ({ page }) => {
  await page.goto("/logg-inn");
  await page.getByLabel("E-postadresse").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await page.getByLabel("Kode fra e-posten").fill("000000");
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Koden" })).toContainText(
    "Koden stemmer ikke",
  );
});

test("ukjent e-post får ingen kode og ingen bekreftelse på at adressen finnes", async ({
  page,
}) => {
  await page.goto("/logg-inn");
  await page.getByLabel("E-postadresse").fill("ukjent@example.com");
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  // Samme skjerm som for kjente adresser (lekker ikke hvem som har tilgang)
  await expect(page.getByLabel("Kode fra e-posten")).toBeVisible();
  const mailbox = await page.context().newPage();
  await mailbox.goto("/dev/epost");
  await expect(
    mailbox.getByTestId("dev-email-to").filter({ hasText: "ukjent@example.com" }),
  ).toHaveCount(0);
});
