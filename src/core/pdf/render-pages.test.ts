import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bathroomPdfData, IDS, TEST_LANDSCAPE_PROFILE } from "../../../tests/pdf-fixtures";
import { inspectPdf } from "../../../tests/pdf-inspect";

vi.mock("server-only", () => ({}));

const { loadPdfAssets } = await import("./assets.node");
const { createNodeWorkerEngine } = await import("./engine.node");
const {
  PDF_DRAFT_MARK_KINDS,
  PDF_PAGE_ANCHOR_KINDS,
  PDF_PAGE_HASH_LENGTH,
  PDF_PREVIEW_LIMITS,
  PDF_DEFAULT_LIMITS,
} = await import("./codes");
const { PdfRenderError } = await import("./errors");
const { cleanPageSvg, isSafePageSvg } = await import("./page-svg");
const { BYGGCON_STANDARD_PROFILE } = await import("./profiles");
const { createReportPagesRenderer, createReportPdfRenderer, preparePdfJob } =
  await import("./render");
const { renderReportPages } = await import("./index");
type ReportPdfData = import("./types").ReportPdfData;
type PdfAssets = import("./types").PdfAssets;
type PdfEngine = import("./types").PdfEngine;
type RenderedPages = import("./types").RenderedPages;
type RenderReportPagesOptions = import("./types").RenderReportPagesOptions;

/*
 * Sidene som SVG og sidekartet mot motoren (testplanen LF1 og LF3). Oppdiktede data, ingen
 * database. Støtter hovedmål: færre reklamasjoner (samme sider og merker som PDF-utkastet), KI i
 * bunnen (sidekartet har bare id-er og faste koder) og de ansatte (rask nok til å følge skrivingen).
 */

const NOW = new Date("2026-11-03T10:00:00Z");
const BASE = "https://app.example.invalid";
const engine = createNodeWorkerEngine();
const renderPages = createReportPagesRenderer(engine);
const renderPdf = createReportPdfRenderer(engine);
let assets: PdfAssets;
let bath: RenderedPages;

function options(overrides: Partial<RenderReportPagesOptions> = {}): RenderReportPagesOptions {
  return {
    draft: true,
    generatedAt: NOW,
    appBaseUrl: BASE,
    assets,
    limits: PDF_PREVIEW_LIMITS,
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PdfRenderError);
  return (error as InstanceType<typeof PdfRenderError>).code;
}

