import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addDeviation,
  addMeasure,
  decideSuggestion,
  ReportStorageError,
  saveField,
  setTgDirect,
  type ReportFieldChange,
} from "@/core/reports";
import { db } from "@/db/client";
import { auditLog, deviations, ruleSuggestionDecisions } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../tests/factories";
import {
  answer,
  answerHole,
  answerMembrane1990,
  CP,
  RULE,
  startedBathroom,
} from "../../../tests/report-fixtures";

/*
 * Logg, personvern og statiske sjekker (docs/funksjoner/fase2a-badet-pc-testplan.md 4e: B4.26–B4.28).
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

/** En oppdiktet markør som aldri skal finnes i noen logg. */
const MARKER = "MARKØR-fritekst-7Q";

function spyLogger() {
  return [
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function logged(spies: ReturnType<typeof spyLogger>): string {
  return JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_key, value) =>
      value instanceof Error ? { name: value.name, message: value.message } : value,
  );
}

describe("4e logg og personvern", () => {
  it("B4.26 fritekstmarkøren finnes ikke i revisjonsloggen, applikasjonsloggen eller regelsvaret", async () => {
    const spies = spyLogger();
    const f = await startedBathroom();
    const deviationId = uuidv7();
    await addDeviation(f.actor, f.organizationId, f.room, {
      id: deviationId,
      checkpointKey: "wet_room.ventilation",
      questionKey: "wet_room.ventilation.missing_ventilation",
      outcomeKey: "tg3",
      tg: null,
    });
    const [deviation] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const measureId = uuidv7();
    await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.adjacent,
      tgDirect: "IU",
      base: null,
    });
    const changes: ReportFieldChange[] = [
      {
        table: "deviations",
        id: deviationId,
        field: "deviation_text",
        value: MARKER,
        base: deviation!.deviationText,
      },
      {
        table: "deviations",
        id: deviationId,
        field: "cause_text",
        value: MARKER,
        base: deviation!.causeText,
      },
      {
        table: "deviations",
        id: deviationId,
        field: "consequence_text",
        value: MARKER,
        base: deviation!.consequenceText,
      },
      { table: "deviations", id: deviationId, field: "cost_text", value: MARKER, base: null },
      { table: "deviation_measures", id: measureId, field: "text", value: MARKER, base: "" },
      {
        table: "checkpoint_results",
        checkpointKey: CP.general,
        field: "description_text",
        value: MARKER,
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
        value: MARKER,
        base: null,
      })),
    ];
    for (const change of changes) {
      expect((await saveField(f.actor, f.organizationId, f.room, change)).status).toBe("saved");
    }
    await answer(f, "wet_room.hole_moisture_location", { text: MARKER });
    await answerMembrane1990(f);
    await decideSuggestion(f.actor, f.organizationId, f.room, {
      id: uuidv7(),
      ruleKey: RULE.before2000,
      decision: "rejected",
      overrideReasonCode: "other",
      overrideReason: MARKER,
    });

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, f.organizationId));
    expect(audit.length).toBeGreaterThan(changes.length);
    expect(JSON.stringify(audit)).not.toContain(MARKER);
    // Revisjonsradene har bare id-er, koder, feltkoder, TG og tall
    for (const row of audit) {
      for (const value of Object.values(row.changes as Record<string, unknown>)) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          expect(["string", "number", "boolean"].includes(typeof item) || item === null).toBe(true);
          if (typeof item === "string") expect(item).toMatch(/^[a-z0-9_.\-]+$/i);
        }
      }
    }
    const [decision] = await db
      .select()
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.reportId, f.reportId));
    expect(decision?.overrideReason).toBe(MARKER);
    expect(JSON.stringify(decision?.reasons)).not.toContain(MARKER);
    expect(JSON.stringify(decision?.suggestion)).not.toContain(MARKER);
    expect(logged(spies)).not.toContain(MARKER);
  });

  it("B4.27 en databasefeil logger verken feltverdi eller parametre, og feilen har fast melding", async () => {
    const f = await startedBathroom();
    await answerHole(f, "not_done");
    const spies = spyLogger();
    // En databasefeil med feltverdien i meldingen, slik ekte feil kan ha den
    await db.execute(sql`
      create or replace function test_fail_field_answer() returns trigger as $$
      begin
        raise exception 'avvist: %', new.value_text using errcode = 'XX000';
      end $$ language plpgsql`);
    await db.execute(
      sql`create trigger test_fail_field_answer before insert on field_answers for each row execute function test_fail_field_answer()`,
    );
    let error: unknown;
    try {
      error = await answer(f, "wet_room.hole_moisture_location", { text: MARKER }).catch((e) => e);
    } finally {
      await db.execute(sql`drop trigger test_fail_field_answer on field_answers`);
      await db.execute(sql`drop function test_fail_field_answer()`);
    }
    expect(error).toBeInstanceOf(ReportStorageError);
    expect((error as Error).message).not.toContain(MARKER);
    expect(logged(spies)).not.toContain(MARKER);
    expect(spies[3]?.mock.calls.length).toBe(1);
  });
});

// --- B4.28 Statiske sjekker -------------------------------------------------------------------

const REPORTS_DIR = path.resolve(process.cwd(), "src/core/reports");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("B4.28 statisk", () => {
  it("B4.28 ingen tjeneste i src/core/reports kjører delete", () => {
    const offenders = sourceFiles(REPORTS_DIR).filter((file) =>
      /\.delete\(|\bdelete\s+from\b/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  // Gjelder til «KI i veien»: da skal rapportkjernen kalle KI gjennom `src/core/ai`, og denne
  // testen fjernes med vilje i den oppgaven, ikke ved et uhell.
  it("B4.28 src/core/reports importerer ikke src/core/ai og kaller ikke requestSuggestion", () => {
    for (const file of sourceFiles(REPORTS_DIR)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'](@\/core\/ai|(\.\.\/)+ai)(\/[^"']*)?["']/);
      expect(text, file).not.toMatch(/import\(\s*["']@\/core\/ai/);
      expect(text, file).not.toContain("requestSuggestion");
    }
  });

  it("B4.28 klientkomponenter under rommet importerer bare @/core/reports/logic, ikke indeksen", () => {
    const route = path.resolve(process.cwd(), "src/app/(ansatt)/oppdrag/[id]/rom");
    if (!existsSync(route)) return;
    for (const file of sourceFiles(route)) {
      const text = readFileSync(file, "utf8");
      if (!/^["']use client["']/m.test(text)) continue;
      expect(text, file).not.toMatch(/from\s+["']@\/core\/reports["']/);
    }
  });
});
