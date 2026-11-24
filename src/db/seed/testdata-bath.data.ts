import type { OverrideReasonCode } from "@/db/schema";

/*
 * Scenarioene for badene i testdataene, del 2 (docs/funksjoner/fase2a-testdata-del-2.md). Ren fil:
 * ingen database, ingen KI. Seed-steget (`testdata-bath.ts`) leser scenarioene og skriver dem
 * gjennom kjernetjenestene; testene leser dem som fasit.
 *
 * Støtter hovedmålene:
 * - De ansatte: badene i testmiljøet ligner ekte befaringer (svar, målinger, avvik med TG, årsak,
 *   konsekvens, tiltak og kostnad), også avbrutte befaringer under arbeid.
 * - KI i bunnen: faste koder og regelbeslutninger i samme form som ekte data, og et feltnotat per
 *   avvik som evalueringssett for «Skriv det du ser» og «KI i veien». Ingen KI-kall.
 * - Færre reklamasjoner: TG kommer bare fra regelmotoren og utfallene i malen. Scenarioet sier
 *   hvilke forslag som skal komme, og seed stopper hvis regelmotoren svarer noe annet.
 *
 * Faste regler for innholdet (fagansvarlig, A501–A514):
 * - Bare koder fra badmalen (`src/db/seed/templates/wet-room.ts`). Ingen `low_threshold_height`,
 *   `insufficient_fall` bare ved motfall, ingen `other_written` som dokumentasjon (A513).
 * - TG3 har kostnadsintervall fra `TG3_COST_BANDS` (A509), TG2 har ingen kostnad, HMS ingen TG.
 * - Vekt-% betyr treverk: målested og oppbygging beskriver treverk. RF % bare i bad under arbeid
 *   der tilliggende ikke står ferdig (A511).
 * - Fritekstene er egne ord, merket «utkast, ikke godkjent av fagrådet», uten gjetteord, uten
 *   henvisning til standarden og uten person- eller adresseopplysninger.
 */

/** Merket på alle fritekster i testdataene som ikke kommer fra malen. */
export const TESTDATA_DRAFT_LABEL = "utkast, ikke godkjent av fagrådet" as const;

// --- Kodene fra badmalen --------------------------------------------------------------------

const GENERAL = "wet_room.general";
const DOCUMENTATION = "wet_room.documentation";
const WALLS_CEILING = "wet_room.walls_ceiling";
const FLOOR = "wet_room.floor";
const MEMBRANE_DRAIN = "wet_room.membrane_drain";
const FIXTURES = "wet_room.fixtures";
const VENTILATION = "wet_room.ventilation";
const ADJACENT = "wet_room.adjacent";

/** Kontrollpunktene i malens rekkefølge. «Under arbeid» fylles i denne rekkefølgen (A512). */
export const WET_ROOM_CHECKPOINT_ORDER = [
  GENERAL,
  DOCUMENTATION,
  WALLS_CEILING,
  FLOOR,
  MEMBRANE_DRAIN,
  FIXTURES,
  VENTILATION,
  ADJACENT,
] as const;
export type BathCheckpointKey = (typeof WET_ROOM_CHECKPOINT_ORDER)[number];

/** Reglene i badmalen (faste koder). */
export const BATH_RULES = {
  pastLifespan: "wet_room.membrane_past_lifespan",
  before2000: "wet_room.membrane_before_2000",
  moisture: "wet_room.hole_moisture_over_limit",
  notDone: "wet_room.hole_drilling_not_done",
  noMoisture: "wet_room.hole_no_elevated_moisture",
} as const;
export type BathRuleKey = (typeof BATH_RULES)[keyof typeof BATH_RULES];

/** Aldersreglene. Forslaget herfra avgjør aldersprofilen (A514). */
export const BATH_AGE_RULE_KEYS: readonly BathRuleKey[] = [
  BATH_RULES.before2000,
  BATH_RULES.pastLifespan,
];

// --- Typene ---------------------------------------------------------------------------------

/** Statusene på oppdrag som får rapport. «Bestilt» får ingen. */
export const BATH_ASSIGNMENT_STATUSES = ["in_progress", "completed", "invoiced"] as const;
export type BathAssignmentStatus = (typeof BATH_ASSIGNMENT_STATUSES)[number];

const DONE_STATUSES: readonly BathAssignmentStatus[] = ["completed", "invoiced"];
const IN_PROGRESS: readonly BathAssignmentStatus[] = ["in_progress"];

