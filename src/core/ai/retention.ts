/*
 * Oppbevaring av `ai_usage_log` (A157): 10 år fra raden ble laget. Regnes i UTC med
 * `setUTCFullYear`, så 29.02.2028 gir 01.03.2038 (testplan 6.3).
 */
export const AI_RETENTION_YEARS = 10;

export function computeAiRetainUntil(createdAt: Date): Date {
  const retainUntil = new Date(createdAt.getTime());
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + AI_RETENTION_YEARS);
  return retainUntil;
}
