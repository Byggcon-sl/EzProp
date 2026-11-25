import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// FA-I39: spion på inngangene til KI-modulen. Rapportkjernen skal aldri kalle dem.
const aiSpies = vi.hoisted(() => ({
  requestSuggestion: vi.fn(),
  recordDecision: vi.fn(),
  checkAiTextApproved: vi.fn(),
}));
vi.mock("@/core/ai", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...aiSpies,
}));

import {
  addDeviation,
  addMeasure,
  applyReviewedTexts,
  decideSuggestion,
  removeDeviation,
  ReportStorageError,
  restoreDeviation,
  saveField,
  setTgDirect,
  type ReportFieldChange,
} from "@/core/reports";
import { db } from "@/db/client";
import { aiUsageLog, auditLog, deviations, reports, ruleSuggestionDecisions } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
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

// --- Rett forslag og avvik: KI og sletting (rett-forslag-og-avvik-testplan.md 2g) ---------------

describe("rett-forslag-og-avvik 2g: ingen KI og ingen sletting", () => {
  it("FA-I39–I41 Godta, Endre, Avvis, already_decided, fjern og Angre: ingen KI-kall, ingen ai_usage_log, ingenting slettet", async () => {
    const f = await startedBathroom();
    await answerMembrane1990(f);
    const first = uuidv7();
    const decideOnce = (input: Record<string, unknown>) =>
      decideSuggestion(f.actor, f.organizationId, f.room, {
        id: uuidv7(),
        ruleKey: RULE.before2000,
        ...input,
      } as Parameters<typeof decideSuggestion>[3]);

    expect((await decideOnce({ decision: "accepted", deviationId: first })).status).toBe("saved");
    // already_decided (Endre og Avvis etter Godta)
    expect(
      (
        await decideOnce({
          decision: "changed",
          chosenTg: "2",
          overrideReasonCode: "other",
          overrideReason: MARKER,
        })
      ).status,
    ).toBe("already_decided");
    expect(
      (await decideOnce({ decision: "rejected", overrideReasonCode: "documentation_present" }))
        .status,
    ).toBe("already_decided");
    await removeDeviation(f.actor, f.organizationId, f.room, first);
    const second = uuidv7();
    expect(
      (
        await decideOnce({
          decision: "changed",
          chosenTg: "2",
          overrideReasonCode: "other",
          overrideReason: MARKER,
          deviationId: second,
        })
      ).status,
    ).toBe("saved");
    expect(
      (await restoreDeviation(f.actor, f.organizationId, f.room, { deviationId: first })).status,
    ).toBe("newer_decision");
    await removeDeviation(f.actor, f.organizationId, f.room, second);
    expect(
      (await decideOnce({ decision: "rejected", overrideReasonCode: "documentation_present" }))
        .status,
    ).toBe("saved");

    for (const spy of Object.values(aiSpies)) expect(spy).not.toHaveBeenCalled();
    expect(
      await db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, f.organizationId)),
    ).toEqual([]);
    // Fjernede avvik står mykt slettet; beslutningsradene står alle
    const rows = await db.select().from(deviations).where(eq(deviations.reportId, f.reportId));
    expect(rows.map((r) => r.id).sort()).toEqual([first, second].sort());
    expect(rows.every((r) => r.deletedAt !== null)).toBe(true);
    const decisions = await db
      .select()
      .from(ruleSuggestionDecisions)
      .where(eq(ruleSuggestionDecisions.reportId, f.reportId));
    expect(decisions.map((d) => d.decision)).toEqual(["accepted", "changed", "rejected"]);
    // Begrunnelsesteksten står i raden, aldri i revisjonsloggen
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, f.organizationId));
    expect(JSON.stringify(audit)).not.toContain(MARKER);
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

