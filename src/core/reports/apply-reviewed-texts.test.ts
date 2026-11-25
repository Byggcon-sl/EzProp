import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Tvunget feil i skriving av beslutning nummer to (GT3.31). */
const failDecision = vi.hoisted(() => ({ onCall: 0, calls: 0 }));
vi.mock("@/core/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/ai")>();
  return {
    ...original,
    recordDecisionIn: async (...args: Parameters<typeof original.recordDecisionIn>) => {
      failDecision.calls += 1;
      if (failDecision.onCall > 0 && failDecision.calls === failDecision.onCall) {
        throw new Error("tvunget feil i testen");
      }
      return original.recordDecisionIn(...args);
    },
  };
});

import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { retainUntilFor } from "@/core/ai";
import { fakeAiProvider } from "@/core/ai/providers/fake";
import {
  addMeasure,
  applyReviewedTexts,
  polishDescription,
  polishDeviation,
  REPORT_PUBLISHED_MESSAGE,
  ReportValidationError,
  saveField,
  type ApplyReviewedTextsInput,
  type ReviewChoice,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  aiUsageLog,
  auditLog,
  checkpointResults,
  claims,
  deviationMeasures,
  deviations,
  reports,
  type EmployeeRole,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRow, captureError, mergeOrganizationSettings } from "../../../tests/ai";
import {
  createAiUsageLog,
  createClaim,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  addPlaceDeviation,
  kiBathroom,
  PLACE,
  type KiBathroom,
} from "../../../tests/report-ki-fixtures";
import {
  CP,
  createStaff,
  setInspectorsEditAll,
  startedBathroom,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Lagringen i «Gå gjennom tekstene» (docs/funksjoner/fase2a-ga-gjennom-tekstene-testplan.md
 * 3b: GT3.20–GT3.34). Forslagene lages med språkvasken i avvikskortet og på beskrivelsen
 * (`polishDeviation`, `polishDescription`) mot den falske leverandøren, slik «Gå gjennom tekstene»
 * lager dem per felt. Alle tekster er oppdiktede.
 *
 * Støtter hovedmål: KI i bunnen (serveren avgjør beslutningen og logger den med teksten) og færre
 * reklamasjoner (endrede felt overskrives ikke, TG er urørt, publisert rapport er låst).
 */

beforeEach(() => {
  failDecision.onCall = 0;
  failDecision.calls = 0;
  return resetDatabase();
});
afterEach(() => vi.restoreAllMocks());

const TEXTS = {
  deviation_text: "mxq avvik på sjiktet",
  cause_text: "mxq årsak, spør mxq@eksempel.no",
  consequence_text: "mxq konsekvens",
  measure: "mxq tiltak",
  description: "mxq beskrivelse",
} as const;

type Field = "deviation_text" | "cause_text" | "consequence_text" | "measure" | "description";

type Reviewed = KiBathroom & {
  deviationId: string;
  measureId: string;
  resultId: string;
  usage: Record<Field, string>;
  suggestion: Record<Field, string>;
};

/** Badet med avvik, tiltak og beskrivelse, språkvasket per felt. */
async function reviewed(f: KiBathroom): Promise<Reviewed> {
  const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
  await db
    .update(deviations)
    .set({
      deviationText: TEXTS.deviation_text,
      causeText: TEXTS.cause_text,
      consequenceText: TEXTS.consequence_text,
    })
    .where(eq(deviations.id, deviationId));
  const measureId = uuidv7();
  await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
  await db
    .update(deviationMeasures)
    .set({ text: TEXTS.measure })
    .where(eq(deviationMeasures.id, measureId));
  await saveField(f.actor, f.organizationId, f.room, {
    table: "checkpoint_results",
    checkpointKey: CP.membrane,
    field: "description_text",
    value: TEXTS.description,
    base: null,
  });
  const [result] = await db
    .select({ id: checkpointResults.id })
    .from(checkpointResults)
    .where(eq(checkpointResults.reportId, f.reportId))
    .orderBy(sql`${checkpointResults.updatedAt} desc`)
    .limit(1);
  if (!result) throw new Error("mangler punkt");

  const keys = ["deviation_text", "cause_text", "consequence_text"] as const;
  const items = [
    ...keys.map((fieldKey) => ({
      requestId: uuidv7(),
      target: { type: "deviation" as const, id: deviationId, fieldKey },
      text: TEXTS[fieldKey],
    })),
    {
      requestId: uuidv7(),
      target: { type: "deviation_measure" as const, id: measureId, fieldKey: "text" as const },
      text: TEXTS.measure,
    },
  ];
  const polished = await polishDeviation(f.actor, f.organizationId, f.room, {
    deviationId,
    items,
  });
  const descriptionId = uuidv7();
  const description = await polishDescription(f.actor, f.organizationId, f.room, {
    requestId: descriptionId,
    checkpointKey: CP.membrane,
    text: TEXTS.description,
  });
  if (polished.status !== "done" || description.status !== "done") throw new Error("ikke vasket");
  const fields = [...polished.fields, ...description.fields];
  const text = (i: number) => {
    const r = fields[i]?.result;
    if (r?.status !== "suggestion") throw new Error(`fikk ${r?.status}`);
    return r.text;
  };
  return {
    ...f,
    deviationId,
    measureId,
    resultId: result.id,
    usage: {
      deviation_text: items[0]!.requestId,
      cause_text: items[1]!.requestId,
      consequence_text: items[2]!.requestId,
      measure: items[3]!.requestId,
      description: descriptionId,
    },
    suggestion: {
      deviation_text: text(0),
      cause_text: text(1),
      consequence_text: text(2),
      measure: text(3),
      description: text(4),
    },
  };
}

async function deviationRow(id: string) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
  if (!row) throw new Error("mangler avvik");
  return row;
}

