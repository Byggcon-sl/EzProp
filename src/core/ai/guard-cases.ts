import type { AiFeatureCode, AiGuardAnswerPart, AiGuardCode, AiGuardSentPart } from "./types";

/*
 * Testsakene for vaktene på svaret, som data (docs/funksjoner/fase2a-ki-i-veien-testplan.md K1.2–
 * K1.6c og K2.1). Brukes av `guards.test.ts` og av evalueringen, så en snudd forventning gjør
 * begge røde. Ren data: ingen database, ingen leverandør.
 *
 * Alle tekster er oppdiktet og egne formuleringer (regel 7). Plassholderne er de faste fra vasken.
 */

export type GuardCase = {
  /** Kort beskrivelse, med testplannummeret først. */
  name: string;
  feature: AiFeatureCode;
  sent: AiGuardSentPart[];
  answer: AiGuardAnswerPart[];
  /** Vakten som skal slå til, eller `null` når svaret kan vises. */
  expected: AiGuardCode | null;
  /** Navnene på de ansatte (bare `override_summary`, navnevakten). */
  personNames?: string[];
};

const polish = (
  name: string,
  sent: string,
  answer: string,
  expected: AiGuardCode | null,
): GuardCase => ({
  name,
  feature: "language_polish",
  sent: [{ label: null, texts: [sent] }],
  answer: [{ label: null, text: answer }],
  expected,
});

const summary = (
  name: string,
  sent: Record<string, string[]>,
  answer: [string | null, string][],
  expected: AiGuardCode | null,
): GuardCase => ({
  name,
  feature: "summary_draft",
  sent: Object.entries(sent).map(([label, texts]) => ({ label, texts })),
  answer: answer.map(([label, text]) => ({ label, text })),
  expected,
});

/** Grunnlaget til `override_summary` slik kjernen sender det: én linje per sperre, punkt og grunn. */
const OVERRIDE_SENT = [
  "Måned: oktober 2026",
  "Rapporter publisert: 18",
  "Rapporter publisert måneden før: 12",
  "- Sperre: Hulltaking mangler svar eller grunn | Punkt: Hulltaking i våtrom | Grunn: Ikke tilgang eller nektet av eier | Rapporter: 7 | Andel: 39 % | Reklamasjon på samme punkt: 2 | Rapporter måneden før: 2 | Andel måneden før: 17 % | Endring i rapporter: opp 5 | Endring i andel: opp 22 prosentpoeng",
  "- Sperre: TG3 uten kostnadsoverslag | Punkt: Membran | Grunn: Beskrevet et annet sted i rapporten | Rapporter: 3 | Andel: 17 % | Reklamasjon på samme punkt: 0 | Rapporter måneden før: 3 | Andel måneden før: 25 % | Endring i rapporter: uendret | Endring i andel: ned 8 prosentpoeng",
];

const override = (
  name: string,
  answer: string,
  expected: AiGuardCode | null,
  personNames: string[] = [],
): GuardCase => ({
  name,
  feature: "override_summary",
  sent: [{ label: null, texts: OVERRIDE_SENT }],
  answer: [{ label: null, text: answer }],
  expected,
  personNames,
});

/** Oppdiktet navn på en ansatt. */
const EMPLOYEE = "Mxqline Testesen";

/** Tre funn som brukes i flere saker. Punktets navn står først, som kjernen sender det. */
const THREE_FINDINGS = {
  F1: ["Membran", "Fuktmåling viste 15 vekt-% ved sluket", "Tettesjiktet har sprekker"],
  F2: ["Sluk", "Klemringen mangler", "Monter ny klemring"],
  F3: ["Ventilasjon", "Avtrekket er svakt", "Rens ventilen"],
};