/**
 * Aldersprofilen (A514): hvilket aldersforslag badets år, sjikttype og dokumentasjon gir.
 * `none`: 2000 eller senere og under alderen i tabellen. `tg2_age`: 2000 eller senere og alderen
 * er nådd. `tg3_before_2000`: før 2000, uansett sjikttype.
 */
export const BATH_AGE_PROFILES = ["none", "tg2_age", "tg3_before_2000"] as const;
export type BathAgeProfile = (typeof BATH_AGE_PROFILES)[number];

/** Et svar i scenarioet: valgkode, tall, tekst eller avkrysning, etter felttypen i malen. */
export type BathAnswer = string | number | boolean;
export type BathAnswers = Readonly<Record<string, BathAnswer>>;

/** Grunnene til at hull ikke er tatt (valgene i `wet_room.hole_drilling_reason`). */
export type BathHoleReason = "owner_refused" | "no_access" | "concrete_or_masonry" | "other";

/**
 * Beslutningen på et regelforslag. `open` betyr at forslaget står uten beslutning; det er bare
 * lov på punkt som ikke står ferdig. Eneste `changed` er TG0 → TG1 på tilliggende, og eneste
 * `rejected` er TG0 med `measured_again` på et punkt som ikke står ferdig (fagansvarlig 5, A506).
 */
export type BathRuleDecision =
  | { ruleKey: BathRuleKey; decision: "accepted"; chosenTg?: 2 | 3 }
  | {
      ruleKey: BathRuleKey;
      decision: "changed";
      chosenTg: "1";
      overrideReasonCode: OverrideReasonCode;
    }
  | { ruleKey: BathRuleKey; decision: "rejected"; overrideReasonCode: OverrideReasonCode }
  | { ruleKey: BathRuleKey; decision: "open" };

/** Kostnaden på et avvik: TG3 har intervall, TG2 og HMS har ingen. */
export type BathExpectedCost =
  { type: "none" } | { type: "band"; bandKey: string } | { type: "approx"; amount: number };

/** Ett forventet avvik i badet, med det seed skriver og det «Bilder på PC» og KI skal bruke. */
export type BathExpectedDeviation = {
  checkpointKey: BathCheckpointKey;
  /** Hele koden på avviksspørsmålet, `<punkt>.<spørsmål>`. */
  questionKey: string;
  /** `tg2`, `tg3`, `choose` eller `hms`. */
  outcomeKey: string;
  kind: "tg" | "hms";
  /** TG-en avviket får, eller `null` (HMS). */
  tg: 2 | 3 | null;
  /** Hvor TG-en kommer fra: et regelforslag eller et utfall i malen som takstmannen valgte. */
  source: { type: "rule"; ruleKey: BathRuleKey } | { type: "outcome" };
  /** `edited` bare med en av variantene i `TESTDATA_BATH_EDITED_TEXTS`. */
  textSource: "template" | "edited";
  cost: BathExpectedCost;
  /** Planlagte bilder som korte beskrivelser. Ingen filer og ingen personer (A501). */
  plannedPhotos: readonly string[];
  /** Kort notat slik takstmannen ville skrevet det på stedet. Bare i datafilen, ikke i databasen. */
  fieldNote: string;
};

/** TGIU på tilliggende: opplysningene følger grunnen (A349, fagansvarlig runde 3). */
export type BathTgiuPlan = {
  reason: BathHoleReason;
  /** Begrunnelsen, både i svaret og i `tgiu_details.reason` (T-0114). */
  reasonNote: string;
  /** Sann bare ved `owner_refused`. */
  ownerInformed: boolean;
  alternativeMethod: string;
  alternativeResult: string;
  risk: string;
  constructionVulnerable: "yes" | "no";
  howToExamine: string;
};

export type BathScenario = {
  /** Fast kode. */
  key: string;
  /** Norsk navn i oppsummeringen. */
  name: string;
  mandatory: boolean;
  allowedStatuses: readonly BathAssignmentStatus[];
  ageProfile: BathAgeProfile;
  /**
   * `from_bath`: byggeåret for våtrommet er badets år fra del 1 (A507). `unknown`: tomt år og
   * kilden «Ukjent» (scenario 11).
   */
  buildYear: "from_bath" | "unknown";
  /** Hvor mange punkt som står ferdige, i malens rekkefølge. 8 for ferdige og fakturerte. */
  doneCount: number;
  /**
   * Svarene per kontrollpunkt (feltkoder fra malen). Byggeåret, kilden og byggeforskriften i
   * «Generelt» legges til av seed fra badets år. Punkt uten nøkkel får ingen svar.
   */
  answers: Partial<Record<BathCheckpointKey, BathAnswers>>;
  /** TGIU på tilliggende, når hull ikke er tatt. */
  tgiu: BathTgiuPlan | null;
  /** Beslutningen per regelforslag. Nøyaktig forslagene regelmotoren gir for badet. */
  decisions: readonly BathRuleDecision[];
  expected: { deviations: readonly BathExpectedDeviation[] };
};

