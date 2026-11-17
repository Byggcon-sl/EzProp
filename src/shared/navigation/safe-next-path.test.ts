import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, isSafeNextPath, safeNextPath } from "./safe-next-path";

// `neste` på innloggingssiden. Først prøve F (docs/funksjoner/fase1-prove-f-innlogging.md punkt 3),
// strammet inn til en tillatt-liste i rett T-0070 (docs/agenter/oppgaver/rett-t0070-t0071.md punkt 1,
// testplan avsnitt 1a). Teknisk regel med testsaker som data. Støtter de ansatte (rett tilbake til
// siden etter innlogging) og sikkerhet: `neste` skal aldri kunne sende brukeren til en annen
// nettside (åpen videresending) eller bære søketekst eller navn.

const FORM_ID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";
const FALLBACK = "/arbeidskoe";
/** Nøyaktig 200 tegn. */
const PATH_200 = `/${"a".repeat(199)}`;

interface Case {
  label: string;
  input: string | string[] | undefined;
  expected: string;
}

const accepted: Case[] = [
  { label: "arbeidskøen", input: "/arbeidskoe", expected: "/arbeidskoe" },
  { label: "listen", input: "/prove/testskjema", expected: "/prove/testskjema" },
  {
    label: "et skjema",
    input: `/prove/testskjema/${FORM_ID}`,
    expected: `/prove/testskjema/${FORM_ID}`,
  },
  // Rett T-0070: alle interne sider med små bokstaver, tall og bindestrek
  { label: "et oppdrag", input: `/oppdrag/${FORM_ID}`, expected: `/oppdrag/${FORM_ID}` },
  {
    label: "bygningene i et oppdrag",
    input: `/oppdrag/${FORM_ID}/bygninger`,
    expected: `/oppdrag/${FORM_ID}/bygninger`,
  },
  { label: "en ordre", input: `/ordre/${FORM_ID}`, expected: `/ordre/${FORM_ID}` },
  { label: "/firma", input: "/firma", expected: "/firma" },
  { label: "/statistikk/tid", input: "/statistikk/tid", expected: "/statistikk/tid" },
  {
    label: "en ansatt i admin",
    input: `/admin/ansatte/${FORM_ID}`,
    expected: `/admin/ansatte/${FORM_ID}`,
  },
  { label: "/admin", input: "/admin", expected: "/admin" },
  { label: "nøyaktig 200 tegn", input: PATH_200, expected: PATH_200 },
  // Før bare en fast liste; nå godtas de fordi de er vanlige interne stier
  { label: "/prove/testskjema-x", input: "/prove/testskjema-x", expected: "/prove/testskjema-x" },
  {
    label: "/prove/testskjema/ikke-en-uuid",
    input: "/prove/testskjema/ikke-en-uuid",
    expected: "/prove/testskjema/ikke-en-uuid",
  },
  {
    label: "uuid og mer etterpå",
    input: `/prove/testskjema/${FORM_ID}/x`,
    expected: `/prove/testskjema/${FORM_ID}/x`,
  },
];

