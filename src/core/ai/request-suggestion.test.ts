import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  AI_ERROR_CODES,
  aiOrganization,
  aiRow,
  aiRowCount,
  allAuditRows,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  fakeAiProvider,
  fakeErrorInputs,
  fakeNoMatchInput,
  mergeOrganizationSettings,
  neutralRequestRejection,
  requestSuggestion,
  SAMPLE_TEXT,
  snapshot,
  tenYearsAfter,
  validRequest,
  validTarget,
  type AiRequestForTest,
} from "../../../tests/ai";
import {
  createAiUsageLog,
  createAssignment,
  createOrganization,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { redactFields } from "./redaction";

/*
 * `requestSuggestion` (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 6, 9.1–9.3 og
 * 10.2–10.3; kortet Omfang 3 og avklaringene A–C). Mot testdatabasen med den falske leverandøren.
 * Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn, alt logges likt), de ansatte (gjentatte kall fra
 * iPaden gir samme svar og ingen dobbel rad) og færre reklamasjoner (et forslag kan aldri avgjøres
 * eller leses av en annen organisasjon, og hvem som ba om hva står i loggen).
 */

const SECRET_MARKER = "hemmelig-markør";

/*
 * Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 4, 5 og 7): leverandøren og
 * vasken kan byttes ut i én test. Standard er de ekte funksjonene, så de andre testene prøver den
 * ekte veien.
 */
const swap = vi.hoisted(() => ({
  provider: null as null | {
    code: string;
    model: string;
    complete: (request: unknown) => Promise<unknown>;
  },
  redact: null as
    | null
    | ((
        grant: unknown,
        assignmentId: string | null,
        fields: Record<string, string>,
      ) => Promise<{ fields: Record<string, string>; count: number }>),
}));

vi.mock("./provider-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-resolution")>();
  return {
    ...actual,
    resolveAiProvider: async (grant: EmployeeGrant) =>
      swap.provider
        ? { kind: "enabled" as const, provider: swap.provider, model: swap.provider.model }
        : actual.resolveAiProvider(grant),
  };
});

vi.mock("./redaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redaction")>();
  return {
    ...actual,
    redactFields: vi.fn(
      (grant: EmployeeGrant, assignmentId: string | null, fields: Record<string, string>) =>
        swap.redact
          ? swap.redact(grant, assignmentId, fields)
          : actual.redactFields(grant, assignmentId, fields),
    ),
  };
});

