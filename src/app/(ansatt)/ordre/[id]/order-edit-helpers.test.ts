import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/*
 * Rene hjelpere og statiske krav for skjemaet «Endre ordren» på /ordre/[id]
 * (docs/funksjoner/fase2a-rette-ordre-testplan.md 5.1, 10.4 og 10.7). Prosjektet har ingen
 * komponenttester, så meldingen for feilkoden og visningen av verdier ligger i rene hjelpere.
 *
 * Navnene på hjelperne er ikke låst i kortet («for eksempel `orderFormError(code)`»). Testen finner
 * dem ut fra oppførselen blant det som eksporteres fra `.ts`-filene i denne mappen og fra
 * `@/core/orders`. Finnes ingen, er testen rød med en melding om hva som mangler.
 *
 * Støtter hovedmål: de ansatte (ingenting som er skrevet, går tapt; tydelige verdier i
 * «Endringer») og færre reklamasjoner (skjemaverdier lagres aldri lokalt på enheten).
 */

vi.mock("server-only", () => ({}));

const dir = join(process.cwd(), "src", "app", "(ansatt)", "ordre", "[id]");
const CHANGED_MESSAGE = "Ordren er endret av en annen. Last siden på nytt.";

function sourceFiles(pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

type Fn = (...args: unknown[]) => unknown;

/** Alle eksporterte funksjoner fra de rene `.ts`-filene i mappen og fra `@/core/orders`. */
async function exportedFunctions(): Promise<Array<{ name: string; fn: Fn }>> {
  const modules: Record<string, unknown>[] = [];
  for (const file of sourceFiles(/\.ts$/)) {
    const text = readFileSync(file, "utf8");
    if (/^\s*["']use (server|client)["']/.test(text)) continue;
    modules.push((await import(/* @vite-ignore */ file)) as Record<string, unknown>);
  }
  modules.push((await import("@/core/orders")) as Record<string, unknown>);
  return modules.flatMap((module) =>
    Object.entries(module)
      .filter((entry): entry is [string, Fn] => typeof entry[1] === "function")
      .map(([name, fn]) => ({ name, fn })),
  );
}

/** Kaller bare rene, synkrone hjelpere; tjenester (async) og klasser hoppes over. */
function tryCall(fn: Fn, ...args: unknown[]): unknown {
  if (
    fn.constructor.name === "AsyncFunction" ||
    /^class\b/.test(Function.prototype.toString.call(fn))
  ) {
    return undefined;
  }
  try {
    const result = fn(...args);
    if (result instanceof Promise) {
      result.catch(() => undefined);
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  }
}

type FormError = { message: string; reload: boolean };

function isFormError(value: unknown): value is FormError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FormError).message === "string" &&
    typeof (value as FormError).reload === "boolean"
  );
}

async function findFormError(): Promise<Fn> {
  const candidates = await exportedFunctions();
  const named = candidates.find((candidate) => candidate.name === "orderFormError");
  if (named) return named.fn;
  const found = candidates.find((candidate) => {
    const result = tryCall(candidate.fn, "ORDER_CHANGED");
    return isFormError(result) && result.reload === true;
  });
  if (!found) {
    throw new Error(
      "fant ingen ren hjelper som gir { message, reload } for feilkoden (for eksempel orderFormError)",
    );
  }
  return found.fn;
}

describe("10.4 ren hjelper for meldingen i skjemaet", () => {
  it("ORDER_CHANGED gir den faste meldingen og reload: true", async () => {
    const formError = await findFormError();
    const result = formError("ORDER_CHANGED");
    expect(isFormError(result)).toBe(true);
    expect(result).toMatchObject({ message: CHANGED_MESSAGE, reload: true });
  });

  it.each(["NO_ACCESS", "UNKNOWN", "FIELDS", "CONTACT_NOT_FOUND", "", "toString"])(
    "andre koder («%s») gir reload: false",
    async (code) => {
      const formError = await findFormError();
      const result = tryCall(formError, code);
      if (result === null || result === undefined) return;
      expect(isFormError(result)).toBe(true);
      expect((result as FormError).reload).toBe(false);
    },
  );
});

/** Hjelperen som gjør en verdi om til tekst i «Endringer» (null → «(tom)», true → «Ja»). */
async function findValueFormatter(): Promise<(value: unknown) => unknown> {
  for (const { fn } of await exportedFunctions()) {
    if (
      tryCall(fn, true) === "Ja" &&
      tryCall(fn, false) === "Nei" &&
      tryCall(fn, null) === "(tom)"
    ) {
      return (value) => fn(value);
    }
    if (
      tryCall(fn, "sellerDeclarationReceived", true) === "Ja" &&
      tryCall(fn, "sellerDeclarationReceived", null) === "(tom)"
    ) {
      return (value) => fn(typeof value === "boolean" ? "sellerDeclarationReceived" : "gnr", value);
    }
  }
  throw new Error(
    "fant ingen ren hjelper for verdiene i «Endringer» (null → «(tom)», true → «Ja»)",
  );
}

describe("5.1 verdiformat i «Endringer» (regeltest)", () => {
  it.each([
    [null, "(tom)"],
    ["", "(tom)"],
    [true, "Ja"],
    [false, "Nei"],
    ["Testveien 14, 8000 Bodø", "Testveien 14, 8000 Bodø"],
  ] as const)("%j vises som «%s»", async (value, text) => {
    const format = await findValueFormatter();
    expect(format(value)).toBe(text);
  });

  it("tall vises som tall", async () => {
    const format = await findValueFormatter();
    expect(String(format(12))).toBe("12");
  });

  it("ISO-dato vises som norsk dato og klokkeslett (norsk tid)", async () => {
    const format = await findValueFormatter();
    const text = String(format("2026-11-02T08:00:00.000Z"));
    expect(text).toMatch(/02\.11\.2026/);
    expect(text).toMatch(/09[:.]00/);
    expect(text).not.toContain("T08:00");
  });
});

describe("10.7 ingen lokal lagring av skjemaverdier (AK 23, statisk)", () => {
  it("skjemafilene under /ordre/[id] nevner ikke localStorage, sessionStorage, indexedDB eller history", () => {
    const files = sourceFiles(/\.(ts|tsx)$/);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
      expect(text, file).not.toMatch(/history\.(pushState|replaceState)/);
    }
  });
});
