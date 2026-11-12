import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDocumentKeys,
  parseTemplateDocument,
  type TemplateDocument,
  type TemplateDocumentInput,
} from "@/core/templates";
import { TEMPLATE_KEY_PATTERN } from "@/db/schema";
import { buildTemplateDocument } from "../../../../tests/template-document";
import { wetRoomTemplate } from "./wet-room";

/*
 * Datatest av malfilen for badet (docs/funksjoner/fase2a-mal-bad-testplan.md avsnitt 1).
 * Uten database. «Regeltestene» her er datatester over malfilen: malen har ingen regler ennå.
 *
 * Kontrollene på malen er rene funksjoner i denne filen. Hver av dem prøves først på et lite
 * dokument som skal feile (1.28), så vi vet at en grønn kontroll på malen betyr noe.
 *
 * Støtter hovedmål:
 * - De ansatte: badet har alltid de åtte punktene, feltene og korte tekstene takstmannen starter fra.
 * - KI i bunnen: de faste kodene er låst (`key_snapshot`), tekstene er delt i felt og merket utkast.
 * - Færre reklamasjoner: hulltaking, fall, terskel og membran er egne felt, dokumentasjon gir bare
 *   TG2, sjikt før 2000 gir bare ett avvik, og ingen tekst har gjetteord eller er kopiert.
 *
 * Testdata er oppdiktet.
 */

// --- Malen etter skjemaet -----------------------------------------------------------------------

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) {
    throw new Error(`malen for badet er ugyldig: ${JSON.stringify(result.issues)}`);
  }
  return result.document;
}

const CHECKPOINT_KEYS = [
  "wet_room.general",
  "wet_room.documentation",
  "wet_room.walls_ceiling",
  "wet_room.floor",
  "wet_room.membrane_drain",
  "wet_room.fixtures",
  "wet_room.ventilation",
  "wet_room.adjacent",
] as const;

const MANDATORY_CHECKPOINTS = ["wet_room.general", "wet_room.membrane_drain", "wet_room.adjacent"];

const TG_KINDS = ["tg2", "tg3", "choose_tg2_tg3"] as const;
/** `choose_tg2_tg3` regnes som TG3 i sjekkene (kortet, Omfang 3). */
const TG3_LIKE = ["tg3", "choose_tg2_tg3"] as const;

/** Flettefeltene som er lov i rapporttekstene. */
const MERGE_FIELDS = ["årstall", "måleverdi"];

// --- Rapporttekstene ----------------------------------------------------------------------------

type ReportText = { where: string; kind: string; field: string; text: string };

/** Rapporttekstene: avvik, årsak, konsekvens og tiltak. Ikke valgnavn, spørsmål eller `source_ref`. */
function reportTexts(doc: TemplateDocument): ReportText[] {
  const out: ReportText[] = [];
  for (const o of doc.outcomes) {
    const where = `${o.question_key}/${o.key}`;
    for (const field of [
      "deviation_text",
      "default_cause_text",
      "default_consequence_text",
    ] as const) {
      const text = o[field];
      if (text) out.push({ where, kind: o.kind, field, text });
    }
  }
  for (const m of doc.standard_measures) {
    const outcome = doc.outcomes.find(
      (o) =>
        o.checkpoint_key === m.checkpoint_key &&
        o.question_key === m.question_key &&
        o.key === m.outcome_key,
    );
    out.push({
      where: `${m.question_key}/${m.outcome_key}`,
      kind: outcome?.kind ?? "?",
      field: "standard_measures.text",
      text: m.text,
    });
  }
  return out;
}

function measuresOf(doc: TemplateDocument, o: TemplateDocument["outcomes"][number]) {
  return doc.standard_measures.filter(
    (m) =>
      m.checkpoint_key === o.checkpoint_key &&
      m.question_key === o.question_key &&
      m.outcome_key === o.key,
  );
}

// --- Ordgrenser (også for æ, ø og å) -----------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Hele ord: ikke en bokstav rett før eller rett etter. Tall etter er lov («TEK17»). */
function wordPattern(word: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, caseSensitive ? "u" : "iu");
}

const GUESS_WORDS = [
  "antas",
  "trolig",
  "sannsynligvis",
  "antagelig",
  "muligens",
  "formentlig",
  "ser ut til",
];
/** Henvisninger. «TEK» og «NS» skiller store og små bokstaver, så «teknisk» og «ns» ikke treffer. */
const REFERENCES: { word: string; caseSensitive: boolean }[] = [
  { word: "TEK", caseSensitive: true },
  { word: "NS", caseSensitive: true },
  { word: "Byggforsk", caseSensitive: false },
  { word: "IVIT", caseSensitive: false },
  { word: "SmartTakst", caseSensitive: false },
];

/** Gjetteord og henvisninger som står i teksten. */
function guessWordsAndReferencesIn(text: string): string[] {
  return [
    ...GUESS_WORDS.filter((word) => wordPattern(word, false).test(text)),
    ...REFERENCES.filter(({ word, caseSensitive }) =>
      wordPattern(word, caseSensitive).test(text),
    ).map(({ word }) => word),
  ];
}

/** Antall setninger: deler på punktum, utrop og spørsmål fulgt av mellomrom eller slutt. */
function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?=\s|$)/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

const MAX_SENTENCES = 2;
const MAX_CHARS = 300;

// --- Kontrollene (rene funksjoner: tom liste = bestått) ------------------------------------------

type Check = (doc: TemplateDocument) => string[];

