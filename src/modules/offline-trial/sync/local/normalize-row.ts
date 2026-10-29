/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Lokal kjerne: rader fra serveren gjøres om til lokal form, felles for ElectricSQL (shapes) og
 * egenbygd (hente-ruten). Flyttet uendret fra `electricsql/shape-messages.ts`. Ren fil: ingen
 * nettleser-API, ingen SDK.
 *
 * PostgreSQL skriver verdiene som tekst (`"120"`, `"2026-10-28 10:00:00+00"`, jsonb som JSON-tekst).
 * De gjøres om til lokal form: `value` som JSON-tekst, `size_bytes` som tall, tidsstempler som
 * ISO-tekst. Bare kolonnene i `localColumnsOf(table)`; ukjente kolonner overses.
 */
import { localColumnsOf, type TrialTableName } from "../local-columns";
import type { LocalRow } from "../types";

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "deleted_at", "uploaded_at"]);
const INTEGER_COLUMNS = new Set(["size_bytes"]);

const PG_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Tidsstempel fra PostgreSQL eller ISO til ISO 8601. Ukjent form beholdes som den er. */
function toIsoTimestamp(value: string): string {
  const match = PG_TIMESTAMP.exec(value.trim());
  let candidate = value;
  if (match) {
    let zone = match[3] ?? "Z";
    if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
    else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    candidate = `${match[1]}T${match[2]}${zone}`;
  }
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** jsonb til JSON-tekst. Tekst som allerede er gyldig JSON, står som den er. */
function toJsonText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value) ?? null;
}

type Normalized = { ok: true; value: unknown } | { ok: false };

function normalizeColumn(column: string, value: unknown): Normalized {
  if (value === undefined) return { ok: false };
  if (column === "value") return { ok: true, value: toJsonText(value) };
  if (value === null) return { ok: true, value: null };
  if (INTEGER_COLUMNS.has(column)) {
    const number = typeof value === "string" ? Number(value) : value;
    return typeof number === "number" && Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false };
  }
  if (TIMESTAMP_COLUMNS.has(column)) {
    if (value instanceof Date) return { ok: true, value: value.toISOString() };
    return typeof value === "string" ? { ok: true, value: toIsoTimestamp(value) } : { ok: false };
  }
  if (typeof value === "string") return { ok: true, value };
  if (typeof value === "number" || typeof value === "boolean") {
    return { ok: true, value: String(value) };
  }
  return { ok: false };
}

/** Bare kjente kolonner, i lokal form. */
export function normalizeLocalRow(table: TrialTableName, value: Record<string, unknown>): LocalRow {
  const row: LocalRow = {};
  for (const column of localColumnsOf(table)) {
    if (!Object.hasOwn(value, column)) continue;
    const normalized = normalizeColumn(column, value[column]);
    if (normalized.ok) row[column] = normalized.value;
  }
  return row;
}
