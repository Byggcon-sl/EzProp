import { checkImage } from "@/shared/images";
import { PDF_PAGE_HASH_LENGTH } from "./codes";
import { PdfRenderError } from "./errors";
import { layoutReportPdf, normalizeAppBaseUrl, type PdfLayout } from "./layout";
import { buildPdfPageMap } from "./page-map-build";
import { cleanPageSvg } from "./page-svg";
import { REPORT_PDF_TEMPLATE } from "./template";
import type {
  CreateReportPagesRenderer,
  CreateReportPdfRenderer,
  PdfEngine,
  PdfEngineJob,
  PdfEngineOutput,
  PdfImage,
  PdfLimits,
  PdfPagesLimits,
  PdfProfile,
  RenderedPage,
  RenderReportPdfOptions,
  ReportPdfData,
} from "./types";

/*
 * Eneste vei til motoren (ADR 0016 punkt 5). Ren: sjekker grensene og bildene, bygger oppsettet og
 * inndataene til malen, og kaller motoren. Leser aldri klokke, filer eller nett. Kan brukes i
 * nettleseren i 2b med en annen `PdfEngine`.
 */

/** Høyeste antall markeringer på ett bilde. Flere er ikke en ekte markering. */
export const MAX_MARKINGS_PER_IMAGE = 50;

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isPoint = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  isFraction((value as { x?: unknown }).x) &&
  isFraction((value as { y?: unknown }).y);

/** Litt slakk for avrunding når en form går helt ut til kanten av bildet. */
const EDGE = 1 + 1e-9;

/**
 * En markering er bare faste former med tall mellom 0 og 1 (andeler av bildet). Ukjent type, tekst
 * i stedet for tall, `NaN`, uendelig, negative tall og former som går utenfor bildet avvises.
 */
export function isValidMarking(marking: unknown): boolean {
  if (typeof marking !== "object" || marking === null) return false;
  const m = marking as Record<string, unknown>;
  switch (m.type) {
    case "arrow":
      return isPoint(m.from) && isPoint(m.to);
    case "circle": {
      if (!isPoint(m.center) || !isFraction(m.radius) || m.radius === 0) return false;
      return true;
    }
    case "rectangle": {
      if (!isPoint(m.topLeft) || !isFraction(m.width) || !isFraction(m.height)) return false;
      if (m.width === 0 || m.height === 0) return false;
      const topLeft = m.topLeft as { x: number; y: number };
      return topLeft.x + m.width <= EDGE && topLeft.y + m.height <= EDGE;
    }
    default:
      return false;
  }
}

/** Alle bildene i rapporten, i rekkefølgen de står i PDF-en. */
export function collectPdfImages(data: ReportPdfData): PdfImage[] {
  return data.rooms.flatMap((room) =>
    room.checkpoints.flatMap((checkpoint) =>
      checkpoint.deviations.flatMap((deviation) => deviation.images),
    ),
  );
}

/**
 * Sjekker bildene før motoren: antall og samlet størrelse, format kjent på innholdet (bare JPEG og
 * PNG), ingen EXIF, XMP, IPTC eller kommentarer, målene stemmer med filen, største side innenfor
 * grensen, og gyldige markeringer. Kaster `PdfRenderError` med fast kode.
 */
export function validatePdfImages(images: readonly PdfImage[], limits: PdfLimits): void {
  if (images.length > limits.maxImages) throw new PdfRenderError("too_many_images");
  let total = 0;
  for (const image of images) {
    if (!(image.bytes instanceof Uint8Array)) throw new PdfRenderError("invalid_image");
    total += image.bytes.byteLength;
  }
  if (total > limits.maxImageBytesTotal) throw new PdfRenderError("images_too_large");

  for (const image of images) {
    const checked = checkImage(image.bytes);
    if (!checked.ok || checked.format !== image.format) {
      throw new PdfRenderError("invalid_image");
    }
    if (checked.widthPx !== image.widthPx || checked.heightPx !== image.heightPx) {
      throw new PdfRenderError("invalid_image");
    }
    if (Math.max(checked.widthPx, checked.heightPx) > limits.maxImageEdgePx) {
      throw new PdfRenderError("images_too_large");
    }
    if (!Array.isArray(image.markings) || image.markings.length > MAX_MARKINGS_PER_IMAGE) {
      throw new PdfRenderError("invalid_marking");
    }
    if (!image.markings.every(isValidMarking)) throw new PdfRenderError("invalid_marking");
  }
}

const LOGO_PATH = "/assets/logo";

export type PreparedPdfJob = {
  layout: PdfLayout;
  job: PdfEngineJob;
  imageCount: number;
};

/**
 * Alt før motoren, uten motoren: sjekkene, oppsettet og jobben. Egen funksjon, så oppsettet kan
 * prøves uten motor.
 */
