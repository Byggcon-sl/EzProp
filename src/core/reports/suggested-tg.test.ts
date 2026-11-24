import { and, count, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Slås på i FA-I20: revisjonsraden for beslutningen feiler, etter at TG og raden er skrevet. */
const auditFault = vi.hoisted(() => ({ on: false }));
vi.mock("@/core/audit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/audit")>();
  return {
    ...original,
    recordAuditEvent: vi.fn(async (...args: Parameters<typeof original.recordAuditEvent>) => {
      if (auditFault.on && args[2].entityType === "rule_suggestion_decision") {
        throw new Error("tvunget feil i testen");
      }
      return original.recordAuditEvent(...args);
    }),
  };
});

/** FA-I39: hver funksjon i KI-modulen er en spion, så testen ser om noe kalles. */
vi.mock("@/core/ai", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(original)) {
    wrapped[name] =
      typeof value === "function" && !/^[A-Z]/.test(name)
        ? vi.fn((...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args))
        : value;
  }
  return wrapped;
});

import { AccessDeniedError } from "@/core/access";
import * as ai from "@/core/ai";
import {
  addDeviation,
  changeSuggestedDeviationTg,
  decideSuggestion,
  ReportStorageError,
  ReportValidationError,
  setTgDirect,
  type ChangeSuggestedDeviationTgInput,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  aiUsageLog,
  auditLog,
  deviationMeasures,
  deviations,
  ruleSuggestionDecisions,
} from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
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
 * TG-bytte på et avvik fra et regelforslag (T-0113, A490): testplanen
 * docs/agenter/oppgaver/rett-forslag-og-avvik-testplan.md 2c (FA-I19–I27), 2f (FA-T3, FA-T6) og
 * 2g (FA-I38, FA-I39). TG og beslutningsrad lagres sammen; uten grunn lagres ingenting. Regler og
 * KI setter aldri TG. Alle data er oppdiktede.
 */

beforeEach(() => {
  auditFault.on = false;
  return resetDatabase();
});
afterEach(() => {
  auditFault.on = false;
  vi.restoreAllMocks();
});

type F = Awaited<ReturnType<typeof startedBathroom>>;

/** En oppdiktet markør som aldri skal finnes i noen logg. */
const MARKER = "MARKØR-grunn-9Z";

function change(f: F, input: ChangeSuggestedDeviationTgInput) {
  return changeSuggestedDeviationTg(f.actor, f.organizationId, f.room, input);
}

async function decisionsOf(f: Pick<F, "reportId">) {
  return db
    .select()
    .from(ruleSuggestionDecisions)
    .where(eq(ruleSuggestionDecisions.reportId, f.reportId))
    .orderBy(ruleSuggestionDecisions.decidedAt, ruleSuggestionDecisions.id);
}

async function deviationRow(id: string) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
  if (!row) throw new Error("fant ikke avviket");
  return row;
}

async function liveMeasureTexts(deviationId: string) {
  const rows = await db
    .select({ text: deviationMeasures.text })
    .from(deviationMeasures)
    .where(and(eq(deviationMeasures.deviationId, deviationId), isNull(deviationMeasures.deletedAt)))
    .orderBy(deviationMeasures.sortOrder);
  return rows.map((r) => r.text);
}

async function auditCount() {
  const [row] = await db.select({ n: count() }).from(auditLog);
  return row?.n ?? 0;
}

/** Bad med sjikt fra 1990 og godtatt TG3-forslag «før 2000». */
async function acceptedTg3(options: Parameters<typeof startedBathroom>[0] = {}) {
  const f = await startedBathroom(options);
  await answerMembrane1990(f);
  const deviationId = uuidv7();
  const accepted = await decideSuggestion(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    ruleKey: RULE.before2000,
    decision: "accepted",
    deviationId,
  });
  if (accepted.status !== "saved") throw new Error("godta feilet");
  return { ...f, deviationId, acceptedId: accepted.decisionId };
}

/** Bad med fukt over grensen og godtatt «velg TG2 eller TG3» med valgt TG. */
async function acceptedChoose(tg: 2 | 3 | null) {
  const f = await startedBathroom();
  await answerHole(f, "done_with_findings", 20);
  const deviationId = uuidv7();
  const accepted = await decideSuggestion(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    ruleKey: RULE.moisture,
    decision: "accepted",
    deviationId,
    ...(tg === null ? {} : { chosenTg: tg }),
  });
  if (accepted.status !== "saved") throw new Error("godta feilet");
  return { ...f, deviationId };
}

