import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/core/access";
import {
  fakeAiProvider,
  FAKE_ADD_TG_INPUT,
  FAKE_DROP_FINDING_INPUT,
} from "@/core/ai/providers/fake";
import {
  draftSummary,
  getReportSummary,
  removeDeviation,
  ReportValidationError,
  saveField,
  saveSummary,
  setCheckpointDone,
  setTgDirect,
} from "@/core/reports";
import { SUMMARY_GROUP_HEADINGS } from "@/core/reports/logic";
import { db } from "@/db/client";
import { auditLog, deviations, reports, REPORT_SUMMARY_BASIS_MAX } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRow, aiRowCount, captureError } from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import {
  addPlaceDeviation,
  countQueries,
  kiBathroom,
  PLACE,
  type KiBathroom,
} from "../../../tests/report-ki-fixtures";
import { CP, startedBathroom } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Sammendraget for hele rapporten (docs/funksjoner/fase2a-ki-i-veien-testplan.md 4c:
 * K4.12–K4.17c, K4.21b, K5.9–K5.11). Falsk leverandør, oppdiktede tekster.
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const NAMES = {
  membrane: "Vanntett sjikt, membran og sluk",
  fixtures: "Sanitærutstyr og innredning",
  ventilation: "Ventilasjon",
  floor: "Overflater gulv",
};

/** TG3 på sjikt, TG2 på innredning, HMS, TGIU på gulvet og ett avvik uten valgt TG. */
async function fullReport(f: KiBathroom) {
  const tg3 = await addPlaceDeviation(f, PLACE.membraneTg3);
  const tg2 = await addPlaceDeviation(f, PLACE.furnitureTg2);
  const hms = await addPlaceDeviation(f, PLACE.overheatingHms);
  const noTg = await addPlaceDeviation(f, PLACE.adjacentChoose);
  await setTgDirect(f.actor, f.organizationId, f.room, {
    checkpointKey: CP.floor,
    tgDirect: "IU",
    base: null,
  });
  await saveField(f.actor, f.organizationId, f.room, {
    table: "tgiu_details",
    checkpointKey: CP.floor,
    field: "reason",
    value: "Mxq eier ga ikke lov til å fjerne lister",
    base: null,
  });
  return { tg3, tg2, hms, noTg };
}

async function summaryOf(f: KiBathroom) {
  const summary = await getReportSummary(f.actor, f.organizationId, f.assignmentId);
  if (!summary) throw new Error("mangler sammendrag");
  return summary;
}

async function draftOf(f: KiBathroom) {
  const result = await draftSummary(f.actor, f.organizationId, f.assignmentId, {
    requestId: uuidv7(),
  });
  if (result.status !== "suggestion") throw new Error(`fikk ${result.status}`);
  return result;
}

async function reportRow(f: KiBathroom) {
  const [row] = await db.select().from(reports).where(eq(reports.id, f.reportId));
  if (!row) throw new Error("mangler rapport");
  return row;
}

