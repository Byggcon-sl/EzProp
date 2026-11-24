import "server-only";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { loadPdfEngineModule } from "./assets.node";
import { PdfRenderError } from "./errors";
import type { PdfEngine, PdfEngineResult } from "./types";

/*
 * Motoren på serveren (ADR 0016 punkt 2). Én ny arbeidstråd per PDF, som avsluttes når PDF-en er
 * ferdig, ved feil og ved tidsavbrudd. Da stopper tidsgrensen faktisk motoren, minnet gis tilbake,
 * og ingen tilstand deles mellom to PDF-er. Alt skjer i minnet: ingen midlertidige filer.
 *
 * Stien er fast og regnes fra mappen appen kjører fra. `next.config.ts` tar filen med i
 * `.next/standalone`, og `deploy-azure.yml` sjekker at den finnes.
 */
export const PDF_WORKER_PATH = path.join(process.cwd(), "src/core/pdf/typst-worker.mjs");

type WorkerReply = { ok: true; bytes: Uint8Array; pageCount: number } | { ok: false };

function isReply(value: unknown): value is WorkerReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Record<string, unknown>;
  if (reply.ok === false) return true;
  return (
    reply.ok === true &&
    reply.bytes instanceof Uint8Array &&
    typeof reply.pageCount === "number" &&
    Number.isSafeInteger(reply.pageCount)
  );
}

/** Lager en motor som starter arbeidstråden på `workerPath`. Testene kan bytte tråden. */
export function createNodeWorkerEngine(workerPath: string = PDF_WORKER_PATH): PdfEngine {
  return async (job, { timeoutMs }) => {
    let wasmModule: WebAssembly.Module;
    try {
      wasmModule = await loadPdfEngineModule();
    } catch {
      throw new PdfRenderError("engine_failed");
    }

    return new Promise<PdfEngineResult>((resolve, reject) => {
      let settled = false;
      let worker: Worker;
      try {
        worker = new Worker(workerPath, {
          workerData: { wasmModule, job },
          // Tråden får ikke prosessens miljøvariabler (hemmeligheter, database-URL).
          env: {},
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
          if (isReply(message) && message.ok) {
            resolve({ bytes: message.bytes, pageCount: message.pageCount });
          } else {
            reject(new PdfRenderError("engine_failed"));
          }
        });
      });
      worker.once("error", () => finish(() => reject(new PdfRenderError("engine_failed"))));
      worker.once("exit", () => finish(() => reject(new PdfRenderError("engine_failed"))));
    });
  };
}

/** Motoren appen bruker. */
export const nodeWorkerEngine: PdfEngine = createNodeWorkerEngine();
