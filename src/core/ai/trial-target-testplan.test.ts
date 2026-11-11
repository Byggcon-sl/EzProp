import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import {
  aiRowCount,
  allAiRows,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  fakeAiProvider,
  languagePolish,
  neutralRequestRejection,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { answerTarget, trialTarget } from "../../../tests/ai-pattern";

/*
 * Vakten for måltypen `ai_trial` (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 1
 * og 2, kortet Omfang 4, A166). Prøvesiden sender fritekst uten vask, så målet godtas bare når
 * organisasjonens leverandør er den falske. Sjekken ligger i kjernen. Mot testdatabasen.
 *
 * Støtter hovedmål: KI i bunnen (prøvesiden går gjennom samme kjerne som alt annet) og færre
 * reklamasjoner (fritekst kan aldri gå til en ekte leverandør før «Vask før KI» finnes).
 */

/**
 * Leverandøren kjernen får fra `resolveAiProvider`. Standard er den ekte funksjonen. Når
 * `override` er satt, gir den en annen leverandør (ikke `fake`), slik at vakten prøves selv om
 * koden bare har adapteren `fake` ennå.
 */
const providerSwap = vi.hoisted(() => ({
  override: null as null | { code: string; model: string; complete: (r: unknown) => unknown },
}));

vi.mock("@/core/ai/provider-resolution", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/ai/provider-resolution")>();
  return {
    ...original,
    resolveAiProvider: vi.fn(async (grant: Parameters<typeof original.resolveAiProvider>[0]) => {
      if (providerSwap.override) {
        return {
          kind: "enabled",
          provider: providerSwap.override,
          model: providerSwap.override.model,
          features: null,
        };
      }
      return original.resolveAiProvider(grant);
    }),
  };
});

beforeEach(async () => {
  await resetDatabase();
  providerSwap.override = null;
});
afterEach(() => {
  providerSwap.override = null;
  vi.restoreAllMocks();
});

/** En leverandør som ikke er `fake`. Svarer som en vanlig leverandør hvis den blir kalt. */
function otherProvider() {
  const complete = vi.fn(async () => ({
    outcome: "ok" as const,
    text: "Oppdiktet svar fra annen leverandør.",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0,
    currency: "NOK",
  }));
  return { code: "other_test_provider", model: "other-test-v1", complete };
}

async function inspectorIn(options: Parameters<typeof enableAi>[1] | "none") {
  const organization = await createOrganization("Oppdiktet Takst A");
  if (options !== "none") await enableAi(organization.id, options);
  const person = await employeeWithGrant(organization.id, ["inspector"]);
  return { organization, ...person };
}

describe("funksjonsdefinisjonen language_polish (1)", () => {
  it("1.1 har nøyaktig to lovlige mål: answer/text og ai_trial/text", () => {
    const targets = languagePolish().allowedTargets.map((t) => `${t.type}/${t.fieldKey}`);
    expect([...targets].sort()).toEqual(["ai_trial/text", "answer/text"]);
  });

  it("1.1 rettighet, ledetekstversjon og én feltkode er uendret", () => {
    const definition = languagePolish();
    expect(definition.permission).toBe("report.edit");
    // Endret med vilje fra v1 til v2 (evalueringssett, E5.7)
    expect(definition.promptVersion).toBe("language_polish.v2");
    expect([...definition.allowedFields]).toEqual(["text"]);
  });
});

describe("vakten for ai_trial: leverandør × mål (2)", () => {
  type Case = {
    name: string;
    setup: Parameters<typeof enableAi>[1] | "none";
    target: "ai_trial" | "answer";
    expected: "ok" | "disabled";
  };
  const CASES: Case[] = [
    { name: "2.1 fake + ai_trial/text", setup: {}, target: "ai_trial", expected: "ok" },
    {
      name: "2.2 rå tilkobling med annen leverandørkode (unknown_vendor) + ai_trial",
      setup: { provider: "unknown_vendor" },
      target: "ai_trial",
      expected: "disabled",
    },
    {
      name: "2.3 ingen tilkobling + ai_trial",
      setup: "none",
      target: "ai_trial",
      expected: "disabled",
    },
    {
      name: "2.4 ai.enabled = false + fake + ai_trial",
      setup: { enabled: false },
      target: "ai_trial",
      expected: "disabled",
    },
    {
      name: "2.6 fake + answer/text (ingen regresjon)",
      setup: {},
      target: "answer",
      expected: "ok",
    },
  ];

  it.each(CASES)("$name → $expected", async ({ setup, target, expected }) => {
    const { organization, grant } = await inspectorIn(setup);
    const completeSpy = vi.spyOn(fakeAiProvider, "complete");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const goal = target === "ai_trial" ? trialTarget() : answerTarget();

    const result = await requestSuggestion(grant, validRequest({ target: goal }));

    expect(fetchSpy).not.toHaveBeenCalled();
    if (expected === "disabled") {
      expect(result).toEqual({ kind: "disabled" });
      expect(await aiRowCount()).toBe(0);
      expect(completeSpy).not.toHaveBeenCalled();
      return;
    }
    expect(result.kind).toBe("suggestion");
    expect(completeSpy).toHaveBeenCalledTimes(1);
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.organization_id).toBe(organization.id);
    expect(row.target_ref).toEqual(goal);
    expect(row.status).toBe("suggested");
    expect(row.outcome).toBe("ok");
  });

  // Vask før KI (fase2a-vask-for-ki.md Omfang 5 og 6, A171, A173): en sperret forespørsel er
  // ikke lenger «KI er av» uten rad, men utfallet `blocked` med én rad og intet kall.
  it("2.2 og 2.7 vakten ligger i kjernen: annen aktiv leverandør + ai_trial gir blocked, én blocked-rad og intet kall", async () => {
    const { grant } = await inspectorIn({});
    const other = otherProvider();
    providerSwap.override = other;
    const fakeSpy = vi.spyOn(fakeAiProvider, "complete");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));

    expect(result).toEqual({ kind: "blocked" });
    expect(other.complete).not.toHaveBeenCalled();
    expect(fakeSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("blocked");
  });

  it("2.7 kontroll: samme andre leverandør + answer/text er også sperret til answers finnes (A173)", async () => {
    const { grant } = await inspectorIn({});
    const other = otherProvider();
    providerSwap.override = other;

    const result = await requestSuggestion(grant, validRequest({ target: answerTarget() }));

    expect(result).toEqual({ kind: "blocked" });
    expect(other.complete).not.toHaveBeenCalled();
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("blocked");
  });

  it.each(["title", "tg"])(
    "2.5 ai_trial med feltet %s gir nøytralt avslag og ingen rad",
    async (fieldKey) => {
      const { grant } = await inspectorIn({});
      const baseline = await neutralRequestRejection(grant);
      const spy = vi.spyOn(fakeAiProvider, "complete");

      const error = await captureError(() =>
        requestSuggestion(grant, validRequest({ target: trialTarget(undefined, fieldKey) })),
      );

      expectSameRejection(error, baseline);
      expect(error.name).toBe("AiRequestRejectedError");
      expect(spy).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
    },
  );

  it("2.8 tenant: A har fake, B har annen leverandør; B sin takstmann med ai_trial får «KI er av», og A sin tilkobling brukes aldri", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgA.id);
    await enableAi(orgB.id, { provider: "unknown_vendor" });
    const inspectorB = await employeeWithGrant(orgB.id, ["inspector"], "Test Takstmann B");
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestSuggestion(
      inspectorB.grant,
      validRequest({ target: trialTarget() }),
    );

    expect(result).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });
});
