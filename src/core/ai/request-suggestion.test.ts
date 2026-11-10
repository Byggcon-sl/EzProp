import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import {
  AiRequestRejectedError,
  FAKE_ERROR_INPUT,
  FAKE_NO_MATCH_INPUT,
  fakeAiProvider,
  requestSuggestion,
  type AiSuggestionRequest,
} from "@/core/ai";
import { db } from "@/db/client";
import { aiUsageLog, assignments } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  TEST_NOW,
  createAiUsageLog,
  createAssignment,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  EDIT_ALL,
  SAMPLE_TEXT,
  addMember,
  aiOrganization,
  auditCount,
  auditFor,
  enableAi,
  polishField,
  polishRequest,
  polishTarget,
  regrant,
  setOrganizationSetting,
  AI_ENABLED,
  usageCount,
  usageRow,
  usageRows,
} from "../../../tests/ai";

/*
 * `requestSuggestion` mot testdatabasen og den falske leverandøren (testplan
 * docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 6, 9.1–9.3, 9.5–9.7 og 10.2–10.3).
 * Feil i samme transaksjon (6.24) står i request-suggestion-transaction.test.ts.
 *
 * Alle data er oppdiktet. Ingen nettverkskall: bare `fake`.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn, hvert kall logges likt), de ansatte (gjentatt kall
 * fra iPaden gir samme svar, ingen doble rader) og færre reklamasjoner (et forslag kan aldri
 * leses eller avgjøres av en annen organisasjon, og forrige forslag avvises med spor).
 */

const NEUTRAL_MESSAGE = new AiRequestRejectedError().message;
const field = polishField();

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(fakeAiProvider, "complete");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function expectNeutralRejection(promise: Promise<unknown>) {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, "nøytralt avslag").toBeInstanceOf(AiRequestRejectedError);
  expect((error as Error).message).toBe(NEUTRAL_MESSAGE);
  return error as Error;
}

/** Alle kolonnene i raden som tekst, for sammenligning før og etter. */
async function snapshot(id: string) {
  return JSON.stringify(await usageRow(id));
}

describe("requestSuggestion: vellykket kall (6.1–6.4)", () => {
  it("6.1 forslag: svaret og én rad med alle feltene", async () => {
    const { organization, inspector } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    const request = polishRequest({ assignmentId: assignment.id });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.usageId).toBe(request.requestId);
    expect(result.status).toBe("suggested");
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.candidateId).toBeNull();
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);

    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(request.requestId);
    expect(row.organizationId).toBe(organization.id);
    expect(row.feature).toBe("language_polish");
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("fake-v1");
    expect(row.promptVersion).toBe("language_polish.v1");
    expect(Number(row.cost)).toBe(0);
    expect(row.currency).toBe("NOK");
    expect(row.employeeId).toBe(inspector.employeeId);
    expect(row.targetRef).toEqual(request.target);
    expect(row.assignmentId).toBe(assignment.id);
    expect(row.reportId).toBeNull();
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
    expect(row.outputText).toBe(result.text);
    expect(row.errorCode).toBeNull();
    expect(row.decidedBy).toBeNull();
    expect(row.decidedAt).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.tokensIn).toBeGreaterThanOrEqual(0);
    expect(row.tokensOut).toBeGreaterThanOrEqual(0);
  });

  it("6.2 source_fields er bare feltkoden, input_summary bare feltnavn og antall tegn", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest();

    await requestSuggestion(inspector.grant, request);

    const row = (await usageRow(request.requestId))!;
    expect(row.sourceFields).toEqual([field]);
    expect(row.inputSummary).toEqual({ [field]: SAMPLE_TEXT.length });
    expect(JSON.stringify(row.inputSummary)).not.toContain("taket");
  });

  it("6.3 retain_until er opprettet + 10 år (fast tid)", async () => {
    const { inspector } = await aiOrganization();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    const request = polishRequest();

    await requestSuggestion(inspector.grant, request);

    const row = (await usageRow(request.requestId))!;
    expect(row.createdAt.toISOString()).toBe(TEST_NOW.toISOString());
    expect(row.retainUntil.toISOString()).toBe("2036-11-03T10:00:00.000Z");
  });

  it("6.3 opprettet 29.02.2028 gir 01.03.2038 (samme regel som filene: ett år etter 29.02 er 01.03)", async () => {
    const { inspector } = await aiOrganization();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-29T12:00:00Z"));
    const request = polishRequest();

    await requestSuggestion(inspector.grant, request);

    const row = (await usageRow(request.requestId))!;
    expect(row.retainUntil.toISOString()).toBe("2038-03-01T12:00:00.000Z");
  });

  it("6.4 assignmentId = null gir rad med tom assignment_id", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ assignmentId: null });

    expect((await requestSuggestion(inspector.grant, request)).kind).toBe("suggestion");
    expect((await usageRow(request.requestId))!.assignmentId).toBeNull();
  });
});

