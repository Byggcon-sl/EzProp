// MIDLERTIDIG STUBB for bit 2. Erstattes av bit 1.
export const ACTIVITY_INTERVAL_SECONDS = 60;

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
  if (lastSentAt === null) return true;
  if (now.getTime() - lastSentAt.getTime() < ACTIVITY_INTERVAL_SECONDS * 1000) return false;
  return lastActivityAt !== null && lastActivityAt.getTime() > lastSentAt.getTime();
}
