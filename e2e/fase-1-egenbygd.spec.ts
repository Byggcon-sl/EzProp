import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  ADMIN_EMAIL,
  createTrialForm,
  hookValue,
  indicator,
  isPullUrl,
  localPhotoFileCount,
  logIn,
  openSecondDevice,
  pendingChanges,
  PULL_PATH,
  readRowsViaHook,
  recordPulls,
  type TrialHook,
  type LocalRow,
} from "./helpers";
import { PULL_BACKOFF_MAX_MS } from "../src/modules/offline-trial/sync/custom/types";

// Tredje kandidat for drift uten nett: egenbygd (lokal database og endringskø) koblet til
// testskjemaet (fase 1, oppgave 6). Testplan: docs/funksjoner/fase1-kandidat-egenbygd-testplan.md
// avsnitt 6.2. Kandidaten trenger ingen ekstra tjeneste: skriveruten og hente-ruten finnes i e2e,
// så lesing fra serveren og to enheter testes ende til ende. E2e-databasen tømmes aldri, så
// testene regner aldri med et bestemt antall rader på serveren. Alle data er oppdiktet.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(DIR, "fixtures", "test-image.png");
const PHOTO_ROUTE = "**/api/prove/bilder/**";
const CHANGES_ROUTE = "**/api/prove/synk/endringer";
const ANY_STATUS =
  /^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret|Venter på kontakt med serveren)$/;
const NO_PHOTOS_WAITING =
  /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret$|^Venter på kontakt med serveren$/;
const ALL_SAVED = "Alt er lagret";
/** Køen er tom, men serveren har ikke bekreftet en henting ennå. */
const AWAITING_SERVER = "Venter på kontakt med serveren";
/** Takt 5 s pluss sending og slingringsmonn (testplan 6.2, «To enheter»). */
const OTHER_DEVICE_TIMEOUT = 20_000;

function pcOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "pc", "Kjøres bare i pc (testplan 6.2)");
}

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

function foreignWarning(page: Page, key: string): Locator {
  return fieldContainer(page, key).getByRole("status").filter({ hasText: "Endret av en annen" });
}

function floorsInput(page: Page): Locator {
  return page.getByLabel("Antall etasjer", { exact: true });
}

function roofText(page: Page): Locator {
  return page.getByLabel("Tak – beskrivelse", { exact: true });
}

function roofTg(page: Page, tg: "TG2" | "TG3"): Locator {
  return group(page, "Tak – tilstandsgrad").getByRole("button", { name: tg, exact: true });
}

function randomUuid(): string {
  return crypto.randomUUID();
}

function formLink(page: Page, formId: string): Locator {
  return page.locator(`a[href$="/prove/testskjema/${formId}"]`);
}

/** Logger inn, lager et nytt skjema og returnerer id-en. */
async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expectCount(page, 0);
  return id;
}

async function answerFor(page: Page, formId: string, fieldKey: string) {
  return (await readRowsViaHook(page, "trial_answers", formId)).find(
    (row) => row.field_key === fieldKey,
  );
}

/** Venter til køen er tom og «Alt er lagret» vises. `timeout` gjelder hvert av de to stegene. */
async function waitAllSaved(page: Page, timeout = 20_000) {
  await expect.poll(() => pendingChanges(page), { timeout, message: "køen tømmes" }).toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout });
}

/**
 * Frist når køen og leseren kan ha en hel ventetid foran seg etter mange 500-feil (begge har tak
 * på 60 s), eller en første henting i mange sider når databasen er stor (sent i en full kjøring).
 */
const FULL_READER_WAIT_MS = PULL_BACKOFF_MAX_MS + 10_000;

/** Åpner skjemaet fra listen på en enhet som får det via hente-ruten. */
async function openFromList(page: Page, formId: string) {
  await page.goto("/prove/testskjema");
  await expect(formLink(page, formId)).toBeVisible({ timeout: OTHER_DEVICE_TIMEOUT });
  await formLink(page, formId).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expect(counter(page)).toBeVisible();
}

