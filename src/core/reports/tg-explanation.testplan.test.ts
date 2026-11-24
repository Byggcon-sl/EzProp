import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_GUESS_WORDS } from "@/core/ai/evals/run";
import { TG_EXPLANATION } from "./tg-explanation";

/*
 * TG-forklaringen i PDF-en (testplanen for PDF av badet avsnitt 3.3; kortet Omfang 4, A533).
 * Kodedata med tekststatus «utkast, ikke godkjent av fagrådet». Egne ord: ingen gjetteord, ingen
 * henvisning til NS 3600 og ingen 8 ord på rad fra `docs/kartlegging/` (regel 7).
 *
 * Hovedmål: færre reklamasjoner (kunden og megleren får en forklaring av TG som ikke motsier
 * rapporten) og KI i bunnen (teksten er data med fast struktur, ikke fri tekst i malen).
 */

type Explanation = {
  title: string;
  items: { tg: string; label: string; text: string }[];
  hmsText: string;
  textStatus?: string;
  status?: string;
};

const explanation = TG_EXPLANATION as unknown as Explanation;

function textOf(tg: string): string {
  const item = explanation.items.find((i) => i.tg === tg);
  if (!item) throw new Error(`mangler ${tg}`);
  return item.text;
}

/** All tekst som går til PDF-en. */
function pdfTexts(): string[] {
  return [
    explanation.title,
    ...explanation.items.flatMap((i) => [i.label, i.text]),
    explanation.hmsText,
  ];
}

describe("3.3 TG-forklaringen", () => {
  it("1. har TG0, TG1, TG2, TG3 og TGIU i den rekkefølgen, pluss én setning om HMS", () => {
    expect(explanation.items.map((i) => i.tg)).toEqual(["0", "1", "2", "3", "IU"]);
    expect(explanation.items.map((i) => i.label)).toEqual(["TG0", "TG1", "TG2", "TG3", "TGIU"]);
    expect(explanation.hmsText).toMatch(/HMS/);
    expect(explanation.hmsText).toMatch(/TG/);
    // Én setning
    expect(explanation.hmsText.trim().split(/(?<=[.!?])\s+/u)).toHaveLength(1);
    expect(explanation.title.trim().length).toBeGreaterThan(0);
  });

  it("2. TG0 sier «normalt», TG3 nevner kostnadsanslag, TGIU sier hva og hvorfor", () => {
    expect(textOf("0")).toMatch(/normalt/);
    expect(textOf("3")).toMatch(/kostnad/i);
    expect(textOf("IU")).toMatch(/\bhva\b/i);
    expect(textOf("IU")).toMatch(/\bhvorfor\b/i);
    for (const item of explanation.items) expect(item.text.trim().length).toBeGreaterThan(20);
  });

  it("3. tekststatus er utkast i dataene, og merket står ikke i teksten til PDF-en", () => {
    expect(explanation.textStatus ?? explanation.status).toBe("draft");
    for (const text of pdfTexts()) {
      expect(text).not.toMatch(/utkast/i);
      expect(text).not.toMatch(/fagrådet/i);
    }
  });

  it("4. ingen gjetteord, ingen henvisning til NS 3600 og ingen «§»", () => {
    for (const text of pdfTexts()) {
      for (const word of EVAL_GUESS_WORDS) {
        expect(text, `«${word}» i «${text}»`).not.toMatch(
          new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "iu"),
        );
      }
      expect(text).not.toMatch(/\bantas\b|\btrolig\b/iu);
      expect(text).not.toMatch(/NS\s?3600/u);
      expect(text).not.toMatch(/(?<![\p{L}])(NS|TEK)(?![\p{L}])/u);
      expect(text).not.toMatch(/IVIT|SmartTakst|Byggforsk/iu);
      expect(text).not.toContain("§");
    }
  });

  it("4. ingen 8 ord på rad fra docs/kartlegging/ (regel 7)", () => {
    const runLength = 8;
    const words = (text: string) =>
      text
        .normalize("NFC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((w) => w.length > 0);
    const runsOf = (text: string) => {
      const list = words(text);
      const out: string[] = [];
      for (let i = 0; i + runLength <= list.length; i++)
        out.push(list.slice(i, i + runLength).join(" "));
      return out;
    };
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(md|txt|json|csv)$/u.test(name) ? [path] : [];
      });
    const research = new Set<string>();
    for (const file of files(join(process.cwd(), "docs", "kartlegging"))) {
      for (const run of runsOf(readFileSync(file, "utf8"))) research.add(run);
    }
    expect(research.size).toBeGreaterThan(1000);
    const copied = pdfTexts().flatMap((text) => runsOf(text).filter((run) => research.has(run)));
    expect(copied).toEqual([]);
  });

  it("5. etiketten er «TGIU», aldri «IU» alene", () => {
    for (const text of pdfTexts()) {
      expect(text).not.toMatch(/(?<![\p{L}])IU(?![\p{L}])/u);
    }
  });

  it("filen importerer ikke KI og leser ikke database", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "core", "reports", "tg-explanation.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@\/core\/ai|@\/db|ai_usage_log/);
  });
});
