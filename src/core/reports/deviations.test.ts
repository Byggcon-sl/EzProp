import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  removeDeviation,
  removeMeasure,
  ReportValidationError,
  restoreDeviation,
  saveField,
  setCheckpointDone,
  setTgDirect,
} from "@/core/reports";
import { MAX_DEVIATIONS_PER_CHECKPOINT, MAX_MEASURES_PER_DEVIATION } from "@/core/reports/logic";
import { db } from "@/db/client";
import { checkpointResults, deviationMeasures, deviations, tgiuDetails } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../tests/factories";
import {
  answer,
  answerHole,
  checkpointOf,
  CP,
  RULE,
  startedBathroom,
  startedView,
} from "../../../tests/report-fixtures";

/*
 * Avvik, tiltak, TGIU og «Ferdig med punktet» (docs/funksjoner/fase2a-badet-pc-testplan.md 4d og
 * B4.35). Fjerning er myk, og Angre gir samme rad tilbake.
 */

beforeEach(resetDatabase);

type F = Awaited<ReturnType<typeof startedBathroom>>;

const TG2_FIXTURES = {
  checkpointKey: "wet_room.fixtures",
  questionKey: "wet_room.fixtures.damaged_furniture",
  outcomeKey: "tg2",
};
const TG3_VENTILATION = {
  checkpointKey: "wet_room.ventilation",
  questionKey: "wet_room.ventilation.missing_ventilation",
  outcomeKey: "tg3",
};

async function add(f: F, place = TG2_FIXTURES, id = uuidv7()) {
  const result = await addDeviation(f.actor, f.organizationId, f.room, { id, ...place, tg: null });
  expect(result.status).toBe("saved");
  return id;
}

async function measuresOf(deviationId: string) {
  return db.select().from(deviationMeasures).where(eq(deviationMeasures.deviationId, deviationId));
}