/** Kontekstvalgene fra prosjektet (pc eller ipad) for enhet nummer to. */
function deviceOptions(fixtures: {
  baseURL: string | undefined;
  viewport: { width: number; height: number } | null;
  hasTouch: boolean;
}): BrowserContextOptions {
  return {
    baseURL: fixtures.baseURL,
    viewport: fixtures.viewport,
    hasTouch: fixtures.hasTouch,
    serviceWorkers: "block",
  };
}

interface PostedOperation {
  op: string;
  table: string;
  id: string;
  data: Record<string, unknown>;
}

function operationsOf(postData: string | null): PostedOperation[] {
  if (!postData) return [];
  try {
    const body = JSON.parse(postData) as { operations?: PostedOperation[] };
    return Array.isArray(body.operations) ? body.operations : [];
  } catch {
    return [];
  }
}

/** Feilsvaret har en norsk melding i `{ feil }`. */
async function expectErrorMessage(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as { feil?: unknown };
  expect(typeof body.feil).toBe("string");
  expect(String(body.feil).length).toBeGreaterThan(0);
  return body;
}

function expectNoStore(headers: Record<string, string>) {
  expect(headers["cache-control"]).toBe("private, no-store");
}

// ---------------------------------------------------------------------------------------------
// Lagring og kø
// ---------------------------------------------------------------------------------------------

test("testkroken og lageret er klare", async ({ page }) => {
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  const forms = await readRowsViaHook(page, "trial_forms");
  expect(Array.isArray(forms)).toBe(true);
  const hasDb = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
    return "db" in hook && hook.db !== undefined;
  });
  expect(hasDb).toBe(false);
});

