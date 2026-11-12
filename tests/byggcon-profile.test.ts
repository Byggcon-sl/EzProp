import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Byggcon-profilen: forbudte ord, skriftfiler, lisens, forhåndslasting, synkstatus uten hex,
 * skjermbilder og designprinsippene.
 * Testplan: docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 1 og 9.
 * Ren test, ingen database. Denne filen ligger i tests/ og telles ikke i søket.
 *
 * Støtter hovedmål: de ansatte (skriften virker uten nett, ett Byggcon-uttrykk), KI i bunnen
 * (KI-merket er beskrevet i designprinsippene) og færre reklamasjoner (TG alltid med tekst).
 */

const repoRoot = join(__dirname, "..");
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");

/** Filtyper som leses som tekst. Andre filer (skrift, bilder) sjekkes bare på filnavn. */
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|css|md|txt|html|svg|webmanifest)$/i;

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const scanned = () => [...allFiles(join(repoRoot, "src")), ...allFiles(join(repoRoot, "public"))];

/** Treff som «fil:linje: tekst» for innholdet, og «fil (filnavn)» for navnet. */
function findHits(pattern: RegExp, files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (pattern.test(rel(file))) hits.push(`${rel(file)} (filnavn)`);
    if (!TEXT_FILE.test(file)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line))
          hits.push(`${rel(file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  return hits;
}

const FORBIDDEN_WORDS = /aurora|gradient|roboto/i;
const GOOGLE_FONTS = /fonts\.googleapis|fonts\.gstatic|next\/font\/google/;

describe("1.1 og 1.2 forbudte ord i src/ og public/", () => {
  it("kontroll: søket finner et oppdiktet treff i innhold og filnavn", () => {
    expect(FORBIDDEN_WORDS.test("bg-gradient-to-br")).toBe(true);
    expect(FORBIDDEN_WORDS.test("Roboto-Regular.ttf")).toBe(true);
    expect(FORBIDDEN_WORDS.test(".aurora-bar")).toBe(true);
    expect(GOOGLE_FONTS.test('import { Inter } from "next/font/google";')).toBe(true);
  });

  it("søket ser faktisk filer i src/ og public/", () => {
    const files = scanned().map(rel);
    expect(files).toContain("src/app/globals.css");
    expect(files).toContain("src/app/layout.tsx");
    expect(files.some((file) => file.startsWith("public/"))).toBe(true);
  });

  it("1.1 ingen nordlys, fargeovergang eller Roboto (innhold og filnavn)", () => {
    expect(findHits(FORBIDDEN_WORDS, scanned())).toEqual([]);
  });

  it("1.2 ingen Google-skrift", () => {
    expect(findHits(GOOGLE_FONTS, scanned())).toEqual([]);
  });
});

const FONT_SOURCE = join(repoRoot, "docs", "design", "byggcon-profil", "fonts");
const PUBLIC_FONTS = join(repoRoot, "public", "fonts");

const INTER_FILES = [
  "Inter-Regular.ttf",
  "Inter-Medium.ttf",
  "Inter-SemiBold.ttf",
  "Inter-Bold.ttf",
];
const SCHIBSTED_FILES = [
  "SchibstedGrotesk-Medium.ttf",
  "SchibstedGrotesk-SemiBold.ttf",
  "SchibstedGrotesk-Bold.ttf",
];
const LICENSE_FILES = ["OFL-Inter.txt", "OFL-SchibstedGrotesk.txt"];

describe("1.3 og 1.4 skriftfilene og lisensen", () => {
  const publicFonts = () => (existsSync(PUBLIC_FONTS) ? readdirSync(PUBLIC_FONTS) : []);

  it("grunnlaget i docs/design/byggcon-profil/fonts har filene testen venter", () => {
    const source = readdirSync(FONT_SOURCE);
    for (const file of [...INTER_FILES, ...SCHIBSTED_FILES, ...LICENSE_FILES]) {
      expect(source, file).toContain(file);
    }
  });

  it.each([...INTER_FILES, ...SCHIBSTED_FILES])(
    "1.3 public/fonts har %s, og den er ikke tom",
    (file) => {
      expect(publicFonts()).toContain(file);
      expect(statSync(join(PUBLIC_FONTS, file)).size).toBeGreaterThan(0);
    },
  );

  it("1.3 alle skriftfilene i grunnlaget ligger i public/fonts, og ingen Roboto-fil", () => {
    const wanted = readdirSync(FONT_SOURCE).filter((file) => /\.(ttf|woff2?)$/i.test(file));
    const present = publicFonts();
    expect(wanted.filter((file) => !present.includes(file))).toEqual([]);
    expect(present.filter((file) => /^roboto/i.test(file))).toEqual([]);
  });

  it.each(LICENSE_FILES)("1.4 lisensfilen %s ligger ved siden av skriftene", (file) => {
    expect(publicFonts()).toContain(file);
    expect(readFileSync(join(PUBLIC_FONTS, file), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("1.4 README nevner SIL OFL 1.1, Inter og Schibsted Grotesk, ikke Roboto", () => {
    const readme = readFileSync(join(PUBLIC_FONTS, "README.md"), "utf8");
    expect(readme).toContain("SIL OFL 1.1");
    expect(readme).toContain("Inter");
    expect(readme).toContain("Schibsted Grotesk");
    expect(readme).not.toMatch(/roboto/i);
  });
});

/** Hvert `localFont({ ... })`-kall i layout.tsx som tekst, til og med parentesen som lukker det. */
function localFontCalls(source: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("localFont(", from);
    if (start < 0) return calls;
    let depth = 0;
    let end = start + "localFont".length;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      if (source[end] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

describe("1.5 forhåndslasting (D2, A225)", () => {
  const layout = () => readFileSync(join(repoRoot, "src", "app", "layout.tsx"), "utf8");
  const calls = () => localFontCalls(layout());

  it("kontroll: tolken finner kallene i en liten streng", () => {
    const sample = `const a = localFont({ src: [{ path: "x" }], preload: true });\nconst b = localFont({ src: "y" });`;
    expect(localFontCalls(sample)).toHaveLength(2);
    expect(localFontCalls(sample)[0]).toContain("preload: true");
  });

  it("layout.tsx bruker next/font/local med to familier", () => {
    expect(layout()).toContain('from "next/font/local"');
    expect(calls()).toHaveLength(2);
  });

  it("nøyaktig ett `preload: true`, og det er Inter med alle fire vektene", () => {
    expect(layout().match(/preload:\s*true/g) ?? []).toHaveLength(1);
    const inter = calls().find((call) => /Inter-/.test(call));
    expect(inter, "localFont-kallet for Inter").toBeDefined();
    expect(inter).toMatch(/preload:\s*true/);
    for (const file of INTER_FILES) expect(inter).toContain(file);
    for (const weight of ["400", "500", "600", "700"]) {
      expect(inter).toMatch(new RegExp(`weight:\\s*"${weight}"`));
    }
    expect(inter).toMatch(/variable:\s*"--font-inter"/);
  });

  it("Schibsted Grotesk har `preload: false` og vektene 500, 600 og 700", () => {
    const schibsted = calls().find((call) => /SchibstedGrotesk-/.test(call));
    expect(schibsted, "localFont-kallet for Schibsted Grotesk").toBeDefined();
    expect(schibsted).toMatch(/preload:\s*false/);
    for (const file of SCHIBSTED_FILES) expect(schibsted).toContain(file);
    expect(schibsted).toMatch(/variable:\s*"--font-schibsted"/);
  });

  it('bare `display: "swap"`, og `adjustFontFallback` er ikke slått av', () => {
    const displays = [...layout().matchAll(/display:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(displays.length).toBeGreaterThanOrEqual(2);
    expect(displays.every((value) => value === "swap")).toBe(true);
    expect(layout()).not.toMatch(/adjustFontFallback:\s*false/);
  });

  it("begge skriftvariablene settes på <html>", () => {
    expect(layout()).toMatch(/className=\{`[^`]*inter\.variable[^`]*schibsted\.variable[^`]*`\}/);
  });
});

