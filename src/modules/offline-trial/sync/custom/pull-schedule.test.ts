import { describe, expect, it } from "vitest";
import {
  PULL_BACKOFF_MAX_MS,
  PULL_INTERVAL_MS,
  type PullOutcome,
  type PullScheduleState,
} from "./types";
import { nextPullDelay } from "./pull-schedule";

// Takten for hentingen i kandidat 3, egenbygd (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 6).
// Testplan avsnitt 2.1. Ren funksjon uten klokke: kontrakten `NextPullDelay(state, outcome)` i
// custom/types.ts gjelder (avgjort av prosjektleder 29.10.2026). Testplanens hendelser med tid
// («ack 1 s etter», «wake», «offline») ligger derfor i leseren og testes i reader.test.ts.
// Takten er data: tabellene under er testsakene.

const START: PullScheduleState = { failures: 0 };

/** Kjører en rekke utfall fra start og gir ventetiden etter hvert. */
function run(outcomes: readonly PullOutcome[], from: PullScheduleState = START) {
  let state = from;
  const delays: number[] = [];
  for (const outcome of outcomes) {
    const next = nextPullDelay(state, outcome);
    delays.push(next.delayMs);
    state = next.state;
  }
  return { state, delays };
}

describe("nextPullDelay (custom/pull-schedule.ts)", () => {
  it("takten er 5 s og taket er 60 s", () => {
    expect(PULL_INTERVAL_MS).toBe(5_000);
    expect(PULL_BACKOFF_MAX_MS).toBe(60_000);
  });

  it("vellykket henting med ferdig: true gir neste henting om 5 s", () => {
    const { state, delays } = run(["ok"]);
    expect(delays).toEqual([5_000]);
    expect(state.failures).toBe(0);
  });

  it.each([0, 1, 3, 10])(
    "ferdig: false gir neste side med en gang (feil på rad før: %i)",
    (failures) => {
      expect(nextPullDelay({ failures }, "more").delayMs).toBe(0);
    },
  );

  // Obligatorisk
  it("feil gir 5, 10, 20, 40, 60 og 60 s", () => {
    const { state, delays } = run(["failed", "failed", "failed", "failed", "failed", "failed"]);
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(state.failures).toBe(6);
  });

  it("taket på 60 s holder også etter svært mange feil", () => {
    expect(nextPullDelay({ failures: 1_000 }, "failed").delayMs).toBe(60_000);
  });

  it("vellykket henting etter feil gir 5 s igjen", () => {
    const { delays } = run(["failed", "failed", "failed", "ok", "failed"]);
    // Etter suksess er telleren nullstilt: neste feil starter på 5 s igjen
    expect(delays).toEqual([5_000, 10_000, 20_000, 5_000, 5_000]);
  });

  it("ugyldig markør gir ny henting uten siden med en gang, og teller ikke som feil", () => {
    const afterFailures = run(["failed", "failed"]).state;
    const next = nextPullDelay(afterFailures, "invalid-cursor");
    expect(next.delayMs).toBe(0);
    // Feiltelleren er uendret: neste feil fortsetter der den var
    expect(next.state.failures).toBe(afterFailures.failures);
    expect(nextPullDelay(next.state, "failed").delayMs).toBe(20_000);
  });

  it("200 på en bunt gir henting ved neste takt", () => {
    expect(nextPullDelay(START, "acked").delayMs).toBe(PULL_INTERVAL_MS);
  });

  it("200 på en bunt under feilventetid gir 5 s og nullstiller feiltelleren", () => {
    // Avgjort 29.10.2026: serveren svarte, så nettet virker. `acked` gir alltid 5 s.
    const { state, delays } = run(["failed", "failed", "failed", "acked"]);
    expect(delays.at(-1)).toBe(PULL_INTERVAL_MS);
    expect(state.failures).toBe(0);
    // Telleren er nullstilt: neste feil starter på 5 s
    expect(nextPullDelay(state, "failed").delayMs).toBe(5_000);
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

  it.each<[PullOutcome[], number]>([
    [["ok"], 5_000],
    [["acked"], 5_000],
    [["more"], 0],
    [["invalid-cursor"], 0],
    [["failed"], 5_000],
    [["failed", "failed"], 10_000],
    [["failed", "more", "failed"], 10_000],
    [["failed", "invalid-cursor", "failed"], 10_000],
    [["failed", "failed", "failed", "failed", "failed", "failed", "failed", "failed"], 60_000],
  ])("rekken %j gir %i ms til slutt", (outcomes, expected) => {
    expect(run(outcomes).delays.at(-1)).toBe(expected);
  });

  it("endrer aldri tilstanden den får inn", () => {
    const state = Object.freeze({ failures: 2 });
    for (const outcome of ["ok", "more", "failed", "invalid-cursor", "acked"] as const) {
      const next = nextPullDelay(state, outcome);
      expect(state.failures).toBe(2);
      expect(next.state).not.toBe(state);
    }
  });

  it("ventetiden er aldri under 5 s mellom to hentinger med ferdig: true", () => {
    // Egenskapstest: alle rekker på inntil 8 steg. Etter ok, acked og failed er ventetiden
    // alltid mellom 5 og 60 s, uansett hva som kom før (aldri tettere enn takten, aldri over taket).
    const all: PullOutcome[] = ["ok", "more", "failed", "invalid-cursor", "acked"];
    const spaced = new Set<PullOutcome>(["ok", "acked", "failed"]);
    let checked = 0;
    const violations: string[] = [];
    const walk = (state: PullScheduleState, path: PullOutcome[]) => {
      if (path.length === 8 || violations.length > 0) return;
      for (const outcome of all) {
        const next = nextPullDelay(state, outcome);
        const delay = next.delayMs;
        const bad =
          !Number.isFinite(delay) ||
          delay < 0 ||
          delay > PULL_BACKOFF_MAX_MS ||
          (spaced.has(outcome) && delay < PULL_INTERVAL_MS);
        if (bad) violations.push(`${[...path, outcome].join(" → ")}: ${delay}`);
        checked += 1;
        walk(next.state, [...path, outcome]);
      }
    };
    walk(START, []);
    expect(violations).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
  });
});
