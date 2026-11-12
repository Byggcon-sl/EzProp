import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Kontrast i Byggcon-profilen (lys visning).
 * Testplan: docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 2 (utvider
 * docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 1).
 * Fargene leses fra `@theme` i globals.css. Bare hvit er fast. Slate og brand er omdefinert i
 * temaet, så de leses derfra. Parene er fra docs/funksjoner/fase2a-byggcon-profil-design.md
 * avsnitt 8.
 * Støtter hovedmål: de ansatte (høy kontrast i sollys på iPad), KI i bunnen (KI-merket har eget
 * uttrykk) og færre reklamasjoner (TG kan ikke forveksles med synk eller KI, og leses riktig).
 */

const GLOBALS_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "globals.css");

/**
 * Fargevariablene i `@theme { ... }`, uten `--color-`. Feiler hvis en `--color-*` ikke er skrevet
 * som `#rrggbb` (da kan ikke kontrasten regnes, og testen kunne blitt grønn på gamle verdier).
 */
function readThemeColors(css: string = readFileSync(GLOBALS_CSS, "utf8")): Record<string, string> {
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  if (!theme) throw new Error("Fant ikke @theme i globals.css");
  const colors: Record<string, string> = {};
  for (const match of theme.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1]!;
    const value = match[2]!.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error(`--color-${name} er ikke skrevet som #rrggbb: ${value}`);
    }
    colors[name] = value.toLowerCase();
  }
  return colors;
}

/** Bare hvit er fast. Alt annet leses fra temaet. */
const fixed: Record<string, string> = {
  white: "#ffffff",
};

