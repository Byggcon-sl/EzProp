import { describe, expect, it } from "vitest";
import {
  PDF_DRAFT_MARK_KINDS,
  PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN,
  PDF_PAGE_ANCHOR_ID_PATTERN,
  PDF_PAGE_ANCHOR_KINDS,
} from "./codes";
import { PdfRenderError } from "./errors";
import {
  isPdfPageAnchor,
  PAGE_ANCHOR_ELEMENT_KEY,
  PAGE_ANCHOR_ID,
  pdfPageAnchorKey,
  samePdfPageAnchor,
} from "./page-map";
import { buildPdfPageMap, PDF_PAGE_MARGINS_PT } from "./page-map-build";
import type { PdfEnginePage, PdfEnginePageMark, PdfPageAnchor } from "./types";

/*
 * Ankrene og sidekartet som rene funksjoner (testplanen LF3, regel 6). Ingen motor, ingen
 * database. Støtter hovedmål: KI i bunnen (kartet har bare id-er og faste koder) og færre
 * reklamasjoner (et kart med feil gir ingen visning, aldri et halvt kart).
 */

const CP = "0193a000-0000-7000-8000-000000000010";
const DEV = "0193a000-0000-7000-8000-000000000020";
const A4: PdfEnginePage = { svg: "", widthPt: 595.28, heightPt: 841.89, offsetYPt: 0 };
const pages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ ...A4, offsetYPt: index * 842 }));

const checkpoint: PdfPageAnchor = {
  kind: "checkpoint",
  checkpointId: CP,
  deviationId: null,
  elementKey: null,
};
const cause: PdfPageAnchor = {
  kind: "deviation.cause",
  checkpointId: CP,
  deviationId: DEV,
  elementKey: null,
};
const answer: PdfPageAnchor = {
  kind: "checkpoint.answer",
  checkpointId: CP,
  deviationId: null,
  elementKey: "wet_room.moisture",
};

function mark(
  edge: "start" | "end",
  anchor: PdfPageAnchor,
  page: number,
  y: number,
  overrides: Partial<PdfEnginePageMark> = {},
): PdfEnginePageMark {
  return { edge, anchor, mark: null, page, x: 51.02, y, ...overrides };
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(PdfRenderError);
    return (error as PdfRenderError).code;
  }
}

describe("LF3.9 faste koder (regel 6)", () => {
  it("ankerkodene står i fast rekkefølge; nye koder legges bare til nederst", () => {
    expect(PDF_PAGE_ANCHOR_KINDS).toEqual([
      "checkpoint",
      "checkpoint.description",
      "checkpoint.answer",
      "deviation",
      "deviation.text",
      "deviation.cause",
      "deviation.consequence",
      "deviation.measures",
      "deviation.cost",
      "tgiu",
    ]);
    expect(PDF_DRAFT_MARK_KINDS).toEqual(["tg_not_set", "missing", "check"]);
  });

  it("page-map.ts har de samme formkravene som codes.ts", () => {
    expect(PAGE_ANCHOR_ID.source).toBe(PDF_PAGE_ANCHOR_ID_PATTERN.source);
    expect(PAGE_ANCHOR_ELEMENT_KEY.source).toBe(PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN.source);
    for (const kind of PDF_PAGE_ANCHOR_KINDS) {
      const isDeviation = kind.startsWith("deviation");
      expect(
        isPdfPageAnchor({
          kind,
          checkpointId: CP,
          deviationId: isDeviation ? DEV : null,
          elementKey: kind === "checkpoint.answer" ? "wet_room.moisture" : null,
        }),
        kind,
      ).toBe(true);
    }
  });
});

