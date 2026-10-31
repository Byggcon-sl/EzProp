import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Kontrast i rammen (grunnlayout design A «Fjord», lys visning).
// Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 1.
// Fargeparene: docs/funksjoner/fase0b-grunnlayout-fjord-skisse.md avsnitt 4.
// Støtter reklamasjoner: målt kontrast gir færre feillesinger på PC og iPad.

const globalsCss = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");

/** `--color-<navn>: #rrggbb;` fra `globals.css`, eller kast hvis variabelen mangler. */
function themeColor(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(globalsCss);
  if (!match?.[1]) throw new Error(`Fant ikke --color-${name} i src/app/globals.css`);
  return match[1].toLowerCase();
}

/** Tailwinds egne farger (ikke i globals.css), som tall. */
const tailwindColors: Record<string, string> = {
  "slate-900": "#0f172a",
  "slate-700": "#334155",
  "slate-600": "#475569",
  white: "#ffffff",
};

/** Fargene fra globals.css som rammen bruker. */
const themeNames = ["canvas", "brand-100", "brand-600", "brand-700", "brand-900"] as const;

function color(name: string): string {
  return tailwindColors[name] ?? themeColor(name);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x kontrastforhold mellom to farger på formen #rrggbb. */
function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

/** Parene i skissen avsnitt 4: [forgrunn, bakgrunn, bruk, krav]. */
const pairs: [string, string, string, number][] = [
  ["slate-900", "canvas", "h1, navn i org-linjen (smal)", TEXT],
  ["slate-900", "white", "korttekst, org-navn i kortet", TEXT],
  ["slate-700", "canvas", "menypunkt", TEXT],
  ["slate-700", "white", "menypunkt i raden (smal)", TEXT],
  ["slate-600", "canvas", "hilsen, «Prøver», «Du jobber for»", TEXT],
  ["slate-600", "white", "brødtekst i kortet, «Du jobber for» i kortet", TEXT],
  ["brand-900", "brand-100", "aktivt menypunkt", TEXT],
  ["brand-900", "white", "produktnavn", TEXT],
  ["white", "brand-600", "logo og initialer", TEXT],
  ["brand-700", "canvas", "Byggcon-blå som tekst", TEXT],
  ["brand-700", "white", "Byggcon-blå som tekst", TEXT],
  ["brand-600", "canvas", "fokusring", NON_TEXT],
  ["brand-600", "white", "fokusring", NON_TEXT],
];

describe("kontrasthjelperen", () => {
  it("svart mot hvitt gir 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("hvitt mot hvitt gir 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("feiler hvis en variabel ikke finnes i globals.css", () => {
    expect(() => themeColor("finnes-ikke")).toThrow(/--color-finnes-ikke/);
  });
});

describe("fargevariablene i globals.css", () => {
  it.each(themeNames)("--color-%s finnes som #rrggbb", (name) => {
    expect(themeColor(name)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("kontrast i rammen (lys visning)", () => {
  it("listen har de 13 parene fra skissen", () => {
    expect(pairs).toHaveLength(13);
  });

  it.each(pairs)("%s på %s (%s) er minst %d:1", (foreground, background, _use, minimum) => {
    const ratio = contrastRatio(color(foreground), color(background));
    expect(ratio).toBeGreaterThanOrEqual(minimum);
  });
});
