import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearSavedAt, readSyncCandidate, savedAtKey, writeSyncCandidate } from "./select-store";
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

  // Kandidat 3, egenbygd (docs/funksjoner/fase1-kandidat-egenbygd-testplan.md avsnitt 2.4)
  it("custom med store bokstaver eller norsk navn gir powersync", () => {
    for (const value of ["CUSTOM", "Custom", " custom", "egenbygd", "Egenbygd"]) {
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

// «Lagret kl.» per kandidat i localStorage (docs/funksjoner/fase1-synkstatus.md pkt. 7, A6).
// Testplan synkstatus avsnitt 2.5. `clearIfOtherOrganization` laster kandidatene med dynamisk
// import (IndexedDB) og kan ikke kalles i Vitest. Tømmingen ligger derfor i den rene funksjonen
// `clearSavedAt(storage)` (krav K7), og en lesetest viser at den kalles bare ved bytte.

const SAVED_AT = "2026-10-29T13:32:00.000Z";
const ORG_A = "0192d3a0-0000-7000-8000-0000000000a0";

/** `localStorage`-lik lagring med `removeItem`. */
function removableStorage(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  return {
    ...storage,
    removeItem: (key: string) => {
      storage.map.delete(key);
    },
  };
}

function selectStoreSource(): string {
  return readFileSync(
    path.join(process.cwd(), "src/modules/offline-trial/sync/select-store.ts"),
    "utf8",
  );
}

/** Teksten fra `{` på `from` til den tilhørende `}`. */
function blockFrom(source: string, from: number): { start: number; end: number } {
  const start = source.indexOf("{", from);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return { start, end: i };
  }
  throw new Error("Fant ikke slutten på blokken");
}

/** Kroppen til `clearIfOtherOrganization`. */
function clearIfOtherOrganizationBody(source: string): string {
  const name = source.indexOf("function clearIfOtherOrganization");
  expect(name, "clearIfOtherOrganization finnes").toBeGreaterThanOrEqual(0);
  const { start, end } = blockFrom(source, source.indexOf(")", name));
  return source.slice(start, end + 1);
}

describe("«Lagret kl.» i localStorage (select-store.ts)", () => {
  it("nøklene for Lagret kl. er trial_saved_at_ og kandidaten", () => {
    expect(savedAtKey("powersync")).toBe("trial_saved_at_powersync");
    expect(savedAtKey("electricsql")).toBe("trial_saved_at_electricsql");
    expect(savedAtKey("custom")).toBe("trial_saved_at_custom");
    const keys = TRIAL_SYNC_CANDIDATES.map((candidate) => savedAtKey(candidate));
    expect(new Set(keys).size).toBe(TRIAL_SYNC_CANDIDATES.length);
  });

  // Obligatorisk
  it.each(TRIAL_SYNC_CANDIDATES)(
    "bytte av organisasjon tømmer Lagret kl. for alle tre kandidatene (valgt: %s)",
    (chosen) => {
      const storage = removableStorage({
        trial_sync_candidate: chosen,
        trial_last_organization_id: ORG_A,
        trial_saved_at_powersync: SAVED_AT,
        trial_saved_at_electricsql: SAVED_AT,
        trial_saved_at_custom: SAVED_AT,
      });
      clearSavedAt(storage);
      for (const candidate of TRIAL_SYNC_CANDIDATES) {
        expect(storage.map.has(`trial_saved_at_${candidate}`), candidate).toBe(false);
      }
      // Valget av kandidat og organisasjonen røres ikke av denne tømmingen
      expect(storage.map.get("trial_sync_candidate")).toBe(chosen);
      expect(storage.map.get("trial_last_organization_id")).toBe(ORG_A);
    },
  );

  it("bytte av organisasjon kaller tømmingen i clearIfOtherOrganization", () => {
    const body = clearIfOtherOrganizationBody(selectStoreSource());
    const branch = body.indexOf("last !== organizationId");
    const call = body.indexOf("clearSavedAt(");
    const write = body.indexOf("setItem(TRIAL_LAST_ORGANIZATION_KEY");
    expect(branch, "grenen for ulik organisasjon").toBeGreaterThanOrEqual(0);
    expect(call, "clearSavedAt kalles i grenen").toBeGreaterThan(branch);
    expect(write, "den nye organisasjonen skrives etterpå").toBeGreaterThan(call);
  });

  it("samme organisasjon tømmer ikke Lagret kl.", () => {
    // clearSavedAt kalles bare inne i grenen `last && last !== organizationId`
    const body = clearIfOtherOrganizationBody(selectStoreSource());
    const ifStart = body.indexOf("if (");
    expect(ifStart).toBeGreaterThanOrEqual(0);
    const block = blockFrom(body, body.indexOf(")", ifStart));
    expect(body.slice(ifStart, block.start)).toContain("last !== organizationId");
    const calls = [...body.matchAll(/clearSavedAt\(/g)].map((match) => match.index ?? -1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!).toBeGreaterThan(block.start);
    expect(calls[0]!).toBeLessThan(block.end);
  });

  it("clearSavedAt rører ingen andre nøkler", () => {
    const storage = removableStorage({
      trial_sync_candidate: "custom",
      trial_device_id: "enhet-1",
      trial_saved_at_custom: SAVED_AT,
    });
    clearSavedAt(storage);
    expect(Object.fromEntries(storage.map)).toEqual({
      trial_sync_candidate: "custom",
      trial_device_id: "enhet-1",
    });
  });
});
