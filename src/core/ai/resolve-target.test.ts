import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiOrganization, employeeWithGrant } from "../../../tests/ai";
import {
  createAiReportChain,
  resolvedTargets,
  setReportStatus,
  softDelete,
} from "../../../tests/ai-report";
import {
  createOrganization,
  createOverrideSummaryRow,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { resolveAiTarget } from "./resolve-target";

/*
 * Oppslaget av målet i kjernen (docs/funksjoner/fase2a-ki-i-veien-testplan.md K4.18 og K5.12,
 * ADR 0006, tillegg 17.11.2026, del 1). Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (rapport og oppdrag i loggen utledes ett sted) og færre
 * reklamasjoner (et forslag kan aldri knyttes til en annen organisasjons rapport, en slettet rad
 * eller en publisert rapport).
 */

beforeEach(resetDatabase);

describe("K4.18 resolveAiTarget: riktig id gir rapport og oppdrag", () => {
  it("alle måltypene, også new_measure, gir rapporten og oppdraget fra kjeden", async () => {
    const { organization, grant } = await aiOrganization();
    const chain = await createAiReportChain(organization.id);
    for (const { name, target } of resolvedTargets(chain)) {
      expect(await resolveAiTarget(grant, target), name).toEqual({
        reportId: chain.reportId,
        assignmentId: chain.assignmentId,
      });
    }
  });

  it("id med store bokstaver gir samme svar", async () => {
    const { organization, grant } = await aiOrganization();
    const chain = await createAiReportChain(organization.id);
    expect(
      await resolveAiTarget(grant, {
        type: "deviation",
        id: chain.deviationId.toUpperCase(),
        fieldKey: "cause_text",
      }),
    ).toEqual({ reportId: chain.reportId, assignmentId: chain.assignmentId });
  });

  it("måltyper kjernen ikke slår opp (field_answer, tgiu_detail, ukjent) gir null", async () => {
    const { grant } = await aiOrganization();
    for (const type of ["field_answer", "tgiu_detail", "ai_trial", "contact"]) {
      expect(await resolveAiTarget(grant, { type, id: uuidv7(), fieldKey: "text" }), type).toBe(
        null,
      );
    }
  });
});

describe("K4.18 resolveAiTarget: ikke funnet", () => {
  it("ukjent id gir null for alle måltypene", async () => {
    const { grant } = await aiOrganization();
    for (const type of ["deviation", "deviation_measure", "checkpoint_result", "report"]) {
      expect(await resolveAiTarget(grant, { type, id: uuidv7(), fieldKey: "x" }), type).toBe(null);
    }
  });

  it("id fra en annen organisasjon gir null", async () => {
    const { grant } = await aiOrganization();
    const other = await createOrganization("Oppdiktet Takst B");
    const chain = await createAiReportChain(other.id);
    for (const { name, target } of resolvedTargets(chain)) {
      expect(await resolveAiTarget(grant, target), name).toBe(null);
    }
  });

  it("rapport som ikke er draft gir null for alle måltypene", async () => {
    const { organization, grant } = await aiOrganization();
    const chain = await createAiReportChain(organization.id);
    await setReportStatus(chain.reportId, "superseded");
    for (const { name, target } of resolvedTargets(chain)) {
      expect(await resolveAiTarget(grant, target), name).toBe(null);
    }
  });

  it.each([
    { deleted: "assignments" as const, gone: ["alle"] },
    { deleted: "reports" as const, gone: ["alle"] },
    {
      deleted: "checkpoint_results" as const,
      gone: ["deviation", "deviation_measure", "checkpoint_result"],
    },
    { deleted: "deviations" as const, gone: ["deviation", "deviation_measure"] },
    { deleted: "deviation_measures" as const, gone: ["deviation_measure"] },
  ])("mykt slettet $deleted gir null for målene under", async ({ deleted, gone }) => {
    const { organization, grant } = await aiOrganization();
    const chain = await createAiReportChain(organization.id);
    const idOf = {
      assignments: chain.assignmentId,
      reports: chain.reportId,
      checkpoint_results: chain.checkpointResultId,
      deviations: chain.deviationId,
      deviation_measures: chain.measureId,
    } as const;
    await softDelete(deleted, idOf[deleted]);
    for (const { name, target } of resolvedTargets(chain)) {
      const expectGone = gone.includes("alle") || gone.includes(target.type);
      const resolved = await resolveAiTarget(grant, target);
      if (expectGone) expect(resolved, name).toBe(null);
      else expect(resolved, name).not.toBe(null);
    }
  });

  it("mykt slettet rom gir null for målene i rommet", async () => {
    const { organization, grant } = await aiOrganization();
    const chain = await createAiReportChain(organization.id);
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`update rooms set deleted_at = now() where id = (select room_id from checkpoint_results where id = ${chain.checkpointResultId})`,
    );
    for (const { name, target } of resolvedTargets(chain)) {
      const resolved = await resolveAiTarget(grant, target);
      if (target.type === "report") expect(resolved, name).not.toBe(null);
      else expect(resolved, name).toBe(null);
    }
  });
});