describe("4c utkast til sammendrag", () => {
  it("K4.12 kodens overskrifter i rekkefølgen TG3, TG2, TGIU, HMS; summary_text er uendret", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const draft = await draftOf(f);
    const at = (text: string) => draft.text.indexOf(text);
    expect(at(SUMMARY_GROUP_HEADINGS.tg3)).toBe(0);
    expect(at(SUMMARY_GROUP_HEADINGS.tg2)).toBeGreaterThan(at(SUMMARY_GROUP_HEADINGS.tg3));
    expect(at(SUMMARY_GROUP_HEADINGS.tgiu)).toBeGreaterThan(at(SUMMARY_GROUP_HEADINGS.tg2));
    expect(at(SUMMARY_GROUP_HEADINGS.hms)).toBeGreaterThan(at(SUMMARY_GROUP_HEADINGS.tgiu));
    expect(draft.text).toContain(`${NAMES.floor}: Mxq eier ga ikke lov til å fjerne lister`);
    expect(draft.text).toContain(`${NAMES.membrane}:`);
    expect(draft.basis.map((b) => b.group)).toEqual(["tg3", "tg2", "tgiu", "hms"]);
    expect(draft.missingTgCount).toBe(1);
    expect(draft.usageId).not.toBeNull();
    expect(await aiRow(draft.usageId ?? "")).toMatchObject({
      feature: "summary_draft",
      report_id: f.reportId,
      target_ref: { type: "report", id: f.reportId, fieldKey: "summary_text" },
    });
    expect((await reportRow(f)).summaryText).toBeNull();
  });

  it("K4.15 ingen godkjente funn: intet kall og ingen rad", async () => {
    const f = await kiBathroom();
    await addPlaceDeviation(f, PLACE.adjacentChoose);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await draftSummary(f.actor, f.organizationId, f.assignmentId, {
      requestId: uuidv7(),
    });
    expect(result).toEqual({ status: "no_findings", missingTgCount: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect((await summaryOf(f)).findingCount).toBe(0);
  });

  it("A462 bare TGIU-funn: koden skriver utkastet, KI kalles ikke", async () => {
    const f = await kiBathroom();
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.floor,
      tgDirect: "IU",
      base: null,
    });
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const draft = await draftOf(f);
    expect(draft.usageId).toBeNull();
    expect(draft.text).toBe(`${SUMMARY_GROUP_HEADINGS.tgiu}\n${NAMES.floor}`);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    const saved = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: draft.text,
      baseRowVersion: (await summaryOf(f)).rowVersion,
      draft: { usageId: null, basis: draft.basis, edited: false },
    });
    expect(saved.status).toBe("saved");
    expect((await reportRow(f)).summaryBasis).toEqual(draft.basis);
  });

  it("K4.17 byttet TG eller manglende funn stopper hele utkastet; summary_text er uendret", async () => {
    const f = await kiBathroom();
    const { tg2 } = await fullReport(f);
    const [row] = await db.select().from(deviations).where(eq(deviations.id, tg2));
    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id: tg2,
      field: "cause_text",
      value: `Mxq årsak ${FAKE_ADD_TG_INPUT}`,
      base: row?.causeText ?? null,
    });
    const tg = await draftSummary(f.actor, f.organizationId, f.assignmentId, {
      requestId: uuidv7(),
    });
    expect(tg).toEqual({ status: "stopped", guard: "tg_guard" });

    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id: tg2,
      field: "cause_text",
      value: `Mxq årsak ${FAKE_DROP_FINDING_INPUT}`,
      base: `Mxq årsak ${FAKE_ADD_TG_INPUT}`,
    });
    const coverage = await draftSummary(f.actor, f.organizationId, f.assignmentId, {
      requestId: uuidv7(),
    });
    expect(coverage).toEqual({ status: "stopped", guard: "coverage_guard" });
    expect((await reportRow(f)).summaryText).toBeNull();
  });

  it("K4.17c «N avvik mangler TG» gis ved utkast, uten sperre", async () => {
    const f = await kiBathroom();
    await addPlaceDeviation(f, PLACE.membraneTg3);
    await addPlaceDeviation(f, PLACE.adjacentChoose);
    const draft = await draftOf(f);
    expect(draft.missingTgCount).toBe(1);
    expect((await summaryOf(f)).missingTgCount).toBe(1);
  });
});

