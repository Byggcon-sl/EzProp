import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  applySyncedRowsViaHook,
  countRequests,
  createTrialForm,
  hookValue,
  indicator,
  isPullUrl,
  localPhotoFileCount,
  logIn,
  pendingChanges,
  readRowsViaHook,
  recordPulls,
  useCandidate,
  type ElectricTrialHook,
  type LocalRow,
  type TrialSyncCandidate,
} from "./helpers";

// Andre kandidat for drift uten nett: ElectricSQL koblet til testskjemaet (fase 1, oppgave 5).
// Testplan: docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6.2, pluss
// «createForm legger skjemaet i køen før første svar» (oppgavekortet, «Avgjørelser før bygging» 1).
// Kjører uten Electric-tjenesten: shape-ruten svarer 502 og lageret prøver igjen med økende
// ventetid. Skriveruten finnes, så endringskøen tømmes. Skjemaer lages nye i hver test; ingenting
// slettes i databasen. Alle data er oppdiktet.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(DIR, "fixtures", "test-image.png");
const PHOTO_ROUTE = "**/api/prove/bilder/**";
const CHANGES_ROUTE = "**/api/prove/synk/endringer";
const SHAPE_ROUTE = "/api/prove/synk/shape";
const ANY_STATUS = /^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret på serveren)$/;
const NO_PHOTOS_WAITING = /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/;
const ALL_SAVED = "Alt er lagret på serveren";
const FOREIGN = "annen-enhet";
const WAIT_TEXT = "Vent til alt er lagret på serveren før du bytter";

/** Hemmeligheten e2e-serveren får (fra playwright.config.ts), så testen ser at den aldri lekker. */
const E2E_ELECTRIC_SECRET = (() => {
  const config = readFileSync(path.join(DIR, "..", "playwright.config.ts"), "utf8");
  const value = /ELECTRIC_SECRET:\s*["']([^"']+)["']/.exec(config)?.[1];
  if (!value) throw new Error("ELECTRIC_SECRET mangler i playwright.config.ts");
  return value;
})();

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

function randomUuid(): string {
  return crypto.randomUUID();
}

function formLink(page: Page, formId: string): Locator {
  return page.locator(`a[href$="/prove/testskjema/${formId}"]`);
}

/**
 * Logger inn, lager et nytt skjema og returnerer id-en. Testen kaller
 * `useCandidate(context, "electricsql")` først; her sjekkes bare at valget er tatt.
 */
async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expectCount(page, 0);
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  return id;
}

async function answerRows(page: Page, formId: string): Promise<LocalRow[]> {
  return readRowsViaHook(page, "trial_answers", formId);
}

async function answerFor(page: Page, formId: string, fieldKey: string) {
  return (await answerRows(page, formId)).find((row) => row.field_key === fieldKey);
}

/** Venter til egen rad for feltet ligger lokalt og serveren har bekreftet køen. */
async function waitForOwnRowConfirmed(page: Page, formId: string, fieldKey: string) {
  await expect
    .poll(async () => Boolean(await answerFor(page, formId, fieldKey)), {
      message: `egen rad for ${fieldKey}`,
    })
    .toBe(true);
  await expect
    .poll(() => pendingChanges(page), { timeout: 20_000, message: "køen tømmes" })
    .toBe(0);
}

/**
 * Electric strømmer i loggrekkefølge, så ekkoet av egen skriving kommer før en annen enhets
 * endring av samme felt. Lageret hopper over første melding for en nøkkel det nettopp fikk
 * bekreftet («Avgjørelser før bygging» 2). Testen sender derfor ekkoet først, slik strømmen ville.
 */
async function echoOwnRow(page: Page, formId: string, fieldKey: string) {
  const own = await answerFor(page, formId, fieldKey);
  expect(own, `egen rad for ${fieldKey}`).toBeDefined();
  await applySyncedRowsViaHook(page, "trial_answers", [own!]);
}

function foreignAnswer(
  formId: string,
  fieldKey: string,
  value: unknown,
  extra: Partial<LocalRow> = {},
): LocalRow {
  const now = new Date().toISOString();
  return {
    id: randomUuid(),
    trial_form_id: formId,
    field_key: fieldKey,
    value: JSON.stringify(value),
    text_state: null,
    device_id: FOREIGN,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...extra,
  };
}

