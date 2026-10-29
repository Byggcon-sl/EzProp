import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Sjekken av secrets for synktjenestene før Bicep valideres (deploy-azure.yml).
 * Testplan: docs/funksjoner/fase1-synk-i-azure-testplan.md, avsnitt 5.
 * Alle verdier er oppdiktede. Skriptet skal nevne navnet på det som mangler, aldri verdien.
 */

const SCRIPT = path.resolve(process.cwd(), "scripts/azure/check-sync-secrets.sh");

const NAMES = [
  "POWERSYNC_JWT_SECRET",
  "POWERSYNC_DB_PASSWORD",
  "ELECTRIC_SECRET",
  "ELECTRIC_DB_PASSWORD",
] as const;
type SecretName = (typeof NAMES)[number];

// Oppdiktede, men gyldige verdier: passord bare bokstaver og tall, 24 tegn; nøkler minst 32 tegn.
const VALID: Record<SecretName, string> = {
  POWERSYNC_JWT_SECRET: "oppdiktet-powersync-nokkel-0123456789abcdef",
  POWERSYNC_DB_PASSWORD: "a1".repeat(12),
  ELECTRIC_SECRET: "oppdiktet-electric-nokkel-0123456789abcdef",
  ELECTRIC_DB_PASSWORD: "b2".repeat(12),
};

interface Run {
  status: number | null;
  output: string;
}

