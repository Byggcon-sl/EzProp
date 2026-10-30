import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Loggen i Electric-lagringen viser bare feilmeldingen, aldri hele feilobjektet (rader fra serveren
// kan henge på feilen). Testplan docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md (L2).
// Formleseren i `store.ts` er ikke eksportert og trenger IndexedDB, så her leses kilden som tekst.
// Egenbygd leser er testet ved å kjøre koden i custom/reader.test.ts (L1).

const STORE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "store.ts");

describe("loggen i Electric-lagringen", () => {
  it("logger bare feilmeldingen når rader fra serveren ikke kan legges inn", () => {
    const source = readFileSync(STORE_FILE, "utf8");
    const call = source.match(
      /console\.warn\(\s*"Synk: kunne ikke legge inn rader fra serveren\.",([^;]*)\);/,
    );
    expect(call, "loggkallet finnes").not.toBeNull();
    expect(call![1]!.trim()).toBe('error instanceof Error ? error.message : "ukjent feil",');
  });
});
