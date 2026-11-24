import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/*
 * Statiske sjekker for PDF-rutene og knappene (testplanen for PDF av badet avsnitt 6.5, 10.5.5,
 * 11.2.1, 11.3.1, 11.4.2, 11.7 og 11.8.2).
 *
 * Hovedmål: de ansatte (PDF-en hentes aldri fra mellomlageret, og ingenting lages på forhånd)
 * og færre reklamasjoner (hendelsene telles aldri per person, arbeidsmiljøloven kap. 9).
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const ASSIGNMENT_DIR = path.join(SRC, "app", "(ansatt)", "oppdrag", "[id]");
const UUID = "0193b000-0000-7000-8000-000000000001";
const RELEASE = "0193b000-0000-7000-8000-000000000002";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
    return [full];
  });
}

const sourceFiles = walk(SRC).filter(
  (file) => /\.(ts|tsx|mjs)$/.test(file) && !/\.test\.tsx?$/.test(file),
);

// --- 11.7 Service worker ---------------------------------------------------------------------

/** Kjører public/sw.js i en sandkasse og gir fetch-lytteren. */
function loadServiceWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: "http://localhost:3000" },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const context = vm.createContext({
    self,
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => undefined }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => new Response(""),
    URL,
    Response,
    Headers,
    console,
  });
  vm.runInContext(readFileSync(path.join(ROOT, "public", "sw.js"), "utf8"), context);
  const onFetch = listeners.get("fetch");
  if (!onFetch) throw new Error("sw.js har ingen fetch-lytter");
  return (pathname: string, mode: "navigate" | "no-cors" | "cors" = "navigate") => {
    const respondWith = vi.fn();
    onFetch({
      request: {
        method: "GET",
        url: `http://localhost:3000${pathname}`,
        mode,
        headers: new Headers(),
      },
      respondWith,
      waitUntil: () => undefined,
    });
    return respondWith;
  };
}

describe("11.7 service workeren mellomlagrer aldri PDF-ene", () => {
  it.each([
    `/oppdrag/${UUID}/pdf`,
    `/oppdrag/${UUID}/pdf?x=1`,
    `/oppdrag/${UUID}/utgivelser/${RELEASE}/pdf`,
  ])("%s går rett til nettet (aldri respondWith)", (pathname) => {
    const fetchEvent = loadServiceWorker();
    for (const mode of ["navigate", "no-cors", "cors"] as const) {
      expect(fetchEvent(pathname, mode)).not.toHaveBeenCalled();
    }
  });

  it("selvtest: sandkassen ser at statiske filer går gjennom service workeren", () => {
    const fetchEvent = loadServiceWorker();
    expect(fetchEvent("/_next/static/x.js", "no-cors")).toHaveBeenCalled();
  });
});

// --- 11.4.2 Knappene er vanlige lenker ------------------------------------------------------

