import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Drift-filene for testmiljøet i Azure leses som tekst (ingen YAML-pakke, ingen Azure-kall).
 * Bicep kan ikke kompileres her; testene sjekker det som kan sjekkes uten Azure.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readIfExists = (path: string) => (existsSync(join(root, path)) ? read(path) : "");

const WORKFLOW = ".github/workflows/deploy-azure.yml";
const BICEP = "infra/azure/main.bicep";
const DRIFT_DOC = "docs/drift/testmiljo-azure.md";

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

function secretNames(text: string): string[] {
  return [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]!);
}

function varNames(text: string): string[] {
  return [...text.matchAll(/vars\.([A-Z0-9_]+)/g)].map((match) => match[1]!);
}

/** `a` kommer før `b` (begge må finnes). */
function after(text: string, a: string, b: string): boolean {
  const first = text.indexOf(a);
  const second = text.indexOf(b);
  return first !== -1 && second !== -1 && first < second;
}

function lines(text: string): string[] {
  return text.split("\n");
}

function lineIndex(text: string, needle: string | RegExp, from = 0): number {
  const all = lines(text);
  for (let i = from; i < all.length; i++) {
    const line = all[i]!;
    if (typeof needle === "string" ? line.includes(needle) : needle.test(line)) return i;
  }
  return -1;
}

describe("utrullingsarbeidsflyten (deploy-azure.yml)", () => {
  const workflow = read(WORKFLOW);
  const workflowLines = lines(workflow);

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
    const firstPermissions = workflow.match(/permissions:.*/)?.[0];
    expect(firstPermissions?.trim()).toBe("permissions: {}");
    expect(workflow.match(/id-token:\s*write/g) ?? []).toHaveLength(1);
    const deployJob = workflow.search(/^\s{2}utrulling:/m);
    expect(deployJob).toBeGreaterThan(-1);
    expect(workflow.search(/id-token:\s*write/)).toBeGreaterThan(deployJob);
  });

  it("jobben sjekk gir klar, og utrulling kjører bare når klar er true", () => {
    const checkJob = workflow.search(/^\s{2}sjekk:/m);
    const deployJob = workflow.search(/^\s{2}utrulling:/m);
    expect(checkJob).toBeGreaterThan(-1);
    expect(deployJob).toBeGreaterThan(-1);
    const checkText = workflow.slice(checkJob, deployJob > checkJob ? deployJob : undefined);
    expect(checkText).toMatch(/outputs:\s*\n\s*klar:/);
    const deployText = workflow.slice(deployJob);
    expect(deployText).toMatch(/needs:\s*(sjekk|\[\s*sjekk\s*\])/);
    expect(deployText).toContain("if: needs.sjekk.outputs.klar == 'true'");
    expect(workflow).toContain("hopper over utrullingen");
  });

  it("sjekk leser bare om AZURE_CLIENT_ID finnes, ikke verdien", () => {
    expect(workflow).toContain("secrets.AZURE_CLIENT_ID != ''");
    const leaking = workflowLines.filter(
      (line) =>
        line.includes("echo") &&
        line.includes("AZURE_CLIENT_ID") &&
        !line.includes("klar") &&
        !line.includes("!= ''"),
    );
    expect(leaking).toEqual([]);
  });

  it("bruker OIDC, ikke lagret Azure-passord", () => {
    const login = lineIndex(workflow, "azure/login");
    expect(login).toBeGreaterThan(-1);
    const loginBlock = workflowLines.slice(login, login + 8).join("\n");
    expect(loginBlock).toContain("client-id:");
    expect(loginBlock).toContain("tenant-id:");
    expect(loginBlock).toContain("subscription-id:");
    expect(workflow).not.toContain("creds:");
    expect(workflow).not.toContain("AZURE_CREDENTIALS");
  });

  it("lager ikke ressursgruppen", () => {
    expect(workflow).not.toMatch(/az\s+group\s+create/);
  });

  it("bruker bare de dokumenterte navnene på secrets og variabler", () => {
    const secrets = new Set(secretNames(workflow));
    const vars = new Set(varNames(workflow));
    expect([...secrets].filter((name) => !ALLOWED_SECRETS.includes(name))).toEqual([]);
    expect([...vars].filter((name) => !ALLOWED_VARS.includes(name))).toEqual([]);
    for (const name of REQUIRED_SECRETS) expect(secrets.has(name), name).toBe(true);
    for (const name of ALLOWED_VARS) expect(vars.has(name), name).toBe(true);
  });

  it("bygget bruker de oppdiktede verdiene fra ci.yml, ikke ekte secrets", () => {
    const ci = read(".github/workflows/ci.yml");
    const plainSecret = (text: string) =>
      lines(text)
        .map((line) => line.match(/^\s*BETTER_AUTH_SECRET:\s*(.+?)\s*$/)?.[1])
        .filter((value): value is string => !!value && !value.includes("${{"));
    const ciValues = plainSecret(ci);
    expect(ciValues).toHaveLength(1);
    const workflowValues = plainSecret(workflow);
    expect(workflowValues.length).toBeGreaterThan(0);
    for (const value of workflowValues) expect(value).toBe(ciValues[0]);
    expect(workflow).not.toContain("DEV_MAILBOX");
    expect(workflow).toMatch(/BETTER_AUTH_URL:\s*http:\/\/localhost:3000/);
  });

  it("ingen hemmeligheter som verdier", () => {
    const pattern =
      /(POSTGRES_ADMIN_PASSWORD|MS_GRAPH_CLIENT_SECRET|AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID)\s*:\s*[^$\s]/;
    expect(workflowLines.filter((line) => pattern.test(line))).toEqual([]);
  });

  it("Bicep valideres før den rulles ut, uten hemmelige utskrifter", () => {
    expect(after(workflow, "az deployment group validate", "az deployment group create")).toBe(
      true,
    );
    const create = lineIndex(workflow, "az deployment group create");
    const createBlock: string[] = [];
    for (let i = create; i < workflowLines.length; i++) {
      createBlock.push(workflowLines[i]!);
      if (!workflowLines[i]!.trimEnd().endsWith("\\")) break;
    }
    expect(createBlock.join("\n")).toMatch(/--output none|--query/);
  });

  it("DATABASE_URL maskeres før bruk", () => {
    expect(workflow).toContain("::add-mask::");
    expect(after(workflow, "::add-mask::", "pnpm db:migrate")).toBe(true);
  });

  it("migrering og seed kjører fra arbeidsflyten med riktig miljø", () => {
    expect(workflow).toContain("pnpm db:migrate");
    expect(workflow).toContain("pnpm db:seed");
    const migrate = lineIndex(workflow, "pnpm db:migrate");
    const before = workflowLines.slice(Math.max(0, migrate - 15), migrate).join("\n");
    expect(before).toMatch(/^\s*env:\s*$/m);
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "SEED_ADMIN_EMAIL"]) {
      expect(before, name).toMatch(new RegExp(`^\\s*${name}:`, "m"));
    }
    expect(workflow).toContain("pnpm install");
    expect(workflow).not.toContain("--prod");
  });

  it("brannmurregelen for kjøreren fjernes alltid", () => {
    const create = lineIndex(workflow, /firewall-rule create.*github-runner/);
    const remove = lineIndex(workflow, /firewall-rule delete.*github-runner/);
    const migrate = lineIndex(workflow, "pnpm db:migrate");
    const seed = lineIndex(workflow, "pnpm db:seed");
    expect(create).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(-1);
    expect(create).toBeLessThan(migrate);
    expect(remove).toBeGreaterThan(seed);
    const around = workflowLines.slice(Math.max(0, remove - 3), remove + 4).join("\n");
    expect(around).toContain("if: always()");
  });

  it("setter APP_VERSION til kort commit-id og sjekker /api/helse", () => {
    expect(workflow).toContain("APP_VERSION");
    expect(workflow).toMatch(
      /GITHUB_SHA::7|github\.sha.*(substr|cut -c1-7)|(substr|cut -c1-7).*github\.sha|git rev-parse --short/,
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
    expect(workflow).toMatch(/cd \.next\/standalone|working-directory: \.next\/standalone/);
    const inside = workflow.search(/cd \.next\/standalone|working-directory: \.next\/standalone/);
    expect(workflow.slice(inside)).toMatch(/\bzip\b/);
  });
});

