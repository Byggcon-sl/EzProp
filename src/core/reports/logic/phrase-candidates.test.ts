import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cutPhraseCandidates,
  listPhraseCandidates,
  mergePhraseUsage,
  mostUsedPhraseCandidate,
  phraseCandidateOtherTg,
  phraseCandidateText,
  PHRASE_MOST_USED_MIN_COUNT,
  searchPhraseCandidates,
  templateTextStatusMatcher,
  type PhraseCandidateContext,
  type PhraseCandidateDocument,
} from "@/core/reports/logic";

/*
 * Kandidatkilden og tekstsøket uten KI (docs/funksjoner/fase2a-ki-i-veien-testplan.md 1c:
 * K1.10–K1.17b). Rene funksjoner, oppdiktet maldokument. Ingen tekst fra NS 3600, IVIT eller
 * SmartTakst.
 */

const DOC: PhraseCandidateDocument = {
  checkpoints: [
    { key: "cp.floor", name: "Gulv og fall", sort_order: 1 },
    { key: "cp.walls", name: "Vegger", sort_order: 2 },
    { key: "cp.fixtures", name: "Innredning", sort_order: 3 },
  ],
  deviation_questions: [
    {
      checkpoint_key: "cp.floor",
      key: "cp.floor.slope",
      text: "Er fallet for lite?",
      sort_order: 0,
    },
    {
      checkpoint_key: "cp.floor",
      key: "cp.floor.cracks",
      text: "Er flisene sprukket?",
      sort_order: 1,
    },
    {
      checkpoint_key: "cp.floor",
      key: "cp.floor.wet",
      text: "Er det fukt i gulvet?",
      sort_order: 2,
    },
    {
      checkpoint_key: "cp.walls",
      key: "cp.walls.marks",
      text: "Er det merker på veggen?",
      sort_order: 3,
    },
    {
      checkpoint_key: "cp.fixtures",
      key: "cp.fixtures.heat",
      text: "Er det varmgang?",
      sort_order: 4,
    },
  ],
  outcomes: [
    outcome(
      "cp.floor",
      "cp.floor.slope",
      "tg2",
      "Mxq fall avvik",
      "Mxq fall årsak",
      "Mxq fall konsekvens",
    ),
    outcome(
      "cp.floor",
      "cp.floor.cracks",
      "tg3",
      "Mxq sprekk avvik",
      "Mxq sprekk årsak",
      "Mxq sprekk konsekvens",
    ),
    outcome(
      "cp.floor",
      "cp.floor.wet",
      "choose_tg2_tg3",
      "Mxq fukt avvik {måleverdi}",
      "Mxq fukt årsak",
      null,
    ),
    outcome(
      "cp.walls",
      "cp.walls.marks",
      "tg2",
      "Mxq merker avvik",
      "Mxq merker årsak",
      "Mxq merker konsekvens",
    ),
    outcome(
      "cp.fixtures",
      "cp.fixtures.heat",
      "hms",
      "Mxq varme avvik",
      null,
      "Mxq varme konsekvens",
    ),
  ],
  standard_measures: [
    measure("cp.floor", "cp.floor.slope", "tg2", "Mxq fall bør rettes", null, 0),
    measure("cp.floor", "cp.floor.wet", "choose_tg2_tg3", "Mxq fukt bør måles", 2, 0),
    measure("cp.floor", "cp.floor.wet", "choose_tg2_tg3", "Mxq fukt må måles", 3, 1),
    measure("cp.walls", "cp.walls.marks", "tg2", "Mxq merker bør vaskes", null, 0),
    measure("cp.fixtures", "cp.fixtures.heat", "hms", "Mxq varme må kontrolleres", null, 0),
  ],
};

