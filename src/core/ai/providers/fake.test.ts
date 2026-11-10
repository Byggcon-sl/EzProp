import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_ERROR_CODES,
  fakeAiProvider,
  fakeErrorInputs,
  fakeNoMatchInput,
  SAMPLE_TEXT,
} from "../../../../tests/ai";

/*
 * Den falske leverandøren `fake` (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 3,
 * ADR 0006 del 3). Ren regeltest: tabell med inndata og forventet svar. Ingen database, ingen nett.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (alt kan bygges og prøves uten kostnad og uten at
 * data sendes ut).
 */

const request = (prompt: string) => ({
  feature: "language_polish",
  promptVersion: "language_polish.v1",
  prompt,
  model: "fake-v1",
});

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // 3.7: ingen nettverkskall. Kaster hvis noe prøver.
  fetchSpy = vi.fn(() => {
    throw new Error("fake skal aldri gjøre nettverkskall");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("falsk leverandør (3)", () => {
  it.each([SAMPLE_TEXT, "Vinduene i stua er nye.", "Det er fukt i kjelleren ved trappen."])(
    "3.1 vanlig tekst gir ok, tekst, kostnad 0 NOK: %s",
    async (text) => {
      const result = await fakeAiProvider.complete(request(text));
      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.cost).toBe(0);
      expect(result.currency).toBe("NOK");
      expect(result.tokensIn).toBeGreaterThanOrEqual(0);
      expect(result.tokensOut).toBeGreaterThanOrEqual(0);
    },
  );

  it("3.2 samme inndata to ganger gir nøyaktig samme svar", async () => {
    const first = await fakeAiProvider.complete(request(SAMPLE_TEXT));
    const second = await fakeAiProvider.complete(request(SAMPLE_TEXT));
    expect(second).toEqual(first);
  });

  it("3.3 ulik inndata gir ulikt svar", async () => {
    const first = await fakeAiProvider.complete(request(SAMPLE_TEXT));
    const second = await fakeAiProvider.complete(request("Vinduene i stua er nye."));
    expect(first.outcome).toBe("ok");
    expect(second.outcome).toBe("ok");
    if (first.outcome === "ok" && second.outcome === "ok") {
      expect(second.text).not.toBe(first.text);
    }
  });

  it("3.4 prøveverdien for ingen treff gir no_match og kostnad 0", async () => {
    const result = await fakeAiProvider.complete(request(fakeNoMatchInput()));
    expect(result.outcome).toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.cost).toBe(0);
      expect(result.currency).toBe("NOK");
    }
  });

  it("3.5 prøveverdiene for feil gir error med en fast kode", async () => {
    const inputs = fakeErrorInputs();
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const result = await fakeAiProvider.complete(request(input));
      expect(result.outcome, input).toBe("error");
      if (result.outcome === "error") expect(AI_ERROR_CODES).toContain(result.errorCode);
    }
  });

  it("3.5 prøveverdien virker også når den står inne i en lengre ledetekst", async () => {
    const noMatch = await fakeAiProvider.complete(
      request(`Ledetekst før.\n${fakeNoMatchInput()}\nLedetekst etter.`),
    );
    expect(noMatch.outcome).toBe("no_match");
    const [errorInput] = fakeErrorInputs();
    const error = await fakeAiProvider.complete(
      request(`Ledetekst før.\n${errorInput}\nLedetekst etter.`),
    );
    expect(error.outcome).toBe("error");
  });

  it("3.6 koden er fake", () => {
    expect(fakeAiProvider.code).toBe("fake");
  });
});
