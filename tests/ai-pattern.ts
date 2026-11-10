import { AccessDeniedError, type EmployeeGrant } from "@/core/access";
import * as aiModule from "@/core/ai";
import { uuidv7 } from "@/shared/lib/uuid";
import type { AiTarget } from "./ai";

/*
 * Testhjelpere for forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 0). Bare i testene. Alle verdier er oppdiktet.
 *
 * Avtalen med utvikler (testplanen avsnitt 0):
 * - `@/core/ai` eksporterer `getSuggestionStatus(grant, usageId)` → `{ status, outcome } | null`
 *   (eller nøytral feil) og `checkAiTextApproved(grant, items)` → de elementene som ikke er
 *   godkjent, og taket `AI_APPROVAL_CHECK_MAX`.
 * - Måltypen for prøvesiden er `ai_trial` med feltet `text`.
 * Typene er løse, så testene kan sende inn verdier typene ville stoppet (ugyldig uuid o.l.).
 */

const ai = aiModule as unknown as Record<string, unknown>;

export type StatusAnswer = { status: string | null; outcome: string } | null;
export type ApprovalItem = { aiUsageId: string; target: AiTarget };

export const TRIAL_TARGET_TYPE = "ai_trial";

/** Taket fra avtalen (avsnitt 0). Fasiten står her, ikke regnet ut fra koden. */
export const APPROVAL_CHECK_MAX = 500;

function exported<T>(name: string): T {
  const value = ai[name];
  if (typeof value !== "function") {
    throw new Error(`@/core/ai eksporterer ikke ${name} (testplanen avsnitt 0)`);
  }
  return value as T;
}

export function getSuggestionStatus(grant: EmployeeGrant, usageId: unknown): Promise<StatusAnswer> {
  return exported<(g: EmployeeGrant, id: unknown) => Promise<StatusAnswer>>("getSuggestionStatus")(
    grant,
    usageId,
  );
}

export function checkAiTextApproved(grant: EmployeeGrant, items: unknown): Promise<ApprovalItem[]> {
  return exported<(g: EmployeeGrant, items: unknown) => Promise<ApprovalItem[]>>(
    "checkAiTextApproved",
  )(grant, items);
}

/** Målet for prøvesiden, med ny id. */
export function trialTarget(id: string = uuidv7(), fieldKey = "text"): AiTarget {
  return { type: TRIAL_TARGET_TYPE, id, fieldKey };
}

/** Målet for et svar i rapporten (finnes ikke ennå, men står i `allowedTargets`). */
export function answerTarget(id: string = uuidv7(), fieldKey = "text"): AiTarget {
  return { type: "answer", id, fieldKey };
}

/**
 * Svaret fra et kall gjort om til noe som kan sammenlignes: verdien, eller feilens klasse og
 * melding. Brukes for «samme svar» (avklaring A: `null` eller nøytral feil, men likt overalt).
 */
export type Outcome =
  | { kind: "value"; value: unknown }
  | { kind: "error"; name: string; message: string; accessDenied: boolean };

export async function outcomeOf(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "value", value: await call() };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      kind: "error",
      name: error.constructor.name,
      message: error.message,
      accessDenied: error instanceof AccessDeniedError,
    };
  }
}