async function measureRow(id: string) {
  const [row] = await db.select().from(deviationMeasures).where(eq(deviationMeasures.id, id));
  if (!row) throw new Error("mangler tiltak");
  return row;
}

async function resultRow(id: string) {
  const [row] = await db.select().from(checkpointResults).where(eq(checkpointResults.id, id));
  if (!row) throw new Error("mangler punkt");
  return row;
}

/** Alle tekstene og beslutningene i rommet, til «ingenting endret». */
async function state(p: Reviewed) {
  const d = await deviationRow(p.deviationId);
  const m = await measureRow(p.measureId);
  const r = await resultRow(p.resultId);
  const decisions = await db
    .select({ id: aiUsageLog.id, status: aiUsageLog.status, decidedAt: aiUsageLog.decidedAt })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.organizationId, p.organizationId))
    .orderBy(aiUsageLog.id);
  return JSON.stringify({
    texts: [d.deviationText, d.causeText, d.consequenceText, m.text, r.descriptionText],
    versions: [d.rowVersion, m.rowVersion, r.rowVersion],
    decisions,
  });
}

/** Radversjonene slik gjennomgangen viste dem. */
async function versions(p: Reviewed): Promise<Record<Field, number>> {
  const d = (await deviationRow(p.deviationId)).rowVersion;
  return {
    deviation_text: d,
    cause_text: d,
    consequence_text: d,
    measure: (await measureRow(p.measureId)).rowVersion,
    description: (await resultRow(p.resultId)).rowVersion,
  };
}

function choice(
  p: Reviewed,
  v: Record<Field, number>,
  field: Field,
  kind: ReviewChoice,
  text?: string,
): ApplyReviewedTextsInput["choices"][number] {
  return {
    usageId: p.usage[field],
    choice: kind,
    rowVersion: v[field],
    ...(text === undefined ? {} : { text }),
  };
}

const ALL: Field[] = ["deviation_text", "cause_text", "consequence_text", "measure", "description"];

async function useAll(p: Reviewed, actor: Actor = p.actor) {
  const v = await versions(p);
  return applyReviewedTexts(actor, p.organizationId, p.room, {
    choices: ALL.map((field) => choice(p, v, field, "use")),
  });
}