beforeEach(resetDatabase);
afterEach(() => {
  swap.provider = null;
  swap.redact = null;
  vi.mocked(redactFields).mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function spyOnLogger() {
  return [
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function loggedText(spies: ReturnType<typeof spyOnLogger>): string {
  return JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
  );
}

/** Leaf-verdiene i et JSON-objekt. */
function leaves(value: unknown): unknown[] {
  if (value === null || typeof value !== "object") return [value];
  return Object.values(value as Record<string, unknown>).flatMap(leaves);
}

describe("requestSuggestion: vellykket kall (6.1–6.4)", () => {
  it("6.1 forslag: svaret og én rad med funksjon, fake, fake-v1, ledetekstversjon, 0 NOK", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    const request = validRequest({ assignmentId: assignment.id });

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({
      kind: "suggestion",
      usageId: request.requestId,
      status: "suggested",
      text: expect.any(String),
      candidateId: null,
    });
    if (result.kind !== "suggestion") return;
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(await aiRowCount()).toBe(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.organization_id).toBe(grant.organizationId);
    expect(row.employee_id).toBe(grant.employeeId);
    expect(row.feature).toBe("language_polish");
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("fake-v1");
    expect(row.prompt_version).toBe("language_polish.v1");
    expect(Number(row.cost)).toBe(0);
    expect(row.currency).toBe("NOK");
    expect(row.target_ref).toEqual(request.target);
    expect(row.assignment_id).toBe(assignment.id);
    expect(row.report_id).toBeNull();
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
    expect(row.output_text).toBe(result.text);
    expect(row.error_code).toBeNull();
    expect(row.decided_by).toBeNull();
    expect(row.decided_at).toBeNull();
    expect(row.deleted_at).toBeNull();
  });

  it('6.2 source_fields er nøyaktig ["text"]; input_summary har bare feltnavn og antall tegn', async () => {
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(row.source_fields).toEqual(["text"]);
    const summary = JSON.stringify(row.input_summary);
    expect(summary).toContain('"text"');
    expect(summary).not.toContain("Taket");
    expect(summary).not.toContain("sprekker");
    // Bare tall som verdier, og antallet tegn i teksten finnes
    for (const leaf of leaves(row.input_summary)) expect(typeof leaf, summary).toBe("number");
    expect(leaves(row.input_summary)).toContain(SAMPLE_TEXT.length);
  });

  it("6.3 retain_until er opprettet + 10 år (fast tid)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe(tenYearsAfter(TEST_NOW).toISOString());
    expect(new Date(row.retain_until).toISOString()).toBe("2036-11-03T10:00:00.000Z");
  });

  it("6.3 opprettet 29.02.2028 gir retain_until 01.03.2038 (minst ti år)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-29T10:00:00Z"));
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe("2038-03-01T10:00:00.000Z");
  });

  it("6.4 assignmentId = null godtas og gir tom assignment_id", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ assignmentId: null });
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    expect((await aiRow(request.requestId))!.assignment_id).toBeNull();
  });

  it("2.5 ledeteksten leverandøren får: language_polish.v1, fake-v1, med teksten og uten gjetteord", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await requestSuggestion(grant, validRequest());
    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]![0];
    expect(sent.feature).toBe("language_polish");
    expect(sent.promptVersion).toBe("language_polish.v1");
    expect(sent.model).toBe("fake-v1");
    expect(sent.prompt).toContain(SAMPLE_TEXT);
    const instruction = sent.prompt.replace(SAMPLE_TEXT, "").trim();
    expect(instruction.length, "ledeteksten har mer enn bare teksten").toBeGreaterThan(0);
    expect(sent.prompt).not.toMatch(/\b(antas|trolig)\b/i);
    // Ingen organisasjon, ansatt eller oppdrag i det leverandøren får
    expect(JSON.stringify(sent)).not.toContain(grant.organizationId);
    expect(JSON.stringify(sent)).not.toContain(grant.employeeId);
  });
});

describe("requestSuggestion: utfall uten forslag (6.5–6.7)", () => {
  it("6.5 ingen treff: no_match, tom status og output_text", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: fakeNoMatchInput() } });
    const result = await requestSuggestion(grant, request);
    expect(result).toEqual({ kind: "no_match", usageId: request.requestId });
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("no_match");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
  });

  it("6.6 feil fra leverandøren: error, error_code er en fast kode", async () => {
    const { grant } = await aiOrganization();
    for (const input of fakeErrorInputs()) {
      const request = validRequest({ fields: { text: input } });
      const result = await requestSuggestion(grant, request);
      expect(result).toEqual({ kind: "error", usageId: request.requestId });
      const row = (await aiRow(request.requestId))!;
      expect(row.outcome).toBe("error");
      expect(AI_ERROR_CODES).toContain(row.error_code);
      expect(row.status).toBeNull();
      expect(row.output_text).toBeNull();
    }
  });

  it("6.7 unntak i leverandøren: error med unknown, ingen unntak ut, markøren ikke i rad eller logger", async () => {
    const { grant } = await aiOrganization();
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(new Error(SECRET_MARKER));
    const logSpies = spyOnLogger();
    const request = validRequest();

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "error", usageId: request.requestId });
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("error");
    expect(row.error_code).toBe("unknown");
    expect(JSON.stringify(row)).not.toContain(SECRET_MARKER);
    expect(loggedText(logSpies)).not.toContain(SECRET_MARKER);
  });
});

