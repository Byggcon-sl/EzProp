import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Drift-filene leses som tekst og sjekkes med enkle mønstre (ingen YAML-pakke, ingen Azure-kall).
 * Testplan: docs/funksjoner/fase1-testmiljo-azure-testplan.md, avsnitt 3.
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
];
const REQUIRED_SECRETS = ALLOWED_SECRETS.slice(0, 5);
const ALLOWED_VARS = ["SEED_ADMIN_EMAIL", "APP_HOSTNAME"];

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
      /(POSTGRES_ADMIN_PASSWORD|MS_GRAPH_CLIENT_SECRET|AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID)\s*:\s*[^$\s]/;
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
    expect(workflow).toContain("pnpm db:seed");
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
    const seedLine = lines.findIndex((line) => line.includes("pnpm db:seed"));
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
    for (const index of secretParams) {
      expect(lines[index - 1]?.trim(), lines[index]).toBe("@secure()");
      expect(lines[index], "hemmelig parameter har standardverdi").not.toContain("=");
    }
  });

  it("ingen hemmelige utdata", () => {
    const outputs = lines.filter((line) => /^\s*output\b/.test(line));
    expect(outputs.length).toBeGreaterThan(0);
    for (const line of outputs) {
      expect(line).not.toMatch(/password|secret|DATABASE_URL|connectionString/i);
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
    for (const name of ["planName", "appName", "postgresServerName"]) {
      expect(bicep).toMatch(new RegExp(`var\\s+${name}\\s*=\\s*'[^']*\\$\\{environmentName\\}`));
    }
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
    expect(doc).not.toContain("Mail.Send");
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
