import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContext,
  type ConsoleMessage,
  type Locator,
  type Page,
} from "@playwright/test";
import { storageLevel } from "../src/modules/offline-trial/storage-health";
import {
  ADMIN_EMAIL,
  MB,
  createTrialForm,
  fieldSaved,
  logIn,
  logInAsInspector,
  setStorageOverride,
  storageBox,
  storageError,
  storageWarning,
  syncStatus,
  updateStorageOverride,
  useCandidate,
  type StorageOverride,
} from "./helpers";

// Prøve C – lagring i Safari (docs/funksjoner/fase1-prove-c-lagring.md pkt. 2–5).
// Testplan: docs/funksjoner/fase1-prove-c-lagring-testplan.md avsnitt 5. Støtter reklamasjoner
// (et svar eller bilde som ikke ble lagret på iPaden, gir alltid en melding og et merke på feltet)
// og tid (varig lagring og ny lagring skjer automatisk). Kjører i pc og ipad med PowerSync.
// Testene leser markørene (`data-storage-level`, `data-storage-persisted`, `data-field-saved`),
// `role` og `data-testid`; ordrett tekst testes i Vitest (storage-health.test.ts).
//
// Regel for stabile tester: hver test som ikke selv tester lite plass, setter overstyringen
// 10 MB brukt av 4 GB, så lav kvote i Chromium uten skjerm aldri gir varselet ved et uhell.
// Unntak: testen med ekte tall, og testene som fjerner `navigator.storage` eller kroken.
// Ekte omstart, 7 dager og full disk på ekte iPad: resultatmalen
// (docs/funksjoner/fase1-prove-c-lagring-resultat.md). Alle data er oppdiktet.

const TEST_IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "test-image.png",
);

const FULL = "Plassen på iPaden er brukt opp.";
const SECRET_ANSWER = "Oppdiktet-svar-7391";
const TEXT_A = "Generell beskrivelse";
const TEXT_B = "Tak – beskrivelse";
const PHOTO = "Forsidebilde";
const NUMBER = "Antall etasjer";

/** Nok plass: 10 MB brukt av 4 GB. */
const PLENTY: StorageOverride = { estimate: { usage: 10 * MB, quota: 4096 * MB } };
/** 2 GB ledig: 100 MB brukt av 2148 MB. */
const TWO_GB_FREE = { usage: 100 * MB, quota: 2148 * MB };
/** 100 MB ledig: 1948 MB brukt av 2048 MB. */
const LOW_FREE = { usage: 1948 * MB, quota: 2048 * MB };

function ipadOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "ipad", "Kjøres bare i ipad (testplan 5.4)");
}

function counter(page: Page): Locator {
  return page.getByText(/^\d+ av 40 felt utfylt$/);
}

/** Den faste linjen øverst i skjemaet (samme sticky-beholder som synkstatusen). */
function stickyLine(page: Page): Locator {
  return page.locator("div.sticky").filter({ has: syncStatus(page) });
}

/** Markørene for lagring i skjemaet (på den faste linjen eller et element i den). */
function formStorageMarker(page: Page): Locator {
  return page.locator("div.sticky[data-storage-level], div.sticky [data-storage-level]").first();
}

function textInput(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true });
}

function retryButton(page: Page): Locator {
  return storageError(page).getByRole("button", { name: "Prøv igjen", exact: true });
}

function closeButton(page: Page): Locator {
  return storageError(page).getByRole("button", { name: "Lukk", exact: true });
}

async function expectSaved(page: Page, label: string, saved: "yes" | "no") {
  await expect(fieldSaved(page, label), `${label} lagret: ${saved}`).toHaveAttribute(
    "data-field-saved",
    saved,
  );
}

/** Logger inn som admin med overstyringen og lager et nytt testskjema. */
async function openForm(
  page: Page,
  context: BrowserContext,
  override: StorageOverride | null = PLENTY,
): Promise<string> {
  if (override) await setStorageOverride(context, override);
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
  return id;
}

/** Åpner skjemaet og venter til plassen er målt (nivå ok), så fravær av varsel betyr noe. */
async function openFormMeasured(page: Page, context: BrowserContext, override = PLENTY) {
  const id = await openForm(page, context, override);
  await expect(formStorageMarker(page)).toHaveAttribute("data-storage-level", "ok");
  return id;
}

async function addPhoto(page: Page) {
  await page.getByLabel(PHOTO, { exact: true }).setInputFiles(TEST_IMAGE);
}

