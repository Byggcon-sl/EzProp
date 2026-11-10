import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import {
  AiDecisionError,
  AiRequestRejectedError,
  recordDecision,
  requestSuggestion,
  type AiDecision,
} from "@/core/ai";
import { db } from "@/db/client";
import { aiUsageLog, integrationConnections } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  TEST_NOW,
  createAiUsageLog,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  addMember,
  aiOrganization,
  auditCount,
  auditFor,
  polishRequest,
  polishTarget,
  setOrganizationSetting,
  AI_ENABLED,
  usageRow,
} from "../../../tests/ai";

/*
 * `recordDecision` mot testdatabasen (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 7, 9.4, 9.8 og 10.1). Tabellen over lovlige endringer er en regeltest med én sak per
 * rute (A162). Utgangsradene lages rått med `createAiUsageLog`. Alle data er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (hvem som godtok hva, og når, står alltid i loggen og i
 * revisjonsloggen) og de ansatte (gjentatt trykk fra iPaden gir ingen feil og ingen dobbel linje).
 */

const NEUTRAL_MESSAGE = new AiRequestRejectedError().message;
const OTHER_TIME = new Date("2026-10-20T08:00:00Z");

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.useRealTimers();
});

async function snapshot(id: string) {
  return JSON.stringify(await usageRow(id));
}

/** En rad i status `from`, laget av en takstmann; avgjort av den samme hvis ikke `suggested`. */
async function rowWithStatus(organizationId: string, from: string, employeeId: string) {
  return createAiUsageLog(organizationId, {
    employeeId,
    status: from,
    decidedBy: from === "suggested" ? null : employeeId,
    decidedAt: from === "suggested" ? null : OTHER_TIME,
  });
}

type Cell = "change" | "same" | "invalid";
type Row = [from: string, decision: AiDecision, expected: Cell, to: string | null];

/** Fasiten, skrevet ut for hånd fra kortet (Omfang 4). 16 ruter. */
const TABLE: Row[] = [
  ["suggested", "accepted", "change", "accepted"],
  ["suggested", "edited", "change", "edited"],
  ["suggested", "rejected", "change", "rejected"],
  ["suggested", "undo", "invalid", null],
  ["accepted", "accepted", "same", null],
  ["accepted", "edited", "invalid", null],
  ["accepted", "rejected", "invalid", null],
  ["accepted", "undo", "change", "suggested"],
  ["edited", "accepted", "invalid", null],
  ["edited", "edited", "same", null],
  ["edited", "rejected", "invalid", null],
  ["edited", "undo", "change", "suggested"],
  ["rejected", "accepted", "invalid", null],
  ["rejected", "edited", "invalid", null],
  ["rejected", "rejected", "same", null],
  ["rejected", "undo", "change", "suggested"],
];

describe("recordDecision: tabellen over lovlige endringer (7.1–7.4)", () => {
  it("tabellen har 16 ruter", () => {
    expect(TABLE).toHaveLength(16);
  });

  it.each(TABLE)("%s + %s → %s", async (from, decision, expected, to) => {
    const { organization, inspector } = await aiOrganization();
    const deciderEmployee = await addMember(organization.id, ["manager"], "Test Leder");
    const row = await rowWithStatus(organization.id, from, inspector.employeeId);
    const before = (await usageRow(row.id))!;
    const auditBefore = await auditCount();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);

    const call = recordDecision(deciderEmployee.grant, row.id, decision);

    if (expected === "invalid") {
      await expect(call).rejects.toThrow(AiDecisionError);
      expect(await snapshot(row.id)).toBe(JSON.stringify(before));
      expect(await auditCount()).toBe(auditBefore);
      return;
    }
    await call;
    if (expected === "same") {
      expect(await snapshot(row.id), "7.2 ingen endring, også decided_at").toBe(
        JSON.stringify(before),
      );
      expect(await auditCount()).toBe(auditBefore);
      return;
    }

    const after = (await usageRow(row.id))!;
    expect(after.status).toBe(to);
    expect(after.rowVersion).toBe(before.rowVersion + 1);
    if (to === "suggested") {
      expect(after.decidedBy, "7.4 undo tømmer decided_by").toBeNull();
      expect(after.decidedAt, "7.4 undo tømmer decided_at").toBeNull();
    } else {
      expect(after.decidedBy).toBe(deciderEmployee.employeeId);
      expect(after.decidedAt?.toISOString()).toBe(TEST_NOW.toISOString());
    }
    expect(await auditCount()).toBe(auditBefore + 1);
    const lines = await auditFor(row.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.organizationId).toBe(organization.id);
    expect(lines[0]!.actorEmployeeId).toBe(deciderEmployee.employeeId);
    expect(lines[0]!.changes).toEqual({ status: { from, to } });
    expect(JSON.stringify(lines[0])).not.toContain(before.outputText!);
  });
});