describe("requestSuggestion: utfall uten forslag (6.5–6.7)", () => {
  it("6.5 ingen treff: no_match, tom status og output_text", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: FAKE_NO_MATCH_INPUT } });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result).toEqual({ kind: "no_match", usageId: request.requestId });
    const row = (await usageRow(request.requestId))!;
    expect(row.outcome).toBe("no_match");
    expect(row.status).toBeNull();
    expect(row.outputText).toBeNull();
    expect(row.errorCode).toBeNull();
    expect(Number(row.cost)).toBe(0);
  });

  it("6.6 feil fra leverandøren: error med den faste koden fra fake", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: FAKE_ERROR_INPUT } });
    const expected = await fakeAiProvider.complete({
      feature: "language_polish",
      promptVersion: "language_polish.v1",
      prompt: FAKE_ERROR_INPUT,
      model: "fake-v1",
    });
    vi.mocked(fakeAiProvider.complete).mockClear();
    expect(expected.outcome).toBe("error");

    const result = await requestSuggestion(inspector.grant, request);

    expect(result).toEqual({ kind: "error", usageId: request.requestId });
    const row = (await usageRow(request.requestId))!;
    expect(row.outcome).toBe("error");
    expect(row.errorCode).toBe(expected.outcome === "error" ? expected.errorCode : "mangler");
    expect(row.status).toBeNull();
    expect(row.outputText).toBeNull();
  });

  it("6.7 unntak i leverandøren: error med unknown, ingen unntak ut, ingen melding i raden eller loggen", async () => {
    const { inspector } = await aiOrganization();
    vi.mocked(fakeAiProvider.complete).mockRejectedValue(new Error("hemmelig-markør"));
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    const request = polishRequest();

    const result = await requestSuggestion(inspector.grant, request);

    expect(result).toEqual({ kind: "error", usageId: request.requestId });
    const row = (await usageRow(request.requestId))!;
    expect(row.outcome).toBe("error");
    expect(row.errorCode).toBe("unknown");
    expect(JSON.stringify(row)).not.toContain("hemmelig-markør");
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("hemmelig-markør");
    }
  });
});