/** Ingen TG-utfall på et kontrollpunkt med `gives_tg = false` (del av T-0014). */
const checkNoTgOnNonTgCheckpoint: Check = (doc) => {
  const noTg = new Set(doc.checkpoints.filter((c) => !c.gives_tg).map((c) => c.key));
  return doc.outcomes
    .filter((o) => (TG_KINDS as readonly string[]).includes(o.kind) && noTg.has(o.checkpoint_key))
    .map((o) => `${o.question_key}/${o.key}: ${o.kind} på punkt uten TG`);
};

/** TG2, TG3 og valg: avvik, årsak, kriterium, konsekvens og tiltak. HMS: avvik, konsekvens og tiltak. */
const checkOutcomeTexts: Check = (doc) => {
  const errors: string[] = [];
  for (const o of doc.outcomes) {
    const where = `${o.question_key}/${o.key}`;
    const measures = measuresOf(doc, o);
    if (!o.deviation_text) errors.push(`${where}: mangler avvik`);
    if (!o.default_consequence_text) errors.push(`${where}: mangler konsekvens`);
    if (measures.length === 0) errors.push(`${where}: mangler tiltak`);
    if ((TG_KINDS as readonly string[]).includes(o.kind)) {
      if (!o.default_cause_text) errors.push(`${where}: mangler årsak`);
      if (!o.default_cause_criterion) errors.push(`${where}: mangler kriterium for årsak`);
    }
  }
  return errors;
};

/** Ingen gjetteord og ingen henvisning til TEK, NS, Byggforsk, IVIT eller SmartTakst. */
const checkGuessWordsAndReferences: Check = (doc) =>
  reportTexts(doc).flatMap(({ where, field, text }) =>
    guessWordsAndReferencesIn(text).map((word) => `${where} ${field}: «${word}»`),
  );

/** Høyst to setninger og 300 tegn per rapporttekstfelt. */
const checkTextLength: Check = (doc) =>
  reportTexts(doc).flatMap(({ where, field, text }) => {
    const errors: string[] = [];
    if (text.length > MAX_CHARS) errors.push(`${where} ${field}: ${text.length} tegn`);
    if (sentenceCount(text) > MAX_SENTENCES) {
      errors.push(`${where} ${field}: ${sentenceCount(text)} setninger`);
    }
    return errors;
  });

const BOR = wordPattern("bør", false);
const MA = wordPattern("må", false);

/** «Bør» (og ikke «må») i tiltak ved TG2; «må» i tiltak ved TG3 og valg mellom TG2 og TG3. */
const checkMeasureModal: Check = (doc) => {
  const errors: string[] = [];
  for (const o of doc.outcomes) {
    for (const m of measuresOf(doc, o)) {
      const where = `${o.question_key}/${o.key}: «${m.text}»`;
      if (o.kind === "tg2") {
        if (!BOR.test(m.text)) errors.push(`${where} mangler «bør»`);
        if (MA.test(m.text)) errors.push(`${where} har «må» ved TG2`);
      }
      if ((TG3_LIKE as readonly string[]).includes(o.kind) && !MA.test(m.text)) {
        errors.push(`${where} mangler «må»`);
      }
    }
  }
  return errors;
};

// --- Lite dokument til kontrollene ---------------------------------------------------------------

/** Et lite dokument som består alle kontrollene (TG2, TG3 og HMS med hele tekster). */
function goodSmallDocument(): ReturnType<typeof buildTemplateDocument> {
  const base = {
    deviation_text: "Det er oppdiktet avvik på punktet.",
    default_cause_text: "Årsaken er oppdiktet.",
    default_cause_criterion: "significant_deviation" as const,
    default_consequence_text: "Konsekvensen er oppdiktet.",
    source_ref: "Oppdiktet kilde",
  };
  return buildTemplateDocument({
    outcomes: [
      { checkpoint_key: "cp.one", question_key: "dq.first", key: "out.a", kind: "tg2", ...base },
      { checkpoint_key: "cp.one", question_key: "dq.first", key: "out.b", kind: "tg3", ...base },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.second",
        key: "out.c",
        kind: "hms",
        deviation_text: base.deviation_text,
        default_consequence_text: base.default_consequence_text,
        source_ref: base.source_ref,
      },
    ],
    standard_measures: [
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.a",
        text: "Forholdet bør utbedres.",
      },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.first",
        outcome_key: "out.b",
        text: "Forholdet må utbedres.",
      },
      {
        checkpoint_key: "cp.one",
        question_key: "dq.second",
        outcome_key: "out.c",
        text: "Forholdet må kontrolleres av fagperson.",
      },
    ],
  });
}

function parsedSmall(change: (doc: ReturnType<typeof goodSmallDocument>) => void = () => {}) {
  const doc = goodSmallDocument();
  change(doc);
  const result = parseTemplateDocument(doc);
  if (!result.success)
    throw new Error(`testdokumentet er ugyldig: ${JSON.stringify(result.issues)}`);
  return result.document;
}

type Outcomes = NonNullable<TemplateDocumentInput["outcomes"]>;
type Measures = NonNullable<TemplateDocumentInput["standard_measures"]>;
const outcomeByKey = (doc: { outcomes: Outcomes }, key: string) =>
  doc.outcomes.find((o) => o.key === key)!;
const measureFor = (doc: { standard_measures: Measures }, outcomeKey: string) =>
  doc.standard_measures.find((m) => m.outcome_key === outcomeKey)!;

