import { z } from "zod";
import {
  AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH,
  AI_OVERRIDE_SHARE_MIN_REPORTS,
  AI_OVERRIDE_STATS_MAX_ROWS,
} from "./limits";
import type { AiOverrideStats } from "./types";

/*
 * Streng kontroll av tallgrunnlaget til `override_summary` (docs/funksjoner/
 * fase2a-overstyringer-leder.md «KI i bunnen», ADR 0006 tillegg 24.11.2026 punkt 4, A570 og A573).
 * Kjøres rett før ledeteksten bygges, både i kjernen og i kjøreren for evalueringssettet. Ren:
 * ingen database, ingen leverandør.
 *
 * Støtter hovedmålene KI i bunnen (bare faste koder, etiketter og tall går til KI) og færre
 * reklamasjoner (tallene KI skriver om, er regnet av serveren og kan kontrolleres av tallvakten).
 *
 * - Ukjente nøkler avvises på alle nivåer (`strict`), så en kalle- eller malfeil aldri kan sende
 *   begrunnelsestekst, navn eller id-er med.
 * - Kodene følger nøkkelformatet, så en kode fra en egen mal senere ikke kan bære tekst.
 * - Alle tall er heltall. Antall er fra 0; endring (`deltaCount`, `deltaPoints`) kan være
 *   negativ. Prosent er 0–100.
 * - Under `AI_OVERRIDE_SHARE_MIN_REPORTS` rapporter i en måned skal prosentene for den måneden
 *   være `null` (bare antall, A570). Null rapporter i måneden gir avslag: da skal KI ikke kalles.
 * - `deltaCount` er `count - previousCount`. Kombinasjonen (sperre, punkt, grunn) står én gang.
 */

/**
 * Nøkkelformatet for faste koder. Samme mønster som `TEMPLATE_KEY_PATTERN` i `@/db/schema`
 * (testen holder dem like); står her fordi kjøreren for evalueringssettet ikke laster databasen.
 */
export const OVERRIDE_STATS_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Måneden i formatet `YYYY-MM`. */
export const OVERRIDE_STATS_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Høyeste antall tegn i en fast etikett (kode eller grunn). */
export const OVERRIDE_STATS_LABEL_MAX_LENGTH = 200;

const code = z.string().max(100).regex(OVERRIDE_STATS_KEY_PATTERN);
const label = z.string().trim().min(1).max(OVERRIDE_STATS_LABEL_MAX_LENGTH);
const count = z.number().int().min(0);
const percent = z.number().int().min(0).max(100);

const rowSchema = z
  .object({
    checkCode: code,
    checkLabel: label,
    checkpointKey: code.nullable(),
    checkpointName: z.string().trim().min(1).max(AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH).nullable(),
    reasonCode: code,
    reasonLabel: label,
    count: z.number().int().min(1),
    sharePercent: percent.nullable(),
    claimCount: count,
    previousCount: count,
    previousSharePercent: percent.nullable(),
    deltaCount: z.number().int(),
    deltaPoints: z.number().int().min(-100).max(100).nullable(),
  })
  .strict();

const statsSchema = z
  .object({
    month: z.string().regex(OVERRIDE_STATS_MONTH_PATTERN),
    reportCount: z.number().int().min(1),
    previousMonth: z.object({ reportCount: count }).strict(),
    rows: z.array(rowSchema).max(AI_OVERRIDE_STATS_MAX_ROWS),
  })
  .strict()
  .superRefine((stats, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const smallMonth = stats.reportCount < AI_OVERRIDE_SHARE_MIN_REPORTS;
    const smallPrevious = stats.previousMonth.reportCount < AI_OVERRIDE_SHARE_MIN_REPORTS;
    const seen = new Set<string>();
    for (const row of stats.rows) {
      const key = `${row.checkCode}|${row.checkpointKey ?? ""}|${row.reasonCode}`;
      if (seen.has(key)) fail("Samme kombinasjon står to ganger.");
      seen.add(key);
      if ((row.checkpointKey === null) !== (row.checkpointName === null)) {
        fail("Punktet må ha både kode og navn, eller ingen av dem.");
      }
      if (row.count > stats.reportCount) fail("Flere rapporter enn i måneden.");
      if (row.claimCount > row.count) fail("Flere reklamasjoner enn rapporter.");
      if (row.previousCount > stats.previousMonth.reportCount) {
        fail("Flere rapporter måneden før enn publisert.");
      }
      if (row.deltaCount !== row.count - row.previousCount) fail("Endringen stemmer ikke.");
      if (smallMonth && row.sharePercent !== null) fail("Andel med for få rapporter.");
      if (smallPrevious && row.previousSharePercent !== null) {
        fail("Andel måneden før med for få rapporter.");
      }
      if ((smallMonth || smallPrevious) && row.deltaPoints !== null) {
        fail("Endring i prosentpoeng med for få rapporter.");
      }
    }
  });

/** Grunnlaget slik kontrollen har godtatt det. */
export type CheckedOverrideStats = AiOverrideStats;

/** Kontrollerer grunnlaget. `null` betyr avslag (kalleren gir det nøytrale avslaget). */
export function parseOverrideStats(value: unknown): CheckedOverrideStats | null {
  const parsed = statsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Antall linjer som ble kuttet før kjernen: heltall fra 0. */
export const overrideStatsCutSchema = z.number().int().min(0);

const MONTH_NAMES = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
] as const;

/** `2026-10` blir «oktober 2026». Forutsetter at måneden har bestått kontrollen. */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${MONTH_NAMES[Number(monthNumber) - 1] ?? month} ${year}`;
}
