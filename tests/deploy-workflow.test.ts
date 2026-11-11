import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Drift-filene leses som tekst og sjekkes med enkle mønstre (ingen YAML-pakke, ingen Azure-kall).
 * Testplan: docs/funksjoner/fase1-testmiljo-azure-testplan.md, avsnitt 3, og
 * docs/funksjoner/fase0b-nokkelboks-testplan.md, avsnitt 1–3 og 7 (nøkkelboksen, av som standard).
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function secretNames(text: string): string[] {
  return [...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]!))];
}

function varNames(text: string): string[] {
  return [...new Set([...text.matchAll(/vars\.([A-Z0-9_]+)/g)].map((match) => match[1]!))];
}

/** `a` kommer før `b` i teksten (begge må finnes). */
function after(text: string, a: string, b: string): boolean {
  const first = text.indexOf(a);
  const second = text.indexOf(b);
  return first !== -1 && second !== -1 && first < second;
}

/** Linjenumrene (0-basert) der mønsteret slår til. */
function lineIndexes(lines: string[], pattern: RegExp): number[] {
  return lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Hele kommandoen `pnpm db:seed`, ikke `pnpm db:seed:testoppdrag`. */
const SEED_COMMAND = /pnpm db:seed(\s|$)/;
/** Hele kommandoen `pnpm db:seed:testoppdrag`. */
const SEED_TESTOPPDRAG_COMMAND = /pnpm db:seed:testoppdrag(\s|$)/;

/** Ikke-kommentarlinjer (YAML og bash: `#`, Bicep: `//`). */
function isComment(line: string): boolean {
  return /^\s*(#|\/\/)/.test(line);
}

/** Første linje (0-basert) som slår til og ikke er en kommentar, ellers -1. */
function codeLine(lines: string[], pattern: RegExp | string): number {
  return lines.findIndex(
    (line) =>
      !isComment(line) &&
      (typeof pattern === "string" ? line.includes(pattern) : pattern.test(line)),
  );
}

/** Steget i arbeidsflyten som linje `index` hører til (fra «- …:» til neste steg). */
function stepOf(lines: string[], index: number): string[] {
  let start = index;
  while (start > 0 && !/^\s*-\s+[\w-]+:/.test(lines[start]!)) start -= 1;
  const indent = indentOf(lines[start]!);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim() !== "" && indentOf(line) <= indent) break;
    end += 1;
  }
  return lines.slice(start, end);
}

