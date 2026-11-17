import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Testplan docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, avsnitt 5 (C4–C8). Filene
 * leses som tekst og sjekkes med enkle mønstre (ingen YAML-pakke, ingen kall til GitHub eller
 * Azure), samme måte som tests/deploy-workflow.test.ts.
 *
 * Støtter hovedmål: de ansatte (ryddingen går av seg selv hver natt, og hemmeligheten lekker
 * ikke). KI i bunnen: ikke berørt.
 */

const CLEANUP_WORKFLOW = ".github/workflows/rydd-innloggingsdata.yml";
const DEPLOY_WORKFLOW = ".github/workflows/deploy-azure.yml";
const BICEP = "infra/azure/main.bicep";
const SECRET_NAME = "AUTH_CLEANUP_SECRET";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function readCleanup(): string {
  expect(existsSync(join(process.cwd(), CLEANUP_WORKFLOW)), CLEANUP_WORKFLOW).toBe(true);
  return read(CLEANUP_WORKFLOW);
}

function isComment(line: string): boolean {
  return /^\s*(#|\/\/)/.test(line);
}

function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !isComment(line));
}

function secretNames(text: string): string[] {
  return [
    ...new Set(
      [
        ...codeLines(text)
          .join("\n")
          .matchAll(/secrets\.([A-Z0-9_]+)/g),
      ].map((m) => m[1]!),
    ),
  ];
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Alle `run:`-blokker (linjen og linjene med større innrykk). */
function runBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(-\s+)?run:/.test(line)) return;
    const indent = indentOf(line.replace(/-\s+/, "  "));
    const out = [line];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== "" && indentOf(next) <= indent) break;
      out.push(next);
    }
    blocks.push(out.join("\n"));
  });
  return blocks;
}

/** Kommandoene i `run:`-blokkene med fortsettelseslinjer (`\`) slått sammen. */
function curlCommands(text: string): string[] {
  return runBlocks(text)
    .map((block) => block.replace(/\\\s*\n\s*/g, " "))
    .flatMap((block) => block.split("\n"))
    .filter((line) => !isComment(line) && /\bcurl\b/.test(line));
}

// =====================================================================================

