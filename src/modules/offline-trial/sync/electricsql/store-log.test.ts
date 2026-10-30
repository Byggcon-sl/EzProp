import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Synkfilene logger bare feilmeldingen, aldri hele feilobjektet: et feilobjekt kan bære rader fra
// serveren eller tekst fra skjemaet. Testplan docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md
// avsnitt 2 (L2 og L3). Kildetest: formleseren i `store.ts` er ikke eksportert, og ingenting
// eksporteres bare for testen. Filene leses som tekst.

const SYNC = "src/modules/offline-trial/sync";
/** Navn som brukes på fanget feil i `catch` og `.catch`. */
const ERROR_NAMES = new Set(["error", "err", "e"]);

interface LogCall {
  file: string;
  line: number;
  args: string[];
}

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/** Alle `.ts`-filer under synkmappen, utenom tester. */
function syncSourceFiles(): string[] {
  const entries = readdirSync(path.join(process.cwd(), SYNC), { recursive: true });
  return entries
    .map((entry) => String(entry).split(path.sep).join("/"))
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => `${SYNC}/${entry}`)
    .sort();
}

/**
 * Finner `console.warn|error|log(…)` og deler argumentene på komma på øverste nivå. Hopper over
 * tekst i anførselstegn og malstrenger (også `${…}` inni dem), så komma der teller ikke.
 */
function logCalls(file: string, text: string): LogCall[] {
  const calls: LogCall[] = [];
  const start = /console\.(?:warn|error|log)\s*\(/g;
  for (let match = start.exec(text); match; match = start.exec(text)) {
    const args: string[] = [];
    let depth = 0;
    let current = "";
    let i = match.index + match[0].length;
    for (; i < text.length; i++) {
      const char = text[i]!;
      if (char === '"' || char === "'" || char === "`") {
        const end = skipString(text, i);
        current += text.slice(i, end);
        i = end - 1;
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
    const line = text.slice(0, match.index).split("\n").length;
    calls.push({ file, line, args });
  }
  return calls;
}

/** Indeksen rett etter strengen som starter ved `from`. */
function skipString(text: string, from: number): number {
  const quote = text[from];
  let i = from + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && char === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      continue;
    }
    if (char === quote) return i + 1;
    i++;
  }
  return i;
}

/** Kall der et argument er feilvariabelen alene (hele feilobjektet i loggen). */
function wholeErrorCalls(calls: LogCall[]): string[] {
  return calls
    .filter((call) => call.args.some((arg) => ERROR_NAMES.has(arg)))
    .map((call) => `${call.file}:${call.line}`);
}

describe("loggen i synkfilene", () => {
  it("kildesjekken finner hele feilobjektet når det står i loggen", () => {
    const sample = [
      'console.warn("Synk: noe feilet.", error);',
      "console.error(`Synk: ${a}, ${b}`,\n  err,\n);",
      'console.log("ok", e)',
      'console.warn("Synk: noe feilet.", error instanceof Error ? error.message : String(error));',
      'console.warn("Synk: noe feilet.", errorText(error));',
    ].join("\n");
    expect(wholeErrorCalls(logCalls("eksempel.ts", sample))).toEqual([
      "eksempel.ts:1",
      "eksempel.ts:2",
      "eksempel.ts:5",
    ]);
  });

  it("Electric: loggen viser bare feilmeldingen når rader ikke kan legges inn", () => {
    for (const file of [`${SYNC}/electricsql/store.ts`, `${SYNC}/custom/reader.ts`]) {
      const calls = logCalls(file, read(file));
      const merge = calls.filter((call) =>
        call.args[0]?.includes("kunne ikke legge inn rader fra serveren"),
      );
      expect(merge, file).toHaveLength(1);
      expect(merge[0]!.args.slice(1), file).toEqual([
        "error instanceof Error ? error.message : String(error)",
      ]);
      expect(wholeErrorCalls(calls), file).toEqual([]);
    }
  });

  it("ingen synkfil logger hele feilobjektet", () => {
    const files = syncSourceFiles();
    expect(files).toContain(`${SYNC}/electricsql/store.ts`);
    expect(files).toContain(`${SYNC}/local/trial-store.ts`);
    const calls = files.flatMap((file) => logCalls(file, read(file)));
    expect(calls.length).toBeGreaterThan(5);
    expect(wholeErrorCalls(calls)).toEqual([]);
  });
});