/** Underblokken `key:` i et steg (linjen selv og alle linjer med større innrykk). */
function subBlock(step: string[], key: string): string {
  const start = step.findIndex((line) => new RegExp(`^\\s*(-\\s+)?${key}:`).test(line));
  if (start === -1) return "";
  const indent = indentOf(step[start]!.replace(/-\s+/, "  "));
  const out = [step[start]!];
  for (const line of step.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) <= indent) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Kommandoen på linjen med `marker`, med fortsettelseslinjer (`\`). */
function commandBlock(text: string, marker: string): string {
  const lines = text.split("\n");
  let index = codeLine(lines, marker);
  if (index === -1) return "";
  const out = [lines[index]!];
  while (lines[index]!.trimEnd().endsWith("\\") && index + 1 < lines.length) {
    index += 1;
    out.push(lines[index]!);
  }
  return out.join("\n");
}

/**
 * Det som sendes som --parameters i kommandoen: selve kommandoen pluss bash-listene den bruker
 * (`"${NAVN[@]}"`), både `NAVN=( … )` og `NAVN+=( … )`.
 */
function parameterSources(text: string, command: string): string {
  const lines = text.split("\n");
  const parts = [command];
  for (const match of command.matchAll(/\$\{(\w+)\[@\]\}/g)) {
    const name = match[1]!;
    lines.forEach((line, index) => {
      if (!new RegExp(`^\\s*${name}\\+?=\\(`).test(line)) return;
      let end = index;
      while (end < lines.length && !lines[end]!.includes(")")) end += 1;
      parts.push(lines.slice(index, end + 1).join("\n"));
    });
  }
  return parts.join("\n");
}

interface BicepResource {
  symbol: string;
  type: string;
  start: number;
  lines: string[];
  text: string;
}

/** Alle `resource`-blokker på øverste nivå i Bicep-filen. */
function resourceBlocks(bicep: string): BicepResource[] {
  const lines = bicep.split("\n");
  const out: BicepResource[] = [];
  lines.forEach((line, index) => {
    const match = /^resource\s+(\w+)\s+'([^'@]+)@[^']*'/.exec(line);
    if (!match) return;
    let end = index + 1;
    while (end < lines.length && !/^\}/.test(lines[end]!)) end += 1;
    const block = lines.slice(index, end + 1);
    out.push({
      symbol: match[1]!,
      type: match[2]!,
      start: index,
      lines: block,
      text: block.join("\n"),
    });
  });
  return out;
}

/**
 * Linjen inneholder `needle`, eller verdien er en `var` (ett nivå) som gjør det. Brukes for navn og
 * adresser som kan stå direkte eller via en variabel.
 */
function resolvesTo(bicep: string, line: string, needle: string): boolean {
  if (line.includes(needle)) return true;
  const value = /:\s*([A-Za-z_]\w*)\s*\}?\s*$/.exec(line.trim())?.[1];
  if (!value) return false;
  const definition = bicep.split("\n").find((l) => new RegExp(`^var\\s+${value}\\s*=`).test(l));
  return definition !== undefined && definition.includes(needle);
}

const WORKFLOW_PATH = ".github/workflows/deploy-azure.yml";
const BICEP_PATH = "infra/azure/main.bicep";
const DRIFT_DOC_PATH = "docs/drift/testmiljo-azure.md";

const ALLOWED_SECRETS = [
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "POSTGRES_ADMIN_PASSWORD",
  "BETTER_AUTH_SECRET",
  "MS_GRAPH_TENANT_ID",
  "MS_GRAPH_CLIENT_ID",
  "MS_GRAPH_CLIENT_SECRET",
  "MAIL_FROM",
  // KI-leverandøren (docs/funksjoner/fase2a-ki-leverandor.md Omfang 15). Tom verdi betyr KI av.
  "ANTHROPIC_API_KEY",
];
const REQUIRED_SECRETS = ALLOWED_SECRETS.slice(0, 5);
const ALLOWED_VARS = ["SEED_ADMIN_EMAIL", "APP_HOSTNAME", "ENABLE_KEY_VAULT"];

describe("utrullingsarbeidsflyten (deploy-azure.yml)", () => {
  const workflow = read(WORKFLOW_PATH);
  const lines = workflow.split("\n");

  it("kjører ved push til main og manuelt", () => {
    expect(workflow).toMatch(/^\s*push:/m);
    expect(workflow).toMatch(/branches:\s*\[\s*main\s*\]|branches:\s*\n\s*-\s*main\b/);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    expect(workflow).not.toMatch(/pull_request:/);
  });

  it("ingen to utrullinger samtidig", () => {
    expect(workflow).toMatch(/^\s*concurrency:/m);
  });

  it("rettigheter er minst mulig", () => {
    const firstPermissions = lines.find((line) => /^\s*permissions:/.test(line));
    expect(firstPermissions?.trim()).toBe("permissions: {}");
    expect(workflow.match(/id-token:\s*write/g)).toHaveLength(1);
    expect(after(workflow, "\n  utrulling:", "id-token: write")).toBe(true);
  });

  it("jobben sjekk gir klar, og utrulling kjører bare når klar er true", () => {
    const sjekk = workflow.slice(workflow.indexOf("  sjekk:"), workflow.indexOf("  utrulling:"));
    expect(sjekk).toMatch(/^\s*sjekk:/);
    expect(sjekk).toMatch(/outputs:\s*\n\s*klar:/);
    const utrulling = workflow.slice(workflow.indexOf("  utrulling:"));
    expect(utrulling).toMatch(/needs:\s*(sjekk|\[\s*sjekk\s*\])\s*$/m);
    expect(utrulling).toContain("if: needs.sjekk.outputs.klar == 'true'");
    expect(workflow).toContain("hopper over utrullingen");
  });

  it("sjekk leser bare om AZURE_CLIENT_ID finnes, ikke verdien", () => {
    expect(workflow).toContain("secrets.AZURE_CLIENT_ID != ''");
    const leaking = lines.filter(
      (line) =>
        line.includes("echo") &&
        line.includes("AZURE_CLIENT_ID") &&
        !line.includes("klar") &&
        !line.includes("!= ''"),
    );
    expect(leaking).toEqual([]);
  });

  it("bruker OIDC, ikke lagret Azure-passord", () => {
    expect(workflow).toMatch(/uses:\s*azure\/login@/);
    expect(workflow).toMatch(/client-id:/);
    expect(workflow).toMatch(/tenant-id:/);
    expect(workflow).toMatch(/subscription-id:/);
    expect(workflow).not.toMatch(/creds:/);
    expect(workflow).not.toContain("AZURE_CREDENTIALS");
  });

  it("lager ikke ressursgruppen", () => {
    expect(workflow).not.toMatch(/az\s+group\s+create/);
  });

  it("bruker bare de dokumenterte navnene på secrets og variabler", () => {
    const secrets = secretNames(workflow);
    const vars = varNames(workflow);
    expect(secrets.filter((name) => !ALLOWED_SECRETS.includes(name))).toEqual([]);
    expect(vars.filter((name) => !ALLOWED_VARS.includes(name))).toEqual([]);
    for (const name of REQUIRED_SECRETS) expect(secrets).toContain(name);
    for (const name of ALLOWED_VARS) expect(vars).toContain(name);
  });

  it("bygget bruker de oppdiktede verdiene fra ci.yml, ikke ekte secrets", () => {
    const ci = read(".github/workflows/ci.yml");
    const plainSecret = (text: string) =>
      text
        .split("\n")
        .filter((line) => /^\s*BETTER_AUTH_SECRET:/.test(line) && !line.includes("${{"))
        .map((line) => line.split(":").slice(1).join(":").trim());
    const ciValues = plainSecret(ci);
    const workflowValues = plainSecret(workflow);
    expect(ciValues).toHaveLength(1);
    expect(workflowValues.length).toBeGreaterThan(0);
    for (const value of workflowValues) expect(value).toBe(ciValues[0]);
    expect(workflow).not.toContain("DEV_MAILBOX");
    expect(workflow).toMatch(/BETTER_AUTH_URL:\s*http:\/\/localhost:3000/);
  });

  it("ingen hemmeligheter som verdier", () => {
    const pattern =
      /(POSTGRES_ADMIN_PASSWORD|MS_GRAPH_CLIENT_SECRET|ANTHROPIC_API_KEY|AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID)\s*:\s*[^$\s]/;
    expect(lines.filter((line) => pattern.test(line))).toEqual([]);
  });

  it("Bicep valideres før den rulles ut, uten hemmelige utskrifter", () => {
    expect(after(workflow, "az deployment group validate", "az deployment group create")).toBe(
      true,
    );
    // Blokken med create går til neste tomme linje eller neste steg.
    const start = workflow.indexOf("az deployment group create");
    const rest = workflow.slice(start);
    const end = rest.search(/\n\s*\n|\n\s*- name:/);
    const block = end === -1 ? rest : rest.slice(0, end);
    expect(block).toMatch(/--output none|--query/);
  });

  it("DATABASE_URL maskeres før bruk", () => {
    expect(workflow).toContain("::add-mask::");
    expect(after(workflow, "::add-mask::", "pnpm db:migrate")).toBe(true);
  });

  it("migrering og seed kjører fra arbeidsflyten med riktig miljø", () => {
    expect(workflow).toContain("pnpm db:migrate");
    expect(workflow).toMatch(new RegExp(SEED_COMMAND.source, "m"));
    const migrateLine = lines.findIndex((line) => line.includes("pnpm db:migrate"));
    const before = lines.slice(Math.max(0, migrateLine - 15), migrateLine).join("\n");
    const envBlock = before.slice(before.lastIndexOf("env:"));
    expect(before).toContain("env:");
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "SEED_ADMIN_EMAIL"]) {
      expect(envBlock).toContain(`${name}:`);
    }
    expect(workflow).toContain("pnpm install");
    expect(workflow).not.toContain("--prod");
  });

  it("brannmurregelen for kjøreren fjernes alltid", () => {
    const createLine = lines.findIndex(
      (line) => line.includes("firewall-rule create") && line.includes("github-runner"),
    );
    const deleteLine = lines.findIndex(
      (line) => line.includes("firewall-rule delete") && line.includes("github-runner"),
    );
    const migrateLine = lines.findIndex((line) => line.includes("pnpm db:migrate"));
    const seedLine = codeLine(lines, SEED_COMMAND);
    expect(seedLine).toBeGreaterThan(-1);
    expect(createLine).toBeGreaterThan(-1);
    expect(deleteLine).toBeGreaterThan(-1);
    expect(createLine).toBeLessThan(migrateLine);
    expect(deleteLine).toBeGreaterThan(seedLine);
    const near = lines.slice(Math.max(0, deleteLine - 3), deleteLine + 4).join("\n");
    expect(near).toMatch(/if:\s*always\(\)/);
  });

  it("setter APP_VERSION til kort commit-id og sjekker /api/helse", () => {
    expect(workflow).toContain("APP_VERSION");
    expect(workflow).toMatch(
      /GITHUB_SHA::7|github\.sha[^\n]*(substr|cut -c1-7)|git rev-parse --short/,
    );
    const deploy = workflow.indexOf("webapps-deploy");
    expect(deploy).toBeGreaterThan(-1);
    const afterDeploy = workflow.slice(deploy);
    expect(afterDeploy).toContain("/api/helse");
    expect(afterDeploy).toContain("versjon");
    expect(afterDeploy).toMatch(/grep|jq/);
    expect(afterDeploy).toContain("exit 1");
  });

  it("zip lages fra innsiden av standalone", () => {
    expect(workflow).toContain(".next/standalone/.next/static");
    expect(workflow).toContain(".next/standalone/public");
    expect(workflow).toMatch(/cd \.next\/standalone|working-directory:\s*\.next\/standalone/);
    const zipLine = lines.findIndex((line) => /^\s*zip\s/.test(line));
    const standaloneLine = lines.findIndex((line) =>
      /cd \.next\/standalone|working-directory:\s*\.next\/standalone/.test(line),
    );
    expect(zipLine).toBeGreaterThan(-1);
    expect(standaloneLine).toBeGreaterThan(-1);
    // working-directory står i steget før run:, cd står i run-blokken; begge kommer før zip.
    expect(standaloneLine).toBeLessThan(zipLine);
  });
});

describe("infrastruktur (main.bicep)", () => {
  const bicep = read(BICEP_PATH);
  const lines = bicep.split("\n");

  it("ligger i Sweden Central", () => {
    expect(bicep).toContain("param location string = 'swedencentral'");
  });

  it("alle passord og hemmeligheter er @secure() og uten standardverdi", () => {
    const secretParams = lineIndexes(lines, /^\s*param\s+\w*(password|secret)\w*\s/i);
    const names = secretParams.map((index) => lines[index]!.trim().split(/\s+/)[1]);
    for (const name of ["postgresAdminPassword", "betterAuthSecret", "msGraphClientSecret"]) {
      expect(names).toContain(name);
    }
    const anthropic = lineIndexes(lines, /^\s*param\s+anthropicApiKey\s/);
    expect(anthropic).toHaveLength(1);
    expect(lines[anthropic[0]! - 1]?.trim()).toBe("@secure()");
    expect(lines[anthropic[0]!], "KI-nøkkelen har standardverdi").not.toContain("=");
    for (const index of secretParams) {
      const line = lines[index]!;
      expect(lines[index - 1]?.trim(), line).toBe("@secure()");
      expect(line, "hemmelig parameter har standardverdi").not.toContain("=");
    }
  });

  it("ingen hemmelige utdata", () => {
    const outputs = lines.filter((line) => /^\s*output\b/.test(line));
    expect(outputs.length).toBeGreaterThan(0);
    for (const line of outputs) {
      expect(line).not.toMatch(/password|secret|DATABASE_URL|URI|connectionString/i);
    }
  });

  it("ingen hostname-binding eller sertifikat", () => {
    expect(bicep).not.toContain("hostNameBindings");
    expect(bicep).not.toContain("Microsoft.Web/certificates");
  });

  it("appen er bare https, TLS 1.2, med helsesjekk, alltid på", () => {
    expect(bicep).toContain("httpsOnly: true");
    expect(bicep).toContain("minTlsVersion: '1.2'");
    expect(bicep).toContain("healthCheckPath: '/api/helse'");
    expect(bicep).toContain("alwaysOn: true");
    expect(bicep).toMatch(/linuxFxVersion:\s*'NODE\|22/);
    expect(bicep).toMatch(/appCommandLine:\s*'[^']*node server\.js/);
  });

  it("ingen bygging på serveren", () => {
    expect(bicep).toMatch(/SCM_DO_BUILD_DURING_DEPLOYMENT'?,?\s*value:\s*'false'/);
  });

  it("databasen er PostgreSQL 16 i samme region uten geo-kopi, og krever sertifikatsjekk", () => {
    const postgres = bicep.slice(bicep.indexOf("Microsoft.DBforPostgreSQL/flexibleServers@"));
    expect(postgres).toContain("version: '16'");
    expect(postgres).toContain("location: location");
    expect(postgres).toContain("geoRedundantBackup: 'Disabled'");
    expect(bicep).toContain("sslmode=verify-full");
    expect(bicep).not.toContain("sslmode=require");
    expect(bicep).toMatch(/uriComponent\(\s*postgresAdminPassword\s*\)/);
  });

  it("appinnstillingene er riktige, og DEV_MAILBOX og PORT settes aldri", () => {
    expect(bicep).toMatch(/'NODE_ENV',\s*value:\s*'production'/);
    for (const name of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "SEED_ADMIN_EMAIL",
      "APP_VERSION",
    ]) {
      expect(bicep).toContain(`'${name}'`);
    }
    const infraFiles = readdirSync(join(process.cwd(), "infra/azure"));
    for (const file of infraFiles) {
      const text = read(`infra/azure/${file}`);
      expect(text, file).not.toContain("DEV_MAILBOX");
      expect(text, file).not.toContain("WEBSITES_PORT");
      expect(text, file).not.toMatch(/\bPORT\b/);
    }
  });

  it("BETTER_AUTH_URL følger appHostname", () => {
    const settingLine = lines.find((line) => line.includes("'BETTER_AUTH_URL'"));
    expect(settingLine).toBeDefined();
    let expressionLine = lines.findIndex((line) => line === settingLine);
    if (!settingLine!.includes("appHostname")) {
      const variable = /value:\s*(\w+)/.exec(settingLine!)?.[1];
      expect(variable).toBeDefined();
      expressionLine = lines.findIndex((line) =>
        new RegExp(`^\\s*var\\s+${variable}\\s*=`).test(line),
      );
    }
    expect(expressionLine).toBeGreaterThan(-1);
    expect(lines[expressionLine]).toContain("appHostname");
    const near = lines.slice(Math.max(0, expressionLine - 3), expressionLine + 4).join("\n");
    expect(near).toContain("azurewebsites.net");
  });

  it("ressursnavn bruker environmentName", () => {
    expect(bicep).not.toContain("ezprop-test");
    // kvName: nøkkelboksen (docs/funksjoner/fase0b-nokkelboks-testplan.md, punkt 5 og test 1.7).
    for (const name of ["planName", "appName", "postgresServerName", "kvName"]) {
      expect(bicep).toMatch(new RegExp(`var\\s+${name}\\s*=\\s*'[^']*\\$\\{environmentName\\}`));
    }
    // Synktjenestene (Container Apps) er fjernet sammen med PowerSync og ElectricSQL (ADR 0004).
    expect(resourceBlocks(bicep).filter((r) => r.type.startsWith("Microsoft.App/"))).toEqual([]);
  });

  it("ingen verdier for hemmeligheter", () => {
    const pattern = /(password|secret)\w*\s*:\s*'[^']{8,}'/i;
    expect(lines.filter((line) => pattern.test(line))).toEqual([]);
  });
});

describe("dokumentasjon for testmiljøet", () => {
  it("driftsdokumentet nevner alle secrets og variabler arbeidsflyten bruker", () => {
    expect(existsSync(join(process.cwd(), DRIFT_DOC_PATH)), DRIFT_DOC_PATH).toBe(true);
    const doc = read(DRIFT_DOC_PATH);
    const workflow = read(WORKFLOW_PATH);
    for (const name of [...secretNames(workflow), ...varNames(workflow)]) {
      expect(doc, name).toContain(name);
    }
  });

  it("driftsdokumentet har stegene, kostnad og sletting", () => {
    expect(existsSync(join(process.cwd(), DRIFT_DOC_PATH)), DRIFT_DOC_PATH).toBe(true);
    const doc = read(DRIFT_DOC_PATH);
    for (const text of [
      "rg-ezprop-test",
      "federated",
      "repo:Byggcon-sl/EzProp:ref:refs/heads/main",
      "Contributor",
      "rand -hex 24",
      "rand -base64 32",
      "Legg til på Hjem-skjerm",
      "asuid",
      "APP_HOSTNAME",
      "kr",
      "az group delete",
      "Minimum før ekte data",
    ]) {
      expect(doc, text).toContain(text);
    }
    expect(doc).toMatch(/Log stream|log tail/);
    // Fase 0b: Graph-adapteren er bygget, så dokumentet skal forklare rettigheten og policyen.
    expect(doc).toContain("Mail.Send");
    expect(doc).toContain("New-ApplicationAccessPolicy");
  });

  it("utviklingsmiljø-dokumentet lenker til driftsdokumentet", () => {
    expect(read("docs/10-utviklingsmiljo.md")).toContain("docs/drift/testmiljo-azure.md");
  });

  it("ADR 0002 finnes med begge avveiningene", () => {
    const adr = read("docs/adr/0002-testmiljo-azure.md");
    expect(adr).toContain("Azure-tjenester");
    expect(adr).toContain("administrator");
    expect(read("docs/06-arkitektur.md")).toContain("ADR 0002");
  });
});

describe("Bicep i CI (ci.yml)", () => {
  const ci = read(".github/workflows/ci.yml");

  it("CI bygger og linter Bicep uten innlogging", () => {
    expect(ci).toMatch(/az bicep build[^\n]*infra\/azure\/main\.bicep/);
    expect(ci).toMatch(/az bicep lint[^\n]*infra\/azure\/main\.bicep/);
    expect(ci).not.toMatch(/azure\/login/);
    // Jobben med Bicep bruker ingen secrets.
    const ciLines = ci.split("\n");
    const buildLine = ciLines.findIndex((line) => line.includes("az bicep build"));
    let jobStart = buildLine;
    while (jobStart > 0 && !/^ {2}[\w-]+:\s*$/.test(ciLines[jobStart]!)) jobStart -= 1;
    let jobEnd = buildLine + 1;
    while (jobEnd < ciLines.length && !/^ {2}[\w-]+:\s*$/.test(ciLines[jobEnd]!)) jobEnd += 1;
    expect(ciLines.slice(jobStart, jobEnd).join("\n")).not.toContain("secrets.");
  });

  it("CI krever enableKeyVault på alle Key Vault-ressurser i den bygde malen", () => {
    // Testplan nøkkelboks 3.1 (A9). Samme jobb-avgrensning som testen over.
    const ciLines = ci.split("\n");
    const buildLine = ciLines.findIndex((line) => line.includes("az bicep build"));
    expect(buildLine).toBeGreaterThan(-1);
    let jobStart = buildLine;
    while (jobStart > 0 && !/^ {2}[\w-]+:\s*$/.test(ciLines[jobStart]!)) jobStart -= 1;
    let jobEnd = buildLine + 1;
    while (jobEnd < ciLines.length && !/^ {2}[\w-]+:\s*$/.test(ciLines[jobEnd]!)) jobEnd += 1;
    const job = ciLines.slice(jobStart, jobEnd).join("\n");
    expect(job).toMatch(/\bjq\b/);
    expect(job).toContain("Microsoft.KeyVault/");
    // I jq-uttrykket i YAML skrives anførselstegnene ofte som '"'"'; begge former godtas.
    expect(job).toMatch(/parameters\((?:'|'"'"')enableKeyVault(?:'|'"'"')\)/);
    // Tellesjekk: minst fem Key Vault-ressurser, så en tom select ikke blir grønn.
    expect(job).toMatch(/-lt\s+5\b|-ge\s+5\b|<\s*5\b|>=\s*5\b/);
    expect(job).not.toContain("secrets.");
  });
});

describe("testoppdragene i CI og utrullingen (fase 2a)", () => {
  // Testplan: docs/funksjoner/fase2a-testoppdrag-testplan.md, avsnitt 3.
  it("hjelperen skiller pnpm db:seed fra pnpm db:seed:testoppdrag", () => {
    expect(SEED_COMMAND.test("pnpm db:seed")).toBe(true);
    expect(SEED_COMMAND.test("      - run: pnpm db:seed")).toBe(true);
    expect(SEED_COMMAND.test("pnpm db:seed && echo ok")).toBe(true);
    expect(SEED_COMMAND.test("pnpm db:seed:testoppdrag")).toBe(false);
    expect(SEED_TESTOPPDRAG_COMMAND.test("pnpm db:seed:testoppdrag")).toBe(true);
    expect(SEED_TESTOPPDRAG_COMMAND.test("pnpm db:seed")).toBe(false);
  });

  it("deploy-azure.yml legger inn testoppdragene etter seed og før brannmuren lukkes", () => {
    const lines = read(WORKFLOW_PATH).split("\n");
    const seed = codeLine(lines, SEED_COMMAND);
    const testoppdrag = codeLine(lines, SEED_TESTOPPDRAG_COMMAND);
    const close = lines.findIndex(
      (line) => line.includes("firewall-rule delete") && line.includes("github-runner"),
    );
    expect(seed).toBeGreaterThan(-1);
    expect(testoppdrag).toBeGreaterThan(seed);
    expect(close).toBeGreaterThan(testoppdrag);
    // Samme steg som seed, så det får samme miljø (DATABASE_URL osv.).
    expect(stepOf(lines, testoppdrag)).toEqual(stepOf(lines, seed));
    expect(lineIndexes(lines, SEED_TESTOPPDRAG_COMMAND)).toHaveLength(1);
  });

  it("ci.yml legger inn testoppdragene etter seed og før e2e", () => {
    const lines = read(".github/workflows/ci.yml").split("\n");
    const seed = codeLine(lines, SEED_COMMAND);
    const testoppdrag = codeLine(lines, SEED_TESTOPPDRAG_COMMAND);
    const e2e = codeLine(lines, "pnpm test:e2e");
    expect(seed).toBeGreaterThan(-1);
    expect(testoppdrag).toBeGreaterThan(seed);
    expect(e2e).toBeGreaterThan(testoppdrag);
    // Samme jobb som seed, så det får samme miljø.
    const jobOf = (index: number) =>
      lines
        .slice(0, index + 1)
        .reverse()
        .find((line) => /^ {2}[\w-]+:\s*$/.test(line));
    expect(jobOf(testoppdrag)).toBe(jobOf(seed));
    expect(jobOf(e2e)).toBe(jobOf(seed));
  });

  it("ingen produksjonsflyt kjører testoppdragene", () => {
    const dir = join(process.cwd(), ".github/workflows");
    const withStep = readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .filter((name) => SEED_TESTOPPDRAG_COMMAND.test(read(`.github/workflows/${name}`)))
      .sort();
    expect(withStep).toEqual(["ci.yml", "deploy-azure.yml"]);
    // Utrullingen går bare til testmiljøet.
    const workflow = read(WORKFLOW_PATH);
    expect(workflow).toMatch(/^\s*ENVIRONMENT_NAME:\s*test\s*$/m);
    expect(workflow).toMatch(/^\s*RESOURCE_GROUP:\s*rg-[\w-]*-test\s*$/m);
    expect(workflow).not.toMatch(/\bprod(uction|uksjon)?\b/i);
  });
});

function braceBalance(text: string): number {
  return (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);
}

/** Linjene i alle Container Apps-ressursene (ingen igjen etter ADR 0004; holdes for sikkerhets skyld). */
function containerLineIndexes(bicep: string): Set<number> {
  return new Set(
    resourceBlocks(bicep)
      .filter((r) => r.type.startsWith("Microsoft.App/"))
      .flatMap((r) => r.lines.map((_, i) => r.start + i)),
  );
}

/** `var`-definisjonen `name`: fra `var name =` til neste tomme linje, `var`, `resource`, `param` eller `output`. */
function varDefinition(bicep: string, name: string): string | undefined {
  const lines = bicep.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^var\\s+${name}\\s*=`).test(l));
  if (start === -1) return undefined;
  const out = [lines[start]!.replace(new RegExp(`^var\\s+${name}\\s*=\\s*`), "")];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^(var|resource|param|output|@)\b/.test(line)) break;
    if (isComment(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * Verdien til appinnstillingen `name` som tekst: uttrykket etter `value:` (over flere linjer til
 * klammene går opp), eller `var`-definisjonen det peker på (ett nivå).
 */
function appSettingExpression(bicep: string, name: string): string | undefined {
  const lines = bicep.split("\n");
  const inContainers = containerLineIndexes(bicep);
  const index = lines.findIndex(
    (line, i) => !inContainers.has(i) && !isComment(line) && line.includes(`name: '${name}'`),
  );
  if (index === -1) return undefined;
  // Objektet starter på samme linje (`{ name: …`) eller på linjen før (`{` alene, flere linjer).
  let begin = index;
  if (!/\{\s*name:/.test(lines[index]!)) {
    begin -= 1;
    while (begin > 0 && isComment(lines[begin]!)) begin -= 1;
  }
  const entry = lines.slice(begin, index + 1).filter((line) => !isComment(line));
  let end = index;
  while (braceBalance(entry.join("\n")) > 0 && end + 1 < lines.length) {
    end += 1;
    if (!isComment(lines[end]!)) entry.push(lines[end]!);
  }
  const text = entry.join("\n");
  const match = /value:\s*([\s\S]*?)\s*\}\s*$/.exec(text);
  const value = (match?.[1] ?? text.slice(text.indexOf("value:") + 6)).trim();
  if (/^[A-Za-z_]\w*$/.test(value)) {
    const definition = varDefinition(bicep, value);
    if (definition !== undefined) return definition;
  }
  return value;
}

/** For en `output`-linje: uttrykket etter `=` og `var`-definisjonen identifikatoren peker på. */
function outputValue(bicep: string, line: string): string {
  const expression = line.slice(line.indexOf("=") + 1).trim();
  const identifier = /^([A-Za-z_]\w*)/.exec(expression)?.[1];
  const definition = identifier ? varDefinition(bicep, identifier) : undefined;
  return [expression, definition ?? ""].join("\n");
}

/** Navnene på alle `@secure()`-parametere i filen. */
function secureParamNames(lines: string[]): string[] {
  return lines.flatMap((line, index) => {
    if (lines[index - 1]?.trim() !== "@secure()") return [];
    const match = /^\s*param\s+(\w+)\s/.exec(line);
    return match ? [match[1]!] : [];
  });
}

/** Alle filer under `dir` (rekursivt) som slutter på en av `extensions`. */
function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
  });
}