describe("11.4.2 «Lag PDF (utkast)» og «Åpne PDF» er vanlige <a>, ikke next/link", () => {
  const components = walk(ASSIGNMENT_DIR).filter(
    (file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"),
  );
  // Tekstene og adressene står samlet i `pdf-texts.ts` (designet avsnitt 5 og 6); komponentene
  // bruker `draftPdfHref` og `releasePdfHref` derfra
  const textsFile = path.join(ASSIGNMENT_DIR, "pdf-texts.ts");
  const texts = readFileSync(textsFile, "utf8");
  const pdfLinkFiles = components.filter((file) =>
    /\/pdf[`"'?]|\b(draftPdfHref|releasePdfHref)\(/.test(readFileSync(file, "utf8")),
  );

  it("knappene finnes i komponentene", () => {
    const all = [...components.map((file) => readFileSync(file, "utf8")), texts].join("\n");
    expect(all).toContain("Lag PDF (utkast)");
    expect(all).toContain("Åpne PDF");
    expect(texts).toMatch(/\/oppdrag\/\$\{assignmentId\}\/pdf`/);
    expect(texts).toMatch(/\/oppdrag\/\$\{assignmentId\}\/utgivelser\/\$\{releaseId\}\/pdf`/);
    expect(pdfLinkFiles.length).toBeGreaterThan(0);
  });

  it.each(pdfLinkFiles.map((file) => [path.relative(ROOT, file), file]))(
    "%s lenker til PDF-en uten next/link og uten forhåndshenting",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+["']next\/link["']/);
      expect(source).not.toMatch(/router\.prefetch|prefetch=\{?true/);
      expect(source).toMatch(/<a[\s>]/);
    },
  );

  it("utgivelseskortet og skjermen etter publisering har «Åpne PDF»", () => {
    const card = readFileSync(path.join(ASSIGNMENT_DIR, "releases-card.tsx"), "utf8");
    expect(card).toMatch(/Åpne PDF/);
    const publish = walk(path.join(ASSIGNMENT_DIR, "publiser"))
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // Begge bruker lenken til utgivelsen, som bygger adressen `…/utgivelser/<id>/pdf`
    expect(card).toMatch(/<ReleasePdfLink\b/);
    expect(publish).toMatch(/<ReleasePdfLink\b/);
    const link = readFileSync(path.join(ASSIGNMENT_DIR, "release-pdf-link.tsx"), "utf8");
    expect(link).toMatch(/href=\{releasePdfHref\(/);
    expect(texts).toMatch(/utgivelser\//);
  });
});

// --- 10.5.5 og 11.8.2 Ingen telling per person ---------------------------------------------------

describe("10.5.5 og 11.8.2 ingen spørring grupperer hendelser på actor_id", () => {
  it("ingen fil i src grupperer på actor_id eller actorId", () => {
    const offenders = sourceFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /group\s*by[^;\n]*actor_id|groupBy\([^)]*actorId/i.test(source);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("PDF-hendelsene leses bare der de skrives (ingen statistikk per ansatt)", () => {
    const readers = sourceFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /(draft|release)_pdf_created/.test(source) &&
        !/src[\\/]core[\\/]events[\\/]types\.ts$/.test(file) &&
        /actorId|actor_id/.test(source)
      );
    });
    expect(readers.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

// --- 11.2.1 og 11.3.1 Telleren og arbeidstråden ----------------------------------------------------

describe("11.2.1 telleren og 11.3.1 arbeidstråden", () => {
  it("createKeyedLimiter brukes med staleAfterMs over 20 000 og over tidsgrensen", async () => {
    const { PDF_DEFAULT_LIMITS } = await import("@/core/pdf/codes");
    const users = sourceFiles.filter(
      (file) =>
        /createKeyedLimiter\(/.test(readFileSync(file, "utf8")) &&
        !file.endsWith("keyed-limiter.ts"),
    );
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) {
      const source = readFileSync(file, "utf8");
      const match = source.match(/staleAfterMs:\s*([^,\n}]+)/);
      expect(match, path.relative(ROOT, file)).not.toBeNull();
      const expression = match![1]!.trim();
      const literal = Number(expression.replace(/_/g, ""));
      if (Number.isFinite(literal)) {
        expect(literal).toBeGreaterThan(20_000);
        expect(literal).toBeGreaterThan(PDF_DEFAULT_LIMITS.timeoutMs);
      } else {
        // Uttrykk: må bygge på tidsgrensen og legge til
        expect(expression).toMatch(/timeoutMs\s*[+*]/);
      }
    }
  });

  it("arbeidstråden startes med resourceLimits og maxOldGenerationSizeMb", () => {
    const workers = sourceFiles.filter((file) => /new Worker\(/.test(readFileSync(file, "utf8")));
    const pdfWorkers = workers.filter((file) => file.includes(`${path.sep}pdf${path.sep}`));
    expect(pdfWorkers.length).toBeGreaterThan(0);
    for (const file of pdfWorkers) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/resourceLimits/);
      expect(source).toMatch(/maxOldGenerationSizeMb/);
    }
  });

  it("rutene finnes der kortet sier", () => {
    expect(existsSync(path.join(ASSIGNMENT_DIR, "pdf", "route.ts"))).toBe(true);
    expect(
      existsSync(path.join(ASSIGNMENT_DIR, "utgivelser", "[releaseId]", "pdf", "route.ts")),
    ).toBe(true);
  });
});
