// Arbeidstråden for PDF-motoren (ADR 0016). Eneste fil som laster motorpakken og rendereren for
// sidene. Ren JavaScript, så Next ikke pakker den; `engine.node.ts` starter den med filsti, én ny
// tråd per PDF eller forhåndsvisning, og avslutter tråden etterpå og ved tidsavbrudd.
//
// Lukket motor: ingen standardskrifter fra nettet, ingen filtilgang, ingen pakkehenting, og
// `fetch` avviser i tråden. Malen kommer som tekst, dataene som JSON i `sys.inputs`, og bilder,
// logo og skrifter som byte. WASM-modulene er allerede kompilert i hovedtråden og kommer inn som
// `WebAssembly.Module`, så tråden leser ingen filer.
//
// Svaret er `{ ok: true, output: "pdf", bytes, pageCount }`,
// `{ ok: true, output: "pages", pages, marks }` eller `{ ok: false, code }`. Motorens melding
// sendes aldri ut av tråden, fordi den kan sitere rapporttekst.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

// Sperres før motoren lastes, så heller ikke oppstarten kan hente noe.
const blocked = () => Promise.reject(new Error("network is blocked"));
globalThis.fetch = blocked;
globalThis.XMLHttpRequest = undefined;

const requireEngine = createRequire(import.meta.url);

/** Malen legger sidetallet her (`<pdf-page-count>`). */
const PAGE_COUNT_SELECTOR = "<pdf-page-count>";
/** Malen legger merkene for sidekartet her når oppsettet har `pageMap: true`. */
const PAGE_MARKS_SELECTOR = "<pdf-page-marks>";
/**
 * Vinduet for én side ligger så mye innenfor sidens rektangel (pt), slik at rendereren bare tar
 * med den ene siden (ADR 0016 punkt 15).
 */
const WINDOW_INSET_PT = 0.5;

const fail = (code) => ({ ok: false, code });

/**
 * Rå merker fra malen, uten å stole på formen. Sjekkes strengt i `page-map-build.ts`; her
 * plukkes bare feltene ut, så ingenting annet fra motoren går ut av tråden.
 */
function readMarks(value) {
  if (!Array.isArray(value) || value.length !== 1 || !Array.isArray(value[0])) return null;
  return value[0].map((raw) => {
    const item = typeof raw === "object" && raw !== null ? raw : {};
    const anchor = typeof item.anchor === "object" && item.anchor !== null ? item.anchor : {};
    return {
      edge: item.edge,
      anchor: {
        kind: anchor.kind,
        checkpointId: anchor.checkpointId,
        deviationId: anchor.deviationId,
        elementKey: anchor.elementKey,
      },
      mark: item.mark,
      page: item.page,
      x: item.x,
      y: item.y,
    };
  });
}

/** Én selvstendig SVG per side: én ny økt i rendereren per side (ADR 0016 punkt 15). */
async function renderPages(rendererModule, vector) {
  const { createTypstRenderer } = requireEngine("@myriaddreamin/typst.ts/renderer");
  const rendererPath = requireEngine.resolve("@myriaddreamin/typst-ts-renderer");
  const renderer = createTypstRenderer();
  await renderer.init({
    getWrapper: () => import(pathToFileURL(rendererPath).href),
    getModule: () => ({ module_or_path: rendererModule }),
  });
  const session = { format: "vector", artifactContent: vector };
  const infos = await renderer.runWithSession(session, async (s) => s.retrievePagesInfo());
  const pages = [];
  // Sidene står under hverandre i rendererens dokument, hver med høyden rundet opp til hele
  // punkter (`pageOffset` er bare sidenummeret). `cleanPageSvg` sjekker at siden står der.
  let offsetYPt = 0;
  for (const info of infos) {
    const { width, height } = info;
    const top = offsetYPt;
    const svg = await renderer.runWithSession(session, async (s) =>
      s.render_in_window(
        WINDOW_INSET_PT,
        top + WINDOW_INSET_PT,
        width - WINDOW_INSET_PT,
        top + height - WINDOW_INSET_PT,
      ),
    );
    pages.push({ svg, widthPt: width, heightPt: height, offsetYPt: top });
    offsetYPt += Math.ceil(height);
  }
  return pages;
}

async function run({ wasmModule, rendererModule, job }) {
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
      if (compiled.hasError) return fail("engine_failed");
      const counts = await world.query({ selector: PAGE_COUNT_SELECTOR, field: "value" });
      const pageCount = Array.isArray(counts) ? counts[0] : undefined;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1) return fail("engine_failed");

      if (job.output === "pages") {
        // Taket sjekkes før sidene tegnes, så for mange sider aldri koster tid eller minne.
        if (Number.isSafeInteger(job.maxPages) && pageCount > job.maxPages) {
          return fail("too_many_pages");
        }
        if (!(rendererModule instanceof WebAssembly.Module)) return fail("engine_failed");
        const marks = readMarks(
          await world.query({ selector: PAGE_MARKS_SELECTOR, field: "value" }),
        );
        const vector = await world.vector({ diagnostics: "full" });
        if (!marks || !vector?.result) return fail("engine_failed");
        const pages = await renderPages(rendererModule, vector.result);
        if (pages.length !== pageCount) return fail("engine_failed");
        return { ok: true, output: "pages", pages, marks };
      }

      const pdf = await world.pdf({ diagnostics: "full" });
      if (!pdf?.result) return fail("engine_failed");
      return { ok: true, output: "pdf", bytes: pdf.result, pageCount };
    },
  );
}

try {
  const result = await run(workerData);
  if (result.ok && result.output === "pdf") parentPort.postMessage(result, [result.bytes.buffer]);
  else parentPort.postMessage(result);
} catch {
  // Meldingen fra motoren kan sitere rapporttekst og sendes aldri videre.
  parentPort.postMessage(fail("engine_failed"));
}
