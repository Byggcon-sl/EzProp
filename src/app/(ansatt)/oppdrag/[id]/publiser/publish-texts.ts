/*
 * Tekstene på publiser-siden som ikke er oversettelse av koder (funntekstene og grunnene står i
 * `@/core/reports/logic/publish-check-texts.ts`). Egne ord, norsk bokmål, uten gjetteord
 * (docs/funksjoner/fase2a-publisering-badet-design.md). Samme fil brukes av serverhandlingene og
 * klientkomponentene, så meldingene er like.
 * Støtter hovedmål: de ansatte (korte, konkrete meldinger) og færre reklamasjoner.
 */

/** «1 endring», «3 endringer». */
function changes(count: number): string {
  return count === 1 ? "1 endring" : `${count} endringer`;
}

/** «1 sperre», «2 sperrer». */
function blockers(count: number): string {
  return count === 1 ? "1 sperre" : `${count} sperrer`;
}

export const PUBLISH_TEXTS = {
  title: "Se over og publiser",
  documentTitle: (number: string | null) =>
    number ? `Se over og publiser – Oppdrag ${number}` : "Se over og publiser",
  back: "Oppdraget",
  backLabel: "Tilbake til oppdraget",
  reportType: "Tilstandsrapport",

  // Øverst (F5)
  noPermission: "Du kan se sjekken, men ikke publisere eller krysse bort. En takstmann publiserer.",
  certificationExpired: (date: string) =>
    `Du kan ikke publisere: sertifiseringen din gikk ut ${date}. En kollega med gyldig sertifisering kan publisere.`,
  certificationMissing:
    "Du kan ikke publisere: du har ingen gyldig sertifisering. En kollega med gyldig sertifisering kan publisere.",

  // «Dette publiseres»
  summaryHeading: "Dette publiseres",
  versionLine: (version: number, validUntil: string | null, inherited: boolean) => {
    if (validUntil === null) {
      return `Versjon ${version} · Gyldig til: mangler (befaringsdato er ikke satt)`;
    }
    return inherited
      ? `Versjon ${version} · Gyldig til ${validUntil} (som versjon 1)`
      : `Versjon ${version} · Gyldig til ${validUntil}`;
  },
  countLabel: (count: number) => (count === 1 ? "1 punkt" : `${count} punkter`),
  tg3Cost: (cost: string) => `kostnad ${cost}`,
  noTgYet: "Ingen punkter har TG ennå.",

  // Gruppene
  blockersHeading: (count: number) => `Må rettes eller krysses bort (${count})`,
  noBlockers: "Ingen sperrer.",
  warningsHeading: (count: number) => `Bør sees over (${count})`,
  reportGroup: "Rapporten",
  unnamedRoom: "Våtrom",

  // Sperrekortet
  mustFix: "Må rettes",
  overridden: "Krysset bort",
  newSinceOpened: "Ny siden du åpnet siden",
  fixNow: "Rett nå",
  close: "Lukk",
  goTo: "Gå til",
  goToLabel: (place: string) => `Gå til: ${place}`,
  publishAnyway: "Publiser likevel",
  overrideHint: (version: number) =>
    `Gjelder bare versjon ${version}. Mangelen kommer tilbake i neste versjon hvis den ikke er rettet.`,
  previousOverride: (version: number, reason: string) =>
    `I versjon ${version} krysset du bort dette: ${reason}`,
  useSameReason: "Bruk samme begrunnelse",

  // Grunnene (F1)
  reasonLegend: "Hvorfor publiserer du likevel?",
  reasonTextLabel: "Skriv grunnen",
  reasonTextOptionalLabel: "Forklaring (valgfri)",
  addExplanation: "Legg til en forklaring (valgfri)",
  reasonHintOther: "Minst 10 tegn. Ikke skriv navn eller kontaktopplysninger.",
  reasonHint: "Ikke skriv navn eller kontaktopplysninger.",
  charCount: (count: string, max: string) => `${count} av ${max} tegn`,

  // «Rett nå» (F2)
  holeLegend: "Hulltaking",
  holeReasonLegend: "Grunn",
  holeNoteLabel: "Forklar",
  costLegend: "Kostnad",
  tgCheckpointLegend: "TG for punktet",
  tgCheckpointHint: "Har punktet avvik med TG, bruk «Gå til».",
  tgDeviationLegend: (number: number | null) =>
    number === null ? "TG for avviket" : `TG for avvik ${number}`,
  saving: "Lagrer …",
  loading: "Henter valgene …",
  saveFailed: "Endringen ble ikke lagret. Prøv igjen.",
  conflict: "Feltet er endret et annet sted. Listen er hentet på nytt.",
  tgiuConflict: "Punktet har TGIU. Bruk «Gå til» for å velge hva som skal gjelde.",
  fixedLine: (what: string) => `Rettet: ${what}`,
  fixedHole: "Hulltaking er besvart.",
  fixedCost: (deviation: string, cost: string) => `${deviation} har kostnad ${cost}.`,
  fixedTg: (place: string, tg: string) => `${place} har ${tg}.`,
  fixedAnnouncement: (remaining: number) =>
    remaining === 0
      ? "Rettet. Ingen igjen som må rettes."
      : `Rettet. ${remaining} igjen som må rettes.`,

  // KI-forslag (F4)
  aiPendingLine: (field: string, place: string | null) => (place ? `${field} · ${place}` : field),
  aiHandled: "Forslaget er behandlet.",
  aiUndone: "Angret",
  aiFailed: "Valget ble ikke lagret. Prøv igjen.",
  aiNotAllowed: "Valget kan ikke gjøres nå. Forslaget er endret.",

  // Listen er oppdatert (F3)
  listUpdated: (newBlockers: number) =>
    newBlockers === 0
      ? "Listen er oppdatert. Ingen nye sperrer."
      : newBlockers === 1
        ? "Listen er oppdatert. 1 ny sperre."
        : `Listen er oppdatert. ${newBlockers} nye sperrer.`,
  listChangedOnPublish:
    "Noe er endret siden du åpnet siden. Se over listen og trykk Publiser igjen.",

  // Nedre linje
  offline: "Publisering krever nett. Alt er lagret på enheten.",
  waitingForSync: (count: number) => `Venter på synk (${changes(count)})`,
  allSaved: "Alt er lagret",
  publish: (version: number) => `Publiser versjon ${version}`,
  publishBlocked: (count: number) => `Publiser (${count} må rettes eller krysses bort)`,
  publishMissingReason: (count: number) => `Publiser (${count} mangler grunn)`,
  blockedAnnouncement: (count: number) => `${count} må rettes eller krysses bort.`,
  missingReasonAnnouncement: (count: number) =>
    count === 1 ? "1 sperre mangler grunn." : `${count} sperrer mangler grunn.`,
  publishing: "Publiserer …",
  publishFailed: "Rapporten ble ikke publisert. Prøv igjen.",
  alreadyPublished: "Rapporten er alt publisert.",
  seeReleases: "Se utgivelsene",

  // Uten våtrom og ikke startet
  noWetRoom: "Rapporten har ikke noe våtrom å publisere.",
  toBuildings: "Til bygninger og rom",
  notStarted: "Rapporten er ikke startet. Start den fra badet.",

  // Etter publisering
  publishedHeading: (version: number) => `Versjon ${version} er publisert`,
  publishedLine: (when: string, validUntil: string | null, overridden: number) =>
    [
      when,
      validUntil ? `Gyldig til ${validUntil}` : "Gyldig til: mangler",
      overridden === 0 ? "Ingen sperrer krysset bort" : `${blockers(overridden)} krysset bort`,
    ].join(" · "),
  toAssignment: "Til oppdraget",
  seeBathroom: "Se badet",
  alreadyPublishedLine: (when: string) => `Publisert ${when}.`,
  newVersion: "Lag ny versjon",
  creatingNewVersion: "Lager ny versjon …",
  newVersionFailed: "Ny versjon ble ikke laget. Prøv igjen.",
  newVersionStarted: (next: number, previous: number) =>
    `Du retter versjon ${next}. Versjon ${previous} er uendret.`,
} as const;

