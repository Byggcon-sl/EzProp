import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_CANDIDATE_SOURCES, AI_GUARD_CODES, SUMMARY_GROUPS } from "@/db/schema";
import { EVAL_GUESS_WORDS } from "./run";
import {
  EVAL_CANDIDATE_SOURCES,
  EVAL_CASES_STATUS,
  EVAL_GUARD_CODES,
  EVAL_SUMMARY_GROUPS,
  parseCasesFile,
} from "./schema";

/*
 * Formatet for evalueringssettet (docs/funksjoner/fase2a-evalueringssett-testplan.md avsnitt 1,
 * kortet Omfang 1). Ren test, ingen database. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (hver KI-funksjon har et fast sett med fasit, og en feil i filen
 * stopper kjøringen i stedet for å gi et falskt resultat) og færre reklamasjoner (fasiten kan ikke
 * være tvetydig: ukjente nøkler og motsigende krav avvises).
 */

const FILE_NAME = "language_polish.cases.json";
const STATUS = "utkast, ikke godkjent av fagrådet";
const NOTE =
  "Bare oppdiktet tekst. Aldri kopi av ekte rapporttekst eller ai_usage_log. Prøvedata for KI, aldri avvikstekst, seed-data eller mal.";

type Json = Record<string, unknown>;

function validCase(index: number, overrides: Json = {}): Json {
  return {
    id: `t-${String(index).padStart(3, "0")}`,
    description: "Oppdiktet eksempel.",
    fields: { text: `Oppdiktet tekst nummer ${index} om taket.` },
    mustPass: false,
    expect: { outcome: "ok", mustContain: ["taket"] },
    ...overrides,
  };
}

function validFile(count = 30, overrides: Json = {}): Json {
  return {
    feature: "language_polish",
    status: STATUS,
    note: NOTE,
    cases: Array.from({ length: count }, (_, index) => validCase(index + 1)),
    ...overrides,
  };
}

/** Filen med eksempel nummer `index` byttet ut. */
function withCase(index: number, replacement: Json): Json {
  const file = validFile();
  (file.cases as Json[])[index] = replacement;
  return file;
}

type ParseResult = ReturnType<typeof parseCasesFile>;

function errorsOf(result: ParseResult): string[] {
  return result.ok ? [] : result.errors;
}

function expectAccepted(json: unknown): Extract<ParseResult, { ok: true }> {
  const result = parseCasesFile(json, FILE_NAME);
  expect(errorsOf(result)).toEqual([]);
  expect(result.ok).toBe(true);
  return result as Extract<ParseResult, { ok: true }>;
}

function expectRejected(json: unknown): string[] {
  const result = parseCasesFile(json, FILE_NAME);
  expect(result.ok).toBe(false);
  const errors = errorsOf(result);
  expect(errors.length).toBeGreaterThan(0);
  return errors;
}

