import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { PHOTO_UPLOAD_INTERVAL_MS } from "../src/modules/offline-trial/sync/photo-uploader";
import { TRIAL_LAST_ORGANIZATION_KEY } from "../src/modules/offline-trial/sync/types";
import {
  ADMIN_EMAIL,
  createTrialForm,
  decodeInPage,
  hookValue,
  indicator,
  jpegMarkers,
  localConfirmedKeys,
  localDisplayCopyCount,
  localPhotoFileCount,
  logIn,
  logInAsInspector,
  readRowsViaHook,
  syncNowButton,
  sha256Bytes,
  sha256File,
  trialUploadPath,
  viewFromServerLink,
  waitForTrialHook,
} from "./helpers";

// Prøve D – bilder (docs/funksjoner/fase1-prove-d-bilder.md). Testplan:
// docs/funksjoner/fase1-prove-d-bilder-testplan.md avsnitt 5. Støtter reklamasjoner (originalen
// kommer fram med samme fingeravtrykk, visningskopien står riktig vei og har aldri GPS eller annen
// metadata, iPaden sletter aldri før serveren har bekreftet) og tid (alt skjer av seg selv: ingen
// knapp, nytt forsøk etter brudd). Kandidaten egenbygd, som ikke trenger synktjenester. Admin er
// innlogget unntatt i testen for takstmann. Hver test har egen kontekst (ny IndexedDB) og eget
// testskjema. Serveren sjekkes på disk under TRIAL_UPLOAD_DIR fra playwright.config.ts;
// fingeravtrykket regnes her fra fixture-bytene, aldri fra noe appen har regnet.
//
// Fixturene (e2e/fixtures/, oppdiktet, ingen ekte bilder, ingen personer, GPS 0,0) ble laget én
// gang i en midlertidig mappe utenfor repoet med Python og Pillow:
//
//   img = Image.new("RGB", (64, 32), (255, 255, 255))      # 64x32 lagrede piksler, hvit
//   for x in range(16): for y in range(16): img.putpixel((x, y), (255, 0, 0))  # rødt 16x16 i (0,0)
//   exif = Image.Exif(); exif[0x0112] = 6                   # Orientation = 6
//   gps = exif.get_ifd(0x8825)                              # GPS-IFD
//   gps[1] = "N"; gps[2] = (0.0, 0.0, 0.0); gps[3] = "E"; gps[4] = (0.0, 0.0, 0.0)
//   img.save("test-photo-rotated.jpg", "JPEG", quality=95, subsampling=0, exif=exif)
//
//   test-photo.heic: en `ftyp`-boks med merket `heic` (kompatible `mif1`, `heic`) og en `mdat`-boks
//   med teksten «oppdiktet-heic-innhold-ikke-et-bilde» fire ganger. 176 byte; Chromium kan ikke
//   dekode den.
//
// Sjekk før innsjekking (ImageMagick `identify -verbose`): Orientation RightTop, GPSLatitude
// 0/1,0/1,0/1 N, GPSLongitude 0/1,0/1,0/1 E, ingen dato, modell eller serienummer.
//
// Ekte HEIC fra kameraet, ekte rotering, flymodus og brudd midt i en fil prøves på ekte iPad
// (docs/funksjoner/fase1-prove-d-bilder-resultat.md, D1–D5).

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const ROTATED = path.join(FIXTURES, "test-photo-rotated.jpg");
const HEIC = path.join(FIXTURES, "test-photo.heic");
const PNG = path.join(FIXTURES, "test-image.png");
const ROTATED_BYTES = readFileSync(ROTATED);
const HEIC_BYTES = readFileSync(HEIC);
const PNG_BYTES = readFileSync(PNG);

const PHOTO_FIELD = "Forsidebilde";
const NOT_UPLOADED = "Bildet er ikke lastet opp ennå.";
/** Synkstatusen når ingen bilder venter (egenbygd-testene bruker samme). */
const NO_PHOTOS_WAITING =
  /^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret$|^Venter på kontakt med serveren$/;
