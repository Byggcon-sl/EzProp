import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiRow,
  aiRowCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  mergeOrganizationSettings,
  neutralDecisionRejection,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  createAiUsageLog,
  createOrganization,
  createOverrideSummaryRow,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AiRateLimitError, AiRequestRejectedError } from "./errors";
import { AI_FEATURES, type AiFeatureDefinition } from "./features";
import {
  AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
  AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
} from "./limits";
import {
  FAKE_ADD_NUMBER_INPUT,
  FAKE_ADD_TG_INPUT,
  FAKE_ERROR_INPUT,
  fakeAiProvider,
} from "./providers/fake";
import { recordDecision } from "./record-decision";
import { isOrganizationTargetAllowed, requestSuggestion } from "./request-suggestion";
import { getSuggestionStatus } from "./suggestion-status";
import type { AiOverrideStats, AiOverrideStatsRow, AiSuggestionRequest } from "./types";

/*
 * `override_summary` gjennom kjernen (docs/funksjoner/fase2a-overstyringer-leder-testplan.md
 * O4.16–O4.26 for KI-delen, O5.2–O5.3, O6.3; ADR 0006 tillegg 24.11.2026). Mot testdatabasen og
 * den falske leverandøren. For sperren mot ekte leverandør (O4.26, A568) byttes leverandøren med
 * en oppdiktet «ekte» leverandør som bare svarer fast tekst; ingen nettkall.
 *
 * Alle tall, navn og etiketter er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (månedsoppsummeringen går samme vei som all annen KI, med logg,
 * vakter og beslutning) og færre reklamasjoner (tallene kan ikke endres av KI).
 */

const swap = vi.hoisted(() => ({
  /** Når satt: leverandøren `resolveAiProvider` gir (en oppdiktet ekte leverandør). */
  provider: null as null | {
    code: string;
    model: string;
    complete: (request: unknown) => Promise<unknown>;
  },
  /** Når satt: endrer definisjonen til `override_summary` (for å prøve at sperren holder). */
  patch: null as null | Record<string, unknown>,
}));

vi.mock("./provider-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-resolution")>();
  return {
    ...actual,
    resolveAiProvider: async (grant: EmployeeGrant) =>
      swap.provider
        ? {
            kind: "enabled" as const,
            provider: swap.provider,
            model: swap.provider.model,
            features: null,
          }
        : actual.resolveAiProvider(grant),
  };
});

vi.mock("./features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features")>();
  return {
    ...actual,
    getFeatureDefinition: (code: string) => {
      const definition = actual.getFeatureDefinition(code);
      if (!definition || definition.code !== "override_summary" || swap.patch === null) {
        return definition;
      }
      return { ...definition, ...swap.patch };
    },
  };
});

