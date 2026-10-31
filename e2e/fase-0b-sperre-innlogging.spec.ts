import { expect, test } from "@playwright/test";
import { uniqueSuffix } from "./helpers";

// Sperre etter mange feil ved innlogging (docs/funksjoner/fase0b-sperre-innlogging-testplan.md
// avsnitt 4). Kjører i pc og ipad. Støtter færre reklamasjoner (ingen kan gjette seg inn og
// endre rapporter i en takstmanns navn) og tid (takstmannen ser nøyaktig når han kan prøve igjen).
//
// Oppdiktet, ukjent adresse som er unik per prosjekt og kjøring (aldri ADMIN_EMAIL), så sperren
// ikke rører de andre testene. Bare utviklings-postkassen brukes (DEV_MAILBOX=1 i webServer).

test("sperre etter 5 feil koder viser når man kan prøve igjen", async ({ page }) => {
  const email = `sperre.${uniqueSuffix()}@eksempel.no`;

  await page.goto("/logg-inn");
  await page.getByLabel("E-postadresse").fill(email);
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await expect(page.getByLabel("Kode fra e-posten")).toBeVisible();

  // Skjemaets melding (Next har også en tom role="alert" for sidebytter)
  const alert = page.locator("form").getByRole("alert");
  const logInButton = page.getByRole("button", { name: "Logg inn" });

  /** Skriver feil kode, trykker «Logg inn» og venter på svaret fra serveren. */
  async function submitWrongCode() {
    await page.getByLabel("Kode fra e-posten").fill("000000");
    const response = page.waitForResponse((r) => r.url().includes("/api/auth/sign-in/email-otp"));
    await logInButton.click();
    return (await response).status();
  }

  // 5 feil koder: hver gang Better Auths vanlige svar, også den 5. (presisering 3)
  for (let attempt = 1; attempt <= 5; attempt++) {
    expect(await submitWrongCode()).not.toBe(429);
    await expect(alert).toHaveText(/^Koden (stemmer ikke|er ikke lenger gyldig)/);
    await expect(logInButton).toBeEnabled();
  }

  // 6. forsøk: sperren slår inn, med klokkeslett
  expect(await submitWrongCode()).toBe(429);
  await expect(alert).toHaveText(/^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/);
  await expect(alert).toBeInViewport();
  await expect(page.getByText("Vent ett minutt")).toHaveCount(0);
});
