import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  CHANGES_PATH,
  countRequests,
  createTrialForm,
  hookValue,
  indicator,
  isPullUrl,
  logIn,
  logInAsInspector,
  pendingChanges,
  recordPulls,
  savedAt,
  setSavedAt,
  syncMessage,
  syncNowButton,
  syncStatus,
  useCandidate as chooseCandidate,
  waitForTrialHook,
  type ElectricTrialHook,
  type TrialSyncCandidate,
} from "./helpers";

// Synkstatus som alltid vises (fase 1). Testplan: docs/funksjoner/fase1-synkstatus-testplan.md
// avsnitt 5. Støtter reklamasjoner (takstmannen ser alltid om noe bare ligger på iPaden, og «Alt er
// lagret» vises bare når serveren har bekreftet) og tid (ett trykk på «Synk nå» i stedet for å
// vente på neste forsøk).
//
// Hva hver kandidat kan nå i skyen (testplan avsnitt 0): bare egenbygd kan hente fra serveren i
// e2e, så bare egenbygd kan vise «Alt er lagret». PowerSync og ElectricSQL viser det motsatte:
// uten bekreftet henting står det aldri «Alt er lagret».
//
// Klokke: tidssonen er Europe/Oslo, og klokkeslett settes med page.clock.setFixedTime (aldri
// page.clock.install, som stopper tidtakerne synken trenger). 29.10.2026 er Oslo på UTC+1.
// Alle data er oppdiktet.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(DIR, "fixtures", "test-image.png");
const CANDIDATES = ["powersync", "electricsql", "custom"] as const;
const CHANGES_ROUTE = `**${CHANGES_PATH}`;
const PULL_ROUTE = isPullUrl;
const PHOTO_ROUTE = "**/api/prove/bilder/**";

const ALL_SAVED = "Alt er lagret";
const AWAITING_SERVER = "Venter på kontakt med serveren";
const NEVER_SAVED = "Ikke lagret på serveren ennå";
const OFFLINE_MESSAGE = "Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.";
const FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";

/** 14:32 i Oslo 29.10.2026. */
const AT_1432 = "2026-10-29T13:32:00.000Z";
/** 14:47 i Oslo 29.10.2026. */
const AT_1447 = "2026-10-29T13:47:00.000Z";
/** 15:10 i Oslo 29.10.2026 (senere samme dag). */
const AT_1510 = "2026-10-29T14:10:00.000Z";

test.use({ timezoneId: "Europe/Oslo" });

function ipadOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "ipad", "Kjøres bare i ipad (testplan 5.2)");
}

function counter(page: Page): Locator {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

function floorsInput(page: Page): Locator {
  return page.getByLabel("Antall etasjer", { exact: true });
}

/** Logger inn som admin med valgt kandidat og fast klokke. */
async function start(
  page: Page,
  context: BrowserContext,
  candidate: TrialSyncCandidate,
  at = AT_1432,
) {
  await chooseCandidate(context, candidate);
  await logIn(page, ADMIN_EMAIL);
  await page.clock.setFixedTime(new Date(at));
}

/** Går til listen «Testskjema» og venter på lageret. */
async function openList(page: Page, candidate: TrialSyncCandidate) {
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await waitForTrialHook(page);
  expect(await hookValue(page, "candidate")).toBe(candidate);
}

/** Lager et nytt skjema og venter på lageret. */
async function openNewForm(page: Page, candidate: TrialSyncCandidate): Promise<string> {
  const id = await createTrialForm(page);
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
  await waitForTrialHook(page);
  expect(await hookValue(page, "candidate")).toBe(candidate);
  return id;
}

async function fillFloors(page: Page, value = "3") {
  await floorsInput(page).fill(value);
  await expect(counter(page)).toHaveText(/^[1-9]\d* av 40 felt utfylt$/);
}

/** `store.status()` fra testkroken. */
async function storeStatus(page: Page) {
  await waitForTrialHook(page);
  return page.evaluate(async () => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    return hook.store.status();
  });
}