/** Feilsvaret har en norsk melding i `{ feil }`. */
async function expectErrorMessage(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as { feil?: unknown };
  expect(typeof body.feil).toBe("string");
  expect(String(body.feil).length).toBeGreaterThan(0);
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

test("testkroken viser electricsql som kandidat og lageret er klart", async ({ page, context }) => {
  await useCandidate(context, "electricsql");
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  const forms = await readRowsViaHook(page, "trial_forms");
  expect(Array.isArray(forms)).toBe(true);
  const hasDb = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    return "db" in hook && hook.db !== undefined;
  });
  expect(hasDb).toBe(false);
});

test("listen viser nye testskjemaer med navn og laget når, og åpner dem (ElectricSQL)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  const first = await openNewForm(page);
  const second = await createTrialForm(page);
  expect(first).not.toBe(second);

  await page.goto("/prove/testskjema");
  const one = page.getByRole("link", { name: "Testskjema 1", exact: true });
  const two = page.getByRole("link", { name: "Testskjema 2", exact: true });
  await expect(one).toBeVisible();
  await expect(two).toBeVisible();
  for (const [link, name] of [
    [one, "Testskjema 1"],
    [two, "Testskjema 2"],
  ] as const) {
    const row = link.locator("xpath=..");
    const rest = (await row.innerText()).replace(name, "").trim();
    expect(rest, `tidsangivelse for ${name}`).not.toBe("");
  }

  await one.click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${first}$`));
  await expectCount(page, 0);
});

test("svarene og et bilde overlever at siden lastes på nytt uten server (ElectricSQL)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  const formId = await openNewForm(page);

  const tg2 = group(page, "Tak – tilstandsgrad").getByRole("button", { name: "TG2", exact: true });
  await tg2.click();
  await floorsInput(page).fill("7");
  await page.getByLabel("Tak – beskrivelse", { exact: true }).fill("Oppdiktet tekst");
  await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
  await page.getByLabel("Tak – beskrivelse", { exact: true }).blur();
  await expectCount(page, 4);

  await expect
    .poll(async () => {
      const rows = await answerRows(page, formId);
      const byKey = Object.fromEntries(rows.map((row) => [row.field_key, row]));
      const photos = await readRowsViaHook(page, "trial_photos", formId);
      const textState = byKey.roof_description?.text_state;
      return {
        roof_tg: byKey.roof_tg?.value,
        floors: byKey.floors?.value,
        roof_description: byKey.roof_description?.value,
        textState: typeof textState === "string" && /^[A-Za-z0-9+/]+=*$/.test(textState),
        photos: photos.length,
      };
    })
    .toEqual({
      roof_tg: JSON.stringify("TG2"),
      floors: "7",
      roof_description: JSON.stringify("Oppdiktet tekst"),
      textState: true,
      photos: 1,
    });

  await page.reload();
  await expectCount(page, 4);
  await expect(tg2).toHaveAttribute("aria-pressed", "true");
  await expect(floorsInput(page)).toHaveValue("7");
  await expect(page.getByLabel("Tak – beskrivelse", { exact: true })).toHaveValue(
    "Oppdiktet tekst",
  );
  await expect(
    fieldContainer(page, "cover_photo").getByText("1 bilde", { exact: true }),
  ).toBeVisible();

  await page.goto("/prove/testskjema");
  const link = formLink(page, formId);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expectCount(page, 4);
});

test("indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett (ElectricSQL)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
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
  await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING);
  // Skriveruten finnes i e2e, så køen tømmes (ulikt PowerSync uten tjeneste)
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
});

test("skjemaet åpner fra hurtiglageret uten nett etter ett besøk (ElectricSQL)", async ({
  page,
  context,
}, testInfo) => {
  await useCandidate(context, "electricsql");
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

test.describe("endringskøen", () => {
  // page.route og page.on("request") ser ikke forespørsler som går via service worker
  test.use({ serviceWorkers: "block" });

  // Obligatorisk (tap av data)
  test("endringskøen overlever omlasting og tømmes bare etter 200", async ({ page, context }) => {
    await useCandidate(context, "electricsql");
    await logIn(page, ADMIN_EMAIL);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      const formId = await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      // Holder seg i 6 s selv om sendingen prøves igjen
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
    await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
  });

  test("avbrutt sending beholder bunten", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "electricsql");
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
    await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
  });

  test("det som skrives mens en bunt er underveis går ikke tapt", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "electricsql");
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
      // Svarer 200 først etter 3 s, så det rekker å bli skrevet mer mens bunten er underveis
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
      responded += 1;
    });
    try {
      await floorsInput(page).fill("7");
      await expect.poll(() => floorsPosts.length, { message: "bunten med 7 er sendt" }).toBe(1);
      await floorsInput(page).fill("8");
      await expectCount(page, 1);

      // Mens bunten med 7 er underveis, ligger 8 i køen som egen oppføring
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

  test("createForm legger skjemaet i køen før første svar", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "electricsql");
    await logIn(page, ADMIN_EMAIL);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      const formId = await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await expect
        .poll(async () => (await readRowsViaHook(page, "outbox")).length)
        .toBeGreaterThanOrEqual(2);
      const outbox = [...(await readRowsViaHook(page, "outbox"))].sort(
        (a, b) => Number(a.seq) - Number(b.seq),
      );
      expect(outbox[0]!.table).toBe("trial_forms");
      expect(outbox[0]!.id).toBe(formId);
      const answer = outbox.find((entry) => entry.table === "trial_answers");
      expect(answer).toBeDefined();
      expect(Number(answer!.seq)).toBeGreaterThan(Number(outbox[0]!.seq));
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
  });

  test("shape-henting uten Electric prøves igjen med økende ventetid, høyst ett kall per tabell per 5 s", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    await useCandidate(context, "electricsql");
    await logIn(page, ADMIN_EMAIL);
    const formId = await createTrialForm(page);

    const shapes = countRequests(page, `**${SHAPE_ROUTE}*`);
    const started = Date.now();
    await page.goto(`/prove/testskjema/${formId}`);
    await expectCount(page, 0);
    // Skriving virker mens hentingen feiler
    await floorsInput(page).fill("7");
    await expectCount(page, 1);
    await page.waitForTimeout(Math.max(0, 12_000 - (Date.now() - started)));

    const perTable = shapes.countBy("tabell");
    testInfo.annotations.push({ type: "kall per tabell", description: JSON.stringify(perTable) });
    expect(Object.keys(perTable).sort()).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
    for (const [table, count] of Object.entries(perTable)) {
      expect(count, table).toBeLessThanOrEqual(3);
      expect(count, table).toBeGreaterThanOrEqual(2);
    }
    const answered = shapes.requests.filter((entry) => entry.status !== null);
    expect(answered.length).toBeGreaterThan(0);
    for (const entry of answered) expect(entry.status, entry.url.search).toBe(502);
  });

  test("bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder (ElectricSQL)", async ({
    page,
    context,
  }) => {
    await useCandidate(context, "electricsql");
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

    await page.route(PHOTO_ROUTE, (route) => route.abort());
    try {
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      await expect.poll(() => localPhotoFileCount(page)).toBe(1);
      // Bilderaden er sendt og bekreftet; bare filen venter
      await expect.poll(() => pendingChanges(page), { timeout: 20_000 }).toBe(0);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }
    const postsBeforeUpload = photoPosts.length;
    expect(postsBeforeUpload).toBeGreaterThan(0);

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
  });

  test("velgeren er sperret med forklaring når noe venter på å bli sendt", async ({
    page,
    context,
  }) => {
    await useCandidate(context, "electricsql");
    await logIn(page, ADMIN_EMAIL);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    const selector = group(page, "Synkløsning");
    const other = selector.getByRole("button", { name: "PowerSync", exact: true });
    try {
      await createTrialForm(page);
      await floorsInput(page).fill("7");
      await expectCount(page, 1);
      await page.goto("/prove/testskjema");
      await expect(selector).toBeVisible();
      await expect(other).toBeDisabled();
      await expect(page.getByText(WAIT_TEXT)).toBeVisible();
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await expect(other).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(WAIT_TEXT)).toHaveCount(0);
  });

  test.describe("innlogging med annen organisasjon tømmer lokal lagring for begge kandidater", () => {
    // "custom" lagt til for kandidat 3 (docs/funksjoner/fase1-kandidat-egenbygd-testplan.md 1.1)
    for (const candidate of ["powersync", "electricsql", "custom"] as TrialSyncCandidate[]) {
      // Obligatorisk (tenant)
      test(`innlogging med annen organisasjon tømmer lokal lagring for begge kandidater (${candidate})`, async ({
        page,
        context,
      }, testInfo) => {
        pcOnly(testInfo);
        await useCandidate(context, candidate);
        await logIn(page, ADMIN_EMAIL);
        await page.route(PHOTO_ROUTE, (route) => route.abort());
        try {
          await createTrialForm(page);
          expect(await hookValue(page, "candidate")).toBe(candidate);
          await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
          await expect.poll(() => localPhotoFileCount(page)).toBe(1);
          await expect
            .poll(async () => (await readRowsViaHook(page, "trial_forms")).length)
            .toBeGreaterThan(0);
          if (candidate === "custom") {
            // Hentemarkøren må finnes før byttet, ellers viser testen ingenting
            await expect
              .poll(
                async () =>
                  (await readRowsViaHook(page, "sync_state")).some((row) => row.key === "cursor"),
                { timeout: 20_000, message: "hentemarkøren er lagret" },
              )
              .toBe(true);
            // Etter byttet holdes hente-ruten nede, så tomme lagre ikke fylles igjen fra serveren
            // (samme organisasjon på serveren; byttet er bare simulert på enheten)
            await page.route(isPullUrl, (route) =>
              route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
            );
          }
          const pulls = recordPulls(page);

          await page.evaluate(async (organizationId) => {
            const hook = (window as unknown as { __offlineTrial: ElectricTrialHook })
              .__offlineTrial;
            await hook.simulateOrganizationChange(organizationId);
          }, randomUuid());
          const reloadedAt = Date.now();
          await page.reload();

          await expect
            .poll(async () => (await readRowsViaHook(page, "trial_forms")).length, {
              timeout: 15_000,
            })
            .toBe(0);
          expect(await readRowsViaHook(page, "trial_photos")).toEqual([]);
          expect(await localPhotoFileCount(page)).toBe(0);
          expect(await pendingChanges(page)).toBe(0);
          if (candidate === "electricsql") {
            expect(await readRowsViaHook(page, "shape_state")).toEqual([]);
            expect(await readRowsViaHook(page, "outbox")).toEqual([]);
          }
          if (candidate === "custom") {
            expect(await readRowsViaHook(page, "sync_state")).toEqual([]);
            expect(await readRowsViaHook(page, "outbox")).toEqual([]);
            await expect.poll(() => pulls.since(reloadedAt).length).toBeGreaterThan(0);
            // En markør fra forrige organisasjon brukes aldri
            expect(pulls.since(reloadedAt)[0]!.siden).toBeNull();
          }
        } finally {
          await page.unroute(PHOTO_ROUTE);
          if (candidate === "custom") await page.unroute(isPullUrl);
        }
      });
    }
  });
});

test("shape-svar via proxyen legges inn lokalt og vises (simulert med testkroken)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  const formId = await openNewForm(page);
  await floorsInput(page).fill("5");
  await floorsInput(page).blur();
  await expectCount(page, 1);
  await waitForOwnRowConfirmed(page, formId, "floors");
  await echoOwnRow(page, formId, "floors");

  await applySyncedRowsViaHook(page, "trial_answers", [foreignAnswer(formId, "floors", 7)]);
  await expect(floorsInput(page)).toHaveValue("7");
  await expect(foreignWarning(page, "floors")).toBeVisible({ timeout: 15_000 });
  expect((await answerFor(page, formId, "floors"))?.device_id).toBe(FOREIGN);

  await floorsInput(page).click();
  await expect(foreignWarning(page, "floors")).toHaveCount(0);
});

test("TG og valg satt utenfra viser Endret av en annen, egen endring gjør det ikke (ElectricSQL)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  const formId = await openNewForm(page);
  const tg = group(page, "Tak – tilstandsgrad");
  await tg.getByRole("button", { name: "TG2", exact: true }).click();
  await waitForOwnRowConfirmed(page, formId, "roof_tg");
  await echoOwnRow(page, formId, "roof_tg");
  await expect(foreignWarning(page, "roof_tg")).toHaveCount(0);

  await applySyncedRowsViaHook(page, "trial_answers", [foreignAnswer(formId, "roof_tg", "TG3")]);
  await expect(tg.getByRole("button", { name: "TG3", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tg.getByRole("button", { name: "TG2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(foreignWarning(page, "roof_tg")).toBeVisible({ timeout: 15_000 });

  await applySyncedRowsViaHook(page, "trial_answers", [
    foreignAnswer(formId, "leak_stopper", "no"),
  ]);
  await expect(
    group(page, "Lekkasjestopper").getByRole("button", { name: "Nei", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(foreignWarning(page, "leak_stopper")).toBeVisible({ timeout: 15_000 });

  const ownDevice = await hookValue(page, "deviceId");
  expect(ownDevice).not.toBe(FOREIGN);
  await applySyncedRowsViaHook(page, "trial_answers", [
    foreignAnswer(formId, "moisture_floor", 12, { device_id: ownDevice }),
  ]);
  await expect(page.getByLabel("Fuktmåling gulv", { exact: true })).toHaveValue("12");
  await expect(foreignWarning(page, "moisture_floor")).toHaveCount(0);
});

test("innkommende text_state flettes med egen tekst", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
  const formId = await openNewForm(page);
  const text = page.getByLabel("Tak – beskrivelse", { exact: true });
  await text.fill("Taket er tett.");
  await page.waitForTimeout(500);
  await text.blur();
  await waitForOwnRowConfirmed(page, formId, "roof_description");
  await echoOwnRow(page, formId, "roof_description");

  // En annen enhet skrev «Merk: » fra felles tom start (ekte Yjs-tilstand fra kroken)
  const foreignState = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: ElectricTrialHook }).__offlineTrial;
    return hook.createTextState("Merk: ");
  });
  expect(foreignState).toMatch(/^[A-Za-z0-9+/]+=*$/);
  await applySyncedRowsViaHook(page, "trial_answers", [
    foreignAnswer(formId, "roof_description", "Merk: ", { text_state: foreignState }),
  ]);

  await expect
    .poll(async () => {
      const value = await text.inputValue();
      return value.includes("Merk: ") && value.includes("Taket er tett.");
    })
    .toBe(true);
  const row = await answerFor(page, formId, "roof_description");
  const stored = JSON.parse(String(row?.value)) as string;
  expect(stored).toContain("Merk: ");
  expect(stored).toContain("Taket er tett.");
});

test("første lasting av et skjema fra en annen enhet gir ingen varsler (ElectricSQL)", async ({
  page,
  context,
}) => {
  await useCandidate(context, "electricsql");
  const formId = await openNewForm(page);
  await page.goto("/prove/testskjema");
  await expect(formLink(page, formId)).toBeVisible();

  await applySyncedRowsViaHook(page, "trial_answers", [
    foreignAnswer(formId, "roof_tg", "TG3"),
    foreignAnswer(formId, "leak_stopper", "no"),
    foreignAnswer(formId, "floors", 7),
    foreignAnswer(formId, "moisture_floor", 12),
    foreignAnswer(formId, "building_type", "detached"),
  ]);

  await formLink(page, formId).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expectCount(page, 5);
  await expect(page.getByText("Endret av en annen")).toHaveCount(0);
});

test("velgeren Synkløsning: valget overlever omlasting og er tillatt når alt er lagret", async ({
  page,
}, testInfo) => {
  await logIn(page, ADMIN_EMAIL);
  await page.goto("/prove/testskjema");
  const selector = group(page, "Synkløsning");
  const powersync = selector.getByRole("button", { name: "PowerSync", exact: true });
  const electric = selector.getByRole("button", { name: "ElectricSQL", exact: true });
  await expect(powersync).toHaveAttribute("aria-pressed", "true");
  await expect(electric).toHaveAttribute("aria-pressed", "false");
  await expect(electric).toBeEnabled();
  if (testInfo.project.name === "ipad") {
    for (const button of [powersync, electric]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(indicator(page)).toHaveText(ALL_SAVED);
  await expect(page.getByText(WAIT_TEXT)).toHaveCount(0);

  await Promise.all([page.waitForEvent("load"), electric.click()]);
  await page.waitForLoadState();
  await expect(electric).toHaveAttribute("aria-pressed", "true");
  await expect(powersync).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("trial_sync_candidate"))).toBe(
    "electricsql",
  );
  expect(await hookValue(page, "candidate")).toBe("electricsql");

  await page.reload();
  await expect(electric).toHaveAttribute("aria-pressed", "true");
  expect(await hookValue(page, "candidate")).toBe("electricsql");
});

// Obligatorisk (tap av data)
test("bytte av kandidat sletter ingenting lokalt", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await logIn(page, ADMIN_EMAIL);
  const powersyncForm = await createTrialForm(page);
  expect(await hookValue(page, "candidate")).toBe("powersync");
  await floorsInput(page).fill("7");
  await expectCount(page, 1);
  await expect.poll(async () => (await answerFor(page, powersyncForm, "floors"))?.value).toBe("7");

  const switchTo = async (candidate: TrialSyncCandidate) => {
    await page.goto("/prove/testskjema");
    await page.evaluate((value) => localStorage.setItem("trial_sync_candidate", value), candidate);
    await page.reload();
    expect(await hookValue(page, "candidate")).toBe(candidate);
  };

  await switchTo("electricsql");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  // Eget lager: PowerSync-skjemaet vises ikke her (det nådde aldri serveren uten tjenesten)
  await expect(formLink(page, powersyncForm)).toHaveCount(0);
  const electricForm = await createTrialForm(page);
  expect(electricForm).not.toBe(powersyncForm);

  await switchTo("powersync");
  await expect(formLink(page, powersyncForm)).toBeVisible();
  await formLink(page, powersyncForm).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${powersyncForm}$`));
  await expect(floorsInput(page)).toHaveValue("7");
  await expectCount(page, 1);

  await switchTo("electricsql");
  await expect(formLink(page, electricForm)).toBeVisible();
});

