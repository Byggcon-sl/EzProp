import { and, count, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/core/access";
import { addDeviation, decideSuggestion, ReportValidationError, setTgDirect } from "@/core/reports";
import { db } from "@/db/client";
import {
  checkpointResults,
  deviationMeasures,
  deviations,
  rules,
  ruleSuggestionDecisions,
  tgiuDetails,
} from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../tests/factories";
import {
  answer,
  answerHole,
  answerMembrane1990,
  checkpointOf,
  CP,
  RULE,
  startedBathroom,
  startedView,
} from "../../../tests/report-fixtures";

/*
 * Regelforslag (docs/funksjoner/fase2a-badet-pc-testplan.md 4c og 4f: B4.14–B4.21, B4.30–B4.32).
 * Serveren regner forslaget selv, reglene setter aldri TG, og hver beslutning er en ny rad.
 */

beforeEach(resetDatabase);

type F = Awaited<ReturnType<typeof startedBathroom>>;

const BEFORE_2000 = { question: "wet_room.membrane_drain.membrane_before_2000", outcome: "tg3" };
const ELEVATED = { question: "wet_room.adjacent.elevated_moisture", outcome: "choose" };
const FIXTURES = "wet_room.fixtures";

async function decisionsOf(f: F) {
  return db
    .select()
    .from(ruleSuggestionDecisions)
    .where(eq(ruleSuggestionDecisions.reportId, f.reportId))
    .orderBy(ruleSuggestionDecisions.decidedAt);
}

async function liveDeviations(f: F) {
  return db
    .select()
    .from(deviations)
    .where(and(eq(deviations.reportId, f.reportId), isNull(deviations.deletedAt)));
}

function decide(f: F, input: Parameters<typeof decideSuggestion>[3]) {
  return decideSuggestion(f.actor, f.organizationId, f.room, input);
}

/** Svaret for en regel i visningen. */
async function suggestionOf(f: F, ruleKey: string) {
  const view = await startedView(f);
  const found = view.suggestions.find((s) => s.ruleKey === ruleKey);
  if (!found) throw new Error(`fant ikke regelen ${ruleKey}`);
  return found;
}

async function expectNoTg(f: F) {
  const view = await startedView(f);
  for (const checkpoint of view.checkpoints) {
    expect(checkpoint.tgDirect).toBeNull();
    expect(checkpoint.tg).toBeNull();
    expect(checkpoint.deviations).toEqual([]);
  }
  expect(await liveDeviations(f)).toEqual([]);
  expect(await decisionsOf(f)).toEqual([]);
}

describe("4c regelforslag", () => {
  it("B4.14 regler setter aldri TG: lagring som utløser alle fem reglene gir ingen avvik, TG eller beslutning", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    expect((await suggestionOf(f, RULE.before2000)).state).toBe("triggered");
    await expectNoTg(f);

    await answer(f, "wet_room.membrane_year", { number: 2008 }, { number: 1990 });
    expect((await suggestionOf(f, RULE.pastLifespan)).state).toBe("triggered");
    await expectNoTg(f);

    await answerHole(f, "not_done");
    expect((await suggestionOf(f, RULE.notDone)).state).toBe("triggered");
    await expectNoTg(f);

    await answer(
      f,
      "wet_room.hole_drilling",
      { optionKeys: ["done_no_findings"] },
      { optionKeys: ["not_done"] },
    );
    await answer(f, "wet_room.hole_moisture_unit", { optionKeys: ["weight_percent"] });
    await answer(f, "wet_room.hole_moisture_reading", { number: 14.9 });
    expect((await suggestionOf(f, RULE.noMoisture)).state).toBe("triggered");
    await expectNoTg(f);

    await answer(f, "wet_room.hole_moisture_reading", { number: 15 }, { number: 14.9 });
    expect((await suggestionOf(f, RULE.moisture)).state).toBe("triggered");
    expect((await suggestionOf(f, RULE.noMoisture)).state).not.toBe("triggered");
    await expectNoTg(f);
  });

  it("B4.15 Godta outcome (sjikt 1990) lager avviket med malens tekster og logger serverens regelsvar", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    const deviationId = uuidv7();
    const result = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
      deviationId,
    });
    expect(result).toMatchObject({ status: "saved", deviationId });

    const outcome = wetRoomTemplate.outcomes.find(
      (o) => o.question_key === BEFORE_2000.question && o.key === BEFORE_2000.outcome,
    )!;
    const [row] = await liveDeviations(f);
    const [rule] = await db
      .select({ id: rules.id })
      .from(rules)
      .where(and(eq(rules.versionId, f.templateVersionId), eq(rules.key, RULE.before2000)));
    expect(row).toMatchObject({
      id: deviationId,
      kind: "tg",
      tg: 3,
      deviationText: outcome.deviation_text,
      causeText: outcome.default_cause_text,
      causeCriterion: outcome.default_cause_criterion,
      consequenceText: outcome.default_consequence_text,
      textSource: "template",
      suggestedByRuleId: rule?.id,
      costType: "none",
    });
    const measures = await db
      .select()
      .from(deviationMeasures)
      .where(eq(deviationMeasures.deviationId, deviationId));
    expect(measures.map((m) => m.text)).toEqual(
      wetRoomTemplate.standard_measures
        .filter((m) => m.question_key === BEFORE_2000.question && m.outcome_key === "tg3")
        .map((m) => m.text),
    );
    expect(measures.every((m) => m.textSource === "template")).toBe(true);

    const [decision] = await decisionsOf(f);
    expect(decision).toMatchObject({
      decision: "accepted",
      ruleKey: RULE.before2000,
      suggestion: {
        kind: "outcome",
        checkpoint_key: CP.membrane,
        question_key: BEFORE_2000.question,
        outcome_key: "tg3",
      },
      lifespanSetKey: expect.any(String),
      inspectionYear: 2026,
      chosenTg: "3",
      chosenOutcomeKey: "tg3",
      deviationId,
      overrideReasonCode: null,
      overrideReason: null,
      decidedBy: f.employeeId,
    });
    expect(Array.isArray(decision?.reasons) && decision.reasons.length).toBeGreaterThan(0);
    const view = await startedView(f);
    expect(checkpointOf(view, CP.membrane).tg).toBe("3");
  });

  it("B4.16 Godta tgiu gir tg_direct IU med tomme opplysninger; Godta tg0 (14,9) gir tg_direct 0", async () => {
    const f = await startedBathroom();
    await answerHole(f, "not_done");
    expect(
      (await decide(f, { id: uuidv7(), ruleKey: RULE.notDone, decision: "accepted" })).status,
    ).toBe("saved");
    let view = await startedView(f);
    expect(checkpointOf(view, CP.adjacent)).toMatchObject({
      tgDirect: "IU",
      tg: "IU",
      status: "tgiu",
    });
    expect(checkpointOf(view, CP.adjacent).tgiuDetails).not.toBeNull();

    const g = await startedBathroom();
    await answerHole(g, "done_no_findings", 14.9);
    expect(
      (await decide(g, { id: uuidv7(), ruleKey: RULE.noMoisture, decision: "accepted" })).status,
    ).toBe("saved");
    view = await startedView(g);
    expect(checkpointOf(view, CP.adjacent).tgDirect).toBe("0");
    const [decision] = await decisionsOf(g);
    expect(decision).toMatchObject({ decision: "accepted", chosenTg: "0", deviationId: null });
  });

  it("B4.17 Endre og Avvis krever grunn; ny beslutning er ny rad, og første rad er urørt", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    const attempts = [
      { decision: "changed" as const, chosenTg: "2" as const },
      { decision: "rejected" as const },
      { decision: "rejected" as const, overrideReasonCode: "other" as const },
      {
        decision: "rejected" as const,
        overrideReasonCode: "other" as const,
        overrideReason: "   ",
      },
      { decision: "accepted" as const, overrideReasonCode: "visible_damage" as const },
    ];
    for (const attempt of attempts) {
      const error = await decide(f, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        ...attempt,
      } as never).catch((e) => e);
      expect(error).toBeInstanceOf(ReportValidationError);
      expect(error.code).toBe("override_reason");
    }
    expect(await decisionsOf(f)).toEqual([]);

    const rejected = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "rejected",
      overrideReasonCode: "documentation_present",
    });
    expect(rejected).toMatchObject({ status: "saved", deviationId: null });
    expect(await liveDeviations(f)).toEqual([]);
    const [first] = await decisionsOf(f);

    const deviationId = uuidv7();
    const changed = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "changed",
      chosenTg: "2",
      overrideReasonCode: "other",
      overrideReason: "Sjiktet er skiftet senere",
      deviationId,
    });
    expect(changed).toMatchObject({ status: "saved", deviationId });
    const rows = await decisionsOf(f);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(first);
    expect(rows[1]).toMatchObject({
      decision: "changed",
      chosenTg: "2",
      chosenOutcomeKey: "tg3",
      overrideReasonCode: "other",
      overrideReason: "Sjiktet er skiftet senere",
      deviationId,
    });
    const [deviation] = await liveDeviations(f);
    expect(deviation).toMatchObject({ id: deviationId, tg: 2, textSource: "template" });

    // Endre til TG uten avvik: ingen avvik, TG direkte
    const g = await startedBathroom();
    await answerMembrane1990(g);
    await decide(g, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "changed",
      chosenTg: "1",
      overrideReason: "Ny membran lagt i 2020",
    });
    expect(await liveDeviations(g)).toEqual([]);
    expect(checkpointOf(await startedView(g), CP.membrane).tgDirect).toBe("1");
  });

  it("B4.18 serveren stoler ikke på klienten", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    // Forfalsket forslag eller begrunnelse i kallet avvises (strengt skjema)
    for (const forged of [
      { suggestion: { kind: "tg0", checkpoint_key: CP.membrane } },
      { reasons: [{ type: "unsupported", note: "fritekst" }] },
    ]) {
      const error = await decide(f, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
        ...forged,
      } as never).catch((e) => e);
      expect(error).toBeInstanceOf(ReportValidationError);
    }
    const unknown = await decide(f, {
      id: uuidv7(),
      ruleKey: "wet_room.finnes_ikke",
      decision: "accepted",
    }).catch((e) => e);
    expect(unknown).toBeInstanceOf(ReportValidationError);
    expect(unknown.code).toBe("unknown_key");

    // Regelen slår ikke til på lagrede svar
    const stale = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.pastLifespan,
      decision: "accepted",
    });
    expect(stale.status).toBe("no_longer_applies");
    expect(await decisionsOf(f)).toEqual([]);
    expect(await liveDeviations(f)).toEqual([]);

    // Det som lagres, er serverens eget regelsvar
    await decide(f, { id: uuidv7(), ruleKey: RULE.before2000, decision: "accepted" });
    const [decision] = await decisionsOf(f);
    expect(decision?.suggestion).toEqual({
      kind: "outcome",
      checkpoint_key: CP.membrane,
      question_key: BEFORE_2000.question,
      outcome_key: "tg3",
    });
    expect(JSON.stringify(decision?.reasons)).not.toContain("fritekst");
  });

  it("B4.19 forslag som ikke lenger gjelder: avviket står, advarselen kommer, ingenting slettes", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    const deviationId = uuidv7();
    await decide(f, { id: uuidv7(), ruleKey: RULE.before2000, decision: "accepted", deviationId });
    await answer(f, "wet_room.membrane_year", { number: 2015 }, { number: 1990 });
    const view = await startedView(f);
    const membrane = checkpointOf(view, CP.membrane);
    expect(membrane.deviations.map((d) => d.id)).toEqual([deviationId]);
    expect(membrane.warnings).toContainEqual(
      expect.objectContaining({
        code: "suggestion_no_longer_applies",
        ruleKey: RULE.before2000,
        deviationId,
      }),
    );
    expect(view.suggestions.find((s) => s.ruleKey === RULE.before2000)?.stale).toBe(true);
    expect(await liveDeviations(f)).toHaveLength(1);
  });

  it("B4.20 TGIU og TG-avvik krever aktivt valg; fjernet TGIU slettes mykt; TG1 tømmes", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.membrane,
      tgDirect: "IU",
      base: null,
    });
    const conflict = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
    });
    expect(conflict).toEqual({ status: "tgiu_conflict" });
    expect(await decisionsOf(f)).toEqual([]);
    expect(checkpointOf(await startedView(f), CP.membrane).tgDirect).toBe("IU");

    const saved = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
      tgiuChoice: "remove_tgiu",
    });
    expect(saved.status).toBe("saved");
    const membrane = checkpointOf(await startedView(f), CP.membrane);
    expect(membrane).toMatchObject({ tgDirect: null, tg: "3", tgiuDetails: null });
    const tgiuRows = await db
      .select()
      .from(tgiuDetails)
      .where(eq(tgiuDetails.reportId, f.reportId));
    expect(tgiuRows).toHaveLength(1);
    expect(tgiuRows[0]?.deletedAt).not.toBeNull();

    // TG-avvik på punkt med TG1 tømmer tg_direct
    const g = await startedBathroom();
    await answerMembrane1990(g);
    await setTgDirect(g.actor, g.organizationId, g.room, {
      checkpointKey: CP.membrane,
      tgDirect: "1",
      base: null,
    });
    await decide(g, { id: uuidv7(), ruleKey: RULE.before2000, decision: "accepted" });
    expect(checkpointOf(await startedView(g), CP.membrane)).toMatchObject({
      tgDirect: null,
      tg: "3",
    });
  });

  it("B4.21 bør/må: «velg TG2 eller TG3» gir bør-tiltak ved TG2 og må-tiltak ved TG3 (T-0060)", async () => {
    const spec = (tg: 2 | 3) =>
      wetRoomTemplate.standard_measures.filter(
        (m) => m.question_key === ELEVATED.question && m.applies_to_tg === tg,
      )[0]!.text;
    for (const [decision, tg] of [
      ["accepted", 2],
      ["accepted", 3],
      ["changed", 2],
      ["changed", 3],
    ] as const) {
      const f = await startedBathroom();
      await answerHole(f, "done_with_findings", 18);
      const result = await decide(f, {
        id: uuidv7(),
        ruleKey: RULE.moisture,
        ...(decision === "accepted"
          ? { decision, chosenTg: tg }
          : { decision, chosenTg: String(tg) as "2" | "3", overrideReasonCode: "measured_again" }),
      } as never);
      expect(result.status).toBe("saved");
      const [deviation] = await liveDeviations(f);
      expect(deviation).toMatchObject({
        tg,
        measurementValue: 18,
        measurementUnit: "weight_percent",
      });
      const texts = (
        await db
          .select()
          .from(deviationMeasures)
          .where(eq(deviationMeasures.deviationId, deviation!.id))
      ).map((m) => m.text);
      expect(texts).toContain(spec(tg));
      expect(texts).not.toContain(spec(tg === 2 ? 3 : 2));
    }
  });

  it("B4.30 source_ref flettes aldri inn i avvikstekst, årsak, konsekvens eller tiltak", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    await decide(f, { id: uuidv7(), ruleKey: RULE.before2000, decision: "accepted" });
    const rule = wetRoomTemplate.rules.find((r) => r.key === RULE.before2000)!;
    const outcome = wetRoomTemplate.outcomes.find((o) => o.question_key === BEFORE_2000.question)!;
    const [deviation] = await liveDeviations(f);
    const measures = await db
      .select()
      .from(deviationMeasures)
      .where(eq(deviationMeasures.reportId, f.reportId));
    const texts = [
      deviation?.deviationText,
      deviation?.causeText,
      deviation?.consequenceText,
      ...measures.map((m) => m.text),
    ].join("\n");
    for (const source of [rule.source_ref, outcome.source_ref]) {
      expect(source).toBeTruthy();
      expect(texts).not.toContain(source);
    }
  });
});

