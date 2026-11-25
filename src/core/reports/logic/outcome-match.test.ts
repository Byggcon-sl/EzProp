import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendNoteToDeviationText,
  canReplaceDeviationTextWithNote,
  findRegisteredDeviation,
  listOutcomeMatchCandidates,
  listPhraseCandidates,
  outcomeMatchCandidateText,
  rankOutcomesBySimilarity,
  replaceDeviationTextWithNote,
  searchOutcomes,
  searchPhraseCandidates,
  type OutcomeSearchDocument,
  type OutcomeSearchHit,
} from "@/core/reports/logic";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { rankBySimilarity } from "@/shared/lib/text-similarity";

/*
 * «Skriv det du ser»: kandidatlisten, «Nærmeste treff (uten KI)», «Registrert fra før» og notatet
 * som avvikstekst (docs/funksjoner/fase2a-skriv-det-du-ser.md, A554, A556, A558, A559; testplanen
 * 1a–1c og 2). Rene funksjoner uten database. Badmalen fra seed-dataene og et oppdiktet
 * maldokument; notatene er oppdiktet.
 *
 * Hovedmål: best for de ansatte (samme hjelp uten nett, egne ord gir treff) og færre reklamasjoner
 * (riktig utfall, malens tekst med måling og årstall beholdes, ingen doble avvik).
 */

const OUTCOME_MATCH_MAX = 3;
const ROOT = resolve(__dirname, "../../../..");

// --- Et lite oppdiktet maldokument ---------------------------------------------------------------

const DOC: OutcomeSearchDocument = {
  checkpoints: [
    { key: "cp.walls", name: "Vegger", sort_order: 1 },
    { key: "cp.floor", name: "Gulv", sort_order: 2 },
  ],
  deviation_questions: [
    { checkpoint_key: "cp.walls", key: "cp.walls.marks", text: "Er det merker?", sort_order: 1 },
    {
      checkpoint_key: "cp.floor",
      key: "cp.floor.cracks",
      text: "Er flisene sprukket?",
      sort_order: 1,
    },
    {
      checkpoint_key: "cp.floor",
      key: "cp.floor.fall",
      text: "Er fallet for lite?",
      sort_order: 2,
    },
  ],
  outcomes: [
    {
      checkpoint_key: "cp.walls",
      question_key: "cp.walls.marks",
      key: "tg2",
      kind: "tg2",
      sort_order: 1,
      deviation_text: "Mxq merker på veggen.",
    },
    {
      checkpoint_key: "cp.floor",
      question_key: "cp.floor.cracks",
      key: "tg2",
      kind: "tg2",
      sort_order: 1,
      deviation_text: "Mxq sprukne fliser på gulvet.",
    },
    {
      checkpoint_key: "cp.floor",
      question_key: "cp.floor.fall",
      key: "choose",
      kind: "choose_tg2_tg3",
      sort_order: 1,
      deviation_text: "Mxq fall målt til {måleverdi} mm.",
    },
  ],
} as unknown as OutcomeSearchDocument;

const keys = (hits: readonly OutcomeSearchHit[]) => hits.map((hit) => hit.questionKey);

function withExtra(
  extra: Partial<Record<keyof OutcomeSearchDocument, unknown[]>>,
): OutcomeSearchDocument {
  return {
    checkpoints: [...DOC.checkpoints, ...(extra.checkpoints ?? [])],
    deviation_questions: [...DOC.deviation_questions, ...(extra.deviation_questions ?? [])],
    outcomes: [...DOC.outcomes, ...(extra.outcomes ?? [])],
  } as unknown as OutcomeSearchDocument;
}

