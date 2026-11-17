import { describe, expect, it } from "vitest";
import {
  assembleCodeOnlySummary,
  checkSummaryText,
  collectSummaryFindings,
  compareSummaryBasis,
  groupSummaryFindings,
  SUMMARY_GROUP_HEADINGS,
  SUMMARY_GROUP_ORDER,
  SUMMARY_TEXT_MAX_LENGTH,
  summaryBasisOf,
  summaryNeedsAi,
  uncoveredSummaryFindings,
  type SummaryCheckpointInput,
  type SummaryDeviationInput,
} from "@/core/reports/logic";
import { REPORT_SUMMARY_MAX_LENGTH, SUMMARY_GROUPS } from "@/db/schema";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";

/*
 * Sammendraget som rene funksjoner (docs/funksjoner/fase2a-ki-i-veien-testplan.md 1d:
 * K1.18–K1.26). Oppdiktede punkter og tekster.
 */

let next = 0;
function id(): string {
  next += 1;
  return `00000000-0000-7000-8000-${String(next).padStart(12, "0")}`;
}

function deviation(overrides: Partial<SummaryDeviationInput> = {}): SummaryDeviationInput {
  return {
    id: id(),
    rowVersion: 1,
    kind: "tg",
    tg: 2,
    sortOrder: 0,
    deviationText: "Mxq avvik",
    causeText: "Mxq årsak",
    consequenceText: "Mxq konsekvens",
    measures: [],
    ...overrides,
  };
}

function checkpoint(
  name: string,
  order: number,
  overrides: Partial<SummaryCheckpointInput> = {},
): SummaryCheckpointInput {
  return {
    resultId: id(),
    resultRowVersion: 1,
    checkpointKey: `cp.${order}`,
    checkpointName: name,
    order: [order],
    roomId: null,
    tgDirect: null,
    tgiu: null,
    deviations: [],
    ...overrides,
  };
}

