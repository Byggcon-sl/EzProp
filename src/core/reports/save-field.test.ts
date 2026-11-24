import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/core/access";
import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  removeDeviation,
  ReportValidationError,
  saveField,
  setTgDirect,
  type ReportFieldChange,
} from "@/core/reports";
import { warningFix } from "@/core/reports/logic";
import { db } from "@/db/client";
import {
  auditLog,
  checkpointResults,
  deviationMeasures,
  deviations,
  fieldAnswers,
  ruleSuggestionDecisions,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  answer,
  answerHole,
  answerMembrane1990,
  checkpointOf,
  CP,
  EMPTY,
  RULE,
  startedBathroom,
  startedView,
} from "../../../tests/report-fixtures";

/*
 * Lagring per felt (docs/funksjoner/fase2a-badet-pc-testplan.md 4b: B4.8–B4.13 og B4.36).
 */

beforeEach(resetDatabase);

type F = Awaited<ReturnType<typeof startedBathroom>>;

const TG3_VENTILATION = {
  checkpointKey: "wet_room.ventilation",
  questionKey: "wet_room.ventilation.missing_ventilation",
  outcomeKey: "tg3",
};

function save(f: F, change: ReportFieldChange) {
  return saveField(f.actor, f.organizationId, f.room, change);
}

async function deviationOn(f: F) {
  const id = uuidv7();
  await addDeviation(f.actor, f.organizationId, f.room, { id, ...TG3_VENTILATION, tg: null });
  const [row] = await db.select().from(deviations).where(eq(deviations.id, id));
  return row!;
}

