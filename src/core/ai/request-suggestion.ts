import { and, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, assignments, type AiErrorCode } from "@/db/schema";
import { stripUnstorableChars } from "@/shared/lib/clean-text";
import { logger } from "@/shared/lib/logger";
import { AiRequestRejectedError } from "./errors";
import { AI_TRIAL_TARGET_TYPE, getFeatureDefinition } from "./features";
import { preparePrompt } from "./prompt";
import { findPromptLeaks } from "./prompt-leaks";
import { resolveAiProvider } from "./provider-resolution";
import type { AiProvider, AiProviderResult } from "./providers/types";
import { loadKnownValues } from "./redaction";
import { aiSuggestionRequestShapeSchema, hasOnlyAllowedFields } from "./request";
import type { AiSuggestionRequest, AiSuggestionResult } from "./types";
import {
  insertBlockedRow,
  lockTarget,
  normalizeTarget,
  recordStatusChange,
  retainUntilFrom,
  sameTarget,
  sameTargetWhere,
  toSuggestionResult,
} from "./usage-log";

/*
 * Be om et KI-forslag (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 3, ADR 0006 del 1 og 4).
 * Rekkefølgen er fast (docs/funksjoner/fase2a-vask-for-ki.md Omfang 4 og 5): valider →
 * rettighet → tillatt-liste → oppdrag → samme `requestId` → «KI er av» (ingen rad) → sperret
 * (`blocked`-rad, intet kall) → funksjonen er ikke slått på for leverandøren (`settings.features`,
 * ingen rad) → vask → lekkasjesjekk for ekte leverandør (`blocked`-rad, intet kall) → kall
 * leverandøren → én transaksjon med ny rad, avvisning av forrige forslag og revisjonslogg. Alle
 * avslag før kallet gir ingen rad, intet kall og ingen linje i `audit_log`. Organisasjon og ansatt kommer bare fra `grant`.
 *
 * Leverandøren får bare vasket tekst, også den falske. Kaster vasken, kalles leverandøren aldri
 * (A176). `provider.complete` kalles bare her, og etter vasken i `preparePrompt` (./prompt.ts).
 *
 * Tegn databasen ikke tar (nulltegn, ensomme surrogater) fjernes fra verdiene rett etter
 * tillatt-listen, før alt annet og før personvernvasken (rett-t0001-synkko.md Omfang 3, A180):
 * et telefonnummer med nulltegn mellom sifrene kjennes ellers ikke igjen av mønstrene. Svaret
 * fra leverandøren vaskes likt, så loggen og klienten får samme tekst.
 */

/** Om en verdi i `fields` er tom. Samme kriterium før og etter vasken. */
function hasEmptyValue(fields: Readonly<Record<string, string>>): boolean {
  return Object.values(fields).some((value) => value.length === 0);
}

/** Måltyper som ikke kan kontrolleres mot organisasjonen ennå (A166, A173). */
const FAKE_ONLY_TARGET_TYPES: ReadonlySet<string> = new Set([AI_TRIAL_TARGET_TYPE, "answer"]);

/** Koden til den falske leverandøren. Alt annet regnes som ekte. */
const FAKE_PROVIDER_CODE = "fake";

/**
 * Om leverandøren er ekte. Sammenligner på fast kode, ikke på objektet: alt som ikke har koden
 * `fake`, regnes som ekte (docs/funksjoner/fase2a-ki-leverandor.md Omfang 6).
 */
function isRealProvider(provider: AiProvider): boolean {
  return provider.code !== FAKE_PROVIDER_CODE;
}

/**
 * Om forespørselen sperres (ad-1): bare den falske leverandøren får prøvemålet og
 * `answer`, og fritekst uten oppdrag går ikke til en ekte leverandør (spørsmål 58).
 */
function isBlocked(provider: AiProvider, targetType: string, assignmentId: string | null): boolean {
  if (!isRealProvider(provider)) return false;
  if (FAKE_ONLY_TARGET_TYPES.has(targetType)) return true;
  return assignmentId === null && targetType !== AI_TRIAL_TARGET_TYPE;
}

const resultColumns = {
  id: aiUsageLog.id,
  organizationId: aiUsageLog.organizationId,
  employeeId: aiUsageLog.employeeId,
  feature: aiUsageLog.feature,
  targetRef: aiUsageLog.targetRef,
  outcome: aiUsageLog.outcome,
  outputText: aiUsageLog.outputText,
  deletedAt: aiUsageLog.deletedAt,
};