// --- Tilgang -------------------------------------------------------------------------------------

describe("GT3.20 roller, innstilling og reklamasjonssak", () => {
  type Case = { name: string; roles: EmployeeRole[]; editAll: boolean; allowed: boolean };
  const CASES: Case[] = [
    { name: "takstmann, alle kan endre", roles: ["inspector"], editAll: true, allowed: true },
    { name: "takstmann, innstillingen av", roles: ["inspector"], editAll: false, allowed: false },
    { name: "kontor", roles: ["office"], editAll: true, allowed: false },
    { name: "leder", roles: ["manager"], editAll: false, allowed: true },
    { name: "admin med bare admin-rollen", roles: ["admin"], editAll: false, allowed: true },
  ];

  it.each(CASES)("$name (lov: $allowed)", async ({ roles, editAll, allowed }) => {
    const p = await reviewed(await kiBathroom({ roles: ["admin"] }));
    await setInspectorsEditAll(p.organizationId, editAll);
    const { actor } = await createStaff(p.organizationId, roles);
    const before = await state(p);
    if (allowed) {
      const result = await useAll(p, actor);
      expect(result.saved).toHaveLength(ALL.length);
    } else {
      await expect(useAll(p, actor)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await state(p)).toBe(before);
    }
  });

  it("takstmann med enkeltrettigheten report.edit og innstillingen av: lov", async () => {
    const p = await reviewed(await kiBathroom({ roles: ["admin"] }));
    await setInspectorsEditAll(p.organizationId, false);
    const { actor, employee } = await createStaff(p.organizationId, ["inspector"]);
    await grantPermission(employee, "report.edit");
    expect((await useAll(p, actor)).saved).toHaveLength(ALL.length);
  });

  it.each([
    { name: "leder", roles: ["manager"] as EmployeeRole[], editAll: false, allowed: true },
    { name: "admin", roles: ["admin"] as EmployeeRole[], editAll: false, allowed: true },
    { name: "takstmann, PÅ", roles: ["inspector"] as EmployeeRole[], editAll: true, allowed: true },
    {
      name: "takstmann, AV",
      roles: ["inspector"] as EmployeeRole[],
      editAll: false,
      allowed: false,
    },
  ])(
    "reklamasjonssak: $name følger report.edit, og saken står urørt",
    async ({ roles, editAll, allowed }) => {
      const p = await reviewed(await kiBathroom({ roles: ["admin"] }));
      await setInspectorsEditAll(p.organizationId, editAll);
      const claim = await createClaim(p.organizationId, { assignmentId: p.room.assignmentId });
      const claimBefore = JSON.stringify(
        await db.select().from(claims).where(eq(claims.id, claim.id)),
      );
      const { actor } = await createStaff(p.organizationId, roles);
      if (allowed) {
        expect((await useAll(p, actor)).saved).toHaveLength(ALL.length);
      } else {
        await expect(useAll(p, actor)).rejects.toBeInstanceOf(AccessDeniedError);
      }
      expect(JSON.stringify(await db.select().from(claims).where(eq(claims.id, claim.id)))).toBe(
        claimBefore,
      );
    },
  );
});

describe("GT3.21 tenant-isolasjon", () => {
  it("en annen organisasjon får verken rader eller tilgang, og raden der er uendret", async () => {
    const byOrg = new Map<string, Reviewed>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const p = await reviewed(await kiBathroom({ organizationId: grant.organizationId }));
          byOrg.set(grant.organizationId, p);
          ids[side].push(p.usage.cause_text);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const own = byOrg.get(grant.organizationId);
        if (!own) throw new Error("mangler oppsett");
        const v = await versions(own);
        await applyReviewedTexts(actor, organizationId, own.room, {
          choices: [choice(own, v, "cause_text", "keep")],
        });
        return db
          .select({ id: aiUsageLog.id })
          .from(aiUsageLog)
          .where(
            and(
              eq(aiUsageLog.organizationId, grant.organizationId),
              eq(aiUsageLog.status, "rejected"),
            ),
          );
      },
      idOf: (row) => row.id,
    });
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    const before = await state(b);
    const vb = await versions(b);
    const error = await captureError(() =>
      applyReviewedTexts(a.actor, a.organizationId, a.room, {
        choices: [choice(b, vb, "consequence_text", "use")],
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await state(b)).toBe(before);
  });
});

