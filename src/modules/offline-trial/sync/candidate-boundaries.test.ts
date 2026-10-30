import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sidene og bildekøen er kandidatuavhengige (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 2
// og avgjørelse A og E), ellers blir kriteriet «Arbeid» skjevt mellom kandidatene. Testplan
// avsnitt 2.5. Filene leses som tekst; ingen ESLint-regel.

const ROOT = process.cwd();
const MODULE = "src/modules/offline-trial";
const PAGES = "src/app/(ansatt)/prove/testskjema";
const HEADER = "Prøve fase 1, kastes eller gjøres om etter ADR";

/**
 * Kandidatenes pakker og mapper, også den lokale kjernen (`sync/local/`) og egenbygd
 * (`sync/custom/`). Treffer både `@/…/sync/powersync/x` og `./powersync/x`.
 */
const CANDIDATE_SPECIFIER =
  /@powersync\/|@electric-sql\/|(^|\/)sync\/(powersync|electricsql|custom|local)(\/|$)|^\.\.?\/(powersync|electricsql|custom|local)(\/|$)/;

/** Rene filer: ingen nettleser-API, React eller SDK. */
function expectPure(relative: string) {
  const text = read(relative);
  const specifiers = specifiersOf(text).map((entry) => entry.specifier);
  expect(
    specifiers.filter(
      (s) =>
        s === "react" ||
        s.startsWith("react/") ||
        s.startsWith("@electric-sql/") ||
        s.startsWith("@powersync/"),
    ),
    relative,
  ).toEqual([]);
  for (const word of ["window.", "indexedDB", "document.", "navigator."]) {
    expect(text.includes(word), `${relative} inneholder ${word}`).toBe(false);
  }
}

function read(relative: string): string {
  const file = path.join(ROOT, relative);
  expect(existsSync(file), `${relative} mangler`).toBe(true);
  return readFileSync(file, "utf8");
}

function filesUnder(relative: string, pattern: RegExp): string[] {
  const dir = path.join(ROOT, relative);
  expect(existsSync(dir), `${relative} mangler`).toBe(true);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const child = path.join(relative, name);
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...filesUnder(child, pattern));
    else if (pattern.test(name)) out.push(child);
  }
  return out;
}

interface Specifier {
  specifier: string;
  kind: "static" | "type" | "dynamic";
}

/** Alle modulnavn filen henter: `import … from`, `export … from`, `import "x"`, `import("x")`, `require("x")`. */
function specifiersOf(text: string): Specifier[] {
  const out: Specifier[] = [];
  const fromPattern = /\b(import|export)\s+(type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(fromPattern)) {
    out.push({ specifier: match[3]!, kind: match[2] ? "type" : "static" });
  }
  for (const match of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    out.push({ specifier: match[1]!, kind: "static" });
  }
  for (const match of text.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    out.push({ specifier: match[1]!, kind: "dynamic" });
  }
  return out;
}

function candidateImports(relative: string): string[] {
  return specifiersOf(read(relative))
    .map((entry) => entry.specifier)
    .filter((specifier) => CANDIDATE_SPECIFIER.test(specifier));
}

function startsWithHeader(relative: string): boolean {
  const text = read(relative).trimStart();
  let comment: string | undefined;
  if (text.startsWith("/*")) comment = text.slice(0, text.indexOf("*/") + 2);
  else if (text.startsWith("//")) comment = /^(?:\/\/.*\n?)+/.exec(text)?.[0];
  return comment !== undefined && comment.includes(HEADER);
}

/** Hvert `console.error(…)` og `console.warn(…)` i teksten, med argumentene (parentesene telles). */
function logCalls(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/console\.(error|warn)\(/g)) {
    let depth = 0;
    let end = match.index;
    for (let i = match.index + match[0].length - 1; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    out.push(text.slice(match.index, end).replace(/\s+/g, " "));
  }
  return out;
}

