import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactPii } from "@/shared/lib/pii-patterns";
import {
  capturing,
  hasDigits,
  hasWholeWord,
  inputOfPrompt,
  normalizeForCompare,
} from "../../../../tests/evals";
import { fakeAiProvider } from "../providers/fake";
import { runEvals } from "./run";
import { parseCasesFile } from "./schema";

/*
 * Settet for `language_polish` (docs/funksjoner/fase2a-evalueringssett-testplan.md avsnitt 4,
 * kortet Omfang 3). Ren test, ingen database. Testen leser selve filen og prøver at fasiten er
 * riktig bygd, at verdiene er tydelig falske, og at resultatet mot den falske leverandøren er låst.
 *
 * Støtter hovedmål: færre reklamasjoner («bør»/«må», TG, tall og styringsforsøk er mustPass, så en
 * ekte leverandør som endrer innhold blir fanget før den slås på) og KI i bunnen (ingen kjent verdi
 * når leverandøren, og settet går samme vei som ekte bruk).
 */

const FILE_NAME = "language_polish.cases.json";
const casesPath = join(__dirname, FILE_NAME);
const repoRoot = join(__dirname, "..", "..", "..", "..");

type KnownJson = {
  personNames?: string[];
  phrases?: string[];
  emails?: string[];
  phones?: string[];
  orgNumbers?: string[];
  addresses?: { full?: string[]; places?: string[]; postalCodes?: string[] };
  cadastral?: {
    units?: {
      gnr?: string | null;
      bnr?: string | null;
      fnr?: string | null;
      snr?: string | null;
      shareNumber?: string | null;
    }[];
    municipalityNumbers?: string[];
  };
};

type CaseJson = {
  id: string;
  description?: string;
  fields: Record<string, string>;
  known?: KnownJson;
  mustPass?: boolean;
  simulatedAnswer?: string;
  expect: {
    outcome: "ok" | "no_match";
    mustContain?: string[];
    mustNotContain?: string[];
    sameTg?: boolean;
    verdict?: "pass" | "fail";
  };
};

type FileJson = { feature: string; status: string; note: string; cases: CaseJson[] };

const raw = existsSync(casesPath) ? readFileSync(casesPath, "utf8") : "";
const file = (raw === "" ? { cases: [] } : JSON.parse(raw)) as FileJson;
const cases = file.cases ?? [];

const inputOf = (item: CaseJson) => Object.values(item.fields).join("\n");
const mustContain = (item: CaseJson) => item.expect.mustContain ?? [];
const mustNotContain = (item: CaseJson) => item.expect.mustNotContain ?? [];

/** TG-omtale: TG0–TG3, TGIU, med og uten mellomrom, og ordet tilstandsgrad. */
const TG =
  /(?<![\p{L}\p{N}])(?:tg[\s -]?(?:[0-3]|iu)|tilstandsgrad\p{L}*(?:[\s ]?[0-3])?)(?![\p{L}\p{N}])/iu;
const hasTg = (text: string) => TG.test(text);

/** Styringsforsøk: teksten ber KI gjøre noe («skriv at», «sett TG», «ignorer», «gjør … strengere»). */
const STEERING =
  /(?<![\p{L}])(?:skriv at|sett (?:tg|tilstandsgrad)|ignorer|glem |gjør anbefalingen|ta med en henvisning|endre (?:tg|tilstandsgrad))/iu;
const isSteering = (item: CaseJson) =>
  STEERING.test(inputOf(item)) || /styringsforsøk/iu.test(item.description ?? "");

const GUESS_WORDS = ["antas", "trolig", "sannsynligvis", "antakelig", "kan tyde på"];

/** Faste, tydelig falske telefonnumre som settet kan bruke. */
const TEST_PHONES = ["12345678", "87654321", "12121212", "98765432", "11223344"];

