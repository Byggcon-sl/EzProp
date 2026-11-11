import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import * as aiModule from "@/core/ai";
import * as fakeModule from "@/core/ai/providers/fake";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  type TestAiUsageRow,
} from "./factories";

/*
 * Testhjelpere for KI-modulen (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 0).
 * Bare i testene. Alle verdier er oppdiktet.
 *
 * Avtalen med utvikler (testplanen avsnitt 0):
 * - `@/core/ai` eksporterer `requestSuggestion`, `recordDecision` og funksjonsdefinisjonene som
 *   `AI_FEATURES` (liste eller oppslag på kode) eller `getFeatureDefinition(code)`.
 * - `@/core/ai/providers/fake` eksporterer `fakeAiProvider` (objektet tjenesten kaller, så testene
 *   kan spionere på `complete`), `FAKE_NO_MATCH_INPUT` og `FAKE_ERROR_INPUT` (tekst, eller et
 *   oppslag med én tekst per feilkode).
 */

export type AiTarget = { type: string; id: string; fieldKey: string };

export type AiFeatureDefinitionForTest = {
  code: string;
  permission: string;
  allowedFields: readonly string[];
  allowedTargets: readonly { type: string; fieldKey: string }[];
  promptVersion: string;
};

export type AiRequestForTest = {
  requestId: string;
  feature: string;
  assignmentId: string | null;
  reportId: string | null;
  target: AiTarget;
  fields: Record<string, unknown>;
  candidates?: unknown[];
} & Record<string, unknown>;

type AiResult =
  | {
      kind: "suggestion";
      usageId: string;
      status: string;
      text: string;
      candidateId: string | null;
    }
  | { kind: "no_match"; usageId: string }
  | { kind: "error"; usageId: string }
  | { kind: "disabled" };

type ProviderResult =
  | {
      outcome: "ok";
      text: string;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      currency: string;
    }
  | { outcome: "no_match"; tokensIn: number; tokensOut: number; cost: number; currency: string }
  | { outcome: "error"; errorCode: string };

export type FakeProviderForTest = {
  readonly code: string;
  complete(request: {
    feature: string;
    promptVersion: string;
    prompt: string;
    model: string;
  }): Promise<ProviderResult>;
};

const ai = aiModule as unknown as Record<string, unknown>;
const fake = fakeModule as unknown as Record<string, unknown>;

/** `requestSuggestion` med løse typer, så testene kan sende forespørsler typene ville stoppet. */
export function requestSuggestion(grant: EmployeeGrant, request: unknown): Promise<AiResult> {
  const fn = ai.requestSuggestion as (g: EmployeeGrant, r: unknown) => Promise<AiResult>;
  return fn(grant, request);
}

/** `recordDecision` med løse typer. */
export function recordDecision(
  grant: EmployeeGrant,
  usageId: string,
  decision: string,
): Promise<void> {
  const fn = ai.recordDecision as (g: EmployeeGrant, id: string, d: string) => Promise<void>;
  return fn(grant, usageId, decision);
}

/** Alle funksjonsdefinisjonene fra koden. */
export function featureDefinitions(): AiFeatureDefinitionForTest[] {
  const list = ai.AI_FEATURES;
  if (Array.isArray(list)) return list as AiFeatureDefinitionForTest[];
  if (list && typeof list === "object") {
    return Object.values(list as Record<string, AiFeatureDefinitionForTest>);
  }
  const get = ai.getFeatureDefinition as ((code: string) => unknown) | undefined;
  if (typeof get === "function") {
    const found = get("language_polish");
    return found ? [found as AiFeatureDefinitionForTest] : [];
  }
  throw new Error(
    "@/core/ai eksporterer verken AI_FEATURES eller getFeatureDefinition (testplanen avsnitt 0)",
  );
}

export function languagePolish(): AiFeatureDefinitionForTest {
  const found = featureDefinitions().find((definition) => definition.code === "language_polish");
  if (!found) throw new Error("fant ikke funksjonsdefinisjonen language_polish");
  return found;
}

export const fakeAiProvider = fake.fakeAiProvider as FakeProviderForTest;