describe("evalueringssett: skjemaet (E1)", () => {
  it("E1.1 en gyldig minimal fil med 30 eksempler godtas", () => {
    const result = expectAccepted(validFile());
    expect(result.file.feature).toBe("language_polish");
    expect(result.file.cases).toHaveLength(30);
  });

  it.each([
    { where: "toppnivå", json: validFile(30, { ekstra: true }) },
    { where: "eksempel", json: withCase(0, validCase(1, { ekstra: 1 })) },
    {
      where: "expect",
      json: withCase(0, validCase(1, { expect: { outcome: "ok", mustContainAll: ["taket"] } })),
    },
  ])("E1.2 ukjent nøkkel i $where avvises (strict)", ({ json }) => {
    expectRejected(json);
  });

  it("E1.3 et felt utenfor tillatt-listen for funksjonen avvises", () => {
    const errors = expectRejected(
      withCase(0, validCase(1, { fields: { text: "Oppdiktet.", email: "x@example.com" } })),
    );
    expect(errors.join("\n")).toContain("email");
  });

  it("E1.3 ukjent funksjon avvises", () => {
    expectRejected(validFile(30, { feature: "finnes_ikke" }));
  });

  it("E1.4 duplisert id avvises, og meldingen nevner id-en", () => {
    const file = validFile();
    (file.cases as Json[])[7] = validCase(8, { id: "t-dobbel" });
    (file.cases as Json[])[12] = validCase(13, { id: "t-dobbel" });
    const errors = expectRejected(file);
    expect(errors.join("\n")).toContain("t-dobbel");
  });

  it.each([29, 51])("E1.5 %i eksempler avvises", (count) => {
    expectRejected(validFile(count));
  });

  it.each([30, 50])("E1.5 %i eksempler godtas", (count) => {
    expectAccepted(validFile(count));
  });

  it("E1.6 manglende status avvises", () => {
    const file = validFile();
    delete file.status;
    expectRejected(file);
  });

  it.each(["godkjent", "utkast", "Utkast, ikke godkjent av fagrådet", ""])(
    "E1.6 annen status enn utkast-merket avvises: «%s»",
    (status) => {
      expectRejected(validFile(30, { status }));
    },
  );

  it("E1.6 manglende note avvises", () => {
    const file = validFile();
    delete file.note;
    expectRejected(file);
  });

  it("E1.7 outcome no_match sammen med mustContain avvises", () => {
    expectRejected(
      withCase(0, validCase(1, { expect: { outcome: "no_match", mustContain: ["taket"] } })),
    );
  });

  it("E1.7 outcome no_match uten mustContain godtas", () => {
    expectAccepted(withCase(0, validCase(1, { expect: { outcome: "no_match" } })));
  });

  it("E1.8 mustPass er valgfri og blir false; sameTg er valgfri", () => {
    const file = validFile();
    const withoutMustPass = validCase(1, { expect: { outcome: "ok" } });
    delete withoutMustPass.mustPass;
    (file.cases as Json[])[0] = withoutMustPass;
    (file.cases as Json[])[1] = validCase(2, {
      mustPass: true,
      expect: { outcome: "ok", sameTg: true },
    });
    const result = expectAccepted(file);
    if (result.file.feature !== "language_polish") throw new Error("ventet language_polish");
    expect(result.file.cases[0]!.mustPass).toBe(false);
    expect(result.file.cases[0]!.expect.sameTg).toBeUndefined();
    expect(result.file.cases[1]!.mustPass).toBe(true);
    expect(result.file.cases[1]!.expect.sameTg).toBe(true);
  });

  it("E1.9 known har formen til KnownValues: full form og delvis form godtas", () => {
    const file = validFile();
    (file.cases as Json[])[0] = validCase(1, {
      known: {
        personNames: ["Åse Testesen"],
        phrases: ["Testrør AS"],
        emails: ["ase.testesen@example.com"],
        phones: ["12345678"],
        orgNumbers: ["000111222"],
        addresses: {
          full: ["Prøvetunet 7, 8099 Testvik"],
          places: ["Testvik"],
          postalCodes: ["8099"],
        },
        cadastral: {
          units: [{ gnr: "999", bnr: "12", fnr: null, snr: null, shareNumber: null }],
          municipalityNumbers: ["1899"],
        },
      },
    });
    (file.cases as Json[])[1] = validCase(2, { known: { phones: ["87654321"] } });
    expectAccepted(file);
  });

  it.each([
    { name: "personNames som tekst, ikke liste", known: { personNames: "Åse Testesen" } },
    { name: "telefon som tall", known: { phones: [12345678] } },
    { name: "addresses som liste", known: { addresses: ["Prøvetunet 7"] } },
    { name: "ukjent nøkkel i known", known: { names: ["Åse Testesen"] } },
    {
      name: "radformen fra redaction-cases.ts (parties)",
      known: { parties: [{ name: "Åse Testesen", phone: "12345678" }] },
    },
    {
      name: "matrikkel med gnr som tall",
      known: { cadastral: { units: [{ gnr: 999, bnr: "12" }] } },
    },
  ])("E1.9 known med feil type avvises: $name", ({ known }) => {
    expectRejected(withCase(0, validCase(1, { known })));
  });

  it("E1.10 feilmeldingen gjentar ikke verdier fra known", () => {
    const secrets = ["Qzxåse Hemmeligsen", "qzx.hemmelig@example.com", "98989898"];
    const file = validFile(30, { status: "godkjent" });
    (file.cases as Json[])[0] = validCase(1, {
      known: {
        personNames: [secrets[0]],
        emails: [secrets[1]],
        // Feil type: verdien selv er grunnen til feilen
        phones: [Number(secrets[2])],
      },
    });
    (file.cases as Json[])[1] = validCase(2, {
      known: { personNames: secrets[0] },
      fields: { text: "Oppdiktet.", phone: secrets[2] },
    });
    const errors = expectRejected(file);
    const text = errors.join("\n");
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(text).not.toContain("Hemmeligsen");
  });
});

