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

/*
 * «KI i veien» (docs/funksjoner/fase2a-ki-i-veien.md «Falsk leverandør»): samme svar hver gang,
 * rangering etter ordlikhet med fast grense, utkast per F-merke, og prøveverdier som provoserer
 * vaktene. Ledetekstene bygges med `prompt.ts`, slik kjernen gjør.
 */
describe("KI i veien: den falske leverandøren for de nye funksjonene", () => {
  async function phrasePrompt(text: string, texts: string[]) {
    const { AI_FEATURES } = await import("../features");
    const { prepareCandidatePrompt } = await import("../prompt");
    const candidates = texts.map((entry, index) => ({
      source: "template_outcome" as const,
      id: `0190a0b0-0000-7000-8000-00000000000${index}`,
      text: entry,
    }));
    return prepareCandidatePrompt(
      AI_FEATURES.phrase_suggest,
      { text, outcome_key: "membrane_crack", group: "tg2" },
      candidates,
      null,
    ).prompt;
  }

  async function summaryPrompt(findings: { name: string; text: string }[]) {
    const { AI_FEATURES } = await import("../features");
    const { prepareSummaryPrompt } = await import("../prompt");
    return prepareSummaryPrompt(
      AI_FEATURES.summary_draft,
      [
        {
          group: "tg2",
          heading: "TG2 Vesentlige avvik",
          findings: findings.map((finding) => ({
            checkpointName: finding.name,
            deviationText: finding.text,
            causeText: null,
            consequenceText: null,
            measures: [],
          })),
          fixedLines: [],
        },
      ],
      null,
    ).prompt;
  }

  const call = (feature: string, prompt: string) =>
    fakeAiProvider.complete({ feature, promptVersion: `${feature}.v1`, prompt, model: "fake-v1" });

  it("phrase_suggest: rangerer etter ordlikhet og svarer med merker", async () => {
    const prompt = await phrasePrompt("sprekker i membranen ved sluket", [
      "Klemringen mangler",
      "Membranen har sprekker ved sluket",
      "Sprekker i flisene",
    ]);
    const result = await call("phrase_suggest", prompt);
    expect(result).toMatchObject({ outcome: "ok", text: "K2, K3" });
    // Samme svar hver gang
    expect(await call("phrase_suggest", prompt)).toEqual(result);
  });

  it("phrase_suggest: under grensen for alle gir «INGEN»", async () => {
    const { FAKE_PHRASE_MIN_SCORE } = await import("./fake");
    expect(FAKE_PHRASE_MIN_SCORE).toBeGreaterThan(0);
    const prompt = await phrasePrompt("takrenne beslag nedløp", ["Klemringen mangler"]);
    expect(await call("phrase_suggest", prompt)).toMatchObject({ outcome: "ok", text: "INGEN" });
  });

  it("phrase_suggest: tomt felt gir kandidatene i rekkefølgen de kom, høyst fem", async () => {
    const prompt = await phrasePrompt(
      "",
      Array.from({ length: 7 }, (_, index) => `Kandidat nummer ${index}`),
    );
    expect(await call("phrase_suggest", prompt)).toMatchObject({ text: "K1, K2, K3, K4, K5" });
  });

  it("summary_draft: én linje per F-merke med funnets egen tekst, og prøveverdiene virker", async () => {
    const { FAKE_ADD_TG_INPUT, FAKE_DROP_FINDING_INPUT, FAKE_ADDED_TG } = await import("./fake");
    const prompt = await summaryPrompt([
      { name: "Sluk", text: "klemringen mangler" },
      { name: "Ventil", text: `avtrekket er svakt ${FAKE_ADD_TG_INPUT}` },
      { name: "Flis", text: `sprekker ${FAKE_DROP_FINDING_INPUT}` },
    ]);
    const result = await call("summary_draft", prompt);
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    const lines = result.text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("F1: Klemringen mangler.");
    expect(lines[1]).toContain(FAKE_ADDED_TG);
    expect(result.text).not.toContain("F3");
  });

  it("language_polish: prøveverdiene legger til TG og tall, og tar bort en plassholder", async () => {
    const { FAKE_ADD_NUMBER_INPUT, FAKE_ADDED_NUMBER, FAKE_DROP_PLACEHOLDER_INPUT } =
      await import("./fake");
    const number = await fakeAiProvider.complete(request(`tekst ${FAKE_ADD_NUMBER_INPUT}`));
    expect(number.outcome === "ok" && number.text).toContain(FAKE_ADDED_NUMBER);
    const dropped = await fakeAiProvider.complete(
      request(`[navn] ringte ${FAKE_DROP_PLACEHOLDER_INPUT}`),
    );
    expect(dropped.outcome === "ok" && dropped.text).not.toContain("[navn]");
    // Prøveverdiene har ingen sifre og ingen TG, så de ikke selv slår ut i vaktene
    for (const marker of [FAKE_ADD_NUMBER_INPUT, FAKE_DROP_PLACEHOLDER_INPUT]) {
      expect(marker).not.toMatch(/\d|TG\s?\d/u);
    }
  });
});
