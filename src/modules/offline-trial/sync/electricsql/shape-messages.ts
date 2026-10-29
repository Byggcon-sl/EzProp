/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tolking av svar fra Electric (gjennom proxy-ruten), etter `ParseShapeBody`, `ReadShapeHeaders`
 * og `NextShapeParams` i `electricsql/types.ts`. Ren fil: ingen nettleser-API, ingen SDK.
 *
 * Electric sender verdiene som tekst slik PostgreSQL skriver dem (`"120"`, `"2026-10-28 10:00:00+00"`,
 * jsonb som JSON-tekst). De gjøres om til lokal form: `value` som JSON-tekst, `size_bytes` som tall,
 * tidsstempler som ISO-tekst. Nøkkelen regnes fra kolonnene (`localRowKey`), aldri fra Electrics
 * `key`-tekst. Ukjente meldinger og kolonner overses.
 */
import type { TrialTableName } from "../local-columns";
import type { IncomingChange, LocalRow } from "../types";
import { normalizeLocalRow } from "../local/normalize-row";
import { localRowKey } from "../local/outbox";
import type {
  NextShapeParams,
  ParseShapeBody,
  ParsedShapeBody,
  ReadShapeHeaders,
  ShapeRequestParams,
} from "./types";

const OPERATIONS = new Set(["insert", "update", "delete"]);

/** Bare kjente kolonner, i lokal form (felles normaliserer i `sync/local/`). */
export const normalizeShapeRow = normalizeLocalRow;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Nøkkelen for en endring. Svar uten `trial_form_id`/`field_key` i meldingen (update eller delete
 * med bare endrede kolonner) får `id` som nøkkel; innflettingen finner da raden på `id`.
 */
function changeKey(table: TrialTableName, row: LocalRow): string | null {
  if (table === "trial_answers") {
    if (typeof row.trial_form_id === "string" && typeof row.field_key === "string") {
      return localRowKey(table, row);
    }
  }
  return typeof row.id === "string" ? String(row.id) : null;
}

export const parseShapeMessages: ParseShapeBody = (table, body): ParsedShapeBody => {
  const result: ParsedShapeBody = { changes: [], upToDate: false, mustRefetch: false };
  if (!Array.isArray(body)) return result;
  for (const message of body) {
    if (!isRecord(message) || !isRecord(message.headers)) continue;
    const { control, operation } = message.headers;
    if (control === "up-to-date") {
      result.upToDate = true;
      continue;
    }
    if (control === "must-refetch") {
      result.mustRefetch = true;
      continue;
    }
    if (typeof operation !== "string" || !OPERATIONS.has(operation)) continue;
    if (!isRecord(message.value)) continue;
    const row = normalizeShapeRow(table, message.value);
    const key = changeKey(table, row);
    if (key === null) continue;
    result.changes.push({ table, kind: operation as IncomingChange["kind"], key, row });
  }
  // Etter must-refetch gjelder ingenting i denne kroppen; alt hentes på nytt fra -1.
  if (result.mustRefetch) result.changes = [];
  return result;
};

export const readShapeHeaders: ReadShapeHeaders = (headers) => {
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const record = headers as Readonly<Record<string, string | undefined>>;
    const found = Object.keys(record).find((key) => key.toLowerCase() === name);
    return found === undefined ? undefined : record[found];
  };
  const upToDate = get("electric-up-to-date");
  return {
    handle: get("electric-handle") || undefined,
    offset: get("electric-offset") || undefined,
    cursor: get("electric-cursor") || undefined,
    upToDate: upToDate !== undefined && upToDate.toLowerCase() !== "false",
  };
};

export const nextShapeParams: NextShapeParams = (organizationId, table, state, live, cursor) => {
  if (!state) return { organisasjon: organizationId, tabell: table, offset: "-1" };
  const params: ShapeRequestParams = {
    organisasjon: organizationId,
    tabell: table,
    offset: state.offset,
    handle: state.handle,
  };
  if (live) {
    params.live = "true";
    if (cursor) params.cursor = cursor;
  }
  return params;
};

/** Spørrestrengen til proxy-ruten, i fast rekkefølge. */
export function shapeSearchParams(params: ShapeRequestParams): URLSearchParams {
  const search = new URLSearchParams({
    organisasjon: params.organisasjon,
    tabell: params.tabell,
    offset: params.offset,
  });
  if (params.handle) search.set("handle", params.handle);
  if (params.live) search.set("live", params.live);
  if (params.cursor) search.set("cursor", params.cursor);
  return search;
}