export const GUARD_CASES: readonly GuardCase[] = [
  // --- override_summary (ADR 0006 tillegg 24.11.2026) ----------------------------------------
  override(
    "OS-V1 svar med bare tall, etiketter og punktnavn fra grunnlaget slipper gjennom",
    "I oktober 2026 ble 18 rapporter publisert. Hulltaking i våtrom ble krysset bort med «Ikke tilgang eller nektet av eier» i 7 rapporter, 39 % av rapportene som ble publisert, opp fra 2 måneden før. 2 av dem fikk reklamasjon på samme punkt.",
    null,
    [EMPLOYEE],
  ),
  override(
    "OS-V2 TG fra etiketten til sperren er lov å gjenta",
    "TG3 uten kostnadsoverslag ble krysset bort i 3 rapporter, som måneden før.",
    null,
  ),
  override(
    "OS-V3 TG som ikke står i grunnlaget stoppes",
    "Hulltaking i våtrom ble krysset bort i 7 rapporter. Badene bør få TG2.",
    "tg_guard",
  ),
  override(
    "OS-V4 tilstandsgrad som ikke står i grunnlaget stoppes",
    "Hulltaking ble krysset bort i 7 rapporter, uten at tilstandsgraden ble satt.",
    "tg_guard",
  ),
  override(
    "OS-V5 avrundet andel er et nytt tall og stoppes",
    "Hulltaking i våtrom ble krysset bort i 7 rapporter, omtrent 40 % av rapportene.",
    "number_guard",
  ),
  override(
    "OS-V6 tall lagt sammen stoppes",
    "Til sammen ble 10 sperrer krysset bort i oktober 2026.",
    "number_guard",
  ),
  override(
    "OS-V7 gjetteord stoppes",
    "Hulltaking i våtrom ble krysset bort i 7 rapporter, sannsynligvis fordi eier nektet.",
    "guess_guard",
  ),
  override(
    "OS-V8 «ser ut til» stoppes",
    "Det ser ut til at hulltaking i våtrom ble krysset bort oftere enn før.",
    "guess_guard",
  ),
  override(
    "OS-V9 hele navnet på en ansatt stoppes",
    `${EMPLOYEE} krysset bort hulltaking i 7 rapporter.`,
    "name_guard",
    [EMPLOYEE],
  ),
  override(
    "OS-V10 ett navneord stoppes, også med små bokstaver",
    "De fleste av de 7 rapportene var skrevet av testesen.",
    "name_guard",
    [EMPLOYEE],
  ),
  override(
    "OS-V11 et navneord som også står i grunnlaget (punktnavnet) er ikke et navn",
    "Membran ble krysset bort i 3 rapporter.",
    null,
    ["Kari Membran"],
  ),
  override(
    "OS-V12 en plassholder i svaret stoppes",
    "Hulltaking i [navn] ble krysset bort i 7 rapporter.",
    "placeholder_guard",
  ),
  override(
    "OS-V13 TG-vakten kommer før tallvakten",
    "Hulltaking ble krysset bort i 99 rapporter med TG2.",
    "tg_guard",
  ),

  // --- K1.2 TG-vakt, language_polish ---------------------------------------------------------
  polish(
    "K1.2 TG som sto i inndata og står uendret, slipper gjennom",
    "membranen er gamel og har TG2 ved sluket",
    "Membranen er gammel og har TG2 ved sluket.",
    null,
  ),
  polish(
    "K1.2 «TG 2» skrevet om til «TG2» er samme TG",
    "Satt til TG 2 etter måling",
    "Satt til TG2 etter måling.",
    null,
  ),
  polish(
    "K1.2 ny TG i svaret",
    "Membranen er sprukket ved sluket",
    "Membranen er sprukket ved sluket, TG3.",
    "tg_guard",
  ),
  polish("K1.2 TG2 inn, TG3 ut", "Avviket gir TG2", "Avviket gir TG3.", "tg_guard"),
  polish(
    "K1.2 «ikke undersøkt» lagt til",
    "Membranen bak badekaret er ikke sett",
    "Membranen bak badekaret er ikke undersøkt.",
    "tg_guard",
  ),
  polish(
    "K1.2 TG fjernet fra svaret",
    "Sluket har TG2 fordi klemringen mangler",
    "Klemringen på sluket mangler.",
    "tg_guard",
  ),
  polish(
    "K1.2 tilstandsgrad lagt til med ord",
    "Det er sprekker i flisene",
    "Det er sprekker i flisene, tilstandsgrad 2.",
    "tg_guard",
  ),

  // --- K1.4 tallvakt ---------------------------------------------------------------------------
  polish("K1.4 nytt årstall", "Badet er pusset opp", "Badet er pusset opp i 2015.", "number_guard"),
  polish(
    "K1.4 ny måleverdi",
    "Fuktmåling ved sluket viste forhøyet verdi",
    "Fuktmåling ved sluket viste 18 vekt-%.",
    "number_guard",
  ),
  polish(
    "K1.4 ny lengde",
    "Fallet mot sluket er for lite",
    "Fallet mot sluket er 3 mm.",
    "number_guard",
  ),
  polish(
    "K1.4 nytt kronebeløp",
    "Utbedring av membranen",
    "Utbedring av membranen koster 40 000 kr.",
    "number_guard",
  ),
  polish(
    "K1.4 tall som sto i inndata slipper gjennom, også «40000» mot «40 000»",
    "Utbedring ca 40000 kr og fall 3 mm",
    "Utbedring ca. 40 000 kr og fall 3 mm.",
    null,
  ),
  polish(
    "K1.4 «15,0» mot «15» stoppes (sifferrekker, feiler lukket)",
    "Fuktmåling viste 15 vekt-%",
    "Fuktmåling viste 15,0 vekt-%.",
    "number_guard",
  ),
  polish(
    "K1.4 TG-vakt og tallvakt samtidig: tg_guard vinner",
    "Sprekker i flisene",
    "Sprekker i flisene, TG2 etter 3 år.",
    "tg_guard",
  ),

  // --- K1.6b plassholdere --------------------------------------------------------------------
  polish(
    "K1.6b samme plassholdere i samme rekkefølge slipper gjennom",
    "[navn] opplyste at [adresse] har hatt lekkasje",
    "[navn] opplyste at [adresse] har hatt en lekkasje.",
    null,
  ),
  polish(
    "K1.6b plassholder fjernet",
    "[navn] opplyste om lekkasje",
    "Det er opplyst om lekkasje.",
    "placeholder_guard",
  ),
  polish(
    "K1.6b plassholder lagt til",
    "Eier opplyste om lekkasje",
    "[navn] opplyste om lekkasje.",
    "placeholder_guard",
  ),
  polish(
    "K1.6b to [navn] der svaret har ett",
    "[navn] og [navn] var til stede",
    "[navn] var til stede.",
    "placeholder_guard",
  ),
  polish(
    "K1.6b byttet rekkefølge på plassholderne",
    "[navn] eier [adresse]",
    "[adresse] eies av [navn].",
    "placeholder_guard",
  ),
  polish(
    "K1.4 og K1.6b tallvakten vinner over plassholdervakten",
    "[navn] opplyste om lekkasje",
    "Det ble opplyst om lekkasje i 2019.",
    "number_guard",
  ),

  // --- K1.3 TG-vakt, summary_draft ------------------------------------------------------------
  summary(
    "K1.3 utkast uten TG slipper gjennom",
    THREE_FINDINGS,
    [
      ["F1", "Fuktmåling viste 15 vekt-% ved sluket, og tettesjiktet har sprekker."],
      ["F2", "Klemringen mangler, og en ny klemring monteres."],
      ["F3", "Avtrekket er svakt, og ventilen renses."],
    ],
    null,
  ),
  summary(
    "K1.3 enhver TG i KI-teksten stopper, også TG som sto i funnet",
    { F1: ["Membran", "Membranen har TG3"] },
    [["F1", "Membranen har TG3."]],
    "tg_guard",
  ),
  summary(
    "K1.3 «ikke undersøkt» i KI-teksten stopper",
    { F1: ["Membran", "Membranen bak kar er ikke sett"] },
    [["F1", "Membranen bak kar er ikke undersøkt."]],
    "tg_guard",
  ),
  summary(
    "K1.3 TG byttet mellom to funn stoppes",
    { F1: ["Membran", "Sprekker i tettesjiktet"], F2: ["Sluk", "Klemringen mangler"] },
    [
      ["F1", "Sprekker i tettesjiktet, satt til TG2."],
      ["F2", "Klemringen mangler, satt til TG3."],
    ],
    "tg_guard",
  ),

  // --- K1.6a dekningsvakt --------------------------------------------------------------------
  summary(
    "K1.6a ett av tre funn i samme gruppe mangler",
    THREE_FINDINGS,
    [
      ["F1", "Fuktmåling viste 15 vekt-% ved sluket."],
      ["F3", "Avtrekket er svakt."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a tomt funn",
    THREE_FINDINGS,
    [
      ["F1", "Fuktmåling viste 15 vekt-% ved sluket."],
      ["F2", "    "],
      ["F3", "Avtrekket er svakt."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a ukjent merke (F9 når det finnes tre)",
    THREE_FINDINGS,
    [
      ["F1", "Fuktmåling viste 15 vekt-% ved sluket."],
      ["F2", "Klemringen mangler."],
      ["F3", "Avtrekket er svakt."],
      ["F9", "Flisene er hele."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a samme merke to ganger",
    { F1: ["Membran", "Sprekker i tettesjiktet"], F2: ["Sluk", "Klemringen mangler"] },
    [
      ["F1", "Sprekker i tettesjiktet."],
      ["F1", "Klemringen mangler."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a tekst uten merke",
    { F1: ["Membran", "Sprekker i tettesjiktet"] },
    [
      [null, "Badet er i god stand."],
      ["F1", "Sprekker i tettesjiktet."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a TG-vakten vinner over dekningsvakten",
    THREE_FINDINGS,
    [["F1", "Fuktmåling viste 15 vekt-% ved sluket, TG3."]],
    "tg_guard",
  ),

  // --- K1.4 tallvakt per funn, summary_draft --------------------------------------------------
  summary(
    "K1.4 tall flyttet fra F1 til F2 stoppes",
    { F1: ["Membran", "Fuktmåling viste 15 vekt-%"], F2: ["Sluk", "Klemringen mangler"] },
    [
      ["F1", "Fuktmålingen viste forhøyet fukt."],
      ["F2", "Klemringen mangler, 15 vekt-% ved sluket."],
    ],
    "number_guard",
  ),
  summary(
    "K1.4 tall i merkene regnes ikke som nye tall",
    { F1: ["Membran", "Sprekker i tettesjiktet"], F2: ["Sluk", "Klemringen mangler"] },
    [
      ["F1", "Sprekker i tettesjiktet, se også F2."],
      ["F2", "Klemringen mangler (G1)."],
    ],
    null,
  ),
  summary(
    "K1.4 dekningsvakten vinner over tallvakten",
    THREE_FINDINGS,
    [
      ["F1", "Fuktmåling viste 15 vekt-% ved sluket."],
      ["F2", "Klemringen mangler etter 2019."],
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6b plassholder per funn: flyttet til et annet funn stoppes",
    { F1: ["Membran", "[navn] opplyste om lekkasje"], F2: ["Sluk", "Klemringen mangler"] },
    [
      ["F1", "Det er opplyst om lekkasje."],
      ["F2", "[navn] opplyste at klemringen mangler."],
    ],
    "placeholder_guard",
  ),

  // --- K1.5 vaktene gjelder ikke phrase_suggest ----------------------------------------------
  {
    name: "K1.5 phrase_suggest kjører ikke vaktene (svaret er bare merker)",
    feature: "phrase_suggest",
    sent: [{ label: null, texts: ["Sprekker i flisene"] }],
    answer: [{ label: null, text: "K1, K2 TG3 4711" }],
    expected: null,
  },
];

/**
 * Kjente saker uten vakt (K1.6c, spørsmål 103): en nektelse («ikke», «ingen», «uten») faller bort
 * i språkvasken. Vaktene stopper dem ikke ennå, så `expected` er `null`. Evalueringen skal merke
 * dem som ikke bestått. Om en egen vakt skal stoppe dem, er spørsmål 103 til Ståle, og må være
 * avklart før `language_polish` slås på for ekte leverandør.
 */
export const KNOWN_UNGUARDED_CASES: readonly GuardCase[] = [
  polish(
    "K1.6c «ikke» faller bort",
    "Det er ikke påvist fukt i veggen",
    "Det er påvist fukt i veggen.",
    null,
  ),
  polish(
    "K1.6c «ingen» faller bort",
    "Ingen sprekker i flisene ved sluket",
    "Sprekker i flisene ved sluket.",
    null,
  ),
  polish(
    "K1.6c «uten» faller bort",
    "Sluket er montert uten klemring",
    "Sluket er montert med klemring.",
    null,
  ),
];
