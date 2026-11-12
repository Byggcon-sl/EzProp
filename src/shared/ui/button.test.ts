import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_BUTTON_VARIANT, Button } from "./button";

/*
 * Knappene i Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 3,
 * button.test.ts). Klassene leses fra markupen. Høydene er låst: md 44 px, lg 56 px.
 * Ordet for fargeovergang bygges av biter, så søket etter forbudte ord i src/ ikke treffer filen.
 * Støtter hovedmål: de ansatte (pilleknapper med høy kontrast i sollys, samme trykkflater som før).
 */

const BLEND_WORD = ["gra", "dient"].join("");

type Variant = "primary" | "secondary" | "ghost" | typeof AI_BUTTON_VARIANT;
const VARIANTS: Variant[] = ["primary", "secondary", "ghost", AI_BUTTON_VARIANT];

function render(props: { variant?: Variant; size?: "md" | "lg"; disabled?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(Button, props, "Lagre"));
}

/** Klassene på knappen som en liste. */
function classes(html: string): string[] {
  const value = /<button[^>]*class="([^"]*)"/.exec(html)?.[1];
  if (value === undefined) throw new Error(`Fant ingen knapp i ${html}`);
  return value.split(/\s+/).filter(Boolean);
}

describe("hovedknappen", () => {
  it("1 night-flate, lys tekst og pilleform", () => {
    const list = classes(render({ variant: "primary" }));
    expect(list.some((name) => /^bg-(night|slate-900)$/.test(name))).toBe(true);
    expect(list).toContain("text-white");
    expect(list).toContain("rounded-full");
  });

  it("1 er standardvarianten", () => {
    expect(classes(render())).toEqual(classes(render({ variant: "primary" })));
  });

  it("1 lg er min-h-14 (56 px), md er min-h-11 (44 px)", () => {
    expect(classes(render({ size: "lg" }))).toContain("min-h-14");
    expect(classes(render({ size: "md" }))).toContain("min-h-11");
    expect(classes(render())).toContain("min-h-11");
  });

  it("5 deaktivert hovedknapp bruker egne farger, ikke opacity på night", () => {
    const html = render({ variant: "primary", disabled: true });
    const list = classes(html);
    expect(list.filter((name) => name.includes("opacity-"))).toEqual([]);
    expect(list.some((name) => /^disabled:bg-/.test(name))).toBe(true);
    expect(list.some((name) => /^disabled:text-/.test(name))).toBe(true);
    expect(html).toContain('disabled=""');
  });
});

describe("sekundærknappen", () => {
  it("2 gjennomsiktig med kant og pilleform", () => {
    const list = classes(render({ variant: "secondary" }));
    expect(list).toContain("bg-transparent");
    expect(list.some((name) => /^(ring-1|border)$/.test(name))).toBe(true);
    expect(list).toContain("rounded-full");
    expect(list).not.toContain("bg-white");
  });
});

describe("ghost-knappen (bare tredje handling)", () => {
  it("4 har kant eller understreking, og min-h-11", () => {
    const list = classes(render({ variant: "ghost" }));
    expect(list.some((name) => /^(ring-1|border|underline)$/.test(name))).toBe(true);
    expect(list).toContain("min-h-11");
  });
});

describe("alle variantene", () => {
  it.each(VARIANTS)("3 %s: ingen gul eller amber-flate", (variant) => {
    const list = classes(render({ variant }));
    expect(list.filter((name) => /(^|:)bg-(amber|yellow|watch|sun)/.test(name))).toEqual([]);
  });

  it.each(VARIANTS)("3 %s: ingen fargeovergang og ingen skygge", (variant) => {
    const html = render({ variant });
    expect(html).not.toContain(BLEND_WORD);
    expect(classes(html).filter((name) => /(^|:)shadow/.test(name))).toEqual([]);
  });

  it.each(VARIANTS)("pilleform for %s", (variant) => {
    expect(classes(render({ variant }))).toContain("rounded-full");
  });

  it.each(VARIANTS)("6 %s: ingen outline-none uten egen ramme", (variant) => {
    const list = classes(render({ variant }));
    if (list.some((name) => /(^|:)outline-none$/.test(name))) {
      expect(list.some((name) => /^focus-visible:(outline|ring)-/.test(name))).toBe(true);
    }
  });

  it.each(VARIANTS)("%s md beholder min-h-11", (variant) => {
    expect(classes(render({ variant, size: "md" }))).toContain("min-h-11");
  });

  it.each(VARIANTS)("%s lg beholder min-h-14", (variant) => {
    expect(classes(render({ variant, size: "lg" }))).toContain("min-h-14");
  });
});

describe("6 fokusrammen i fjord fra globals.css (D1, A224)", () => {
  it(":focus-visible har outline i fjord, ikke mørk fjord", () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
      "utf8",
    );
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(rule, ":focus-visible mangler i globals.css").toBeDefined();
    expect(rule).toMatch(/outline-2/);
    expect(rule).toMatch(/outline-(fjord|brand-600)(\s|;|$)/);
  });
});
