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
  countRequests,
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
  useCandidate,
  type ElectricTrialHook,
  type LocalRow,
  type TrialSyncCandidate,
} from "./helpers";

// Tredje kandidat for drift uten nett: egenbygd (lokal database og endringskø) koblet til
// testskjemaet (fase 1, oppgave 6). Testplan: docs/funksjoner/fase1-kandidat-egenbygd-testplan.md
// avsnitt 6.2. Kandidaten trenger ingen ekstra tjeneste: skriveruten og hente-ruten finnes i e2e,
// så lesing fra serveren og to enheter testes ende til ende. E2e-databasen tømmes aldri, så
// testene regner aldri med et bestemt antall rader på serveren. Alle data er oppdiktet.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(DIR, "fixtures", "test-image.png");
const PHOTO_ROUTE = "**/api/prove/bilder/**";
const CHANGES_ROUTE = "**/api/prove/synk/endringer";
const ANY_STATUS = /^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret på serveren)$/;
const NO_PHOTOS_WAITING = /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/;
const ALL_SAVED = "Alt er lagret på serveren";
const WAIT_TEXT = "Vent til alt er lagret på serveren før du bytter";
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

/** Logger inn, lager et nytt skjema og returnerer id-en. Testen kaller `useCandidate` først. */
async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expectCount(page, 0);
  expect(await hookValue(page, "candidate")).toBe("custom");
  return id;
}

async function answerFor(page: Page, formId: string, fieldKey: string) {
  return (await readRowsViaHook(page, "trial_answers", formId)).find(
    (row) => row.field_key === fieldKey,
  );
}

async function waitAllSaved(page: Page) {
  await expect
    .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
    .toBe(0);
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
}

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

/** Leser navn, versjon og lagre (med keyPath) i en IndexedDB-database uten å lage den. */
async function describeDatabase(page: Page, name: string) {
  return page.evaluate(async (dbName) => {
    const databases = await indexedDB.databases();
    if (!databases.some((info) => info.name === dbName)) return null;
    return new Promise<{
      version: number;
      stores: Record<string, string | string[] | null>;
    }>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const names = Array.from(database.objectStoreNames);
        const stores: Record<string, string | string[] | null> = {};
        if (names.length > 0) {
          const tx = database.transaction(names, "readonly");
          for (const store of names) stores[store] = tx.objectStore(store).keyPath;
        }
        const version = database.version;
        database.close();
        resolve({ version, stores });
      };
    });
  }, name);
}

/** Id-ene i et lager i en IndexedDB-database (direkte, ikke via kroken). */
async function idsInStore(page: Page, dbName: string, storeName: string): Promise<string[]> {
  return page.evaluate(
    async ([database, store]) =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction(store, "readonly").objectStore(store).getAll();
          all.onsuccess = () => {
            db.close();
            resolve((all.result as { id?: string }[]).map((row) => String(row.id)));
          };
          all.onerror = () => reject(all.error);
        };
      }),
    [dbName, storeName] as const,
  );
}

// ---------------------------------------------------------------------------------------------
// Lagring og kø (samme som Electric, med navnet «(Egenbygd)»)
// ---------------------------------------------------------------------------------------------

test("testkroken viser custom som kandidat og lageret er klart", async ({ page, context }) => {
  await useCandidate(context, "custom");
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  expect(await hookValue(page, "candidate")).toBe("custom");
  const forms = await readRowsViaHook(page, "trial_forms");
  expect(Array.isArray(forms)).toBe(true);
  const hasDb = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    return "db" in hook && hook.db !== undefined;
  });
  expect(hasDb).toBe(false);
});

