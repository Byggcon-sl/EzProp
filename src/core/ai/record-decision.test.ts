import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRow,
  allAuditRows,
  auditCount,
  captureError,
  employeeWithGrant,
  expectSameRejection,
  mergeOrganizationSettings,
  neutralDecisionRejection,
  recordDecision,
  snapshot,
  validTarget,
} from "../../../tests/ai";
import { createAiUsageLog, resetDatabase, TEST_NOW } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as aiModule from "./index";

/*
 * `recordDecision` (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 7, 9.4, 9.8 og
 * 10.1; kortet Omfang 4, A162 og avklaring D). Mot testdatabasen. Utgangsradene lages med
 * `createAiUsageLog`. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (avgjørelser og angre virker likt overalt, også gjentatte kall fra
 * iPaden) og færre reklamasjoner (hvem som godtok hva, og når, står alltid i loggen og i
 * `audit_log`, og en annen organisasjon kan aldri avgjøre et forslag).
 */

type Cell = "lov" | "ingen endring" | "feil";
type Status = "suggested" | "accepted" | "edited" | "rejected";
type Decision = "accepted" | "edited" | "rejected" | "undo";

/** Tabellen over lovlige endringer (kortet Omfang 4), skrevet inn her som fasit. */
const TRANSITIONS: Record<Status, Record<Decision, Cell>> = {
  suggested: { accepted: "lov", edited: "lov", rejected: "lov", undo: "feil" },
  accepted: { accepted: "ingen endring", edited: "feil", rejected: "feil", undo: "lov" },
  edited: { accepted: "feil", edited: "ingen endring", rejected: "feil", undo: "lov" },
  rejected: { accepted: "feil", edited: "feil", rejected: "ingen endring", undo: "lov" },
};

const cells = (Object.keys(TRANSITIONS) as Status[]).flatMap((from) =>
  (Object.keys(TRANSITIONS[from]) as Decision[]).map((decision) => ({
    from,
    decision,
    cell: TRANSITIONS[from][decision],
    to: decision === "undo" ? "suggested" : decision,
  })),
);

const EARLIER = new Date("2026-11-02T09:00:00Z");
const DECIDED_EARLIER = new Date("2026-11-02T10:00:00Z");

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** En rad med status `from`. Avgjorte rader har `decided_by` og `decided_at` fra før. */
async function rowWithStatus(
  organizationId: string,
  employeeId: string,
  from: Status,
  extra: Parameters<typeof createAiUsageLog>[1] = {},
) {
  return createAiUsageLog(organizationId, {
    employeeId,
    status: from,
    decidedBy: from === "suggested" ? null : employeeId,
    decidedAt: from === "suggested" ? null : DECIDED_EARLIER,
    createdAt: EARLIER,
    ...extra,
  });
}

describe("recordDecision: tabellen over lovlige endringer (7.1–7.4)", () => {
  it("tabellen har 16 ruter", () => {
    expect(cells).toHaveLength(16);
  });

  it.each(cells)("$from + $decision → $cell", async ({ from, decision, cell, to }) => {
    const { organization, grant } = await aiOrganization();
    const row = await rowWithStatus(organization.id, grant.employeeId, from, {
      outputText: "Forslaget MARKOR-tabell er her.",
    });
    const before = (await aiRow(row.id))!;
    const auditBefore = await allAuditRows();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);

    if (cell === "feil") {
      const error = await captureError(() => recordDecision(grant, row.id, decision));
      expect(error).not.toBeInstanceOf(AccessDeniedError);
      expect(snapshot(await aiRow(row.id))).toBe(snapshot(before));
      expect(await auditCount()).toBe(auditBefore.length);
      return;
    }

    await recordDecision(grant, row.id, decision);
    const after = (await aiRow(row.id))!;

    if (cell === "ingen endring") {
      expect(snapshot(after)).toBe(snapshot(before));
      expect(await auditCount()).toBe(auditBefore.length);
      return;
    }

    // lov
    expect(after.status).toBe(to);
    expect(after.row_version).toBeGreaterThan(before.row_version);
    if (decision === "undo") {
      // 7.4 angre tømmer decided_by og decided_at
      expect(after.decided_by).toBeNull();
      expect(after.decided_at).toBeNull();
    } else {
      // 7.7 decided_by kommer fra grant, decided_at fra serverens klokke
      expect(after.decided_by).toBe(grant.employeeId);
      expect(new Date(after.decided_at!).toISOString()).toBe(TEST_NOW.toISOString());
    }
    expect(after.output_text).toBe(before.output_text);
    const newAudit = (await allAuditRows()).slice(auditBefore.length);
    expect(newAudit).toHaveLength(1);
    const line = newAudit[0]!;
    expect(line.entity_id).toBe(row.id);
    expect(line.organization_id).toBe(grant.organizationId);
    expect(line.actor_employee_id).toBe(grant.employeeId);
    const changes = JSON.stringify(line.changes);
    expect(changes).toContain(`"${from}"`);
    expect(changes).toContain(`"${to}"`);
    expect(changes).not.toContain("MARKOR-tabell");
    expect(changes).not.toContain("Forslaget");
  });
});

