import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, organizations } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createAssignment,
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  auditRows,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  AI_ENABLED_SETTING_KEY,
  AiDecisionError,
  AiRequestRejectedError,
  FAKE_ERROR_CODE,
  FAKE_ERROR_INPUT,
  recordDecision,
  requestSuggestion,
  type AiSuggestionRequest,
} from "./index";
import { fakeAiProvider } from "./providers/fake";
import { addYears } from "./usage-log";

/*
 * Utviklerens egne tester for KI-modulen (docs/funksjoner/fase2a-ki-modul-logg.md). Testskriveren
 * lager de fulle testene etter testplanen; her er hovedveien, avslag, statusendringer og
 * tenant-isolasjon for de to funksjonene. Testdata er oppdiktet.
 * Støtter hovedmål: KI i bunnen, de ansatte (alt mot fake uten kostnad), færre reklamasjoner.
 */

const TEXT = "taket er gammelt og har noen sprekker";

async function enableAi(organizationId: string) {
  await db
    .update(organizations)
    .set({ settings: { [AI_ENABLED_SETTING_KEY]: true } })
    .where(eq(organizations.id, organizationId));
  await createIntegrationConnection(organizationId, { port: "ai", provider: "fake" });
}

async function inspectorGrant(organizationId: string): Promise<EmployeeGrant> {
  const actor = await createUser({ name: "Test Takstmann" });
  await createEmployee(actor, organizationId, ["inspector"]);
  return requireOrganizationAccess(actor, organizationId);
}

function request(overrides: Partial<AiSuggestionRequest> = {}): AiSuggestionRequest {
  return {
    requestId: randomUUID(),
    feature: "language_polish",
    assignmentId: null,
    reportId: null,
    target: { type: "answer", id: randomUUID(), fieldKey: "text" },
    fields: { text: TEXT },
    ...overrides,
  };
}

async function rowsIn(organizationId: string) {
  return db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, organizationId));
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestSuggestion", () => {
  it("gir forslag mot fake og skriver én rad uten feltverdier", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const assignment = await createAssignment(org.id);
    const req = request({ assignmentId: assignment.id });

    const result = await requestSuggestion(grant, req);

    expect(result).toEqual({
      kind: "suggestion",
      usageId: req.requestId,
      status: "suggested",
      text: "Taket er gammelt og har noen sprekker.",
      candidateId: null,
    });
    const [row] = await rowsIn(org.id);
    expect(row).toMatchObject({
      id: req.requestId,
      employeeId: grant.employeeId,
      feature: "language_polish",
      provider: "fake",
      model: "fake-v1",
      promptVersion: "language_polish.v1",
      assignmentId: assignment.id,
      reportId: null,
      targetRef: req.target,
      sourceFields: ["text"],
      inputSummary: { text: TEXT.length },
      outcome: "ok",
      status: "suggested",
      currency: "NOK",
    });
    expect(Number(row!.cost)).toBe(0);
    expect(row!.retainUntil.toISOString()).toBe(addYears(row!.createdAt, 10).toISOString());
  });

  it("KI av gir disabled uten rad og uten kall", async () => {
    const org = await createOrganization();
    const grant = await inspectorGrant(org.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    expect(await requestSuggestion(grant, request())).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
    expect(await rowsIn(org.id)).toHaveLength(0);
  });

  it.each([
    ["ukjent felt", request({ fields: { text: TEXT, email: "x" } })],
    ["TG som mål", request({ target: { type: "answer", id: randomUUID(), fieldKey: "tg" } })],
    ["reportId satt", request({ reportId: randomUUID() })],
    ["for lang verdi", request({ fields: { text: "a".repeat(5001) } })],
    ["ukjent oppdrag", request({ assignmentId: randomUUID() })],
  ])("avslag før kallet: %s", async (_name, req) => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    await expect(requestSuggestion(grant, req)).rejects.toBeInstanceOf(AiRequestRejectedError);
    expect(spy).not.toHaveBeenCalled();
    expect(await rowsIn(org.id)).toHaveLength(0);
    expect(await auditRows(org.id)).toHaveLength(0);
  });

  it("kontor uten report.edit får AccessDeniedError", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const actor = await createUser({ name: "Test Kontor" });
    await createEmployee(actor, org.id, ["office"]);
    const grant = await requireOrganizationAccess(actor, org.id);

    await expect(requestSuggestion(grant, request())).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("feil fra leverandøren logges bare med funksjon, leverandør, kode og id", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const warn = vi.spyOn(logger, "warn");
    const req = request({ fields: { text: `MARKOR-91c2 ${FAKE_ERROR_INPUT}` } });

    expect(await requestSuggestion(grant, req)).toEqual({
      kind: "error",
      usageId: req.requestId,
    });
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      feature: "language_polish",
      provider: "fake",
      errorCode: FAKE_ERROR_CODE,
      usageId: req.requestId,
    });
    const [row] = await rowsIn(org.id);
    expect(JSON.stringify(row)).not.toContain("MARKOR-91c2");
  });

  it("unntak i leverandøren gir error med unknown", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(new Error("hemmelig-markør"));

    const req = request();
    expect(await requestSuggestion(grant, req)).toEqual({ kind: "error", usageId: req.requestId });
    const [row] = await rowsIn(org.id);
    expect(row).toMatchObject({ outcome: "error", errorCode: "unknown", status: null });
  });

  it("samme requestId gir samme svar og én rad; en annen ansatt får avslag", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const other = await inspectorGrant(org.id);
    const req = request();

    const [first, second] = await Promise.all([
      requestSuggestion(grant, req),
      requestSuggestion(grant, req),
    ]);
    expect(second).toEqual(first);
    expect(await requestSuggestion(grant, req)).toEqual(first);
    expect(await rowsIn(org.id)).toHaveLength(1);
    await expect(requestSuggestion(other, req)).rejects.toBeInstanceOf(AiRequestRejectedError);
  });

  it("nytt forslag på samme mål avviser det forrige, med linje i audit_log", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const first = await inspectorGrant(org.id);
    const second = await inspectorGrant(org.id);
    const target = { type: "answer", id: randomUUID(), fieldKey: "text" };
    const a = request({ target });
    const b = request({ target, fields: { text: "vinduet lekker" } });

    await requestSuggestion(first, a);
    await requestSuggestion(second, b);

    const [old] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, a.requestId));
    expect(old).toMatchObject({ status: "rejected", decidedBy: second.employeeId });
    const audit = await auditRows(org.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: a.requestId,
      changes: { status: { from: "suggested", to: "rejected" } },
    });
  });

  it("tenant-isolasjon: oppslag på requestId gir bare egne rader", async () => {
    const requests = new Map<string, AiSuggestionRequest[]>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          await enableAi(grant.organizationId);
          const req = request();
          await requestSuggestion(grant, req);
          requests.set(grant.organizationId, [req]);
          ids[key].push(req.requestId);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: string[] = [];
        for (const reqs of requests.values()) {
          for (const req of reqs) {
            try {
              const result = await requestSuggestion(grant, req);
              if (result.kind !== "disabled" && result.kind !== "blocked")
                found.push(result.usageId);
            } catch (error) {
              if (!(error instanceof AiRequestRejectedError)) throw error;
            }
          }
        }
        return found;
      },
      idOf: (id) => id,
    });
  });
});