type StoredRow = {
  organizationId: string;
  employeeId: string;
  feature: string;
  targetRef: { type: string; id: string; fieldKey: string };
  deletedAt: Date | null;
};

/** Om den lagrede raden er samme forespørsel fra samme ansatt i samme organisasjon. */
function isOwnRequest(
  row: StoredRow,
  grant: EmployeeGrant,
  feature: string,
  target: { type: string; id: string; fieldKey: string },
): boolean {
  return (
    row.deletedAt === null &&
    row.organizationId === grant.organizationId &&
    row.employeeId === grant.employeeId &&
    row.feature === feature &&
    sameTarget(row.targetRef, target)
  );
}

/** Kaller leverandøren. Et unntak gir `error` med `unknown`; feilen sendes aldri videre. */
async function callProvider(call: () => Promise<AiProviderResult>): Promise<AiProviderResult> {
  try {
    return await call();
  } catch {
    return { outcome: "error", errorCode: "unknown" };
  }
}

export async function requestSuggestion(
  grant: EmployeeGrant,
  request: AiSuggestionRequest,
): Promise<AiSuggestionResult> {
  // 1. Forespørselen valideres strengt
  const parsed = aiSuggestionRequestShapeSchema.safeParse(request);
  if (!parsed.success) throw new AiRequestRejectedError();
  const input = parsed.data;
  const definition = getFeatureDefinition(input.feature);
  if (!definition) throw new AiRequestRejectedError();
  if (hasEmptyValue(input.fields)) throw new AiRequestRejectedError();

  // 2. Rettigheten fra funksjonen (admin har alle)
  if (!grantHasPermission(grant, definition.permission)) throw new AccessDeniedError();

  // 3. Bare feltkoder fra tillatt-listen
  if (!hasOnlyAllowedFields(definition, input.fields)) throw new AiRequestRejectedError();

  // Tegn databasen ikke tar fjernes fra verdiene (ikke fra feltkodene). Tom etter vask gir samme
  // avslag som tom tekst i trinn 1, før oppslag, sperret rad, personvernvask og leverandør.
  const fields: Record<string, string> = Object.fromEntries(
    Object.entries(input.fields).map(([key, value]) => [key, stripUnstorableChars(value)]),
  );
  if (hasEmptyValue(fields)) throw new AiRequestRejectedError();

  // 4. Oppdraget hører til organisasjonen og er ikke slettet
  if (input.assignmentId !== null) {
    const [assignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, input.assignmentId),
          eq(assignments.organizationId, grant.organizationId),
          isNull(assignments.deletedAt),
        ),
      );
    if (!assignment) throw new AiRequestRejectedError();
  }

  // 5. Samme requestId på nytt: svaret fra første gang, uten nytt kall
  const target = normalizeTarget(input.target);
  const [existing] = await db
    .select(resultColumns)
    .from(aiUsageLog)
    .where(
      and(eq(aiUsageLog.id, input.requestId), eq(aiUsageLog.organizationId, grant.organizationId)),
    );
  if (existing) {
    if (!isOwnRequest(existing, grant, definition.code, target)) {
      throw new AiRequestRejectedError();
    }
    return toSuggestionResult(existing);
  }
  // Id-en finnes hos en annen organisasjon eller er mykt slettet: avslag før leverandøren kalles
  const [taken] = await db
    .select({ id: aiUsageLog.id })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.id, input.requestId));
  if (taken) throw new AiRequestRejectedError();

  // 6. KI av: ingen rad, intet kall
  const resolved = await resolveAiProvider(grant);
  if (resolved.kind === "disabled") return { kind: "disabled" };
  const { provider, model } = resolved;
  const fieldKeys = Object.keys(fields).sort();

  const blockedRow = () =>
    insertBlockedRow(grant, {
      requestId: input.requestId,
      feature: definition.code,
      provider: provider.code,
      model,
      promptVersion: definition.promptVersion,
      assignmentId: input.assignmentId,
      target,
      sourceFields: fieldKeys,
    });

  // 7. Sperret: rad med utfallet `blocked`, intet oppslag, ingen vask, intet kall
  if (isBlocked(provider, target.type, input.assignmentId)) return blockedRow();

  // 7b. Funksjonen er ikke slått på for leverandøren (`settings.features`, A194): som «KI er av»,
  // ingen rad, ingen vask, intet kall. `null` betyr alle (bare `fake`); tom liste betyr ingen.
  if (resolved.features !== null && !resolved.features.includes(definition.code)) {
    return { kind: "disabled" };
  }

  // 8. Kjente verdier for oppdraget (bare med oppdrag). Kaster oppslaget, kalles leverandøren aldri.
  const known =
    input.assignmentId === null ? null : await loadKnownValues(grant, input.assignmentId);

  // 9. Felles ledetekst: rensing, vask og ledetekst av de vaskede feltene på tillatt-listen.
  // Kaster vasken, kalles leverandøren aldri. Så kalles leverandøren.
  const prepared = preparePrompt(definition, fields, known);

  // 9b. Lekkasjesjekken på den ferdige ledeteksten (A195): siste vern før tekst forlater oss.
  // Treff gir `blocked`-rad uten kall. Typen eller verdien logges ikke.
  if (isRealProvider(provider) && findPromptLeaks(prepared.prompt, known).length > 0) {
    return blockedRow();
  }

  const providerResult = await callProvider(() =>
    provider.complete({
      feature: definition.code,
      promptVersion: definition.promptVersion,
      prompt: prepared.prompt,
      model,
    }),
  );
  // Samme vaskede tekst i `ai_usage_log` og tilbake til klienten
  const result: AiProviderResult =
    providerResult.outcome === "ok"
      ? { ...providerResult, text: stripUnstorableChars(providerResult.text) }
      : providerResult;
  if (result.outcome === "error") {
    logger.warn("KI-kallet ga feil", {
      feature: definition.code,
      provider: provider.code,
      errorCode: result.errorCode,
      usageId: input.requestId,
    });
  }

  // 10. Én transaksjon: ny rad, forrige forslag på samme mål avvist, revisjonslogg.
  // `input_summary` regnes av den vaskede teksten, det som faktisk ble sendt (A172).
  const now = new Date();
  const inputSummary = Object.fromEntries(
    fieldKeys.map((key) => [key, (prepared.redactedFields[key] ?? "").length]),
  );
  const errorCode: AiErrorCode | null = result.outcome === "error" ? result.errorCode : null;

  return db.transaction(async (tx) => {
    await lockTarget(tx, grant.organizationId, definition.code, target);
    const [inserted] = await tx
      .insert(aiUsageLog)
      .values({
        id: input.requestId,
        organizationId: grant.organizationId,
        employeeId: grant.employeeId,
        feature: definition.code,
        provider: provider.code,
        model,
        promptVersion: definition.promptVersion,
        assignmentId: input.assignmentId,
        reportId: null,
        targetRef: target,
        sourceFields: fieldKeys,
        inputSummary,
        outcome: result.outcome,
        errorCode,
        outputText: result.outcome === "ok" ? result.text : null,
        status: result.outcome === "ok" ? "suggested" : null,
        tokensIn: result.outcome === "error" ? 0 : result.tokensIn,
        tokensOut: result.outcome === "error" ? 0 : result.tokensOut,
        cost: result.outcome === "error" ? "0" : String(result.cost),
        currency: result.outcome === "error" ? "NOK" : result.currency,
        redactedCount: prepared.redactedCount,
        retainUntil: retainUntilFrom(now),
        createdAt: now,
        updatedAt: now,
        createdBy: grant.employeeId,
        updatedBy: grant.employeeId,
      })
      .onConflictDoNothing({ target: aiUsageLog.id })
      .returning(resultColumns);

    if (!inserted) {
      // Et samtidig kall med samme id kom først. Bare vår egen rad leses tilbake.
      const [winner] = await tx
        .select(resultColumns)
        .from(aiUsageLog)
        .where(
          and(
            eq(aiUsageLog.id, input.requestId),
            eq(aiUsageLog.organizationId, grant.organizationId),
          ),
        );
      if (!winner || !isOwnRequest(winner, grant, definition.code, target)) {
        throw new AiRequestRejectedError();
      }
      return toSuggestionResult(winner);
    }

    // Avklaring A: forrige forslag avvises bare når det nye er brukbart
    if (inserted.outcome === "ok") {
      const replaced = await tx
        .update(aiUsageLog)
        .set({
          status: "rejected",
          decidedBy: grant.employeeId,
          decidedAt: now,
          updatedBy: grant.employeeId,
        })
        .where(
          and(
            sameTargetWhere(grant.organizationId, definition.code, target),
            eq(aiUsageLog.status, "suggested"),
            ne(aiUsageLog.id, inserted.id),
          ),
        )
        .returning({ id: aiUsageLog.id });
      for (const row of replaced) {
        await recordStatusChange(tx, grant, row.id, "suggested", "rejected");
      }
    }
    return toSuggestionResult(inserted);
  });
}
