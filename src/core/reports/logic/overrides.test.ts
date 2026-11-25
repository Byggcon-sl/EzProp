import { describe, expect, it } from "vitest";
import {
  AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH,
  AI_OVERRIDE_SHARE_MIN_REPORTS,
  AI_OVERRIDE_STATS_MAX_ROWS,
} from "@/core/ai/limits";
import { PUBLISH_BLOCKER_CODES, PUBLISH_OVERRIDE_REASON_CODES } from "@/db/schema";
import {
  PUBLISH_BLOCKER_LABELS,
  PUBLISH_OVERRIDE_REASON_LABELS,
  publishCheckLabel,
  publishOverrideReasonLabel,
  UNKNOWN_OVERRIDE_REASON_LABEL,
  UNKNOWN_PUBLISH_CHECK_LABEL,
} from "@/shared/config/publish-check-labels";
import {
  buildOverrideSummaryInput,
  overrideStatsSchema,
  type OverrideCountRow,
} from "../override-stats-input";
import {
  computeOverrideShare,
  isOverrideSummaryMonth,
  OVERRIDE_SHARE_MIN_REPORTS,
  overrideListFromDate,
  overrideSummaryMonths,
  shiftMonth,
} from "./overrides";

/*
 * Enhetstester for tellingen (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt 1a).
 * Støtter hovedmål: KI i bunnen (serveren regner tallene, grunnlaget er strengt) og færre
 * reklamasjoner (riktig andel uten deling på null). Oppdiktede tall.
 */

function row(overrides: Partial<OverrideCountRow> = {}): OverrideCountRow {
  return {
    checkCode: "wet_or_below_ground_missing_hole",
    checkpointKey: "wet_room.membrane_drain",
    checkpointName: "Membran og sluk",
    reasonCode: "no_access_or_refused",
    count: 7,
    claimCount: 2,
    previousCount: 2,
    ...overrides,
  };
}

describe("O1.1 computeOverrideShare", () => {
  it("7 av 18 gir 39 (hele prosent, avrundet til nærmeste)", () => {
    expect(computeOverrideShare(7, 18)).toBe(39);
  });

  it("0 rapporter gir null uten deling på null", () => {
    expect(computeOverrideShare(0, 0)).toBeNull();
  });

  it("4 rapporter gir null (bare antall), 5 gir prosent (grensen)", () => {
    expect(computeOverrideShare(2, 4)).toBeNull();
    expect(computeOverrideShare(2, 5)).toBe(40);
  });

  it("grensen er samme tall som i KI-modulen", () => {
    expect(OVERRIDE_SHARE_MIN_REPORTS).toBe(AI_OVERRIDE_SHARE_MIN_REPORTS);
  });
});

describe("O1.2 endring fra måneden før", () => {
  it("økning gir positivt antall og prosentpoeng", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 18,
      previousReportCount: 10,
      rows: [row({ count: 7, previousCount: 2 })],
    });
    expect(stats.rows[0]).toMatchObject({
      count: 7,
      sharePercent: 39,
      previousCount: 2,
      previousSharePercent: 20,
      deltaCount: 5,
      deltaPoints: 19,
    });
  });

  it("nedgang gir negativt antall og prosentpoeng", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 10,
      rows: [row({ count: 1, previousCount: 4, claimCount: 0 })],
    });
    expect(stats.rows[0]).toMatchObject({ deltaCount: -3, deltaPoints: -30 });
  });

  it("likt gir null endring", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 10,
      rows: [row({ count: 3, previousCount: 3 })],
    });
    expect(stats.rows[0]).toMatchObject({ deltaCount: 0, deltaPoints: 0 });
  });

  it("ny kode som ikke fantes måneden før gir previousCount 0", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 8,
      rows: [row({ count: 2, previousCount: 0 })],
    });
    expect(stats.rows[0]).toMatchObject({
      previousCount: 0,
      previousSharePercent: 0,
      deltaCount: 2,
      deltaPoints: 20,
    });
  });

  it("måneden før under 5 rapporter gir previousSharePercent og deltaPoints null", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 4,
      rows: [row({ count: 2, previousCount: 1 })],
    });
    expect(stats.rows[0]).toMatchObject({
      sharePercent: 20,
      previousSharePercent: null,
      deltaCount: 1,
      deltaPoints: null,
    });
  });

  it("under 5 rapporter i måneden gir bare antall", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 4,
      previousReportCount: 10,
      rows: [row({ count: 2, previousCount: 1 })],
    });
    expect(stats.rows[0]).toMatchObject({ sharePercent: null, deltaPoints: null });
    expect(stats).toMatchObject({
      month: "2026-10",
      reportCount: 4,
      previousMonth: { reportCount: 10 },
    });
  });
});