describe("kandidatlisten (S1.12–S1.16)", () => {
  it("S1.13 uten åpent punkt: malens rekkefølge (punkt, spørsmål, utfall)", () => {
    expect(keys(listOutcomeMatchCandidates(DOC, null))).toEqual([
      "cp.walls.marks",
      "cp.floor.cracks",
      "cp.floor.fall",
    ]);
  });

  it("S1.13 utfallene i det åpne kontrollpunktet først, så resten i malens rekkefølge", () => {
    expect(keys(listOutcomeMatchCandidates(DOC, "cp.floor"))).toEqual([
      "cp.floor.cracks",
      "cp.floor.fall",
      "cp.walls.marks",
    ]);
  });

  it("S1.13 ukjent åpent punkt gir malens rekkefølge", () => {
    expect(listOutcomeMatchCandidates(DOC, "cp.finnes_ikke")).toEqual(
      listOutcomeMatchCandidates(DOC, null),
    );
  });

  it("S1.12 bare utfallene i dokumentet: badmalen gir alle utfallene for våtrom, ingen andre", () => {
    const list = listOutcomeMatchCandidates(wetRoomTemplate, null);
    expect(list).toHaveLength(wetRoomTemplate.outcomes.length);
    expect(list.every((hit) => hit.checkpointKey.startsWith("wet_room."))).toBe(true);
  });

  it("S1.14 mykt slettede og arkiverte utfall, punkter og spørsmål er ikke med", () => {
    const doc = withExtra({
      checkpoints: [{ key: "cp.gone", name: "Borte", sort_order: 3, deleted_at: "2026-11-01" }],
      deviation_questions: [
        { checkpoint_key: "cp.gone", key: "cp.gone.q", text: "Borte?", sort_order: 1 },
        {
          checkpoint_key: "cp.walls",
          key: "cp.walls.archived",
          text: "Arkivert?",
          sort_order: 2,
          archived_at: "2026-11-01",
        },
      ],
      outcomes: [
        {
          checkpoint_key: "cp.gone",
          question_key: "cp.gone.q",
          key: "tg2",
          kind: "tg2",
          sort_order: 1,
          deviation_text: "Mxq borte.",
        },
        {
          checkpoint_key: "cp.walls",
          question_key: "cp.walls.archived",
          key: "tg2",
          kind: "tg2",
          sort_order: 1,
          deviation_text: "Mxq arkivert.",
        },
        {
          checkpoint_key: "cp.walls",
          question_key: "cp.walls.marks",
          key: "tg3",
          kind: "tg3",
          sort_order: 2,
          deviation_text: "Mxq slettet utfall.",
          deleted_at: "2026-11-01",
        },
      ],
    });
    expect(listOutcomeMatchCandidates(doc, null)).toEqual(listOutcomeMatchCandidates(DOC, null));
  });

  it("S1.16 kutter aldri: alle utfallene kommer med, også mange", () => {
    const outcomes = Array.from({ length: 80 }, (_, i) => ({
      checkpoint_key: "cp.walls",
      question_key: "cp.walls.marks",
      key: `k${i}`,
      kind: "tg2",
      sort_order: i,
      deviation_text: `Mxq tekst ${i}.`,
    }));
    const doc = { ...DOC, outcomes } as unknown as OutcomeSearchDocument;
    expect(listOutcomeMatchCandidates(doc, null)).toHaveLength(80);
  });

  it("S1.15 kandidatteksten: punktnavn, spørsmål og avvikstekst med flettefeltene uutfylt", () => {
    const fall = listOutcomeMatchCandidates(DOC, null).find(
      (h) => h.questionKey === "cp.floor.fall",
    )!;
    expect(outcomeMatchCandidateText(fall)).toBe(
      "Punkt: Gulv. Spørsmål: Er fallet for lite? Avvikstekst: Mxq fall målt til {måleverdi} mm.",
    );
  });

  it("S1.15 kandidatteksten har aldri kode, type, TG, gruppe, kilde eller hjelpetekst", () => {
    for (const hit of listOutcomeMatchCandidates(wetRoomTemplate, null)) {
      const text = outcomeMatchCandidateText(hit);
      expect(text).not.toContain(hit.checkpointKey);
      expect(text).not.toContain(hit.questionKey);
      expect(text).not.toMatch(/\bTG\s*[0-3]|\btgiu\b|choose|hms|tg[23]\b/iu);
      expect(text.length).toBeLessThan(2000);
      const outcome = wetRoomTemplate.outcomes.find(
        (o) => o.checkpoint_key === hit.checkpointKey && o.question_key === hit.questionKey,
      )!;
      if (outcome.source_ref) expect(text).not.toContain(outcome.source_ref);
    }
    expect(outcomeMatchCandidateText.length).toBe(1);
  });

  it("S1.15 tomme deler hoppes over", () => {
    expect(
      outcomeMatchCandidateText({ checkpointName: "Gulv", questionText: " ", deviationText: "" }),
    ).toBe("Punkt: Gulv.");
    expect(
      outcomeMatchCandidateText({
        checkpointName: "",
        questionText: "Er det fall?",
        deviationText: "",
      }),
    ).toBe("Spørsmål: Er det fall?");
  });
});

