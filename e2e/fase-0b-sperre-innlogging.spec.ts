import { expect, test } from "@playwright/test";
import { uniqueSuffix } from "./helpers";

/*
 * Sperre etter mange feil ved innlogging (docs/funksjoner/fase0b-sperre-innlogging-testplan.md
 * avsnitt 4). Kjører i pc og ipad. Oppdiktet, ukjent adresse som er unik per prosjekt og kjøring,
 * aldri ADMIN_EMAIL. Bare utviklings-postkassen brukes (DEV_MAILBOX=1, rateLimit er av).
 * Støtter hovedmål reklamasjoner: ingen kan gjette seg til koden og endre rapporter i en
 * takstmanns navn. Hele pakken grønn etterpå viser at riktig kode nullstiller (logIn virker).
 */

const SIGN_IN_PATH = "/api/auth/sign-in/email-otp";

test("sperre etter 5 feil koder viser når man kan prøve igjen", async ({ page }, testInfo) => {
  const email = `sperre.${testInfo.project.name}.${uniqueSuffix()}@eksempel.no`;

  await page.goto("/logg-inn");
  await page.getByLabel("E-postadresse").fill(email);
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await expect(page.getByLabel("Kode fra e-posten")).toBeVisible();

  const codeField = page.getByLabel("Kode fra e-posten");
  const submit = page.getByRole("button", { name: "Logg inn", exact: true });
  // Meldingen i skjemaet (Next har også en tom «alert» for sidebytter)
  const alert = page.locator("form").getByRole("alert");

  // Presisering 3: de 5 første feilene får Better Auths vanlige svar, ikke 429
  for (let i = 0; i < 5; i += 1) {
    await codeField.fill("000000");
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(SIGN_IN_PATH)),
      submit.click(),
    ]);
    expect(response.status()).not.toBe(429);
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("For mange");
    await expect(submit).toBeEnabled();
  }

  // 6. forsøk: sperret, med klokkeslett
  await codeField.fill("000000");
  const [blocked] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(SIGN_IN_PATH)),
    submit.click(),
  ]);
  expect(blocked.status()).toBe(429);
  await expect(alert).toHaveText(/^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/);
  await expect(alert).toBeInViewport();
  await expect(page.getByText("Vent ett minutt")).toHaveCount(0);
});