function pendingText(changes: number, photos: number): string {
  return `Venter: ${changes} ${changes === 1 ? "endring" : "endringer"}, ${photos} ${photos === 1 ? "bilde" : "bilder"}`;
}

/** Venter til køen er tom og serveren har bekreftet (bare egenbygd kan det i e2e). */
async function waitAllSaved(page: Page) {
  await expect
    .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
    .toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
}

/** Teller kall til `store.syncNow` på siden (samme objekt som skjermen bruker). */
async function countSyncNowCalls(page: Page) {
  await waitForTrialHook(page);
  await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: { store: Record<string, unknown> } })
      .__offlineTrial;
    const store = hook.store as { syncNow: () => Promise<unknown> };
    const original = store.syncNow.bind(store);
    (window as unknown as { __syncNowCalls: number }).__syncNowCalls = 0;
    store.syncNow = () => {
      (window as unknown as { __syncNowCalls: number }).__syncNowCalls += 1;
      return original();
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __syncNowCalls: number }).__syncNowCalls);
}

// --- 5.2 Visning ---

test.describe("visning", () => {
  test.use({ serviceWorkers: "block" });

  for (const candidate of CANDIDATES) {
    test(`synkstatusen vises på listen Testskjema med tilstand, Lagret kl. og Synk nå (${candidate})`, async ({
      page,
      context,
    }) => {
      await start(page, context, candidate);
      // Egenbygd kan hente i e2e; uten henting er enheten fortsatt «ny» når vi ser på den
      await page.route(PULL_ROUTE, (route) => route.abort());
      await openList(page, candidate);
      for (const where of ["listen", "skjemaet"]) {
        if (where === "skjemaet") await openNewForm(page, candidate);
        await expect(syncStatus(page), where).toBeVisible();
        await expect(indicator(page), where).toBeVisible();
        await expect(indicator(page), where).toHaveText(/\S/);
        await expect(savedAt(page), where).toHaveText(NEVER_SAVED);
        await expect(syncNowButton(page), where).toBeVisible();
        await expect(syncNowButton(page), where).toHaveText("Synk nå");
        await expect(syncNowButton(page), where).toBeEnabled();
      }
    });

    test(`synkstatusen står i synsfeltet etter rulling til bunnen av testskjemaet (${candidate})`, async ({
      page,
      context,
    }) => {
      await start(page, context, candidate);
      await createTrialForm(page);
      await waitForTrialHook(page);
      await page.locator("[data-field]").last().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(syncStatus(page)).toBeInViewport();
      await expect(syncNowButton(page)).toBeInViewport();
      await expect(savedAt(page)).toBeInViewport();
    });

    // Akseptkriterium
    test(`antallene stemmer med store.status() (${candidate})`, async ({ page, context }) => {
      await start(page, context, candidate);
      await openList(page, candidate);
      await openNewForm(page, candidate);
      // Uten nett viser linjen «Uten nett»; antallene leses når nettet er tilbake, men sending og
      // bildeopplasting er stoppet, så alt fortsatt venter.
      await page.route(CHANGES_ROUTE, (route) => route.abort());
      await page.route(PHOTO_ROUTE, (route) => route.abort());
      try {
        await context.setOffline(true);
        await expect(indicator(page)).toHaveText("Uten nett");
        await floorsInput(page).fill("3");
        await page.getByLabel("Byggeår", { exact: true }).fill("1985");
        await page.getByLabel("Tak – beskrivelse", { exact: true }).fill("Oppdiktet tekst");
        await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
        await expect(counter(page)).toHaveText("4 av 40 felt utfylt");
        await expect(indicator(page)).toHaveText("Uten nett");
      } finally {
        await context.setOffline(false);
      }
      await expect
        .poll(
          async () => {
            const status = await storeStatus(page);
            const text = (await indicator(page).innerText()).trim();
            return status.pendingChanges > 0 &&
              status.pendingPhotos === 1 &&
              text === pendingText(status.pendingChanges, status.pendingPhotos)
              ? "lik"
              : `${text} / ${JSON.stringify(status)}`;
          },
          { timeout: 15_000 },
        )
        .toBe("lik");
    });
  }

  test("Uten nett vises med tekst, ikke bare farge", async ({ page, context }) => {
    await start(page, context, "custom");
    await openList(page, "custom");
    try {
      await context.setOffline(true);
      await expect(indicator(page)).toHaveText("Uten nett");
      await expect(indicator(page)).not.toHaveText(ALL_SAVED);
      await expect(syncStatus(page)).toContainText("Uten nett");
      await expect(syncStatus(page)).not.toContainText(ALL_SAVED);
    } finally {
      await context.setOffline(false);
    }
  });

  test("gammel måleindikator finnes ikke lenger", async ({ page, context }) => {
    await start(page, context, "custom");
    await openList(page, "custom");
    await expect(syncStatus(page)).toBeVisible();
    await expect(page.getByTestId("sync-indicator")).toHaveCount(0);
    await openNewForm(page, "custom");
    await expect(syncStatus(page)).toBeVisible();
    await expect(page.getByTestId("sync-indicator")).toHaveCount(0);
  });

  // Akseptkriterium
  test("Synk nå er minst 56 høy på iPad", async ({ page, context }, testInfo) => {
    ipadOnly(testInfo);
    await start(page, context, "custom");
    await openList(page, "custom");
    for (const where of ["listen", "skjemaet"]) {
      if (where === "skjemaet") await openNewForm(page, "custom");
      await expect(syncNowButton(page)).toBeVisible();
      const box = await syncNowButton(page).boundingBox();
      expect(box, where).not.toBeNull();
      expect(box!.height, where).toBeGreaterThanOrEqual(56);
      expect(box!.width, where).toBeGreaterThanOrEqual(56);
    }
  });
});