describe("4c lagring og advarsler", () => {
  it("K4.13 «Bruk» lagrer tekst og grunnlag, og beslutningen; konflikt gir nyeste verdi", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const draft = await draftOf(f);
    const before = await summaryOf(f);
    const saved = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: draft.text,
      baseRowVersion: before.rowVersion,
      draft: { usageId: draft.usageId, basis: draft.basis, edited: false },
    });
    if (saved.status !== "saved") throw new Error(`fikk ${saved.status}`);
    expect(saved.summary.text).toBe(draft.text);
    expect(saved.summary.rowVersion).toBe(before.rowVersion + 1);
    expect(saved.summary.changedSinceDraft).toBeNull();
    expect(saved.summary.uncovered).toEqual([]);
    expect((await reportRow(f)).summaryBasis).toEqual(draft.basis);
    expect((await aiRow(draft.usageId ?? ""))?.status).toBe("accepted");

    const conflict = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: "Mxq annen tekst",
      baseRowVersion: before.rowVersion,
    });
    expect(conflict).toMatchObject({ status: "conflict", summary: { text: draft.text } });
    expect((await reportRow(f)).summaryText).toBe(draft.text);
  });

  it("K4.13 endret utkast registreres som edited; skrevet for hånd rører ikke grunnlaget", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const draft = await draftOf(f);
    const saved = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: `${draft.text}\nMxq tillegg`,
      baseRowVersion: (await summaryOf(f)).rowVersion,
      draft: { usageId: draft.usageId, basis: draft.basis, edited: true },
    });
    if (saved.status !== "saved") throw new Error(`fikk ${saved.status}`);
    expect((await aiRow(draft.usageId ?? ""))?.status).toBe("edited");
    const manual = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: "Mxq skrevet for hånd",
      baseRowVersion: saved.summary.rowVersion,
    });
    expect(manual.status).toBe("saved");
    expect((await reportRow(f)).summaryBasis).toEqual(draft.basis);
    const cleared = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: "",
      baseRowVersion: saved.summary.rowVersion + 1,
    });
    expect(cleared.status).toBe("saved");
    const row = await reportRow(f);
    expect(row.summaryText).toBeNull();
    expect(row.summaryBasis).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("K4.13 bare i draft: publisert rapport gir avslag", async () => {
    const f = await kiBathroom();
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, f.reportId));
    const error = await captureError(() =>
      saveSummary(f.actor, f.organizationId, f.assignmentId, { text: "Mxq", baseRowVersion: 1 }),
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as ReportValidationError).code).toBe("report_not_editable");
    const draft = await captureError(() =>
      draftSummary(f.actor, f.organizationId, f.assignmentId, { requestId: uuidv7() }),
    );
    expect((draft as ReportValidationError).code).toBe("report_not_editable");
  });

  it("K4.14 revisjonsloggen har feltkoden summary_text og aldri teksten", async () => {
    const f = await kiBathroom();
    const marker = "Mxq-merke-ÆØ sammendrag";
    await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: marker,
      baseRowVersion: (await summaryOf(f)).rowVersion,
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, f.reportId));
    const summaryRows = rows.filter(
      (r) => (r.changes as Record<string, unknown>).field === "summary_text",
    );
    expect(summaryRows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("Mxq-merke-ÆØ");
  });

  it("K1.26 inndatakontroll: plassholder, elleve sifre og for lang tekst avvises", async () => {
    const f = await kiBathroom();
    const base = (await summaryOf(f)).rowVersion;
    for (const [text, code] of [
      ["Mxq [adresse]", "text_has_placeholder"],
      ["Mxq 010190 12345", "invalid_input"],
      ["x".repeat(10_001), "invalid_input"],
    ] as const) {
      const error = await captureError(() =>
        saveSummary(f.actor, f.organizationId, f.assignmentId, { text, baseRowVersion: base }),
      );
      expect((error as ReportValidationError).code).toBe(code);
    }
    expect((await reportRow(f)).summaryText).toBeNull();
  });

  it("K4.16 endret TG, nytt funn og fjernet funn gir advarsel; ingen sperre", async () => {
    const f = await kiBathroom();
    const { tg2, hms } = await fullReport(f);
    const draft = await draftOf(f);
    const saved = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: draft.text,
      baseRowVersion: (await summaryOf(f)).rowVersion,
      draft: { usageId: draft.usageId, basis: draft.basis, edited: false },
    });
    expect(saved.status).toBe("saved");

    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id: tg2,
      field: "tg",
      value: 3,
      base: 2,
    });
    const added = await addPlaceDeviation(f, PLACE.ventilationTg3);
    await removeDeviation(f.actor, f.organizationId, f.room, hms);
    const summary = await summaryOf(f);
    expect(summary.changedSinceDraft?.added.map((x) => x.id)).toEqual([added]);
    expect(summary.changedSinceDraft?.changed.map((x) => x.id)).toEqual([tg2]);
    expect(summary.changedSinceDraft?.changed[0]?.group).toBe("tg3");
    expect(summary.changedSinceDraft?.removedCount).toBe(1);
    // Ventilasjon (TG3) står ikke i teksten
    expect(summary.uncovered.map((x) => x.checkpointName)).toEqual([NAMES.ventilation]);

    const done = await setCheckpointDone(f.actor, f.organizationId, f.room, {
      checkpointKey: PLACE.furnitureTg2.checkpointKey,
      done: true,
    });
    expect(done.status).toBe("saved");
  });

  it("K4.17a grunnlaget fra nettleseren kontrolleres strengt", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const other = await startedBathroom({ organizationId: f.organizationId });
    const otherDeviation = await addPlaceDeviation(other, PLACE.membraneTg3);
    const draft = await draftOf(f);
    const base = (await summaryOf(f)).rowVersion;
    const first = draft.basis[0];
    if (!first) throw new Error("mangler grunnlag");
    const bad: unknown[] = [
      [{ ...first, extra: 1 }],
      [{ ...first, text: "Mxq" }],
      [{ ...first, id: otherDeviation }],
      [{ ...first, rowVersion: first.rowVersion + 1 }],
      Array.from({ length: REPORT_SUMMARY_BASIS_MAX + 1 }, () => first),
      [first, first],
    ];
    for (const basis of bad) {
      const error = await captureError(() =>
        saveSummary(f.actor, f.organizationId, f.assignmentId, {
          text: draft.text,
          baseRowVersion: base,
          draft: { usageId: draft.usageId, basis, edited: false } as never,
        }),
      );
      expect(error).toBeInstanceOf(ReportValidationError);
    }
    expect((await reportRow(f)).summaryText).toBeNull();
    expect((await aiRow(draft.usageId ?? ""))?.status).toBe("suggested");

    // Gruppen fra nettleseren overstyres av serveren
    const saved = await saveSummary(f.actor, f.organizationId, f.assignmentId, {
      text: draft.text,
      baseRowVersion: base,
      draft: {
        usageId: draft.usageId,
        basis: draft.basis.map((b) => ({ ...b, group: "hms" as const })),
        edited: false,
      },
    });
    expect(saved.status).toBe("saved");
    expect((await reportRow(f)).summaryBasis).toEqual(draft.basis);
  });

  it("K4.17a usageId med feil funksjon eller annen rapport gir 404 og røres ikke", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const other = await startedBathroom({ organizationId: f.organizationId });
    const draft = await draftOf(f);
    const base = (await summaryOf(f)).rowVersion;
    const polish = await createAiUsageLog(f.organizationId, {
      reportId: f.reportId,
      targetRef: { type: "report", id: f.reportId, fieldKey: "summary_text" },
    });
    const otherReport = await createAiUsageLog(f.organizationId, {
      feature: "summary_draft",
      promptVersion: "summary_draft.v1",
      reportId: other.reportId,
      targetRef: { type: "report", id: other.reportId, fieldKey: "summary_text" },
    });
    for (const usageId of [polish.id, otherReport.id]) {
      const error = await captureError(() =>
        saveSummary(f.actor, f.organizationId, f.assignmentId, {
          text: draft.text,
          baseRowVersion: base,
          draft: { usageId, basis: draft.basis, edited: false },
        }),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect((await aiRow(usageId))?.status).toBe("suggested");
    }
    expect((await reportRow(f)).summaryText).toBeNull();
  });

  it("K4.17b feiler beslutningen, er teksten ikke lagret", async () => {
    const f = await kiBathroom();
    await fullReport(f);
    const draft = await draftOf(f);
    const stopped = await createAiUsageLog(f.organizationId, {
      feature: "summary_draft",
      promptVersion: "summary_draft.v1",
      reportId: f.reportId,
      assignmentId: f.assignmentId,
      targetRef: { type: "report", id: f.reportId, fieldKey: "summary_text" },
      outcome: "stopped",
      errorCode: "tg_guard",
      outputText: null,
      status: null,
    });
    const base = (await summaryOf(f)).rowVersion;
    const error = await captureError(() =>
      saveSummary(f.actor, f.organizationId, f.assignmentId, {
        text: draft.text,
        baseRowVersion: base,
        draft: { usageId: stopped.id, basis: draft.basis, edited: false },
      }),
    );
    expect(error).toBeInstanceOf(Error);
    const row = await reportRow(f);
    expect(row.summaryText).toBeNull();
    expect(row.summaryBasis).toBeNull();
  });
});