describe("recordDecision: angre på avvist når det finnes et annet forslag (7.5, avklaring D)", () => {
  const OLD = new Date("2026-11-01T10:00:00Z");
  const NEW = new Date("2026-11-02T10:00:00Z");
  const OLDER = new Date("2026-10-31T10:00:00Z");

  async function rejectedOn(organizationId: string, employeeId: string, target = polishTarget()) {
    const row = await createAiUsageLog(organizationId, {
      employeeId,
      targetRef: target,
      status: "rejected",
      decidedBy: employeeId,
      decidedAt: OLD,
      createdAt: OLD,
    });
    return { row, target };
  }

  it("7.5 nyere suggested-forslag på samme mål → feil, ingen endring", async () => {
    const { organization, inspector } = await aiOrganization();
    const { row, target } = await rejectedOn(organization.id, inspector.employeeId);
    await createAiUsageLog(organization.id, { targetRef: target, createdAt: NEW });
    const before = await snapshot(row.id);
    const auditBefore = await auditCount();

    await expect(recordDecision(inspector.grant, row.id, "undo")).rejects.toThrow(AiDecisionError);
    expect(await snapshot(row.id)).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it.each([
    ["nyere forslag er mykt slettet", "deleted"],
    ["nyere forslag er på et annet mål", "other_target"],
    ["nyere har outcome no_match", "no_match"],
    ["nyere har outcome error", "error"],
    ["nyere ligger i en annen organisasjon (samme target_ref)", "other_org"],
    ["det andre forslaget er eldre", "older"],
  ])("7.5 %s → lov", async (_name, variant) => {
    const { organization, inspector } = await aiOrganization();
    const { row, target } = await rejectedOn(organization.id, inspector.employeeId);
    if (variant === "deleted") {
      await createAiUsageLog(organization.id, {
        targetRef: target,
        createdAt: NEW,
        deletedAt: NEW,
      });
    } else if (variant === "other_target") {
      await createAiUsageLog(organization.id, { targetRef: polishTarget(), createdAt: NEW });
    } else if (variant === "no_match" || variant === "error") {
      await createAiUsageLog(organization.id, {
        targetRef: target,
        createdAt: NEW,
        outcome: variant,
        status: null,
        outputText: null,
        errorCode: variant === "error" ? "unavailable" : null,
      });
    } else if (variant === "other_org") {
      const other = await createOrganization("Organisasjon B");
      await createAiUsageLog(other.id, { targetRef: target, createdAt: NEW });
    } else {
      await createAiUsageLog(organization.id, { targetRef: target, createdAt: OLDER });
    }

    await recordDecision(inspector.grant, row.id, "undo");
    expect((await usageRow(row.id))!.status).toBe("suggested");
  });

  it("7.5 «nyere» avgjøres på created_at, ikke på id-en: eldre rad med høyere id → lov", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    // Den avviste har lav id (tidlig tid i UUID v7), den andre høy id, men eldre created_at
    const row = await createAiUsageLog(organization.id, {
      id: uuidv7(Date.parse("2020-01-01T00:00:00Z")),
      employeeId: inspector.employeeId,
      targetRef: target,
      status: "rejected",
      decidedBy: inspector.employeeId,
      decidedAt: OLD,
      createdAt: OLD,
    });
    await createAiUsageLog(organization.id, {
      id: uuidv7(Date.parse("2030-01-01T00:00:00Z")),
      targetRef: target,
      createdAt: OLDER,
    });

    await recordDecision(inspector.grant, row.id, "undo");
    expect((await usageRow(row.id))!.status).toBe("suggested");
  });

  it("7.5 «nyere» avgjøres på created_at, ikke på id-en: nyere rad med lavere id → feil", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const row = await createAiUsageLog(organization.id, {
      id: uuidv7(Date.parse("2030-01-01T00:00:00Z")),
      employeeId: inspector.employeeId,
      targetRef: target,
      status: "rejected",
      decidedBy: inspector.employeeId,
      decidedAt: OLD,
      createdAt: OLD,
    });
    await createAiUsageLog(organization.id, {
      id: uuidv7(Date.parse("2020-01-01T00:00:00Z")),
      targetRef: target,
      createdAt: NEW,
    });

    await expect(recordDecision(inspector.grant, row.id, "undo")).rejects.toThrow(AiDecisionError);
    expect((await usageRow(row.id))!.status).toBe("rejected");
  });

  it("7.5 helhet: forslag avvist av et nytt forslag kan ikke angres før det nye er avgjort", async () => {
    const { inspector } = await aiOrganization();
    const target = polishTarget();
    const first = polishRequest({ target });
    await requestSuggestion(inspector.grant, first);
    await requestSuggestion(inspector.grant, polishRequest({ target }));
    expect((await usageRow(first.requestId))!.status).toBe("rejected");

    await expect(recordDecision(inspector.grant, first.requestId, "undo")).rejects.toThrow(
      AiDecisionError,
    );
  });
});

