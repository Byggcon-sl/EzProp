import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import { AI_FEATURES, getFeatureDefinition, type AiFeatureDefinition } from "./features";
import { AI_FIELD_MAX_LENGTH } from "./limits";
import type { AiFeatureCode } from "./types";

/*
 * Validering av forespørselen til `requestSuggestion` (docs/funksjoner/fase2a-ki-modul-logg.md
 * Omfang 3.1 og 3.3). Strengt: ukjente nøkler avvises på alle nivåer. Organisasjon, ansatt og
 * leverandør kommer aldri fra forespørselen.
 */

/** Står i `limits.ts`, slik at klientdelen kan bruke grensen uten å laste denne filen. */
export { AI_FIELD_MAX_LENGTH };

const uuidSchema = z.string().refine(isUuid);
const featureCodes = Object.keys(AI_FEATURES) as [AiFeatureCode, ...AiFeatureCode[]];

const targetSchema = z
  .object({
    type: z.string().min(1),
    id: uuidSchema,
    fieldKey: z.string().min(1),
  })
  .strict();

/**
 * Formen på forespørselen og målet, men ikke tillatt-listen for feltene. `requestSuggestion`
 * sjekker rettigheten mellom disse to trinnene (Omfang 3.2).
 */
export const aiSuggestionRequestShapeSchema = z
  .object({
    requestId: uuidSchema,
    feature: z.enum(featureCodes),
    assignmentId: uuidSchema.nullable(),
    // `reports` finnes ikke ennå (A158): bare tom
    reportId: z.null().optional(),
    target: targetSchema,
    fields: z.record(z.string(), z.string().max(AI_FIELD_MAX_LENGTH)),
    // Ingen funksjon bruker kandidater ennå: mangler eller tom
    candidates: z.array(z.never()).max(0).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const definition = getFeatureDefinition(request.feature);
    if (!definition || !isAllowedTarget(definition, request.target)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Ulovlig mål." });
    }
  });

/** Hele valideringen, også tillatt-listen for feltene. */
export const aiSuggestionRequestSchema = aiSuggestionRequestShapeSchema.superRefine(
  (request, ctx) => {
    const definition = getFeatureDefinition(request.feature);
    if (!definition || !hasOnlyAllowedFields(definition, request.fields)) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: "Felt utenfor tillatt-listen." });
    }
  },
);

export type ParsedAiSuggestionRequest = z.infer<typeof aiSuggestionRequestShapeSchema>;

function isAllowedTarget(
  definition: AiFeatureDefinition,
  target: { type: string; fieldKey: string },
): boolean {
  return definition.allowedTargets.some(
    (allowed) => allowed.type === target.type && allowed.fieldKey === target.fieldKey,
  );
}

/** Om alle feltkodene står på funksjonens tillatt-liste. */
export function hasOnlyAllowedFields(
  definition: AiFeatureDefinition,
  fields: Readonly<Record<string, string>>,
): boolean {
  return Object.keys(fields).every((key) => definition.allowedFields.includes(key));
}