describe("requestSuggestion: avslag før kallet (6.8–6.10)", () => {
  const cases: { name: string; change: (request: AiRequestForTest) => AiRequestForTest }[] = [
    { name: "ukjent funksjon", change: (r) => ({ ...r, feature: "tg_suggest" }) },
    {
      name: "felt utenfor tillatt-listen",
      change: (r) => ({ ...r, fields: { ...r.fields, email: "ola@example.com" } }),
    },
    { name: "ulovlig mål", change: (r) => ({ ...r, target: { ...r.target, type: "contact" } }) },
    { name: "TG-felt som mål", change: (r) => ({ ...r, target: { ...r.target, fieldKey: "tg" } }) },
    { name: "reportId satt", change: (r) => ({ ...r, reportId: randomUUID() }) },
    {
      name: "candidates med innhold",
      change: (r) => ({ ...r, candidates: [{ id: randomUUID(), text: "Fast frase" }] }),
    },
    { name: "verdi på 5 001 tegn", change: (r) => ({ ...r, fields: { text: "a".repeat(5001) } }) },
    { name: "ugyldig requestId", change: (r) => ({ ...r, requestId: "ikke-en-uuid" }) },
  ];

  it.each(cases)(
    "6.8 $name → nøytralt avslag, fake ikke kalt, ingen rad, ingen audit",
    async ({ change }) => {
      const { grant } = await aiOrganization();
      const baseline = await neutralRequestRejection(grant);
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const auditBefore = await auditCount();

      const error = await captureError(() => requestSuggestion(grant, change(validRequest())));

      expectSameRejection(error, baseline);
      expect(spy).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it.each([
    { name: "ukjent oppdrag (tilfeldig UUID)", assignment: async () => randomUUID() },
    {
      name: "mykt slettet oppdrag",
      assignment: async (organizationId: string) =>
        (await createAssignment(organizationId, { deletedAt: new Date("2026-11-01T10:00:00Z") }))
          .id,
    },
    {
      name: "oppdrag i en annen organisasjon (6.10)",
      assignment: async () => {
        const other = await createOrganization("Oppdiktet Takst B");
        return (await createAssignment(other.id)).id;
      },
    },
  ])("6.9 $name → samme nøytrale avslag, ingen rad", async ({ assignment }) => {
    const { organization, grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const assignmentId = await assignment(organization.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const auditBefore = await auditCount();

    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ assignmentId })),
    );

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("requestSuggestion: samme requestId igjen (6.11–6.18, 10.3)", () => {
  it("6.11 etter hverandre: likt svar, fake kalt én gang, én rad, ingen ny audit", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    const auditAfterFirst = await auditCount();
    const rowAfterFirst = snapshot(await aiRow(request.requestId));

    const second = await requestSuggestion(grant, request);

    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await aiRowCount()).toBe(1);
    expect(await auditCount()).toBe(auditAfterFirst);
    expect(snapshot(await aiRow(request.requestId))).toBe(rowAfterFirst);
  });

  it("6.12 samtidig (Promise.all): én rad og like svar", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest();
    const [first, second] = await Promise.all([
      requestSuggestion(grant, request),
      requestSuggestion(grant, { ...request }),
    ]);
    expect(second).toEqual(first);
    expect(first.kind).toBe("suggestion");
    expect(await aiRowCount()).toBe(1);
  });

  it.each([
    { name: "annen target.id", change: (r: AiRequestForTest) => ({ ...r, target: validTarget() }) },
    {
      name: "annen fieldKey",
      change: (r: AiRequestForTest) => ({ ...r, target: { ...r.target, fieldKey: "other_text" } }),
    },
    {
      name: "annen funksjon",
      change: (r: AiRequestForTest) => ({ ...r, feature: "dictation_structuring" }),
    },
  ])("6.13 samme id, $name → nøytralt avslag, første rad uendret", async ({ change }) => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(grant, change(request)));

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("6.14 samme id fra en annen ansatt i samme organisasjon → nøytralt avslag, teksten røpes ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const baseline = await neutralRequestRejection(other.grant);
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    if (first.kind !== "suggestion") throw new Error("forventet forslag");
    const before = snapshot(await aiRow(request.requestId));

    const error = await captureError(() => requestSuggestion(other.grant, request));

    expectSameRejection(error, baseline);
    expect(error.message).not.toContain(first.text);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("6.15 samme id fra en annen organisasjon → nøytralt avslag, A sin rad helt uendret, ingen rad i B", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const baseline = await neutralRequestRejection(b.grant);
    const request = validRequest();
    const first = await requestSuggestion(a.grant, request);
    if (first.kind !== "suggestion") throw new Error("forventet forslag");
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(b.grant, request));
    // B prøver også å sende med A sin organisasjon og ansatt i forespørselen (brukes aldri)
    const withForeignIds = await captureError(() =>
      requestSuggestion(b.grant, {
        ...request,
        organizationId: a.organization.id,
        employeeId: a.grant.employeeId,
      }),
    );

    expectSameRejection(error, baseline);
    expectSameRejection(withForeignIds, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(error.message).not.toContain(first.text);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("4.8/6.15 ukjente nøkler på toppnivå brukes aldri: raden får grant sin organisasjon og ansatt", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const request = validRequest();
    try {
      await requestSuggestion(b.grant, {
        ...request,
        organizationId: a.organization.id,
        employeeId: a.grant.employeeId,
        provider: "openai",
      });
    } catch {
      // Avvist er også riktig (testplanen 4.8)
    }
    const row = await aiRow(request.requestId);
    if (row) {
      expect(row.organization_id).toBe(b.organization.id);
      expect(row.employee_id).toBe(b.grant.employeeId);
      expect(row.provider).toBe("fake");
    }
    const rowsInA = (await db.execute(
      sql`select id from ai_usage_log where organization_id = ${a.organization.id}`,
    )) as unknown as unknown[];
    expect(rowsInA).toHaveLength(0);
  });

  it.each([
    { name: "no_match", text: () => fakeNoMatchInput(), kind: "no_match" },
    { name: "error", text: () => fakeErrorInputs()[0]!, kind: "error" },
  ])(
    "6.16 gjentatt kall for et $name-svar gir samme svar uten nytt kall",
    async ({ text, kind }) => {
      const { grant } = await aiOrganization();
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const request = validRequest({ fields: { text: text() } });
      const first = await requestSuggestion(grant, request);
      expect(first.kind).toBe(kind);
      const second = await requestSuggestion(grant, request);
      expect(second).toEqual(first);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await aiRowCount()).toBe(1);
    },
  );

  it("6.17 gjentatt kall etter at KI er slått av gir det lagrede svaret (avklaring B)", async () => {
    const { organization, grant } = await aiOrganization();
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    await mergeOrganizationSettings(organization.id, { "ai.enabled": false });
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const second = await requestSuggestion(grant, request);

    expect(second).toEqual(first);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
    // Og et nytt kall nå gir disabled
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
  });

  it("6.18 gjentatt kall uten rettighet (takstmann har mistet report.edit) → AccessDeniedError", async () => {
    const { organization, actor, grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const weaker = await requireOrganizationAccess(actor, organization.id);

    const error = await captureError(() => requestSuggestion(weaker, request));

    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });

  it("10.3 mykt slettet rad med samme requestId → nøytralt avslag, ingen ny rad (avklaring C)", async () => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const request = validRequest();
    await requestSuggestion(grant, request);
    await db.execute(
      sql`update ai_usage_log set deleted_at = now(), deleted_by = ${grant.employeeId} where id = ${request.requestId}`,
    );
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(grant, request));

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });
});

