import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  createTrialForm,
  hookValue,
  indicator,
  localPhotoFileCount,
  logIn,
  queryLocal,
  setAnswerViaHook,
  type OfflineTrialHook,
} from "./helpers";

// Første kandidat for drift uten nett: PowerSync koblet til testskjemaet (fase 1, oppgave 4).
// Testplan: docs/funksjoner/fase1-kandidat-powersync-testplan.md avsnitt 6.2.
// Kjører uten PowerSync-tjenesten: koblingen feiler stille, den lokale databasen virker.
// Skjemaer lages nye i hver test; ingenting slettes i databasen.

const TEST_IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "test-image.png",
);
const PHOTO_ROUTE = "**/api/prove/bilder/**";
const ANY_STATUS = /^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret på serveren)$/;
const NO_PHOTOS_WAITING = /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/;
const FOREIGN = "annen-enhet";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expectCount(page, 0);
  return id;
}

/** Venter til egen rad for feltet ligger i den lokale databasen (før «en annen» skriver). */
async function waitForOwnRow(page: Page, formId: string, fieldKey: string) {
  await expect
    .poll(
      async () =>
        (
          await queryLocal(
            page,
            "SELECT id FROM trial_answers WHERE trial_form_id = ? AND field_key = ?",
            [formId, fieldKey],
          )
        ).length,
      { message: `egen rad for ${fieldKey}` },
    )
    .toBe(1);
}

function randomUuid(): string {
  return crypto.randomUUID();
}