describe("recordDecision: angre når et nyere forslag finnes (7.5, avklaring D)", () => {
  it("7.5 undo fra rejected når et nyere suggested-forslag på samme mål finnes → feil", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const rejected = await rowWithStatus(organization.id, grant.employeeId, "rejected", {
      targetRef: target,
    });
    await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      targetRef: target,
      createdAt: new Date("2026-11-02T12:00:00Z"),
    });
    const before = snapshot(await aiRow(rejected.id));
    const auditBefore = await auditCount();

    const error = await captureError(() => recordDecision(grant, rejected.id, "undo"));

    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(snapshot(await aiRow(rejected.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("7.5 det nyere forslaget er mykt slettet → lov", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const rejected = await rowWithStatus(organization.id, grant.employeeId, "rejected", {
      targetRef: target,
    });
    await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      targetRef: target,
      createdAt: new Date("2026-11-02T12:00:00Z"),
      deletedAt: new Date("2026-11-02T13:00:00Z"),
      deletedBy: grant.employeeId,
    });

    await recordDecision(grant, rejected.id, "undo");

    expect((await aiRow(rejected.id))!.status).toBe("suggested");
  });

  it("7.5 det nyere forslaget er på et annet mål → lov", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const rejected = await rowWithStatus(organization.id, grant.employeeId, "rejected", {
      targetRef: target,
    });
    await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      targetRef: validTarget(),
      createdAt: new Date("2026-11-02T12:00:00Z"),
    });

    await recordDecision(grant, rejected.id, "undo");

    expect((await aiRow(rejected.id))!.status).toBe("suggested");
  });

  it("7.5 det nyere forslaget er i en annen organisasjon → lov", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const target = validTarget();
    const rejected = await rowWithStatus(a.organization.id, a.grant.employeeId, "rejected", {
      targetRef: target,
    });
    await rowWithStatus(b.organization.id, b.grant.employeeId, "suggested", {
      targetRef: target,
      createdAt: new Date("2026-11-02T12:00:00Z"),
    });

    await recordDecision(a.grant, rejected.id, "undo");

    expect((await aiRow(rejected.id))!.status).toBe("suggested");
  });

  it("D: «nyere» sammenlignes på created_at, ikke på id-en fra enheten", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    // Det nyere forslaget får en id som sorterer FØR den avviste (id laget med eldre tid)
    const smallId = uuidv7(new Date("2020-01-01T00:00:00Z").getTime());
    const largeId = uuidv7(new Date("2030-01-01T00:00:00Z").getTime());
    const rejected = await rowWithStatus(organization.id, grant.employeeId, "rejected", {
      id: largeId,
      targetRef: target,
    });
    await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      id: smallId,
      targetRef: target,
      createdAt: new Date("2026-11-02T12:00:00Z"),
    });

    const error = await captureError(() => recordDecision(grant, rejected.id, "undo"));
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect((await aiRow(rejected.id))!.status).toBe("rejected");
  });

  it("D: et eldre suggested-forslag (created_at før) med større id sperrer ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const smallId = uuidv7(new Date("2020-01-01T00:00:00Z").getTime());
    const largeId = uuidv7(new Date("2030-01-01T00:00:00Z").getTime());
    const rejected = await rowWithStatus(organization.id, grant.employeeId, "rejected", {
      id: smallId,
      targetRef: target,
      createdAt: new Date("2026-11-02T12:00:00Z"),
    });
    await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      id: largeId,
      targetRef: target,
      createdAt: new Date("2026-11-01T12:00:00Z"),
    });

    await recordDecision(grant, rejected.id, "undo");
    expect((await aiRow(rejected.id))!.status).toBe("suggested");
  });
});