// --- K2.5 nye sakstyper (docs/funksjoner/fase2a-ki-i-veien-testplan.md del 2) -------------------

/*
 * Støtter hovedmål: KI i bunnen (settene for fraseforslag og sammendrag kan ikke ha en fasit som
 * peker på noe som ikke finnes) og færre reklamasjoner (HMS- og TG-tekster blandes aldri, og
 * gruppene står alltid i rekkefølgen TG3, TG2, TGIU, HMS).
 */

const PHRASE_FILE = "phrase_suggest.cases.json";
const SUMMARY_FILE = "summary_draft.cases.json";

function phraseCase(index: number, overrides: Json = {}): Json {
  return {
    id: `ps-${String(index).padStart(3, "0")}`,
    deviationKind: "tg",
    field: "deviation_text",
    fields: { text: "Oppdiktet notat om fall mot sluket.", group: "tg" },
    candidates: [
      { id: "k-a", source: "template_outcome", kind: "tg", text: "Oppdiktet tekst om fall." },
      { id: "k-b", source: "template_outcome", kind: "tg", text: "Oppdiktet tekst om fuger." },
    ],
    expect: { outcome: "ok", correct: ["k-a"] },
    ...overrides,
  };
}

function summaryCase(index: number, overrides: Json = {}): Json {
  return {
    id: `sd-${String(index).padStart(3, "0")}`,
    groups: [
      {
        group: "tg2",
        findings: [
          {
            checkpointName: "Oppdiktet punkt",
            deviationText: "Oppdiktet avvik.",
            causeText: null,
            consequenceText: "Oppdiktet konsekvens.",
            measures: ["Oppdiktet tiltak."],
          },
        ],
      },
    ],
    expect: { outcome: "ok" },
    ...overrides,
  };
}

function fileOf(feature: string, make: (index: number) => Json, count = 30): Json {
  return {
    feature,
    status: STATUS,
    note: NOTE,
    cases: Array.from({ length: count }, (_, index) => make(index + 1)),
  };
}

function withFirst(file: Json, replacement: Json): Json {
  (file.cases as Json[])[0] = replacement;
  return file;
}

function rejected(json: Json, fileName: string): string {
  const result = parseCasesFile(json, fileName);
  expect(result.ok).toBe(false);
  const errors = errorsOf(result);
  expect(errors.length).toBeGreaterThan(0);
  return errors.join("\n");
}

