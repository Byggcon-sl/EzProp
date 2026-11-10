import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearSavedAt, TRIAL_SAVED_AT_KEY } from "./select-store";

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

// «Lagret kl.» i localStorage (docs/funksjoner/fase1-synkstatus.md pkt. 7, A6).
// Testplan synkstatus avsnitt 2.5. `clearIfOtherOrganization` laster lageret med dynamisk
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
  it("nøkkelen for Lagret kl. er trial_saved_at", () => {
    expect(TRIAL_SAVED_AT_KEY).toBe("trial_saved_at");
  });

  // Obligatorisk
  it("bytte av organisasjon tømmer Lagret kl.", () => {
    const storage = removableStorage({
      trial_last_organization_id: ORG_A,
      trial_saved_at: SAVED_AT,
    });
    clearSavedAt(storage);
    expect(storage.map.has("trial_saved_at")).toBe(false);
    // Organisasjonen røres ikke av denne tømmingen
    expect(storage.map.get("trial_last_organization_id")).toBe(ORG_A);
  });

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
      trial_device_id: "enhet-1",
      trial_saved_at: SAVED_AT,
    });
    clearSavedAt(storage);
    expect(Object.fromEntries(storage.map)).toEqual({
      trial_device_id: "enhet-1",
    });
  });
});
