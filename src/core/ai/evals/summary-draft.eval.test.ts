import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactPii } from "@/shared/lib/pii-patterns";
import { capturing, hasWholeWord, inputOfPrompt } from "../../../../tests/evals";
import { extractTgMentions } from "../guards";
import { fakeAiProvider } from "../providers/fake";
import {
  EVAL_CONCLUSION_PHRASES,
  EVAL_GRADING_WORDS,
  EVAL_GUESS_WORDS,
  evaluateSummaryAnswer,
  runEvals,
  summaryAnswerParts,
  summaryInputOf,
} from "./run";
import { parseCasesFile, type SummaryEvalCase } from "./schema";

/*
 * Settet for `summary_draft` (docs/funksjoner/fase2a-ki-i-veien-testplan.md K2.3 og K2.3a). Ren
 * test, ingen database. Testen leser selve filen og prøver at sakene kortet krever finnes, at
 * funnene er rene, at TGIU-linjene aldri går til KI, og at resultatet mot den falske leverandøren
 * er låst.
 *
 * Støtter hovedmål: færre reklamasjoner (ingen funn mangler eller legges til, ingen TG, nye tall,
 * gjetteord, graderingsord eller samlekonklusjon i KI-teksten) og KI i bunnen (utkastet kan måles
 * før ekte KI slås på).
 */

const FILE_NAME = "summary_draft.cases.json";
const raw = readFileSync(join(__dirname, FILE_NAME), "utf8");
const json = JSON.parse(raw) as { feature: string; status: string; note: string };
const parsed = parseCasesFile(JSON.parse(raw) as unknown, FILE_NAME);
const cases: SummaryEvalCase[] =
  parsed.ok && parsed.file.feature === "summary_draft" ? parsed.file.cases : [];

type Finding = Extract<
  SummaryEvalCase["groups"][number],
  { findings: unknown }
>["findings"][number];

function findingsOf(item: SummaryEvalCase): Finding[] {
  return item.groups.flatMap((group) => ("findings" in group ? group.findings : []));
}

function findingText(finding: Finding): string {
  return [
    finding.checkpointName,
    finding.deviationText,
    finding.causeText,
    finding.consequenceText,
    ...finding.measures,
  ]
    .filter((text) => text !== null)
    .join("\n");
}

function fixedLinesOf(item: SummaryEvalCase) {
  return item.groups.flatMap((group) => ("fixedLines" in group ? group.fixedLines : []));
}

const stoppedBy = (guard: string) =>
  cases.filter((item) => item.expect.outcome === "stopped" && item.expect.guard === guard);

const failing = cases.filter(
  (item) => item.expect.outcome === "ok" && item.expect.verdict === "fail",
);

const NUMBER = /\d+(?:[.,]\d+)?/gu;

