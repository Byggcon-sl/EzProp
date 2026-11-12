import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/config/brand";
import manifest from "./manifest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("manifest", () => {
  it("manifestet har standalone, start_url /arbeidskoe, navn fra brand og lang nb", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/arbeidskoe");
    expect(m.name).toBe(brand.productName);
    expect(m.short_name).toBe(brand.productName);
    expect(m.lang).toBe("nb");
    expect(m.theme_color).toBe(brand.color);
    expect(m.background_color).toBe(brand.color);
    expect(m.icons?.[0]?.src).toContain("/apple-icon");
    expect(m.description).not.toContain(brand.productName);
  });
});

/*
 * Merkevarefargen i Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 4,
 * designspesifikasjonen 7): en farge fra paletten i `@theme`, ikke den gamle Byggcon-blå.
 * Støtter hovedmål: de ansatte (ikonet og temafargen på iPaden følger samme profil).
 */
describe("merkevarefargen", () => {
  function paletteHex(): string[] {
    const css = readFileSync(path.join(here, "globals.css"), "utf8");
    const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    return [...theme.matchAll(/--color-[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) =>
      match[1]!.toLowerCase(),
    );
  }

  it("brand.color er en farge fra paletten, ikke #326CA1", () => {
    expect(brand.color.toLowerCase()).not.toBe("#326ca1");
    expect(paletteHex()).toContain(brand.color.toLowerCase());
  });

  it("theme_color og background_color i manifestet er fra paletten", () => {
    const m = manifest();
    for (const value of [m.theme_color, m.background_color]) {
      expect(value).toBeDefined();
      expect(value!.toLowerCase()).not.toBe("#326ca1");
      expect(paletteHex()).toContain(value!.toLowerCase());
    }
  });

  it("apple-icon.tsx bruker brand.color og ingen gammel blå", () => {
    const icon = readFileSync(path.join(here, "apple-icon.tsx"), "utf8");
    expect(icon).toContain("brand.color");
    expect(icon).not.toMatch(/#326ca1/i);
    const hexes = [...icon.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toLowerCase());
    expect(hexes.filter((hex) => hex !== "#ffffff" && !paletteHex().includes(hex))).toEqual([]);
  });

  it("viewport.themeColor i layout.tsx bruker brand.color", () => {
    const layout = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(layout).toMatch(/themeColor:\s*brand\.color/);
  });
});
