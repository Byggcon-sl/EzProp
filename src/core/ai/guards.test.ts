import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARD_CASES,
  NEGATION_CASES,
  NUMBER_GUARD_POLISH_CASES,
  PLACEHOLDER_GUARD_POLISH_CASES,
  SUMMARY_GUARD_CASES,
  TG_GUARD_POLISH_CASES,
  type GuardCase,
} from "./guard-cases";

/*
 * K1.1–K1.6c: vaktene på KI-svaret (docs/funksjoner/fase2a-ki-i-veien-testplan.md avsnitt 1a).
 * Ren test uten database. Testsakene står som data i `guard-cases.ts` og brukes også av
 * evalueringen (K2.1).
 *
 * Avtalen (src/core/ai/types.ts): `src/core/ai/guards.ts` eksporterer `checkAnswerGuards`
 * (`CheckAnswerGuards`), `restorePlaceholders` (`RestorePlaceholders`) og `extractTgMentions`.
 *
 * Støtter hovedmål: KI i bunnen og færre reklamasjoner (KI-svar som endrer TG, legger til tall,
 * mister funn eller bytter skjulte opplysninger, når aldri skjermen).
 */

type GuardsModule = {
  checkAnswerGuards: (input: {
    feature: string;
    sent: GuardCase["sent"];
    answer: GuardCase["answer"];
  }) => string | null;
  restorePlaceholders: (
    answer: string,
    originals: readonly { placeholder: string; value: string }[],
  ) => string;
  extractTgMentions: (text: string) => string[];
};

async function guards(): Promise<GuardsModule> {
  return (await import("./guards")) as unknown as GuardsModule;
}

const check = async (c: GuardCase) =>
  (await guards()).checkAnswerGuards({ feature: c.feature, sent: c.sent, answer: c.answer });

describe("K1.1 extractTgMentions er flyttet til kjernen", () => {
  it("K1.1 evalueringen har ingen egen kopi og importerer fra kjernen", () => {
    const evalsDir = join(__dirname, "evals");
    for (const name of readdirSync(evalsDir).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n))) {
      const source = readFileSync(join(evalsDir, name), "utf8");
      expect(source, name).not.toMatch(/function\s+extractTgMentions\b/);
      expect(source, name).not.toMatch(/const\s+extractTgMentions\s*=/);
    }
    const run = readFileSync(join(evalsDir, "run.ts"), "utf8");
    expect(run).toMatch(/import[^;]*extractTgMentions[^;]*from\s+["'](\.\.\/guards|@\/core\/ai\/guards)["']/s);
  });

  it.each([
    ["TG2", 1],
    ["TG 3", 1],
    ["tilstandsgrad 2", 1],
    ["TGIU", 1],
    ["TG IU", 1],
    ["ikke undersøkt", 1],
    ["tg2 og Tg3", 2],
    ["STG2", 0],
    ["TG23", 0],
    ["Fuktmåling i kjelleren", 0],
  ])("K1.1 «%s» gir %i treff", async (text, count) => {
    expect((await guards()).extractTgMentions(text)).toHaveLength(count);
  });

  it("K1.1 store og små bokstaver og mellomrom gir samme omtale", async () => {
    const { extractTgMentions } = await guards();
    expect(extractTgMentions("tg2")).toEqual(extractTgMentions("TG 2"));
    expect(extractTgMentions("tgiu")).toEqual(extractTgMentions("TG IU"));
  });

  it("K1.1 «ikke undersøkt» regnes som TGIU", async () => {
    const { extractTgMentions } = await guards();
    expect(extractTgMentions("Veggen er ikke undersøkt.")).toEqual(extractTgMentions("TGIU"));
    expect(extractTgMentions("Veggen er IKKE UNDERSØKT.")).toEqual(extractTgMentions("TGIU"));
  });
});

describe("K1.2 TG-vakten, language_polish", () => {
  it.each(TG_GUARD_POLISH_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect(await check(c)).toBe(c.expected);
  });
});

describe("K1.3 og K1.6a vaktene på sammendraget, summary_draft", () => {
  it.each(SUMMARY_GUARD_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect(await check(c)).toBe(c.expected);
  });
});