const rejected: Case[] = [
  // Mangler, tom, liste
  { label: "mangler", input: undefined, expected: FALLBACK },
  { label: "tom", input: "", expected: FALLBACK },
  { label: "liste", input: ["a", "b"], expected: FALLBACK },
  { label: "liste med trygg sti", input: ["/arbeidskoe"], expected: FALLBACK },
  // Annen nettside
  { label: "//evil.example", input: "//evil.example", expected: FALLBACK },
  { label: "/\\evil.example", input: "/\\evil.example", expected: FALLBACK },
  { label: "\\\\evil.example", input: "\\\\evil.example", expected: FALLBACK },
  { label: "https://evil.example", input: "https://evil.example", expected: FALLBACK },
  {
    label: "https://evil.example/prove/testskjema",
    input: "https://evil.example/prove/testskjema",
    expected: FALLBACK,
  },
  { label: "javascript:alert(1)", input: "javascript:alert(1)", expected: FALLBACK },
  { label: "data:", input: "data:text/html,hei", expected: FALLBACK },
  // Grensen etter prefikset
  { label: "/prove/testskjemaX", input: "/prove/testskjemaX", expected: FALLBACK },
  {
    label: "/prove/testskjema/ (skråstrek til slutt)",
    input: "/prove/testskjema/",
    expected: FALLBACK,
  },
  {
    label: "uuid med store bokstaver",
    input: `/prove/testskjema/${FORM_ID.toUpperCase()}`,
    expected: FALLBACK,
  },
  {
    label: "uuid med skråstrek til slutt",
    input: `/prove/testskjema/${FORM_ID}/`,
    expected: FALLBACK,
  },
  { label: "/arbeidskoeX", input: "/arbeidskoeX", expected: FALLBACK },
  { label: "/arbeidskoe/", input: "/arbeidskoe/", expected: FALLBACK },
  // Tab, linjeskift og andre kontrolltegn
  { label: "tab", input: "/\t/evil.example", expected: FALLBACK },
  { label: "linjeskift", input: "/\n/evil.example", expected: FALLBACK },
  { label: "vognretur", input: "/\r/evil.example", expected: FALLBACK },
  { label: "linjeskift til slutt", input: "/arbeidskoe\n", expected: FALLBACK },
  { label: "nulltegn", input: "/arbeidskoe\u0000", expected: FALLBACK },
  // Mellomrom eller andre tegn før skråstreken
  { label: "mellomrom foran", input: " /arbeidskoe", expected: FALLBACK },
  { label: "mellomrom bak", input: "/arbeidskoe ", expected: FALLBACK },
  { label: "x foran", input: "x/arbeidskoe", expected: FALLBACK },
  // Kodede tegn (ingen dekoding)
  { label: "%2F%2F", input: "/%2F%2Fevil.example", expected: FALLBACK },
  { label: "%5C", input: "/%5Cevil.example", expected: FALLBACK },
  { label: "kodet hele stien", input: "%2Farbeidskoe", expected: FALLBACK },
  { label: "kodet skråstrek i skjemastien", input: "%2Fprove%2Ftestskjema", expected: FALLBACK },
  // ..
  { label: "..", input: "/prove/testskjema/../../api/x", expected: FALLBACK },
  { label: "./", input: "/prove/./testskjema", expected: FALLBACK },
  // Spørrestreng og #
  { label: "spørrestreng", input: "/prove/testskjema?x=1", expected: FALLBACK },
  { label: "#", input: "/prove/testskjema#a", expected: FALLBACK },
  {
    label: "skjema med spørrestreng",
    input: `/prove/testskjema/${FORM_ID}?neste=//evil.example`,
    expected: FALLBACK,
  },
  // Andre sider på samme nettsted som ikke er på listen
  { label: "/api/...", input: "/api/auth/get-session", expected: FALLBACK },
  { label: "/logg-inn", input: "/logg-inn", expected: FALLBACK },
  { label: "/", input: "/", expected: FALLBACK },
  // Svært lang streng
  { label: "svært lang", input: `/${"a".repeat(100_000)}`, expected: FALLBACK },
  {
    label: "svært lang etter trygg sti",
    input: `/prove/testskjema/${FORM_ID}${"a".repeat(10_000)}`,
    expected: FALLBACK,
  },
  // Rett T-0070 (testplan 1a)
  { label: "/", input: "/", expected: FALLBACK },
  { label: "/\\\\evil", input: "/\\\\evil", expected: FALLBACK },
  { label: "http://evil.example", input: "http://evil.example", expected: FALLBACK },
  { label: "https:evil.example", input: "https:evil.example", expected: FALLBACK },
  { label: "data:text/html,x", input: "data:text/html,x", expected: FALLBACK },
  { label: "/oppdrag@evil.example", input: "/oppdrag@evil.example", expected: FALLBACK },
  { label: "uten skråstrek", input: "arbeidskoe", expected: FALLBACK },
  { label: "/%2F/evil", input: "/%2F/evil", expected: FALLBACK },
  { label: "%2F%2Fevil.example", input: "%2F%2Fevil.example", expected: FALLBACK },
  { label: "dobbelt kodet", input: "/%252F%252Fevil.example", expected: FALLBACK },
  { label: "linjeskift i stien", input: "/oppdrag\n//evil", expected: FALLBACK },
  { label: "tab til slutt", input: "/oppdrag\t", expected: FALLBACK },
  { label: "nulltegn i stien", input: "/\u0000x", expected: FALLBACK },
  { label: "mellomrom i stien", input: "/oppdrag /x", expected: FALLBACK },
  { label: "/.", input: "/.", expected: FALLBACK },
  { label: "/..", input: "/..", expected: FALLBACK },
  { label: "/oppdrag/../logg-inn", input: "/oppdrag/../logg-inn", expected: FALLBACK },
  { label: "/oppdrag/./x", input: "/oppdrag/./x", expected: FALLBACK },
  {
    label: "oppdrag med spørrestreng",
    input: `/oppdrag/${FORM_ID}?fane=parter`,
    expected: FALLBACK,
  },
  { label: "søketekst", input: "/arbeidskoe?q=Oppdiktet", expected: FALLBACK },
  { label: "/oppdrag#x", input: "/oppdrag#x", expected: FALLBACK },
  { label: "/Arbeidskoe", input: "/Arbeidskoe", expected: FALLBACK },
  { label: "/LOGG-INN", input: "/LOGG-INN", expected: FALLBACK },
  { label: "/logg-inn/", input: "/logg-inn/", expected: FALLBACK },
  { label: "/logg-inn med neste", input: "/logg-inn?neste=/arbeidskoe", expected: FALLBACK },
  { label: "/logg-inn/x", input: "/logg-inn/x", expected: FALLBACK },
  { label: "/%6Cogg-inn", input: "/%6Cogg-inn", expected: FALLBACK },
  { label: "/api", input: "/api", expected: FALLBACK },
  { label: "/_next/static/x", input: "/_next/static/x", expected: FALLBACK },
  { label: "/dev/epost", input: "/dev/epost", expected: FALLBACK },
  { label: "/oppdrag/", input: "/oppdrag/", expected: FALLBACK },
  { label: "/oppdrag//x", input: "/oppdrag//x", expected: FALLBACK },
  { label: "201 tegn", input: `${PATH_200}a`, expected: FALLBACK },
  { label: "over 2000 tegn", input: `/${"a".repeat(2001)}`, expected: FALLBACK },
];

