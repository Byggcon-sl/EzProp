import { describe, expect, it } from "vitest";
import { INITIAL_PULL_SCHEDULE, nextPullDelay } from "./pull-schedule";
import type { PullOutcome, PullScheduleState } from "./types";

// Takten for hentingen (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 6). Testplan avsnitt 2.1,
// tilpasset kontrakten i custom/types.ts: `(state, outcome) => { state, delayMs }` uten klokke
// (avgjort av prosjektleder 29.10.2026). Takten er data: tabeller med testsaker.

/** Kjører en rekke utfall fra start og gir ventetiden etter hvert. */
function run(outcomes: readonly PullOutcome[], start: PullScheduleState = INITIAL_PULL_SCHEDULE) {
  let state = start;
  const delays: number[] = [];
  for (const outcome of outcomes) {
    const next = nextPullDelay(state, outcome);
    state = next.state;
    delays.push(next.delayMs);
  }
  return { state, delays };
}

describe("nextPullDelay (pull-schedule.ts)", () => {
  it("vellykket henting med ferdig: true gir neste henting om 5 s", () => {
    expect(nextPullDelay(INITIAL_PULL_SCHEDULE, "ok")).toEqual({
      state: { failures: 0 },
      delayMs: 5_000,
    });
  });

  it.each([0, 1, 4, 9])("ferdig: false gir neste side med en gang (failures %i)", (failures) => {
    expect(nextPullDelay({ failures }, "more")).toEqual({ state: { failures }, delayMs: 0 });
  });

  // Obligatorisk
  it("feil gir 5, 10, 20, 40, 60 og 60 s", () => {
    expect(run(["failed", "failed", "failed", "failed", "failed", "failed"]).delays).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });

  it("taket på 60 s holder også etter svært mange feil", () => {
    expect(nextPullDelay({ failures: 1_000 }, "failed").delayMs).toBe(60_000);
  });

  it("vellykket henting etter feil gir 5 s igjen", () => {
    const { state, delays } = run(["failed", "failed", "failed", "ok"]);
    expect(delays.at(-1)).toBe(5_000);
    expect(state.failures).toBe(0);
    // Telleren er nullstilt: neste feil starter på 5 s
    expect(nextPullDelay(state, "failed").delayMs).toBe(5_000);
  });

  it("ugyldig markør gir ny henting uten siden med en gang, og teller ikke som feil", () => {
    expect(nextPullDelay({ failures: 2 }, "invalid-cursor")).toEqual({
      state: { failures: 2 },
      delayMs: 0,
    });
  });

  it("200 på en bunt gir henting ved neste takt", () => {
    expect(nextPullDelay(INITIAL_PULL_SCHEDULE, "acked")).toEqual({
      state: { failures: 0 },
      delayMs: 5_000,
    });
  });

  it("200 på en bunt under feilventetid gir 5 s og nullstiller feiltelleren", () => {
    const { state, delays } = run(["failed", "failed", "failed", "acked"]);
    expect(delays.at(-1)).toBe(5_000);
    expect(state.failures).toBe(0);
  });

  it.each<[PullOutcome, number, number]>([
    ["ok", 3, 0],
    ["acked", 3, 0],
    ["more", 3, 3],
    ["invalid-cursor", 3, 3],
    ["failed", 3, 4],
  ])("%s med %i feil på rad gir %i feil etterpå", (outcome, before, after) => {
    expect(nextPullDelay({ failures: before }, outcome).state.failures).toBe(after);
  });

  it("ventetiden er aldri under 5 s etter ok, acked eller failed", () => {
    // Egenskapstest over alle rekker på inntil 6 steg: bare `more` og `invalid-cursor` gir 0.
    const outcomes: PullOutcome[] = ["ok", "more", "failed", "invalid-cursor", "acked"];
    let rows: PullOutcome[][] = [[]];
    for (let step = 0; step < 6; step++) {
      rows = rows.flatMap((row) => outcomes.map((outcome) => [...row, outcome]));
      for (const row of rows) {
        const { delays } = run(row);
        row.forEach((outcome, index) => {
          const delay = delays[index]!;
          if (outcome === "more" || outcome === "invalid-cursor") expect(delay).toBe(0);
          else expect(delay).toBeGreaterThanOrEqual(5_000);
          expect(delay).toBeLessThanOrEqual(60_000);
        });
      }
    }
  });

  it("funksjonen endrer ikke tilstanden den får", () => {
    const state = Object.freeze({ failures: 2 });
    expect(() => nextPullDelay(state, "failed")).not.toThrow();
    expect(state.failures).toBe(2);
  });
});