describe("recordDecision: hvem som avgjør (7.6–7.7)", () => {
  it.each([
    { name: "leder", roles: ["manager"] as const },
    { name: "takstmann med innstillingen på", roles: ["inspector"] as const },
  ])(
    "7.6 $name kan avgjøre et forslag en annen ba om; decided_by er den som avgjorde",
    async ({ roles }) => {
      const { organization, grant: requester } = await aiOrganization();
      const decider = await employeeWithGrant(organization.id, [...roles], "Test Leder");
      const row = await rowWithStatus(organization.id, requester.employeeId, "suggested");

      await recordDecision(decider.grant, row.id, "accepted");

      const after = (await aiRow(row.id))!;
      expect(after.status).toBe("accepted");
      expect(after.decided_by).toBe(decider.grant.employeeId);
      expect(after.employee_id).toBe(requester.employeeId);
    },
  );

  it("7.7 decided_by kan ikke styres: funksjonen tar grant, usageId og avgjørelse, ingen ansatt-id", async () => {
    const fn = (aiModule as unknown as Record<string, unknown>).recordDecision as (
      ...args: unknown[]
    ) => Promise<void>;
    expect(fn.length).toBeLessThanOrEqual(3);
    const { organization, grant } = await aiOrganization();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const row = await rowWithStatus(organization.id, grant.employeeId, "suggested");

    // Et fjerde argument med en annen ansatt brukes aldri
    await fn(grant, row.id, "accepted", other.grant.employeeId);

    expect((await aiRow(row.id))!.decided_by).toBe(grant.employeeId);
  });
});

describe("recordDecision: rader uten forslag og ukjente id-er (7.8–7.9)", () => {
  it.each([
    { outcome: "no_match", errorCode: null },
    { outcome: "error", errorCode: "timeout" },
  ])(
    "7.8 rad med outcome $outcome → feil for hver avgjørelse, ingen endring",
    async ({ outcome, errorCode }) => {
      const { organization, grant } = await aiOrganization();
      const row = await createAiUsageLog(organization.id, {
        employeeId: grant.employeeId,
        outcome,
        errorCode,
        status: null,
        outputText: null,
      });
      const before = snapshot(await aiRow(row.id));
      const auditBefore = await auditCount();
      for (const decision of ["accepted", "edited", "rejected", "undo"]) {
        const error = await captureError(() => recordDecision(grant, row.id, decision));
        expect(error, decision).not.toBeInstanceOf(AccessDeniedError);
      }
      expect(snapshot(await aiRow(row.id))).toBe(before);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it.each([
    { name: "ukjent usageId", id: () => uuidv7() },
    { name: "ugyldig UUID", id: () => "ikke-en-uuid" },
    { name: "tom tekst", id: () => "" },
  ])("7.9 $name → nøytralt avslag", async ({ id }) => {
    const { grant } = await aiOrganization();
    const baseline = await neutralDecisionRejection(grant);
    const auditBefore = await auditCount();
    const error = await captureError(() => recordDecision(grant, id(), "accepted"));
    expectSameRejection(error, baseline);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('7.9 ukjent avgjørelse ("approve") gir feil og ingen endring', async () => {
    const { organization, grant } = await aiOrganization();
    const row = await rowWithStatus(organization.id, grant.employeeId, "suggested");
    const before = snapshot(await aiRow(row.id));
    const error = await captureError(() => recordDecision(grant, row.id, "approve"));
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(snapshot(await aiRow(row.id))).toBe(before);
  });
});

describe("recordDecision: KI av og markør (7.10–7.11)", () => {
  it("7.10 KI av (ai.enabled = false, tilkoblingen slettet): avgjørelser og angre virker", async () => {
    const { organization, connection, grant } = await aiOrganization();
    const row = await rowWithStatus(organization.id, grant.employeeId, "suggested");
    await mergeOrganizationSettings(organization.id, { "ai.enabled": false });
    await db.execute(
      sql`update integration_connections set deleted_at = now() where id = ${connection!.id}`,
    );

    await recordDecision(grant, row.id, "accepted");
    expect((await aiRow(row.id))!.status).toBe("accepted");
    await recordDecision(grant, row.id, "undo");
    expect((await aiRow(row.id))!.status).toBe("suggested");
    await recordDecision(grant, row.id, "rejected");
    expect((await aiRow(row.id))!.status).toBe("rejected");
  });

  it("7.11 output_text med en unik markør finnes ikke i noen linje i audit_log", async () => {
    const { organization, grant } = await aiOrganization();
    const marker = "MARKOR-7f3a-beslutning";
    const row = await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      outputText: `Taket har sprekker ${marker}.`,
    });
    await recordDecision(grant, row.id, "edited");
    await recordDecision(grant, row.id, "undo");
    await recordDecision(grant, row.id, "accepted");
    const audit = await allAuditRows();
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audit)).not.toContain(marker);
  });
});