describe("evalueringssett: settet for summary_draft (K2.3)", () => {
  it("K2.3 filen er gyldig, har 30–50 saker med unike id-er og er merket utkast", () => {
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(json.feature).toBe("summary_draft");
    expect(json.status).toBe("utkast, ikke godkjent av fagrådet");
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.length).toBeLessThanOrEqual(50);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("K2.3 alle fire grupper er prøvd, og minst én sak har alle fire i rekkefølgen TG3, TG2, TGIU, HMS", () => {
    const groups = new Set(cases.flatMap((item) => item.groups.map((group) => group.group)));
    expect([...groups].sort()).toEqual(["hms", "tg2", "tg3", "tgiu"]);
    expect(
      cases.some(
        (item) => item.groups.map((group) => group.group).join(",") === "tg3,tg2,tgiu,hms",
      ),
    ).toBe(true);
  });

  it("K2.3 funnene er rene: ingen TG, gjetteord, graderingsord, samlekonklusjon eller henvisning", () => {
    const problems: string[] = [];
    for (const item of cases) {
      const texts = [
        ...findingsOf(item).map(findingText),
        ...fixedLinesOf(item).map((l) => l.text),
      ];
      for (const text of texts) {
        if (extractTgMentions(text).length > 0) problems.push(`${item.id}: TG`);
        for (const word of [
          ...EVAL_GUESS_WORDS,
          ...EVAL_GRADING_WORDS,
          ...EVAL_CONCLUSION_PHRASES,
        ]) {
          if (hasWholeWord(text, word)) problems.push(`${item.id}: ${word}`);
        }
        if (/(?<![\p{L}])NS(?![\p{L}])|ivit|smarttakst/iu.test(text)) {
          problems.push(`${item.id}: henvisning`);
        }
        if (redactPii(text).count > 0) problems.push(`${item.id}: persondata`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("K2.3 TG byttet mellom to funn: stoppes med tg_guard", () => {
    const swapped = stoppedBy("tg_guard").filter((item) => {
      const answer = item.simulatedAnswer ?? [];
      const mentions = answer.map((part) => extractTgMentions(part.text));
      return (
        item.groups.some((g) => g.group === "tg3") &&
        item.groups.some((g) => g.group === "tg2") &&
        mentions.filter((list) => list.length > 0).length >= 2
      );
    });
    expect(swapped.length).toBeGreaterThan(0);
  });

  it("K2.3 hulltaking nektet av eier: TGIU-linje fra koden, aldri TG2 eller «uten funn»", () => {
    const refused = cases.filter((item) =>
      fixedLinesOf(item).some(
        (line) => /hulltaking/iu.test(line.text) && /nektet/iu.test(line.text),
      ),
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const item of refused) {
      // Punktet står i TGIU-gruppen, aldri som et TG2-funn
      expect(
        findingsOf(item).some((finding) => /hulltaking/iu.test(finding.checkpointName)),
        item.id,
      ).toBe(false);
      const answer = (item.simulatedAnswer ?? []).map((part) => part.text).join("\n");
      const saysTg2 = extractTgMentions(answer).includes("tg2");
      const saysNoFindings = hasWholeWord(answer, "uten funn");
      if (saysTg2) expect(item.expect, item.id).toEqual({ outcome: "stopped", guard: "tg_guard" });
      if (saysNoFindings) expect(item.expect, item.id).toMatchObject({ verdict: "fail" });
    }
    // Både en vanlig sak (falsk leverandør) og saker der KI prøver TG2 og «uten funn»
    expect(refused.some((item) => item.simulatedAnswer === undefined)).toBe(true);
    expect(
      refused.some((item) =>
        extractTgMentions((item.simulatedAnswer ?? []).map((p) => p.text).join(" ")).includes(
          "tg2",
        ),
      ),
    ).toBe(true);
    expect(
      refused.some((item) =>
        hasWholeWord((item.simulatedAnswer ?? []).map((p) => p.text).join(" "), "uten funn"),
      ),
    ).toBe(true);
  });

  it("K2.3a tall flyttet fra ett funn til et annet: stoppes med number_guard", () => {
    const moved = stoppedBy("number_guard").filter((item) => {
      const { sent } = summaryInputOf(item);
      return (item.simulatedAnswer ?? []).some((part) => {
        const own = sent.find((s) => s.label === part.label)?.texts.join(" ") ?? "";
        const others = sent
          .filter((s) => s.label !== part.label)
          .flatMap((s) => s.texts)
          .join(" ");
        return Array.from(part.text.matchAll(NUMBER), (m) => m[0]).some(
          (n) => !own.includes(n) && others.includes(n),
        );
      });
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it("K2.3a graderingsord som funnet ikke har: består ikke", () => {
    const graded = failing.filter((item) =>
      (item.simulatedAnswer ?? []).some((part) =>
        EVAL_GRADING_WORDS.some((word) => hasWholeWord(part.text, word)),
      ),
    );
    expect(graded.length).toBeGreaterThan(0);
  });

  it("K2.3a ett av tre funn i samme gruppe mangler: stoppes med coverage_guard", () => {
    const skipped = stoppedBy("coverage_guard").filter((item) => {
      const three = item.groups.some((g) => "findings" in g && g.findings.length === 3);
      const labels = (item.simulatedAnswer ?? []).map((part) => part.label);
      return three && labels.length === 2 && labels.every((label) => /^F[1-3]$/u.test(label));
    });
    expect(skipped.length).toBeGreaterThan(0);
  });

  it("K2.3 gjetteord og samlekonklusjon i KI-teksten: består ikke", () => {
    const answerOf = (item: SummaryEvalCase) =>
      (item.simulatedAnswer ?? []).map((part) => part.text).join("\n");
    expect(failing.some((item) => hasWholeWord(answerOf(item), "antas"))).toBe(true);
    expect(
      failing.some((item) =>
        EVAL_CONCLUSION_PHRASES.some((phrase) => hasWholeWord(answerOf(item), phrase)),
      ),
    ).toBe(true);
  });

  it("K2.3 overskriftene og TGIU-linjene sendes aldri til leverandøren (A462)", async () => {
    const provider = capturing(fakeAiProvider);
    const result = await runEvals({ provider, casesDir: __dirname, feature: "summary_draft" });
    expect(result.errors).toEqual([]);
    const real = cases.filter((item) => item.simulatedAnswer === undefined);
    expect(provider.prompts).toHaveLength(real.length);
    real.forEach((item, index) => {
      const input = inputOfPrompt(provider.prompts[index]!);
      for (const line of fixedLinesOf(item)) expect(input, item.id).not.toContain(line.text);
      for (const group of summaryInputOf(item).groups) {
        expect(input, item.id).not.toContain(group.heading);
      }
      expect(extractTgMentions(input), item.id).toEqual([]);
    });
  });

  it("K2.3 låst resultat mot den falske leverandøren", async () => {
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: __dirname,
      feature: "summary_draft",
    });
    expect(result.errors).toEqual([]);
    const feature = result.features[0]!;
    // Endres bare med vilje, i samme PR som settet.
    expect({
      total: feature.total,
      passed: feature.passed,
      mustPassPassed: feature.mustPassPassed,
      misses: feature.misses.map((miss) => miss.id),
      leaks: feature.leaks,
      crashes: feature.crashes,
    }).toEqual({
      total: cases.length,
      passed: cases.length,
      mustPassPassed: cases.filter((item) => item.mustPass).length,
      misses: [],
      leaks: [],
      crashes: [],
    });
  });
});

describe("evalueringssett: vurderingen av sammendraget (K2.3)", () => {
  const sent = [
    { label: "F1", texts: ["Punkt A", "Det er sprekk i fugen."] },
    { label: "F2", texts: ["Punkt B", "Avtrekket er svakt."] },
  ];
  const ok = { outcome: "ok" as const };

  it("K2.3 svar med alle funn i rekkefølge og uten tillegg består", () => {
    const answer = [
      { label: "F1", text: "Fugen har sprekk." },
      { label: "F2", text: "Avtrekket er svakt." },
    ];
    expect(evaluateSummaryAnswer(ok, sent, answer)).toEqual({ passed: true, reasons: [] });
  });

  it.each([
    [
      "rekkefølgen er byttet",
      [
        { label: "F2", text: "Avtrekket er svakt." },
        { label: "F1", text: "Fugen har sprekk." },
      ],
      /rekkefølgen/u,
    ],
    [
      "gjetteord er lagt til",
      [
        { label: "F1", text: "Fugen har trolig sprekk." },
        { label: "F2", text: "Avtrekket er svakt." },
      ],
      /gjetteordet «trolig»/u,
    ],
    [
      "graderingsord er lagt til",
      [
        { label: "F1", text: "Fugen har en vesentlig sprekk." },
        { label: "F2", text: "Avtrekket er svakt." },
      ],
      /graderingsordet «vesentlig»/u,
    ],
    [
      "samlekonklusjon",
      [
        { label: "F1", text: "Fugen har sprekk." },
        { label: "F2", text: "Avtrekket er svakt. Ingen andre avvik." },
      ],
      /samlekonklusjon/u,
    ],
  ])("K2.3 %s: består ikke", (_name, answer, reason) => {
    const result = evaluateSummaryAnswer(ok, sent, answer);
    expect(result.passed).toBe(false);
    expect(result.reasons.join("; ")).toMatch(reason);
  });

  it("K2.3 graderingsord som står i funnet, er lov", () => {
    const graded = [{ label: "F1", texts: ["Punkt A", "Det er en vesentlig sprekk."] }];
    const answer = [{ label: "F1", text: "Sprekken er vesentlig." }];
    expect(evaluateSummaryAnswer(ok, graded, answer).passed).toBe(true);
  });

  it("K2.3 svaret leses som JSON-objekt, JSON-liste eller linjer med F-merker", () => {
    const expected = [
      { label: "F1", text: "Første." },
      { label: "F2", text: "Andre." },
    ];
    expect(summaryAnswerParts('{"F1":"Første.","F2":"Andre."}')).toEqual(expected);
    expect(
      summaryAnswerParts('[{"label":"F1","text":"Første."},{"label":"F2","text":"Andre."}]'),
    ).toEqual(expected);
    expect(summaryAnswerParts("F1: Første.\nF2: Andre.")).toEqual(expected);
  });

  it("K2.3 tekst uten F-merke får merket null, så dekningsvakten stopper den", () => {
    expect(summaryAnswerParts("Innledning.\nF1: Første.")).toEqual([
      { label: null, text: "Innledning." },
      { label: "F1", text: "Første." },
    ]);
    expect(summaryAnswerParts('{"Innledning":"Tekst."}')).toEqual([
      { label: null, text: "Tekst." },
    ]);
  });
});
