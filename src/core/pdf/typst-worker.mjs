// Arbeidstråden for PDF-motoren (ADR 0016). Eneste fil som laster motorpakken. Ren JavaScript,
// så Next ikke pakker den; `engine.node.ts` starter den med filsti, én ny tråd per PDF, og
// avslutter tråden etterpå og ved tidsavbrudd.
//
// Lukket motor: ingen standardskrifter fra nettet, ingen filtilgang, ingen pakkehenting, og
// `fetch` avviser i tråden. Malen kommer som tekst, dataene som JSON i `sys.inputs`, og bilder,
// logo og skrifter som byte. WASM-modulen er allerede kompilert i hovedtråden og kommer inn som
// `WebAssembly.Module`, så tråden leser ingen filer.
//
// Svaret er `{ ok: true, bytes, pageCount }` eller `{ ok: false, code }`. Motorens melding sendes
// aldri ut av tråden, fordi den kan sitere rapporttekst.
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// Sperres før motoren lastes, så heller ikke oppstarten kan hente noe.
const blocked = () => Promise.reject(new Error("network is blocked"));
globalThis.fetch = blocked;
globalThis.XMLHttpRequest = undefined;

const requireEngine = createRequire(import.meta.url);

/** Malen legger sidetallet her (`<pdf-page-count>`). */
const PAGE_COUNT_SELECTOR = "<pdf-page-count>";

async function run({ wasmModule, job }) {
  const { createTypstCompiler } = requireEngine("@myriaddreamin/typst.ts/compiler");
  const init = requireEngine("@myriaddreamin/typst.ts/options.init");
  const compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => ({ module_or_path: wasmModule }),
    beforeBuild: [
      init.disableDefaultFontAssets(),
      init.loadFonts([...job.fonts], { assets: false }),
    ],
  });
  compiler.addSource("/main.typ", job.source);
  for (const [filePath, bytes] of job.files) compiler.mapShadow(filePath, bytes);

  return compiler.runWithWorld(
    { mainFilePath: "/main.typ", inputs: { ...job.inputs } },
    async (world) => {
      const compiled = await world.compile({ diagnostics: "full" });
      if (compiled.hasError) return { ok: false, code: "engine_failed" };
      const counts = await world.query({ selector: PAGE_COUNT_SELECTOR, field: "value" });
      const pageCount = Array.isArray(counts) ? counts[0] : undefined;
      const pdf = await world.pdf({ diagnostics: "full" });
      if (!pdf?.result || !Number.isSafeInteger(pageCount) || pageCount < 1) {
        return { ok: false, code: "engine_failed" };
      }
      return { ok: true, bytes: pdf.result, pageCount };
    },
  );
}

try {
  const result = await run(workerData);
  if (result.ok) parentPort.postMessage(result, [result.bytes.buffer]);
  else parentPort.postMessage(result);
} catch {
  // Meldingen fra motoren kan sitere rapporttekst og sendes aldri videre.
  parentPort.postMessage({ ok: false, code: "engine_failed" });
}
