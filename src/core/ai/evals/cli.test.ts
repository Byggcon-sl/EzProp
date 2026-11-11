import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evalCases,
  evalFile,
  inputOfPrompt,
  makeCasesDir,
  okResult,
  removeDir,
  testProvider,
  type EvalCaseJson,
} from "../../../../tests/evals";
import { fakeAiProvider } from "../providers/fake";
import { runEvalCommand } from "./run";

/*
 * Kommandoen `pnpm ai:eval [funksjon]` (docs/funksjoner/fase2a-evalueringssett-testplan.md
 * avsnitt 3, kortet Omfang 4). Mot `runEvalCommand(argv, casesDir, provider)` med en midlertidig
 * mappe, og én røyktest som starter kommandoen uten database. Alle tekster og verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (kommandoen stopper på oppsett, krasj og persondata, og den
 * skriver aldri verdier eller svar) og de ansatte (bare prøvde funksjoner slås på).
 */

const repoRoot = join(__dirname, "..", "..", "..", "..");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDir(dirs.pop()!);
});

function dirWith(files: Record<string, unknown>): string {
  const dir = makeCasesDir(files);
  dirs.push(dir);
  return dir;
}

function polishDir(cases: EvalCaseJson[]): string {
  return dirWith({ "language_polish.cases.json": evalFile(cases) });
}