export function fakeNoMatchInput(): string {
  const value = fake.FAKE_NO_MATCH_INPUT;
  if (typeof value !== "string") throw new Error("FAKE_NO_MATCH_INPUT mangler");
  return value;
}

/** Prøveverdiene som gir `error` (én, eller én per feilkode). */
export function fakeErrorInputs(): string[] {
  const value = fake.FAKE_ERROR_INPUT ?? fake.FAKE_ERROR_INPUTS;
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && typeof value === "object") {
    return Object.values(value).filter((v): v is string => typeof v === "string");
  }
  throw new Error("FAKE_ERROR_INPUT mangler");
}

export const AI_ERROR_CODES = ["timeout", "rate_limited", "unavailable", "rejected", "unknown"];

/** Et lovlig mål for `language_polish` (type og feltkode fra definisjonen), med ny id. */
export function validTarget(id: string = uuidv7()): AiTarget {
  const [target] = languagePolish().allowedTargets;
  if (!target) throw new Error("language_polish har ingen lovlige mål");
  return { type: target.type, id, fieldKey: target.fieldKey };
}

export const SAMPLE_TEXT = "Taket er gammelt og har noen sprekker";

/** En gyldig forespørsel (testplanen avsnitt 4): ny UUID, lovlig mål, `fields.text`. */
export function validRequest(overrides: Partial<AiRequestForTest> = {}): AiRequestForTest {
  return {
    requestId: uuidv7(),
    feature: "language_polish",
    assignmentId: null,
    reportId: null,
    target: validTarget(),
    fields: { text: SAMPLE_TEXT },
    ...overrides,
  };
}

/** Slår sammen nøkler inn i `organizations.settings` (andre nøkler står). */
export async function mergeOrganizationSettings(
  organizationId: string,
  patch: Record<string, unknown>,
) {
  await db.execute(
    sql`update organizations set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb where id = ${organizationId}`,
  );
}

/** Fjerner en nøkkel fra `organizations.settings`. */
export async function removeOrganizationSetting(organizationId: string, key: string) {
  await db.execute(
    sql`update organizations set settings = settings - ${key} where id = ${organizationId}`,
  );
}

/**
 * Slår KI på eller av i organisasjonen (testplanen avsnitt 0): setter `ai.enabled` (standard
 * `true`) og lager tilkoblingen på porten `ai` (standard aktiv `fake`). `connection: false` lager
 * ingen tilkobling. Gir tilkoblingen tilbake.
 */
export async function enableAi(
  organizationId: string,
  options: {
    enabled?: unknown;
    provider?: string;
    status?: string;
    deletedAt?: Date | null;
    connection?: boolean;
    /** `settings` på tilkoblingen (rå, forbi skjemaet). Standard `{}`. */
    settings?: Record<string, unknown>;
    /** `secret_ref` på tilkoblingen (rå). Standard ingen. */
    secretRef?: string | null;
  } = {},
) {
  if (!("enabled" in options) || options.enabled !== undefined) {
    await mergeOrganizationSettings(organizationId, { "ai.enabled": options.enabled ?? true });
  }
  if (options.connection === false) return null;
  return createIntegrationConnection(organizationId, {
    port: "ai",
    provider: options.provider ?? "fake",
    status: options.status ?? "active",
    deletedAt: options.deletedAt ?? null,
    settings: options.settings ?? {},
    secretRef: options.secretRef ?? null,
  });
}

/**
 * Gyldige innstillinger for tilkoblingen `anthropic` (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md, «Avtale om signaturer»). Modellen er et merke, ingen ekte modell-id. Prisene er
 * oppdiktet.
 */
export function anthropicSettings(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    model: "MERKE-MODELL-K7Q",
    features: ["language_polish"],
    pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" },
    ...overrides,
  };
}

/**
 * Slår KI på med en gyldig `anthropic`-tilkobling (rå rad): `ai.enabled`, `secret_ref =
 * ANTHROPIC_API_KEY` og `anthropicSettings`. Nøkkelen settes ikke her; testen setter den med
 * `vi.stubEnv`.
 */
export async function enableAnthropic(
  organizationId: string,
  options: Parameters<typeof enableAi>[1] = {},
) {
  return enableAi(organizationId, {
    provider: "anthropic",
    secretRef: "ANTHROPIC_API_KEY",
    settings: anthropicSettings(),
    ...options,
  });
}

