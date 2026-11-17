import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import * as aiModule from "@/core/ai";
import * as reportsModule from "@/core/reports";
import {
  addDeviation,
  saveField,
  type ApplyPhrase,
  type DraftSummary,
  type GetReportSummary,
  type SaveSummary,
  type SuggestPhrases,
} from "@/core/reports";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import { enableAi, fakeAiProvider } from "./ai";
import { startedBathroom } from "./report-fixtures";

/*
 * Testhjelpere for «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md). Bare i testene.
 * Alle verdier er oppdiktet.
 *
 * Funksjonene i `@/core/reports` og `@/core/ai` hentes med løse oppslag, slik at testfilene kan
 * typesjekkes og kjøres mens tjenestene bygges. Mangler en funksjon, gir kallet en tydelig feil.
 * Signaturene er typene i `src/core/reports/types.ts` og `src/core/ai/types.ts`.
 */

const reports = reportsModule as unknown as Record<string, unknown>;
const ai = aiModule as unknown as Record<string, unknown>;

function required<T>(module: Record<string, unknown>, name: string, where: string): T {
  const fn = module[name];
  if (typeof fn !== "function") {
    throw new Error(`${where} eksporterer ikke ${name} ennå (docs/funksjoner/fase2a-ki-i-veien.md)`);
  }
  return fn as T;
}

export const suggestPhrases: SuggestPhrases = (...args) =>
  required<SuggestPhrases>(reports, "suggestPhrases", "@/core/reports")(...args);
export const applyPhrase: ApplyPhrase = (...args) =>
  required<ApplyPhrase>(reports, "applyPhrase", "@/core/reports")(...args);
export const getReportSummary: GetReportSummary = (...args) =>
  required<GetReportSummary>(reports, "getReportSummary", "@/core/reports")(...args);
export const draftSummary: DraftSummary = (...args) =>
  required<DraftSummary>(reports, "draftSummary", "@/core/reports")(...args);
export const saveSummary: SaveSummary = (...args) =>
  required<SaveSummary>(reports, "saveSummary", "@/core/reports")(...args);

type AnyResult = { kind: string } & Record<string, unknown>;

/** `requestSuggestion` med tredje argument (`AiServerInput`) og løse typer. */
export function requestWithServerInput(
  grant: EmployeeGrant,
  request: unknown,
  serverInput?: unknown,
): Promise<AnyResult> {
  return required<(g: EmployeeGrant, r: unknown, s?: unknown) => Promise<AnyResult>>(
    ai,
    "requestSuggestion",
    "@/core/ai",
  )(grant, request, serverInput);
}

/** `requestSuggestionBatch` (A460) med løse typer. */
export function requestSuggestionBatch(
  grant: EmployeeGrant,
  requests: readonly unknown[],
): Promise<AnyResult[]> {
  return required<(g: EmployeeGrant, r: readonly unknown[]) => Promise<AnyResult[]>>(
    ai,
    "requestSuggestionBatch",
    "@/core/ai",
  )(grant, requests);
}

/** `recordDecision` med `options` (kandidaten) og løse typer. */
export function recordDecisionWith(
  grant: EmployeeGrant,
  usageId: string,
  decision: string,
  options?: unknown,
): Promise<void> {
  return required<(g: EmployeeGrant, id: string, d: string, o?: unknown) => Promise<void>>(
    ai,
    "recordDecision",
    "@/core/ai",
  )(grant, usageId, decision, options);
}

// --- Oppsett --------------------------------------------------------------------------------

/** TG2-utfallet «sjiktet er så gammelt at funksjonen er usikker» på membran og sluk. */
export const PAST_LIFESPAN = {
  checkpointKey: "wet_room.membrane_drain",
  questionKey: "wet_room.membrane_drain.membrane_past_lifespan",
  outcomeKey: "tg2",
} as const;
/** TG3-utfallet «mangler tetting mellom sjikt og sluk» på samme punkt. */
export const DRAIN_CONNECTION = {
  checkpointKey: "wet_room.membrane_drain",
  questionKey: "wet_room.membrane_drain.membrane_drain_connection",
  outcomeKey: "tg3",
} as const;
/** TG3 på ventilasjon (annet punkt). */
export const MISSING_VENTILATION = {
  checkpointKey: "wet_room.ventilation",
  questionKey: "wet_room.ventilation.missing_ventilation",
  outcomeKey: "tg3",
} as const;
/** TG2 på innredning (annet punkt). */
export const DAMAGED_FURNITURE = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.damaged_furniture",
  outcomeKey: "tg2",
} as const;
/** HMS-utfallet på innredning. */
export const OVERHEATING_HMS = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.signs_of_overheating",
  outcomeKey: "hms",
} as const;
/** «Velg TG2 eller TG3» på gulvet. */
export const INSUFFICIENT_FALL = {
  checkpointKey: "wet_room.floor",
  questionKey: "wet_room.floor.insufficient_fall",
  outcomeKey: "choose",
} as const;