/** Opplastingen går hvert 10. sekund; litt slingringsmonn for to runder. */
const UPLOAD_TIMEOUT = 30_000;

const APP1 = 0xe1;
const APP13 = 0xed;

/** Teksten ved et bilde der visningskopien har feilet endelig (A11). */
const ONLY_ORIGINAL_SAVED = "Bare originalen er lagret";
/** Merknaden i lageret `confirmed` for en kopi som har feilet endelig (oppgavekortet pkt. 1). */
const DISPLAY_FAILED_PREFIX = "display-failed:";
const FAILED_COPY_NAME = "oppdiktet-kopi-4821.png";

function displayUrl(photoId: string, organizationId: string): string {
  return `/api/prove/bilder/${photoId}/visning?organisasjon=${organizationId}`;
}

function photoInput(page: Page) {
  return page.getByLabel(PHOTO_FIELD, { exact: true });
}

/** Bildet i listen med navnet. */
function photoListItem(page: Page, fileName: string) {
  return page.getByRole("listitem").filter({ hasText: fileName });
}

function onlyOriginalSaved(page: Page, fileName: string) {
  return photoListItem(page, fileName).getByText(ONLY_ORIGINAL_SAVED, { exact: true });
}

/** «Bare originalen er lagret» vises som vanlig tekst, og lenken «Vis fra serveren» er borte. */
async function expectOnlyOriginalSaved(page: Page, fileName: string, photoId: string) {
  const text = onlyOriginalSaved(page, fileName);
  await expect(text).toBeVisible({ timeout: UPLOAD_TIMEOUT });
  await expect(text).toHaveCount(1);
  await expect(viewFromServerLink(page, fileName)).toHaveCount(0);
  await expect(
    photoListItem(page, fileName).getByRole("link", { name: ONLY_ORIGINAL_SAVED }),
  ).toHaveCount(0);
  expect(await text.evaluate((element) => element.closest("a"))).toBeNull();
  const content = (await text.textContent()) ?? "";
  expect(content).not.toContain(photoId);
  expect(content).not.toContain("400");
  // iPad-størrelse: synlig uten å rulle sidelengs
  const box = await text.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (viewport) expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

/** Admin, kandidaten egenbygd og et nytt testskjema. Gir skjema- og organisasjons-id. */
async function openNewForm(page: Page, context: BrowserContext, asInspector = false) {
  // Samme som useCandidate (navnet med «use» tolkes som React-hook av lint utenfor testene)
  await context.addInitScript(() => {
    window.localStorage.setItem("trial_sync_candidate", "custom");
  });
  if (asInspector) await logInAsInspector(page);
  else await logIn(page, ADMIN_EMAIL);
  const formId = await createTrialForm(page);
  await waitForTrialHook(page);
  const organizationId = await hookValue(page, "organizationId");
  return { formId, organizationId };
}

/** Id-en til bildet med navnet, fra radene i det lokale lageret. */
async function photoIdFor(page: Page, formId: string, name: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const rows = await readRowsViaHook(page, "trial_photos", formId);
      id = rows.find((row) => row.name === name)?.id as string | undefined;
      return typeof id === "string";
    })
    .toBe(true);
  return id!;
}

function isRed([r, g, b]: readonly number[]): boolean {
  return r! > 200 && g! < 60 && b! < 60;
}

/** PUT-er fra siden mot bilderutene, skilt på original og kopi, per bilde-id. */
function recordPhotoPuts(page: Page) {
  const puts: {
    kind: "original" | "display";
    id: string;
    contentType: string;
    failed: boolean;
    request: Request;
  }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "PUT") return;
    const match = /\/api\/prove\/bilder\/([^/?]+)(\/visning)?(\?|$)/.exec(request.url());
    if (!match) return;
    puts.push({
      kind: match[2] ? "display" : "original",
      id: match[1]!,
      contentType: request.headers()["content-type"] ?? "",
      failed: false,
      request,
    });
  });
  page.on("requestfailed", (request) => {
    const entry = puts.find((put) => put.request === request);
    if (entry) entry.failed = true;
  });
  return {
    puts,
    count: (kind: "original" | "display", id: string) =>
      puts.filter((put) => put.kind === kind && put.id === id).length,
    failed: (id: string) => puts.filter((put) => put.id === id && put.failed).length,
    ids: (kind: "original" | "display") => [
      ...new Set(puts.filter((put) => put.kind === kind).map((put) => put.id)),
    ],
  };
}

