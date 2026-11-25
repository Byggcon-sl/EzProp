import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEGRATION_PORTS, PROVIDERS_BY_PORT } from "@/core/integrations/ports";

/*
 * Statiske sjekker for PDF-gjengivelsen (testplanen 2.2, ADR 0016). Leser kildekoden, ingen
 * database. Støtter hovedmål: KI i bunnen (ingen KI, ingen nett, lukket motor) og færre
 * reklamasjoner (samme PDF hver gang: ingen klokke eller tilfeldighet).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const pdfDir = join(repoRoot, "src/core/pdf");
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const productFiles = files(pdfDir).filter((file) => !/\.test\.ts$/.test(file));
/** Kildekoden uten kommentarer, så forklaringer ikke gir falske treff. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ENGINE_PACKAGES = /@myriaddreamin\/typst/;

describe("2.2 PDF-gjengivelsen er et lukket, rent blad", () => {
  it("søket ser filene i src/core/pdf", () => {
    const names = productFiles.map(rel);
    expect(names).toContain("src/core/pdf/render.ts");
    expect(names).toContain("src/core/pdf/typst-worker.mjs");
  });

  it("2.2.1 motorpakken lastes i én fil i hele src/", () => {
    const hits = files(join(repoRoot, "src"))
      .filter((file) => !/\.test\.ts$/.test(file))
      .filter((file) => ENGINE_PACKAGES.test(code(file)))
      .map(rel);
    // assets.node.ts finner WASM-filen (bare stien), arbeidstråden laster motoren.
    expect(hits.sort()).toEqual(["src/core/pdf/assets.node.ts", "src/core/pdf/typst-worker.mjs"]);
    expect(code(join(pdfDir, "assets.node.ts"))).not.toMatch(
      /require\(["']@myriaddreamin|import .* from ["']@myriaddreamin/,
    );
  });

  it("2.2.2 ingen KI i src/core/pdf", () => {
    for (const file of productFiles) {
      expect(code(file), rel(file)).not.toMatch(/core\/ai|ai_usage_log|aiGate|ai-gate/);
    }
  });

  it("2.2.3 ingen klokke eller tilfeldighet", () => {
    for (const file of productFiles) {
      expect(code(file), rel(file)).not.toMatch(
        /Date\.now\(|new Date\(\)|Math\.random|randomUUID|performance\.now/,
      );
    }
  });

  it("2.2.4 ingen nett, og node:fs bare i assets.node.ts", () => {
    for (const file of productFiles) {
      const source = code(file);
      expect(source, rel(file)).not.toMatch(/\bfetch\(|["']node:(?:http|https|net|dgram|tls)["']/);
      if (!file.endsWith("assets.node.ts")) {
        expect(source, rel(file)).not.toMatch(/["'](?:node:)?fs(?:\/promises)?["']/);
      }
    }
    // Arbeidstråden sperrer fetch før motoren lastes.
    expect(readFileSync(join(pdfDir, "typst-worker.mjs"), "utf8")).toMatch(
      /globalThis\.fetch = blocked;[\s\S]*requireEngine\(/,
    );
  });

  it("2.2.4 motoren er lukket: ingen pakkeregister, ingen filtilgang, ingen standardskrifter fra nett", () => {
    const worker = code(join(pdfDir, "typst-worker.mjs"));
    expect(worker).toContain("disableDefaultFontAssets()");
    expect(worker).toMatch(/loadFonts\([^)]*\{ assets: false \}\)/);
    expect(worker).not.toMatch(/withAccessModel|withPackageRegistry|fetchPackage/);
  });

  it("ADR 0016 punkt 4: malen har ingen eval, read eller pakker", () => {
    const template = code(join(pdfDir, "template.ts"));
    expect(template).toContain("json(bytes(sys.inputs.data))");
    expect(template).not.toMatch(/\beval\(|#read\(|\bread\(|@preview|#import|#include/);
  });

  it("ADR 0016 punkt 10: ingen midlertidige filer", () => {
    for (const file of productFiles) {
      expect(code(file), rel(file)).not.toMatch(/tmpdir|mkdtemp|writeFile/);
    }
  });

  it("2.2.5 motoren er ikke en leverandør i INTEGRATION_PORTS", () => {
    const ports = JSON.stringify([INTEGRATION_PORTS, PROVIDERS_BY_PORT]).toLowerCase();
    expect(ports).not.toMatch(/pdf|typst/);
  });

  it("arbeidstråden ligger der next.config.ts og utrullingen venter den", () => {
    expect(existsSync(join(pdfDir, "typst-worker.mjs"))).toBe(true);
    expect(readFileSync(join(repoRoot, "next.config.ts"), "utf8")).toContain(
      "./src/core/pdf/typst-worker.mjs",
    );
    expect(code(join(pdfDir, "engine.node.ts")).replace(/\s+/g, "")).toMatch(
      /path\.join\(process\.cwd\(\),"src\/core\/pdf\/typst-worker\.mjs",?\)/,
    );
    // Uten merket sporer Turbopack hele prosjektmappen inn i PDF-ruten, og `pnpm build` feiler.
    const raw = readFileSync(join(pdfDir, "engine.node.ts"), "utf8");
    expect(raw).toContain("/* turbopackIgnore: true */ process.cwd()");
    expect(raw).toContain("new Worker(/* turbopackIgnore: true */ workerPath");
  });

  it("2.2.8 rapportdataene i core/reports importerer ikke KI (når filene finnes)", () => {
    for (const name of [
      "pdf-data.ts",
      "pdf-data-build.ts",
      "release-pdf.ts",
      "tg-explanation.ts",
    ]) {
      const file = join(repoRoot, "src/core/reports", name);
      if (!existsSync(file)) continue;
      expect(code(file), name).not.toMatch(/@\/core\/ai/);
    }
  });

  it("feil fra motoren tas aldri med videre", () => {
    const worker = code(join(pdfDir, "typst-worker.mjs"));
    expect(worker).not.toMatch(/error\.message|error\.stack|diagnostics:\s*compiled/);
    const engine = code(join(pdfDir, "engine.node.ts"));
    expect(engine).not.toMatch(/\.message|\.stack/);
  });
});

