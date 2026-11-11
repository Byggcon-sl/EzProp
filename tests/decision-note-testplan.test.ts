import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Beslutningsnotatet om KI-leverandør (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt 5,
 * D1, kortet Omfang 1). Sjekker formen: sju deler, svaret om EU/EØS først, egen liste over det som
 * er usikkert, datoer på prisene og ingen gjetteord. Klarspråk, at teksten ikke er kopiert fra
 * vilkårene, at trening og lagring holdes fra hverandre, og at ingen ansatte nevnes, sjekkes
 * manuelt i gjennomgangen. Modellnavn dekkes av tests/no-model-names.test.ts (S1).
 *
 * Støtter hovedmål: de ansatte (Ståle får ett kort notat med det han må vite og avgjøre) og KI i
 * bunnen (ekte KI slås ikke på før avtale, EU/EØS-vei og personvern er avklart).
 */

const NOTE_PATH = join(__dirname, "..", "docs", "beslutningsnotat-ki-leverandor.md");

function note(): string {
  if (!existsSync(NOTE_PATH)) throw new Error("docs/beslutningsnotat-ki-leverandor.md finnes ikke");
  return readFileSync(NOTE_PATH, "utf8");
}

type Section = { level: number; title: string; body: string };

/** Overskriftene (#, ##, ###) med teksten under, til neste overskrift på samme eller høyere nivå. */
function sections(text: string): Section[] {
  const lines = text.split("\n");
  const heads = lines.flatMap((line, index) => {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    return match ? [{ index, level: match[1]!.length, title: match[2]! }] : [];
  });
  return heads.map((head, i) => {
    const next = heads.slice(i + 1).find((other) => other.level <= head.level);
    const end = next ? next.index : lines.length;
    return {
      level: head.level,
      title: head.title,
      body: lines.slice(head.index + 1, end).join("\n"),
    };
  });
}

function findSection(text: string, pattern: RegExp): Section | undefined {
  return sections(text).find((section) => pattern.test(section.title));
}

/** Første avsnitt etter tittelen: første blokk med tekst som ikke er overskrift, liste eller metadata. */
function firstParagraph(text: string): string {
  const afterTitle = text.split("\n").slice(text.split("\n").findIndex((l) => /^#\s/.test(l)) + 1);
  const blocks = afterTitle.join("\n").split(/\n\s*\n/);
  const paragraph = blocks
    .map((block) => block.trim())
    .find((block) => block !== "" && !/^(#|[-*]\s|\d+\.\s|>|\|)/.test(block));
  return paragraph ?? "";
}

describe("beslutningsnotatet (D1)", () => {
  it("5.1 notatet finnes", () => {
    expect(existsSync(NOTE_PATH)).toBe(true);
    expect(note().trim().length).toBeGreaterThan(500);
    expect(/^#\s+\S/m.test(note())).toBe(true);
  });

  it.each([
    { part: "modellvalg per funksjon", pattern: /modell/i },
    { part: "pris per rapport", pattern: /pris|kostnad/i },
    { part: "EU/EØS", pattern: /EU\/EØS|EØS/ },
    { part: "databehandleravtale", pattern: /databehandleravtale/i },
    { part: "trening og lagring", pattern: /trening.*lagring|lagring.*trening/i },
    { part: "tale til tekst", pattern: /tale/i },
    { part: "hva Ståle må gjøre", pattern: /Ståle/ },
  ])("5.2 har en overskrift for $part", ({ pattern }) => {
    expect(findSection(note(), pattern)).toBeDefined();
  });

  it("5.3 første avsnitt etter tittelen nevner EU/EØS", () => {
    expect(firstParagraph(note())).toContain("EU/EØS");
  });

  it("5.4 «Dette er usikkert» er en egen overskrift med minst ett listepunkt", () => {
    const section = findSection(note(), /^Dette er usikkert\b/i);
    expect(section).toBeDefined();
    expect(section!.body).toMatch(/^\s*([-*]|\d+\.)\s+\S/m);
  });

  it.each(["antas", "trolig"])("5.5 ingen gjetteord: «%s»", (word) => {
    expect(note()).not.toMatch(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "iu"));
  });

  it("5.6 pris-delen har minst én dato og «må sjekkes på nytt»", () => {
    const section = findSection(note(), /pris/i);
    expect(section).toBeDefined();
    expect(section!.body).toMatch(/\b\d{1,2}\.\s?\d{1,2}\.\s?20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/);
    expect(section!.body).toMatch(/må sjekkes på nytt/i);
  });

  it("5.6 pris-delen er i kroner", () => {
    const section = findSection(note(), /pris/i);
    expect(section!.body).toMatch(/\bkr\b|kroner|NOK/i);
  });

  it("notatet nevner hemmeligheten ANTHROPIC_API_KEY, men aldri en verdi i nøkkelformat", () => {
    const text = note();
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
  });
});