async function expectAllUploaded(page: Page) {
  await expect.poll(() => localPhotoFileCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
  await expect.poll(() => localDisplayCopyCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
}

async function waitForFile(file: string) {
  await expect.poll(() => existsSync(file), { timeout: UPLOAD_TIMEOUT }).toBe(true);
}

test.describe("Prøve D – bilder", () => {
  // --- 5.2 Uten nett ---

  // Obligatorisk (AK 3)
  test("bilder valgt uten nett lastes opp når nettet kommer tilbake, med samme fingeravtrykk", async ({
    page,
    context,
  }) => {
    const { formId, organizationId } = await openNewForm(page, context);

    await context.setOffline(true);
    await photoInput(page).setInputFiles([ROTATED, PNG]);
    await expect.poll(() => localPhotoFileCount(page)).toBe(2);
    const rotatedId = await photoIdFor(page, formId, "test-photo-rotated.jpg");
    const pngId = await photoIdFor(page, formId, "test-image.png");
    expect(existsSync(trialUploadPath(organizationId, rotatedId))).toBe(false);
    expect(existsSync(trialUploadPath(organizationId, pngId))).toBe(false);

    await context.setOffline(false);
    await expectAllUploaded(page);

    for (const [id, bytes] of [
      [rotatedId, ROTATED_BYTES],
      [pngId, PNG_BYTES],
    ] as const) {
      const file = trialUploadPath(organizationId, id);
      await waitForFile(file);
      expect(sha256File(file)).toBe(sha256Bytes(bytes));
      await expect
        .poll(
          async () =>
            (await readRowsViaHook(page, "trial_photos", formId)).find((row) => row.id === id)
              ?.sha256,
          { timeout: UPLOAD_TIMEOUT },
        )
        .toBe(sha256Bytes(bytes));
    }
    await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING, { timeout: UPLOAD_TIMEOUT });
  });

  // --- 5.3 Rotering og metadata ---

  // Obligatorisk (AK 1)
  test("visningskopien står riktig vei og har ingen metadata (EXIF-retning 6)", async ({
    page,
    context,
  }) => {
    const { formId, organizationId } = await openNewForm(page, context);

    await photoInput(page).setInputFiles(ROTATED);
    const id = await photoIdFor(page, formId, "test-photo-rotated.jpg");
    const copyFile = trialUploadPath(organizationId, id, true);
    await waitForFile(copyFile);

    // Originalen er uendret, også GPS-feltet (APP1) er der
    const original = readFileSync(trialUploadPath(organizationId, id));
    expect(sha256Bytes(original)).toBe(sha256Bytes(ROTATED_BYTES));
    expect(jpegMarkers(original)).toContain(APP1);

    // Kopien: JPEG uten APP1 og APP13, ingen «Exif» i bytene
    const copy = readFileSync(copyFile);
    expect([copy[0], copy[1]]).toEqual([0xff, 0xd8]);
    const markers = jpegMarkers(copy);
    expect(markers).not.toContain(APP1);
    expect(markers).not.toContain(APP13);
    expect(copy.includes(Buffer.from("Exif"))).toBe(false);

    // Retning 6: bredde og høyde byttet, det røde feltet oppe til høyre
    const decoded = await decodeInPage(page, displayUrl(id, organizationId), [
      [28, 4],
      [4, 4],
    ]);
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(64);
    expect(isRed(decoded.pixels[0]!), `(28, 4) er ${decoded.pixels[0]}`).toBe(true);
    expect(isRed(decoded.pixels[1]!), `(4, 4) er ${decoded.pixels[1]}`).toBe(false);
  });

  // --- 5.4 Størrelse ---

  // Obligatorisk (AK 2)
  test("et bilde på 3000x1000 får kopi på 2000x667", async ({ page, context }) => {
    const { formId, organizationId } = await openNewForm(page, context);

    const base64 = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(3000, 1000);
      const context2d = canvas.getContext("2d")!;
      context2d.fillStyle = "#2a6f97";
      context2d.fillRect(0, 0, 3000, 1000);
      context2d.fillStyle = "#ffffff";
      context2d.fillRect(100, 100, 400, 400);
      const blob = await canvas.convertToBlob({ type: "image/jpeg" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    const buffer = Buffer.from(base64, "base64");

    await photoInput(page).setInputFiles({ name: "stort.jpg", mimeType: "image/jpeg", buffer });
    const id = await photoIdFor(page, formId, "stort.jpg");
    await waitForFile(trialUploadPath(organizationId, id, true));

    const decoded = await decodeInPage(page, displayUrl(id, organizationId));
    expect(decoded.width).toBe(2000);
    expect(decoded.height).toBe(667);
    expect(sha256File(trialUploadPath(organizationId, id))).toBe(sha256Bytes(buffer));
  });

  test("et lite bilde forstørres ikke", async ({ page, context }) => {
    const { formId, organizationId } = await openNewForm(page, context);

    await photoInput(page).setInputFiles(PNG);
    const id = await photoIdFor(page, formId, "test-image.png");
    await waitForFile(trialUploadPath(organizationId, id, true));

    const decoded = await decodeInPage(page, displayUrl(id, organizationId));
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
  });

  // --- 5.5 Brudd og fortsettelse ---

  // Obligatorisk (AK 4)
  test("brudd i opplastingen: hvert bilde kommer fram én gang og bekreftede sendes ikke igjen", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const { formId, organizationId } = await openNewForm(page, context);
    const recorder = recordPhotoPuts(page);

    // Ruten blir stående; bryteren avgjør. `page.unroute` midt i en opplasting kan la
    // forespørselen henge uten svar (samme grep som i egenbygd-testene).
    let onlyThrough: string | null = null;
    await page.route("**/api/prove/bilder/**", (route) => {
      const request = route.request();
      if (onlyThrough && request.method() === "PUT" && !request.url().includes(onlyThrough)) {
        return route.abort();
      }
      return route.fallback();
    });

    // Bilde 1 slippes gjennom og bekreftes
    await photoInput(page).setInputFiles(ROTATED);
    const first = await photoIdFor(page, formId, "test-photo-rotated.jpg");
    await expect
      .poll(async () => (await localConfirmedKeys(page)).includes(first), {
        timeout: UPLOAD_TIMEOUT,
      })
      .toBe(true);
    await waitForFile(trialUploadPath(organizationId, first));

    // Bruddet: alle PUT for andre bilder enn bilde 1 avbrytes
    onlyThrough = first;
    await photoInput(page).setInputFiles(PNG);
    const second = await photoIdFor(page, formId, "test-image.png");
    await expect
      .poll(() => recorder.failed(second), { timeout: UPLOAD_TIMEOUT })
      .toBeGreaterThanOrEqual(1);
    expect(await localPhotoFileCount(page)).toBe(1);

    // Nettet slippes fram
    onlyThrough = null;
    await expectAllUploaded(page);
    await waitForFile(trialUploadPath(organizationId, second));
    await waitForFile(trialUploadPath(organizationId, first, true));
    await waitForFile(trialUploadPath(organizationId, second, true));

    expect(recorder.count("original", first)).toBe(1);
    expect(recorder.count("original", second)).toBeGreaterThanOrEqual(2);

    // To nye runder uten nye PUT for noen av dem
    const before = recorder.puts.length;
    const start = Date.now();
    await expect
      .poll(() => Date.now() - start, { timeout: PHOTO_UPLOAD_INTERVAL_MS * 2 + 10_000 })
      .toBeGreaterThan(PHOTO_UPLOAD_INTERVAL_MS * 2);
    expect(recorder.puts.length).toBe(before);
    expect(recorder.count("original", first)).toBe(1);

    // Serveren: én rad per bilde, én original og én kopi per bilde, likt fingeravtrykk
    const rows = await readRowsViaHook(page, "trial_photos", formId);
    expect(rows.map((row) => row.id).sort()).toEqual([first, second].sort());
    expect(sha256File(trialUploadPath(organizationId, first))).toBe(sha256Bytes(ROTATED_BYTES));
    expect(sha256File(trialUploadPath(organizationId, second))).toBe(sha256Bytes(PNG_BYTES));
  });

  // --- 5.6 HEIC og «Vis fra serveren» ---

  // Obligatorisk (AK 5)
  test("HEIC som Chromium ikke kan dekode lastes opp uendret uten kopi, og neste bilde går gjennom", async ({
    page,
    context,
  }) => {
    const { formId, organizationId } = await openNewForm(page, context);
    const recorder = recordPhotoPuts(page);

    await photoInput(page).setInputFiles([
      { name: "test-photo.heic", mimeType: "image/heic", buffer: HEIC_BYTES },
      { name: "test-photo-rotated.jpg", mimeType: "image/jpeg", buffer: ROTATED_BYTES },
    ]);
    const heicId = await photoIdFor(page, formId, "test-photo.heic");
    const jpegId = await photoIdFor(page, formId, "test-photo-rotated.jpg");
    await expect.poll(() => localPhotoFileCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
    await waitForFile(trialUploadPath(organizationId, jpegId, true));
    await expect.poll(() => localDisplayCopyCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);

    // HEIC: originalen uendret med image/heic, ingen kopi
    expect(sha256File(trialUploadPath(organizationId, heicId))).toBe(sha256Bytes(HEIC_BYTES));
    const heicPuts = recorder.puts.filter((put) => put.kind === "original" && put.id === heicId);
    expect(heicPuts.length).toBeGreaterThanOrEqual(1);
    for (const put of heicPuts) expect(put.contentType).toBe("image/heic");
    expect(existsSync(trialUploadPath(organizationId, heicId, true))).toBe(false);
    expect(recorder.count("display", heicId)).toBe(0);

    // JPEG-en: original og kopi
    expect(existsSync(trialUploadPath(organizationId, jpegId))).toBe(true);
    expect(existsSync(trialUploadPath(organizationId, jpegId, true))).toBe(true);

    // Det D4 teller
    const response = await page.request.get(displayUrl(heicId, organizationId));
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ feil: NOT_UPLOADED });
  });

  // Obligatorisk (AK 9)
  test("Vis fra serveren åpner bildet i ny fane", async ({ page, context }) => {
    const { formId, organizationId } = await openNewForm(page, context);

    await photoInput(page).setInputFiles(ROTATED);
    const id = await photoIdFor(page, formId, "test-photo-rotated.jpg");
    await waitForFile(trialUploadPath(organizationId, id, true));

    const link = viewFromServerLink(page, "test-photo-rotated.jpg");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /\bnoopener\b/);

    const responsePromise = context.waitForEvent(
      "response",
      (response) =>
        response.url().includes(`/api/prove/bilder/${id}/visning`) &&
        response.request().method() === "GET",
    );
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("image/jpeg");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toContain("no-store");
    expect(new URL(popup.url()).pathname).toBe(`/api/prove/bilder/${id}/visning`);
    await popup.close();
  });

  test("Vis fra serveren er minst 44 høy på iPad", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare iPad-størrelse (testplan 5.6)");
    const { formId } = await openNewForm(page, context);

    await photoInput(page).setInputFiles(PNG);
    await photoIdFor(page, formId, "test-image.png");
    const link = viewFromServerLink(page, "test-image.png");
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("takstmann ser lenken og får åpnet bildet", async ({ page, context }) => {
    const { formId, organizationId } = await openNewForm(page, context, true);

    await photoInput(page).setInputFiles(PNG);
    const id = await photoIdFor(page, formId, "test-image.png");
    await waitForFile(trialUploadPath(organizationId, id, true));

    const link = viewFromServerLink(page, "test-image.png");
    await expect(link).toBeVisible();
    const responsePromise = context.waitForEvent(
      "response",
      (response) =>
        response.url().includes(`/api/prove/bilder/${id}/visning`) &&
        response.request().method() === "GET",
    );
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/jpeg");
    await popup.close();
  });

  // --- 5.7 Lokal lagring og logg ---

  test("visningskopien telles ikke i Venter og havner aldri i confirmed", async ({
    page,
    context,
  }) => {
    const { formId } = await openNewForm(page, context);
    let blockCopies = true;
    await page.route("**/visning**", (route) => (blockCopies ? route.abort() : route.fallback()));

    await photoInput(page).setInputFiles(PNG);
    const id = await photoIdFor(page, formId, "test-image.png");
    await expect
      .poll(async () => (await localConfirmedKeys(page)).includes(id), {
        timeout: UPLOAD_TIMEOUT,
      })
      .toBe(true);
    expect(await localPhotoFileCount(page)).toBe(0);
    expect(await localDisplayCopyCount(page)).toBe(1);
    await expect(indicator(page)).toHaveText(NO_PHOTOS_WAITING, { timeout: UPLOAD_TIMEOUT });
    expect((await localConfirmedKeys(page)).filter((key) => key.includes(":display"))).toEqual([]);

    // En avbrutt kopi er ikke endelig feilet (småfunn D/F, A11): ingen merknad
    expect(
      (await localConfirmedKeys(page)).filter((key) => key.startsWith(DISPLAY_FAILED_PREFIX)),
    ).toEqual([]);

    blockCopies = false;
    await expect.poll(() => localDisplayCopyCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
    expect((await localConfirmedKeys(page)).filter((key) => key.includes(":display"))).toEqual([]);
    expect(
      (await localConfirmedKeys(page)).filter((key) => key.startsWith(DISPLAY_FAILED_PREFIX)),
    ).toEqual([]);
    await expect(onlyOriginalSaved(page, "test-image.png")).toHaveCount(0);
  });

  // Småfunn D/F (docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md, A11). Obligatorisk: en kopi som
  // serveren avviser, sendes ikke på nytt i stillhet, og takstmannen ser at bare originalen er lagret.
  test("kopi som får 400 viser Bare originalen er lagret og sendes ikke igjen", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));
    page.on("pageerror", (error) => messages.push(`${error.name}: ${error.message}`));
    const { formId, organizationId } = await openNewForm(page, context);

    let displayPuts = 0;
    await page.route("**/visning**", (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      displayPuts++;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ feil: "oppdiktet-svar-fra-serveren" }),
      });
    });

    await photoInput(page).setInputFiles({
      name: FAILED_COPY_NAME,
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    const id = await photoIdFor(page, formId, FAILED_COPY_NAME);

    // Originalen er sikret som før
    await waitForFile(trialUploadPath(organizationId, id));
    expect(sha256File(trialUploadPath(organizationId, id))).toBe(sha256Bytes(PNG_BYTES));
    await expect
      .poll(async () => (await localConfirmedKeys(page)).includes(id), {
        timeout: UPLOAD_TIMEOUT,
      })
      .toBe(true);

    // Kopien ble sendt én gang, er slettet lokalt og har merknad
    await expect.poll(() => displayPuts, { timeout: UPLOAD_TIMEOUT }).toBe(1);
    await expect.poll(() => localDisplayCopyCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
    await expect
      .poll(async () => (await localConfirmedKeys(page)).includes(`${DISPLAY_FAILED_PREFIX}${id}`))
      .toBe(true);
    expect(existsSync(trialUploadPath(organizationId, id, true))).toBe(false);

    // Synlig status i stedet for lenken
    await expectOnlyOriginalSaved(page, FAILED_COPY_NAME, id);

    // Minst to runder til («Synk nå» og ventetid): ingen ny PUT til visningsruten
    const start = Date.now();
    for (const round of [1, 2]) {
      if (await syncNowButton(page).isVisible()) await syncNowButton(page).click();
      await expect
        .poll(() => Date.now() - start, { timeout: PHOTO_UPLOAD_INTERVAL_MS * 2 + 10_000 })
        .toBeGreaterThan(PHOTO_UPLOAD_INTERVAL_MS * round + 1_000);
    }
    expect(displayPuts).toBe(1);
    expect(await localDisplayCopyCount(page)).toBe(0);

    // Etter omlasting står teksten fortsatt, og det kommer ingen ny PUT etter en runde til
    await page.reload();
    await waitForTrialHook(page);
    await expectOnlyOriginalSaved(page, FAILED_COPY_NAME, id);
    const afterReload = Date.now();
    await expect
      .poll(() => Date.now() - afterReload, { timeout: PHOTO_UPLOAD_INTERVAL_MS + 10_000 })
      .toBeGreaterThan(PHOTO_UPLOAD_INTERVAL_MS + 1_000);
    expect(displayPuts).toBe(1);
    expect(await localDisplayCopyCount(page)).toBe(0);

    // Loggen har verken filnavn, bilde-id eller svarteksten (grenen for 400)
    expect(
      messages.filter(
        (text) =>
          text.includes("oppdiktet-kopi-4821") ||
          text.includes(id) ||
          text.includes("oppdiktet-svar-fra-serveren"),
      ),
    ).toEqual([]);
  });

  test("innlogging i annen organisasjon tømmer også visningskopiene", async ({ page, context }) => {
    await openNewForm(page, context);
    const photoId = randomUUID();

    await page.evaluate(async (id) => {
      const databases = await indexedDB.databases();
      const exists = databases.some((info) => info.name === "offline-trial-photos");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = exists
          ? indexedDB.open("offline-trial-photos")
          : indexedDB.open("offline-trial-photos", 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
          if (!db.objectStoreNames.contains("confirmed")) db.createObjectStore("confirmed");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["photos"], "readwrite");
        const store = tx.objectStore("photos");
        store.put(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), id);
        store.put(
          new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
          `${id}:display`,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      // Merknaden for en kopi som har feilet endelig (A11): egen nøkkel i `confirmed`
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["confirmed"], "readwrite");
        tx.objectStore("confirmed").put("400", `display-failed:${id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    }, photoId);
    expect(await localPhotoFileCount(page)).toBe(1);
    expect(await localDisplayCopyCount(page)).toBe(1);
    expect(await localConfirmedKeys(page)).toContain(`${DISPLAY_FAILED_PREFIX}${photoId}`);

    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      TRIAL_LAST_ORGANIZATION_KEY,
      randomUUID(),
    ] as const);
    await page.reload();
    await waitForTrialHook(page);

    await expect.poll(() => localPhotoFileCount(page)).toBe(0);
    await expect.poll(() => localDisplayCopyCount(page)).toBe(0);
    await expect
      .poll(async () =>
        (await localConfirmedKeys(page)).filter((key) => key.startsWith(DISPLAY_FAILED_PREFIX)),
      )
      .toEqual([]);
  });

  test("loggen har aldri filnavnet", async ({ page, context }) => {
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));
    page.on("pageerror", (error) => messages.push(`${error.name}: ${error.message}`));
    const { formId, organizationId } = await openNewForm(page, context);

    await photoInput(page).setInputFiles({
      name: "oppdiktet-bilde-7391.heic",
      mimeType: "image/heic",
      buffer: HEIC_BYTES,
    });
    const id = await photoIdFor(page, formId, "oppdiktet-bilde-7391.heic");
    await expect.poll(() => localPhotoFileCount(page), { timeout: UPLOAD_TIMEOUT }).toBe(0);
    await waitForFile(trialUploadPath(organizationId, id));

    expect(messages.filter((text) => text.includes("oppdiktet-bilde-7391"))).toEqual([]);
  });
});
