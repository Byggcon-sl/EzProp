import type {
  CheckpointDoc,
  DeviationQuestionDoc,
  OutcomeDoc,
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
 * - Ingen regler ennå (neste punkt i 2a-2). Hulltakingsmålingene er enkeltfelt nå (A202).
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
    ["from_1997_to_2010", "1997–2010"],
    ["tek10", "TEK10"],
    ["tek17", "TEK17"],
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
  rules: [],
  rule_conditions: [],
  rule_test_cases: [],
};
