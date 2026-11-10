import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_TEXT_MARK_LABEL, AiTextMark, showsAiTextMark } from "./ai-text-mark";

/*
 * KI-merket (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 10, punkt 15–17).
 * Støtter hovedmål: reklamasjoner (bare godkjent KI-tekst får merket, og bare når statusen er lest
 * fra serveren med en id i KI-loggen).
 */

const USAGE_ID = "0b6c7a1e-3f4d-4e2a-8c9b-5a6d7e8f9a0b";

function render(props: { aiUsageId?: string | null; status: string | null }): string {
  return renderToStaticMarkup(createElement(AiTextMark, props));
}

describe("AiTextMark", () => {
  it.each(["accepted", "edited"])("10.15 %s med aiUsageId gir «Tekst fra KI, godkjent»", (status) => {
    const html = render({ aiUsageId: USAGE_ID, status });
    expect(html).toContain("Tekst fra KI, godkjent");
    expect(AI_TEXT_MARK_LABEL).toBe("Tekst fra KI, godkjent");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("bg-ai-50");
  });

  it.each<[string, { aiUsageId?: string | null; status: string | null }]>([
    ["suggested", { aiUsageId: USAGE_ID, status: "suggested" }],
    ["rejected", { aiUsageId: USAGE_ID, status: "rejected" }],
    ["uten status", { aiUsageId: USAGE_ID, status: null }],
    ["accepted uten aiUsageId", { status: "accepted" }],
    ["accepted med tom aiUsageId", { aiUsageId: "", status: "accepted" }],
    ["accepted med null", { aiUsageId: null, status: "accepted" }],
  ])("10.16 %s: ingenting rendres", (_name, props) => {
    expect(render(props)).toBe("");
    expect(showsAiTextMark(props)).toBe(false);
  });

  it("10.17 merket har ingen props for variant eller tekst", () => {
    const withVariant = createElement(AiTextMark, {
      aiUsageId: USAGE_ID,
      status: "accepted",
      // @ts-expect-error: merket har ingen variant
      variant: "x",
    });
    const withLabel = createElement(AiTextMark, {
      aiUsageId: USAGE_ID,
      status: "accepted",
      // @ts-expect-error: merket har ingen tekst-prop
      label: "Annet",
    });
    for (const element of [withVariant, withLabel]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain("Tekst fra KI, godkjent");
      expect(html).not.toContain("Annet");
    }
  });
});