describe("evalueringssett: skjemaet for phrase_suggest og summary_draft (K2.5)", () => {
  it.each([
    ["phrase_suggest", PHRASE_FILE],
    ["language_polish", "language_polish.cases.json"],
    ["summary_draft", SUMMARY_FILE],
  ])("K2.5 den ekte filen for %s er gyldig og merket utkast", (feature, fileName) => {
    const json = JSON.parse(readFileSync(join(__dirname, fileName), "utf8")) as Json;
    expect(errorsOf(parseCasesFile(json, fileName))).toEqual([]);
    expect(json.feature).toBe(feature);
    expect(json.status).toBe(EVAL_CASES_STATUS);
  });

  it("K2.5 en gyldig phrase_suggest-fil godtas, også med fasit no_match", () => {
    const file = fileOf("phrase_suggest", (i) =>
      i === 1 ? phraseCase(i, { expect: { outcome: "no_match" } }) : phraseCase(i),
    );
    expect(errorsOf(parseCasesFile(file, PHRASE_FILE))).toEqual([]);
  });

  it("K2.5 en gyldig summary_draft-fil godtas", () => {
    const file = fileOf("summary_draft", summaryCase);
    expect(errorsOf(parseCasesFile(file, SUMMARY_FILE))).toEqual([]);
  });

  it.each([
    ["phrase_suggest", PHRASE_FILE, phraseCase],
    ["summary_draft", SUMMARY_FILE, summaryCase],
  ] as const)("K2.5 %s uten utkast-merket avvises", (feature, fileName, make) => {
    const file = fileOf(feature, make);
    file.status = "godkjent";
    rejected(file, fileName);
    delete file.status;
    rejected(file, fileName);
  });

  it.each([
    ["uten expect", (c: Json): Json => ({ ...c, expect: undefined })],
    ["uten correct", (c: Json): Json => ({ ...c, expect: { outcome: "ok" } })],
    ["med tom correct", (c: Json): Json => ({ ...c, expect: { outcome: "ok", correct: [] } })],
  ])("K2.5 phrase_suggest-sak %s (uten fasit) avvises", (_name, change) => {
    rejected(withFirst(fileOf("phrase_suggest", phraseCase), change(phraseCase(1))), PHRASE_FILE);
  });

  it("K2.5 summary_draft-sak uten fasit avvises", () => {
    const item = summaryCase(1);
    delete item.expect;
    rejected(withFirst(fileOf("summary_draft", summaryCase), item), SUMMARY_FILE);
  });

  it("K2.5 ukjent kandidat-id i fasiten avvises, og meldingen nevner id-en", () => {
    const text = rejected(
      withFirst(
        fileOf("phrase_suggest", phraseCase),
        phraseCase(1, { expect: { outcome: "ok", correct: ["k-a", "k-finnes-ikke"] } }),
      ),
      PHRASE_FILE,
    );
    expect(text).toContain("k-finnes-ikke");
  });

  it("K2.5 samme kandidat-id to ganger i listen avvises", () => {
    const item = phraseCase(1);
    const candidates = item.candidates as Json[];
    item.candidates = [candidates[0], { ...candidates[1], id: "k-a" }];
    rejected(withFirst(fileOf("phrase_suggest", phraseCase), item), PHRASE_FILE);
  });

  it.each([
    ["HMS-kandidat for et TG-avvik", "tg", "hms"],
    ["TG-kandidat for et HMS-avvik", "hms", "tg"],
  ])("K2.5 %s avvises (A463)", (_name, deviationKind, candidateKind) => {
    const item = phraseCase(1, { deviationKind });
    item.candidates = (item.candidates as Json[]).map((c, i) => ({
      ...c,
      kind: i === 0 ? candidateKind : deviationKind,
    }));
    const text = rejected(withFirst(fileOf("phrase_suggest", phraseCase), item), PHRASE_FILE);
    expect(text).toMatch(/HMS og TG blandes aldri/u);
  });

  it("K2.5 ukjent kandidatkilde avvises", () => {
    const item = phraseCase(1);
    const candidates = item.candidates as Json[];
    item.candidates = [{ ...candidates[0], source: "free_text" }, candidates[1]];
    rejected(withFirst(fileOf("phrase_suggest", phraseCase), item), PHRASE_FILE);
  });

  it("K2.5 gruppene i feil rekkefølge avvises (TG2 før TG3)", () => {
    const base = summaryCase(1);
    const tg2 = (base.groups as Json[])[0]!;
    const item = { ...base, groups: [tg2, { ...tg2, group: "tg3" }] };
    const text = rejected(withFirst(fileOf("summary_draft", summaryCase), item), SUMMARY_FILE);
    expect(text).toMatch(/TG3, TG2, TGIU, HMS/u);
  });

  it("K2.5 bare TGIU-linjer (ingen funn til KI) avvises", () => {
    const item = summaryCase(1, {
      groups: [{ group: "tgiu", fixedLines: [{ checkpointName: "Punkt", text: "Grunn." }] }],
    });
    rejected(withFirst(fileOf("summary_draft", summaryCase), item), SUMMARY_FILE);
  });

  it("K2.5 TGIU-gruppe med funn i stedet for faste linjer avvises", () => {
    const base = summaryCase(1);
    const item = { ...base, groups: [{ ...(base.groups as Json[])[0], group: "tgiu" }] };
    rejected(withFirst(fileOf("summary_draft", summaryCase), item), SUMMARY_FILE);
  });

  it("K2.5 utfallet stopped krever en kjent vaktkode og et oppdiktet svar", () => {
    const answer = [{ label: "F1", text: "Oppdiktet svar." }];
    const make = (expectation: Json, simulatedAnswer?: Json[]) =>
      withFirst(
        fileOf("summary_draft", summaryCase),
        summaryCase(
          1,
          simulatedAnswer ? { expect: expectation, simulatedAnswer } : { expect: expectation },
        ),
      );
    rejected(make({ outcome: "stopped", guard: "tg_guard" }), SUMMARY_FILE);
    rejected(make({ outcome: "stopped", guard: "ukjent_vakt" }, answer), SUMMARY_FILE);
    const ok = parseCasesFile(
      make({ outcome: "stopped", guard: "tg_guard" }, answer),
      SUMMARY_FILE,
    );
    expect(errorsOf(ok)).toEqual([]);
  });

  it("K2.5 verdict fail uten oppdiktet svar avvises (language_polish og summary_draft)", () => {
    rejected(withCase(0, validCase(1, { expect: { outcome: "ok", verdict: "fail" } })), FILE_NAME);
    rejected(
      withFirst(
        fileOf("summary_draft", summaryCase),
        summaryCase(1, { expect: { outcome: "ok", verdict: "fail" } }),
      ),
      SUMMARY_FILE,
    );
  });

  it("K2.5 F-merket i et oppdiktet svar må ha formen F1, F2 …", () => {
    rejected(
      withFirst(
        fileOf("summary_draft", summaryCase),
        summaryCase(1, { simulatedAnswer: [{ label: "K1", text: "Oppdiktet." }] }),
      ),
      SUMMARY_FILE,
    );
  });

  it("K2.5 de faste kodene i skjemaet er de samme som i databaseskjemaet", () => {
    expect([...EVAL_CANDIDATE_SOURCES]).toEqual([...AI_CANDIDATE_SOURCES]);
    expect([...EVAL_GUARD_CODES]).toEqual([...AI_GUARD_CODES]);
    expect([...EVAL_SUMMARY_GROUPS]).toEqual([...SUMMARY_GROUPS]);
  });
});