describe("LF8 levende forhåndsvisning: rendereren, sidekartet og pakken", () => {
  const RENDERER = "@myriaddreamin/typst-ts-renderer";
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
    dependencies: Record<string, string>;
  };

  it("LF8.1 de nye filene for sidene importerer ikke KI", () => {
    for (const name of ["page-map.ts", "page-map-build.ts", "page-svg.ts", "render.ts"]) {
      expect(code(join(pdfDir, name)), name).not.toMatch(/@\/core\/ai|core\/ai|ai_usage_log/);
    }
  });

  it("LF8.2 page-map.ts og codes.ts har ingen importer av verdier, så klienten kan bruke dem", () => {
    for (const name of ["page-map.ts", "codes.ts"]) {
      const imports = code(join(pdfDir, name)).match(/^\s*import\b.*$/gm) ?? [];
      expect(
        imports.filter((line) => !/^\s*import type\b/.test(line)),
        name,
      ).toEqual([]);
      expect(code(join(pdfDir, name)), name).not.toMatch(/\brequire\(|\bimport\(|server-only/);
    }
  });

  it("LF8.3 rendereren er låst til nøyaktig 0.7.0, i package.json og i lockfila", () => {
    expect(packageJson.dependencies[RENDERER]).toBe("0.7.0");
    expect(packageJson.dependencies["@myriaddreamin/typst.ts"]).toBe("0.7.0");
    expect(packageJson.dependencies["@myriaddreamin/typst-ts-web-compiler"]).toBe("0.7.0");
    const lock = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    expect(lock).toMatch(
      /'@myriaddreamin\/typst-ts-renderer':\s*\n\s*specifier: 0\.7\.0\s*\n\s*version: 0\.7\.0/,
    );
    expect(lock).not.toMatch(/'@myriaddreamin\/typst-ts-renderer@(?!0\.7\.0')/);
  });

  it("LF8.3 rendereren lastes bare i arbeidstråden; assets.node.ts har bare stien til WASM-filen", () => {
    const hits = files(join(repoRoot, "src"))
      .filter((file) => !/\.test\.ts$/.test(file))
      .filter((file) => code(file).includes(RENDERER))
      .map(rel);
    expect(hits.sort()).toEqual(["src/core/pdf/assets.node.ts", "src/core/pdf/typst-worker.mjs"]);
    expect(code(join(pdfDir, "assets.node.ts"))).toContain(
      `${RENDERER}/pkg/typst_ts_renderer_bg.wasm`,
    );
    const worker = code(join(pdfDir, "typst-worker.mjs"));
    expect(worker).toContain('requireEngine.resolve("@myriaddreamin/typst-ts-renderer")');
    expect(worker).toContain('requireEngine("@myriaddreamin/typst.ts/renderer")');
    // Rendereren får den kompilerte modulen fra hovedtråden og leser ingen filer.
    expect(worker).toMatch(/getModule: \(\) => \(\{ module_or_path: rendererModule \}\)/);
  });

  it("LF8.4 rendereren har ingen installasjonsskript og ingen egne avhengigheter", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "node_modules", RENDERER, "package.json"), "utf8"),
    ) as { version: string; license: string; scripts?: Record<string, string> } & Record<
      string,
      unknown
    >;
    expect(manifest.version).toBe("0.7.0");
    expect(manifest.license).toBe("Apache-2.0");
    for (const script of ["preinstall", "install", "postinstall"]) {
      expect(manifest.scripts?.[script], script).toBeUndefined();
    }
    expect(manifest.dependencies).toBeUndefined();
  });

  it("LF8.5 next.config.ts holder rendereren utenfor pakken og tar filene med i standalone", () => {
    const config = readFileSync(join(repoRoot, "next.config.ts"), "utf8");
    const external = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
    expect(external).toContain(`"${RENDERER}"`);
    expect(config).toContain(`./node_modules/${RENDERER}/package.json`);
    expect(config).toContain(`./node_modules/${RENDERER}/pkg/*.mjs`);
    expect(config).toContain(`./node_modules/${RENDERER}/pkg/*.wasm`);
  });

  it("prøven i utrullingen prøver også sidene som SVG", () => {
    const trial = readFileSync(join(repoRoot, "scripts/pdf-engine-trial.mjs"), "utf8");
    expect(trial).toContain(RENDERER);
    expect(trial).toContain("render_in_window");
  });

  it("LF8.9 versjonen er 0.21.0", () => {
    expect(packageJson.version).toBe("0.21.0");
  });

  it("margene i sidekartet er de samme som i malen", () => {
    expect(code(join(pdfDir, "template.ts"))).toContain(
      "margin: (top: 18mm, bottom: 22mm, left: 18mm, right: 18mm)",
    );
    const build = code(join(pdfDir, "page-map-build.ts"));
    expect(build).toContain("top: (18 * 72) / 25.4");
    expect(build).toContain("bottom: (22 * 72) / 25.4");
    expect(build).toContain("right: (18 * 72) / 25.4");
  });

  it("hash regnes med crypto.subtle, uten node: utenfor *.node.ts og arbeidstråden", () => {
    expect(code(join(pdfDir, "render.ts"))).toContain('crypto.subtle.digest("SHA-256"');
    for (const file of productFiles) {
      if (/\.node\.ts$|typst-worker\.mjs$/.test(file)) continue;
      expect(code(file), rel(file)).not.toMatch(/from ["']node:|require\(["']node:/);
    }
  });
});
