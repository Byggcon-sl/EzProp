import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  neutralRequestRejection,
} from "../../../tests/ai";
import {
  createAiUsageLog,
  createOrganization,
  resetDatabase,
  type AiUsageLogOverrides,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AI_APPROVAL_CHECK_MAX, checkAiTextApproved, type AiTargetRef } from "./index";

/*
 * Publiseringssperren for KI-tekst `checkAiTextApproved` (docs/funksjoner/fase2a-forslagsmonster-
 * testplan.md avsnitt 4 og 5.2, kortet Omfang 6, ad-6, avklaring C). Mot testdatabasen. Svaret er
 * elementene som ikke er godkjent. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (bare KI-tekst som er godkjent for akkurat det feltet,
 * slipper gjennom) og KI i bunnen (publiseringen i 2a-2 bygger på denne tjenesten).
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const MARKER = "OPPDIKTET-MARKOR-2c9e";

async function setup() {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  const other = await createOrganization("Oppdiktet Takst B");
  return { organization, other, ...inspector };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const answerTarget = (id: string = uuidv7()): AiTargetRef => ({
  type: "answer",
  id,
  fieldKey: "text",
});

/** En godkjent rad (accepted, ok) på målet, med overstyringer. */
async function approvedRow(
  ctx: Ctx,
  target: AiTargetRef,
  overrides: AiUsageLogOverrides & { organizationId?: string } = {},
) {
  const { organizationId, ...rest } = overrides;
  const own = organizationId === undefined || organizationId === ctx.organization.id;
  return createAiUsageLog(organizationId ?? ctx.organization.id, {
    employeeId: own ? ctx.grant.employeeId : undefined,
    targetRef: target,
    status: "accepted",
    decidedBy: own ? ctx.grant.employeeId : null,
    decidedAt: new Date(),
    outputText: `Oppdiktet tekst ${MARKER}`,
    ...rest,
  });
}

type Case = {
  name: string;
  approved: boolean;
  /** Lager raden og gir elementet som sendes inn. */
  build: (ctx: Ctx) => Promise<{ aiUsageId: string; target: AiTargetRef }>;
};

const CASES: Case[] = [
  {
    name: "4.1 accepted, ok, samme mål",
    approved: true,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.2 edited, ok, samme mål",
    approved: true,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, { status: "edited" });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.2 accepted på prøvemålet ai_trial",
    approved: true,
    build: async (ctx) => {
      const target = { type: "ai_trial", id: uuidv7(), fieldKey: "text" };
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.3 suggested",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        status: "suggested",
        decidedBy: null,
        decidedAt: null,
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.4 rejected",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, { status: "rejected" });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.5 outcome no_match",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        outcome: "no_match",
        status: null,
        outputText: null,
        decidedBy: null,
        decidedAt: null,
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.6 outcome error",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        outcome: "error",
        errorCode: "timeout",
        status: null,
        outputText: null,
        decidedBy: null,
        decidedAt: null,
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "V5.6 outcome blocked (sperret forespørsel)",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        outcome: "blocked",
        status: null,
        outputText: null,
        decidedBy: null,
        decidedAt: null,
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.7 mykt slettet rad (accepted)",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        deletedAt: new Date(),
        deletedBy: "oppdiktet-admin",
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.8 rad i annen organisasjon (accepted)",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, { organizationId: ctx.other.id });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.9 ad-6: samme type og id, annet felt",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target: { ...target, fieldKey: "description" } };
    },
  },
  {
    name: "4.10 ad-6: samme type og felt, annen id",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target: { ...target, id: uuidv7() } };
    },
  },
  {
    name: "4.11 ad-6: samme id og felt, annen type (answer mot ai_trial)",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target: { ...target, type: "ai_trial" } };
    },
  },
  {
    name: "4.12 mål som ikke står i allowedTargets (report/summary)",
    approved: false,
    build: async (ctx) => {
      const target = { type: "report", id: uuidv7(), fieldKey: "summary" };
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.12 rad med ukjent funksjon",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, {
        feature: "unknown_feature",
        promptVersion: "unknown_feature.v1",
      });
      return { aiUsageId: row.id, target };
    },
  },
  {
    name: "4.13 ugyldig uuid som aiUsageId",
    approved: false,
    build: async () => ({ aiUsageId: "abc", target: answerTarget() }),
  },
  {
    name: "4.13 uuid med ekstra tegn",
    approved: false,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: `${row.id}' or '1'='1`, target };
    },
  },
  {
    name: "4.14 ukjent id (gyldig uuid)",
    approved: false,
    build: async () => ({ aiUsageId: uuidv7(), target: answerTarget() }),
  },
  {
    name: "4.15 store bokstaver i target.id mot rad med små",
    approved: true,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id, target: { ...target, id: target.id.toUpperCase() } };
    },
  },
  {
    name: "4.15 store bokstaver i aiUsageId (normaliseres til små)",
    approved: true,
    build: async (ctx) => {
      const target = answerTarget();
      const row = await approvedRow(ctx, target);
      return { aiUsageId: row.id.toUpperCase(), target };
    },
  },
];

