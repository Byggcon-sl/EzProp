/**
 * Fast tilfeldighet for testdataene (`pnpm db:seed:testdata`). Samme frø gir alltid samme
 * rekkefølge, slik at to kjøringer lager like data. Egen liten generator (mulberry32), ingen pakke.
 * Brukes bare til oppdiktede testdata, aldri til noe som skal være hemmelig.
 */
export type SeededRandom = {
  /** Neste tall, 0 ≤ x < 1. */
  next(): number;
  /** Heltall fra og med `min` til og med `max`. */
  int(min: number, max: number): number;
  /** Ett element fra listen. Kaster hvis listen er tom. */
  pick<T>(list: readonly T[]): T;
};

export function createSeededRandom(seed: number): SeededRandom {
  if (!Number.isFinite(seed)) throw new Error("Frøet må være et endelig tall.");
  let state = Math.trunc(seed) >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error("int(min, max) krever heltall der min ikke er større enn max.");
    }
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(list: readonly T[]): T {
    if (list.length === 0) throw new Error("Kan ikke velge fra en tom liste.");
    return list[int(0, list.length - 1)] as T;
  }

  return { next, int, pick };
}
