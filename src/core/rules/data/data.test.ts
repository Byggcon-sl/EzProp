import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_KEY_PATTERN } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { SOURCE_RULE_AGE, WET_ROOM_LIFESPANS } from "./lifespans";
import { SOURCE_RULE_MOISTURE, WET_ROOM_THRESHOLDS } from "./thresholds";

/*
 * Levetidene og terskelen som kodedata (docs/funksjoner/fase2a-regler-bad-testplan.md avsnitt 2
 * og 10.1). Ren test uten database.
 *
 * Testen 2.3 er den eneste som har tallene skrevet inn: den låser utkastet som er avtalt i kortet
 * (Omfang 2 og 3). Alle andre tester leser tallene fra `lifespans.ts` og `thresholds.ts`.
 *
 * Støtter hovedmål:
 * - Færre reklamasjoner: levetidene og grensen er like hver gang, og «uten dokumentasjon» gir
 *   aldri lengre levetid enn «med».
 * - KI i bunnen: hver rad har fast kode og status (`draft` = utkast, ikke godkjent av fagrådet),
 *   så KI og PDF senere kan vise om tallet er godkjent. Ingen KI i regelmotoren.
 */

const MEMBRANE_ELEMENT = "wet_room.membrane_type";
const UNIT_ELEMENT = "wet_room.hole_moisture_unit";
const THRESHOLD_KEY = "wet_room_hole_moisture_weight_percent";

const entries = WET_ROOM_LIFESPANS.entries;

function optionKeys(elementKey: string): string[] {
  return (wetRoomTemplate.element_options ?? [])
    .filter((o) => o.element_key === elementKey)
    .map((o) => o.key);
}

/** Levetiden for et materiale med eller uten dokumentasjon (rader med `any` gjelder begge). */
function minAgeFor(material: string, documentation: "with" | "without"): number | null {
  const rows = entries.filter(
    (e) =>
      e.material_code === material &&
      e.outcome_kind === "tg2" &&
      (e.documentation === documentation || e.documentation === "any"),
  );
  if (rows.length !== 1) {
    throw new Error(
      `${material}/${documentation}: ventet én rad, fant ${rows.length}: ${JSON.stringify(rows)}`,
    );
  }
  return rows[0]!.min_age;
}

