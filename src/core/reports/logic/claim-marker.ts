import { todayInOslo } from "@/shared/lib/dates";
import type { ClassifyClaimMarker } from "../override-types";

/*
 * Markeringen av en overstyring på siden «Overstyringer» (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A566 og A571). Rene funksjoner; tjenesten regner `isLatestReleaseBeforeClaim` i SQL med samme
 * regel som `latestReleaseOnOrBefore` under.
 *
 * Støtter hovedmål: færre reklamasjoner (leder ser hvilke sperrer som ikke bør krysses bort).
 */

/**
 * Se `ClassifyClaimMarker`. Rød når en reklamasjon har samme kontrollpunkt og utgivelsen er den
 * siste kunden fikk før reklamasjonen; nøytral når en slik reklamasjon mangler punkt. Rød vinner
 * over nøytral. En overstyring for hele rapporten (uten punkt) er aldri markert.
 */
export const classifyClaimMarker: ClassifyClaimMarker = ({ checkpointKey, claims }) => {
  if (checkpointKey === null) return "none";
  let neutral = false;
  for (const claim of claims) {
    if (!claim.isLatestReleaseBeforeClaim) continue;
    if (claim.checkpointKey === checkpointKey) return "same_checkpoint";
    if (claim.checkpointKey === null) neutral = true;
  }
  return neutral ? "checkpoint_not_selected" : "none";
};

/** Utgivelsesdatoen i norsk tid (`YYYY-MM-DD`). */
export function osloDateOf(time: Date): string {
  return todayInOslo(time);
}

/**
 * Den siste utgivelsen (høyeste versjon) av rapporten med norsk dato til og med reklamasjonens
 * `received_at` (A571). Samme dag teller med. `null` når alle utgivelsene kom etter reklamasjonen.
 */
export function latestReleaseOnOrBefore(
  releases: readonly { id: string; versionNumber: number; releasedDate: string }[],
  receivedAt: string,
): string | null {
  let best: { id: string; versionNumber: number } | null = null;
  for (const release of releases) {
    if (release.releasedDate > receivedAt) continue;
    if (!best || release.versionNumber > best.versionNumber) best = release;
  }
  return best?.id ?? null;
}
