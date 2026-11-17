import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONDITION_REASON_CODES,
  evaluateRules,
  RULE_REASON_CODES,
  runRuleTestCases,
  type RuleResult,
} from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { parseTemplateDocument, type TemplateDocument } from "@/core/templates";
import {
  CAUSE_CRITERIA,
  CONSTRUCTION_VULNERABLE_VALUES,
  COST_TYPES,
  RULE_SUGGESTION_DECISIONS,
} from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import {
  CHECKPOINT_STATUSES,
  CHECKPOINT_TG_VALUES,
  CHECKPOINT_WARNING_CODES,
  INSPECTION_YEAR_SOURCES,
  MERGE_FIELD_KEYS,
  OVERRIDE_REASON_CODES,
  WARNING_FIX_KINDS,
  WARNING_MISSING_PARTS,
} from "./codes";
import { COST_BANDS } from "./cost-bands";
import * as labels from "./labels";
import {
  CAUSE_CRITERION_LABELS,
  CHECKPOINT_STATUS_LABELS,
  CONSTRUCTION_VULNERABLE_LABELS,
  COST_BAND_LABELS,
  COST_TYPE_LABELS,
  DECISION_LABELS,
  formatDecimal,
  formatWholeNumber,
  INSPECTION_YEAR_SOURCE_LABELS,
  LABELS_TEXT_STATUS,
  MERGE_FIELD_LABELS,
  notEvaluatedLines,
  OVERRIDE_REASON_LABELS,
  reasonLines,
  RULE_REASON_TEXTS,
  TG_LABEL_SOURCE,
  TG_LONG_LABELS,
  TG_SHORT_LABELS,
  tgFullLabel,
  WARNING_FIX_LABELS,
  WARNING_MISSING_PART_LABELS,
  WARNING_TEXTS,
  warningText,
  type ReasonLabelLookup,
} from "./labels";

/*
 * Oversettelsen av koder til norsk (testplanen B1.13 og akseptkriteriet om gjetteord og kopi).
 * Ren test. Badmalens regler kjøres med regelmotoren for å samle alle begrunnelseskodene.
 *
 * Hovedmål: færre reklamasjoner (ingen gjetteord og ingen kopiert tekst i det som vises) og de
 * ansatte (begrunnelsen og «ikke vurdert» sier i klarspråk hva som mangler).
 */

const SYSTEM = { kind: "system", reportType: "condition_report" } as const;

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) throw new Error("malen for badet er ugyldig");
  return result.document;
}

const TEMPLATE = parsedTemplate();

const LOOKUP: ReasonLabelLookup = {
  elementLabel: (key) => TEMPLATE.elements.find((e) => e.key === key)?.label ?? null,
  optionLabel: (elementKey, optionKey) =>
    TEMPLATE.element_options.find((o) => o.element_key === elementKey && o.key === optionKey)
      ?.label ?? null,
};

// --- Alle tekstene i oversettelsesfilen -----------------------------------------------------------

/** Alle strenger i filen: konstanter og det funksjonene lager med eksempelverdier. */
function allLabelTexts(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const [name, value] of Object.entries(labels)) {
    if (typeof value !== "function" && name !== "TG_LABEL_SOURCE") walk(value);
  }
  out.push(
    labels.progressText(3, 8),
    labels.reviewCountText(3),
    labels.costNotRoundedText(40000),
    labels.useRoundedAmountText(40000),
    labels.textsWrittenForTgText(3),
    ...MERGE_FIELD_KEYS.flatMap((f) => [
      labels.mergeFieldMissingText(f),
      labels.mergeFieldWarningText(f),
    ]),
    ...CHECKPOINT_TG_VALUES.map((tg) => tgFullLabel(tg)),
  );
  return out;
}

// Samme ordliste og henvisninger som malens tekstsjekk (src/db/seed/templates/wet-room.test.ts).
const GUESS_WORDS = [
  "antas",
  "trolig",
  "sannsynligvis",
  "antagelig",
  "muligens",
  "formentlig",
  "ser ut til",
  "antar",
  "antakelig",
  "sannsynlig",
  "kanskje",
  "tyder på",
  "virker som",
  "tilsynelatende",
];
const REFERENCES = [
  { word: "TEK", caseSensitive: true },
  { word: "NS", caseSensitive: true },
  { word: "Byggforsk", caseSensitive: false },
  { word: "IVIT", caseSensitive: false },
  { word: "SmartTakst", caseSensitive: false },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(word: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, caseSensitive ? "u" : "iu");
}

