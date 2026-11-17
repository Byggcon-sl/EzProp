import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Den planlagte ryddingen av innloggingsdata og hemmelighetens vei til appen (ADR 0014).
 * Testplan: docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, C4–C7.
 * Filene leses som tekst og sjekkes med enkle mønstre (ingen YAML-pakke, ingen kall ut).
 *
 * Støtter hovedmål: best for de ansatte (ryddingen går av seg selv hver natt, uten kostnad).
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function isComment(line: string): boolean {
  return /^\s*(#|\/\/)/.test(line);
}

function code(text: string): string[] {
  return text.split("\n").filter((line) => !isComment(line));
}

function secretNames(text: string): string[] {
  return [...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]!))];
}

const WORKFLOW_PATH = ".github/workflows/rydd-innloggingsdata.yml";
const workflow = read(WORKFLOW_PATH);
const lines = code(workflow);

/** Linjene i `run: |`-blokken (bash-skriptet). */
function runScript(): string[] {
  const all = workflow.split("\n");
  const start = all.findIndex((line) => /^\s*run:\s*\|/.test(line));
  expect(start, "run: |").toBeGreaterThan(-1);
  const indent = all[start]!.length - all[start]!.trimStart().length;
  const out: string[] = [];
  for (const line of all.slice(start + 1)) {
    if (line.trim() !== "" && line.length - line.trimStart().length <= indent) break;
    out.push(line);
  }
  return out;
}

describe("C4 scheduled workflow", () => {
  it("runs nightly and by hand, without permissions", () => {
    expect(workflow).toMatch(/^name: Rydding av innloggingsdata$/m);
    expect(workflow).toMatch(/^\s*schedule:/m);
    const cron = workflow.match(/cron:\s*"([^"]+)"/);
    expect(cron, "cron").not.toBeNull();
    const [minute, hour, ...rest] = cron![1]!.split(" ");
    expect(rest).toEqual(["*", "*", "*"]);
    expect(Number(minute)).not.toBe(0);
    expect(Number(hour)).toBeLessThan(6);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).not.toMatch(/^[ ]+permissions:/m);
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
    expect(workflow).not.toContain("actions/checkout");
  });

  it("secret only via env, never on the command line, no verbose curl", () => {
    expect(workflow).toMatch(
      /^\s*AUTH_CLEANUP_SECRET:\s*\$\{\{\s*secrets\.AUTH_CLEANUP_SECRET\s*\}\}\s*$/m,
    );
    const script = runScript();
    expect(script.join("\n")).not.toContain("${{");
    expect(script.join("\n")).not.toMatch(/set\s+-[a-z]*x/);
    expect(script.join("\n")).toMatch(/curl --fail --silent --show-error[^\n]*-X POST/);
    for (const flag of [/\s-v\b/, /\s-i\b/, /--include/, /--trace/, /--verbose/]) {
      expect(script.join("\n")).not.toMatch(flag);
    }
    expect(script.join("\n")).toContain("/api/intern/rydd-innloggingsdata");
    for (const line of script.filter((l) => /\becho\b/.test(l))) {
      expect(line).not.toMatch(/\$\{?AUTH_CLEANUP_SECRET/);
    }
  });
});

describe("C5 skips without error when secret or url missing", () => {
  it("exits 0 with a notice when the secret or the address is empty", () => {
    const script = runScript().join("\n");
    expect(script).toMatch(
      /if \[ -z "\$AUTH_CLEANUP_SECRET" \]; then\s*\n\s*echo "::notice::[^\n]*"\s*\n\s*exit 0/,
    );
    expect(script).toMatch(
      /if \[ -z "\$URL" \]; then\s*\n\s*echo "::notice::[^\n]*"\s*\n\s*exit 0/,
    );
    // Sjekken kommer før kallet.
    expect(script.indexOf('-z "$AUTH_CLEANUP_SECRET"')).toBeLessThan(script.indexOf("curl "));
    expect(script.indexOf('-z "$URL"')).toBeLessThan(script.indexOf("curl "));
  });
});

describe("C6 same GitHub secret as deploy, no production url", () => {
  it("uses only AUTH_CLEANUP_SECRET, the same name as the deployment", () => {
    expect(secretNames(workflow)).toEqual(["AUTH_CLEANUP_SECRET"]);
    expect(secretNames(read(".github/workflows/deploy-azure.yml"))).toContain(
      "AUTH_CLEANUP_SECRET",
    );
  });

  it("the address is the test environment's", () => {
    const vars = [...workflow.matchAll(/vars\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(vars).toEqual(["APP_HOSTNAME"]);
    const urls = lines.flatMap((line) =>
      [...line.matchAll(/https:\/\/[^\s"'$]+/g)].map((m) => m[0]),
    );
    expect(urls).toEqual(["https://app-ezprop-test.azurewebsites.net"]);
    expect(lines.join("\n").toLowerCase()).not.toMatch(/prod/);
  });
});

describe("C7 Bicep and deploy carry AUTH_CLEANUP_SECRET", () => {
  const bicep = read("infra/azure/main.bicep");
  const bicepLines = bicep.split("\n");

  it("Bicep has a secure parameter, a conditional vault secret and the app setting", () => {
    const index = bicepLines.findIndex((line) => /^param authCleanupSecret string$/.test(line));
    expect(index, "param authCleanupSecret").toBeGreaterThan(-1);
    expect(bicepLines[index - 1]!.trim()).toBe("@secure()");
    expect(bicep).toMatch(/^var authCleanupConfigured = !empty\(authCleanupSecret\)$/m);
    expect(bicep).toMatch(
      /^resource kvAuthCleanupSecret 'Microsoft\.KeyVault\/vaults\/secrets@[^']+' = if \(enableKeyVault && authCleanupConfigured\) \{$/m,
    );
    expect(bicep).toContain("name: 'auth-cleanup-secret'");
    expect(bicep).toMatch(
      /\{ name: 'AUTH_CLEANUP_SECRET', value: enableKeyVault \? '@Microsoft\.KeyVault\(SecretUri=\$\{kvAuthCleanupSecret!\.properties\.secretUri\}\)' : authCleanupSecret \}/,
    );
    expect(bicep).toMatch(/var authCleanupAppSettings = authCleanupConfigured/);
    expect(bicep).toMatch(/appSettings: concat\([^)]*authCleanupAppSettings\)/);
  });

  it("the deployment passes the parameter from env", () => {
    const deploy = read(".github/workflows/deploy-azure.yml");
    expect(deploy).toMatch(
      /^\s*AUTH_CLEANUP_SECRET:\s*\$\{\{\s*secrets\.AUTH_CLEANUP_SECRET\s*\}\}\s*$/m,
    );
    expect(deploy).toContain('"authCleanupSecret=$AUTH_CLEANUP_SECRET"');
    for (const line of code(deploy).filter((l) => /\becho\b/.test(l))) {
      expect(line).not.toContain("AUTH_CLEANUP_SECRET");
    }
  });

  it("the operations document describes the job", () => {
    const doc = read("docs/drift/testmiljo-azure.md");
    const section = doc.slice(doc.indexOf("## Rydding av innloggingsdata"));
    expect(doc).toContain("## Rydding av innloggingsdata");
    for (const text of [
      "AUTH_CLEANUP_SECRET",
      "24 timer",
      "30 dager",
      "ADR 0014",
      "Run workflow",
      "Utrulling til Azure",
      "404",
      "500",
      "60 dager",
      "Produksjon",
    ]) {
      expect(section, text).toContain(text);
    }
  });
});
