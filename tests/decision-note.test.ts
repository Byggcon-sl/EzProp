import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Beslutningsnotatet om KI-leverandør til Ståle (S8).
 * Testplan: docs/funksjoner/fase2a-ki-leverandor-testplan.md, del 5 (D1).
 * Modellnavn sjekkes i tests/no-model-names.test.ts (S1).
 * Klarspråk, egne ord og at trening og lagring holdes fra hverandre, sjekkes manuelt.
 */

const NOTE_PATH = "docs/beslutningsnotat-ki-leverandor.md";

function readNote(): string {
  return readFileSync(join(process.cwd(), NOTE_PATH), "utf8");
}

function headings(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^##\s/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}

/** Teksten under en overskrift på nivå 2, fram til neste overskrift på samme nivå. */
function section(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line) => line.replace(/^##\s+/, "").trim() === title && /^##\s/.test(line),
  );
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("beslutningsnotat om KI-leverandør (D1)", () => {
  it("D1 5.1 notatet finnes", () => {
    expect(existsSync(join(process.cwd(), NOTE_PATH))).toBe(true);
  });

  it("D1 5.2 har de sju delene som egne overskrifter", () => {
    const found = headings(readNote());
    for (const title of [
      "EU/EØS",
      "Modellvalg per funksjon",
      "Pris per rapport",
      "Databehandleravtale",
      "Trening og lagring",
      "Tale til tekst",
      "Hva Ståle må gjøre",
    ]) {
      expect(found).toContain(title);
    }
  });

  it("D1 5.3 første avsnitt etter tittelen svarer på EU/EØS", () => {
    const lines = readNote().split("\n");
    const titleIndex = lines.findIndex((line) => /^#\s/.test(line));
    expect(titleIndex).toBeGreaterThanOrEqual(0);
    const firstParagraph = lines
      .slice(titleIndex + 1)
      .join("\n")
      .trim()
      .split(/\n\s*\n/)[0];
    expect(firstParagraph).toContain("EU/EØS");
  });

  it("D1 5.4 «Dette er usikkert» er en egen overskrift med minst ett listepunkt", () => {
    const note = readNote();
    expect(headings(note)).toContain("Dette er usikkert");
    const items = section(note, "Dette er usikkert")
      .split("\n")
      .filter((line) => /^\s*-\s+\S/.test(line));
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("D1 5.5 har ingen gjetteord", () => {
    const note = readNote().toLowerCase();
    expect(note).not.toMatch(/\bantas\b/);
    expect(note).not.toMatch(/\btrolig\b/);
  });

  it("D1 5.6 pris-delen har dato og sier at prisene må sjekkes på nytt", () => {
    const prices = section(readNote(), "Pris per rapport");
    expect(prices).toMatch(/\b\d{2}\.\d{2}\.\d{4}\b/);
    expect(prices.toLowerCase()).toContain("må sjekkes på nytt");
  });
});
