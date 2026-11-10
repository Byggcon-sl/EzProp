import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_FEATURES,
  FAKE_ERROR_INPUT,
  FAKE_MODEL,
  FAKE_NO_MATCH_INPUT,
  fakeAiProvider,
  type AiProviderRequest,
} from "@/core/ai";

/*
 * Den falske leverandøren (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 3).
 * Regeltest som tabell: inndata → forventet svar. Ren, ingen database, ingen nettverkskall.
 *
 * Støtter hovedmål: de ansatte og KI i bunnen (alt kan bygges og prøves uten kostnad og uten at
 * data sendes ut).
 */

const ERROR_CODES = ["timeout", "rate_limited", "unavailable", "rejected", "unknown"];

function requestFor(text: string): AiProviderRequest {
  const definition = AI_FEATURES.language_polish;
  return {
    feature: "language_polish",
    promptVersion: definition.promptVersion,
    prompt: definition.buildPrompt({ text }),
    model: FAKE_MODEL,
  };
}

const fetchSpy = vi.fn(() => {
  throw new Error("nettverkskall er ikke lov i testen");
});

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(fetchSpy, "3.7 ingen nettverkskall").not.toHaveBeenCalled();
});

describe("falsk leverandør: kode og modell (3.6)", () => {
  it("3.6 code er fake, og modellen er fake-v1", () => {
    expect(fakeAiProvider.code).toBe("fake");
    expect(FAKE_MODEL).toBe("fake-v1");
  });
});

describe("falsk leverandør: svar per inndata (3.1–3.5)", () => {
  it.each([
    ["vanlig tekst", "taket er gammelt og har noen sprekker"],
    ["tekst med punktum", "Vinduene er skiftet i 2015."],
    ["tekst med flere linjer", "Kledningen er malt.\nTakrennene er tette."],
  ])("3.1 %s → ok, ikke tom tekst, kostnad 0 NOK, tokens ≥ 0", async (_name, text) => {
    const result = await fakeAiProvider.complete(requestFor(text));
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.cost).toBe(0);
    expect(result.currency).toBe("NOK");
    expect(result.tokensIn).toBeGreaterThanOrEqual(0);
    expect(result.tokensOut).toBeGreaterThanOrEqual(0);
  });

  it("3.2 samme inndata to ganger gir nøyaktig samme svar", async () => {
    const first = await fakeAiProvider.complete(requestFor("grunnmuren har riss"));
    const second = await fakeAiProvider.complete(requestFor("grunnmuren har riss"));
    expect(second).toEqual(first);
  });

  it("3.3 ulik inndata gir ulikt svar (ikke fast tekst for alt)", async () => {
    const first = await fakeAiProvider.complete(requestFor("grunnmuren har riss"));
    const second = await fakeAiProvider.complete(requestFor("pipa mangler beslag"));
    expect(first.outcome).toBe("ok");
    expect(second.outcome).toBe("ok");
    expect(second).not.toEqual(first);
  });

  it("3.4 prøveverdien for ingen treff → no_match med kostnad 0", async () => {
    const result = await fakeAiProvider.complete(requestFor(FAKE_NO_MATCH_INPUT));
    expect(result.outcome).toBe("no_match");
    if (result.outcome !== "no_match") return;
    expect(result.cost).toBe(0);
    expect(result.currency).toBe("NOK");
  });

  it("3.5 prøveverdien for feil → error med en fast kode", async () => {
    const result = await fakeAiProvider.complete(requestFor(FAKE_ERROR_INPUT));
    expect(result.outcome).toBe("error");
    if (result.outcome !== "error") return;
    expect(ERROR_CODES).toContain(result.errorCode);
    expect(Object.keys(result).sort()).toEqual(["errorCode", "outcome"]);
  });

  it("3.5 prøveverdiene gir samme utfall hver gang", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await fakeAiProvider.complete(requestFor(FAKE_NO_MATCH_INPUT))).outcome).toBe(
        "no_match",
      );
      expect((await fakeAiProvider.complete(requestFor(FAKE_ERROR_INPUT))).outcome).toBe("error");
    }
  });
});