test("listen viser nye testskjemaer med navn og laget når, og åpner dem", async ({ page }) => {
  await logIn(page, ADMIN_EMAIL);
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
    // «Laget når» står ved siden av navnet
    const row = link.locator("xpath=..");
    const rest = (await row.innerText()).replace(name, "").trim();
    expect(rest, `tidsangivelse for ${name}`).not.toBe("");
  }

  await one.click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${first}$`));
  await expectCount(page, 0);
});

test("svarene overlever at siden lastes på nytt uten server", async ({ page }) => {
  const formId = await openNewForm(page);

  const tg2 = group(page, "Tak – tilstandsgrad").getByRole("button", { name: "TG2", exact: true });
  await tg2.click();
  await page.getByLabel("Antall etasjer", { exact: true }).fill("7");
  await page.getByLabel("Tak – beskrivelse", { exact: true }).fill("Oppdiktet tekst");
  await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
  await page.getByLabel("Tak – beskrivelse", { exact: true }).blur();
  await expectCount(page, 4);

  // Alt ligger lokalt før siden lastes på nytt (tekst skrives litt etter siste tastetrykk)
  await expect
    .poll(async () => {
      const rows = await queryLocal<{ field_key: string; value: string }>(
        page,
        "SELECT field_key, value FROM trial_answers WHERE trial_form_id = ?",
        [formId],
      );
      const byKey = Object.fromEntries(rows.map((row) => [row.field_key, row.value]));
      const photos = await queryLocal(page, "SELECT id FROM trial_photos WHERE trial_form_id = ?", [
        formId,
      ]);
      return {
        roof_tg: byKey.roof_tg,
        floors: byKey.floors,
        roof_description: byKey.roof_description,
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

test("indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett", async ({
  page,
  context,
}) => {
  await openNewForm(page);
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
  // Uten tjeneste i e2e blir antall endringer aldri 0, men bildene skal være 0
  await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING);
});

test.describe("bildekøen", () => {
  // page.route ser ikke forespørsler som går via service worker, så den slås av her.
  // Service worker testes for seg nedenfor.
  test.use({ serviceWorkers: "block" });

  test("indikatoren bøyer entall og flertall riktig", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    const formId = await openNewForm(page);
    const hasOverride = await page.evaluate(() => {
      const hook = (window as unknown as { __offlineTrial?: OfflineTrialHook }).__offlineTrial;
      return Boolean(hook && "pendingOverride" in hook);
    });

    if (hasOverride) {
      testInfo.annotations.push({ type: "vei", description: "testkroken pendingOverride" });
      const cases: [number, number, string][] = [
        [1, 1, "Venter: 1 endring, 1 bilde"],
        [2, 1, "Venter: 2 endringer, 1 bilde"],
        [1, 2, "Venter: 1 endring, 2 bilder"],
        [2, 0, "Venter: 2 endringer, 0 bilder"],
      ];
      for (const [changes, photos, text] of cases) {
        await page.evaluate(
          (override) => {
            const hook = (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial;
            hook.pendingOverride = override;
          },
          { changes, photos },
        );
        await expect(indicator(page)).toHaveText(text);
      }
      await page.evaluate(() => {
        (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial.pendingOverride =
          null;
      });
      return;
    }

    // Uten overstyring: regn ut fra faktisk kø (SDK-ens ps_crud) med opplasting av bilder stoppet
    testInfo.annotations.push({
      type: "vei",
      description: "faktisk kø; «1 endring» i entall kan ikke nås uten pendingOverride",
    });
    await page.route(PHOTO_ROUTE, (route) => route.abort());
    try {
      await page.getByLabel("Antall etasjer", { exact: true }).fill("2");
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      await expect
        .poll(async () => {
          const [row] = await queryLocal<{ n: number }>(page, "SELECT count(*) AS n FROM ps_crud");
          const n = Number(row?.n ?? -1);
          const text = (await indicator(page).innerText()).trim();
          return text === `Venter: ${n} ${n === 1 ? "endring" : "endringer"}, 1 bilde`;
        })
        .toBe(true);
      await page.getByLabel("Byggeår", { exact: true }).fill("1985");
      await expect(indicator(page)).toHaveText(/^Venter: \d+ endringer, 1 bilde$/);
      expect(formId).toMatch(UUID);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }
  });

  test("bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder", async ({
    page,
  }) => {
    const formId = await openNewForm(page);
    // Ruten blir stående til slutt; bryteren slipper opplastingene gjennom. page.unroute midt i en
    // opplasting kan la forespørselen henge uten svar (fanget, men aldri behandlet).
    let blockPhotos = true;
    await page.route(PHOTO_ROUTE, (route) => (blockPhotos ? route.abort() : route.fallback()));
    try {
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      await expect.poll(() => localPhotoFileCount(page)).toBe(1);

      blockPhotos = false;
      await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING, { timeout: 15_000 });
      await expect.poll(() => localPhotoFileCount(page), { timeout: 15_000 }).toBe(0);
      await expect
        .poll(async () => {
          const rows = await queryLocal<{ uploaded_at: string | null }>(
            page,
            "SELECT uploaded_at FROM trial_photos WHERE trial_form_id = ?",
            [formId],
          );
          // Småfunn 6: bare serveren setter uploaded_at. Uten synktjeneste i e2e forblir den tom
          // lokalt, men bildet regnes ikke som ventende fordi serveren har bekreftet filen.
          return rows.length === 1 && rows[0]!.uploaded_at === null;
        })
        .toBe(true);
      await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }
  });

  test("bildet beholdes lokalt når serveren svarer med feil sha256", async ({ page }, testInfo) => {
    pcOnly(testInfo);
    await openNewForm(page);
    let attempts = 0;
    await page.route(PHOTO_ROUTE, (route) => {
      attempts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sha256: "0".repeat(64) }),
      });
    });
    try {
      await page.getByLabel("Forsidebilde", { exact: true }).setInputFiles(TEST_IMAGE);
      // Opplasteren har prøvd, men serveren bekreftet et annet fingeravtrykk
      await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(1_000);
      await expect(indicator(page)).toHaveText(/, 1 bilde$/);
      expect(await localPhotoFileCount(page)).toBe(1);
    } finally {
      await page.unroute(PHOTO_ROUTE);
    }
  });
});

test("skjemaet åpner fra hurtiglageret uten nett etter ett besøk", async ({
  page,
  context,
}, testInfo) => {
  const formId = await openNewForm(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Siden må styres av service worker før den kan åpnes uten nett
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
  // Reserve (testplan 6.2): skriptene og skjemasiden ligger i hurtiglageret
  await page.goto(`/prove/testskjema/${formId}`);
  const cached = await page.evaluate(async (script) => {
    const scriptHit = await caches.match(script);
    const pageHit = await caches.match(location.pathname);
    return { script: Boolean(scriptHit), page: Boolean(pageHit) };
  }, scriptUrl!);
  expect(cached).toEqual({ script: true, page: true });
});

test("tall satt utenfra via testkroken vises i feltet med Endret av en annen", async ({ page }) => {
  const formId = await openNewForm(page);
  const floors = page.getByLabel("Antall etasjer", { exact: true });
  await floors.fill("5");
  await floors.blur();
  await expectCount(page, 1);
  await waitForOwnRow(page, formId, "floors");

  await setAnswerViaHook(page, formId, "floors", 7, FOREIGN);
  await expect(floors).toHaveValue("7");
  await expect(foreignWarning(page, "floors")).toBeVisible({ timeout: 15_000 });

  await floors.click();
  await expect(foreignWarning(page, "floors")).toHaveCount(0);
});

test("TG og valg satt utenfra viser Endret av en annen, egen endring gjør det ikke", async ({
  page,
}) => {
  const formId = await openNewForm(page);
  const tg = group(page, "Tak – tilstandsgrad");
  await tg.getByRole("button", { name: "TG2", exact: true }).click();
  // Siden må ha vist egen rad (telleren leser lagrede svar) før «en annen» skriver; ellers kan
  // begge skrivingene komme i samme varsel fra databasen og se ut som første lasting.
  await expectCount(page, 1);
  await waitForOwnRow(page, formId, "roof_tg");
  await expect(foreignWarning(page, "roof_tg")).toHaveCount(0);

  await setAnswerViaHook(page, formId, "roof_tg", "TG3", FOREIGN);
  await expect(tg.getByRole("button", { name: "TG3", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tg.getByRole("button", { name: "TG2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(foreignWarning(page, "roof_tg")).toBeVisible({ timeout: 15_000 });

  await setAnswerViaHook(page, formId, "leak_stopper", "no", FOREIGN);
  await expect(
    group(page, "Lekkasjestopper").getByRole("button", { name: "Nei", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(foreignWarning(page, "leak_stopper")).toBeVisible({ timeout: 15_000 });

  const ownDevice = await hookValue(page, "deviceId");
  expect(ownDevice).not.toBe(FOREIGN);
  await setAnswerViaHook(page, formId, "moisture_floor", 12, ownDevice);
  await expect(page.getByLabel("Fuktmåling gulv", { exact: true })).toHaveValue("12");
  await expect(foreignWarning(page, "moisture_floor")).toHaveCount(0);
});

test("tekstfelt satt utenfra gir ikke varsel, men viser teksten", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  const formId = await openNewForm(page);
  // Egen rad først, så det ikke er «første lasting»
  await group(page, "Tak – tilstandsgrad")
    .getByRole("button", { name: "TG1", exact: true })
    .click();
  await waitForOwnRow(page, formId, "roof_tg");

  await setAnswerViaHook(page, formId, "roof_description", "Oppdiktet tekst fra en annen", FOREIGN);
  await expect(page.getByLabel("Tak – beskrivelse", { exact: true })).toHaveValue(
    "Oppdiktet tekst fra en annen",
  );
  await expect(
    fieldContainer(page, "roof_description").getByText("Endret av en annen"),
  ).toHaveCount(0);
});

test("tekst skrevet i feltet lagres med text_state i lokal database", async ({
  page,
}, testInfo) => {
  pcOnly(testInfo);
  const formId = await openNewForm(page);
  await page.getByLabel("Tak – beskrivelse", { exact: true }).fill("Oppdiktet tekst");
  await page.waitForTimeout(500);

  await expect
    .poll(async () => {
      const [row] = await queryLocal<{ value: string | null; text_state: string | null }>(
        page,
        "SELECT value, text_state FROM trial_answers WHERE trial_form_id = ? AND field_key = ?",
        [formId, "roof_description"],
      );
      return {
        value: row?.value ?? null,
        textState: /^[A-Za-z0-9+/]+=*$/.test(row?.text_state ?? ""),
      };
    })
    .toEqual({ value: JSON.stringify("Oppdiktet tekst"), textState: true });
});

test("første lasting av et skjema fra en annen enhet gir ingen varsler", async ({ page }) => {
  await logIn(page, ADMIN_EMAIL);
  const formId = await createTrialForm(page);
  await page.goto("/prove/testskjema");
  await expect(page.getByRole("link", { name: "Testskjema 1", exact: true })).toBeVisible();

  // Fem svar «fra en annen iPad» før skjemaet åpnes
  await setAnswerViaHook(page, formId, "roof_tg", "TG3", FOREIGN);
  await setAnswerViaHook(page, formId, "leak_stopper", "no", FOREIGN);
  await setAnswerViaHook(page, formId, "floors", 7, FOREIGN);
  await setAnswerViaHook(page, formId, "moisture_floor", 12, FOREIGN);
  await setAnswerViaHook(page, formId, "building_type", "detached", FOREIGN);

  await page.getByRole("link", { name: "Testskjema 1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/prove/testskjema/${formId}$`));
  await expectCount(page, 5);
  await expect(page.getByText("Endret av en annen")).toHaveCount(0);
});