function luminance(hex: string): number {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`Ugyldig farge: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(value.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x kontrastforhold mellom to farger (1 til 21). */
function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

function color(name: string, theme: Record<string, string>): string {
  const value = fixed[name] ?? theme[name];
  if (!value) throw new Error(`Fargen ${name} finnes ikke i globals.css`);
  return value;
}

const BACKGROUNDS = ["snow", "white", "sand"] as const;

/** Paletten (2.2). Mørk fjord heter `fjord-dark` (designspesifikasjonen 2.1). */
const PALETTE = [
  "snow",
  "sand",
  "night",
  "fjord",
  "fjord-dark",
  "stone",
  "line",
  "line-strong",
  "canvas",
  "field",
] as const;

const TG_LEVELS = ["tg0", "tg1", "tg2", "tg3", "tgiu"] as const;
const SYNC_STATES = ["saved", "pending", "offline", "waiting"] as const;
const STATUS_TOKENS = ["ok", "watch", "urgent", "unknown"] as const;

/** Tekst mot bakgrunn: minst 4,5:1 (WCAG 1.4.3). */
const textPairs: [text: string, background: string, usage: string][] = [
  // 2.4 tekst mot snow, hvit og sand
  ...(["slate-600", "slate-700", "slate-900", "night"] as const).flatMap((text) =>
    BACKGROUNDS.map((bg): [string, string, string] => [text, bg, "tekst"]),
  ),
  // Dempet tekst (stone = slate-500), designspesifikasjonen avsnitt 8
  ...BACKGROUNDS.map((bg): [string, string, string] => ["slate-500", bg, "dempet tekst"]),
  // 2.5 hovedknapp og deaktivert hovedknapp (D3, A226)
  ["white", "night", "hovedknapp"],
  ["white", "slate-500", "deaktivert hovedknapp (stone)"],
  ["white", "ai-700", "«Bruk» i KI-kortet"],
  ["white", "urgent-line", "knapp som fjerner noe"],
  // 2.10 KI
  ["ai-900", "ai-50", "KI-merket og overskriften «Forslag fra KI»"],
  ["slate-900", "ai-50", "teksten i forslagsboksen"],
  // 2.12 adminområdet, merker og «Forfalt», nå med fargene fra temaet
  ["slate-900", "canvas", "h1 og organisasjonsnavn på smal skjerm"],
  ["slate-700", "canvas", "menypunkt"],
  ["brand-900", "brand-100", "aktivt menypunkt"],
  ["brand-900", "white", "produktnavn i topplinjen"],
  ["white", "brand-600", "logo og initialer"],
  ["brand-700", "canvas", "lenketekst på canvas"],
  ["brand-700", "white", "lenketekst på hvitt"],
  ["slate-700", "sand", "merket «neutral» (roller, «Sluttet»)"],
  ["slate-700", "slate-100", "merket «neutral» med slate-100"],
  ["brand-700", "brand-50", "merket «brand» (Admin) og «Endre» i rad med hover"],
  ["watch-text", "watch-fill", "merket «warning» («Forsikring utløpt», «Mangler opplysninger»)"],
  ["urgent-text", "white", "feil ved feltet"],
  ["urgent-text", "urgent-fill", "merket «danger» («Forfalt») og feilmeldingen øverst"],
  ["slate-900", "sand", "kvittering etter lagring"],
  ["slate-600", "brand-50", "linje 2 i rad med hover"],
  ["slate-900", "brand-50", "tittel i rad med hover"],
];

/** Kanter og fokusramme: minst 3:1 (WCAG 1.4.11). */
const nonTextPairs: [ring: string, background: string, usage: string][] = [
  // 2.6 kant på sekundærknapp (slate-700) og skjemafelt
  ...BACKGROUNDS.map((bg): [string, string, string] => ["slate-700", bg, "kant sekundærknapp"]),
  ...BACKGROUNDS.map((bg): [string, string, string] => ["field", bg, "kant skjemafelt"]),
  // 2.7 fokusramme i fjord (D1, A224)
  ...[...BACKGROUNDS, "night"].map((bg): [string, string, string] => ["fjord", bg, "fokusramme"]),
  ["brand-600", "canvas", "fokusring (brand-600 = fjord) på canvas"],
  // 2.10 kanten på KI-merket og forslagsboksen
  ...[...BACKGROUNDS, "ai-50"].map((bg): [string, string, string] => ["ai-line", bg, "KI-kant"]),
  ["urgent-line", "white", "kant på felt med feil"],
];

describe("kontrasthjelperen", () => {
  it("svart mot hvitt gir 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("hvitt mot hvitt gir 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("er lik begge veier", () => {
    expect(contrastRatio("#316aa0", "#f5f4f0")).toBeCloseTo(contrastRatio("#f5f4f0", "#316aa0"));
  });

  it("feiler hvis en farge ikke finnes", () => {
    expect(() => color("finnes-ikke", readThemeColors())).toThrow(/finnes ikke/);
  });
});

describe("2.1 readThemeColors feiler ved ikke-hex", () => {
  it.each([
    ["oklch", "@theme {\n  --color-x: oklch(0.5 0.1 200);\n}"],
    ["kort hex", "@theme {\n  --color-x: #abc;\n}"],
    ["rgba", "@theme {\n  --color-x: rgb(15 25 36 / 0.12);\n}"],
    ["var()", "@theme {\n  --color-x: var(--color-y);\n}"],
  ])("%s gir feil med navnet på variabelen", (_name, css) => {
    expect(() => readThemeColors(css)).toThrow(/--color-x/);
  });

  it("#rrggbb leses, med små bokstaver", () => {
    expect(readThemeColors("@theme {\n  --color-x: #ABCDEF;\n}")).toEqual({ x: "#abcdef" });
  });

  it("hele globals.css leses uten feil", () => {
    expect(() => readThemeColors()).not.toThrow();
  });
});

describe("2.2 og 2.3 paletten i globals.css", () => {
  it.each(PALETTE)("--color-%s finnes som #rrggbb", (name) => {
    expect(readThemeColors()[name], `--color-${name} mangler i globals.css`).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });

  it("linjene er mørkere enn snow, og line-strong er sterkere enn line", () => {
    const theme = readThemeColors();
    expect(luminance(theme["line"]!)).toBeLessThan(luminance(theme["snow"]!));
    expect(luminance(theme["line-strong"]!)).toBeLessThan(luminance(theme["line"]!));
  });

  it("canvas er snow, og fjord er #316aa0", () => {
    const theme = readThemeColors();
    expect(theme["canvas"]).toBe(theme["snow"]);
    expect(theme["fjord"]).toBe("#316aa0");
  });

  it("brand-600 følger fjord, og stone er slate-500", () => {
    const theme = readThemeColors();
    expect(theme["brand-600"]).toBe(theme["fjord"]);
    expect(theme["slate-500"]).toBe(theme["stone"]);
  });

  it.each(["brand-50", "brand-100", "brand-600", "brand-700", "brand-900"])(
    "--color-%s finnes i temaet",
    (name) => {
      expect(readThemeColors()[name]).toMatch(/^#[0-9a-f]{6}$/);
    },
  );

  it.each([
    ["slate-50"],
    ["slate-100"],
    ["slate-200"],
    ["slate-300"],
    ["slate-500"],
    ["slate-600"],
    ["slate-700"],
    ["slate-800"],
    ["slate-900"],
  ])("--color-%s er omdefinert i temaet", (name) => {
    expect(readThemeColors()[name]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("de gamle verdiene er borte (Byggcon-blå og Tailwinds slate)", () => {
    const theme = readThemeColors();
    expect(Object.values(theme)).not.toContain("#326ca1");
    expect(theme["slate-900"]).not.toBe("#0f172a");
    expect(theme["slate-700"]).not.toBe("#334155");
    expect(theme["slate-600"]).not.toBe("#475569");
  });

  it("ingen gul «sun» i paletten", () => {
    expect(readThemeColors()["sun"]).toBeUndefined();
  });
});

describe("alle farger parene bruker, finnes", () => {
  it("ingen par peker på en farge som mangler", () => {
    const theme = readThemeColors();
    const missing = [...textPairs, ...nonTextPairs]
      .flatMap(([a, b]) => [a, b])
      .filter((name) => !fixed[name] && !theme[name]);
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("2.4–2.7, 2.10 og 2.12 kontrast i Byggcon-profilen (lys visning)", () => {
  it.each(textPairs)("tekst %s mot %s er minst 4,5:1 (%s)", (text, background) => {
    const theme = readThemeColors();
    expect(contrastRatio(color(text, theme), color(background, theme))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(nonTextPairs)("%s mot %s er minst 3:1 (%s)", (ring, background) => {
    const theme = readThemeColors();
    expect(contrastRatio(color(ring, theme), color(background, theme))).toBeGreaterThanOrEqual(3);
  });

  it("mørk fjord brukes ikke til fokus: den gir under 3:1 mot night (derfor fjord, D1)", () => {
    const theme = readThemeColors();
    expect(contrastRatio(color("fjord-dark", theme), color("night", theme))).toBeLessThan(3);
  });
});

describe("2.8 TG-tokenene (alltid med tekst)", () => {
  it.each(TG_LEVELS)("%s har tekst- og flatetoken, tekst mot flate minst 4,5:1", (level) => {
    const theme = readThemeColors();
    const bg = theme[`${level}-bg`];
    const text = theme[`${level}-text`];
    expect(bg, `--color-${level}-bg`).toMatch(/^#[0-9a-f]{6}$/);
    expect(text, `--color-${level}-text`).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(text!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it("TG2 og TG3 har ulike flater, og ulike fra TG0", () => {
    const theme = readThemeColors();
    const flats = ["tg0-bg", "tg2-bg", "tg3-bg"].map((name) => theme[name]);
    expect(new Set(flats).size).toBe(3);
  });
});

describe("2.9 synkstatusen", () => {
  it.each(SYNC_STATES)("sync-%s har flate og tekst", (state) => {
    const theme = readThemeColors();
    expect(theme[`sync-${state}-bg`], `--color-sync-${state}-bg`).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme[`sync-${state}-text`], `--color-sync-${state}-text`).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("alle --color-sync-*-par: tekst mot flate minst 4,5:1", () => {
    const theme = readThemeColors();
    const states = Object.keys(theme)
      .map((name) => /^sync-(.+)-bg$/.exec(name)?.[1])
      .filter((state): state is string => Boolean(state));
    expect(states.length).toBeGreaterThanOrEqual(SYNC_STATES.length);
    for (const state of states) {
      const text = theme[`sync-${state}-text`];
      expect(text, `--color-sync-${state}-text mangler`).toBeDefined();
      expect(
        contrastRatio(text!, theme[`sync-${state}-bg`]!),
        `sync-${state}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("2.11 KI, TG og synk er ulike", () => {
  function tokens(theme: Record<string, string>, test: (name: string) => boolean) {
    return Object.entries(theme).filter(([name]) => test(name));
  }

  it("KI-tokenene finnes (ai-50, ai-line, ai-700, ai-900)", () => {
    const theme = readThemeColors();
    for (const name of ["ai-50", "ai-line", "ai-700", "ai-900"]) {
      expect(theme[name], `--color-${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("ingen KI-token har samme hex som en TG-, synk- eller statustoken", () => {
    const theme = readThemeColors();
    const ai = tokens(theme, (name) => name.startsWith("ai-"));
    const others = tokens(
      theme,
      (name) =>
        /^tg/.test(name) ||
        name.startsWith("sync-") ||
        STATUS_TOKENS.some((status) => name.startsWith(`${status}-`)),
    );
    expect(ai.length).toBeGreaterThanOrEqual(4);
    expect(others.length).toBeGreaterThanOrEqual(TG_LEVELS.length * 2 + SYNC_STATES.length * 2);
    const clashes = ai.flatMap(([aiName, aiHex]) =>
      others.filter(([, hex]) => hex === aiHex).map(([name]) => `${aiName} = ${name}`),
    );
    expect(clashes).toEqual([]);
  });

  it("ingen synkflate er lik flaten til TG0, TG2 eller TG3", () => {
    const theme = readThemeColors();
    const tgFlats = ["tg0-bg", "tg2-bg", "tg3-bg"].map((name) => theme[name]);
    expect(tgFlats.every(Boolean)).toBe(true);
    const clashes = tokens(theme, (name) => /^sync-.+-bg$/.test(name)).filter(([, hex]) =>
      tgFlats.includes(hex),
    );
    expect(clashes).toEqual([]);
  });

  it("statustokenene finnes (flate, tekst og strek)", () => {
    const theme = readThemeColors();
    for (const status of STATUS_TOKENS) {
      for (const part of ["fill", "text", "line"]) {
        expect(theme[`${status}-${part}`], `--color-${status}-${part}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