describe("planlagt arbeidsflyt for rydding av innloggingsdata (C4–C6)", () => {
  it("C4 scheduled workflow: schedule and workflow_dispatch", () => {
    const workflow = readCleanup();
    expect(workflow).toMatch(/^on:/m);
    expect(workflow).toMatch(/^\s+schedule:/m);
    const crons = [...workflow.matchAll(/-\s*cron:\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(crons).toHaveLength(1);
    // Én gang i døgnet: fast minutt og time, alle dager
    const [minute, hour, dom, month, dow] = crons[0]!.trim().split(/\s+/);
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
    expect(workflow).toMatch(/^\s+workflow_dispatch:/m);
  });

  it("C4 permissions: {} on top level", () => {
    const workflow = readCleanup();
    expect(workflow).toMatch(/^permissions:\s*\{\s*\}\s*$/m);
    // Ingen jobb gir seg selv flere rettigheter
    expect(workflow).not.toMatch(/^[ \t]+permissions:[ \t]*\S/m);
  });

  it("C4 secret only via env, never on the command line", () => {
    const workflow = readCleanup();
    const lines = codeLines(workflow);
    const withSecret = lines.filter((line) => line.includes("secrets."));
    expect(withSecret.length).toBeGreaterThan(0);
    for (const line of withSecret) {
      // `NAVN: ${{ secrets.X }}` eller `NAVN: ${{ secrets.X != '' }}` under env
      expect(line, line).toMatch(
        /^\s*[A-Z][A-Z0-9_]*:\s*\$\{\{[^}]*secrets\.[A-Z0-9_]+[^}]*\}\}\s*$/,
      );
    }
    for (const block of runBlocks(workflow)) {
      expect(block).not.toContain("${{ secrets.");
      expect(block).not.toContain("secrets.");
    }
  });

  it("C4 no set -x and no verbose curl", () => {
    const workflow = readCleanup();
    const code = codeLines(workflow).join("\n");
    expect(code).not.toMatch(/set\s+-[a-wyz]*x/);
    expect(code).not.toMatch(/bash\s+-x/);
    const commands = curlCommands(workflow);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).not.toMatch(
        /\s(-v|-i|-I|-D|--verbose|--include|--head|--dump-header|--trace\S*)(\s|=|$)/,
      );
    }
  });

  it("C4 curl --fail --silent --show-error -X POST with the secret from the environment", () => {
    const workflow = readCleanup();
    const commands = curlCommands(workflow);
    const post = commands.filter((command) => /-X\s+POST/.test(command));
    expect(post).toHaveLength(1);
    const command = post[0]!;
    for (const flag of ["--fail", "--silent", "--show-error"]) {
      expect(command, flag).toMatch(new RegExp(`\\s${flag}(\\s|$)`));
    }
    // Headeren kommer fra stdin (printf er innebygd), så hemmeligheten står aldri på
    // kommandolinjen til curl og vises ikke i prosesslisten.
    expect(command).toMatch(
      /printf 'Authorization:\s*Bearer %s\\n' "\$AUTH_CLEANUP_SECRET"\s*\|\s*curl\b/,
    );
    expect(command).toMatch(/\s-H @-\s/);
    expect(command.slice(command.indexOf("curl"))).not.toMatch(/AUTH_CLEANUP_SECRET/);
    expect(command).toContain("/api/intern/rydd-innloggingsdata");
  });

  it("C5 skips without error when secret or url missing", () => {
    const workflow = readCleanup();
    const code = codeLines(workflow).join("\n");
    // Enten en sjekk-jobb som i «Utrulling til Azure» (bare om hemmeligheten finnes) …
    const checkJob =
      new RegExp(`secrets\\.${SECRET_NAME}\\s*!=\\s*''`).test(code) &&
      /if:\s*.*(needs|steps)\.[\w-]+\.outputs\.\w+\s*==\s*'true'/.test(code);
    // … eller en sjekk i skallet som avslutter med 0
    const shellCheck = /-z\s+"\$\{?[A-Z_]*SECRET[A-Z_]*\}?"[\s\S]*?exit\s+0/.test(code);
    expect(checkJob || shellCheck).toBe(true);
    // Adressen: kommer den fra en GitHub-variabel, må også den sjekkes
    for (const match of code.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*\$\{\{\s*vars\.([A-Z0-9_]+)/gm)) {
      const envName = match[1]!;
      const varName = match[2]!;
      const checked =
        new RegExp(`-z\\s+"\\$\\{?${envName}\\}?"`).test(code) ||
        new RegExp(`vars\\.${varName}\\s*!=\\s*''`).test(code) ||
        new RegExp(`vars\\.${varName}\\s*\\|\\|`).test(code);
      expect(checked, `${envName} (vars.${varName}) sjekkes ikke`).toBe(true);
    }
    // En manglende hemmelighet gir ikke feil
    expect(code).not.toMatch(/-z\s+"\$\{?[A-Z_]*SECRET[A-Z_]*\}?"[^\n]*\n[^\n]*exit\s+1/);
  });

  it("C6 same GitHub secret as deploy, no production url", () => {
    const workflow = readCleanup();
    const deploy = read(DEPLOY_WORKFLOW);
    const cleanupSecrets = secretNames(workflow);
    expect(cleanupSecrets).toContain(SECRET_NAME);
    expect(secretNames(deploy)).toContain(SECRET_NAME);
    // Ryddejobben trenger ingen andre hemmeligheter
    expect(cleanupSecrets).toEqual([SECRET_NAME]);
    const code = codeLines(workflow).join("\n");
    const urls = [...code.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    for (const url of urls) {
      expect(url, url).not.toMatch(/prod/i);
      expect(url, url).not.toMatch(/localhost|127\.0\.0\.1/);
    }
    expect(code).not.toMatch(/ezprop-prod|-prod\b|produksjon/i);
    // Testmiljøets adresse (fast variabel), ikke en adresse som kan peke på produksjon
    expect(code).toMatch(/app-ezprop-test|ezprop-test|APP_HOSTNAME|TEST/);
  });
});

