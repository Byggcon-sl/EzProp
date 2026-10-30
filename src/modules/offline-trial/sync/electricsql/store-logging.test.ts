import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Loggen i synken viser bare feilmeldingen, aldri hele feilobjektet (rader fra serveren kan henge
// på feilen). Testplan docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md avsnitt 2 (L2, L3).
// Formleseren i `store.ts` er ikke eksportert og trenger IndexedDB, så her leses kilden som tekst.
// Oppførselen for egenbygd er testet i custom/reader.test.ts (L1).

const SYNC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Alle `.ts` under `sync/` utenom tester. */
function syncSourceFiles(dir = SYNC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return syncSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** Kilden uten kommentarer; tekstverdier står igjen. */
function withoutComments(source: string): string {
  return source.replace(
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, literal: string | undefined) => literal ?? "",
  );
}

/** Argumentene (som tekst, på øverste nivå) til hvert kall `console.x(…)` i kilden. */
function consoleCalls(source: string): { method: string; args: string[] }[] {
  const calls: { method: string; args: string[] }[] = [];
  const start = /console\.(warn|error|log|info|debug)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(source))) {
    const args: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = "";
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const char = source[i]!;
      if (quote) {
        current += char;
        if (char === "\\") current += source[++i] ?? "";
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        current += char;
        continue;
      }
      if (char === "(" || char === "[" || char === "{") depth++;
      if (char === ")" || char === "]" || char === "}") {
        if (depth === 0) break;
        depth--;
      }
      if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim() !== "") args.push(current.trim());
    calls.push({ method: match[1]!, args });
  }
  return calls;
}

/** Navnene på feilvariablene i filen (`catch (x)` og vanlige navn). */
function errorNames(source: string): Set<string> {
  const names = new Set(["error", "err", "e", "cause", "reason"]);
  for (const found of source.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(found[1]!);
  return names;
}

/** Kall der et argument er selve feilvariabelen. */
function wholeErrorLogged(file: string): string[] {
  const source = withoutComments(readFileSync(file, "utf8"));
  const names = errorNames(source);
  return consoleCalls(source)
    .filter(({ args }) => args.some((arg) => names.has(arg)))
    .map(
      ({ method, args }) =>
        `${path.relative(SYNC_DIR, file)}: console.${method}(${args.join(", ")})`,
    );
}

describe("loggen i synken", () => {
  it("Electric: loggen viser bare feilmeldingen når rader ikke kan legges inn", () => {
    const files = ["electricsql/store.ts", "custom/reader.ts"].map((file) =>
      path.join(SYNC_DIR, file),
    );
    for (const file of files) {
      const source = withoutComments(readFileSync(file, "utf8"));
      // Meldingen finnes fortsatt (vi tester riktig sted).
      expect(source, file).toContain("Synk: kunne ikke legge inn rader fra serveren.");
    }
    expect(files.flatMap(wholeErrorLogged)).toEqual([]);
  });

  it("ingen synkfil logger hele feilobjektet", () => {
    const files = syncSourceFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files.flatMap(wholeErrorLogged)).toEqual([]);
  });

  it("hjelperen finner feilobjektet i et loggkall (selvsjekk)", () => {
    const sample = `try { x(); } catch (problem) { console.warn("Synk: feil.", problem); }`;
    const names = errorNames(sample);
    const flagged = consoleCalls(sample).filter(({ args }) => args.some((a) => names.has(a)));
    expect(flagged).toHaveLength(1);
    const ok = `try { x(); } catch (error) { console.warn("Synk: feil.", errorText(error)); }`;
    const okNames = errorNames(ok);
    expect(consoleCalls(ok).filter(({ args }) => args.some((a) => okNames.has(a)))).toEqual([]);
  });
});
