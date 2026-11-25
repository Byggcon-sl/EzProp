import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { AI_FEATURES } from "@/core/ai";
import {
  AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR,
  AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY,
} from "@/core/ai/limits";
import { fakeAiProvider } from "@/core/ai/providers/fake";
import { db } from "@/db/client";
import { aiUsageLog, auditLog, overrideSummaries } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { enableAi } from "../../../tests/ai";
import {
  createAiUsageLog,
  createEmployee,
  createOrganization,
  createOverrideSummaryRow,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  LEAK_MARKERS,
  overrideClaim,
  overrideOrg,
  overrideRelease,
  overrideReport,
} from "../../../tests/override-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  decideOverrideSummary,
  getOverrideSummary,
  OverrideSummaryTextError,
  ReportValidationError,
  requestOverrideSummary,
  saveOverrideSummary,
} from "./index";

vi.mock("server-only", () => ({}));

/*
 * Månedsoppsummeringen (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt 4c,
 * O4.16–O4.24, og 6, O6.3, O6.4 og O6.8). Fast klokke: 24.11.2026, så de fire månedene er
 * 2026-11, 2026-10, 2026-09 og 2026-08.
 *
 * Testene som trenger KI-funksjonen `override_summary` i `@/core/ai` (forslag og beslutning),
 * kjøres når funksjonen finnes i `AI_FEATURES`. Den bygges i egen bit i samme oppgave.
 *
 * Støtter hovedmål: KI i bunnen (forslag, beslutning og logg går gjennom `@/core/ai`, og
 * KI-forslaget i loggen skrives aldri over) og de ansatte (lederens tekst kontrolleres, logges
 * aldri og lekker aldri mellom organisasjoner). Testdata er oppdiktet.
 */

const NOW = new Date("2026-11-24T12:00:00Z");
const MONTH = "2026-10";
const AI_READY = Object.prototype.hasOwnProperty.call(AI_FEATURES, "override_summary");

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function managerIn(organizationId: string, name = "Leder Testesen") {
  const actor: Actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, ["manager"]);
  return { actor, employee };
}

/** Organisasjon med KI på, en leder og `reports` publiserte rapporter i oktober med overstyring. */
async function setup(options: { reports?: number } = {}) {
  const organization = await createOrganization("Oppdiktet Takst");
  const org = await overrideOrg(organization.id);
  const { actor, employee } = await managerIn(organization.id);
  await enableAi(organization.id);
  for (let i = 0; i < (options.reports ?? 6); i += 1) {
    const report = await overrideReport(org);
    await overrideRelease(org, report, {
      releasedAt: new Date(`2026-10-1${i % 10}T10:00:00Z`),
      overrides: [{ reasonCode: i === 0 ? "other" : "no_access_or_refused" }],
    });
    if (i === 0) {
      await overrideClaim(organization.id, report.assignmentId, {
        receivedAt: "2026-11-02",
        checkpointKey: "wet_room.membrane_drain",
      });
    }
  }
  return { org, actor, employee, organizationId: organization.id };
}

async function summaryRows(organizationId: string) {
  return db
    .select()
    .from(overrideSummaries)
    .where(eq(overrideSummaries.organizationId, organizationId));
}

async function usageRows(organizationId: string) {
  return db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, organizationId));
}

