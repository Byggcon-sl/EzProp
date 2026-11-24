import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * P9 statisk importtest (testplanen avsnitt 2.4). Sjekken før publisering er samme modul i
 * nettleseren, på iPaden og på serveren: ingen database, ingen `server-only`, ingen `node:crypto`,
 * ingen pakker, ingen KI og ingen feltkoder for våtrom (ADR 0013 punkt 14, A396).
 *
 * Hovedmål: de ansatte (samme sjekk overalt) og KI i bunnen (KI er aldri med i sjekken).
 */

const FILES = ["publish-check.ts", "publish-check-texts.ts", "publish-check-types.ts"];

function importsOf(source: string): { target: string; typeOnly: boolean }[] {
  return [...source.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gmu)].map(
    (match) => ({
      target: match[3]!,
      typeOnly: match[2] !== undefined,
    }),
  );
}

describe("P9 sjekken er ren kode", () => {
  it.each(FILES)("%s importerer verken database, server, kryptering, pakker eller KI", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    for (const { target, typeOnly } of importsOf(source)) {
      expect(target, `${file}: ${target}`).not.toMatch(
        /^(server-only|node:|crypto$|drizzle-orm|zod|react|next)/u,
      );
      expect(target, `${file}: ${target}`).not.toMatch(/^@\/core\/ai/u);
      if (target.startsWith("@/db")) expect(typeOnly, `${file}: ${target}`).toBe(true);
      const allowed =
        target.startsWith("./") || target.startsWith("@/shared/") || target.startsWith("@/db");
      expect(allowed, `${file}: ${target}`).toBe(true);
    }
    expect(source, file).not.toMatch(/require\(|import\(/u);
  });

  it.each(FILES)("%s har ingen feltkoder for våtrom og ingen dagens dato", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    expect(source, file).not.toMatch(/wet_room\./u);
    expect(source, file).not.toMatch(/new Date\(|Date\.now\(/u);
  });
});