describe("«Nærmeste treff (uten KI)» (S1.7, S1.8)", () => {
  const nearest = (note: string, openCheckpointKey: string | null = null) =>
    rankOutcomesBySimilarity(wetRoomTemplate, note, {
      openCheckpointKey,
      limit: OUTCOME_MATCH_MAX,
    });

  it("S1.7 «sprekk i flis ved sluket, litt løs» gir gulvflisen blant de tre første", () => {
    expect(keys(nearest("sprekk i flis ved sluket, litt løs"))).toContain(
      "wet_room.floor.cracked_tiles_or_joints",
    );
  });

  it("S1.7 høyst `limit` treff, og grensen kommer som parameter", () => {
    expect(nearest("membran fra 1994")).toHaveLength(3);
    expect(
      rankOutcomesBySimilarity(wetRoomTemplate, "membran fra 1994", {
        openCheckpointKey: null,
        limit: 1,
      }),
    ).toHaveLength(1);
  });

  it.each([
    "hulltaking ikke utført, eier nektet",
    "hulltaking ikke utført",
    "litt slitt fuge",
    "små bruksmerker på innredning",
  ])("S1.8 «%s» gir ingen treff", (note) => {
    expect(nearest(note)).toEqual([]);
  });

  it("åpent punkt flytter et treff med likt poeng foran", () => {
    expect(keys(nearest("sprekk i flis")).slice(0, 2)).toEqual([
      "wet_room.walls_ceiling.cracked_tiles_or_joints",
      "wet_room.floor.cracked_tiles_or_joints",
    ]);
    expect(keys(nearest("sprekk i flis", "wet_room.floor")).slice(0, 2)).toEqual([
      "wet_room.floor.cracked_tiles_or_joints",
      "wet_room.walls_ceiling.cracked_tiles_or_joints",
    ]);
  });

  it("TG og utfallstype påvirker aldri rekkefølgen", () => {
    expect(nearest("fuktmerke og råte på veggen, dette er TG3")).toEqual(
      nearest("fuktmerke og råte på veggen"),
    );
  });
});

describe("tekstsøket i «Forslag» uten nett (S1.10, S1.11, T-0146)", () => {
  const consequences = listPhraseCandidates(wetRoomTemplate, {
    field: "consequence_text",
    checkpointKey: "wet_room.floor",
    questionKey: "wet_room.floor.cracked_tiles_or_joints",
    outcomeKey: "tg2",
    kind: "tg",
    tg: 3,
    usage: [],
    currentTexts: [],
  });

  it("S1.10 egen tekst gir kandidater som ligner, ikke tom liste", () => {
    const hits = searchPhraseCandidates(consequences, "vann kan trenge inn i bjelkelaget", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits[0]!.text.toLocaleLowerCase("nb")).toContain("vann kan trenge inn");
  });

  it("S1.10 tomt felt gir som før rekkefølgen fra kandidatlisten", () => {
    expect(searchPhraseCandidates(consequences, "", 3)).toEqual(consequences.slice(0, 3));
    expect(searchPhraseCandidates(consequences, "   ", 3)).toEqual(consequences.slice(0, 3));
  });

  it("S1.10 treffer det strenge søket, brukes det, ikke likheten", () => {
    const strict = searchPhraseCandidates(consequences, "råte", 5);
    expect(strict.length).toBeGreaterThan(0);
    for (const hit of strict) {
      expect(
        [hit.text, hit.checkpointName, hit.questionText].join(" ").toLocaleLowerCase("nb"),
      ).toContain("råte");
    }
  });

  it("S1.10 ingen over grensen gir fortsatt tom liste, og grensen 0 gir tom liste", () => {
    expect(searchPhraseCandidates(consequences, "helt annet ord her", 5)).toEqual([]);
    expect(searchPhraseCandidates(consequences, "vann kan trenge inn i bjelkelaget", 0)).toEqual(
      [],
    );
  });

  it("S1.11 `searchOutcomes` krever fortsatt alle ordene (uendret)", () => {
    expect(searchOutcomes(wetRoomTemplate, "sprekk i flis ved sluket, litt løs")).toEqual([]);
  });
});

