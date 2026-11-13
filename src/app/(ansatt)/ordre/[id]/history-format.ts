import { formatOsloDateTime } from "../received-at";

/** ISO-tidspunkt slik kjernen lagrer datoer i revisjonsloggen, for eksempel «2026-11-12T09:30:00.000Z». */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Én verdi i «Endringer» på ordresiden («Adresse: X → Y»). Tom verdi blir «(tom)», ja/nei blir
 * «Ja»/«Nei», et tidspunkt blir norsk dato og klokkeslett, tall vises som tall. Bestilleren kommer
 * ferdig som navn fra kjernen. Annet (objekter, lister) vises aldri rått.
 */
export function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined) return "(tom)";
  if (typeof value === "boolean") return value ? "Ja" : "Nei";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "(tom)";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "(tom)" : formatOsloDateTime(value);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return "(tom)";
    if (ISO_DATE_TIME.test(text) && !Number.isNaN(new Date(text).getTime())) {
      return formatOsloDateTime(text);
    }
    return text;
  }
  return "(tom)";
}

/** «Adresse: Testveien 12 → Testveien 14». */
export function formatHistoryChange(change: { label: string; from: unknown; to: unknown }): string {
  return `${change.label}: ${formatHistoryValue(change.from)} → ${formatHistoryValue(change.to)}`;
}
