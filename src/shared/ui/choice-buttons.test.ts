import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoiceButtons, choiceButtonId } from "./choice-buttons";

/*
 * Valg som pilleknapper (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 14): ekte radioknapper
 * i `<fieldset>` med `<legend>`, aldri nedtrekk, minst 44 × 44 pt, valgt pille med hakeikon.
 * Støtter hovedmål: de ansatte (ett trykk per valg).
 */

const OPTIONS = [
  { value: "2", label: "TG2" },
  { value: "3", label: "TG3" },
  { value: "x", label: "Låst", disabled: true },
];

function render(value: string | null, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    ChoiceButtons({
      id: "tg",
      legend: "TG",
      options: OPTIONS,
      value,
      onChange: () => {},
      ...extra,
    }),
  );
}

describe("ChoiceButtons", () => {
  it("er radioknapper i fieldset med legend, ingen select", () => {
    const html = render(null);
    expect(html).toMatch(/^<fieldset/);
    expect(html).toContain("<legend");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).not.toContain("<select");
    expect(html).toContain(`id="${choiceButtonId("tg", 0)}"`);
    expect(html).toContain('name="tg"');
  });

  it("pillene er minst 44 × 44 pt", () => {
    expect(render(null).match(/min-h-11 min-w-11/g)).toHaveLength(3);
  });

  it("valgt pille har hakeikon og night-flate, ikke bare farge", () => {
    const html = render("3");
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain("bg-night text-white");
    expect(html).toMatch(/id="tg-1"[^>]*checked=""[^>]*value="3"/);
  });

  it("låst valg er disabled", () => {
    expect(render(null)).toMatch(/id="tg-2" disabled=""[^>]*value="x"/);
  });

  it("feil og hjelpetekst kobles med aria-describedby", () => {
    const html = render(null, { hint: "Velg én", error: "Velg TG2 eller TG3.", describedBy: "w1" });
    expect(html).toContain('aria-describedby="tg-hint tg-error w1"');
    expect(html).toContain('aria-invalid="true"');
  });
});
