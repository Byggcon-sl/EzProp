import { describe, expect, it } from "vitest";
import { applyTextEdit, createTextState, textOf } from "../../text-merge";
import { nextTextState } from "./store";

// Prøve fase 1: hvordan lageret regner ny tekst-tilstand når en annen enhet har skrevet i samme
// tekstfelt (oppgavekortet pkt. 18). Oppdiktede tekster.

describe("nextTextState", () => {
  it("starter fra tom tilstand når ingenting er lagret", () => {
    expect(textOf(nextTextState(null, null, "Oppdiktet tekst"))).toBe("Oppdiktet tekst");
  });

  it("skriver videre på lagret tilstand", () => {
    const stored = createTextState("Taket ");
    expect(textOf(nextTextState(stored, null, "Taket er tett."))).toBe("Taket er tett.");
  });

  it("beholder tekst fra en annen enhet når brukeren skriver videre fra egen tekst", () => {
    const start = createTextState("Taket ");
    const own = applyTextEdit(start, "Taket er tett");
    // Lagret tilstand etter synk: begge bidrag flettet
    const stored = nextTextState(applyTextEdit(start, "Merk: Taket "), null, "Merk: Taket ");
    const merged = nextTextState(stored, null, textOf(stored));
    const result = textOf(nextTextState(merged, own, "Taket er tett."));
    expect(result).toContain("Merk: ");
    expect(result).toContain("er tett.");
  });

  it("dobler ikke teksten når brukeren skriver videre fra den flettede teksten", () => {
    const start = createTextState("Taket ");
    const own = applyTextEdit(start, "Taket er tett");
    const remote = applyTextEdit(start, "Merk: Taket ");
    const stored = nextTextState(remote, own, "Taket er tett");
    const seen = textOf(stored);
    expect(textOf(nextTextState(stored, own, `${seen} Ok`))).toBe(`${seen} Ok`);
  });
});