describe("K5.12 tenant-isolasjon for oppslaget av målet", () => {
  it("expectTenantIsolation per måltype (fire måltyper og new_measure)", async () => {
    const chains = new Map<string, Awaited<ReturnType<typeof createAiReportChain>>>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAiReportChain(grantA.organizationId);
        const b = await createAiReportChain(grantB.organizationId);
        chains.set(grantA.organizationId, a);
        chains.set(grantB.organizationId, b);
        const keys = (chain: typeof a) =>
          resolvedTargets(chain).map((entry) => entry.name + chain.reportId);
        return { a: keys(a), b: keys(b) };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: string[] = [];
        for (const chain of chains.values()) {
          for (const { name, target } of resolvedTargets(chain)) {
            const resolved = await resolveAiTarget(grant, target);
            if (resolved) found.push(name + resolved.reportId);
          }
        }
        return found;
      },
      idOf: (row) => row,
    });
  });

  it("en ansatt i organisasjon A får null for B sine mål, selv med samme rolle", async () => {
    const a = await createOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    const chainB = await createAiReportChain(b.id);
    const { grant } = await employeeWithGrant(a.id, ["admin"]);
    for (const { name, target } of resolvedTargets(chainB)) {
      expect(await resolveAiTarget(grant, target), name).toBe(null);
    }
  });
});

/*
 * Organisasjonsmålet `override_summary` (docs/funksjoner/fase2a-overstyringer-leder-testplan.md
 * O6.5, ADR 0006 tillegg 24.11.2026 punkt 2). Raden i `override_summaries` slås opp på
 * `grant.organizationId` og `deleted_at is null`; svaret har verken rapport eller oppdrag.
 */
describe("O6.5 resolveAiTarget for override_summary", () => {
  const target = (id: string, fieldKey = "text") => ({ type: "override_summary", id, fieldKey });

  it("raden i organisasjonen gir rapport og oppdrag lik null; id med store bokstaver likt", async () => {
    const { organization, grant } = await aiOrganization();
    const row = await createOverrideSummaryRow(organization.id);
    expect(await resolveAiTarget(grant, target(row.id))).toEqual({
      reportId: null,
      assignmentId: null,
    });
    expect(await resolveAiTarget(grant, target(row.id.toUpperCase()))).toEqual({
      reportId: null,
      assignmentId: null,
    });
  });

  it("ukjent id, slettet rad, annen organisasjon og annen feltkode gir samme svar (null)", async () => {
    const { organization, grant } = await aiOrganization();
    const other = await createOrganization("Oppdiktet Takst B");
    const foreign = await createOverrideSummaryRow(other.id);
    const deleted = await createOverrideSummaryRow(organization.id, {
      month: "2026-09",
      deletedAt: new Date(),
    });
    const own = await createOverrideSummaryRow(organization.id, { month: "2026-08" });
    expect(await resolveAiTarget(grant, target(uuidv7()))).toBe(null);
    expect(await resolveAiTarget(grant, target(deleted.id))).toBe(null);
    expect(await resolveAiTarget(grant, target(foreign.id))).toBe(null);
    expect(await resolveAiTarget(grant, target(own.id, "summary_text"))).toBe(null);
  });

  it("expectTenantIsolation: hver organisasjon finner bare sin egen oppsummering", async () => {
    const ids: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOverrideSummaryRow(grantA.organizationId);
        const b = await createOverrideSummaryRow(grantB.organizationId);
        ids.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
        const found: string[] = [];
        for (const id of ids) {
          if (await resolveAiTarget(grant, target(id))) found.push(id);
        }
        return found;
      },
      idOf: (id) => id,
    });
  });
});
