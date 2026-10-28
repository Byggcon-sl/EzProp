import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sjekker at en id fra URL-en eller enheten har riktig format før den brukes i en spørring. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * UUID versjon 7: tilfeldig, men sorterer etter tid (docs/05-domenemodell.md avsnitt 3).
 * ID-er lages på enheten (iPad eller PC), slik at rader kan opprettes uten nett.
 * Samme algoritme skal brukes i nettleseren (fase 1); her er serverens utgave.
 */
export function uuidv7(now: number = Date.now()): string {
  const random = randomUUID().replace(/-/g, "");
  const time = now.toString(16).padStart(12, "0");
  // 48 bit tid, versjon 7, 12 bit tilfeldig, variant 10xx, 62 bit tilfeldig
  const hex =
    time +
    "7" +
    random.slice(13, 16) +
    ((parseInt(random.slice(16, 17), 16) & 0x3) | 0x8).toString(16) +
    random.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
