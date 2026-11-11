import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import {
  aiQueueEntries,
  aiUsageRowCountForEmployee,
  aiUsageRowsById,
  aiUsageRowsForTarget,
  logInAsNoAiInspector,
  logInAsSampleAdminOnly,
  logInAsSampleInspector,
  logInAsSecondSampleInspector,
  restoreSampleAiEnabled,
  SAMPLE_SECOND_INSPECTOR_EMAIL,
  sampleEmployeeId,
  setSampleAiEnabled,
} from "./helpers";

/*
 * KI-kø uten nett på /prove/ki (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 8, K8.1–K8.13).
 * Kjører i prosjektene pc og ipad. Nett av med `context.setOffline`. Køen leses rått fra
 * IndexedDB (`aiQueueEntries`), radene i KI-loggen fra databasen. Den falske leverandøren svarer
 * med stor forbokstav og punktum. Prøveorganisasjonen har KI på (`pnpm db:seed:testoppdrag`).
 * All tekst er oppdiktet; e-post bare på example.com/example.invalid.
 * Støtter hovedmål: de ansatte (ett trykk uten nett, teksten overlever ny lasting, ingen ser en
 * annens tekst på delt iPad), KI i bunnen (KI virker likt med og uten nett, alt går gjennom
 * serveren) og færre reklamasjoner (sent forslag overskriver aldri egen tekst).
 */

const PORTRAIT = { width: 834, height: 1194 } as const;
const QUEUED_TEXT = "Venter på KI. Forslaget kommer når nettet er tilbake.";
const OFFLINE_TEXT = "Krever nett. Teksten din er lagret og kan skrives videre.";
const AI_OFF = "KI er av.";
const ARRIVAL = { timeout: 15_000 };

function marker(): string {
  return `k${randomUUID().slice(0, 8)}`;
}

/** Oppdiktet setning med markør, så radene kan finnes. */
function sentence(tag: string): string {
  return `fukt i kjellervegg ved sluk ${tag}`;
}

function polished(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

const field = (page: Page) => page.getByLabel("Setning");
const askButton = (page: Page) => page.getByRole("button", { name: "Foreslå bedre språk" });
const card = (page: Page) => page.getByRole("region", { name: "Forslag fra KI" });
const suggestionText = (page: Page) => card(page).getByTestId("ai-suggestion-text");

async function openTrial(page: Page) {
  await page.goto("/prove/ki");
  await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
}

/** Skriver teksten, slår av nettet og trykker én gang. Gir posten i køen. */
async function queueOffline(page: Page, context: BrowserContext, text: string) {
  await field(page).fill(text);
  await context.setOffline(true);
  await expect(page.getByTestId("network-status")).toHaveText(/Uten nett/, { timeout: 5_000 });
  await expect(askButton(page)).toBeEnabled();
  await askButton(page).click();
  await expect(page.getByText(QUEUED_TEXT).first()).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => (await aiQueueEntries(page)).length).toBe(1);
  const [entry] = await aiQueueEntries(page);
  return entry as Record<string, unknown> & { requestId: string; targetId: string };
}

/** POST til serverhandlingen på /prove/ki. */
function isActionCall(method: string, url: string, headers: Record<string, string>): boolean {
  return method === "POST" && new URL(url).pathname === "/prove/ki" && "next-action" in headers;
}

test.afterEach(async ({ context }) => {
  await context.setOffline(false);
});