function outcome(
  checkpoint: string,
  question: string,
  kind: "tg2" | "tg3" | "hms" | "choose_tg2_tg3",
  deviation: string | null,
  cause: string | null,
  consequence: string | null,
): PhraseCandidateDocument["outcomes"][number] {
  return {
    checkpoint_key: checkpoint,
    question_key: question,
    key: kind === "choose_tg2_tg3" ? "choose" : kind,
    kind,
    deviation_text: deviation,
    default_cause_text: cause,
    default_consequence_text: consequence,
    text_status: "draft",
    sort_order: 0,
  };
}

function measure(
  checkpoint: string,
  question: string,
  kind: string,
  text: string,
  appliesToTg: 2 | 3 | null,
  sortOrder: number,
): PhraseCandidateDocument["standard_measures"][number] {
  return {
    checkpoint_key: checkpoint,
    question_key: question,
    outcome_key: kind === "choose_tg2_tg3" ? "choose" : kind,
    text,
    applies_to_tg: appliesToTg,
    text_status: "draft",
    sort_order: sortOrder,
  };
}

function context(overrides: Partial<PhraseCandidateContext> = {}): PhraseCandidateContext {
  return {
    field: "deviation_text",
    checkpointKey: "cp.floor",
    questionKey: "cp.floor.slope",
    outcomeKey: "tg2",
    kind: "tg",
    tg: 2,
    usage: [],
    currentTexts: [],
    ...overrides,
  };
}

const texts = (list: { text: string }[]) => list.map((c) => c.text);

