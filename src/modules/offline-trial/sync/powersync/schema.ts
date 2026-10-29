/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Klientskjemaet for PowerSync, bygd fra kolonnelistene i `schema-columns.ts`. `value` (jsonb på
 * serveren), `text_state` og tidsstempler er tekst lokalt; `size_bytes` er heltall.
 */
import { column, Schema, Table } from "@powersync/web";
import { trialColumns, type TrialColumnKind } from "./schema-columns";

function columnsOf(columns: Record<string, TrialColumnKind>) {
  return Object.fromEntries(
    Object.entries(columns).map(([name, kind]) => [
      name,
      kind === "integer" ? column.integer : column.text,
    ]),
  );
}

export const trialSchema = new Schema({
  trial_forms: new Table(columnsOf(trialColumns.trial_forms)),
  trial_answers: new Table(columnsOf(trialColumns.trial_answers), {
    indexes: { form_field: ["trial_form_id", "field_key"] },
  }),
  trial_photos: new Table(columnsOf(trialColumns.trial_photos), {
    indexes: { form_field: ["trial_form_id", "field_key"] },
  }),
});
