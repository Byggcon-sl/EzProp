import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_PROFILE_CODE, PDF_FOOTER_PARTS, PDF_SECTION_CODES } from "./codes";
import {
  BYGGCON_LOGO_KEY,
  BYGGCON_STANDARD_PROFILE,
  getPdfProfile,
  PDF_PROFILES,
} from "./profiles";

/*
 * Profilene som kodedata (testplanen 3.6, design avsnitt 1 og 7). Ren test, uten database.
 * Støtter hovedmål: færre reklamasjoner (samme farger og TG-merker som på skjermen) og de ansatte.
 */

const repoRoot = join(__dirname, "..", "..", "..");
const css = readFileSync(join(repoRoot, "src/app/globals.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`Fant ikke --color-${name} i globals.css`);
  return match[1]!.toLowerCase();
}

/** Kontrast etter WCAG 2.1. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("3.6.1 standardprofilen", () => {
  it("byggcon_standard finnes, er standard, stående og har versjon", () => {
    expect(DEFAULT_PDF_PROFILE_CODE).toBe("byggcon_standard");
    const profile = getPdfProfile(DEFAULT_PDF_PROFILE_CODE);
    expect(profile).toBe(BYGGCON_STANDARD_PROFILE);
    expect(profile?.orientation).toBe("portrait");
    expect(profile?.version).toBeGreaterThanOrEqual(1);
    expect(profile?.sections).toEqual(PDF_SECTION_CODES);
    expect(profile?.footer).toEqual(PDF_FOOTER_PARTS);
  });

  it("ukjent kode gir null", () => {
    expect(getPdfProfile("finnes_ikke")).toBeNull();
    expect(getPdfProfile("")).toBeNull();
  });
});

describe("design 7: fargene er de samme som i globals.css", () => {
  const colors = BYGGCON_STANDARD_PROFILE.colors;

  it.each([
    ["text", "night"],
    ["muted", "stone"],
    ["accent", "fjord"],
    ["rule", "line-strong"],
    ["link", "fjord-dark"],
    ["panel", "sand"],
    ["marking", "urgent-line"],
  ] as const)("%s = --color-%s", (field, name) => {
    expect(colors[field]).toBe(token(name));
  });

  it.each([
    ["0", "tg0", "ok"],
    ["1", "tg1", "ok"],
    ["2", "tg2", "watch"],
    ["3", "tg3", "urgent"],
    ["IU", "tgiu", "unknown"],
  ] as const)("TG%s har flate, tekst og strek fra tokenene", (tg, name, tone) => {
    expect(colors.tg[tg]).toEqual({
      background: token(`${name}-bg`),
      text: token(`${name}-text`),
      stroke: token(`${tone}-line`),
    });
  });

  it("vannmerket er en lys tone av night (5–12 % på hvit)", () => {
    const night = token("night");
    const shares = [1, 3, 5].map((at) => {
      const n = parseInt(night.slice(at, at + 2), 16);
      const w = parseInt(colors.watermark.slice(at, at + 2), 16);
      return (255 - w) / (255 - n);
    });
    for (const share of shares) {
      expect(share).toBeGreaterThan(0.05);
      expect(share).toBeLessThan(0.12);
    }
  });

  it("kontrasten holder minst 4,5:1 for tekst på hvit, sand og vannmerket", () => {
    expect(contrast(colors.text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.link, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.watermark)).toBeGreaterThanOrEqual(4.5);
    for (const tone of Object.values(colors.tg)) {
      expect(contrast(tone.text, tone.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("3.6.2 og 3.6.3 profilene har bare utseende", () => {
  it("ingen selskapsnavn, org.nr., fagtekst eller nettadresse", () => {
    const text = JSON.stringify(PDF_PROFILES);
    expect(text).not.toMatch(/\bAS\b|\bASA\b/);
    expect(text).not.toMatch(/\d{3}\s?\d{3}\s?\d{3}/);
    expect(text).not.toMatch(/avvik|undersøkt|TG\d/i);
    expect(text).not.toMatch(/https?:/);
  });

  it("kodene er unike, følger mønsteret og er låst (regel 6)", () => {
    const codes = PDF_PROFILES.map((profile) => profile.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(codes).toEqual(["byggcon_standard"]);
  });

  it("3.6.4 testprofilen finnes bare i testene", () => {
    const files = readdirSync(join(repoRoot, "src"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
      .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain("test_landscape");
    }
  });
});

describe("statisk 2.2.6 skrifter og logo fra repoet", () => {
  it("skriftene i profilen finnes i public/fonts med lisens", () => {
    const fonts = readdirSync(join(repoRoot, "public/fonts"));
    expect(fonts).toContain("Inter-Regular.ttf");
    expect(fonts).toContain("SchibstedGrotesk-Bold.ttf");
    expect(fonts).toContain("OFL-Inter.txt");
    expect(fonts).toContain("OFL-SchibstedGrotesk.txt");
    expect(BYGGCON_STANDARD_PROFILE.fonts).toEqual({ heading: "Schibsted Grotesk", body: "Inter" });
  });

  it("logoen finnes i public/brand", () => {
    expect(BYGGCON_STANDARD_PROFILE.logo).toBe(BYGGCON_LOGO_KEY);
    expect(existsSync(join(repoRoot, "public/brand/byggcon-logo.png"))).toBe(true);
  });
});