test("listen viser nye testskjemaer med navn og laget når, og åpner dem (Egenbygd)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "custom");
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

test("svarene og et bilde overlever at siden lastes på nytt (Egenbygd)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "custom");
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
  await useCandidate(context, "custom");
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
  await useCandidate(context, "custom");
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

test("service worker rører ikke hente-ruten", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "custom");
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
  test("endringskøen overlever omlasting og tømmes bare etter 200 (Egenbygd)", async ({
    page,
    context,
  }) => {
    await useCandidate(context, "custom");
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

  test("avbrutt sending beholder bunten (Egenbygd)", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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
    await useCandidate(context, "custom");
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
    await waitAllSaved(reopened!);
  });

  test("det som skrives mens en bunt er underveis går ikke tapt (Egenbygd)", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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

      const outbox = await readRowsViaHook(page, "outbox");
      expect(
        outbox.some(
          (entry) =>
            entry.table === "trial_answers" &&
            (entry.data as Record<string, unknown> | undefined)?.value === "8",
        ),
        JSON.stringify(outbox),
      ).toBe(true);
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
    context,
  }) => {
    await useCandidate(context, "custom");
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
        .poll(async () => {
          const rows = await readRowsViaHook(page, "trial_photos", formId);
          return rows.length === 1 && Boolean(rows[0]!.uploaded_at);
        })
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

  test("Electric og Egenbygd har hver sin lokale database", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await logIn(page, ADMIN_EMAIL);
    const switchTo = async (candidate: TrialSyncCandidate) => {
      await page.goto("/prove/testskjema");
      await page.evaluate(
        (value) => localStorage.setItem("trial_sync_candidate", value),
        candidate,
      );
      await page.reload();
      expect(await hookValue(page, "candidate")).toBe(candidate);
    };

    await switchTo("electricsql");
    const electricForm = await createTrialForm(page);
    await expect
      .poll(() => idsInStore(page, "offline-trial-electric", "synced_trial_forms"))
      .toContain(electricForm);

    await switchTo("custom");
    await expect
      .poll(async () =>
        (await page.evaluate(() => indexedDB.databases())).map((info) => info.name).sort(),
      )
      .toEqual(expect.arrayContaining(["offline-trial-custom", "offline-trial-electric"]));

    const electric = await describeDatabase(page, "offline-trial-electric");
    expect(electric).not.toBeNull();
    // Samme versjon og lagre som før kandidat 3: ingen data på enheten er flyttet
    expect(electric!.version).toBe(1);
    expect(electric!.stores).toEqual({
      outbox: "seq",
      shape_state: "table",
      synced_trial_answers: "id",
      synced_trial_forms: "id",
      synced_trial_photos: "id",
    });

    const custom = await describeDatabase(page, "offline-trial-custom");
    expect(custom).not.toBeNull();
    expect(custom!.stores).toEqual({
      outbox: "seq",
      sync_state: "key",
      synced_trial_answers: "id",
      synced_trial_forms: "id",
      synced_trial_photos: "id",
    });
    expect(custom!.stores).not.toHaveProperty("shape_state");

    // Electric-skjemaet ligger bare i Electric-databasen; det egenbygde lageret kan få det via
    // hentingen (det er på serveren), men aldri ved at databasene deler lagring
    expect(await idsInStore(page, "offline-trial-electric", "synced_trial_forms")).toContain(
      electricForm,
    );

    await switchTo("electricsql");
    await expect(formLink(page, electricForm)).toBeVisible();
  });

  // -------------------------------------------------------------------------------------------
  // Henting fra serveren (nytt for denne kandidaten)
  // -------------------------------------------------------------------------------------------

  test("ny enhet får skjemaet og svarene fra serveren via hente-ruten", async ({
    page,
    context,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }) => {
    await useCandidate(context, "custom");
    const formId = await openNewForm(page);
    await floorsInput(page).fill("7");
    await roofTg(page, "TG2").click();
    await expectCount(page, 2);
    await waitAllSaved(page);

    const second = await openSecondDevice(browser, "custom", {
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
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
    const formId = await openNewForm(page);
    await waitAllSaved(page);

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
      await waitAllSaved(page);
    } finally {
      await page.unroute(isPullUrl);
    }
  });

  // Obligatorisk (tap av data)
  test("ugyldig markør (400) gir ny henting uten siden, og køen er urørt", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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
    await useCandidate(context, "custom");
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

  test("Egenbygd kaller verken shape-ruten eller PowerSync", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
    const shapes = countRequests(page, "**/api/prove/synk/shape*");
    const tokens = countRequests(page, "**/api/prove/synk/token*");
    const pulls = recordPulls(page);
    await openNewForm(page);
    await page.waitForTimeout(10_000);
    expect(shapes.count()).toBe(0);
    expect(tokens.count()).toBe(0);
    // Hentingen går mot egen rute
    expect(pulls.count()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------------------------
  // To enheter (prøve B i det små). Rekkefølgen på sendingen styres med setOffline per kontekst.
  // -------------------------------------------------------------------------------------------

  test("tekst skrevet på én enhet vises på den andre uten omlasting", async ({
    page,
    context,
    browser,
    baseURL,
    viewport,
    hasTouch,
  }) => {
    await useCandidate(context, "custom");
    const formId = await openNewForm(page);
    await waitAllSaved(page);
    const second = await openSecondDevice(
      browser,
      "custom",
      deviceOptions({ baseURL, viewport, hasTouch }),
    );
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
    await useCandidate(context, "custom");
    const formId = await openNewForm(page);
    const second = await openSecondDevice(
      browser,
      "custom",
      deviceOptions({ baseURL, viewport, hasTouch }),
    );
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
    await useCandidate(context, "custom");
    const formId = await openNewForm(page);
    await waitAllSaved(page);
    const second = await openSecondDevice(
      browser,
      "custom",
      deviceOptions({ baseURL, viewport, hasTouch }),
    );
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

  test("velgeren er sperret med forklaring når noe venter på å bli sendt (Egenbygd)", async ({
    page,
    context,
  }) => {
    await useCandidate(context, "custom");
    await logIn(page, ADMIN_EMAIL);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    const selector = group(page, "Synkløsning");
    const others = [
      selector.getByRole("button", { name: "PowerSync", exact: true }),
      selector.getByRole("button", { name: "ElectricSQL", exact: true }),
    ];
    try {
      await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await page.goto("/prove/testskjema");
      await expect(selector).toBeVisible();
      for (const button of others) await expect(button).toBeDisabled();
      await expect(page.getByText(WAIT_TEXT)).toBeVisible();
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    for (const button of others) await expect(button).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(WAIT_TEXT)).toHaveCount(0);
  });

  // Obligatorisk (tap av data)
  test("bytte mellom alle tre kandidater sletter ingenting lokalt", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await logIn(page, ADMIN_EMAIL);
    const switchTo = async (candidate: TrialSyncCandidate) => {
      await page.goto("/prove/testskjema");
      await page.evaluate(
        (value) => localStorage.setItem("trial_sync_candidate", value),
        candidate,
      );
      await page.reload();
      expect(await hookValue(page, "candidate")).toBe(candidate);
    };

    const forms = new Map<TrialSyncCandidate, string>();
    for (const candidate of ["powersync", "electricsql", "custom"] as const) {
      await switchTo(candidate);
      const formId = await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect.poll(async () => (await answerFor(page, formId, "floors"))?.value).toBe("7");
      forms.set(candidate, formId);
    }

    const expectKept = async (candidate: TrialSyncCandidate) => {
      const formId = forms.get(candidate)!;
      await expect
        .poll(
          async () => (await readRowsViaHook(page, "trial_forms")).some((r) => r.id === formId),
          {
            message: `skjemaet for ${candidate}`,
          },
        )
        .toBe(true);
      await expect
        .poll(async () => (await answerFor(page, formId, "floors"))?.value, {
          message: `floors for ${candidate}`,
        })
        .toBe("7");
    };

    for (const candidate of [
      "powersync",
      "electricsql",
      "custom",
      "powersync",
      "electricsql",
      "custom",
    ] as const) {
      await switchTo(candidate);
      await expectKept(candidate);
    }
  });

  // -------------------------------------------------------------------------------------------
  // Hente-ruten
  // -------------------------------------------------------------------------------------------

  test("uinnlogget gir 401 på hente-ruten", async ({ request }, testInfo) => {
    pcOnly(testInfo);
    const response = await request.get(`${PULL_PATH}?organisasjon=${randomUuid()}`);
    expect(response.status()).toBe(401);
    expectNoStore(response.headers());
  });

  // Obligatorisk
  test("fremmed organisasjon gir 403 på hente-ruten", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
    await logIn(page, ADMIN_EMAIL);
    const response = await page.request.get(`${PULL_PATH}?organisasjon=${randomUuid()}`);
    expect(response.status()).toBe(403);
    expectNoStore(response.headers());
    const body = await expectErrorMessage(response);
    expect(body).not.toHaveProperty("endringer");
    expect(body).not.toHaveProperty("markor");
  });

  test("ugyldig markør gir 400 på hente-ruten", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "custom");
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
test("velgeren har tre knapper, og Egenbygd overlever omlasting", async ({ page }, testInfo) => {
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  const selector = group(page, "Synkløsning");
  const powersync = selector.getByRole("button", { name: "PowerSync", exact: true });
  const electric = selector.getByRole("button", { name: "ElectricSQL", exact: true });
  const custom = selector.getByRole("button", { name: "Egenbygd", exact: true });
  await expect(powersync).toBeVisible();
  await expect(electric).toBeVisible();
  await expect(custom).toBeVisible();
  await expect(selector.getByRole("button")).toHaveCount(3);
  await expect(custom).toHaveAttribute("aria-pressed", "false");
  await expect(custom).toBeEnabled();
  if (testInfo.project.name === "ipad") {
    for (const button of [powersync, electric, custom]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(indicator(page)).toHaveText(ALL_SAVED);

  await Promise.all([page.waitForEvent("load"), custom.click()]);
  await page.waitForLoadState();
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  await expect(powersync).toHaveAttribute("aria-pressed", "false");
  await expect(electric).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("trial_sync_candidate"))).toBe("custom");
  expect(await hookValue(page, "candidate")).toBe("custom");

  await page.reload();
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  expect(await hookValue(page, "candidate")).toBe("custom");
});
