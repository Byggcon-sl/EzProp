import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch, SWITCH_STATE_TEXTS } from "./switch";

/*
 * Bryteren med tekst (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 8 og 16):
 * `role="switch"`, tilstanden som tekst, raden minst 44 pt, ingen avkrysningsboks, og ingen
 * import fra kjernen. Støtter hovedmål: færre reklamasjoner (sperren passeres bare med et aktivt
 * valg som synes) og de ansatte (stor trykkflate på iPad).
 */

function render(checked: boolean, disabled = false) {
  return renderToStaticMarkup(
    createElement(Switch, {
      id: "override-1",
      label: "Publiser likevel",
      checked,
      disabled,
      onChange: () => {},
      describedBy: "override-1-hint",
    }),
  );
}

describe("Switch", () => {
  it("er en knapp med role=switch og aria-checked, ikke en avkrysningsboks", () => {
    const html = render(false);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("tilstanden står som tekst: «Av» og «På»", () => {
    expect(render(false)).toContain(`>${SWITCH_STATE_TEXTS.off}<`);
    const on = render(true);
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain(`>${SWITCH_STATE_TEXTS.on}<`);
  });

  it("etiketten og tilstanden gir navnet, og hjelpeteksten kobles med aria-describedby", () => {
    const html = render(false);
    expect(html).toContain('aria-labelledby="override-1-label override-1-state"');
    expect(html).toContain('id="override-1-label"');
    expect(html).toContain("Publiser likevel");
    expect(html).toContain('aria-describedby="override-1-hint"');
  });

  it("raden er minst 44 pt og har fokusramme i fjord", () => {
    const html = render(false);
    expect(html).toContain("min-h-11");
    expect(html).toContain("w-full");
    expect(html).toContain("focus-visible:outline-fjord");
  });

  it("på: night-flate; av: hvit flate med kant i field. Ingen TG-toner", () => {
    expect(render(true)).toContain("bg-night");
    const off = render(false);
    expect(off).toContain("ring-field");
    expect(off).not.toContain("bg-night");
    expect(off + render(true)).not.toMatch(/\b(bg|text|ring)-(tg|watch|urgent)/);
  });

  it("kan låses", () => {
    expect(render(false, true)).toContain("disabled");
  });

  it("importerer ikke kjernen, databasen eller modulene", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "switch.tsx");
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/from\s+["']@\/(core|db|modules)/);
  });
});