describe("1c kandidatkilden og tekstsøket", () => {
  it("K1.10 rekkefølgen: eget utfall, samme punkt og TG, resten av punktet, resten av rommet", () => {
    const list = listPhraseCandidates(DOC, context());
    expect(texts(list)).toEqual([
      "Mxq fall avvik",
      // Samme punkt og samme TG: «velg TG2 eller TG3» passer TG2
      "Mxq fukt avvik {måleverdi}",
      // Resten av punktet: TG3
      "Mxq sprekk avvik",
      // Resten av rommet, i malens rekkefølge
      "Mxq merker avvik",
    ]);
    expect(list[0]?.ref).toBeNull();
  });

  it("K1.10 innen et ledd gjelder malens rekkefølge", () => {
    const list = listPhraseCandidates(
      DOC,
      context({ checkpointKey: "cp.other", questionKey: null, outcomeKey: null }),
    );
    expect(texts(list)).toEqual([
      "Mxq fall avvik",
      "Mxq sprekk avvik",
      "Mxq fukt avvik {måleverdi}",
      "Mxq merker avvik",
    ]);
  });

  it.each([
    ["cause_text", ["Mxq fall årsak", "Mxq fukt årsak", "Mxq sprekk årsak", "Mxq merker årsak"]],
    ["consequence_text", ["Mxq fall konsekvens", "Mxq sprekk konsekvens", "Mxq merker konsekvens"]],
    [
      "new_measure",
      ["Mxq fall bør rettes", "Mxq fukt bør måles", "Mxq fukt må måles", "Mxq merker bør vaskes"],
    ],
  ] as const)("K1.11 samme felttype: %s gir bare sine tekster", (field, expected) => {
    expect(texts(listPhraseCandidates(DOC, context({ field })))).toEqual(expected);
  });

  it("K1.11 standardtiltak har plassen blant utfallets tiltak og TG-en de gjelder for", () => {
    const list = listPhraseCandidates(DOC, context({ field: "new_measure" }));
    const must = list.find((c) => c.text === "Mxq fukt må måles");
    expect(must).toMatchObject({
      appliesToTg: 3,
      measureSortOrder: 1,
      outcomeKind: "choose_tg2_tg3",
    });
    expect(list.find((c) => c.text === "Mxq fall bør rettes")?.measureSortOrder).toBe(0);
  });

  it("K1.12 teksten i feltet tas ut, med store og små bokstaver og mellomrom likt", () => {
    const list = listPhraseCandidates(DOC, context({ currentTexts: ["  mxq   FALL avvik "] }));
    expect(texts(list)).not.toContain("Mxq fall avvik");
    expect(list).toHaveLength(3);
  });

  it("K1.12 like tekster står bare én gang, og den nærmeste beholdes", () => {
    const doc: PhraseCandidateDocument = {
      ...DOC,
      outcomes: [
        ...DOC.outcomes,
        outcome("cp.walls", "cp.walls.marks", "tg2", "MXQ fall avvik", null, null),
      ],
    };
    const list = listPhraseCandidates(doc, context());
    expect(list.filter((c) => c.text.toLowerCase() === "mxq fall avvik")).toHaveLength(1);
    expect(list[0]?.checkpointKey).toBe("cp.floor");
  });

  it("K1.13 bare det som står i dokumentet: et utfall som er arkivert (ikke i versjonen), er ikke med", () => {
    const doc: PhraseCandidateDocument = {
      ...DOC,
      outcomes: DOC.outcomes.filter((o) => o.question_key !== "cp.walls.marks"),
    };
    expect(texts(listPhraseCandidates(doc, context()))).not.toContain("Mxq merker avvik");
  });

  it("K1.13 tomme tekster og utfall på punkter utenfor rommet er ikke med", () => {
    const doc: PhraseCandidateDocument = {
      ...DOC,
      checkpoints: DOC.checkpoints.filter((c) => c.key !== "cp.walls"),
    };
    const list = listPhraseCandidates(doc, context({ field: "consequence_text" }));
    expect(texts(list)).toEqual(["Mxq fall konsekvens", "Mxq sprekk konsekvens"]);
  });

  it("K1.14 kuttet etter prioritet: de første beholdes, og antallet kuttet står igjen", () => {
    const list = listPhraseCandidates(DOC, context());
    const { candidates, cut } = cutPhraseCandidates(list, 2);
    expect(texts(candidates)).toEqual(["Mxq fall avvik", "Mxq fukt avvik {måleverdi}"]);
    expect(cut).toBe(2);
    expect(cutPhraseCandidates(list, 10)).toEqual({ candidates: list, cut: 0 });
  });

  it("K1.15 flettefelt: verdien settes inn, og manglende verdi står i missing uten { }", () => {
    const [, wet] = listPhraseCandidates(DOC, context());
    if (!wet) throw new Error("mangler kandidat");
    expect(phraseCandidateText(wet, { måleverdi: "77 7 2" })).toEqual({
      text: "Mxq fukt avvik 77 7 2",
      missing: [],
    });
    const missing = phraseCandidateText(wet, {});
    expect(missing.missing).toEqual(["måleverdi"]);
    expect(missing.text).not.toMatch(/[{}]/);
  });

  it("K1.16 tekstsøket: alle ordene må stå i teksten, punktnavnet eller spørsmålet", () => {
    const list = listPhraseCandidates(
      DOC,
      context({ checkpointKey: "cp.other", questionKey: null, outcomeKey: null }),
    );
    expect(texts(searchPhraseCandidates(list, "FUKT", 5))).toEqual(["Mxq fukt avvik {måleverdi}"]);
    expect(texts(searchPhraseCandidates(list, "vegger merker", 5))).toEqual(["Mxq merker avvik"]);
    expect(texts(searchPhraseCandidates(list, "sprukket", 5))).toEqual(["Mxq sprekk avvik"]);
    expect(searchPhraseCandidates(list, "finnes ikke", 5)).toEqual([]);
  });

  it("K1.16 tomt søk gir kandidatene i rekkefølgen fra K1.10, høyst grensen", () => {
    const list = listPhraseCandidates(DOC, context());
    expect(searchPhraseCandidates(list, "   ", 2)).toEqual(list.slice(0, 2));
    expect(searchPhraseCandidates(list, "", 5)).toEqual(list);
  });

  it("K1.16 æøå og store bokstaver regnes likt", () => {
    const list = listPhraseCandidates(DOC, context({ field: "cause_text" }));
    expect(texts(searchPhraseCandidates(list, "ÅRSAK SPREKK", 5))).toEqual(["Mxq sprekk årsak"]);
  });

  it("K1.16 statisk: kandidatkilden og tekstsøket kan kjøres i nettleseren", () => {
    const file = path.resolve(process.cwd(), "src/core/reports/logic/phrase-candidates.ts");
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/["']server-only["']/);
    expect(text).not.toMatch(/from\s+["']@\/db(\/client)?["']/);
    expect(text).not.toMatch(/^import\s+(?!type)[^;]*from\s+["']@\/db\/schema["']/m);
    expect(text).not.toMatch(/from\s+["']@\/core\/ai/);
  });

  it("K1.17 kandidat fra et utfall med annen TG merkes", () => {
    const list = listPhraseCandidates(DOC, context());
    const tg3 = list.find((c) => c.text === "Mxq sprekk avvik");
    const same = list.find((c) => c.text === "Mxq fall avvik");
    const choose = list.find((c) => c.text === "Mxq fukt avvik {måleverdi}");
    if (!tg3 || !same || !choose) throw new Error("mangler kandidat");
    expect(phraseCandidateOtherTg(tg3, 2)).toBe(3);
    expect(phraseCandidateOtherTg(same, 2)).toBeNull();
    expect(phraseCandidateOtherTg(choose, 2)).toBeNull();
    expect(phraseCandidateOtherTg(tg3, null)).toBeNull();
    const must = listPhraseCandidates(DOC, context({ field: "new_measure" })).find(
      (c) => c.text === "Mxq fukt må måles",
    );
    if (!must) throw new Error("mangler kandidat");
    expect(phraseCandidateOtherTg(must, 2)).toBe(3);
  });

  it.each([
    ["TG-avvik får aldri HMS-tekster", context(), "Mxq varme avvik", false],
    [
      "HMS-avvik får bare HMS-tekster",
      context({
        kind: "hms",
        tg: null,
        checkpointKey: "cp.fixtures",
        questionKey: "cp.fixtures.heat",
        outcomeKey: "hms",
      }),
      "Mxq varme avvik",
      true,
    ],
  ] as const)(
    "K1.17 HMS og TG holdes fra hverandre (A463): %s",
    (_name, ctx, hmsText, hmsIncluded) => {
      const list = listPhraseCandidates(DOC, ctx);
      expect(texts(list).includes(hmsText)).toBe(hmsIncluded);
      if (ctx.kind === "hms") {
        expect(list.every((c) => c.outcomeKind === "hms")).toBe(true);
      } else {
        expect(list.some((c) => c.outcomeKind === "hms")).toBe(false);
      }
    },
  );

  it("K1.17 HMS-tiltak er bare kandidater for HMS-avvik", () => {
    const hms = context({
      field: "new_measure",
      kind: "hms",
      tg: null,
      checkpointKey: "cp.fixtures",
      questionKey: "cp.fixtures.heat",
      outcomeKey: "hms",
    });
    expect(texts(listPhraseCandidates(DOC, hms))).toEqual(["Mxq varme må kontrolleres"]);
    expect(texts(listPhraseCandidates(DOC, context({ field: "new_measure" })))).not.toContain(
      "Mxq varme må kontrolleres",
    );
  });

  it("K1.17a «Mest brukt»: flest valg kommer først ved lik plass, aldri foran et nærmere ledd", () => {
    const usage = [
      {
        field: "deviation_text",
        checkpointKey: "cp.walls",
        questionKey: "cp.walls.marks",
        outcomeKey: "tg2",
        measureSortOrder: null,
        count: 9,
      },
      {
        field: "deviation_text",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.cracks",
        outcomeKey: "tg3",
        measureSortOrder: null,
        count: 1,
      },
      // Annet felt teller ikke her
      {
        field: "cause_text",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.wet",
        outcomeKey: "choose",
        measureSortOrder: null,
        count: 50,
      },
    ] as const;
    const list = listPhraseCandidates(
      DOC,
      context({ checkpointKey: "cp.other", questionKey: null, outcomeKey: null, usage }),
    );
    expect(texts(list)).toEqual([
      "Mxq merker avvik",
      "Mxq sprekk avvik",
      "Mxq fall avvik",
      "Mxq fukt avvik {måleverdi}",
    ]);
    expect(list.map((c) => c.chosenCount)).toEqual([9, 1, 0, 0]);
    // Punktets egne står fortsatt først
    const own = listPhraseCandidates(DOC, context({ usage }));
    expect(own[0]?.text).toBe("Mxq fall avvik");
  });

  it("K1.17a merket «Mest brukt» krever minst to valg og gir den med flest", () => {
    expect(PHRASE_MOST_USED_MIN_COUNT).toBe(2);
    const base = listPhraseCandidates(DOC, context());
    const withCounts = base.map((c, i) => ({ ...c, chosenCount: [1, 3, 3, 0][i] ?? 0 }));
    expect(mostUsedPhraseCandidate(withCounts)?.text).toBe(base[1]?.text);
    expect(mostUsedPhraseCandidate(base.map((c) => ({ ...c, chosenCount: 1 })))).toBeNull();
    expect(mostUsedPhraseCandidate([])).toBeNull();
  });

  it("K1.17a tellingen er per organisasjon og tar ingen ansatt-id: typen har bare koder og tall", () => {
    const merged = mergePhraseUsage([
      {
        field: "new_measure",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.wet",
        outcomeKey: "choose",
        measureSortOrder: 1,
        count: 2,
      },
      {
        field: "new_measure",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.wet",
        outcomeKey: "choose",
        measureSortOrder: 1,
        count: 3,
      },
      {
        field: "new_measure",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.wet",
        outcomeKey: "choose",
        measureSortOrder: 0,
        count: 0,
      },
    ]);
    expect(merged).toEqual([
      {
        field: "new_measure",
        checkpointKey: "cp.floor",
        questionKey: "cp.floor.wet",
        outcomeKey: "choose",
        measureSortOrder: 1,
        count: 5,
      },
    ]);
    for (const entry of merged) {
      expect(Object.keys(entry).sort()).toEqual(
        ["checkpointKey", "count", "field", "measureSortOrder", "outcomeKey", "questionKey"].sort(),
      );
    }
    // Tekstsøket bruker samme tall: rekkefølgen fra listen står
    const list = listPhraseCandidates(
      DOC,
      context({
        field: "new_measure",
        checkpointKey: "cp.other",
        questionKey: null,
        outcomeKey: null,
        usage: merged,
      }),
    );
    expect(searchPhraseCandidates(list, "fukt", 5)[0]?.text).toBe("Mxq fukt må måles");
  });

  it("K1.17b new_measure gir standardtiltakene: tiltakene som alt står på avviket, tas ut", () => {
    const list = listPhraseCandidates(
      DOC,
      context({ field: "new_measure", currentTexts: ["Mxq fall bør rettes", ""] }),
    );
    expect(texts(list)).toEqual([
      "Mxq fukt bør måles",
      "Mxq fukt må måles",
      "Mxq merker bør vaskes",
    ]);
  });

  it("D4 «Utkast»-merket: malens tekst med flettefelt fylt inn gir malens status, egen tekst gir null", () => {
    const status = templateTextStatusMatcher([
      { text: "Mxq fukt avvik {måleverdi} målt", textStatus: "draft" },
      { text: "Mxq fall avvik", textStatus: "approved" },
    ]);
    expect(status("Mxq fukt avvik 77 7 2 målt")).toBe("draft");
    expect(status("Mxq fukt avvik [måleverdi mangler] målt")).toBe("draft");
    expect(status("  mxq FALL avvik ")).toBe("approved");
    expect(status("Mxq fall avvik, endret")).toBeNull();
    expect(status(null)).toBeNull();
    expect(status("   ")).toBeNull();
  });
});
