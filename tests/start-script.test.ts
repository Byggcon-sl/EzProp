import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Ståles oppstartsskript (start.sh) leses som tekst. Det må virke med bash 3.2 på Mac.
 * Testplan: docs/funksjoner/fase2a-testoppdrag-testplan.md, avsnitt 3.
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const SEED_COMMAND = /--silent db:seed(\s|$)/;
const SEED_TESTOPPDRAG_COMMAND = /--silent db:seed:testoppdrag(\s|$)/;

describe("start.sh", () => {
  const script = read("start.sh");
  const lines = script.split("\n");
  const code = (pattern: RegExp) =>
    lines.findIndex((line) => !/^\s*#/.test(line) && pattern.test(line));

  it("har gyldig bash-syntaks", () => {
    expect(() => execFileSync("bash", ["-n", "start.sh"], { cwd: process.cwd() })).not.toThrow();
  });

  it("legger inn testoppdragene etter grunndata, med stopp og norsk melding ved feil", () => {
    const seed = code(SEED_COMMAND);
    const testoppdrag = code(SEED_TESTOPPDRAG_COMMAND);
    expect(seed).toBeGreaterThan(-1);
    expect(testoppdrag).toBeGreaterThan(seed);
    const line = lines[testoppdrag]!;
    expect(line).toMatch(/\|\|\s*stopp\s+"[^"]*testoppdrag[^"]*feilet\.?"/);
    expect(lines.filter((l) => SEED_TESTOPPDRAG_COMMAND.test(l))).toHaveLength(1);
  });

  it("bruker ingen bash 4-ting (bash 3.2 på Mac)", () => {
    const codeLines = lines.filter((line) => !/^\s*#/.test(line));
    for (const line of codeLines) {
      expect(line).not.toMatch(/declare\s+-A/);
      expect(line).not.toMatch(/\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)\}/);
      expect(line).not.toMatch(/\b(mapfile|readarray)\b/);
    }
  });

  // M10.1 (docs/funksjoner/fase2a-microsoft-innlogging-testplan.md): Microsoft-innloggingen legges
  // til tomme i en eldre .env, i den samme løkken som e-postverdiene. Ingen egen sjekk.
  it("legger de tre verdiene for Microsoft-innloggingen inn i løkken for valgfrie verdier", () => {
    const loops = lines.filter((line) => /^\s*for\s+navn\s+in\s+MS_GRAPH_TENANT_ID\b/.test(line));
    expect(loops).toHaveLength(1);
    const names = loops[0]!
      .replace(/^\s*for\s+navn\s+in\s+/, "")
      .replace(/;\s*do\s*$/, "")
      .split(/\s+/);
    for (const name of [
      "MS_GRAPH_TENANT_ID",
      "MS_GRAPH_CLIENT_ID",
      "MS_GRAPH_CLIENT_SECRET",
      "MAIL_FROM",
      "MS_LOGIN_TENANT_ID",
      "MS_LOGIN_CLIENT_ID",
      "MS_LOGIN_CLIENT_SECRET",
    ]) {
      expect(names, name).toContain(name);
    }
    // Ingen ny sjekk som stopper skriptet når verdiene mangler
    const mentions = lines.filter((line) => !/^\s*#/.test(line) && line.includes("MS_LOGIN_"));
    expect(mentions).toEqual(loops);
  });

  it(".env.example har de tre verdiene for Microsoft-innloggingen uten verdier (M10.3)", () => {
    const example = read(".env.example").split("\n");
    for (const name of ["MS_LOGIN_TENANT_ID", "MS_LOGIN_CLIENT_ID", "MS_LOGIN_CLIENT_SECRET"]) {
      expect(
        example.filter((line) => line.startsWith(`${name}=`)),
        name,
      ).toEqual([`${name}=`]);
    }
  });

  it("Start EzProp.command kjører bare start.sh, uten egne seed-linjer", () => {
    const command = read("Start EzProp.command");
    expect(command).toContain("./start.sh");
    expect(command).not.toContain("db:seed");
  });
});
