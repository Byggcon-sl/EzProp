import { describe, expect, it } from "vitest";
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "./text-merge";

// Tekstfletting for prøve B (docs/funksjoner/fase1-kandidat-powersync.md pkt. 17).
// Testplan avsnitt 2.1. Kjører likt på iPaden og på serveren, så alt her er rene funksjoner.

const merge = mergeTextStates;

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/** To enheter som skriver i hver sin ende av samme tekst, fra felles start. */
function twoEnds() {
  const base = createTextState("Taket ");
  const a = applyTextEdit(base, "Taket er tett.");
  const b = applyTextEdit(base, "Merk: Taket ");
  return { base, a, b };
}

describe("text-merge", () => {
  it("createTextState og textOf gir samme tekst tilbake", () => {
    expect(textOf(createTextState("Tak i god stand"))).toBe("Tak i god stand");
    expect(textOf(createTextState(""))).toBe("");
  });

  it("applyTextEdit legger til tekst i slutten, starten og midten", () => {
    const state = createTextState("abc");
    expect(textOf(applyTextEdit(state, "abcd"))).toBe("abcd");
    expect(textOf(applyTextEdit(state, "xabc"))).toBe("xabc");
    expect(textOf(applyTextEdit(state, "abXc"))).toBe("abXc");
  });

  it("applyTextEdit sletter tekst i slutten, starten og midten", () => {
    const state = createTextState("abcd");
    expect(textOf(applyTextEdit(state, "abc"))).toBe("abc");
    expect(textOf(applyTextEdit(state, "bcd"))).toBe("bcd");
    expect(textOf(applyTextEdit(state, "ad"))).toBe("ad");
  });

  it("applyTextEdit erstatter hele teksten", () => {
    expect(textOf(applyTextEdit(createTextState("gammel"), "ny"))).toBe("ny");
  });

  it("to som skriver i hver sin ende samtidig gir en tekst med begge bidrag", () => {
    const { a, b } = twoEnds();
    const text = textOf(merge(a, b));
    expect(text).toContain("Merk: ");
    expect(text).toContain("er tett.");
    expect(occurrences(text, "Taket ")).toBe(1);
  });

  it("mergeTextStates er symmetrisk", () => {
    const { base, a, b } = twoEnds();
    expect(textOf(merge(a, b))).toBe(textOf(merge(b, a)));
    expect(textOf(merge(base, a))).toBe(textOf(merge(a, base)));
    // Også når begge starter fra hver sin tomme tilstand (to iPader uten felles start)
    const c = applyTextEdit(createTextState(""), "Oppdiktet fra enhet 1.");
    const d = applyTextEdit(createTextState(""), "Oppdiktet fra enhet 2.");
    expect(textOf(merge(c, d))).toBe(textOf(merge(d, c)));
  });

  it("samme tilstand flettet to ganger gir samme resultat", () => {
    const { a, b } = twoEnds();
    const once = merge(a, b);
    expect(textOf(merge(once, b))).toBe(textOf(once));
    expect(textOf(merge(once, a))).toBe(textOf(once));
    expect(textOf(merge(a, a))).toBe(textOf(a));
  });

  it("tom tilstand flettet med tekst gir teksten", () => {
    const { a } = twoEnds();
    const empty = createTextState("");
    expect(textOf(merge(empty, a))).toBe(textOf(a));
    expect(textOf(merge(a, empty))).toBe(textOf(a));
  });

  it("æøå og emoji overlever redigering og fletting", () => {
    const start = createTextState("Blåbærsyltetøy 🏠");
    const edited = applyTextEdit(start, "Blåbærsyltetøy 🏠 på Ørnes");
    expect(textOf(edited)).toBe("Blåbærsyltetøy 🏠 på Ørnes");

    const other = applyTextEdit(start, "Æ: Blåbærsyltetøy 🏠");
    const expected = "Æ: Blåbærsyltetøy 🏠 på Ørnes";
    const text = textOf(merge(edited, other));
    expect(text).toBe(expected);
    expect(text.length).toBe(expected.length);
    expect(text).not.toContain("�");
  });

  it("tilstanden er base64 og tåler JSON-rundtur", () => {
    const { a, b } = twoEnds();
    for (const state of [a, b, merge(a, b), createTextState("")]) {
      expect(typeof state).toBe("string");
      expect(state).toMatch(/^[A-Za-z0-9+/]+=*$/);
      const roundTrip = (JSON.parse(JSON.stringify({ state })) as { state: string }).state;
      expect(textOf(roundTrip)).toBe(textOf(state));
    }
  });

  it("ugyldig tilstand kaster en tydelig feil", () => {
    // Serveren må kunne svare 400, ikke skrive tom tekst
    expect(() => textOf("ikke base64!!")).toThrow(Error);
  });
});