describe("infrastruktur som kode (infra/azure/main.bicep)", () => {
  const bicep = read(BICEP);
  const bicepLines = lines(bicep);

  it("ligger i Sweden Central", () => {
    expect(bicep).toContain("param location string = 'swedencentral'");
  });

  it("alle passord og hemmeligheter er @secure() og uten standardverdi", () => {
    const secretParams: string[] = [];
    bicepLines.forEach((line, i) => {
      const match = line.match(/^\s*param\s+(\w+)/);
      if (!match || !/password|secret/i.test(match[1]!)) return;
      secretParams.push(match[1]!);
      expect(bicepLines[i - 1]?.trim(), match[1]).toBe("@secure()");
      expect(line, match[1]).not.toContain("=");
    });
    for (const name of ["postgresAdminPassword", "betterAuthSecret", "msGraphClientSecret"]) {
      expect(secretParams).toContain(name);
    }
  });

  it("ingen hemmelige utdata", () => {
    const outputs = bicepLines.filter((line) => /^\s*output\b/.test(line));
    for (const line of outputs) {
      expect(line).not.toMatch(/password|secret|DATABASE_URL|connectionString/i);
    }
  });

  it("ingen hostname-binding eller sertifikat", () => {
    expect(bicep).not.toContain("hostNameBindings");
    expect(bicep).not.toContain("Microsoft.Web/certificates");
  });

  it("appen er bare https, TLS 1.2, med helsesjekk, alltid på", () => {
    expect(bicep).toMatch(/httpsOnly:\s*true/);
    expect(bicep).toMatch(/minTlsVersion:\s*'1\.2'/);
    expect(bicep).toMatch(/healthCheckPath:\s*'\/api\/helse'/);
    expect(bicep).toMatch(/alwaysOn:\s*true/);
    expect(bicep).toMatch(/linuxFxVersion:.*NODE\|22/);
    expect(bicep).toMatch(/appCommandLine:.*node server\.js/);
  });

  it("ingen bygging på serveren", () => {
    expect(bicep).toMatch(/SCM_DO_BUILD_DURING_DEPLOYMENT.*'false'/);
  });

  it("databasen er PostgreSQL 16 i samme region uten geo-kopi, og krever sertifikatsjekk", () => {
    const server = bicep.search(/Microsoft\.DBforPostgreSQL\/flexibleServers@/);
    expect(server).toBeGreaterThan(-1);
    const serverText = bicep.slice(server);
    expect(serverText).toMatch(/version:\s*'16'/);
    expect(serverText).toMatch(/location:\s*location\b/);
    expect(serverText).toMatch(/geoRedundantBackup:\s*'Disabled'/);
    expect(bicep).toContain("sslmode=verify-full");
    expect(bicep).not.toContain("sslmode=require");
    expect(bicep).toContain("uriComponent(");
  });

  it("appinnstillingene er riktige, og DEV_MAILBOX og PORT settes aldri", () => {
    expect(bicep).toMatch(/NODE_ENV.*production/);
    for (const name of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "SEED_ADMIN_EMAIL",
      "APP_VERSION",
    ]) {
      expect(bicep, name).toMatch(new RegExp(`name:\\s*'${name}'`));
    }
    for (const file of readdirSync(join(root, "infra/azure"), { recursive: true })) {
      const path = join("infra/azure", String(file));
      if (!/\.\w+$/.test(path)) continue;
      const text = read(path);
      expect(text, path).not.toContain("DEV_MAILBOX");
      expect(text, path).not.toMatch(/\bPORT\b/);
      expect(text, path).not.toContain("WEBSITES_PORT");
    }
  });

  it("BETTER_AUTH_URL følger appHostname", () => {
    const setting = bicepLines.find((line) => /name:\s*'BETTER_AUTH_URL'/.test(line));
    expect(setting).toBeDefined();
    const value = setting!.match(/value:\s*(.+?)\s*\}?\s*$/)?.[1] ?? "";
    let expressionLine = bicepLines.indexOf(setting!);
    if (/^\w+$/.test(value)) {
      expressionLine = bicepLines.findIndex((line) =>
        new RegExp(`^\\s*var\\s+${value}\\s*=`).test(line),
      );
    }
    expect(expressionLine).toBeGreaterThan(-1);
    expect(bicepLines[expressionLine]).toContain("appHostname");
    const nearby = bicepLines.slice(Math.max(0, expressionLine - 3), expressionLine + 4).join("\n");
    expect(nearby).toContain("azurewebsites.net");
  });

  it("ressursnavn bruker environmentName", () => {
    expect(bicep).not.toContain("ezprop-test");
    expect(bicep).toMatch(/plan\w*.*\$\{environmentName\}/i);
    expect(bicep).toMatch(/app\w*.*\$\{environmentName\}/i);
    expect(bicep).toMatch(/(psql|postgres|database|db)\w*.*\$\{environmentName\}/i);
  });

  it("ingen verdier for hemmeligheter", () => {
    const pattern = /(password|secret)\w*\s*:\s*'[^']{8,}'/i;
    expect(bicepLines.filter((line) => pattern.test(line))).toEqual([]);
  });
});

describe("dokumentasjon for testmiljøet", () => {
  it("driftsdokumentet nevner alle secrets og variabler arbeidsflyten bruker", () => {
    const workflow = read(WORKFLOW);
    const doc = readIfExists(DRIFT_DOC);
    expect(doc, `${DRIFT_DOC} mangler`).not.toBe("");
    const names = new Set([...secretNames(workflow), ...varNames(workflow)]);
    expect([...names].filter((name) => !doc.includes(name))).toEqual([]);
  });

  it("driftsdokumentet har stegene, kostnad og sletting", () => {
    const doc = readIfExists(DRIFT_DOC);
    expect(doc, `${DRIFT_DOC} mangler`).not.toBe("");
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
    expect(read("docs/10-utviklingsmiljo.md")).toContain(DRIFT_DOC);
  });

  it("ADR 0002 finnes med begge avveiningene", () => {
    const adr = readIfExists("docs/adr/0002-testmiljo-azure.md");
    expect(adr, "docs/adr/0002-testmiljo-azure.md mangler").not.toBe("");
    expect(adr).toContain("Azure-tjenester");
    expect(adr).toContain("administrator");
    expect(read("docs/06-arkitektur.md")).toContain("ADR 0002");
  });
});
