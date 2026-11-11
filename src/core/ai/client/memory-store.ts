import type { AiQueueStore, AiQueueStoreChange, CreateMemoryAiQueueStore } from "./types";

/*
 * Minneutgaven av lageret for KI-køen, til enhetstester. Oppfører seg som IndexedDB-utgaven:
 * holder rå poster (`unknown`), nøkkel er `requestId`, og `update` leser, avgjør og skriver i ett
 * steg. Kan fylles med ugyldige poster for å prøve lesesjekken.
 */

export type MemoryAiQueueStoreOptions = {
  /** Gis den inn, kaster `update` og `clear` feilen den lager, i stedet for å røre lageret. */
  failWith?: () => Error;
};

export type MemoryAiQueueStore = AiQueueStore & {
  /** Rått innhold slik det ligger i lageret, i innsettingsrekkefølge. */
  snapshot(): unknown[];
  /** Slår feil på (`failWith`) eller av (`null`) underveis i en test. */
  setFailure(failWith: (() => Error) | null): void;
};

function requestIdOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, "requestId")
    ? (value as { requestId?: unknown }).requestId
    : undefined;
}

export function createMemoryAiQueueStore(
  initial: readonly unknown[] = [],
  options: MemoryAiQueueStoreOptions = {},
): MemoryAiQueueStore {
  let rows: unknown[] = [...initial];
  let failWith = options.failWith ?? null;

  function failIfSet(): void {
    if (failWith) throw failWith();
  }

  return {
    async update<T>(decide: (stored: readonly unknown[]) => AiQueueStoreChange<T>): Promise<T> {
      await Promise.resolve();
      failIfSet();
      const change = decide([...rows]);
      const removed = new Set<unknown>(change.remove);
      rows = rows.filter((row) => !removed.has(requestIdOf(row)));
      for (const entry of change.put) {
        // IndexedDB lagrer en kopi. Det gjør minneutgaven også.
        const copy = structuredClone(entry);
        const index = rows.findIndex((row) => requestIdOf(row) === entry.requestId);
        if (index === -1) rows.push(copy);
        else rows[index] = copy;
      }
      return change.result;
    },
    async clear(): Promise<void> {
      await Promise.resolve();
      failIfSet();
      rows = [];
    },
    snapshot(): unknown[] {
      return [...rows];
    },
    setFailure(next: (() => Error) | null): void {
      failWith = next;
    },
  };
}

createMemoryAiQueueStore satisfies CreateMemoryAiQueueStore;