describe("1.6 synkstatusen bruker tokens", () => {
  it("sync-status.tsx har ingen fast hex-verdi", () => {
    const source = readFileSync(
      join(repoRoot, "src", "modules", "offline-trial", "sync-status.tsx"),
      "utf8",
    );
    const hits = source
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /#[0-9a-f]{3,6}\b/i.test(line))
      .map(({ line, index }) => `linje ${index + 1}: ${line.trim()}`);
    expect(hits).toEqual([]);
    expect(source).toContain("sync-");
  });
});

/*
 * 9.1 Skjermbildene. Navnet er `ezprop-<for|etter>-<skjerm>-<pc|ipad>.<png|jpg>`. Skjermen kan
 * skrives på noen få måter (kortet sier ikke noe fast navn).
 */
const SCREENS: Record<string, RegExp> = {
  innlogging: /^(innlogging|logg-inn)$/,
  arbeidsko: /^(arbeidsko|arbeidskoe|arbeidskoen|dashbord)$/,
  oppdrag: /^oppdrag$/,
  skjema: /^(skjema|testskjema)$/,
  ki: /^(ki|prove-ki)$/,
};

describe("9.1 skjermbilder før og etter", () => {
  const dir = join(repoRoot, "docs", "design", "byggcon-profil", "bilder");
  const shots = () =>
    readdirSync(dir)
      .map((name) => ({
        name,
        match: /^ezprop-(for|etter)-(.+)-(pc|ipad)\.(png|jpe?g)$/.exec(name),
      }))
      .filter((entry) => entry.match);

  const cases = (["for", "etter"] as const).flatMap((when) =>
    Object.keys(SCREENS).flatMap((screen) =>
      (["pc", "ipad"] as const).map((device) => [when, screen, device] as const),
    ),
  );

  it("20 kombinasjoner (før/etter × fem skjermer × PC/iPad)", () => {
    expect(cases).toHaveLength(20);
  });

  it.each(cases)("ezprop-%s-%s-%s finnes og er ikke tom", (when, screen, device) => {
    const found = shots().filter(
      ({ match }) =>
        match![1] === when && SCREENS[screen]!.test(match![2]!) && match![3] === device,
    );
    expect(
      found.map((entry) => entry.name),
      `${when} ${screen} ${device}`,
    ).toHaveLength(1);
    expect(statSync(join(dir, found[0]!.name)).size).toBeGreaterThan(0);
  });
});

