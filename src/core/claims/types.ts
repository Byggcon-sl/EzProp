import type { Actor } from "@/core/access";

/**
 * «Kan gjelde reklamasjonen» (docs/funksjoner/fase2a-tg-spor.md, forbedreren 3). Støtter
 * hovedmålet færre reklamasjoner: leder finner punktet klagen gjelder uten å lete.
 *
 * `src/core/claims` eier `claims.building_part_text`. Derfor skjer sammenligningen her, og
 * `src/core/reports` får bare id-ene tilbake.
 */

/** Én kandidat: en id kalleren kjenner igjen, og navnene som kan passe (romtype, rom, punkt). */
export type ClaimMatchCandidate = {
  id: string;
  names: readonly string[];
};

/**
 * Sammenligner ordene i sakens `building_part_text` med navnene på kandidatene og gir id-ene som
 * treffer (`claims.read`, bare leder og admin, regel 12).
 *
 * - Saken hentes med `grant.organizationId` og `deleted_at is null`. Fremmed, fjernet eller
 *   ugyldig id gir `AccessDeniedError` (404), som `getClaim`.
 * - Ren tekstsammenligning uten KI: små bokstaver, tegn og tall skilt ut, ord under tre tegn og
 *   fyllord tas bort, og et treff er et helt ord som står i begge. Tom tekst gir tom liste.
 * - **Teksten går aldri ut:** svaret har bare id-er. Verken teksten, ordene eller hvilke ord som
 *   traff, sendes til kalleren, logges eller går til KI (`claims.building_part_text` står i
 *   `NEVER_FIELDS`).
 * - Høyst `CLAIM_MATCH_CANDIDATES_MAX` kandidater; flere gir tom liste (feiler lukket).
 * - Leser aldri rapporttabellene. Importerer aldri `@/core/reports` (retningen er
 *   `core/reports` → `core/claims`).
 */
export type MatchClaimBuildingPart = (
  actor: Actor,
  organizationId: string,
  claimId: string,
  candidates: readonly ClaimMatchCandidate[],
) => Promise<{ matchedIds: string[] }>;

/** Høyeste antall kandidater i ett kall til `matchClaimBuildingPart`. */
export const CLAIM_MATCH_CANDIDATES_MAX = 2000;
