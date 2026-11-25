import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bathroomPdfData } from "../../../tests/pdf-fixtures";

vi.mock("server-only", () => ({}));

const { loadPdfAssets } = await import("./assets.node");
const { createNodeWorkerEngine } = await import("./engine.node");
const { PDF_DEFAULT_LIMITS } = await import("./codes");
const { BYGGCON_STANDARD_PROFILE } = await import("./profiles");
const { createReportPdfRenderer, preparePdfJob } = await import("./render");
const { layoutReportPdf } = await import("./layout");
const { REPORT_PDF_TEMPLATE } = await import("./template");
type PdfAssets = import("./types").PdfAssets;

/*
 * Utgivelsen og PDF-utkastet er urørt av forhåndsvisningen (testplanen LF2.1–LF2.2, ADR 0016
 * punkt 18). Verdiene er tatt fra koden på `main` før malen og `layout.ts` fikk merkene for
 * sidekartet. Endres de, er PDF-en endret: det skal være en egen, bevisst oppgave (ADR 0016,
 * «Konsekvenser»), aldri en bieffekt av forhåndsvisningen.
 * Støtter hovedmål: færre reklamasjoner (det kunden fikk, endres ikke).
 */

const RELEASE_SHA256 = "a84e39d5d56eeca6722727a6f2f44c9e16ac6a09e02c33f3b7d5bc713dfc5e38";
const DRAFT_SHA256 = "bd6ffe334098322b369bab35e20d47d6f888ee97aa84661cec05d03fb5e747a9";

const GENERATED_AT = new Date("2026-11-03T10:00:00Z");
const BASE = "https://app.example.invalid";
const render = createReportPdfRenderer(createNodeWorkerEngine());
let assets: PdfAssets;

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  assets = await loadPdfAssets();
}, 30_000);

describe("LF2 utgivelsen og PDF-utkastet er byte for byte uendret", () => {
  it("LF2.1 fast utgivelsesprøve gir samme SHA-256 som før forhåndsvisningen", async () => {
    const pdf = await render(bathroomPdfData("release"), BYGGCON_STANDARD_PROFILE, {
      draft: false,
      generatedAt: GENERATED_AT,
      appBaseUrl: BASE,
      assets,
      limits: PDF_DEFAULT_LIMITS,
    });
    expect(sha(pdf.bytes)).toBe(RELEASE_SHA256);
  }, 30_000);

  it("LF2.2 PDF-utkastet (uten sidekart) gir samme SHA-256 som før forhåndsvisningen", async () => {
    const pdf = await render(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, {
      draft: true,
      generatedAt: GENERATED_AT,
      appBaseUrl: BASE,
      assets,
      limits: PDF_DEFAULT_LIMITS,
    });
    expect(sha(pdf.bytes)).toBe(DRAFT_SHA256);
  }, 30_000);
});

describe("LF2.3 merkene for sidekartet finnes bare med pageMap", () => {
  const layoutOptions = {
    draft: true,
    generatedAt: GENERATED_AT,
    appBaseUrl: BASE,
    logoPath: "/assets/logo",
    imagePath: () => "/assets/img/1.png",
  };

  it("uten pageMap har oppsettet ingen ankere og ingen merker", () => {
    for (const pageMap of [undefined, false]) {
      const layout = layoutReportPdf(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, {
        ...layoutOptions,
        pageMap,
      });
      expect(layout.pageMap).toBe(false);
      const json = JSON.stringify(layout);
      expect(json).not.toMatch(/"pageMarks":\{|"pageMark":\{|"checkpointId"|"kind":"checkpoint/);
    }
  });

  it("med pageMap har punkter, avvik og punktene uten innhold et anker", () => {
    const layout = layoutReportPdf(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, {
      ...layoutOptions,
      pageMap: true,
    });
    expect(layout.pageMap).toBe(true);
    const room = layout.sections.find((section) => section.kind === "room");
    if (room?.kind !== "room") throw new Error("ventet rom");
    for (const checkpoint of room.checkpoints) {
      expect(checkpoint.pageMarks?.checkpoint.anchor.kind).toBe("checkpoint");
      for (const deviation of checkpoint.deviations) {
        expect(deviation.pageMarks?.deviation.anchor.kind).toBe("deviation");
      }
    }
    const missing = layout.sections.find((section) => section.kind === "missing");
    if (missing?.kind !== "missing") throw new Error("ventet «Ikke med i PDF-en»");
    expect(missing.empty.every((item) => item.pageMark?.mark === "missing")).toBe(true);
  });

  it("PDF-jobben har aldri sidekart; bare jobben for sidene har det", () => {
    const options = {
      draft: true,
      generatedAt: GENERATED_AT,
      appBaseUrl: BASE,
      assets: { fonts: [], logos: {} },
      limits: PDF_DEFAULT_LIMITS,
    };
    const pdfJob = preparePdfJob(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options);
    expect(pdfJob.job.output).toBe("pdf");
    expect(pdfJob.layout.pageMap).toBe(false);
    const pagesJob = preparePdfJob(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options,
      "pages",
    );
    expect(pagesJob.job.output).toBe("pages");
    expect(pagesJob.layout.pageMap).toBe(true);
  });

  it("malen skriver merkene bare gjennom page-mark, som ikke gir noe uten anker", () => {
    expect(REPORT_PDF_TEMPLATE).toContain("#let page-mark(edge, pm) = if pm != none {");
    expect(REPORT_PDF_TEMPLATE.match(/<pdf-page-mark>/g)).toHaveLength(2);
    expect(REPORT_PDF_TEMPLATE).toContain("#if d.pageMap {");
  });
});
