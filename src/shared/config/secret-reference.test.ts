import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isUnresolvedSecretReference, KEY_VAULT_REFERENCE_PREFIX } from "./secret-reference";

/*
 * Testplan docs/funksjoner/fase0b-nokkelboks-testplan.md avsnitt 4. Støtter hovedmål: reklamasjoner
 * (en referanse som ikke ble hentet, brukes aldri som nøkkel). Alle verdier er oppdiktet.
 */

const URI = "https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/";

describe("isUnresolvedSecretReference", () => {
  it.each([
    [`@Microsoft.KeyVault(SecretUri=${URI})`],
    ["@Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)"],
    [`  @Microsoft.KeyVault(SecretUri=${URI})\n`],
    ["  @Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)\n"],
    [`@microsoft.keyvault(secreturi=${URI})`],
    ["@MICROSOFT.KEYVAULT(VaultName=x;SecretName=y;SecretVersion=z)"],
  ])("1. %j er en referanse som ikke er hentet", (value) => {
    expect(isUnresolvedSecretReference(value)).toBe(true);
  });

  it.each([
    [""],
    ["   "],
    ["hemmelig-test-verdi"],
    ["postgres://ezprop:ezprop@localhost:5432/ezprop"],
    ["verdi med @Microsoft.KeyVault( inni"],
    [`Microsoft.KeyVault(SecretUri=${URI})`],
    ["@Microsoft.KeyVault"],
    ["@Microsoft.KeyVaultX("],
  ])("2. %j er ikke en referanse", (value) => {
    expect(isUnresolvedSecretReference(value)).toBe(false);
  });

  it("3. konstanten er starten på referansen", () => {
    expect(KEY_VAULT_REFERENCE_PREFIX).toBe("@Microsoft.KeyVault(");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe("formen på referansen står ett sted", () => {
  it("4. bare secret-reference.ts kjenner teksten, og secrets.ts og env.ts bruker funksjonen", () => {
    const files = sourceFiles("src").filter((file) =>
      readFileSync(join(process.cwd(), file), "utf8").includes("Microsoft.KeyVault("),
    );
    expect(files).toEqual(["src/shared/config/secret-reference.ts"]);

    const importPattern =
      /import\s*\{[^}]*\bisUnresolvedSecretReference\b[^}]*\}\s*from\s*["'](@\/shared\/config\/secret-reference|\.\/secret-reference)["']/;
    const secrets = readFileSync(join(process.cwd(), "src/core/integrations/secrets.ts"), "utf8");
    expect(secrets).toMatch(
      /import\s*\{[^}]*\bisUnresolvedSecretReference\b[^}]*\}\s*from\s*["']@\/shared\/config\/secret-reference["']/,
    );
    const env = readFileSync(join(process.cwd(), "src/shared/config/env.ts"), "utf8");
    expect(env).toMatch(importPattern);
  });
});