// --- Valgene -------------------------------------------------------------------------------------

describe("GT3.22–GT3.27 valgene", () => {
  it("GT3.22 «Bruk» skriver forslaget med plassholderne byttet tilbake og gir accepted; row_version øker én gang per rad", async () => {
    const p = await reviewed(await kiBathroom());
    const causeRow = await aiRow(p.usage.cause_text);
    expect(causeRow?.output_text).toContain("[e-post]");
    const before = await versions(p);

    const result = await useAll(p);

    const d = await deviationRow(p.deviationId);
    expect(d.causeText).toBe(p.suggestion.cause_text);
    expect(d.causeText).toContain("mxq@eksempel.no");
    expect(d.causeText).not.toContain("[e-post]");
    expect(d.deviationText).toBe(p.suggestion.deviation_text);
    expect(d.consequenceText).toBe(p.suggestion.consequence_text);
    expect((await measureRow(p.measureId)).text).toBe(p.suggestion.measure);
    expect((await resultRow(p.resultId)).descriptionText).toBe(p.suggestion.description);
    expect(d.rowVersion).toBe(before.cause_text + 1);
    expect((await measureRow(p.measureId)).rowVersion).toBe(before.measure + 1);
    expect((await resultRow(p.resultId)).rowVersion).toBe(before.description + 1);
    for (const field of ALL) {
      expect((await aiRow(p.usage[field]))?.status).toBe("accepted");
    }
    expect(result.skippedChanged).toEqual([]);
    expect(result.saved.find((s) => s.usageId === p.usage.cause_text)).toEqual({
      usageId: p.usage.cause_text,
      decision: "accepted",
      text: p.suggestion.cause_text,
      rowVersion: d.rowVersion,
    });
  });

  it("GT3.22 plassholderne passer ikke lenger teksten i feltet: «Bruk» avvises, «Rett før bruk» gir edited", async () => {
    const p = await reviewed(await kiBathroom());
    // Teksten byttes uten ny radversjon, så bare tilbakebyttet kan merke det
    await db.execute(
      sql`update deviations set cause_text = 'mxq årsak uten adresse' where id = ${p.deviationId}`,
    );
    const v = await versions(p);
    const before = await state(p);
    const error = await captureError(() =>
      applyReviewedTexts(p.actor, p.organizationId, p.room, {
        choices: [choice(p, v, "cause_text", "use")],
      }),
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as ReportValidationError).code).toBe("invalid_choice");
    expect(error.message).not.toContain("mxq");
    expect(await state(p)).toBe(before);

    const edited = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [choice(p, v, "cause_text", "edit", p.suggestion.cause_text)],
    });
    expect(edited.saved[0]?.decision).toBe("edited");
  });

  it("GT3.23 «Rett før bruk»: lik forslaget gir accepted, annen tekst gir edited", async () => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    const result = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        choice(p, v, "cause_text", "edit", p.suggestion.cause_text),
        choice(p, v, "consequence_text", "edit", "Mxq egen konsekvens."),
        // En fremmed tekst kan aldri føres som godtatt
        choice(p, v, "description", "edit", "Mxq helt annen tekst."),
      ],
    });
    expect(result.saved.map((s) => s.decision)).toEqual(["accepted", "edited", "edited"]);
    expect((await aiRow(p.usage.cause_text))?.status).toBe("accepted");
    expect((await aiRow(p.usage.consequence_text))?.status).toBe("edited");
    expect((await aiRow(p.usage.description))?.status).toBe("edited");
    const d = await deviationRow(p.deviationId);
    expect(d.causeText).toBe(p.suggestion.cause_text);
    expect(d.consequenceText).toBe("Mxq egen konsekvens.");
    expect((await resultRow(p.resultId)).descriptionText).toBe("Mxq helt annen tekst.");
  });

  it.each([
    ["for lang tekst", "x".repeat(10_001)],
    ["plassholder", "Mxq [adresse] er feil."],
    ["elleve sifre", "Mxq 010190 12345"],
  ])(
    "GT3.24 «Rett før bruk» med %s avvises med samme melding som saveField",
    async (_name, text) => {
      const p = await reviewed(await kiBathroom());
      const before = await state(p);
      const v = await versions(p);
      const error = await captureError(() =>
        applyReviewedTexts(p.actor, p.organizationId, p.room, {
          choices: [choice(p, v, "consequence_text", "edit", text)],
        }),
      );
      const d = await deviationRow(p.deviationId);
      const viaSaveField = await captureError(() =>
        saveField(p.actor, p.organizationId, p.room, {
          table: "deviations",
          id: p.deviationId,
          field: "consequence_text",
          value: text,
          base: d.consequenceText,
        }),
      );
      expect(error).toBeInstanceOf(ReportValidationError);
      expect((error as ReportValidationError).code).toBe(
        (viaSaveField as ReportValidationError).code,
      );
      expect(error.message).toBe(viaSaveField.message);
      expect(await state(p)).toBe(before);
    },
  );

  it("GT3.25 «Behold» lar teksten stå og gir rejected med oppbevaring etter innstillingen", async () => {
    const p = await reviewed(await kiBathroom());
    await mergeOrganizationSettings(p.organizationId, { "ai.rejected_retention_years": 3 });
    const before = await deviationRow(p.deviationId);
    const v = await versions(p);
    const result = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [choice(p, v, "cause_text", "keep")],
    });
    expect(result.saved).toEqual([
      {
        usageId: p.usage.cause_text,
        decision: "rejected",
        text: TEXTS.cause_text,
        rowVersion: before.rowVersion,
      },
    ]);
    const after = await deviationRow(p.deviationId);
    expect(after.causeText).toBe(TEXTS.cause_text);
    expect(after.rowVersion).toBe(before.rowVersion);
    const row = await aiRow(p.usage.cause_text);
    expect(row?.status).toBe("rejected");
    expect(new Date(row!.retain_until as string | Date).toISOString()).toBe(
      retainUntilFor("rejected", new Date(row!.created_at as string | Date), 3).toISOString(),
    );
  });

  it("GT3.26 «Angre» etter «Bruk» og etter «Rett før bruk» setter teksten tilbake og gir rejected", async () => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    const first = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        choice(p, v, "cause_text", "use"),
        choice(p, v, "consequence_text", "edit", "Mxq egen."),
      ],
    });
    const rowVersion = first.saved[0]!.rowVersion;
    const undone = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        { usageId: p.usage.cause_text, choice: "undo", text: TEXTS.cause_text, rowVersion },
        {
          usageId: p.usage.consequence_text,
          choice: "undo",
          text: TEXTS.consequence_text,
          rowVersion,
        },
      ],
    });
    expect(undone.saved.map((s) => [s.decision, s.text])).toEqual([
      ["rejected", TEXTS.cause_text],
      ["rejected", TEXTS.consequence_text],
    ]);
    const d = await deviationRow(p.deviationId);
    expect([d.causeText, d.consequenceText]).toEqual([TEXTS.cause_text, TEXTS.consequence_text]);
    expect(d.rowVersion).toBe(rowVersion + 1);
    expect((await aiRow(p.usage.cause_text))?.status).toBe("rejected");
    expect((await aiRow(p.usage.consequence_text))?.status).toBe("rejected");
  });

  it.each(["suggested", "rejected"] as const)(
    "GT3.26 «Angre» på et forslag med status %s avvises",
    async (status) => {
      const p = await reviewed(await kiBathroom());
      const v = await versions(p);
      if (status === "rejected") {
        await applyReviewedTexts(p.actor, p.organizationId, p.room, {
          choices: [choice(p, v, "cause_text", "keep")],
        });
      }
      const before = await state(p);
      const error = await captureError(() =>
        applyReviewedTexts(p.actor, p.organizationId, p.room, {
          choices: [choice(p, v, "cause_text", "undo", "mxq før")],
        }),
      );
      expect(error).toBeInstanceOf(ReportValidationError);
      expect(await state(p)).toBe(before);
    },
  );

  it("GT3.27 «Angre» etter «Bruk alle» angrer hele bolken i én transaksjon", async () => {
    const p = await reviewed(await kiBathroom());
    const used = await useAll(p);
    const original: Record<Field, string> = {
      deviation_text: TEXTS.deviation_text,
      cause_text: TEXTS.cause_text,
      consequence_text: TEXTS.consequence_text,
      measure: TEXTS.measure,
      description: TEXTS.description,
    };
    const result = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: ALL.map((field) => ({
        usageId: p.usage[field],
        choice: "undo" as const,
        text: original[field],
        rowVersion: used.saved.find((s) => s.usageId === p.usage[field])!.rowVersion,
      })),
    });
    expect(result.saved).toHaveLength(ALL.length);
    const d = await deviationRow(p.deviationId);
    expect([d.deviationText, d.causeText, d.consequenceText]).toEqual([
      TEXTS.deviation_text,
      TEXTS.cause_text,
      TEXTS.consequence_text,
    ]);
    expect((await measureRow(p.measureId)).text).toBe(TEXTS.measure);
    expect((await resultRow(p.resultId)).descriptionText).toBe(TEXTS.description);
    for (const field of ALL) expect((await aiRow(p.usage[field]))?.status).toBe("rejected");
  });
});