/** Teksten i markeringslaget til rendereren, før ryddingen. Bare for å sammenligne med PDF-en. */
function rawText(svg: string): string {
  return [...svg.matchAll(/<h5:div[^>]*>([^<]*)<\/h5:div>/g)]
    .map((match) => match[1]!)
    .join(" ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Sidene rett fra motoren (med tekstlaget), for samme jobb som `renderReportPages`. */
async function rawPages(data: ReportPdfData) {
  const prepared = preparePdfJob(data, BYGGCON_STANDARD_PROFILE, options(), "pages");
  const result = await engine(prepared.job, { timeoutMs: 20_000 });
  if (result.output !== "pages") throw new Error("ventet sider");
  return result;
}

const LONG_CAUSE = "Prøvetekst for en lang årsak som går over flere linjer i testbadet. ".repeat(
  140,
);

/** Mange rom med kopier av badet, med egne id-er, for et dokument på rundt 30 sider. */
function largeReport(copies: number): ReportPdfData {
  const data = bathroomPdfData("draft");
  const room = data.rooms[0]!;
  let next = 0x1000;
  const id = () => `0193a000-0000-7000-8000-${(next++).toString(16).padStart(12, "0")}`;
  data.rooms = Array.from({ length: copies }, (_, index) => ({
    ...structuredClone(room),
    roomId: id(),
    title: `Bad ${index + 1}`,
    checkpoints: structuredClone(room.checkpoints).map((checkpoint) => ({
      ...checkpoint,
      checkpointId: id(),
      descriptionText: `${checkpoint.descriptionText ?? ""} ${"Utfyllende prøvetekst. ".repeat(20)}`,
      deviations: checkpoint.deviations.map((deviation) => ({
        ...deviation,
        deviationId: id(),
        images: index < 4 ? deviation.images : [],
      })),
    })),
  }));
  return data;
}

beforeAll(async () => {
  assets = await loadPdfAssets();
  bath = await renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
}, 60_000);

describe("LF1 sidene som SVG", () => {
  it("LF1.1 like mange sider som PDF-utkastet for samme data og profil", async () => {
    const pdf = await renderPdf(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, {
      ...options(),
      limits: PDF_DEFAULT_LIMITS,
    });
    expect(bath.pages).toHaveLength(pdf.pageCount);
    expect(bath.imageCount).toBe(pdf.imageCount);
  });

  it("LF1.2 «UTKAST» på hver side, og «Ikke satt», «Mangler» og «Sjekk» på samme side som i PDF-utkastet", async () => {
    const pdf = inspectPdf(
      (
        await renderPdf(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, {
          ...options(),
          limits: PDF_DEFAULT_LIMITS,
        })
      ).bytes,
    );
    const raw = await rawPages(bathroomPdfData("draft"));
    expect(raw.pages).toHaveLength(pdf.pages.length);
    raw.pages.forEach((page, index) => {
      const svgText = rawText(page.svg).replace(/\s+/g, " ");
      const pdfText = pdf.pages[index]!.lines.map((line) => line.text).join(" ");
      expect(svgText, `side ${index + 1}`).toContain("UTKAST");
      for (const word of ["Ikke satt", "Mangler:", "Sjekk:", "Ikke med i PDF-en"]) {
        expect(svgText.includes(word), `${word} på side ${index + 1}`).toBe(pdfText.includes(word));
      }
    });
    // Utkastmerkene finnes i sidekartet på de samme sidene.
    const markedPages = (kind: string) =>
      [...new Set(bath.pageMap.filter((row) => row.mark === kind).map((row) => row.page))].sort();
    const pagesWith = (word: string) =>
      raw.pages.flatMap((page, index) => (rawText(page.svg).includes(word) ? [index + 1] : []));
    expect(markedPages("tg_not_set")).toEqual(pagesWith("Ikke satt"));
    expect(markedPages("check")).toEqual(pagesWith("Sjekk:"));
    for (const page of markedPages("missing")) {
      expect(rawText(raw.pages[page - 1]!.svg)).toMatch(/Mangler:|Ikke med i PDF-en/);
    }
  });

  it("LF1.3 samme inndata gir samme hash; endret avvikstekst endrer bare siden med avviket", async () => {
    const again = await renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
    expect(again.pages.map((page) => page.hash)).toEqual(bath.pages.map((page) => page.hash));
    expect(again.pageMap).toEqual(bath.pageMap);

    const changed = bathroomPdfData("draft");
    const drain = changed.rooms[0]!.checkpoints.find((cp) => cp.checkpointId === IDS.cpDrain)!;
    drain.deviations[0]!.text = "Endret prøvetekst for avviket ved sluket.";
    const after = await renderPages(changed, BYGGCON_STANDARD_PROFILE, options());
    const drainPages = new Set(
      bath.pageMap.filter((row) => row.anchor.deviationId === IDS.devDrain).map((row) => row.page),
    );
    expect(after.pages).toHaveLength(bath.pages.length);
    after.pages.forEach((page, index) => {
      const same = page.hash === bath.pages[index]!.hash;
      expect(same, `side ${index + 1}`).toBe(!drainPages.has(index + 1));
    });
  });

  it("LF1.4 hash er SHA-256 av SVG-en, heksadesimalt med fast lengde", async () => {
    const { createHash } = await import("node:crypto");
    for (const page of bath.pages) {
      expect(page.hash).toMatch(new RegExp(`^[0-9a-f]{${PDF_PAGE_HASH_LENGTH}}$`));
      expect(page.hash).toBe(
        createHash("sha256").update(page.svg).digest("hex").slice(0, PDF_PAGE_HASH_LENGTH),
      );
    }
  });

  it("LF1.5 sidene er A4 i punkter, og liggende med liggende profil", async () => {
    for (const page of bath.pages) {
      expect(page.widthPt).toBeCloseTo(595.28, 1);
      expect(page.heightPt).toBeCloseTo(841.89, 1);
      expect(page.svg).toContain('viewBox="0 0 595.276 841.89"');
    }
    const landscape = await renderPages(
      bathroomPdfData("draft"),
      TEST_LANDSCAPE_PROFILE,
      options(),
    );
    for (const page of landscape.pages) {
      expect(page.widthPt).toBeCloseTo(841.89, 1);
      expect(page.heightPt).toBeCloseTo(595.28, 1);
      expect(isSafePageSvg(page.svg)).toBe(true);
    }
  });

  it.each(Array.from({ length: 6 }, (_, index) => index))(
    "LF1.6 side %i er en sikker, selvstendig SVG uten tekst",
    (index) => {
      const svg = bath.pages[index]!.svg;
      expect(isSafePageSvg(svg)).toBe(true);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/\son[a-z]+=/i);
      expect(svg).not.toMatch(/foreignObject|<a[\s>]|<style/i);
      for (const [, href] of svg.matchAll(/(?:xlink:)?href="([^"]*)"/g)) {
        expect(href).toMatch(/^(?:#|data:image\/(?:png|jpeg);base64,)/);
      }
      expect(svg).not.toMatch(/@import|url\(http|https?:\/\/(?!www\.w3\.org\/)/);
      // Teksten er omriss: ingen tekst mellom elementene.
      expect(svg.replace(/<[^>]*>/g, "").trim()).toBe("");
      // Ingen rapporttekst, adresse eller lenke til skjemaet i SVG-en.
      for (const text of ["Prøvevegen", "Gnr. 999", "Prøvetekst", "/oppdrag/", "UTKAST"]) {
        expect(svg).not.toContain(text);
      }
    },
  );

  it("LF1.7 tekst som ligner kode står som tekst, og sidene er like sikre", async () => {
    const data = bathroomPdfData("draft");
    const cause = '<script>alert(1)</script> {{ x }} #import "x" ] \\ " #read("/etc/passwd")';
    data.rooms[0]!.checkpoints[0]!.deviations[0]!.causeText = cause;
    const result = await renderPages(data, BYGGCON_STANDARD_PROFILE, options());
    for (const page of result.pages) {
      expect(isSafePageSvg(page.svg)).toBe(true);
      expect(page.svg).not.toMatch(/<script|\{\{|#import|#read/);
    }
    const raw = await rawPages(data);
    expect(raw.pages.map((page) => rawText(page.svg)).join(" ")).toContain(cause);
  });

  it("LF1.8 over taket på sider eller størrelse gir egen kode og ingen delvis svar", async () => {
    const limits = { ...PDF_PREVIEW_LIMITS, maxPages: 3 };
    expect(
      await codeOf(
        renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options({ limits })),
      ),
    ).toBe("too_many_pages");
    const small = { ...PDF_PREVIEW_LIMITS, maxSvgBytesTotal: 200_000 };
    expect(
      await codeOf(
        renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options({ limits: small })),
      ),
    ).toBe("pages_too_large");
    // Også når motoren selv ikke stopper: gjengivelsen teller sidene.
    const ignoringLimit: PdfEngine = (job, timeout) =>
      engine({ ...job, maxPages: undefined }, timeout);
    expect(
      await codeOf(
        createReportPagesRenderer(ignoringLimit)(
          bathroomPdfData("draft"),
          BYGGCON_STANDARD_PROFILE,
          options({ limits }),
        ),
      ),
    ).toBe("too_many_pages");
    // Ugyldige tak er en feil, aldri «uten tak».
    expect(
      await codeOf(
        renderPages(
          bathroomPdfData("draft"),
          BYGGCON_STANDARD_PROFILE,
          options({ limits: { ...PDF_PREVIEW_LIMITS, maxPages: Number.NaN } }),
        ),
      ),
    ).toBe("engine_failed");
  });

  it("LF1.9 feil i motoren gir engine_failed uten rapporttekst i meldingen", async () => {
    const data = bathroomPdfData("draft");
    data.rooms[0]!.checkpoints[0]!.deviations[0]!.causeText = "Hemmelig merketekst 4711";
    const broken: PdfEngine = (job, timeout) =>
      engine({ ...job, source: `${job.source}\n#let = (` }, timeout);
    const error = await createReportPagesRenderer(broken)(
      data,
      BYGGCON_STANDARD_PROFILE,
      options(),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfRenderError);
    expect((error as InstanceType<typeof PdfRenderError>).code).toBe("engine_failed");
    expect(String((error as Error).message)).not.toContain("4711");
    expect(String((error as Error).stack)).not.toContain("4711");

    // Motoren svarer med feil form: også engine_failed.
    const wrongOutput: PdfEngine = async () => ({
      output: "pdf",
      bytes: new Uint8Array(),
      pageCount: 1,
    });
    expect(
      await codeOf(
        createReportPagesRenderer(wrongOutput)(
          bathroomPdfData(),
          BYGGCON_STANDARD_PROFILE,
          options(),
        ),
      ),
    ).toBe("engine_failed");
    // En side som ikke kan ryddes, avviser hele gjengivelsen.
    const unsafe: PdfEngine = async (job, timeout) => {
      const result = await engine(job, timeout);
      if (result.output !== "pages") return result;
      const pages = result.pages.map((page, index) =>
        index === 1 ? { ...page, svg: page.svg.replace("<defs", "<!-- x --><defs") } : page,
      );
      return { ...result, pages };
    };
    expect(
      await codeOf(
        createReportPagesRenderer(unsafe)(bathroomPdfData(), BYGGCON_STANDARD_PROFILE, options()),
      ),
    ).toBe("engine_failed");
  });

  it("LF1.10 ingen midlertidige filer, heller ikke ved feil", async () => {
    const before = readdirSync(tmpdir()).length;
    const varDir = join(process.cwd(), "var");
    const varCount = () => {
      try {
        return readdirSync(varDir, { recursive: true }).length;
      } catch {
        return 0;
      }
    };
    const varBefore = varCount();
    for (let run = 0; run < 3; run += 1) {
      await renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
    }
    await renderPages(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options({ limits: { ...PDF_PREVIEW_LIMITS, maxPages: 1 } }),
    ).catch(() => undefined);
    await createReportPagesRenderer((job, timeout) =>
      engine({ ...job, source: "#let = (" }, timeout),
    )(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options()).catch(() => undefined);
    expect(readdirSync(tmpdir()).length).toBe(before);
    expect(varCount()).toBe(varBefore);
  });

  it("LF1.11 ny tråd per gjengivelse, avsluttet etterpå (også ved feil)", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    await renderPages(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
    await renderPages(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options({ limits: { ...PDF_PREVIEW_LIMITS, maxPages: 1 } }),
    ).catch(() => undefined);
    expect(terminate).toHaveBeenCalledTimes(2);
    terminate.mockRestore();
  });

  it("serverinngangen renderReportPages er koblet til motoren", async () => {
    const result = await renderReportPages(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options(),
    );
    expect(result.pages.map((page) => page.hash)).toEqual(bath.pages.map((page) => page.hash));
  });

  it("rundt 30 sider: under taket, samme antall sider som PDF-en, og raskt nok", async () => {
    const data = largeReport(10);
    const started = performance.now();
    const result = await renderPages(data, BYGGCON_STANDARD_PROFILE, options());
    const ms = performance.now() - started;
    const pdf = await renderPdf(data, BYGGCON_STANDARD_PROFILE, {
      ...options(),
      limits: PDF_DEFAULT_LIMITS,
    });
    expect(result.pages.length).toBe(pdf.pageCount);
    expect(result.pages.length).toBeGreaterThanOrEqual(25);
    expect(ms).toBeLessThan(10_000);
    const total = result.pages.reduce((sum, page) => sum + page.svg.length, 0);
    expect(total).toBeLessThanOrEqual(PDF_PREVIEW_LIMITS.maxSvgBytesTotal);
    for (const page of result.pages) expect(isSafePageSvg(page.svg)).toBe(true);
  }, 60_000);
});

describe("LF3 sidekartet fra gjengivelsen", () => {
  it("LF3.1 alle ankerkodene finnes, med riktige id-er og elementKey bare for svar", () => {
    for (const kind of PDF_PAGE_ANCHOR_KINDS) {
      const rows = bath.pageMap.filter((row) => row.anchor.kind === kind);
      expect(rows.length, kind).toBeGreaterThan(0);
      for (const { anchor } of rows) {
        expect(Object.values(IDS)).toContain(anchor.checkpointId);
        if (kind.startsWith("deviation")) expect(Object.values(IDS)).toContain(anchor.deviationId);
        else expect(anchor.deviationId).toBeNull();
        if (kind === "checkpoint.answer") expect(anchor.elementKey).toMatch(/^wet_room\./);
        else expect(anchor.elementKey).toBeNull();
      }
    }
    const answers = bath.pageMap
      .filter((row) => row.anchor.kind === "checkpoint.answer")
      .map((row) => row.anchor.elementKey);
    expect(answers).toEqual(["wet_room.hole_taken", "wet_room.moisture"]);
  });

  it("LF3.2 ankrene kommer fra id-ene, ikke fra editPath: utgivelsen gir samme ankere", async () => {
    const release = await renderPages(bathroomPdfData("release"), BYGGCON_STANDARD_PROFILE, {
      ...options(),
      draft: false,
    });
    const anchors = (pages: RenderedPages) =>
      pages.pageMap
        .filter((row) => !(row.anchor.kind === "checkpoint" && row.mark === "missing"))
        .map((row) => row.anchor);
    // Utkastet har i tillegg punktet uten innhold på siden «Ikke med i PDF-en».
    const draftAnchors = anchors(bath).filter((anchor) => anchor.checkpointId !== IDS.cpEmpty);
    expect(new Set(anchors(release).map((a) => JSON.stringify(a)))).toEqual(
      new Set(draftAnchors.map((a) => JSON.stringify(a))),
    );
    expect(JSON.stringify(bath.pageMap)).not.toMatch(/"a\d+"|#punkt|#avvik|\/oppdrag\//);
  });

  it("LF3.3 et avsnitt over to sider gir én rad per side med samme anker", async () => {
    const data = bathroomPdfData("draft");
    data.rooms[0]!.checkpoints[0]!.deviations[0]!.causeText = LONG_CAUSE;
    const result = await renderPages(data, BYGGCON_STANDARD_PROFILE, options());
    const cause = result.pageMap.filter(
      (row) => row.anchor.kind === "deviation.cause" && row.anchor.deviationId === IDS.devMembrane,
    );
    expect(cause.length).toBeGreaterThanOrEqual(2);
    const pages = cause.map((row) => row.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(new Set(pages).size).toBe(pages.length);
    for (const row of cause) expect(row.anchor).toEqual(cause[0]!.anchor);
  });

  it("LF3.4 mark bare der utkastet har merke, og bare faste koder", () => {
    const marked = bath.pageMap.filter((row) => row.mark !== null);
    for (const row of marked) expect(PDF_DRAFT_MARK_KINDS).toContain(row.mark);
    const markOf = (checkpointId: string, kind = "checkpoint") =>
      bath.pageMap.find(
        (row) => row.anchor.checkpointId === checkpointId && row.anchor.kind === kind,
      )?.mark;
    expect(markOf(IDS.cpVentilation)).toBe("tg_not_set");
    expect(markOf(IDS.cpEmpty)).toBe("missing");
    expect(markOf(IDS.cpMembrane, "deviation")).toBe("check");
    expect(markOf(IDS.cpMembrane)).toBeNull();
    // Delene av et kort har aldri eget merke.
    expect(
      bath.pageMap.filter((row) => row.anchor.kind.includes(".") && row.mark !== null),
    ).toEqual([]);
    // Utgivelsen har ingen merker.
  });

  it("LF3.5 bare id-er, faste koder og field_key; aldri adresse, matrikkel eller tekst", async () => {
    const data = bathroomPdfData("draft");
    data.cover.addressLines = ["Merkevegen 77", "9999 Merkestad"];
    data.cover.cadastralText = "Gnr. 4242, bnr. 42";
    data.rooms[0]!.checkpoints[0]!.deviations[0]!.causeText = "Merketekst for årsaken XQZ";
    const result = await renderPages(data, BYGGCON_STANDARD_PROFILE, options());
    const json = JSON.stringify(result.pageMap);
    for (const text of ["Merkevegen", "Merkestad", "4242", "XQZ", "Prøvetekst", "Membran"]) {
      expect(json).not.toContain(text);
    }
    const allowed = new Set<string>([...PDF_PAGE_ANCHOR_KINDS, ...PDF_DRAFT_MARK_KINDS]);
    const strings = json.match(/"(?:[^"\\]|\\.)*"/g)!.map((quoted) => JSON.parse(quoted) as string);
    const keys = new Set([
      "anchor",
      "kind",
      "checkpointId",
      "deviationId",
      "elementKey",
      "page",
      "x",
      "y",
      "w",
      "h",
      "mark",
    ]);
    for (const value of strings) {
      const ok =
        keys.has(value) ||
        allowed.has(value) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ||
        /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(value);
      expect(ok, value).toBe(true);
    }
  });

  it("LF3.6 tallene er endelige og innenfor siden, i sidens leserekkefølge", () => {
    for (const row of bath.pageMap) {
      const page = bath.pages[row.page - 1]!;
      for (const value of [row.x, row.y, row.w, row.h]) expect(Number.isFinite(value)).toBe(true);
      expect(row.w).toBeGreaterThan(0);
      expect(row.h).toBeGreaterThan(0);
      expect(row.x).toBeGreaterThanOrEqual(0);
      expect(row.y).toBeGreaterThanOrEqual(0);
      expect(row.x + row.w).toBeLessThanOrEqual(page.widthPt);
      expect(row.y + row.h).toBeLessThanOrEqual(page.heightPt);
    }
    const order = bath.pageMap.map((row) => [row.page, row.y] as const);
    const sorted = [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(order).toEqual(sorted);
  });

  it("LF3.7 punkter og avvik som ikke er i dataene, finnes ikke i kartet", async () => {
    const data = bathroomPdfData("draft");
    data.rooms[0]!.checkpoints = data.rooms[0]!.checkpoints.filter(
      (checkpoint) => checkpoint.checkpointId !== IDS.cpDrain,
    );
    data.rooms[0]!.checkpoints[0]!.deviations = data.rooms[0]!.checkpoints[0]!.deviations.filter(
      (deviation) => deviation.deviationId !== IDS.devMembraneHms,
    );
    const result = await renderPages(data, BYGGCON_STANDARD_PROFILE, options());
    const json = JSON.stringify(result.pageMap);
    expect(json).not.toContain(IDS.cpDrain);
    expect(json).not.toContain(IDS.devDrain);
    expect(json).not.toContain(IDS.devMembraneHms);
  });

  it("LF3.8 merkene flytter ikke linje- eller sideskift: sidene er like uten merker", async () => {
    const prepared = preparePdfJob(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options(),
      "pages",
    );
    const layout = JSON.parse(prepared.job.inputs.data!) as Record<string, unknown>;
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value).map(([key, inner]) => [
            key,
            key === "pageMarks" || key === "pageMark" ? null : strip(inner),
          ]),
        );
      }
      return value;
    };
    const unmarked = await engine(
      { ...prepared.job, inputs: { data: JSON.stringify(strip(layout)) } },
      { timeoutMs: 20_000 },
    );
    if (unmarked.output !== "pages") throw new Error("ventet sider");
    expect(unmarked.marks).toEqual([]);
    const hashes = unmarked.pages.map((page) => cleanPageSvg(page.svg, page));
    expect(hashes).toEqual(bath.pages.map((page) => page.svg));
  });
});
