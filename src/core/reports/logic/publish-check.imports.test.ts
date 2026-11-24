import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statisk importtest for sjekken før publisering (docs/funksjoner/fase2a-publisering-badet-testplan.md
 * 2.4, kortets P9). Sjekken og kanoniseringen er samme kode i nettleseren, på iPaden og på
 * serveren: ingen database, ingen `server-only`, ingen `node:crypto`, ingen KI og ingen feltkoder
 * for våtrom (ADR 0013 punkt 14). Publiseringstjenesten kaller aldri KI.
 *
 * Hovedmål: KI i bunnen (KI er ikke med i sjekken, og publisering gir aldri KI-kall) og færre
 * reklamasjoner (samme svar på iPaden og serveren).
 */

const ROOT = resolve(__dirname, "../../../..");
const LOGIC = __dirname;
const REPORTS = resolve(__dirname, "..");

/** Alle importer i en fil: `[spesifikator, bare typer]`. */
function importsOf(source: string): { target: string; typeOnly: boolean }[] {
  const found: { target: string; typeOnly: boolean }[] = [];
  for (const match of source.matchAll(
    /^\s*(import|export)\s+(type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gmu,
  )) {
    found.push({ target: match[3]!, typeOnly: match[2] !== undefined });
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)) {
    found.push({ target: match[1]!, typeOnly: false });
  }
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/gu)) {
    found.push({ target: match[1]!, typeOnly: false });
  }
  return found;
}

/** Fila en relativ import eller `@/`-import peker på, når den finnes. */
function resolveLocal(from: string, target: string): string | null {
  let base: string;
  if (target.startsWith("./") || target.startsWith("../")) base = resolve(dirname(from), target);
  else if (target.startsWith("@/")) base = join(ROOT, "src", target.slice(2));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // mappe
      }
    }
  }
  return null;
}

/**
 * Alle importer (ikke bare typer) som følger med når fila lastes, også gjennom egen kode. Typer
 * fjernes ved bygging og følges ikke.
 */
function runtimeImportGraph(entry: string): { file: string; target: string }[] {
  const seen = new Set<string>();
  const edges: { file: string; target: string }[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { target, typeOnly } of importsOf(readFileSync(file, "utf8"))) {
      if (typeOnly) continue;
      edges.push({ file, target });
      const local = resolveLocal(file, target);
      if (local) queue.push(local);
    }
  }
  return edges;
}

const FORBIDDEN = [
  /^@\/db(\/|$)/u,
  /^server-only$/u,
  /^node:crypto$/u,
  /^crypto$/u,
  /^drizzle-orm/u,
  /^@\/core\/ai(\/|$)/u,
  /^@\/core\/reports$/u,
];

const PURE_FILES = ["publish-check.ts", "publish-check-texts.ts", "publish-check-types.ts"];

describe("2.4 statisk importtest (P9)", () => {
  it.each(PURE_FILES)("%s finnes", (file) => {
    expect(existsSync(join(LOGIC, file))).toBe(true);
  });

  it.each(PURE_FILES)(
    "%s laster verken database, server-only, node:crypto, drizzle-orm eller KI (heller ikke gjennom andre filer)",
    (file) => {
      for (const edge of runtimeImportGraph(join(LOGIC, file))) {
        for (const pattern of FORBIDDEN) {
          expect(
            pattern.test(edge.target),
            `${edge.file.replace(ROOT, "")} importerer ${edge.target}`,
          ).toBe(false);
        }
      }
    },
  );

  it.each(PURE_FILES)("%s har ingen feltkoder for våtrom og ingen dagens dato", (file) => {
    const source = readFileSync(join(LOGIC, file), "utf8");
    expect(source).not.toMatch(/["'`]wet_room\./u);
    expect(source).not.toMatch(/new Date\(|Date\.now\(/u);
  });

  it("publiseringstjenesten importerer ikke @/core/ai", () => {
    const serviceFiles = readdirSync(REPORTS).filter(
      (f) => /^publish/u.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(serviceFiles).toContain("publish.ts");
    for (const file of serviceFiles) {
      const source = readFileSync(join(REPORTS, file), "utf8");
      for (const { target } of importsOf(source)) {
        expect(/^@\/core\/ai(\/|$)/u.test(target), `${file} importerer ${target}`).toBe(false);
      }
    }
  });

  it("publiseringstjenesten oppdaterer eller sletter aldri utgivelser og sjekkrader (4.3.6)", () => {
    const serviceFiles = readdirSync(REPORTS).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    for (const file of serviceFiles) {
      const source = readFileSync(join(REPORTS, file), "utf8");
      expect(source, file).not.toMatch(/\.update\(\s*(reportReleases|publishCheckResults)\b/u);
      expect(source, file).not.toMatch(/\.delete\(\s*(reportReleases|publishCheckResults)\b/u);
    }
  });

  it("ingen kode i src/ oppdaterer eller sletter utgivelser og sjekkrader (4.3.6)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "migrations" || entry.name === "node_modules") continue;
          walk(path);
        } else if (/\.(ts|tsx)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          if (
            /\.(update|delete)\(\s*(reportReleases|publishCheckResults)\b/u.test(source) ||
            /(update|delete\s+from)\s+"?(report_releases|publish_check_results)\b/iu.test(source)
          ) {
            offenders.push(path.replace(ROOT, ""));
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  it("papirkurven tar ikke med utgivelser eller sjekkrader (4.3.6)", () => {
    const trashFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /trash/iu.test(entry.name) &&
          /\.tsx?$/u.test(entry.name) &&
          !/\.test\./u.test(entry.name)
        ) {
          trashFiles.push(path);
        }
      }
    };
    walk(join(ROOT, "src", "core"));
    expect(trashFiles.length).toBeGreaterThan(0);
    for (const file of trashFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /reportReleases|publishCheckResults|report_releases|publish_check_results/u,
      );
    }
  });
});