// --- Kostnad, endrede tekster og fritekster -----------------------------------------------------

/**
 * Kostnadsintervallet for TG3 per utfall (A509), utkast til fagrådet har svart (spørsmål 92).
 * Sjikt fra før 2000: full fornyelse av våtrommet. Forhøyet fukt med TG3: åpne og utbedre den
 * fuktskadde delen.
 */
export const TG3_COST_BANDS = {
  membrane_before_2000: "from_200000_to_500000",
  elevated_moisture: "from_100000_to_200000",
} as const;

/** Merket på kostnadsintervallene i `TG3_COST_BANDS`. */
export const TG3_COST_BANDS_LABEL = TESTDATA_DRAFT_LABEL;

/**
 * Endrede avvikstekster (`text_source = edited`), høyst tre. Bare avviksteksten endres; årsak,
 * konsekvens og flettefeltene står som i malen.
 */
export const TESTDATA_BATH_EDITED_TEXTS = {
  label: TESTDATA_DRAFT_LABEL,
  variants: {
    "wet_room.ventilation.weak_extract|tg2":
      "Avtrekket i våtrommet trekker svakt ved test med papirark mot ventilen.",
    "wet_room.walls_ceiling.cracked_tiles_or_joints|tg2":
      "Det er riss i fugene og to sprukne fliser på veggen ved dusjen.",
    "wet_room.documentation.missing_membrane_documentation|tg2":
      "Eier har ikke kunnet vise papirer på hvordan det vanntette sjiktet ble lagt, heller ikke en samsvarserklæring.",
  },
} as const;
export type BathEditedTextKey = keyof (typeof TESTDATA_BATH_EDITED_TEXTS)["variants"];

/**
 * Fritekst som ikke finnes i malen, én eller to korte varianter per felt. Tekstene for målested og
 * oppbygging ved vekt-% beskriver treverk (spørsmål 77 e).
 */
export const TESTDATA_BATH_FREE_TEXTS = {
  hole_location_timber: {
    label: TESTDATA_DRAFT_LABEL,
    variants: ["Bunnsvill i veggen mot gangen, ved dørkarmen", "Stender i veggen bak servanten"],
  },
  hole_construction_timber: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Bindingsverk i tre med våtromsplater og fliser på badsiden",
      "Trestendere med gipsplater mot gangen og membran mot badet",
    ],
  },
  hole_location_rf: {
    label: TESTDATA_DRAFT_LABEL,
    variants: ["Borehull i gulvet utenfor dusjsonen"],
  },
  hole_construction_rf: {
    label: TESTDATA_DRAFT_LABEL,
    variants: ["Støpt gulv med varmekabler under flisene"],
  },
  tgiu_reason_owner_refused: {
    label: TESTDATA_DRAFT_LABEL,
    variants: ["Eier ville ikke at det ble boret hull i veggen mot gangen."],
  },
  tgiu_reason_concrete_or_masonry: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Veggene rundt badet er støpt, så hull for måling i treverk kunne ikke tas.",
      "Badet ligger mellom murte vegger uten treverk der hull kunne tas.",
    ],
  },
  alternative_method: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Overflatemåling med fuktindikator langs gulv og vegger utenfor badet",
      "Fuktindikator mot sokkel og gulv i rommene ved siden av",
    ],
  },
  alternative_result: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Ingen utslag over normalt nivå på målepunktene",
      "Normale verdier på alle punktene som ble målt",
    ],
  },
  not_investigated_risk: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Skjult fukt i veggen mot badet kan gi skader som ikke er oppdaget.",
      "Lekkasje fra badet kan ha gått inn i konstruksjonen uten synlige tegn.",
    ],
  },
  how_to_examine_timber: {
    label: TESTDATA_DRAFT_LABEL,
    variants: [
      "Hull i veggen mot badet med måling i treverket, etter avtale med eier.",
      "Åpning av veggen fra rommet ved siden av, med måling i svill og stendere.",
    ],
  },
  how_to_examine_masonry: {
    label: TESTDATA_DRAFT_LABEL,
    variants: ["Boring i gulvet utenfor badet med måling av fukt i støpen, utført av fagperson."],
  },
} as const;
export type BathFreeTextField = keyof typeof TESTDATA_BATH_FREE_TEXTS;