describe("O1.3 buildOverrideSummaryInput", () => {
  it.each(["overrideReason", "employeeName", "assignmentId"])(
    "avviser ukjent nøkkel %s i en linje (zod strict)",
    (key) => {
      expect(() =>
        buildOverrideSummaryInput({
          month: "2026-10",
          reportCount: 10,
          previousReportCount: 10,
          rows: [{ ...row(), [key]: "Mxq-grunn-ÆØ" } as OverrideCountRow],
        }),
      ).toThrow();
    },
  );

  it("avviser ukjent nøkkel på øverste nivå", () => {
    expect(() =>
      buildOverrideSummaryInput({
        month: "2026-10",
        reportCount: 10,
        previousReportCount: 10,
        rows: [],
        employeeName: "Mxqline Testesen",
      } as never),
    ).toThrow();
  });

  it.each(["hull i våtrom", "våtrom", "a".repeat(101), "Mxq-grunn-ÆØ", "WET_ROOM"])(
    "avviser kode som ikke følger kodemønsteret: %s",
    (code) => {
      expect(() =>
        buildOverrideSummaryInput({
          month: "2026-10",
          reportCount: 10,
          previousReportCount: 10,
          rows: [row({ checkCode: code })],
        }),
      ).toThrow();
      expect(() =>
        buildOverrideSummaryInput({
          month: "2026-10",
          reportCount: 10,
          previousReportCount: 10,
          rows: [row({ checkpointKey: code })],
        }),
      ).toThrow();
    },
  );

  it.each([1.5, -1, "7", Number.NaN])("avviser tall som ikke er heltall fra 0: %s", (value) => {
    expect(() =>
      buildOverrideSummaryInput({
        month: "2026-10",
        reportCount: 10,
        previousReportCount: 10,
        rows: [row({ count: value as number })],
      }),
    ).toThrow();
  });

  it("alle tall i svaret er heltall eller null, og svaret består det strenge skjemaet", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 18,
      previousReportCount: 3,
      rows: [row(), row({ reasonCode: "other", count: 1, claimCount: 0, previousCount: 0 })],
    });
    expect(overrideStatsSchema.safeParse(stats).success).toBe(true);
    for (const line of stats.rows) {
      for (const value of [
        line.count,
        line.sharePercent,
        line.claimCount,
        line.previousCount,
        line.previousSharePercent,
        line.deltaCount,
        line.deltaPoints,
      ]) {
        expect(value === null || Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("etikettene kommer fra kodelistene, og punktnavnet kortes til grensen", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 10,
      rows: [row({ checkpointName: `  ${"Membran ".repeat(40)}  ` })],
    });
    const line = stats.rows[0]!;
    expect(line.checkLabel).toBe("Hulltaking mangler");
    expect(line.reasonLabel).toBe("Ikke tilgang eller nektet av eier");
    expect(line.checkpointName!.length).toBeLessThanOrEqual(AI_OVERRIDE_CHECKPOINT_NAME_MAX_LENGTH);
  });

  it("hele rapporten har verken punkt eller punktnavn", () => {
    const { stats } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 10,
      previousReportCount: 10,
      rows: [
        row({ checkCode: "inspection_date_missing", checkpointKey: null, checkpointName: "x" }),
      ],
    });
    expect(stats.rows[0]).toMatchObject({ checkpointKey: null, checkpointName: null });
  });

  it("over grensen kuttes linjene med lavest antall, og antallet står i rowsCut", () => {
    const rows = Array.from({ length: AI_OVERRIDE_STATS_MAX_ROWS + 3 }, (_, i) =>
      row({ checkpointKey: `wet_room.p${i}`, count: i + 1, claimCount: 0, previousCount: 0 }),
    );
    const { stats, rowsCut } = buildOverrideSummaryInput({
      month: "2026-10",
      reportCount: 100,
      previousReportCount: 0,
      rows,
    });
    expect(rowsCut).toBe(3);
    expect(stats.rows).toHaveLength(AI_OVERRIDE_STATS_MAX_ROWS);
    expect(stats.rows.map((r) => r.count)).not.toContain(1);
    expect(stats.rows[0]!.count).toBe(AI_OVERRIDE_STATS_MAX_ROWS + 3);
  });
});

describe("O1.4 etiketter", () => {
  it.each(PUBLISH_BLOCKER_CODES)("sperren %s har norsk etikett", (code) => {
    const label = publishCheckLabel(code);
    expect(label).toBe(PUBLISH_BLOCKER_LABELS[code]);
    expect(label).not.toBe(UNKNOWN_PUBLISH_CHECK_LABEL);
    expect(label).not.toContain("_");
  });

  it.each(PUBLISH_OVERRIDE_REASON_CODES)("grunnen %s har norsk etikett", (code) => {
    const label = publishOverrideReasonLabel(code);
    expect(label).toBe(PUBLISH_OVERRIDE_REASON_LABELS[code]);
    expect(label).not.toBe(UNKNOWN_OVERRIDE_REASON_LABEL);
  });

  it.each(["finnes_ikke", "Mxq-grunn-ÆØ", "", "__proto__", "toString", null, undefined])(
    "ukjent kode %s gir trygg tekst, aldri koden eller undefined",
    (code) => {
      expect(publishCheckLabel(code)).toBe(UNKNOWN_PUBLISH_CHECK_LABEL);
      expect(publishOverrideReasonLabel(code)).toBe(UNKNOWN_OVERRIDE_REASON_LABEL);
    },
  );
});

describe("måneder og 90 dager (A572, A577)", () => {
  it("90 dager tilbake fra i dag", () => {
    expect(overrideListFromDate("2026-11-24")).toBe("2026-08-26");
  });

  it("fire måneder, nyeste først, i norsk tid", () => {
    // 1.11.2026 kl. 00:30 i Oslo er fortsatt 31.10 i UTC
    expect(overrideSummaryMonths(new Date("2026-10-31T23:30:00Z"))).toEqual([
      "2026-11",
      "2026-10",
      "2026-09",
      "2026-08",
    ]);
    expect(overrideSummaryMonths(new Date("2026-02-10T12:00:00Z"))).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
    ]);
  });

  it("bare de fire månedene godtas", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(isOverrideSummaryMonth("2026-10", now)).toBe(true);
    expect(isOverrideSummaryMonth("2026-08", now)).toBe(true);
    for (const month of ["2026-07", "2026-12", "2025-01", "2026-13", "2026-1", 202610, null]) {
      expect(isOverrideSummaryMonth(month, now)).toBe(false);
    }
  });

  it("shiftMonth går over årsskiftet", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});