describe("1d sammendraget", () => {
  it("K1.18 grupper og rekkefølge: TG3, TG2, TGIU, HMS sist; malens rekkefølge innen gruppen", () => {
    expect(SUMMARY_GROUP_ORDER).toEqual(SUMMARY_GROUPS);
    const floor = checkpoint("Gulv", 2, {
      deviations: [
        deviation({ tg: 2, sortOrder: 1, deviationText: "andre" }),
        deviation({ tg: 2, sortOrder: 0, deviationText: "første" }),
        deviation({ kind: "hms", tg: null }),
      ],
    });
    const walls = checkpoint("Vegger", 1, { deviations: [deviation({ tg: 2 })] });
    const vent = checkpoint("Ventilasjon", 3, { deviations: [deviation({ tg: 3 })] });
    const adjacent = checkpoint("Tilliggende", 4, {
      tgDirect: "IU",
      tgiu: { id: id(), rowVersion: 2, reason: "Mxq eier nektet hulltaking" },
    });
    const { findings } = collectSummaryFindings([adjacent, floor, vent, walls]);
    expect(findings.map((f) => [f.group, f.checkpointName, f.deviationText])).toEqual([
      ["tg3", "Ventilasjon", "Mxq avvik"],
      ["tg2", "Vegger", "Mxq avvik"],
      ["tg2", "Gulv", "første"],
      ["tg2", "Gulv", "andre"],
      ["tgiu", "Tilliggende", null],
      ["hms", "Gulv", "Mxq avvik"],
    ]);
    const groups = groupSummaryFindings(findings);
    expect(groups.map((g) => g.group)).toEqual(["tg3", "tg2", "tgiu", "hms"]);
    expect(groups.map((g) => g.heading)).toEqual([
      SUMMARY_GROUP_HEADINGS.tg3,
      SUMMARY_GROUP_HEADINGS.tg2,
      SUMMARY_GROUP_HEADINGS.tgiu,
      SUMMARY_GROUP_HEADINGS.hms,
    ]);
  });

  it("K1.18 tomme grupper tas ikke med", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Gulv", 1, { deviations: [deviation({ tg: 3 })] }),
    ]);
    expect(groupSummaryFindings(findings).map((g) => g.group)).toEqual(["tg3"]);
  });

  it.each([
    ["avvik med TG2", { deviations: [deviation({ tg: 2 })] }, 1],
    ["avvik med TG3", { deviations: [deviation({ tg: 3 })] }, 1],
    ["HMS-avvik", { deviations: [deviation({ kind: "hms", tg: null })] }, 1],
    ["punkt med TGIU", { tgDirect: "IU" as const }, 1],
    ["avvik uten valgt TG", { deviations: [deviation({ tg: null })] }, 0],
    ["TG0 på punktet", { tgDirect: "0" as const }, 0],
    ["TG1 på punktet", { tgDirect: "1" as const }, 0],
    // Avviste og ubesvarte regelforslag lager aldri avvik, så punktet er tomt
    ["avvist eller ubesvart regelforslag (tomt punkt)", {}, 0],
  ] as const)("K1.19 %s: tas med eller ikke", (_name, overrides, count) => {
    const { findings } = collectSummaryFindings([checkpoint("Punkt", 1, overrides)]);
    expect(findings).toHaveLength(count);
  });

  it("K1.19 mykt slettede avvik og tiltak sendes aldri inn, så de kan ikke bli funn eller del", () => {
    // Tjenesten leser bare rader med deleted_at is null; her vises at bare det som sendes inn, brukes
    const live = deviation({
      tg: 2,
      measures: [{ id: id(), rowVersion: 1, text: "Mxq tiltak", sortOrder: 0 }],
    });
    const { findings } = collectSummaryFindings([checkpoint("Gulv", 1, { deviations: [live] })]);
    expect(findings.map((f) => f.id)).toEqual([live.id]);
    expect(findings[0]?.parts).toHaveLength(1);
  });

  it("K4.17c / A465 avvik uten valgt TG telles og er ikke med", () => {
    const result = collectSummaryFindings([
      checkpoint("Gulv", 1, {
        deviations: [deviation({ tg: null }), deviation({ tg: null }), deviation({ tg: 2 })],
      }),
      checkpoint("HMS", 2, { deviations: [deviation({ kind: "hms", tg: null })] }),
    ]);
    expect(result.missingTgCount).toBe(2);
    expect(result.findings).toHaveLength(2);
  });

  it("K1.20 TGIU: koden skriver punktets navn og grunnen, aldri «uten funn»", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Tilliggende rom", 1, {
        tgDirect: "IU",
        tgiu: { id: id(), rowVersion: 1, reason: "Mxq eier nektet hulltaking" },
      }),
      checkpoint("Sluk", 2, { tgDirect: "IU", tgiu: { id: id(), rowVersion: 1, reason: "  " } }),
    ]);
    expect(summaryNeedsAi(findings)).toBe(false);
    const text = assembleCodeOnlySummary(findings);
    expect(text).toBe(
      [SUMMARY_GROUP_HEADINGS.tgiu, "Tilliggende rom: Mxq eier nektet hulltaking", "Sluk"].join(
        "\n",
      ),
    );
    expect(text.toLowerCase()).not.toContain("uten funn");
    expect(findings.every((f) => f.group === "tgiu")).toBe(true);
  });

  it("K1.21 overskriftene er kodens, og et utkast med TG2 trenger KI", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Gulv", 1, { deviations: [deviation({ tg: 2 })] }),
      checkpoint("Tilliggende", 2, { tgDirect: "IU" }),
    ]);
    expect(summaryNeedsAi(findings)).toBe(true);
    expect(SUMMARY_GROUP_HEADINGS).toEqual({
      tg3: "TG3 Store eller alvorlige avvik",
      tg2: "TG2 Vesentlige avvik",
      tgiu: "TGIU Ikke undersøkt",
      hms: "HMS Forhold som gjelder helse, miljø og sikkerhet",
    });
  });

  it("K1.22 funnet har bare tillatte tekster: ingen rom, etasje, eier informert, notat eller kostnad", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Gulv", 1, {
        roomId: id(),
        deviations: [
          deviation({
            tg: 3,
            measures: [
              { id: id(), rowVersion: 1, text: "Mxq tiltak b", sortOrder: 1 },
              { id: id(), rowVersion: 1, text: "Mxq tiltak a", sortOrder: 0 },
              { id: id(), rowVersion: 1, text: "   ", sortOrder: 2 },
            ],
          }),
        ],
      }),
    ]);
    const finding = findings[0];
    if (!finding) throw new Error("mangler funn");
    expect(Object.keys(finding).sort()).toEqual(
      [
        "causeText",
        "checkpointKey",
        "checkpointName",
        "consequenceText",
        "deviationText",
        "group",
        "id",
        "measures",
        "parts",
        "roomId",
        "rowVersion",
        "source",
        "tgiuReason",
      ].sort(),
    );
    expect(finding.measures).toEqual(["Mxq tiltak a", "Mxq tiltak b"]);
    expect(finding.parts).toHaveLength(3);
  });

  it("K1.24 «Funnene er endret»: endret row_version, TG, nytt og fjernet funn; likt gir ingen", () => {
    const keep = deviation({ tg: 2 });
    const changeTg = deviation({ tg: 2 });
    const remove = deviation({ tg: 3 });
    const measureId = id();
    const withMeasure = deviation({
      tg: 2,
      measures: [{ id: measureId, rowVersion: 1, text: "Mxq tiltak", sortOrder: 0 }],
    });
    const before = collectSummaryFindings([
      checkpoint("Gulv", 1, { deviations: [keep, changeTg, remove, withMeasure] }),
    ]).findings;
    const basis = summaryBasisOf(before);
    expect(compareSummaryBasis(basis, before)).toBeNull();
    expect(compareSummaryBasis(null, before)).toBeNull();
    expect(compareSummaryBasis([], before)).toBeNull();

    const added = deviation({ tg: 2 });
    const edited = { ...keep, rowVersion: 2 };
    const after = collectSummaryFindings([
      checkpoint("Gulv", 1, {
        deviations: [
          edited,
          { ...changeTg, tg: 3 },
          added,
          { ...withMeasure, measures: [{ id: measureId, rowVersion: 2, text: "x", sortOrder: 0 }] },
        ],
      }),
    ]).findings;
    const changes = compareSummaryBasis(basis, after);
    expect(changes?.added.map((f) => f.id)).toEqual([added.id]);
    expect(changes?.changed.map((f) => f.id).sort()).toEqual(
      [keep.id, changeTg.id, withMeasure.id].sort(),
    );
    expect(changes?.removedCount).toBe(1);
  });

  it("K1.24 et TGIU-punkt som bare merkes ferdig, gir ingen advarsel; endrede opplysninger gir", () => {
    const tgiu = { id: id(), rowVersion: 1, reason: "Mxq grunn" };
    const point = checkpoint("Tilliggende", 1, { tgDirect: "IU", tgiu });
    const basis = summaryBasisOf(collectSummaryFindings([point]).findings);
    const done = collectSummaryFindings([{ ...point, resultRowVersion: 5 }]).findings;
    expect(compareSummaryBasis(basis, done)).toBeNull();
    const edited = collectSummaryFindings([
      { ...point, tgiu: { ...tgiu, rowVersion: 2 } },
    ]).findings;
    expect(compareSummaryBasis(basis, edited)?.changed).toHaveLength(1);
  });

  it("K1.24 summary_basis har bare id, kilde, gruppe, row_version og deler, aldri tekst", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Gulv", 1, { deviations: [deviation({ tg: 2, deviationText: "Mxq-merke-ÆØ" })] }),
    ]);
    const basis = summaryBasisOf(findings);
    expect(JSON.stringify(basis)).not.toContain("Mxq-merke-ÆØ");
    expect(Object.keys(basis[0] ?? {}).sort()).toEqual(
      ["group", "id", "parts", "rowVersion", "source"].sort(),
    );
  });

  it("K1.25 dekningssjekk: TG3 og TGIU uten punktets navn i teksten gir advarsel", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Ventilasjon", 1, { deviations: [deviation({ tg: 3 })] }),
      checkpoint("Gulv og fall", 2, { deviations: [deviation({ tg: 2 })] }),
      checkpoint("Tilliggende konstruksjoner", 3, { tgDirect: "IU" }),
    ]);
    const uncovered = uncoveredSummaryFindings("Mxq tekst om gulvet", findings);
    expect(uncovered.map((f) => f.checkpointName)).toEqual([
      "Ventilasjon",
      "Tilliggende konstruksjoner",
    ]);
    // Navnet med annen bokstavstørrelse og mellomrom regnes som nevnt
    expect(
      uncoveredSummaryFindings("VENTILASJON: x\nTILLIGGENDE   konstruksjoner: y", findings),
    ).toEqual([]);
    // Tom tekst gir tom liste
    expect(uncoveredSummaryFindings("  ", findings)).toEqual([]);
    expect(uncoveredSummaryFindings(null, findings)).toEqual([]);
  });

  it("K1.25 et uendret utkast fra koden gir aldri advarselen", () => {
    const { findings } = collectSummaryFindings([
      checkpoint("Tilliggende konstruksjoner", 1, { tgDirect: "IU" }),
      checkpoint("Sluk", 2, { tgDirect: "IU" }),
    ]);
    expect(uncoveredSummaryFindings(assembleCodeOnlySummary(findings), findings)).toEqual([]);
  });

  it("K1.26 inndatakontroll: lengde, plassholdere og elleve sifre; tom tekst er lov", () => {
    expect(SUMMARY_TEXT_MAX_LENGTH).toBe(REPORT_SUMMARY_MAX_LENGTH);
    expect(checkSummaryText(null)).toBe("ok");
    expect(checkSummaryText("")).toBe("ok");
    expect(checkSummaryText("x".repeat(SUMMARY_TEXT_MAX_LENGTH))).toBe("ok");
    expect(checkSummaryText("x".repeat(SUMMARY_TEXT_MAX_LENGTH + 1))).toBe("too_long");
    for (const text of ["01019012345", "010190 12345", "010190.12345"]) {
      expect(checkSummaryText(`Mxq ${text}`)).toBe("national_id");
    }
    expect(checkSummaryText("Mxq 0101901234")).toBe("ok");
  });

  it.each(PII_PLACEHOLDERS.map((p) => [p]))("K1.26 plassholderen %s avvises", (placeholder) => {
    expect(checkSummaryText(`Mxq ${placeholder} tekst`)).toBe("placeholder");
    expect(checkSummaryText(`Mxq ${placeholder.toUpperCase()} tekst`)).toBe("placeholder");
  });
});
