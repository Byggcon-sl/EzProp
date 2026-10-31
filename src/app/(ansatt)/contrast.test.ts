import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Kontrast i rammen (grunnlayout Fjord, lys visning).
 * Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 1.
 * Fargeparene er fra ui-designerens skisse (docs/funksjoner/fase0b-grunnlayout-fjord-skisse.md
 * avsnitt 4). `canvas` og `brand-*` leses fra globals.css; slate og hvit er Tailwinds egne tall.
 * Støtter hovedmål: reklamasjoner (høy kontrast gir færre feillesinger på iPad i dagslys).
 */

const GLOBALS_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "globals.css");

/** Fargevariablene i `@theme { ... }` i globals.css, uten `--color-`. */
function readThemeColors(): Record<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  if (!theme) throw new Error("Fant ikke @theme i globals.css");
  const colors: Record<string, string> = {};
  for (const match of theme.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    colors[match[1]!] = match[2]!.toLowerCase();
  }
  return colors;
}

/** Tailwinds egne farger som rammen bruker (sRGB-verdiene fra skissen). */
const fixed: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  "slate-900": "#0f172a",
  "slate-700": "#334155",
  "slate-600": "#475569",
  // Adminområdet (docs/funksjoner/fase0b-admin-organisasjon-skisse.md avsnitt 8). Regnet om fra
  // oklch-verdiene i tailwindcss/theme.css (v4) til sRGB, klippet til sRGB der fargen ligger utenfor.
  "slate-100": "#f1f5f9",
  "amber-50": "#fffbeb",
  "amber-900": "#7b3306",
  "red-700": "#c10007",
  "red-800": "#9f0712",
  "emerald-50": "#ecfdf5",
  "emerald-900": "#004f3b",
};

/** Variablene i globals.css som parene under bruker. Mangler én, skal testen feile. */
const themeNames = [
  "canvas",
  "field",
  "brand-50",
  "brand-100",
  "brand-600",
  "brand-700",
  "brand-900",
] as const;

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

/** Tekst mot bakgrunn: minst 4,5:1 (WCAG 1.4.3). */
const textPairs: [text: string, background: string, usage: string][] = [
  ["slate-900", "canvas", "h1 og organisasjonsnavn på smal skjerm"],
  ["slate-900", "white", "korttekst og organisasjonsnavn i kortet"],
  ["slate-700", "canvas", "menypunkt"],
  ["slate-700", "white", "menypunkt i raden på iPad stående"],
  ["slate-600", "canvas", "hilsen, «Prøver» og «Du jobber for»"],
  ["slate-600", "white", "brødtekst i kortet og «Du jobber for» i kortet"],
  ["brand-900", "brand-100", "aktivt menypunkt"],
  ["brand-900", "white", "produktnavn i topplinjen"],
  ["white", "brand-600", "logo og initialer"],
  ["brand-700", "canvas", "Byggcon-blå som tekst (lenker) på canvas"],
  ["brand-700", "white", "Byggcon-blå som tekst (lenker) på hvitt"],
  ["slate-700", "slate-100", "merket «neutral» (roller, «Sluttet»)"],
  ["brand-700", "brand-50", "merket «brand» (Admin) og «Endre» i rad med hover"],
  ["amber-900", "amber-50", "merket «warning» («Forsikring utløpt», «Mangler opplysninger»)"],
  ["red-800", "white", "feil ved feltet"],
  ["emerald-900", "emerald-50", "kvittering etter lagring"],
  ["slate-600", "brand-50", "linje 2 i rad med hover"],
  ["slate-900", "brand-50", "tittel i rad med hover"],
];

/** Fokusring og annet som ikke er tekst: minst 3:1 (WCAG 1.4.11). */
const nonTextPairs: [ring: string, background: string, usage: string][] = [
  ["brand-600", "canvas", "fokusring på canvas"],
  ["brand-600", "white", "fokusring på hvitt"],
  ["red-700", "white", "kant på felt med feil"],
  ["field", "white", "kant på felt og avkryssingsboks"],
];

describe("kontrasthjelperen", () => {
  it("svart mot hvitt gir 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("hvitt mot hvitt gir 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("er lik begge veier", () => {
    expect(contrastRatio("#326ca1", "#eef2f7")).toBeCloseTo(contrastRatio("#eef2f7", "#326ca1"));
  });

  it("feiler hvis en farge ikke finnes", () => {
    expect(() => color("finnes-ikke", readThemeColors())).toThrow(/finnes ikke/);
  });
});

describe("fargevariablene i globals.css", () => {
  it.each(themeNames)("--color-%s finnes i @theme", (name) => {
    expect(readThemeColors()[name], `--color-${name} mangler i globals.css`).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });

  it("alle farger parene bruker, finnes", () => {
    const theme = readThemeColors();
    for (const [a, b] of [...textPairs, ...nonTextPairs]) {
      expect(() => color(a, theme)).not.toThrow();
      expect(() => color(b, theme)).not.toThrow();
    }
  });
});

describe("kontrast i rammen (lys visning)", () => {
  it.each(textPairs)("tekst %s mot %s er minst 4,5:1 (%s)", (text, background) => {
    const theme = readThemeColors();
    expect(contrastRatio(color(text, theme), color(background, theme))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(nonTextPairs)("%s mot %s er minst 3:1 (%s)", (ring, background) => {
    const theme = readThemeColors();
    expect(contrastRatio(color(ring, theme), color(background, theme))).toBeGreaterThanOrEqual(3);
  });
});