describe("4d avvik, tiltak, TGIU og ferdig", () => {
  it("B4.22 avvik og tiltak fjernes mykt og telles ikke; Angre gir samme rad og tiltakene tilbake", async () => {
    const f = await startedBathroom();
    const deviationId = await add(f);
    const extraId = uuidv7();
    await addMeasure(f.actor, f.organizationId, f.room, { id: extraId, deviationId });
    const removedBeforeId = uuidv7();
    await addMeasure(f.actor, f.organizationId, f.room, { id: removedBeforeId, deviationId });
    await removeMeasure(f.actor, f.organizationId, f.room, removedBeforeId);
    const before = await db.select().from(deviations).where(eq(deviations.id, deviationId));

    const removed = await removeDeviation(f.actor, f.organizationId, f.room, deviationId);
    expect(removed.status).toBe("saved");
    const fixtures = checkpointOf(await startedView(f), TG2_FIXTURES.checkpointKey);
    expect(fixtures.deviations).toEqual([]);
    expect(fixtures.tg).toBeNull();
    expect(fixtures.warnings).toEqual([]);
    const [deleted] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    expect(deleted?.deletedAt).not.toBeNull();
    const measures = await measuresOf(deviationId);
    expect(measures.every((m) => m.deletedAt !== null)).toBe(true);
    const together = measures.filter((m) => m.id !== removedBeforeId);
    expect(together.every((m) => m.deletedAt?.getTime() === deleted?.deletedAt?.getTime())).toBe(
      true,
    );

    const restored = await restoreDeviation(f.actor, f.organizationId, f.room, { deviationId });
    expect(restored.status).toBe("saved");
    const [back] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    expect(back).toMatchObject({
      ...before[0],
      deletedAt: null,
      deletedBy: null,
      updatedAt: expect.any(Date),
      rowVersion: expect.any(Number),
      updatedBy: expect.anything(),
    });
    const view = checkpointOf(await startedView(f), TG2_FIXTURES.checkpointKey);
    expect(view.deviations.map((d) => d.id)).toEqual([deviationId]);
    const restoredMeasures = view.deviations[0]!.measures.map((m) => m.id);
    expect(restoredMeasures).toContain(extraId);
    expect(restoredMeasures).not.toContain(removedBeforeId);
    expect(view.tg).toBe("2");

    // Et avvik som ikke er slettet: «saved» uten endring
    expect(
      (await restoreDeviation(f.actor, f.organizationId, f.room, { deviationId })).status,
    ).toBe("saved");
  });

  it("B4.22 tak: 50 avvik per punkt og 20 tiltak per avvik gir norsk feilmelding", async () => {
    const f = await startedBathroom();
    const firstId = await add(f);
    const [first] = await db.select().from(deviations).where(eq(deviations.id, firstId));
    const rows = Array.from({ length: MAX_DEVIATIONS_PER_CHECKPOINT - 1 }, (_, i) => ({
      ...first!,
      id: uuidv7(),
      sortOrder: i + 1,
    }));
    await db.insert(deviations).values(rows);
    const error = await addDeviation(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ...TG2_FIXTURES,
      tg: null,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ReportValidationError);
    expect(error.code).toBe("limit_reached");
    expect(error.message).toBe("Punktet har 50 avvik, som er grensen.");

    const existing = (await measuresOf(firstId)).length;
    for (let i = existing; i < MAX_MEASURES_PER_DEVIATION; i += 1) {
      await addMeasure(f.actor, f.organizationId, f.room, { id: uuidv7(), deviationId: firstId });
    }
    const measureError = await addMeasure(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      deviationId: firstId,
    }).catch((e) => e);
    expect(measureError).toBeInstanceOf(ReportValidationError);
    expect(measureError.message).toBe("Avviket har 20 tiltak, som er grensen.");
  });

  it("B4.22 TGIU satt på nytt etter «Fjern TGIU» gir de samme tekstene tilbake", async () => {
    const f = await startedBathroom();
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    await saveField(f.actor, f.organizationId, f.room, {
      table: "tgiu_details",
      checkpointKey: CP.adjacent,
      field: "reason",
      value: "Eier ville ikke ha hull i veggen",
      base: null,
    });
    const [original] = await db
      .select()
      .from(tgiuDetails)
      .where(eq(tgiuDetails.reportId, f.reportId));
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: null,
      base: "IU",
    });
    expect(checkpointOf(await startedView(f), CP.adjacent).tgiuDetails).toBeNull();
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    const details = checkpointOf(await startedView(f), CP.adjacent).tgiuDetails;
    expect(details).toMatchObject({ id: original?.id, reason: "Eier ville ikke ha hull i veggen" });
    const rows = await db.select().from(tgiuDetails).where(eq(tgiuDetails.reportId, f.reportId));
    expect(rows).toHaveLength(1);
  });

  it("B4.23 kostnad: fem intervaller, eget beløp 37 500 med advarsel, ugyldige beløp avvises", async () => {
    const f = await startedBathroom();
    const id = await add(f, TG3_VENTILATION);
    let base = { type: "none" as const, bandKey: null, amount: null } as {
      type: "band" | "approx" | "none";
      bandKey: string | null;
      amount: number | null;
    };
    const { COST_BANDS } = await import("@/core/reports/logic");
    for (const band of COST_BANDS) {
      const value = { type: "band" as const, bandKey: band.key, amount: null };
      const result = await saveField(f.actor, f.organizationId, f.room, {
        table: "deviations",
        id,
        field: "cost",
        value,
        base,
      });
      expect(result.status).toBe("saved");
      base = value;
    }
    const approx = { type: "approx" as const, bandKey: null, amount: 37500 };
    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id,
      field: "cost",
      value: approx,
      base,
    });
    const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
    expect(row).toMatchObject({ costType: "approx", costAmount: 37500, costBandKey: null });
    const ventilation = checkpointOf(await startedView(f), TG3_VENTILATION.checkpointKey);
    expect(ventilation.warnings.map((w) => w.code)).toContain("cost_amount_not_rounded");

    for (const amount of [0, -10000, 12500.5]) {
      const error = await saveField(f.actor, f.organizationId, f.room, {
        table: "deviations",
        id,
        field: "cost",
        value: { type: "approx", bandKey: null, amount },
        base: approx,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(ReportValidationError);
    }
    const unknownBand = await saveField(f.actor, f.organizationId, f.room, {
      table: "deviations",
      id,
      field: "cost",
      value: { type: "band", bandKey: "under_1", amount: null },
      base: approx,
    }).catch((e) => e);
    expect(unknownBand).toBeInstanceOf(ReportValidationError);
  });

  it("B4.24 TGIU-opplysningene lagres; advarselen følger grunnen", async () => {
    const f = await startedBathroom();
    await answerHole(f, "not_done");
    await answer(f, "wet_room.hole_drilling_reason", { optionKeys: ["owner_refused"] });
    await decideSuggestion(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.notDone,
      decision: "accepted",
    });
    const missing = () =>
      startedView(f).then(
        (v) =>
          checkpointOf(v, CP.adjacent).warnings.find((w) => w.code === "tgiu_details_missing")
            ?.missing ?? [],
      );
    expect(await missing()).toContain("owner_informed");
    expect(await missing()).toContain("alternative_check_method");

    const texts = {
      reason: "Eier ga ikke samtykke til hull",
      risk_assessment: "Skjult fukt kan finnes",
      how_to_examine: "Hull må tas med samtykke",
      alternative_check_method: "Overflatemåling",
      alternative_check_result: "Ingen utslag",
    } as const;
    for (const [field, value] of Object.entries(texts)) {
      const result = await saveField(f.actor, f.organizationId, f.room, {
        table: "tgiu_details",
        checkpointKey: CP.adjacent,
        field: field as keyof typeof texts,
        value,
        base: null,
      });
      expect(result.status).toBe("saved");
    }
    await saveField(f.actor, f.organizationId, f.room, {
      table: "tgiu_details",
      checkpointKey: CP.adjacent,
      field: "construction_vulnerable",
      value: "yes",
      base: null,
    });
    expect(await missing()).toEqual(["owner_informed"]);
    await saveField(f.actor, f.organizationId, f.room, {
      table: "tgiu_details",
      checkpointKey: CP.adjacent,
      field: "owner_informed",
      value: true,
      base: null,
    });
    expect(await missing()).toEqual([]);
    const details = checkpointOf(await startedView(f), CP.adjacent).tgiuDetails;
    expect(details).toMatchObject({
      ...{ reason: texts.reason, riskAssessment: texts.risk_assessment },
      ownerInformed: true,
    });
    expect(details?.ownerInformedAt).not.toBeNull();

    // Grunn tom: ingen advarsel om «eier informert»
    const g = await startedBathroom();
    await answerHole(g, "not_done");
    await decideSuggestion(g.actor, g.organizationId, g.room, {
      id: uuidv7(),
      ruleKey: RULE.notDone,
      decision: "accepted",
    });
    const view = await startedView(g);
    const warning = checkpointOf(view, CP.adjacent).warnings.find(
      (w) => w.code === "tgiu_details_missing",
    );
    expect(warning?.missing).not.toContain("owner_informed");
  });

  it("B4.25 «Ferdig med punktet» lagres med hvem og når, også med advarsler", async () => {
    const f = await startedBathroom();
    const result = await setCheckpointDone(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.general,
      done: true,
    });
    expect(result.status).toBe("saved");
    const [row] = await db
      .select()
      .from(checkpointResults)
      .where(and(eq(checkpointResults.reportId, f.reportId), isNull(checkpointResults.deletedAt)));
    expect(row).toMatchObject({ done: true, doneBy: f.employeeId });
    expect(row?.doneAt).toBeInstanceOf(Date);
    if (result.status !== "saved") throw new Error("ikke lagret");
    expect(result.refresh.progress).toEqual({ done: 1, total: 8 });
    expect(checkpointOf(result.refresh, CP.general).warnings.map((w) => w.code)).toContain(
      "checkpoint_done_without_tg",
    );
    // Neste punkt som ikke er ferdig kan finnes fra svaret
    expect(result.refresh.checkpoints.find((c) => !c.done)?.checkpointKey).toBe(CP.documentation);

    await setCheckpointDone(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.general,
      done: false,
    });
    const [undone] = await db
      .select()
      .from(checkpointResults)
      .where(eq(checkpointResults.id, row!.id));
    expect(undone).toMatchObject({ done: false, doneBy: null, doneAt: null });
  });

  it("B4.35 avvik fra søket lages på riktig punkt med malens tekster; annen malversjon og ukjent utfall avvises", async () => {
    const f = await startedBathroom();
    const id = await add(f, TG3_VENTILATION);
    const [row] = await db
      .select({ deviation: deviations, checkpointId: checkpointResults.checkpointId })
      .from(deviations)
      .innerJoin(checkpointResults, eq(checkpointResults.id, deviations.checkpointResultId))
      .where(eq(deviations.id, id));
    const outcome = wetRoomTemplate.outcomes.find(
      (o) => o.question_key === TG3_VENTILATION.questionKey,
    )!;
    expect(row?.deviation).toMatchObject({
      textSource: "template",
      deviationText: outcome.deviation_text,
      tg: 3,
    });
    const view = await startedView(f);
    expect(checkpointOf(view, TG3_VENTILATION.checkpointKey).deviations.map((d) => d.id)).toEqual([
      id,
    ]);

    for (const wrong of [
      { ...TG3_VENTILATION, outcomeKey: "tg2" },
      { ...TG3_VENTILATION, checkpointKey: CP.general },
      { checkpointKey: "wet_room.finnes_ikke", questionKey: "x.y", outcomeKey: "tg3" },
    ]) {
      const error = await addDeviation(f.actor, f.organizationId, f.room, {
        id: uuidv7(),
        ...wrong,
        tg: null,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(ReportValidationError);
      expect(error.code).toBe("unknown_key");
    }
    // Fast TG-utfall kan ikke få annen TG her (det er Endre på et forslag)
    const mismatch = await addDeviation(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ...TG3_VENTILATION,
      tg: 2,
    }).catch((e) => e);
    expect(mismatch).toBeInstanceOf(ReportValidationError);
  });

  it("B4.35 utfall fra en annen malversjon avvises (låst malversjon)", async () => {
    const f = await startedBathroom();
    const { createTemplate } = await import("../../../tests/factories");
    const changed = {
      ...wetRoomTemplate,
      deviation_questions: [
        ...wetRoomTemplate.deviation_questions,
        {
          checkpoint_key: CP.general,
          key: "wet_room.general.new_question",
          text: "Nytt spørsmål?",
          sort_order: 99,
        },
      ],
      outcomes: [
        ...wetRoomTemplate.outcomes,
        {
          ...wetRoomTemplate.outcomes.find((o) => o.checkpoint_key === CP.general)!,
          question_key: "wet_room.general.new_question",
          key: "tg2",
          kind: "tg2" as const,
        },
      ],
    };
    await createTemplate(f.organizationId, {
      status: "published",
      document: changed,
      versionNumber: 2,
    });
    const error = await addDeviation(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      checkpointKey: CP.general,
      questionKey: "wet_room.general.new_question",
      outcomeKey: "tg2",
      tg: null,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ReportValidationError);
    expect(error.code).toBe("unknown_key");
  });

  it("B1.8/B6.15 flettefeltene fylles fra svarene når avviket lages; uten svar står «[måleverdi mangler]», aldri {…}", async () => {
    const f = await startedBathroom();
    const fall = {
      checkpointKey: CP.floor,
      questionKey: "wet_room.floor.insufficient_fall",
      outcomeKey: "choose",
    };
    const textOf = async (id: string) => {
      const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
      const measures = await measuresOf(id);
      return [
        row?.deviationText,
        row?.causeText,
        row?.consequenceText,
        ...measures.map((m) => m.text),
      ]
        .filter((t): t is string => typeof t === "string")
        .join(" ");
    };

    const missingId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, { id: missingId, ...fall, tg: 2 });
    const missing = await textOf(missingId);
    expect(missing).not.toMatch(/[{}]/u);
    expect(missing).toContain("Målt fall mot sluk er [måleverdi mangler] mm per meter.");

    await answer(f, "wet_room.fall_direction_1", { number: 5 });
    await answer(f, "wet_room.fall_direction_2", { number: 7.5 });
    const filledId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, { id: filledId, ...fall, tg: 3 });
    expect(await textOf(filledId)).toContain("Målt fall mot sluk er 5 og 7,5 mm per meter.");

    await answer(f, "wet_room.membrane_year", { number: 1990 });
    const yearId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: yearId,
      checkpointKey: CP.membrane,
      questionKey: "wet_room.membrane_drain.membrane_before_2000",
      outcomeKey: "tg3",
      tg: null,
    });
    expect(await textOf(yearId)).toContain("registrert som fra 1990.");
  });
});