describe("kandidatgrensene", () => {
  // Obligatorisk (rettferdig «Arbeid»)
  it("sidene under prove/testskjema importerer ikke fra noen kandidat", () => {
    const files = filesUnder(PAGES, /\.tsx?$/);
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => candidateImports(file).map((spec) => `${file}: ${spec}`));
    expect(found).toEqual([]);
  });

  it("photo-uploader.ts importerer ikke fra noen kandidat", () => {
    expect(candidateImports(`${MODULE}/sync/photo-uploader.ts`)).toEqual([]);
  });

  it("sync-status.tsx importerer ikke fra noen kandidat", () => {
    expect(candidateImports(`${MODULE}/sync-status.tsx`)).toEqual([]);
  });

  // Synkstatus (docs/funksjoner/fase1-synkstatus-testplan.md avsnitt 2.6)
  it("synkstatusen kjenner ingen kandidat", () => {
    const files = [
      `${MODULE}/sync-status.tsx`,
      `${MODULE}/sync-status-text.ts`,
      `${MODULE}/sync/sync-now.ts`,
    ];
    const found = files.flatMap((file) => candidateImports(file).map((spec) => `${file}: ${spec}`));
    expect(found).toEqual([]);
    // De rene filene har heller ingen nettleser-API, React eller SDK
    expectPure(`${MODULE}/sync-status-text.ts`);
    expectPure(`${MODULE}/sync/sync-now.ts`);
    // Hodekommentaren i de rene filene («use client» står først i sync-status.tsx)
    for (const file of files.slice(1)) expect(startsWithHeader(file), file).toBe(true);
    expect(read(`${MODULE}/sync-status.tsx`)).toContain(HEADER);
  });

  it("sync-indicator.tsx er fjernet", () => {
    expect(existsSync(path.join(ROOT, `${MODULE}/sync-indicator.tsx`))).toBe(false);
    const importers = filesUnder("src", /\.tsx?$/).filter((file) =>
      specifiersOf(read(file)).some((entry) => /(^|\/)sync-indicator$/.test(entry.specifier)),
    );
    expect(importers).toEqual([]);
  });

  it("Lagret kl. regnes ut ett sted", () => {
    const sources = filesUnder("src", /\.tsx?$/).filter((file) => !/\.test\.tsx?$/.test(file));
    const definesNextSavedAt = sources.filter((file) =>
      /\b(function|const)\s+nextSavedAt\b/.test(read(file)),
    );
    expect(definesNextSavedAt).toEqual([`${MODULE}/sync-status-text.ts`]);
    // Ingen kandidatfil skriver nøklene for «Lagret kl.»; bare skjermen og select-store.ts
    const candidateFiles = ["powersync", "electricsql", "custom", "local"].flatMap((dir) =>
      filesUnder(`${MODULE}/sync/${dir}`, /\.tsx?$/).filter((file) => !/\.test\.tsx?$/.test(file)),
    );
    const writers = candidateFiles.filter((file) => /trial_saved_at_|savedAtKey/.test(read(file)));
    expect(writers).toEqual([]);
    const mentions = sources.filter((file) => /trial_saved_at_/.test(read(file)));
    for (const file of mentions) {
      expect([`${MODULE}/sync-status.tsx`, `${MODULE}/sync/select-store.ts`], file).toContain(file);
    }
  });

  it("de rene filene i sync/electricsql importerer ikke window, React eller @electric-sql", () => {
    // outbox.ts og apply-incoming.ts er flyttet til sync/local (testen under).
    expectPure(`${MODULE}/sync/electricsql/shape-messages.ts`);
  });

  it("de rene filene i sync/local og sync/custom importerer ikke window, React eller @electric-sql", () => {
    for (const name of ["outbox.ts", "apply-incoming.ts", "normalize-row.ts"]) {
      expectPure(`${MODULE}/sync/local/${name}`);
    }
    // Hente-leseren og takten (testplan 2.5): nett bare via ctx.isOnline(), aldri navigator
    for (const name of ["pull-schedule.ts", "reader.ts"]) {
      expectPure(`${MODULE}/sync/custom/${name}`);
    }
  });

  // Obligatorisk (kandidat 3 knyttes ikke til en kandidat som kanskje kastes)
  it("sync/custom importerer aldri fra sync/electricsql eller sync/powersync", () => {
    const files = filesUnder(`${MODULE}/sync/custom`, /\.ts$/).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThanOrEqual(4);
    const found = files.flatMap((file) =>
      specifiersOf(read(file))
        .map((entry) => entry.specifier)
        .filter((spec) =>
          /(^|\/)(electricsql|powersync)(\/|$)|@electric-sql\/|@powersync\//.test(spec),
        )
        .map((spec) => `${file}: ${spec}`),
    );
    expect(found).toEqual([]);
  });

  it("sync/local importerer aldri fra noen kandidat", () => {
    const files = filesUnder(`${MODULE}/sync/local`, /\.ts$/).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThanOrEqual(5);
    const found = files.flatMap((file) =>
      specifiersOf(read(file))
        .map((entry) => entry.specifier)
        .filter((spec) =>
          /(^|\/)(electricsql|powersync|custom)(\/|$)|@electric-sql\/|@powersync\//.test(spec),
        )
        .map((spec) => `${file}: ${spec}`),
    );
    expect(found).toEqual([]);
  });

  it("select-store.ts laster kandidaten med dynamisk import", () => {
    const relative = `${MODULE}/sync/select-store.ts`;
    const specifiers = specifiersOf(read(relative));
    // Bare typer (fjernes ved bygging) er lov statisk; koden lastes med import()
    const staticCandidate = specifiers.filter(
      (entry) => entry.kind === "static" && CANDIDATE_SPECIFIER.test(entry.specifier),
    );
    expect(staticCandidate.map((entry) => entry.specifier)).toEqual([]);
    const dynamic = specifiers.filter((entry) => entry.kind === "dynamic").map((e) => e.specifier);
    expect(
      dynamic.some((s) => /(^|\/)powersync\//.test(s)),
      "import() for powersync",
    ).toBe(true);
    expect(
      dynamic.some((s) => /(^|\/)electricsql\//.test(s)),
      "import() for electricsql",
    ).toBe(true);
    // Kandidat 3 (testplan egenbygd 2.5): egen dynamisk import, ingen statisk import fra custom/ eller local/
    expect(
      dynamic.some((s) => /(^|\/)custom\//.test(s)),
      "import() for custom",
    ).toBe(true);
    const staticCustomOrLocal = specifiers.filter(
      (entry) => entry.kind === "static" && /(^|\/)(custom|local)\//.test(entry.specifier),
    );
    expect(staticCustomOrLocal.map((entry) => entry.specifier)).toEqual([]);
  });

  it("types.ts har ikke getAnswers", () => {
    const text = read(`${MODULE}/sync/types.ts`);
    expect(text).not.toContain("getAnswers");
    for (const name of [
      "flush",
      "close",
      "subscribeForms",
      "onStatusChange",
      "listPendingPhotos",
      "markPhotoUploaded",
      "TrialSyncTestable",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("alle filer i sync/electricsql har hodekommentaren", () => {
    const electric = filesUnder(`${MODULE}/sync/electricsql`, /\.ts$/).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    // Minst typene og de tre rene filene
    expect(electric.length).toBeGreaterThanOrEqual(4);
    const files = [
      ...electric,
      `${MODULE}/server/electric-shape.ts`,
      `${MODULE}/sync/select-store.ts`,
      `${MODULE}/sync/test-hooks.ts`,
    ];
    const missing = files.filter((file) => !startsWithHeader(file));
    expect(missing).toEqual([]);
  });

  it("alle filer i sync/local og sync/custom har hodekommentaren", () => {
    const files = [
      ...filesUnder(`${MODULE}/sync/local`, /\.ts$/),
      ...filesUnder(`${MODULE}/sync/custom`, /\.ts$/),
    ].filter((file) => !file.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(6);
    // Hente-ruten og spørringen bak den er også prøvekode (testplan egenbygd 2.5)
    files.push(`${MODULE}/server/changes-since.ts`, "src/app/api/prove/synk/hent/route.ts");
    const missing = files.filter((file) => !startsWithHeader(file));
    expect(missing).toEqual([]);
  });

  // Prøve C – lagring (docs/funksjoner/fase1-prove-c-lagring-testplan.md avsnitt 2.2)
  it("storage-health.ts importerer ikke fra noen kandidat og ikke React", () => {
    const file = `${MODULE}/storage-health.ts`;
    expect(candidateImports(file)).toEqual([]);
    const react = specifiersOf(read(file))
      .map((entry) => entry.specifier)
      .filter((s) => s === "react" || s.startsWith("react/") || s.startsWith("react-dom"));
    expect(react).toEqual([]);
  });

  it("storage-health.ts har hodekommentaren", () => {
    expect(read(`${MODULE}/storage-health.ts`)).toContain(HEADER);
  });

  // Obligatorisk (loggregelen: aldri svaret eller bildet i loggen)
  it("loggen ved lagringsfeil bruker storageErrorLog", () => {
    const files = [`${PAGES}/[id]/trial-form-page.tsx`, `${PAGES}/trial-sync-provider.tsx`];
    for (const file of files) {
      const text = read(file);
      const calls = logCalls(text);
      const storageCalls = calls.filter((call) => /lagr/i.test(call));
      expect(storageCalls.length, `${file}: logg om lagring`).toBeGreaterThan(0);
      for (const call of storageCalls) {
        expect(call, `${file}: ${call}`).toContain("storageErrorLog(");
      }
      // Ingen logg med det rå feilobjektet som siste argument
      for (const call of calls) {
        expect(/,\s*(error|err|e|reason)\s*,?\s*\)$/.test(call), `${file}: ${call}`).toBe(false);
      }
    }
  });

  // Prøve D – bilder (docs/funksjoner/fase1-prove-d-bilder-testplan.md avsnitt 2.4).
  // «photo-uploader.ts importerer fortsatt ingen kandidat» dekkes av testen over, uendret.
  it("display-copy.ts importerer ikke fra noen kandidat og ikke React", () => {
    const file = `${MODULE}/sync/display-copy.ts`;
    expect(candidateImports(file)).toEqual([]);
    const react = specifiersOf(read(file))
      .map((entry) => entry.specifier)
      .filter((s) => s === "react" || s.startsWith("react/") || s.startsWith("react-dom"));
    expect(react).toEqual([]);
  });

  it("display-copy.ts har hodekommentaren", () => {
    expect(read(`${MODULE}/sync/display-copy.ts`)).toContain(HEADER);
  });

  it("testkroken for lagring leses bare med miljøvariabelen", () => {
    const hookFile = `${MODULE}/storage-test-hook.ts`;
    const text = read(hookFile);
    expect(text).toContain("__offlineTrialStorage");
    // Samme vakt som sync/test-hooks.ts: direkte eller via trialTestHooksEnabled()
    const guard = /NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS\s*===\s*["']1["']/;
    const usesSharedGuard =
      /\btrialTestHooksEnabled\s*\(/.test(text) &&
      specifiersOf(text).some((entry) => /(^|\/)test-hooks$/.test(entry.specifier));
    expect(guard.test(text) || usesSharedGuard, hookFile).toBe(true);
    expect(read(`${MODULE}/sync/test-hooks.ts`)).toMatch(guard);
    // Ingen annen kildefil leser kroken direkte
    const readers = filesUnder("src", /\.tsx?$/)
      .filter((file) => !/\.test\.tsx?$/.test(file) && file !== hookFile)
      .filter((file) => read(file).includes("__offlineTrialStorage"));
    expect(readers).toEqual([]);
  });
});