describe("K1.4 tallvakten, language_polish", () => {
  it.each(NUMBER_GUARD_POLISH_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect(await check(c)).toBe(c.expected);
  });
});

describe("K1.6b plassholderne (A466)", () => {
  it.each(PLACEHOLDER_GUARD_POLISH_CASES.map((c) => [c.name, c] as const))(
    "%s",
    async (_name, c) => {
      expect(await check(c)).toBe(c.expected);
    },
  );

  it("K1.6b plassholderne byttes tilbake per type i rekkefølge", async () => {
    const { restorePlaceholders } = await guards();
    expect(
      restorePlaceholders("[navn] og [navn] var til stede i [adresse].", [
        { placeholder: "[navn]", value: "Åse Testesen" },
        { placeholder: "[adresse]", value: "Testveien 1" },
        { placeholder: "[navn]", value: "Ola Prøvesen" },
      ]),
    ).toBe("Åse Testesen og Ola Prøvesen var til stede i Testveien 1.");
  });

  it.each([
    ["Ås", "Sluket i [adresse] er skiftet.", "Sluket i Ås er skiftet."],
    ["Berg", "[navn] opplyste om sluket.", "Berg opplyste om sluket."],
    ["1985 Bad", "Membranen er fra [adresse].", "Membranen er fra 1985 Bad."],
  ])("K1.6b kjent overvask («%s») kommer tilbake slik den sto", async (value, answer, expected) => {
    const { restorePlaceholders } = await guards();
    const placeholder = answer.includes("[navn]") ? "[navn]" : "[adresse]";
    expect(restorePlaceholders(answer, [{ placeholder, value }])).toBe(expected);
  });

  it("K1.6b restorePlaceholders kaster når antallet ikke stemmer", async () => {
    const { restorePlaceholders } = await guards();
    expect(() =>
      restorePlaceholders("[navn] og [navn] var der.", [
        { placeholder: "[navn]", value: "Åse Testesen" },
      ]),
    ).toThrow();
  });
});

describe("K1.5 vaktene gjelder ikke phrase_suggest", () => {
  it("K1.5 checkAnswerGuards slipper alt gjennom for phrase_suggest (svaret er bare merker)", async () => {
    const { checkAnswerGuards } = await guards();
    expect(
      checkAnswerGuards({
        feature: "phrase_suggest",
        sent: [{ label: null, texts: ["Fallet er for lite."] }],
        answer: [{ label: null, text: "TG3 1985" }],
      }),
    ).toBeNull();
  });
});

describe("K1.6c kjente saker uten vakt (spørsmål 103)", () => {
  it.each(NEGATION_CASES.map((c) => [c.name, c] as const))(
    "%s: vakten slipper den gjennom i dag, evalueringen skal ikke godta den",
    async (_name, c) => {
      expect(await check(c)).toBeNull();
      expect(c.evalPasses).toBe(false);
    },
  );
});

describe("K2.1 sakene er data og ikke hule", () => {
  it("K2.1 alle fire vaktkodene og «slipper gjennom» har saker", () => {
    const codes = new Set(GUARD_CASES.map((c) => c.expected));
    for (const code of [null, "tg_guard", "number_guard", "coverage_guard", "placeholder_guard"]) {
      expect(codes.has(code as never), String(code)).toBe(true);
    }
  });

  it("K2.1 begge funksjonene har saker, og navnene er unike", () => {
    expect(GUARD_CASES.some((c) => c.feature === "language_polish")).toBe(true);
    expect(GUARD_CASES.some((c) => c.feature === "summary_draft")).toBe(true);
    const names = GUARD_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("K2.1 en snudd forventning gjør saken rød", async () => {
    const stops = GUARD_CASES.find((c) => c.expected === "tg_guard")!;
    expect(await check(stops)).not.toBeNull();
    const passes = GUARD_CASES.find((c) => c.expected === null)!;
    expect(await check(passes)).toBeNull();
  });

  it("K2.1 sakene har ingen gjetteord eller standardhenvisninger", () => {
    const all = JSON.stringify([...GUARD_CASES, ...NEGATION_CASES]);
    expect(all).not.toMatch(/\b(antas|trolig|sannsynligvis)\b/iu);
    expect(all).not.toMatch(/NS ?3600|IVIT|SmartTakst/u);
  });
});
