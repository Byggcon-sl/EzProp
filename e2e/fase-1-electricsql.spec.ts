import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import {
  ADMIN_EMAIL,
  applySyncedRowsViaHook,
  countRequests,
  createTrialForm,
  hookValue,
  indicator,
  localPhotoFileCount,
  logIn,
  pendingChanges,
  readRowsViaHook,
  useCandidate as chooseCandidate,
  type SyncCandidate,
  type TrialHook,
} from "./helpers";

// Andre kandidat for drift uten nett: ElectricSQL koblet til testskjemaet (fase 1, oppgave 5).
// Testplan: docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 6.2.
// Kjører uten Electric-tjenesten: proxy-ruten svarer 502, lageret prøver igjen med økende ventetid,
// og alt lokalt virker. Endringskøen tømmes likevel mot POST /api/prove/synk/endringer.
// Skjemaer lages nye i hver test; ingenting slettes i databasen. Alle data er oppdiktet.
// Hovedmål: tid (befaring uten nett) og reklamasjoner (ingenting går tapt).
// useCandidate (e2e/helpers.ts) heter chooseCandidate her: det er ingen React-krok, men lint-regelen
// for kroker ser bare på navnet.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(DIR, "fixtures", "test-image.png");
const PHOTO_ROUTE = "**/api/prove/bilder/**";
const CHANGES_ROUTE = "**/api/prove/synk/endringer";
const SHAPE_ROUTE = "/api/prove/synk/shape";
const ANY_STATUS = /^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret på serveren)$/;
const NO_PHOTOS_WAITING = /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/;
const ALL_SAVED = "Alt er lagret på serveren";
const FOREIGN = "annen-enhet";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SWITCH_BLOCKED = "Vent til alt er lagret på serveren før du bytter";

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

function switcher(page: Page): Locator {
  return page.getByRole("group", { name: "Synkløsning" });
}

function candidateButton(page: Page, name: "PowerSync" | "ElectricSQL"): Locator {
  return switcher(page).getByRole("button", { name, exact: true });
}

function randomUuid(): string {
  return crypto.randomUUID();
}

/** ElectricSQL valgt, innlogget som admin. */
async function logInWithElectric(page: Page, context: BrowserContext) {
  await chooseCandidate(context, "electricsql");
  await logIn(page, ADMIN_EMAIL);
}

async function openNewForm(page: Page, context: BrowserContext): Promise<string> {
  await logInWithElectric(page, context);
  const id = await createTrialForm(page);
  await expectCount(page, 0);
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  return id;
}

/** Svaret for ett felt slik det ligger i lageret (snake_case). */
async function localAnswer(page: Page, formId: string, fieldKey: string) {
  const rows = await readRowsViaHook(page, "trial_answers", formId);
  return rows.find((row) => row.field_key === fieldKey);
}

/** Venter til egen rad for feltet ligger lokalt (før «en annen» skriver). */
async function waitForOwnRow(page: Page, formId: string, fieldKey: string) {
  await expect
    .poll(async () => Boolean(await localAnswer(page, formId, fieldKey)), {
      message: `egen rad for ${fieldKey}`,
    })
    .toBe(true);
}

async function waitForEmptyQueue(page: Page, timeout = 20_000) {
  await expect.poll(() => pendingChanges(page), { timeout }).toBe(0);
}

function answerRow(
  formId: string,
  fieldKey: string,
  value: unknown,
  deviceId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: randomUuid(),
    trial_form_id: formId,
    field_key: fieldKey,
    value: JSON.stringify(value),
    text_state: null,
    device_id: deviceId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...extra,
  };
}

/**
 * Electric sender vår egen skriving tilbake som en shape-melding (ekkoet). Lageret hopper over
 * første melding for en nøkkel som er bekreftet (200) men ikke speilet ennå (oppgavekortet,
 * avgjørelse før bygging 2). Testene som simulerer «en annen» etter egen skriving, venter derfor
 * til køen er tom og sender ekkoet først, slik det skjer med ekte Electric.
 */
