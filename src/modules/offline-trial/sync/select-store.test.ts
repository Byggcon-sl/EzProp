import { describe, expect, it } from "vitest";
import { readSyncCandidate, writeSyncCandidate } from "./select-store";
import { TRIAL_SYNC_CANDIDATE_KEY, TRIAL_SYNC_CANDIDATES } from "./types";

// Valg av kandidat (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 7). Testplan avsnitt 2.4.
// openTrialStore (dynamisk import) testes bare i e2e. Hovedmål: tid (samme skjema, to kandidater).

/** Falsk `Storage` bygget på en Map (Vitest har ingen DOM). */
function fakeStorage(initial: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

describe("readSyncCandidate og writeSyncCandidate", () => {
  it("standard er powersync når ingenting er lagret", () => {
    expect(readSyncCandidate(fakeStorage())).toBe("powersync");
  });

  it("lagret electricsql leses tilbake", () => {
    expect(readSyncCandidate(fakeStorage({ trial_sync_candidate: "electricsql" }))).toBe(
      "electricsql",
    );
    expect(readSyncCandidate(fakeStorage({ trial_sync_candidate: "powersync" }))).toBe("powersync");
  });

  it("ukjent verdi gir powersync, ikke krasj", () => {
    for (const value of ["pglite", "", "ELECTRICSQL", " electricsql", "null"]) {
      expect(readSyncCandidate(fakeStorage({ trial_sync_candidate: value })), value).toBe(
        "powersync",
      );
    }
  });

  it("writeSyncCandidate skriver nøkkelen trial_sync_candidate", () => {
    const storage = fakeStorage();
    writeSyncCandidate("electricsql", storage);
    expect(storage.map.get("trial_sync_candidate")).toBe("electricsql");
    expect(readSyncCandidate(storage)).toBe("electricsql");
    writeSyncCandidate("powersync", storage);
    expect(storage.map.get("trial_sync_candidate")).toBe("powersync");
    // Rører ikke andre nøkler (enhets-id, sist brukte organisasjon)
    expect(Array.from(storage.map.keys())).toEqual(["trial_sync_candidate"]);
  });

  it("nøkkelen er trial_sync_candidate og verdiene bare powersync og electricsql", () => {
    expect(TRIAL_SYNC_CANDIDATE_KEY).toBe("trial_sync_candidate");
    expect([...TRIAL_SYNC_CANDIDATES]).toEqual(["powersync", "electricsql"]);
  });
});
