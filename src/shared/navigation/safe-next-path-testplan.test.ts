import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, isSafeNextPath, safeNextPath } from "./safe-next-path";

/*
 * Rett T-0070: `neste` på innloggingssiden er en tillatt-liste (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1a). Sakene er data i tabeller.
 * Regel: høyst 200 tegn, `^/[a-z0-9-]+(?:/[a-z0-9-]+)*$`, første ledd ikke `logg-inn`, `api`,
 * `_next` eller `dev`, ingen dekoding.
 *
 * Støtter hovedmål: de ansatte (tilbake til samme side etter innlogging) og sikkerheten rundt
 * dem (aldri videresending til et annet nettsted, og `neste` bærer aldri søketekst eller navn).
 */

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

/** Nøyaktig 200 tegn: «/oppdrag/» + bokstaver. */
const EXACTLY_200 = `/oppdrag/${"a".repeat(200 - "/oppdrag/".length)}`;
const LENGTH_201 = `/oppdrag/${"a".repeat(201 - "/oppdrag/".length)}`;

type Case = { label: string; input: unknown };

const accepted: Case[] = [
  { label: "arbeidskøen", input: "/arbeidskoe" },
  { label: "testskjemalisten", input: "/prove/testskjema" },
  { label: "et testskjema", input: `/prove/testskjema/${UUID}` },
  { label: "et oppdrag", input: `/oppdrag/${UUID}` },
  { label: "bygningene på et oppdrag", input: `/oppdrag/${UUID}/bygninger` },
  { label: "en ordre (bare som verdi)", input: `/ordre/${UUID}` },
  { label: "firma", input: "/firma" },
  { label: "statistikk for tid", input: "/statistikk/tid" },
  { label: "en ansatt i admin", input: `/admin/ansatte/${UUID}` },
  { label: "nøyaktig 200 tegn", input: EXACTLY_200 },
];

const rejected: Case[] = [
  // Tomme verdier og lister
  { label: "undefined", input: undefined },
  { label: "tom streng", input: "" },
  { label: "bare skråstrek", input: "/" },
  { label: "liste med trygg sti", input: ["/arbeidskoe"] },
  { label: "null", input: null },
  { label: "tall", input: 42 },
  { label: "objekt", input: {} },
  // Annen nettside
  { label: "//evil.example", input: "//evil.example" },
  { label: "/\\evil.example", input: "/\\evil.example" },
  { label: "\\\\evil.example", input: "\\\\evil.example" },
  { label: "/\\\\evil", input: "/\\\\evil" },
  { label: "http://evil.example", input: "http://evil.example" },
  { label: "https:evil.example", input: "https:evil.example" },
  { label: "javascript:alert(1)", input: "javascript:alert(1)" },
  { label: "data:text/html,x", input: "data:text/html,x" },
  { label: "/oppdrag@evil.example", input: "/oppdrag@evil.example" },
  // Uten innledende skråstrek
  { label: "arbeidskoe uten skråstrek", input: "arbeidskoe" },
  // Kodet
  { label: "/%2F%2Fevil.example", input: "/%2F%2Fevil.example" },
  { label: "/%2F/evil", input: "/%2F/evil" },
  { label: "/%5Cevil.example", input: "/%5Cevil.example" },
  { label: "%2F%2Fevil.example", input: "%2F%2Fevil.example" },
  { label: "dobbelt kodet /%252F%252Fevil.example", input: "/%252F%252Fevil.example" },
  // Kontrolltegn og mellomrom
  { label: "tab", input: "/\t/evil.example" },
  { label: "linjeskift", input: "/\n/evil.example" },
  { label: "linjeskift midt i", input: "/oppdrag\n//evil" },
  { label: "tab til slutt", input: "/oppdrag\t" },
  { label: "nulltegn", input: "/\u0000x" },
  { label: "mellomrom", input: "/oppdrag /x" },
  // Punktum
  { label: "/.", input: "/." },
  { label: "/..", input: "/.." },
  { label: "/oppdrag/../logg-inn", input: "/oppdrag/../logg-inn" },
  { label: "/oppdrag/./x", input: "/oppdrag/./x" },
  // Spørrestreng og #
  { label: "spørrestreng på oppdraget", input: `/oppdrag/${UUID}?fane=parter` },
  { label: "søketekst med navn", input: "/arbeidskoe?q=Oppdiktet" },
  { label: "#", input: "/oppdrag#x" },
  // Store bokstaver
  { label: "/Arbeidskoe", input: "/Arbeidskoe" },
  { label: "/LOGG-INN", input: "/LOGG-INN" },
  { label: "uuid med store bokstaver", input: `/oppdrag/${UUID.toUpperCase()}` },
  // Løkke og interne ruter
  { label: "/logg-inn", input: "/logg-inn" },
  { label: "/logg-inn/", input: "/logg-inn/" },
  { label: "/logg-inn?neste=/arbeidskoe", input: "/logg-inn?neste=/arbeidskoe" },
  { label: "/logg-inn/x", input: "/logg-inn/x" },
  { label: "/%6Cogg-inn", input: "/%6Cogg-inn" },
  { label: "/api/auth/get-session", input: "/api/auth/get-session" },
  { label: "/api", input: "/api" },
  { label: "/_next/static/x", input: "/_next/static/x" },
  { label: "/dev/epost", input: "/dev/epost" },
  { label: "/dev", input: "/dev" },
  // Avslutning og doble skråstreker
  { label: "/oppdrag/", input: "/oppdrag/" },
  { label: "/oppdrag//x", input: "/oppdrag//x" },
  // Lengde
  { label: "201 tegn", input: LENGTH_201 },
  { label: "over 2000 tegn", input: `/oppdrag/${"a".repeat(2500)}` },
];