describe("«Registrert fra før» (S1.17)", () => {
  const hit = { checkpointKey: "cp.floor", questionKey: "cp.floor.cracks", outcomeKey: "tg2" };

  it("S1.17 rommet har et avvik på samme utfall: gir avvikets id", () => {
    expect(
      findRegisteredDeviation(hit, [
        {
          checkpointKey: "cp.walls",
          deviations: [{ id: "d-0", questionKey: "cp.floor.cracks", outcomeKey: "tg2" }],
        },
        {
          checkpointKey: "cp.floor",
          deviations: [
            { id: "d-1", questionKey: "cp.floor.fall", outcomeKey: "choose" },
            { id: "d-2", questionKey: "cp.floor.cracks", outcomeKey: "tg2" },
          ],
        },
      ]),
    ).toBe("d-2");
  });

  it("S1.17 fritt avvik, annet utfall eller annet punkt gir null", () => {
    expect(
      findRegisteredDeviation(hit, [
        {
          checkpointKey: "cp.floor",
          deviations: [
            { id: "d-1", questionKey: null, outcomeKey: null },
            { id: "d-2", questionKey: "cp.floor.cracks", outcomeKey: "tg3" },
          ],
        },
      ]),
    ).toBeNull();
    expect(findRegisteredDeviation(hit, [])).toBeNull();
  });

  it("S1.17 mykt slettet avvik merker ikke", () => {
    const deleted = {
      id: "d-1",
      questionKey: "cp.floor.cracks",
      outcomeKey: "tg2",
      deletedAt: new Date(),
    };
    expect(
      findRegisteredDeviation(hit, [{ checkpointKey: "cp.floor", deviations: [deleted] }]),
    ).toBeNull();
  });
});

describe("notatet som avvikstekst (S1.18–S1.20)", () => {
  it("S1.19 «Legg notatet til»: malens tekst, mellomrom, notatet med stor forbokstav og punktum", () => {
    expect(
      appendNoteToDeviationText("Det er sprukne fliser på gulvet.", "sprekk ved sluket, litt løs"),
    ).toBe("Det er sprukne fliser på gulvet. Sprekk ved sluket, litt løs.");
  });

  it.each(["Løs flis ved sluket.", "Løs flis ved sluket!", "Løs flis ved sluket?"])(
    "S1.19 notat som slutter på «.», «!» eller «?» får ikke ekstra punktum: %s",
    (note) => {
      expect(appendNoteToDeviationText("Mxq.", note)).toBe(`Mxq. ${note}`);
    },
  );

  it("S1.19 notatet trimmes, æøå får stor forbokstav, og tom avvikstekst gir bare notatet", () => {
    expect(appendNoteToDeviationText("Mxq.  ", "  øverste flis løs  ")).toBe(
      "Mxq. Øverste flis løs.",
    );
    expect(appendNoteToDeviationText(null, "løs flis")).toBe("Løs flis.");
    expect(appendNoteToDeviationText("  ", "løs flis")).toBe("Løs flis.");
  });

  it("S1.19 malens tekst endres ikke, heller ikke flettefeltene", () => {
    expect(
      appendNoteToDeviationText("Målt fall er {måleverdi} mm per meter.", "motfall ved døra"),
    ).toBe("Målt fall er {måleverdi} mm per meter. Motfall ved døra.");
  });

  it("S1.19 tomt notat gir malens tekst uendret", () => {
    expect(appendNoteToDeviationText("Mxq.", "   ")).toBe("Mxq.");
  });

  it("S1.20 «Bruk bare notatet» gir notatet med samme formatering", () => {
    expect(replaceDeviationTextWithNote("Det er sprukne fliser.", "løs flis ved sluket")).toBe(
      "Løs flis ved sluket.",
    );
    expect(replaceDeviationTextWithNote(null, "løs flis!")).toBe("Løs flis!");
    expect(replaceDeviationTextWithNote("Mxq.", "  ")).toBeNull();
  });

  it("S1.20 nekter når malens tekst har flettefelt", () => {
    expect(replaceDeviationTextWithNote("Fra {årstall}.", "membran fra 1994")).toBeNull();
  });

  it("S1.18 flettefelt avgjøres av malens data: de fem utfallene i badmalen gir usann", () => {
    const withMergeFields = wetRoomTemplate.outcomes
      .filter((o) => !canReplaceDeviationTextWithNote(o.deviation_text))
      .map((o) => o.question_key.replace(/^wet_room\./u, ""))
      .sort();
    expect(withMergeFields).toEqual([
      "adjacent.elevated_moisture",
      "floor.insufficient_fall",
      "membrane_drain.low_threshold_height",
      "membrane_drain.membrane_before_2000",
      "membrane_drain.membrane_past_lifespan",
    ]);
    expect(canReplaceDeviationTextWithNote("Det er sprukne fliser på gulvet.")).toBe(true);
    expect(canReplaceDeviationTextWithNote(null)).toBe(true);
  });

  it("S1.18 statisk: ingen fast liste med utfallskoder i koden", () => {
    const source = readFileSync(join(__dirname, "deviation-note.ts"), "utf8");
    expect(source).not.toMatch(
      /insufficient_fall|low_threshold_height|elevated_moisture|membrane_/u,
    );
  });
});