describe("4b lagring per felt", () => {
  it("B4.8 hvert felt lagres for seg, og row_version øker", async () => {
    const f = await startedBathroom();
    const first = await answer(f, "wet_room.build_year", { number: 1995 });
    expect(first).toMatchObject({ status: "saved", rowVersion: 1 });
    const second = await answer(f, "wet_room.build_year", { number: 1996 }, { number: 1995 });
    expect(second).toMatchObject({ status: "saved", rowVersion: 2 });
    if (first.status !== "saved" || second.status !== "saved") throw new Error("ikke lagret");
    expect(second.id).toBe(first.id);

    const deviation = await deviationOn(f);
    const result = await save(f, {
      table: "deviations",
      id: deviation.id,
      field: "cost_text",
      value: "Grovt anslag",
      base: null,
    });
    expect(result).toMatchObject({ status: "saved", rowVersion: deviation.rowVersion + 1 });
  });

  it("B4.9 samme felt fra to faner: den andre får «endret av andre» med nyeste verdi, ingen overskriving", async () => {
    const f = await startedBathroom();
    await answer(f, "wet_room.build_year", { number: 1990 });
    const tabA = await answer(f, "wet_room.build_year", { number: 1991 }, { number: 1990 });
    const tabB = await answer(f, "wet_room.build_year", { number: 1992 }, { number: 1990 });
    expect(tabA.status).toBe("saved");
    expect(tabB).toMatchObject({ status: "conflict", current: { number: 1991 } });
    const [row] = await db.select().from(fieldAnswers).where(eq(fieldAnswers.reportId, f.reportId));
    expect(row?.valueNumber).toBe(1991);

    const deviation = await deviationOn(f);
    const text = deviation.deviationText;
    await save(f, {
      table: "deviations",
      id: deviation.id,
      field: "deviation_text",
      value: "Fane A",
      base: text,
    });
    const conflict = await save(f, {
      table: "deviations",
      id: deviation.id,
      field: "deviation_text",
      value: "Fane B",
      base: text,
    });
    expect(conflict).toMatchObject({ status: "conflict", current: "Fane A" });
  });

  it("B4.10 ulike felt på samme avvik fra to faner gir ingen konflikt", async () => {
    const f = await startedBathroom();
    const deviation = await deviationOn(f);
    const a = await save(f, {
      table: "deviations",
      id: deviation.id,
      field: "cause_text",
      value: "Ny årsak",
      base: deviation.causeText,
    });
    const b = await save(f, {
      table: "deviations",
      id: deviation.id,
      field: "consequence_text",
      value: "Ny konsekvens",
      base: deviation.consequenceText,
    });
    expect([a.status, b.status]).toEqual(["saved", "saved"]);
    const [row] = await db.select().from(deviations).where(eq(deviations.id, deviation.id));
    expect(row).toMatchObject({
      causeText: "Ny årsak",
      consequenceText: "Ny konsekvens",
      textSource: "edited",
    });
  });

  it("B4.11 ukjent felt, felt fra annen malversjon, ulovlig tabell eller felt og ugyldige verdier avvises", async () => {
    const f = await startedBathroom();
    const cases: [unknown, string][] = [
      [
        {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.finnes_ikke",
          field: "value",
          value: EMPTY,
          base: EMPTY,
        },
        "unknown_key",
      ],
      [
        { table: "reports", id: uuidv7(), field: "status", value: "published", base: "draft" },
        "invalid_input",
      ],
      [
        { table: "deviations", id: uuidv7(), field: "ai_usage_id", value: uuidv7(), base: null },
        "invalid_input",
      ],
      [
        {
          table: "checkpoint_results",
          checkpointKey: CP.general,
          field: "tg_direct",
          value: "0",
          base: null,
        },
        "invalid_input",
      ],
      [
        {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.membrane_type",
          field: "value",
          value: { ...EMPTY, optionKeys: ["finnes_ikke"] },
          base: EMPTY,
        },
        "invalid_value",
      ],
      [
        {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.membrane_type",
          field: "value",
          value: { ...EMPTY, optionKeys: ["foil", "unknown"] },
          base: EMPTY,
        },
        "invalid_value",
      ],
      [
        {
          table: "field_answers",
          id: uuidv7(),
          elementKey: "wet_room.build_year",
          field: "value",
          value: { ...EMPTY, text: "1990" },
          base: EMPTY,
        },
        "invalid_value",
      ],
      [
        {
          table: "checkpoint_results",
          checkpointKey: "wet_room.finnes_ikke",
          field: "description_text",
          value: "x",
          base: null,
        },
        "unknown_key",
      ],
    ];
    for (const [change, code] of cases) {
      const error = await saveField(
        f.actor,
        f.organizationId,
        f.room,
        change as ReportFieldChange,
      ).catch((e) => e);
      expect(error, JSON.stringify(change)).toBeInstanceOf(ReportValidationError);
      expect(error.code, JSON.stringify(change)).toBe(code);
    }
    const [count] = await db
      .select()
      .from(fieldAnswers)
      .where(eq(fieldAnswers.reportId, f.reportId));
    expect(count).toBeUndefined();
  });

  it("B4.11 arkivert feltkode i en ny malversjon kan ikke brukes i en rapport på den nye versjonen", async () => {
    const { wetRoomTemplate } = await import("@/db/seed/templates/wet-room");
    const { createTemplate, createOrganization } = await import("../../../tests/factories");
    const org = await createOrganization("Arkivert");
    await createTemplate(org.id, {
      status: "published",
      document: {
        ...wetRoomTemplate,
        elements: wetRoomTemplate.elements.filter((e) => e.key !== "wet_room.building_code"),
        element_options: wetRoomTemplate.element_options.filter(
          (o) => o.element_key !== "wet_room.building_code",
        ),
      },
    });
    const f = await startedBathroom({ organizationId: org.id, withTemplate: false });
    const error = await answer(f, "wet_room.building_code", { optionKeys: ["tek10"] }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ReportValidationError);
    expect(error.code).toBe("unknown_key");
  });

  it("B4.13 ai_usage_id kommer aldri fra klienten; en endret verdi tømmer den", async () => {
    const f = await startedBathroom();
    const extra = await saveField(f.actor, f.organizationId, f.room, {
      table: "field_answers",
      id: uuidv7(),
      elementKey: "wet_room.build_year",
      field: "value",
      value: EMPTY,
      base: EMPTY,
      aiUsageId: uuidv7(),
    } as never).catch((e) => e);
    expect(extra).toBeInstanceOf(ReportValidationError);

    const saved = await answer(f, "wet_room.hole_moisture_location", { text: "Bak dusjveggen" });
    if (saved.status !== "saved") throw new Error("ikke lagret");
    const ai = await createAiUsageLog(f.organizationId, {
      reportId: f.reportId,
      targetRef: {
        type: "field_answer",
        id: saved.id,
        fieldKey: "wet_room.hole_moisture_location",
      },
    });
    await db.update(fieldAnswers).set({ aiUsageId: ai.id }).where(eq(fieldAnswers.id, saved.id));
    expect((await startedView(f)).answers.find((a) => a.id === saved.id)?.aiUsageId).toBe(ai.id);
    await answer(
      f,
      "wet_room.hole_moisture_location",
      { text: "Bak dusjveggen, nede" },
      { text: "Bak dusjveggen" },
    );
    const [row] = await db.select().from(fieldAnswers).where(eq(fieldAnswers.id, saved.id));
    expect(row?.aiUsageId).toBeNull();
  });

  it("B4.13 statisk: bare ett sted i src/core/reports skriver ai_usage_id", () => {
    const dir = path.resolve(process.cwd(), "src/core/reports");
    const files = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    const writes = files.flatMap((name) =>
      readFileSync(path.join(dir, name), "utf8")
        .split("\n")
        // Skriving til databasen: `aiUsageId:` med en verdi, ikke typen og ikke lesing til visningen
        .filter(
          (line) =>
            /aiUsageId\s*:/.test(line) &&
            !/aiUsageId\s*:\s*string/.test(line) &&
            !/aiUsageId\s*:\s*a\.aiUsageId/.test(line),
        )
        .map((line) => `${name}: ${line.trim()}`),
    );
    expect(writes).toEqual(["save-field.ts: aiUsageId: ANSWER_AI_USAGE_ON_CHANGE,"]);
  });

  it("B4.12 lengdegrense og fødselsnummer avvises i alle fritekstfelt", async () => {
    const f = await startedBathroom();
    const deviation = await deviationOn(f);
    const measureId = uuidv7();
    await addMeasure(f.actor, f.organizationId, f.room, {
      id: measureId,
      deviationId: deviation.id,
    });
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    const nationalId = "Nr 010190 12345";
    const changes = (value: string): ReportFieldChange[] => [
      {
        table: "deviations",
        id: deviation.id,
        field: "deviation_text",
        value,
        base: deviation.deviationText,
      },
      {
        table: "deviations",
        id: deviation.id,
        field: "cause_text",
        value,
        base: deviation.causeText,
      },
      {
        table: "deviations",
        id: deviation.id,
        field: "consequence_text",
        value,
        base: deviation.consequenceText,
      },
      { table: "deviations", id: deviation.id, field: "cost_text", value, base: null },
      { table: "deviation_measures", id: measureId, field: "text", value, base: "" },
      {
        table: "checkpoint_results",
        checkpointKey: CP.general,
        field: "description_text",
        value,
        base: null,
      },
      ...(
        [
          "reason",
          "alternative_check_method",
          "alternative_check_result",
          "risk_assessment",
          "how_to_examine",
        ] as const
      ).map((field): ReportFieldChange => ({
        table: "tgiu_details",
        checkpointKey: CP.adjacent,
        field,
        value,
        base: null,
      })),
      {
        table: "field_answers",
        id: uuidv7(),
        elementKey: "wet_room.hole_moisture_location",
        field: "value",
        value: { ...EMPTY, text: value },
        base: EMPTY,
      },
    ];
    for (const change of changes(nationalId)) {
      const error = await save(f, change).catch((e) => e);
      expect(error, change.table).toBeInstanceOf(ReportValidationError);
      expect(error.message).toBe("Fødselsnummer skal ikke lagres her.");
    }
    for (const change of changes("x".repeat(10_001))) {
      const error = await save(f, change).catch((e) => e);
      expect(error, change.table).toBeInstanceOf(ReportValidationError);
      expect(error.message).toMatch(/^Teksten kan ha høyst/);
    }
    // Begrunnelsen ved Avvis
    await answerHole(f, "not_done");
    const reasonError = await decideSuggestion(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.notDone,
      decision: "rejected",
      overrideReason: nationalId,
    }).catch((e) => e);
    expect(reasonError).toBeInstanceOf(ReportValidationError);
    const [measure] = await db
      .select()
      .from(deviationMeasures)
      .where(eq(deviationMeasures.id, measureId));
    expect(measure?.text).toBe("");
  });

  it("B4.12 mønsteret ligger ett sted, og tilbudet bruker det felles", () => {
    const orders = readFileSync(path.resolve(process.cwd(), "src/core/orders/schemas.ts"), "utf8");
    expect(orders).toContain('from "@/shared/validation/free-text"');
    expect(orders).not.toMatch(/const ELEVEN_DIGITS/);
    const reportsSchemas = readFileSync(
      path.resolve(process.cwd(), "src/core/reports/schemas.ts"),
      "utf8",
    );
    expect(reportsSchemas).toContain('from "@/shared/validation/free-text"');
  });

  it("B4.36 «Rett nå» T-0059 bytter valget gjennom vanlig lagring, og advarselen forsvinner", async () => {
    const f = await startedBathroom();
    await answerHole(f, "done_no_findings", 15);
    let adjacent = checkpointOf(await startedView(f), CP.adjacent);
    const warning = adjacent.warnings.find((w) => w.code === "no_findings_with_reading_over_limit");
    expect(warning).toBeDefined();
    expect(warningFix(warning!, { decisions: [] })).toEqual({ kind: "change_answer" });

    const auditBefore = (
      await db.select().from(auditLog).where(eq(auditLog.organizationId, f.organizationId))
    ).length;
    const stale = await answer(
      f,
      "wet_room.hole_drilling",
      { optionKeys: ["done_with_findings"] },
      { optionKeys: ["not_done"] },
    );
    expect(stale.status).toBe("conflict");
    const fixed = await answer(
      f,
      "wet_room.hole_drilling",
      { optionKeys: ["done_with_findings"] },
      { optionKeys: ["done_no_findings"] },
    );
    expect(fixed.status).toBe("saved");
    if (fixed.status !== "saved") throw new Error("ikke lagret");
    adjacent = checkpointOf(fixed.refresh, CP.adjacent);
    expect(adjacent.warnings.map((w) => w.code)).not.toContain(
      "no_findings_with_reading_over_limit",
    );
    const auditAfter = (
      await db.select().from(auditLog).where(eq(auditLog.organizationId, f.organizationId))
    ).length;
    expect(auditAfter).toBe(auditBefore + 1);

    // 15 med annen enhet enn vekt-% gir verken forslag eller advarsel (A386)
    const g = await startedBathroom();
    await answerHole(g, "done_no_findings", 15, "relative_humidity");
    const other = checkpointOf(await startedView(g), CP.adjacent);
    expect(other.warnings.map((w) => w.code)).not.toContain("no_findings_with_reading_over_limit");
  });

  it("T-0059 og TGIU-advarselen bygger på serverens regelsvar", async () => {
    const f = await startedBathroom();
    await answerHole(f, "not_done");
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "1",
      base: null,
    });
    const adjacent = checkpointOf(await startedView(f), CP.adjacent);
    expect(adjacent.warnings).toContainEqual(
      expect.objectContaining({ code: "tgiu_suggested_not_set", ruleKey: RULE.notDone }),
    );
  });
});