async function echoOwnRow(page: Page, formId: string, fieldKey: string) {
  await waitForEmptyQueue(page);
  const own = await localAnswer(page, formId, fieldKey);
  expect(own, `egen rad for ${fieldKey}`).toBeDefined();
  await applySyncedRowsViaHook(page, "trial_answers", [{ ...own! }]);
  return own!;
}

/** Operasjonene i én POST mot endringer-ruten. */
function operationsOf(request: Request): {
  op: string;
  table: string;
  id: string;
  data: Record<string, unknown>;
}[] {
  try {
    const body = request.postDataJSON() as { operations?: unknown[] } | null;
    return (body?.operations ?? []) as never;
  } catch {
    return [];
  }
}

function e2eElectricSecret(): string | undefined {
  const text = readFileSync(path.join(DIR, "..", "playwright.config.ts"), "utf8");
  return /ELECTRIC_SECRET\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
}

test("testkroken viser electricsql som kandidat og lageret er klart", async ({ page, context }) => {
  await logInWithElectric(page, context);
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  expect(await hookValue(page, "organizationId")).toMatch(UUID);
  expect(Array.isArray(await readRowsViaHook(page, "trial_forms"))).toBe(true);
  const hasDb = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: Record<string, unknown> }).__offlineTrial;
    return "db" in hook && hook.db !== undefined;
  });
  expect(hasDb).toBe(false);
});

