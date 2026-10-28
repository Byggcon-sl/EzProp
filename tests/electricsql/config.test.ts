import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Docker, miljø og oppstart for synktjenesten ElectricSQL (kandidat 2,
// docs/funksjoner/fase1-kandidat-electricsql.md pkt. 11–12 og avgjørelse F). Testplan avsnitt 2.7.
// Filene leses som tekst; hjelperne er kopiert fra tests/powersync/config.test.ts (ingen YAML-pakke
// som direkte avhengighet).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relative: string): string {
  const file = path.join(ROOT, relative);
  expect(existsSync(file), `${relative} mangler`).toBe(true);
  return readFileSync(file, "utf8");
}

/** Linjer uten kommentarer og tomme linjer. */
function contentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .filter((line) => line.trim() !== "");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Teksten under nøkkelen `key` (første treff med gitt innrykk eller dypere enn `minIndent`),
 * fram til neste linje med samme eller mindre innrykk.
 */
function block(text: string, key: string, minIndent = 0): string {
  const lines = contentLines(text);
  const start = lines.findIndex(
    (line) => indentOf(line) >= minIndent && new RegExp(`^\\s*${key}:`).test(line),
  );
  expect(start, `fant ikke «${key}:»`).toBeGreaterThanOrEqual(0);
  const indent = indentOf(lines[start]!);
  const out = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (indentOf(line) <= indent) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Toppnivå-blokken `key:` (innrykk 0). */
function topBlock(text: string, key: string): string {
  const lines = contentLines(text);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  expect(start, `fant ikke toppnivå «${key}:»`).toBeGreaterThanOrEqual(0);
  const out = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (indentOf(line) === 0) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Linjene under en liste-nøkkel, uten «- » og anførselstegn. */
function listItems(blockText: string): string[] {
  return blockText
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/^-\s*/, "").replace(/["']/g, ""));
}

function envExampleValue(key: string): string | undefined {
  const line = read(".env.example")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

/** Verdien til `key` i en YAML- eller miljøfil (`KEY: verdi`, `KEY=verdi`), uten anførselstegn. */
function valueIn(text: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*[:=]\\s*["']?([^"'\\s#]+)`, "m").exec(text);
  return match?.[1];
}

function electricService(): string {
  const compose = read("docker-compose.yml");
  return block(block(compose, "services"), "electric", 1);
}

describe("ElectricSQL-konfigurasjon", () => {
  it("docker-compose binder Electric bare til 127.0.0.1, ikke port 3000, med fast versjonstag", () => {
    const electric = electricService();

    const ports = listItems(block(electric, "ports", 3));
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port).toMatch(/^127\.0\.0\.1:/);
      // 127.0.0.1:<vert>:<container>
      const hostPort = port.split(":")[1];
      expect(hostPort, port).not.toBe("3000");
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

    const volumes = listItems(block(electric, "volumes", 3));
    const named = volumes.filter((volume) => !volume.startsWith("./") && !volume.startsWith("/"));
    expect(named.length, "Electric mangler navngitt volum").toBeGreaterThan(0);
    const topVolumes = topBlock(compose, "volumes");
    for (const volume of named) {
      const name = volume.split(":")[0]!;
      expect(topVolumes, `volumet ${name} står ikke under toppnivå volumes:`).toMatch(
        new RegExp(`^\\s+${name}:`, "m"),
      );
    }

    const environment = block(electric, "environment", 3);
    expect(environment).toMatch(/ELECTRIC_USAGE_REPORTING\s*[:=]\s*["']?false["']?/);
    const secretLine = environment.split("\n").find((line) => /\bELECTRIC_SECRET\b/.test(line));
    expect(secretLine, "ELECTRIC_SECRET mangler i environment").toBeDefined();
    expect(secretLine).toMatch(/\$\{ELECTRIC_SECRET[^}]*\}/);
    // Ingen fast verdi som standard: ${ELECTRIC_SECRET} eller ${ELECTRIC_SECRET:-}
    expect(secretLine).not.toMatch(/\$\{ELECTRIC_SECRET:?-[^}]+\}/);
  });

  it("Electric-tjenesten har ingen tilkoblingsstreng med passord i filen", () => {
    const compose = read("docker-compose.yml");
    const withPassword = /postgres(ql)?:\/\/\w+:\w+@([\w.-]+)/;
    for (const line of compose.split("\n")) {
      const match = withPassword.exec(line);
      if (!match) continue;
      // Bare som standardverdi i ${…:-…} for utvikling, og bare mot db-tjenesten
      expect(line, "tilkoblingsstreng utenfor ${…:-…}").toMatch(
        /\$\{\w+:-postgres(ql)?:\/\/\w+:\w+@[^}]*\}/,
      );
      expect(match[2], "tilkoblingsstreng mot en annen vert enn db").toBe("db");
    }
  });

  it(".env.example har ELECTRIC_URL og ELECTRIC_SECRET med forklaring, aldri NEXT_PUBLIC_", () => {
    const lines = read(".env.example").split("\n");
    for (const key of ["ELECTRIC_URL", "ELECTRIC_SECRET"]) {
      const index = lines.findIndex((line) => line.startsWith(`${key}=`));
      expect(index, `${key} mangler i .env.example`).toBeGreaterThan(0);
      expect(lines[index - 1]!.trim(), `kommentar over ${key}`).toMatch(/^#/);
    }
    expect(Buffer.byteLength(envExampleValue("ELECTRIC_SECRET") ?? "")).toBeGreaterThanOrEqual(32);
    expect(envExampleValue("ELECTRIC_URL")).toMatch(/^https?:\/\//);
    for (const line of lines) {
      expect(line.startsWith("NEXT_PUBLIC_ELECTRIC"), line).toBe(false);
      expect(line, "testkroken står aldri i .env.example").not.toContain(
        "NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS",
      );
    }
  });

  it("ci.yml og playwright.config.ts har ELECTRIC_URL og ELECTRIC_SECRET, og hemmeligheten er ikke utviklingsverdien", () => {
    const devSecret = envExampleValue("ELECTRIC_SECRET");
    expect(devSecret).toBeTruthy();
    for (const file of [".github/workflows/ci.yml", "playwright.config.ts"]) {
      const text = read(file);
      expect(text, `${file}: ELECTRIC_URL`).toMatch(/\bELECTRIC_URL\b/);
      expect(text, `${file}: ELECTRIC_SECRET`).toMatch(/\bELECTRIC_SECRET\b/);
      const secret = valueIn(text, "ELECTRIC_SECRET");
      expect(secret, `${file}: verdi for ELECTRIC_SECRET`).toBeTruthy();
      expect(secret, file).not.toBe(devSecret);
      expect(text.includes(devSecret!), `${file} har utviklingsverdien`).toBe(false);
      expect(Buffer.byteLength(secret!), file).toBeGreaterThanOrEqual(32);
    }
  });

  it("start.sh har steget for ElectricSQL og TOTALT stemmer", () => {
    const script = read("start.sh");
    const lines = script.split("\n");

    expect(script).toContain('steg "Starter synktjenesten (ElectricSQL)"');
    const total = /^TOTALT=(\d+)\s*$/m.exec(script)?.[1];
    expect(total, "TOTALT=").toBeDefined();
    const steps = lines.filter((line) => /^steg "/.test(line));
    expect(Number(total)).toBe(steps.length);

    const powersync = lines.findIndex((line) => line.startsWith('steg "Starter synktjenesten (PowerSync)"'));
    const electric = lines.findIndex((line) => line.startsWith('steg "Starter synktjenesten (ElectricSQL)"'));
    expect(powersync).toBeGreaterThanOrEqual(0);
    expect(electric, "ElectricSQL-steget står etter PowerSync-steget").toBeGreaterThan(powersync);

    // Selve steget: fram til neste steg
    const next = lines.findIndex((line, index) => index > electric && /^steg "/.test(line));
    const stepText = lines.slice(electric, next === -1 ? undefined : next).join("\n");
    expect(stepText).toContain("EZPROP_SKIP_DOCKER");

    // Eldre .env får nøklene lagt til (samme mekanisme som for PowerSync)
    expect(script).toMatch(/"ELECTRIC_URL=[^"]+"/);
    expect(script).toMatch(/"ELECTRIC_SECRET=[^"]+"/);
  });
});