test("uinnlogget gir 401 på alle tre synkrutene", async ({ request }, testInfo) => {
  pcOnly(testInfo);
  const organization = randomUuid();
  const token = await request.get(`/api/prove/synk/token?organisasjon=${organization}`);
  expect(token.status()).toBe(401);
  expect(await token.text()).not.toMatch(/"token"/);

  const changes = await request.post("/api/prove/synk/endringer", {
    data: { organizationId: organization, operations: [] },
  });
  expect(changes.status()).toBe(401);

  const photo = await request.put(
    `/api/prove/bilder/${randomUuid()}?organisasjon=${organization}&skjema=${randomUuid()}&felt=cover_photo&navn=a.png&bytes=3`,
    { headers: { "Content-Type": "image/png" }, data: Buffer.from([1, 2, 3]) },
  );
  expect(photo.status()).toBe(401);
});

test("fremmed organisasjon gir 403 på alle tre synkrutene", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await logIn(page, ADMIN_EMAIL);
  const foreign = randomUuid();

  const token = await page.request.get(`/api/prove/synk/token?organisasjon=${foreign}`);
  expect(token.status()).toBe(403);
  const tokenBody = await token.text();
  expect(tokenBody).not.toMatch(/"token"/);

  const changes = await page.request.post("/api/prove/synk/endringer", {
    data: {
      organizationId: foreign,
      operations: [
        { op: "PUT", table: "trial_forms", id: randomUuid(), data: { name: "Oppdiktet" } },
      ],
    },
  });
  expect(changes.status()).toBe(403);

  const photo = await page.request.put(
    `/api/prove/bilder/${randomUuid()}?organisasjon=${foreign}&skjema=${randomUuid()}&felt=cover_photo&navn=a.png&bytes=3`,
    { headers: { "Content-Type": "image/png" }, data: Buffer.from([1, 2, 3]) },
  );
  expect(photo.status()).toBe(403);
});

