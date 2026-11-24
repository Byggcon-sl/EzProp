import { describe, expect, it } from "vitest";
import { GUARD_CASES, KNOWN_UNGUARDED_CASES } from "./guard-cases";
import {
  checkAnswerGuards,
  extractNumbers,
  extractPlaceholders,
  extractTgMentions,
  isBlankText,
} from "./guards";
import { PlaceholderRestoreError, restorePlaceholders } from "./placeholders";
import { redactText, redactTextTracked, compileKnownValues, emptyKnownValues } from "./redact-text";

/*
 * Vaktene på svaret (docs/funksjoner/fase2a-ki-i-veien-testplan.md 1a, K1.1–K1.6c og K2.1). Ren
 * test, ingen database. Testsakene står som data i `guard-cases.ts` og brukes også av
 * evalueringen. Alle tekster er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (KI-svar som endrer TG, legger til tall, mister funn eller
 * endrer skjulte opplysninger, vises aldri) og KI i bunnen (samme vakter for alle funksjoner).
 */

describe("K1.1 extractTgMentions", () => {
  it.each([
    ["Avviket har TG2.", ["tg2"]],
    ["Satt til TG 3 etter befaringen.", ["tg3"]],
    ["Gir tilstandsgrad 2.", ["tilstandsgrad2"]],
    ["Punktet er TGIU.", ["tgiu"]],
    ["Punktet er TG IU.", ["tgiu"]],
    ["Membranen er ikke undersøkt.", ["tgiu"]],
    ["Satt til TG-2.", ["tg-2"]],
    ["avviket har tg2 og Tg3", ["tg2", "tg3"]],
  ])("«%s» gir %j", (text, expected) => {
    expect(extractTgMentions(text)).toEqual(expected);
  });

  it.each(["Koden STG2 er en varekode.", "Koden TG23 er ikke en grad.", "Fuktmåling i kjeller."])(
    "«%s» gir ingen treff",
    (text) => {
      expect(extractTgMentions(text)).toEqual([]);
    },
  );
});

describe("K1.2–K1.6b og K2.1 vaktene som data", () => {
  it("testsakene finnes for alle vaktene og for alle funksjonene", () => {
    const expected = new Set(GUARD_CASES.map((guardCase) => guardCase.expected));
    for (const code of ["tg_guard", "coverage_guard", "number_guard", "placeholder_guard", null]) {
      expect(expected.has(code as never), String(code)).toBe(true);
    }
    const features = new Set(GUARD_CASES.map((guardCase) => guardCase.feature));
    expect([...features].sort()).toEqual([
      "language_polish",
      "outcome_match",
      "phrase_suggest",
      "summary_draft",
    ]);
  });

  it.each(GUARD_CASES.map((guardCase) => [guardCase.name, guardCase] as const))(
    "%s",
    (_name, guardCase) => {
      expect(
        checkAnswerGuards({
          feature: guardCase.feature,
          sent: guardCase.sent,
          answer: guardCase.answer,
        }),
      ).toBe(guardCase.expected);
    },
  );

  it("K2.1 en snudd forventning gjør testen rød (vakten svarer ikke det samme for begge)", () => {
    const stopped = GUARD_CASES.find((guardCase) => guardCase.expected === "tg_guard");
    expect(stopped).toBeDefined();
    if (!stopped) return;
    const result = checkAnswerGuards(stopped);
    expect(result).not.toBeNull();
    expect(result).not.toBe("number_guard");
  });
});

describe("K1.6c kjente saker uten vakt (spørsmål 103)", () => {
  it.each(KNOWN_UNGUARDED_CASES.map((guardCase) => [guardCase.name, guardCase] as const))(
    "%s: vaktene slipper den gjennom (evalueringen må merke den)",
    (_name, guardCase) => {
      expect(guardCase.expected).toBeNull();
      expect(checkAnswerGuards(guardCase)).toBeNull();
    },
  );
});

