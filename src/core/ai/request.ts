import { z } from "zod";
import { ORGANIZATION_AI_TARGET_TYPES, RESOLVED_AI_TARGET_TYPES } from "@/shared/config/ai-targets";
import { isUuid } from "@/shared/lib/uuid";
import {
  AI_FEATURES,
  ARCHIVED_AI_TARGET_TYPES,
  getFeatureDefinition,
  type AiFeatureDefinition,
} from "./features";
import { AI_FIELD_MAX_LENGTH } from "./limits";
import type { AiFeatureCode } from "./types";

/*
 * Validering av forespørselen til `requestSuggestion` (docs/funksjoner/fase2a-ki-modul-logg.md
 * Omfang 3.1 og 3.3, og «KI i veien»). Strengt: ukjente nøkler avvises på alle nivåer.
 * Organisasjon, ansatt og leverandør kommer aldri fra forespørselen.
 *
 * Det nettleseren aldri kan sende (ADR 0006, tillegg 17.11.2026, del 1):
 * - `candidates` med innhold og `findings`/`summaryGroups`: kommer bare fra serveren, i
 *   `AiServerInput` (tredje argument).
 * - `reportId`: utledes alltid av kjernen fra målet.
 * - `assignmentId` for måltypene kjernen slår opp selv (`RESOLVED_AI_TARGET_TYPES` og
 *   organisasjonsmålene i `ORGANIZATION_AI_TARGET_TYPES`): oppdraget utledes fra målet, eller
 *   finnes ikke.
 * - En arkivert måltype (`ARCHIVED_AI_TARGET_TYPES`).
 */

/** Står i `limits.ts`, slik at klientdelen kan bruke grensen uten å laste denne filen. */
export { AI_FIELD_MAX_LENGTH };

const uuidSchema = z.string().refine(isUuid);
const featureCodes = Object.keys(AI_FEATURES) as [AiFeatureCode, ...AiFeatureCode[]];
// Organisasjonsmålene slås også opp av kjernen (ADR 0006, tillegg 24.11.2026), men gir verken
// rapport eller oppdrag
const resolvedTypes: ReadonlySet<string> = new Set([
  ...RESOLVED_AI_TARGET_TYPES,
  ...ORGANIZATION_AI_TARGET_TYPES,
]);
const organizationTypes: ReadonlySet<string> = new Set(ORGANIZATION_AI_TARGET_TYPES);

const targetSchema = z
  .object({
    type: z.string().min(1),
    id: uuidSchema,
    fieldKey: z.string().min(1),
  })
  .strict();

/** Om kjernen selv slår opp målraden og utleder rapport og oppdrag. */
export function isResolvedTargetType(type: string): boolean {
  return resolvedTypes.has(type);
}

/** Om målet hører til organisasjonen, ikke til en rapport eller et oppdrag. */
export function isOrganizationTargetType(type: string): boolean {
  return organizationTypes.has(type);
}

/**
 * Formen på forespørselen og målet, men ikke tillatt-listen for feltene. `requestSuggestion`
 * sjekker rettigheten mellom disse to trinnene (Omfang 3.2).
 */
export const aiSuggestionRequestShapeSchema = z
  .object({
    requestId: uuidSchema,
    feature: z.enum(featureCodes),
    assignmentId: uuidSchema.nullable(),
    // Utledes alltid av kjernen fra målet: bare tom
    reportId: z.null().optional(),
    target: targetSchema,
    fields: z.record(z.string(), z.string().max(AI_FIELD_MAX_LENGTH)),
    // Kandidater kommer bare fra serveren (`AiServerInput`): mangler eller tom
    candidates: z.array(z.never()).max(0).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const definition = getFeatureDefinition(request.feature);
    if (
      !definition ||
      ARCHIVED_AI_TARGET_TYPES.includes(request.target.type) ||
      !isAllowedTarget(definition, request.target)
    ) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Ulovlig mål." });
    }
    // Oppdraget utledes av kjernen for målene den slår opp selv
    if (isResolvedTargetType(request.target.type) && request.assignmentId !== null) {
      ctx.addIssue({ code: "custom", path: ["assignmentId"], message: "Ikke lov for målet." });
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