async function expectValidation(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReportValidationError);
  expect((error as ReportValidationError).code).toBe(code);
  return error as ReportValidationError;
}

describe("2c TG-bytte med grunn (changeSuggestedDeviationTg)", () => {
  it("FA-I19 uten grunn (TG3 → TG2): override_reason med norsk melding, verken avvik eller rad lagret", async () => {
    const f = await acceptedTg3();
    const before = await deviationRow(f.deviationId);
    const auditBefore = await auditCount();
    const error = await expectValidation(
      change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 2, base: 3 }),
      "override_reason",
    );
    expect(error.message).toBe("Velg en grunn for å endre TG fra forslaget.");
    expect(await deviationRow(f.deviationId)).toEqual(before);
    expect(await decisionsOf(f)).toHaveLength(1);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("FA-I19 «Annet» uten tekst: override_reason, ingenting lagret", async () => {
    const f = await acceptedTg3();
    await expectValidation(
      change(f, {
        id: uuidv7(),
        deviationId: f.deviationId,
        tg: 2,
        base: 3,
        overrideReasonCode: "other",
      }),
      "override_reason",
    );
    expect((await deviationRow(f.deviationId)).tg).toBe(3);
    expect(await decisionsOf(f)).toHaveLength(1);
  });

  it("FA-I20 med grunn: rad changed med samme avvik, regelsvaret kopiert (også når regelen ikke slår til lenger)", async () => {
    const f = await acceptedTg3();
    // Regelen slår ikke til lenger; den gjeldende beslutningen står fordi avviket står
    await answer(f, "wet_room.membrane_year", { number: 2008 }, { number: 1990 });
    const [accepted] = await decisionsOf(f);
    const id = uuidv7();
    const result = await change(f, {
      id,
      deviationId: f.deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "documentation_present",
    });
    expect(result).toMatchObject({ status: "saved", decisionId: id });
    expect((await deviationRow(f.deviationId)).tg).toBe(2);

    const rows = await decisionsOf(f);
    expect(rows).toHaveLength(2);
    const row = rows[1]!;
    expect(row).toMatchObject({
      id,
      decision: "changed",
      ruleKey: RULE.before2000,
      checkpointResultId: accepted!.checkpointResultId,
      chosenTg: "2",
      chosenOutcomeKey: "tg3",
      deviationId: f.deviationId,
      overrideReasonCode: "documentation_present",
      overrideReason: null,
      decidedBy: f.employeeId,
    });
    expect(row.suggestion).toEqual(accepted!.suggestion);
    expect(row.reasons).toEqual(accepted!.reasons);
    expect(row.lifespanSetKey).toBe(accepted!.lifespanSetKey);
    expect(row.thresholdSetKey).toBe(accepted!.thresholdSetKey);
    expect(row.inspectionYear).toBe(accepted!.inspectionYear);
  });

  it("FA-I20 feil etter avviksoppdateringen: verken TG, tiltak eller rad lagret (samme transaksjon)", async () => {
    const f = await acceptedTg3();
    const before = await deviationRow(f.deviationId);
    const measuresBefore = await liveMeasureTexts(f.deviationId);
    const auditBefore = await auditCount();
    auditFault.on = true;
    await expect(
      change(f, {
        id: uuidv7(),
        deviationId: f.deviationId,
        tg: 2,
        base: 3,
        overrideReasonCode: "visible_damage",
      }),
    ).rejects.toBeInstanceOf(ReportStorageError);
    auditFault.on = false;
    expect(await deviationRow(f.deviationId)).toEqual(before);
    expect(await liveMeasureTexts(f.deviationId)).toEqual(measuresBefore);
    expect(await decisionsOf(f)).toHaveLength(1);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("FA-I21 tilbake til forslagets TG (TG2 → TG3) uten grunn gir rad accepted; med grunn avvises det", async () => {
    const f = await acceptedTg3();
    await change(f, {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "measured_again",
    });
    await expectValidation(
      change(f, {
        id: uuidv7(),
        deviationId: f.deviationId,
        tg: 3,
        base: 2,
        overrideReasonCode: "measured_again",
      }),
      "override_reason",
    );
    expect(await decisionsOf(f)).toHaveLength(2);

    const id = uuidv7();
    expect(await change(f, { id, deviationId: f.deviationId, tg: 3, base: 2 })).toMatchObject({
      status: "saved",
      decisionId: id,
    });
    const rows = await decisionsOf(f);
    expect(rows.map((r) => r.decision)).toEqual(["accepted", "changed", "accepted"]);
    expect(rows[2]).toMatchObject({
      chosenTg: "3",
      deviationId: f.deviationId,
      overrideReasonCode: null,
      overrideReason: null,
    });
    expect((await deviationRow(f.deviationId)).tg).toBe(3);
  });

  it("FA-I22 «velg TG2 eller TG3»: TG2, TG3 og tom gir accepted uten grunn", async () => {
    const f = await acceptedChoose(2);
    for (const [tg, base] of [
      [3, 2],
      [null, 3],
      [2, null],
    ] as const) {
      const result = await change(f, { id: uuidv7(), deviationId: f.deviationId, tg, base });
      expect(result.status).toBe("saved");
      expect((await deviationRow(f.deviationId)).tg).toBe(tg);
    }
    const rows = await decisionsOf(f);
    expect(rows.map((r) => [r.decision, r.chosenTg])).toEqual([
      ["accepted", "2"],
      ["accepted", "3"],
      ["accepted", null],
      ["accepted", "2"],
    ]);
    expect(rows.every((r) => r.deviationId === f.deviationId)).toBe(true);
  });

  it("FA-I23 samme id to ganger gir samme svar og ingen ny rad", async () => {
    const f = await acceptedTg3();
    const input = {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2 as const,
      base: 3 as const,
      overrideReasonCode: "visible_damage" as const,
    };
    const first = await change(f, input);
    const second = await change(f, input);
    expect(first.status).toBe("saved");
    expect(second).toMatchObject({ status: "saved", decisionId: input.id });
    expect(await decisionsOf(f)).toHaveLength(2);
    expect((await deviationRow(f.deviationId)).tg).toBe(2);
  });

  it("FA-I24 base ulik lagret TG gir conflict med nåverdien, ingenting lagret", async () => {
    const f = await acceptedTg3();
    const before = await deviationRow(f.deviationId);
    const result = await change(f, {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2,
      base: 2,
      overrideReasonCode: "visible_damage",
    });
    expect(result).toMatchObject({ status: "conflict", current: 3 });
    expect(await deviationRow(f.deviationId)).toEqual(before);
    expect(await decisionsOf(f)).toHaveLength(1);
  });

  it("samme TG som nå gir saved med den gjeldende raden, uten ny rad", async () => {
    const f = await acceptedTg3();
    const result = await change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 3, base: 3 });
    expect(result).toMatchObject({ status: "saved", decisionId: f.acceptedId });
    expect(await decisionsOf(f)).toHaveLength(1);
  });

  it("FA-I25 ugyldig input gir valideringsfeil eller 404, og ingenting lagres", async () => {
    const f = await acceptedTg3();
    const good = {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2 as const,
      base: 3 as const,
      overrideReasonCode: "visible_damage" as const,
    };
    // Id som ikke er uuid: 404 uten å si hvorfor
    await expect(change(f, { ...good, id: "abc" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(change(f, { ...good, deviationId: "1; drop table" })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    for (const bad of [
      { ...good, overrideReasonCode: "made_up" },
      { ...good, tg: 4 },
      { ...good, organizationId: f.organizationId },
      { ...good, overrideReason: "x".repeat(501) },
    ]) {
      const error = await expectValidation(
        change(f, bad as unknown as ChangeSuggestedDeviationTgInput),
        "overrideReason" in bad ? "override_reason" : "invalid_input",
      );
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toContain("made_up");
    }
    expect((await deviationRow(f.deviationId)).tg).toBe(3);
    expect(await decisionsOf(f)).toHaveLength(1);
  });

  it("avvik uten gjeldende beslutning gir not_applicable (avvik uten forslag)", async () => {
    const f = await startedBathroom();
    const deviationId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: deviationId,
      checkpointKey: CP.membrane,
      questionKey: "wet_room.membrane_drain.membrane_before_2000",
      outcomeKey: "tg3",
      tg: null,
    });
    await expectValidation(
      change(f, {
        id: uuidv7(),
        deviationId,
        tg: 2,
        base: 3,
        overrideReasonCode: "visible_damage",
      }),
      "not_applicable",
    );
    expect(await decisionsOf(f)).toHaveLength(0);
  });

  it("FA-I26 fag: byggeår 1995, folie, årstall tomt: godta TG3, bytt til TG2 krever grunn", async () => {
    const f = await startedBathroom();
    await answer(f, "wet_room.membrane_type", { optionKeys: ["foil"] });
    await answer(f, "wet_room.documentation_type", { optionKeys: ["none"] });
    await answer(f, "wet_room.build_year", { number: 1995 });
    const deviationId = uuidv7();
    const accepted = await decideSuggestion(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "accepted",
      deviationId,
    });
    expect(accepted.status).toBe("saved");
    expect((await deviationRow(deviationId)).tg).toBe(3);

    await expectValidation(
      change(f, { id: uuidv7(), deviationId, tg: 2, base: 3 }),
      "override_reason",
    );
    const saved = await change(f, {
      id: uuidv7(),
      deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "age_known_otherwise",
      overrideReason: MARKER,
    });
    expect(saved.status).toBe("saved");
    const rows = await decisionsOf(f);
    expect(rows[1]).toMatchObject({
      decision: "changed",
      chosenTg: "2",
      suggestion: { kind: "outcome", outcome_key: "tg3" },
      overrideReasonCode: "age_known_otherwise",
      overrideReason: MARKER,
    });
    // Visningen har forslagets TG og valgt TG, med grunnkoden
    const suggestion = (await startedView(f)).suggestions.find(
      (s) => s.ruleKey === RULE.before2000,
    );
    expect(suggestion?.latestDecision).toMatchObject({
      decision: "changed",
      chosenTg: "2",
      suggestionTg: 3,
      overrideReasonCode: "age_known_otherwise",
      deviationId,
    });
  });

  it("FA-I27 tekster og kostnad følger TG: TG3 → TG2 gir texts_written_for_other_tg, TG2 → TG3 gir tg3_missing_cost", async () => {
    const f = await acceptedTg3();
    const codes = async () =>
      checkpointOf(await startedView(f), CP.membrane)
        .warnings.filter((w) => w.deviationId === f.deviationId)
        .map((w) => w.code);
    expect(await codes()).toContain("tg3_missing_cost");
    expect(await codes()).not.toContain("texts_written_for_other_tg");

    await change(f, {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "visible_damage",
    });
    expect(await codes()).toContain("texts_written_for_other_tg");
    expect(await codes()).not.toContain("tg3_missing_cost");

    await change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 3, base: 2 });
    expect(await codes()).toContain("tg3_missing_cost");
    expect(await codes()).not.toContain("texts_written_for_other_tg");
  });

  it("FA-I27 «velg TG2 eller TG3»: TG2 gir tiltakstekstene for TG2, ikke for TG3", async () => {
    const f = await acceptedChoose(3);
    const tg3Measures = await liveMeasureTexts(f.deviationId);
    await change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 2, base: 3 });
    const tg2Measures = await liveMeasureTexts(f.deviationId);
    expect(tg2Measures).not.toEqual(tg3Measures);
    for (const text of tg3Measures) {
      if (!tg2Measures.includes(text)) expect(tg2Measures).not.toContain(text);
    }
  });

  it("TGIU på punktet stopper TG-bytte (A395), og ingenting lagres", async () => {
    const f = await acceptedChoose(null);
    const tgiu = await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    expect(tgiu.status).toBe("saved");
    await expectValidation(
      change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 2, base: null }),
      "tgiu_on_checkpoint",
    );
    expect((await deviationRow(f.deviationId)).tg).toBeNull();
    expect(await decisionsOf(f)).toHaveLength(1);
  });
});