const badDocuments: {
  name: string;
  check: Check;
  checkName: string;
  change: (doc: ReturnType<typeof goodSmallDocument>) => void;
}[] = [
  {
    name: "TG-utfall på punkt med gives_tg = false",
    check: checkNoTgOnNonTgCheckpoint,
    checkName: "checkNoTgOnNonTgCheckpoint",
    change: (doc) => {
      doc.checkpoints[0]!.gives_tg = false;
    },
  },
  {
    name: "TG3 uten årsak",
    check: checkOutcomeTexts,
    checkName: "checkOutcomeTexts",
    change: (doc) => {
      outcomeByKey(doc, "out.b").default_cause_text = null;
    },
  },
  {
    name: "HMS uten konsekvens",
    check: checkOutcomeTexts,
    checkName: "checkOutcomeTexts",
    change: (doc) => {
      outcomeByKey(doc, "out.c").default_consequence_text = null;
    },
  },
  {
    name: "«trolig» i avvik",
    check: checkGuessWordsAndReferences,
    checkName: "checkGuessWordsAndReferences",
    change: (doc) => {
      outcomeByKey(doc, "out.a").deviation_text = "Det er trolig et oppdiktet avvik.";
    },
  },
  {
    name: "tre setninger",
    check: checkTextLength,
    checkName: "checkTextLength",
    change: (doc) => {
      outcomeByKey(doc, "out.a").default_consequence_text =
        "Første. Andre setning. Tredje setning.";
    },
  },
  {
    name: "«må» i TG2-tiltak",
    check: checkMeasureModal,
    checkName: "checkMeasureModal",
    change: (doc) => {
      measureFor(doc, "out.a").text = "Forholdet må utbedres.";
    },
  },
];

// --- Kopi fra researchen -----------------------------------------------------------------------

const RUN_LENGTH = 8;
const RESEARCH_DIR = join(process.cwd(), "docs", "kartlegging");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

/** Små bokstaver, tegnsetting fjernet, delt i ord. */
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
  for (let i = 0; i + RUN_LENGTH <= list.length; i++) {
    out.push(list.slice(i, i + RUN_LENGTH).join(" "));
  }
  return out;
}

let researchRuns: Set<string> | null = null;
function researchRunSet(): Set<string> {
  if (researchRuns) return researchRuns;
  const set = new Set<string>();
  for (const file of markdownFiles(RESEARCH_DIR)) {
    for (const run of runs(readFileSync(file, "utf8"))) set.add(run);
  }
  researchRuns = set;
  return set;
}

/** De første 8 ordene på rad i teksten som også står i researchen, eller `null`. */
function copiedRun(text: string): string | null {
  const set = researchRunSet();
  return runs(text).find((run) => set.has(run)) ?? null;
}

// --- Fast liste over alle koder (regel 6) -------------------------------------------------------

/**
 * Alle faste koder i malen. Listen er skrevet for hånd og skal ikke genereres. Endres den, skal
 * PR-en si hvilken kode som er arkivert og hvilken som er ny (regel 6). Seksjon, punkt, felt og valg
 * er fra kortet (Omfang 2); spørsmål og utfall er fra fagrollens liste i malfilen.
 */
