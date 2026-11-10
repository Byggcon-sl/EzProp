import type { Permission } from "@/core/access";
import type { AiErrorCode, AiOutcome, AiSuggestionStatus } from "@/db/schema";

/*
 * Typene for KI-modulen (ADR 0006 del 1 og 2). ADR-en var retning; koden her er fasit.
 */

export type { AiErrorCode, AiOutcome, AiSuggestionStatus };

/** Faste koder for KI-funksjonene (regel 6). Flere kommer per funksjon. */
export const AI_FEATURE_CODES = ["language_polish"] as const;
export type AiFeatureCode = (typeof AI_FEATURE_CODES)[number];

/** Hvor forslaget gjelder: måltype, id og feltkode. */
export type AiTargetRef = { type: string; id: string; fieldKey: string };

export type AiSuggestionRequest = {
  /** UUID laget på enheten. Blir id-en i `ai_usage_log`. */
  requestId: string;
  feature: AiFeatureCode;
  assignmentId: string | null;
  /** Må være tom til `reports` er bygget (A158). */
  reportId: string | null;
  target: AiTargetRef;
  /** Feltkode → verdi. Bare koder fra funksjonens tillatt-liste. */
  fields: Record<string, string>;
  /** Avvises hvis med innhold. Brukes av første frasefunksjon i 2a-2. */
  candidates?: { id: string; text: string }[];
};

export type AiSuggestionResult =
  | {
      kind: "suggestion";
      usageId: string;
      status: "suggested";
      text: string;
      candidateId: string | null;
    }
  | { kind: "no_match"; usageId: string }
  | { kind: "error"; usageId: string }
  /** KI er av: ingen rad, intet kall. */
  | { kind: "disabled" };

/** Kortnavn brukt i oppgavekortet. */
export type AiRequest = AiSuggestionRequest;
export type AiResponse = AiSuggestionResult;

export type AiDecision = "accepted" | "edited" | "rejected" | "undo";

/** Et lovlig mål for en funksjon: måltype og feltkode. */
export type AiAllowedTarget = { type: string; fieldKey: string };

/** Definisjonen av én KI-funksjon. Data, med test (regel 5 og 6). */
export type AiFeatureDefinition = {
  code: AiFeatureCode;
  /** Rettigheten som kreves for å be om og avgjøre forslag. */
  permission: Permission;
  /** Feltkodene som kan sendes. Alt annet avvises (ADR 0006 del 6). */
  allowedFields: readonly string[];
  allowedTargets: readonly AiAllowedTarget[];
  /** Ny versjon ved hver endring av ledeteksten. */
  promptVersion: string;
  /** Den faste ledeteksten for versjonen over. */
  instructions: string;
  /** Bygger hele ledeteksten fra feltene (bare koder fra tillatt-listen). */
  buildPrompt(fields: Readonly<Record<string, string>>): string;
};

export type AiProviderRequest = {
  feature: AiFeatureCode;
  promptVersion: string;
  /** Ferdig bygget av `src/core/ai`. */
  prompt: string;
  model: string;
};

export type AiProviderResult =
  | {
      outcome: "ok";
      text: string;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      currency: string;
    }
  | {
      outcome: "no_match";
      tokensIn: number;
      tokensOut: number;
      cost: number;
      currency: string;
    }
  | { outcome: "error"; errorCode: AiErrorCode };

export interface AiProvider {
  /** Fast kode fra `PROVIDERS_BY_PORT.ai`. */
  readonly code: string;
  complete(request: AiProviderRequest): Promise<AiProviderResult>;
}