describe("2g logg, personvern og KI", () => {
  it("FA-I38 revisjonsloggen har bare koder, id-er og TG; friteksten står bare i beslutningsraden", async () => {
    const spies = [
      vi.spyOn(logger, "debug"),
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
    ];
    const f = await acceptedTg3();
    const id = uuidv7();
    await change(f, {
      id,
      deviationId: f.deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "other",
      overrideReason: MARKER,
    });
    const audit = await db.select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain(MARKER);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(MARKER);

    const decisionAudit = audit.find((a) => a.entityId === id);
    expect(decisionAudit).toMatchObject({
      entityType: "rule_suggestion_decision",
      action: "changed",
      changes: expect.objectContaining({
        ruleKey: RULE.before2000,
        deviationId: f.deviationId,
        replacesDecisionId: f.acceptedId,
        fromTg: 3,
        toTg: 2,
        overrideReasonCode: "other",
      }),
    });
    const [row] = await db
      .select()
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.id, id));
    expect(row?.overrideReason).toBe(MARKER);
  });

  it("FA-I39 TG-bytte kaller aldri KI-modulen og lager ingen rad i ai_usage_log", async () => {
    const f = await acceptedTg3();
    await change(f, {
      id: uuidv7(),
      deviationId: f.deviationId,
      tg: 2,
      base: 3,
      overrideReasonCode: "visible_damage",
    });
    await change(f, { id: uuidv7(), deviationId: f.deviationId, tg: 3, base: 2 });
    for (const [name, value] of Object.entries(ai)) {
      if (vi.isMockFunction(value)) {
        expect(value, `KI-funksjonen ${name} ble kalt`).not.toHaveBeenCalled();
      }
    }
    const [rows] = await db.select({ n: count() }).from(aiUsageLog);
    expect(rows?.n).toBe(0);
  });
});