describe("requestSuggestion: avslag før kallet (6.8–6.10)", () => {
  type Change = (request: Record<string, unknown>) => void;
  const cases: [string, Change][] = [
    ["ukjent funksjon", (r) => (r.feature = "tg_suggest")],
    ["felt utenfor tillatt-listen", (r) => (r.fields = { [field]: "x", email: "x" })],
    ["ulovlig mål", (r) => (r.target = { ...polishTarget(), type: "contact" })],
    ["TG-felt som mål", (r) => (r.target = { ...polishTarget(), fieldKey: "tg" })],
    ["reportId satt", (r) => (r.reportId = randomUUID())],
    ["candidates med innhold", (r) => (r.candidates = [{ id: randomUUID(), text: "Frase" }])],
    ["verdi på 5 001 tegn", (r) => (r.fields = { [field]: "a".repeat(5001) })],
    ["ugyldig requestId", (r) => (r.requestId = "ikke-en-uuid")],
  ];

  it.each(cases)(
    "6.8 %s → nøytralt avslag, intet kall, ingen rad, ingen revisjonslinje",
    async (_name, change) => {
      const { inspector } = await aiOrganization();
      const request = polishRequest() as unknown as Record<string, unknown>;
      change(request);
      const auditBefore = await auditCount();

      await expectNeutralRejection(
        requestSuggestion(inspector.grant, request as unknown as AiSuggestionRequest),
      );

      expect(fakeAiProvider.complete).not.toHaveBeenCalled();
      expect(await usageCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it("6.9 ukjent oppdrag (tilfeldig UUID) → samme nøytrale avslag", async () => {
    const { inspector } = await aiOrganization();

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, polishRequest({ assignmentId: randomUUID() })),
    );
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });

  it("6.9 mykt slettet oppdrag → samme nøytrale avslag", async () => {
    const { organization, inspector } = await aiOrganization();
    const assignment = await createAssignment(organization.id, {
      deletedAt: new Date("2026-11-01T10:00:00Z"),
    });

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, polishRequest({ assignmentId: assignment.id })),
    );
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });

  it("6.10 oppdrag i en annen organisasjon → samme nøytrale avslag", async () => {
    const { inspector } = await aiOrganization("Organisasjon A");
    const other = await createOrganization("Organisasjon B");
    const foreign = await createAssignment(other.id);

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, polishRequest({ assignmentId: foreign.id })),
    );
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });
});