describe("isPdfPageAnchor", () => {
  it.each([
    ["ukjent kode", { ...checkpoint, kind: "checkpoint.label" }],
    ["arkivert eller skrevet om", { ...checkpoint, kind: "Checkpoint" }],
    ["id som ikke er UUID", { ...checkpoint, checkpointId: "a1" }],
    ["id med store bokstaver", { ...checkpoint, checkpointId: CP.toUpperCase() }],
    ["avvik uten deviationId", { ...cause, deviationId: null }],
    ["punkt med deviationId", { ...checkpoint, deviationId: DEV }],
    ["svar uten elementKey", { ...answer, elementKey: null }],
    ["elementKey på annet enn svar", { ...checkpoint, elementKey: "wet_room.moisture" }],
    ["selector i elementKey", { ...answer, elementKey: 'x"],[onclick' }],
    ["sti i elementKey", { ...answer, elementKey: "../../etc" }],
    ["tekst i elementKey", { ...answer, elementKey: "Fuktmåling 12,4" }],
    ["for lang elementKey", { ...answer, elementKey: "a".repeat(201) }],
    ["ekstra felt", { ...checkpoint, text: "Prøvetekst" }],
    ["felt mangler", { kind: "checkpoint", checkpointId: CP, deviationId: null }],
    ["liste", [checkpoint]],
    ["tekst", "checkpoint"],
    ["null", null],
    ["prototype", Object.assign(Object.create({ evil: true }), checkpoint)],
  ])("avviser %s", (_name, value) => {
    expect(isPdfPageAnchor(value)).toBe(false);
  });

  it("godtar gyldige ankere", () => {
    for (const anchor of [checkpoint, cause, answer]) expect(isPdfPageAnchor(anchor)).toBe(true);
  });
});

describe("pdfPageAnchorKey og samePdfPageAnchor", () => {
  it("ulike ankere har ulik nøkkel; like ankere er like", () => {
    const keys = new Set([checkpoint, cause, answer].map(pdfPageAnchorKey));
    expect(keys.size).toBe(3);
    expect(pdfPageAnchorKey({ ...answer })).toBe(pdfPageAnchorKey(answer));
    expect(samePdfPageAnchor(answer, { ...answer })).toBe(true);
    expect(samePdfPageAnchor(answer, { ...answer, elementKey: "wet_room.hole_taken" })).toBe(false);
    expect(samePdfPageAnchor(checkpoint, cause)).toBe(false);
  });
});

