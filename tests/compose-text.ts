import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/**
 * Tekst- og YAML-hjelpere for konfigurasjonstestene (PowerSync og ElectricSQL). Ingen YAML-pakke i
 * treet som direkte avhengighet, så filene leses som tekst: små hjelpere henter ut en blokk etter
 * innrykk. Flyttet hit fra tests/powersync/config.test.ts
 * (docs/funksjoner/fase1-kandidat-electricsql-testplan.md avsnitt 1). Ren hjelpefil, ingen test.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function read(relative: string): string {
  const file = path.join(ROOT, relative);
  expect(existsSync(file), `${relative} mangler`).toBe(true);
  return readFileSync(file, "utf8");
}

/** Linjer uten kommentarer og tomme linjer. */
export function contentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .filter((line) => line.trim() !== "");
}

export function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Teksten under nøkkelen `key` (første treff med gitt innrykk eller dypere enn `minIndent`),
 * fram til neste linje med samme eller mindre innrykk.
 */
export function block(text: string, key: string, minIndent = 0): string {
  const lines = contentLines(text);
  const start = lines.findIndex(
    (line) => indentOf(line) >= minIndent && new RegExp(`^\\s*${key}:`).test(line),
  );
  expect(start, `fant ikke «${key}:»`).toBeGreaterThanOrEqual(0);
  const indent = indentOf(lines[start]!);
  const out = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (indentOf(line) <= indent) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Verdien til `key` i .env.example, eller undefined. */
export function envExampleValue(key: string): string | undefined {
  const line = read(".env.example")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}