beforeEach(async () => {
  await resetDatabase();
  swap.provider = null;
  swap.patch = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MONTH = "2026-10";

function statsRow(overrides: Partial<AiOverrideStatsRow> = {}): AiOverrideStatsRow {
  return {
    checkCode: "wet_or_below_ground_missing_hole",
    checkLabel: "Hulltaking mangler svar eller grunn",
    checkpointKey: "wet_room.hole_moisture",
    checkpointName: "Hulltaking i våtrom",
    reasonCode: "no_access_or_refused",
    reasonLabel: "Ikke tilgang eller nektet av eier",
    count: 7,
    sharePercent: 39,
    claimCount: 2,
    previousCount: 2,
    previousSharePercent: 17,
    deltaCount: 5,
    deltaPoints: 22,
    ...overrides,
  };
}

function stats(overrides: Partial<AiOverrideStats> = {}): AiOverrideStats {
  return {
    month: MONTH,
    reportCount: 18,
    previousMonth: { reportCount: 12 },
    rows: [statsRow()],
    ...overrides,
  };
}

function request(summaryId: string, overrides: Partial<AiSuggestionRequest> = {}) {
  return {
    requestId: uuidv7(),
    feature: "override_summary" as const,
    assignmentId: null,
    reportId: null,
    target: { type: "override_summary", id: summaryId, fieldKey: "text" },
    fields: {},
    ...overrides,
  };
}

/** Organisasjon med KI på (`fake`), to ledere og månedsraden. */
async function setup(name = "Oppdiktet Takst A") {
  const organization = await createOrganization(name);
  await enableAi(organization.id);
  const leaderA = await employeeWithGrant(organization.id, ["manager"], "Mxqline Testesen");
  const leaderB = await employeeWithGrant(organization.id, ["manager"], "Leder To");
  const summary = await createOverrideSummaryRow(organization.id, { month: MONTH });
  return { organization, leaderA, leaderB, summary };
}

function promptOf(spy: { mock: { calls: unknown[][] } }, index = 0): string {
  return (spy.mock.calls[index]![0] as { prompt: string }).prompt;
}

describe("O4.16 lage oppsummering gjennom kjernen", () => {
  it("leder får forslag; raden har funksjonen, ingen rapport eller oppdrag, og bare antall i input_summary", async () => {
    const { leaderA, summary } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, { overrideStats: stats() });
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.text).toMatch(/7 rapporter/u);
    expect(result.text).toMatch(/39 %/u);
    expect(spy).toHaveBeenCalledTimes(1);
    const row = (await aiRow(req.requestId))!;
    expect(row.feature).toBe("override_summary");
    expect(row.prompt_version).toBe("override_summary.v1");
    expect(row.report_id).toBe(null);
    expect(row.assignment_id).toBe(null);
    expect(row.source_fields).toEqual([]);
    expect(row.input_summary).toEqual({ rows: 1, rows_cut: 0 });
    expect(row.target_ref).toEqual({ type: "override_summary", id: summary.id, fieldKey: "text" });
  });

  it("kodene sendes ikke; etikettene, punktnavnet og tallene gjør det", async () => {
    const { leaderA, summary } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats(),
      overrideStatsCut: 3,
    });
    const prompt = promptOf(spy);
    expect(prompt).not.toContain("wet_or_below_ground_missing_hole");
    expect(prompt).not.toContain("no_access_or_refused");
    expect(prompt).not.toContain("wet_room.hole_moisture");
    expect(prompt).toContain("Hulltaking i våtrom");
    expect(prompt).toContain("Ikke tilgang eller nektet av eier");
    expect(prompt).toContain("oktober 2026");
  });

  it("overrideStatsCut føres som rows_cut", async () => {
    const { leaderA, summary } = await setup();
    const req = request(summary.id);
    await requestSuggestion(leaderA.grant, req, { overrideStats: stats(), overrideStatsCut: 4 });
    expect((await aiRow(req.requestId))!.input_summary).toEqual({ rows: 1, rows_cut: 4 });
  });
});