describe("buildPdfPageMap", () => {
  it("ett par på én side gir én rad med plass og høyde", () => {
    const map = buildPdfPageMap(
      [mark("start", checkpoint, 4, 100), mark("end", checkpoint, 4, 250)],
      pages(6),
    );
    expect(map).toEqual([
      {
        anchor: checkpoint,
        page: 4,
        x: 51.02,
        y: 100,
        w: Math.round((595.28 - PDF_PAGE_MARGINS_PT.right - 51.02) * 100) / 100,
        h: 150,
        mark: null,
      },
    ]);
  });

  it("LF3.3 avsnitt over to (og tre) sider gir én rad per side", () => {
    const map = buildPdfPageMap(
      [mark("start", cause, 2, 700), mark("end", cause, 4, 120)],
      pages(4),
    );
    expect(map.map((row) => row.page)).toEqual([2, 3, 4]);
    expect(map[0]!.y).toBe(700);
    expect(map[0]!.h).toBeCloseTo(841.89 - PDF_PAGE_MARGINS_PT.bottom - 700, 1);
    expect(map[1]!.y).toBeCloseTo(PDF_PAGE_MARGINS_PT.top, 1);
    expect(map[2]!.h).toBeCloseTo(120 - PDF_PAGE_MARGINS_PT.top, 1);
    for (const row of map) expect(row.anchor).toEqual(cause);
  });

  it("et merke alene nederst på siden (avsnittet starter på neste) gir ingen tom rad", () => {
    const bottom = 841.89 - PDF_PAGE_MARGINS_PT.bottom;
    const map = buildPdfPageMap(
      [mark("start", checkpoint, 2, bottom), mark("end", checkpoint, 3, 200)],
      pages(3),
    );
    expect(map.map((row) => row.page)).toEqual([3]);
  });

  it("nøstede avsnitt og rekkefølge: side, så høyde", () => {
    const map = buildPdfPageMap(
      [
        mark("start", checkpoint, 1, 100),
        mark("start", answer, 1, 120),
        mark("end", answer, 1, 130),
        mark("start", cause, 1, 140, { x: 63 }),
        mark("end", cause, 2, 90, { x: 63 }),
        mark("end", checkpoint, 2, 100),
      ],
      pages(2),
    );
    expect(map.map((row) => [row.anchor.kind, row.page, row.y])).toEqual([
      ["checkpoint", 1, 100],
      ["checkpoint.answer", 1, 120],
      ["deviation.cause", 1, 140],
      ["checkpoint", 2, expect.closeTo(PDF_PAGE_MARGINS_PT.top, 1)],
      ["deviation.cause", 2, expect.closeTo(PDF_PAGE_MARGINS_PT.top, 1)],
    ]);
  });

  it("mark kommer med, og bare som fast kode", () => {
    const map = buildPdfPageMap(
      [
        mark("start", checkpoint, 1, 100, { mark: "tg_not_set" }),
        mark("end", checkpoint, 1, 200, { mark: "tg_not_set" }),
      ],
      pages(1),
    );
    expect(map[0]!.mark).toBe("tg_not_set");
  });

  it("tomt dokument uten merker gir tomt kart", () => {
    expect(buildPdfPageMap([], pages(2))).toEqual([]);
  });

  it.each<[string, unknown[]]>([
    ["slutt uten start", [mark("end", checkpoint, 1, 100)]],
    ["start uten slutt", [mark("start", checkpoint, 1, 100)]],
    ["slutt før start", [mark("start", checkpoint, 2, 100), mark("end", checkpoint, 1, 100)]],
    [
      "slutt over start på samme side",
      [mark("start", checkpoint, 1, 300), mark("end", checkpoint, 1, 100)],
    ],
    [
      "ulikt merke i start og slutt",
      [
        mark("start", checkpoint, 1, 100, { mark: "missing" }),
        mark("end", checkpoint, 1, 200, { mark: "check" }),
      ],
    ],
    [
      "ukjent merke",
      [
        mark("start", checkpoint, 1, 100, { mark: "Mangler" as never }),
        mark("end", checkpoint, 1, 200, { mark: "Mangler" as never }),
      ],
    ],
    [
      "ukjent anker",
      [
        mark("start", { ...checkpoint, kind: "x" as never }, 1, 100),
        mark("end", { ...checkpoint, kind: "x" as never }, 1, 200),
      ],
    ],
    [
      "tekst i ankeret",
      [
        mark("start", { ...checkpoint, checkpointId: "Prøvevegen 1" }, 1, 100),
        mark("end", { ...checkpoint, checkpointId: "Prøvevegen 1" }, 1, 200),
      ],
    ],
    ["side 0", [mark("start", checkpoint, 0, 100), mark("end", checkpoint, 0, 200)]],
    ["side utenfor", [mark("start", checkpoint, 3, 100), mark("end", checkpoint, 3, 200)]],
    [
      "side som tekst",
      [mark("start", checkpoint, "1" as never, 100), mark("end", checkpoint, 1, 2)],
    ],
    ["NaN", [mark("start", checkpoint, 1, Number.NaN), mark("end", checkpoint, 1, 200)]],
    ["uendelig", [mark("start", checkpoint, 1, 100), mark("end", checkpoint, 1, Infinity)]],
    ["under siden", [mark("start", checkpoint, 1, 100), mark("end", checkpoint, 1, 900)]],
    ["negativ x", [mark("start", checkpoint, 1, 100, { x: -20 }), mark("end", checkpoint, 1, 2)]],
    ["ukjent kant", [{ ...mark("start", checkpoint, 1, 100), edge: "middle" }]],
    ["ikke et objekt", ["start"]],
    ["null", [null]],
  ])("%s gir engine_failed, aldri et halvt kart", (_name, marks) => {
    expect(codeOf(() => buildPdfPageMap(marks as PdfEnginePageMark[], pages(2)))).toBe(
      "engine_failed",
    );
  });
});
