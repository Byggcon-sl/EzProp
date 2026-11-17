import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Warning, WARNING_SCREEN_READER_PREFIX } from "./warning";

/*
 * Advarsel som ikke sperrer (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 13 og 14):
 * sand-flate, ikke TG-tonene, «Se over:» for skjermleser, aldri role="alert".
 * Støtter hovedmål: færre reklamasjoner (mangler synes uten å stoppe arbeidet).
 */

describe("Warning", () => {
  it("sand, ikke TG-tone, ikke alert, med «Se over:» for skjermleser", () => {
    const html = renderToStaticMarkup(Warning({ id: "w1", children: "TG3 skal ha kostnad." }));
    expect(html).toContain("bg-sand");
    expect(html).not.toMatch(/\b(bg|text)-(tg|watch|urgent)/);
    expect(html).not.toContain("role=");
    expect(html).toContain(WARNING_SCREEN_READER_PREFIX);
    expect(html).toContain('id="w1"');
    expect(html).toContain("TG3 skal ha kostnad.");
  });

  it("handlingen står i advarselen, og den kan få fokus når det trengs", () => {
    const html = renderToStaticMarkup(
      Warning({ children: "x", action: "Rett nå", focusable: true }),
    );
    expect(html).toContain("Rett nå");
    expect(html).toContain('tabindex="-1"');
  });
});
