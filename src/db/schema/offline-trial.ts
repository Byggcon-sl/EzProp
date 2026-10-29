import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tre tabeller bare for prøven uten nett (docs/funksjoner/fase1-kandidat-powersync.md, «Data»).
 * De er ikke en del av datamodellen i docs/05 utover merknaden i ordlisten, og slettes eller gjøres
 * om i fase 2b. Alle har `baseColumns`: id laget på enheten (uuidv7), `organization_id`, myk
 * sletting og `row_version`. Synktjenesten leser dem gjennom publikasjonen `powersync`
 * (bare disse tre, aldri `FOR ALL TABLES`), se migreringen.
 *
 * Kolonner serveren eier og klienten aldri får skrive: `organization_id`, `created_by`,
 * `updated_by`, `row_version`, og på bilder `uploaded_at`, `sha256`, `storage_path`.
 */

/** Ett testskjema («én rapport» i prøven). Lages på enheten. */
export const trialForms = pgTable(
  "trial_forms",
  {
    ...baseColumns,
    name: text("name").notNull(),
  },
  (table) => [index("trial_forms_organization_id_idx").on(table.organizationId)],
);
export type TrialFormRecord = typeof trialForms.$inferSelect;

/**
 * Ett svar per felt. `field_key` er en av de 40 faste nøklene i `trialForm` (modulen
 * `offline-trial`). Endringer synkes per felt; serveren upserter på `(trial_form_id, field_key)`
 * og beholder sin egen `id` når to enheter laget raden hver for seg.
 */
export const trialAnswers = pgTable(
  "trial_answers",
  {
    ...baseColumns,
    trialFormId: uuid("trial_form_id")
      .notNull()
      .references(() => trialForms.id),
    fieldKey: text("field_key").notNull(),
    /**
     * `TrialValue` som JSON. For tekstfelt selve teksten, for bildefelt alltid tom (bildene ligger i
     * `trial_photos`). SQL NULL betyr «ikke besvart»; JSON `null` brukes ikke.
     */
    value: jsonb("value"),
    /** Base64-kodet Yjs-tilstand for tekstfelt. Sannheten for tekst; `value` er avledet av den. */
    textState: text("text_state"),
    /** Fast id per nettleser-installasjon (`trial_device_id`). Bare for varselet i prøve B. */
    deviceId: text("device_id").notNull(),
  },
  (table) => [
    index("trial_answers_organization_id_idx").on(table.organizationId),
    uniqueIndex("trial_answers_trial_form_id_field_key_idx").on(table.trialFormId, table.fieldKey),
  ],
);
export type TrialAnswerRecord = typeof trialAnswers.$inferSelect;

/**
 * Ett bilde i et bildefelt. `id` er `TrialPhoto.id` fra enheten. Raden kan lages av synk eller av
 * opplastingsruten (derfor kan `device_id` mangle). `uploaded_at`, `sha256` og `storage_path`
 * settes bare av serveren, og `storage_path` synkes aldri til enheten.
 */
export const trialPhotos = pgTable(
  "trial_photos",
  {
    ...baseColumns,
    trialFormId: uuid("trial_form_id")
      .notNull()
      .references(() => trialForms.id),
    fieldKey: text("field_key").notNull(),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    storagePath: text("storage_path"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    deviceId: text("device_id"),
  },
  (table) => [
    index("trial_photos_organization_id_idx").on(table.organizationId),
    index("trial_photos_trial_form_id_field_key_idx").on(table.trialFormId, table.fieldKey),
  ],
);
export type TrialPhotoRecord = typeof trialPhotos.$inferSelect;