describe("hemmeligheten i Bicep og utrullingen (C7)", () => {
  const bicep = read(BICEP);
  const bicepLines = bicep.split("\n");

  function cleanupParam(): string {
    const index = bicepLines.findIndex((line) => /^param\s+\w*[Cc]leanup\w*\s+string\b/.test(line));
    expect(index, "parameter for driftshemmeligheten").toBeGreaterThan(-1);
    const name = bicepLines[index]!.trim().split(/\s+/)[1]!;
    // @secure() rett over (eventuelt etter @description)
    const above = bicepLines.slice(Math.max(0, index - 3), index).join("\n");
    expect(above).toContain("@secure()");
    expect(bicepLines[index]).not.toMatch(/=/);
    return name;
  }

  it("C7 Bicep has a secure parameter", () => {
    expect(cleanupParam()).toMatch(/^authCleanupSecret$/);
  });

  it("C7 Bicep has a conditional key vault secret", () => {
    const param = cleanupParam();
    const start = bicepLines.findIndex(
      (line) =>
        /^resource\s+\w+\s+'Microsoft\.KeyVault\/vaults\/secrets@/.test(line) &&
        bicepLines
          .slice(bicepLines.indexOf(line), bicepLines.indexOf(line) + 8)
          .some((l) => new RegExp(`value:\\s*${param}\\b`).test(l)),
    );
    expect(start, "nøkkelboks-hemmelighet med verdien").toBeGreaterThan(-1);
    expect(bicepLines[start]).toMatch(/=\s*if\s*\(\s*enableKeyVault\s*&&/);
  });

  it("C7 Bicep sets the app setting AUTH_CLEANUP_SECRET like ANTHROPIC_API_KEY", () => {
    const param = cleanupParam();
    const setting = bicepLines.find((line) => line.includes(`name: '${SECRET_NAME}'`));
    expect(setting, "appinnstilling").toBeDefined();
    expect(setting!).toMatch(/enableKeyVault\s*\?\s*'@Microsoft\.KeyVault\(SecretUri=/);
    expect(setting!).toMatch(new RegExp(`:\\s*${param}\\s*\\}`));
    // Ingen utdata med hemmeligheten
    const outputs = bicepLines.filter((line) => /^output\s/.test(line));
    for (const line of outputs) expect(line).not.toContain(param);
  });

  it("C7 deploy-azure.yml passes the parameter from the GitHub secret", () => {
    const param = cleanupParam();
    const deploy = read(DEPLOY_WORKFLOW);
    expect(deploy).toMatch(
      new RegExp(
        `^\\s*${SECRET_NAME}:\\s*\\$\\{\\{\\s*secrets\\.${SECRET_NAME}\\s*\\}\\}\\s*$`,
        "m",
      ),
    );
    expect(deploy).toContain(`"${param}=$${SECRET_NAME}"`);
  });
});

describe(".env.example (C8)", () => {
  it("C8 AUTH_CLEANUP_SECRET is empty with an explanation", () => {
    const lines = read(".env.example").split("\n");
    const index = lines.findIndex((line) => line.startsWith(`${SECRET_NAME}=`));
    expect(index, `${SECRET_NAME}= i .env.example`).toBeGreaterThan(-1);
    expect(lines[index]!.trim()).toBe(`${SECRET_NAME}=`);
    expect(lines[index - 1]!, "forklaring over linjen").toMatch(/^#\s*\S/);
  });
});