export function preparePdfJob(
  data: ReportPdfData,
  profile: PdfProfile,
  options: RenderReportPdfOptions,
  output: PdfEngineOutput = "pdf",
): PreparedPdfJob {
  if (!(options.generatedAt instanceof Date) || Number.isNaN(options.generatedAt.getTime())) {
    throw new PdfRenderError("engine_failed");
  }
  // Et utkast vises aldri som ferdig rapport: er én av dem utkast, blir PDF-en et utkast.
  const draft = options.draft || data.kind === "draft";

  const images = collectPdfImages(data);
  validatePdfImages(images, options.limits);

  const files: (readonly [string, Uint8Array])[] = [];
  const imagePaths = new Map<PdfImage, string>();
  images.forEach((image, index) => {
    const filePath = `/assets/img/${index + 1}.${image.format === "png" ? "png" : "jpg"}`;
    imagePaths.set(image, filePath);
    files.push([filePath, image.bytes]);
  });

  const logo = options.assets.logos[profile.logo];
  const logoPath = logo ? LOGO_PATH : null;
  if (logo) files.push([LOGO_PATH, logo]);

  const layout = layoutReportPdf(data, profile, {
    draft,
    generatedAt: options.generatedAt,
    appBaseUrl: normalizeAppBaseUrl(options.appBaseUrl),
    logoPath,
    imagePath: (image) => imagePaths.get(image) ?? "",
    // Merkene for sidekartet skrives bare for sidene; PDF-en er byte for byte som før.
    pageMap: output === "pages",
  });

  return {
    layout,
    imageCount: images.length,
    job: {
      output,
      source: REPORT_PDF_TEMPLATE,
      inputs: { data: JSON.stringify(layout) },
      files,
      fonts: options.assets.fonts,
    },
  };
}

export const createReportPdfRenderer: CreateReportPdfRenderer =
  (engine: PdfEngine) => async (data, profile, options) => {
    const prepared = preparePdfJob(data, profile, options);
    try {
      const result = await engine(prepared.job, { timeoutMs: options.limits.timeoutMs });
      // Motoren skal svare med det jobben ba om. Noe annet er en feil i motoren.
      if (result.output !== "pdf") throw new PdfRenderError("engine_failed");
      return { bytes: result.bytes, pageCount: result.pageCount, imageCount: prepared.imageCount };
    } catch (error) {
      // Bare den faste koden går videre, aldri meldingen fra motoren.
      if (error instanceof PdfRenderError) throw error;
      throw new PdfRenderError("engine_failed");
    }
  };

// --- Sidene som SVG og sidekartet (tillegget til ADR 0016, punkt 13–20) ------------------------

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function checkPagesLimits(limits: PdfPagesLimits): void {
  if (!isPositiveInteger(limits.maxPages) || !isPositiveInteger(limits.maxSvgBytesTotal)) {
    throw new PdfRenderError("engine_failed");
  }
}

/**
 * De første `PDF_PAGE_HASH_LENGTH` heksadesimale tegnene av SHA-256. `crypto.subtle` finnes både i
 * Node og i nettleseren, så filen trenger ingen `node:`-modul (ADR-tillegget punkt 19).
 */
async function pageHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, PDF_PAGE_HASH_LENGTH);
}

/**
 * Samme data, profil og mal som PDF-en, men til én selvstendig SVG per side og sidekartet. Over
 * taket på sider eller samlet størrelse gir `too_many_pages` eller `pages_too_large`, aldri et
 * halvt svar. En side som ikke består sjekken, eller merker som ikke kan leses, gir
 * `engine_failed`. Lagrer ingenting.
 */
export const createReportPagesRenderer: CreateReportPagesRenderer =
  (engine: PdfEngine) => async (data, profile, options) => {
    checkPagesLimits(options.limits);
    const prepared = preparePdfJob(data, profile, options, "pages");
    try {
      const result = await engine(
        { ...prepared.job, maxPages: options.limits.maxPages },
        { timeoutMs: options.limits.timeoutMs },
      );
      if (result.output !== "pages" || result.pages.length === 0) {
        throw new PdfRenderError("engine_failed");
      }
      if (result.pages.length > options.limits.maxPages) {
        throw new PdfRenderError("too_many_pages");
      }

      const encoder = new TextEncoder();
      const cleaned: {
        svg: string;
        bytes: Uint8Array<ArrayBuffer>;
        widthPt: number;
        heightPt: number;
      }[] = [];
      let total = 0;
      for (const page of result.pages) {
        const svg = cleanPageSvg(page.svg, page);
        if (svg === null) throw new PdfRenderError("engine_failed");
        const bytes = encoder.encode(svg);
        total += bytes.byteLength;
        if (total > options.limits.maxSvgBytesTotal) throw new PdfRenderError("pages_too_large");
        cleaned.push({ svg, bytes, widthPt: page.widthPt, heightPt: page.heightPt });
      }
      const pageMap = buildPdfPageMap(result.marks, result.pages);
      const pages: RenderedPage[] = await Promise.all(
        cleaned.map(async (page) => ({
          svg: page.svg,
          hash: await pageHash(page.bytes),
          widthPt: page.widthPt,
          heightPt: page.heightPt,
        })),
      );
      return { pages, pageMap, imageCount: prepared.imageCount };
    } catch (error) {
      // Bare den faste koden går videre, aldri meldingen fra motoren eller rapporttekst.
      if (error instanceof PdfRenderError) throw error;
      throw new PdfRenderError("engine_failed");
    }
  };