describe("O1.3/O4.17 grunnlaget kontrolleres strengt rett før kallet", () => {
  const invalid: [string, unknown][] = [
    ["mangler", undefined],
    ["null rapporter (KI kalles ikke)", stats({ reportCount: 0, rows: [] })],
    [
      "ukjent nøkkel overrideReason",
      stats({ rows: [{ ...statsRow(), overrideReason: "Mxq" } as never] }),
    ],
    ["ukjent nøkkel employeeName", { ...stats(), employeeName: "Mxqline Testesen" }],
    [
      "ukjent nøkkel assignmentId",
      stats({ rows: [{ ...statsRow(), assignmentId: uuidv7() } as never] }),
    ],
    ["kode med mellomrom", stats({ rows: [statsRow({ checkCode: "hull i vatrom" })] })],
    ["kode med æøå", stats({ rows: [statsRow({ reasonCode: "ikke_tilgang_å" })] })],
    ["kode over lengdegrensen", stats({ rows: [statsRow({ checkCode: "a".repeat(101) })] })],
    ["desimaltall", stats({ rows: [statsRow({ count: 2.5, deltaCount: 0.5 })] })],
    ["tall som tekst", stats({ rows: [statsRow({ count: "7" as never })] })],
    [
      "andel under fem rapporter",
      stats({ reportCount: 4, rows: [statsRow({ count: 2, deltaCount: 0 })] }),
    ],
    ["endringen stemmer ikke", stats({ rows: [statsRow({ deltaCount: 4 })] })],
    ["ugyldig måned", stats({ month: "2026-13" })],
    ["samme kombinasjon to ganger", stats({ rows: [statsRow(), statsRow()] })],
    ["punktkode uten navn", stats({ rows: [statsRow({ checkpointName: null })] })],
  ];

  it.each(invalid)("%s: samme avslag, ingen rad, intet kall", async (_name, overrideStats) => {
    const { leaderA, summary } = await setup();
    const baseline = await captureError(() =>
      requestSuggestion(leaderA.grant, request(uuidv7()), { overrideStats: stats() }),
    );
    expect(baseline).toBeInstanceOf(AiRequestRejectedError);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const error = await captureError(() =>
      requestSuggestion(leaderA.grant, request(summary.id), {
        overrideStats: overrideStats as AiOverrideStats,
      }),
    );
    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("andre funksjoner kan ikke få overrideStats, og override_summary tar ikke felt fra nettleseren", async () => {
    const { leaderA, summary } = await setup();
    await expect(
      requestSuggestion(leaderA.grant, request(summary.id, { fields: { text: "Mxq" } }), {
        overrideStats: stats(),
      }),
    ).rejects.toBeInstanceOf(AiRequestRejectedError);
    await expect(
      requestSuggestion(leaderA.grant, request(summary.id), {
        overrideStats: stats(),
        candidates: [],
      }),
    ).rejects.toBeInstanceOf(AiRequestRejectedError);
    await expect(
      requestSuggestion(leaderA.grant, request(summary.id, { assignmentId: uuidv7() }), {
        overrideStats: stats(),
      }),
    ).rejects.toBeInstanceOf(AiRequestRejectedError);
    expect(await aiRowCount()).toBe(0);
  });
});

describe("O4.20 åpent forslag gjenbrukes for hele organisasjonen", () => {
  it("leder B får samme åpne forslag som leder A ba om, uten nytt kall, og kan avgjøre det", async () => {
    const { leaderA, leaderB, summary } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const first = await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats(),
    });
    const second = await requestSuggestion(leaderB.grant, request(summary.id), {
      overrideStats: stats(),
    });
    expect(first.kind).toBe("suggestion");
    expect(second.kind).toBe("suggestion");
    if (first.kind !== "suggestion" || second.kind !== "suggestion") return;
    expect(second.usageId).toBe(first.usageId);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await aiRowCount()).toBe(1);
    await recordDecision(leaderB.grant, first.usageId, "accepted");
    expect((await aiRow(first.usageId))!.status).toBe("accepted");
    // Etter beslutningen er forslaget ikke åpent lenger: nytt trykk gir nytt kall
    await requestSuggestion(leaderB.grant, request(summary.id), { overrideStats: stats() });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("forslag for en annen måned (annen rad) gjenbrukes ikke", async () => {
    const { organization, leaderA, summary } = await setup();
    const september = await createOverrideSummaryRow(organization.id, { month: "2026-09" });
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await requestSuggestion(leaderA.grant, request(summary.id), { overrideStats: stats() });
    await requestSuggestion(leaderA.grant, request(september.id), {
      overrideStats: stats({ month: "2026-09" }),
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("O4.21 grensene i limits.ts (A575)", () => {
  async function seedCalls(
    organizationId: string,
    employeeId: string,
    count: number,
    createdAt = new Date(),
  ) {
    for (let index = 0; index < count; index += 1) {
      await createAiUsageLog(organizationId, {
        employeeId,
        feature: "override_summary",
        promptVersion: "override_summary.v1",
        outcome: "error",
        errorCode: "unavailable",
        sourceFields: [],
        inputSummary: { rows: 1, rows_cut: 0 },
        targetRef: { type: "override_summary", id: uuidv7(), fieldKey: "text" },
        createdAt,
      });
    }
  }

  it("femte forespørsel samme time går, sjette avvises med norsk melding uten rad og kall", async () => {
    const { organization, leaderA, summary } = await setup();
    await seedCalls(
      organization.id,
      leaderA.employee.id,
      AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR - 1,
    );
    const ok = await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats({ rows: [statsRow({ checkpointName: FAKE_ERROR_INPUT })] }),
    });
    expect(ok.kind).toBe("error");
    const before = await aiRowCount();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const error = await captureError(() =>
      requestSuggestion(leaderA.grant, request(summary.id), { overrideStats: stats() }),
    );
    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).reason).toBe("employee_hour");
    expect(error.message).toMatch(/oppsummeringer/u);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(before);
  });

  it("forespørsler eldre enn en time teller ikke for lederen; sperrede rader teller ikke", async () => {
    const { organization, leaderA, summary } = await setup();
    await seedCalls(
      organization.id,
      leaderA.employee.id,
      AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
      new Date(Date.now() - 61 * 60 * 1000),
    );
    for (let index = 0; index < 3; index += 1) {
      await createAiUsageLog(organization.id, {
        employeeId: leaderA.employee.id,
        feature: "override_summary",
        outcome: "blocked",
        status: null,
        outputText: null,
        targetRef: { type: "override_summary", id: summary.id, fieldKey: "text" },
      });
    }
    const result = await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats(),
    });
    expect(result.kind).toBe("suggestion");
  });

  it("organisasjonen: den 21. forespørselen samme døgn avvises, også for en annen leder", async () => {
    const { organization, leaderA, leaderB, summary } = await setup();
    await seedCalls(
      organization.id,
      leaderA.employee.id,
      AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );
    const error = await captureError(() =>
      requestSuggestion(leaderB.grant, request(summary.id), { overrideStats: stats() }),
    );
    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).reason).toBe("organization_day");
  });

  it("grensene telles per organisasjon: en annen organisasjon påvirkes ikke", async () => {
    const a = await setup("Oppdiktet Takst A");
    const b = await setup("Oppdiktet Takst B");
    await seedCalls(
      a.organization.id,
      a.leaderA.employee.id,
      AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
    );
    const result = await requestSuggestion(b.leaderA.grant, request(b.summary.id), {
      overrideStats: stats(),
    });
    expect(result.kind).toBe("suggestion");
  });
});