export type EmployeeVariant = "inspector" | "office" | "manager" | "admin";

/** En ansatt med rollene i organisasjonen, og grant fra tilgangssjekken (lesetilgang). */
export async function employeeWithGrant(
  organizationId: string,
  roles: EmployeeVariant[] = ["inspector"],
  name = "Test Takstmann",
) {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  const grant = await requireOrganizationAccess(actor, organizationId);
  return { actor, employee, grant };
}

/** Organisasjon med KI på (`fake`) og én takstmann. */
export async function aiOrganization(name = "Oppdiktet Takst A") {
  const organization = await createOrganization(name);
  const connection = await enableAi(organization.id);
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  return { organization, connection, ...inspector };
}

/** Alle rader i `ai_usage_log` (alle organisasjoner), i rekkefølgen de ble laget. */
export async function allAiRows(): Promise<TestAiUsageRow[]> {
  return (await db.execute(
    sql`select * from ai_usage_log order by created_at, id`,
  )) as unknown as TestAiUsageRow[];
}

export async function aiRow(id: string): Promise<TestAiUsageRow | undefined> {
  const [row] = (await db.execute(
    sql`select * from ai_usage_log where id = ${id}`,
  )) as unknown as TestAiUsageRow[];
  return row;
}

export async function aiRowCount(): Promise<number> {
  const [row] = (await db.execute(sql`select count(*)::int as n from ai_usage_log`)) as unknown as {
    n: number;
  }[];
  return row?.n ?? -1;
}

/** Alle linjer i `audit_log` (alle organisasjoner), som rå rader. */
export async function allAuditRows(): Promise<Record<string, unknown>[]> {
  return (await db.execute(
    sql`select * from audit_log order by created_at, id`,
  )) as unknown as Record<string, unknown>[];
}

export async function auditCount(): Promise<number> {
  const [row] = (await db.execute(sql`select count(*)::int as n from audit_log`)) as unknown as {
    n: number;
  }[];
  return row?.n ?? -1;
}

/** Venter på feilen fra kallet. Feiler testen hvis kallet går gjennom. */
export async function captureError(call: () => Promise<unknown>): Promise<Error> {
  try {
    await call();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`kastet noe som ikke er Error: ${String(error)}`);
  }
  throw new Error("kallet skulle gitt feil, men gikk gjennom");
}

/**
 * Det nøytrale avslaget fra `requestSuggestion` (testplanen avsnitt 0): feilen for en ukjent
 * funksjon. Alle andre avslag skal ha samme klasse og samme melding.
 */
export async function neutralRequestRejection(grant: EmployeeGrant): Promise<Error> {
  const error = await captureError(() =>
    requestSuggestion(grant, validRequest({ feature: "tg_suggest" })),
  );
  expect(error).not.toBeInstanceOf(AccessDeniedError);
  expect(error.message.trim().length).toBeGreaterThan(0);
  return error;
}

/** Det nøytrale avslaget fra `recordDecision`: feilen for en ukjent `usageId`. */
export async function neutralDecisionRejection(grant: EmployeeGrant): Promise<Error> {
  const error = await captureError(() => recordDecision(grant, randomUUID(), "accepted"));
  expect(error).not.toBeInstanceOf(AccessDeniedError);
  expect(error.message.trim().length).toBeGreaterThan(0);
  return error;
}

/** Feilen har samme klasse og samme melding som det nøytrale avslaget. */
export function expectSameRejection(error: Error, baseline: Error) {
  expect(error).not.toBeInstanceOf(AccessDeniedError);
  expect(error.constructor).toBe(baseline.constructor);
  expect(error.message).toBe(baseline.message);
}

/** Ti år etter tidspunktet (samme regel som JavaScript: 29.02 blir 01.03 i et vanlig år). */
export function tenYearsAfter(date: Date): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + 10);
  return result;
}

/** Kolonnene i raden som tall/tekst/JSON, for å sammenligne «uendret». */
export function snapshot(row: TestAiUsageRow | undefined): string {
  return JSON.stringify(row);
}
