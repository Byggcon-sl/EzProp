import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./codes";
import * as statusFlow from "./status-flow";
import { allowedTransitions, canCancel, isCorrected } from "./status-flow";

/*
 * Overgangene for oppdragsstatus som testsaker
 * (docs/funksjoner/fase2a-statusflyt-testplan.md avsnitt 1). Ren enhetstest, ingen database.
 *
 * Tabellen under er fasit (kortet, «Regler»). Hver av de 16 kombinasjonene av fra/til er én
 * rad. Kommer det en ny status uten testsaker, blir 1.2 rød.
 *
 * Støtter hovedmål: KI først (overgangene er låst som data, så automatikken fra `report.sent`
 * og faktura senere kan bruke de samme funksjonene trygt) og reklamasjoner (tilbake krever grunn).
 */

type Kind = "forward" | "back" | null;

const F: Kind = "forward";
const B: Kind = "back";
const X: Kind = null;

/** Fra (rad) og til (kolonne), i rekkefølgen i ASSIGNMENT_STATUSES. */
const TABLE: Record<AssignmentStatus, Record<AssignmentStatus, Kind>> = {
  ordered: { ordered: X, in_progress: F, completed: X, invoiced: X },
  in_progress: { ordered: B, in_progress: X, completed: F, invoiced: X },
  completed: { ordered: X, in_progress: B, completed: X, invoiced: F },
  invoiced: { ordered: X, in_progress: X, completed: B, invoiced: X },
};

const KIND_LABEL: Record<string, string> = {
  forward: "fram",
  back: "tilbake (grunn påkrevd)",
  null: "ulovlig",
};

const CASES = ASSIGNMENT_STATUSES.flatMap((from) =>
  ASSIGNMENT_STATUSES.map((to) => {
    const kind = TABLE[from]?.[to];
    return { from, to, kind, label: KIND_LABEL[String(kind)] ?? "mangler i tabellen" };
  }),
);

/** Hva overgangen er, regnet ut fra `allowedTransitions`. */
function kindFromAllowed(from: AssignmentStatus, to: AssignmentStatus): Kind {
  const allowed = allowedTransitions(from);
  if (allowed.next === to) return "forward";
  if (allowed.previous === to) return "back";
  return null;
}

/** Hjelperen for én overgang, hvis utvikleren har laget den (testplanen, «Avtale om signaturer»). */
const transitionKind = (statusFlow as Record<string, unknown>).transitionKind as
  ((from: string, to: string) => Kind | undefined) | undefined;

describe("1.1 alle 16 overganger", () => {
  it.each(CASES)("$from → $to er $label", ({ from, to, kind }) => {
    expect(kind, `${from} → ${to} mangler i tabellen`).not.toBeUndefined();
    expect(kindFromAllowed(from, to)).toBe(kind);
    if (transitionKind) expect(transitionKind(from, to) ?? null).toBe(kind);
  });
});

describe("1.2 tabellen dekker alt", () => {
  it("antall rader er ASSIGNMENT_STATUSES.length ** 2, og alle har et svar", () => {
    expect(CASES).toHaveLength(ASSIGNMENT_STATUSES.length ** 2);
    expect(CASES).toHaveLength(16);
    expect(CASES.filter((row) => row.kind === undefined)).toEqual([]);
  });

  it("tabellen har ingen statuser som ikke finnes i ASSIGNMENT_STATUSES", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
    for (const row of Object.values(TABLE)) {
      expect(Object.keys(row).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
    }
  });

  it("aldri hopp: fram og tilbake er alltid ett steg i rekkefølgen", () => {
    for (const { from, to, kind } of CASES) {
      const step = ASSIGNMENT_STATUSES.indexOf(to) - ASSIGNMENT_STATUSES.indexOf(from);
      if (kind === "forward") expect(step, `${from} → ${to}`).toBe(1);
      if (kind === "back") expect(step, `${from} → ${to}`).toBe(-1);
    }
  });
});

describe("1.3 allowedTransitions", () => {
  it.each([
    { status: "ordered", next: "in_progress", previous: null },
    { status: "in_progress", next: "completed", previous: "ordered" },
    { status: "completed", next: "invoiced", previous: "in_progress" },
    { status: "invoiced", next: null, previous: "completed" },
  ] as const)("$status → neste $next, forrige $previous", ({ status, next, previous }) => {
    const allowed = allowedTransitions(status);
    expect(allowed.next).toBe(next);
    expect(allowed.previous).toBe(previous);
  });
});

describe("1.4 canCancel", () => {
  it.each([
    ["ordered", true],
    ["in_progress", true],
    ["completed", false],
    ["invoiced", false],
  ] as const)("%s gir %s", (status, expected) => {
    expect(canCancel(status)).toBe(expected);
  });

  it("dekker alle statusene", () => {
    for (const status of ASSIGNMENT_STATUSES) expect(typeof canCancel(status)).toBe("boolean");
  });
});

describe("1.5 isCorrected («Rettet»)", () => {
  it.each([
    ["completed", 2, true],
    ["completed", 5, true],
    ["completed", 1, false],
    ["completed", null, false],
    ["ordered", 2, false],
    ["in_progress", 2, false],
    ["invoiced", 2, false],
  ] as const)("%s med høyeste sendte versjon %s gir %s", (status, version, expected) => {
    expect(isCorrected({ status, highestSentReleaseVersion: version })).toBe(expected);
  });
});