describe("O4.22–O4.23 feil og vakter", () => {
  it.each([
    [FAKE_ADD_NUMBER_INPUT, "number_guard"],
    [FAKE_ADD_TG_INPUT, "tg_guard"],
  ])("%s stoppes med %s; svaret har ingen tekst", async (trigger, guard) => {
    const { leaderA, summary } = await setup();
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, {
      overrideStats: stats({ rows: [statsRow({ checkpointName: trigger })] }),
    });
    expect(result).toEqual({ kind: "stopped", usageId: req.requestId, guard });
    const row = (await aiRow(req.requestId))!;
    expect(row.outcome).toBe("stopped");
    expect(row.error_code).toBe(guard);
    expect(row.status).toBe(null);
  });

  it("[fake: feil] gir error, og raden har ingen tekst", async () => {
    const { leaderA, summary } = await setup();
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, {
      overrideStats: stats({ rows: [statsRow({ checkpointName: FAKE_ERROR_INPUT })] }),
    });
    expect(result).toEqual({ kind: "error", usageId: req.requestId });
    expect((await aiRow(req.requestId))!.output_text).toBe(null);
  });

  it.each([
    [
      "gjetteord",
      "Hulltaking i våtrom ble krysset bort i 7 rapporter, sannsynligvis av vane.",
      "guess_guard",
    ],
    [
      "navnet på en ansatt",
      "Mxqline Testesen krysset bort hulltaking i 7 rapporter.",
      "name_guard",
    ],
    ["etternavnet alene", "Hulltaking i 7 rapporter, de fleste av Testesen.", "name_guard"],
    ["en TG som ikke står i grunnlaget", "Hulltaking i 7 rapporter bør gi TG2.", "tg_guard"],
    ["en plassholder", "Hulltaking i [navn] ble krysset bort i 7 rapporter.", "placeholder_guard"],
  ])("svar med %s stoppes (%s)", async (_name, answer, guard) => {
    const { leaderA, summary } = await setup();
    vi.spyOn(fakeAiProvider, "complete").mockResolvedValueOnce({
      outcome: "ok",
      text: answer,
      tokensIn: 10,
      tokensOut: 10,
      cost: 0,
      currency: "NOK",
    });
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, { overrideStats: stats() });
    expect(result).toEqual({ kind: "stopped", usageId: req.requestId, guard });
  });

  it("navnet på en ansatt i punktnavnet vaskes før kallet", async () => {
    const { leaderA, summary } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats({ rows: [statsRow({ checkpointName: "Bad hos Mxqline Testesen" })] }),
    });
    const prompt = promptOf(spy);
    expect(prompt).not.toContain("Mxqline");
    expect(prompt).not.toContain("Testesen");
  });

  it("KI av: ingen rad og intet kall", async () => {
    const { organization, leaderA, summary } = await setup();
    await mergeOrganizationSettings(organization.id, { "ai.enabled": false });
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats(),
    });
    expect(result).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });
});