describe("checkAiTextApproved: hva sperren godkjenner (4.1–4.15)", () => {
  it.each(CASES)("$name → godkjent = $approved", async ({ build, approved }) => {
    const ctx = await setup();
    const item = await build(ctx);
    const result = await checkAiTextApproved(ctx.grant, [item]);
    if (approved) {
      expect(result).toEqual([]);
    } else {
      expect(result).toEqual([{ aiUsageId: item.aiUsageId, target: item.target }]);
    }
  });
});

describe("checkAiTextApproved: lister, tak og oppslag (4.16–4.22)", () => {
  it("4.16 tom liste gir tom liste uten databasekall", async () => {
    const ctx = await setup();
    const select = vi.spyOn(db, "select");
    const execute = vi.spyOn(db, "execute");
    expect(await checkAiTextApproved(ctx.grant, [])).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("4.17 samme id to ganger (begge godkjent) gir tom liste", async () => {
    const ctx = await setup();
    const target = answerTarget();
    const row = await approvedRow(ctx, target);
    const item = { aiUsageId: row.id, target };
    expect(await checkAiTextApproved(ctx.grant, [item, { ...item }])).toEqual([]);
  });

  it("4.17 samme id to ganger med ulikt felt: bare elementet med feil felt i svaret", async () => {
    const ctx = await setup();
    const target = answerTarget();
    const row = await approvedRow(ctx, target);
    const wrong = { aiUsageId: row.id, target: { ...target, fieldKey: "title" } };
    expect(await checkAiTextApproved(ctx.grant, [{ aiUsageId: row.id, target }, wrong])).toEqual([
      wrong,
    ]);
  });

  it("4.18 blandet liste: nøyaktig de stoppede, hver med sin target, i innsendt rekkefølge", async () => {
    const ctx = await setup();
    const ok1 = answerTarget();
    const ok2 = { type: "ai_trial", id: uuidv7(), fieldKey: "text" };
    const r1 = await approvedRow(ctx, ok1);
    const r2 = await approvedRow(ctx, ok2, { status: "edited" });
    const suggestedTarget = answerTarget();
    const r3 = await approvedRow(ctx, suggestedTarget, {
      status: "suggested",
      decidedBy: null,
      decidedAt: null,
    });
    const stopped = [
      { aiUsageId: r3.id, target: suggestedTarget },
      { aiUsageId: uuidv7(), target: answerTarget() },
      { aiUsageId: r1.id, target: { ...ok1, fieldKey: "description" } },
    ];
    const items = [stopped[0]!, { aiUsageId: r1.id, target: ok1 }, stopped[1]!];
    items.push({ aiUsageId: r2.id, target: ok2 }, stopped[2]!);
    expect(await checkAiTextApproved(ctx.grant, items)).toEqual(stopped);
  });

  it("4.19 taket: 500 elementer godtas, 501 gir avslag uten delvis svar", async () => {
    const ctx = await setup();
    expect(AI_APPROVAL_CHECK_MAX).toBe(500);
    const target = answerTarget();
    const row = await approvedRow(ctx, target);
    const many = Array.from({ length: 500 }, () => ({ aiUsageId: row.id, target }));
    expect(await checkAiTextApproved(ctx.grant, many)).toEqual([]);

    const baseline = await neutralRequestRejection(ctx.grant);
    const select = vi.spyOn(db, "select");
    const error = await captureError(() =>
      checkAiTextApproved(ctx.grant, [...many, { aiUsageId: uuidv7(), target }]),
    );
    expectSameRejection(error, baseline);
    expect(select).not.toHaveBeenCalled();
  });

  it("4.20 ett oppslag for hele listen: 50 elementer gir ett kall mot databasen", async () => {
    const ctx = await setup();
    const items = [];
    for (let i = 0; i < 25; i++) {
      const target = answerTarget();
      const row = await approvedRow(ctx, target, i % 2 === 0 ? {} : { status: "rejected" });
      items.push({ aiUsageId: row.id, target }, { aiUsageId: uuidv7(), target: answerTarget() });
    }
    expect(items).toHaveLength(50);
    const select = vi.spyOn(db, "select");
    const execute = vi.spyOn(db, "execute");
    const result = await checkAiTextApproved(ctx.grant, items);
    // Spionen må faktisk ha sett kallet, ellers sier testen ingenting
    expect(select).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(result).toHaveLength(25 + 12);
  });

  it("4.21 leser aldri output_text: markøren finnes ikke i svaret, og kilden nevner den ikke", async () => {
    const ctx = await setup();
    const target = answerTarget();
    const row = await approvedRow(ctx, target, {
      status: "suggested",
      decidedBy: null,
      decidedAt: null,
    });
    const result = await checkAiTextApproved(ctx.grant, [{ aiUsageId: row.id, target }]);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(MARKER);
    const source = readFileSync(join(__dirname, "approval-check.ts"), "utf8");
    expect(source).not.toMatch(/outputText|output_text/);
  });

  it("4.22 svaret skiller ikke grunner: bare aiUsageId og target", async () => {
    const ctx = await setup();
    const target = answerTarget();
    const foreign = await approvedRow(ctx, target, { organizationId: ctx.other.id });
    const rejected = await approvedRow(ctx, answerTarget(), { status: "rejected" });
    const result = await checkAiTextApproved(ctx.grant, [
      { aiUsageId: foreign.id, target },
      { aiUsageId: rejected.id, target: rejected.target_ref },
      { aiUsageId: uuidv7(), target },
      { aiUsageId: "abc", target },
    ]);
    expect(result).toHaveLength(4);
    for (const item of result) {
      expect(Object.keys(item).sort()).toEqual(["aiUsageId", "target"]);
      expect(Object.keys(item.target).sort()).toEqual(["fieldKey", "id", "type"]);
    }
  });
});

describe("checkAiTextApproved: tilgang og tenant (4.23–4.24, 5.2)", () => {
  it.each([
    { name: "tom liste", items: () => [] },
    {
      name: "liste med godkjent element",
      items: (row: { id: string; target: AiTargetRef }) => [
        { aiUsageId: row.id, target: row.target },
      ],
    },
    {
      name: "liste over taket",
      items: () =>
        Array.from({ length: 501 }, () => ({ aiUsageId: uuidv7(), target: answerTarget() })),
    },
  ])("4.23 kontor uten report.edit: AccessDeniedError ($name)", async ({ items }) => {
    const ctx = await setup();
    const target = answerTarget();
    const row = await approvedRow(ctx, target);
    const office = await employeeWithGrant(ctx.organization.id, ["office"], "Test Kontor");
    const select = vi.spyOn(db, "select");
    const error = await captureError(() =>
      checkAiTextApproved(office.grant, items({ id: row.id, target })),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(select).not.toHaveBeenCalled();
  });

  it("4.24 expectTenantIsolation: A sin godkjente rad sendt inn av B kommer tilbake som stoppet", async () => {
    const seeded: { aiUsageId: string; target: AiTargetRef }[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const target = answerTarget();
          const row = await createAiUsageLog(grant.organizationId, {
            employeeId: grant.employeeId,
            targetRef: target,
            status: "accepted",
            decidedBy: grant.employeeId,
            decidedAt: new Date(),
          });
          seeded.push({ aiUsageId: row.id, target });
          ids[side].push(row.id);
        }
        return ids;
      },
      // «Radene» spørringen gir, er elementene sperren godkjenner
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const stopped = new Set(
          (await checkAiTextApproved(grant, seeded)).map((item) => item.aiUsageId),
        );
        return seeded.filter((item) => !stopped.has(item.aiUsageId));
      },
      idOf: (item) => item.aiUsageId,
    });
  });
});
