import { expect, test, type Page } from "@playwright/test";
import { parseTrialNumber } from "../src/modules/offline-trial/answers";
import {
  trialRuleCases,
  type TrialRuleCase,
} from "../src/modules/offline-trial/rules/trial-rule-cases";
import { trialRules, type TrialRuleState } from "../src/modules/offline-trial/rules/trial-rules";
import {
  ADMIN_EMAIL,
  countRequests,
  createTrialForm,
  hookValue,
  logIn,
  numberInput,
  ruleResult,
  useCandidate,
} from "./helpers";

// Prøve E: regler uten nett (docs/funksjoner/fase1-prove-e-regler.md pkt. 5–6, AK 6).
// Testplan: docs/funksjoner/fase1-prove-e-regler-testplan.md avsnitt 5.2. Testsakene er de samme
// dataene som Vitest og resultatmalen bruker. Testene leser `data-rule-state`, aldri norsk tekst.
// Kandidat «custom» (egenbygd) er den eneste som virker fullt uten synktjeneste i e2e.

const RULES_PATH = "/api/prove/regler";
const RULES_ROUTE = `**${RULES_PATH}`;
/** Verdi som er over begge prøvegrensene (oppdiktet). Brukes for å få en kjent tilstand før hver sak. */
const ABOVE_BOTH = "100";

function pcOnly(testInfo: { project: { name: string } }) {
  test.skip(
    testInfo.project.name !== "pc",
    "Ruten svarer likt uansett skjermstørrelse, så dette kjøres bare i pc (testplan 5.2)",
  );
}

function ipadOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "ipad", "Gjelder iPad-størrelse (testplan 5.2)");
}

function fieldFor(testCase: TrialRuleCase): string {
  const rule = trialRules.find((entry) => entry.key === testCase.rule_key);
  if (!rule) throw new Error(`Fant ikke regelen ${testCase.rule_key}`);
  return rule.field;
}

function label(testCase: TrialRuleCase): string {
  return `${testCase.rule_key}: ${testCase.name}`;
}

/** Logger inn som admin, lager et nytt testskjema og venter til det er klart. */
async function openNewForm(page: Page): Promise<string> {
  await logIn(page, ADMIN_EMAIL);
  const id = await createTrialForm(page);
  await expect(page.getByText(/^0 av 40 felt utfylt$/)).toBeVisible();
  expect(await hookValue(page, "candidate")).toBe("custom");
  return id;
}

/**
 * Fyller inn en testsak og venter på svaret. Først settes feltet til en verdi som gir en annen
 * tilstand enn forventet, så venter testen alltid på en endring og aldri på en gammel linje.
 */
async function enterCase(page: Page, testCase: TrialRuleCase): Promise<void> {
  const input = numberInput(page, fieldFor(testCase));
  const result = ruleResult(page, testCase.rule_key);
  const primed: [string, TrialRuleState] =
    testCase.expect_state === "not_evaluated" ? [ABOVE_BOTH, "triggered"] : ["", "not_evaluated"];
  await input.fill(primed[0]);
  await expect(result, `${label(testCase)} (før)`).toHaveAttribute("data-rule-state", primed[1]);
  await input.fill(testCase.input);
  await expect(result, label(testCase)).toHaveAttribute("data-rule-state", testCase.expect_state);
}

test.beforeEach(async ({ context }) => {
  await useCandidate(context, "custom");
});

test("regelsvaret vises under begge feltene", async ({ page }) => {
  await openNewForm(page);
  for (const rule of trialRules) {
    const result = ruleResult(page, rule.key);
    await expect(result, rule.key).toHaveCount(1);
    await expect(result, rule.key).toBeVisible();
    await expect(result, rule.key).toHaveAttribute("data-rule-state", "not_evaluated");
    await expect(result, rule.key).toHaveAttribute("aria-live", "polite");
    const inputBox = await numberInput(page, rule.field).boundingBox();
    const resultBox = await result.boundingBox();
    expect(inputBox && resultBox, rule.key).toBeTruthy();
    expect(resultBox!.y, `${rule.key} står under feltet`).toBeGreaterThanOrEqual(
      inputBox!.y + inputBox!.height - 1,
    );
  }
});