export type Place = {
  checkpointKey: string;
  questionKey: string;
  outcomeKey: string;
};

export type KiBathroom = Awaited<ReturnType<typeof kiBathroom>>;

/**
 * Bad med startet rapport, KI på (`fake`) og grant for den innloggede. `roles` gjelder den
 * innloggede (standard takstmann).
 */
export async function kiBathroom(options: Parameters<typeof startedBathroom>[0] = {}) {
  const f = await startedBathroom(options);
  await enableAi(f.organizationId);
  const grant = await requireOrganizationAccess(f.actor, f.organizationId);
  return { ...f, grant };
}

/**
 * Bad med startet rapport og KI på i en organisasjon som finnes (for `expectTenantIsolation`,
 * der organisasjonene lages av hjelperen). Rapporten startes av en ny takstmann.
 */
export async function kiBathroomIn(organizationId: string) {
  const f = await startedBathroom({ organizationId });
  await enableAi(organizationId);
  const grant = await requireOrganizationAccess(f.actor, organizationId);
  return { ...f, grant };
}

/** Legger til et avvik fra et utfall og gir id-en. `tg` kreves for «velg TG2 eller TG3». */
export async function addPlace(
  f: Pick<KiBathroom, "actor" | "organizationId" | "room">,
  place: Place,
  tg: 2 | 3 | null = null,
): Promise<string> {
  const id = uuidv7();
  const result = await addDeviation(f.actor, f.organizationId, f.room, {
    id,
    ...place,
    tg,
  });
  expect(result.status).toBe("saved");
  return id;
}

/** Skriver fritekst i et felt på avviket (base leses fra databasen). */
export async function writeDeviationText(
  f: Pick<KiBathroom, "actor" | "organizationId" | "room">,
  deviationId: string,
  field: "deviation_text" | "cause_text" | "consequence_text",
  value: string | null,
) {
  const [row] = (await db.execute(
    sql`select deviation_text, cause_text, consequence_text from deviations where id = ${deviationId}`,
  )) as unknown as Record<string, string | null>[];
  return saveField(f.actor, f.organizationId, f.room, {
    table: "deviations",
    id: deviationId,
    field,
    value,
    base: row?.[field] ?? null,
  });
}

// --- Den falske leverandøren -------------------------------------------------------------------

type CompleteRequest = { feature: string; promptVersion: string; prompt: string; model: string };

/**
 * Lar den falske leverandøren svare med rå tekst for de neste kallene (én verdi per kall, siste
 * gjentas). Gir spionen tilbake, så testen kan lese ledeteksten.
 */
export function providerAnswers(...texts: string[]) {
  let call = 0;
  return vi.spyOn(fakeAiProvider, "complete").mockImplementation(async () => {
    const text = texts[Math.min(call, texts.length - 1)] ?? "";
    call += 1;
    return { outcome: "ok", text, tokensIn: 11, tokensOut: 7, cost: 0, currency: "NOK" };
  });
}

/** Spion uten endring av svaret. */
export function providerSpy() {
  return vi.spyOn(fakeAiProvider, "complete");
}

/** Ledeteksten i kall nummer `index`. */
export function promptOf(spy: { mock: { calls: unknown[][] } }, index = 0): string {
  const request = spy.mock.calls[index]?.[0] as CompleteRequest | undefined;
  if (!request) throw new Error(`leverandøren ble ikke kalt ${index + 1} gang(er)`);
  return request.prompt;
}

/** Kandidatlinjene `K<n>: tekst` i ledeteksten, som merke → tekst. */
export function candidateLines(prompt: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of prompt.matchAll(/^(K\d+): (.*)$/gmu)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

// --- Loggen ------------------------------------------------------------------------------------

export type KiLogRow = {
  id: string;
  organization_id: string;
  feature: string;
  outcome: string;
  error_code: string | null;
  status: string | null;
  output_text: string | null;
  input_summary: Record<string, unknown>;
  candidate_refs: { source: string; id: string }[] | null;
  chosen_candidate: { source: string; id: string } | null;
  target_ref: { type: string; id: string; fieldKey: string };
  report_id: string | null;
  assignment_id: string | null;
  tokens_in: number | null;
  cost: string | null;
};

export async function kiRows(feature?: string): Promise<KiLogRow[]> {
  const rows = (await db.execute(
    feature
      ? sql`select * from ai_usage_log where feature = ${feature} order by created_at, id`
      : sql`select * from ai_usage_log order by created_at, id`,
  )) as unknown as KiLogRow[];
  return rows;
}

/** En ny grant for en ansatt (for roller og andre organisasjoner). */
export async function grantFor(actor: Actor, organizationId: string) {
  return requireOrganizationAccess(actor, organizationId);
}