describe("O6.3 tenant-isolasjon for getOverrideSummary", () => {
  it("B får verken A-s tekst eller A-s rad, og fremmed organisasjons-id avvises", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const rowA = await createOverrideSummaryRow(grantA.organizationId, {
          month: MONTH,
          status: "manual",
          source: "manual",
          text: "Tekst for A.",
          decidedBy: grantA.employeeId,
          decidedAt: NOW,
        });
        const rowB = await createOverrideSummaryRow(grantB.organizationId, { month: MONTH });
        return { a: [rowA.id], b: [rowB.id] };
      },
      query: async (actor, organizationId) => {
        const view = await getOverrideSummary(actor, organizationId, MONTH);
        return view.id ? [view] : [];
      },
      idOf: (view) => view.id!,
    });
  });

  it("forespørsel, lagring og beslutning mot en annen organisasjon avvises", async () => {
    const a = await setup({ reports: 1 });
    const b = await setup({ reports: 1 });
    const rowA = await createOverrideSummaryRow(a.organizationId, { month: MONTH });
    await expect(
      requestOverrideSummary(b.actor, a.organizationId, { requestId: uuidv7(), month: MONTH }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      saveOverrideSummary(b.actor, a.organizationId, {
        month: MONTH,
        text: "Tekst fra B.",
        baseRowVersion: rowA.rowVersion,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      decideOverrideSummary(b.actor, a.organizationId, {
        month: MONTH,
        usageId: uuidv7(),
        decision: "accepted",
        baseRowVersion: rowA.rowVersion,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await summaryRows(a.organizationId))[0]!.text).toBeNull();
  });
});

describe("O6.4 saveOverrideSummary skriver bare egen rad", () => {
  it("B som lagrer for samme måned, får egen rad, og A-s rad står urørt", async () => {
    const a = await setup({ reports: 1 });
    const b = await setup({ reports: 1 });
    await saveOverrideSummary(a.actor, a.organizationId, {
      month: MONTH,
      text: "Tekst for A.",
      baseRowVersion: 0,
    });
    const before = await summaryRows(a.organizationId);
    const result = await saveOverrideSummary(b.actor, b.organizationId, {
      month: MONTH,
      text: "Tekst for B.",
      baseRowVersion: 0,
    });
    expect(result.status).toBe("saved");
    expect(result.summary.id).not.toBe(before[0]!.id);
    expect(await summaryRows(a.organizationId)).toEqual(before);
  });

  it("forslag fra A kan ikke brukes i B (samme svar som ukjent id)", async () => {
    const a = await setup({ reports: 1 });
    const b = await setup({ reports: 1 });
    const rowA = await createOverrideSummaryRow(a.organizationId, { month: MONTH });
    const usageA = await createAiUsageLog(a.organizationId, {
      employeeId: a.employee.id,
      feature: "override_summary",
      targetRef: { type: "override_summary", id: rowA.id, fieldKey: "text" },
      outputText: "Forslag for A.",
    });
    const rowB = await createOverrideSummaryRow(b.organizationId, { month: MONTH });
    for (const usageId of [usageA.id, randomUUID()]) {
      await expect(
        decideOverrideSummary(b.actor, b.organizationId, {
          month: MONTH,
          usageId,
          decision: "accepted",
          baseRowVersion: rowB.rowVersion,
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(
        saveOverrideSummary(b.actor, b.organizationId, {
          month: MONTH,
          text: "Endret.",
          baseRowVersion: rowB.rowVersion,
          usageId,
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });
});

describe("O4.13 bare fire tillatte måneder", () => {
  it.each(["2025-01", "2026-13", "2026-12", "2026-07", "", "2026-10-01"])(
    "%s avvises med samme feil på lesing, forespørsel og lagring",
    async (month) => {
      const { actor, organizationId } = await setup({ reports: 1 });
      const errors = await Promise.all([
        getOverrideSummary(actor, organizationId, month).catch((e: unknown) => e),
        requestOverrideSummary(actor, organizationId, { requestId: uuidv7(), month }).catch(
          (e: unknown) => e,
        ),
        saveOverrideSummary(actor, organizationId, {
          month,
          text: "Tekst.",
          baseRowVersion: 0,
        }).catch((e: unknown) => e),
      ]);
      for (const error of errors) {
        expect(error).toBeInstanceOf(ReportValidationError);
        expect((error as Error).message).toBe((errors[0] as Error).message);
      }
    },
  );

  it("organisasjons-id som måned avvises med samme feil", async () => {
    const { actor, organizationId } = await setup({ reports: 1 });
    await expect(getOverrideSummary(actor, organizationId, organizationId)).rejects.toBeInstanceOf(
      ReportValidationError,
    );
  });

  it("de fire månedene godtas", async () => {
    const { actor, organizationId } = await setup({ reports: 1 });
    for (const month of ["2026-11", "2026-10", "2026-09", "2026-08"]) {
      const view = await getOverrideSummary(actor, organizationId, month);
      expect(view).toMatchObject({ month, id: null, status: "empty", rowVersion: 0 });
    }
  });
});

describe("O4.17 null utgivelser", () => {
  it("måned uten utgivelser kaller ikke KI og lager verken loggrad eller rad", async () => {
    const { actor, organizationId } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await requestOverrideSummary(actor, organizationId, {
      requestId: uuidv7(),
      month: "2026-09",
    });
    expect(result.status).toBe("no_reports");
    if (result.status === "no_reports") expect(result.summary.reportCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(await usageRows(organizationId)).toEqual([]);
    expect(await summaryRows(organizationId)).toEqual([]);
  });
});

describe("O4.19 manuell tekst", () => {
  it("lagres med source manual, og lederen ser den på getOverrideSummary", async () => {
    const { actor, organizationId } = await setup();
    const result = await saveOverrideSummary(actor, organizationId, {
      month: MONTH,
      text: "  Hulltaking ble krysset bort i 5 av 6 rapporter.  ",
      baseRowVersion: 0,
    });
    expect(result.status).toBe("saved");
    expect(result.summary).toMatchObject({
      status: "manual",
      source: "manual",
      text: "Hulltaking ble krysset bort i 5 av 6 rapporter.",
      reportCount: 6,
      canDecide: true,
    });
    const view = await getOverrideSummary(actor, organizationId, MONTH);
    expect(view.text).toBe("Hulltaking ble krysset bort i 5 av 6 rapporter.");
    const [row] = await summaryRows(organizationId);
    expect(row).toMatchObject({ aiUsageLogId: null, status: "manual" });
  });

  it.each([
    ["navn", `${LEAK_MARKERS.employeeName} krysset bort flest.`, "employee_name"],
    ["navn med annen bokstavstørrelse", "MXQLINE TESTESEN krysset bort flest.", "employee_name"],
    ["e-post", "Spør ase.testesen@eksempel.no.", "email"],
    ["telefon", "Ring 12345678.", "phone"],
    ["elleve sifre", "Gjelder 010190 12345.", "id_number"],
    ["for lang", "a".repeat(2001), "too_long"],
    ["tom", "   ", "empty"],
  ])("tekst med %s avvises og lagres ikke", async (_name, text, issue) => {
    const { actor, organizationId } = await setup({ reports: 1 });
    const error = await saveOverrideSummary(actor, organizationId, {
      month: MONTH,
      text,
      baseRowVersion: 0,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OverrideSummaryTextError);
    expect((error as OverrideSummaryTextError).issue).toBe(issue);
    expect((error as Error).message).not.toContain("Testesen");
    expect(await summaryRows(organizationId)).toEqual([]);
  });

  it("O6.8 navn på ansatt i en annen organisasjon stoppes ikke", async () => {
    const a = await setup({ reports: 1 });
    const other = await createOrganization("Annen organisasjon");
    await managerIn(other.id, "Bjørnar Utenfra");
    const result = await saveOverrideSummary(a.actor, a.organizationId, {
      month: MONTH,
      text: "Bjørnar Utenfra er ikke ansatt her.",
      baseRowVersion: 0,
    });
    expect(result.status).toBe("saved");
  });

  it("feil radversjon gir konflikt, og ingenting lagres", async () => {
    const { actor, organizationId } = await setup({ reports: 1 });
    const first = await saveOverrideSummary(actor, organizationId, {
      month: MONTH,
      text: "Første tekst.",
      baseRowVersion: 0,
    });
    const stale = await saveOverrideSummary(actor, organizationId, {
      month: MONTH,
      text: "Andre tekst.",
      baseRowVersion: first.summary.rowVersion - 1,
    });
    expect(stale.status).toBe("conflict");
    expect(stale.summary.text).toBe("Første tekst.");
    const next = await saveOverrideSummary(actor, organizationId, {
      month: MONTH,
      text: "Andre tekst.",
      baseRowVersion: first.summary.rowVersion,
    });
    expect(next.summary.text).toBe("Andre tekst.");
  });
});

describe("O4.21 grensene", () => {
  it(`forespørsel nummer ${AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR + 1} fra samme leder innen en time avvises uten kall og uten loggrad`, async () => {
    const { actor, employee, organizationId } = await setup();
    for (let i = 0; i < AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR; i += 1) {
      await createAiUsageLog(organizationId, {
        employeeId: employee.id,
        feature: "override_summary",
        outcome: "error",
        errorCode: "unavailable",
        createdAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      });
    }
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const before = (await usageRows(organizationId)).length;
    const result = await requestOverrideSummary(actor, organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result).toEqual({ status: "rate_limited" });
    expect(spy).not.toHaveBeenCalled();
    expect((await usageRows(organizationId)).length).toBe(before);
  });

  it(`forespørsel nummer ${AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY + 1} i organisasjonen innen et døgn avvises`, async () => {
    const { actor, organizationId } = await setup();
    for (let i = 0; i < AI_OVERRIDE_SUMMARY_MAX_PER_ORGANIZATION_PER_DAY; i += 1) {
      await createAiUsageLog(organizationId, {
        feature: "override_summary",
        outcome: "error",
        errorCode: "unavailable",
        createdAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
      });
    }
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await requestOverrideSummary(actor, organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result).toEqual({ status: "rate_limited" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("O4.24 logging", () => {
  it("revisjonsloggen og applikasjonsloggen har bare id, måned og status, aldri teksten", async () => {
    const { actor, organizationId } = await setup({ reports: 1 });
    const info = vi.spyOn(logger, "info");
    const text = "Mxq-lederens-tekst ble skrevet for oktober.";
    await saveOverrideSummary(actor, organizationId, { month: MONTH, text, baseRowVersion: 0 });
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          eq(auditLog.entityType, "override_summary"),
        ),
      );
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("Mxq-lederens-tekst");
    expect(audit.at(-1)!.changes).toEqual({ month: MONTH, status: "manual" });
    expect(JSON.stringify(info.mock.calls)).not.toContain("Mxq-lederens-tekst");
  });
});

describe.skipIf(!AI_READY)("oppsummering med KI (krever funksjonen override_summary)", () => {
  async function suggest(ctx: { actor: Actor; organizationId: string }, month = MONTH) {
    const result = await requestOverrideSummary(ctx.actor, ctx.organizationId, {
      requestId: uuidv7(),
      month,
    });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") throw new Error("ikke forslag");
    return result.summary;
  }

  it("O4.16 lage: raden lages, målet er raden, og loggraden har verken rapport eller oppdrag", async () => {
    const ctx = await setup();
    const summary = await suggest(ctx);
    expect(summary.id).not.toBeNull();
    expect(summary.openSuggestion).not.toBeNull();
    const [usage] = await usageRows(ctx.organizationId);
    expect(usage).toMatchObject({
      feature: "override_summary",
      reportId: null,
      assignmentId: null,
      targetRef: { type: "override_summary", id: summary.id, fieldKey: "text" },
    });
    expect((await summaryRows(ctx.organizationId))[0]).toMatchObject({
      status: "empty",
      text: null,
    });
  });

  it("O4.14 det leverandøren fikk og input_summary har ingen persondata", async () => {
    const ctx = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await suggest(ctx);
    const sent = JSON.stringify(spy.mock.calls);
    const [usage] = await usageRows(ctx.organizationId);
    for (const marker of Object.values(LEAK_MARKERS)) {
      expect(sent).not.toContain(marker);
      expect(JSON.stringify(usage!.inputSummary)).not.toContain(marker);
    }
    expect(sent).not.toContain(ctx.org.employeeId);
  });

  it("O4.18 godta → endre → avvis: siste beslutning gjelder, og forslaget i loggen skrives aldri over", async () => {
    const ctx = await setup();
    const first = await suggest(ctx);
    const usageId = first.openSuggestion!.usageId;
    const accepted = await decideOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      usageId,
      decision: "accepted",
      baseRowVersion: first.rowVersion,
    });
    expect(accepted.summary).toMatchObject({
      status: "accepted",
      source: "ai",
      text: first.openSuggestion!.text.trim(),
      openSuggestion: null,
    });
    expect((await summaryRows(ctx.organizationId))[0]!.aiUsageLogId).toBe(usageId);

    const edited = await saveOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      text: "Endret av leder.",
      baseRowVersion: accepted.summary.rowVersion,
    });
    expect(edited.summary).toMatchObject({ status: "edited", text: "Endret av leder." });
    const [usageAfterEdit] = await usageRows(ctx.organizationId);
    expect(usageAfterEdit!.outputText).toBe(first.openSuggestion!.text);

    const second = await suggest(ctx);
    const rejected = await decideOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      usageId: second.openSuggestion!.usageId,
      decision: "rejected",
      baseRowVersion: second.rowVersion,
    });
    // Avvis fjerner ikke teksten som gjelder
    expect(rejected.summary).toMatchObject({ status: "edited", text: "Endret av leder." });
    const view = await getOverrideSummary(ctx.actor, ctx.organizationId, MONTH);
    expect(view.text).toBe("Endret av leder.");
  });

  it("avvis uten tidligere tekst gir rejected uten tekst; angre gir tom rad", async () => {
    const ctx = await setup();
    const first = await suggest(ctx);
    const rejected = await decideOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      usageId: first.openSuggestion!.usageId,
      decision: "rejected",
      baseRowVersion: first.rowVersion,
    });
    expect(rejected.summary).toMatchObject({ status: "rejected", text: null });
    const second = await suggest(ctx);
    const accepted = await decideOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      usageId: second.openSuggestion!.usageId,
      decision: "accepted",
      baseRowVersion: second.rowVersion,
    });
    const undone = await decideOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      usageId: second.openSuggestion!.usageId,
      decision: "undo",
      baseRowVersion: accepted.summary.rowVersion,
    });
    expect(undone.summary).toMatchObject({ status: "empty", text: null, source: null });
  });

  it("endre på et åpent forslag registrerer edited og lagrer teksten", async () => {
    const ctx = await setup();
    const first = await suggest(ctx);
    const usageId = first.openSuggestion!.usageId;
    const edited = await saveOverrideSummary(ctx.actor, ctx.organizationId, {
      month: MONTH,
      text: "Rettet tekst fra leder.",
      baseRowVersion: first.rowVersion,
      usageId,
    });
    expect(edited.summary).toMatchObject({
      status: "edited",
      source: "ai",
      text: "Rettet tekst fra leder.",
    });
    const [usage] = await usageRows(ctx.organizationId);
    expect(usage).toMatchObject({ status: "edited", outputText: first.openSuggestion!.text });
  });

  it("O4.20 åpent forslag gjenbrukes: leder B får forslaget leder A ba om, og kan avgjøre det", async () => {
    const ctx = await setup();
    const first = await suggest(ctx);
    const other = await managerIn(ctx.organizationId, "Leder Nummer To");
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const again = await requestOverrideSummary(other.actor, ctx.organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(again.status).toBe("suggested");
    expect(spy).not.toHaveBeenCalled();
    if (again.status !== "suggested") return;
    expect(again.summary.openSuggestion!.usageId).toBe(first.openSuggestion!.usageId);
    const decided = await decideOverrideSummary(other.actor, ctx.organizationId, {
      month: MONTH,
      usageId: first.openSuggestion!.usageId,
      decision: "accepted",
      baseRowVersion: again.summary.rowVersion,
    });
    expect(decided.summary.status).toBe("accepted");
  });

  it("O4.21 to trykk samtidig for samme måned gir ett åpent forslag", async () => {
    const ctx = await setup();
    await Promise.all([
      requestOverrideSummary(ctx.actor, ctx.organizationId, { requestId: uuidv7(), month: MONTH }),
      requestOverrideSummary(ctx.actor, ctx.organizationId, { requestId: uuidv7(), month: MONTH }),
    ]);
    const open = (await usageRows(ctx.organizationId)).filter((r) => r.status === "suggested");
    expect(open).toHaveLength(1);
    expect(await summaryRows(ctx.organizationId)).toHaveLength(1);
  });

  it("O4.21 forespørsler eldre enn en time teller ikke for lederen", async () => {
    const { employee, organizationId, actor } = await setup();
    for (let i = 0; i < AI_OVERRIDE_SUMMARY_MAX_PER_EMPLOYEE_PER_HOUR; i += 1) {
      await createAiUsageLog(organizationId, {
        employeeId: employee.id,
        feature: "override_summary",
        outcome: "error",
        errorCode: "unavailable",
        createdAt: new Date(NOW.getTime() - 61 * 60 * 1000),
      });
    }
    const result = await requestOverrideSummary(actor, organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result.status).not.toBe("rate_limited");
  });

  it("O4.22 feil fra leverandøren gir error, og listen virker fortsatt", async () => {
    const ctx = await setup();
    vi.spyOn(fakeAiProvider, "complete").mockResolvedValue({
      outcome: "error",
      errorCode: "unavailable",
    });
    const result = await requestOverrideSummary(ctx.actor, ctx.organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result).toEqual({ status: "error" });
    const view = await getOverrideSummary(ctx.actor, ctx.organizationId, MONTH);
    expect(view.openSuggestion).toBeNull();
  });

  it("O4.22 KI-porten av gir disabled uten kall", async () => {
    const ctx = await setup();
    await enableAi(ctx.organizationId, { enabled: false, connection: false });
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await requestOverrideSummary(ctx.actor, ctx.organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result).toEqual({ status: "disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "et tall som ikke står i grunnlaget",
      "Hulltaking ble krysset bort i 977 rapporter.",
      "number_guard",
    ],
    ["TG", "Hulltaking ga TG3 i flere bad.", "tg_guard"],
  ])("O4.23 vakten stopper %s", async (_name, text, guard) => {
    const ctx = await setup();
    vi.spyOn(fakeAiProvider, "complete").mockResolvedValue({
      outcome: "ok",
      text,
      tokensIn: 10,
      tokensOut: 10,
      cost: 0,
      currency: "NOK",
    });
    const result = await requestOverrideSummary(ctx.actor, ctx.organizationId, {
      requestId: uuidv7(),
      month: MONTH,
    });
    expect(result).toEqual({ status: "stopped", guard });
    const view = await getOverrideSummary(ctx.actor, ctx.organizationId, MONTH);
    expect(view.openSuggestion).toBeNull();
  });
});