describe("O4.26 isBlocked: organisasjonsmål uten oppdrag mot ekte leverandør (A568)", () => {
  function realProvider() {
    const complete = vi.fn(async () => ({
      outcome: "ok" as const,
      text: "I oktober 2026 ble 18 rapporter publisert.",
      tokensIn: 100,
      tokensOut: 20,
      cost: 0.01,
      currency: "NOK",
    }));
    swap.provider = { code: "anthropic", model: "test-modell", complete };
    return complete;
  }

  it("override_summary med tom tillatt-liste og bare tallgrunnlaget er lov", async () => {
    const { leaderA, summary } = await setup();
    const complete = realProvider();
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, { overrideStats: stats() });
    expect(result.kind).toBe("suggestion");
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await aiRow(req.requestId))!.provider).toBe("anthropic");
  });

  it.each([
    ["med en feltkilde fra nettleseren", { fieldSources: { text: "free_text" } }],
    ["med en annen serverkilde", { serverSources: { findings: ["checkpoints.name"] } }],
    [
      "med tallgrunnlaget og en annen serverkilde",
      { serverSources: { override_stats: ["checkpoints.name"], findings: ["checkpoints.name"] } },
    ],
    ["uten serverkilder", { serverSources: {} }],
  ])("samme mål, men definisjonen %s, sperres (blocked-rad, intet kall)", async (_name, patch) => {
    const { leaderA, summary } = await setup();
    const complete = realProvider();
    swap.patch = patch;
    const req = request(summary.id);
    const result = await requestSuggestion(leaderA.grant, req, { overrideStats: stats() });
    expect(result).toEqual({ kind: "blocked" });
    expect(complete).not.toHaveBeenCalled();
    expect((await aiRow(req.requestId))!.outcome).toBe("blocked");
  });

  it("isOrganizationTargetAllowed er smal: bare organisasjonsmål, tom tillatt-liste og override_stats", () => {
    const base: Pick<AiFeatureDefinition, "allowedFields" | "fieldSources" | "serverSources"> = {
      allowedFields: [],
      fieldSources: {},
      serverSources: { override_stats: ["checkpoints.name"] },
    };
    expect(isOrganizationTargetAllowed(AI_FEATURES.override_summary, "override_summary")).toBe(
      true,
    );
    expect(isOrganizationTargetAllowed(base, "override_summary")).toBe(true);
    // Andre måltyper uten oppdrag sperres som før
    for (const type of ["report", "deviation", "field_answer", "tgiu_detail", "ai_trial"]) {
      expect(isOrganizationTargetAllowed(base, type), type).toBe(false);
    }
    // Andre funksjoner (med felt eller andre kilder) sperres også på organisasjonsmålet
    for (const code of ["language_polish", "phrase_suggest", "summary_draft"] as const) {
      expect(isOrganizationTargetAllowed(AI_FEATURES[code], "override_summary"), code).toBe(false);
    }
    expect(
      isOrganizationTargetAllowed({ ...base, allowedFields: ["text"] }, "override_summary"),
    ).toBe(false);
    expect(
      isOrganizationTargetAllowed(
        { ...base, fieldSources: { text: "free_text" } },
        "override_summary",
      ),
    ).toBe(false);
  });
});