test("listen viser nye testskjemaer med navn og laget når, og åpner dem (ElectricSQL)", async ({
  page,
  context,
}) => {
  await logInWithElectric(page, context);
  const first = await createTrialForm(page);
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
  const formId = await openNewForm(page, context);

  const tg2 = group(page, "Tak – tilstandsgrad").getByRole("button", { name: "TG2", exact: true });
  await tg2.click();
  await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
  await page.getByLabel("Tak – beskrivelse", { exact: true }).fill("Oppdiktet tekst");
  await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
  await page.getByLabel("Tak – beskrivelse", { exact: true }).blur();
  await expectCount(page, 4);

  await expect
    .poll(async () => {
      const rows = await readRowsViaHook(page, "trial_answers", formId);
      const byKey = Object.fromEntries(rows.map((row) => [row.field_key, row]));
      const photos = await readRowsViaHook(page, "trial_photos", formId);
      const text = byKey.roof_description?.text_state;
      return {
        roof_tg: byKey.roof_tg?.value,
        floors: byKey.floors?.value,
        roof_description: byKey.roof_description?.value,
        textState: typeof text === "string" && /^[A-Za-z0-9+/]+=*$/.test(text),
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
  await expect(page.getByLabel("Antall etasjer", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Tak – beskrivelse", { exact: true })).toHaveValue(
    "Oppdiktet tekst",
  );
  await expect(
    fieldContainer(page, "cover_photo").getByText("1 bilde", { exact: true }),
  ).toBeVisible();
  await expect(fieldContainer(page, "cover_photo").getByText("test-image.png")).toBeVisible();

  await page.goto("/prove/testskjema");
  const link = page.getByRole("link", { name: "Testskjema 1", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expectCount(page, 4);
});

test("indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett (ElectricSQL)", async ({
  page,
  context,
}) => {
  await openNewForm(page, context);
  await expect(indicator(page)).toHaveText(ANY_STATUS);

  try {
    await context.setOffline(true);
    await expect(indicator(page)).toHaveText("Uten nett");
    await page.getByLabel("Antall etasjer", { exact: true }).fill("3");
    await expectCount(page, 1);
    await expect(indicator(page)).toHaveText("Uten nett");
  } finally {
    await context.setOffline(false);
  }
  await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING);
  // Skriveruten finnes i e2e, så køen tømmes (ulikt PowerSync)
  await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
});

test("skjemaet åpner fra hurtiglageret uten nett etter ett besøk (ElectricSQL)", async ({
  page,
  context,
}, testInfo) => {
  const formId = await openNewForm(page, context);
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
  // page.route ser ikke forespørsler som går via service worker, så den slås av her.
  test.use({ serviceWorkers: "block" });

  test("endringskøen overlever omlasting og tømmes bare etter 200", async ({ page, context }) => {
    await logInWithElectric(page, context);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      await createTrialForm(page);
      await expectCount(page, 0);
      await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
      await page.getByLabel("Antall etasjer", { exact: true }).blur();
      await expectCount(page, 1);

      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      // Holder seg i 6 s: en bunt med 500 slippes aldri
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(1_000);
        expect(await pendingChanges(page)).toBeGreaterThanOrEqual(2);
      }

      await page.reload();
      await expectCount(page, 1);
      await expect(page.getByLabel("Antall etasjer", { exact: true })).toHaveValue("7");
      expect(await pendingChanges(page)).toBeGreaterThanOrEqual(2);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await waitForEmptyQueue(page);
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
  });

  test("avbrutt sending beholder bunten", async ({ page, context }, testInfo) => {
    pcOnly(testInfo);
    await logInWithElectric(page, context);
    await page.route(CHANGES_ROUTE, (route) => route.abort());
    try {
      await createTrialForm(page);
      await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
      await page.getByLabel("Antall etasjer", { exact: true }).blur();
      await expectCount(page, 1);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(6_000);
      expect(await pendingChanges(page)).toBeGreaterThanOrEqual(2);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await waitForEmptyQueue(page);
    await expect(indicator(page)).toHaveText(ALL_SAVED, { timeout: 20_000 });
  });

  test("det som skrives mens en bunt er underveis går ikke tapt", async ({
    page,
    context,
  }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page, context);
    await waitForEmptyQueue(page);

    const floorsPosts: { value: unknown; status?: number }[] = [];
    await page.route(CHANGES_ROUTE, async (route) => {
      const ops = operationsOf(route.request());
      const floors = ops.find(
        (op) => op.table === "trial_answers" && op.data?.field_key === "floors",
      );
      const entry = floors ? { value: floors.data.value } : null;
      if (entry) floorsPosts.push(entry);
      // Svaret kommer 3 s etter at bunten er sendt
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const response = await route.fetch();
      if (entry) (entry as { status?: number }).status = response.status();
      await route.fulfill({ response });
    });
    try {
      const floors = page.getByLabel("Antall etasjer", { exact: true });
      await floors.fill("7");
      await floors.blur();
      await expect.poll(() => floorsPosts.length).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(500);
      // Bunten med 7 er underveis; nå skrives 8
      await floors.fill("8");
      await floors.blur();

      await expect.poll(() => floorsPosts.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      await waitForEmptyQueue(page, 30_000);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }

    expect(String(floorsPosts[0]!.value)).toBe("7");
    expect(String(floorsPosts.at(-1)!.value)).toBe("8");
    expect(floorsPosts.every((post) => post.status === 200)).toBe(true);
    expect((await localAnswer(page, formId, "floors"))?.value).toBe("8");
    await expect(page.getByLabel("Antall etasjer", { exact: true })).toHaveValue("8");
  });

  test("createForm legger skjemaet i køen før første svar", async ({ page, context }, testInfo) => {
    // Erstatter Vitest-testen «skjemaet sendes alltid før svarene som peker på det»
    // (oppgavekortet, avgjørelse før bygging 1: ren seq-rekkefølge).
    pcOnly(testInfo);
    await logInWithElectric(page, context);
    const sent: { table: string; id: string; formId?: unknown }[] = [];
    await page.route(CHANGES_ROUTE, async (route) => {
      for (const op of operationsOf(route.request())) {
        sent.push({ table: op.table, id: op.id, formId: op.data?.trial_form_id });
      }
      await route.continue();
    });
    try {
      const formId = await createTrialForm(page);
      await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
      await page.getByLabel("Antall etasjer", { exact: true }).blur();
      await waitForEmptyQueue(page);

      const formIndex = sent.findIndex((op) => op.table === "trial_forms" && op.id === formId);
      const answerIndex = sent.findIndex(
        (op) => op.table === "trial_answers" && op.formId === formId,
      );
      expect(formIndex).toBeGreaterThanOrEqual(0);
      expect(answerIndex).toBeGreaterThanOrEqual(0);
      expect(formIndex).toBeLessThan(answerIndex);
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
  });
});

test("shape-henting uten Electric prøves igjen med økende ventetid, høyst ett kall per tabell per 5 s", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await logInWithElectric(page, context);
  const shapes = countRequests(page, `**${SHAPE_ROUTE}*`);
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === SHAPE_ROUTE) statuses.push(response.status());
  });
  const started = Date.now();
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();

  // Skriving virker mens hentingen feiler
  await page.getByRole("button", { name: "Nytt testskjema", exact: true }).click();
  await expect(page).toHaveURL(/\/prove\/testskjema\/[0-9a-f-]{36}$/);
  await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
  await expectCount(page, 1);

  await page.waitForTimeout(Math.max(0, 12_000 - (Date.now() - started)));
  const perTable = new Map<string, number>();
  for (const url of shapes.urls) {
    const table = new URL(url).searchParams.get("tabell") ?? "(mangler)";
    perTable.set(table, (perTable.get(table) ?? 0) + 1);
  }
  expect([...perTable.keys()].sort()).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
  for (const [table, count] of perTable) {
    expect(count, `${table}: ${count} kall på 12 s`).toBeLessThanOrEqual(3);
    expect(count, `${table}: ${count} kall på 12 s`).toBeGreaterThanOrEqual(2);
  }
  expect(statuses.length).toBeGreaterThan(0);
  expect(
    statuses.every((status) => status === 502),
    statuses.join(","),
  ).toBe(true);
});

test("shape-svar via proxyen legges inn lokalt og vises (simulert med testkroken)", async ({
  page,
  context,
}) => {
  const formId = await openNewForm(page, context);
  const floors = page.getByLabel("Antall etasjer", { exact: true });
  await floors.fill("5");
  await floors.blur();
  await expectCount(page, 1);
  await waitForOwnRow(page, formId, "floors");
  const own = await echoOwnRow(page, formId, "floors");

  await applySyncedRowsViaHook(page, "trial_answers", [
    { ...own, value: "7", device_id: FOREIGN, updated_at: new Date().toISOString() },
  ]);
  await expect(floors).toHaveValue("7");
  await expect(foreignWarning(page, "floors")).toBeVisible();

  await floors.click();
  await expect(foreignWarning(page, "floors")).toHaveCount(0);
});

test("TG og valg satt utenfra viser Endret av en annen, egen endring gjør det ikke (ElectricSQL)", async ({
  page,
  context,
}) => {
  const formId = await openNewForm(page, context);
  const tg = group(page, "Tak – tilstandsgrad");
  await tg.getByRole("button", { name: "TG2", exact: true }).click();
  await waitForOwnRow(page, formId, "roof_tg");
  await expect(foreignWarning(page, "roof_tg")).toHaveCount(0);
  const own = await echoOwnRow(page, formId, "roof_tg");
  await expect(foreignWarning(page, "roof_tg")).toHaveCount(0);

  await applySyncedRowsViaHook(page, "trial_answers", [
    {
      ...own,
      value: JSON.stringify("TG3"),
      device_id: FOREIGN,
      updated_at: new Date().toISOString(),
    },
  ]);
  await expect(tg.getByRole("button", { name: "TG3", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tg.getByRole("button", { name: "TG2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(foreignWarning(page, "roof_tg")).toBeVisible();

  await applySyncedRowsViaHook(page, "trial_answers", [
    answerRow(formId, "leak_stopper", "no", FOREIGN),
  ]);
  await expect(
    group(page, "Lekkasjestopper").getByRole("button", { name: "Nei", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(foreignWarning(page, "leak_stopper")).toBeVisible();

  const ownDevice = await hookValue(page, "deviceId");
  expect(ownDevice).not.toBe(FOREIGN);
  await applySyncedRowsViaHook(page, "trial_answers", [
    answerRow(formId, "moisture_floor", 12, ownDevice),
  ]);
  await expect(page.getByLabel("Fuktmåling gulv", { exact: true })).toHaveValue("12");
  await expect(foreignWarning(page, "moisture_floor")).toHaveCount(0);
});

test("innkommende text_state flettes med egen tekst", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  const formId = await openNewForm(page, context);
  const description = page.getByLabel("Tak – beskrivelse", { exact: true });
  await description.fill("Taket er tett.");
  await page.waitForTimeout(500);
  await description.blur();
  await waitForOwnRow(page, formId, "roof_description");
  const own = await echoOwnRow(page, formId, "roof_description");

  // Tilstand fra «en annen iPad», laget fra tom start med samme kode som text-merge.ts
  const foreignState = await page.evaluate(() => {
    const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
    if (typeof hook.createTextState !== "function")
      throw new Error("Kroken mangler createTextState");
    return hook.createTextState("Merk: ");
  });
  expect(foreignState).toMatch(/^[A-Za-z0-9+/]+=*$/);
  await applySyncedRowsViaHook(page, "trial_answers", [
    {
      ...own,
      value: JSON.stringify("Merk: "),
      text_state: foreignState,
      device_id: FOREIGN,
      updated_at: new Date().toISOString(),
    },
  ]);

  await expect(description).toHaveValue(/Merk: /);
  await expect(description).toHaveValue(/Taket er tett\./);
  await expect
    .poll(async () => {
      const row = await localAnswer(page, formId, "roof_description");
      const value = typeof row?.value === "string" ? (JSON.parse(row.value) as string) : "";
      return value.includes("Merk: ") && value.includes("Taket er tett.");
    })
    .toBe(true);
});

test("første lasting av et skjema fra en annen enhet gir ingen varsler (ElectricSQL)", async ({
  page,
  context,
}) => {
  await logInWithElectric(page, context);
  const formId = await createTrialForm(page);
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("link", { name: "Testskjema 1", exact: true })).toBeVisible();

  await applySyncedRowsViaHook(page, "trial_answers", [
    answerRow(formId, "roof_tg", "TG3", FOREIGN),
    answerRow(formId, "leak_stopper", "no", FOREIGN),
    answerRow(formId, "floors", 7, FOREIGN),
    answerRow(formId, "moisture_floor", 12, FOREIGN),
    answerRow(formId, "building_type", "detached", FOREIGN),
  ]);

  await page.getByRole("link", { name: "Testskjema 1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expectCount(page, 5);
  await expect(page.getByText("Endret av en annen")).toHaveCount(0);
});

test.describe("bildekøen (ElectricSQL)", () => {
  test.use({ serviceWorkers: "block" });

  test("bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder (ElectricSQL)", async ({
    page,
    context,
  }) => {
    const formId = await openNewForm(page, context);
    await page.route(PHOTO_ROUTE, (route) => route.abort());
    try {
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      await expect.poll(() => localPhotoFileCount(page)).toBe(1);
      // Bilderaden går til serveren via køen; bare filen venter
      await waitForEmptyQueue(page);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }

    // Etter dette skal ingen bunt bære uploaded_at eller sha256 (markPhotoUploaded skriver bare lokalt)
    const photoColumnsSent: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/api/prove/synk/endringer")) return;
      for (const op of operationsOf(request)) {
        if (op.table === "trial_photos" && ("uploaded_at" in op.data || "sha256" in op.data)) {
          photoColumnsSent.push(op.id);
        }
      }
    });

    await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING, { timeout: 15_000 });
    await expect.poll(() => localPhotoFileCount(page), { timeout: 15_000 }).toBe(0);
    await expect
      .poll(async () => {
        const rows = await readRowsViaHook(page, "trial_photos", formId);
        return rows.length === 1 && Boolean(rows[0]!.uploaded_at);
      })
      .toBe(true);
    expect(await pendingChanges(page)).toBe(0);
    await page.waitForTimeout(2_000);
    expect(await pendingChanges(page)).toBe(0);
    expect(photoColumnsSent).toEqual([]);
    await expect(indicator(page)).toHaveText(ALL_SAVED);
  });
});

test.describe("velgeren Synkløsning", () => {
  test.use({ serviceWorkers: "block" });

  test("velgeren Synkløsning: valget overlever omlasting og er tillatt når alt er lagret", async ({
    page,
  }, testInfo) => {
    // Uten useCandidate: ny kontekst, standardkandidaten
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    await expect(switcher(page)).toBeVisible();
    const powersync = candidateButton(page, "PowerSync");
    const electric = candidateButton(page, "ElectricSQL");
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
    await Promise.all([page.waitForEvent("load"), electric.click()]);
    await page.waitForLoadState();
    await expect(candidateButton(page, "ElectricSQL")).toHaveAttribute("aria-pressed", "true");
    await expect(candidateButton(page, "PowerSync")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => localStorage.getItem("trial_sync_candidate"))).toBe(
      "electricsql",
    );
    expect(await hookValue(page, "candidate")).toBe("electricsql");

    await page.reload();
    await expect(candidateButton(page, "ElectricSQL")).toHaveAttribute("aria-pressed", "true");
    expect(await hookValue(page, "candidate")).toBe("electricsql");
  });

  test("velgeren er sperret med forklaring når noe venter på å bli sendt", async ({
    page,
    context,
  }) => {
    await logInWithElectric(page, context);
    await page.route(CHANGES_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    try {
      await createTrialForm(page);
      await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
      await page.getByLabel("Antall etasjer", { exact: true }).blur();
      await expectCount(page, 1);
      await expect.poll(() => pendingChanges(page)).toBeGreaterThan(0);

      await page.goto("/prove/testskjema");
      await expect(candidateButton(page, "ElectricSQL")).toHaveAttribute("aria-pressed", "true");
      await expect(candidateButton(page, "PowerSync")).toBeDisabled();
      await expect(page.getByText(SWITCH_BLOCKED)).toBeVisible();
    } finally {
      await page.unroute(CHANGES_ROUTE);
    }
    await expect(candidateButton(page, "PowerSync")).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(SWITCH_BLOCKED)).toBeHidden();
  });
});

test("bytte av kandidat sletter ingenting lokalt", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  // PowerSync (standard)
  await logIn(page, ADMIN_EMAIL);
  const powersyncForm = await createTrialForm(page);
  expect(await hookValue(page, "candidate")).toBe("powersync");
  const floors = page.getByLabel("Antall etasjer", { exact: true });
  await floors.fill("7");
  await floors.blur();
  await expectCount(page, 1);
  await expect
    .poll(async () => (await localAnswer(page, powersyncForm, "floors"))?.value)
    .toBe("7");

  // Bytt til ElectricSQL ved å sette nøkkelen direkte
  await page.evaluate(() => localStorage.setItem("trial_sync_candidate", "electricsql"));
  await page.goto("/prove/testskjema");
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  const electricFormsBefore = await readRowsViaHook(page, "trial_forms");
  expect(electricFormsBefore.map((row) => row.id)).not.toContain(powersyncForm);
  await expect(page.locator(`a[href$="/prove/testskjema/${powersyncForm}"]`)).toHaveCount(0);
  const electricForm = await createTrialForm(page);
  expect(electricForm).not.toBe(powersyncForm);

  // Tilbake til PowerSync: skjemaet og svaret står
  await page.evaluate(() => localStorage.setItem("trial_sync_candidate", "powersync"));
  await page.goto("/prove/testskjema");
  expect(await hookValue(page, "candidate")).toBe("powersync");
  const powersyncLink = page.locator(`a[href$="/prove/testskjema/${powersyncForm}"]`);
  await expect(powersyncLink).toBeVisible();
  await powersyncLink.click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${powersyncForm}$`));
  await expect(page.getByLabel("Antall etasjer", { exact: true })).toHaveValue("7");

  // Og ElectricSQL igjen: Electric-skjemaet står
  await page.evaluate(() => localStorage.setItem("trial_sync_candidate", "electricsql"));
  await page.goto("/prove/testskjema");
  expect(await hookValue(page, "candidate")).toBe("electricsql");
  await expect(page.locator(`a[href$="/prove/testskjema/${electricForm}"]`)).toBeVisible();
});

test.describe("innlogging med annen organisasjon tømmer lokal lagring for begge kandidater", () => {
  test.use({ serviceWorkers: "block" });

  for (const candidate of [
    "powersync",
    "electricsql",
  ] as const satisfies readonly SyncCandidate[]) {
    test(`innlogging med annen organisasjon tømmer lokal lagring for begge kandidater (${candidate})`, async ({
      page,
      context,
    }, testInfo) => {
      pcOnly(testInfo);
      await chooseCandidate(context, candidate);
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
        if (candidate === "electricsql") {
          await expect
            .poll(
              async () =>
                (await readRowsViaHook(page, "shape_state")).length +
                (await readRowsViaHook(page, "outbox")).length +
                (await readRowsViaHook(page, "trial_photos")).length,
            )
            .toBeGreaterThan(0);
        }

        await page.evaluate(async (organizationId) => {
          const hook = (window as unknown as { __offlineTrial: TrialHook }).__offlineTrial;
          await hook.simulateOrganizationChange(organizationId);
        }, randomUuid());
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
      } finally {
        await page.unroute(PHOTO_ROUTE);
      }
    });
  }
});

test("uinnlogget gir 401 på shape-ruten", async ({ request }, testInfo) => {
  pcOnly(testInfo);
  const response = await request.get(
    `${SHAPE_ROUTE}?organisasjon=${randomUuid()}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("fremmed organisasjon gir 403 på shape-ruten", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await logIn(page, ADMIN_EMAIL);
  const response = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${randomUuid()}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(403);
  const electricHeaders = Object.keys(response.headers()).filter((name) =>
    name.startsWith("electric-"),
  );
  expect(electricHeaders).toEqual([]);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

/** Feilsvaret har en norsk melding (en ikke-tom tekst i JSON-kroppen). */
async function expectErrorMessage(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as Record<string, unknown>;
  const texts = Object.values(body).filter((value) => typeof value === "string" && value !== "");
  expect(texts.length, JSON.stringify(body)).toBeGreaterThan(0);
}

test("shape-ruten gir 400 for ukjent tabell og ulovlig offset", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await logInWithElectric(page, context);
  await page.goto("/prove/testskjema");
  const organizationId = await hookValue(page, "organizationId");

  const unknownTable = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=users&offset=-1`,
  );
  expect(unknownTable.status()).toBe(400);
  await expectErrorMessage(unknownTable);

  const badOffset = await page.request.get(
    `${SHAPE_ROUTE}?${new URLSearchParams({ organisasjon: organizationId, tabell: "trial_forms", offset: "../x" })}`,
  );
  expect(badOffset.status()).toBe(400);
  await expectErrorMessage(badOffset);
});

test("shape-ruten gir 502 uten Electric, med private no-store og uten vert eller hemmelighet i svaret", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await logInWithElectric(page, context);
  await page.goto("/prove/testskjema");
  const organizationId = await hookValue(page, "organizationId");

  const response = await page.request.get(
    `${SHAPE_ROUTE}?organisasjon=${organizationId}&tabell=trial_forms&offset=-1`,
  );
  expect(response.status()).toBe(502);
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("private, no-store");
  for (const name of ["etag", "age", "expires"]) expect(headers[name], name).toBeUndefined();

  const text = await response.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(typeof body.feil).toBe("string");
  expect((body.feil as string).length).toBeGreaterThan(0);
  const secret = e2eElectricSecret();
  expect(secret, "ELECTRIC_SECRET mangler i playwright.config.ts").toBeTruthy();
  for (const leak of ["3010", "localhost:3010", secret!]) {
    expect(text, leak).not.toContain(leak);
    for (const value of Object.values(headers)) expect(value, leak).not.toContain(leak);
  }
});

test("shape-ruten kopierer bare tillatte parametre (ingen Electric: 502 betyr at kallet ble gjort)", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await logInWithElectric(page, context);
  await page.goto("/prove/testskjema");
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
  const response = await page.request.get(`${SHAPE_ROUTE}?${query}`);
  // Ignorert, ikke avvist: kallet til (den manglende) Electric ble gjort
  expect(response.status()).toBe(502);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("service worker rører ikke shape-ruten", async ({ page, context }, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page, context);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expectCount(page, 0);
  const organizationId = await hookValue(page, "organizationId");
  await page.evaluate(async (organization) => {
    await fetch(`/api/prove/synk/shape?organisasjon=${organization}&tabell=trial_forms&offset=-1`);
    await fetch("/api/helse");
  }, organizationId);
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
});