const KEY_SNAPSHOT = [
  "section wet_room",
  "checkpoint wet_room.general",
  "checkpoint wet_room.documentation",
  "checkpoint wet_room.walls_ceiling",
  "checkpoint wet_room.floor",
  "checkpoint wet_room.membrane_drain",
  "checkpoint wet_room.fixtures",
  "checkpoint wet_room.ventilation",
  "checkpoint wet_room.adjacent",
  "element wet_room.build_year",
  "element wet_room.build_year_source",
  "element wet_room.building_code",
  "element wet_room.documentation_type",
  "element wet_room.ceiling_type",
  "element wet_room.floor_type",
  "element wet_room.floor_heating",
  "element wet_room.fall_direction_1",
  "element wet_room.fall_direction_2",
  "element wet_room.threshold_height_mm",
  "element wet_room.membrane_type",
  "element wet_room.membrane_year",
  "element wet_room.drain_type",
  "element wet_room.ventilation_type",
  "element wet_room.hole_drilling",
  "element wet_room.hole_moisture_reading",
  "element wet_room.hole_moisture_unit",
  "element wet_room.hole_moisture_location",
  "element wet_room.hole_air_temperature",
  "element wet_room.hole_construction",
  "element wet_room.hole_drilling_reason",
  "element wet_room.hole_drilling_reason_note",
  "element wet_room.owner_informed",
  "element wet_room.other_moisture_method",
  "element wet_room.other_moisture_result",
  "element wet_room.not_investigated_risk",
  "element wet_room.construction_damage_prone",
  "option wet_room.build_year_source documented",
  "option wet_room.build_year_source owner_stated",
  "option wet_room.build_year_source estimated",
  "option wet_room.build_year_source unknown",
  "option wet_room.building_code before_1997",
  "option wet_room.building_code from_1997_to_2010",
  "option wet_room.building_code tek10",
  "option wet_room.building_code tek17",
  "option wet_room.building_code unknown",
  "option wet_room.documentation_type none",
  "option wet_room.documentation_type declaration_of_conformity",
  "option wet_room.documentation_type wet_room_certificate",
  "option wet_room.documentation_type other_written",
  "option wet_room.ceiling_type painted",
  "option wet_room.ceiling_type boards",
  "option wet_room.ceiling_type panel",
  "option wet_room.ceiling_type other",
  "option wet_room.floor_type tiles",
  "option wet_room.floor_type vinyl",
  "option wet_room.floor_type untreated_concrete",
  "option wet_room.floor_type painted_concrete",
  "option wet_room.floor_type wood",
  "option wet_room.floor_type other",
  "option wet_room.floor_heating heating_cables",
  "option wet_room.floor_heating waterborne",
  "option wet_room.floor_heating panel_heater",
  "option wet_room.floor_heating radiator",
  "option wet_room.floor_heating none",
  "option wet_room.floor_heating other",
  "option wet_room.membrane_type liquid_membrane",
  "option wet_room.membrane_type foil",
  "option wet_room.membrane_type sheet_membrane",
  "option wet_room.membrane_type membrane_boards",
  "option wet_room.membrane_type bathroom_cabin",
  "option wet_room.membrane_type bathroom_panel",
  "option wet_room.membrane_type wet_room_wallpaper_paint",
  "option wet_room.membrane_type wet_room_vinyl",
  "option wet_room.membrane_type unknown",
  "option wet_room.drain_type clamping_ring",
  "option wet_room.drain_type without_clamping_ring",
  "option wet_room.drain_type unknown",
  "option wet_room.ventilation_type balanced",
  "option wet_room.ventilation_type mechanical_extract",
  "option wet_room.ventilation_type natural",
  "option wet_room.ventilation_type none",
  "option wet_room.hole_drilling done_no_findings",
  "option wet_room.hole_drilling done_with_findings",
  "option wet_room.hole_drilling not_done",
  "option wet_room.hole_moisture_unit weight_percent",
  "option wet_room.hole_moisture_unit relative_humidity",
  "option wet_room.hole_drilling_reason owner_refused",
  "option wet_room.hole_drilling_reason no_access",
  "option wet_room.hole_drilling_reason concrete_or_masonry",
  "option wet_room.hole_drilling_reason other",
  "option wet_room.construction_damage_prone yes",
  "option wet_room.construction_damage_prone no",
  "question wet_room.general.full_upgrade_needed",
  "question wet_room.general.not_built_as_wet_room",
  "question wet_room.documentation.missing_membrane_documentation",
  "question wet_room.documentation.incomplete_documentation",
  "question wet_room.walls_ceiling.moisture_marks",
  "question wet_room.walls_ceiling.cracked_tiles_or_joints",
  "question wet_room.walls_ceiling.mould_or_rot",
  "question wet_room.floor.insufficient_fall",
  "question wet_room.floor.cracked_tiles_or_joints",
  "question wet_room.floor.vinyl_damage",
  "question wet_room.floor.moisture_damage",
  "question wet_room.membrane_drain.membrane_before_2000",
  "question wet_room.membrane_drain.leak_at_penetration",
  "question wet_room.membrane_drain.membrane_drain_connection",
  "question wet_room.membrane_drain.drain_without_clamping_ring",
  "question wet_room.membrane_drain.drain_not_accessible",
  "question wet_room.membrane_drain.low_threshold_height",
  "question wet_room.fixtures.leak_or_failure",
  "question wet_room.fixtures.cracked_sanitary_ware",
  "question wet_room.fixtures.damaged_furniture",
  "question wet_room.fixtures.signs_of_overheating",
  "question wet_room.ventilation.missing_ventilation",
  "question wet_room.ventilation.weak_extract",
  "question wet_room.ventilation.poor_air_supply",
  "question wet_room.adjacent.elevated_moisture",
  "outcome wet_room.general.full_upgrade_needed tg3",
  "outcome wet_room.general.not_built_as_wet_room tg3",
  "outcome wet_room.documentation.missing_membrane_documentation tg2",
  "outcome wet_room.documentation.incomplete_documentation tg2",
  "outcome wet_room.walls_ceiling.moisture_marks tg2",
  "outcome wet_room.walls_ceiling.cracked_tiles_or_joints tg2",
  "outcome wet_room.walls_ceiling.mould_or_rot tg3",
  "outcome wet_room.floor.insufficient_fall choose",
  "outcome wet_room.floor.cracked_tiles_or_joints tg2",
  "outcome wet_room.floor.vinyl_damage tg2",
  "outcome wet_room.floor.moisture_damage tg3",
  "outcome wet_room.membrane_drain.membrane_before_2000 tg3",
  "outcome wet_room.membrane_drain.leak_at_penetration tg3",
  "outcome wet_room.membrane_drain.membrane_drain_connection tg3",
  "outcome wet_room.membrane_drain.drain_without_clamping_ring tg2",
  "outcome wet_room.membrane_drain.drain_not_accessible choose",
  "outcome wet_room.membrane_drain.low_threshold_height choose",
  "outcome wet_room.fixtures.leak_or_failure tg3",
  "outcome wet_room.fixtures.cracked_sanitary_ware tg2",
  "outcome wet_room.fixtures.damaged_furniture tg2",
  "outcome wet_room.fixtures.signs_of_overheating hms",
  "outcome wet_room.ventilation.missing_ventilation tg3",
  "outcome wet_room.ventilation.weak_extract tg2",
  "outcome wet_room.ventilation.poor_air_supply tg2",
  "outcome wet_room.adjacent.elevated_moisture choose",
];