/** Kjører skriptet med et miljø bygget fra bunnen: bare PATH, HOME og det testen setter. */
function run(env: Record<string, string>): Run {
  const result = spawnSync("bash", [SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      ...env,
    } as Record<string, string | undefined> as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Ingen av verdiene som ble satt (unntatt bryteren), står i utskriften. */
function expectNoValues(result: Run, env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) {
    if (name === "ENABLE_SYNC_TRIAL" || value === "") continue;
    expect(result.output, `verdien til ${name} står i utskriften`).not.toContain(value);
  }
}

describe("check-sync-secrets.sh", () => {
  it("skriptet finnes", () => {
    expect(existsSync(SCRIPT), SCRIPT).toBe(true);
  });

  it("bryter av gir ok uten secrets", () => {
    const withoutSwitch = run({});
    expect(withoutSwitch.status, withoutSwitch.output).toBe(0);
    for (const value of ["false", "TRUE", "ja", "", "1", "true "]) {
      const result = run({ ENABLE_SYNC_TRIAL: value });
      expect(result.status, `ENABLE_SYNC_TRIAL=«${value}»: ${result.output}`).toBe(0);
    }
  });

  it.each(NAMES)("bryter på og %s mangler gir exit 1 med navnet", (missing) => {
    const env: Record<string, string> = { ENABLE_SYNC_TRIAL: "true" };
    for (const name of NAMES) if (name !== missing) env[name] = VALID[name];
    const result = run(env);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(missing);
    expect(result.output).toMatch(/mangler/i);
    expectNoValues(result, env);

    // Tom verdi er det samme som at den mangler.
    const emptyEnv = { ...env, [missing]: "" };
    const empty = run(emptyEnv);
    expect(empty.status, empty.output).toBe(1);
    expect(empty.output).toContain(missing);
    expectNoValues(empty, emptyEnv);
  });

  it("aldri verdiene i utskriften", () => {
    const env: Record<string, string> = { ENABLE_SYNC_TRIAL: "true", ...VALID };
    const ok = run(env);
    expectNoValues(ok, env);
    for (const name of ["POWERSYNC_DB_PASSWORD", "ELECTRIC_DB_PASSWORD"] as const) {
      const badEnv = { ...env, [name]: "oppdiktet@passord/med%tegn 0123456789" };
      const bad = run(badEnv);
      expect(bad.status).toBe(1);
      expectNoValues(bad, badEnv);
    }
  });

  describe.each(["POWERSYNC_DB_PASSWORD", "ELECTRIC_DB_PASSWORD"] as const)("%s", (name) => {
    it("DB-passord som ikke bare er bokstaver og tall stopper", () => {
      for (const sign of ["@", "/", "%", " ", ":", "-"]) {
        const value = `${"c3".repeat(12)}${sign}x`;
        const env: Record<string, string> = { ENABLE_SYNC_TRIAL: "true", ...VALID, [name]: value };
        const result = run(env);
        expect(result.status, `tegnet «${sign}»: ${result.output}`).toBe(1);
        expect(result.output).toContain(name);
        expectNoValues(result, env);
      }
    });

    it("DB-passord under 24 tegn stopper", () => {
      const short = `${"d4".repeat(11)}e`; // 23 tegn
      expect(short).toHaveLength(23);
      const shortEnv: Record<string, string> = {
        ENABLE_SYNC_TRIAL: "true",
        ...VALID,
        [name]: short,
      };
      const result = run(shortEnv);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(name);
      expectNoValues(result, shortEnv);

      const exact = "d4".repeat(12); // 24 tegn
      const exactEnv = { ...shortEnv, [name]: exact };
      const ok = run(exactEnv);
      expect(ok.status, ok.output).toBe(0);
    });
  });

  // Småfunn etter PR #17: JWT- og Electric-hemmeligheten må ha minst 32 tegn.
  describe.each(["POWERSYNC_JWT_SECRET", "ELECTRIC_SECRET"] as const)("%s", (name) => {
    it(`${name} under 32 tegn stopper`, () => {
      const short = `oppdiktet-${"k".repeat(21)}`; // 31 tegn
      expect(short).toHaveLength(31);
      const env: Record<string, string> = { ENABLE_SYNC_TRIAL: "true", ...VALID, [name]: short };
      const result = run(env);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(name);
      expectNoValues(result, env);
    });
  });

  it("JWT- og Electric-hemmelighet med nøyaktig 32 tegn gir exit 0", () => {
    const jwt = `oppdiktet-jwt-${"j".repeat(18)}`;
    const electric = `oppdiktet-el-${"e".repeat(19)}`;
    expect(jwt).toHaveLength(32);
    expect(electric).toHaveLength(32);
    const env: Record<string, string> = {
      ENABLE_SYNC_TRIAL: "true",
      ...VALID,
      POWERSYNC_JWT_SECRET: jwt,
      ELECTRIC_SECRET: electric,
    };
    const result = run(env);
    expect(result.status, result.output).toBe(0);
    expectNoValues(result, env);
  });

  it("32 tegn med spesialtegn gir exit 0", () => {
    const jwt = "oppdiktet/jwt-nokkel/med-tegn-01";
    const electric = "oppdiktet-el/nokkel-med/tegn-012";
    expect(jwt).toHaveLength(32);
    expect(electric).toHaveLength(32);
    const env: Record<string, string> = {
      ENABLE_SYNC_TRIAL: "true",
      ...VALID,
      POWERSYNC_JWT_SECRET: jwt,
      ELECTRIC_SECRET: electric,
    };
    const result = run(env);
    expect(result.status, result.output).toBe(0);
    expectNoValues(result, env);
  });

  it("alle satt gir exit 0", () => {
    const env: Record<string, string> = { ENABLE_SYNC_TRIAL: "true", ...VALID };
    const result = run(env);
    expect(result.status, result.output).toBe(0);
    expectNoValues(result, env);
  });

  it("virker med bash 3.2", () => {
    const syntax = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    const text = readFileSync(SCRIPT, "utf8");
    const firstLine = text.split("\n")[0];
    expect(["#!/usr/bin/env bash", "#!/bin/bash"]).toContain(firstLine);
    const code = text
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).not.toMatch(/declare\s+-A/);
    expect(code).not.toMatch(/\bmapfile\b/);
    expect(code).not.toMatch(/\breadarray\b/);
    expect(code).not.toMatch(/\$\{[^}]*,,\}/);
    expect(code).not.toMatch(/\$\{[^}]*\^\^\}/);
    expect(code).not.toContain(";&");
    expect(code).not.toMatch(/\bset\s+-[A-Za-z]*x/);
    expect(code).not.toMatch(/set\s+-o\s+xtrace/);
  });
});