describe("requestSuggestion: nytt forslag på samme mål (6.19–6.25, 10.2)", () => {
  it("6.19 forrige suggested på samme mål (fra en annen takstmann) settes til rejected, med én audit-linje", async () => {
    const { organization, grant } = await aiOrganization();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const target = validTarget();
    const previous = validRequest({ target });
    const previousResult = await requestSuggestion(other.grant, previous);
    if (previousResult.kind !== "suggestion") throw new Error("forventet forslag");
    const auditBefore = await allAuditRows();

    const next = validRequest({ target });
    const result = await requestSuggestion(grant, next);

    expect(result.kind).toBe("suggestion");
    const old = (await aiRow(previous.requestId))!;
    expect(old.status).toBe("rejected");
    expect(old.decided_by).toBe(grant.employeeId);
    expect(old.decided_at).not.toBeNull();
    expect((await aiRow(next.requestId))!.status).toBe("suggested");

    const newAudit = (await allAuditRows()).slice(auditBefore.length);
    const aboutOld = newAudit.filter((line) => line.entity_id === previous.requestId);
    expect(aboutOld).toHaveLength(1);
    const line = aboutOld[0]!;
    expect(line.organization_id).toBe(grant.organizationId);
    expect(line.actor_employee_id).toBe(grant.employeeId);
    const changes = JSON.stringify(line.changes);
    expect(changes).toContain("suggested");
    expect(changes).toContain("rejected");
    expect(changes).not.toContain(previousResult.text);
    expect(changes).not.toContain(SAMPLE_TEXT);
  });

  it.each(["accepted", "edited", "rejected"])(
    "6.20 forslag som allerede er %s røres ikke",
    async (status) => {
      const { organization, grant } = await aiOrganization();
      const target = validTarget();
      const existing = await createAiUsageLog(organization.id, {
        targetRef: target,
        status,
        decidedBy: grant.employeeId,
        decidedAt: new Date("2026-11-02T10:00:00Z"),
        createdAt: new Date("2026-11-02T09:00:00Z"),
      });
      const before = snapshot(await aiRow(existing.id));

      await requestSuggestion(grant, validRequest({ target }));

      expect(snapshot(await aiRow(existing.id))).toBe(before);
    },
  );

  it("6.21 samme mål i en annen organisasjon røres ikke", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const target = validTarget();
    const inB = await createAiUsageLog(b.organization.id, {
      employeeId: b.grant.employeeId,
      targetRef: target,
    });
    const before = snapshot(await aiRow(inB.id));

    await requestSuggestion(a.grant, validRequest({ target }));

    expect(snapshot(await aiRow(inB.id))).toBe(before);
  });

  it("6.22/10.2 mykt slettet suggested-forslag på samme mål røres ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const deleted = await createAiUsageLog(organization.id, {
      targetRef: target,
      deletedAt: new Date("2026-11-02T10:00:00Z"),
      deletedBy: grant.employeeId,
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(deleted.id));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(deleted.id))).toBe(before);
  });

  it.each([
    {
      name: "samme type og id, annen fieldKey",
      target: (t: ReturnType<typeof validTarget>) => ({ ...t, fieldKey: "other_text" }),
    },
    { name: "annen id", target: (t: ReturnType<typeof validTarget>) => ({ ...t, id: uuidv7() }) },
    {
      name: "annen type",
      target: (t: ReturnType<typeof validTarget>) => ({ ...t, type: "other_type" }),
    },
  ])("6.23 annet mål ($name) røres ikke", async ({ target }) => {
    const { organization, grant } = await aiOrganization();
    const mine = validTarget();
    const elsewhere = await createAiUsageLog(organization.id, {
      targetRef: target(mine),
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(elsewhere.id));

    await requestSuggestion(grant, validRequest({ target: mine }));

    expect(snapshot(await aiRow(elsewhere.id))).toBe(before);
  });

  it("6.23 forslag fra en annen funksjon på samme mål røres ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const otherFeature = await createAiUsageLog(organization.id, {
      feature: "dictation_structuring",
      promptVersion: "dictation_structuring.v1",
      targetRef: target,
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(otherFeature.id));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(otherFeature.id))).toBe(before);
  });

  it("6.24 samme transaksjon: feiler audit-skrivingen, er forrige fortsatt suggested og ny rad finnes ikke", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);

    // Tvinger feil i audit_log med en midlertidig trigger (bare i denne testen)
    await db.execute(sql`
      create or replace function ai_test_fail_audit() returns trigger language plpgsql as $$
      begin raise exception 'tvunget feil i testen'; end $$`);
    await db.execute(sql`
      create trigger ai_test_fail_audit before insert on audit_log
      for each row execute function ai_test_fail_audit()`);
    const next = validRequest({ target });
    try {
      try {
        await requestSuggestion(grant, next);
      } catch {
        // Feilen kan gå ut til kalleren; det som teller, er databasen etterpå
      }
    } finally {
      await db.execute(sql`drop trigger if exists ai_test_fail_audit on audit_log`);
      await db.execute(sql`drop function if exists ai_test_fail_audit()`);
    }

    expect((await aiRow(previous.requestId))!.status).toBe("suggested");
    expect((await aiRow(previous.requestId))!.decided_by).toBeNull();
    expect(await aiRow(next.requestId)).toBeUndefined();
  });

  it.each([
    { name: "no_match", text: () => fakeNoMatchInput() },
    { name: "error", text: () => fakeErrorInputs()[0]! },
  ])("6.25 nytt kall gir $name: forrige suggested står urørt (avklaring A)", async ({ text }) => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);
    const before = snapshot(await aiRow(previous.requestId));
    const auditBefore = await auditCount();

    await requestSuggestion(grant, validRequest({ target, fields: { text: text() } }));

    expect(snapshot(await aiRow(previous.requestId))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("6.25 unntak i leverandøren: forrige suggested står urørt", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);
    const before = snapshot(await aiRow(previous.requestId));
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(new Error("tilfeldig feil"));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(previous.requestId))).toBe(before);
  });
});

