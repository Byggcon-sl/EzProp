/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kolonnene i den lokale databasen, som ren data (ingen import av SDK-en), så Vitest kan
 * sammenligne dem med PostgreSQL-skjemaet (src/db/schema/offline-trial.ts). Samme navn som i
 * PostgreSQL. `id` legger SDK-en til selv. `storage_path` synkes aldri til enheten, og
 * serverstyrte kolonner klienten ikke trenger (`created_by`, `row_version` osv.) er ikke med.
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