describe("O5.2–O5.3 tilgang per rolle", () => {
  const roles: [string, EmployeeVariant[], boolean][] = [
    ["takstmann", ["inspector"], false],
    ["kontor", ["office"], false],
    ["takstmann med kontor", ["inspector", "office"], false],
    ["leder", ["manager"], true],
    ["admin uten lederrolle", ["admin"], true],
  ];

  it.each(roles)("%s: lage oppsummering (claims.read)", async (_name, variant, allowed) => {
    const { organization, summary } = await setup();
    const { grant } = await employeeWithGrant(organization.id, variant, "Rolle Test");
    const call = requestSuggestion(grant, request(summary.id), { overrideStats: stats() });
    if (allowed) await expect(call).resolves.toMatchObject({ kind: "suggestion" });
    else await expect(call).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("takstmann med access.inspectors_edit_all kan heller ikke lage oppsummering", async () => {
    const { organization, summary } = await setup();
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": true });
    const { grant } = await employeeWithGrant(organization.id, ["inspector"], "Rolle Test");
    await expect(
      requestSuggestion(grant, request(summary.id), { overrideStats: stats() }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it.each(roles)(
    "%s med kjent usageId: status, godta, endre, avvis og angre",
    async (_name, variant, allowed) => {
      const { organization, leaderA, summary } = await setup();
      const created = await requestSuggestion(leaderA.grant, request(summary.id), {
        overrideStats: stats(),
      });
      if (created.kind !== "suggestion") throw new Error("ventet forslag");
      const { grant } = await employeeWithGrant(organization.id, variant, "Rolle Test");
      if (allowed) {
        expect(await getSuggestionStatus(grant, created.usageId)).toEqual({
          status: "suggested",
          outcome: "ok",
        });
        await recordDecision(grant, created.usageId, "edited");
        await recordDecision(grant, created.usageId, "undo");
        await recordDecision(grant, created.usageId, "rejected");
        await recordDecision(grant, created.usageId, "undo");
        await recordDecision(grant, created.usageId, "accepted");
        expect((await aiRow(created.usageId))!.status).toBe("accepted");
        return;
      }
      expect(await getSuggestionStatus(grant, created.usageId)).toBe(null);
      expect(await getSuggestionStatus(grant, uuidv7())).toBe(null);
      const before = JSON.stringify(await aiRow(created.usageId));
      for (const decision of ["accepted", "edited", "rejected", "undo"] as const) {
        const unknown = await captureError(() => recordDecision(grant, uuidv7(), decision));
        const known = await captureError(() => recordDecision(grant, created.usageId, decision));
        expect(known.constructor, decision).toBe(unknown.constructor);
        expect(known.message, decision).toBe(unknown.message);
      }
      expect(JSON.stringify(await aiRow(created.usageId))).toBe(before);
    },
  );

  it("en ansatt med claims.read uten claims.manage kan lage, men ikke avgjøre (samme avslag som ukjent id)", async () => {
    const { organization, leaderA, summary } = await setup();
    const created = await requestSuggestion(leaderA.grant, request(summary.id), {
      overrideStats: stats(),
    });
    if (created.kind !== "suggestion") throw new Error("ventet forslag");
    const { grant } = await employeeWithGrant(organization.id, ["manager"], "Bare Lese");
    // Ingen rolle har claims.read uten claims.manage i dag; grant-et lages for å prøve regelen
    const readOnly: EmployeeGrant = {
      ...grant,
      permissions: grant.permissions.filter((permission) => permission !== "claims.manage"),
    };
    expect(readOnly.permissions).toContain("claims.read");
    const baseline = await neutralDecisionRejection(leaderA.grant);
    const error = await captureError(() => recordDecision(readOnly, created.usageId, "accepted"));
    expectSameRejection(error, baseline);
  });
});

describe("O6.3 tenant-isolasjon", () => {
  it("usageId fra A avvises i B som ukjent id; B får ikke A sitt åpne forslag", async () => {
    const a = await setup("Oppdiktet Takst A");
    const b = await setup("Oppdiktet Takst B");
    const created = await requestSuggestion(a.leaderA.grant, request(a.summary.id), {
      overrideStats: stats(),
    });
    if (created.kind !== "suggestion") throw new Error("ventet forslag");
    expect(await getSuggestionStatus(b.leaderA.grant, created.usageId)).toBe(null);
    const baseline = await neutralDecisionRejection(b.leaderA.grant);
    const error = await captureError(() =>
      recordDecision(b.leaderA.grant, created.usageId, "accepted"),
    );
    expectSameRejection(error, baseline);
    // A sin rad som mål fra B: samme avslag som ukjent id
    const unknown = await captureError(() =>
      requestSuggestion(b.leaderA.grant, request(uuidv7()), { overrideStats: stats() }),
    );
    const foreign = await captureError(() =>
      requestSuggestion(b.leaderA.grant, request(a.summary.id), { overrideStats: stats() }),
    );
    expectSameRejection(foreign, unknown);
    // B sitt eget trykk gir et eget forslag
    const own = await requestSuggestion(b.leaderA.grant, request(b.summary.id), {
      overrideStats: stats(),
    });
    expect(own.kind).toBe("suggestion");
    if (own.kind === "suggestion") expect(own.usageId).not.toBe(created.usageId);
  });

  it("expectTenantIsolation: forslaget lages bare på egen organisasjons rad", async () => {
    const summaries: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createOverrideSummaryRow(grantA.organizationId);
        const b = await createOverrideSummaryRow(grantB.organizationId);
        summaries.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
        const found: string[] = [];
        for (const id of summaries) {
          try {
            const result = await requestSuggestion(grant, request(id), { overrideStats: stats() });
            if (result.kind === "suggestion") found.push(id);
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return found;
      },
      idOf: (id) => id,
    });
  });
});
