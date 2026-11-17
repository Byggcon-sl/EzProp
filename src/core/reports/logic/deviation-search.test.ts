import { describe, expect, it } from "vitest";
import { parseTemplateDocument, type TemplateDocument } from "@/core/templates";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import {
  normalizeSearchText,
  searchOutcomes,
  type OutcomeSearchDocument,
} from "./deviation-search";

/*
 * Avvikssøk i «+ Avvik» (testplanen B1.17, A382). Ren test over badmalen og et oppdiktet dokument.
 *
 * Hovedmål: de ansatte (takstmannen finner avviket uten å vite hvilket punkt det står under).
 */

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) throw new Error("malen for badet er ugyldig");
  return result.document;
}

const WET_ROOM = parsedTemplate();

/** Et lite oppdiktet dokument med æøå og rekkefølge som ikke følger listen. */
const SMALL: OutcomeSearchDocument = {
  checkpoints: [
    { ...WET_ROOM.checkpoints[0]!, key: "b", name: "Bad", sort_order: 1 },
    { ...WET_ROOM.checkpoints[0]!, key: "a", name: "Kjøkken", sort_order: 0 },
  ],
  deviation_questions: [
    { checkpoint_key: "a", key: "a.q", text: "Er det skade?", sort_order: 0 },
    { checkpoint_key: "b", key: "b.q", text: "Er det fukt?", sort_order: 0 },
  ],
  outcomes: [
    {
      ...WET_ROOM.outcomes[0]!,
      checkpoint_key: "b",
      question_key: "b.q",
      key: "x",
      deviation_text: "Fuktskade på gulv.",
      sort_order: 0,
    },
    {
      ...WET_ROOM.outcomes[0]!,
      checkpoint_key: "a",
      question_key: "a.q",
      key: "y",
      deviation_text: "Ødelagt benkeplate.",
      sort_order: 1,
    },
    {
      ...WET_ROOM.outcomes[0]!,
      checkpoint_key: "a",
      question_key: "a.q",
      key: "z",
      deviation_text: "Åpen skjøt i ØVRE skap.",
      sort_order: 0,
    },
  ],
};

describe("B1.17 avvikssøk", () => {
  it("«fukt» finner utfallene med fukt på flere punkter, med punktnavnet", () => {
    const hits = searchOutcomes(WET_ROOM, "fukt");
    expect(hits.length).toBeGreaterThan(3);
    expect(new Set(hits.map((h) => h.checkpointKey)).size).toBeGreaterThan(2);
    for (const hit of hits) {
      expect(hit.checkpointName).not.toBe("");
      const haystack =
        `${hit.deviationText} ${hit.questionText} ${hit.checkpointName}`.toLowerCase();
      expect(haystack).toContain("fukt");
    }
    // Et utfall med fukt i avviksteksten på tilliggende konstruksjoner er med.
    expect(
      hits.some((h) => h.checkpointKey.endsWith(".adjacent") && h.deviationText.includes("fukten")),
    ).toBe(true);
  });

  it("tomt søk gir alle utfall i malens rekkefølge", () => {
    expect(searchOutcomes(WET_ROOM, "")).toHaveLength(WET_ROOM.outcomes.length);
    expect(searchOutcomes(WET_ROOM, "   ")).toHaveLength(WET_ROOM.outcomes.length);
    expect(searchOutcomes(SMALL, "").map((h) => h.outcomeKey)).toEqual(["z", "y", "x"]);
  });

  it.each([["FUKT"], ["Fukt"], ["fUkT"]])("stor og liten bokstav likt: %s", (query) => {
    expect(searchOutcomes(WET_ROOM, query)).toEqual(searchOutcomes(WET_ROOM, "fukt"));
  });

  it.each([
    ["øDELAGT", ["y"]],
    ["ødelagt", ["y"]],
    ["ÅPEN", ["z"]],
    ["øvre", ["z"]],
    ["KJØKKEN", ["z", "y"]],
  ])("æøå likt: %s", (query, keys) => {
    expect(searchOutcomes(SMALL, query).map((h) => h.outcomeKey)).toEqual(keys);
  });

  it("flere ord må alle stå i treffet", () => {
    expect(searchOutcomes(SMALL, "skade gulv").map((h) => h.outcomeKey)).toEqual(["x"]);
    expect(searchOutcomes(SMALL, "fukt benkeplate")).toEqual([]);
  });

  it("utfall som ikke står i versjonen (arkivert eller fra andre versjoner), kommer ikke med", () => {
    const withoutX: OutcomeSearchDocument = {
      ...SMALL,
      outcomes: SMALL.outcomes.filter((o) => o.key !== "x"),
    };
    expect(searchOutcomes(withoutX, "fukt")).toEqual([]);
  });

  it("utfall uten spørsmål eller punkt i dokumentet kommer ikke med", () => {
    const orphan: OutcomeSearchDocument = { ...SMALL, deviation_questions: [] };
    expect(searchOutcomes(orphan, "")).toEqual([]);
  });

  it("ingen treff gir tom liste", () => {
    expect(searchOutcomes(WET_ROOM, "zzzz finnes ikke")).toEqual([]);
  });

  it("treffet har punktnavn, spørsmål og TG-art", () => {
    expect(searchOutcomes(SMALL, "gulv")).toEqual([
      {
        checkpointKey: "b",
        checkpointName: "Bad",
        questionKey: "b.q",
        questionText: "Er det fukt?",
        outcomeKey: "x",
        outcomeKind: WET_ROOM.outcomes[0]!.kind,
        deviationText: "Fuktskade på gulv.",
      },
    ]);
  });

  it("normalizeSearchText gir små bokstaver og ett mellomrom", () => {
    expect(normalizeSearchText("  ÆRLIG   Ø\tÅ ")).toBe("ærlig ø å");
  });
});