describe("GT3.36 applyReviewedTexts: ingen tekst i logg, feil eller revisjonslogg", () => {
  /** Oppdiktet merke i før- og ettertekstene. Skal aldri stå i noen logg eller feilmelding. */
  const MERKE = "Mxq-merke-ÆØ";

  it("lagring, avslag og feil gir bare id-er, feltkoder og antall", async () => {
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
    await db
      .update(deviations)
      .set({ causeText: `før ${MERKE}`, consequenceText: `før ${MERKE}` })
      .where(eq(deviations.id, deviationId));
    const [deviation] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const rowVersion = deviation!.rowVersion;
    const row = (fieldKey: string) =>
      createAiUsageLog(f.organizationId, {
        employeeId: f.employeeId,
        assignmentId: f.assignmentId,
        reportId: f.reportId,
        targetRef: { type: "deviation", id: deviationId, fieldKey },
        outputText: `Etter ${MERKE}.`,
      });
    const cause = await row("cause_text");
    const consequence = await row("consequence_text");
    const errors: Error[] = [];
    const attempt = async (input: Parameters<typeof applyReviewedTexts>[3]) => {
      try {
        await applyReviewedTexts(f.actor, f.organizationId, f.room, input);
      } catch (error) {
        errors.push(error as Error);
      }
    };

    // Avslag: elleve sifre i teksten, fremmed id og publisert rapport
    await attempt({
      choices: [{ usageId: cause.id, choice: "edit", text: `${MERKE} 010190 12345`, rowVersion }],
    });
    await attempt({ choices: [{ usageId: uuidv7(), choice: "use", rowVersion }] });
    // Lagret: «Bruk» og «Rett før bruk»
    await attempt({
      choices: [
        { usageId: cause.id, choice: "use", rowVersion },
        { usageId: consequence.id, choice: "edit", text: `Egen ${MERKE}`, rowVersion },
      ],
    });
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, f.reportId));
    await attempt({
      choices: [{ usageId: cause.id, choice: "undo", text: `før ${MERKE}`, rowVersion }],
    });

    expect(errors).toHaveLength(3);
    for (const error of errors) expect(error.message).not.toContain(MERKE);
    expect(logged(spies)).not.toContain(MERKE);
    const audit = await db.select().from(auditLog);
    expect(audit.filter((a) => a.action === "ai_review")).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(MERKE);
    expect((await db.select().from(aiUsageLog)).map((r) => r.status).sort()).toEqual([
      "accepted",
      "edited",
    ]);
  });
});

describe("B4.28 statisk", () => {
  it("B4.28 ingen tjeneste i src/core/reports kjører delete", () => {
    const offenders = sourceFiles(REPORTS_DIR).filter((file) =>
      /\.delete\(|\bdelete\s+from\b/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  // B4.28 «src/core/reports importerer ikke src/core/ai» er fjernet med vilje i «KI i veien»
  // (docs/funksjoner/fase2a-ki-i-veien.md Omfang): rapportkjernen kaller nå KI gjennom
  // `src/core/ai`. Erstattet av K2.8: TG kommer bare fra regelmotoren og takstmannen.
  it("K2.8 en fil i src/core/reports som kaller KI, skriver aldri TG", () => {
    const writesTg =
      /\.(?:set|values)\(\s*\{[^}]*\b(?:tg|tgDirect|chosenTg)\s*:|writeTgDirect\(|createDeviationFromOutcome\(|swapMeasuresForTg\(/s;
    const callsAi = /\b(?:requestSuggestion|requestSuggestionBatch)\s*\(/;
    const offenders = sourceFiles(REPORTS_DIR).filter((file) => {
      const text = readFileSync(file, "utf8");
      return callsAi.test(text) && writesTg.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("K2.8 KI-svaret brukes aldri som TG: ingen tg-verdi hentes fra et resultat fra KI", () => {
    for (const file of sourceFiles(REPORTS_DIR)) {
      const text = readFileSync(file, "utf8");
      if (!/from\s+["']@\/core\/ai["']/.test(text)) continue;
      // Et KI-svar har `text`, `candidates` eller `guard`, aldri TG. Ingen tg-felt leses fra det.
      expect(text, file).not.toMatch(/\b(?:result|answer|suggestion|ai)\w*\.tg\b/i);
    }
  });

  it("K2.8 src/core/ai importerer aldri @/core/reports eller @/core/templates", () => {
    const aiDir = path.resolve(process.cwd(), "src/core/ai");
    for (const file of sourceFiles(aiDir)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["']@\/core\/(reports|templates)(\/[^"']*)?["']/);
      expect(text, file).not.toMatch(/import\(\s*["']@\/core\/(reports|templates)/);
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
