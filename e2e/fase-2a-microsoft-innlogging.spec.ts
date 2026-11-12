import { expect, test, type Request } from "@playwright/test";
import { ADMIN_EMAIL, logIn } from "./helpers";

// Logg inn med Microsoft 365 (docs/funksjoner/fase2a-microsoft-innlogging.md, ADR 0008).
// Støtter de ansatte: ett trykk inn med kontoen de bruker hver dag, med koden som reserve.
//
// E2e-serveren har et oppdiktet Microsoft-oppsett (playwright.config.ts). Nettleseren når aldri
// Microsoft: adressen avskjæres med page.route. Selve runden hos Microsoft (tilbakekall, tenant,
// ansattsjekk, tokens) prøves i src/core/auth/microsoft-callback.integration.test.ts (A222).
// At ingenting går tapt ved ny innlogging, prøves med koden i e2e/fase-1-prove-f-innlogging.spec.ts
// (samme sideskift og samme lokale lagring).

const TENANT_ID = "00000000-0000-4000-8000-0000000e2e01";
const CLIENT_ID = "00000000-0000-4000-8000-0000000e2e02";
const MICROSOFT_ROUTE = "https://login.microsoftonline.com/**";
const REJECTED =
  "Du har ikke tilgang med denne kontoen. Be leder eller admin legge deg inn som ansatt, eller logg inn med kode.";
const OFFLINE =
  "Du er uten nett. Innlogging trenger nett. Det du har lagret på iPaden, er trygt og synkes når du er inne igjen.";

const microsoftButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /Logg inn med Microsoft|Åpner Microsoft/ });
const codeInstead = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Logg inn med kode i stedet" });

test("Microsoft er hovedvalget, og koden er reserven som virker for admin", async ({ page }) => {
  await page.goto("/logg-inn");
  await expect(
    page.getByText("Bruk Byggcon-kontoen din i Microsoft.", { exact: false }),
  ).toBeVisible();
  await expect(microsoftButton(page)).toBeVisible();
  // Hovedvalg: minst 56 px høy og full bredde (docs/08-designprinsipper.md)
  const box = await microsoftButton(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  const codeBox = await codeInstead(page).boundingBox();
  expect(codeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByLabel("E-postadresse")).toHaveCount(0);

  await codeInstead(page).click();
  await expect(page.getByLabel("E-postadresse")).toBeVisible();

  // Kodeinnlogging er uendret (regel 11)
  await logIn(page, ADMIN_EMAIL);
  await expect(page.getByRole("heading", { name: "Arbeidskø" })).toBeVisible();
});

test("trykk sender til egen tenant hos Microsoft, og knappen er sperret etter første trykk", async ({
  page,
}) => {
  const microsoftRequests: Request[] = [];
  await page.route(MICROSOFT_ROUTE, async (route) => {
    microsoftRequests.push(route.request());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Falsk side</p>" });
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let socialCalls = 0;
  await page.route("**/api/auth/sign-in/social", async (route) => {
    socialCalls += 1;
    await gate;
    await route.continue();
  });

  await page.goto("/logg-inn?neste=%2Foppdrag");
  await microsoftButton(page).click();
  await expect(page.getByRole("button", { name: "Åpner Microsoft …" })).toBeDisabled();
  await microsoftButton(page)
    .click({ force: true })
    .catch(() => {});
  release();

  await expect.poll(() => microsoftRequests.length).toBe(1);
  expect(socialCalls).toBe(1);
  const url = new URL(microsoftRequests[0]!.url());
  expect(url.pathname).toBe(`/${TENANT_ID}/oauth2/v2.0/authorize`);
  expect(url.pathname).not.toMatch(/\/(common|organizations|consumers)\//);
  expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/microsoft$/);
  expect(url.searchParams.get("state")).toBeTruthy();
  // Bare openid, profile og email (A218)
  expect((url.searchParams.get("scope") ?? "").split(" ").sort()).toEqual([
    "email",
    "openid",
    "profile",
  ]);
  expect(url.searchParams.get("prompt")).toBeNull();
});

test("avvist innlogging gir samme norske melding uten feilkode, og kodeskjemaet er åpent", async ({
  page,
}) => {
  for (const error of ["signup_disabled", "account_not_linked", "unable_to_link_account"]) {
    await page.goto(`/logg-inn?error=${error}`);
    await expect(page.getByText(REJECTED)).toBeVisible();
    await expect(page.getByText(error)).toHaveCount(0);
    await expect(page.getByLabel("E-postadresse")).toBeVisible();
    await expect(codeInstead(page)).toHaveCount(0);
  }
});

test("teknisk feil hos Microsoft gir egen melding, ikke «ingen tilgang»", async ({ page }) => {
  await page.goto("/logg-inn?error=state_mismatch");
  await expect(
    page.getByText(
      "Innloggingen med Microsoft virket ikke denne gangen. Prøv igjen, eller logg inn med kode.",
    ),
  ).toBeVisible();
  await expect(page.getByText(REJECTED)).toHaveCount(0);
  await expect(page.getByLabel("E-postadresse")).toBeVisible();
});

test("uten nett er begge knappene sperret, og siden sier at innlogging trenger nett", async ({
  page,
  context,
}) => {
  await page.goto("/logg-inn");
  await expect(microsoftButton(page)).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText(OFFLINE)).toBeVisible();
  await expect(microsoftButton(page)).toBeDisabled();
  await expect(codeInstead(page)).toBeDisabled();
  await context.setOffline(false);
  await expect(microsoftButton(page)).toBeEnabled();
});