describe("recordDecision: angre på godtatt eller endret når et nyere forslag finnes (7.5, A162)", () => {
  it.each([["accepted"], ["edited"]] as const)(
    "%s + nytt forslag på samme mål + undo → feil, ingen endring, ingen revisjonslinje",
    async (decision) => {
      const { inspector } = await aiOrganization();
      const target = polishTarget();
      const first = polishRequest({ target });
      await requestSuggestion(inspector.grant, first);
      await recordDecision(inspector.grant, first.requestId, decision);
      const second = polishRequest({ target });
      await requestSuggestion(inspector.grant, second);
      // Det godtatte eller endrede forslaget røres ikke av det nye
      expect((await usageRow(first.requestId))!.status).toBe(decision);
      expect((await usageRow(second.requestId))!.status).toBe("suggested");
      const before = await snapshot(first.requestId);
      const auditBefore = await auditCount();

      await expect(recordDecision(inspector.grant, first.requestId, "undo")).rejects.toThrow(
        AiDecisionError,
      );
      expect(await snapshot(first.requestId)).toBe(before);
      expect(await auditCount()).toBe(auditBefore);
      const open = await db
        .select({ id: aiUsageLog.id })
        .from(aiUsageLog)
        .where(eq(aiUsageLog.status, "suggested"));
      expect(open, "aldri to åpne forslag på samme mål").toHaveLength(1);
    },
  );
});

describe("recordDecision: hvem avgjør (7.6, 7.7)", () => {
  it("7.6 en annen ansatt med report.edit kan avgjøre et forslag en annen ba om", async () => {
    const { organization, inspector } = await aiOrganization();
    const colleague = await addMember(organization.id, ["inspector"], "Test Kollega");
    const leader = await addMember(organization.id, ["manager"], "Test Leder");
    const first = await createAiUsageLog(organization.id, { employeeId: inspector.employeeId });
    const second = await createAiUsageLog(organization.id, { employeeId: inspector.employeeId });

    await recordDecision(colleague.grant, first.id, "accepted");
    await recordDecision(leader.grant, second.id, "edited");

    const a = (await usageRow(first.id))!;
    const b = (await usageRow(second.id))!;
    expect(a.decidedBy).toBe(colleague.employeeId);
    expect(a.employeeId).toBe(inspector.employeeId);
    expect(b.decidedBy).toBe(leader.employeeId);
  });

  it("7.7 decided_by kan ikke styres: funksjonen tar ingen ansatt-id, og verdien er grant sin", async () => {
    const { organization, inspector } = await aiOrganization();
    const colleague = await addMember(organization.id, ["inspector"], "Test Kollega");
    const row = await createAiUsageLog(organization.id, { employeeId: inspector.employeeId });
    expect(recordDecision.length).toBe(3);

    const loose = recordDecision as unknown as (...args: unknown[]) => Promise<void>;
    await loose(inspector.grant, row.id, "accepted", colleague.employeeId, {
      decidedBy: colleague.employeeId,
    });

    expect((await usageRow(row.id))!.decidedBy).toBe(inspector.employeeId);
  });
});

