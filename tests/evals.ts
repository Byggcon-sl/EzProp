import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT_INPUT_SEPARATOR } from "@/core/ai/features";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "@/core/ai/providers/types";

/*
 * Testhjelpere for evalueringssettet (docs/funksjoner/fase2a-evalueringssett-testplan.md).
 * Bare i testene. Alle tekster og verdier er oppdiktet.
 *
 * Avtalen med utvikler: `src/core/ai/evals/run.ts` har `runEvals({ provider, casesDir, feature? })`
 * og `runEvalCommand(argv, casesDir, provider) → { exitCode, lines }`. Settet ligger som
 * `<funksjon>.cases.json` i mappen.
 */

export const EVAL_STATUS = "utkast, ikke godkjent av fagrådet";
export const EVAL_NOTE =
  "Bare oppdiktet tekst, aldri kopi av ekte rapporttekst eller ai_usage_log. Prøvedata for KI, brukes aldri som avvikstekst, seed-data eller mal.";

export type EvalCaseJson = {
  id: string;
  description?: string;
  fields: Record<string, string>;
  known?: Record<string, unknown>;
  mustPass?: boolean;
  expect: {
    outcome: "ok" | "no_match";
    mustContain?: string[];
    mustNotContain?: string[];
    sameTg?: boolean;
  };
};

/** Et vanlig eksempel som treffer mot en leverandør som gjentar teksten. */
export function evalCase(id: string, overrides: Partial<EvalCaseJson> = {}): EvalCaseJson {
  return {
    id,
    fields: { text: `Oppdiktet tekst ${id} om taket.` },
    expect: { outcome: "ok", mustContain: ["taket"] },
    ...overrides,
  };
}

/** `count` eksempler med id-ene `${prefix}-01` osv. `change` kan endre hvert av dem. */
export function evalCases(
  count = 30,
  prefix = "t",
  change: (item: EvalCaseJson, index: number) => EvalCaseJson = (item) => item,
): EvalCaseJson[] {
  return Array.from({ length: count }, (_, index) =>
    change(evalCase(`${prefix}-${String(index + 1).padStart(2, "0")}`), index),
  );
}

export function evalFile(cases: EvalCaseJson[], feature = "language_polish") {
  return { feature, status: EVAL_STATUS, note: EVAL_NOTE, cases };
}

/** Lager en midlertidig mappe med filene (navn → innhold; objekter blir JSON). */
export function makeCasesDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "ezprop-evals-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      join(dir, name),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
      "utf8",
    );
  }
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Teksten fra den ansatte i ledeteksten (etter skillet). */
export function inputOfPrompt(prompt: string): string {
  const index = prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR);
  return index === -1 ? prompt : prompt.slice(index + PROMPT_INPUT_SEPARATOR.length);
}

export function okResult(text: string): AiProviderResult {
  return { outcome: "ok", text, tokensIn: 1, tokensOut: 1, cost: 0, currency: "NOK" };
}

/**
 * En testleverandør. `answer` får teksten etter skillet og hele forespørselen og gir svaret.
 * Alle ledetekster den fikk, står i `prompts`.
 */
export function testProvider(
  answer: (
    input: string,
    request: AiProviderRequest,
  ) => AiProviderResult | Promise<AiProviderResult>,
): AiProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    code: "test_provider",
    model: "test-v1",
    prompts,
    async complete(request: AiProviderRequest) {
      prompts.push(request.prompt);
      return answer(inputOfPrompt(request.prompt), request);
    },
  };
}

/** Pakker inn en leverandør og tar vare på ledetekstene den fikk. */
export function capturing(inner: AiProvider): AiProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    code: inner.code,
    model: inner.model,
    prompts,
    complete(request: AiProviderRequest) {
      prompts.push(request.prompt);
      return inner.complete(request);
    },
  };
}

/** Normalisert for sammenligning: NFC, små bokstaver, alle mellomromstyper slått sammen. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s   ]+/gu, " ")
    .trim();
}

/** Om verdien står som hele ord i teksten (Unicode-grenser, normalisert). */
export function hasWholeWord(text: string, word: string): boolean {
  const value = normalizeForCompare(word);
  if (value === "") return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(
    normalizeForCompare(text),
  );
}

/** Om sifrene står i teksten i rekkefølge, med hva som helst som ikke er bokstav eller siffer mellom. */
export function hasDigits(text: string, digits: string): boolean {
  if (digits.length < 4) return false;
  const source = digits.split("").join("[^\\p{L}\\p{N}]*");
  return new RegExp(`(?<!\\p{N})${source}(?!\\p{N})`, "u").test(text.normalize("NFC"));
}