describe("evalueringssett: kommandoen (E3)", () => {
  it("E3.1 ukjent funksjon gir kode 1 og norsk melding", async () => {
    const { exitCode, lines } = await runEvalCommand(
      ["finnes_ikke"],
      polishDir(evalCases()),
      fakeAiProvider,
    );
    expect(exitCode).toBe(1);
    const text = lines.join("\n");
    expect(text).toMatch(/ukjent/iu);
    expect(text).toContain("finnes_ikke");
  });

  it("E3.2 ugyldig JSON gir kode 1 og nevner filnavnet", async () => {
    const dir = dirWith({ "language_polish.cases.json": '{ "feature": "language_polish", ' });
    for (const argv of [[], ["language_polish"]]) {
      const { exitCode, lines } = await runEvalCommand(argv, dir, fakeAiProvider);
      expect(exitCode, argv.join(" ")).toBe(1);
      expect(lines.join("\n")).toContain("language_polish.cases.json");
    }
  });

  it("E3.2 fil som ikke følger skjemaet gir kode 1 og nevner filnavnet", async () => {
    const dir = dirWith({ "language_polish.cases.json": evalFile(evalCases(29)) });
    const { exitCode, lines } = await runEvalCommand([], dir, fakeAiProvider);
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("language_polish.cases.json");
  });

  it("E3.3 duplisert id gir kode 1 og nevner id-en", async () => {
    const cases = evalCases(30, "t", (item, index) =>
      index === 9 || index === 20 ? { ...item, id: "t-dobbel" } : item,
    );
    const { exitCode, lines } = await runEvalCommand([], polishDir(cases), fakeAiProvider);
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("t-dobbel");
  });

  it("E3.4 leverandøren kaster gir kode 1", async () => {
    const provider = testProvider((input) => {
      if (input.includes("t-07")) throw new Error("oppdiktet krasj");
      return okResult(input);
    });
    const { exitCode, lines } = await runEvalCommand([], polishDir(evalCases()), provider);
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("t-07");
    expect(lines.join("\n")).not.toContain("oppdiktet krasj");
  });

  it.each([
    {
      name: "navn på to tegn (A174)",
      text: "Li ringte om taket.",
      known: { personNames: ["Bo Li"] },
      value: "Li",
      type: "navn",
    },
    {
      name: "telefon med skilletegn vasken ikke tar",
      text: "Ring 12 - 34 - 56 - 78 om taket.",
      known: { phones: ["12345678"] },
      value: "12 - 34 - 56 - 78",
      type: "telefon",
    },
  ])(
    "E3.5 persondata i teksten til leverandøren ($name) gir kode 1, id og type, aldri verdien",
    async ({ text, known, value, type }) => {
      const cases = evalCases(30, "t", (item, index) =>
        index === 11 ? { ...item, fields: { text }, known } : item,
      );
      const provider = testProvider((input) => okResult(input));
      const { exitCode, lines } = await runEvalCommand([], polishDir(cases), provider);
      // Lekkasjen fanges før kallet: verdien når aldri leverandøren (gjennomgang 11.11.2026)
      expect(provider.prompts).toHaveLength(29);
      expect(
        provider.prompts.map(inputOfPrompt).some((input) => input.includes(value)),
        "verdien skal ikke nå leverandøren",
      ).toBe(false);
      expect(exitCode).toBe(1);
      const leakLine = lines.find((line) => line.includes("t-12"));
      expect(leakLine, "linjen med eksempel-id").toBeDefined();
      expect(leakLine).toContain(type);
      for (const line of lines) {
        expect(line).not.toContain(value);
        expect(line).not.toContain("Bo Li");
        expect(line.replace(/\D/gu, "")).not.toContain("12345678");
      }
    },
  );

  it("E3.6 lav treffprosent og bom på mustPass mot den falske leverandøren gir kode 0 (A183)", async () => {
    const cases = evalCases(30, "t", (item) => ({
      ...item,
      mustPass: true,
      expect: { outcome: "ok", mustContain: ["vindskier"] },
    }));
    const { exitCode, lines } = await runEvalCommand([], polishDir(cases), fakeAiProvider);
    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toMatch(/mustPass\D*0 av 30/u);
  });

  it("E3.7 uten argument kjøres alle *.cases.json i mappen", async () => {
    const miss = (item: EvalCaseJson, index: number) =>
      index === 0
        ? { ...item, expect: { outcome: "ok" as const, mustContain: ["vindskier"] } }
        : item;
    const dir = dirWith({
      "language_polish.cases.json": evalFile(evalCases(30, "a", miss)),
      "language_polish_ekstra.cases.json": evalFile(evalCases(31, "b", miss)),
      "ikke-et-sett.json": { feature: "finnes_ikke" },
    });
    const { exitCode, lines } = await runEvalCommand([], dir, fakeAiProvider);
    expect(exitCode).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("a-01");
    expect(text).toContain("b-01");
    expect(text).toMatch(/\b30\b/u);
    expect(text).toMatch(/\b31\b/u);
  });

  it("E3.8 utskriften på norsk har antall, treff, treffprosent, grensen og mustPass, og id og grunn for hvert bom", async () => {
    const cases = evalCases(30, "t", (item, index) => {
      if (index < 4) return { ...item, mustPass: true };
      if (index === 4) return { ...item, expect: { outcome: "ok", mustContain: ["vindskier"] } };
      if (index === 5) return { ...item, expect: { outcome: "ok", mustNotContain: ["taket"] } };
      return item;
    });
    const { exitCode, lines } = await runEvalCommand(
      ["language_polish"],
      polishDir(cases),
      fakeAiProvider,
    );
    expect(exitCode).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("language_polish");
    expect(text).toMatch(/\b30\b[^\n]*eksempler/u);
    expect(text).toMatch(/\b28\b[^\n]*treff/u);
    expect(text).toMatch(/treffprosent[^\n]*93(?:,3)?\s?%/u);
    expect(text).toMatch(/grense[^\n]*90\s?%/u);
    expect(text).toMatch(/mustPass\D*4 av 4/u);
    const missLine = (id: string) => lines.find((line) => line.includes(id));
    expect(missLine("t-05")).toContain("vindskier");
    expect(missLine("t-06")).toContain("taket");
    expect(missLine("t-07")).toBeUndefined();
  });

  it("E3.9 svaret fra leverandøren står aldri i utskriften", async () => {
    const marker = "Svarmarkør-zqx-4711";
    const cases = evalCases(30, "t", (item, index) =>
      index < 3
        ? { ...item, expect: { outcome: "ok", mustContain: ["vindskier"], sameTg: true } }
        : item,
    );
    const provider = testProvider(() => okResult(`${marker} TG3 ${marker}`));
    const { lines } = await runEvalCommand([], polishDir(cases), provider);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(marker);
  });

  it("E3.10 røyktest: pnpm ai:eval kjører uten DATABASE_URL og gir kode 0 med language_polish", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    const result = spawnSync("pnpm", ["--silent", "ai:eval"], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      timeout: 55_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("language_polish");
  }, 60_000);

  it("E3.11 scripts/ai-eval.ts bruker fakeAiProvider fast: ingen process.env, ingen resolveAiProvider, intet valg av leverandør", () => {
    const file = join(repoRoot, "scripts", "ai-eval.ts");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/\bfakeAiProvider\b/u);
    expect(source).toMatch(/\brunEvalCommand\s*\(/u);
    expect(source).not.toMatch(/process\.env/u);
    expect(source).not.toMatch(/\bresolveAiProvider\b/u);
    expect(source).not.toMatch(/--provider|provider\s*=|PROVIDER/u);
    expect(source).not.toMatch(/readSecret|ANTHROPIC|fetch\s*\(/u);
    // Kommandoen står i package.json
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["ai:eval"]).toMatch(/scripts\/ai-eval\.ts/u);
  });
});
