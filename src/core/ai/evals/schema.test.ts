import { describe, expect, it } from "vitest";
import { parseCasesFile } from "./schema";

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
