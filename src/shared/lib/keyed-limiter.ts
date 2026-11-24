/**
 * Teller for pågående arbeid per nøkkel, med et felles tak (ADR 0016 punkt 9, A539). Generisk:
 * kjenner verken PDF, ansatte eller organisasjoner. Rutene bruker `grant.employeeId` som nøkkel.
 *
 * Telleren gjelder per prosess. Med flere instanser ganges det felles taket med antall
 * instanser. Den holder ingen kø: fullt tak gir avslag med en gang, og ruten svarer 429.
 */

export type KeyedLimiterOptions = {
  /** Høyeste antall pågående på tvers av alle nøkler. */
  maxTotal: number;
  /** Høyeste antall pågående per nøkkel. */
  maxPerKey: number;
  /**
   * En plass som ikke er frigitt etter så lang tid, regnes som tapt og frigis. Sikrer at en feil
   * i ruten aldri stenger en ansatt ute for godt. Settes over tidsgrensen for arbeidet.
   */
  staleAfterMs: number;
  /** Klokken i millisekunder. Standard er `Date.now`. Byttes i testene. */
  now?: () => number;
};

export type KeyedLimiterRejection = "key_busy" | "total_busy";

export type KeyedLimiterAcquire =
  /** `release` tåler å kalles flere ganger. Kalles i `finally`. */
  { ok: true; release: () => void } | { ok: false; reason: KeyedLimiterRejection };

export type KeyedLimiter = {
  tryAcquire: (key: string) => KeyedLimiterAcquire;
  /** Antall pågående akkurat nå (til tester og helsesjekk). */
  active: () => number;
};

export type CreateKeyedLimiter = (options: KeyedLimiterOptions) => KeyedLimiter;

type Slot = { key: string; startedAt: number };

/**
 * Lager en teller. Plasser eldre enn `staleAfterMs` ryddes ved hvert nytt forsøk, slik at en tapt
 * `release` aldri holder plassen for alltid. Ingen tidtakere: klokken leses bare ved kall.
 *
 * Nøkkelen sjekkes før det felles taket: har den ansatte alt en pågående, får hen `key_busy`
 * («En PDF lages allerede») også når taket er fullt.
 */
export const createKeyedLimiter: CreateKeyedLimiter = (options) => {
  const { maxTotal, maxPerKey, staleAfterMs } = options;
  if (!Number.isSafeInteger(maxTotal) || maxTotal < 1) {
    throw new RangeError("maxTotal må være et heltall over 0.");
  }
  if (!Number.isSafeInteger(maxPerKey) || maxPerKey < 1) {
    throw new RangeError("maxPerKey må være et heltall over 0.");
  }
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new RangeError("staleAfterMs må være over 0.");
  }
  const now = options.now ?? Date.now;
  const slots = new Set<Slot>();

  const dropStale = (at: number) => {
    for (const slot of slots) {
      if (at - slot.startedAt >= staleAfterMs) slots.delete(slot);
    }
  };

  return {
    tryAcquire(key) {
      const at = now();
      dropStale(at);
      let forKey = 0;
      for (const slot of slots) if (slot.key === key) forKey += 1;
      if (forKey >= maxPerKey) return { ok: false, reason: "key_busy" };
      if (slots.size >= maxTotal) return { ok: false, reason: "total_busy" };
      const slot: Slot = { key, startedAt: at };
      slots.add(slot);
      return {
        ok: true,
        // Å slette en plass som alt er frigitt eller ryddet, gjør ingenting.
        release: () => {
          slots.delete(slot);
        },
      };
    },
    active() {
      dropStale(now());
      return slots.size;
    },
  };
};
