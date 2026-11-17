import { describe, expect, it } from "vitest";
import { AI_CANDIDATE_REFS_MAX } from "@/shared/config/ai-targets";
import { AI_CANDIDATE_SOURCES } from "@/db/schema";
import { containsCandidate, labelCandidates, parseCandidateAnswer } from "./candidates";
import { AI_SUGGESTED_CANDIDATES_MAX } from "./index";
import type { AiCandidate } from "./types";

/*
 * Kandidatkontrakten (docs/funksjoner/fase2a-ki-i-veien-testplan.md 1b, K1.7–K1.9 og K1.31a).
 * Ren test, ingen database. Alle id-er og tekster er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (KI velger bare blant kildens egne tekster, og svaret tolkes
 * strengt) og færre reklamasjoner (et merke KI har funnet på, blir aldri til tekst i rapporten).
 */

const ids = [
  "0190a0b0-0000-7000-8000-000000000001",
  "0190a0b0-0000-7000-8000-000000000002",
  "0190a0b0-0000-7000-8000-000000000003",
  "0190a0b0-0000-7000-8000-000000000004",
  "0190a0b0-0000-7000-8000-000000000005",
  "0190a0b0-0000-7000-8000-000000000006",
  "0190a0b0-0000-7000-8000-000000000007",
];

function candidates(count: number): AiCandidate[] {
  return ids.slice(0, count).map((id, index) => ({
    source: index % 2 === 0 ? "template_outcome" : "template_measure",
    id,
    text: `Oppdiktet tekst nummer ${index + 1}`,
  }));
}

describe("K1.7 streng tolking av svaret", () => {
  const labeled = labelCandidates(candidates(4));

  it("gyldige merker i svarets rekkefølge", () => {
    const parsed = parseCandidateAnswer("K2, K1", labeled);
    expect(parsed.refs).toEqual([
      { source: "template_measure", id: ids[1] },
      { source: "template_outcome", id: ids[0] },
    ]);
    expect(parsed.unknownLabels).toBe(0);
    expect(parsed.duplicateLabels).toBe(0);
  });

  it("ukjent merke, doble merker, tomme biter og annen tekst tas bort og telles", () => {
    const parsed = parseCandidateAnswer("K9, K2,, K2; tekst K01 K1", labeled);
    expect(parsed.refs.map((ref) => ref.id)).toEqual([ids[1], ids[0]]);
    // K9 (ikke sendt), «tekst» og «K01» (ikke formen K<tall>)
    expect(parsed.unknownLabels).toBe(3);
    expect(parsed.duplicateLabels).toBe(1);
  });

  it("flere gyldige enn grensen gir de første", () => {
    const seven = labelCandidates(candidates(7));
    const parsed = parseCandidateAnswer("K7 K6 K5 K4 K3 K2 K1", seven);
    expect(parsed.refs).toHaveLength(AI_CANDIDATE_REFS_MAX);
    expect(parsed.refs.map((ref) => ref.id)).toEqual([ids[6], ids[5], ids[4], ids[3], ids[2]]);
  });

  it.each([
    ["INGEN", 0],
    ["", 0],
    ["K9", 1],
    ["ingen passer", 1],
  ])("«%s» gir ingen gyldige (no_match)", (answer, unknown) => {
    const parsed = parseCandidateAnswer(answer, labeled);
    expect(parsed.refs).toEqual([]);
    expect(parsed.unknownLabels).toBe(unknown);
  });

  it.each([null, undefined, 42, ["K1"], { K1: true }])(
    "svar som ikke er tekst (%j) gir tom liste, aldri unntak",
    (answer) => {
      expect(parseCandidateAnswer(answer, labeled).refs).toEqual([]);
    },
  );
});

describe("K1.8 merkene lages per kall", () => {
  it("K-merkene følger rekkefølgen i kallet, så samme kandidat kan få ulikt merke", () => {
    const list = candidates(3);
    const first = labelCandidates(list);
    const second = labelCandidates([...list].reverse());
    const labelOf = (labeled: typeof first, id: string) =>
      labeled.find((entry) => entry.candidate.id === id)?.label;
    expect(labelOf(first, ids[0] as string)).toBe("K1");
    expect(labelOf(second, ids[0] as string)).toBe("K3");
  });

  it("svaret blir { source, id }, aldri merket", () => {
    const parsed = parseCandidateAnswer("K1", labelCandidates(candidates(2)));
    for (const ref of parsed.refs) {
      expect(Object.keys(ref).sort()).toEqual(["id", "source"]);
      expect(JSON.stringify(ref)).not.toMatch(/"K\d/u);
    }
  });

  it("containsCandidate sammenligner kilde og id uten hensyn til store bokstaver", () => {
    const list = [{ source: "template_outcome" as const, id: ids[0] as string }];
    expect(
      containsCandidate(list, { source: "template_outcome", id: (ids[0] as string).toUpperCase() }),
    ).toBe(true);
    expect(containsCandidate(list, { source: "template_measure", id: ids[0] as string })).toBe(
      false,
    );
    expect(containsCandidate(null, { source: "template_outcome", id: ids[0] as string })).toBe(
      false,
    );
  });
});

describe("K1.9 og K1.31a faste koder og ett tall", () => {
  it("K1.9 kildekodene er låst i fast rekkefølge (regel 6)", () => {
    expect([...AI_CANDIDATE_SOURCES]).toEqual(["template_outcome", "template_measure", "phrase"]);
  });

  it("K1.31a AI_SUGGESTED_CANDIDATES_MAX er AI_CANDIDATE_REFS_MAX", () => {
    expect(AI_SUGGESTED_CANDIDATES_MAX).toBe(AI_CANDIDATE_REFS_MAX);
    expect(AI_CANDIDATE_REFS_MAX).toBe(5);
  });
});
