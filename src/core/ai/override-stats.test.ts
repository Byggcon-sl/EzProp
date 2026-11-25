import { describe, expect, it } from "vitest";
import { TEMPLATE_KEY_PATTERN } from "@/db/schema";
import { extractNumbers } from "./guards";
import { AI_FEATURES } from "./features";
import { parseCasesFile } from "./evals/schema";
import { monthLabel, OVERRIDE_STATS_KEY_PATTERN, parseOverrideStats } from "./override-stats";
import { prepareOverridePrompt } from "./prompt";
import { fakeAiProvider } from "./providers/fake";
import type { AiOverrideStats, AiOverrideStatsRow } from "./types";

/*
 * Tallgrunnlaget til `override_summary`: den strenge kontrollen, ledeteksten og den falske
 * leverandøren (docs/funksjoner/fase2a-overstyringer-leder-testplan.md O1.3 for KI-delen og
 * O2.3). Ren test, ingen database. Alle tall og etiketter er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (bare koder, etiketter og tall går til KI) og færre reklamasjoner
 * (tallene KI skriver om, kan kontrolleres av tallvakten).
 */

function row(overrides: Partial<AiOverrideStatsRow> = {}): AiOverrideStatsRow {
  return {
    checkCode: "wet_or_below_ground_missing_hole",
    checkLabel: "Hulltaking mangler svar eller grunn",
    checkpointKey: "wet_room.hole_moisture",
    checkpointName: "Hulltaking i våtrom",
    reasonCode: "no_access_or_refused",
    reasonLabel: "Ikke tilgang eller nektet av eier",
    count: 2,
    sharePercent: 13,
    claimCount: 0,
    previousCount: 6,
    previousSharePercent: 38,
    deltaCount: -4,
    deltaPoints: -25,
    ...overrides,
  };
}

function stats(overrides: Partial<AiOverrideStats> = {}): AiOverrideStats {
  return {
    month: "2026-11",
    reportCount: 15,
    previousMonth: { reportCount: 16 },
    rows: [row()],
    ...overrides,
  };
}

describe("parseOverrideStats (O1.3)", () => {
  it("kodemønsteret er det samme som nøkkelformatet i databasen", () => {
    expect(OVERRIDE_STATS_KEY_PATTERN.source).toBe(TEMPLATE_KEY_PATTERN.source);
  });

  it("gyldig grunnlag godtas, også nedgang (negativ endring) og hele rapporten", () => {
    expect(parseOverrideStats(stats())).not.toBe(null);
    expect(
      parseOverrideStats(stats({ rows: [row({ checkpointKey: null, checkpointName: null })] })),
    ).not.toBe(null);
    expect(parseOverrideStats(stats({ rows: [] }))).not.toBe(null);
  });

  it("under fem rapporter: andel og prosentpoeng må være null (A570)", () => {
    const small = stats({
      reportCount: 4,
      rows: [row({ count: 2, sharePercent: null, deltaPoints: null })],
    });
    expect(parseOverrideStats(small)).not.toBe(null);
    expect(parseOverrideStats({ ...small, rows: [row({ count: 2, deltaPoints: null })] })).toBe(
      null,
    );
    const previousSmall = stats({ previousMonth: { reportCount: 4 } });
    expect(
      parseOverrideStats({
        ...previousSmall,
        rows: [
          row({ previousCount: 3, deltaCount: -1, previousSharePercent: null, deltaPoints: null }),
        ],
      }),
    ).not.toBe(null);
    expect(
      parseOverrideStats({
        ...previousSmall,
        rows: [row({ previousCount: 3, deltaCount: -1, deltaPoints: null })],
      }),
    ).toBe(null);
  });

  it.each([
    ["ukjent nøkkel på toppen", { ...stats(), assignmentId: "x" }],
    ["ukjent nøkkel i måneden før", { ...stats(), previousMonth: { reportCount: 16, extra: 1 } }],
    ["ukjent nøkkel i linjen", stats({ rows: [{ ...row(), overrideReason: "Mxq" } as never] })],
    ["kode med stor bokstav", stats({ rows: [row({ checkCode: "Hull" })] })],
    ["kode med bindestrek", stats({ rows: [row({ reasonCode: "no-access" })] })],
    ["tom etikett", stats({ rows: [row({ checkLabel: "  " })] })],
    ["for langt punktnavn", stats({ rows: [row({ checkpointName: "a".repeat(121) })] })],
    ["prosent over 100", stats({ rows: [row({ sharePercent: 101 })] })],
    ["negativt antall", stats({ rows: [row({ claimCount: -1 })] })],
    ["flere reklamasjoner enn rapporter", stats({ rows: [row({ claimCount: 3 })] })],
    ["flere rapporter enn i måneden", stats({ rows: [row({ count: 16, deltaCount: 10 })] })],
    ["null rapporter", stats({ reportCount: 0, rows: [] })],
    ["måned uten null foran", stats({ month: "2026-1" })],
    [
      "for mange linjer",
      stats({ rows: Array.from({ length: 61 }, (_, i) => row({ reasonCode: `r${i}` })) }),
    ],
  ])("avviser %s", (_name, value) => {
    expect(parseOverrideStats(value)).toBe(null);
  });

  it("månedsnavnet er norsk", () => {
    expect(monthLabel("2026-01")).toBe("januar 2026");
    expect(monthLabel("2026-10")).toBe("oktober 2026");
  });
});