describe("statisk: logikken kan kjøres i nettleseren og får grensen som parameter (S1.33)", () => {
  it.each(["outcome-match.ts", "deviation-note.ts", "phrase-candidates.ts"])(
    "%s importerer verken server-only, databasen, KI eller grensene i @/shared/config",
    (file) => {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source).not.toMatch(/["']server-only["']/u);
      expect(source).not.toMatch(/from\s+["']@\/db(\/client)?["']/u);
      expect(source).not.toMatch(/from\s+["']@\/core\/ai/u);
      expect(source).not.toMatch(/@\/shared\/config/u);
      expect(source).not.toMatch(/OUTCOME_MATCH_MAX/u);
    },
  );
});

// --- Evalueringssettet mot badmalen og det lokale søket (S2.2–S2.5) -----------------------------

type EvalCandidate = {
  id: string;
  source: string;
  checkpointKey: string;
  outcomeKey: string;
  text: string;
};
type EvalCase = {
  id: string;
  category: string;
  note: string;
  candidates: EvalCandidate[];
  expect: { require: "any" | "all" | "first" | "none"; ids: string[] };
};

const evalFile = JSON.parse(
  readFileSync(join(ROOT, "src/core/ai/evals/outcome_match.cases.json"), "utf8"),
) as { cases: EvalCase[] };

const wetRoomHits = listOutcomeMatchCandidates(wetRoomTemplate, null);

function localTop(evalCase: EvalCase): string[] {
  return rankBySimilarity(evalCase.note, evalCase.candidates, (c) => c.text, {
    limit: OUTCOME_MATCH_MAX,
  }).map((match) => match.item.id);
}

function passes(evalCase: EvalCase, top: readonly string[]): boolean {
  const { require, ids } = evalCase.expect;
  switch (require) {
    case "none":
      return top.length === 0;
    case "all":
      return ids.every((id) => top.includes(id));
    case "first":
      return top.length > 0 && ids.includes(top[0]!);
    case "any":
      return ids.some((id) => top.includes(id));
  }
}

describe("evalueringssettet mot badmalen (S2.2)", () => {
  it.each(evalFile.cases.map((c) => [c.id, c] as const))(
    "S2.2 %s: hver kandidat er et utfall for våtrom i badmalen, med teksten kjernen lager",
    (_id, evalCase) => {
      for (const candidate of evalCase.candidates) {
        const questionKey = `${candidate.checkpointKey}.${candidate.outcomeKey}`;
        const matches = wetRoomHits.filter(
          (hit) => hit.checkpointKey === candidate.checkpointKey && hit.questionKey === questionKey,
        );
        expect(matches, `${candidate.id}`).toHaveLength(1);
        expect(candidate.text).toBe(outcomeMatchCandidateText(matches[0]!));
        expect(candidate.id).toBe(questionKey.replace(/^wet_room\./u, ""));
      }
    },
  );
});

describe("evalueringssettet i det lokale søket, hver sak for seg (S2.3–S2.5)", () => {
  it.each(evalFile.cases.map((c) => [c.id, c.category, c.note, c] as const))(
    "%s (%s) «%s» består",
    (_id, _category, _note, evalCase) => {
      expect(localTop(evalCase), evalCase.expect.require).toSatisfy((top: string[]) =>
        passes(evalCase, top),
      );
    },
  );

  it("S2.5 TG i notatet gir samme rangering som uten", () => {
    const tgCases = evalFile.cases.filter((c) => c.category === "tg_mention");
    expect(tgCases.length).toBeGreaterThan(0);
    for (const evalCase of tgCases) {
      const without = evalCase.note
        .replace(/,?\s*(?:dette er\s*)?\btg\s*-?\s*(?:[0-3]|iu)\b/giu, "")
        .trim();
      expect(localTop(evalCase)).toEqual(localTop({ ...evalCase, note: without }));
    }
  });
});