// --- 5.3 «Synk nå» og «Lagret kl.» ---

test.describe("Synk nå", () => {
  // page.route og page.on("request") ser ikke forespørsler som går via service worker
  test.use({ serviceWorkers: "block" });

  for (const candidate of CANDIDATES) {
    // Akseptkriterium (per kandidat)
    test(`Synk nå sender køen med en gang etter feil, uten å vente på neste forsøk (${candidate})`, async ({
      page,
      context,
    }, testInfo) => {
      await start(page, context, candidate);
      // Sendingen feiler helt til testen selv slipper den. Da kan ingen POST gå igjennom før
      // trykket, uansett hvem som sender (PowerSync-SDK-en kaller også uploadData selv).
      let fail = true;
      let failures = 0;
      await page.route(CHANGES_ROUTE, (route) => {
        if (route.request().method() !== "POST" || !fail) return route.fallback();
        failures += 1;
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      });
      const posts = countRequests(page, CHANGES_ROUTE);
      await openList(page, candidate);
      await openNewForm(page, candidate);
      await fillFloors(page);

      if (candidate === "powersync") {
        // Uten PowerSync-tjenesten er det ikke sikkert SDK-en sender av seg selv; trykk til det
        // har kommet minst to feil (krav K3: syncNow kaller opplastingen selv).
        testInfo.annotations.push({
          type: "vei",
          description: "feil fra trykk (ingen tjeneste)",
        });
        for (let i = 0; i < 2 && failures < 2; i++) {
          await syncNowButton(page).click();
          await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
          await expect.poll(() => failures, { timeout: 20_000 }).toBeGreaterThanOrEqual(i + 1);
        }
      }
      // Minst to feil: neste automatiske forsøk er da minst 10 s unna, godt over grensen på 3 s
      await expect.poll(() => failures, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      expect(await pendingChanges(page)).toBeGreaterThan(0);

      const before = posts.count();
      fail = false;
      const pressedAt = Date.now();
      await syncNowButton(page).click();
      await expect
        .poll(() => posts.count(), { timeout: 3_000, message: "ny POST innen 3 s" })
        .toBeGreaterThan(before);
      expect(Date.now() - pressedAt).toBeLessThan(5_000);
      await expect
        .poll(() => pendingChanges(page), { timeout: 15_000, message: "køen tømmes" })
        .toBe(0);
    });

    // Akseptkriterium (per kandidat)
    test(`Synk nå som feiler gir Synk nå igjen, feilbeskjed og uendret Lagret kl. (${candidate})`, async ({
      page,
      context,
    }) => {
      await setSavedAt(context, candidate, AT_1432);
      await start(page, context, candidate, AT_1510);
      // Serveren svarer 500 på sending (litt forsinket, så «Synker …» kan ses), og egenbygd får
      // ikke hente, så ingenting kan bli bekreftet i denne testen
      await page.route(CHANGES_ROUTE, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      });
      await page.route(PULL_ROUTE, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
      );
      await openList(page, candidate);
      await openNewForm(page, candidate);
      await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
      await fillFloors(page);

      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await syncNowButton(page).click();
      await expect(syncNowButton(page)).toHaveText("Synker …");
      await expect(syncNowButton(page)).toBeDisabled();
      await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
      await expect(syncNowButton(page)).toBeEnabled();
      await expect(syncMessage(page)).toHaveText(FAILED_MESSAGE);
      await expect(syncMessage(page)).toHaveAttribute("aria-live", "polite");
      await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
      await expect(indicator(page)).not.toHaveText(ALL_SAVED);
      expect(errors).toEqual([]);
    });

    // Akseptkriterium
    test(`Synk nå uten nett gir beskjeden og sender ingenting (${candidate})`, async ({
      page,
      context,
    }) => {
      await start(page, context, candidate);
      await openList(page, candidate);
      await openNewForm(page, candidate);
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      const trial = countRequests(page, "**/api/prove/**");
      try {
        await context.setOffline(true);
        await expect(indicator(page)).toHaveText("Uten nett");
        await fillFloors(page);
        const before = trial.count();
        await syncNowButton(page).click();
        await expect(syncMessage(page)).toHaveText(OFFLINE_MESSAGE);
        await expect(syncMessage(page)).toHaveAttribute("aria-live", "polite");
        await expect(syncNowButton(page)).toHaveText("Synk nå");
        await expect(syncNowButton(page)).toBeEnabled();
        await page.waitForTimeout(5_000);
        expect(
          trial.requests.slice(before).map((entry) => entry.url.pathname),
          "ingen forespørsler til /api/prove/ etter trykket",
        ).toEqual([]);
        await expect(indicator(page)).toHaveText("Uten nett");
      } finally {
        await context.setOffline(false);
      }
      expect(errors).toEqual([]);
    });

    test(`to raske trykk gir én runde (${candidate})`, async ({ page, context }, testInfo) => {
      await start(page, context, candidate);
      // Først feiler sendingen, så noe ligger i køen og venter på neste forsøk
      let fail = true;
      let failures = 0;
      await page.route(CHANGES_ROUTE, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        if (fail) {
          failures += 1;
          return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        }
        // Treg server: runden varer over 1 s, så det andre trykket kommer mens den pågår
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return route.fallback();
      });
      await openList(page, candidate);
      await openNewForm(page, candidate);
      await fillFloors(page);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThan(0);
      if (candidate !== "powersync") {
        // To feil: neste automatiske forsøk er minst 10 s unna og blandes ikke med trykkene
        await expect.poll(() => failures, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      }
      const syncNowCalls = await countSyncNowCalls(page);
      const posts = countRequests(page, CHANGES_ROUTE);
      fail = false;

      await syncNowButton(page).dblclick();
      await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
      // Ett kall til store.syncNow fra de to trykkene
      expect(await syncNowCalls()).toBe(1);
      if (candidate === "powersync") {
        // PowerSync sender én transaksjon per POST; én runde kan gi flere POST-er
        testInfo.annotations.push({ type: "vei", description: "PowerSync: telt kall til syncNow" });
        expect(posts.count()).toBeGreaterThanOrEqual(1);
      } else {
        expect(posts.count()).toBe(1);
      }
    });
  }

  // Akseptkriterium «Wi-Fi uten internett»
  for (const candidate of ["powersync", "electricsql"] as const) {
    test(`uten bekreftet henting står det aldri Alt er lagret (${candidate})`, async ({
      page,
      context,
    }) => {
      await start(page, context, candidate);
      await openList(page, candidate);
      await openNewForm(page, candidate);
      await fillFloors(page);
      await syncNowButton(page).click();
      await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
      await expect
        .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
        .toBe(0);
      // Køen er tom, men serveren har ikke bekreftet henting: aldri «Alt er lagret»
      const seen = new Set<string>();
      for (let i = 0; i < 10; i++) {
        seen.add((await indicator(page).innerText()).trim());
        await page.waitForTimeout(500);
      }
      expect([...seen].filter((text) => text === ALL_SAVED)).toEqual([]);
      await expect(indicator(page)).toHaveText(AWAITING_SERVER);
      await expect(savedAt(page)).toHaveText(NEVER_SAVED);
    });
  }

  test("Wi-Fi uten internett gir aldri Alt er lagret", async ({ page, context }) => {
    await start(page, context, "custom");
    // Nettleseren mener den har nett, men ingen kall kommer fram
    await page.route("**/api/prove/**", (route) => route.abort());
    await openList(page, "custom");
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add((await indicator(page).innerText()).trim());
      await page.waitForTimeout(500);
    }
    expect([...seen].filter((text) => text === ALL_SAVED)).toEqual([]);
    expect((await storeStatus(page)).pendingChanges).toBe(0);
    await expect(indicator(page)).toHaveText(AWAITING_SERVER);
    await expect(savedAt(page)).toHaveText(NEVER_SAVED);
  });

  test("Lagret kl. vises etter at alt er sendt", async ({ page, context }) => {
    await start(page, context, "custom", AT_1432);
    await openList(page, "custom");
    await openNewForm(page, "custom");
    await fillFloors(page);
    await waitAllSaved(page);
    await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
  });

  test("Lagret på en annen dag viser dato", async ({ page, context }) => {
    await setSavedAt(context, "custom", "2026-10-28T13:32:00.000Z");
    await start(page, context, "custom", "2026-10-29T08:00:00.000Z");
    // Ingen henting: «Lagret kl.» kan ikke bli flyttet til i dag før nettet går
    await page.route(PULL_ROUTE, (route) => route.abort());
    await openList(page, "custom");
    try {
      await context.setOffline(true);
      await expect(indicator(page)).toHaveText("Uten nett");
      await expect(savedAt(page)).toHaveText("Lagret 28.10. kl. 14:32");
    } finally {
      await context.setOffline(false);
    }
  });

  // Akseptkriterium
  test("trykk når alt er lagret gir nytt klokkeslett", async ({ page, context }) => {
    await start(page, context, "custom", AT_1432);
    await openList(page, "custom");
    await openNewForm(page, "custom");
    await fillFloors(page);
    await waitAllSaved(page);
    await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");

    const pulls = recordPulls(page);
    await page.clock.setFixedTime(new Date(AT_1447));
    const pressedAt = Date.now();
    await syncNowButton(page).click();
    // Henting med en gang (takten ellers er 5 s)
    await expect
      .poll(() => pulls.since(pressedAt - 1).length, { timeout: 1_500, message: "henting nå" })
      .toBeGreaterThan(0);
    await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
    await expect(indicator(page)).toHaveText(ALL_SAVED);
    await expect(savedAt(page)).toHaveText("Lagret kl. 14:47");
    await expect(syncMessage(page)).toHaveText("");
  });

  // Akseptkriterium
  test("bytte av organisasjon tømmer Lagret kl. for alle tre kandidatene", async ({
    page,
    context,
  }) => {
    for (const candidate of CANDIDATES) await setSavedAt(context, candidate, AT_1432);
    await start(page, context, "custom", AT_1510);
    // Ingen henting: etter byttet skal enheten være «ny», ikke få et nytt tidspunkt
    await page.route(PULL_ROUTE, (route) => route.abort());
    await openList(page, "custom");
    await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
    const keysBefore = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("trial_saved_at_")),
    );
    expect(keysBefore.sort()).toEqual([
      "trial_saved_at_custom",
      "trial_saved_at_electricsql",
      "trial_saved_at_powersync",
    ]);

    await page.evaluate(async (organizationId) => {
      const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
      await hook.simulateOrganizationChange(organizationId);
    }, crypto.randomUUID());
    await page.reload();
    await waitForTrialHook(page);
    await expect(savedAt(page)).toHaveText(NEVER_SAVED);
    const keysAfter = await page.evaluate(() =>
      ["powersync", "electricsql", "custom"].filter(
        (candidate) => localStorage.getItem(`trial_saved_at_${candidate}`) !== null,
      ),
    );
    expect(keysAfter).toEqual([]);
  });
});

