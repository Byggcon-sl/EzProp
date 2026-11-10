import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import { captureError, employeeWithGrant, enableAi, type AiTarget } from "../../../tests/ai";
import {
  answerTarget,
  APPROVAL_CHECK_MAX,
  checkAiTextApproved,
  trialTarget,
  type ApprovalItem,
} from "../../../tests/ai-pattern";
import {
  createAiUsageLog,
  createOrganization,
  resetDatabase,
  type AiUsageLogOverrides,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Publiseringssperren `checkAiTextApproved` (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 4 og 5.2, kortet Omfang 6, ad-6). Svaret er de innsendte elementene som ikke er
 * godkjent. Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (bare KI-tekst som takstmannen har godkjent for akkurat
 * det feltet, slipper gjennom) og KI i bunnen (tjenesten publiseringen i 2a-2 bygger på).
 */

const MARKER = "MARKOR-sperre-41ad";
const DECIDED_AT = new Date("2026-11-09T10:00:00Z");

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

type Ctx = { organizationId: string; grant: EmployeeGrant; otherOrganizationId: string };

async function setup(): Promise<Ctx> {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const other = await createOrganization("Oppdiktet Takst B");
  const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
  return { organizationId: organization.id, grant, otherOrganizationId: other.id };
}

/** En rad med målet, godkjent som standard. */
async function row(
  ctx: Ctx,
  target: AiTarget,
  overrides: AiUsageLogOverrides & { organizationId?: string } = {},
) {
  const { organizationId = ctx.organizationId, ...rest } = overrides;
  const status = "status" in rest ? rest.status : "accepted";
  const decided = status !== "suggested" && status !== null;
  return createAiUsageLog(organizationId, {
    employeeId: organizationId === ctx.organizationId ? ctx.grant.employeeId : undefined,
    targetRef: target,
    outputText: `Godkjent tekst ${MARKER}.`,
    decidedBy: decided && organizationId === ctx.organizationId ? ctx.grant.employeeId : null,
    decidedAt: decided ? DECIDED_AT : null,
    ...rest,
    status,
  });
}

type Verdict = "godkjent" | "stoppet";
type Case = { name: string; verdict: Verdict; build: (ctx: Ctx) => Promise<ApprovalItem> };

const CASES: Case[] = [
  {
    name: "4.1 accepted, ok, samme mål",
    verdict: "godkjent",
    build: async (ctx) => {
      const target = trialTarget();
      return { aiUsageId: (await row(ctx, target)).id, target };
    },
  },
  {
    name: "4.2 edited, ok, samme mål",
    verdict: "godkjent",
    build: async (ctx) => {
      const target = answerTarget();
      return { aiUsageId: (await row(ctx, target, { status: "edited" })).id, target };
    },
  },
  {
    name: "4.3 suggested",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      return { aiUsageId: (await row(ctx, target, { status: "suggested" })).id, target };
    },
  },
  {
    name: "4.4 rejected",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      return { aiUsageId: (await row(ctx, target, { status: "rejected" })).id, target };
    },
  },
  {
    name: "4.5 outcome = no_match",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      const created = await row(ctx, target, {
        outcome: "no_match",
        status: null,
        outputText: null,
      });
      return { aiUsageId: created.id, target };
    },
  },
  {
    name: "4.6 outcome = error",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      const created = await row(ctx, target, {
        outcome: "error",
        errorCode: "unavailable",
        status: null,
        outputText: null,
      });
      return { aiUsageId: created.id, target };
    },
  },
  {
    name: "4.7 mykt slettet rad (accepted)",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      const created = await row(ctx, target, {
        deletedAt: new Date("2026-11-09T11:00:00Z"),
        deletedBy: ctx.grant.employeeId,
      });
      return { aiUsageId: created.id, target };
    },
  },
  {
    name: "4.8 rad i annen organisasjon (accepted)",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = trialTarget();
      const created = await row(ctx, target, { organizationId: ctx.otherOrganizationId });
      return { aiUsageId: created.id, target };
    },
  },
  {
    name: "4.9 ad-6: samme type og id, annet felt",
    verdict: "stoppet",
    build: async (ctx) => {
      const stored = trialTarget();
      const created = await row(ctx, stored);
      return { aiUsageId: created.id, target: { ...stored, fieldKey: "title" } };
    },
  },
  {
    name: "4.10 ad-6: samme type og felt, annen id",
    verdict: "stoppet",
    build: async (ctx) => {
      const created = await row(ctx, trialTarget());
      return { aiUsageId: created.id, target: trialTarget() };
    },
  },
  {
    name: "4.11 ad-6: samme id og felt, annen type (answer mot ai_trial)",
    verdict: "stoppet",
    build: async (ctx) => {
      const stored = trialTarget();
      const created = await row(ctx, stored);
      return { aiUsageId: created.id, target: answerTarget(stored.id) };
    },
  },
  {
    name: "4.12 mål som ikke står i allowedTargets (report/summary), sendt inn med samme mål",
    verdict: "stoppet",
    build: async (ctx) => {
      const target = { type: "report", id: uuidv7(), fieldKey: "summary" };
      return { aiUsageId: (await row(ctx, target)).id, target };
    },
  },
  {
    name: "4.13 ugyldig uuid som aiUsageId",
    verdict: "stoppet",
    build: async () => ({ aiUsageId: "ikke-en-uuid", target: trialTarget() }),
  },
  {
    name: "4.14 ukjent id (gyldig uuid)",
    verdict: "stoppet",
    build: async () => ({ aiUsageId: randomUUID(), target: trialTarget() }),
  },
  {
    name: "4.15 store bokstaver i target.id mot rad med små",
    verdict: "godkjent",
    build: async (ctx) => {
      const stored = trialTarget();
      const created = await row(ctx, stored);
      return { aiUsageId: created.id, target: { ...stored, id: stored.id.toUpperCase() } };
    },
  },
  {
    name: "4.15 store bokstaver i aiUsageId (kortet: id sammenlignes normalisert)",
    verdict: "godkjent",
    build: async (ctx) => {
      const target = trialTarget();
      const created = await row(ctx, target);
      return { aiUsageId: created.id.toUpperCase(), target };
    },
  },
];

