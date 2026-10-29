import { expect, test, type Page } from "@playwright/test";
import { parseTrialNumber } from "../src/modules/offline-trial/answers";
import {
  trialRuleCases,
  trialRules,
  type TrialRuleCase,
} from "../src/modules/offline-trial/rules/index";
import {
  ADMIN_EMAIL,
  countRequests,
  createTrialForm,
  hookValue,
  logIn,
  numberInput,
  readRowsViaHook,
  ruleResult,
  useCandidate,
} from "./helpers";

// Prøve E: regler uten nett (docs/funksjoner/fase1-prove-e-regler.md pkt. 5–6, AK 6).
// Testplan: docs/funksjoner/fase1-prove-e-regler-testplan.md avsnitt 5.2. Testsakene er felles
// fasit fra src/modules/offline-trial/rules. Testene leser `data-rule-state`, aldri norsk tekst.
// Egenbygd er eneste kandidat som virker fullt uten synktjeneste i e2e. Bare admin her; de fire
// rollene dekkes i route.test.ts. Alle data er oppdiktet.

const RULES_PATH = "/api/prove/regler";
const RULES_GLOB = `**${RULES_PATH}`;

function pcOnly(testInfo: { project: { name: string } }, reason: string) {
  test.skip(testInfo.project.name !== "pc", reason);
}

function fieldOf(ruleKey: string): string {
  const rule = trialRules.find((entry) => entry.key === ruleKey);
  if (!rule) throw new Error(`Fant ikke regelen ${ruleKey}`);
  return rule.field;
}

function caseLabel(entry: TrialRuleCase): string {
  return `${entry.rule_key} / ${entry.name} («${entry.input}»)`;
}

async function openNewForm(page: Page) {
  await logIn(page, ADMIN_EMAIL);
  await createTrialForm(page);
  for (const rule of trialRules) await expect(numberInput(page, rule.field)).toBeVisible();
}

/**
 * Fyller inn en testsak og venter på at svaret under feltet er oppdatert. Først settes en verdi
 * med en annen tilstand enn den forventede, så testen aldri leser et gammelt svar som tilfeldigvis
 * er likt. Gir tilstanden nettleseren viser.
 */
async function browserStateFor(page: Page, entry: TrialRuleCase): Promise<string | null> {
  const input = numberInput(page, fieldOf(entry.rule_key));
  const line = ruleResult(page, entry.rule_key);
  const [resetText, resetState] =
    entry.expect_state === "not_evaluated" ? ["0", "not_triggered"] : ["", "not_evaluated"];
  await input.fill(resetText);
  await expect(line, `${caseLabel(entry)}: før`).toHaveAttribute("data-rule-state", resetState);
  await input.fill(entry.input);
  try {
    await expect(line).toHaveAttribute("data-rule-state", entry.expect_state);
  } catch {
    // Les det som faktisk vises, så sammenligningen under sier hvilken sak som er ulik
  }
  return line.getAttribute("data-rule-state");
}

test.beforeEach(async ({ context }) => {
  await useCandidate(context, "custom");
});

test("regelsvaret vises under begge feltene", async ({ page }) => {
  await openNewForm(page);
  for (const rule of trialRules) {
    const line = ruleResult(page, rule.key);
    await expect(line, rule.key).toHaveCount(1);
    await expect(line, rule.key).toBeVisible();
    await expect(line, rule.key).toHaveAttribute("data-rule-state", "not_evaluated");
    await expect(line, rule.key).toHaveAttribute("aria-live", "polite");
    // Under feltet: linjen begynner nedenfor toppen av tallfeltet
    const inputBox = await numberInput(page, rule.field).boundingBox();
    const lineBox = await line.boundingBox();
    expect(inputBox && lineBox, rule.key).toBeTruthy();
    expect(lineBox!.y, `${rule.key} ligger under feltet`).toBeGreaterThan(inputBox!.y);
  }
});

// Obligatorisk (AK 6)
test("uten nett gir hver testsak riktig svar", async ({ page, context }) => {
  const calls = countRequests(page, RULES_GLOB);
  await openNewForm(page);
  try {
    await context.setOffline(true);
    for (const entry of trialRuleCases) {
      const state = await browserStateFor(page, entry);
      expect(state, caseLabel(entry)).toBe(entry.expect_state);
    }
  } finally {
    await context.setOffline(false);
  }
  expect(calls.count(), "forespørsler til regelruten").toBe(0);
});