// Utenfor «block»: lasting uten nett trenger service worker, som i virkeligheten
test.describe("Lagret kl. etter ny lasting uten nett", () => {
  for (const candidate of CANDIDATES) {
    // Akseptkriterium
    test(`Lagret kl. står der etter ny lasting uten nett (${candidate})`, async ({
      page,
      context,
    }, testInfo) => {
      if (candidate === "custom") {
        await start(page, context, candidate, AT_1432);
        await openList(page, candidate);
        await openNewForm(page, candidate);
        await fillFloors(page);
        await waitAllSaved(page);
      } else {
        await setSavedAt(context, candidate, AT_1432);
        await start(page, context, candidate, AT_1510);
        await openList(page, candidate);
      }
      await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await waitForTrialHook(page);

      let offlineReloadWorked = false;
      try {
        await context.setOffline(true);
        try {
          await page.reload();
          await expect(syncStatus(page)).toBeVisible();
          offlineReloadWorked = true;
          testInfo.annotations.push({ type: "vei", description: "reload uten nett" });
        } catch (error) {
          testInfo.annotations.push({
            type: "vei",
            description: `reserve: api stoppet og setOffline etter lasting (reload uten nett feilet: ${String(error).slice(0, 120)})`,
          });
        }
        if (!offlineReloadWorked) {
          await context.setOffline(false);
          await page.route("**/api/**", (route) => route.abort());
          await page.reload();
          await context.setOffline(true);
        }
        await expect(indicator(page)).toHaveText("Uten nett");
        await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
      } finally {
        await context.setOffline(false);
      }
    });
  }
});