describe("2f tenant-isolasjon (changeSuggestedDeviationTg)", () => {
  it("FA-T3 oppslaget av avviket og den gjeldende raden filtrerer på organisasjonen", async () => {
    const byOrg = new Map<string, Awaited<ReturnType<typeof acceptedTg3>> & { tg: 2 | 3 }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await acceptedTg3({ organizationId: grantA.organizationId });
        const b = await acceptedTg3({ organizationId: grantB.organizationId });
        byOrg.set(grantA.organizationId, { ...a, tg: 3 });
        byOrg.set(grantB.organizationId, { ...b, tg: 3 });
        return { a: [a.deviationId], b: [b.deviationId] };
      },
      query: async (actor, organizationId) => {
        // Mot en fremmed organisasjon brukes et avvik fra den andre; tilgangen stopper før oppslaget
        const own = byOrg.get(organizationId) ?? [...byOrg.values()][0]!;
        const next = own.tg === 3 ? 2 : 3;
        const result = await changeSuggestedDeviationTg(actor, organizationId, own.room, {
          id: uuidv7(),
          deviationId: own.deviationId,
          tg: next,
          base: own.tg,
          ...(next === 2 ? { overrideReasonCode: "visible_damage" as const } : {}),
        });
        if (result.status !== "saved") return [];
        own.tg = next;
        const [row] = await db
          .select({ id: deviations.id })
          .from(deviations)
          .where(
            and(eq(deviations.id, own.deviationId), eq(deviations.organizationId, organizationId)),
          );
        return row ? [row.id] : [];
      },
      idOf: (id) => id,
    });
  });

  it("FA-T6 id-er fra en annen organisasjon gir samme svar som en id som ikke finnes, og B er urørt", async () => {
    const a = await acceptedTg3();
    const b = await acceptedTg3();
    const bBefore = await deviationRow(b.deviationId);
    const bDecisions = await decisionsOf(b);
    const reason = { overrideReasonCode: "visible_damage" as const };

    // Avviket i B, med rommet i A
    await expect(
      change(a, { id: uuidv7(), deviationId: b.deviationId, tg: 2, base: 3, ...reason }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    // En id som ikke finnes, gir det samme
    await expect(
      change(a, { id: uuidv7(), deviationId: uuidv7(), tg: 2, base: 3, ...reason }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    // Base og grunn spiller ingen rolle: aldri conflict eller override_reason for B sitt avvik
    await expect(
      change(a, { id: uuidv7(), deviationId: b.deviationId, tg: 2, base: 2 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    // Rommet i B med organisasjonen A
    await expect(
      changeSuggestedDeviationTg(a.actor, a.organizationId, b.room, {
        id: uuidv7(),
        deviationId: b.deviationId,
        tg: 2,
        base: 3,
        ...reason,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    // Beslutnings-id fra B på eget avvik: 404, og ingenting lagres i A
    await expect(
      change(a, { id: b.acceptedId, deviationId: a.deviationId, tg: 2, base: 3, ...reason }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await deviationRow(a.deviationId)).tg).toBe(3);
    expect(await decisionsOf(a)).toHaveLength(1);

    expect(await deviationRow(b.deviationId)).toEqual(bBefore);
    expect(await decisionsOf(b)).toEqual(bDecisions);
  });
});
