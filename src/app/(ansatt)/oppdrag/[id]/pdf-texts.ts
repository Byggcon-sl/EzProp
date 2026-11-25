/*
 * Tekstene til PDF-knappene på skjermen (docs/funksjoner/fase2a-pdf-badet-design.md avsnitt 5 og
 * 6). Samlet her, ikke spredt i komponentene. Tekstene i selve PDF-en og feilsidene fra ruten står
 * i `src/core/pdf/pdf-texts.ts`.
 * Støtter hovedmål: de ansatte (ett trykk gir PDF-en, og det står hva som skjer).
 */

export const PDF_BUTTON_TEXTS = {
  create: "Lag PDF (utkast)",
  saving: "Lagrer endringer …",
  creating: "Lager PDF …",
  /** Leses opp av skjermleseren mens PDF-en lages. */
  creatingStatus: "Lager PDF-en. Den åpnes i en ny fane.",
  offline: "Krever nett. PDF-en kan lages når du er på nett igjen.",
  saveFailed: "Endringene ble ikke lagret. PDF-en ble ikke laget.",
  newTab: "(åpnes i ny fane)",
} as const;

export const RELEASE_PDF_TEXTS = {
  open: "Åpne PDF",
  /** Tilgjengelig navn per utgivelse. */
  openLabel: (versionNumber: number) =>
    `Åpne PDF av versjon ${versionNumber} ${PDF_BUTTON_TEXTS.newTab}`,
  /** Lover ikke mer enn det PDF-en av en utgivelse viser (sikkerhet runde 2 punkt 1). */
  hint: "PDF-en viser teksten og TG slik de ble publisert.",
} as const;

/** Adressen til utkastet av oppdragets rapport. Bare id-en. */
export function draftPdfHref(assignmentId: string): string {
  return `/oppdrag/${assignmentId}/pdf`;
}

/** Adressen til PDF-en av en utgivelse. Bare id-er. */
export function releasePdfHref(assignmentId: string, releaseId: string): string {
  return `/oppdrag/${assignmentId}/utgivelser/${releaseId}/pdf`;
}

/** Ankeret på badet for et kontrollpunkt (F4). Samme form som lenken i utkastet. */
export function checkpointAnchorId(checkpointId: string): string {
  return `punkt-${checkpointId}`;
}

/** Ankeret på badet for et avvik (F4). */
export function deviationAnchorId(deviationId: string): string {
  return `avvik-${deviationId}`;
}