/** Første variant av en fritekst. Seed velger varianten per bad med `freeTextVariant`. */
function text(field: BathFreeTextField, variant = 0): string {
  const variants = TESTDATA_BATH_FREE_TEXTS[field].variants as readonly string[];
  return variants[variant % variants.length] as string;
}

// --- Byggesteinene for svarene ----------------------------------------------------------------

/** Overflater, gulv og ventilasjon uten avvik. Fall og terskel er tydelig uproblematiske. */
const WALLS: BathAnswers = { "wet_room.ceiling_type": "painted" };
const FLOOR_OK: BathAnswers = {
  "wet_room.floor_type": "tiles",
  "wet_room.fall_direction_1": 15,
};
const VENTILATION_OK: BathAnswers = { "wet_room.ventilation_type": "mechanical_extract" };

function documentation(type: "none" | "declaration_of_conformity" | "wet_room_certificate") {
  return { "wet_room.documentation_type": type } as const;
}

function membrane(type: string, drain: "clamping_ring" | "unknown" = "clamping_ring"): BathAnswers {
  return {
    "wet_room.threshold_height_mm": 30,
    "wet_room.membrane_type": type,
    "wet_room.drain_type": drain,
  };
}

/** Hull tatt og målt i vekt-% i treverk. */
function holeInTimber(
  drilling: "done_no_findings" | "done_with_findings",
  reading: number,
  variant = 0,
): BathAnswers {
  return {
    "wet_room.hole_drilling": drilling,
    "wet_room.hole_moisture_reading": reading,
    "wet_room.hole_moisture_unit": "weight_percent",
    "wet_room.hole_moisture_location": text("hole_location_timber", variant),
    "wet_room.hole_construction": text("hole_construction_timber", variant),
  };
}

/** TGIU etter grunnen: «eier informert» bare ved `owner_refused`. */
function tgiu(reason: "owner_refused" | "concrete_or_masonry", variant = 0): BathTgiuPlan {
  const refused = reason === "owner_refused";
  return {
    reason,
    reasonNote: refused
      ? text("tgiu_reason_owner_refused", variant)
      : text("tgiu_reason_concrete_or_masonry", variant),
    ownerInformed: refused,
    alternativeMethod: text("alternative_method", variant),
    alternativeResult: text("alternative_result", variant),
    risk: text("not_investigated_risk", variant),
    constructionVulnerable: refused ? "yes" : "no",
    howToExamine: refused
      ? text("how_to_examine_timber", variant)
      : text("how_to_examine_masonry", variant),
  };
}

// --- De forventede avvikene ---------------------------------------------------------------------

const DEV_MISSING_DOCUMENTATION: BathExpectedDeviation = {
  checkpointKey: DOCUMENTATION,
  questionKey: "wet_room.documentation.missing_membrane_documentation",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["oversikt over badet fra døren"],
  fieldNote: "ingen papirer på membranen, ikke vist samsvarserklæring",
};

const DEV_PAST_LIFESPAN: BathExpectedDeviation = {
  checkpointKey: MEMBRANE_DRAIN,
  questionKey: "wet_room.membrane_drain.membrane_past_lifespan",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "rule", ruleKey: BATH_RULES.pastLifespan },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["nærbilde av sluk med klemring", "overgang mellom gulv og vegg ved dusjen"],
  fieldNote: "membranen har passert alderen, ingen synlige skader",
};

const DEV_BEFORE_2000: BathExpectedDeviation = {
  checkpointKey: MEMBRANE_DRAIN,
  questionKey: "wet_room.membrane_drain.membrane_before_2000",
  outcomeKey: "tg3",
  kind: "tg",
  tg: 3,
  source: { type: "rule", ruleKey: BATH_RULES.before2000 },
  textSource: "template",
  cost: { type: "band", bandKey: TG3_COST_BANDS.membrane_before_2000 },
  plannedPhotos: ["nærbilde av sluket", "oversikt over gulvet mot sluket"],
  fieldNote: "gammelt bad, membran fra før 2000, sluk av eldre utseende",
};

function moistureDeviation(tg: 2 | 3): BathExpectedDeviation {
  return {
    checkpointKey: ADJACENT,
    questionKey: "wet_room.adjacent.elevated_moisture",
    outcomeKey: "choose",
    kind: "tg",
    tg,
    source: { type: "rule", ruleKey: BATH_RULES.moisture },
    textSource: "template",
    cost: tg === 3 ? { type: "band", bandKey: TG3_COST_BANDS.elevated_moisture } : { type: "none" },
    plannedPhotos: ["fuktmåler i borehullet", "veggen mot gangen der hullet er tatt"],
    fieldNote:
      tg === 3
        ? "høy fukt i svillen ved dørkarmen, mykt treverk rundt hullet"
        : "forhøyet fukt i stenderen, treverket er fast",
  };
}