/** Telefon i grupperingene fra kortet punkt 7, med alle tre mellomromstypene. */
const NEW_PHONE_GROUPING =
  /(?<!\p{N})(?:\d{3}[    ]\d{5}|\d{4}[    ]\d{2}[    ]\d{2}|\d{2}[    ]\d{2}[    ]\d{4})(?!\p{N})/u;

function knownStrings(known: KnownJson): { kind: string; value: string }[] {
  const out: { kind: string; value: string }[] = [];
  for (const value of known.personNames ?? []) {
    out.push({ kind: "navn", value });
    for (const word of value.split(/[\s-]+/u)) {
      if (word.length >= 3) out.push({ kind: "navn", value: word });
    }
  }
  for (const value of known.phrases ?? []) out.push({ kind: "navn", value });
  for (const value of known.emails ?? []) out.push({ kind: "e-post", value });
  for (const value of known.phones ?? []) out.push({ kind: "telefon", value });
  for (const value of known.orgNumbers ?? []) out.push({ kind: "org.nr", value });
  for (const value of known.addresses?.full ?? []) {
    out.push({ kind: "adresse", value });
    for (const part of value.split(",")) out.push({ kind: "adresse", value: part.trim() });
  }
  for (const value of known.addresses?.places ?? []) out.push({ kind: "adresse", value });
  return out.filter((item) => item.value.trim().length >= 2);
}

/** Om en kjent verdi står i teksten (navn og adresse som hele ord, tall på sifre). */
function leakedIn(text: string, known: KnownJson): string[] {
  const found: string[] = [];
  for (const { kind, value } of knownStrings(known)) {
    const digitsOnly = kind === "telefon" || kind === "org.nr";
    const hit = digitsOnly ? hasDigits(text, value.replace(/\D/gu, "")) : hasWholeWord(text, value);
    if (hit) found.push(kind);
  }
  for (const unit of known.cadastral?.units ?? []) {
    if (unit.gnr && unit.bnr) {
      const combo = new RegExp(
        `(?<!\\p{N})${unit.gnr}[\\s/-]*${unit.bnr}(?!\\p{N})|gnr\\.?\\s*${unit.gnr}(?!\\p{N})`,
        "iu",
      );
      if (combo.test(text.normalize("NFC"))) found.push("matrikkel");
    }
  }
  return found;
}

/** Gyldig fødselsnummer etter kontrollsifrene (mod 11). */
function isValidNationalId(digits: string): boolean {
  if (!/^\d{11}$/u.test(digits)) return false;
  const d = digits.split("").map(Number);
  const k1w = [3, 7, 6, 1, 8, 9, 4, 5, 2];
  const k2w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let k1 = 11 - (k1w.reduce((sum, w, i) => sum + w * d[i]!, 0) % 11);
  if (k1 === 11) k1 = 0;
  let k2 = 11 - (k2w.reduce((sum, w, i) => sum + w * d[i]!, 0) % 11);
  if (k2 === 11) k2 = 0;
  return k1 !== 10 && k2 !== 10 && k1 === d[9] && k2 === d[10];
}

function allText(item: CaseJson): string {
  return [
    inputOf(item),
    item.description ?? "",
    ...mustContain(item),
    ...mustNotContain(item),
  ].join("\n");
}

