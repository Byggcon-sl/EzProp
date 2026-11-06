import { describe, expect, it } from "vitest";
import { TEST_NOW } from "../../../tests/factories";
import { shouldSendActivity } from "./activity";

/*
 * Når måleren på oppdragssiden sender (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 2).
 * Ren funksjon, fast `now`. Importeres fra `./activity` slik klientkomponenten gjør.
 *
 * Støtter hovedmål: tid (tiden måles uten trykk, men bare når takstmannen faktisk er aktiv).
 */

const at = (seconds: number) => new Date(TEST_NOW.getTime() + seconds * 1000);

type Case = {
  name: string;
  lastSentAt: Date | null;
  lastActivityAt: Date | null;
  visible: boolean;
  now: Date;
  expected: boolean;
};

const CASES: Case[] = [
  {
    name: "2.1 første kall, synlig",
    lastSentAt: null,
    lastActivityAt: null,
    visible: true,
    now: TEST_NOW,
    expected: true,
  },
  {
    name: "2.2 første kall, skjult fane",
    lastSentAt: null,
    lastActivityAt: null,
    visible: false,
    now: TEST_NOW,
    expected: false,
  },
  {
    name: "2.3 59 s etter med aktivitet",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(30),
    visible: true,
    now: at(59),
    expected: false,
  },
  {
    name: "2.4 60 s etter med aktivitet",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(30),
    visible: true,
    now: at(60),
    expected: true,
  },
  {
    name: "2.4 120 s etter med aktivitet",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(100),
    visible: true,
    now: at(120),
    expected: true,
  },
  {
    name: "2.5 60 s etter uten aktivitet (null)",
    lastSentAt: TEST_NOW,
    lastActivityAt: null,
    visible: true,
    now: at(60),
    expected: false,
  },
  {
    name: "2.5 60 s etter, aktivitet før forrige kall",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(-5),
    visible: true,
    now: at(60),
    expected: false,
  },
  {
    name: "2.6 60 s etter med aktivitet, skjult fane",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(30),
    visible: false,
    now: at(60),
    expected: false,
  },
  {
    name: "2.7 aktivitet nøyaktig lik lastSentAt",
    lastSentAt: TEST_NOW,
    lastActivityAt: at(0),
    visible: true,
    now: at(60),
    expected: false,
  },
];

describe("shouldSendActivity", () => {
  it.each(CASES)("$name → $expected", ({ name: _name, expected, ...input }) => {
    expect(shouldSendActivity(input)).toBe(expected);
  });
});
