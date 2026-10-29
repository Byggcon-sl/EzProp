import { describe, expect, it } from "vitest";
import { block, contentLines, envExampleValue, read } from "../compose-text";

// Docker og miljø for kandidat 2, ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql.md
// pkt. 11–12, avgjørelse F). Testplan avsnitt 2.7. Filene leses som tekst (tests/compose-text.ts).
// Hovedmål: tid (Ståle starter alt med ./start.sh) og ingen hemmeligheter i repoet.

function electricService(): string {
  const services = block(read("docker-compose.yml"), "services");
  return block(services, "electric", 1);
}

function listItems(section: string): string[] {
  return section
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, "").replace(/["']/g, "").trim());
}

/** Verdien til en nøkkel i en `environment:`-blokk, enten som `KEY: v` eller `- KEY=v`. */
function envValue(environment: string, key: string): string | undefined {
  for (const raw of environment.split("\n").slice(1)) {
    const line = raw.trim().replace(/^-\s*/, "");
    const match = new RegExp(`^${key}\\s*[:=]\\s*(.*)$`).exec(line);
    if (match) return match[1]!.trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

describe("ElectricSQL-konfigurasjon", () => {
  it("docker-compose binder Electric bare til 127.0.0.1, ikke port 3000, med fast versjonstag", () => {
    const electric = electricService();
    const ports = listItems(block(electric, "ports", 3));
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port).toMatch(/^127\.0\.0\.1:/);
      const hostPort = port.split(":")[1];
      expect(hostPort, "vertsporten 3000 er appens").not.toBe("3000");
    }

    const image = /^\s*image:\s*["']?([^\s"']+)/m.exec(electric)?.[1];
    expect(image, "image mangler").toBeTruthy();
    expect(image!.startsWith("electricsql/electric:")).toBe(true);
    expect(image).not.toMatch(/:latest$/);
    const tag = image!.slice("electricsql/electric:".length);
    expect(tag).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("Electric venter på databasen, har eget volum og sender ikke bruksdata", () => {
    const compose = read("docker-compose.yml");
    const electric = electricService();

    const dependsOn = block(electric, "depends_on", 3);
    expect(block(dependsOn, "db", 4)).toMatch(/condition:\s*service_healthy/);

    const mounts = listItems(block(electric, "volumes", 3));
    const named = mounts
      .filter((mount) => !mount.startsWith("./") && !mount.startsWith("/"))
      .map((mount) => mount.split(":")[0]!);
    expect(named.length, "Electric mangler et navngitt volum").toBeGreaterThan(0);
    const topVolumes = contentLines(block(compose, "^volumes", 0))
      .slice(1)
      .map((line) => line.trim().replace(/:.*$/, ""));
    for (const name of named) expect(topVolumes, `volumet ${name}`).toContain(name);

    const environment = block(electric, "environment", 3);
    expect(envValue(environment, "ELECTRIC_USAGE_REPORTING")).toBe("false");
    const secret = envValue(environment, "ELECTRIC_SECRET");
    expect(secret, "ELECTRIC_SECRET mangler i environment").toBeDefined();
    expect(secret!, "ELECTRIC_SECRET skal leses fra miljøet").toMatch(
      /^\$\{ELECTRIC_SECRET(\}|[:?-])/,
    );
    const devSecret = envExampleValue("ELECTRIC_SECRET");
    expect(devSecret).toBeTruthy();
    expect(compose.includes(devSecret!), "utviklingshemmeligheten står i docker-compose.yml").toBe(
      false,
    );
  });

  it("Electric-tjenesten har ingen tilkoblingsstreng med passord i filen", () => {
    const pattern = /postgres(ql)?:\/\/\w+:\w+@([\w.-]+)/;
    for (const line of contentLines(electricService())) {
      const match = pattern.exec(line);
      if (!match) continue;
      // Bare som standardverdi i ${…:-…}, og bare mot db-tjenesten i compose, aldri en ekstern vert
      expect(line, "tilkoblingsstreng utenfor ${…:-…}").toMatch(
        /\$\{\w+:-postgres(ql)?:\/\/\w+:\w+@[^}]+\}/,
      );
      expect(match[2], "ekstern vert i tilkoblingsstrengen").toBe("db");
    }
  });

  it(".env.example har ELECTRIC_URL og ELECTRIC_SECRET med forklaring, aldri NEXT_PUBLIC_", () => {
    const lines = read(".env.example").split("\n");
    for (const key of ["ELECTRIC_URL", "ELECTRIC_SECRET"]) {
      const index = lines.findIndex((line) => line.startsWith(`${key}=`));
      expect(index, `${key} mangler`).toBeGreaterThan(0);
      expect(lines[index - 1]!.trim().startsWith("#"), `kommentar over ${key}`).toBe(true);
    }
    expect(envExampleValue("ELECTRIC_URL")).toMatch(/^https?:\/\//);
    expect(
      Buffer.byteLength(envExampleValue("ELECTRIC_SECRET") ?? "", "utf8"),
    ).toBeGreaterThanOrEqual(32);
    expect(lines.filter((line) => /^\s*NEXT_PUBLIC_ELECTRIC/.test(line))).toEqual([]);
    expect(lines.filter((line) => line.includes("NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS"))).toEqual(
      [],
    );
  });

  it("ci.yml og playwright.config.ts har ELECTRIC_URL og ELECTRIC_SECRET, og hemmeligheten er ikke utviklingsverdien", () => {
    const devSecret = envExampleValue("ELECTRIC_SECRET");
    expect(devSecret).toBeTruthy();
    const files = {
      ".github/workflows/ci.yml": /ELECTRIC_SECRET\s*:\s*["']?([^"'\s,]+)/,
      "playwright.config.ts": /ELECTRIC_SECRET\s*:\s*["']([^"']+)["']/,
    };
    for (const [file, secretPattern] of Object.entries(files)) {
      const text = read(file);
      expect(text, `${file}: ELECTRIC_URL`).toMatch(/\bELECTRIC_URL\b/);
      expect(text, `${file}: ELECTRIC_SECRET`).toMatch(/\bELECTRIC_SECRET\b/);
      const value = secretPattern.exec(text)?.[1];
      expect(value, `${file}: verdi for ELECTRIC_SECRET`).toBeTruthy();
      expect(value, `${file} bruker utviklingsverdien`).not.toBe(devSecret);
      expect(Buffer.byteLength(value!, "utf8"), file).toBeGreaterThanOrEqual(32);
      expect(text.includes(devSecret!), `${file} inneholder utviklingsverdien`).toBe(false);
      expect(text, file).not.toMatch(/NEXT_PUBLIC_ELECTRIC/);
    }
  });

  it("start.sh har steget for ElectricSQL og TOTALT stemmer", () => {
    const text = read("start.sh");
    expect(text).toContain('steg "Starter synktjenesten (ElectricSQL)"');

    const steps = text.split("\n").filter((line) => /^steg "/.test(line));
    const total = /^TOTALT=(\d+)$/m.exec(text)?.[1];
    expect(total, "TOTALT mangler").toBeDefined();
    expect(Number(total)).toBe(steps.length);

    const powersyncIndex = steps.indexOf('steg "Starter synktjenesten (PowerSync)"');
    const electricIndex = steps.indexOf('steg "Starter synktjenesten (ElectricSQL)"');
    expect(powersyncIndex).toBeGreaterThanOrEqual(0);
    expect(electricIndex).toBeGreaterThan(powersyncIndex);

    // Teksten i selve Electric-steget (fram til neste steg)
    const start = text.indexOf('steg "Starter synktjenesten (ElectricSQL)"');
    const rest = text.slice(start + 1);
    const next = rest.search(/^steg "/m);
    const electricStep = next === -1 ? rest : rest.slice(0, next);
    expect(electricStep).toContain("EZPROP_SKIP_DOCKER");

    // Eldre .env får ELECTRIC_URL og ELECTRIC_SECRET lagt til (i steget «Gjør klar innstillinger»)
    const settingsStart = text.indexOf('steg "Gjør klar innstillinger"');
    expect(settingsStart).toBeGreaterThanOrEqual(0);
    const afterSettings = text.slice(settingsStart + 1);
    const settingsEnd = afterSettings.search(/^steg "/m);
    const settings = settingsEnd === -1 ? afterSettings : afterSettings.slice(0, settingsEnd);
    expect(settings).toMatch(/ELECTRIC_URL=/);
    expect(settings).toMatch(/ELECTRIC_SECRET=/);
  });
});