describe("4f tillegg", () => {
  it("B4.31 dobbelt Godta gir ett avvik; samme id to ganger gir samme svar", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    const results = await Promise.all([
      decide(f, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
        deviationId: uuidv7(),
      }),
      decide(f, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        decision: "accepted",
        deviationId: uuidv7(),
      }),
    ]);
    expect(results.every((r) => r.status === "saved")).toBe(true);
    expect(await liveDeviations(f)).toHaveLength(1);

    const g = await startedBathroom();
    await answerMembrane1990(g);
    const input = {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted" as const,
      deviationId: uuidv7(),
    };
    const first = await decide(g, input);
    const second = await decide(g, input);
    expect(second).toMatchObject({
      status: "saved",
      decisionId: (first as { decisionId: string }).decisionId,
    });
    expect(await liveDeviations(g)).toHaveLength(1);
    expect(await decisionsOf(g)).toHaveLength(1);
  });

  it("B4.31 id som finnes i en annen organisasjon avvises uten å røre den andre raden", async () => {
    const a = await startedBathroom();
    await answerMembrane1990(a);
    const decisionId = uuidv7();
    const deviationId = uuidv7();
    await decide(a, {
      id: decisionId,
      ruleKey: RULE.before2000,
      decision: "accepted",
      deviationId,
    });
    const before = await db.select().from(deviations).where(eq(deviations.id, deviationId));

    const b = await startedBathroom();
    await answerMembrane1990(b);
    await expect(
      decide(b, { id: uuidv7(), ruleKey: RULE.before2000, decision: "accepted", deviationId }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      decide(b, { id: decisionId, ruleKey: RULE.before2000, decision: "accepted" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await db.select().from(deviations).where(eq(deviations.id, deviationId))).toEqual(
      before,
    );
    expect(await liveDeviations(b)).toEqual([]);
    expect(await decisionsOf(b)).toEqual([]);
  });

  it("B4.32 Godta TGIU eller TG0 på punkt med TG-avvik krever aktivt valg (A395)", async () => {
    // TGIU-forslag på punkt med TG3-avvik
    const f = await startedBathroom();
    const deviationId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: deviationId,
      checkpointKey: CP.adjacent,
      questionKey: ELEVATED.question,
      outcomeKey: ELEVATED.outcome,
      tg: 3,
    });
    await answerHole(f, "not_done");
    const conflict = await decide(f, { id: uuidv7(), ruleKey: RULE.notDone, decision: "accepted" });
    expect(conflict).toEqual({ status: "tgiu_conflicts_with_deviation" });
    expect(await decisionsOf(f)).toEqual([]);
    expect(await liveDeviations(f)).toHaveLength(1);
    expect(checkpointOf(await startedView(f), CP.adjacent).tgDirect).toBeNull();

    // Feiler ett ledd (beslutnings-id finnes i en annen organisasjon), lagres ingenting
    const other = await startedBathroom();
    await answerHole(other, "not_done");
    const takenId = uuidv7();
    await decide(other, { id: takenId, ruleKey: RULE.notDone, decision: "accepted" });
    await expect(
      decide(f, {
        id: takenId,
        ruleKey: RULE.notDone,
        decision: "accepted",
        tgDeviationChoice: "remove_tg_deviations",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await liveDeviations(f)).toHaveLength(1);
    expect(checkpointOf(await startedView(f), CP.adjacent).tgDirect).toBeNull();

    const saved = await decide(f, {
      id: uuidv7(),
      ruleKey: RULE.notDone,
      decision: "accepted",
      tgDeviationChoice: "remove_tg_deviations",
    });
    expect(saved.status).toBe("saved");
    expect(await liveDeviations(f)).toEqual([]);
    expect(checkpointOf(await startedView(f), CP.adjacent).tgDirect).toBe("IU");
    expect((await decisionsOf(f)).map((d) => d.decision)).toEqual(["accepted"]);

    // TG0-forslag på punkt med TG2-avvik
    const g = await startedBathroom();
    await addDeviation(g.actor, g.organizationId, g.room, {
      id: uuidv7(),
      checkpointKey: CP.adjacent,
      questionKey: ELEVATED.question,
      outcomeKey: ELEVATED.outcome,
      tg: 2,
    });
    await answerHole(g, "done_no_findings", 14.9);
    expect(
      await decide(g, { id: uuidv7(), ruleKey: RULE.noMoisture, decision: "accepted" }),
    ).toEqual({
      status: "tgiu_conflicts_with_deviation",
    });
    expect(await decisionsOf(g)).toEqual([]);
  });

  it("B4.32 samme for setTgDirect; HMS-avvik står", async () => {
    const f = await startedBathroom();
    const view = await startedView(f);
    const outcome = (kind: string) =>
      view.document.outcomes.find((o) => o.checkpoint_key === FIXTURES && o.kind === kind)!;
    const hms = outcome("hms");
    const tg2 = outcome("tg2");
    const hmsId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: hmsId,
      checkpointKey: FIXTURES,
      questionKey: hms.question_key,
      outcomeKey: hms.key,
      tg: null,
    });
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      checkpointKey: FIXTURES,
      questionKey: tg2.question_key,
      outcomeKey: tg2.key,
      tg: null,
    });
    for (const tgDirect of ["IU", "0"] as const) {
      expect(
        await setTgDirect(f.actor, f.organizationId, f.room, {
          checkpointKey: FIXTURES,
          tgDirect,
          base: null,
        }),
      ).toEqual({ status: "tgiu_conflicts_with_deviation" });
    }
    const error = await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: FIXTURES,
      tgDirect: "1",
      base: null,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ReportValidationError);

    const saved = await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: FIXTURES,
      tgDirect: "IU",
      base: null,
      tgDeviationChoice: "remove_tg_deviations",
    });
    expect(saved.status).toBe("saved");
    expect((await liveDeviations(f)).map((d) => d.id)).toEqual([hmsId]);
    const fixtures = checkpointOf(await startedView(f), FIXTURES);
    expect(fixtures).toMatchObject({ tgDirect: "IU", tg: "IU" });

    // HMS kan stå sammen med TGIU uten valg
    const g = await startedBathroom();
    await setTgDirect(g.actor, g.organizationId, g.room, {
      checkpointKey: FIXTURES,
      tgDirect: "IU",
      base: null,
    });
    const added = await addDeviation(g.actor, g.organizationId, g.room, {
      id: uuidv7(),
      checkpointKey: FIXTURES,
      questionKey: hms.question_key,
      outcomeKey: hms.key,
      tg: null,
    });
    expect(added.status).toBe("saved");
    const [counted] = await db
      .select({ n: count() })
      .from(checkpointResults)
      .where(and(eq(checkpointResults.reportId, g.reportId), eq(checkpointResults.tgDirect, "IU")));
    expect(counted?.n).toBe(1);
  });
});