describe("9.3 designprinsippene og ui-designeren", () => {
  const principles = () => readFileSync(join(repoRoot, "docs", "08-designprinsipper.md"), "utf8");

  it.each([
    "snow",
    "sand",
    "night",
    "fjord",
    "Inter",
    "Schibsted Grotesk",
    "12 px",
    "TG alltid med tekst",
  ])("08-designprinsipper.md nevner «%s»", (word) => {
    expect(principles()).toContain(word);
  });

  it("nevner synkstatus og KI-merket", () => {
    expect(principles()).toMatch(/synkstatus/i);
    expect(principles()).toMatch(/KI-merke/);
  });

  it("sier at luften og trykkflatene står (44 og 56)", () => {
    const text = principles();
    expect(text).toMatch(/luft/i);
    expect(text).toMatch(/trykkflate/i);
    expect(text).toMatch(/44/);
    expect(text).toMatch(/56/);
  });

  it("grunnmuren er ikke lenger Roboto, nordlys eller den gamle blå", () => {
    const text = principles();
    expect(text).not.toMatch(/roboto/i);
    expect(text).not.toMatch(/#326ca1/i);
    expect(text).not.toMatch(/nordlysfarger som aksent/i);
  });

  it(".claude/agents/ui-designer.md nevner ikke Roboto eller nordlys", () => {
    const text = readFileSync(join(repoRoot, ".claude", "agents", "ui-designer.md"), "utf8");
    expect(text).not.toMatch(/roboto/i);
    expect(text).not.toMatch(/nordlys/i);
  });
});