// --- T-0113, A490: TG på avvik fra et forslag går ikke gjennom lagring per felt -------------------

/** Bad med godtatt TG3-forslag «før 2000» (avvik fra forslag med gjeldende beslutning). */
async function suggestedDeviation(options: Parameters<typeof startedBathroom>[0] = {}) {
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
  return { ...f, deviationId };
}

/** Alt som kan endres av et TG-bytte: avviket, punktet, beslutningene og revisjonsloggen. */
async function snapshot(f: Pick<F, "reportId">, deviationId: string) {
  const [deviation] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
  const results = await db
    .select()
    .from(checkpointResults)
    .where(eq(checkpointResults.reportId, f.reportId));
  const decisions = await db
    .select()
    .from(ruleSuggestionDecisions)
    .where(eq(ruleSuggestionDecisions.reportId, f.reportId));
  const [audit] = await db.select({ n: count() }).from(auditLog);
  return { deviation, results, decisions, audit: audit?.n };
}

function tgChange(deviationId: string, value: 2 | 3 | null, base: 2 | 3 | null): ReportFieldChange {
  return { table: "deviations", id: deviationId, field: "tg", value, base };
}

describe("2c TG på avvik fra forslag i lagring per felt (T-0113)", () => {
  it("FA-I16 saveField med tg på avvik fra godtatt forslag avvises med override_reason, og ingenting lagres", async () => {
    const f = await suggestedDeviation();
    const before = await snapshot(f, f.deviationId);
    for (const [value, base] of [
      [2, 3],
      [null, 3],
      // Også med feil base: avvises før konfliktsjekken, aldri «endret av andre»
      [2, 2],
    ] as const) {
      const error = await save(f, tgChange(f.deviationId, value, base)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ReportValidationError);
      expect((error as ReportValidationError).code).toBe("override_reason");
      expect((error as ReportValidationError).message).toBe(
        "Velg en grunn for å endre TG fra forslaget.",
      );
    }
    expect(await snapshot(f, f.deviationId)).toEqual(before);
  });

  it("FA-I17 saveField med tg på avvik uten forslag lagres uten grunn, som før", async () => {
    const f = await startedBathroom();
    const row = await deviationOn(f);
    const next = row.tg === 2 ? 3 : 2;
    const result = await save(f, tgChange(row.id, next, row.tg));
    expect(result.status).toBe("saved");
    const [after] = await db.select().from(deviations).where(eq(deviations.id, row.id));
    expect(after?.tg).toBe(next);
    const [decisions] = await db.select({ n: count() }).from(ruleSuggestionDecisions);
    expect(decisions?.n).toBe(0);
  });

  it("fjernet avvik fra forslag: saveField gir 404 som før", async () => {
    // Avviket er fjernet: saveField gir 404 som før, og beslutningen er ikke gjeldende
    const f = await suggestedDeviation();
    await removeDeviation(f.actor, f.organizationId, f.room, f.deviationId);
    await expect(save(f, tgChange(f.deviationId, 2, 3))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("FA-I18 andre felt på avvik fra forslag lagres som før, uten grunn og uten ny beslutningsrad", async () => {
    const f = await suggestedDeviation();
    const [row] = await db.select().from(deviations).where(eq(deviations.id, f.deviationId));
    const changes: ReportFieldChange[] = [
      {
        table: "deviations",
        id: f.deviationId,
        field: "cause_text",
        value: "Oppdiktet årsak",
        base: row!.causeText,
      },
      {
        table: "deviations",
        id: f.deviationId,
        field: "cost",
        value: { type: "approx", bandKey: null, amount: 30_000 },
        base: { type: row!.costType, bandKey: row!.costBandKey, amount: row!.costAmount },
      },
    ];
    for (const c of changes) expect((await save(f, c)).status).toBe("saved");
    const decisions = await db
      .select()
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.reportId, f.reportId));
    expect(decisions).toHaveLength(1);
    const [after] = await db.select().from(deviations).where(eq(deviations.id, f.deviationId));
    expect(after).toMatchObject({ causeText: "Oppdiktet årsak", costAmount: 30_000, tg: 3 });
  });
});

describe("2f tenant-isolasjon (saveField for tg med forslagssjekken)", () => {
  it("FA-T4 forslagssjekken i saveField filtrerer på organisasjonen", async () => {
    const byOrg = new Map<string, Awaited<ReturnType<typeof suggestedDeviation>>>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await suggestedDeviation({ organizationId: grantA.organizationId });
        const b = await suggestedDeviation({ organizationId: grantB.organizationId });
        byOrg.set(grantA.organizationId, a);
        byOrg.set(grantB.organizationId, b);
        return { a: [a.deviationId], b: [b.deviationId] };
      },
      query: async (actor, organizationId) => {
        // Mot en fremmed organisasjon brukes et avvik fra den andre; tilgangen stopper før oppslaget
        const own = byOrg.get(organizationId) ?? [...byOrg.values()][0]!;
        try {
          await saveField(actor, organizationId, own.room, tgChange(own.deviationId, 2, 3));
        } catch (error) {
          // Egen organisasjon: forslaget ble funnet, og TG-bytte uten grunn er avvist
          if (error instanceof ReportValidationError && error.code === "override_reason") {
            const [row] = await db
              .select({ id: deviations.id })
              .from(deviations)
              .where(
                and(
                  eq(deviations.id, own.deviationId),
                  eq(deviations.organizationId, organizationId),
                ),
              );
            return row ? [row.id] : [];
          }
          throw error;
        }
        return [];
      },
      idOf: (id) => id,
    });
  });

  it("FA-T6 avvik fra en annen organisasjon gir 404, aldri override_reason eller conflict, og B er urørt", async () => {
    const a = await suggestedDeviation();
    const b = await suggestedDeviation();
    const bBefore = await snapshot(b, b.deviationId);
    for (const [value, base] of [
      [2, 3],
      [2, 2],
    ] as const) {
      await expect(save(a, tgChange(b.deviationId, value, base))).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(save(a, tgChange(uuidv7(), value, base))).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
    const after = await snapshot(b, b.deviationId);
    expect(after.deviation).toEqual(bBefore.deviation);
    expect(after.decisions).toEqual(bBefore.decisions);
  });
});
