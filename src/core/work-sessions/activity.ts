/*
 * Når måleren på siden sender aktivitet (docs/funksjoner/fase2a-tidsmaling.md punkt 4). Ren
 * funksjon uten serverkode, så klientkomponenten kan importere filen direkte.
 */

/** Høyst ett kall per så mange sekunder. */
export const ACTIVITY_INTERVAL_SECONDS = 60;

/**
 * Skal måleren sende nå? Aldri når fanen er skjult. Første kall sendes straks. Deretter bare når
 * det har gått minst 60 sekunder og det har vært aktivitet etter forrige kall (lik tid regnes
 * som ingen ny aktivitet).
 */
export function shouldSendActivity({
  lastSentAt,
  lastActivityAt,
  visible,
  now,
}: {
  lastSentAt: Date | null;
  lastActivityAt: Date | null;
  visible: boolean;
  now: Date;
}): boolean {
  if (!visible) return false;
  if (!lastSentAt) return true;
  if (now.getTime() - lastSentAt.getTime() < ACTIVITY_INTERVAL_SECONDS * 1000) return false;
  return lastActivityAt !== null && lastActivityAt.getTime() > lastSentAt.getTime();
}
