import { describe, expect, it } from "vitest";
import { SEARCH_QUERY_MAX_LENGTH, likePattern } from "./like-pattern";

/*
 * Den felles søkehjelperen (docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 1).
 * Ren enhetstest uten database. Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (samme søk virker likt i ordrelisten, arbeidskøen og kontaktene) og
 * reklamasjoner (`%`, `_` og `\` gir aldri treff på alt, så kontoret velger ikke feil rad).
 */

/** Søketeksten i mønsteret, uten `%` foran og bak. */
function inner(pattern: string | null): string {
  expect(pattern).not.toBeNull();
  expect(pattern!.startsWith("%")).toBe(true);
  expect(pattern!.endsWith("%")).toBe(true);
  return pattern!.slice(1, -1);
}

describe("1 likePattern", () => {
  it("grensen er 100 tegn", () => {
    expect(SEARCH_QUERY_MAX_LENGTH).toBe(100);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["tom", ""],
    ["bare mellomrom", "   "],
    ["tabulator og linjeskift", "\t\n "],
  ])("1.1 tom tekst (%s) gir null", (_name, query) => {
    expect(likePattern(query)).toBeNull();
  });

  it("1.2 trimmer", () => {
    expect(likePattern("  Fjord  ")).toBe("%Fjord%");
  });

  it("1.3 kutter ved 100 tegn", () => {
    const query = "a".repeat(150);
    const text = inner(likePattern(query));
    expect(text.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX_LENGTH);
    expect(text).toBe("a".repeat(100));
  });

  it("1.3 trimmer også etter kuttet", () => {
    // 99 tegn, mellomrom på plass 100, og mer tekst som kuttes bort
    const query = `${"b".repeat(99)} ${"c".repeat(20)}`;
    expect(inner(likePattern(query))).toBe("b".repeat(99));
  });

  it("1.3 tekst som blir tom etter kutt og trim gir null", () => {
    expect(likePattern(" ".repeat(120))).toBeNull();
  });

  it("1.3 mellomrom foran telles ikke med i de 100 tegnene", () => {
    const query = `${" ".repeat(10)}${"d".repeat(100)}`;
    expect(inner(likePattern(query))).toBe("d".repeat(100));
  });

  it.each([
    ["prosent", "%", "\\%"],
    ["understrek", "_", "\\_"],
    ["omvendt skråstrek", "\\", "\\\\"],
    ["blandet", "50%_\\", "50\\%\\_\\\\"],
    ["skråstrek før prosent", "\\%", "\\\\\\%"],
    ["flere av samme", "%%__", "\\%\\%\\_\\_"],
    ["midt i tekst", "Gate_7 100%", "Gate\\_7 100\\%"],
  ])("1.4 escaper %s", (_name, query, expected) => {
    expect(inner(likePattern(query))).toBe(expected);
  });

  it("1.4 `\\` escapes først, så `%` ikke blir dobbelt-escapet", () => {
    // «%» skal gi nøyaktig ett «\» foran, aldri «\\%» (som ville bety en bokstavelig «\» og jokertegn)
    expect(likePattern("%")).toBe("%\\%%");
    expect(likePattern("_")).toBe("%\\_%");
  });

  it.each([
    ["adresse", "Fjordgata 7", "%Fjordgata 7%"],
    ["store bokstaver", "FJORDG", "%FJORDG%"],
    ["små bokstaver", "fjordg", "%fjordg%"],
    ["æøå", "Øvre Ålgård", "%Øvre Ålgård%"],
    ["matrikkel", "12/34", "%12/34%"],
    ["nummer", "2026-00001", "%2026-00001%"],
  ])("1.5 vanlig tekst (%s) endres ikke utover % foran og bak", (_name, query, expected) => {
    expect(likePattern(query)).toBe(expected);
  });
});
