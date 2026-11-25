import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bathroomPdfData } from "../../../tests/pdf-fixtures";

vi.mock("server-only", () => ({}));

const { loadPdfAssets } = await import("./assets.node");
const { createNodeWorkerEngine } = await import("./engine.node");
const { PDF_DEFAULT_LIMITS } = await import("./codes");
const { BYGGCON_STANDARD_PROFILE } = await import("./profiles");
const { createReportPdfRenderer } = await import("./render");
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