const DEV_WEAK_EXTRACT_EDITED: BathExpectedDeviation = {
  checkpointKey: VENTILATION,
  questionKey: "wet_room.ventilation.weak_extract",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "edited",
  cost: { type: "none" },
  plannedPhotos: ["avtrekksventil i himlingen med papirark"],
  fieldNote: "avtrekket holder ikke papirarket, svakt trekk",
};

const DEV_POOR_AIR_SUPPLY: BathExpectedDeviation = {
  checkpointKey: VENTILATION,
  questionKey: "wet_room.ventilation.poor_air_supply",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["døren til badet sett nedenfra"],
  fieldNote: "ingen spalte under døren, ingen ventil for tilluft",
};

const DEV_OVERHEATING: BathExpectedDeviation = {
  checkpointKey: FIXTURES,
  questionKey: "wet_room.fixtures.signs_of_overheating",
  outcomeKey: "hms",
  kind: "hms",
  tg: null,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["stikkontakt ved speilet med brunt merke"],
  fieldNote: "brunt merke rundt stikkontakten ved speilet, varm å kjenne på",
};

const DEV_WALL_JOINTS_EDITED: BathExpectedDeviation = {
  checkpointKey: WALLS_CEILING,
  questionKey: "wet_room.walls_ceiling.cracked_tiles_or_joints",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "edited",
  cost: { type: "none" },
  plannedPhotos: ["nærbilde av riss i fuge ved dusjen"],
  fieldNote: "riss i fugene og to sprukne fliser ved dusjen",
};

const DEV_MOISTURE_MARKS: BathExpectedDeviation = {
  checkpointKey: WALLS_CEILING,
  questionKey: "wet_room.walls_ceiling.moisture_marks",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["misfarging i himlingen over dusjen"],
  fieldNote: "gulbrune merker i himlingen over dusjen",
};

const DEV_FLOOR_JOINTS: BathExpectedDeviation = {
  checkpointKey: FLOOR,
  questionKey: "wet_room.floor.cracked_tiles_or_joints",
  outcomeKey: "tg2",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["sprekk i flis ved sluket"],
  fieldNote: "sprekk i flis ved sluk, løs flis",
};

const DEV_NEGATIVE_FALL: BathExpectedDeviation = {
  checkpointKey: FLOOR,
  questionKey: "wet_room.floor.insufficient_fall",
  outcomeKey: "choose",
  kind: "tg",
  tg: 2,
  source: { type: "outcome" },
  textSource: "template",
  cost: { type: "none" },
  plannedPhotos: ["vater på gulvet mot sluket"],
  fieldNote: "motfall fra sluket mot døren, vann blir stående ved terskelen",
};

/** Floor med motfall i retning 1 (bare sammen med `insufficient_fall`). */
const FLOOR_NEGATIVE_FALL: BathAnswers = { ...FLOOR_OK, "wet_room.fall_direction_1": -2 };

// --- Scenarioene ----------------------------------------------------------------------------------

/** Svarene på et ferdig bad der alle punktene er besøkt. */
function doneAnswers(parts: {
  documentation: BathAnswers;
  membrane: BathAnswers;
  adjacent?: BathAnswers;
  floor?: BathAnswers;
}): Partial<Record<BathCheckpointKey, BathAnswers>> {
  return {
    [GENERAL]: {},
    [DOCUMENTATION]: parts.documentation,
    [WALLS_CEILING]: WALLS,
    [FLOOR]: parts.floor ?? FLOOR_OK,
    [MEMBRANE_DRAIN]: parts.membrane,
    [FIXTURES]: {},
    [VENTILATION]: VENTILATION_OK,
    ...(parts.adjacent ? { [ADJACENT]: parts.adjacent } : {}),
  };
}

const ACCEPT_TG0: BathRuleDecision = { ruleKey: BATH_RULES.noMoisture, decision: "accepted" };
const ACCEPT_TGIU: BathRuleDecision = { ruleKey: BATH_RULES.notDone, decision: "accepted" };
const ACCEPT_BEFORE_2000: BathRuleDecision = {
  ruleKey: BATH_RULES.before2000,
  decision: "accepted",
};
const ACCEPT_PAST_LIFESPAN: BathRuleDecision = {
  ruleKey: BATH_RULES.pastLifespan,
  decision: "accepted",
};