describe("requestSuggestion: tenant-isolasjon (9.1–9.3)", () => {
  /** Ikke-AccessDenied-feil fra en fremmed id er det nøytrale avslaget: hopp over. */
  async function tryRequest(grant: EmployeeGrant, request: AiRequestForTest) {
    try {
      return await requestSuggestion(grant, request);
    } catch (error) {
      if (error instanceof AccessDeniedError) throw error;
      return null;
    }
  }

  it("9.1 oppslag på requestId: gjentatt kall gir bare egne rader", async () => {
    const requests: AiRequestForTest[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = validRequest();
        const b = validRequest();
        await requestSuggestion(grantA, a);
        await requestSuggestion(grantB, b);
        requests.push(a, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: { id: string }[] = [];
        for (const request of requests) {
          const result = await tryRequest(grant, request);
          if (result && "usageId" in result) found.push({ id: result.usageId });
        }
        return found;
      },
      idOf: (row) => row.id,
    });
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
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const accepted: { id: string }[] = [];
        for (const assignmentId of assignmentIds) {
          const result = await tryRequest(grant, validRequest({ assignmentId }));
          if (result && result.kind === "suggestion") accepted.push({ id: assignmentId });
        }
        return accepted;
      },
      idOf: (row) => row.id,
    });
  });

  it("9.3 settet som avviser forrige forslag: bare egne rader blir rejected", async () => {
    const target = validTarget();
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createAiUsageLog(grantA.organizationId, {
          employeeId: grantA.employeeId,
          targetRef: target,
          createdAt: new Date("2026-11-02T09:00:00Z"),
        });
        const b = await createAiUsageLog(grantB.organizationId, {
          employeeId: grantB.employeeId,
          targetRef: target,
          createdAt: new Date("2026-11-02T09:00:00Z"),
        });
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const before = new Map<string, string | null>();
        for (const id of seeded) before.set(id, (await aiRow(id))!.status);
        await requestSuggestion(grant, validRequest({ target }));
        const changed: { id: string }[] = [];
        for (const id of seeded) {
          const status = (await aiRow(id))!.status;
          if (before.get(id) === "suggested" && status === "rejected") changed.push({ id });
        }
        return changed;
      },
      idOf: (row) => row.id,
    });
  });
});

