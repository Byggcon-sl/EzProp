import type { AiFeatureCode } from "../types";

/*
 * Tillatt-listen slik klienten kjenner den: feltkodene en post i KI-køen kan ha per funksjon.
 * Skal være lik `AI_FEATURES[*].allowedFields` i `../features.ts`; en statisk test holder dem
 * like. Listen står her fordi `features.ts` har ledetekstene og ikke skal lastes i nettleseren.
 *
 * GJENNOMGANG KREVES: endring her krever gjennomgang av sikkerhet-personvern i PR-en (A175).
 */
export const AI_QUEUE_ALLOWED_FIELDS: Readonly<Record<AiFeatureCode, readonly string[]>> = {
  language_polish: ["text"],
};