export const TESTDATA_BATH_SCENARIOS: readonly BathScenario[] = [
  // 1. Visningsbadet: avbrutt etter sanitærutstyret, TG3 før 2000 med kostnad, TG2 med fast TG og
  // endret tekst, HMS uten TG og TGIU med alle opplysningene på tilliggende (hullet tas tidlig,
  // A512). Ventilasjon står urørt.
  {
    key: "showcase",
    name: "Visningsbad",
    mandatory: true,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 6,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("none"),
      [WALLS_CEILING]: WALLS,
      [FLOOR]: FLOOR_OK,
      [MEMBRANE_DRAIN]: membrane("foil"),
      [FIXTURES]: {},
    },
    tgiu: tgiu("owner_refused"),
    decisions: [ACCEPT_BEFORE_2000, ACCEPT_TGIU],
    expected: {
      deviations: [
        DEV_MISSING_DOCUMENTATION,
        DEV_WALL_JOINTS_EDITED,
        DEV_BEFORE_2000,
        DEV_OVERHEATING,
      ],
    },
  },
  // 2. TG2 for alder: folie uten dokumentasjon, 18 år eller eldre, 2000 eller senere
  {
    key: "tg2_age",
    name: "TG2 for alder",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg2_age",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("none"),
      membrane: membrane("foil"),
      adjacent: holeInTimber("done_no_findings", 11),
    }),
    tgiu: null,
    decisions: [ACCEPT_PAST_LIFESPAN, ACCEPT_TG0],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION, DEV_PAST_LIFESPAN] },
  },
  // 3. TG3 før 2000: sjiktår tomt, byggeåret før 2000. Ingen TG2 for alder i tillegg (B3)
  {
    key: "tg3_before_2000",
    name: "TG3 før 2000",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("none"),
      membrane: membrane("foil"),
      adjacent: holeInTimber("done_no_findings", 12.5, 1),
    }),
    tgiu: null,
    decisions: [ACCEPT_BEFORE_2000, ACCEPT_TG0],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION, DEV_BEFORE_2000] },
  },
  // 4. TGIU komplett: eier nektet hulltaking, alle fem opplysningene
  {
    key: "tgiu_owner_refused",
    name: "TGIU, eier nektet hulltaking",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("declaration_of_conformity"),
      membrane: membrane("liquid_membrane"),
    }),
    tgiu: tgiu("owner_refused"),
    decisions: [ACCEPT_TGIU],
    expected: { deviations: [] },
  },
  // 5. TG0 på tilliggende: hull uten funn under 15 vekt-%, og en TG2 på veggen (endret tekst)
  {
    key: "tg0",
    name: "TG0 på tilliggende",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("wet_room_certificate"),
      membrane: membrane("membrane_boards"),
      adjacent: holeInTimber("done_no_findings", 11),
    }),
    tgiu: null,
    decisions: [ACCEPT_TG0],
    expected: { deviations: [DEV_WALL_JOINTS_EDITED] },
  },
  // 6. Forhøyet fukt med TG2: tiltaket med «bør» (applies_to_tg = 2)
  {
    key: "moisture_tg2",
    name: "Forhøyet fukt med TG2",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("declaration_of_conformity"),
      membrane: membrane("sheet_membrane"),
      adjacent: holeInTimber("done_with_findings", 16.5, 1),
    }),
    tgiu: null,
    decisions: [{ ruleKey: BATH_RULES.moisture, decision: "accepted", chosenTg: 2 }],
    expected: { deviations: [moistureDeviation(2)] },
  },
  // 7. Forhøyet fukt med TG3: tiltaket med «må» og kostnadsintervall
  {
    key: "moisture_tg3",
    name: "Forhøyet fukt med TG3",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("wet_room_certificate"),
      membrane: membrane("foil"),
      adjacent: holeInTimber("done_with_findings", 21),
    }),
    tgiu: null,
    decisions: [{ ruleKey: BATH_RULES.moisture, decision: "accepted", chosenTg: 3 }],
    expected: { deviations: [moistureDeviation(3)] },
  },
  // 8. Endret forslag: TG0 på tilliggende endret til TG1 (eneste lovlige endring)
  {
    key: "changed_suggestion",
    name: "Endret forslag",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("wet_room_certificate"),
      membrane: membrane("sheet_membrane"),
      adjacent: holeInTimber("done_no_findings", 13.5, 1),
    }),
    tgiu: null,
    decisions: [
      {
        ruleKey: BATH_RULES.noMoisture,
        decision: "changed",
        chosenTg: "1",
        overrideReasonCode: "visible_damage",
      },
    ],
    expected: { deviations: [] },
  },
  // 9. Avvist forslag: TG0 avvist med `measured_again`, tilliggende står ikke ferdig (A506)
  {
    key: "rejected_suggestion",
    name: "Avvist forslag",
    mandatory: true,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 3,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("declaration_of_conformity"),
      [WALLS_CEILING]: WALLS,
      [ADJACENT]: holeInTimber("done_no_findings", 12),
    },
    tgiu: null,
    decisions: [
      {
        ruleKey: BATH_RULES.noMoisture,
        decision: "rejected",
        overrideReasonCode: "measured_again",
      },
    ],
    expected: { deviations: [] },
  },
  // 10. Bad uten avvik: sju punkt med TG1 og tilliggende med TG0 fra godtatt forslag
  {
    key: "no_deviations",
    name: "Bad uten avvik",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("wet_room_certificate"),
      membrane: membrane("liquid_membrane"),
      adjacent: holeInTimber("done_no_findings", 11),
    }),
    tgiu: null,
    decisions: [ACCEPT_TG0],
    expected: { deviations: [] },
  },
  // 11. «Ukjent» byggeår (T-0051, B2.5): sjiktet er ikke nådd og får verken TG1 eller TGIU
  {
    key: "unknown_build_year",
    name: "Ukjent byggeår",
    mandatory: true,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "none",
    buildYear: "unknown",
    doneCount: 4,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("none"),
      [WALLS_CEILING]: WALLS,
      [FLOOR]: FLOOR_OK,
    },
    tgiu: null,
    decisions: [],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION] },
  },
  // 12. HMS uten TG: varmgang ved el-punkt, punktet får TG1 direkte (A505)
  {
    key: "hms",
    name: "HMS uten TG",
    mandatory: true,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("declaration_of_conformity"),
      membrane: membrane("foil"),
      adjacent: holeInTimber("done_no_findings", 10.5, 1),
    }),
    tgiu: null,
    decisions: [ACCEPT_TG0],
    expected: { deviations: [DEV_OVERHEATING] },
  },

  // --- Bare i den tilfeldige delen -------------------------------------------------------------

  // TGIU der hullet ikke kunne tas (betong eller mur): alt unntatt «eier informert»
  {
    key: "tgiu_concrete",
    name: "TGIU, betong eller mur",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("wet_room_certificate"),
      membrane: membrane("sheet_membrane"),
    }),
    tgiu: tgiu("concrete_or_masonry"),
    decisions: [ACCEPT_TGIU],
    expected: { deviations: [DEV_POOR_AIR_SUPPLY] },
  },
  // Gammelt bad på betong: TG3 før 2000 og TGIU uten «eier informert»
  {
    key: "tgiu_concrete_old",
    name: "TGIU, betong eller mur, gammelt bad",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("none"),
      membrane: membrane("liquid_membrane", "unknown"),
    }),
    tgiu: tgiu("concrete_or_masonry", 1),
    decisions: [ACCEPT_BEFORE_2000, ACCEPT_TGIU],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION, DEV_BEFORE_2000] },
  },
  // Gammelt bad med dokumentasjon og forhøyet fukt med TG2
  {
    key: "old_moisture",
    name: "Gammelt bad med forhøyet fukt",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("declaration_of_conformity"),
      membrane: membrane("liquid_membrane"),
      adjacent: holeInTimber("done_with_findings", 17.5, 1),
    }),
    tgiu: null,
    decisions: [
      ACCEPT_BEFORE_2000,
      { ruleKey: BATH_RULES.moisture, decision: "accepted", chosenTg: 2 },
    ],
    expected: { deviations: [DEV_BEFORE_2000, moistureDeviation(2)] },
  },
  // Smøremembran uten dokumentasjon, 15 år eller eldre, med motfall mot døren
  {
    key: "tg2_age_liquid",
    name: "TG2 for alder, smøremembran",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg2_age",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("none"),
      membrane: membrane("liquid_membrane"),
      floor: FLOOR_NEGATIVE_FALL,
      adjacent: holeInTimber("done_no_findings", 10.5),
    }),
    tgiu: null,
    decisions: [ACCEPT_PAST_LIFESPAN, ACCEPT_TG0],
    expected: {
      deviations: [DEV_MISSING_DOCUMENTATION, DEV_NEGATIVE_FALL, DEV_PAST_LIFESPAN],
    },
  },
  // Nyere bad med svakt avtrekk (endret tekst)
  {
    key: "young_weak_extract",
    name: "Nyere bad med svakt avtrekk",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("declaration_of_conformity"),
      membrane: membrane("sheet_membrane"),
      adjacent: holeInTimber("done_no_findings", 9.5, 1),
    }),
    tgiu: null,
    decisions: [ACCEPT_TG0],
    expected: { deviations: [DEV_WEAK_EXTRACT_EDITED] },
  },
  // Gammelt bad med varmgang ved el-punkt
  {
    key: "old_hms",
    name: "Gammelt bad med HMS",
    mandatory: false,
    allowedStatuses: DONE_STATUSES,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 8,
    answers: doneAnswers({
      documentation: documentation("none"),
      membrane: membrane("foil"),
      adjacent: holeInTimber("done_no_findings", 12),
    }),
    tgiu: null,
    decisions: [ACCEPT_BEFORE_2000, ACCEPT_TG0],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION, DEV_BEFORE_2000, DEV_OVERHEATING] },
  },
  // Gammelt bad, avbrutt etter dokumentasjonen: forslaget for før 2000 står åpent fra byggeåret
  {
    key: "in_progress_early_old",
    name: "Gammelt bad, befaring nettopp startet",
    mandatory: false,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 2,
    answers: { [GENERAL]: {}, [DOCUMENTATION]: documentation("declaration_of_conformity") },
    tgiu: null,
    decisions: [{ ruleKey: BATH_RULES.before2000, decision: "open" }],
    expected: { deviations: [] },
  },
  // Gammelt bad, avbrutt etter sjiktet: TG3 før 2000 godtatt med kostnad
  {
    key: "in_progress_old_membrane",
    name: "Gammelt bad, avbrutt etter sjiktet",
    mandatory: false,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "tg3_before_2000",
    buildYear: "from_bath",
    doneCount: 5,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("none"),
      [WALLS_CEILING]: WALLS,
      [FLOOR]: FLOOR_OK,
      [MEMBRANE_DRAIN]: membrane("foil", "unknown"),
    },
    tgiu: null,
    decisions: [ACCEPT_BEFORE_2000],
    expected: { deviations: [DEV_MISSING_DOCUMENTATION, DEV_FLOOR_JOINTS, DEV_BEFORE_2000] },
  },
  // Nyere bad, avbrutt etter sjiktet, fukt målt i RF % på tilliggende (ikke vurdert, A511)
  {
    key: "in_progress_rf",
    name: "Nyere bad, fukt målt i RF %",
    mandatory: false,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 5,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("declaration_of_conformity"),
      [WALLS_CEILING]: WALLS,
      [FLOOR]: FLOOR_OK,
      [MEMBRANE_DRAIN]: membrane("sheet_membrane"),
      [ADJACENT]: {
        "wet_room.hole_drilling": "done_no_findings",
        "wet_room.hole_moisture_reading": 78,
        "wet_room.hole_moisture_unit": "relative_humidity",
        "wet_room.hole_moisture_location": text("hole_location_rf"),
        "wet_room.hole_construction": text("hole_construction_rf"),
      },
    },
    tgiu: null,
    decisions: [],
    expected: { deviations: [] },
  },
  // Nyere bad, avbrutt etter veggene, med fuktmerker i himlingen
  {
    key: "in_progress_young_walls",
    name: "Nyere bad, avbrutt etter veggene",
    mandatory: false,
    allowedStatuses: IN_PROGRESS,
    ageProfile: "none",
    buildYear: "from_bath",
    doneCount: 3,
    answers: {
      [GENERAL]: {},
      [DOCUMENTATION]: documentation("wet_room_certificate"),
      [WALLS_CEILING]: { "wet_room.ceiling_type": "boards" },
    },
    tgiu: null,
    decisions: [],
    expected: { deviations: [DEV_MOISTURE_MARKS] },
  },
];

/** De tolv pliktige scenarioene i kortets rekkefølge (A504). */
export const MANDATORY_BATH_SCENARIO_KEYS = [
  "showcase",
  "tg2_age",
  "tg3_before_2000",
  "tgiu_owner_refused",
  "tg0",
  "moisture_tg2",
  "moisture_tg3",
  "changed_suggestion",
  "rejected_suggestion",
  "no_deviations",
  "unknown_build_year",
  "hms",
] as const;
export type MandatoryBathScenarioKey = (typeof MANDATORY_BATH_SCENARIO_KEYS)[number];

/** Visningsbadet (forbedrer 2). Finnes i databasen med `findShowcaseBathReport`. */
export const SHOWCASE_BATH_SCENARIO_KEY: MandatoryBathScenarioKey = "showcase";

/** Scenarioet med nøkkelen. Kaster med norsk melding hvis det ikke finnes. */
export function bathScenarioByKey(key: string): BathScenario {
  const scenario = TESTDATA_BATH_SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`Scenarioet «${key}» finnes ikke i testdataene for badene.`);
  return scenario;
}