describe("checkAiTextApproved: tabellen (4.1–4.15)", () => {
  it.each(CASES)("$name → $verdict", async ({ build, verdict }) => {
    const ctx = await setup();
    const item = await build(ctx);

    const result = await checkAiTextApproved(ctx.grant, [item]);

    if (verdict === "godkjent") {
      expect(result).toEqual([]);
      return;
    }
    expect(result).toHaveLength(1);
    expect(result[0]!.aiUsageId).toBe(item.aiUsageId);
    expect(result[0]!.target).toEqual(item.target);
  });
});

describe("checkAiTextApproved: lister (4.16–4.19)", () => {
  it("4.16 tom liste gir tom liste, uten spørring mot databasen", async () => {
    const ctx = await setup();
    const select = vi.spyOn(db, "select");
    const execute = vi.spyOn(db, "execute");
    expect(await checkAiTextApproved(ctx.grant, [])).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("4.17 samme id to ganger (begge godkjent) gir tom liste", async () => {
    const ctx = await setup();
    const target = trialTarget();
    const created = await row(ctx, target);
    const item = { aiUsageId: created.id, target };
    expect(await checkAiTextApproved(ctx.grant, [item, { ...item }])).toEqual([]);
  });

  it("4.17 samme id to ganger med ulikt felt: bare elementet med feil felt i svaret", async () => {
    const ctx = await setup();
    const target = trialTarget();
    const created = await row(ctx, target);
    const wrong = { aiUsageId: created.id, target: { ...target, fieldKey: "title" } };
    const result = await checkAiTextApproved(ctx.grant, [{ aiUsageId: created.id, target }, wrong]);
    expect(result).toEqual([wrong]);
  });

  it("4.18 blandet liste (2 godkjent, 3 stoppet): nøyaktig de 3, hver med sin target", async () => {
    const ctx = await setup();
    const okA = trialTarget();
    const okB = answerTarget();
    const approved = [
      { aiUsageId: (await row(ctx, okA)).id, target: okA },
      { aiUsageId: (await row(ctx, okB, { status: "edited" })).id, target: okB },
    ];
    const pendingTarget = trialTarget();
    const rejectedTarget = trialTarget();
    const stopped = [
      {
        aiUsageId: (await row(ctx, pendingTarget, { status: "suggested" })).id,
        target: pendingTarget,
      },
      {
        aiUsageId: (await row(ctx, rejectedTarget, { status: "rejected" })).id,
        target: rejectedTarget,
      },
      { aiUsageId: randomUUID(), target: trialTarget() },
    ];
    const mixed = [stopped[1]!, approved[0]!, stopped[2]!, approved[1]!, stopped[0]!];

    const result = await checkAiTextApproved(ctx.grant, mixed);

    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining(stopped));
    for (const item of approved) {
      expect(result.map((r) => r.aiUsageId)).not.toContain(item.aiUsageId);
    }
  });

  it("4.19 taket: 500 elementer godtas", async () => {
    const ctx = await setup();
    const items = Array.from({ length: APPROVAL_CHECK_MAX }, () => ({
      aiUsageId: randomUUID(),
      target: trialTarget(),
    }));
    const result = await checkAiTextApproved(ctx.grant, items);
    expect(result).toHaveLength(APPROVAL_CHECK_MAX);
  });

  it("4.19 taket: 501 elementer gir avslag (feil), ikke delvis svar", async () => {
    const ctx = await setup();
    const target = trialTarget();
    const approved = { aiUsageId: (await row(ctx, target)).id, target };
    const items = [
      approved,
      ...Array.from({ length: APPROVAL_CHECK_MAX }, () => ({
        aiUsageId: randomUUID(),
        target: trialTarget(),
      })),
    ];
    expect(items).toHaveLength(APPROVAL_CHECK_MAX + 1);
    const error = await captureError(() => checkAiTextApproved(ctx.grant, items));
    expect(error).not.toBeInstanceOf(AccessDeniedError);
  });

  it("4.20 ett oppslag for hele listen: 50 elementer gir ett kall mot databasen", async () => {
    const ctx = await setup();
    const items: ApprovalItem[] = [];
    for (let i = 0; i < 50; i += 1) {
      const target = trialTarget();
      const created = await row(ctx, target, { status: i % 2 === 0 ? "accepted" : "suggested" });
      items.push({ aiUsageId: created.id, target });
    }
    const select = vi.spyOn(db, "select");
    const execute = vi.spyOn(db, "execute");
    const selectDistinct = vi.spyOn(db, "selectDistinct");

    const result = await checkAiTextApproved(ctx.grant, items);

    const calls =
      select.mock.calls.length + execute.mock.calls.length + selectDistinct.mock.calls.length;
    // Spionen må faktisk ha sett kallet, ellers sier testen ingenting
    expect(calls).toBe(1);
    expect(result).toHaveLength(25);
  });
});

describe("checkAiTextApproved: svaret (4.21–4.23)", () => {
  it("4.21 leser aldri output_text: svaret inneholder ikke markøren", async () => {
    const ctx = await setup();
    const target = trialTarget();
    const created = await row(ctx, target, { status: "suggested" });
    const result = await checkAiTextApproved(ctx.grant, [{ aiUsageId: created.id, target }]);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it("4.22 elementene i svaret har bare aiUsageId og target (ingen grunn)", async () => {
    const ctx = await setup();
    const suggestedTarget = trialTarget();
    const items = [
      {
        aiUsageId: (await row(ctx, suggestedTarget, { status: "suggested" })).id,
        target: suggestedTarget,
      },
      { aiUsageId: randomUUID(), target: trialTarget() },
      { aiUsageId: "abc", target: trialTarget() },
      {
        aiUsageId: (await row(ctx, trialTarget(), { organizationId: ctx.otherOrganizationId })).id,
        target: trialTarget(),
      },
    ];
    const result = await checkAiTextApproved(ctx.grant, items);
    expect(result).toHaveLength(items.length);
    for (const item of result) {
      expect(Object.keys(item).sort()).toEqual(["aiUsageId", "target"]);
      expect(Object.keys(item.target).sort()).toEqual(["fieldKey", "id", "type"]);
    }
  });

  it.each([
    { name: "tom liste", items: () => [] as ApprovalItem[] },
    {
      name: "liste med ett element",
      items: () => [{ aiUsageId: randomUUID(), target: trialTarget() }],
    },
  ])("4.23 uten report.edit ($name): AccessDeniedError", async ({ items }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const office = await employeeWithGrant(organization.id, ["office"], "Test Kontor");
    expect(office.grant.permissions).not.toContain("report.edit");
    const error = await captureError(() => checkAiTextApproved(office.grant, items()));
    expect(error).toBeInstanceOf(AccessDeniedError);
  });
});

describe("checkAiTextApproved: tenant-isolasjon (4.24, 5.2)", () => {
  it("expectTenantIsolation", async () => {
    const seeded: ApprovalItem[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const target = trialTarget();
          const created = await createAiUsageLog(grant.organizationId, {
            employeeId: grant.employeeId,
            targetRef: target,
            status: "accepted",
            decidedBy: grant.employeeId,
            decidedAt: DECIDED_AT,
          });
          seeded.push({ aiUsageId: created.id, target });
          ids[side].push(created.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const stopped = new Set(
          (await checkAiTextApproved(grant, seeded)).map((item) => item.aiUsageId),
        );
        // «Radene» spørringen gir, er de som ble godkjent
        return seeded
          .filter((item) => !stopped.has(item.aiUsageId))
          .map((item) => ({
            id: item.aiUsageId,
          }));
      },
      idOf: (r) => r.id,
    });
  });

  it("5.2 A sin godkjente rad sendt inn av B kommer tilbake som stoppet", async () => {
    const ctx = await setup();
    const target = trialTarget();
    const created = await row(ctx, target);
    const orgB = await createOrganization("Oppdiktet Takst C");
    const inspectorB = await employeeWithGrant(orgB.id, ["inspector"], "Test Takstmann B");
    const item = { aiUsageId: created.id, target };

    expect(await checkAiTextApproved(ctx.grant, [item])).toEqual([]);
    expect(await checkAiTextApproved(inspectorB.grant, [item])).toEqual([item]);
  });
});
