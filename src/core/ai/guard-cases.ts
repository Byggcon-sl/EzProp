import type { AiGuardCode } from "@/db/schema";

/*
 * Testsakene for vaktene på KI-svaret, som data (docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * K1.2–K1.6c og K2.1). Brukes både av enhetstestene (`guards.test.ts`, `it.each`) og av
 * evalueringen. En snudd forventning skal gjøre testen rød.
 *
 * Alle tekster er oppdiktet og skrevet for testene. Ingen tekst fra standarder eller andre
 * systemer. Tekstene er vasket på forhånd: plassholderne står slik vasken setter dem inn.
 *
 * Støtter hovedmål: KI i bunnen (vaktene er ett sted og prøves likt i test og evaluering) og
 * færre reklamasjoner (svar som endrer TG, legger til tall eller mister et funn, vises aldri).
 */

/** Én del av det som ble sendt (`AiGuardSentPart`). */
export type GuardCaseSentPart = { label: string | null; texts: readonly string[] };
/** Én del av svaret (`AiGuardAnswerPart`). */
export type GuardCaseAnswerPart = { label: string | null; text: string };

export type GuardCase = {
  /** Testnummeret i testplanen og en kort beskrivelse. */
  name: string;
  feature: "language_polish" | "summary_draft";
  sent: readonly GuardCaseSentPart[];
  answer: readonly GuardCaseAnswerPart[];
  /** Vaktkoden som skal slå til, eller `null` når svaret kan vises. */
  expected: AiGuardCode | null;
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

/** K1.2 TG-vakten for språkvask: TG-omtalene i svaret må være de samme som i det som ble sendt. */
export const TG_GUARD_POLISH_CASES: readonly GuardCase[] = [
  polish(
    "K1.2 TG som sto i inndata og står uendret, slipper gjennom",
    "Avviket har TG2 og gjeldr fallet mot sluk.",
    "Avviket har TG2 og gjelder fallet mot sluk.",
    null,
  ),
  polish(
    "K1.2 «TG 3» i inndata og «TG3» i svaret regnes som samme TG",
    "Sjiktet er gitt TG 3 fordi det mangler tetting.",
    "Sjiktet er gitt TG3 fordi det mangler tetting.",
    null,
  ),
  polish(
    "K1.2 ny TG i svaret stoppes",
    "Flisene på gulvet er sprukne.",
    "Flisene på gulvet er sprukne, TG2.",
    "tg_guard",
  ),
  polish(
    "K1.2 TG2 i inndata og TG3 i svaret stoppes",
    "Fallet mot sluk er for lite, TG2.",
    "Fallet mot sluk er for lite, TG3.",
    "tg_guard",
  ),
  polish(
    "K1.2 «tilstandsgrad 3» lagt til stoppes",
    "Fallet mot sluk er for lite.",
    "Fallet mot sluk er for lite og gir tilstandsgrad 3.",
    "tg_guard",
  ),
  polish(
    "K1.2 «ikke undersøkt» lagt til stoppes (regnes som TGIU)",
    "Rommet bak veggen ble ikke åpnet.",
    "Rommet bak veggen er ikke undersøkt.",
    "tg_guard",
  ),
  polish(
    "K1.2 TGIU lagt til med små bokstaver stoppes",
    "Rommet bak veggen ble ikke åpnet.",
    "Rommet bak veggen ble ikke åpnet, tgiu.",
    "tg_guard",
  ),
  polish(
    "K1.2 TG fjernet fra svaret stoppes (endring)",
    "Membranen mangler tetting mot sluket, TG3.",
    "Membranen mangler tetting mot sluket.",
    "tg_guard",
  ),
];

/** K1.4 tallvakten for språkvask. */
export const NUMBER_GUARD_POLISH_CASES: readonly GuardCase[] = [
  polish(
    "K1.4 nytt årstall stoppes",
    "Membranen er gammel og bør sjekkes.",
    "Membranen er fra 1985 og bør sjekkes.",
    "number_guard",
  ),
  polish(
    "K1.4 ny måleverdi (18 vekt-%) stoppes",
    "Det ble målt forhøyet fukt i veggen.",
    "Det ble målt 18 vekt-% fukt i veggen.",
    "number_guard",
  ),
  polish(
    "K1.4 ny lengde (3 mm) stoppes",
    "Det er riss i fugene.",
    "Det er riss på 3 mm i fugene.",
    "number_guard",
  ),
  polish(
    "K1.4 nytt kronebeløp (40 000 kr) stoppes",
    "Utbedringen er kostbar.",
    "Utbedringen koster rundt 40 000 kr.",
    "number_guard",
  ),
  polish(
    "K1.4 tall som sto i inndata slipper gjennom",
    "Det ble malt 18 vekt-% fukt i veggen.",
    "Det ble målt 18 vekt-% fukt i veggen.",
    null,
  ),
  polish(
    "K1.4 «40000» i inndata og «40 000» i svaret er samme tall",
    "Anslaget er 40000 kr for nytt sluk.",
    "Anslaget er 40 000 kr for nytt sluk.",
    null,
  ),
  polish(
    "K1.4 «15» i inndata og «15,0» i svaret stoppes (vakten feiler lukket, A471)",
    "Målingen viste 15 vekt-% i bunnsvillen.",
    "Målingen viste 15,0 vekt-% i bunnsvillen.",
    "number_guard",
  ),
  polish(
    "K1.4 TG-vakten og tallvakten samtidig gir tg_guard (rekkefølgen, A471)",
    "Fallet mot sluk er for lite.",
    "Fallet mot sluk er 4 mm for lite, TG2.",
    "tg_guard",
  ),
];

/** K1.4 og K1.6b plassholderne for språkvask (A466). */
export const PLACEHOLDER_GUARD_POLISH_CASES: readonly GuardCase[] = [
  polish(
    "K1.6b samme plassholdere i samme rekkefølge slipper gjennom",
    "[navn] opplyste at sluket i [adresse] ble skiftet.",
    "[navn] opplyste at sluket i [adresse] ble skiftet.",
    null,
  ),
  polish(
    "K1.6b to [navn] i samme rekkefølge slipper gjennom",
    "[navn] og [navn] var til stede ved befaringen.",
    "[navn] og [navn] var til stede under befaringen.",
    null,
  ),
  polish(
    "K1.6b lagt til plassholder stoppes",
    "[navn] opplyste at sluket ble skiftet.",
    "[navn] opplyste at sluket i [adresse] ble skiftet.",
    "placeholder_guard",
  ),
  polish(
    "K1.6b fjernet plassholder stoppes",
    "[navn] og [navn] var til stede ved befaringen.",
    "[navn] var til stede ved befaringen.",
    "placeholder_guard",
  ),
  polish(
    "K1.6b plassholder byttet til annen type stoppes",
    "[navn] opplyste at sluket ble skiftet.",
    "[telefon] opplyste at sluket ble skiftet.",
    "placeholder_guard",
  ),
  polish(
    "K1.4 tallvakten og plassholdervakten samtidig gir number_guard (rekkefølgen, A471)",
    "[navn] opplyste at sluket ble skiftet.",
    "Sluket ble skiftet i 2019.",
    "number_guard",
  ),
];

/** Funn i sammendraget: ett F-merke per funn. */
const finding = (label: string, ...texts: string[]): GuardCaseSentPart => ({ label, texts });
const part = (label: string, text: string): GuardCaseAnswerPart => ({ label, text });

const F1 = finding("F1", "Membranen mangler tetting mot sluket.", "Sluket må tettes mot sjiktet.");
const F2 = finding("F2", "Fallet mot sluk er for lite.", "Fallet bør rettes ved neste oppussing.");
const F3 = finding("F3", "Det ble målt 15 vekt-% fukt i bunnsvillen.");

const summary = (
  name: string,
  sent: readonly GuardCaseSentPart[],
  answer: readonly GuardCaseAnswerPart[],
  expected: AiGuardCode | null,
): GuardCase => ({ name, feature: "summary_draft", sent, answer, expected });

/** K1.3, K1.4, K1.6a og K1.6b for sammendraget. */
export const SUMMARY_GUARD_CASES: readonly GuardCase[] = [
  summary(
    "K1.3 alle F-merker med tekst uten TG og uten nye tall slipper gjennom",
    [F1, F2, F3],
    [
      part("F1", "Membranen er ikke tettet mot sluket, og sluket må tettes."),
      part("F2", "Fallet mot sluket er for lite og bør rettes ved neste oppussing."),
      part("F3", "Bunnsvillen har 15 vekt-% fukt."),
    ],
    null,
  ),
  summary(
    "K1.3 TG i KI-teksten stoppes, også når TG sto i funnet som ble sendt",
    [finding("F1", "Membranen mangler tetting mot sluket, TG3.")],
    [part("F1", "Membranen mangler tetting mot sluket, TG3.")],
    "tg_guard",
  ),
  summary(
    "K1.3 «ikke undersøkt» i KI-teksten stoppes",
    [F1],
    [part("F1", "Membranen er ikke undersøkt.")],
    "tg_guard",
  ),
  summary(
    "K1.3 byttet TG mellom to funn stoppes (svaret omtaler F1 med TG2)",
    [finding("F1", "Membranen mangler tetting, TG3."), finding("F2", "Fallet er for lite, TG2.")],
    [part("F1", "Membranen mangler tetting, TG2."), part("F2", "Fallet er for lite.")],
    "tg_guard",
  ),
  summary(
    "K1.6a ett av tre F-merker mangler stoppes",
    [F1, F2, F3],
    [part("F1", "Membranen er ikke tettet mot sluket."), part("F2", "Fallet er for lite.")],
    "coverage_guard",
  ),
  summary(
    "K1.6a tomt F-merke stoppes",
    [F1, F2],
    [part("F1", "Membranen er ikke tettet mot sluket."), part("F2", "   ")],
    "coverage_guard",
  ),
  summary(
    "K1.6a ukjent F-merke (F9 når det finnes 3) stoppes",
    [F1, F2, F3],
    [
      part("F1", "Membranen er ikke tettet mot sluket."),
      part("F2", "Fallet er for lite."),
      part("F3", "Bunnsvillen har 15 vekt-% fukt."),
      part("F9", "Badet er ellers i orden."),
    ],
    "coverage_guard",
  ),
  summary(
    "K1.6a samme F-merke to ganger stoppes",
    [F1, F2],
    [
      part("F1", "Membranen er ikke tettet mot sluket."),
      part("F1", "Membranen er ikke tettet."),
      part("F2", "Fallet er for lite."),
    ],
    "coverage_guard",
  ),
  summary(
    "K1.4 tall flyttet mellom funn (15 vekt-% fra F3 under F2) stoppes (A461)",
    [F1, F2, F3],
    [
      part("F1", "Membranen er ikke tettet mot sluket."),
      part("F2", "Fallet er for lite, og det er 15 vekt-% fukt."),
      part("F3", "Bunnsvillen har forhøyet fukt."),
    ],
    "number_guard",
  ),
  summary(
    "K1.4 nytt kronebeløp i sammendraget stoppes",
    [F1],
    [part("F1", "Membranen må tettes, ca. 40 000 kr.")],
    "number_guard",
  ),
  summary(
    "K1.4 tall i merkene (F1, G2) regnes ikke som nye tall",
    [F1, F2],
    [
      part("F1", "Under G1: membranen er ikke tettet mot sluket, se også F2."),
      part("F2", "Fallet er for lite, jf. G2 og F1."),
    ],
    null,
  ),
  summary(
    "K1.4 TG og manglende funn samtidig gir tg_guard (rekkefølgen, A471)",
    [F1, F2],
    [part("F1", "Membranen mangler tetting, TG3.")],
    "tg_guard",
  ),
  summary(
    "K1.4 manglende funn og nytt tall samtidig gir coverage_guard (rekkefølgen, A471)",
    [F1, F2],
    [part("F1", "Membranen mangler tetting siden 2015.")],
    "coverage_guard",
  ),
  summary(
    "K1.6b plassholder lagt til i sammendraget stoppes",
    [finding("F1", "[navn] opplyste at sluket ble skiftet.")],
    [part("F1", "[navn] opplyste at sluket i [adresse] ble skiftet.")],
    "placeholder_guard",
  ),
  summary(
    "K1.6b plassholder flyttet til et annet funn stoppes",
    [finding("F1", "[navn] opplyste at sluket ble skiftet."), F2],
    [part("F1", "Sluket ble skiftet."), part("F2", "[navn] sa at fallet er for lite.")],
    "placeholder_guard",
  ),
];

/** Alle sakene vaktene skal avgjøre. */
export const GUARD_CASES: readonly GuardCase[] = [
  ...TG_GUARD_POLISH_CASES,
  ...NUMBER_GUARD_POLISH_CASES,
  ...PLACEHOLDER_GUARD_POLISH_CASES,
  ...SUMMARY_GUARD_CASES,
];

/**
 * K1.6c kjente saker uten vakt ennå (fag 5, spørsmål 103): en nektelse («ikke», «ingen», «uten»)
 * faller bort. Vaktene slipper dem gjennom i dag (`expectedGuard: null`), men evalueringen skal
 * merke dem som ikke bestått (`evalPasses: false`). Når Ståle har svart på spørsmål 103, flyttes
 * sakene til `GUARD_CASES` med egen vaktkode.
 */
export type KnownCase = GuardCase & { evalPasses: false };

export const NEGATION_CASES: readonly KnownCase[] = [
  {
    ...polish(
      "K1.6c «ikke påvist fukt» blir «påvist fukt»",
      "Det er ikke påvist fukt i veggen bak dusjen.",
      "Det er påvist fukt i veggen bak dusjen.",
      null,
    ),
    evalPasses: false,
  },
  {
    ...polish(
      "K1.6c «ingen sprekker» blir «sprekker»",
      "Det er ingen sprekker i flisene på gulvet.",
      "Det er sprekker i flisene på gulvet.",
      null,
    ),
    evalPasses: false,
  },
  {
    ...polish(
      "K1.6c «uten klemring» faller bort",
      "Sluket står uten klemring mot membranen.",
      "Sluket står med klemring mot membranen.",
      null,
    ),
    evalPasses: false,
  },
];
