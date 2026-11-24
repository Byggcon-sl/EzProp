/*
 * Faste tekster i PDF-en (docs/funksjoner/fase2a-pdf-badet-design.md avsnitt 6). Bare etiketter
 * og overskrifter: ingen fagtekst (den kommer i `ReportPdfData`) og intet selskapsnavn (det kommer
 * fra oppdraget). Skjermtekstene står ved skjermene. TG-tekstene kommer fra `TgBadge`, så PDF-en og
 * skjermen alltid sier det samme.
 */

export const PDF_TEXTS = {
  cover: {
    title: "Tilstandsrapport",
    assignmentNumber: "Oppdragsnummer",
    inspectionDate: "Befaringsdato",
    company: "Utført av",
    logoAlt: "Logo",
  },
  toc: { heading: "Innhold" },
  deviation: {
    cause: "Årsak",
    consequence: "Konsekvens",
    measures: "Tiltak",
    cost: "Kostnad",
    hms: "HMS",
    /** «<punktets etikett> · avvik, fortsetter» øverst på neste side. */
    continued: (checkpointLabel: string) => `${checkpointLabel} · avvik, fortsetter`,
    imageAlt: (checkpointLabel: string) => `Bilde til avvik på ${checkpointLabel}`,
  },
  draft: {
    banner: "UTKAST – ikke send til kunde",
    watermark: "UTKAST",
    notSet: "Ikke satt",
    missing: (text: string) => `Mangler: ${text}`,
    check: (text: string) => `Sjekk: ${text}`,
    link: "Rett i skjemaet ›",
  },
  missing: {
    heading: "Ikke med i PDF-en",
    intro: "Dette står ikke i rapporten ennå. Siden er bare med i utkastet.",
    emptyHeading: "Punkter uten innhold",
  },
  footer: {
    noCompany: "Juridisk selskap mangler på oppdraget",
    orgNumber: (orgNumber: string) => `org.nr. ${orgNumber}`,
    /** Tallene settes inn av malen, fordi bare motoren vet sidetallet. */
    pagePrefix: "Side",
    pageMiddle: "av",
  },
  meta: {
    titleDraft: (assignmentNumber: string) => `UTKAST – Tilstandsrapport ${assignmentNumber}`,
    titleRelease: (assignmentNumber: string, version: number) =>
      `Tilstandsrapport ${assignmentNumber}, versjon ${version}`,
    titleReleaseNoVersion: (assignmentNumber: string) => `Tilstandsrapport ${assignmentNumber}`,
  },
} as const;
