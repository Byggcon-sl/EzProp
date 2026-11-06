import { z } from "zod";

/*
 * Skjema for bryteren «Mål tid» og nullpunktet fra IVIT (docs/funksjoner/fase2a-tidsmaling.md
 * punkt 6, A123). Samme skjema brukes av kjernen og skjermen. Ukjente nøkler (også
 * `access.inspectors_edit_all` og `organizationId`) tas bort av Zod.
 */

export const BASELINE_MAX_MINUTES = 10_000;
export const BASELINE_SOURCE_MAX_LENGTH = 200;

const MINUTES = `Skriv minutter som et helt tall fra 0 til ${BASELINE_MAX_MINUTES.toLocaleString("nb-NO")}.`;
const SOURCE_TOO_LONG = `Kilden kan ha høyst ${BASELINE_SOURCE_MAX_LENGTH} tegn.`;
const SOURCE = "Kilden må være tekst.";
const ENABLED = "Velg om tiden skal måles.";
const EMPTY = "Velg bryteren eller fyll inn nullpunktet.";

const minutes = z
  .number({ error: MINUTES })
  .int({ error: MINUTES })
  .min(0, { error: MINUTES })
  .max(BASELINE_MAX_MINUTES, { error: MINUTES });

/** Nullpunktet fra IVIT: minutter per fase og kilden (antall oppdrag skrives i kilden). */
export const timeTrackingBaselineSchema = z.object({
  preparation: minutes,
  inspection: minutes,
  office: minutes,
  delivery: minutes,
  source: z
    .string({ error: SOURCE })
    .trim()
    .max(BASELINE_SOURCE_MAX_LENGTH, { error: SOURCE_TOO_LONG }),
});
export type TimeTrackingBaseline = z.infer<typeof timeTrackingBaselineSchema>;

/**
 * Det som lagres: bryteren, nullpunktet eller begge. Minst én av dem må være med, slik at
 * bryteren kan lagres uten å røre nullpunktet og omvendt.
 */
export const timeTrackingSettingsSchema = z
  .object({
    enabled: z.boolean({ error: ENABLED }).optional(),
    baseline: timeTrackingBaselineSchema.optional(),
  })
  .refine((value) => value.enabled !== undefined || value.baseline !== undefined, {
    error: EMPTY,
  });
export type TimeTrackingSettingsInput = z.input<typeof timeTrackingSettingsSchema>;
export type TimeTrackingSettings = z.output<typeof timeTrackingSettingsSchema>;