describe("recordDecision: avslag (7.8, 7.9, 10.1)", () => {
  it.each([
    ["no_match", null],
    ["error", "unavailable"],
  ])("7.8 rad med outcome %s → feil, ingen endring", async (outcome, errorCode) => {
    const { organization, inspector } = await aiOrganization();
    const row = await createAiUsageLog(organization.id, {
      outcome,
      status: null,
      outputText: null,
      errorCode,
    });
    const before = await snapshot(row.id);

    for (const decision of ["accepted", "edited", "rejected", "undo"] as const) {
      let error: unknown;
      try {
        await recordDecision(inspector.grant, row.id, decision);
      } catch (caught) {
        error = caught;
      }
      expect(
        error instanceof AiDecisionError || error instanceof AiRequestRejectedError,
        `${decision} gir feil`,
      ).toBe(true);
    }
    expect(await snapshot(row.id)).toBe(before);
    expect(await auditCount()).toBe(0);
  });

  it.each([
    ["ukjent usageId", () => randomUUID()],
    ["ugyldig UUID", () => "ikke-en-uuid"],
    ["tom tekst", () => ""],
  ])("7.9 %s → nøytralt avslag", async (_name, makeId) => {
    const { inspector } = await aiOrganization();

    const error = await recordDecision(inspector.grant, makeId(), "accepted").catch((e) => e);
    expect(error).toBeInstanceOf(AiRequestRejectedError);
    expect((error as Error).message).toBe(NEUTRAL_MESSAGE);
    expect(await auditCount()).toBe(0);
  });

  it("7.9 ukjent avgjørelse → feil, ingen endring", async () => {
    const { organization, inspector } = await aiOrganization();
    const row = await createAiUsageLog(organization.id);
    const before = await snapshot(row.id);

    await expect(
      recordDecision(inspector.grant, row.id, "approved" as AiDecision),
    ).rejects.toThrow();
    expect(await snapshot(row.id)).toBe(before);
  });

  it("10.1 mykt slettet rad → nøytralt avslag, ingen endring, ingen revisjonslinje", async () => {
    const { organization, inspector } = await aiOrganization();
    const row = await createAiUsageLog(organization.id, {
      deletedAt: new Date("2026-11-01T10:00:00Z"),
    });
    const before = await snapshot(row.id);

    const error = await recordDecision(inspector.grant, row.id, "accepted").catch((e) => e);
    expect(error).toBeInstanceOf(AiRequestRejectedError);
    expect((error as Error).message).toBe(NEUTRAL_MESSAGE);
    expect(await snapshot(row.id)).toBe(before);
    expect(await auditCount()).toBe(0);
  });
});

describe("recordDecision: KI av (7.10)", () => {
  it("7.10 ai.enabled = false og tilkoblingen slettet: avgjørelser og angre virker fortsatt", async () => {
    const { organization, inspector } = await aiOrganization();
    const request = polishRequest();
    await requestSuggestion(inspector.grant, request);
    await setOrganizationSetting(organization.id, AI_ENABLED, false);
    await db
      .update(integrationConnections)
      .set({ deletedAt: new Date("2026-11-04T10:00:00Z") })
      .where(eq(integrationConnections.organizationId, organization.id));

    await recordDecision(inspector.grant, request.requestId, "accepted");
    expect((await usageRow(request.requestId))!.status).toBe("accepted");
    await recordDecision(inspector.grant, request.requestId, "undo");
    expect((await usageRow(request.requestId))!.status).toBe("suggested");
    await recordDecision(inspector.grant, request.requestId, "rejected");
    expect((await usageRow(request.requestId))!.status).toBe("rejected");
  });
});

describe("recordDecision: ingen forslagstekst i revisjonsloggen (7.11)", () => {
  it("7.11 markør i output_text finnes ikke i noen linje i audit_log", async () => {
    const { organization, inspector } = await aiOrganization();
    const row = await createAiUsageLog(organization.id, {
      outputText: "Forslag med MARKOR-9c1e i teksten.",
    });

    await recordDecision(inspector.grant, row.id, "accepted");
    await recordDecision(inspector.grant, row.id, "undo");
    await recordDecision(inspector.grant, row.id, "edited");

    const lines = await auditFor(row.id);
    expect(lines).toHaveLength(3);
    expect(JSON.stringify(lines)).not.toContain("MARKOR-9c1e");
  });
});

describe("recordDecision: tenant-isolasjon (9.4, 9.8)", () => {
  it("9.4 lesing og endring: bare egne forslag blir endret", async () => {
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAiUsageLog(grantA.organizationId);
        const b = await createAiUsageLog(grantB.organizationId);
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        for (const id of seeded) {
          try {
            await recordDecision(grant, id, "accepted");
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        // Uten filter på organisasjon: en endring på tvers ville vist seg her
        return db
          .select()
          .from(aiUsageLog)
          .where(
            and(eq(aiUsageLog.status, "accepted"), eq(aiUsageLog.decidedBy, grant.employeeId)),
          );
      },
      idOf: (row) => row.id,
    });
  });

  it("9.8 B sin admin avgjør A sin usageId → nøytralt avslag, A sin rad uendret", async () => {
    const { organization: orgA, inspector } = await aiOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminB = await addMember(orgB.id, ["admin"], "Test Admin B");
    const request = polishRequest();
    await requestSuggestion(inspector.grant, request);
    const before = await snapshot(request.requestId);
    expect((await usageRow(request.requestId))!.organizationId).toBe(orgA.id);

    for (const decision of ["accepted", "edited", "rejected", "undo"] as const) {
      const error = await recordDecision(adminB.grant, request.requestId, decision).catch((e) => e);
      expect(error).toBeInstanceOf(AiRequestRejectedError);
      expect((error as Error).message).toBe(NEUTRAL_MESSAGE);
    }
    expect(await snapshot(request.requestId)).toBe(before);
    expect(await auditCount()).toBe(0);
  });
});
