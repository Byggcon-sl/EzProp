import type { AiFeatureCode } from "../types";

/*
 * Tillatt-listen slik klienten kjenner den: feltkodene en post i KI-køen kan ha per funksjon.
 * Skal være lik `AI_FEATURES[*].allowedFields` i `../features.ts`; en statisk test holder dem
 * like. Listen står her fordi `features.ts` har ledetekstene og ikke skal lastes i nettleseren.
 *
 * Bare `language_polish` kan stå i køen. `phrase_suggest` og `summary_draft` trenger kandidater
 * og funn fra serveren og nett (A485, A439), og køen kobles ikke til badskjermen (A441).
 *
 * GJENNOMGANG KREVES: endring her krever gjennomgang av sikkerhet-personvern i PR-en (A175).
 */
export const AI_QUEUE_ALLOWED_FIELDS: Readonly<Partial<Record<AiFeatureCode, readonly string[]>>> =
  {
    language_polish: ["text"],
  };