/** Feltene i kortet (Omfang 2): punkt, type og enhet. */
const FIELDS: { key: string; checkpoint: string; type: string; unit: string | null }[] = [
  { key: "wet_room.build_year", checkpoint: "wet_room.general", type: "number", unit: null },
  { key: "wet_room.build_year_source", checkpoint: "wet_room.general", type: "choice", unit: null },
  { key: "wet_room.building_code", checkpoint: "wet_room.general", type: "choice", unit: null },
  {
    key: "wet_room.documentation_type",
    checkpoint: "wet_room.documentation",
    type: "choice",
    unit: null,
  },
  {
    key: "wet_room.ceiling_type",
    checkpoint: "wet_room.walls_ceiling",
    type: "choice",
    unit: null,
  },
  { key: "wet_room.floor_type", checkpoint: "wet_room.floor", type: "choice", unit: null },
  { key: "wet_room.floor_heating", checkpoint: "wet_room.floor", type: "choice", unit: null },
  { key: "wet_room.fall_direction_1", checkpoint: "wet_room.floor", type: "number", unit: "mm/m" },
  { key: "wet_room.fall_direction_2", checkpoint: "wet_room.floor", type: "number", unit: "mm/m" },
  { key: "wet_room.threshold_height_mm", checkpoint: "wet_room.floor", type: "number", unit: "mm" },
  {
    key: "wet_room.membrane_type",
    checkpoint: "wet_room.membrane_drain",
    type: "choice",
    unit: null,
  },
  {
    key: "wet_room.membrane_year",
    checkpoint: "wet_room.membrane_drain",
    type: "number",
    unit: null,
  },
  { key: "wet_room.drain_type", checkpoint: "wet_room.membrane_drain", type: "choice", unit: null },
  {
    key: "wet_room.ventilation_type",
    checkpoint: "wet_room.ventilation",
    type: "choice",
    unit: null,
  },
  { key: "wet_room.hole_drilling", checkpoint: "wet_room.adjacent", type: "choice", unit: null },
  {
    key: "wet_room.hole_moisture_reading",
    checkpoint: "wet_room.adjacent",
    type: "number",
    unit: null,
  },
  {
    key: "wet_room.hole_moisture_unit",
    checkpoint: "wet_room.adjacent",
    type: "choice",
    unit: null,
  },
  {
    key: "wet_room.hole_moisture_location",
    checkpoint: "wet_room.adjacent",
    type: "text",
    unit: null,
  },
  {
    key: "wet_room.hole_air_temperature",
    checkpoint: "wet_room.adjacent",
    type: "number",
    unit: "°C",
  },
  { key: "wet_room.hole_construction", checkpoint: "wet_room.adjacent", type: "text", unit: null },
  {
    key: "wet_room.hole_drilling_reason",
    checkpoint: "wet_room.adjacent",
    type: "choice",
    unit: null,
  },
  {
    key: "wet_room.hole_drilling_reason_note",
    checkpoint: "wet_room.adjacent",
    type: "text",
    unit: null,
  },
  { key: "wet_room.owner_informed", checkpoint: "wet_room.adjacent", type: "checkbox", unit: null },
  {
    key: "wet_room.other_moisture_method",
    checkpoint: "wet_room.adjacent",
    type: "text",
    unit: null,
  },
  {
    key: "wet_room.other_moisture_result",
    checkpoint: "wet_room.adjacent",
    type: "text",
    unit: null,
  },
  {
    key: "wet_room.not_investigated_risk",
    checkpoint: "wet_room.adjacent",
    type: "text",
    unit: null,
  },
  {
    key: "wet_room.construction_damage_prone",
    checkpoint: "wet_room.adjacent",
    type: "choice",
    unit: null,
  },
];

/** Valgene som står i kortet. */
const CHOICES: Record<string, string[]> = {
  "wet_room.build_year_source": ["documented", "owner_stated", "estimated", "unknown"],
  "wet_room.building_code": ["before_1997", "from_1997_to_2010", "tek10", "tek17", "unknown"],
  "wet_room.documentation_type": [
    "none",
    "declaration_of_conformity",
    "wet_room_certificate",
    "other_written",
  ],
  "wet_room.ventilation_type": ["balanced", "mechanical_extract", "natural", "none"],
  "wet_room.hole_drilling": ["done_no_findings", "done_with_findings", "not_done"],
  "wet_room.hole_moisture_unit": ["weight_percent", "relative_humidity"],
  "wet_room.hole_drilling_reason": ["owner_refused", "no_access", "concrete_or_masonry", "other"],
  "wet_room.construction_damage_prone": ["yes", "no"],
};

const MEMBRANE_CHOICES = [
  "liquid_membrane",
  "foil",
  "sheet_membrane",
  "membrane_boards",
  "bathroom_cabin",
  "bathroom_panel",
  "wet_room_wallpaper_paint",
  "wet_room_vinyl",
  "unknown",
];

/** Kodeformatet for valg og materialkoder: små bokstaver, tall og `_` (uten punktum). */
const LOCAL_CODE = /^[a-z0-9_]+$/;

const sorted = (list: readonly string[]) => [...list].sort();

// =================================================================================================

