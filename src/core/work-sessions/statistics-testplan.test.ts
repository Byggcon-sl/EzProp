import { describe, expect, it } from "vitest";
import {
  secondsToDisplayMinutes,
  summarizeTimeStatistics,
  WORK_PHASES,
  type TimeStatisticsRow,
  type TimeTrackingBaseline,
  type WorkPhase,
} from "./index";

/*
 * Utregningen i statistikken (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 4, A124).
 * Ren funksjon, sekunder inn og fasitsvar ut. Oppdiktet måling: oppdrag «X», «Y» og «Z».
 *
 * Støtter hovedmål: tid (snittet regnes likt hver gang, så sammenligningen med IVIT holder) og
 * arbeidsmiljøloven kapittel 9 (svaret har ingen felt om den ansatte).
 */

const SOURCE = "Oppdiktet måling, 3 oppdrag";

function baseline(minutes: Partial<Record<WorkPhase, number>>): TimeTrackingBaseline {
  return { preparation: 0, inspection: 0, office: 0, delivery: 0, source: SOURCE, ...minutes };
}

function phase(summary: ReturnType<typeof summarizeTimeStatistics>, code: WorkPhase) {
  const row = summary.phases.find((candidate) => candidate.phase === code);
  if (!row) throw new Error(`mangler fasen ${code}`);
  return row;
}

const FASIT_ROWS: TimeStatisticsRow[] = [
  { assignmentId: "X", phase: "preparation", seconds: 600 },
  { assignmentId: "X", phase: "inspection", seconds: 3600 },
  { assignmentId: "Y", phase: "office", seconds: 1800 },
  { assignmentId: "Y", phase: "delivery", seconds: 300 },
];

type Case = {
  name: string;
  rows: TimeStatisticsRow[];
  count: number;
  averages: Record<WorkPhase, number>;
  total: number;
};

const CASES: Case[] = [
  {
    name: "4.1 fasitsvar X og Y",
    rows: FASIT_ROWS,
    count: 2,
    averages: { preparation: 300, inspection: 1800, office: 900, delivery: 150 },
    total: 3150,
  },
  {
    name: "4.3 fase uten økt bidrar med 0, nevneren er antall oppdrag",
    rows: [
      { assignmentId: "X", phase: "office", seconds: 1200 },
      { assignmentId: "Y", phase: "office", seconds: 600 },
      { assignmentId: "Z", phase: "preparation", seconds: 900 },
    ],
    count: 3,
    averages: { preparation: 300, inspection: 0, office: 600, delivery: 0 },
    total: 900,
  },
  {
    name: "ett oppdrag, alle faser",
    rows: [
      { assignmentId: "X", phase: "preparation", seconds: 60 },
      { assignmentId: "X", phase: "inspection", seconds: 120 },
      { assignmentId: "X", phase: "office", seconds: 180 },
      { assignmentId: "X", phase: "delivery", seconds: 240 },
    ],
    count: 1,
    averages: { preparation: 60, inspection: 120, office: 180, delivery: 240 },
    total: 600,
  },
];

