import "server-only";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { loadPdfEngineModule, loadPdfRendererModule } from "./assets.node";
import { PdfRenderError } from "./errors";
import type {
  PdfEngine,
  PdfEngineJob,
  PdfEnginePage,
  PdfEnginePageMark,
  PdfEngineResult,
} from "./types";

/*
 * Motoren på serveren (ADR 0016 punkt 2). Én ny arbeidstråd per PDF og per forhåndsvisning (punkt
 * 21), som avsluttes når jobben er ferdig, ved feil og ved tidsavbrudd. Da stopper tidsgrensen faktisk motoren, minnet gis tilbake,
 * og ingen tilstand deles mellom to PDF-er. Alt skjer i minnet: ingen midlertidige filer.
 *
 * Stien er fast og regnes fra mappen appen kjører fra. `next.config.ts` tar filen med i
 * `.next/standalone`, og `deploy-azure.yml` sjekker at den finnes.
 */
// `turbopackIgnore`: stien skal ikke følges av Turbopack. Uten merket sporer bygget hele
// prosjektmappen (også tester og dokumenter) inn i ruten, og bygget feiler.
export const PDF_WORKER_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "src/core/pdf/typst-worker.mjs",
);

/**
 * Minnegrensen for JavaScript-delen av tråden (kortet, «Arbeidstråden», testplanen 11.3.1).
 * WASM-minnet til motoren telles ikke her, men en feil i JS-delen tar aldri hele serveren: tråden
 * stoppes med `ERR_WORKER_OUT_OF_MEMORY`, og ruten gir 500-siden. Badet bruker langt mindre
 * (ADR 0016, målingene); grensen gir rom for 25 MB bilder med kopier.
 */
export const PDF_WORKER_MAX_OLD_GENERATION_MB = 256;

/** Feilkodene arbeidstråden kan svare med. Alt annet blir `engine_failed`. */
const WORKER_FAILURE_CODES = ["engine_failed", "too_many_pages"] as const;
type WorkerFailureCode = (typeof WORKER_FAILURE_CODES)[number];

/**
 * Svaret fra tråden som resultat, eller feilkoden. Formen sjekkes her; merkene sjekkes strengt
 * etterpå i `buildPdfPageMap`, og sidene i `cleanPageSvg`.
 */
export function readWorkerReply(
  value: unknown,
  output: PdfEngineJob["output"],
): PdfEngineResult | WorkerFailureCode {
  if (typeof value !== "object" || value === null) return "engine_failed";
  const reply = value as Record<string, unknown>;
  if (reply.ok === false) {
    return (WORKER_FAILURE_CODES as readonly unknown[]).includes(reply.code)
      ? (reply.code as WorkerFailureCode)
      : "engine_failed";
  }
  if (reply.ok !== true || reply.output !== output) return "engine_failed";
  if (output === "pdf") {
    if (
      !(reply.bytes instanceof Uint8Array) ||
      typeof reply.pageCount !== "number" ||
      !Number.isSafeInteger(reply.pageCount)
    ) {
      return "engine_failed";
    }
    return { output: "pdf", bytes: reply.bytes, pageCount: reply.pageCount };
  }
  if (!Array.isArray(reply.pages) || !Array.isArray(reply.marks)) return "engine_failed";
  const pages: PdfEnginePage[] = [];
  for (const page of reply.pages as unknown[]) {
    if (typeof page !== "object" || page === null) return "engine_failed";
    const { svg, widthPt, heightPt, offsetYPt } = page as Record<string, unknown>;
    if (
      typeof svg !== "string" ||
      typeof widthPt !== "number" ||
      typeof heightPt !== "number" ||
      typeof offsetYPt !== "number"
    ) {
      return "engine_failed";
    }
    pages.push({ svg, widthPt, heightPt, offsetYPt });
  }
  // Merkene har ukjent form til `buildPdfPageMap` har sjekket dem.
  return { output: "pages", pages, marks: reply.marks as PdfEnginePageMark[] };
}

/** Lager en motor som starter arbeidstråden på `workerPath`. Testene kan bytte tråden. */
export function createNodeWorkerEngine(workerPath: string = PDF_WORKER_PATH): PdfEngine {
  return async (job, { timeoutMs }) => {
    let wasmModule: WebAssembly.Module;
    let rendererModule: WebAssembly.Module | null = null;
    try {
      wasmModule = await loadPdfEngineModule();
      // Rendereren trengs bare for sidene (forhåndsvisningen), aldri for PDF-en.
      if (job.output === "pages") rendererModule = await loadPdfRendererModule();
    } catch {
      throw new PdfRenderError("engine_failed");
    }

    return new Promise<PdfEngineResult>((resolve, reject) => {
      let settled = false;
      let worker: Worker;
      try {
        worker = new Worker(/* turbopackIgnore: true */ workerPath, {
          workerData: { wasmModule, rendererModule, job },
          // Tråden får ikke prosessens miljøvariabler (hemmeligheter, database-URL).
          env: {},
          resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_GENERATION_MB },
          stdout: true,
          stderr: true,
        });
      } catch {
        reject(new PdfRenderError("engine_failed"));
        return;
      }
      // Utskrift fra motoren kan sitere rapporttekst. Den leses og kastes.
      worker.stdout.resume();
      worker.stderr.resume();

      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Tråden avsluttes alltid, også når den svarte. Feil ved avslutning er uten betydning.
        void worker.terminate().catch(() => undefined);
        outcome();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new PdfRenderError("timeout")));
      }, timeoutMs);

      worker.once("message", (message: unknown) => {
        finish(() => {
          const reply = readWorkerReply(message, job.output);
          if (typeof reply === "string") reject(new PdfRenderError(reply));
          else resolve(reply);
        });
      });
      worker.once("error", () => finish(() => reject(new PdfRenderError("engine_failed"))));
      worker.once("exit", () => finish(() => reject(new PdfRenderError("engine_failed"))));
    });
  };
}

/** Motoren appen bruker. */
export const nodeWorkerEngine: PdfEngine = createNodeWorkerEngine();