test("uinnlogget gir 401 på shape-ruten", async ({ request }, testInfo) => {
  pcOnly(testInfo);
  const response = await request.get(
    `${SHAPE_ROUTE}?organisasjon=${randomUuid()}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  for (const name of Object.keys(response.headers())) expect(name).not.toMatch(/^electric-/);
});

test("fremmed organisasjon gir 403 på shape-ruten", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
  await logIn(page, ADMIN_EMAIL);
  const response = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${randomUuid()}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toContain("no-store");
  for (const name of Object.keys(response.headers())) expect(name).not.toMatch(/^electric-/);
  await expectErrorMessage(response);
});

test("shape-ruten gir 400 for ukjent tabell og ulovlig offset", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");

  const table = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=users&offset=-1`,
  );
  expect(table.status()).toBe(400);
  await expectErrorMessage(table);

  const offset = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=trial_forms&offset=${encodeURIComponent("../x")}`,
  );
  expect(offset.status()).toBe(400);
  await expectErrorMessage(offset);
});

test("shape-ruten gir 502 uten Electric, med private no-store og uten vert eller hemmelighet i svaret", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  const response = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(502);
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("private, no-store");
  for (const name of ["etag", "age", "expires"]) expect(headers[name], name).toBeUndefined();
  const text = await response.text();
  const body = JSON.parse(text) as { feil?: unknown };
  expect(typeof body.feil).toBe("string");
  expect(text).not.toContain("3010");
  expect(text).not.toContain("localhost:3010");
  expect(text).not.toContain(E2E_ELECTRIC_SECRET);
  for (const value of Object.values(headers)) {
    expect(value).not.toContain(E2E_ELECTRIC_SECRET);
    expect(value).not.toContain("3010");
  }
});

test("shape-ruten kopierer bare tillatte parametre (ingen Electric: 502 betyr at kallet ble gjort)", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  const query = new URLSearchParams({
    organisasjon: organizationId,
    tabell: "trial_forms",
    offset: "-1",
    secret: "x",
    where: "1=1",
    "params[1]": randomUuid(),
    replica: "full",
  });
  const response = await page.request.get(`${SHAPE_ROUTE}?${query.toString()}`);
  // Ignorert, ikke avvist: kallet gikk videre (og feilet fordi Electric ikke kjører)
  expect(response.status()).toBe(502);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("service worker rører ikke shape-ruten", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  await useCandidate(context, "electricsql");
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
  }, `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=trial_forms&offset=-1`);
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
  expect(urls.filter((url) => url.includes("synk/shape"))).toEqual([]);
});