describe("requestSuggestion: samme requestId igjen (6.11–6.18)", () => {
  it("6.11 etter hverandre: likt svar, ett kall, én rad, ingen ny revisjonslinje", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    // Et åpent forslag på målet, så første kall gir en revisjonslinje (avvisning)
    await createAiUsageLog(organization.id, { targetRef: target });
    const request = polishRequest({ target });

    const first = await requestSuggestion(inspector.grant, request);
    const auditAfterFirst = await auditCount();
    expect(auditAfterFirst).toBe(1);
    const second = await requestSuggestion(inspector.grant, request);

    expect(second).toEqual(first);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    expect(
      await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, request.requestId)),
    ).toHaveLength(1);
    expect(await auditCount()).toBe(auditAfterFirst);
  });

  it("6.12 samtidig (Promise.all): én rad og like svar", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest();

    const [first, second] = await Promise.all([
      requestSuggestion(inspector.grant, request),
      requestSuggestion(inspector.grant, request),
    ]);

    expect(first.kind).toBe("suggestion");
    expect(second).toEqual(first);
    expect(await usageCount()).toBe(1);
  });

  it("6.13 samme id, annet mål (annen target.id) → nøytralt avslag, første rad uendret", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest();
    await requestSuggestion(inspector.grant, request);
    const before = await snapshot(request.requestId);

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, { ...request, target: polishTarget() }),
    );

    expect(await snapshot(request.requestId)).toBe(before);
    expect(await usageCount()).toBe(1);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
  });

  it("6.13 samme id, annen feltkode eller annen funksjon → nøytralt avslag, første rad uendret", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest();
    await requestSuggestion(inspector.grant, request);
    const before = await snapshot(request.requestId);

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, {
        ...request,
        target: { ...request.target, fieldKey: "annet_felt" },
      }),
    );
    await expectNeutralRejection(
      requestSuggestion(inspector.grant, {
        ...request,
        feature: "annen_funksjon" as AiSuggestionRequest["feature"],
      }),
    );

    expect(await snapshot(request.requestId)).toBe(before);
    expect(await usageCount()).toBe(1);
  });

  it("6.14 samme id fra en annen ansatt i samme organisasjon → nøytralt avslag, teksten røpes ikke", async () => {
    const { organization, inspector } = await aiOrganization();
    const colleague = await addMember(organization.id, ["inspector"], "Test Kollega");
    const request = polishRequest();
    const first = await requestSuggestion(inspector.grant, request);
    expect(first.kind).toBe("suggestion");
    const before = await snapshot(request.requestId);

    const error = await expectNeutralRejection(requestSuggestion(colleague.grant, request));

    expect(await snapshot(request.requestId)).toBe(before);
    if (first.kind === "suggestion") expect(error.message).not.toContain(first.text);
    expect(JSON.stringify(error)).not.toContain("sprekker");
    expect(await usageCount()).toBe(1);
  });

  it("6.15 samme id fra en annen organisasjon → nøytralt avslag, A sin rad uendret, B får ingen rad", async () => {
    const { inspector: inspectorA } = await aiOrganization("Organisasjon A");
    const { organization: orgB, inspector: inspectorB } = await aiOrganization("Organisasjon B");
    const request = polishRequest();
    await requestSuggestion(inspectorA.grant, request);
    const before = await snapshot(request.requestId);

    await expectNeutralRejection(requestSuggestion(inspectorB.grant, request));

    expect(await snapshot(request.requestId)).toBe(before);
    expect(await usageRows(orgB.id)).toHaveLength(0);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no_match", FAKE_NO_MATCH_INPUT],
    ["error", FAKE_ERROR_INPUT],
  ])("6.16 gjentatt kall for et %s-svar gir samme svar uten nytt kall", async (kind, input) => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: input } });

    const first = await requestSuggestion(inspector.grant, request);
    const second = await requestSuggestion(inspector.grant, request);

    expect(first).toEqual({ kind, usageId: request.requestId });
    expect(second).toEqual(first);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    expect(await usageCount()).toBe(1);
  });

  it("6.17 gjentatt kall etter at KI er slått av gir det lagrede svaret (avklaring B)", async () => {
    const { organization, inspector } = await aiOrganization();
    const request = polishRequest();
    const first = await requestSuggestion(inspector.grant, request);
    await setOrganizationSetting(organization.id, AI_ENABLED, false);

    const second = await requestSuggestion(inspector.grant, request);

    expect(second).toEqual(first);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    // Et nytt kall (ny id) er av
    expect(await requestSuggestion(inspector.grant, polishRequest())).toEqual({ kind: "disabled" });
  });

  it("6.18 gjentatt kall uten rettighet (takstmann har mistet report.edit) → AccessDeniedError", async () => {
    const { organization, inspector } = await aiOrganization();
    const request = polishRequest();
    await requestSuggestion(inspector.grant, request);
    const before = await snapshot(request.requestId);
    await setOrganizationSetting(organization.id, EDIT_ALL, false);
    const grant = await regrant(inspector, organization.id);
    expect(grant.permissions).not.toContain("report.edit");

    await expect(requestSuggestion(grant, request)).rejects.toThrow(AccessDeniedError);

    expect(await snapshot(request.requestId)).toBe(before);
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
  });
});