describe("2 levetider og terskel", () => {
  it("2.1 keys_unique_and_format: kodene er unike og følger kodeformatet", () => {
    expect(WET_ROOM_LIFESPANS.key).toMatch(TEMPLATE_KEY_PATTERN);
    expect(WET_ROOM_THRESHOLDS.key).toMatch(TEMPLATE_KEY_PATTERN);
    expect(WET_ROOM_LIFESPANS.key).not.toBe(WET_ROOM_THRESHOLDS.key);
    const lifespanKeys = entries.map((e) => e.key);
    const thresholdKeys = WET_ROOM_THRESHOLDS.entries.map((e) => e.key);
    expect(new Set(lifespanKeys).size).toBe(lifespanKeys.length);
    expect(new Set(thresholdKeys).size).toBe(thresholdKeys.length);
    for (const key of [...lifespanKeys, ...thresholdKeys])
      expect(key).toMatch(TEMPLATE_KEY_PATTERN);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("2.2 all_draft_with_source: alle rader er utkast med kilde", () => {
    for (const e of entries) {
      expect(e.status, e.key).toBe("draft");
      expect(e.source_ref.trim().length, e.key).toBeGreaterThan(0);
      expect(e.component.trim().length, e.key).toBeGreaterThan(0);
    }
    for (const t of WET_ROOM_THRESHOLDS.entries) {
      expect(t.status, t.key).toBe("draft");
      expect(t.source_ref.trim().length, t.key).toBeGreaterThan(0);
    }
  });

  it("R2.1 source_ns3600: kilden for fukt og alder er NS 3600:2025, Ståles svar og utkast (F3)", () => {
    for (const source of [SOURCE_RULE_MOISTURE, SOURCE_RULE_AGE]) {
      expect(source).toContain("NS 3600:2025");
      expect(source).toContain("Ståle 12.11.2026");
      expect(source).toContain("utkast, ikke godkjent av fagrådet");
      // Ingen punkt eller blad fra en kilde: bare navnet på standarden
      expect(source).not.toMatch(/Byggforsk|SINTEF|tillegg|pkt\.|\d{3}\.\d{3}/i);
    }
    for (const t of WET_ROOM_THRESHOLDS.entries)
      expect(t.source_ref, t.key).toBe(SOURCE_RULE_MOISTURE);
    for (const e of entries) expect(e.source_ref, e.key).toBe(SOURCE_RULE_AGE);
  });

  it("R2.2 source_short: kildeteksten er kort (ingen tekst fra standarden)", () => {
    for (const source of [SOURCE_RULE_MOISTURE, SOURCE_RULE_AGE]) {
      expect(source.length).toBeLessThanOrEqual(200);
    }
  });

  it("R2.4 no_guess_words: ingen gjetteord eller «levetid» i kilder og meldinger", () => {
    const texts = [
      ...entries.map((e) => e.source_ref),
      ...WET_ROOM_THRESHOLDS.entries.map((t) => t.source_ref),
      ...(wetRoomTemplate.rules ?? []).flatMap((r) => [r.message ?? "", r.source_ref ?? ""]),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/antas|trolig|sannsynligvis|levetid/i);
    }
  });

  it.each([
    { material: "liquid_membrane", with: 22, without: 15 },
    { material: "foil", with: 25, without: 18 },
    { material: "sheet_membrane", with: 30, without: 20 },
    { material: "membrane_boards", with: 22, without: 15 },
    { material: "bathroom_cabin", with: 20, without: 15 },
    { material: "bathroom_panel", with: 20, without: 10 },
    { material: "wet_room_wallpaper_paint", with: 7, without: 7 },
    { material: "wet_room_vinyl", with: 20, without: 20 },
  ])("2.3 agreed_values: $material $with/$without år", ({ material, with: w, without }) => {
    expect(minAgeFor(material, "with")).toBe(w);
    expect(minAgeFor(material, "without")).toBe(without);
  });

  it("2.3 agreed_values: «før 2000» er én rad for alle materialer, og ingen andre rader", () => {
    const general = entries.filter((e) => e.material_code === null);
    expect(general).toHaveLength(1);
    expect(general[0]).toMatchObject({
      to_year: 1999,
      from_year: null,
      documentation: "any",
      outcome_kind: "tg3",
    });
    expect(general[0]!.min_age ?? 0).toBe(0);
    // Materialradene foreslår bare TG2 og har ingen årsgrense
    for (const e of entries.filter((e) => e.material_code !== null)) {
      expect(e.outcome_kind, e.key).toBe("tg2");
      expect(e.from_year, e.key).toBeNull();
      expect(e.to_year, e.key).toBeNull();
    }
    const materials = new Set(entries.flatMap((e) => (e.material_code ? [e.material_code] : [])));
    expect(materials.size).toBe(8);
  });

  it("2.3 agreed_values: terskelen er 15 vekt-%, lik eller over gir forslag", () => {
    expect(WET_ROOM_THRESHOLDS.entries).toHaveLength(1);
    expect(WET_ROOM_THRESHOLDS.entries[0]).toMatchObject({
      key: THRESHOLD_KEY,
      value: 15,
      comparator: "gte",
      unit: "weight_percent",
      status: "draft",
    });
  });

  it("2.4 material_codes_exist: hver material_code er et valg under membrantypen, ikke unknown", () => {
    const options = optionKeys(MEMBRANE_ELEMENT);
    expect(options.length).toBeGreaterThan(0);
    for (const e of entries) {
      if (e.material_code === null) continue;
      expect(options, e.key).toContain(e.material_code);
      expect(e.material_code, e.key).not.toBe("unknown");
    }
    // Og hvert valg utenom «ukjent» har levetider
    for (const option of options.filter((o) => o !== "unknown")) {
      expect(
        entries.some((e) => e.material_code === option),
        `${option} har levetid`,
      ).toBe(true);
    }
  });

  it("2.5 threshold_unit_exists: enheten er et valg under enhetsfeltet", () => {
    const units = optionKeys(UNIT_ELEMENT);
    for (const t of WET_ROOM_THRESHOLDS.entries) expect(units, t.key).toContain(t.unit);
  });

  it("2.6 without_not_longer_than_with: uten dokumentasjon er aldri lengre enn med", () => {
    const materials = new Set(entries.flatMap((e) => (e.material_code ? [e.material_code] : [])));
    for (const material of materials) {
      const withDocs = minAgeFor(material, "with");
      const withoutDocs = minAgeFor(material, "without");
      expect(withDocs, material).not.toBeNull();
      expect(withoutDocs, material).not.toBeNull();
      expect(withoutDocs!, material).toBeLessThanOrEqual(withDocs!);
    }
  });
});

// --- Filene i regelmotoren, lest som tekst ---------------------------------------------------------

const RULES_DIR = join(process.cwd(), "src", "core", "rules");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("2.7 og 10.1 regelmotoren er et rent blad", () => {
  const files = sourceFiles(RULES_DIR);

  it("finner filene i motoren og i data/", () => {
    const names = files.map((f) => relative(RULES_DIR, f));
    expect(names).toEqual(expect.arrayContaining(["index.ts", "data/lifespans.ts"]));
  });

  it("2.7 no_imports_of_data_in_engine: bare data/ og testene leser data/", () => {
    const engineFiles = files.filter((f) => !relative(RULES_DIR, f).startsWith("data/"));
    expect(engineFiles.length).toBeGreaterThan(0);
    for (const file of engineFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(RULES_DIR, file)).not.toMatch(
        /from\s+["'](\.\/data|\.\.\/rules\/data|@\/core\/rules\/data)[^"']*["']|import\(\s*["'][^"']*\/data/,
      );
    }
  });

  it("10.1 no_ai_in_rules: ingen fil importerer KI-modulen eller kaller nettet", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const name = relative(RULES_DIR, file);
      expect(text, name).not.toMatch(/["']@\/core\/ai[/"']|["'](\.\.\/)+ai[/"']/);
      expect(text, name).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\./);
      expect(text, name).not.toMatch(/\bDate\.now\s*\(|new Date\s*\(/);
    }
  });

  it("8.4 offline_trial_untouched: ingen fil importerer prøve E", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8"), relative(RULES_DIR, file)).not.toMatch(/offline-trial/);
    }
  });
});
