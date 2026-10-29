import { describe, expect, it } from "vitest";
import { readSyncCandidate, writeSyncCandidate } from "./select-store";
import { TRIAL_SYNC_CANDIDATE_KEY, TRIAL_SYNC_CANDIDATES } from "./types";

// Valg av kandidat i nettleseren (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 7).
// Testplan avsnitt 2.4. Lagringen sendes inn (som getTrialDeviceId), så ingen DOM trengs.
// openTrialStore (dynamisk import) testes bare i e2e.

/** `localStorage`-lik lagring over en Map. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

describe("readSyncCandidate og writeSyncCandidate (select-store.ts)", () => {
  it("standard er powersync når ingenting er lagret", () => {
    expect(readSyncCandidate(memoryStorage())).toBe("powersync");
  });

  it("lagret electricsql leses tilbake", () => {
    expect(readSyncCandidate(memoryStorage({ trial_sync_candidate: "electricsql" }))).toBe(
      "electricsql",
    );
    expect(readSyncCandidate(memoryStorage({ trial_sync_candidate: "powersync" }))).toBe(
      "powersync",
    );
  });

  it("lagret custom leses tilbake", () => {
    expect(readSyncCandidate(memoryStorage({ trial_sync_candidate: "custom" }))).toBe("custom");
  });

  it("ukjent verdi gir powersync, ikke krasj", () => {
    for (const value of ["pglite", "", "ELECTRICSQL", " electricsql", "null"]) {
      expect(readSyncCandidate(memoryStorage({ trial_sync_candidate: value })), value).toBe(
        "powersync",
      );
    }
  });

  it("writeSyncCandidate skriver nøkkelen trial_sync_candidate", () => {
    const storage = memoryStorage();
    writeSyncCandidate("electricsql", storage);
    expect(storage.map.get("trial_sync_candidate")).toBe("electricsql");
    expect(readSyncCandidate(storage)).toBe("electricsql");
    writeSyncCandidate("powersync", storage);
    expect(storage.map.get("trial_sync_candidate")).toBe("powersync");
    // Ingen andre nøkler røres
    expect(Array.from(storage.map.keys())).toEqual(["trial_sync_candidate"]);
  });

  it("custom med store bokstaver eller norsk navn gir powersync", () => {
    for (const value of ["CUSTOM", "egenbygd"]) {
      expect(readSyncCandidate(memoryStorage({ trial_sync_candidate: value })), value).toBe(
        "powersync",
      );
    }
  });

  it("nøkkelen er trial_sync_candidate og verdiene powersync, electricsql og custom", () => {
    expect(TRIAL_SYNC_CANDIDATE_KEY).toBe("trial_sync_candidate");
    expect([...TRIAL_SYNC_CANDIDATES]).toEqual(["powersync", "electricsql", "custom"]);
  });
});
