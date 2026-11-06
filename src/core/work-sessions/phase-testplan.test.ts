import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "@/core/assignments/codes";
import { TEST_NOW } from "../../../tests/factories";
import { phaseForAssignment, WORK_PHASES, type WorkPhase } from "./index";

/*
 * Faseregelen (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 1, A119). Regeltest som data:
 * én rad per tilfelle. `now` er fast: TEST_NOW = 03.11.2026 kl. 10:00 UTC = 11:00 Oslo-tid.
 *
 * Støtter hovedmål: tid (fasen blir riktig uten et eneste trykk, så sammenligningen med IVIT er
 * til å stole på).
 */

type Case = {
  name: string;
  status: AssignmentStatus;
  inspectionAt: string | null;
  now?: string;
  expected: WorkPhase;
};

const YESTERDAY = "2026-11-02T13:00:00Z"; // 02.11 14:00 Oslo
const TODAY_MORNING = "2026-11-03T07:00:00Z"; // 03.11 08:00 Oslo
const TODAY_AFTERNOON = "2026-11-03T14:00:00Z"; // 03.11 15:00 Oslo
const TOMORROW = "2026-11-04T08:00:00Z"; // 04.11 09:00 Oslo
const INSPECTION_VARIANTS: { label: string; at: string | null }[] = [
  { label: "tom befaring", at: null },
  { label: "befaring i går", at: YESTERDAY },
  { label: "befaring i dag før nå", at: TODAY_MORNING },
  { label: "befaring i dag etter nå", at: TODAY_AFTERNOON },
  { label: "befaring i morgen", at: TOMORROW },
];

const CASES: Case[] = [
  // 1.1 bestilt er alltid forberedelse
  ...INSPECTION_VARIANTS.map((variant): Case => ({
    name: `1.1 ordered, ${variant.label}`,
    status: "ordered",
    inspectionAt: variant.at,
    expected: "preparation",
  })),
  // 1.2 og 1.3
  {
    name: "1.2 in_progress, tom befaring",
    status: "in_progress",
    inspectionAt: null,
    expected: "preparation",
  },
  {
    name: "1.3 in_progress, befaring i morgen",
    status: "in_progress",
    inspectionAt: TOMORROW,
    expected: "preparation",
  },
  // 1.4 befaringsdagen, før og etter klokkeslettet
  {
    name: "1.4 in_progress, befaring i dag 08:00",
    status: "in_progress",
    inspectionAt: TODAY_MORNING,
    expected: "inspection",
  },
  {
    name: "1.4 in_progress, befaring i dag 15:00",
    status: "in_progress",
    inspectionAt: TODAY_AFTERNOON,
    expected: "inspection",
  },
  // 1.5
  {
    name: "1.5 in_progress, befaring i går",
    status: "in_progress",
    inspectionAt: YESTERDAY,
    expected: "office",
  },
  // 1.6 ferdig og fakturert er alltid levering
  ...(["completed", "invoiced"] as const).flatMap((status) =>
    INSPECTION_VARIANTS.map((variant): Case => ({
      name: `1.6 ${status}, ${variant.label}`,
      status,
      inspectionAt: variant.at,
      expected: "delivery",
    })),
  ),
  // 1.7 befaring rundt midnatt Oslo-tid
  {
    name: "1.7 befaring 03.11 00:30 Oslo (02.11 23:30 UTC)",
    status: "in_progress",
    inspectionAt: "2026-11-02T23:30:00Z",
    expected: "inspection",
  },
  {
    name: "1.7 befaring 02.11 23:59 Oslo (02.11 22:59 UTC)",
    status: "in_progress",
    inspectionAt: "2026-11-02T22:59:00Z",
    expected: "office",
  },
  // 1.8 now rundt midnatt Oslo-tid, befaring 03.11 09:00 Oslo
  {
    name: "1.8 now 03.11 23:59 Oslo",
    status: "in_progress",
    inspectionAt: "2026-11-03T08:00:00Z",
    now: "2026-11-03T22:59:00Z",
    expected: "inspection",
  },
  {
    name: "1.8 now 04.11 00:01 Oslo",
    status: "in_progress",
    inspectionAt: "2026-11-03T08:00:00Z",
    now: "2026-11-03T23:01:00Z",
    expected: "office",
  },
  // 1.9 sommertid (UTC+2): 15.06 00:30 Oslo er 14.06 i UTC
  {
    name: "1.9 sommertid, befaring 15.06 00:30 Oslo",
    status: "in_progress",
    inspectionAt: "2026-06-14T22:30:00Z",
    now: "2026-06-15T08:00:00Z",
    expected: "inspection",
  },
];

describe("phaseForAssignment (A119)", () => {
  it.each(CASES)("$name → $expected", ({ status, inspectionAt, now, expected }) => {
    const result = phaseForAssignment(
      { status, inspectionAt: inspectionAt === null ? null : new Date(inspectionAt) },
      now ? new Date(now) : TEST_NOW,
    );
    expect(result).toBe(expected);
  });

  it("1.10 tabellen har minst én testsak for hver status", () => {
    const covered = new Set(CASES.map((testCase) => testCase.status));
    for (const status of ASSIGNMENT_STATUSES) {
      expect(covered.has(status), `mangler testsak for status ${status}`).toBe(true);
    }
  });

  it("1.11 resultatet er alltid en kode i WORK_PHASES", () => {
    expect([...WORK_PHASES]).toEqual(["preparation", "inspection", "office", "delivery"]);
    for (const status of ASSIGNMENT_STATUSES) {
      for (const variant of INSPECTION_VARIANTS) {
        const result = phaseForAssignment(
          { status, inspectionAt: variant.at === null ? null : new Date(variant.at) },
          TEST_NOW,
        );
        expect(WORK_PHASES).toContain(result);
      }
    }
  });

  it("phaseForAssignment endrer ikke datoene som sendes inn", () => {
    const inspectionAt = new Date(TODAY_MORNING);
    const now = new Date(TEST_NOW);
    phaseForAssignment({ status: "in_progress", inspectionAt }, now);
    expect(inspectionAt.getTime()).toBe(new Date(TODAY_MORNING).getTime());
    expect(now.toISOString()).toBe(TEST_NOW.toISOString());
  });
});
