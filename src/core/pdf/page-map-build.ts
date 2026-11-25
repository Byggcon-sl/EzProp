import { PDF_DRAFT_MARK_KINDS } from "./codes";
import { PdfRenderError } from "./errors";
import { isPdfPageAnchor, pdfPageAnchorKey } from "./page-map";
import type {
  BuildPdfPageMap,
  PdfDraftMarkKind,
  PdfEnginePage,
  PdfEnginePageMark,
  PdfPageMapEntry,
} from "./types";

/*
 * Sidekartet fra merkene til motoren (tillegget til ADR 0016, punkt 17). Ren. Merkene har ukjent
 * form til de er sjekket her: alt som ikke er et kjent anker med riktige tall, gir
 * `engine_failed`, aldri et halvt kart. Kartet har bare koder, id-er og tall.
 */

/**
 * Sidens marger i malen (`template.ts`: `margin: (top: 18mm, bottom: 22mm, left: 18mm, right:
 * 18mm)`), i punkter. Brukes når et avsnitt fortsetter over en side: da går det fra toppen av
 * innholdet på neste side, og til bunnen av innholdet på siden før.
 */
export const PDF_PAGE_MARGINS_PT = {
  top: (18 * 72) / 25.4,
  bottom: (22 * 72) / 25.4,
  right: (18 * 72) / 25.4,
} as const;

/** Biter av et avsnitt som er lavere enn dette (pt), er bare et merke ved sideskiftet. */
const MIN_SEGMENT_PT = 1;
/** Slakk for avrunding i motoren når et merke står helt ute ved kanten. */
const EDGE_PT = 0.5;

const MARK_KINDS: ReadonlySet<unknown> = new Set(PDF_DRAFT_MARK_KINDS);
const round = (value: number) => Math.round(value * 100) / 100;
const fail = (): never => {
  throw new PdfRenderError("engine_failed");
};

type CheckedMark = PdfEnginePageMark & { order: number };

function checkMark(value: unknown, pages: readonly PdfEnginePage[], order: number): CheckedMark {
  if (typeof value !== "object" || value === null) return fail();
  const mark = value as Record<string, unknown>;
  if (mark.edge !== "start" && mark.edge !== "end") return fail();
  if (!isPdfPageAnchor(mark.anchor)) return fail();
  if (mark.mark !== null && !MARK_KINDS.has(mark.mark)) return fail();
  const { page, x, y } = mark;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > pages.length) {
    return fail();
  }
  const size = pages[page - 1]!;
  if (typeof x !== "number" || !Number.isFinite(x) || x < -EDGE_PT || x > size.widthPt + EDGE_PT) {
    return fail();
  }
  if (typeof y !== "number" || !Number.isFinite(y) || y < -EDGE_PT || y > size.heightPt + EDGE_PT) {
    return fail();
  }
  return {
    edge: mark.edge,
    anchor: { ...mark.anchor },
    mark: mark.mark as PdfDraftMarkKind | null,
    page,
    x: Math.min(Math.max(x, 0), size.widthPt),
    y: Math.min(Math.max(y, 0), size.heightPt),
    order,
  };
}

/**
 * Par av `start` og `end` (i dokumentets rekkefølge, nøstet) blir én rad per side avsnittet står
 * på, sortert etter side og høyde på siden. Et avsnitt over to sider gir to rader med samme anker.
 */
export const buildPdfPageMap: BuildPdfPageMap = (marks, pages) => {
  if (!Array.isArray(marks) || !Array.isArray(pages)) return fail();
  const open = new Map<string, CheckedMark[]>();
  const entries: (PdfPageMapEntry & { order: number })[] = [];

  marks.forEach((value: unknown, index) => {
    const mark = checkMark(value, pages, index);
    const key = pdfPageAnchorKey(mark.anchor);
    if (mark.edge === "start") {
      const stack = open.get(key) ?? [];
      stack.push(mark);
      open.set(key, stack);
      return;
    }
    const start = open.get(key)?.pop();
    if (!start || start.mark !== mark.mark) return fail();
    if (mark.page < start.page || (mark.page === start.page && mark.y < start.y - EDGE_PT)) {
      return fail();
    }
    for (let page = start.page; page <= mark.page; page += 1) {
      const size = pages[page - 1]!;
      const top = page === start.page ? start.y : PDF_PAGE_MARGINS_PT.top;
      const bottom = page === mark.page ? mark.y : size.heightPt - PDF_PAGE_MARGINS_PT.bottom;
      const right = size.widthPt - PDF_PAGE_MARGINS_PT.right;
      const h = bottom - top;
      if (h < MIN_SEGMENT_PT) continue;
      const x = Math.min(start.x, right - MIN_SEGMENT_PT);
      entries.push({
        anchor: start.anchor,
        page,
        x: round(x),
        y: round(top),
        w: round(right - x),
        h: round(h),
        mark: start.mark,
        order: start.order,
      });
    }
  });
  for (const stack of open.values()) if (stack.length > 0) return fail();

  return entries
    .sort((a, b) => a.page - b.page || a.y - b.y || a.order - b.order)
    .map(({ order: _order, ...entry }) => entry);
};