describe("requestSuggestion: nytt forslag på samme mål (6.19–6.23, 6.25)", () => {
  it("6.19 forrige suggested-forslag (fra en annen takstmann) settes til rejected med spor", async () => {
    const { organization, inspector } = await aiOrganization();
    const colleague = await addMember(organization.id, ["inspector"], "Test Kollega");
    const target = polishTarget();
    const previous = polishRequest({ target });
    await requestSuggestion(colleague.grant, previous);
    const auditBefore = await auditCount();

    const result = await requestSuggestion(inspector.grant, polishRequest({ target }));
    expect(result.kind).toBe("suggestion");

    const old = (await usageRow(previous.requestId))!;
    expect(old.status).toBe("rejected");
    expect(old.decidedBy).toBe(inspector.employeeId);
    expect(old.decidedAt).toBeInstanceOf(Date);
    expect(old.employeeId).toBe(colleague.employeeId);

    expect(await auditCount()).toBe(auditBefore + 1);
    const lines = await auditFor(previous.requestId);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.organizationId).toBe(organization.id);
    expect(line.actorEmployeeId).toBe(inspector.employeeId);
    expect(line.changes).toEqual({ status: { from: "suggested", to: "rejected" } });
    expect(JSON.stringify(line)).not.toContain(old.outputText!);
  });

  it.each(["accepted", "edited", "rejected"])(
    "6.20 forslag som allerede er %s, røres ikke",
    async (status) => {
      const { organization, inspector } = await aiOrganization();
      const target = polishTarget();
      const existing = await createAiUsageLog(organization.id, { targetRef: target, status });
      const before = await snapshot(existing.id);

      await requestSuggestion(inspector.grant, polishRequest({ target }));

      expect(await snapshot(existing.id)).toBe(before);
      expect(await auditFor(existing.id)).toHaveLength(0);
    },
  );

  it("6.21 samme mål i en annen organisasjon røres ikke", async () => {
    const { inspector } = await aiOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const target = polishTarget();
    const foreign = await createAiUsageLog(orgB.id, { targetRef: target });
    const before = await snapshot(foreign.id);

    await requestSuggestion(inspector.grant, polishRequest({ target }));

    expect(await snapshot(foreign.id)).toBe(before);
    expect(await auditFor(foreign.id)).toHaveLength(0);
  });

  it("6.22 / 10.2 mykt slettet suggested-forslag på samme mål røres ikke", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const deleted = await createAiUsageLog(organization.id, {
      targetRef: target,
      deletedAt: new Date("2026-11-01T10:00:00Z"),
    });
    const before = await snapshot(deleted.id);

    await requestSuggestion(inspector.grant, polishRequest({ target }));

    expect(await snapshot(deleted.id)).toBe(before);
    expect((await usageRow(deleted.id))!.status).toBe("suggested");
  });

  it("6.23 annet mål (samme type og id, annen feltkode; eller annen id) røres ikke", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const otherField = await createAiUsageLog(organization.id, {
      targetRef: { ...target, fieldKey: "annet_felt" },
    });
    const otherId = await createAiUsageLog(organization.id, { targetRef: polishTarget() });
    const otherType = await createAiUsageLog(organization.id, {
      targetRef: { ...target, type: "annen_type" },
    });
    const before = await Promise.all([otherField, otherId, otherType].map((r) => snapshot(r.id)));

    await requestSuggestion(inspector.grant, polishRequest({ target }));

    const after = await Promise.all([otherField, otherId, otherType].map((r) => snapshot(r.id)));
    expect(after).toEqual(before);
  });

  it.each([
    ["no_match", FAKE_NO_MATCH_INPUT],
    ["error", FAKE_ERROR_INPUT],
  ])(
    "6.25 nytt kall gir %s: forrige suggested står urørt, ingen revisjonslinje",
    async (kind, input) => {
      const { organization, inspector } = await aiOrganization();
      const target = polishTarget();
      const previous = await createAiUsageLog(organization.id, { targetRef: target });
      const before = await snapshot(previous.id);
      const auditBefore = await auditCount();
      const request = polishRequest({ target, fields: { [field]: input } });

      const result = await requestSuggestion(inspector.grant, request);

      expect(result.kind).toBe(kind);
      expect(await snapshot(previous.id)).toBe(before);
      const old = (await usageRow(previous.id))!;
      expect(old.status).toBe("suggested");
      expect(old.decidedBy).toBeNull();
      expect(old.decidedAt).toBeNull();
      expect(await auditCount()).toBe(auditBefore);
      expect((await usageRow(request.requestId))!.outcome).toBe(kind);
    },
  );
});

describe("requestSuggestion: myk sletting (10.3)", () => {
  it("10.3 samme requestId på en mykt slettet rad → nøytralt avslag, ingen ny rad, intet kall", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const deleted = await createAiUsageLog(organization.id, {
      employeeId: inspector.employeeId,
      targetRef: target,
      deletedAt: new Date("2026-11-01T10:00:00Z"),
    });
    const before = await snapshot(deleted.id);

    await expectNeutralRejection(
      requestSuggestion(inspector.grant, polishRequest({ requestId: deleted.id, target })),
    );

    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await snapshot(deleted.id)).toBe(before);
    expect(await usageCount()).toBe(1);
    expect((await usageRow(deleted.id))!.deletedAt).not.toBeNull();
  });
});

