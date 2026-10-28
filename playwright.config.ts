import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lar flere arbeidskopier kjøre e2e samtidig uten å kollidere
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

/**
 * Ende-til-ende-tester. Kjører mot en bygget app og databasen i DATABASE_URL
 * (migrert og seedet med `pnpm db:migrate && pnpm db:seed`).
 *
 * To nettlesere: PC og iPad Pro (befaringen skjer på iPad, docs/08-designprinsipper.md).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Én om gangen: testene deler innlogging, og en ny kode gjør den forrige ugyldig.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "nb-NO",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "pc", use: { ...devices["Desktop Chrome"] } },
    {
      name: "ipad",
      // iPad Pro 11" liggende, med Chromium (Safari testes for hånd på ekte iPad)
      use: { ...devices["Desktop Chrome"], viewport: { width: 1194, height: 834 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `${baseURL}/api/helse`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      BETTER_AUTH_URL: baseURL,
      DEV_MAILBOX: "1",
      // Prøve uten nett (fase 1). Ingen synktjeneste i e2e; den lokale databasen virker uten.
      POWERSYNC_URL: "http://localhost:8080",
      POWERSYNC_JWT_SECRET: "e2e-synknokkel-bare-for-automatiske-tester-0123456789",
      TRIAL_UPLOAD_DIR: "var/uploads/trial",
      // Testkroken window.__offlineTrial. Aldri i .env.example.
      NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS: "1",
    },
  },
});
