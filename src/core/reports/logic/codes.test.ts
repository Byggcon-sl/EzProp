import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  checkpointResults,
  deviationMeasures,
  deviations,
  TEXT_SOURCES,
  tgiuDetails,
} from "@/db/schema";
import { REPORT_AI_TARGET_FIELDS } from "./codes";

/*
 * Låste lister og rent blad (testplanen B1.15 og B1.19). Ren test uten database.
 *
 * Hovedmål: KI i bunnen (krokene for KI peker på ekte kolonner, og `text_source` har ingen
 * KI-kode, A357) og færre reklamasjoner (samme kode i nettleseren og på serveren).
 */

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

describe("B1.19 KI-målene", () => {
  it("REPORT_AI_TARGET_FIELDS er låst (A356)", () => {
    expect(REPORT_AI_TARGET_FIELDS).toEqual({
      deviation: ["deviation_text", "cause_text", "consequence_text"],
      deviation_measure: ["text"],
      checkpoint_result: ["description_text"],
      tgiu_detail: ["reason", "risk_assessment", "how_to_examine"],
      field_answer: null,
    });
  });

  it.each([
    ["deviation", deviations],
    ["deviation_measure", deviationMeasures],
    ["checkpoint_result", checkpointResults],
    ["tgiu_detail", tgiuDetails],
  ] as const)("hvert feltnavn i %s finnes som kolonne", (target, table) => {
    const columns = columnNames(table);
    for (const field of REPORT_AI_TARGET_FIELDS[target]) expect(columns, field).toContain(field);
  });

  it("deviations har ingen ai_usage_id (A355)", () => {
    expect(columnNames(deviations)).not.toContain("ai_usage_id");
  });

  it("TEXT_SOURCES har ingen KI- eller frasekode (A357)", () => {
    expect(TEXT_SOURCES).toEqual(["template", "edited", "free"]);
    for (const source of TEXT_SOURCES) expect(source).not.toMatch(/ai|ki|phrase|frase/iu);
  });
});

describe("B1.15 rent blad", () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("filene importerer bare egen mappe, @/shared, @/core/rules og `import type`", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(
        /^(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gmu,
      )) {
        const typeOnly = match[2] !== undefined || /^export\s+type\s/u.test(match[0]);
        const target = match[3]!;
        const allowed =
          target.startsWith("./") ||
          target.startsWith("@/shared/") ||
          target === "@/core/rules" ||
          target.startsWith("@/core/rules/") ||
          typeOnly;
        expect(allowed, `${file}: ${match[0]}`).toBe(true);
      }
    }
  });

  it("ingen database, ingen pakker og ingen dagens dato", () => {
    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/from\s+"(zod|drizzle-orm|react|next)/u);
      expect(source, file).not.toMatch(/new Date\(|Date\.now\(/u);
    }
  });
});
