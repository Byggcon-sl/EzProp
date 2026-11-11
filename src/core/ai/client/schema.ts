import { z } from "zod";

import { AI_FIELD_MAX_LENGTH } from "../limits";
import type { AiFeatureCode } from "../types";
import { AI_QUEUE_ALLOWED_FIELDS } from "./allowed-fields";
import type { AiQueueEntry } from "./types";

/*
 * Skjemaet for én post i KI-køen. Kjøres på hver lesing: lageret validerer ikke, og en post kan
 * være skrevet av en eldre versjon, en annen fane eller være laget med `JSON.parse`.
 * Feltkodene sjekkes som egne nøkler (`Object.hasOwn`, `Object.getOwnPropertyNames`), så
 * `__proto__`, `constructor` og `prototype` aldri slipper gjennom.
 */

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** `true` når `value` er en funksjonskode i tillatt-listen. */
export function isAiQueueFeature(value: unknown): value is AiFeatureCode {
  return typeof value === "string" && Object.hasOwn(AI_QUEUE_ALLOWED_FIELDS, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Sjekker feltene mot tillatt-listen for funksjonen: minst ett felt, bare tillatte koder, bare
 * strenger. Gir `"too_long"` når formen er riktig, men en verdi er lengre enn
 * `AI_FIELD_MAX_LENGTH`.
 */
export function checkAiQueueFields(
  feature: AiFeatureCode,
  fields: unknown,
): "ok" | "too_long" | "invalid" {
  if (!isPlainObject(fields)) return "invalid";
  if (Object.getOwnPropertySymbols(fields).length > 0) return "invalid";
  const keys = Object.getOwnPropertyNames(fields);
  // Ikke-tellbare nøkler er ikke en vanlig post.
  if (keys.length === 0 || keys.length !== Object.keys(fields).length) return "invalid";
  const allowed = AI_QUEUE_ALLOWED_FIELDS[feature];
  let tooLong = false;
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.includes(key)) return "invalid";
    const descriptor = Object.getOwnPropertyDescriptor(fields, key);
    if (!descriptor || !("value" in descriptor)) return "invalid";
    const value: unknown = descriptor.value;
    if (typeof value !== "string") return "invalid";
    if (value.length > AI_FIELD_MAX_LENGTH) tooLong = true;
  }
  return tooLong ? "too_long" : "ok";
}

const nonEmpty = z.string().min(1);

/** Streng form på en post. Ingen ekstra nøkler. */
export const aiQueueEntrySchema = z
  .strictObject({
    requestId: z.uuid(),
    feature: z.custom<AiFeatureCode>(isAiQueueFeature),
    targetType: nonEmpty,
    targetId: nonEmpty,
    fieldKey: nonEmpty,
    assignmentId: z.string().nullable(),
    organizationId: nonEmpty,
    employeeId: nonEmpty,
    fields: z.custom<Record<string, string>>(isPlainObject),
    queuedAt: z.number().finite(),
    attempts: z.number().int().min(0),
  })
  .superRefine((entry, ctx) => {
    if (checkAiQueueFields(entry.feature, entry.fields) !== "ok") {
      ctx.addIssue({ code: "custom", path: ["fields"], message: "fields" });
    }
  }) satisfies z.ZodType<AiQueueEntry>;

/**
 * Gir posten som en ny, ren `AiQueueEntry`, eller `null` hvis den ikke passer. Kaster aldri.
 * Alt kopieres til nye objekter, så posten ikke deler referanse med lageret.
 */
export function parseAiQueueEntry(value: unknown): AiQueueEntry | null {
  let parsed;
  try {
    parsed = aiQueueEntrySchema.safeParse(value);
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const entry = parsed.data;
  const fields: Record<string, string> = {};
  for (const key of Object.keys(entry.fields)) {
    fields[key] = entry.fields[key] as string;
  }
  return {
    requestId: entry.requestId,
    feature: entry.feature,
    targetType: entry.targetType,
    targetId: entry.targetId,
    fieldKey: entry.fieldKey,
    assignmentId: entry.assignmentId,
    organizationId: entry.organizationId,
    employeeId: entry.employeeId,
    fields,
    queuedAt: entry.queuedAt,
    attempts: entry.attempts,
  };
}
