import type { EmployeeGrant } from "@/core/access";
import * as redactionModule from "@/core/ai/redaction";
import { seedKnownValues, type KnownSeed } from "./known-values";

export {
  containsWord,
  NEUTRAL_PARTY_NAME,
  placeholderCounts,
  seedKnownValues,
  type KnownSeed,
} from "./known-values";

/*
 * Testhjelpere for «Vask før KI» (docs/funksjoner/fase2a-vask-for-ki-testplan.md, avtalen om
 * signaturer). Bare i testene. Alle verdier er oppdiktet: ingen ekte navn, adresser eller
 * matrikkelnumre.
 *
 * Avtalen med utvikler:
 * - `@/core/ai/redaction` eksporterer `redactText(text, knownValues) → { text, count }` (ren) og
 *   `loadKnownValues(grant, assignmentId) → KnownValues` (databasen, filtrert på
 *   `grant.organizationId`).
 * - Formen på `KnownValues` er utviklerens. Testene lager derfor de kjente verdiene som rader i
 *   testdatabasen (`seedKnownValues`) og henter dem med `loadKnownValues`, så de ikke binder seg
 *   til formen. `knownStrings` leser alle tekstverdier i objektet uansett form.
 */

const redaction = redactionModule as unknown as Record<string, unknown>;

export type RedactResult = { text: string; count: number };

function exported<T>(name: string): T {
  const value = redaction[name];
  if (typeof value !== "function") {
    throw new Error(`@/core/ai/redaction eksporterer ikke ${name} (testplanen, avtalen)`);
  }
  return value as T;
}

export function redactText(text: string, knownValues: unknown): RedactResult {
  return exported<(t: string, k: unknown) => RedactResult>("redactText")(text, knownValues);
}

export function loadKnownValues(grant: EmployeeGrant, assignmentId: string): Promise<unknown> {
  return exported<(g: EmployeeGrant, id: string) => Promise<unknown>>("loadKnownValues")(
    grant,
    assignmentId,
  );
}

/** Alle tekstverdier i de kjente verdiene, uansett form (objekt, liste, Set, Map). */
export function knownStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof RegExp) return [value.source];
  if (value instanceof Map) {
    return [...value.entries()].flatMap(([k, v]) => [
      ...knownStrings(k, seen),
      ...knownStrings(v, seen),
    ]);
  }
  if (value instanceof Set || Array.isArray(value)) {
    return [...value].flatMap((v) => knownStrings(v, seen));
  }
  return Object.values(value as Record<string, unknown>).flatMap((v) => knownStrings(v, seen));
}

/** Legger inn de kjente verdiene og henter dem med `loadKnownValues`. */
export async function knownValuesFor(grant: EmployeeGrant, seed: KnownSeed): Promise<unknown> {
  const assignmentId = await seedKnownValues(grant.organizationId, seed);
  return loadKnownValues(grant, assignmentId);
}
