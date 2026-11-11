import type { AiErrorCode } from "@/db/schema";
import type { AiFeatureCode } from "../types";

/*
 * Grensesnittet mot en KI-leverandør (docs/adr/0006-ki-i-bunnen.md del 2). Adapterne er `fake`
 * og `anthropic` (S8, Ståle 10.11.2026). Ingen SDK: en ekte adapter bruker innebygd `fetch`, og
 * bare i `src/core/ai/providers/`.
 */

export type AiProviderRequest = {
  feature: AiFeatureCode;
  promptVersion: string;
  /** Ferdig bygget av `src/core/ai` fra tillatt-listen. */
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
  | { outcome: "no_match"; tokensIn: number; tokensOut: number; cost: number; currency: string }
  | { outcome: "error"; errorCode: AiErrorCode };

export interface AiProvider {
  /** Fast kode fra `PROVIDERS_BY_PORT.ai`. */
  readonly code: string;
  /** Modellen adapteren bruker. */
  readonly model: string;
  complete(request: AiProviderRequest): Promise<AiProviderResult>;
}
