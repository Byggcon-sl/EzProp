import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Kandidatuavhengige sider og rene filer (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 2 og
// avgjørelse E). Testplan avsnitt 2.5. Leser filene som tekst; ingen ESLint-regel.
// Hovedmål: tid (kriteriet «Arbeid» blir rettferdig mellom kandidatene bare når sidene er like).

const SYNC_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.resolve(SYNC_DIR, "..");
const ROOT = path.resolve(MODULE_DIR, "..", "..", "..");
const PAGES_DIR = path.join(ROOT, "src", "app", "(ansatt)", "prove", "testskjema");
const ELECTRIC_DIR = path.join(SYNC_DIR, "electricsql");

const CANDIDATE_IMPORT =
  /@powersync\/|@electric-sql\/|sync\/powersync\/|sync\/electricsql\/|^\.\.?\/(powersync|electricsql)\/|["'](\.\.?\/)+(sync\/)?(powersync|electricsql)\//;
const HEADER = "Prøve fase 1, kastes eller gjøres om etter ADR";

function read(file: string): string {
  expect(existsSync(file), `${path.relative(ROOT, file)} mangler`).toBe(true);
  return readFileSync(file, "utf8");
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  expect(existsSync(dir), `${path.relative(ROOT, dir)} mangler`).toBe(true);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, pattern));
    else if (pattern.test(name)) out.push(full);
  }
  return out;
}

/** Hvert modulnavn i `import … from "x"`, `export … from "x"`, `import("x")` og `import "x"`. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+["']([^"']+)["']/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]!);
  }
  return specs;
}

/** Statiske importer: `import … from "x"` og `export … from "x"` (ikke dynamisk `import()`). */
function staticImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(
    /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gms,
  )) {
    specs.push(match[1]!);
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specs.push(match[1]!);
  return specs;
}

/** Peker modulnavnet (relativt til `file`) inn i en kandidat? */
function isCandidateImport(file: string, spec: string): boolean {
  if (/^@powersync\/|^@electric-sql\//.test(spec)) return true;
  if (/sync\/(powersync|electricsql)(\/|$)/.test(spec)) return true;
  if (spec.startsWith(".")) {
    const resolved = path.resolve(path.dirname(file), spec);
    const relative = path.relative(SYNC_DIR, resolved).split(path.sep).join("/");
    if (/^(powersync|electricsql)(\/|$)/.test(relative)) return true;
  }
  return false;
}

function candidateImportsIn(file: string): string[] {
  return importSpecifiers(read(file)).filter((spec) => isCandidateImport(file, spec));
}

describe("kandidatgrenser", () => {
  it("sidene under prove/testskjema importerer ikke fra noen kandidat", () => {
    const files = filesUnder(PAGES_DIR, /\.(ts|tsx)$/);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      candidateImportsIn(file).map((spec) => `${path.relative(ROOT, file)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
    // Dobbeltsjekk med tekstmønsteret fra testplanen (også i kommentarløse import-linjer)
    for (const file of files) {
      for (const line of read(file).split("\n")) {
        if (/^\s*(import|export)\b|\bfrom\s+["']|\bimport\s*\(/.test(line)) {
          expect(CANDIDATE_IMPORT.test(line), `${path.relative(ROOT, file)}: ${line}`).toBe(false);
        }
      }
    }
  });

  it("photo-uploader.ts importerer ikke fra noen kandidat", () => {
    expect(candidateImportsIn(path.join(SYNC_DIR, "photo-uploader.ts"))).toEqual([]);
  });

  it("sync-indicator.tsx importerer ikke fra noen kandidat", () => {
    expect(candidateImportsIn(path.join(MODULE_DIR, "sync-indicator.tsx"))).toEqual([]);
  });

  it("de rene filene i sync/electricsql importerer ikke window, React eller @electric-sql", () => {
    for (const name of ["outbox.ts", "apply-incoming.ts", "shape-messages.ts"]) {
      const file = path.join(ELECTRIC_DIR, name);
      const source = read(file);
      const specs = importSpecifiers(source);
      expect(
        specs.filter((spec) => spec === "react" || spec.startsWith("react/")),
        name,
      ).toEqual([]);
      expect(
        specs.filter((spec) => spec.startsWith("@electric-sql/")),
        name,
      ).toEqual([]);
      for (const forbidden of ["window.", "indexedDB", "document.", "navigator."]) {
        expect(source.includes(forbidden), `${name} bruker ${forbidden}`).toBe(false);
      }
    }
  });

  it("select-store.ts laster kandidaten med dynamisk import", () => {
    const file = path.join(SYNC_DIR, "select-store.ts");
    const source = read(file);
    const staticCandidate = staticImportSpecifiers(source).filter((spec) =>
      isCandidateImport(file, spec),
    );
    expect(staticCandidate).toEqual([]);
    const dynamic = Array.from(source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)).map(
      (match) => match[1]!,
    );
    expect(dynamic.some((spec) => /(^|\/)powersync\//.test(spec))).toBe(true);
    expect(dynamic.some((spec) => /(^|\/)electricsql\//.test(spec))).toBe(true);
  });

  it("types.ts har ikke getAnswers", () => {
    const source = read(path.join(SYNC_DIR, "types.ts"));
    expect(source).not.toContain("getAnswers");
    for (const name of [
      "flush",
      "close",
      "subscribeForms",
      "onStatusChange",
      "listPendingPhotos",
      "markPhotoUploaded",
      "TrialSyncTestable",
    ]) {
      expect(source, name).toContain(name);
    }
  });

  it("alle filer i sync/electricsql har hodekommentaren", () => {
    const files = [
      ...filesUnder(ELECTRIC_DIR, /\.ts$/).filter((file) => !file.endsWith(".test.ts")),
      path.join(MODULE_DIR, "server", "electric-shape.ts"),
      path.join(SYNC_DIR, "select-store.ts"),
    ];
    // Minst kontrakten og de tre rene filene, pluss selve lageret
    for (const name of ["types.ts", "outbox.ts", "apply-incoming.ts", "shape-messages.ts"]) {
      expect(
        files.some((file) => path.basename(file) === name && path.dirname(file) === ELECTRIC_DIR),
        name,
      ).toBe(true);
    }
    for (const file of files) {
      const source = read(file).trimStart();
      // Hodekommentaren står først i filen (etter et eventuelt "use client")
      const withoutDirective = source.replace(/^["']use (client|server)["'];?\s*/, "");
      expect(
        withoutDirective.startsWith("/*") || withoutDirective.startsWith("//"),
        path.relative(ROOT, file),
      ).toBe(true);
      const firstComment = /^(\/\*[\s\S]*?\*\/|(?:\/\/.*\n?)+)/.exec(withoutDirective)?.[0] ?? "";
      expect(firstComment, path.relative(ROOT, file)).toContain(HEADER);
    }
  });
});
