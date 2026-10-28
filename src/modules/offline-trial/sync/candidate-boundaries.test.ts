import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sidene og bildekøen er kandidatuavhengige (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 2
// og avgjørelse A og E), ellers blir kriteriet «Arbeid» skjevt mellom kandidatene. Testplan
// avsnitt 2.5. Filene leses som tekst; ingen ESLint-regel.

const ROOT = process.cwd();
const MODULE = "src/modules/offline-trial";
const PAGES = "src/app/(ansatt)/prove/testskjema";
const HEADER = "Prøve fase 1, kastes eller gjøres om etter ADR";

/** Kandidatenes pakker og mapper. Treffer både `@/…/sync/powersync/x` og `./powersync/x`. */
const CANDIDATE_SPECIFIER =
  /@powersync\/|@electric-sql\/|(^|\/)sync\/(powersync|electricsql)(\/|$)|^\.\.?\/(powersync|electricsql)(\/|$)/;

function read(relative: string): string {
  const file = path.join(ROOT, relative);
  expect(existsSync(file), `${relative} mangler`).toBe(true);
  return readFileSync(file, "utf8");
}

function filesUnder(relative: string, pattern: RegExp): string[] {
  const dir = path.join(ROOT, relative);
  expect(existsSync(dir), `${relative} mangler`).toBe(true);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const child = path.join(relative, name);
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...filesUnder(child, pattern));
    else if (pattern.test(name)) out.push(child);
  }
  return out;
}

interface Specifier {
  specifier: string;
  kind: "static" | "type" | "dynamic";
}

/** Alle modulnavn filen henter: `import … from`, `export … from`, `import "x"`, `import("x")`, `require("x")`. */
function specifiersOf(text: string): Specifier[] {
  const out: Specifier[] = [];
  const fromPattern = /\b(import|export)\s+(type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(fromPattern)) {
    out.push({ specifier: match[3]!, kind: match[2] ? "type" : "static" });
  }
  for (const match of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    out.push({ specifier: match[1]!, kind: "static" });
  }
  for (const match of text.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    out.push({ specifier: match[1]!, kind: "dynamic" });
  }
  return out;
}

function candidateImports(relative: string): string[] {
  return specifiersOf(read(relative))
    .map((entry) => entry.specifier)
    .filter((specifier) => CANDIDATE_SPECIFIER.test(specifier));
}

function startsWithHeader(relative: string): boolean {
  const text = read(relative).trimStart();
  let comment: string | undefined;
  if (text.startsWith("/*")) comment = text.slice(0, text.indexOf("*/") + 2);
  else if (text.startsWith("//")) comment = /^(?:\/\/.*\n?)+/.exec(text)?.[0];
  return comment !== undefined && comment.includes(HEADER);
}

describe("kandidatgrensene", () => {
  // Obligatorisk (rettferdig «Arbeid»)
  it("sidene under prove/testskjema importerer ikke fra noen kandidat", () => {
    const files = filesUnder(PAGES, /\.tsx?$/);
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => candidateImports(file).map((spec) => `${file}: ${spec}`));
    expect(found).toEqual([]);
  });

  it("photo-uploader.ts importerer ikke fra noen kandidat", () => {
    expect(candidateImports(`${MODULE}/sync/photo-uploader.ts`)).toEqual([]);
  });

  it("sync-indicator.tsx importerer ikke fra noen kandidat", () => {
    expect(candidateImports(`${MODULE}/sync-indicator.tsx`)).toEqual([]);
  });

  it("de rene filene i sync/electricsql importerer ikke window, React eller @electric-sql", () => {
    for (const name of ["outbox.ts", "apply-incoming.ts", "shape-messages.ts"]) {
      const relative = `${MODULE}/sync/electricsql/${name}`;
      const text = read(relative);
      const specifiers = specifiersOf(text).map((entry) => entry.specifier);
      expect(
        specifiers.filter(
          (s) => s === "react" || s.startsWith("react/") || s.startsWith("@electric-sql/"),
        ),
        relative,
      ).toEqual([]);
      for (const word of ["window.", "indexedDB", "document.", "navigator."]) {
        expect(text.includes(word), `${relative} inneholder ${word}`).toBe(false);
      }
    }
  });

  it("select-store.ts laster kandidaten med dynamisk import", () => {
    const relative = `${MODULE}/sync/select-store.ts`;
    const specifiers = specifiersOf(read(relative));
    // Bare typer (fjernes ved bygging) er lov statisk; koden lastes med import()
    const staticCandidate = specifiers.filter(
      (entry) => entry.kind === "static" && CANDIDATE_SPECIFIER.test(entry.specifier),
    );
    expect(staticCandidate.map((entry) => entry.specifier)).toEqual([]);
    const dynamic = specifiers.filter((entry) => entry.kind === "dynamic").map((e) => e.specifier);
    expect(
      dynamic.some((s) => /(^|\/)powersync\//.test(s)),
      "import() for powersync",
    ).toBe(true);
    expect(
      dynamic.some((s) => /(^|\/)electricsql\//.test(s)),
      "import() for electricsql",
    ).toBe(true);
  });

  it("types.ts har ikke getAnswers", () => {
    const text = read(`${MODULE}/sync/types.ts`);
    expect(text).not.toContain("getAnswers");
    for (const name of [
      "flush",
      "close",
      "subscribeForms",
      "onStatusChange",
      "listPendingPhotos",
      "markPhotoUploaded",
      "TrialSyncTestable",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("alle filer i sync/electricsql har hodekommentaren", () => {
    const electric = filesUnder(`${MODULE}/sync/electricsql`, /\.ts$/).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    // Minst typene og de tre rene filene
    expect(electric.length).toBeGreaterThanOrEqual(4);
    const files = [
      ...electric,
      `${MODULE}/server/electric-shape.ts`,
      `${MODULE}/sync/select-store.ts`,
      `${MODULE}/sync/test-hooks.ts`,
    ];
    const missing = files.filter((file) => !startsWithHeader(file));
    expect(missing).toEqual([]);
  });
});