// --- Avslag for hele listen ----------------------------------------------------------------------

describe("GT3.28 og GT3.29 avslag for hele listen", () => {
  type Bad = (
    p: Reviewed,
    v: Record<Field, number>,
  ) => Promise<ApplyReviewedTextsInput["choices"][number]>;

  /** En rad i loggen på avviksteksten i rommet, med overstyringer. */
  async function rowOnDeviation(p: Reviewed, overrides: Parameters<typeof createAiUsageLog>[1]) {
    return createAiUsageLog(p.organizationId, {
      employeeId: p.employeeId,
      assignmentId: p.assignmentId,
      reportId: p.reportId,
      targetRef: { type: "deviation", id: p.deviationId, fieldKey: "deviation_text" },
      ...overrides,
    });
  }

  const CASES: [string, Bad][] = [
    ["dobbel usageId", async (p, v) => choice(p, v, "cause_text", "keep")],
    [
      "alt avgjort",
      async (p, v) => {
        await db
          .update(aiUsageLog)
          .set({ status: "accepted", decidedAt: new Date(), decidedBy: p.employeeId })
          .where(eq(aiUsageLog.id, p.usage.consequence_text));
        return choice(p, v, "consequence_text", "use");
      },
    ],
    [
      "stoppet",
      async (p, v) => {
        const row = await rowOnDeviation(p, {
          outcome: "stopped",
          errorCode: "tg_guard",
          outputText: "Mxq TG3.",
          status: null,
        });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
    [
      "«Rett før bruk» på stoppet",
      async (p, v) => {
        const row = await rowOnDeviation(p, {
          outcome: "stopped",
          errorCode: "number_guard",
          outputText: "Mxq 4711.",
          status: null,
        });
        return { usageId: row.id, choice: "edit", text: "Mxq rettet.", rowVersion: v.measure };
      },
    ],
    [
      "ingen treff",
      async (p, v) => {
        const row = await rowOnDeviation(p, { outcome: "no_match" });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
    [
      "sperret",
      async (p, v) => {
        const row = await rowOnDeviation(p, { outcome: "blocked" });
        return { usageId: row.id, choice: "keep", rowVersion: v.deviation_text };
      },
    ],
    [
      "feil",
      async (p, v) => {
        const row = await rowOnDeviation(p, { outcome: "error", errorCode: "timeout" });
        return { usageId: row.id, choice: "keep", rowVersion: v.deviation_text };
      },
    ],
    [
      "summary_draft",
      async (p, v) => {
        const row = await rowOnDeviation(p, {
          feature: "summary_draft",
          promptVersion: "summary_draft.v1",
          targetRef: { type: "report", id: p.reportId, fieldKey: "summary_text" },
        });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
    [
      "phrase_suggest",
      async (p, v) => {
        const row = await rowOnDeviation(p, {
          feature: "phrase_suggest",
          promptVersion: "phrase_suggest.v1",
          targetRef: { type: "deviation", id: p.deviationId, fieldKey: "cause_text" },
          outputText: null,
        });
        return { usageId: row.id, choice: "keep", rowVersion: v.deviation_text };
      },
    ],
    [
      "mål utenfor rommet",
      async (p, v) => {
        const other = await startedBathroom({ organizationId: p.organizationId });
        const deviationId = await addPlaceDeviation(other, PLACE.membraneTg2);
        const row = await rowOnDeviation(p, {
          targetRef: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
        });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
    [
      "annen rapport (A470)",
      async (p, v) => {
        const other = await startedBathroom({ organizationId: p.organizationId });
        const row = await rowOnDeviation(p, {
          reportId: other.reportId,
          assignmentId: other.assignmentId,
        });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
    [
      "mykt slettet loggrad",
      async (p, v) => {
        await db
          .update(aiUsageLog)
          .set({ deletedAt: new Date(), deletedBy: p.employeeId })
          .where(eq(aiUsageLog.id, p.usage.consequence_text));
        return choice(p, v, "consequence_text", "use");
      },
    ],
    [
      "mykt slettet mål",
      async (p, v) => {
        await db
          .update(deviationMeasures)
          .set({ deletedAt: new Date(), deletedBy: p.employeeId })
          .where(eq(deviationMeasures.id, p.measureId));
        return choice(p, v, "measure", "use");
      },
    ],
    [
      "felt som KI ikke skriver i (svar på felt)",
      async (p, v) => {
        const row = await rowOnDeviation(p, {
          targetRef: { type: "field_answer", id: uuidv7(), fieldKey: "text" },
        });
        return { usageId: row.id, choice: "use", rowVersion: v.deviation_text };
      },
    ],
  ];

  it.each(CASES)("%s: ingen tekst og ingen beslutning endret, intet KI-kall", async (_n, bad) => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    const badChoice = await bad(p, v);
    const before = await state(p);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const error = await captureError(() =>
      applyReviewedTexts(p.actor, p.organizationId, p.room, {
        choices: [choice(p, v, "cause_text", "use"), choice(p, v, "description", "use"), badChoice],
      }),
    );
    expect(error instanceof AccessDeniedError || error instanceof ReportValidationError).toBe(true);
    expect(await state(p)).toBe(before);
    expect(spy).not.toHaveBeenCalled();
  });
});

// --- Endret av andre, én transaksjon, publisert, TG og revisjonslogg ----------------------------

describe("GT3.30–GT3.34", () => {
  it("GT3.30 felt på en rad som er endret etter gjennomgangen hoppes over; de andre lagres", async () => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    // En kollega endrer avviket (konsekvensen) etter gjennomgangen
    await saveField(p.actor, p.organizationId, p.room, {
      table: "deviations",
      id: p.deviationId,
      field: "consequence_text",
      value: "mxq kollega",
      base: TEXTS.consequence_text,
    });
    const result = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [choice(p, v, "cause_text", "use"), choice(p, v, "measure", "use")],
    });
    expect(result.skippedChanged).toEqual([
      { usageId: p.usage.cause_text, fieldLabel: expect.stringContaining("Årsak") },
    ]);
    expect(result.saved.map((s) => s.usageId)).toEqual([p.usage.measure]);
    const d = await deviationRow(p.deviationId);
    expect(d.causeText).toBe(TEXTS.cause_text);
    expect(d.consequenceText).toBe("mxq kollega");
    expect((await aiRow(p.usage.cause_text))?.status).toBe("suggested");
    expect((await measureRow(p.measureId)).text).toBe(p.suggestion.measure);
  });

  it("GT3.30 avvik, årsak og konsekvens på samme rad i samme liste lagres alle tre", async () => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    const result = await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        choice(p, v, "deviation_text", "use"),
        choice(p, v, "cause_text", "edit", "Mxq rettet årsak."),
        choice(p, v, "consequence_text", "use"),
      ],
    });
    expect(result.skippedChanged).toEqual([]);
    expect(result.saved).toHaveLength(3);
    const d = await deviationRow(p.deviationId);
    expect([d.deviationText, d.causeText, d.consequenceText]).toEqual([
      p.suggestion.deviation_text,
      "Mxq rettet årsak.",
      p.suggestion.consequence_text,
    ]);
    expect(d.rowVersion).toBe(v.deviation_text + 1);
    expect(new Set(result.saved.map((s) => s.rowVersion))).toEqual(new Set([d.rowVersion]));
  });

  it("GT3.31 feil i beslutning nummer to gir ingen delvis lagring", async () => {
    const p = await reviewed(await kiBathroom());
    const before = await state(p);
    failDecision.calls = 0;
    failDecision.onCall = 2;
    await expect(useAll(p)).rejects.toThrow();
    failDecision.onCall = 0;
    expect(await state(p)).toBe(before);
  });

  it("GT3.32 rapporten publisert i mellomtiden: hele listen avvises med publisert-meldingen", async () => {
    const p = await reviewed(await kiBathroom());
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, p.reportId));
    const before = await state(p);
    const error = await captureError(() => useAll(p));
    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as ReportValidationError).code).toBe("report_published");
    expect(error.message).toBe(REPORT_PUBLISHED_MESSAGE);
    expect(await state(p)).toBe(before);
  });

  it("GT3.33 TG er lik før og etter «Bruk alle» og etter angre", async () => {
    const p = await reviewed(await kiBathroom());
    const tgs = async () =>
      JSON.stringify({
        deviations: await db
          .select({ id: deviations.id, tg: deviations.tg })
          .from(deviations)
          .where(eq(deviations.reportId, p.reportId))
          .orderBy(deviations.id),
        results: await db
          .select({ id: checkpointResults.id, tgDirect: checkpointResults.tgDirect })
          .from(checkpointResults)
          .where(eq(checkpointResults.reportId, p.reportId))
          .orderBy(checkpointResults.id),
      });
    const before = await tgs();
    const used = await useAll(p);
    expect(await tgs()).toBe(before);
    await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        {
          usageId: p.usage.cause_text,
          choice: "undo",
          text: TEXTS.cause_text,
          rowVersion: used.saved[1]!.rowVersion,
        },
      ],
    });
    expect(await tgs()).toBe(before);
  });

  it("GT3.34 revisjonsloggen får én linje per valg, uten tekst", async () => {
    const p = await reviewed(await kiBathroom());
    const v = await versions(p);
    await applyReviewedTexts(p.actor, p.organizationId, p.room, {
      choices: [
        choice(p, v, "cause_text", "use"),
        choice(p, v, "consequence_text", "edit", "Mxq egen konsekvens."),
        choice(p, v, "description", "keep"),
      ],
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "ai_review"));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => (r.changes as { aiUsageId: string }).aiUsageId).sort()).toEqual(
      [p.usage.cause_text, p.usage.consequence_text, p.usage.description].sort(),
    );
    const all = JSON.stringify(await db.select().from(auditLog));
    for (const text of [
      ...Object.values(TEXTS),
      ...Object.values(p.suggestion),
      "Mxq egen konsekvens.",
      "mxq@eksempel.no",
    ]) {
      expect(all).not.toContain(text);
    }
  });
});