function guessWordsAndReferencesIn(text: string): string[] {
  return [
    ...GUESS_WORDS.filter((word) => wordPattern(word, false).test(text)),
    ...REFERENCES.filter(({ word, caseSensitive }) =>
      wordPattern(word, caseSensitive).test(text),
    ).map(({ word }) => word),
  ];
}

// Kopisjekken: åtte ord på rad som også står i researchen (samme regel som malens tekstsjekk).
const RUN_LENGTH = 8;
const RESEARCH_DIR = join(process.cwd(), "docs", "kartlegging");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

function runs(text: string): string[] {
  const list = words(text);
  const out: string[] = [];
  for (let i = 0; i + RUN_LENGTH <= list.length; i++)
    out.push(list.slice(i, i + RUN_LENGTH).join(" "));
  return out;
}

let researchRuns: Set<string> | null = null;
function copiedRun(text: string): string | null {
  if (!researchRuns) {
    researchRuns = new Set(
      markdownFiles(RESEARCH_DIR).flatMap((f) => runs(readFileSync(f, "utf8"))),
    );
  }
  const set = researchRuns;
  return runs(text).find((run) => set.has(run)) ?? null;
}

describe("gjetteord og kopi i de nye tekstene", () => {
  const texts = allLabelTexts();

  it("filen har mange tekster (sjekken går ikke tom)", () => {
    expect(texts.length).toBeGreaterThan(80);
  });

  it("ingen gjetteord og ingen henvisning til TEK, NS, Byggforsk, IVIT eller SmartTakst", () => {
    const hits = texts.flatMap((t) => guessWordsAndReferencesIn(t).map((w) => `«${t}»: ${w}`));
    expect(hits).toEqual([]);
  });

  it("ingen åtte ord på rad fra researchen", () => {
    const copied = texts.map((t) => ({ t, run: copiedRun(t) })).filter((h) => h.run !== null);
    expect(copied).toEqual([]);
  });

  it("sjekken kan feile", () => {
    expect(guessWordsAndReferencesIn("Sjiktet er trolig fra før 2000.")).toEqual(["trolig"]);
    expect(guessWordsAndReferencesIn("Se NS 3600.")).toEqual(["NS"]);
  });

  it("tekstene er merket utkast, ikke godkjent av fagrådet", () => {
    expect(LABELS_TEXT_STATUS).toBe("draft");
    expect(COST_BANDS.every((b) => b.status === "draft")).toBe(true);
  });
});