test.describe("KI-kø uten nett (pc og ipad)", () => {
  test("K8.1 kø og levering: ett trykk uten nett, forslaget kommer uten trykk når nettet er tilbake", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const tag = marker();
    const text = sentence(tag);

    const entry = await queueOffline(page, context, text);
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(0);
    await expect(page.getByText(OFFLINE_TEXT)).toHaveCount(0);
    // Feltet kan skrives i mens forespørselen venter
    await expect(field(page)).toBeEditable();
    await expect(card(page).getByRole("button", { name: "Bruk" })).toHaveCount(0);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await expect.poll(async () => (await aiQueueEntries(page)).length).toBe(0);
    const rows = await aiUsageRowsForTarget(entry.targetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(entry.requestId);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toBeVisible();
  });

  test("K8.2 posten overlever ny lasting: teksten står i feltet og forslaget kommer (T-0035 punkt 4)", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);

    // Hold igjen kallet til serverhandlingen til siden er lastet på nytt
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/prove/ki", async (route) => {
      const request = route.request();
      if (!isActionCall(request.method(), request.url(), await request.allHeaders())) {
        return route.fallback();
      }
      await gate;
      await route.continue().catch(() => {});
    });
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Prøv KI: språkvask", level: 1 })).toBeVisible();
    await expect(field(page)).toHaveValue(text);
    expect(await aiQueueEntries(page)).toHaveLength(1);

    release();
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await expect.poll(async () => (await aiQueueEntries(page)).length).toBe(0);
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("K8.3 erstatning: nytt trykk på samme felt gir én post med ny tekst og ny requestId", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const tag = marker();
    const first = await queueOffline(page, context, sentence(tag));

    const longer = `${sentence(tag)} og i hjørnet`;
    await field(page).fill(longer);
    await askButton(page).click();
    await expect
      .poll(async () => (await aiQueueEntries(page)).map((e) => e.requestId))
      .not.toEqual([first.requestId]);
    const entries = await aiQueueEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestId).not.toBe(first.requestId);
    expect(entries[0]?.targetId).toBe(first.targetId);
    expect(entries[0]?.fields).toEqual({ text: longer });

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(longer), ARRIVAL);
    const rows = await aiUsageRowsForTarget(first.targetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(entries[0]?.requestId);
  });

  test("K8.4 utlogging tømmer køen", async ({ page, context }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const entry = await queueOffline(page, context, sentence(marker()));

    // Utloggingen trenger nett. Kallet fra køen når aldri serveren (avbrytes), så posten blir
    // liggende til utloggingen tømmer den.
    await page.route("**/prove/ki", async (route) => {
      const request = route.request();
      if (!isActionCall(request.method(), request.url(), await request.allHeaders())) {
        return route.fallback();
      }
      await route.abort();
    });
    await context.setOffline(false);
    expect(await aiQueueEntries(page)).toHaveLength(1);
    await page.getByRole("button", { name: "Logg ut" }).click();
    await expect(page).toHaveURL(/\/logg-inn/, { timeout: 10_000 });
    await expect.poll(async () => (await aiQueueEntries(page)).length).toBe(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await logInAsSampleInspector(page);
    await openTrial(page);
    expect(await aiQueueEntries(page)).toHaveLength(0);
    await expect(field(page)).toHaveValue("");
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(0);
  });

  test("K8.5 delt iPad: ny ansatt uten utlogging ser ikke teksten, og ingenting sendes", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);
    expect(entry.employeeId).toBe(await sampleEmployeeId(SAMPLE_INSPECTOR.email));

    // A glemmer å logge ut: fanen lukkes og økten forsvinner
    await page.close();
    await context.clearCookies();
    await context.setOffline(false);

    const next = await context.newPage();
    await logInAsSecondSampleInspector(next);
    await openTrial(next);
    await expect(field(next)).toHaveValue("");
    await expect(next.getByText(text)).toHaveCount(0);
    await expect(next.getByText(QUEUED_TEXT)).toHaveCount(0);
    await expect.poll(async () => (await aiQueueEntries(next)).length).toBe(0);
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(0);
    const second = await sampleEmployeeId(SAMPLE_SECOND_INSPECTOR_EMAIL);
    expect(await aiUsageRowCountForEmployee(second, entry.targetId)).toBe(0);
  });

  test("K8.6 annen organisasjon på samme iPad: køen er tom og ingenting sendes", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);

    await page.close();
    await context.clearCookies();
    await context.setOffline(false);

    const next = await context.newPage();
    await logInAsNoAiInspector(next);
    await openTrial(next);
    await expect(field(next)).toHaveValue("");
    await expect(next.getByText(text)).toHaveCount(0);
    await expect.poll(async () => (await aiQueueEntries(next)).length).toBe(0);
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(0);
  });

  test("K8.7 KI slått av før nettet kommer: «KI er av.», tom kø, ingen ok-rad", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const entry = await queueOffline(page, context, sentence(marker()));

    const previous = await setSampleAiEnabled(false);
    try {
      await context.setOffline(false);
      await expect(page.getByText(AI_OFF).first()).toBeVisible(ARRIVAL);
      await expect.poll(async () => (await aiQueueEntries(page)).length).toBe(0);
      const rows = await aiUsageRowsForTarget(entry.targetId);
      expect(rows.filter((r) => r.outcome === "ok")).toHaveLength(0);
    } finally {
      await restoreSampleAiEnabled(previous);
    }
  });

  test("K8.8 T-0004: skriver videre etter forslaget, ingen «Bruk», egen tekst står", async ({
    page,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    await field(page).fill(text);
    await askButton(page).click();
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toBeVisible();

    const more = `${text} og mer rundt sluket`;
    await field(page).fill(more);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "Nytt forslag" })).toBeVisible();
    await expect(card(page)).toContainText("Forslaget gjelder teksten før du skrev videre.");
    await expect(field(page)).toHaveValue(more);
  });

  test("K8.8 T-0004 for et forslag fra køen: skriver videre mens det venter, forslaget kommer uten «Bruk»", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    await queueOffline(page, context, text);
    const more = `${text} og mer rundt sluket`;
    await field(page).fill(more);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await expect(card(page).getByRole("button", { name: "Bruk" })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "Nytt forslag" })).toBeVisible();
    await expect(field(page)).toHaveValue(more);
  });

  test("K8.9 posten i IndexedDB har feltene, og teksten finnes ikke i localStorage, sessionStorage, adressen eller konsollen", async ({
    page,
    context,
  }) => {
    const consoleLines: string[] = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    await logInAsSampleInspector(page);
    await openTrial(page);
    const tag = marker();
    const text = sentence(tag);
    const entry = await queueOffline(page, context, text);

    for (const key of [
      "requestId",
      "feature",
      "targetType",
      "targetId",
      "fieldKey",
      "organizationId",
      "employeeId",
      "queuedAt",
      "attempts",
    ]) {
      expect(entry).toHaveProperty(key);
    }
    expect(entry.feature).toBe("language_polish");
    expect(entry.attempts).toBe(0);
    expect(typeof entry.queuedAt).toBe("number");
    expect(entry.fields).toEqual({ text });

    const storage = await page.evaluate(() => {
      const dump = (s: Storage) =>
        Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`).join(
          "\n",
        );
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });
    expect(storage.local).not.toContain(tag);
    expect(storage.session).not.toContain(tag);
    expect(page.url()).not.toContain(tag);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    expect(page.url()).not.toContain(tag);
    expect(consoleLines.filter((line) => line.includes(tag))).toEqual([]);
  });

  test("K8.10 kallet til serveren har ikke queuedAt, employeeId eller organizationId", async ({
    page,
    context,
  }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);

    const bodies: string[] = [];
    page.on("request", (request) => {
      if (isActionCall(request.method(), request.url(), request.headers())) {
        bodies.push(request.postData() ?? "");
      }
    });
    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);

    const sent = bodies.filter((body) => body.includes(entry.requestId));
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) {
      expect(body).not.toContain("queuedAt");
      expect(body).not.toContain("employeeId");
      expect(body).not.toContain("organizationId");
      expect(body).not.toContain("attempts");
      expect(body).not.toContain(String(entry.employeeId));
      expect(body).not.toContain(String(entry.organizationId));
    }
  });

  test("K8.11 to faner med samme kø: én rad for requestId", async ({ page, context }) => {
    await logInAsSampleInspector(page);
    await openTrial(page);
    const other = await context.newPage();
    await openTrial(other);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await expect.poll(async () => (await aiQueueEntries(other)).length).toBe(0);
    // Gi den andre fanen tid til å sende den samme posten hvis den gjør det
    await other.waitForTimeout(1_000);
    const rows = await aiUsageRowsById(entry.requestId);
    expect(rows).toHaveLength(1);
    expect(await aiUsageRowsForTarget(entry.targetId)).toHaveLength(1);
    await other.close();
  });

  test("K8.12 admin legger i kø og får forslaget når nettet er tilbake", async ({
    page,
    context,
  }) => {
    await logInAsSampleAdminOnly(page);
    await openTrial(page);
    await expect(page.getByRole("heading", { name: "Ingen tilgang" })).toHaveCount(0);
    const text = sentence(marker());
    const entry = await queueOffline(page, context, text);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    const rows = await aiUsageRowsById(entry.requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("ok");
  });

  test("K8.13 stående iPad: «Venter på KI» og «Nytt forslag» synlige uten sideveis rulling, trykkflater minst 44 px", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "måles bare på iPad");
    await page.setViewportSize(PORTRAIT);
    await logInAsSampleInspector(page);
    await openTrial(page);
    const text = sentence(marker());
    await queueOffline(page, context, text);

    const queuedLine = page.getByText(QUEUED_TEXT).first();
    await expect(queuedLine).toBeInViewport();
    expect(await noHorizontalScroll(page)).toBe(true);
    const askBox = await askButton(page).boundingBox();
    expect(askBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await context.setOffline(false);
    await expect(suggestionText(page)).toHaveText(polished(text), ARRIVAL);
    await field(page).fill(`${text} og mer`);
    const again = card(page).getByRole("button", { name: "Nytt forslag" });
    await again.scrollIntoViewIfNeeded();
    await expect(again).toBeInViewport();
    const box = await again.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}
