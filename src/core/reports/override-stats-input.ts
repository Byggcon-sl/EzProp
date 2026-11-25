import { z } from "zod";
import type { AiOverrideStats, AiOverrideStatsRow } from "@/core/ai";
import {
  AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH,
  AI_OVERRIDE_STATS_MAX_ROWS,
} from "@/core/ai/limits";
import {
  publishCheckLabel,
  publishOverrideReasonLabel,
} from "@/shared/config/publish-check-labels";
import { computeOverrideShare } from "./logic/overrides";

/*
 * Tallgrunnlaget til KI-funksjonen `override_summary` (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A570, A573 og A577). Ren funksjon, men bare for serveren: den bruker Zod og grensene i
 * `@/core/ai`, som de rene funksjonene i `./logic` ikke kan importere (ADR 0013).
 *
 * Støtter hovedmål: KI i bunnen (serveren regner alle tall og prosenter, KI formulerer bare, og
 * grunnlaget har bare faste koder, etiketter, punktnavn og heltall).
 */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Formatet på kodene i grunnlaget: samme som en fast kode (regel 6), høyst 100 tegn. */
export const OVERRIDE_CODE_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const codeSchema = z.string().max(100).regex(OVERRIDE_CODE_PATTERN);
const countSchema = z.number().int().min(0);
const deltaSchema = z.number().int();
const labelSchema = z.string().min(1).max(AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH);

/** Én kombinasjon (kode, punkt, grunn) med tall for måneden og måneden før, fra databasen. */
export type OverrideCountRow = {
  checkCode: string;
  checkpointKey: string | null;
  checkpointName: string | null;
  reasonCode: string;
  /** Unike rapporter med overstyringen i måneden. */
  count: number;
  /** Unike rapporter med rød markering i måneden. */
  claimCount: number;
  /** Unike rapporter med overstyringen i måneden før. */
  previousCount: number;
};

export type OverrideSummaryInputSource = {
  month: string;
  reportCount: number;
  previousReportCount: number;
  rows: readonly OverrideCountRow[];
};

const countRowSchema = z
  .object({
    checkCode: codeSchema,
    checkpointKey: codeSchema.nullable(),
    checkpointName: z.string().nullable(),
    reasonCode: codeSchema,
    count: countSchema,
    claimCount: countSchema,
    previousCount: countSchema,
  })
  .strict();

const sourceSchema = z
  .object({
    month: z.string().regex(MONTH_PATTERN),
    reportCount: countSchema,
    previousReportCount: countSchema,
    rows: z.array(countRowSchema),
  })
  .strict();

/**
 * Formkravet til grunnlaget slik det går til KI: bare kjente nøkler, koder i nøkkelformatet og
 * heltall. Kjernen i `@/core/ai` validerer det samme rett før kallet.
 */
export const overrideStatsSchema = z
  .object({
    month: z.string().regex(MONTH_PATTERN),
    reportCount: countSchema,
    previousMonth: z.object({ reportCount: countSchema }).strict(),
    rows: z
      .array(
        z
          .object({
            checkCode: codeSchema,
            checkLabel: labelSchema,
            checkpointKey: codeSchema.nullable(),
            checkpointName: labelSchema.nullable(),
            reasonCode: codeSchema,
            reasonLabel: labelSchema,
            count: countSchema,
            sharePercent: countSchema.nullable(),
            claimCount: countSchema,
            previousCount: countSchema,
            previousSharePercent: countSchema.nullable(),
            deltaCount: deltaSchema,
            deltaPoints: deltaSchema.nullable(),
          })
          .strict(),
      )
      .max(AI_OVERRIDE_STATS_MAX_ROWS),
  })
  .strict();

/** Kortet ned til grensen, uten mellomrom i endene. Tomt blir `null`. */
function shortName(name: string | null): string | null {
  const trimmed = name?.replace(/\s+/gu, " ").trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.length <= AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH).trimEnd();
}

/** Flest først, så flest røde, så kodene (stabil rekkefølge). */
function compareRows(a: AiOverrideStatsRow, b: AiOverrideStatsRow): number {
  return (
    b.count - a.count ||
    b.claimCount - a.claimCount ||
    b.previousCount - a.previousCount ||
    a.checkCode.localeCompare(b.checkCode) ||
    (a.checkpointKey ?? "").localeCompare(b.checkpointKey ?? "") ||
    a.reasonCode.localeCompare(b.reasonCode)
  );
}

/**
 * Bygger tallgrunnlaget til `override_summary` fra tellingene (A570, A573, A577): etiketter fra
 * kodelistene, andel og endring regnet her, høyst `AI_OVERRIDE_STATS_MAX_ROWS` linjer (lavest
 * antall kuttes først, antallet kuttet står i `rowsCut`). Inndata og svar valideres strengt;
 * ukjent nøkkel, kode utenfor nøkkelformatet eller tall som ikke er heltall gir feil.
 */
export function buildOverrideSummaryInput(source: OverrideSummaryInputSource): {
  stats: AiOverrideStats;
  rowsCut: number;
} {
  const input = sourceSchema.parse(source);
  const rows = input.rows
    .map((row): AiOverrideStatsRow => {
      const sharePercent = computeOverrideShare(row.count, input.reportCount);
      const previousSharePercent = computeOverrideShare(
        row.previousCount,
        input.previousReportCount,
      );
      return {
        checkCode: row.checkCode,
        checkLabel: publishCheckLabel(row.checkCode),
        checkpointKey: row.checkpointKey,
        checkpointName: row.checkpointKey === null ? null : shortName(row.checkpointName),
        reasonCode: row.reasonCode,
        reasonLabel: publishOverrideReasonLabel(row.reasonCode),
        count: row.count,
        sharePercent,
        claimCount: row.claimCount,
        previousCount: row.previousCount,
        previousSharePercent,
        deltaCount: row.count - row.previousCount,
        deltaPoints:
          sharePercent === null || previousSharePercent === null
            ? null
            : sharePercent - previousSharePercent,
      };
    })
    .sort(compareRows);
  const kept = rows.slice(0, AI_OVERRIDE_STATS_MAX_ROWS);
  const stats = overrideStatsSchema.parse({
    month: input.month,
    reportCount: input.reportCount,
    previousMonth: { reportCount: input.previousReportCount },
    rows: kept,
  });
  return { stats, rowsCut: rows.length - kept.length };
}
