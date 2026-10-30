import { describe, expect, it } from "vitest";
import * as syncStatusText from "@/modules/offline-trial/sync-status-text";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

const FORM_ID = "3f2b8c1e-7a4d-4e9b-9c2a-1b5d6e7f8a90";

const cases: Array<[string, string | string[] | undefined, string]> = [
  // Godtas uendret
  ["arbeidskøen", "/arbeidskoe", "/arbeidskoe"],
  ["listen over testskjema", "/prove/testskjema", "/prove/testskjema"],
  ["ett testskjema", `/prove/testskjema/${FORM_ID}`, `/prove/testskjema/${FORM_ID}`],
  // Mangler, tom, liste
  ["mangler", undefined, DEFAULT_NEXT_PATH],
  ["tom", "", DEFAULT_NEXT_PATH],
  ["liste", ["a", "b"], DEFAULT_NEXT_PATH],
  ["liste med godkjent sti", ["/prove/testskjema"], DEFAULT_NEXT_PATH],
  // Andre nettsteder og protokoller
  ["to skråstreker", "//evil.example", DEFAULT_NEXT_PATH],
  ["omvendt skråstrek", "/\\evil.example", DEFAULT_NEXT_PATH],
  ["https", "https://evil.example", DEFAULT_NEXT_PATH],
  ["javascript", "javascript:alert(1)", DEFAULT_NEXT_PATH],
  // Grensen etter prefikset
  ["tegn rett etter prefikset", "/prove/testskjemaX", DEFAULT_NEXT_PATH],
  ["bindestrek etter prefikset", "/prove/testskjema-evil", DEFAULT_NEXT_PATH],
  ["ikke en uuid", "/prove/testskjema/ikke-en-uuid", DEFAULT_NEXT_PATH],
  ["uuid med store bokstaver", `/prove/testskjema/${FORM_ID.toUpperCase()}`, DEFAULT_NEXT_PATH],
  ["skråstrek etter uuid", `/prove/testskjema/${FORM_ID}/`, DEFAULT_NEXT_PATH],
  ["skråstrek etter arbeidskøen", "/arbeidskoe/", DEFAULT_NEXT_PATH],
  // Kontrolltegn
  ["tab", "/\t/evil.example", DEFAULT_NEXT_PATH],
  ["linjeskift", "/\n/evil.example", DEFAULT_NEXT_PATH],
  ["linjeskift etter godkjent sti", "/arbeidskoe\n", DEFAULT_NEXT_PATH],
  // Tegn før skråstreken
  ["mellomrom først", " /arbeidskoe", DEFAULT_NEXT_PATH],
  ["bokstav først", "x/arbeidskoe", DEFAULT_NEXT_PATH],
  // Kodede tegn
  ["kodet skråstrek", "/%2F%2Fevil.example", DEFAULT_NEXT_PATH],
  ["kodet omvendt skråstrek", "/%5Cevil.example", DEFAULT_NEXT_PATH],
  // ..
  ["to punktum", "/prove/testskjema/../../api/x", DEFAULT_NEXT_PATH],
  // Spørrestreng og #
  ["spørrestreng", "/prove/testskjema?x=1", DEFAULT_NEXT_PATH],
  ["#", "/prove/testskjema#a", DEFAULT_NEXT_PATH],
  // Andre sider
  ["api", "/api/auth/get-session", DEFAULT_NEXT_PATH],
  ["innloggingssiden", "/logg-inn", DEFAULT_NEXT_PATH],
  ["svært lang streng", `/prove/testskjema/${"a".repeat(10_000)}`, DEFAULT_NEXT_PATH],
];

describe("safeNextPath", () => {
  it.each(cases)("%s", (_name, input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

// signInHref bygges i en annen bit av oppgaven. Testen kjører så snart funksjonen finnes.
const signInHref = (syncStatusText as unknown as { signInHref?: (pathname: string) => string })
  .signInHref;

describe("signInHref og safeNextPath passer sammen", () => {
  it.skipIf(typeof signInHref !== "function")(
    "neste fra lenken godtas uendret, uten spørrestreng og #",
    () => {
      const href = signInHref!(`/prove/testskjema/${FORM_ID}?x=1#a`);
      const next = new URL(href, "http://localhost").searchParams.get("neste");
      expect(next).toBe(`/prove/testskjema/${FORM_ID}`);
      expect(safeNextPath(next ?? undefined)).toBe(next);
    },
  );
});
