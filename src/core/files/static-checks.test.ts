import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Kontrollene i testplanen avsnitt 9 som kan sjekkes i kode
// (docs/funksjoner/fase0b-filtjeneste-testplan.md): ingen sletting i filtjenesten, ingen import
// fra modulene, og `@azure/storage-blob` bare i Azure-adapteren.

const repoRoot = join(__dirname, "..", "..", "..");
const filesDir = join(repoRoot, "src", "core", "files");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const productFiles = () => sourceFiles(filesDir).filter((file) => !file.endsWith(".test.ts"));

describe("filtjenesten, statiske kontroller", () => {
  it("har kildefiler (ellers sier testene under ingenting)", () => {
    expect(productFiles().length).toBeGreaterThan(0);
  });

  it("src/core/files sletter aldri: ingen unlink, rm eller delete på tabellen", () => {
    for (const file of productFiles()) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(repoRoot, file)).not.toMatch(
        /\b(unlink|unlinkSync|rm|rmSync|rmdir)\s*\(/,
      );
      expect(text, relative(repoRoot, file)).not.toMatch(/\.delete\s*\(\s*files\b/);
      expect(text, relative(repoRoot, file)).not.toMatch(/deleteIfExists|\.delete\s*\(\s*\)/);
    }
  });

  it("@azure/storage-blob importeres bare i Azure-adapteren", () => {
    const users = sourceFiles(join(repoRoot, "src"))
      .filter((file) => /from\s+["']@azure\/storage-blob["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));
    expect(users).toEqual(["src/core/files/azure-storage.ts"]);
  });
});