describe("5b tenant-isolasjon og ytelse", () => {
  async function seedReport(organizationId: string) {
    const f = await startedBathroom({ organizationId });
    const id = await addPlaceDeviation(f, PLACE.membraneTg3);
    return { f, id };
  }

  it("K5.9/K5.10 funnene og lesingen av sammendraget: en annen organisasjon får verken rader eller tilgang", async () => {
    const assignments = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedReport(grantA.organizationId);
        const b = await seedReport(grantB.organizationId);
        for (const { f } of [a, b]) {
          assignments.set(f.organizationId, f.assignmentId);
          await saveSummary(f.actor, f.organizationId, f.assignmentId, {
            text: "Mxq sammendrag uten punktnavn",
            baseRowVersion: (await summaryOf(f as KiBathroom)).rowVersion,
          });
        }
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const summary = await getReportSummary(
          actor,
          organizationId,
          assignments.get(organizationId) ?? uuidv7(),
        );
        return summary?.uncovered ?? [];
      },
      idOf: (row) => row.id,
    });
  });

  it("K5.10/K5.11 lagring: B kan ikke lese eller skrive A sin rapport, og A sin rad er uendret", async () => {
    const assignments = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const { f } = await seedReport(grant.organizationId);
          assignments.set(f.organizationId, f.assignmentId);
          ids[side].push(f.reportId);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignments.get(organizationId) ?? uuidv7();
        const current = await getReportSummary(actor, organizationId, assignmentId);
        const saved = await saveSummary(actor, organizationId, assignmentId, {
          text: "Mxq",
          baseRowVersion: current?.rowVersion ?? 1,
        });
        return [saved.summary];
      },
      idOf: (row) => row.reportId,
    });

    const a = await kiBathroom();
    const b = await kiBathroom();
    await saveSummary(a.actor, a.organizationId, a.assignmentId, {
      text: "Mxq A",
      baseRowVersion: 1,
    });
    for (const call of [
      () =>
        saveSummary(b.actor, b.organizationId, a.assignmentId, { text: "B", baseRowVersion: 2 }),
      () =>
        saveSummary(b.actor, a.organizationId, a.assignmentId, { text: "B", baseRowVersion: 2 }),
      () => getReportSummary(b.actor, b.organizationId, a.assignmentId),
      () => draftSummary(b.actor, b.organizationId, a.assignmentId, { requestId: uuidv7() }),
    ]) {
      expect(await captureError(call)).toBeInstanceOf(AccessDeniedError);
    }
    expect((await reportRow(a)).summaryText).toBe("Mxq A");
  });

  it("draftSummary: en annen organisasjon får verken utkast, tilgang eller rad i ai_usage_log", async () => {
    const byOrg = new Map<string, KiBathroom>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await kiBathroom({ organizationId: grant.organizationId });
          await addPlaceDeviation(f, PLACE.membraneTg3);
          byOrg.set(grant.organizationId, f);
          ids[side].push(f.reportId);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const assignmentId = byOrg.get(organizationId)?.assignmentId ?? uuidv7();
        const result = await draftSummary(actor, organizationId, assignmentId, {
          requestId: uuidv7(),
        });
        if (result.status !== "suggestion" || !result.usageId) {
          throw new Error(`fikk ${result.status}`);
        }
        const row = await aiRow(result.usageId);
        return [{ reportId: String(row?.report_id) }];
      },
      idOf: (row) => row.reportId,
    });
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    const before = await aiRowCount();
    for (const call of [
      () => draftSummary(a.actor, b.organizationId, b.assignmentId, { requestId: uuidv7() }),
      () => draftSummary(a.actor, a.organizationId, b.assignmentId, { requestId: uuidv7() }),
      () => draftSummary(b.actor, b.organizationId, a.assignmentId, { requestId: uuidv7() }),
    ]) {
      expect(await captureError(call)).toBeInstanceOf(AccessDeniedError);
    }
    expect(await aiRowCount()).toBe(before);
  });

  it("K4.21b funnene til sammendraget har fast antall spørringer", async () => {
    const small = await kiBathroom();
    await addPlaceDeviation(small, PLACE.membraneTg3);
    const big = await kiBathroom();
    for (const place of Object.values(PLACE)) {
      await addPlaceDeviation(big, place, place.outcomeKey === "choose" ? 2 : null);
    }
    const smallCount = await countQueries(() =>
      getReportSummary(small.actor, small.organizationId, small.assignmentId),
    );
    const bigCount = await countQueries(() =>
      getReportSummary(big.actor, big.organizationId, big.assignmentId),
    );
    expect(bigCount).toBe(smallCount);
  });
});