describe("ledeteksten og den falske leverandøren for override_summary", () => {
  const definition = AI_FEATURES.override_summary;

  it("innholdet har etikettene og tallene, ingen koder og ingen minustegn", () => {
    const prepared = prepareOverridePrompt(definition, stats(), 2, null);
    const content = prepared.texts.join("\n");
    expect(content).toContain("Måned: november 2026");
    expect(content).toContain("Rapporter publisert: 15");
    expect(content).toContain("Linjer som ikke er tatt med: 2");
    expect(content).toContain("Endring i rapporter: ned 4");
    expect(content).toContain("Endring i andel: ned 25 prosentpoeng");
    expect(content).not.toContain("wet_or_below_ground_missing_hole");
    expect(content).not.toContain("-4");
    expect(prepared.rows).toBe(1);
    expect(prepared.cut).toBe(2);
    expect(prepared.prompt.endsWith(content)).toBe(true);
  });

  it("andel som ikke er regnet, skrives uten sifre", () => {
    const prepared = prepareOverridePrompt(
      definition,
      stats({ reportCount: 4, rows: [row({ count: 2, sharePercent: null, deltaPoints: null })] }),
      0,
      null,
    );
    const line = prepared.texts.at(-1) ?? "";
    expect(line).toMatch(/Andel: ikke regnet, for få rapporter/u);
    expect(extractNumbers(line).sort()).toEqual(["0", "2", "38", "4", "6"].sort());
  });

  it("den falske leverandøren svarer med bare tall fra grunnlaget", async () => {
    const prepared = prepareOverridePrompt(definition, stats(), 0, null);
    const result = await fakeAiProvider.complete({
      feature: "override_summary",
      promptVersion: definition.promptVersion,
      prompt: prepared.prompt,
      model: fakeAiProvider.model,
    });
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.text).toBe(
      "I november 2026 ble 15 rapporter publisert. Hulltaking mangler svar eller grunn (Hulltaking i våtrom) ble krysset bort med «Ikke tilgang eller nektet av eier» i 2 rapporter, 13 % av rapportene som ble publisert, ned fra 6 måneden før.",
    );
    const sent = new Set(prepared.texts.flatMap(extractNumbers));
    for (const value of extractNumbers(result.text)) expect(sent.has(value), value).toBe(true);
  });
});

describe("evalueringssettet for override_summary (O2.3)", () => {
  const validCase = {
    id: "x-1",
    stats: stats(),
    expect: { outcome: "ok" },
  };
  const file = (cases: unknown[], status = "utkast, ikke godkjent av fagrådet") => ({
    feature: "override_summary",
    status,
    note: "Oppdiktet.",
    cases: Array.from({ length: 30 }, (_, index) => ({
      ...(cases[index] ?? cases[0]!),
      id: `x-${index}`,
    })),
  });

  it("et gyldig sett godtas", () => {
    expect(parseCasesFile(file([validCase]), "f.json").ok).toBe(true);
  });

  it("sak uten fasit, uten utkastmerke eller med grunnlag som ikke består kontrollen avvises", () => {
    const { expect: _ignored, ...withoutExpect } = validCase;
    void _ignored;
    expect(parseCasesFile(file([withoutExpect]), "f.json").ok).toBe(false);
    expect(parseCasesFile(file([validCase], "godkjent"), "f.json").ok).toBe(false);
    expect(
      parseCasesFile(
        file([{ ...validCase, stats: { ...stats(), employeeName: "Mxqline Testesen" } }]),
        "f.json",
      ).ok,
    ).toBe(false);
    // not_called krever et grunnlag som avvises
    expect(
      parseCasesFile(file([{ ...validCase, expect: { outcome: "not_called" } }]), "f.json").ok,
    ).toBe(false);
  });
});