test("token-ruten svarer med no-store og et token for egen organisasjon", async ({
  page,
}, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  expect(organizationId).toMatch(UUID);

  const response = await page.request.get(`/api/prove/synk/token?organisasjon=${organizationId}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = (await response.json()) as { token?: string; endpoint?: string };
  expect(body.endpoint).toBeTruthy();
  const parts = (body.token ?? "").split(".");
  expect(parts).toHaveLength(3);
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  expect(payload.organization_id).toBe(organizationId);
  expect(payload.aud).toBe("powersync");
  expect(payload).not.toHaveProperty("email");
  expect(JSON.stringify(payload)).not.toContain(ADMIN_EMAIL);
});

async function postChanges(page: Page, organizationId: string, operations: unknown[]) {
  return page.request.post("/api/prove/synk/endringer", { data: { organizationId, operations } });
}

/** Feilsvaret har en norsk melding (en ikke-tom tekst i JSON-kroppen). */
async function expectErrorMessage(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as Record<string, unknown>;
  const texts = Object.values(body).filter((value) => typeof value === "string" && value !== "");
  expect(texts.length, JSON.stringify(body)).toBeGreaterThan(0);
}

test("endringer-ruten gir 400 for DELETE og ukjent felt", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");

  const formId = randomUuid();
  const created = await postChanges(page, organizationId, [
    { op: "PUT", table: "trial_forms", id: formId, data: { name: "Oppdiktet e2e-skjema" } },
  ]);
  expect(created.status()).toBe(200);
  expect(await created.json()).toEqual({ applied: 1 });

  const deleted = await postChanges(page, organizationId, [
    { op: "DELETE", table: "trial_forms", id: formId, data: {} },
  ]);
  expect(deleted.status()).toBe(400);
  await expectErrorMessage(deleted);

  const unknownField = await postChanges(page, organizationId, [
    {
      op: "PUT",
      table: "trial_answers",
      id: randomUuid(),
      data: {
        trial_form_id: formId,
        field_key: "unknown_key",
        value: JSON.stringify("x"),
        device_id: "e2e",
      },
    },
  ]);
  expect(unknownField.status()).toBe(400);
  await expectErrorMessage(unknownField);
});

test("bilder-ruten gir 404 for ugyldig id og 400 for feil innholdstype", async ({
  page,
}, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  const formId = randomUuid();
  const created = await postChanges(page, organizationId, [
    { op: "PUT", table: "trial_forms", id: formId, data: { name: "Oppdiktet e2e-skjema" } },
  ]);
  expect(created.status()).toBe(200);
  const query = `organisasjon=${organizationId}&skjema=${formId}&felt=cover_photo&navn=a.png&bytes=3`;

  const badId = await page.request.put(`/api/prove/bilder/ikke-en-uuid?${query}`, {
    headers: { "Content-Type": "image/png" },
    data: Buffer.from([1, 2, 3]),
  });
  expect(badId.status()).toBe(404);

  const badType = await page.request.put(`/api/prove/bilder/${randomUuid()}?${query}`, {
    headers: { "Content-Type": "text/plain" },
    data: "oppdiktet",
  });
  expect(badType.status()).toBe(400);
});

test("service worker rører ikke API og innlogging", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expectCount(page, 0);
  // Noe trafikk mot API og innlogging mens siden styres av service worker
  await page.evaluate(async () => {
    await fetch("/api/helse");
    await fetch("/logg-inn");
    await fetch("/dev/epost");
  });
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
  const forbidden = urls.filter((url) => /^\/(api\/|logg-inn|dev\/)/.test(url));
  expect(forbidden).toEqual([]);
});

test("innlogging med annen organisasjon tømmer lokal database", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  await expect
    .poll(async () => (await queryLocal(page, "SELECT id FROM trial_forms")).length)
    .toBe(1);

  const other = randomUuid();
  const usedHook = await page.evaluate(async (organizationId) => {
    const hook = (window as unknown as { __offlineTrial: OfflineTrialHook }).__offlineTrial;
    if (typeof hook.simulateOrganizationChange === "function") {
      await hook.simulateOrganizationChange(organizationId);
      return true;
    }
    localStorage.setItem("trial_last_organization_id", organizationId);
    return false;
  }, other);
  testInfo.annotations.push({
    type: "vei",
    description: usedHook
      ? "simulateOrganizationChange"
      : "localStorage.trial_last_organization_id",
  });

  await page.reload();
  await expect
    .poll(async () => (await queryLocal(page, "SELECT id FROM trial_forms")).length, {
      timeout: 15_000,
    })
    .toBe(0);
});