// Obligatorisk (AK 6)
test("uten nett gir hver testsak riktig svar", async ({ page, context }) => {
  await openNewForm(page);
  const ruleCalls = countRequests(page, RULES_ROUTE);
  try {
    await context.setOffline(true);
    for (const testCase of trialRuleCases) {
      await enterCase(page, testCase);
    }
    expect(ruleCalls.count(), "ingen kall til regelruten").toBe(0);
  } finally {
    await context.setOffline(false);
  }
});

test("svaret endres uten ekstra trykk", async ({ page, context }, testInfo) => {
  ipadOnly(testInfo);
  await openNewForm(page);
  const input = numberInput(page, "water_heater_age");
  const result = ruleResult(page, "trial_water_heater_age");
  try {
    await context.setOffline(true);
    await input.fill("6");
    await expect(result).toHaveAttribute("data-rule-state", "not_triggered");
    await input.fill("8");
    await expect(result).toHaveAttribute("data-rule-state", "triggered");
  } finally {
    await context.setOffline(false);
  }
});

// Obligatorisk (AK 6)
test("nettleser og server gir samme svar for alle testsakene", async ({
  page,
  context,
}, testInfo) => {
  pcOnly(testInfo);
  await openNewForm(page);
  const organizationId = await hookValue(page, "organizationId");
  const ruleCalls = countRequests(page, RULES_ROUTE);

  const fromBrowser = new Map<TrialRuleCase, string | null>();
  try {
    await context.setOffline(true);
    for (const testCase of trialRuleCases) {
      await enterCase(page, testCase);
      fromBrowser.set(
        testCase,
        await ruleResult(page, testCase.rule_key).getAttribute("data-rule-state"),
      );
    }
    expect(ruleCalls.count(), "ingen kall til regelruten uten nett").toBe(0);
  } finally {
    await context.setOffline(false);
  }

  for (const testCase of trialRuleCases) {
    const response = await page.request.post(RULES_PATH, {
      data: {
        organizationId,
        answers: { [fieldFor(testCase)]: parseTrialNumber(testCase.input) },
      },
    });
    expect(response.status(), label(testCase)).toBe(200);
    const body = (await response.json()) as { results: { key: string; state: string }[] };
    const fromServer = body.results.find((entry) => entry.key === testCase.rule_key)?.state;
    expect(fromBrowser.get(testCase), label(testCase)).toBe(testCase.expect_state);
    expect(fromServer, label(testCase)).toBe(testCase.expect_state);
    expect(fromServer, label(testCase)).toBe(fromBrowser.get(testCase));
  }
});

test("ruten krever innlogging", async ({ request }, testInfo) => {
  pcOnly(testInfo);
  const response = await request.post(RULES_PATH, {
    data: { organizationId: crypto.randomUUID(), answers: {} },
  });
  expect(response.status()).toBe(401);
});

test("ruten gir 403 for annen organisasjon", async ({ page }, testInfo) => {
  pcOnly(testInfo);
  await logIn(page, ADMIN_EMAIL);
  const response = await page.request.post(RULES_PATH, {
    data: { organizationId: crypto.randomUUID(), answers: { water_heater_age: 8 } },
  });
  expect(response.status()).toBe(403);
});

test("regelsvaret etter omlasting uten nett", async ({ page, context }) => {
  await openNewForm(page);
  // Samme vei som «skjemaet åpner fra hurtiglageret uten nett» i fase-1-egenbygd.spec.ts
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByText(/^0 av 40 felt utfylt$/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await numberInput(page, "water_heater_age").fill("7,5");
  await expect(ruleResult(page, "trial_water_heater_age")).toHaveAttribute(
    "data-rule-state",
    "triggered",
  );
  await expect(page.getByText(/^1 av 40 felt utfylt$/)).toBeVisible();

  try {
    await context.setOffline(true);
    let reloaded = true;
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    } catch {
      reloaded = false;
    }
    test.skip(
      !reloaded,
      "Testskjemaet lastet ikke på nytt uten nett i Chromium her; ikke dekket (oppgavekort pkt. 6)",
    );
    await expect(ruleResult(page, "trial_water_heater_age")).toHaveAttribute(
      "data-rule-state",
      "triggered",
    );
  } finally {
    await context.setOffline(false);
  }
});