describe("recordDecision", () => {
  async function suggestion() {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const req = request();
    await requestSuggestion(grant, req);
    return { org, grant, usageId: req.requestId };
  }

  it("godta, gjenta uten endring, angre", async () => {
    const { org, grant, usageId } = await suggestion();

    await recordDecision(grant, usageId, "accepted");
    let [row] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, usageId));
    expect(row).toMatchObject({ status: "accepted", decidedBy: grant.employeeId });
    expect(row!.decidedAt).toBeInstanceOf(Date);

    await recordDecision(grant, usageId, "accepted");
    expect(await auditRows(org.id)).toHaveLength(1);

    await expect(recordDecision(grant, usageId, "edited")).rejects.toBeInstanceOf(AiDecisionError);

    await recordDecision(grant, usageId, "undo");
    [row] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, usageId));
    expect(row).toMatchObject({ status: "suggested", decidedBy: null, decidedAt: null });
    const audit = await auditRows(org.id);
    expect(audit.map((line) => line.changes)).toEqual([
      { status: { from: "suggested", to: "accepted" } },
      { status: { from: "accepted", to: "suggested" } },
    ]);
  });

  it("angre fra avvist er feil når det finnes et nyere forslag på samme mål", async () => {
    const org = await createOrganization();
    await enableAi(org.id);
    const grant = await inspectorGrant(org.id);
    const target = { type: "answer", id: randomUUID(), fieldKey: "text" };
    const a = request({ target });
    await requestSuggestion(grant, a);
    await requestSuggestion(grant, request({ target, fields: { text: "nytt forslag" } }));

    await expect(recordDecision(grant, a.requestId, "undo")).rejects.toBeInstanceOf(
      AiDecisionError,
    );
  });

  it("slettet rad og ugyldig id gir nøytralt avslag", async () => {
    const { grant, usageId } = await suggestion();
    await db
      .update(aiUsageLog)
      .set({ deletedAt: new Date() })
      .where(and(eq(aiUsageLog.id, usageId)));

    await expect(recordDecision(grant, usageId, "accepted")).rejects.toBeInstanceOf(
      AiRequestRejectedError,
    );
    await expect(recordDecision(grant, "ikke-en-id", "accepted")).rejects.toBeInstanceOf(
      AiRequestRejectedError,
    );
  });

  it("tenant-isolasjon: bare egne rader kan avgjøres", async () => {
    const ids: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [key, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          await enableAi(grant.organizationId);
          const req = request();
          await requestSuggestion(grant, req);
          ids.push(req.requestId);
          result[key].push(req.requestId);
        }
        return result;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const decided: string[] = [];
        for (const id of ids) {
          try {
            await recordDecision(grant, id, "accepted");
            decided.push(id);
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return decided;
      },
      idOf: (id) => id,
    });
  });
});

describe("addYears", () => {
  it("29. februar + 10 år blir 1. mars (minst ti år)", () => {
    expect(addYears(new Date("2028-02-29T12:00:00Z"), 10).toISOString()).toBe(
      "2038-03-01T12:00:00.000Z",
    );
    expect(addYears(new Date("2026-11-10T08:30:00Z"), 10).toISOString()).toBe(
      "2036-11-10T08:30:00.000Z",
    );
  });
});