describe("recordDecision: myk sletting og tenant-isolasjon (10.1, 9.4, 9.8)", () => {
  it("10.1 mykt slettet rad → nøytralt avslag, ingen endring, ingen audit", async () => {
    const { organization, grant } = await aiOrganization();
    const baseline = await neutralDecisionRejection(grant);
    const row = await rowWithStatus(organization.id, grant.employeeId, "suggested", {
      deletedAt: new Date("2026-11-02T11:00:00Z"),
      deletedBy: grant.employeeId,
    });
    const before = snapshot(await aiRow(row.id));
    const auditBefore = await auditCount();

    for (const decision of ["accepted", "edited", "rejected", "undo"]) {
      const error = await captureError(() => recordDecision(grant, row.id, decision));
      expectSameRejection(error, baseline);
    }
    expect(snapshot(await aiRow(row.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("9.4 lesing og endring i recordDecision: bare egne rader endres", async () => {
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await rowWithStatus(grantA.organizationId, grantA.employeeId, "suggested");
        const b = await rowWithStatus(grantB.organizationId, grantB.employeeId, "suggested");
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const before = new Map<string, string>();
        for (const id of seeded) before.set(id, snapshot(await aiRow(id)));
        for (const id of seeded) {
          try {
            await recordDecision(grant, id, "accepted");
          } catch (error) {
            if (error instanceof AccessDeniedError) throw error;
          }
        }
        const changed: { id: string }[] = [];
        for (const id of seeded) {
          if (snapshot(await aiRow(id)) !== before.get(id)) changed.push({ id });
        }
        // Tilbake til suggested, så neste side kan prøve på nytt
        for (const { id } of changed) await recordDecision(grant, id, "undo");
        return changed;
      },
      idOf: (row) => row.id,
    });
  });

  it("9.8 B sin admin med A sin usageId → nøytralt avslag, A sin rad helt uendret", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const adminB = await employeeWithGrant(b.organization.id, ["admin"], "Test Admin B");
    const baseline = await neutralDecisionRejection(adminB.grant);
    const row = await rowWithStatus(a.organization.id, a.grant.employeeId, "suggested");
    const accepted = await rowWithStatus(a.organization.id, a.grant.employeeId, "accepted");
    const before = snapshot(await aiRow(row.id));
    const beforeAccepted = snapshot(await aiRow(accepted.id));
    const auditBefore = await auditCount();

    for (const decision of ["accepted", "edited", "rejected"]) {
      expectSameRejection(
        await captureError(() => recordDecision(adminB.grant, row.id, decision)),
        baseline,
      );
    }
    expectSameRejection(
      await captureError(() => recordDecision(adminB.grant, accepted.id, "undo")),
      baseline,
    );

    expect(snapshot(await aiRow(row.id))).toBe(before);
    expect(snapshot(await aiRow(accepted.id))).toBe(beforeAccepted);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("recordDecision: sperret forespørsel (vask før KI V5.6, ad-1)", () => {
  it.each(["accepted", "edited", "rejected", "undo"])(
    "V5.6 %s på en blocked-rad: samme avslag som «finnes ikke», raden og audit_log uendret",
    async (decision) => {
      const { organization, grant } = await aiOrganization();
      const blocked = await createAiUsageLog(organization.id, {
        employeeId: grant.employeeId,
        outcome: "blocked",
        status: null,
        outputText: null,
        inputSummary: {},
      });
      const before = snapshot(await aiRow(blocked.id));
      const audits = await auditCount();
      const baseline = await neutralDecisionRejection(grant);
      const error = await captureError(() => recordDecision(grant, blocked.id, decision));
      expectSameRejection(error, baseline);
      expect(snapshot(await aiRow(blocked.id))).toBe(before);
      expect(await auditCount()).toBe(audits);
    },
  );

  it("V5.6 admin får heller ikke godta en blocked-rad (avslag, ikke utestengt)", async () => {
    const { organization } = await aiOrganization();
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const blocked = await createAiUsageLog(organization.id, {
      employeeId: admin.grant.employeeId,
      outcome: "blocked",
      status: null,
      outputText: null,
    });
    const error = await captureError(() => recordDecision(admin.grant, blocked.id, "accepted"));
    expectSameRejection(error, await neutralDecisionRejection(admin.grant));
  });
});