describe("summarizeTimeStatistics (A124)", () => {
  it.each(CASES)("$name", ({ rows, count, averages, total }) => {
    const summary = summarizeTimeStatistics(rows, null);
    expect(summary.assignmentCount).toBe(count);
    expect(summary.phases.map((row) => row.phase)).toEqual([...WORK_PHASES]);
    for (const code of WORK_PHASES)
      expect(phase(summary, code).averageSeconds).toBe(averages[code]);
    expect(summary.total.averageSeconds).toBe(total);
  });

  it.each(CASES)("4.2 totalt = summen av snittene ($name)", ({ rows }) => {
    const summary = summarizeTimeStatistics(rows, baseline({ office: 10 }));
    const sum = summary.phases.reduce((acc, row) => acc + row.averageSeconds, 0);
    expect(summary.total.averageSeconds).toBeCloseTo(sum, 9);
  });

  it.each([
    { name: "30 mot 60 → −50", seconds: 30 * 60, minutes: 60, expected: -50 },
    { name: "90 mot 60 → +50", seconds: 90 * 60, minutes: 60, expected: 50 },
    { name: "20 mot 30 → −33 (avrundet)", seconds: 20 * 60, minutes: 30, expected: -33 },
    { name: "60 mot 60 → 0", seconds: 60 * 60, minutes: 60, expected: 0 },
  ])("4.4 forskjell med fortegn: $name", ({ seconds, minutes, expected }) => {
    const summary = summarizeTimeStatistics(
      [{ assignmentId: "X", phase: "office", seconds }],
      baseline({ office: minutes }),
    );
    const difference = phase(summary, "office").differencePercent;
    expect(difference).toBe(expected);
    expect(Object.is(difference, -0)).toBe(false);
  });

  it.each([
    { name: "nullpunkt mangler", base: null },
    { name: "nullpunkt 0 i fasen", base: baseline({ preparation: 10 }) },
  ])("4.5 $name → null, aldri Infinity eller NaN", ({ base }) => {
    const summary = summarizeTimeStatistics(FASIT_ROWS, base);
    const office = phase(summary, "office");
    expect(office.differencePercent).toBeNull();
    if (base === null) {
      expect(office.baselineMinutes).toBeNull();
      expect(summary.total.differencePercent).toBeNull();
    }
    for (const row of [...summary.phases, summary.total]) {
      if (row.differencePercent !== null) expect(Number.isFinite(row.differencePercent)).toBe(true);
    }
  });

  it("4.6 totalt-nullpunktet er summen av fasene", () => {
    const summary = summarizeTimeStatistics(
      FASIT_ROWS,
      baseline({ preparation: 10, inspection: 50, office: 30, delivery: 15 }),
    );
    expect(summary.total.baselineMinutes).toBe(105);
    // 3 150 s = 52,5 min mot 105 → −50
    expect(summary.total.differencePercent).toBe(-50);
  });

  it("4.6 totalt-nullpunktet er 0 → null", () => {
    const summary = summarizeTimeStatistics(FASIT_ROWS, baseline({}));
    expect(summary.total.baselineMinutes).toBe(0);
    expect(summary.total.differencePercent).toBeNull();
  });

  it.each([
    { name: "uten nullpunkt", base: null },
    { name: "med nullpunkt", base: baseline({ preparation: 10, office: 20 }) },
  ])("4.7 ingen oppdrag som telles: tomt resultat, ingen deling på 0 ($name)", ({ base }) => {
    const summary = summarizeTimeStatistics([], base);
    expect(summary.assignmentCount).toBe(0);
    for (const row of [...summary.phases, summary.total]) {
      expect(row.averageSeconds).toBe(0);
      expect(row.differencePercent).toBeNull();
    }
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity/);
  });

  it.each([
    [0, 0],
    [29, 0],
    [89, 1],
    [90, 2],
    [91, 2],
    [3150, 53],
  ])("4.8 %i s vises som %i minutter", (seconds, minutes) => {
    expect(secondsToDisplayMinutes(seconds)).toBe(minutes);
  });

  it("4.8 utregningen er i sekunder (89 s og 91 s gir snitt 90 s, ikke 1,5 minutt avrundet før)", () => {
    const summary = summarizeTimeStatistics(
      [
        { assignmentId: "X", phase: "office", seconds: 89 },
        { assignmentId: "Y", phase: "office", seconds: 91 },
      ],
      null,
    );
    expect(phase(summary, "office").averageSeconds).toBe(90);
  });

  it("4.9 svaret har bare faste nøkler og ingen ansattfelt", () => {
    const summary = summarizeTimeStatistics(FASIT_ROWS, baseline({ office: 30 }));
    expect(Object.keys(summary).sort()).toEqual(["assignmentCount", "phases", "total"]);
    for (const row of summary.phases) {
      expect(Object.keys(row).sort()).toEqual([
        "averageSeconds",
        "baselineMinutes",
        "differencePercent",
        "phase",
      ]);
    }
    expect(Object.keys(summary.total).sort()).toEqual([
      "averageSeconds",
      "baselineMinutes",
      "differencePercent",
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/employee|name|user|email|person/i);
  });

  it("4.9 oppdrags-id-ene kommer ikke med i svaret", () => {
    const summary = summarizeTimeStatistics(
      [{ assignmentId: "oppdrag-hemmelig-id", phase: "office", seconds: 60 }],
      null,
    );
    expect(JSON.stringify(summary)).not.toContain("oppdrag-hemmelig-id");
  });
});
