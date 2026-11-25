import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { BYGGCON_LOGO_KEY } from "./profiles";
import type { LoadPdfAssets, PdfAssets } from "./types";

/*
 * Eneste fil i `src/core/pdf` som leser filer (ADR 0016 punkt 5). Leser skriftene i `public/fonts`,
 * logoen i `public/brand` og motorens WASM-fil, én gang per prosess. Stiene er faste og regnes fra
 * mappen appen kjører fra (`process.cwd()`), både i utvikling og i `.next/standalone`, der
 * `deploy-azure.yml` kopierer inn `public`.
 */

const FONT_DIR = ["public", "fonts"] as const;
const LOGO_FILES: Readonly<Record<string, readonly string[]>> = {
  [BYGGCON_LOGO_KEY]: ["public", "brand", "byggcon-logo.png"],
};
const ENGINE_WASM = "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm";

async function readAssets(root: string): Promise<PdfAssets> {
  const fontDir = path.join(root, ...FONT_DIR);
  // Sortert, så rekkefølgen (og dermed PDF-en) er lik på alle maskiner.
  const fontNames = (await readdir(fontDir)).filter((name) => name.endsWith(".ttf")).sort();
  if (fontNames.length === 0) throw new Error("Fant ingen skrifter for PDF-en.");
  const fonts = await Promise.all(
    fontNames.map(async (name) => new Uint8Array(await readFile(path.join(fontDir, name)))),
  );
  const logos: Record<string, Uint8Array> = {};
  for (const [key, parts] of Object.entries(LOGO_FILES)) {
    logos[key] = new Uint8Array(await readFile(path.join(root, ...parts)));
  }
  return { fonts, logos };
}

let assets: Promise<PdfAssets> | null = null;

/** Skriftene og logoene som byte. Leses første gang og gjenbrukes. En feil prøves igjen neste gang. */
export const loadPdfAssets: LoadPdfAssets = () => {
  assets ??= readAssets(process.cwd()).catch((error: unknown) => {
    assets = null;
    throw error;
  });
  return assets;
};

let engineModule: Promise<WebAssembly.Module> | null = null;

/**
 * Motorens WASM-fil, kompilert én gang per prosess. Bare den kompilerte koden deles mellom
 * PDF-ene; hver PDF får egen tråd og eget minne (ADR 0016 punkt 2).
 */
export function loadPdfEngineModule(): Promise<WebAssembly.Module> {
  engineModule ??= (async () => {
    const requireFromRoot = createRequire(path.join(process.cwd(), "pdf-engine.js"));
    const bytes = await readFile(requireFromRoot.resolve(ENGINE_WASM));
    return WebAssembly.compile(bytes);
  })().catch((error: unknown) => {
    engineModule = null;
    throw error;
  });
  return engineModule;
}
