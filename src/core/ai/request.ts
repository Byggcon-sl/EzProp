import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import { AiRequestRejectedError } from "./errors";
import { getFeatureDefinition } from "./features";
import { AI_FEATURE_CODES, type AiFeatureDefinition, type AiSuggestionRequest } from "./types";

/*
 * Streng validering av forespørselen (kortet Omfang 3.1). Ukjente nøkler gir avslag, også på
 * toppnivå: `organizationId`, `employeeId` og `provider` kommer aldri fra kalleren. Om feltkodene
 * står på tillatt-listen, sjekkes etter rettigheten (Omfang 3.3, `assertAllowedFields`).
 */

export const MAX_FIELD_LENGTH = 5000;

const uuidSchema = z.string().refine(isUuid);

export const aiRequestSchema = z
  .object({
    requestId: uuidSchema,
    feature: z.enum(AI_FEATURE_CODES),
    assignmentId: uuidSchema.nullable().optional(),
    // `reports` finnes ikke ennå (A158)
    reportId: z.null().optional(),
    target: z
      .object({
        type: z.string().min(1),
        id: uuidSchema,
        fieldKey: z.string().min(1),
      })
      .strict(),
    fields: z.record(z.string(), z.string().max(MAX_FIELD_LENGTH)),
    // Ingen funksjon bruker kandidater ennå
    candidates: z.array(z.unknown()).max(0).optional(),
  })
  .strict();

export type ParsedAiRequest = {
  request: AiSuggestionRequest;
  definition: AiFeatureDefinition;
};

/** Validerer forespørselen, eller kaster det nøytrale avslaget. */
export function parseAiRequest(input: unknown): ParsedAiRequest {
  const parsed = aiRequestSchema.safeParse(input);
  if (!parsed.success) throw new AiRequestRejectedError();
  const data = parsed.data;
  const definition = getFeatureDefinition(data.feature);
  if (!definition) throw new AiRequestRejectedError();

  const target = data.target;
  const targetAllowed = definition.allowedTargets.some(
    (allowed) => allowed.type === target.type && allowed.fieldKey === target.fieldKey,
  );
  if (!targetAllowed) throw new AiRequestRejectedError();

  return {
    definition,
    request: {
      requestId: data.requestId,
      feature: data.feature,
      assignmentId: data.assignmentId ?? null,
      reportId: null,
      target: { type: target.type, id: target.id, fieldKey: target.fieldKey },
      fields: data.fields,
    },
  };
}

/** Alle feltkoder må stå på funksjonens tillatt-liste (ADR 0006 del 6). */
export function assertAllowedFields(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
): void {
  for (const key of Object.keys(fields)) {
    if (!definition.allowedFields.includes(key)) throw new AiRequestRejectedError();
  }
}