describe("K1.4 tallene som sifferrekker", () => {
  it.each([
    ["40 000 kr", ["40000"]],
    ["40000 kr", ["40000"]],
    ["15,0 vekt-%", ["15,0"]],
    ["15 vekt-%", ["15"]],
    ["fra 1985 til 2010", ["1985", "2010"]],
    ["se F2 og G1, K3", []],
    ["3 mm og 2 300 mm", ["3", "2300"]],
  ])("«%s» gir %j", (text, expected) => {
    expect(extractNumbers(text)).toEqual(expected);
  });
});

describe("K1.6 tom-tekst-vakten (T-0111)", () => {
  it.each(["", "   ", "\n\t ", "  ", "  \n"])("%j er tom", (text) => {
    expect(isBlankText(text)).toBe(true);
  });

  it.each(["a", " x ", " . "])("%j er ikke tom", (text) => {
    expect(isBlankText(text)).toBe(false);
  });
});

describe("K1.6b plassholderne byttes tilbake (A466)", () => {
  it("samme plassholdere i samme rekkefølge gir de opprinnelige verdiene", () => {
    const known = { ...emptyKnownValues(), personNames: ["Åse Testesen", "Per Prøvesen"] };
    const original = "Åse Testesen og Per Prøvesen var til stede";
    const tracked = redactTextTracked(original, compileKnownValues(known));
    expect(tracked.text).toBe(redactText(original, known).text);
    expect(tracked.text).toBe("[navn] og [navn] var til stede");
    const answer = "[navn] og [navn] var begge til stede.";
    expect(restorePlaceholders(answer, tracked.originals)).toBe(
      "Åse Testesen og Per Prøvesen var begge til stede.",
    );
  });

  it("plassholder fra mønstrene (e-post og telefon) får verdien tilbake", () => {
    const tracked = redactTextTracked(
      "Ring 12345678 eller skriv til ase.testesen@eksempel.no",
      null,
    );
    expect(extractPlaceholders(tracked.text)).toEqual(["[telefon]", "[e-post]"]);
    expect(restorePlaceholders("Ring [telefon] eller skriv til [e-post].", tracked.originals)).toBe(
      "Ring 12345678 eller skriv til ase.testesen@eksempel.no.",
    );
  });

  it("en plassholder den ansatte skrev selv, står som den sto", () => {
    const tracked = redactTextTracked("Skriv [navn] her", null);
    expect(tracked.originals).toEqual([{ placeholder: "[navn]", value: "[navn]" }]);
    expect(restorePlaceholders("Skriv [navn] her.", tracked.originals)).toBe("Skriv [navn] her.");
  });

  it("kjent overvask kommer tilbake slik den sto", () => {
    const known = emptyKnownValues();
    known.personNames = ["Kari Berg"];
    known.addresses.places = ["Bad"];
    known.addresses.postalCodes = ["1985"];
    const original = "Berg i veggen, flis fra 1985 Bad og Testveien 1";
    const tracked = redactTextTracked(original, compileKnownValues(known));
    expect(tracked.text).toBe(redactText(original, known).text);
    expect(tracked.originals.length).toBeGreaterThan(1);
    const restored = restorePlaceholders(tracked.text, tracked.originals);
    expect(restored).toBe(original);
  });

  it.each([
    ["en plassholder mangler", "[navn] var til stede."],
    ["en plassholder er lagt til", "[navn], [navn] og [navn] var til stede."],
    ["en annen type", "[navn] og [adresse] var til stede."],
  ])("%s gir feil, aldri feil verdi", (_name, answer) => {
    const originals = [
      { placeholder: "[navn]" as const, value: "Åse Testesen" },
      { placeholder: "[navn]" as const, value: "Per Prøvesen" },
    ];
    expect(() => restorePlaceholders(answer, originals)).toThrow(PlaceholderRestoreError);
  });
});
