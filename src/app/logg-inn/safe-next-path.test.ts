import { describe, expect, it } from "vitest";
import { signInHref } from "@/modules/offline-trial/sync-status-text";
import { safeNextPath } from "./safe-next-path";

// Prøve F – `neste` på innloggingssiden (docs/funksjoner/fase1-prove-f-innlogging.md, punkt 3).
// Testplan: docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 1. Teknisk regel med
// testsaker som data. Støtter tid (rett tilbake til skjemaet etter innlogging) og sikkerhet:
// `neste` skal aldri kunne sende brukeren til en annen nettside (åpen videresending).

const FORM_ID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";
const FALLBACK = "/arbeidskoe";

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
  { label: "/prove/testskjema-evil", input: "/prove/testskjema-evil", expected: FALLBACK },
  {
    label: "/prove/testskjema/ikke-en-uuid",
    input: "/prove/testskjema/ikke-en-uuid",
    expected: FALLBACK,
  },
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
    label: "uuid og mer etterpå",
    input: `/prove/testskjema/${FORM_ID}/x`,
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
  { label: "/admin", input: "/admin", expected: FALLBACK },
  // Svært lang streng
  { label: "svært lang", input: `/${"a".repeat(100_000)}`, expected: FALLBACK },
  {
    label: "svært lang etter trygg sti",
    input: `/prove/testskjema/${FORM_ID}${"a".repeat(10_000)}`,
    expected: FALLBACK,
  },
];

describe("safeNextPath (safe-next-path.ts)", () => {
  it.each(accepted)("godtar $label uendret", ({ input, expected }) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each(rejected)("$label gir /arbeidskoe", ({ input, expected }) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("svaret er alltid en sti på samme nettsted og en av de tre trygge formene", () => {
    const allowed = /^(\/arbeidskoe|\/prove\/testskjema(\/[0-9a-f-]{36})?)$/;
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
      expect(() => safeNextPath(value as string | string[] | undefined)).not.toThrow();
      expect(safeNextPath(value as string | string[] | undefined)).toBe(FALLBACK);
    }
  });
});

describe("lenken «Logg inn» i synkstatusen og safeNextPath passer sammen", () => {
  it.each([
    `/prove/testskjema/${FORM_ID}`,
    `/prove/testskjema/${FORM_ID}?x=1#a`,
    "/prove/testskjema",
  ])("neste fra signInHref(%s) godtas uendret", (pathname) => {
    const next = new URL(signInHref(pathname), "https://ezprop.invalid").searchParams.get("neste");
    expect(next).not.toBeNull();
    expect(safeNextPath(next ?? undefined)).toBe(next);
    expect(next).toBe(pathname.split(/[?#]/)[0]);
  });
});
