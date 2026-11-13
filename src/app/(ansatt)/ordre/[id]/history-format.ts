import { formatOsloDateTime } from "../received-at";

/** ISO-tidspunkt slik kjernen lagrer datoer i revisjonsloggen, for eksempel «2026-11-04T09:30:00.000Z». */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Én verdi i «Endringer» på ordresiden: tom blir «(tom)», ja/nei blir «Ja»/«Nei», et
 * ISO-tidspunkt blir norsk dato og klokkeslett (Oslo), tall og annen tekst vises som de er.
 * Objekter og lister vises aldri som «[object Object]», men som «(tom)».
 */
export function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined) return "(tom)";
  if (typeof value === "boolean") return value ? "Ja" : "Nei";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "(tom)";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "(tom)" : formatOsloDateTime(value);
  }
  if (typeof value !== "string") return "(tom)";
  const text = value.trim();
  if (text === "") return "(tom)";
  if (ISO_DATE_TIME.test(text) && !Number.isNaN(new Date(text).getTime())) {
    return formatOsloDateTime(text);
  }
  return value;
}