/** Rommet: knappen med tellemerke og linjen tilbake (design avsnitt 13 og 14). */
export const PUBLISH_LINK_TEXTS = {
  link: "Se over og publiser",
  badge: (blockers: number, warnings: number) => {
    if (blockers === 0 && warnings === 0) return "Ingen mangler";
    if (blockers === 0) return `${warnings} bør sees over`;
    if (warnings === 0) return `${blockers} må rettes`;
    return `${blockers} må rettes, ${warnings} bør sees over`;
  },
  ariaLabel: (blockers: number, warnings: number) => {
    if (blockers === 0 && warnings === 0) return "Se over og publiser. Ingen mangler.";
    const parts = [
      blockers > 0 ? `${blockers} må rettes` : null,
      warnings > 0 ? `${warnings} bør sees over` : null,
    ].filter(Boolean);
    return `Se over og publiser. ${parts.join(", ")}.`;
  },
  back: (remaining: number) =>
    remaining === 0
      ? "Tilbake til publisering (alt rettet)"
      : `Tilbake til publisering (${remaining} igjen)`,
  publishedBadge: (version: number) => `Publisert versjon ${version}`,
  publishedLine: "Rapporten er publisert. Lag ny versjon for å rette.",
  revising: (next: number) => `Du retter versjon ${next}. Versjon ${next - 1} er uendret.`,
} as const;

/** «Utgivelser» på oppdraget (design avsnitt 15). */
export const RELEASES_TEXTS = {
  heading: "Utgivelser",
  version: (version: number) => `Versjon ${version}`,
  overriddenCount: (count: number) =>
    count === 0 ? "Ingen sperrer krysset bort" : `${blockers(count)} krysset bort`,
  left: "Sluttet",
  validUntil: (date: string | null) => (date ? `Gyldig til ${date}` : "Gyldig til: mangler"),
  firstRelease: (date: string) => `Første utgivelse ${date}`,
  reason: (label: string) => `Grunn: ${label}`,
  reasonHidden: "Begrunnelsen vises for takstmann, leder og admin.",
  overridesHeading: "Sperrer som ble krysset bort",
  by: (name: string) => `Krysset bort av ${name}`,
} as const;