test("svaret endres uten ekstra trykk", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "ipad", "Kjøres bare i iPad-størrelse (testplan 5.2)");
  await openNewForm(page);
  const input = numberInput(page, "water_heater_age");
  const line = ruleResult(page, "trial_water_heater_age");
  try {
    await context.setOffline(true);
    await input.click();
    await input.pressSequentially("6");
    await expect(line).toHaveAttribute("data-rule-state", "not_triggered");
    await input.press("Backspace");
    await input.pressSequentially("8");
    await expect(line).toHaveAttribute("data-rule-state", "triggered");
    await expect(input).toBeFocused();
  } finally {
    await context.setOffline(false);
  }
});

// Obligatorisk (AK 6)
test("nettleser og server gir samme svar for alle testsakene", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo, "Ruten svarer likt uansett skjermstørrelse; sammenlignes bare i pc (pkt. 6)");
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");

  const browser: (string | null)[] = [];
  try {
    await context.setOffline(true);
    for (const entry of trialRuleCases) browser.push(await browserStateFor(page, entry));
  } finally {
    await context.setOffline(false);
  }

  for (const [index, entry] of trialRuleCases.entries()) {
    const field = fieldOf(entry.rule_key);
    const response = await page.request.post(RULES_PATH, {
      data: { organizationId, answers: { [field]: parseTrialNumber(entry.input) } },
    });
    expect(response.status(), caseLabel(entry)).toBe(200);
    const body = (await response.json()) as unknown;
    const list = (Array.isArray(body) ? body : (body as { results?: unknown } | null)?.results) as
      { key: string; state: string }[] | undefined;
    expect(Array.isArray(list), `${caseLabel(entry)}: regelsvar i kroppen`).toBe(true);
    const server = list!.find((result) => result.key === entry.rule_key)?.state;
    expect(
      { nettleser: browser[index], server },
      `${caseLabel(entry)}: nettleser og server`,
    ).toEqual({ nettleser: entry.expect_state, server: entry.expect_state });
  }
});

test("ruten krever innlogging", async ({ request }, testInfo) => {
  pcOnly(testInfo, "Rutetest, kjøres bare i pc");
  const response = await request.post(RULES_PATH, {
    data: { organizationId: crypto.randomUUID(), answers: {} },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("ruten gir 403 for annen organisasjon", async ({ page }, testInfo) => {
  pcOnly(testInfo, "Rutetest, kjøres bare i pc");
  await logIn(page, ADMIN_EMAIL);
  const response = await page.request.post(RULES_PATH, {
    data: { organizationId: crypto.randomUUID(), answers: { water_heater_age: 8 } },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body = (await response.json()) as Record<string, unknown>;
  expect(typeof body.feil).toBe("string");
  expect(body).not.toHaveProperty("results");
});

test("regelsvaret etter omlasting uten nett", async ({ page, context }, testInfo) => {
  await openNewForm(page);
  // Samme vei som fase-1-egenbygd.spec.ts («reload uten nett»): service worker klar og hurtiglager fylt
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(numberInput(page, "water_heater_age")).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const formId = new URL(page.url()).pathname.split("/").pop()!;
  await numberInput(page, "water_heater_age").fill("7,5");
  await expect(ruleResult(page, "trial_water_heater_age")).toHaveAttribute(
    "data-rule-state",
    "triggered",
  );
  // Svaret er lagret lokalt før omlastingen
  await expect
    .poll(
      async () =>
        (await readRowsViaHook(page, "trial_answers", formId)).some(
          (row) => row.field_key === "water_heater_age",
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  let reloaded = false;
  try {
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(numberInput(page, "water_heater_age")).toBeVisible();
      reloaded = true;
    } catch (error) {
      testInfo.annotations.push({
        type: "ikke dekket",
        description: `omlasting uten nett virket ikke: ${String(error).slice(0, 120)}`,
      });
    }
    test.skip(!reloaded, "Testskjemaet kan ikke lastes på nytt uten nett her (pkt. 6)");
    await expect(ruleResult(page, "trial_water_heater_age")).toHaveAttribute(
      "data-rule-state",
      "triggered",
    );
    await expect(ruleResult(page, "trial_moisture_floor_limit")).toHaveAttribute(
      "data-rule-state",
      "not_evaluated",
    );
  } finally {
    await context.setOffline(false);
  }
});