/** To svar som feiler (A, så B): én melding med «2 svar». */
async function failTwoAnswers(page: Page) {
  await updateStorageOverride(page, { fail: "answer" });
  await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
  await expect(storageError(page)).toHaveCount(1);
  await textInput(page, TEXT_B).fill("Oppdiktet tekst B");
  await expect(storageError(page)).toContainText("2 svar");
  await expect(storageError(page)).toHaveCount(1);
}

test.beforeEach(async ({ context }) => {
  await useCandidate(context, "powersync");
});

test.describe("boksen på listen og varig lagring (5.2)", () => {
  test("takstmann ser boksen med plass og varig lagring (ekte tall)", async ({ page }) => {
    await logInAsInspector(page);
    await page.goto("/prove/testskjema");
    const box = storageBox(page);
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("data-storage-persisted", /^(yes|no)$/);
    await expect(box).toHaveAttribute("data-storage-level", /^(ok|low)$/);
    await expect(box).toContainText(/\d+\s*MB/);
    await expect(box).toContainText("Varig lagring:");
    // Under velgeren for synkløsning
    const pickerBox = await page.getByRole("group", { name: "Synkløsning" }).boundingBox();
    const storageBoxRect = await box.boundingBox();
    expect(pickerBox && storageBoxRect).toBeTruthy();
    expect(storageBoxRect!.y).toBeGreaterThanOrEqual(pickerBox!.y + pickerBox!.height - 1);
    // Avvik fra kortet (testplan 5.2): kvoten i Chromium uten skjerm kan være under 500 MB ledig
    const estimate = await page.evaluate(async () => {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    });
    await expect(box).toHaveAttribute("data-storage-level", storageLevel(estimate));
  });

  test("boksen viser ok med 2 GB ledig", async ({ page, context }) => {
    await setStorageOverride(context, { estimate: TWO_GB_FREE });
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    const box = storageBox(page);
    await expect(box).toHaveAttribute("data-storage-level", "ok");
    await expect(box).toContainText("100");
    await expect(box).toContainText("2148");
    await expect(box.getByRole("button")).toHaveCount(0);
    await expect(box.locator("button")).toHaveCount(0);
  });

  test("boksen viser lite plass med 100 MB ledig", async ({ page, context }) => {
    await setStorageOverride(context, { estimate: LOW_FREE });
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    await expect(storageBox(page)).toHaveAttribute("data-storage-level", "low");
  });

  // Obligatorisk
  test("uten navigator.storage viser boksen ikke støttet og skjemaet virker", async ({
    page,
    context,
  }) => {
    // Ingen estimate-overstyring: den ville erstatte målingen testen skal vise at mangler
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
    });
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    const box = storageBox(page);
    await expect(box).toHaveAttribute("data-storage-persisted", "unsupported");
    await expect(box).toHaveAttribute("data-storage-level", "unknown");
    await expect(box).toContainText("ikke støttet");
    await expect(box).not.toContainText("NaN");

    await page.getByRole("button", { name: "Nytt testskjema", exact: true }).click();
    await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
    await textInput(page, TEXT_A).fill("Oppdiktet tekst uten lagrings-API");
    await expectSaved(page, TEXT_A, "yes");
    await expect(counter(page)).toHaveText("1 av 40 felt utfylt");
    await expect(storageWarning(page)).toHaveCount(0);
    await expect(storageError(page)).toHaveCount(0);
    await page.reload();
    await expect(textInput(page, TEXT_A)).toHaveValue("Oppdiktet tekst uten lagrings-API");
  });

  test("persist() kalles én gang per innlasting når persisted() er false", async ({
    page,
    context,
  }) => {
    await setStorageOverride(context, PLENTY);
    await wrapPersist(context, false);
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    await expect(storageBox(page)).toHaveAttribute("data-storage-persisted", "no");
    await expect.poll(() => persistCalls(page)).toBe(1);

    await page.reload();
    await expect(storageBox(page)).toHaveAttribute("data-storage-persisted", "no");
    await expect.poll(() => persistCalls(page)).toBe(1);

    // Til skjemaet i samme innlasting (klientnavigasjon): fortsatt ett kall
    const id = await createTrialFormFromList(page);
    await expect(formStorageMarker(page)).toHaveAttribute("data-storage-persisted", "no");
    expect(await persistCalls(page)).toBe(1);

    // Skjemaet åpnet direkte er en ny innlasting
    await page.goto(`/prove/testskjema/${id}`);
    await expect(formStorageMarker(page)).toHaveAttribute("data-storage-persisted", "no");
    await expect.poll(() => persistCalls(page)).toBe(1);
  });

  test("persist() kalles ikke når persisted() er true", async ({ page, context }) => {
    await setStorageOverride(context, PLENTY);
    await wrapPersist(context, true);
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/prove/testskjema");
    await expect(storageBox(page)).toHaveAttribute("data-storage-persisted", "yes");
    expect(await persistCalls(page)).toBe(0);

    const id = await createTrialFormFromList(page);
    await page.goto(`/prove/testskjema/${id}`);
    await expect(formStorageMarker(page)).toHaveAttribute("data-storage-persisted", "yes");
    expect(await persistCalls(page)).toBe(0);
  });

  test("skjemaet viser ingen tall om plass", async ({ page, context }) => {
    await openFormMeasured(page, context, { estimate: TWO_GB_FREE });
    await expect(storageBox(page)).toHaveCount(0);
    await expect(stickyLine(page)).not.toContainText("MB");
  });
});