// --- 5.4 Roller ---

test.describe("roller", () => {
  test.use({ serviceWorkers: "block" });

  // Akseptkriterium
  test("takstmann ser synkstatusen og bruker Synk nå (custom)", async ({ page, context }) => {
    await chooseCandidate(context, "custom");
    await logInAsInspector(page);
    await page.clock.setFixedTime(new Date(AT_1432));
    await expectSyncNowWorks(page);
  });

  test("admin ser synkstatusen og bruker Synk nå (custom)", async ({ page, context }) => {
    await chooseCandidate(context, "custom");
    await logIn(page, ADMIN_EMAIL);
    await page.clock.setFixedTime(new Date(AT_1432));
    await expectSyncNowWorks(page);
  });
});

/** Fyller ut et felt, trykker «Synk nå» og venter på 200 fra skriveruten og «Alt er lagret». */
async function expectSyncNowWorks(page: Page) {
  const posts = countRequests(page, CHANGES_ROUTE);
  await openList(page, "custom");
  await expect(syncStatus(page)).toBeVisible();
  await openNewForm(page, "custom");
  await fillFloors(page);
  await syncNowButton(page).click();
  await expect(syncNowButton(page)).toHaveText("Synk nå", { timeout: 20_000 });
  await expect
    .poll(() => posts.requests.some((entry) => entry.status === 200), { timeout: 20_000 })
    .toBe(true);
  expect(posts.requests.filter((entry) => entry.status === 403)).toEqual([]);
  await waitAllSaved(page);
  await expect(savedAt(page)).toHaveText("Lagret kl. 14:32");
  await expect(syncMessage(page)).toHaveText("");
}