/** En leverandør som ikke er `fake`. Svarer som en vanlig leverandør hvis den blir kalt. */
function realLikeProvider() {
  const complete = vi.fn(async (_request: unknown) => ({
    outcome: "ok" as const,
    text: "Oppdiktet svar fra annen leverandør.",
    tokensIn: 3,
    tokensOut: 4,
    cost: 0.5,
    currency: "NOK",
  }));
  return { code: "other_test_provider", model: "other-test-v1", complete };
}

/** Oppdiktet vask: bytter markøren med `[telefon]` og teller ett treff. */
function markerRedaction() {
  swap.redact = async (_grant, _assignmentId, fields) => ({
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        value.replaceAll(SECRET_MARKER, "[telefon]"),
      ]),
    ),
    count: 1,
  });
}

describe("requestSuggestion: vasken før kallet (vask før KI V4.3–V4.7)", () => {
  it("V4.3 leverandøren får bare den vaskede teksten, og redacted_count står i raden", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    markerRedaction();
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest({
      assignmentId: assignment.id,
      fields: { text: `Ring ${SECRET_MARKER} om taket` },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(redactFields).toHaveBeenCalledTimes(1);
    expect(vi.mocked(redactFields).mock.calls[0]![0]).toBe(grant);
    expect(vi.mocked(redactFields).mock.calls[0]![1]).toBe(assignment.id);
    const prompt = (complete.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Ring [telefon] om taket");
    expect(prompt).not.toContain(SECRET_MARKER);
    const row = (await aiRow(request.requestId))!;
    expect(row.redacted_count).toBe(1);
    expect(JSON.stringify(row)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    expect(Object.keys(result)).not.toContain("redactedCount");
  });

  it("V4.4 input_summary regnes av den vaskede teksten", async () => {
    const { grant } = await aiOrganization();
    markerRedaction();
    const text = `Ring ${SECRET_MARKER} om taket`;
    const request = validRequest({ fields: { text } });

    await requestSuggestion(grant, request);

    const row = (await aiRow(request.requestId))!;
    expect(row.input_summary).toEqual({ text: "Ring [telefon] om taket".length });
    expect(row.input_summary).not.toEqual({ text: text.length });
  });

  it.each(["no_match", "error"] as const)(
    "V4.3 redacted_count skrives også for utfallet %s",
    async (outcome) => {
      const { grant } = await aiOrganization();
      swap.redact = async (_grant, _assignmentId, fields) => ({ fields: { ...fields }, count: 2 });
      const text = outcome === "no_match" ? fakeNoMatchInput() : fakeErrorInputs()[0]!;
      const request = validRequest({ fields: { text } });

      const result = await requestSuggestion(grant, request);

      expect(result.kind).toBe(outcome);
      expect((await aiRow(request.requestId))!.redacted_count).toBe(2);
    },
  );

  it("V4.5 kaster vasken, kalles leverandøren ikke og ingen rad skrives; markøren lekker ikke", async () => {
    const { grant } = await aiOrganization();
    swap.redact = async () => {
      throw new Error(SECRET_MARKER);
    };
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const logSpies = spyOnLogger();
    const auditBefore = await auditCount();

    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { text: "Oppdiktet notat" } })),
    );

    expect(error).toBeInstanceOf(Error);
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
    expect(loggedText(logSpies)).not.toContain(SECRET_MARKER);
  });

  it("V4.6 «KI er av» og blocked kjører ikke vasken", async () => {
    const off = await createOrganization("Oppdiktet Takst Av");
    const offInspector = await employeeWithGrant(off.id, ["inspector"]);
    expect(await requestSuggestion(offInspector.grant, validRequest())).toEqual({
      kind: "disabled",
    });

    const { grant } = await aiOrganization();
    swap.provider = realLikeProvider();
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "blocked" });

    expect(redactFields).not.toHaveBeenCalled();
  });

  it("V4.7 den falske leverandøren får også vasket tekst (prøvemålet uten oppdrag)", async () => {
    const { grant } = await aiOrganization();
    markerRedaction();
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest({
      target: { type: "ai_trial", id: randomUUID(), fieldKey: "text" },
      fields: { text: `Ring ${SECRET_MARKER}` },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(redactFields).toHaveBeenCalledWith(grant, null, { text: `Ring ${SECRET_MARKER}` });
    const prompt = (complete.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toContain(SECRET_MARKER);
  });
});

describe("requestSuggestion: utfallet blocked (vask før KI V5.1–V5.7)", () => {
  async function expectBlockedRow(requestId: string) {
    const row = (await aiRow(requestId))!;
    expect(row.outcome).toBe("blocked");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(Number(row.cost)).toBe(0);
    expect(row.redacted_count).toBe(0);
    expect(row.provider).toBe("other_test_provider");
    expect(row.input_summary).toEqual({});
    return row;
  }

  it.each([
    { name: "V5.1 answer med oppdrag", target: "answer" as const, withAssignment: true },
    { name: "V5.2 ai_trial uten oppdrag", target: "ai_trial" as const, withAssignment: false },
    {
      name: "V5.2 fritekst uten oppdrag (answer, assignmentId null)",
      target: "answer" as const,
      withAssignment: false,
    },
  ])(
    "$name mot ekte leverandør: blocked-rad, intet kall, ingen audit",
    async ({ target, withAssignment }) => {
      const { organization, grant } = await aiOrganization();
      const assignmentId = withAssignment ? (await createAssignment(organization.id)).id : null;
      const provider = realLikeProvider();
      swap.provider = provider;
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const auditBefore = await auditCount();
      const request = validRequest({
        assignmentId,
        target: { type: target, id: randomUUID(), fieldKey: "text" },
      });

      const result = await requestSuggestion(grant, request);

      expect(result).toEqual({ kind: "blocked" });
      expect(provider.complete).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      const row = await expectBlockedRow(request.requestId);
      expect(row.assignment_id).toBe(assignmentId);
      expect(row.organization_id).toBe(grant.organizationId);
      expect(row.employee_id).toBe(grant.employeeId);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it("V5.3 answer med falsk leverandør virker (A173)", async () => {
    const { grant } = await aiOrganization();
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
  });

  it("V5.4 en blocked-forespørsel avviser ikke forrige åpne forslag på samme mål", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const first = validRequest({ target });
    await requestSuggestion(grant, first);
    swap.provider = realLikeProvider();

    expect(await requestSuggestion(grant, validRequest({ target }))).toEqual({ kind: "blocked" });

    expect((await aiRow(first.requestId))!.status).toBe("suggested");
  });

  it("V5.5 samme requestId igjen gir blocked, ingen ny rad og intet kall", async () => {
    const { grant } = await aiOrganization();
    const provider = realLikeProvider();
    swap.provider = provider;
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));

    // Også etter at leverandøren er byttet til den falske: svaret fra første gang
    swap.provider = null;
    const complete = vi.spyOn(fakeAiProvider, "complete");
    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });

    expect(await aiRowCount()).toBe(1);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });

  it("V5.7 «KI er av» gir fortsatt ingen rad og { kind: disabled }", async () => {
    const organization = await createOrganization("Oppdiktet Takst Av");
    await enableAi(organization.id, { enabled: false });
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);

    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
  });
});