const KEY_VAULT_SETTINGS: Record<string, string> = {
  DATABASE_URL: "databaseUrl",
  BETTER_AUTH_SECRET: "betterAuthSecret",
  MS_GRAPH_CLIENT_SECRET: "msGraphClientSecret",
  ANTHROPIC_API_KEY: "anthropicApiKey",
};

const KEY_VAULT_SECRETS: Record<string, string> = {
  "database-url": "databaseUrl",
  "better-auth-secret": "betterAuthSecret",
  "ms-graph-client-secret": "msGraphClientSecret",
  "anthropic-api-key": "anthropicApiKey",
};

const NOT_THROUGH_KEY_VAULT = [
  "MS_GRAPH_TENANT_ID",
  "MS_GRAPH_CLIENT_ID",
  "MAIL_FROM",
  "BETTER_AUTH_URL",
  "SEED_ADMIN_EMAIL",
  "APP_VERSION",
];

describe("nøkkelboksen i infrastrukturen (main.bicep)", () => {
  const bicep = read(BICEP_PATH);
  const lines = bicep.split("\n");
  const resources = resourceBlocks(bicep);
  const kv = resources.filter((r) => r.type.startsWith("Microsoft.KeyVault/"));
  const vault = kv.find((r) => r.type === "Microsoft.KeyVault/vaults");
  const policy = kv.find((r) => r.type === "Microsoft.KeyVault/vaults/accessPolicies");
  const secrets = kv.filter((r) => r.type === "Microsoft.KeyVault/vaults/secrets");

  function secretBlock(name: string) {
    return secrets.find((r) => r.lines.some((line) => line.trim() === `name: '${name}'`));
  }

  it("1. bryteren finnes og er av som standard", () => {
    expect(bicep).toContain("param enableKeyVault bool = false");
    expect(bicep.match(/^\s*param\s+enableKeyVault\b/gm) ?? []).toHaveLength(1);
  });

  it("2. alle Key Vault-ressurser har betingelsen enableKeyVault", () => {
    expect(kv).toHaveLength(6);
    expect(kv.filter((r) => r.type === "Microsoft.KeyVault/vaults")).toHaveLength(1);
    expect(kv.filter((r) => r.type === "Microsoft.KeyVault/vaults/accessPolicies")).toHaveLength(1);
    expect(secrets).toHaveLength(4);
    for (const resource of kv) {
      expect(resource.lines[0], resource.symbol).toMatch(/=\s*if\s*\(\s*enableKeyVault\b/);
    }
    for (const resource of [policy, ...secrets]) {
      expect(resource?.text, resource?.symbol).toMatch(/^\s*parent:\s*\w+/m);
    }
  });

  it("3. appen har systemtildelt identitet, ubetinget", () => {
    const app = resources.find((r) => r.type === "Microsoft.Web/sites");
    expect(app).toBeDefined();
    expect(app!.lines[0]).not.toMatch(/=\s*if\s*\(/);
    expect(app!.text).toMatch(/identity:\s*\{[^}]*type:\s*'SystemAssigned'/);
  });

  it("4. policyen gir bare get", () => {
    expect(policy, "Microsoft.KeyVault/vaults/accessPolicies").toBeDefined();
    const text = policy!.text;
    expect(text).toMatch(/^\s*name:\s*'add'\s*$/m);
    expect(text).toMatch(/objectId:\s*app\.identity\.principalId\b/);
    expect(text).toMatch(/tenantId:\s*subscription\(\)\.tenantId/);
    expect(text).toMatch(/permissions:/);
    expect(text).toMatch(/secrets:\s*\[\s*'get'\s*\]/);
    for (const forbidden of [
      "keys:",
      "certificates:",
      "storage:",
      "'list'",
      "'set'",
      "'delete'",
      "'purge'",
      "'all'",
      "'recover'",
      "'backup'",
      "'restore'",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(bicep).not.toContain("Microsoft.Authorization/roleAssignments");
    expect(bicep).not.toContain("roleDefinitionId");
    const principalLines = lineIndexes(lines, /principalId/);
    expect(principalLines.length).toBeGreaterThan(0);
    const policyEnd = policy!.start + policy!.lines.length - 1;
    for (const index of principalLines) {
      expect(
        index >= policy!.start && index <= policyEnd,
        `principalId utenfor policyen på linje ${index + 1}`,
      ).toBe(true);
    }
  });

  it("5. de fire hemmelighetene går gjennom boksen når bryteren er på", () => {
    for (const name of Object.keys(KEY_VAULT_SETTINGS)) {
      const expression = appSettingExpression(bicep, name);
      expect(expression, name).toBeDefined();
      expect(expression, name).toContain("enableKeyVault");
      expect(expression, name).toContain("@Microsoft.KeyVault(SecretUri=");
      expect(expression, name).toContain(".properties.secretUri");
    }
    expect(bicep).not.toContain("secretUriWithVersion");
    for (const name of NOT_THROUGH_KEY_VAULT) {
      const expression = appSettingExpression(bicep, name);
      expect(expression, name).toBeDefined();
      expect(expression, name).not.toContain("enableKeyVault");
      expect(expression, name).not.toContain("@Microsoft.KeyVault(");
    }
  });

  it("6. bryteren av gir samme verdi som før", () => {
    for (const [name, previous] of Object.entries(KEY_VAULT_SETTINGS)) {
      const expression = appSettingExpression(bicep, name);
      expect(expression, name).toBeDefined();
      expect(expression, name).toMatch(
        new RegExp(`enableKeyVault\\s*\\?[\\s\\S]*:\\s*${previous}\\s*\\}?\\s*$`),
      );
    }
    // Dagens tilkoblingsstreng er uendret (sertifikatsjekk, se testen for databasen over).
    expect(bicep).toMatch(/^var databaseUrl = 'postgres:\/\/[^\n]*sslmode=verify-full'$/m);
  });

  it("7. boksen er låst riktig og uten nettverk", () => {
    expect(vault, "Microsoft.KeyVault/vaults").toBeDefined();
    const text = vault!.text;
    for (const expected of [
      "enableSoftDelete: true",
      "enablePurgeProtection: true",
      "enableRbacAuthorization: false",
      "name: 'standard'",
      "family: 'A'",
      "tenantId: subscription().tenantId",
      "accessPolicies: []",
      "location: location",
    ]) {
      expect(text, expected).toContain(expected);
    }
    const nameLine = vault!.lines.find((line) => /^\s{2}name:/.test(line));
    expect(nameLine, "navnet på boksen").toBeDefined();
    expect(resolvesTo(bicep, nameLine!, "${environmentName}")).toBe(true);
    expect(resolvesTo(bicep, nameLine!, "'kv-ezprop-")).toBe(true);
    expect(bicep).toMatch(/^var kvName = 'kv-ezprop-\$\{environmentName\}'/m);
    for (const forbidden of [
      "privateEndpoint",
      "privateLink",
      "'Deny'",
      "enabledForDeployment: true",
    ]) {
      expect(bicep, forbidden).not.toContain(forbidden);
    }
  });

  it("8. ingen ny utdata og ingen hemmelig utdata", () => {
    const outputs = lines.filter((line) => /^\s*output\b/.test(line));
    expect(outputs.map((line) => /^\s*output\s+(\w+)/.exec(line)?.[1])).toEqual([
      "postgresServerName",
      "postgresHost",
      "appName",
      "appUrl",
    ]);
    const secureNames = secureParamNames(lines);
    expect(secureNames).toContain("betterAuthSecret");
    for (const line of outputs) {
      const value = outputValue(bicep, line);
      for (const forbidden of [
        "vault.azure.net",
        "secretUri",
        "identity",
        "principalId",
        ...secureNames,
      ]) {
        expect(value, `${line}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("9. navnene i boksen er små bokstaver, tall og bindestrek", () => {
    const names = secrets.map((r) => {
      const nameLine = r.lines.find((line) => /^\s{2}name:/.test(line));
      expect(nameLine, r.symbol).toMatch(/^\s*name:\s*'[a-z0-9-]+'$/);
      return /'([^']*)'/.exec(nameLine ?? "")?.[1];
    });
    expect(names.sort()).toEqual(Object.keys(KEY_VAULT_SECRETS).sort());
    for (const [name, value] of Object.entries(KEY_VAULT_SECRETS)) {
      const block = secretBlock(name);
      expect(block, name).toBeDefined();
      expect(block!.text, name).toMatch(/properties:/);
      expect(block!.text, name).toMatch(new RegExp(`^\\s*value:\\s*${value}\\s*$`, "m"));
    }
  });

  it("10. ingen hemmelighet i boksen uten bryteren og e-post", () => {
    const graph = secretBlock("ms-graph-client-secret");
    expect(graph).toBeDefined();
    expect(graph!.lines[0]).toMatch(/=\s*if\s*\(\s*enableKeyVault\s*&&\s*emailConfigured\s*\)/);
    const ai = secretBlock("anthropic-api-key");
    expect(ai).toBeDefined();
    expect(ai!.lines[0]).toMatch(/=\s*if\s*\(\s*enableKeyVault\s*&&\s*aiConfigured\s*\)/);
    for (const name of ["database-url", "better-auth-secret"]) {
      const block = secretBlock(name);
      expect(block, name).toBeDefined();
      expect(block!.lines[0], name).toMatch(/=\s*if\s*\(\s*enableKeyVault\s*\)/);
      expect(block!.lines[0], name).not.toContain("emailConfigured");
    }
  });

  it("10b. KI-nøkkelen havner i boksen bare med bryteren og når den ikke er tom (tom = KI av)", () => {
    const anthropic = secretBlock("anthropic-api-key");
    expect(anthropic, "anthropic-api-key").toBeDefined();
    const condition = /=\s*if\s*\((.*)\)\s*\{?\s*$/.exec(anthropic!.lines[0]!)?.[1] ?? "";
    expect(condition).toMatch(/\benableKeyVault\b/);
    expect(condition).not.toContain("emailConfigured");
    // Tom verdi er lov: enten rett i betingelsen, eller via en var med !empty(anthropicApiKey)
    const expanded = condition.replace(/\b([A-Za-z_]\w*)\b/g, (word) => {
      const definition = new RegExp(`^var\\s+${word}\\s*=\\s*(.*)$`, "m").exec(bicep)?.[1];
      return definition ? `(${definition})` : word;
    });
    expect(expanded).toMatch(/!\s*empty\(\s*anthropicApiKey\s*\)/);
  });

  it("10c. anthropicApiKey er @secure() uten standardverdi, og appen får ANTHROPIC_API_KEY", () => {
    expect(secureParamNames(lines)).toContain("anthropicApiKey");
    const param = lines.find((line) => /^\s*param\s+anthropicApiKey\s/.test(line));
    expect(param, "param anthropicApiKey").toBeDefined();
    expect(param!).not.toContain("=");
    expect(appSettingExpression(bicep, "ANTHROPIC_API_KEY")).toBeDefined();
  });

  it("11. ingen egen kodevei og ingen ny avhengighet", () => {
    const pkg = read("package.json");
    expect(pkg).not.toContain("@azure/keyvault-secrets");
    expect(pkg).not.toContain("@azure/identity");
    for (const file of filesUnder("src", [".ts", ".tsx"])) {
      const text = read(file);
      expect(text, file).not.toContain("SECRETS_DRIVER");
      expect(text, file).not.toMatch(/^\s*import[^;]*keyvault/im);
      expect(text, file).not.toMatch(/(from|import|require)\s*\(?\s*["'][^"']*keyvault/i);
      if (!/\.test\.tsx?$/.test(file)) expect(text, file).not.toContain("vault.azure.net");
    }
  });
});

describe("nøkkelboksen i utrullingen (deploy-azure.yml)", () => {
  const workflow = read(WORKFLOW_PATH);
  const lines = workflow.split("\n");

  it("1. bryteren er på bare når ENABLE_KEY_VAULT er nøyaktig true", () => {
    const code = lines.filter((line) => !isComment(line));
    const mentions = code.filter((line) => line.includes("ENABLE_KEY_VAULT"));
    expect(mentions.length).toBeGreaterThan(0);
    const exact = code.filter(
      (line) =>
        /vars\.ENABLE_KEY_VAULT\s*==\s*'true'/.test(line) ||
        /ENABLE_KEY_VAULT[^\n]*?\s(==?)\s*["']true["']/.test(line),
    );
    expect(exact.length).toBeGreaterThan(0);
    for (const line of mentions) {
      expect(line).not.toMatch(/ENABLE_KEY_VAULT[^\n]*!=/);
      expect(line).not.toMatch(/!=[^\n]*ENABLE_KEY_VAULT/);
      expect(line).not.toMatch(/contains\([^)]*ENABLE_KEY_VAULT/i);
      expect(line).not.toMatch(/-n\s+"?\$\{?ENABLE_KEY_VAULT/);
    }
    for (const marker of ["az deployment group validate", "az deployment group create"]) {
      const command = commandBlock(workflow, marker);
      expect(command, marker).not.toBe("");
      expect(parameterSources(workflow, command), marker).toMatch(/enableKeyVault=/);
    }
    // Bryteren kommer inn via env i steget «Infrastruktur (Bicep)», ikke rett i run.
    const stepLine = codeLine(lines, /^\s*-\s+name:\s*Infrastruktur \(Bicep\)/);
    expect(stepLine, "steget Infrastruktur (Bicep)").toBeGreaterThan(-1);
    const step = stepOf(lines, stepLine);
    expect(subBlock(step, "env")).toMatch(/^\s*ENABLE_KEY_VAULT:/m);
    expect(subBlock(step, "run")).not.toMatch(/\$\{\{[^}]*ENABLE_KEY_VAULT/);
  });

  it("2. ingen nye hemmeligheter og ingen nye utskrifter", () => {
    expect(secretNames(workflow).sort()).toEqual([...ALLOWED_SECRETS].sort());
    const echoes = lines.filter((line) => !isComment(line) && /\becho\b/.test(line));
    for (const line of echoes) {
      expect(line).not.toContain("vault.azure.net");
      expect(line).not.toContain("KeyVault");
      // Bare navnet på bryteren kan nevnes (på/av), ikke andre KEY_VAULT-verdier.
      expect(line.replace(/ENABLE_KEY_VAULT/g, "")).not.toContain("KEY_VAULT");
    }
  });

  it("3. ENABLE_KEY_VAULT er en tillatt variabel som brukes og er dokumentert", () => {
    expect(ALLOWED_VARS).toContain("ENABLE_KEY_VAULT");
    expect(varNames(workflow)).toContain("ENABLE_KEY_VAULT");
    expect(read(DRIFT_DOC_PATH)).toContain("ENABLE_KEY_VAULT");
  });

  it("4. ingen steg som leser fra boksen", () => {
    for (const forbidden of ["az keyvault", "secret show", "secret list", "--query value"]) {
      expect(workflow, forbidden).not.toContain(forbidden);
    }
  });
});

describe("dokumentasjon for nøkkelboksen", () => {
  const RESTART = /start(et|es)? (appen )?på nytt|omstart/i;

  it("1. ADR 0005 finnes og dekker valgene", () => {
    const path = "docs/adr/0005-nokkelboks-key-vault.md";
    expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    const adr = read(path);
    for (const text of [
      "App Service",
      "@Microsoft.KeyVault(",
      "av som standard",
      "GitHub",
      "RBAC",
      "purge",
      "90 dager",
      "Optiplan",
      "antakelse",
      "synk",
      "ENABLE_KEY_VAULT",
    ]) {
      expect(adr, text).toContain(text);
    }
    expect(adr).toMatch(RESTART);
    expect(adr.trimEnd().split("\n").length).toBeLessThanOrEqual(60);
  });

  it("2. driftsdokumentet forklarer slå på, sjekk og slå av", () => {
    const doc = read(DRIFT_DOC_PATH);
    for (const text of [
      "Nøkkelboks for hemmeligheter",
      "ENABLE_KEY_VAULT",
      "true",
      "hakemerke",
      "Recover",
      "90 dager",
      "kv-ezprop-",
    ]) {
      expect(doc, text).toContain(text);
    }
    expect(doc).toMatch(/^#+\s.*Nøkkelboks for hemmeligheter/m);
    expect(doc).toMatch(RESTART);
    const docLines = doc.split("\n");
    const start = docLines.findIndex((line) => /^#+\s.*Hva som ikke er med ennå/.test(line));
    expect(start, "overskriften «Hva som ikke er med ennå»").toBeGreaterThan(-1);
    const level = /^(#+)/.exec(docLines[start]!)![1]!.length;
    let end = start + 1;
    while (end < docLines.length) {
      const heading = /^(#+)\s/.exec(docLines[end]!);
      if (heading && heading[1]!.length <= level) break;
      end += 1;
    }
    const section = docLines.slice(start + 1, end);
    expect(
      section.some((line) => line.includes("Nøkkelboks") && line.includes("ENABLE_KEY_VAULT")),
      "linje om nøkkelboksen under «Hva som ikke er med ennå»",
    ).toBe(true);
    expect(
      section.filter((line) => line.includes("Nøkkelboks for hemmeligheter (fase 0b)")),
    ).toEqual([]);
  });

  it("3. henvisningene i ADR 0002, domenemodellen, arkitekturen og åpne spørsmål", () => {
    expect(read("docs/adr/0002-testmiljo-azure.md")).toContain("ADR 0005");

    const domain = read("docs/05-domenemodell.md").split("\n");
    expect(
      domain.some(
        (line) =>
          line.includes("secret_ref") &&
          line.includes("miljøvariabel") &&
          /n[øo]kkelboks/i.test(line) &&
          line.includes("Bicep"),
      ),
      "linje i domenemodellen om secret_ref og nøkkelboksen",
    ).toBe(true);

    const rule8 = read("docs/06-arkitektur.md")
      .split("\n")
      .find((line) => line.startsWith("8. **Tilkoblinger"));
    expect(rule8, "regel 8 i arkitekturen").toBeDefined();
    expect(rule8).toContain("nøkkelboksen");
    expect(rule8).toContain("oppstart");

    const questions = read("docs/09-apne-sporsmal.md").split("\n");
    const question9 = questions.find((line) => /^\|\s*9\s*\|/.test(line));
    expect(question9, "spørsmål nr. 9").toBeDefined();
    expect(question9).toContain("nøkkelboksen er bygget");
    const decided = questions.findIndex((line) =>
      /Avgjort av agentene mens Ståle var borte/.test(line),
    );
    expect(decided, "«Avgjort av agentene mens Ståle var borte»").toBeGreaterThan(-1);
    const decisions = questions.slice(decided).filter((line) => /^\|\s*A\d+\s*\|/.test(line));
    expect(
      decisions.some(
        (line) =>
          line.includes("Key Vault") &&
          (line.includes("enableKeyVault") || line.includes("ENABLE_KEY_VAULT")),
      ),
      "A-rad om Key Vault",
    ).toBe(true);
  });
});

describe("KI-nøkkelen ANTHROPIC_API_KEY i testmiljøet", () => {
  const workflow = read(WORKFLOW_PATH);
  const workflowLines = workflow.split("\n");
  const bicep = read(BICEP_PATH);

  it("1. sendes bare i steget «Infrastruktur (Bicep)», som hemmelighet", () => {
    const uses = workflowLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !isComment(line) && line.includes("ANTHROPIC_API_KEY"));
    expect(uses.length).toBeGreaterThan(0);
    const stepLine = codeLine(workflowLines, /^\s*-\s+name:\s*Infrastruktur \(Bicep\)/);
    const step = stepOf(workflowLines, stepLine);
    for (const { line, index } of uses) {
      expect(stepOf(workflowLines, index), line).toEqual(step);
    }
    expect(subBlock(step, "env")).toMatch(
      /^\s*ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}\s*$/m,
    );
    expect(subBlock(step, "run")).not.toMatch(/\$\{\{[^}]*ANTHROPIC_API_KEY/);
    expect(REQUIRED_SECRETS).not.toContain("ANTHROPIC_API_KEY");
    for (const marker of ["az deployment group validate", "az deployment group create"]) {
      const command = commandBlock(workflow, marker);
      expect(parameterSources(workflow, command), marker).toContain(
        '"anthropicApiKey=$ANTHROPIC_API_KEY"',
      );
    }
  });

  it("2. tom verdi er lov og betyr at appen ikke får nøkkelen", () => {
    expect(bicep).toMatch(/^var aiConfigured = !empty\(anthropicApiKey\)$/m);
    const block = bicep.slice(bicep.indexOf("var aiAppSettings = aiConfigured"));
    expect(block.startsWith("var aiAppSettings = aiConfigured")).toBe(true);
    expect(block.slice(0, block.indexOf(": []"))).toContain("'ANTHROPIC_API_KEY'");
    expect(bicep.match(/'ANTHROPIC_API_KEY'/g)).toHaveLength(1);
    expect(bicep).toMatch(/appSettings:\s*concat\([^)]*aiAppSettings\)/);
  });

  it("3. CI og e2e får aldri nøkkelen", () => {
    expect(read(".github/workflows/ci.yml")).not.toContain("ANTHROPIC_API_KEY");
    expect(read(".github/workflows/oppdater-pr.yml")).not.toContain("ANTHROPIC_API_KEY");
    const configs = readdirSync(process.cwd()).filter((name) => /^playwright\.config\./.test(name));
    expect(configs.length).toBeGreaterThan(0);
    for (const file of configs) expect(read(file), file).not.toContain("ANTHROPIC_API_KEY");
  });

  it("4. .env.example har bare en tom linje, og driftsdokumentet nevner nøkkelen", () => {
    const example = read(".env.example")
      .split("\n")
      .filter((line) => line.startsWith("ANTHROPIC_API_KEY"));
    expect(example).toEqual(["ANTHROPIC_API_KEY="]);
    expect(read(DRIFT_DOC_PATH)).toContain("ANTHROPIC_API_KEY");
  });
});

/*
 * KI-nøkkelen i testmiljøet (docs/funksjoner/fase2a-ki-leverandor-testplan.md 4.7, kortet Omfang
 * 15): samme steder som MS_GRAPH_CLIENT_SECRET, som hemmelighet, og tom verdi er lov (KI av).
 */
describe("KI-nøkkelen i utrullingen (ANTHROPIC_API_KEY)", () => {
  const workflow = read(WORKFLOW_PATH);

  it("kommer fra secrets i steget Infrastruktur (Bicep) og sendes som anthropicApiKey", () => {
    expect(workflow).toMatch(
      /^\s*ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}\s*$/m,
    );
    expect(workflow).toContain('"anthropicApiKey=$ANTHROPIC_API_KEY"');
    // Ingen sjekk som stopper utrullingen når nøkkelen er tom
    expect(workflow).not.toMatch(/-z\s+"?\$\{?ANTHROPIC_API_KEY/);
  });

  it("start.sh legger til ANTHROPIC_API_KEY tom, som MS_GRAPH_CLIENT_SECRET", () => {
    const start = read("start.sh");
    const loop = start
      .split("\n")
      .find((line) => /^for navn in .*MS_GRAPH_CLIENT_SECRET/.test(line));
    expect(loop, "løkken som legger til tomme innstillinger").toBeDefined();
    expect(loop!).toMatch(/\bANTHROPIC_API_KEY\b/);
  });

  it("driftsdokumentet nevner nøkkelen", () => {
    expect(read(DRIFT_DOC_PATH)).toContain("ANTHROPIC_API_KEY");
  });
});