// --- «Skriv det du ser»: outcome_match (docs/funksjoner/fase2a-skriv-det-du-ser-testplan.md 2) ---

/*
 * Støtter hovedmål: KI i bunnen (settet for `outcome_match` har fasit som kan måles før ekte KI
 * slås på) og færre reklamasjoner (sakene for hulltaking og slitasje må bestås hver for seg, og
 * alvorsparene viser alltid begge utfallene).
 */

const OUTCOME_FILE = "outcome_match.cases.json";

function outcomeCandidate(id: string): Json {
  const [checkpoint, outcome] = id.split(".");
  return {
    id,
    source: "template_outcome",
    checkpointKey: `wet_room.${checkpoint}`,
    outcomeKey: outcome,
    text: `Oppdiktet punkt: Oppdiktet spørsmål om ${outcome}? Oppdiktet tekst.`,
  };
}

const OUTCOME_CANDIDATES = [
  outcomeCandidate("floor.cracked_tiles_or_joints"),
  outcomeCandidate("floor.moisture_damage"),
  outcomeCandidate("walls_ceiling.cracked_tiles_or_joints"),
];

function outcomeCase(index: number, overrides: Json = {}): Json {
  return {
    id: `om-${String(index).padStart(3, "0")}`,
    description: "Oppdiktet sak.",
    category: "match",
    note: "oppdiktet notat om sprekk i flis",
    candidates: OUTCOME_CANDIDATES,
    expect: { require: "any", ids: ["floor.cracked_tiles_or_joints"] },
    ...overrides,
  };
}

function outcomeRejected(replacement: Json): string {
  return rejected(withFirst(fileOf("outcome_match", outcomeCase), replacement), OUTCOME_FILE);
}

type OutcomeCaseJson = {
  id: string;
  category: string;
  note: string;
  description: string;
  mustPass?: boolean;
  candidates: { id: string; text: string }[];
  expect: { require: string; ids: string[] };
};

const outcomeJson = JSON.parse(readFileSync(join(__dirname, OUTCOME_FILE), "utf8")) as {
  feature: string;
  status: string;
  note: string;
  cases: OutcomeCaseJson[];
};