describe("1a safeNextPath og isSafeNextPath: tillatt-liste", () => {
  it("DEFAULT_NEXT_PATH er arbeidskøen", () => {
    expect(DEFAULT_NEXT_PATH).toBe("/arbeidskoe");
  });

  it("nøyaktig 200 tegn og 201 tegn er riktig laget", () => {
    expect(EXACTLY_200).toHaveLength(200);
    expect(LENGTH_201).toHaveLength(201);
  });

  it.each(accepted)("godtar $label uendret", ({ input }) => {
    expect(isSafeNextPath(input)).toBe(true);
    expect(safeNextPath(input as string)).toBe(input);
  });

  it.each(rejected)("avviser $label (gir DEFAULT_NEXT_PATH)", ({ input }) => {
    expect(isSafeNextPath(input)).toBe(false);
    expect(safeNextPath(input as string)).toBe(DEFAULT_NEXT_PATH);
  });

  it("svaret er alltid en sti på samme nettsted, uten spørrestreng, # eller %", () => {
    for (const { input } of [...accepted, ...rejected]) {
      const result = safeNextPath(input as string);
      expect(result, JSON.stringify(input)).toMatch(/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
      expect(new URL(result, "https://ezprop.invalid").host).toBe("ezprop.invalid");
    }
  });

  it("kaster aldri", () => {
    for (const { input } of [...accepted, ...rejected]) {
      expect(() => safeNextPath(input as string)).not.toThrow();
      expect(() => isSafeNextPath(input)).not.toThrow();
    }
  });
});

// Lenken fra synkstatusen sjekkes i src/modules/offline-trial/sign-in-href-next-path-testplan.test.ts
// (src/shared kan ikke importere fra src/modules).

/* Statisk sjekk: én implementasjon, og innloggingssiden importerer den. */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../..");

function filesNamed(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesNamed(full, name));
    else if (entry === name) found.push(full);
  }
  return found;
}

describe("1a én safeNextPath i src/shared/navigation", () => {
  it("det finnes bare én safe-next-path.ts i src/, og den ligger i src/shared/navigation", () => {
    const files = filesNamed(SRC, "safe-next-path.ts").map((file) => path.relative(SRC, file));
    expect(files).toEqual([path.join("shared", "navigation", "safe-next-path.ts")]);
  });

  it.each(["app/logg-inn/page.tsx", "app/logg-inn/login-form.tsx"])(
    "%s importerer fra @/shared/navigation/safe-next-path",
    (file) => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source).toContain("@/shared/navigation/safe-next-path");
      expect(source).not.toMatch(/from "\.\/safe-next-path"/);
    },
  );
});