describe("requestSuggestion: roller og organisasjon (vask før KI V7.3–V7.4)", () => {
  it("V7.3 A sitt oppdrag i en forespørsel fra B avvises, ingen vask og ingen rad", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const assignment = await createAssignment(a.organization.id);
    const baseline = await neutralRequestRejection(b.grant);
    const complete = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() =>
      requestSuggestion(b.grant, validRequest({ assignmentId: assignment.id })),
    );

    expectSameRejection(error, baseline);
    expect(redactFields).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it.each([
    { role: "inspector" as const, allowed: true },
    { role: "manager" as const, allowed: true },
    { role: "admin" as const, allowed: true },
    { role: "office" as const, allowed: false },
  ])("V7.4 $role får samme svar som før (falsk leverandør, vasket)", async ({ role, allowed }) => {
    const { organization } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    const { grant } = await employeeWithGrant(organization.id, [role], `Test ${role}`);
    markerRedaction();
    const request = validRequest({
      assignmentId: assignment.id,
      fields: { text: `Ring ${SECRET_MARKER}` },
    });

    if (!allowed) {
      await expect(requestSuggestion(grant, request)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(redactFields).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      return;
    }
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    expect(redactFields).toHaveBeenCalledTimes(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("ok");
    expect(row.redacted_count).toBe(1);
  });
});