describe("safeNextPath (safe-next-path.ts)", () => {
  it("standardsiden er arbeidskøen", () => {
    expect(DEFAULT_NEXT_PATH).toBe(FALLBACK);
  });

  it.each(accepted)("godtar $label uendret", ({ input, expected }) => {
    expect(safeNextPath(input)).toBe(expected);
    expect(isSafeNextPath(input)).toBe(true);
  });

  it.each(rejected)("$label gir /arbeidskoe", ({ input, expected }) => {
    expect(safeNextPath(input)).toBe(expected);
    expect(isSafeNextPath(input)).toBe(false);
  });

  it("svaret er alltid en sti på samme nettsted med bare trygge tegn", () => {
    const allowed = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
    for (const { input } of [...accepted, ...rejected]) {
      const result = safeNextPath(input);
      expect(result, JSON.stringify(input)).toMatch(allowed);
      // Tolket mot en hvilken som helst vert blir det samme vert
      expect(new URL(result, "https://ezprop.invalid").host).toBe("ezprop.invalid");
    }
  });

  it("kaster aldri", () => {
    const odd: unknown[] = [null, 42, {}, [], ["/arbeidskoe", "//evil.example"]];
    for (const value of odd) {
      expect(() => safeNextPath(value)).not.toThrow();
      expect(safeNextPath(value)).toBe(FALLBACK);
      expect(isSafeNextPath(value)).toBe(false);
    }
  });
});

// At lenken «Logg inn» fra synkstatusen (signInHref) godtas, testes i
// src/modules/offline-trial/sync-status-text.test.ts (shared importerer ikke fra modules).

describe("én safeNextPath i src/", () => {
  it("det finnes bare src/shared/navigation/safe-next-path.ts", () => {
    const found = readdirSync("src", { recursive: true, encoding: "utf8" })
      .map((file) => file.split("\\").join("/"))
      .filter((file) => file.endsWith("safe-next-path.ts"));
    expect(found).toEqual(["shared/navigation/safe-next-path.ts"]);
  });
});
