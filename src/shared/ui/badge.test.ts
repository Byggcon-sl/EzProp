import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

/*
 * Merkene i Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 3,
 * badge.test.ts; designspesifikasjonen 4.3): flate merker uten kant og uten night-fyll, lavere enn
 * 44 px, så de ikke ligner en knapp. Teksten bærer meningen.
 * Støtter hovedmål: færre reklamasjoner (status leses fra teksten, ikke bare fargen) og de ansatte.
 */

const TONES = ["neutral", "brand", "warning", "danger"] as const;

function classes(html: string): string[] {
  const value = /^<span[^>]*class="([^"]*)"/.exec(html)?.[1];
  if (value === undefined) throw new Error(`Fant ikke merket i ${html}`);
  return value.split(/\s+/).filter(Boolean);
}

describe("Badge", () => {
  it.each(TONES)("1 %s: flat, uten kant, uten night-fyll, under 44 px, med tekst", (tone) => {
    const html = renderToStaticMarkup(Badge({ tone, children: "Oppdiktet merke" }));
    const list = classes(html);
    expect(html).toContain("Oppdiktet merke");
    expect(list.filter((name) => /^(border|ring)(-|$)/.test(name))).toEqual([]);
    expect(list.filter((name) => /^bg-(night|slate-900|slate-950)$/.test(name))).toEqual([]);
    expect(list.filter((name) => /^min-h-(11|14)$/.test(name))).toEqual([]);
    expect(list).toContain("h-6");
    expect(list.filter((name) => /(^|:)shadow/.test(name))).toEqual([]);
  });

  it("standard er neutral", () => {
    expect(renderToStaticMarkup(Badge({ children: "x" }))).toBe(
      renderToStaticMarkup(Badge({ tone: "neutral", children: "x" })),
    );
  });

  it("warning og danger bruker statustokenene (felles med Optiplan)", () => {
    expect(classes(renderToStaticMarkup(Badge({ tone: "warning", children: "x" })))).toEqual(
      expect.arrayContaining(["bg-watch-fill", "text-watch-text"]),
    );
    expect(classes(renderToStaticMarkup(Badge({ tone: "danger", children: "x" })))).toEqual(
      expect.arrayContaining(["bg-urgent-fill", "text-urgent-text"]),
    );
  });

  it("ingen tone bruker Tailwinds amber, red eller emerald", () => {
    for (const tone of TONES) {
      const list = classes(renderToStaticMarkup(Badge({ tone, children: "x" })));
      expect(list.filter((name) => /-(amber|red|emerald)-/.test(name))).toEqual([]);
    }
  });
});