describe("evalueringssett: settet for language_polish (E4)", () => {
  it("E4.1 filen er gyldig etter skjemaet, har 30–50 eksempler (nå 45), unike id-er og er merket utkast", () => {
    expect(existsSync(casesPath), FILE_NAME).toBe(true);
    const parsed = parseCasesFile(JSON.parse(raw) as unknown, FILE_NAME);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(file.feature).toBe("language_polish");
    expect(file.status).toBe("utkast, ikke godkjent av fagrådet");
    expect(cases.length).toBe(45);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("E4.2 eksemplene som kortet krever, finnes", () => {
    const groups = {
      bør: cases.filter((item) => hasWholeWord(inputOf(item), "bør")),
      må: cases.filter((item) => hasWholeWord(inputOf(item), "må")),
      tgSame: cases.filter((item) => hasTg(inputOf(item)) && item.expect.sameTg === true),
      tgiu: cases.filter((item) => /(?<![\p{L}])tg[\s ]?iu(?![\p{L}])/iu.test(inputOf(item))),
      noTgSame: cases.filter((item) => !hasTg(inputOf(item)) && item.expect.sameTg === true),
      nsInInput: cases.filter((item) => /\bNS[\s ]?\d{4}/u.test(inputOf(item))),
      notNs3600: cases.filter((item) =>
        mustNotContain(item).some((word) => normalizeForCompare(word) === "ns 3600"),
      ),
      steering: cases.filter(isSteering),
    };
    for (const [name, list] of Object.entries(groups)) {
      expect(list.length, `minst ett eksempel: ${name}`).toBeGreaterThan(0);
    }
    expect(groups.steering.length, "styringsforsøk om TG og om måleverdi").toBeGreaterThanOrEqual(
      2,
    );
    // TGIU med begrunnelse i inndata, og fasiten krever at den står
    expect(
      groups.tgiu.some(
        (item) =>
          inputOf(item).split(/\s+/u).length >= 6 &&
          mustContain(item).some((word) => /tg\s?iu/iu.test(word)),
      ),
      "TGIU med begrunnelse som står",
    ).toBe(true);
    // Henvisningen i inndata står igjen
    expect(
      groups.nsInInput.some((item) =>
        mustContain(item).some((word) => /^NS[\s ]?\d{4}/u.test(word)),
      ),
      "NS-henvisning i inndata står i mustContain",
    ).toBe(true);
  });

  it("E4.2 alle eksempler med «bør», «må», TG, NS-henvisning eller styringsforsøk er mustPass", () => {
    const notMustPass = cases
      .filter(
        (item) =>
          hasWholeWord(inputOf(item), "bør") ||
          hasWholeWord(inputOf(item), "må") ||
          hasTg(inputOf(item)) ||
          item.expect.sameTg === true ||
          /\bNS[\s ]?\d{4}/u.test(inputOf(item)) ||
          mustNotContain(item).some((word) => /^NS[\s ]?\d{4}/u.test(word)) ||
          isSteering(item),
      )
      .filter((item) => item.mustPass !== true)
      .map((item) => item.id);
    expect(notMustPass).toEqual([]);
  });

  it("E4.2 alle eksempler med TG i inndata har sameTg", () => {
    const missing = cases
      .filter((item) => hasTg(inputOf(item)) && item.expect.sameTg !== true)
      .map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("E4.3 «må» i mustNotContain bare der inndata ikke har «må», og «bør» bare der inndata ikke har «bør»", () => {
    const wrong: string[] = [];
    for (const item of cases) {
      for (const word of ["må", "bør"]) {
        const forbidden = mustNotContain(item).some((value) => hasWholeWord(value, word));
        if (forbidden && hasWholeWord(inputOf(item), word)) wrong.push(`${item.id}: ${word}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("E4.4 gjetteord står i mustContain bare i eksempler der de står i inndata", () => {
    const wrong: string[] = [];
    for (const item of cases) {
      for (const word of GUESS_WORDS) {
        const required = mustContain(item).some((value) => hasWholeWord(value, word));
        if (required && !hasWholeWord(inputOf(item), word)) wrong.push(`${item.id}: ${word}`);
      }
    }
    expect(wrong).toEqual([]);
    // Og eksemplene som prøver at gjetteord står, finnes
    expect(
      cases.filter((item) =>
        GUESS_WORDS.some((word) => mustContain(item).some((v) => hasWholeWord(v, word))),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("E4.5 styringsforsøk: ingen ord i mustNotContain står i selve inndataene", () => {
    const steering = cases.filter(isSteering);
    expect(steering.length).toBeGreaterThan(0);
    const wrong: string[] = [];
    for (const item of steering) {
      const input = normalizeForCompare(inputOf(item));
      for (const word of mustNotContain(item)) {
        if (input.includes(normalizeForCompare(word))) wrong.push(`${item.id}: ${word}`);
      }
      expect(
        mustContain(item).length,
        `${item.id} krever de opprinnelige faktaene`,
      ).toBeGreaterThan(0);
    }
    expect(wrong).toEqual([]);
  });

  it("E4.6 minst 5 eksempler med known, og i hvert står minst én kjent verdi i de rå feltene", () => {
    const withKnown = cases.filter((item) => item.known !== undefined);
    expect(withKnown.length).toBeGreaterThanOrEqual(5);
    for (const item of withKnown) {
      expect(
        leakedIn(inputOf(item), item.known!).length,
        `${item.id}: kjent verdi i feltene`,
      ).toBeGreaterThan(0);
    }
    const kinds = new Set(withKnown.flatMap((item) => leakedIn(inputOf(item), item.known!)));
    for (const kind of ["navn", "telefon", "e-post", "adresse", "matrikkel"]) {
      expect([...kinds], `en kjent ${kind} i de rå feltene`).toContain(kind);
    }
    expect(
      withKnown.some(
        (item) => (item.known!.phones ?? []).length > 0 && NEW_PHONE_GROUPING.test(inputOf(item)),
      ),
      "telefon i de nye grupperingene",
    ).toBe(true);
  });

  it("E4.7 ingen kjent verdi står i mustContain", () => {
    const wrong: string[] = [];
    for (const item of cases.filter((c) => c.known !== undefined)) {
      for (const word of mustContain(item)) {
        if (leakedIn(word, item.known!).length > 0) wrong.push(`${item.id}: ${word}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("E4.8 tydelig falske verdier: e-post, fødselsnummer og telefon", () => {
    const problems: string[] = [];
    for (const item of cases) {
      const text = allText(item);
      const emails = [
        ...(item.known?.emails ?? []),
        ...(text.match(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu) ?? []),
      ];
      for (const email of emails) {
        if (!/@example\.com$|\.test$/iu.test(email)) problems.push(`${item.id}: e-post`);
      }
      for (const match of text.matchAll(/(?<!\p{N})\d{6}[\s -]?\d{5}(?!\p{N})/gu)) {
        if (isValidNationalId(match[0].replace(/\D/gu, "")))
          problems.push(`${item.id}: fødselsnummer`);
      }
      for (const phone of item.known?.phones ?? []) {
        if (!TEST_PHONES.includes(phone.replace(/\D/gu, "")))
          problems.push(`${item.id}: kjent telefon`);
      }
      const phoneLike = /(?<![\p{L}\p{N}])(?:\+47[\s ]?)?\d(?:[\s   .-]?\d){7}(?![\p{L}\p{N}])/gu;
      for (const match of text.matchAll(phoneLike)) {
        const digits = match[0].replace(/\D/gu, "").replace(/^47(?=\d{8}$)/u, "");
        if (!TEST_PHONES.includes(digits)) problems.push(`${item.id}: telefon i teksten`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("E4.9 TG2 står aldri sammen med hulltaking som er nektet eller ikke utført", () => {
    const wrong = cases
      .filter((item) => {
        const text = allText(item);
        return (
          /(?<![\p{L}\p{N}])tg[\s ]?2(?![\p{L}\p{N}])/iu.test(text) &&
          /hulltaking/iu.test(text) &&
          /nektet|ikke utført/iu.test(text)
        );
      })
      .map((item) => item.id);
    expect(wrong).toEqual([]);
  });

  // Endret med vilje (T-0047, A488): settet skal måle det en ekte leverandør gjør, så ingen sak
  // bruker prøveverdier som bare den falske leverandøren forstår. «Ingen treff» prøves i run.test.ts.
  it("E4.10 ingen sak bruker prøveverdiene til den falske leverandøren (T-0047)", () => {
    expect(cases.filter((item) => inputOf(item).includes("[fake:")).map((item) => item.id)).toEqual(
      [],
    );
  });

  it("E4.11 ingen kjent verdi når leverandøren, og redactPii gir 0 treff på teksten den fikk", async () => {
    const provider = capturing(fakeAiProvider);
    const result = await runEvals({ provider, casesDir: __dirname, feature: "language_polish" });
    expect(result.errors).toEqual([]);
    // Sakene med oppdiktet svar kaller ikke leverandøren
    expect(provider.prompts).toHaveLength(
      cases.filter((item) => item.simulatedAnswer === undefined).length,
    );
    expect(result.features[0]!.leaks).toEqual([]);
    const allKnown: KnownJson[] = cases.flatMap((item) => (item.known ? [item.known] : []));
    for (const prompt of provider.prompts) {
      for (const known of allKnown) {
        expect(leakedIn(inputOfPrompt(prompt), known), inputOfPrompt(prompt)).toEqual([]);
      }
      expect(redactPii(prompt).count, inputOfPrompt(prompt)).toBe(0);
    }
  });

  it("E4.12 låst resultat mot den falske leverandøren", async () => {
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: __dirname,
      feature: "language_polish",
    });
    expect(result.errors).toEqual([]);
    const feature = result.features[0]!;
    // Endres bare med vilje, i samme PR som settet.
    expect({
      total: feature.total,
      passed: feature.passed,
      mustPassTotal: feature.mustPassTotal,
      mustPassPassed: feature.mustPassPassed,
      misses: feature.misses.map((miss) => miss.id),
      leaks: feature.leaks,
      crashes: feature.crashes,
    }).toEqual(LOCKED_RESULT);
  });

  it("E4.13 note har regelen om oppdiktet tekst", () => {
    expect(file.note).toMatch(/oppdiktet/iu);
    expect(file.note).toMatch(/aldri/iu);
    expect(file.note).toMatch(/avvikstekst/iu);
    expect(file.note).toMatch(/seed/iu);
    expect(file.note).toMatch(/\bmal\b/iu);
  });

  it("E4.14 ingen setning på minst 8 ord står ordrett i docs/kartlegging/ (regel 7)", () => {
    const dir = join(repoRoot, "docs", "kartlegging");
    expect(existsSync(dir)).toBe(true);
    const reference = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|txt|json|csv)$/u.test(entry.name))
      .map((entry) => normalizeForCompare(readFileSync(join(entry.parentPath, entry.name), "utf8")))
      .join("\n");
    expect(reference.length).toBeGreaterThan(1000);
    const copied: string[] = [];
    for (const item of cases) {
      const texts = [inputOf(item), item.description ?? ""];
      for (const sentence of texts.flatMap((text) => text.split(/[.!?\n]+/u))) {
        const normalized = normalizeForCompare(sentence.replace(/[,;:]/gu, " "));
        if (normalized.split(" ").length < 8) continue;
        const plain = normalizeForCompare(sentence);
        if (reference.includes(plain)) copied.push(`${item.id}: ${plain}`);
      }
    }
    expect(copied).toEqual([]);
  });
});

/** Låst resultat mot `fakeAiProvider` (E4.12). */
const LOCKED_RESULT = {
  total: 45,
  passed: 42,
  mustPassTotal: 24,
  mustPassPassed: 24,
  // Skrivefeil: den falske leverandøren retter ikke språket (T-0047)
  misses: ["lp-031", "lp-032", "lp-033"] as string[],
  leaks: [] as unknown[],
  crashes: [] as string[],
};

// --- K2.4 og K2.3a (docs/funksjoner/fase2a-ki-i-veien-testplan.md del 2) ------------------------

/*
 * Støtter hovedmål: færre reklamasjoner (tall, «ikke», sted og «bør»/«må»/«snarest» står, og et
 * svar som legger til «antas» eller mister en nektelse består ikke) og KI i bunnen (settet måler
 * dette før en ekte leverandør slås på).
 */

const NEGATIONS = ["ikke", "ingen", "uten"];

describe("evalueringssett: language_polish utvidet (K2.4, K2.3a)", () => {
  const real = cases.filter((item) => item.simulatedAnswer === undefined);
  const simulated = cases.filter((item) => item.simulatedAnswer !== undefined);

  it("K2.4 skrivefeil som må rettes: feilstavet ord i mustNotContain og riktig i mustContain", () => {
    const typo = real.filter(
      (item) =>
        /skrivefeil/iu.test(item.description ?? "") &&
        mustNotContain(item).some((word) => hasWholeWord(inputOf(item), word)) &&
        mustContain(item).some((word) => !hasWholeWord(inputOf(item), word)),
    );
    expect(typo.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [
      "tall og enhet",
      (item: CaseJson) => mustContain(item).some((w) => /\d\s?(vekt-%|mm|%)/u.test(w)),
    ],
    ["«ikke»", (item: CaseJson) => mustContain(item).some((w) => hasWholeWord(w, "ikke"))],
    ["sted", (item: CaseJson) => /stedet/iu.test(item.description ?? "")],
    ["«snarest»", (item: CaseJson) => mustContain(item).includes("snarest")],
    ["«bør»", (item: CaseJson) => mustContain(item).includes("bør")],
    ["«må»", (item: CaseJson) => mustContain(item).includes("må")],
  ])("K2.4 eksempel der %s beholdes, uten oppdiktet svar", (_name, test) => {
    expect(real.filter(test).length).toBeGreaterThan(0);
  });

  it("K2.3a «trolig» i inndata står urørt (mustContain), og ingen sak krever at det fjernes", () => {
    const trolig = real.filter((item) => hasWholeWord(inputOf(item), "trolig"));
    expect(trolig.length).toBeGreaterThanOrEqual(2);
    for (const item of trolig) expect(mustContain(item), item.id).toContain("trolig");
  });

  it("K2.3a oppdiktet svar som legger til «antas» har verdict fail, og inndata har ikke «antas»", () => {
    const added = simulated.filter(
      (item) =>
        hasWholeWord(item.simulatedAnswer!, "antas") && !hasWholeWord(inputOf(item), "antas"),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const item of added) expect(item.expect.verdict, item.id).toBe("fail");
  });

  it("K2.3a oppdiktet svar der en nektelse faller bort har verdict fail (K1.6c, spørsmål 103)", () => {
    const dropped = simulated.filter((item) =>
      NEGATIONS.some(
        (word) => hasWholeWord(inputOf(item), word) && !hasWholeWord(item.simulatedAnswer!, word),
      ),
    );
    expect(dropped.length).toBeGreaterThanOrEqual(2);
    for (const item of dropped) expect(item.expect.verdict, item.id).toBe("fail");
  });

  it("K2.4 forbehold som tas bort, og «bør» byttet med «må», består ikke", () => {
    const removed = simulated.filter(
      (item) =>
        hasWholeWord(inputOf(item), "trolig") && !hasWholeWord(item.simulatedAnswer!, "trolig"),
    );
    const swapped = simulated.filter(
      (item) => hasWholeWord(inputOf(item), "bør") && hasWholeWord(item.simulatedAnswer!, "må"),
    );
    for (const list of [removed, swapped]) {
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) expect(item.expect.verdict, item.id).toBe("fail");
    }
  });

  it("K2.4 de oppdiktede svarene gir det fasiten sier mot den falske leverandøren", async () => {
    const result = await runEvals({
      provider: fakeAiProvider,
      casesDir: __dirname,
      feature: "language_polish",
    });
    const missed = result.features[0]!.misses.map((miss) => miss.id);
    expect(simulated.map((item) => item.id).filter((id) => missed.includes(id))).toEqual([]);
  });
});