describe("1 malfilen for badet (datatest)", () => {
  it("1.1 parses_without_issues", () => {
    const result = parseTemplateDocument(wetRoomTemplate);
    expect(result.success ? [] : result.issues).toEqual([]);
    expect(checkDocumentKeys(parsedTemplate())).toEqual([]);
  });

  it("1.2 section_wet_room_per_room", () => {
    const doc = parsedTemplate();
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toMatchObject({
      key: "wet_room",
      parent_key: null,
      repeat: "per_room",
      room_type_groups: ["wet_room"],
    });
  });

  it("1.3 has_eight_room_checkpoints", () => {
    const doc = parsedTemplate();
    expect(sorted(doc.checkpoints.map((c) => c.key))).toEqual(sorted(CHECKPOINT_KEYS));
    for (const c of doc.checkpoints) {
      expect(c, c.key).toMatchObject({
        section_key: "wet_room",
        scope: "room",
        group: "room",
        room_type_groups: ["wet_room"],
        gives_tg: true,
      });
    }
    expect(sorted(doc.checkpoints.filter((c) => c.mandatory).map((c) => c.key))).toEqual(
      sorted(MANDATORY_CHECKPOINTS),
    );
  });

  it("1.4 related_checkpoints", () => {
    const doc = parsedTemplate();
    const keys = new Set(doc.checkpoints.map((c) => c.key));
    const membrane = doc.checkpoints.find((c) => c.key === "wet_room.membrane_drain")!;
    expect(membrane.related_checkpoint_keys).toEqual(
      expect.arrayContaining(["wet_room.floor", "wet_room.adjacent"]),
    );
    for (const c of doc.checkpoints) {
      for (const related of c.related_checkpoint_keys) {
        expect(keys.has(related), `${c.key} peker på ${related}`).toBe(true);
        expect(related, `${c.key} peker på seg selv`).not.toBe(c.key);
      }
    }
  });

  it("1.5 keys_prefixed_wet_room", () => {
    const doc = parsedTemplate();
    const keys = [
      ...doc.checkpoints.map((c) => c.key),
      ...doc.elements.map((e) => e.key),
      ...doc.deviation_questions.map((q) => q.key),
    ];
    for (const key of keys) expect(key.startsWith("wet_room."), key).toBe(true);
    // Spørsmålene heter `wet_room.<punkt>.<spørsmål>` (kortet, Data)
    for (const q of doc.deviation_questions) {
      expect(q.key.startsWith(`${q.checkpoint_key}.`), q.key).toBe(true);
    }
    // Feltene hører alle til et kontrollpunkt i malen
    for (const e of doc.elements) {
      expect(CHECKPOINT_KEYS as readonly (string | null)[], e.key).toContain(e.checkpoint_key);
      expect(e.section_key, e.key).toBe("wet_room");
    }
  });

  it("1.6 key_snapshot: de faste kodene er uendret (regel 6)", () => {
    const doc = parsedTemplate();
    const actual = [
      ...doc.sections.map((s) => `section ${s.key}`),
      ...doc.checkpoints.map((c) => `checkpoint ${c.key}`),
      ...doc.elements.map((e) => `element ${e.key}`),
      ...doc.element_options.map((o) => `option ${o.element_key} ${o.key}`),
      ...doc.deviation_questions.map((q) => `question ${q.key}`),
      ...doc.outcomes.map((o) => `outcome ${o.question_key} ${o.key}`),
    ];
    expect(sorted(actual)).toEqual(sorted(KEY_SNAPSHOT));
    expect(new Set(KEY_SNAPSHOT).size, "ingen dobbel kode i listen").toBe(KEY_SNAPSHOT.length);
  });

  it.each(FIELDS)("1.7 fields_types_units: $key", ({ key, checkpoint, type, unit }) => {
    const element = parsedTemplate().elements.find((e) => e.key === key);
    expect(element, `feltet ${key} finnes`).toBeDefined();
    expect(element).toMatchObject({
      checkpoint_key: checkpoint,
      field_type: type,
      unit,
      required: false,
    });
  });

  it("1.7 fields_types_units: ingen felt utenom kortet, alle valgfrie, fall uten min_value", () => {
    const doc = parsedTemplate();
    expect(sorted(doc.elements.map((e) => e.key))).toEqual(sorted(FIELDS.map((f) => f.key)));
    for (const e of doc.elements) expect(e.required, e.key).toBe(false);
    for (const key of ["wet_room.fall_direction_1", "wet_room.fall_direction_2"]) {
      const element = doc.elements.find((e) => e.key === key)!;
      // Negativ verdi = motfall (A208)
      expect(element.min_value, key).toBeNull();
    }
  });

  it.each(Object.entries(CHOICES).map(([element, keys]) => ({ element, keys })))(
    "1.8 choice_codes: $element",
    ({ element, keys }) => {
      const doc = parsedTemplate();
      const options = doc.element_options.filter((o) => o.element_key === element);
      expect(sorted(options.map((o) => o.key))).toEqual(sorted(keys));
    },
  );

  it("1.8 choice_codes: alle valgkoder følger kodeformatet, og alle valgfelt har valg", () => {
    const doc = parsedTemplate();
    for (const o of doc.element_options) {
      expect(o.key, `${o.element_key}/${o.key}`).toMatch(LOCAL_CODE);
      expect(o.key).toMatch(TEMPLATE_KEY_PATTERN);
    }
    for (const e of doc.elements.filter((e) => e.field_type === "choice")) {
      expect(
        doc.element_options.filter((o) => o.element_key === e.key).length,
        `${e.key} har valg`,
      ).toBeGreaterThan(0);
    }
  });

  it("1.9 membrane_material_codes", () => {
    const doc = parsedTemplate();
    const options = doc.element_options.filter((o) => o.element_key === "wet_room.membrane_type");
    expect(sorted(options.map((o) => o.key))).toEqual(sorted(MEMBRANE_CHOICES));
    for (const o of options) {
      expect(o.material_code, o.key).toBe(o.key);
      expect(o.material_code, o.key).toMatch(LOCAL_CODE);
    }
    expect(doc.elements.filter((e) => e.key.includes("membrane_visible"))).toEqual([]);
  });

  it("1.10 no_consent_field", () => {
    expect(parsedTemplate().elements.filter((e) => e.key.includes("consent"))).toEqual([]);
  });

  it("1.11 questions_per_checkpoint", () => {
    const doc = parsedTemplate();
    for (const key of CHECKPOINT_KEYS) {
      const count = doc.deviation_questions.filter((q) => q.checkpoint_key === key).length;
      if (key === "wet_room.adjacent") expect(count, key).toBe(1);
      else expect(count, key).toBeGreaterThanOrEqual(2);
    }
    expect(doc.deviation_questions.length).toBeGreaterThanOrEqual(20);
    expect(doc.deviation_questions.length).toBeLessThanOrEqual(30);
    for (const q of doc.deviation_questions) {
      const outcomes = doc.outcomes.filter(
        (o) => o.checkpoint_key === q.checkpoint_key && o.question_key === q.key,
      );
      expect(outcomes.length, `${q.key}: ett utfall`).toBe(1);
    }
  });

  it("1.12 documentation_only_tg2", () => {
    const outcomes = parsedTemplate().outcomes.filter(
      (o) => o.checkpoint_key === "wet_room.documentation",
    );
    expect(outcomes.length).toBeGreaterThan(0);
    for (const o of outcomes) expect(o.kind, o.question_key).toBe("tg2");
  });

  it("1.13 pre_2000_once_under_membrane", () => {
    const doc = parsedTemplate();
    const year2000 = /(?<![\p{N}])2000(?![\p{N}])/u;
    const mentions = doc.deviation_questions.filter((q) => {
      const outcome = doc.outcomes.filter(
        (o) => o.checkpoint_key === q.checkpoint_key && o.question_key === q.key,
      );
      const texts = [
        q.text,
        ...outcome.flatMap((o) => [
          o.deviation_text,
          o.default_cause_text,
          o.default_consequence_text,
          ...measuresOf(doc, o).map((m) => m.text),
        ]),
      ];
      return texts.some((t) => t !== null && year2000.test(t));
    });
    expect(mentions.map((q) => q.key)).toHaveLength(1);
    const question = mentions[0]!;
    expect(question.checkpoint_key).toBe("wet_room.membrane_drain");
    // Formulert om det vanntette sjiktet, ikke om rommet
    expect(question.text).toMatch(/sjikt|membran/i);
  });

  it("1.14 adjacent_moisture_choose", () => {
    const doc = parsedTemplate();
    const questions = doc.deviation_questions.filter(
      (q) => q.checkpoint_key === "wet_room.adjacent",
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]!.text).toMatch(/fukt/i);
    const outcomes = doc.outcomes.filter((o) => o.question_key === questions[0]!.key);
    expect(outcomes.map((o) => o.kind)).toEqual(["choose_tg2_tg3"]);
  });

  it("1.15 electrical_is_hms", () => {
    const doc = parsedTemplate();
    const heat = /varmgang/i;
    const hms = doc.outcomes.filter((o) => o.kind === "hms");
    const heatOutcome = hms.find((o) => {
      const question = doc.deviation_questions.find((q) => q.key === o.question_key);
      return heat.test(o.deviation_text ?? "") || heat.test(question?.text ?? "");
    });
    expect(heatOutcome, "varmgang er HMS").toBeDefined();
    expect(heatOutcome!.checkpoint_key).toBe("wet_room.fixtures");

    const electrical = [wordPattern("el", false), /elektr/i, heat];
    for (const o of doc.outcomes.filter((o) => (TG_KINDS as readonly string[]).includes(o.kind))) {
      const question = doc.deviation_questions.find((q) => q.key === o.question_key)!;
      const texts = [
        question.text,
        o.deviation_text,
        o.default_cause_text,
        o.default_consequence_text,
        ...measuresOf(doc, o).map((m) => m.text),
      ].filter((t): t is string => t !== null);
      for (const text of texts) {
        for (const pattern of electrical) {
          expect(pattern.test(text), `${o.question_key} (${o.kind}): «${text}»`).toBe(false);
        }
      }
    }
  });

  it("1.16 no_tgiu_outcome", () => {
    expect((wetRoomTemplate.outcomes ?? []).filter((o) => (o.kind as string) === "tgiu")).toEqual(
      [],
    );
    expect(parsedTemplate().outcomes.filter((o) => (o.kind as string) === "tgiu")).toEqual([]);
  });

  it.each(
    parsedTemplate().outcomes.map((o) => ({ name: `${o.question_key}/${o.key} (${o.kind})`, o })),
  )("1.17 outcome_texts_complete: $name", ({ o }) => {
    const doc = parsedTemplate();
    expect(o.deviation_text, "avvik").toBeTruthy();
    expect(o.default_consequence_text, "konsekvens").toBeTruthy();
    expect(measuresOf(doc, o).length, "minst ett tiltak").toBeGreaterThanOrEqual(1);
    if ((TG_KINDS as readonly string[]).includes(o.kind)) {
      expect(o.default_cause_text, "årsak").toBeTruthy();
      expect(o.default_cause_criterion, "kriterium").toBeTruthy();
    }
  });

  it("1.17 outcome_texts_complete: checkOutcomeTexts gir ingen feil på malen", () => {
    expect(checkOutcomeTexts(parsedTemplate())).toEqual([]);
  });

  it("1.18 all_texts_draft: også i malfilen før skjemaet fyller inn standardverdien", () => {
    for (const o of wetRoomTemplate.outcomes ?? []) {
      expect(o.text_status, `${o.question_key}/${o.key}`).toBe("draft");
    }
    for (const m of wetRoomTemplate.standard_measures ?? []) {
      expect(m.text_status, `${m.question_key}/${m.outcome_key}: ${m.text}`).toBe("draft");
    }
    const doc = parsedTemplate();
    expect(doc.outcomes.every((o) => o.text_status === "draft")).toBe(true);
    expect(doc.standard_measures.every((m) => m.text_status === "draft")).toBe(true);
  });

  it("1.19 tg2_bor_tg3_ma", () => {
    expect(checkMeasureModal(parsedTemplate())).toEqual([]);
  });

  it("1.20 texts_short", () => {
    expect(checkTextLength(parsedTemplate())).toEqual([]);
  });

  it("1.21 no_guess_words_or_references", () => {
    expect(checkGuessWordsAndReferences(parsedTemplate())).toEqual([]);
  });

  it.each([
    { text: "Skaden er trolig gammel.", hits: ["trolig"] },
    { text: "Det ser ut til at sjiktet er gammelt.", hits: ["ser ut til"] },
    { text: "Utført etter TEK17.", hits: ["TEK"] },
    { text: "Se NS 3600.", hits: ["NS"] },
    { text: "Kilde: SINTEF Byggforsk.", hits: ["Byggforsk"] },
    { text: "Teknisk rom og arkitekt.", hits: [] },
    { text: "Sjiktet tåler vann.", hits: [] },
    { text: "Ventilasjonen fungerer.", hits: [] },
  ])("1.21 ordgrensene: «$text» gir $hits", ({ text, hits }) => {
    expect(guessWordsAndReferencesIn(text)).toEqual(hits);
  });

  it("1.22 no_text_copied_from_research", () => {
    const copied = reportTexts(parsedTemplate())
      .map(({ where, field, text }) => ({ where, field, run: copiedRun(text) }))
      .filter((hit) => hit.run !== null);
    expect(copied).toEqual([]);
  });

  it("1.22 kopisjekken kan feile: en setning fra researchen blir funnet", () => {
    const files = markdownFiles(RESEARCH_DIR);
    expect(files.length).toBeGreaterThan(0);
    const sample = words(readFileSync(files[0]!, "utf8"))
      .slice(0, RUN_LENGTH + 2)
      .join(" ");
    expect(copiedRun(`Innledning. ${sample}`)).not.toBeNull();
    expect(copiedRun("Dette er en helt ny og oppdiktet setning uten noe fra kildene her.")).toBe(
      null,
    );
  });

  it("1.23 source_ref_set", () => {
    const doc = parsedTemplate();
    const texts = reportTexts(doc);
    for (const o of doc.outcomes) {
      expect(o.source_ref, `${o.question_key}/${o.key}`).toBeTruthy();
      for (const { where, text } of texts) {
        expect(text.includes(o.source_ref!), `${where} har kilden i teksten`).toBe(false);
      }
    }
  });

  it("1.24 merge_fields_only_known", () => {
    const used = reportTexts(parsedTemplate()).flatMap(({ text }) =>
      [...text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!),
    );
    for (const field of used) expect(MERGE_FIELDS, `{${field}}`).toContain(field);
    // Ingen halve flettefelt
    for (const { where, text } of reportTexts(parsedTemplate())) {
      const stripped = text.replace(/\{[^}]*\}/g, "");
      expect(/[{}]/.test(stripped), where).toBe(false);
    }
  });

  it("1.25 no_tg0_hint", () => {
    const doc = parsedTemplate();
    const tg0 = /TG\s*0/i;
    const texts = [
      ...doc.elements.flatMap((e) => [
        `${e.key} default_value: ${JSON.stringify(e.default_value)}`,
        `${e.key} help_text: ${e.help_text ?? ""}`,
        `${e.key} label: ${e.label}`,
      ]),
      ...doc.element_options.map((o) => `${o.element_key}/${o.key}: ${o.label}`),
      ...doc.sections.flatMap((s) => [s.help_text ?? "", s.standard_text ?? ""]),
    ];
    for (const text of texts) expect(tg0.test(text), text).toBe(false);
    // «Utført uten funn» har ingen standardverdi (spørsmål 72 er åpent)
    const hole = doc.elements.find((e) => e.key === "wet_room.hole_drilling")!;
    expect(hole.default_value).toBeNull();
  });

  it("1.26 no_rules", () => {
    expect(wetRoomTemplate.rules ?? []).toEqual([]);
    expect(wetRoomTemplate.rule_conditions ?? []).toEqual([]);
    expect(wetRoomTemplate.rule_test_cases ?? []).toEqual([]);
  });

  it("1.27 no_personal_data", () => {
    const source = readFileSync(join(process.cwd(), "src/db/seed/templates/wet-room.ts"), "utf8");
    const data = JSON.stringify(wetRoomTemplate);
    for (const text of [source, data]) {
      expect(text).not.toMatch(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/iu);
      expect(text).not.toMatch(/\+47/);
      expect(text).not.toMatch(/(?<!\d)\d{8}(?!\d)/);
      expect(text).not.toMatch(/\d{11}/);
      expect(text).not.toMatch(/(?<!\d)\d{2}\s\d{2}\s\d{2}\s\d{2}(?!\d)/);
    }
  });
});

describe("1.28 kontrollene kan feile", () => {
  const checks: [string, Check][] = [
    ["checkNoTgOnNonTgCheckpoint", checkNoTgOnNonTgCheckpoint],
    ["checkOutcomeTexts", checkOutcomeTexts],
    ["checkGuessWordsAndReferences", checkGuessWordsAndReferences],
    ["checkTextLength", checkTextLength],
    ["checkMeasureModal", checkMeasureModal],
  ];

  it.each(checks)("%s gir ingen feil på det lille, gode dokumentet", (_, check) => {
    expect(check(parsedSmall())).toEqual([]);
  });

  it.each(badDocuments)(
    "1.28 check_fails_on_bad_document: $checkName feiler på «$name»",
    ({ check, change }) => {
      expect(check(parsedSmall(change)).length).toBeGreaterThan(0);
    },
  );

  it.each(checks)("1.28 %s gir ingen feil på malen", (_, check) => {
    expect(check(parsedTemplate())).toEqual([]);
  });

  it("alle kontrollene i signaturavtalen har et dokument som skal feile", () => {
    const covered = new Set(badDocuments.map((b) => b.checkName));
    expect(sorted([...covered])).toEqual(sorted(checks.map(([name]) => name)));
  });
});
