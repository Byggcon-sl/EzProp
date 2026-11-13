import { SOURCE_RULE_AGE, WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { SOURCE_RULE_MOISTURE } from "@/core/rules/data/thresholds";
import type {
  CheckpointDoc,
  DeviationQuestionDoc,
  OutcomeDoc,
  RuleConditionDoc,
  RuleDoc,
  RuleTestCaseDoc,
  StandardMeasureDoc,
  TemplateDocument,
  TemplateElementDoc,
  TemplateElementOptionDoc,
} from "@/core/templates";

/*
 * Systemmalen for tilstandsrapport med ett våtrom (bad), docs/funksjoner/fase2a-mal-bad.md.
 *
 * - Alle tekstene i malen (avvik, årsak, konsekvens og tiltak) er Byggcons egne utkast, IKKE
 *   GODKJENT AV FAGRÅDET. De har `text_status: "draft"` og skal godkjennes før ekte bruk (A200).
 * - Kodene (`key`) er faste og endres aldri etter merge (regel 6). Skal noe få ny betydning,
 *   arkiveres koden og det lages en ny. Testen `key_snapshot` vokter dem.
 * - Kilden står bare i `source_ref` (bakgrunn), aldri i rapportteksten.
 * - Fem regler med testsaker (docs/funksjoner/fase2a-regler-bad.md og
 *   fase2a-svar-regler-bygninger.md): alder mot alderstabellen, sjikt fra før 2000, forhøyet fukt
 *   ved hulltaking, hulltaking ikke utført (TGIU) og hull uten funn under fuktgrensen (TG0).
 *   Reglene gir bare forslag; takstmannen setter TG. Alderstabellen og fuktgrensen er utkast, ikke
 *   godkjent av fagrådet, og ligger i regelmotorens data (`src/core/rules/data`), ikke i malen.
 * - Hulltakingsmålingene er enkeltfelt nå (A202).
 * - Flettefelt i tekstene: se `WET_ROOM_MERGE_FIELDS`.
 */

/** Flettefeltene tekstene bruker, skrevet som `{navn}` i teksten. */
export const WET_ROOM_MERGE_FIELDS = ["årstall", "måleverdi", "enhet"] as const;

const SECTION = "wet_room";
const SOURCE_WET_ROOM = "Forskrift til avhendingslova § 2-2; NS 3600:2025 tillegg A, våtrom";

// --- Hjelpere: fyller standardverdiene, så dokumentet er et fullt `TemplateDocument` ---

let elementOrder = 0;
function element(
  checkpointKey: string,
  key: string,
  label: string,
  fieldType: TemplateElementDoc["field_type"],
  extra: Partial<TemplateElementDoc> = {},
): TemplateElementDoc {
  return {
    key,
    section_key: SECTION,
    checkpoint_key: checkpointKey,
    label,
    field_type: fieldType,
    multiple: false,
    unit: null,
    min_value: null,
    max_value: null,
    decimals: null,
    table_columns: null,
    phrase_slot: null,
    required: false,
    default_value: null,
    help_text: null,
    show_in_report: true,
    sort_order: elementOrder++,
    ...extra,
  };
}

function options(
  elementKey: string,
  list: readonly (readonly [key: string, label: string])[],
  withMaterialCode = false,
): TemplateElementOptionDoc[] {
  return list.map(([key, label], index) => ({
    element_key: elementKey,
    key,
    label,
    material_code: withMaterialCode ? key : null,
    sort_order: index,
  }));
}

let checkpointOrder = 0;
function checkpoint(
  key: string,
  name: string,
  mandatory: boolean,
  related: string[] = [],
): CheckpointDoc {
  return {
    key,
    section_key: SECTION,
    name,
    group: "room",
    mandatory,
    regulation_ref: SOURCE_WET_ROOM,
    gives_tg: true,
    scope: "room",
    room_type_groups: ["wet_room"],
    applies_to_unit: "both",
    related_checkpoint_keys: related,
    sort_order: checkpointOrder++,
  };
}

/** Ett avviksspørsmål med ett utfall og tekstene til utfallet. */
type QuestionSpec = {
  checkpoint: string;
  /** Siste del av koden; hele koden blir `<punkt>.<key>`. */
  key: string;
  question: string;
  kind: OutcomeDoc["kind"];
  deviation: string;
  cause: string | null;
  criterion: OutcomeDoc["default_cause_criterion"];
  consequence: string;
  measures: string[];
  source: string;
};

/** Utfallskoden under spørsmålet: `tg2`, `tg3`, `choose` eller `hms`. */
function outcomeKey(kind: OutcomeDoc["kind"]): string {
  return kind === "choose_tg2_tg3" ? "choose" : kind;
}

// --- Kontrollpunktene ---

const GENERAL = "wet_room.general";
const DOCUMENTATION = "wet_room.documentation";
const WALLS_CEILING = "wet_room.walls_ceiling";
const FLOOR = "wet_room.floor";
const MEMBRANE_DRAIN = "wet_room.membrane_drain";
const FIXTURES = "wet_room.fixtures";
const VENTILATION = "wet_room.ventilation";
const ADJACENT = "wet_room.adjacent";

const checkpoints: CheckpointDoc[] = [
  checkpoint(GENERAL, "Generelt", true),
  checkpoint(DOCUMENTATION, "Dokumentasjon for våtrom", false),
  checkpoint(WALLS_CEILING, "Overflater vegger og himling", false),
  checkpoint(FLOOR, "Overflater gulv", false, [MEMBRANE_DRAIN]),
  checkpoint(MEMBRANE_DRAIN, "Vanntett sjikt, membran og sluk", true, [FLOOR, ADJACENT]),
  checkpoint(FIXTURES, "Sanitærutstyr og innredning", false),
  checkpoint(VENTILATION, "Ventilasjon", false),
  checkpoint(ADJACENT, "Tilliggende konstruksjoner våtrom", true, [MEMBRANE_DRAIN]),
];

// --- Feltene og valgene ---

const elements: TemplateElementDoc[] = [
  // Generelt
  element(GENERAL, "wet_room.build_year", "Byggeår for våtrommet", "number", {
    decimals: 0,
    help_text:
      "Året våtrommet ble bygget eller fikk nytt vanntett sjikt. Nye overflater alene teller ikke.",
  }),
  element(GENERAL, "wet_room.build_year_source", "Kilde for byggeåret", "choice"),
  // Brukes av regler og statistikk; forskriften nevnes ikke i rapporten (svar 39)
  element(GENERAL, "wet_room.building_code", "Byggeforskrift da våtrommet ble bygget", "choice", {
    show_in_report: false,
  }),
  // Dokumentasjon
  element(DOCUMENTATION, "wet_room.documentation_type", "Dokumentasjon som er lagt fram", "choice"),
  // Vegger og himling
  element(WALLS_CEILING, "wet_room.ceiling_type", "Himling", "choice"),
  // Gulv
  element(FLOOR, "wet_room.floor_type", "Gulv", "choice"),
  element(FLOOR, "wet_room.floor_heating", "Varme i gulv eller rom", "choice"),
  element(FLOOR, "wet_room.fall_direction_1", "Fall mot sluk, retning 1", "number", {
    unit: "mm/m",
    decimals: 1,
    help_text: "Fall mot sluk per meter. Negativ verdi betyr motfall.",
  }),
  element(FLOOR, "wet_room.fall_direction_2", "Fall mot sluk, retning 2", "number", {
    unit: "mm/m",
    decimals: 1,
    help_text: "Fall mot sluk per meter. Negativ verdi betyr motfall.",
  }),
  // Vanntett sjikt, membran og sluk
  element(MEMBRANE_DRAIN, "wet_room.threshold_height_mm", "Høyde ved terskel", "number", {
    unit: "mm",
    decimals: 0,
    help_text: "Målt fra overkant slukrist opp til overkant membran der terskelen står.",
  }),
  element(MEMBRANE_DRAIN, "wet_room.membrane_type", "Vanntett sjikt", "choice"),
  element(MEMBRANE_DRAIN, "wet_room.membrane_year", "Årstall for det vanntette sjiktet", "number", {
    decimals: 0,
    help_text: "Tomt betyr samme år som byggeåret for våtrommet.",
  }),
  element(MEMBRANE_DRAIN, "wet_room.drain_type", "Sluk", "choice"),
  // Ventilasjon
  element(VENTILATION, "wet_room.ventilation_type", "Ventilasjon", "choice"),
  // Tilliggende konstruksjoner (hulltaking)
  element(ADJACENT, "wet_room.hole_drilling", "Hulltaking", "choice"),
  element(ADJACENT, "wet_room.hole_moisture_reading", "Fuktmåling i hullet", "number", {
    decimals: 1,
  }),
  element(ADJACENT, "wet_room.hole_moisture_unit", "Enhet for fuktmålingen", "choice"),
  element(ADJACENT, "wet_room.hole_moisture_location", "Målested", "text"),
  element(ADJACENT, "wet_room.hole_air_temperature", "Lufttemperatur", "number", {
    unit: "°C",
    decimals: 1,
  }),
  element(ADJACENT, "wet_room.hole_construction", "Oppbygging der hullet er tatt", "text"),
  element(ADJACENT, "wet_room.hole_drilling_reason", "Hvorfor hull ikke er tatt", "choice"),
  element(ADJACENT, "wet_room.hole_drilling_reason_note", "Begrunnelse", "text"),
  element(
    ADJACENT,
    "wet_room.owner_informed",
    "Eier som nektet hulltaking, er informert om utvidet ansvar",
    "checkbox",
  ),
  element(ADJACENT, "wet_room.other_moisture_method", "Annen fuktundersøkelse, metode", "text"),
  element(ADJACENT, "wet_room.other_moisture_result", "Annen fuktundersøkelse, resultat", "text"),
  element(
    ADJACENT,
    "wet_room.not_investigated_risk",
    "Risiko ved at forholdet ikke er undersøkt",
    "text",
  ),
  element(
    ADJACENT,
    "wet_room.construction_damage_prone",
    "Er konstruksjonen skadeutsatt?",
    "choice",
  ),
];

const elementOptions: TemplateElementOptionDoc[] = [
  ...options("wet_room.build_year_source", [
    ["documented", "Dokumentert"],
    ["owner_stated", "Opplyst av eier"],
    ["estimated", "Anslått"],
    ["unknown", "Ukjent (byggeåret for bygningen brukes)"],
  ]),
  ...options("wet_room.building_code", [
    ["before_1997", "Før 1997"],
    // Bare navnene er rettet (2a-2); kodene står (regel 6). Årstallene overlapper ved
    // overgangene fordi forskriftene hadde overgangsperioder.
    ["from_1997_to_2010", "TEK97 (1997–2010)"],
    ["tek10", "TEK10 (2010–2017)"],
    ["tek17", "TEK17 (fra 2017)"],
    ["unknown", "Ukjent"],
  ]),
  ...options("wet_room.documentation_type", [
    ["none", "Ingen"],
    ["declaration_of_conformity", "Samsvarserklæring"],
    ["wet_room_certificate", "Våtromssertifikat"],
    ["other_written", "Annen skriftlig dokumentasjon"],
  ]),
  ...options("wet_room.ceiling_type", [
    ["painted", "Malt"],
    ["boards", "Plater"],
    ["panel", "Panel"],
    ["other", "Annet"],
  ]),
  ...options("wet_room.floor_type", [
    ["tiles", "Fliser"],
    ["vinyl", "Vinyl"],
    ["untreated_concrete", "Ubehandlet betong"],
    ["painted_concrete", "Malt betong"],
    ["wood", "Tre"],
    ["other", "Annet"],
  ]),
  ...options("wet_room.floor_heating", [
    ["heating_cables", "Varmekabler"],
    ["waterborne", "Vannbåren varme"],
    ["panel_heater", "Panelovn"],
    ["radiator", "Radiator"],
    ["none", "Ingen"],
    ["other", "Annet"],
  ]),
  ...options(
    "wet_room.membrane_type",
    [
      ["liquid_membrane", "Smøremembran"],
      ["foil", "Folie"],
      ["sheet_membrane", "Banemembran"],
      ["membrane_boards", "Membranplater (plater med tettesystem)"],
      ["bathroom_cabin", "Baderomskabin"],
      ["bathroom_panel", "Baderomspanel"],
      ["wet_room_wallpaper_paint", "Våtromstapet eller malingssystem"],
      ["wet_room_vinyl", "Våtromsvinyl"],
      ["unknown", "Ukjent"],
    ],
    true,
  ),
  ...options("wet_room.drain_type", [
    ["clamping_ring", "Sluk med klemring"],
    ["without_clamping_ring", "Eldre sluk uten klemring"],
    ["unknown", "Ukjent"],
  ]),
  ...options("wet_room.ventilation_type", [
    ["balanced", "Balansert"],
    ["mechanical_extract", "Mekanisk avtrekk"],
    ["natural", "Naturlig"],
    ["none", "Ingen"],
  ]),
  ...options("wet_room.hole_drilling", [
    ["done_no_findings", "Utført uten funn"],
    ["done_with_findings", "Utført med funn"],
    ["not_done", "Ikke utført"],
  ]),
  ...options("wet_room.hole_moisture_unit", [
    ["weight_percent", "Vekt-%"],
    ["relative_humidity", "RF %"],
  ]),
  ...options("wet_room.hole_drilling_reason", [
    ["owner_refused", "Eier ga ikke samtykke"],
    ["no_access", "Ikke tilgang"],
    ["concrete_or_masonry", "Betong eller mur"],
    ["other", "Annet"],
  ]),
  ...options("wet_room.construction_damage_prone", [
    ["yes", "Ja"],
    ["no", "Nei"],
  ]),
];

// --- Avviksspørsmålene med utkast til tekster (utkast, ikke godkjent av fagrådet) ---

const SOURCE_DOCUMENTATION = "NS 3600:2025 tillegg A, dokumentasjon av våtrom";
const SOURCE_AGE = "NS 3600:2025 tillegg C, vanntett sjikt i våtrom fra før 2000";
const SOURCE_FALL = "NS 3600:2025 tillegg A, fall og høyde ved terskel i våtrom";
const SOURCE_HOLE = "Forskrift til avhendingslova § 2-2; NS 3600:2025 tillegg A, hulltaking";
const SOURCE_HMS = "Forskrift til avhendingslova § 2-18; NS 3600:2025 pkt. 13, HMS";

const questionSpecs: QuestionSpec[] = [
  // Generelt
  {
    checkpoint: GENERAL,
    key: "full_upgrade_needed",
    question: "Har våtrommet så mange eller store avvik at hele rommet bør bygges om?",
    kind: "tg3",
    deviation:
      "Våtrommet har flere avvik som samlet gjør at rommet ikke fungerer som et trygt våtrom.",
    cause: "Avvikene gjelder flere deler av rommet og kan ikke rettes hver for seg.",
    criterion: "functional_failure",
    consequence: "Ved fortsatt bruk kan vann komme inn i konstruksjonen og gi fukt- og soppskader.",
    measures: ["Våtrommet må bygges om med nytt vanntett sjikt, sluk og overflater."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: GENERAL,
    key: "not_built_as_wet_room",
    question: "Brukes rommet som våtrom uten å være bygget som våtrom?",
    kind: "tg3",
    deviation:
      "Rommet har dusj eller annen vannbruk, men mangler vanntett sjikt og sluk som hører til et våtrom.",
    cause: "Rommet er bygget for tørr bruk og tåler ikke vannet det utsettes for.",
    criterion: "significant_deviation",
    consequence:
      "Vann kan trenge inn i gulv og vegger og gi råte, muggsopp og skader i rom ved siden av.",
    measures: ["Vannbruken må stanses, eller rommet må bygges om til et fullverdig våtrom."],
    source: SOURCE_WET_ROOM,
  },
  // Dokumentasjon (bare TG2)
  {
    checkpoint: DOCUMENTATION,
    key: "missing_membrane_documentation",
    question: "Mangler det dokumentasjon på det vanntette sjiktet?",
    kind: "tg2",
    deviation: "Eier har ikke kunnet vise papirer på hvordan det vanntette sjiktet ble lagt.",
    cause: "Uten dokumentasjon kan utførelsen av sjiktet ikke kontrolleres.",
    criterion: "missing_documentation",
    consequence: "Feil i sjiktet kan være skjult og først vise seg som lekkasje eller fuktskade.",
    measures: [
      "Eier bør skaffe dokumentasjon fra den som utførte arbeidet, hvis den finnes.",
      "Uten dokumentasjon bør sluk, fuger og overganger ses etter jevnlig.",
    ],
    source: SOURCE_DOCUMENTATION,
  },
  {
    checkpoint: DOCUMENTATION,
    key: "incomplete_documentation",
    question: "Er dokumentasjonen for våtrommet mangelfull?",
    kind: "tg2",
    deviation:
      "Dokumentasjonen som er lagt fram, viser ikke hvilket tettesystem som er brukt eller hvem som utførte arbeidet.",
    cause: "Dokumentasjonen er for mangelfull til å vise at rommet er bygget fagmessig.",
    criterion: "missing_documentation",
    consequence: "Det er usikkert om det vanntette sjiktet tåler vannbelastningen over tid.",
    measures: ["Eier bør skaffe utfyllende dokumentasjon fra firmaet som utførte arbeidet."],
    source: SOURCE_DOCUMENTATION,
  },
  // Vegger og himling
  {
    checkpoint: WALLS_CEILING,
    key: "moisture_marks",
    question: "Er det fuktmerker eller misfarging på vegger eller himling?",
    kind: "tg2",
    deviation: "Det er fuktmerker eller misfarging på vegg eller himling i våtrommet.",
    cause: "Merkene er tegn på at fukt har virket på overflaten over tid.",
    criterion: "symptom_of_damage",
    consequence: "Vedvarende fukt kan bryte ned overflaten og gi grobunn for muggsopp.",
    measures: ["Årsaken til fukten bør finnes og utbedres før overflaten repareres."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: WALLS_CEILING,
    key: "cracked_tiles_or_joints",
    question: "Er det sprukne fliser, bom eller riss i fuger på veggene?",
    kind: "tg2",
    deviation:
      "Det er sprukne fliser, hulrom bak fliser eller riss i fuger på veggene i våtrommet.",
    cause: "Sprekker og riss gjør at overflaten ikke lenger holder vannet borte fra sjiktet bak.",
    criterion: "significant_deviation",
    consequence:
      "Vann kan komme inn bak flisene og belaste det vanntette sjiktet mer enn beregnet.",
    measures: ["Skadde fliser og fuger bør skiftes eller tettes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: WALLS_CEILING,
    key: "mould_or_rot",
    question: "Er det muggsopp, råte eller påvist fuktskade i vegger eller himling?",
    kind: "tg3",
    deviation: "Det er påvist muggsopp, råte eller fuktskade i vegg eller himling i våtrommet.",
    cause: "Skaden viser at fukt har virket på materialene over tid.",
    criterion: "symptom_of_damage",
    consequence: "Skaden øker så lenge fukten får virke, og kan gi dårlig inneluft.",
    measures: [
      "Omfanget av skaden må kartlegges, og skadde materialer må skiftes.",
      "Årsaken til fukten må utbedres før rommet brukes som før.",
    ],
    source: SOURCE_WET_ROOM,
  },
  // Gulv
  {
    checkpoint: FLOOR,
    key: "insufficient_fall",
    question: "Er fallet mot sluk for lite, eller er det motfall?",
    kind: "choose_tg2_tg3",
    deviation: "Fallet mot sluk er målt til {måleverdi} mm per meter.",
    cause: "Fallet er mindre enn det som trengs for at vann på gulvet renner sikkert til sluket.",
    criterion: "significant_deviation",
    consequence: "Vann kan bli stående på gulvet eller renne mot terskel og vegger.",
    measures: [
      "Ved motfall eller stående vann må gulvet rettes, og det vanntette sjiktet må fornyes samtidig.",
      "Ved svakt fall må vannet holdes borte fra terskel og vegger, og fallet må rettes ved neste oppussing.",
    ],
    source: SOURCE_FALL,
  },
  {
    checkpoint: FLOOR,
    key: "cracked_tiles_or_joints",
    question: "Er det sprukne fliser eller riss i fuger på gulvet?",
    kind: "tg2",
    deviation: "Det er sprukne fliser eller riss i fuger på gulvet i våtrommet.",
    cause: "Sprekker i gulvet gir vannet en vei ned mot det vanntette sjiktet.",
    criterion: "significant_deviation",
    consequence: "Gjentatt vannbelastning kan over tid gi lekkasje til konstruksjonen under.",
    measures: ["Skadde fliser og fuger bør skiftes, og årsaken til sprekkene bør undersøkes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: FLOOR,
    key: "vinyl_damage",
    question: "Er vinylbelegget på gulvet skadet eller løst i skjøter?",
    kind: "choose_tg2_tg3",
    deviation: "Vinylbelegget på gulvet har hull, rifter eller skjøter som har løsnet.",
    cause: "Belegget er selve det vanntette sjiktet, og skaden svekker tettheten.",
    criterion: "significant_deviation",
    consequence: "Vann kan komme gjennom belegget og ned i gulvkonstruksjonen.",
    measures: ["Skadet belegg må repareres av fagperson eller skiftes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: FLOOR,
    key: "moisture_damage",
    question: "Er det omfattende fuktskade, svelling eller råte i gulvet?",
    kind: "tg3",
    deviation: "Gulvet i våtrommet har omfattende fuktskade, svelling eller råte.",
    cause: "Skaden viser at vann har kommet gjennom gulvet.",
    criterion: "symptom_of_damage",
    consequence:
      "Gulvkonstruksjonen kan svekkes, og skaden kan spre seg til rom under eller ved siden av.",
    measures: ["Gulvet må åpnes, skadde materialer skiftes og nytt vanntett sjikt legges."],
    source: SOURCE_WET_ROOM,
  },
  // Vanntett sjikt, membran og sluk
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "membrane_before_2000",
    question: "Er det vanntette sjiktet fra før år 2000?",
    kind: "tg3",
    deviation: "Det vanntette sjiktet i våtrommet er registrert som fra {årstall}.",
    cause: "Sjiktet er fra før år 2000, og funksjonen kan ikke lenger regnes som sikker.",
    criterion: "age_uncertain_function",
    consequence:
      "Et gammelt sjikt kan slippe gjennom vann uten synlige tegn, og skader kan oppstå i skjulte deler.",
    measures: ["Det må påregnes at våtrommet må fornyes med nytt vanntett sjikt og nytt sluk."],
    source: SOURCE_AGE,
  },
  {
    // Foreslås av regelen `wet_room.membrane_past_lifespan` (2a-2, A230). Sier at funksjonen er
    // usikker på grunn av alder, ikke at sjiktet er ødelagt. Tiltaket er undersøkelse og oppfølging.
    checkpoint: MEMBRANE_DRAIN,
    key: "membrane_past_lifespan",
    question: "Er det vanntette sjiktet så gammelt at funksjonen er usikker?",
    kind: "tg2",
    deviation: "Det vanntette sjiktet i våtrommet er registrert som fra {årstall}.",
    cause: "Funksjonen til sjiktet er usikker på grunn av alder, selv uten synlige skader.",
    criterion: "age_uncertain_function",
    consequence:
      "Svakheter i et eldre sjikt synes ofte ikke fra rommet, og vann kan over tid nå konstruksjonen bak.",
    measures: [
      "Sjiktet bør undersøkes nærmere, særlig ved sluk, rørgjennomføringer og overgangen mellom gulv og vegg.",
      "Våtrommet bør følges opp jevnlig med tanke på tegn til fukt.",
    ],
    source: SOURCE_RULE_AGE,
  },
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "leak_at_penetration",
    question: "Er det utetthet ved rørgjennomføringer i det vanntette sjiktet?",
    kind: "tg3",
    deviation: "Det er utetthet rundt rør som går gjennom det vanntette sjiktet.",
    cause: "Gjennomføringen er ikke tettet mot sjiktet.",
    criterion: "functional_failure",
    consequence: "Vann kan renne langs røret og inn i vegg eller gulv.",
    measures: ["Gjennomføringen må tettes med en mansjett som passer til tettesystemet."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "membrane_drain_connection",
    question: "Mangler tetting mellom det vanntette sjiktet og sluket?",
    kind: "tg3",
    deviation: "Det vanntette sjiktet er ikke tettet mot sluket.",
    cause:
      "Overgangen mellom sjikt og sluk er det mest utsatte stedet i rommet, og her mangler tetting.",
    criterion: "functional_failure",
    consequence: "Vann som renner mot sluket, kan gå ned i gulvet i stedet for i avløpet.",
    measures: ["Sluket må tettes mot sjiktet, eller sluk og sjikt må fornyes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "drain_without_clamping_ring",
    question: "Er sluket av eldre type uten klemring?",
    kind: "tg2",
    deviation: "Sluket er av eldre type uten klemring for det vanntette sjiktet.",
    cause: "Uten klemring er overgangen mellom sjikt og sluk mindre sikker.",
    criterion: "significant_deviation",
    consequence: "Overgangen kan slippe gjennom vann når sjiktet eldes eller beveger seg.",
    measures: ["Sluket bør skiftes neste gang våtrommet pusses opp."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "drain_not_accessible",
    question: "Er sluket utilgjengelig for inspeksjon eller rengjøring?",
    kind: "choose_tg2_tg3",
    deviation: "Sluket kan ikke åpnes for ettersyn eller rengjøring.",
    cause: "Tettingen i sluket kan ikke kontrolleres, og sluket kan ikke holdes rent.",
    criterion: "significant_deviation",
    consequence: "Et tett eller utett sluk kan gi vann på gulvet og lekkasje uten at det oppdages.",
    measures: ["Sluket må gjøres tilgjengelig for ettersyn og rengjøring."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: MEMBRANE_DRAIN,
    key: "low_threshold_height",
    question: "Er høyden fra sluket opp til membranen ved terskelen for lav?",
    kind: "choose_tg2_tg3",
    deviation: "Høyden fra slukristen opp til membranen ved terskelen er målt til {måleverdi} mm.",
    cause: "Høyden er for lav til å holde vannet inne i rommet hvis sluket går tett.",
    criterion: "significant_deviation",
    consequence: "Vann kan renne over terskelen og inn i rommet utenfor.",
    measures: ["Gulvet eller terskelen må endres slik at vannet holdes inne i våtrommet."],
    source: SOURCE_FALL,
  },
  // Sanitærutstyr og innredning
  {
    checkpoint: FIXTURES,
    key: "leak_or_failure",
    question: "Er det lekkasje eller funksjonssvikt på sanitærutstyr eller synlige rør?",
    kind: "tg3",
    deviation:
      "Det er lekkasje eller funksjonssvikt på sanitærutstyr eller synlige rør i våtrommet.",
    cause: "Utstyret holder ikke tett eller virker ikke som det skal.",
    criterion: "functional_failure",
    consequence: "Lekkasjen kan gi vannskade på gulv, vegger og innredning.",
    measures: ["Feilen må utbedres av rørlegger, og det må kontrolleres om vann har gitt skade."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: FIXTURES,
    key: "cracked_sanitary_ware",
    question: "Er det sprekker eller avskalling på servant, toalett eller badekar?",
    kind: "choose_tg2_tg3",
    deviation: "Det er sprekker eller avskalling på sanitærutstyr i våtrommet.",
    cause: "Sprekker svekker utstyret og kan utvikle seg til lekkasje.",
    criterion: "significant_deviation",
    consequence: "Utstyret kan begynne å lekke eller knekke ved belastning.",
    measures: ["Utstyr med sprekker må skiftes. Riss og avskalling må holdes under oppsyn."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: FIXTURES,
    key: "damaged_furniture",
    question: "Er innredningen skadet eller svellet av fukt?",
    kind: "tg2",
    deviation: "Innredningen i våtrommet er skadet eller svellet av fukt.",
    cause: "Svelling viser at innredningen har fått vann over tid.",
    criterion: "symptom_of_damage",
    consequence: "Skaden øker, og fukt kan nå vegg og gulv bak innredningen.",
    measures: ["Årsaken til fukten bør finnes, og skadet innredning bør skiftes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: FIXTURES,
    key: "signs_of_overheating",
    question: "Er det merker etter varme ved stikkontakt, lysarmatur eller andre el-punkter?",
    kind: "hms",
    deviation: "Det er merker etter varmgang ved el-punkt i våtrommet.",
    cause: null,
    // HMS gir ikke TG, så utfallet har ikke noe TG-kriterium (A204)
    criterion: null,
    consequence: "Varmgang kan føre til brann eller strømgjennomgang.",
    measures: ["Punktet må kontrolleres av registrert elektroinstallatør før det brukes videre."],
    source: SOURCE_HMS,
  },
  // Ventilasjon
  {
    checkpoint: VENTILATION,
    key: "missing_ventilation",
    question: "Mangler våtrommet ventilasjon, eller er den klart for svak?",
    kind: "tg3",
    deviation: "Våtrommet har ikke ventilasjon, eller avtrekket fjerner ikke fuktig luft.",
    cause: "Fuktig luft blir værende i rommet etter dusjing.",
    criterion: "functional_failure",
    consequence: "Kondens på kalde flater gir grobunn for muggsopp og fuktskader.",
    measures: ["Det må lages avtrekk som fjerner fuktig luft fra rommet."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: VENTILATION,
    key: "weak_extract",
    question: "Trekker avtrekket svakt ved test?",
    kind: "tg2",
    deviation: "Avtrekket i våtrommet trekker svakt ved test.",
    cause: "Avtrekket fjerner ikke nok fuktig luft.",
    criterion: "significant_deviation",
    consequence: "Fukten blir lenger i rommet og øker faren for kondens og muggsopp.",
    measures: ["Ventil og kanal bør rengjøres, og avtrekket bør justeres eller forsterkes."],
    source: SOURCE_WET_ROOM,
  },
  {
    checkpoint: VENTILATION,
    key: "poor_air_supply",
    question: "Mangler det tilførsel av luft til våtrommet?",
    kind: "tg2",
    deviation:
      "Det er ingen åpning for tilluft til våtrommet, som spalte under døren eller ventil.",
    cause: "Uten tilluft fjerner avtrekket lite fuktig luft.",
    criterion: "significant_deviation",
    consequence: "Fukten blir lenger i rommet og belaster overflatene.",
    measures: ["Det bør lages en åpning for tilluft, for eksempel spalte under døren."],
    source: SOURCE_WET_ROOM,
  },
  // Tilliggende konstruksjoner (A207: takstmannen velger TG2 eller TG3)
  {
    checkpoint: ADJACENT,
    key: "elevated_moisture",
    question: "Er det målt forhøyet fukt ved hulltaking?",
    kind: "choose_tg2_tg3",
    deviation:
      "Ved hulltaking i konstruksjonen ved siden av våtrommet er fukten målt til {måleverdi} {enhet}.",
    cause: "Fuktverdien er høyere enn det som er normalt for konstruksjonen.",
    criterion: "symptom_of_damage",
    consequence: "Fukt i konstruksjonen kan gi råte og muggsopp som ikke vises fra rommet.",
    measures: [
      "Fuktkilden må finnes, og flere målinger må vise om fukten har gitt skade og hvor langt den går.",
    ],
    source: SOURCE_HOLE,
  },
];

const deviationQuestions: DeviationQuestionDoc[] = questionSpecs.map((q, index) => ({
  checkpoint_key: q.checkpoint,
  key: `${q.checkpoint}.${q.key}`,
  text: q.question,
  sort_order: index,
}));

const outcomes: OutcomeDoc[] = questionSpecs.map((q) => ({
  checkpoint_key: q.checkpoint,
  question_key: `${q.checkpoint}.${q.key}`,
  key: outcomeKey(q.kind),
  kind: q.kind,
  deviation_text: q.deviation,
  default_cause_text: q.cause,
  default_cause_criterion: q.criterion,
  default_consequence_text: q.consequence,
  source_ref: q.source,
  text_status: "draft",
  sort_order: 0,
}));

const standardMeasures: StandardMeasureDoc[] = questionSpecs.flatMap((q) =>
  q.measures.map((text, index) => ({
    checkpoint_key: q.checkpoint,
    question_key: `${q.checkpoint}.${q.key}`,
    outcome_key: outcomeKey(q.kind),
    text,
    text_status: "draft" as const,
    sort_order: index,
  })),
);

// --- Reglene (TG-forslag som takstmannen godtar, endrer eller avviser) ---------------------------
//
// Reglene er data og kjøres av regelmotoren i `src/core/rules`, likt på iPaden og på serveren.
// Ingen regel kaller KI. Alderstabellen og fuktgrensen sendes inn til motoren fra
// `src/core/rules/data` og er utkast, ikke godkjent av fagrådet.
//
// Svar 59a (Ståle 10.11.2026) og F1 (Ståle 12.11.2026, A238): ingen regel på tilliggende
// konstruksjoner leser alder. Er hullet tatt uten funn og målt under fuktgrensen, foreslår
// `hole_no_elevated_moisture` TG0 på `wet_room.adjacent`, uansett alder. Det er et bevisst unntak
// fra vilkåret om 0–5 år for TG0 (docs/kartlegging/regelverk-krav.md, endringstabellen), så en
// senere kontroll «TG0 bare ved 0–5 år» skal ikke advare på `wet_room.adjacent`. Er hullet tatt
// med funn, gir den ikke forslag: da vurderer takstmannen selv. TG0-regelen og
// `hole_moisture_over_limit` leser samme terskel; TG0-regelen snur den (`negate`, A237), så nøyaktig
// én av dem slår til når målingen er gyldig. Terskelhøyden (`wet_room.threshold_height_mm`) leses
// ikke av noen regel (A229).

const RULE_PAST_LIFESPAN = "wet_room.membrane_past_lifespan";
const RULE_BEFORE_2000 = "wet_room.membrane_before_2000";
const RULE_HOLE_MOISTURE = "wet_room.hole_moisture_over_limit";
const RULE_HOLE_NOT_DONE = "wet_room.hole_drilling_not_done";
const RULE_HOLE_NO_MOISTURE = "wet_room.hole_no_elevated_moisture";

/** Fast kode for fuktgrensen i `src/core/rules/data/thresholds.ts`. */
const THRESHOLD_HOLE_MOISTURE = "wet_room_hole_moisture_weight_percent";

/** Dokumentasjonsvalgene som gir trinnene «uten dokumentasjon» (A227). Tomt felt gir også «uten». */
const WITHOUT_DOCUMENTATION = ["none", "other_written"];

const OUTCOME_PAST_LIFESPAN = {
  checkpoint_key: MEMBRANE_DRAIN,
  question_key: `${MEMBRANE_DRAIN}.membrane_past_lifespan`,
  outcome_key: "tg2",
};
const OUTCOME_BEFORE_2000 = {
  checkpoint_key: MEMBRANE_DRAIN,
  question_key: `${MEMBRANE_DRAIN}.membrane_before_2000`,
  outcome_key: "tg3",
};
const OUTCOME_ELEVATED_MOISTURE = {
  checkpoint_key: ADJACENT,
  question_key: `${ADJACENT}.elevated_moisture`,
  outcome_key: "choose",
};

// Kildene for alderstabellen og fuktgrensen står i regeldataene (F3), så tallene og kilden følges.
const SOURCE_RULE_HOLE = "NS 3600:2025 og forskriften § 2-2; Ståle 25.10.2026 og 12.11.2026 (F2)";
const SOURCE_RULE_NO_MOISTURE =
  "Ståles beslutning 12.11.2026 (F1); utkast, ikke godkjent av fagrådet";

function rule(
  key: string,
  name: string,
  purpose: RuleDoc["purpose"],
  checkpointKey: string,
  suggestedOutcome: RuleDoc["suggested_outcome"],
  message: string,
  sourceRef: string,
  sortOrder: number,
): RuleDoc {
  return {
    key,
    name,
    purpose,
    match: "all",
    target_element_key: null,
    target_section_key: null,
    target_checkpoint_key: checkpointKey,
    target_question: null,
    suggested_outcome: suggestedOutcome,
    validation_code: null,
    severity: null,
    message,
    source_ref: sourceRef,
    active: true,
    sort_order: sortOrder,
  };
}

const rules: RuleDoc[] = [
  rule(
    RULE_PAST_LIFESPAN,
    "Vanntett sjikt har nådd alderen i tabellen",
    "suggest_outcome",
    MEMBRANE_DRAIN,
    OUTCOME_PAST_LIFESPAN,
    "Det vanntette sjiktet har nådd alderen i alderstabellen for denne typen sjikt. Forslaget er TG2 fordi funksjonen er usikker på grunn av alder.",
    SOURCE_RULE_AGE,
    0,
  ),
  rule(
    RULE_BEFORE_2000,
    "Vanntett sjikt fra før 2000",
    "suggest_outcome",
    MEMBRANE_DRAIN,
    OUTCOME_BEFORE_2000,
    "Sjiktet er fra før 2000. Forslaget er TG3.",
    SOURCE_RULE_AGE,
    1,
  ),
  rule(
    RULE_HOLE_MOISTURE,
    "Forhøyet fukt ved hulltaking",
    "suggest_outcome",
    ADJACENT,
    OUTCOME_ELEVATED_MOISTURE,
    "Fuktmålingen i hullet er lik eller over grensen for treverk, så forslaget er avviket forhøyet fukt. Grensen gjelder bare treverk, så måling i andre materialer vurderer du selv.",
    SOURCE_RULE_MOISTURE,
    2,
  ),
  rule(
    RULE_HOLE_NOT_DONE,
    "Hulltaking ikke utført",
    "suggest_tgiu",
    ADJACENT,
    null,
    "Hulltaking er ikke utført, så tilliggende konstruksjoner er ikke undersøkt, og forslaget er TGIU uansett grunn. Fyll ut begrunnelse og risikovurdering.",
    SOURCE_RULE_HOLE,
    3,
  ),
  rule(
    RULE_HOLE_NO_MOISTURE,
    "Hull uten funn og fukt under grensen",
    "suggest_tg0",
    ADJACENT,
    null,
    "Hullet er tatt uten funn, og fukten er målt under grensen for treverk, så forslaget er TG0 uansett alder. Forslaget forutsetter måling i treverk; måling i andre materialer vurderer du selv.",
    SOURCE_RULE_NO_MOISTURE,
    4,
  ),
];

/** Standardverdiene for en betingelse; bare det som trengs settes i hver betingelse. */
function condition(
  ruleKey: string,
  type: RuleConditionDoc["type"],
  sortOrder: number,
  extra: Partial<RuleConditionDoc>,
): RuleConditionDoc {
  return {
    rule_key: ruleKey,
    group_no: null,
    type,
    element_key: null,
    checkpoint_key: null,
    operator: null,
    value: null,
    threshold_key: null,
    age_year_element_key: null,
    age_fallback_year_element_key: null,
    age_source_element_key: null,
    documentation_element_key: null,
    material_element_key: null,
    unit_element_key: null,
    negate: false,
    sort_order: sortOrder,
    ...extra,
  };
}

/** Alder mot alderstabellen: sjiktets årstall, ellers byggeåret for våtrommet. */
const AGE_CONDITION: Partial<RuleConditionDoc> = {
  age_year_element_key: "wet_room.membrane_year",
  age_fallback_year_element_key: "wet_room.build_year",
  age_source_element_key: "wet_room.build_year_source",
  documentation_element_key: "wet_room.documentation_type",
  material_element_key: "wet_room.membrane_type",
  value: WITHOUT_DOCUMENTATION,
};

const ruleConditions: RuleConditionDoc[] = [
  condition(RULE_PAST_LIFESPAN, "age_vs_lifespan", 0, AGE_CONDITION),
  condition(RULE_BEFORE_2000, "age_vs_lifespan", 0, AGE_CONDITION),
  // Gjelder også «utført uten funn» (59a): måling lik eller over grensen gir forslag
  condition(RULE_HOLE_MOISTURE, "option_selected", 0, {
    element_key: "wet_room.hole_drilling",
    operator: "in",
    value: ["done_no_findings", "done_with_findings"],
  }),
  condition(RULE_HOLE_MOISTURE, "number_vs_limit", 1, {
    element_key: "wet_room.hole_moisture_reading",
    threshold_key: THRESHOLD_HOLE_MOISTURE,
    unit_element_key: "wet_room.hole_moisture_unit",
  }),
  // Uansett grunn, også når ingen grunn er valgt
  condition(RULE_HOLE_NOT_DONE, "option_selected", 0, {
    element_key: "wet_room.hole_drilling",
    operator: "eq",
    value: "not_done",
  }),
  // Bare «utført uten funn» (A238): med funn vurderer takstmannen selv
  condition(RULE_HOLE_NO_MOISTURE, "option_selected", 0, {
    element_key: "wet_room.hole_drilling",
    operator: "eq",
    value: "done_no_findings",
  }),
  // Under grensen: samme terskel som `hole_moisture_over_limit`, snudd (A237)
  condition(RULE_HOLE_NO_MOISTURE, "number_vs_limit", 1, {
    element_key: "wet_room.hole_moisture_reading",
    threshold_key: THRESHOLD_HOLE_MOISTURE,
    unit_element_key: "wet_room.hole_moisture_unit",
    negate: true,
  }),
];

// --- Testsakene (oppdiktede svar, befaringsår 2026) ----------------------------------------------
//
// Navnet starter med nummeret i testplanen (docs/funksjoner/fase2a-regler-bad-testplan.md, avsnitt
// 4), og kantverdier har «kant» i navnet; hver regel har minst én kantsak (F4, F5: lik grensen gir
// forslag, én under gir ikke). Fuktsakene bruker 15 og 14.9; testene sjekker at 15 er grensen i
// `thresholds.ts`. Der flere regler prøves med samme svar (B2, B3, 59a), har hver regel sin egen
// testsak.

const INSPECTION_YEAR = 2026;

type Answers = RuleTestCaseDoc["input"];

const testCaseCount = new Map<string, number>();
function testCase(
  ruleKey: string,
  name: string,
  input: Answers,
  expectedState: RuleTestCaseDoc["expected_state"],
  expectedOutcome: RuleTestCaseDoc["expected_outcome"] = null,
): RuleTestCaseDoc {
  const sortOrder = testCaseCount.get(ruleKey) ?? 0;
  testCaseCount.set(ruleKey, sortOrder + 1);
  return {
    rule_key: ruleKey,
    name,
    input,
    expected_state: expectedState,
    inspection_year: INSPECTION_YEAR,
    expected_outcome: expectedOutcome,
    sort_order: sortOrder,
  };
}

/** Sjiktet: type, dokumentasjon og årstall. */
function membrane(type: string | null, documentation: string | null, year: number | null): Answers {
  return {
    "wet_room.membrane_type": type,
    "wet_room.documentation_type": documentation,
    "wet_room.membrane_year": year,
  };
}

/** Hulltaking med måling. */
function hole(
  drilling: string | null,
  reading: number | string | null,
  unit: string | null,
): Answers {
  return {
    "wet_room.hole_drilling": drilling,
    "wet_room.hole_moisture_reading": reading,
    "wet_room.hole_moisture_unit": unit,
  };
}

/** Svar 59a: bad fra 1985, sjiktets årstall tomt, hull tatt og fukt under grensen. */
function case59a(drilling: "done_no_findings" | "done_with_findings"): Answers {
  return {
    "wet_room.build_year": 1985,
    ...membrane(null, null, null),
    ...hole(drilling, 14.9, "weight_percent"),
  };
}

const ruleTestCases: RuleTestCaseDoc[] = [
  // A: alder mot alderstabellen (TG2)
  testCase(
    RULE_PAST_LIFESPAN,
    "A1 folie uten dokumentasjon 17 år (kant)",
    membrane("foil", "none", 2009),
    "not_triggered",
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A2 folie uten dokumentasjon 18 år (kant)",
    membrane("foil", "none", 2008),
    "triggered",
    OUTCOME_PAST_LIFESPAN,
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A3 folie med samsvarserklæring 18 år",
    membrane("foil", "declaration_of_conformity", 2008),
    "not_triggered",
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A4 folie med tom dokumentasjon 18 år gir trinnet uten",
    membrane("foil", null, 2008),
    "triggered",
    OUTCOME_PAST_LIFESPAN,
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A5 folie med annen skriftlig dokumentasjon 18 år gir trinnet uten",
    membrane("foil", "other_written", 2008),
    "triggered",
    OUTCOME_PAST_LIFESPAN,
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A6 ukjent type fra 2005 er ikke vurdert",
    membrane("unknown", "none", 2005),
    "not_evaluated",
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A7 årstall etter befaringsåret er ikke vurdert",
    membrane("foil", "none", 2027),
    "not_evaluated",
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A8 uten sjiktets årstall brukes byggeåret 2008 opplyst av eier",
    {
      ...membrane("foil", "none", null),
      "wet_room.build_year": 2008,
      "wet_room.build_year_source": "owner_stated",
    },
    "triggered",
    OUTCOME_PAST_LIFESPAN,
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "A9 uten sjiktets årstall og byggeår er ikke vurdert",
    { ...membrane("foil", "none", null), "wet_room.build_year": null },
    "not_evaluated",
  ),
  // B: sjikt fra før 2000 (TG3)
  testCase(
    RULE_BEFORE_2000,
    "B1 folie fra 1999 (kant)",
    membrane("foil", "none", 1999),
    "triggered",
    OUTCOME_BEFORE_2000,
  ),
  testCase(
    RULE_BEFORE_2000,
    "B2 folie uten dokumentasjon fra 2000 gir ikke TG3 (kant)",
    membrane("foil", "none", 2000),
    "not_triggered",
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "B2 folie uten dokumentasjon fra 2000 gir TG2 for alder",
    membrane("foil", "none", 2000),
    "triggered",
    OUTCOME_PAST_LIFESPAN,
  ),
  testCase(
    RULE_BEFORE_2000,
    "B3 folie fra 1990 gir TG3",
    membrane("foil", "none", 1990),
    "triggered",
    OUTCOME_BEFORE_2000,
  ),
  testCase(
    RULE_PAST_LIFESPAN,
    "B3 folie fra 1990 gir ikke TG2 i tillegg",
    membrane("foil", "none", 1990),
    "not_triggered",
  ),
  testCase(
    RULE_BEFORE_2000,
    "B4 ukjent type fra 1990",
    membrane("unknown", "none", 1990),
    "triggered",
    OUTCOME_BEFORE_2000,
  ),
  testCase(
    RULE_BEFORE_2000,
    "B4 tom type fra 1990",
    membrane(null, "none", 1990),
    "triggered",
    OUTCOME_BEFORE_2000,
  ),
  testCase(
    RULE_BEFORE_2000,
    "B5 bad fra 1990 med sjikt fra 2015",
    { ...membrane("foil", "none", 2015), "wet_room.build_year": 1990 },
    "not_triggered",
  ),
  testCase(
    RULE_BEFORE_2000,
    "B6 anslått byggeår 1995 uten sjiktets årstall",
    {
      ...membrane("foil", "none", null),
      "wet_room.build_year": 1995,
      "wet_room.build_year_source": "estimated",
    },
    "triggered",
    OUTCOME_BEFORE_2000,
  ),
  testCase(
    RULE_BEFORE_2000,
    "B7 uten sjiktets årstall og byggeår er ikke vurdert",
    { ...membrane("foil", "none", null), "wet_room.build_year": null },
    "not_evaluated",
  ),
  // F: forhøyet fukt ved hulltaking (vekt-% i treverk)
  testCase(
    RULE_HOLE_MOISTURE,
    "F1 utført med funn 14.9 vekt-% under grensen (kant)",
    hole("done_with_findings", 14.9, "weight_percent"),
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F2 utført med funn 15 vekt-% lik grensen (kant)",
    hole("done_with_findings", 15, "weight_percent"),
    "triggered",
    OUTCOME_ELEVATED_MOISTURE,
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F3 utført uten funn 15 vekt-% lik grensen (kant)",
    hole("done_no_findings", 15, "weight_percent"),
    "triggered",
    OUTCOME_ELEVATED_MOISTURE,
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F4 måling i RF % er ikke vurdert",
    hole("done_with_findings", 85, "relative_humidity"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F5 tom måleverdi er ikke vurdert",
    hole("done_with_findings", null, "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F5 tom enhet er ikke vurdert",
    hole("done_with_findings", 15, null),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F5 negativ måleverdi er ikke vurdert",
    hole("done_with_findings", -1, "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F5 måleverdi som tekst er ikke vurdert",
    hole("done_with_findings", "abc", "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F6 ikke utført med tom måling",
    hole("not_done", null, null),
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F7 tom hulltaking er ikke vurdert",
    hole(null, 15, "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_MOISTURE,
    "F8 utført uten funn 14.9 vekt-% under grensen (kant)",
    hole("done_no_findings", 14.9, "weight_percent"),
    "not_triggered",
  ),
  // H: hulltaking ikke utført gir TGIU, uansett grunn
  ...(["owner_refused", "no_access", "concrete_or_masonry", "other"] as const).map((reason) =>
    testCase(
      RULE_HOLE_NOT_DONE,
      `H1 ikke utført med grunnen ${reason}`,
      { "wet_room.hole_drilling": "not_done", "wet_room.hole_drilling_reason": reason },
      "triggered",
    ),
  ),
  testCase(
    RULE_HOLE_NOT_DONE,
    "H1 ikke utført uten valgt grunn (kant)",
    { "wet_room.hole_drilling": "not_done", "wet_room.hole_drilling_reason": null },
    "triggered",
  ),
  testCase(
    RULE_HOLE_NOT_DONE,
    "H2 utført uten funn",
    { "wet_room.hole_drilling": "done_no_findings" },
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_NOT_DONE,
    "H3 tom hulltaking er ikke vurdert",
    { "wet_room.hole_drilling": null },
    "not_evaluated",
  ),
  // T: hull uten funn og fukt under grensen gir TG0 på tilliggende (F1, A238)
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T1 utført uten funn 14.9 vekt-% under grensen gir TG0 (kant)",
    hole("done_no_findings", 14.9, "weight_percent"),
    "triggered",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T2 utført uten funn 15 vekt-% lik grensen gir ikke TG0 (kant)",
    hole("done_no_findings", 15, "weight_percent"),
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T3 utført med funn 14.9 vekt-% gir ikke TG0",
    hole("done_with_findings", 14.9, "weight_percent"),
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T4 utført uten funn 0 vekt-% gir TG0",
    hole("done_no_findings", 0, "weight_percent"),
    "triggered",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T5 måling i RF % er ikke vurdert",
    hole("done_no_findings", 85, "relative_humidity"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T5 tom måleverdi er ikke vurdert",
    hole("done_no_findings", null, "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T5 tom enhet er ikke vurdert",
    hole("done_no_findings", 14.9, null),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T5 negativ måleverdi er ikke vurdert",
    hole("done_no_findings", -1, "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T5 måleverdi som tekst er ikke vurdert",
    hole("done_no_findings", "abc", "weight_percent"),
    "not_evaluated",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T6 ikke utført gir ikke TG0",
    hole("not_done", null, null),
    "not_triggered",
  ),
  testCase(
    RULE_HOLE_NOT_DONE,
    "T6 ikke utført gir TGIU",
    hole("not_done", null, null),
    "triggered",
  ),
  testCase(
    RULE_HOLE_NO_MOISTURE,
    "T7 tom hulltaking er ikke vurdert",
    hole(null, 14.9, "weight_percent"),
    "not_evaluated",
  ),
  // Svar 59a (T-0003) og F1: bad fra 1985 med hull og fukt under grensen. Uten funn gir TG0 på
  // tilliggende, med funn gir ingen forslag der; sjiktet fra før 2000 gir fortsatt TG3-forslag på
  // membran og sluk. Hvert sitt kontrollpunkt.
  ...(["done_no_findings", "done_with_findings"] as const).flatMap((drilling) => [
    testCase(
      RULE_HOLE_MOISTURE,
      `59a bad fra 1985 ${drilling} 14.9 vekt-% gir ikke forhøyet fukt på tilliggende`,
      case59a(drilling),
      "not_triggered",
    ),
    testCase(
      RULE_HOLE_NO_MOISTURE,
      drilling === "done_no_findings"
        ? `59a bad fra 1985 ${drilling} 14.9 vekt-% gir TG0 på tilliggende`
        : `59a bad fra 1985 ${drilling} 14.9 vekt-% gir ikke TG0 på tilliggende`,
      case59a(drilling),
      drilling === "done_no_findings" ? "triggered" : "not_triggered",
    ),
    testCase(
      RULE_BEFORE_2000,
      `59a bad fra 1985 ${drilling} 14.9 vekt-% gir TG3 på sjiktet`,
      case59a(drilling),
      "triggered",
      OUTCOME_BEFORE_2000,
    ),
  ]),
  // Kant per materiale (F4, F5): alder lik tabellverdien gir TG2, ett år yngre gir ikke. Med
  // dokumentasjon prøves med samsvarserklæring, uten med «ingen». Sjikt som da blir fra før 2000,
  // prøves ikke her: der gjelder trinnet før 2000 (B1–B4).
  ...ageEdgeCases(),
];

/** Kanttestsakene for alder per materiale og dokumentasjon, lest fra alderstabellen. */
function ageEdgeCases(): RuleTestCaseDoc[] {
  const documentation = { without: "none", with: "declaration_of_conformity" } as const;
  return WET_ROOM_LIFESPANS.entries.flatMap((entry) => {
    if (entry.material_code === null || entry.min_age === null || entry.outcome_kind !== "tg2") {
      return [];
    }
    const levels =
      entry.documentation === "any" ? (["without", "with"] as const) : [entry.documentation];
    const material = entry.material_code;
    const age = entry.min_age;
    return levels.flatMap((level) => {
      const year = INSPECTION_YEAR - age;
      if (year < 2000) return [];
      const docs = documentation[level];
      return [
        testCase(
          RULE_PAST_LIFESPAN,
          `A10 ${material} ${level} ${age} år gir TG2 (kant)`,
          membrane(material, docs, year),
          "triggered",
          OUTCOME_PAST_LIFESPAN,
        ),
        testCase(
          RULE_PAST_LIFESPAN,
          `A10 ${material} ${level} ${age - 1} år gir ikke TG2 (kant)`,
          membrane(material, docs, year + 1),
          "not_triggered",
        ),
      ];
    });
  });
}

/** Badet (ett våtrom) i systemmalen for tilstandsrapport. Tekstene er utkast. */
export const wetRoomTemplate: TemplateDocument = {
  sections: [
    {
      key: SECTION,
      parent_key: null,
      title: "Våtrom",
      repeat: "per_room",
      room_type_groups: ["wet_room"],
      optional: false,
      standard_text: null,
      help_text: null,
      sort_order: 0,
    },
  ],
  elements,
  element_options: elementOptions,
  checkpoints,
  deviation_questions: deviationQuestions,
  outcomes,
  standard_measures: standardMeasures,
  rules,
  rule_conditions: ruleConditions,
  rule_test_cases: ruleTestCases,
};