describe("alle koder har norsk tekst", () => {
  it.each<[string, readonly string[], Record<string, string>]>([
    ["TG kort", CHECKPOINT_TG_VALUES, TG_SHORT_LABELS],
    ["TG lang", CHECKPOINT_TG_VALUES, TG_LONG_LABELS],
    ["status", CHECKPOINT_STATUSES, CHECKPOINT_STATUS_LABELS],
    ["advarsler", CHECKPOINT_WARNING_CODES, WARNING_TEXTS],
    ["det som mangler", WARNING_MISSING_PARTS, WARNING_MISSING_PART_LABELS],
    ["Rett nå", WARNING_FIX_KINDS, WARNING_FIX_LABELS],
    ["begrunnelse", OVERRIDE_REASON_CODES, OVERRIDE_REASON_LABELS],
    ["beslutning", RULE_SUGGESTION_DECISIONS, DECISION_LABELS],
    ["kostnadstype", COST_TYPES, COST_TYPE_LABELS],
    ["intervall", COST_BANDS.map((b) => b.key), COST_BAND_LABELS],
    ["årsakskriterium", CAUSE_CRITERIA, CAUSE_CRITERION_LABELS],
    ["skadeutsatt", CONSTRUCTION_VULNERABLE_VALUES, CONSTRUCTION_VULNERABLE_LABELS],
    ["flettefelt", MERGE_FIELD_KEYS, MERGE_FIELD_LABELS],
    ["befaringsår", INSPECTION_YEAR_SOURCES, INSPECTION_YEAR_SOURCE_LABELS],
    ["regelmotoren", [...CONDITION_REASON_CODES, ...RULE_REASON_CODES], RULE_REASON_TEXTS],
  ])("%s", (_name, codes, texts) => {
    expect(Object.keys(texts).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(texts[code]?.trim(), code).toBeTruthy();
  });

  it("TG har lang form med forskriften § 2-23 som kilde, ikke NS 3600", () => {
    expect(tgFullLabel("3")).toBe("TG3 Store eller alvorlige avvik");
    expect(tgFullLabel("IU")).toBe("TGIU Ikke undersøkt");
    expect(TG_LONG_LABELS).toEqual({
      "0": "Ingen avvik",
      "1": "Mindre avvik",
      "2": "Vesentlige avvik",
      "3": "Store eller alvorlige avvik",
      IU: "Ikke undersøkt",
    });
    expect(TG_LABEL_SOURCE).toContain("§ 2-23");
    expect(TG_LABEL_SOURCE).not.toMatch(/NS/u);
  });

  it("advarselen sier hva som mangler", () => {
    const w = (
      code: (typeof CHECKPOINT_WARNING_CODES)[number],
      missing: (typeof WARNING_MISSING_PARTS)[number][],
    ) => warningText({ code, deviationId: "d", ruleKey: null, missing });
    expect(w("tg2_tg3_missing_cause_or_consequence", ["cause_criterion", "cause_text"])).toBe(
      "Avviket mangler årsak.",
    );
    expect(w("tg2_tg3_missing_cause_or_consequence", ["cause_text", "consequence_text"])).toBe(
      "Avviket mangler årsak og konsekvens.",
    );
    expect(w("hms_missing_consequence_or_measure", ["measure"])).toBe(
      "HMS-avviket mangler tiltak.",
    );
    expect(w("tg3_missing_cost", [])).toBe("TG3 skal ha kostnad.");
    expect(w("tgiu_details_missing", ["reason", "risk_assessment", "how_to_examine"])).toBe(
      "Fyll ut dette for TGIU: hva som ikke er undersøkt, og hvorfor, risiko og hva som må til for å undersøke.",
    );
  });

  it("tall vises med mellomrom som tusenskille og komma som desimaltegn", () => {
    expect(formatWholeNumber(1250000)).toBe("1 250 000");
    expect(formatWholeNumber(999)).toBe("999");
    expect(formatDecimal(14.9)).toBe("14,9");
    expect(formatDecimal(20)).toBe("20");
  });
});

// --- B1.13 begrunnelseskodene fra badmalens regler -------------------------------------------------

/** Svar som gir «ikke vurdert», feil og opplysninger i reglene (oppdiktede verdier). */
const EXTRA_ANSWERS: Record<string, unknown>[] = [
  {},
  { "wet_room.membrane_year": 2030 },
  { "wet_room.membrane_year": "tekst" },
  { "wet_room.membrane_year": 1990, "wet_room.membrane_type": "foil" },
  { "wet_room.hole_drilling": "done_no_findings", "wet_room.hole_moisture_reading": "x" },
  { "wet_room.hole_drilling": "done_no_findings", "wet_room.hole_moisture_reading": -1 },
  { "wet_room.hole_drilling": "done_no_findings", "wet_room.hole_moisture_reading": 20 },
];

function collectResults(): RuleResult[] {
  const fromCases = runRuleTestCases({
    template: SYSTEM,
    document: TEMPLATE,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  }).flatMap((c) => (c.result ? [c.result] : []));
  const fromAnswers = EXTRA_ANSWERS.flatMap((answers) =>
    [2026, null].flatMap((inspectionYear) =>
      evaluateRules({
        template: SYSTEM,
        document: TEMPLATE,
        answers: answers as never,
        inspectionYear,
        lifespans: WET_ROOM_LIFESPANS,
        thresholds: WET_ROOM_THRESHOLDS,
      }),
    ),
  );
  return [...fromCases, ...fromAnswers];
}

describe("B1.13 oversettelsen av regelsvarene", () => {
  const results = collectResults();

  it("hver kode som står i reasons fra badmalens regler, har norsk tekst", () => {
    const codes = new Set<string>();
    for (const result of results) {
      if (result.code) codes.add(result.code);
      for (const reason of result.reasons) if (reason.code) codes.add(reason.code);
    }
    expect(codes.size).toBeGreaterThan(2);
    for (const code of codes) {
      expect(RULE_REASON_TEXTS[code as keyof typeof RULE_REASON_TEXTS], code).toBeTruthy();
    }
  });

  it("«ikke vurdert» sier hva som mangler, med feltet", () => {
    const notEvaluated = results.filter((r) => r.state === "not_evaluated");
    expect(notEvaluated.length).toBeGreaterThan(0);
    for (const result of notEvaluated) {
      const lines = notEvaluatedLines(result, LOOKUP);
      expect(lines.length, result.rule_key).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.text).not.toMatch(/[a-z]+_[a-z]+/u);
        expect(guessWordsAndReferencesIn(line.text)).toEqual([]);
      }
    }
  });

  it("tomt felt med navn gir «Fyll ut …» og «Gå til feltet»", () => {
    const [hole] = evaluateRules({
      template: SYSTEM,
      document: TEMPLATE,
      answers: {},
      inspectionYear: 2026,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    }).filter((r) => r.rule_key === "wet_room.hole_drilling_not_done");
    expect(hole?.state).toBe("not_evaluated");
    const lines = notEvaluatedLines(hole!, LOOKUP);
    expect(lines[0]?.text).toMatch(/^Fyll ut /u);
    expect(lines[0]?.elementKey).toBe("wet_room.hole_drilling");
  });

  it("regel som ikke kjøres, gir teksten for regelen", () => {
    const result: RuleResult = {
      rule_key: "r",
      purpose: "show",
      state: "not_evaluated",
      suggestion: null,
      code: "purpose_not_supported",
      reasons: [],
      lifespan_set_key: null,
      threshold_set_key: null,
    };
    expect(notEvaluatedLines(result, LOOKUP)).toEqual([
      { text: RULE_REASON_TEXTS.purpose_not_supported, elementKey: null },
    ]);
  });

  it("«Hvorfor» har tall og navn, aldri råkoder, og lenker til feltet", () => {
    const triggered = results.filter((r) => r.state === "triggered");
    expect(triggered.length).toBeGreaterThan(0);
    for (const result of triggered) {
      const lines = reasonLines(result, LOOKUP);
      expect(lines.length, result.rule_key).toBeGreaterThan(0);
      expect(
        lines.some((l) => l.elementKey !== null),
        result.rule_key,
      ).toBe(true);
      for (const line of lines) {
        expect(line.text, result.rule_key).not.toMatch(/[a-z]+_[a-z]+/u);
        expect(guessWordsAndReferencesIn(line.text)).toEqual([]);
      }
    }
  });

  it("sjikt fra 1990 gir linjen med årstallet og alderen", () => {
    const results1990 = evaluateRules({
      template: SYSTEM,
      document: TEMPLATE,
      answers: { "wet_room.membrane_year": 1990, "wet_room.membrane_type": "foil" },
      inspectionYear: 2026,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    });
    const before2000 = results1990.find((r) => r.rule_key === "wet_room.membrane_before_2000");
    expect(before2000?.state).toBe("triggered");
    const text = reasonLines(before2000!, LOOKUP)
      .map((l) => l.text)
      .join(" ");
    expect(text).toContain("1990");
    expect(text).toContain("36 år");
  });

  it("sjikt fra 1990 uten befaringsår gir linjen med årstallet, uten alder", () => {
    const before2000 = evaluateRules({
      template: SYSTEM,
      document: TEMPLATE,
      answers: { "wet_room.membrane_year": 1990, "wet_room.membrane_type": "foil" },
      inspectionYear: null,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    }).find((r) => r.rule_key === "wet_room.membrane_before_2000");
    expect(before2000?.state).toBe("triggered");
    const lines = reasonLines(before2000!, LOOKUP);
    expect(lines[0]?.text).toContain("1990");
    expect(lines[0]?.text).not.toContain(" år ");
    expect(lines[0]?.elementKey).not.toBeNull();
  });
});