test("listen viser nye testskjemaer med navn og laget når, og åpner dem (Egenbygd)", async ({
  page,
}) => {
  const first = await openNewForm(page);
  const second = await createTrialForm(page);
  expect(first).not.toBe(second);

  await page.goto("/prove/testskjema");
  for (const id of [first, second]) {
    const link = formLink(page, id);
    await expect(link).toBeVisible();
    const name = (await link.innerText()).trim();
    expect(name).toMatch(/^Testskjema \d+$/);
    const rest = (await link.locator("xpath=..").innerText()).replace(name, "").trim();
    expect(rest, `tidsangivelse for ${name}`).not.toBe("");
  }

  await formLink(page, first).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${first}$`));
  await expectCount(page, 0);
});

test("svarene og et bilde overlever at siden lastes på nytt (Egenbygd)", async ({ page }) => {
  const formId = await openNewForm(page);

  await roofTg(page, "TG2").click();
  await floorsInput(page).fill("7");
  await roofText(page).fill("Oppdiktet tekst");
  await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
  await roofText(page).blur();
  await expectCount(page, 4);

  await expect
    .poll(async () => {
      const rows = await readRowsViaHook(page, "trial_answers", formId);
      const byKey = Object.fromEntries(rows.map((row) => [row.field_key, row]));
      const photos = await readRowsViaHook(page, "trial_photos", formId);
      return {
        roof_tg: byKey.roof_tg?.value,
        floors: byKey.floors?.value,
        roof_description: byKey.roof_description?.value,
        photos: photos.length,
      };
    })
    .toEqual({
      roof_tg: JSON.stringify("TG2"),
      floors: "7",
      roof_description: JSON.stringify("Oppdiktet tekst"),
      photos: 1,
    });

  await page.reload();
  await expectCount(page, 4);
  await expect(roofTg(page, "TG2")).toHaveAttribute("aria-pressed", "true");
  await expect(floorsInput(page)).toHaveValue("7");
  await expect(roofText(page)).toHaveValue("Oppdiktet tekst");
  await expect(
    fieldContainer(page, "cover_photo").getByText("1 bilde", { exact: true }),
  ).toBeVisible();
});

test("indikatoren viser Uten nett uten nett, og alt lagret med nett (Egenbygd)", async ({
  page,
  context,
}) => {
  await openNewForm(page);
  await expect(indicator(page)).toHaveText(ANY_STATUS);

  try {
    await context.setOffline(true);
    await expect(indicator(page)).toHaveText("Uten nett");
    await floorsInput(page).fill("3");
    await expectCount(page, 1);
    await expect(indicator(page)).toHaveText("Uten nett");
  } finally {
    await context.setOffline(false);
  }
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
});

test("skjemaet åpner fra hurtiglageret uten nett etter ett besøk (Egenbygd)", async ({
  page,
  context,
}, testInfo) => {
  const formId = await openNewForm(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expectCount(page, 0);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const scriptUrl = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("script[src]"))
        .map((el) => (el as HTMLScriptElement).src)
        .find((src) => src.includes("/_next/static/")) ?? null,
  );
  expect(scriptUrl).not.toBeNull();

  let offlineReloadWorked = false;
  try {
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
      await expect(counter(page)).toBeVisible();
      await expect(indicator(page)).toHaveText("Uten nett");
      // Nye svar kan skrives uten nett
      await floorsInput(page).fill("4");
      await expectCount(page, 1);
      offlineReloadWorked = true;
    } catch (error) {
      testInfo.annotations.push({
        type: "vei",
        description: `reserve: caches.match (reload uten nett feilet: ${String(error).slice(0, 120)})`,
      });
    }
  } finally {
    await context.setOffline(false);
  }

  if (offlineReloadWorked) {
    testInfo.annotations.push({ type: "vei", description: "reload uten nett" });
    return;
  }
  await page.goto(`/prove/testskjema/${formId}`);
  const cached = await page.evaluate(async (script) => {
    const scriptHit = await caches.match(script);
    const pageHit = await caches.match(location.pathname);
    return { script: Boolean(scriptHit), page: Boolean(pageHit) };
  }, scriptUrl!);
  expect(cached).toEqual({ script: true, page: true });
});

test("service worker rører ikke hente-ruten", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expectCount(page, 0);
  await page.evaluate(async (url) => {
    await fetch(url);
    await fetch("/api/helse");
  }, `${PULL_PATH}?organisasjon=${organizationId}`);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const urls = await page.evaluate(async () => {
    const all: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) all.push(new URL(request.url).pathname);
    }
    return all;
  });
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((url) => url.startsWith("/api/"))).toEqual([]);
  expect(urls.filter((url) => url.includes("synk/hent"))).toEqual([]);
});

test.describe("egenbygd uten service worker", () => {
  // page.route og page.on("request") ser ikke forespørsler som går via service worker
  test.use({ serviceWorkers: "block" });

  // Obligatorisk (tap av data)
  test("endringskøen overlever omlasting og tømmes bare etter 200 (Egenbygd)", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      const formId = await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(1_000);
        expect(await pendingChanges(page)).toBeGreaterThanOrEqual(2);
      }

      await page.reload();
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      await expect(floorsInput(page)).toHaveValue("7");
      expect((await answerFor(page, formId, "floors"))?.value).toBe("7");
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await waitAllSaved(page);
  });

  test("avbrutt sending beholder bunten (Egenbygd)", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await logIn(page, ADMIN_EMAIL);
    let attempts = 0;
    await page.route(CHANGES_ROUTE, (route) => {
      attempts += 1;
      return route.abort();
    });
    try {
      await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect.poll(() => attempts).toBeGreaterThan(0);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(2_000);
      expect(await pendingChanges(page)).toBeGreaterThanOrEqual(2);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await waitAllSaved(page);
  });

  // Obligatorisk (tap av data)
  test("køen overlever at fanen lukkes og åpnes igjen (Egenbygd)", async ({ page, context }) => {
    // «Alt er lagret» krever en bekreftet henting etter at køen er tom; den kan ha en hel ventetid
    // i leseren foran seg (FULL_READER_WAIT_MS), så testen får tid til den.
    test.setTimeout(60_000 + 2 * FULL_READER_WAIT_MS);
    await logIn(page, ADMIN_EMAIL);
    await context.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    let reopened: Page | null = null;
    try {
      const formId = await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      await floorsInput(page).blur();

      await page.close();
      reopened = await context.newPage();
      await reopened.goto(`/prove/testskjema/${formId}`);
      await expectCount(reopened, 1);
      await expect(floorsInput(reopened)).toHaveValue("7");
      await expect.poll(() => pendingChanges(reopened!)).toBeGreaterThanOrEqual(2);
      expect((await answerFor(reopened, formId, "floors"))?.value).toBe("7");
    } finally {
      await context.unroute(CHANGES_ROUTE);
    }
    await waitAllSaved(reopened!, FULL_READER_WAIT_MS);
  });

  test("det som skrives mens en bunt er underveis går ikke tapt (Egenbygd)", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    await logIn(page, ADMIN_EMAIL);
    const formId = await createTrialForm(page);
    await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);

    const floorsPosts: string[] = [];
    let floorsId: string | null = null;
    let responded = 0;
    await page.route(CHANGES_ROUTE, async (route) => {
      for (const operation of operationsOf(route.request().postData())) {
        if (operation.table !== "trial_answers") continue;
        if (operation.data.field_key === "floors") floorsId = operation.id;
        if (operation.id === floorsId && "value" in operation.data) {
          floorsPosts.push(String(operation.data.value));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
      responded += 1;
    });
    try {
      await floorsInput(page).fill("7");
      await expect.poll(() => floorsPosts.length, { message: "bunten med 7 er sendt" }).toBe(1);
      await floorsInput(page).fill("8");
      await expectCount(page, 1);

      // Feltet viser 8 med en gang, men skrivingen til køen er asynkron: vent på den, så
      // sjekk at bunten med 7 fortsatt er underveis (svaret kommer først etter 3 s).
      await expect
        .poll(
          async () =>
            (await readRowsViaHook(page, "outbox")).some(
              (entry) =>
                entry.table === "trial_answers" &&
                (entry.data as Record<string, unknown> | undefined)?.value === "8",
            ),
          { timeout: 2_500, message: "8 ligger i køen mens bunten med 7 er underveis" },
        )
        .toBe(true);
      expect(responded).toBe(0);

      await expect.poll(() => pendingChanges(page), { timeout: 30_000 }).toBe(0);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    expect(floorsPosts.length).toBeGreaterThanOrEqual(2);
    expect(floorsPosts[0]).toBe("7");
    expect(floorsPosts.at(-1)).toBe("8");
    expect((await answerFor(page, formId, "floors"))?.value).toBe("8");
    await expect(floorsInput(page)).toHaveValue("8");
  });

  test("bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder (Egenbygd)", async ({
    page,
  }) => {
    const formId = await openNewForm(page);
    await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);

    const photoPosts: PostedOperation[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/prove/synk/endringer")) {
        photoPosts.push(
          ...operationsOf(request.postData()).filter((op) => op.table === "trial_photos"),
        );
      }
    });

    // Ruten blir stående til slutt; bryteren slipper opplastingene gjennom. page.unroute midt i en
    // opplasting kan la forespørselen henge uten svar (fanget, men aldri behandlet).
    let blockPhotos = true;
    await page.route(PHOTO_ROUTE, (route) => (blockPhotos ? route.abort() : route.fallback()));
    try {
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      await expect.poll(() => localPhotoFileCount(page)).toBe(1);
      await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);
      const postsBeforeUpload = photoPosts.length;
      expect(postsBeforeUpload).toBeGreaterThan(0);

      blockPhotos = false;
      await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING, { timeout: 15_000 });
      await expect.poll(() => localPhotoFileCount(page), { timeout: 15_000 }).toBe(0);
      await expect
        .poll(
          async () => {
            const rows = await readRowsViaHook(page, "trial_photos", formId);
            // Småfunn 6: uploaded_at kommer bare fra serveren, med neste henting (hvert 5. sekund)
            return rows.length === 1 && Boolean(rows[0]!.uploaded_at);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 15_000 });
      // markPhotoUploaded skriver bare lokalt: ingen ny endring i køen og ingen ny sending
      expect(await pendingChanges(page)).toBe(0);
      await page.waitForTimeout(1_000);
      expect(photoPosts.length).toBe(postsBeforeUpload);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }
  });

  test("ny enhet får skjemaet og svarene fra serveren via hente-ruten", async ({
    page,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }) => {
    const formId = await openNewForm(page);
    await floorsInput(page).fill("7");
    await roofTg(page, "TG2").click();
    await expectCount(page, 2);
    await waitAllSaved(page);

    const second = await openSecondDevice(browser, {
      ...deviceOptions({ baseURL, viewport, hasTouch }),
    });
    try {
      const other = second.page;
      // Lageret og testkroken finnes bare under /prove/testskjema: les enhets-id etter åpning
      await openFromList(other, formId);
      expect(await hookValue(other, "deviceId")).not.toBe(await hookValue(page, "deviceId"));
      await expect(floorsInput(other)).toHaveValue("7");
      await expect(roofTg(other, "TG2")).toHaveAttribute("aria-pressed", "true");
      await expectCount(other, 2);
      // Første lasting gir ingen varsler
      await expect(other.getByText("Endret av en annen")).toHaveCount(0);
    } finally {
      await second.context.close();
    }
  });

  test("hentingen går omtrent hvert 5. sekund med nett, aldri tettere", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page);
    await waitAllSaved(page);

    const recorder = recordPulls(page);
    await page.goto(`/prove/testskjema/${formId}`);
    await expectCount(page, 0);
    await page.waitForTimeout(16_000);

    const pulls = recorder.pulls;
    testInfo.annotations.push({
      type: "hentinger",
      description: JSON.stringify(pulls.map((p) => ({ at: p.at, ferdig: p.ferdig }))),
    });
    expect(pulls.length).toBeGreaterThanOrEqual(3);
    let pairs = 0;
    for (let i = 0; i + 1 < pulls.length; i++) {
      if (pulls[i]!.ferdig !== true) continue;
      const gap = pulls[i + 1]!.at - pulls[i]!.at;
      // Slingringsmonn: 500 ms nedover, 3 s oppover (CI kan være treg)
      expect(gap, `avstand etter kall ${i}`).toBeGreaterThanOrEqual(4_500);
      expect(gap, `avstand etter kall ${i}`).toBeLessThanOrEqual(8_000);
      pairs += 1;
    }
    expect(pairs).toBeGreaterThanOrEqual(2);
  });

  test("feil på hente-ruten gir økende ventetid, og skriving virker i mellomtiden", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page);
    await waitAllSaved(page);
    // Den gamle siden kan sende en henting rett etter svaret på «nytt skjema» (pkt. 6), mens
    // den nye lastes. Forlat den først, så opptakeren bare teller hentingene fra den nye siden.
    await page.goto("about:blank");

    await page.route(isPullUrl, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      const recorder = recordPulls(page);
      await page.goto(`/prove/testskjema/${formId}`);
      await expectCount(page, 0);
      // Ingen skriving i måleperioden: en bunt med 200 gir henting ved neste takt (pkt. 6)
      await page.waitForTimeout(20_000);
      const pulls = recorder.pulls;
      testInfo.annotations.push({
        type: "hentinger",
        description: JSON.stringify(pulls.map((p) => p.at)),
      });
      expect(pulls.length).toBeGreaterThanOrEqual(2);
      expect(pulls.length).toBeLessThanOrEqual(3);
      expect(pulls[1]!.at - pulls[0]!.at).toBeGreaterThanOrEqual(4_500);
      if (pulls.length === 3) expect(pulls[2]!.at - pulls[1]!.at).toBeGreaterThanOrEqual(9_500);

      // Henting blokkerer aldri skriving: skrivingen kommer fram mens hentingen feiler
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      // Hentingen svarer 500, så serveren bekrefter aldri: «Alt er lagret» kan ikke vises her
      await expect
        .poll(() => pendingChanges(page), { timeout: 15_000, message: "køen tømmes" })
        .toBe(0);
      await expect(indicator(page)).toHaveText(AWAITING_SERVER);
    } finally {
      await page.unroute(isPullUrl);
    }
  });

  // Obligatorisk (tap av data)
  test("ugyldig markør (400) gir ny henting uten siden, og køen er urørt", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    const recorder = recordPulls(page);
    const formId = await openNewForm(page);
    await expect
      .poll(() => recorder.pulls.some((pull) => pull.siden !== null), {
        timeout: 20_000,
        message: "et kall med siden",
      })
      .toBe(true);

    let rejectedAt: number | null = null;
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      // To svar gir minst to endringer i køen, også når «nytt skjema» alt er sendt
      await floorsInput(page).fill("7");
      await roofTg(page, "TG2").click();
      await expectCount(page, 2);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      const pendingBefore = await pendingChanges(page);
      const outboxBefore = (await readRowsViaHook(page, "outbox")).length;

      await page.route(isPullUrl, (route) => {
        const url = new URL(route.request().url());
        if (rejectedAt === null && url.searchParams.has("siden")) {
          rejectedAt = Date.now();
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ feil: "Ugyldig markør." }),
          });
        }
        return route.continue();
      });
      await expect
        .poll(() => rejectedAt !== null, { timeout: 20_000, message: "400 er sendt" })
        .toBe(true);
      await expect
        .poll(() => recorder.since(rejectedAt! + 1).length, {
          timeout: 6_000,
          message: "ny henting innen 6 s",
        })
        .toBeGreaterThan(0);
      const after = recorder.since(rejectedAt! + 1)[0]!;
      expect(after.siden).toBeNull();
      expect(after.at - rejectedAt!).toBeLessThanOrEqual(6_000);

      // Køen og de lokale radene er urørt
      expect(await pendingChanges(page)).toBe(pendingBefore);
      expect((await readRowsViaHook(page, "outbox")).length).toBe(outboxBefore);
      expect((await answerFor(page, formId, "floors"))?.value).toBe("7");
      await expect(floorsInput(page)).toHaveValue("7");
    } finally {
      await page.unroute(isPullUrl);
      await page.unroute(CHANGES_ROUTE);
    }
    await waitAllSaved(page);
  });

  test("ingen henting uten nett", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    const recorder = recordPulls(page);
    await openNewForm(page);
    await expect.poll(() => recorder.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    let offlineAt = 0;
    try {
      await context.setOffline(true);
      await expect(indicator(page)).toHaveText("Uten nett");
      offlineAt = Date.now();
      await page.waitForTimeout(10_000);
      expect(recorder.since(offlineAt)).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
    const onlineAt = Date.now();
    await expect
      .poll(() => recorder.since(onlineAt).length, {
        timeout: 6_000,
        message: "ett kall innen 6 s",
      })
      .toBeGreaterThan(0);
  });

  test("Egenbygd henter fra hente-ruten", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    const pulls = recordPulls(page);
    await openNewForm(page);
    await page.waitForTimeout(10_000);
    // Hentingen går mot egen rute
    expect(pulls.count()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------------------------
  // To enheter (prøve B i det små). Rekkefølgen på sendingen styres med setOffline per kontekst.
  // -------------------------------------------------------------------------------------------

  test("tekst skrevet på én enhet vises på den andre uten omlasting", async ({
    page,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }) => {
    const formId = await openNewForm(page);
    await waitAllSaved(page);
    const second = await openSecondDevice(browser, deviceOptions({ baseURL, viewport, hasTouch }));
    try {
      const other = second.page;
      await openFromList(other, formId);

      await roofText(page).fill("Taket er tett.");
      await roofText(page).blur();
      await expect(roofText(other)).toHaveValue("Taket er tett.", {
        timeout: OTHER_DEVICE_TIMEOUT,
      });
    } finally {
      await second.context.close();
    }
  });

  // Obligatorisk (prøve B)
  test("samtidig tekst i samme felt gir begge bidrag på begge", async ({
    page,
    context,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page);
    const second = await openSecondDevice(browser, deviceOptions({ baseURL, viewport, hasTouch }));
    const other = second.page;
    try {
      // Felles start
      await roofText(page).fill("Grunnmur.");
      await roofText(page).blur();
      await waitAllSaved(page);
      await openFromList(other, formId);
      await expect(roofText(other)).toHaveValue("Grunnmur.", { timeout: OTHER_DEVICE_TIMEOUT });

      await context.setOffline(true);
      await second.context.setOffline(true);
      await roofText(page).fill("Grunnmur. Del A.");
      await roofText(page).blur();
      await roofText(other).fill("Grunnmur. Del B.");
      await roofText(other).blur();
      await page.waitForTimeout(500);

      await context.setOffline(false);
      await waitAllSaved(page);
      await second.context.setOffline(false);
      await waitAllSaved(other);

      for (const [name, device] of [
        ["A", page],
        ["B", other],
      ] as const) {
        await expect
          .poll(
            async () => {
              const value = await roofText(device).inputValue();
              return {
                delA: value.includes("Del A."),
                delB: value.includes("Del B."),
                grunnmur: value.split("Grunnmur.").length - 1,
              };
            },
            { timeout: OTHER_DEVICE_TIMEOUT, message: `enhet ${name}` },
          )
          .toEqual({ delA: true, delB: true, grunnmur: 1 });
      }
    } finally {
      await context.setOffline(false);
      await second.context.close();
    }
  });

  // Obligatorisk (prøve B)
  test("TG på begge gir samme verdi på begge og Endret av en annen hos den som tapte", async ({
    page,
    context,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page);
    await waitAllSaved(page);
    const second = await openSecondDevice(browser, deviceOptions({ baseURL, viewport, hasTouch }));
    const other = second.page;
    try {
      await openFromList(other, formId);

      await context.setOffline(true);
      await second.context.setOffline(true);
      await roofTg(page, "TG2").click();
      await roofTg(other, "TG3").click();
      await expectCount(page, 1);
      await expectCount(other, 1);

      // A sender først, B sist: B vinner (den som kom sist til serveren, regelen fra oppgave 4)
      await context.setOffline(false);
      await waitAllSaved(page);
      // A rekker å hente ekkoet av sin egen skriving før B sender
      await page.waitForTimeout(6_000);
      await second.context.setOffline(false);
      await waitAllSaved(other);

      for (const device of [page, other]) {
        await expect(roofTg(device, "TG3")).toHaveAttribute("aria-pressed", "true", {
          timeout: OTHER_DEVICE_TIMEOUT,
        });
        await expect(roofTg(device, "TG2")).toHaveAttribute("aria-pressed", "false");
      }
      await expect(foreignWarning(page, "roof_tg")).toBeVisible();
      await expect(foreignWarning(other, "roof_tg")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
      await second.context.close();
    }
  });

  // -------------------------------------------------------------------------------------------
  // Velger og organisasjon
  // -------------------------------------------------------------------------------------------

  test("uinnlogget gir 401 på hente-ruten", async ({ request }, testInfo) => {
    pcOnly(testInfo);
    const response = await request.get(`${PULL_PATH}?organisasjon=${randomUuid()}`);
    expect(response.status()).toBe(401);
    expectNoStore(response.headers());
  });

  // Obligatorisk
  test("fremmed organisasjon gir 403 på hente-ruten", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await logIn(page, ADMIN_EMAIL);
    const response = await page.request.get(`${PULL_PATH}?organisasjon=${randomUuid()}`);
    expect(response.status()).toBe(403);
    expectNoStore(response.headers());
    const body = await expectErrorMessage(response);
    expect(body).not.toHaveProperty("endringer");
    expect(body).not.toHaveProperty("markor");
  });

  test("ugyldig markør gir 400 på hente-ruten", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await openNewForm(page);
    const organizationId = await hookValue(page, "organizationId");
    for (const siden of ["søppel", "!!!", "a".repeat(10_000)]) {
      const response = await page.request.get(
        `${PULL_PATH}?organisasjon=${organizationId}&siden=${encodeURIComponent(siden)}`,
      );
      expect(response.status(), siden.slice(0, 20)).toBe(400);
      expectNoStore(response.headers());
      const body = await expectErrorMessage(response);
      expect(body).not.toHaveProperty("endringer");
    }
  });

  test("hente-ruten svarer med endringer, markor og ferdig, og aldri storage_path", async ({
    page,
  }, testInfo) => {
    pcOnly(testInfo);
    await openNewForm(page);
    await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
    await expect.poll(() => localPhotoFileCount(page), { timeout: 20_000 }).toBe(0);
    await waitAllSaved(page);
    const organizationId = await hookValue(page, "organizationId");

    const response = await page.request.get(`${PULL_PATH}?organisasjon=${organizationId}`);
    expect(response.status()).toBe(200);
    expectNoStore(response.headers());
    const text = await response.text();
    const body = JSON.parse(text) as {
      endringer: Record<string, LocalRow[]>;
      markor: unknown;
      ferdig: unknown;
    };
    expect(Object.keys(body).sort()).toEqual(["endringer", "ferdig", "markor"]);
    expect(Object.keys(body.endringer).sort()).toEqual([
      "trial_answers",
      "trial_forms",
      "trial_photos",
    ]);
    expect(typeof body.markor).toBe("string");
    expect(typeof body.ferdig).toBe("boolean");
    for (const word of [
      "storage_path",
      "created_by",
      "updated_by",
      "deleted_by",
      "organization_id",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});

// Utenfor describe: velgeren skal virke med service worker som i virkeligheten