describe("requestSuggestion: tenant-isolasjon (9.1–9.3, 9.5–9.6)", () => {
  const editGrant = (actor: Actor, organizationId: string) =>
    requireOrganizationAccess(actor, organizationId, "report.edit");

  it("9.1 oppslag på requestId: gjentatt kall gir bare egne rader", async () => {
    const requests: AiSuggestionRequest[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = polishRequest();
        const b = polishRequest();
        await requestSuggestion(grantA, a);
        await requestSuggestion(grantB, b);
        requests.push(a, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await editGrant(actor, organizationId);
        const found: { id: string }[] = [];
        for (const request of requests) {
          try {
            const result = await requestSuggestion(grant, request);
            if (result.kind !== "disabled") found.push({ id: result.usageId });
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return found;
      },
      idOf: (row) => row.id,
    });
    // Ingen nye rader av de gjentatte kallene
    expect(await usageCount()).toBe(2);
  });

  it("9.2 oppslag av oppdrag: bare egne oppdrag godtas", async () => {
    const assignmentIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        assignmentIds.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await editGrant(actor, organizationId);
        const accepted: { id: string }[] = [];
        for (const assignmentId of assignmentIds) {
          try {
            const result = await requestSuggestion(grant, polishRequest({ assignmentId }));
            if (result.kind === "suggestion") accepted.push({ id: assignmentId });
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return accepted;
      },
      idOf: (row) => row.id,
    });
    // Hver rad peker på et oppdrag i sin egen organisasjon
    const rows = await usageRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const [match] = await db
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.id, row.assignmentId!),
            eq(assignments.organizationId, row.organizationId),
          ),
        );
      expect(match, `rad ${row.id}`).toBeTruthy();
    }
  });

  it("9.3 settet som avviser forrige forslag: bare egne rader blir rejected", async () => {
    const target = polishTarget();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createAiUsageLog(grantA.organizationId, { targetRef: target });
        const b = await createAiUsageLog(grantB.organizationId, { targetRef: target });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await editGrant(actor, organizationId);
        await requestSuggestion(grant, polishRequest({ target }));
        // Uten filter på organisasjon: en avvisning på tvers ville vist seg her
        return db
          .select()
          .from(aiUsageLog)
          .where(
            and(eq(aiUsageLog.status, "rejected"), eq(aiUsageLog.decidedBy, grant.employeeId)),
          );
      },
      idOf: (row) => row.id,
    });
  });

  it("9.5 lesing av ai.enabled: forslag bare i egen organisasjon", async () => {
    const requestFor = new Map<string, AiSuggestionRequest>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = polishRequest();
        const b = polishRequest();
        requestFor.set(grantA.organizationId, a);
        requestFor.set(grantB.organizationId, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await editGrant(actor, organizationId);
        const result = await requestSuggestion(grant, requestFor.get(organizationId)!);
        return result.kind === "disabled" ? [] : [{ id: result.usageId }];
      },
      idOf: (row) => row.id,
    });
  });

  it("9.6 oppslag av tilkobling: forslag bare fra egen tilkobling", async () => {
    const requestFor = new Map<string, AiSuggestionRequest>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = polishRequest();
        const b = polishRequest();
        requestFor.set(grantA.organizationId, a);
        requestFor.set(grantB.organizationId, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await editGrant(actor, organizationId);
        const result = await requestSuggestion(grant, requestFor.get(organizationId)!);
        if (result.kind === "disabled") return [];
        const row = await usageRow(result.usageId);
        return row && row.organizationId === organizationId ? [{ id: result.usageId }] : [];
      },
      idOf: (row) => row.id,
    });
  });
});