test.describe("data overlever lukking (5.3)", () => {
  // Obligatorisk
  test("svar og bilde lagret uten nett står der etter at siden er lukket og åpnet uten nett", async ({
    page,
    context,
  }) => {
    const formId = await openForm(page, context);
    // Service worker og hurtiglager klare (samme vei som fase-1-powersync.spec.ts)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const text = "Oppdiktet tekst lagret uten nett";
    await context.setOffline(true);
    try {
      await textInput(page, TEXT_A).fill(text);
      const floors = textInput(page, NUMBER);
      await floors.fill("3");
      await floors.blur();
      await addPhoto(page);
      await expectSaved(page, TEXT_A, "yes");
      await expectSaved(page, NUMBER, "yes");
      await expectSaved(page, PHOTO, "yes");
      await expect(counter(page)).toHaveText("3 av 40 felt utfylt");
      await page.close();

      // Åpnes uten nett, ingen reservevei: mangler innholdet, er testen rød
      const reopened = await context.newPage();
      await reopened.goto(`/prove/testskjema/${formId}`);
      await expectFormContent(reopened, text);
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("lite plass og lagring som feiler (5.4)", () => {
  // Obligatorisk
  test("lite plass ved åpning gir varsel som ikke sperrer", async ({ page, context }) => {
    await openForm(page, context, { estimate: LOW_FREE });
    const warning = storageWarning(page);
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute("role", "status");
    await expect(stickyLine(page).getByTestId("storage-low-warning")).toHaveCount(1);
    await expect(warning).toContainText("Lite plass igjen på iPaden");
    await expect(formStorageMarker(page)).toHaveAttribute("data-storage-level", "low");

    await textInput(page, TEXT_A).fill("Oppdiktet tekst med lite plass");
    await addPhoto(page);
    await expectSaved(page, TEXT_A, "yes");
    await expectSaved(page, PHOTO, "yes");
    // `data-field-saved="yes"` står også mens skrivingen pågår; telleren leser det som er lagret
    await expect(counter(page)).toHaveText("2 av 40 felt utfylt");
    await expect(storageError(page)).toHaveCount(0);

    // Svaret står der etter ny innlasting, og varselet vises igjen
    await page.reload();
    await expect(textInput(page, TEXT_A)).toHaveValue("Oppdiktet tekst med lite plass");
    await expect(storageWarning(page)).toBeVisible();
  });

  test("lite plass oppdaget ved bilde uten ny innlasting", async ({ page, context }) => {
    await openFormMeasured(page, context, { estimate: TWO_GB_FREE });
    await expect(storageWarning(page)).toHaveCount(0);
    await updateStorageOverride(page, { estimate: LOW_FREE });
    await addPhoto(page);
    await expect(storageWarning(page)).toBeVisible();
    await expectSaved(page, PHOTO, "yes");
    await expect(storageError(page)).toHaveCount(0);
  });

  test("lite plass oppdaget etter feil", async ({ page, context }) => {
    await openFormMeasured(page, context, { estimate: TWO_GB_FREE });
    await expect(storageWarning(page)).toHaveCount(0);
    await updateStorageOverride(page, { estimate: LOW_FREE, fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst som feiler");
    await expect(storageError(page)).toBeVisible();
    await expect(storageWarning(page)).toBeVisible();
  });

  // Obligatorisk
  test("svar som feiler gir én melding med feltnavn, verdi og merke", async ({ page, context }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill(SECRET_ANSWER);

    const error = storageError(page);
    await expect(error).toHaveCount(1);
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(stickyLine(page).getByTestId("storage-error")).toHaveCount(1);
    await expect(error).toContainText(TEXT_A);
    await expect(error).toContainText(FULL);
    await expect(error).not.toContainText(SECRET_ANSWER);
    await expect(textInput(page, TEXT_A)).toHaveValue(SECRET_ANSWER);
    await expectSaved(page, TEXT_A, "no");
    await expect(fieldSaved(page, TEXT_A).getByText("ikke lagret")).toBeVisible();
    await expect(retryButton(page)).toBeVisible();
    await expect(closeButton(page)).toBeVisible();
  });

  // Obligatorisk
  test("Prøv igjen lagrer de feilede svarene og fjerner meldingen", async ({ page, context }) => {
    await openForm(page, context);
    await failTwoAnswers(page);
    // Flere svar som feiler samles i én melding
    await expect(storageError(page)).toHaveCount(1);
    await expect(storageError(page)).toContainText("2 svar");
    await expect(storageError(page)).toContainText(TEXT_B);
    await expectSaved(page, TEXT_A, "no");
    await expectSaved(page, TEXT_B, "no");

    await updateStorageOverride(page, { fail: null });
    await retryButton(page).click();
    await expect(storageError(page)).toHaveCount(0);
    await expectSaved(page, TEXT_A, "yes");
    await expectSaved(page, TEXT_B, "yes");
    await page.reload();
    await expect(textInput(page, TEXT_A)).toHaveValue("Oppdiktet tekst A");
    await expect(textInput(page, TEXT_B)).toHaveValue("Oppdiktet tekst B");
  });

  // Obligatorisk
  test("ny lagring skjer automatisk når et annet svar lagres", async ({ page, context }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(storageError(page)).toBeVisible();
    await expectSaved(page, TEXT_A, "no");

    await updateStorageOverride(page, { fail: null });
    await textInput(page, TEXT_B).fill("Oppdiktet tekst B");
    await expect(storageError(page)).toHaveCount(0);
    await expectSaved(page, TEXT_A, "yes");
    await expectSaved(page, TEXT_B, "yes");
    await page.reload();
    await expect(textInput(page, TEXT_A)).toHaveValue("Oppdiktet tekst A");
  });

  // Obligatorisk
  test("meldingen blir stående når et annet felt lagres men det feilede fortsatt mangler", async ({
    page,
    context,
  }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(storageError(page)).toBeVisible();

    // `fail: "answer"` gjelder bare svar, så bildet lagres
    await addPhoto(page);
    await expectSaved(page, PHOTO, "yes");
    await expect(storageError(page)).toBeVisible();
    await expect(storageError(page)).toContainText(TEXT_A);
    await expectSaved(page, TEXT_A, "no");
  });

  test("Lukk fjerner meldingen men merket blir stående", async ({ page, context }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(storageError(page)).toBeVisible();

    await closeButton(page).click();
    await expect(storageError(page)).toHaveCount(0);
    await expectSaved(page, TEXT_A, "no");
    await expect(fieldSaved(page, TEXT_A).getByText("ikke lagret")).toBeVisible();

    await updateStorageOverride(page, { fail: null });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A, ny");
    await expectSaved(page, TEXT_A, "yes");
    await expect(fieldSaved(page, TEXT_A).getByText("ikke lagret")).toHaveCount(0);
  });

  // Obligatorisk
  test("bilde som feiler gir egen melding uten Prøv igjen", async ({ page, context }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "photo" });
    await addPhoto(page);

    const error = storageError(page);
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toContainText(PHOTO);
    await expect(error).toContainText("Ta bildet på nytt");
    await expect(retryButton(page)).toHaveCount(0);
    await expect(closeButton(page)).toBeVisible();
    await expectSaved(page, PHOTO, "no");

    await updateStorageOverride(page, { fail: null });
    await addPhoto(page);
    await expect(storageError(page)).toHaveCount(0);
    await expectSaved(page, PHOTO, "yes");
  });

  test("svar og bilde som feiler samles i én melding", async ({ page, context }) => {
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "both" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(storageError(page)).toBeVisible();
    await addPhoto(page);
    await expect(storageError(page)).toContainText(PHOTO);
    await expect(storageError(page)).toHaveCount(1);
    await expect(storageError(page)).toContainText(TEXT_A);
    await expectSaved(page, TEXT_A, "no");
    await expectSaved(page, PHOTO, "no");
  });

  test("Prøv igjen og Lukk er minst 44 høye med minst 8 mellom", async ({
    page,
    context,
  }, testInfo) => {
    ipadOnly(testInfo);
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(retryButton(page)).toBeVisible();
    await expect(closeButton(page)).toBeVisible();
    const retry = await retryButton(page).boundingBox();
    const close = await closeButton(page).boundingBox();
    expect(retry && close).toBeTruthy();
    expect(retry!.height).toBeGreaterThanOrEqual(44);
    expect(close!.height).toBeGreaterThanOrEqual(44);
    const gap = Math.max(
      close!.x - (retry!.x + retry!.width),
      retry!.x - (close!.x + close!.width),
      close!.y - (retry!.y + retry!.height),
      retry!.y - (close!.y + close!.height),
    );
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  test("meldingen dekker ikke feltet han skriver i", async ({ page, context }, testInfo) => {
    ipadOnly(testInfo);
    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill("Oppdiktet tekst A");
    await expect(storageError(page)).toBeVisible();
    const before = await stickyLine(page).boundingBox();
    await textInput(page, TEXT_B).fill("Oppdiktet tekst B");
    await expect(storageError(page)).toContainText("2 svar");
    const after = await stickyLine(page).boundingBox();
    expect(before && after).toBeTruthy();
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
  });

  // Obligatorisk
  test("loggen har aldri svaret", async ({ page, context }) => {
    const messages: string[] = [];
    const pending: Promise<void>[] = [];
    const collect = (message: ConsoleMessage) => {
      messages.push(message.text());
      pending.push(
        Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null)))
          .then((values) => {
            messages.push(JSON.stringify(values));
          })
          .catch(() => {}),
      );
    };
    page.on("console", collect);
    page.on("pageerror", (error) => messages.push(`${error.name}: ${error.message}`));

    await openForm(page, context);
    await updateStorageOverride(page, { fail: "answer" });
    await textInput(page, TEXT_A).fill(SECRET_ANSWER);
    await expect(storageError(page)).toBeVisible();
    await expect
      .poll(() => messages.some((text) => /lagre|lagring/i.test(text)), {
        message: "minst én konsollmelding om lagring",
      })
      .toBe(true);
    await Promise.all(pending);
    const leaks = messages.filter((text) => text.includes(SECRET_ANSWER));
    expect(leaks).toEqual([]);
  });

  test("uten testkrok påvirker ingenting lagringen", async ({ page, context }) => {
    await openForm(page, context, null);
    await textInput(page, TEXT_A).fill("Oppdiktet tekst uten krok");
    await expectSaved(page, TEXT_A, "yes");
    await expect(counter(page)).toHaveText("1 av 40 felt utfylt");
    await expect(storageError(page)).toHaveCount(0);
  });
});

// --- Hjelpere for persist() og ny åpning ---

/** Pakker inn `persisted()` (fast svar) og `persist()` (teller kall i `window.__persistCalls`). */
async function wrapPersist(context: BrowserContext, persisted: boolean) {
  await context.addInitScript((answer) => {
    const target = window as unknown as { __persistCalls: number };
    target.__persistCalls = 0;
    const storage = navigator.storage;
    if (!storage) return;
    Object.defineProperty(storage, "persisted", {
      configurable: true,
      value: async () => answer,
    });
    Object.defineProperty(storage, "persist", {
      configurable: true,
      value: async () => {
        target.__persistCalls += 1;
        return answer;
      },
    });
  }, persisted);
}

async function persistCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
}

/** Trykker «Nytt testskjema» på listen som allerede er åpen (ingen ny innlasting). */
async function createTrialFormFromList(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Nytt testskjema", exact: true }).click();
  await expect(page).toHaveURL(/\/prove\/testskjema\/[0-9a-f-]{36}$/);
  await expect(counter(page)).toHaveText("0 av 40 felt utfylt");
  const id = /\/prove\/testskjema\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Fant ingen skjema-id i ${page.url()}`);
  return id;
}

/** Svarene og bildet fra 5.3 står i skjemaet, og telleren er lik. */
async function expectFormContent(page: Page, text: string) {
  await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  await expect(textInput(page, TEXT_A)).toHaveValue(text);
  await expect(textInput(page, NUMBER)).toHaveValue("3");
  await expect(fieldSaved(page, PHOTO).getByText("1 bilde", { exact: true })).toBeVisible();
  await expect(counter(page)).toHaveText("3 av 40 felt utfylt");
}
