import { expect, test } from "@playwright/test";

/*
 * Testplan docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, avsnitt 6 (P1–P2). Ingen
 * skjerm; kjøres i begge prosjektene (PC og iPad-størrelse) fordi den er billig og viser at det
 * bygde programmet oppfører seg som rutetestene. e2e-miljøet setter ikke AUTH_CLEANUP_SECRET
 * (playwright.config.ts), så endepunktet er av.
 *
 * Støtter hovedmål: de ansatte (endepunktet røpes ikke og kan ikke brukes uten driftshemmeligheten).
 */

const ENDPOINT = "/api/intern/rydd-innloggingsdata";

test("P1 cleanup endpoint is hidden without secret", async ({ request }) => {
  const withoutHeader = await request.post(ENDPOINT);
  expect(withoutHeader.status()).toBe(404);
  expect(withoutHeader.headers()["cache-control"] ?? "").toContain("no-store");

  // Med en oppdiktet hemmelighet: samme svar, så endepunktet ikke røpes
  const withHeader = await request.post(ENDPOINT, {
    headers: { authorization: "Bearer oppdiktet-driftshemmelighet-for-e2e-0123456789" },
    data: { now: "2100-01-01", retentionMs: 0 },
  });
  expect(withHeader.status()).toBe(404);
  expect(withHeader.headers()["cache-control"] ?? "").toContain("no-store");
  expect(await withHeader.text()).toBe(await withoutHeader.text());
});

test("P2 GET is rejected", async ({ request }) => {
  const response = await request.get(ENDPOINT);
  expect([404, 405]).toContain(response.status());
  expect(response.status()).not.toBe(200);
});
