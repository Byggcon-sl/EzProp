import { beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRowCount,
  auditCount,
  captureError,
  enableAnthropic,
  employeeWithGrant,
  expectSameRejection,
  fakeAiProvider,
  neutralRequestRejection,
  recordDecision,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { checkAiTextApproved, getSuggestionStatus } from "../../../tests/ai-pattern";
import { createAiUsageLog, createOrganization, resetDatabase } from "../../../tests/factories";
import { AI_FEATURES, AI_TRIAL_TARGET_TYPE, ARCHIVED_AI_TARGET_TYPES } from "./features";
import { aiSuggestionRequestSchema } from "./request";

/*
 * Prøvemålet `ai_trial` er arkivert («KI i veien», docs/funksjoner/fase2a-ki-i-veien-testplan.md
 * K1.31 og K3.5, A428). Prøvesiden `/prove/ki` er fjernet, og ingen funksjon godtar målet lenger.
 * Gamle rader i `ai_usage_log` kan fortsatt leses. Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (all KI går til mål kjernen kan kontrollere) og færre
 * reklamasjoner (fritekst uten mål i rapporten kan ikke lenger sendes).
 */

beforeEach(resetDatabase);

const trialTarget = () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" });

describe("K1.31 ai_trial er arkivert", () => {
  it("konstanten står igjen som arkivert, og ingen funksjon har målet", () => {
    expect(AI_TRIAL_TARGET_TYPE).toBe("ai_trial");
    expect(ARCHIVED_AI_TARGET_TYPES).toContain("ai_trial");
    for (const definition of Object.values(AI_FEATURES)) {
      expect(definition.allowedTargets.map((target) => target.type)).not.toContain("ai_trial");
    }
  });

  it("Zod-skjemaet avviser målet", () => {
    expect(aiSuggestionRequestSchema.safeParse(validRequest()).success).toBe(true);
    expect(
      aiSuggestionRequestSchema.safeParse(validRequest({ target: trialTarget() })).success,
    ).toBe(false);
  });

  it("med falsk leverandør: nøytralt avslag, ingen rad, intet kall, ingen revisjonslogg", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const baseline = await neutralRequestRejection(grant);
    const auditBefore = await auditCount();
    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ target: trialTarget() })),
    );
    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
    spy.mockRestore();
  });

  it("med ekte leverandør: samme avslag, ingen sperret rad", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAnthropic(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const baseline = await neutralRequestRejection(grant);
    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ target: trialTarget() })),
    );
    expectSameRejection(error, baseline);
    expect(await aiRowCount()).toBe(0);
  });
});

describe("K3.5 gamle ai_trial-rader kan fortsatt leses", () => {
  it("getSuggestionStatus, sperren og beslutningen virker på en gammel rad", async () => {
    const { organization, grant } = await aiOrganization();
    const target = trialTarget();
    const old = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      targetRef: target,
    });

    expect(await getSuggestionStatus(grant, old.id)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
    const item = { aiUsageId: old.id, target };
    expect(await checkAiTextApproved(grant, [item])).toEqual([item]);

    await recordDecision(grant, old.id, "accepted");
    expect(await getSuggestionStatus(grant, old.id)).toEqual({
      status: "accepted",
      outcome: "ok",
    });
    expect(await checkAiTextApproved(grant, [item])).toEqual([]);
  });
});