describe("evalueringssett: skjemaet for outcome_match (S2.1, S2.2)", () => {
  it("S2.1 den ekte filen er gyldig, merket utkast og har 30–50 saker", () => {
    expect(errorsOf(parseCasesFile(outcomeJson, OUTCOME_FILE))).toEqual([]);
    expect(outcomeJson.feature).toBe("outcome_match");
    expect(outcomeJson.status).toBe(EVAL_CASES_STATUS);
    expect(outcomeJson.cases.length).toBeGreaterThanOrEqual(30);
    expect(outcomeJson.cases.length).toBeLessThanOrEqual(50);
  });

  it("S2.1 kravene fra fagansvarlig er med", () => {
    const of = (category: string) => outcomeJson.cases.filter((c) => c.category === category);
    const notes = (category: string) => of(category).map((c) => c.note);
    expect(of("no_match_hole_drilling").length).toBeGreaterThanOrEqual(3);
    expect(of("no_match_wear").length).toBeGreaterThanOrEqual(3);
    for (const c of [...of("no_match_hole_drilling"), ...of("no_match_wear")]) {
      expect(c.expect).toEqual({ require: "none", ids: [] });
      expect(c.mustPass).toBe(true);
    }
    expect(notes("no_match_wear")).toContain("litt slitt fuge");

    const moistureCounter = of("counter_case").filter((c) =>
      c.expect.ids.includes("adjacent.elevated_moisture"),
    );
    expect(moistureCounter.length).toBeGreaterThanOrEqual(2);
    expect(
      of("counter_case").some(
        (c) =>
          /riss i fuge/u.test(c.note) && c.expect.ids.includes("floor.cracked_tiles_or_joints"),
      ),
    ).toBe(true);

    const pairs = of("severity_pair").map((c) => [...c.expect.ids].sort().join("+"));
    for (const pair of [
      ["walls_ceiling.moisture_marks", "walls_ceiling.mould_or_rot"],
      ["floor.cracked_tiles_or_joints", "floor.moisture_damage"],
      ["ventilation.weak_extract", "ventilation.missing_ventilation"],
    ]) {
      expect(pairs).toContain([...pair].sort().join("+"));
    }
    for (const c of of("severity_pair")) expect(c.expect.require).toBe("all");

    const age = of("age_pair");
    expect(age.length).toBeGreaterThanOrEqual(2);
    for (const c of age) {
      expect(c.note).toMatch(/\b(?:19|20)\d\d\b/u);
      expect(c.expect.require).toBe("all");
    }
    expect(age.some((c) => /\b19\d\d\b/u.test(c.note))).toBe(true);
    expect(age.some((c) => /\b20\d\d\b/u.test(c.note))).toBe(true);

    const two = of("two_checkpoints");
    const floor = "floor.cracked_tiles_or_joints";
    const walls = "walls_ceiling.cracked_tiles_or_joints";
    expect(
      two.some(
        (c) =>
          c.expect.require === "all" &&
          c.expect.ids.includes(floor) &&
          c.expect.ids.includes(walls),
      ),
    ).toBe(true);
    expect(
      two.some(
        (c) =>
          c.expect.require === "first" &&
          c.expect.ids[0] === floor &&
          /ved sluket|på gulvet/u.test(c.note),
      ),
    ).toBe(true);
    expect(
      two.some(
        (c) =>
          c.expect.require === "first" &&
          c.expect.ids[0] === walls &&
          /på veggen|over badekaret/u.test(c.note),
      ),
    ).toBe(true);

    expect(notes("tg_mention").some((note) => /dette er TG3/u.test(note))).toBe(true);
  });

  it("S2.1 notatene har ingen gjetteord, navn, telefonnumre eller e-post", () => {
    for (const c of outcomeJson.cases) {
      const lower = c.note.toLocaleLowerCase("nb");
      for (const word of EVAL_GUESS_WORDS) {
        expect(lower, c.id).not.toMatch(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u"));
      }
      expect(c.note, c.id).not.toMatch(/\d{8}|@|\bgnr\b|\bbnr\b/iu);
      expect(c.note, c.id).not.toMatch(/NS ?3600|IVIT|SmartTakst/iu);
    }
  });

  it("S2.2 en gyldig minimal fil godtas, også med fasit none", () => {
    const file = fileOf("outcome_match", (i) =>
      i === 1
        ? outcomeCase(i, {
            category: "no_match_wear",
            mustPass: true,
            expect: { require: "none", ids: [] },
          })
        : outcomeCase(i),
    );
    expect(errorsOf(parseCasesFile(file, OUTCOME_FILE))).toEqual([]);
  });

  it("S2.2 fil uten utkast-merke avvises", () => {
    const file = fileOf("outcome_match", outcomeCase);
    file.status = "godkjent";
    expect(rejected(file, OUTCOME_FILE)).toMatch(/status/u);
  });

  it("S2.2 sak uten fasit avvises", () => {
    const { expect: _omitted, ...rest } = outcomeCase(1);
    expect(outcomeRejected(rest)).toMatch(/expect/u);
  });

  it("S2.2 fasit med ukjent utfall avvises, og meldingen nevner id-en", () => {
    const text = outcomeRejected(
      outcomeCase(1, { expect: { require: "any", ids: ["floor.finnes_ikke"] } }),
    );
    expect(text).toMatch(/ukjent kandidat-id floor\.finnes_ikke/u);
  });

  it.each([
    ["none med id-er", { require: "none", ids: ["floor.cracked_tiles_or_joints"] }, /fasit none/u],
    ["any uten id-er", { require: "any", ids: [] }, /krever minst én/u],
    [
      "samme id to ganger",
      { require: "all", ids: ["floor.moisture_damage", "floor.moisture_damage"] },
      /to ganger/u,
    ],
    ["ukjent krav", { require: "some", ids: ["floor.moisture_damage"] }, /require/u],
    [
      "flere enn tre",
      { require: "all", ids: ["a.b", "floor.moisture_damage", "c.d", "e.f"] },
      /for mange/u,
    ],
  ])("S2.2 fasit %s avvises", (_name, expectation, message) => {
    expect(outcomeRejected(outcomeCase(1, { expect: expectation }))).toMatch(message);
  });

  it("S2.2 hulltaking og slitasje krever fasit none og mustPass", () => {
    expect(
      outcomeRejected(outcomeCase(1, { category: "no_match_hole_drilling", mustPass: true })),
    ).toMatch(/krever fasit none/u);
    expect(
      outcomeRejected(
        outcomeCase(1, { category: "no_match_wear", expect: { require: "none", ids: [] } }),
      ),
    ).toMatch(/må bestås for seg/u);
  });

  it("S2.2 en motsak med fasit none avvises", () => {
    expect(
      outcomeRejected(
        outcomeCase(1, {
          category: "counter_case",
          mustPass: true,
          expect: { require: "none", ids: [] },
        }),
      ),
    ).toMatch(/motsak/u);
  });

  it("S2.2 alvorspar og aldersparet krever all med to utfall", () => {
    expect(outcomeRejected(outcomeCase(1, { category: "severity_pair" }))).toMatch(/to utfall/u);
    expect(
      outcomeRejected(
        outcomeCase(1, {
          category: "age_pair",
          expect: {
            require: "any",
            ids: ["floor.moisture_damage", "floor.cracked_tiles_or_joints"],
          },
        }),
      ),
    ).toMatch(/to utfall/u);
  });

  it("S2.2 tg_mention krever at notatet nevner TG", () => {
    expect(outcomeRejected(outcomeCase(1, { category: "tg_mention" }))).toMatch(/nevner TG/u);
    const ok = fileOf("outcome_match", (i) =>
      outcomeCase(i, { category: "tg_mention", note: "sprekk i flis, dette er TG3" }),
    );
    expect(errorsOf(parseCasesFile(ok, OUTCOME_FILE))).toEqual([]);
  });

  it("S2.2 kandidat med annen kilde, for lang tekst eller samme id to ganger avvises", () => {
    expect(
      outcomeRejected(
        outcomeCase(1, { candidates: [{ ...OUTCOME_CANDIDATES[0], source: "phrase" }] }),
      ),
    ).toMatch(/candidates\[0\]\.source/u);
    expect(
      outcomeRejected(
        outcomeCase(1, { candidates: [{ ...OUTCOME_CANDIDATES[0], text: "x".repeat(2001) }] }),
      ),
    ).toMatch(/for lang/u);
    expect(
      outcomeRejected(
        outcomeCase(1, { candidates: [OUTCOME_CANDIDATES[0], OUTCOME_CANDIDATES[0]] }),
      ),
    ).toMatch(/brukt før/u);
  });

  it("S2.2 notat over 500 tegn, tomt notat og ukjent nøkkel avvises", () => {
    expect(outcomeRejected(outcomeCase(1, { note: "a".repeat(501) }))).toMatch(/for lang/u);
    expect(outcomeRejected(outcomeCase(1, { note: "   " }))).toMatch(/note/u);
    expect(outcomeRejected(outcomeCase(1, { fields: { text: "x" } }))).toMatch(/ukjent nøkkel/u);
  });

  it("S2.2 feilmeldingene gjentar aldri notatet", () => {
    const text = outcomeRejected(
      outcomeCase(1, { note: "Hemmeligsen ".repeat(50), category: "tg_mention" }),
    );
    expect(text).not.toContain("Hemmeligsen");
  });
});
