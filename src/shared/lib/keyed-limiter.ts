/**
 * Teller for pågående arbeid per nøkkel, med et felles tak (ADR 0016 punkt 9, A539). Generisk:
 * kjenner verken PDF, ansatte eller organisasjoner. Rutene bruker `grant.employeeId` som nøkkel.
 *
 * Telleren gjelder per prosess. Med flere instanser ganges det felles taket med antall
 * instanser. Den holder ingen kø: fullt tak gir avslag med en gang, og ruten svarer 429.
 * Utvikleren legger til `createKeyedLimiter` i denne filen.
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
