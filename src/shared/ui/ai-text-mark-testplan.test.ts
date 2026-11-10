import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiTextMark } from "./ai-text-mark";

/*
 * KI-merket (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 10.15–10.17, kortet
 * Omfang 2). Én fast tekst, ingen varianter, og bare for `accepted` eller `edited` lest fra
 * serveren, med `aiUsageId`.
 *
 * Støtter hovedmål: færre reklamasjoner (KI-tekst er alltid merket likt) og de ansatte
 * (takstmannen ser hva hen har godkjent).
 */

const LABEL = "Tekst fra KI, godkjent";
const USAGE_ID = "0193a6f0-0000-7000-8000-000000000002";

type MarkProps = Parameters<typeof AiTextMark>[0];

function render(props: MarkProps): string {
  return renderToStaticMarkup(createElement(AiTextMark, props));
}

describe("KI-merket (10.15–10.17)", () => {
  it.each(["accepted", "edited"])("10.15 %s med aiUsageId → «Tekst fra KI, godkjent»", (status) => {
    const html = render({ aiUsageId: USAGE_ID, status });
    expect(html).toContain(LABEL);
  });

  it.each<{ name: string; props: MarkProps }>([
    { name: "suggested", props: { aiUsageId: USAGE_ID, status: "suggested" } },
    { name: "rejected", props: { aiUsageId: USAGE_ID, status: "rejected" } },
    { name: "accepted uten aiUsageId (null)", props: { aiUsageId: null, status: "accepted" } },
    { name: "accepted uten aiUsageId (tom)", props: { aiUsageId: "", status: "accepted" } },
    { name: "edited uten aiUsageId", props: { status: "edited" } as MarkProps },
    { name: "uten status", props: { aiUsageId: USAGE_ID, status: null } },
  ])("10.16 $name → ingenting rendres", ({ props }) => {
    expect(render(props)).toBe("");
  });

  it("10.17 merket har ingen props for variant eller tekst", () => {
    const withVariant: MarkProps = {
      aiUsageId: USAGE_ID,
      status: "accepted",
      // @ts-expect-error merket har ingen variant
      variant: "warning",
    };
    const withLabel: MarkProps = {
      aiUsageId: USAGE_ID,
      status: "accepted",
      // @ts-expect-error merket har ingen egen tekst
      label: "Annen tekst",
    };
    const withChildren: MarkProps = {
      aiUsageId: USAGE_ID,
      status: "accepted",
      // @ts-expect-error merket har ingen barn
      children: "Annen tekst",
    };
    // Teksten er den faste uansett hva som sendes med
    for (const props of [withVariant, withLabel, withChildren]) {
      const html = render(props);
      expect(html).toContain(LABEL);
      expect(html).not.toContain("Annen tekst");
    }
  });
});
