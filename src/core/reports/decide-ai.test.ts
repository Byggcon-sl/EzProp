import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { applyPhrase, decideAiText, ReportValidationError, suggestPhrases } from "@/core/reports";
import { db } from "@/db/client";
import { deviations, reports } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRow, captureError } from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import {
  addPlaceDeviation,
  kiBathroom,
  PLACE,
  type KiBathroom,
} from "../../../tests/report-ki-fixtures";
import { startedBathroom } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * «Behold min», «Lukk» og «Angre» på et KI-forslag (gjennomgangen av KI i veien): tilgangen og
 * rapporten under arbeid gir `withRoomWrite`, og `usageId` må høre til rapporten og et mål i
 * rommet. Falsk leverandør og oppdiktede verdier.
 *
 * Støtter hovedmål: KI i bunnen (beslutningen logges på riktig forslag) og færre reklamasjoner
 * (et forslag i en annen eller ferdig rapport kan ikke endres herfra).
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

/** Et språkvaskforslag på avviket i rommet, slik kjernen lagrer det. */
async function polishRow(f: KiBathroom, deviationId: string) {
  return createAiUsageLog(f.organizationId, {
    feature: "language_polish",
    assignmentId: f.assignmentId,
    reportId: f.reportId,
    targetRef: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
  });
}

async function snapshot(id: string) {
  return JSON.stringify(await aiRow(id));
}

describe("decideAiText", () => {
  it("språkvask: «Behold min» gir rejected, «Angre» gir suggested", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const row = await polishRow(f, deviationId);

    const rejected = await decideAiText(f.actor, f.organizationId, f.room, {
      usageId: row.id,
      decision: "rejected",
    });
    expect(rejected).toEqual({ status: "saved" });
    expect((await aiRow(row.id))?.status).toBe("rejected");

    await decideAiText(f.actor, f.organizationId, f.room, { usageId: row.id, decision: "undo" });
    expect((await aiRow(row.id))?.status).toBe("suggested");
  });

  it("fraseforslag: «Lukk» gir rejected", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const ranked = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "cause_text",
      text: "",
    });
    if (ranked.status !== "ranked") throw new Error(`fikk ${ranked.status}`);
    await decideAiText(f.actor, f.organizationId, f.room, {
      usageId: ranked.usageId,
      decision: "rejected",
    });
    expect((await aiRow(ranked.usageId))?.status).toBe("rejected");
  });

  it("«Angre» etter «Bruk» på et fraseforslag (undo_and_reject) gir rejected", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const [before] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const ranked = await suggestPhrases(f.actor, f.organizationId, f.room, {
      requestId: uuidv7(),
      deviationId,
      field: "cause_text",
      text: "",
    });
    if (ranked.status !== "ranked") throw new Error(`fikk ${ranked.status}`);
    const chosen = ranked.candidates[0];
    if (!chosen) throw new Error("mangler kandidat");
    const applied = await applyPhrase(f.actor, f.organizationId, f.room, {
      usageId: ranked.usageId,
      candidate: chosen.ref,
      base: before?.causeText ?? null,
    });
    expect(applied.status).toBe("saved");
    expect((await aiRow(ranked.usageId))?.status).toBe("accepted");

    await decideAiText(f.actor, f.organizationId, f.room, {
      usageId: ranked.usageId,
      decision: "undo_and_reject",
    });

    const row = await aiRow(ranked.usageId);
    expect(row?.status).toBe("rejected");
    expect(row?.chosen_candidate).toBeNull();
  });

  it("sammendrag: forslaget for rapporten kan avvises fra rommet", async () => {
    const f = await kiBathroom();
    const row = await createAiUsageLog(f.organizationId, {
      feature: "summary_draft",
      promptVersion: "summary_draft.v1",
      assignmentId: f.assignmentId,
      reportId: f.reportId,
      targetRef: { type: "report", id: f.reportId, fieldKey: "summary_text" },
    });
    await decideAiText(f.actor, f.organizationId, f.room, {
      usageId: row.id,
      decision: "rejected",
    });
    expect((await aiRow(row.id))?.status).toBe("rejected");
  });

  it("usageId fra en annen rapport i samme organisasjon gir 404, og raden er uendret", async () => {
    const f = await kiBathroom();
    const other = await startedBathroom({ organizationId: f.organizationId });
    const otherDeviation = await addPlaceDeviation(other, PLACE.membraneTg2);
    const row = await polishRow(other as KiBathroom, otherDeviation);
    const before = await snapshot(row.id);

    const error = await captureError(() =>
      decideAiText(f.actor, f.organizationId, f.room, { usageId: row.id, decision: "rejected" }),
    );

    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await snapshot(row.id)).toBe(before);
  });

  it("riktig rapport, men målet er ikke i rommet: 404, og raden er uendret", async () => {
    const f = await kiBathroom();
    const row = await createAiUsageLog(f.organizationId, {
      feature: "language_polish",
      reportId: f.reportId,
      targetRef: { type: "deviation", id: uuidv7(), fieldKey: "cause_text" },
    });
    const wrongFeature = await createAiUsageLog(f.organizationId, {
      feature: "phrase_suggest",
      promptVersion: "phrase_suggest.v1",
      outputText: null,
      reportId: f.reportId,
      targetRef: { type: "report", id: f.reportId, fieldKey: "summary_text" },
    });
    for (const usageId of [row.id, wrongFeature.id]) {
      const before = await snapshot(usageId);
      const error = await captureError(() =>
        decideAiText(f.actor, f.organizationId, f.room, { usageId, decision: "rejected" }),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await snapshot(usageId)).toBe(before);
    }
  });

  it("ferdig (publisert) rapport gir avslag, og raden er uendret", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const row = await polishRow(f, deviationId);
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, f.reportId));
    const before = await snapshot(row.id);

    const error = await captureError(() =>
      decideAiText(f.actor, f.organizationId, f.room, { usageId: row.id, decision: "rejected" }),
    );

    expect(error).toBeInstanceOf(ReportValidationError);
    expect((error as ReportValidationError).code).toBe("report_not_editable");
    expect(await snapshot(row.id)).toBe(before);
  });

  it("ugyldig beslutning (accepted) avvises av skjemaet, og raden er uendret", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const row = await polishRow(f, deviationId);
    const before = await snapshot(row.id);
    const error = await captureError(() =>
      decideAiText(f.actor, f.organizationId, f.room, {
        usageId: row.id,
        decision: "accepted" as "rejected",
      }),
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect(await snapshot(row.id)).toBe(before);
  });

  it("en annen organisasjon får verken rader eller tilgang", async () => {
    const byOrg = new Map<string, { f: KiBathroom; usageId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await kiBathroom({ organizationId: grant.organizationId });
          const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
          const row = await polishRow(f, deviationId);
          byOrg.set(grant.organizationId, { f, usageId: row.id });
          ids[side].push(row.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const own = byOrg.get(grant.organizationId);
        if (!own) throw new Error("mangler oppsett");
        await decideAiText(actor, organizationId, own.f.room, {
          usageId: own.usageId,
          decision: "rejected",
        });
        return (await db.execute(
          sql`select id from ai_usage_log where organization_id = ${grant.organizationId} and status = 'rejected'`,
        )) as unknown as { id: string }[];
      },
      idOf: (row) => row.id,
    });
    // A sitt rom med B sin usageId gir 404, og B sin rad er uendret
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    const before = await snapshot(b.usageId);
    const error = await captureError(() =>
      decideAiText(a.f.actor, a.f.organizationId, a.f.room, {
        usageId: b.usageId,
        decision: "undo",
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await snapshot(b.usageId)).toBe(before);
  });
});
