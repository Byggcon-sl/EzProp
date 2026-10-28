/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kolonnene i den lokale lagringen på enheten, som ren data (ingen import av noen SDK), felles for
 * alle kandidater: PowerSync bygger SQLite-skjemaet sitt av dem, ElectricSQL-proxyen bruker dem som
 * `columns` i shapene, og Vitest sammenligner dem med PostgreSQL-skjemaet
 * (src/db/schema/offline-trial.ts). Samme navn som i PostgreSQL. `id` er alltid med (nøkkel).
 * `storage_path` synkes aldri til enheten, og serverstyrte kolonner klienten ikke trenger
 * (`organization_id`, `created_by`, `updated_by`, `deleted_by`, `row_version`) er ikke med.
 */

export type TrialColumnKind = "text" | "integer";

export const trialColumns = {
  trial_forms: {
    name: "text",
    created_at: "text",
    updated_at: "text",
    deleted_at: "text",
  },
  trial_answers: {
    trial_form_id: "text",
    field_key: "text",
    value: "text",
    text_state: "text",
    device_id: "text",
    created_at: "text",
    updated_at: "text",
    deleted_at: "text",
  },
  trial_photos: {
    trial_form_id: "text",
    field_key: "text",
    name: "text",
    size_bytes: "integer",
    sha256: "text",
    uploaded_at: "text",
    device_id: "text",
    created_at: "text",
    updated_at: "text",
    deleted_at: "text",
  },
} as const satisfies Record<string, Record<string, TrialColumnKind>>;

export type TrialTableName = keyof typeof trialColumns;
export const TRIAL_TABLE_NAMES = Object.keys(trialColumns) as TrialTableName[];

/** Kolonnene som hentes til enheten, med `id` først. Samme liste for alle kandidater. */
export function localColumnsOf(table: TrialTableName): readonly string[] {
  return ["id", ...Object.keys(trialColumns[table])];
}

export function isTrialTableName(value: unknown): value is TrialTableName {
  return typeof value === "string" && Object.hasOwn(trialColumns, value);
}
