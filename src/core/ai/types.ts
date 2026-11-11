import type { AiErrorCode, AiOutcome, AiSuggestionStatus, AiTargetRef } from "@/db/schema";

/*
 * Den offentlige flaten til KI-modulen (docs/adr/0006-ki-i-bunnen.md del 1 og 2).
 * Støtter hovedmål: KI i bunnen (én vei inn til all KI, alt logges likt).
 */

export type { AiErrorCode, AiOutcome, AiSuggestionStatus, AiTargetRef };

/** Faste funksjonskoder (regel 6). Flere kommer, én per KI-funksjon. */
export type AiFeatureCode = "language_polish";

export type AiSuggestionRequest = {
  /** UUID laget på enheten. Blir id-en i `ai_usage_log`. */
  requestId: string;
  feature: AiFeatureCode;
  assignmentId: string | null;
  /** Må være tom til `reports` finnes (A158). */
  reportId: string | null;
  target: AiTargetRef;
  /** Feltkode → verdi. Bare koder fra funksjonens tillatt-liste. */
  fields: Record<string, string>;
  /** Ikke i bruk ennå: må mangle eller være tom. */
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
  | { kind: "disabled" }
  /** Sperret før leverandøren ble kalt (ad-1). Raden finnes, men vises aldri som forslag. */
  | { kind: "blocked" };

export type AiDecision = "accepted" | "edited" | "rejected" | "undo";

export const AI_DECISIONS = ["accepted", "edited", "rejected", "undo"] as const;
