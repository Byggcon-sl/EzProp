import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TG_BADGE_LONG, TG_BADGE_SHORT, TgBadge, type TgBadgeValue } from "./tg-badge";

/*
 * TG-merket (A246, docs/funksjoner/fase2a-badet-pc-design.md avsnitt 14, testplanen B6.14): alltid
 * tekst, kort form har lang form for skjermleser, bare TG-tokenene. Støtter hovedmål: færre
 * reklamasjoner (TG leses som tekst, ikke farge).
 */

const VALUES: TgBadgeValue[] = ["0", "1", "2", "3", "IU"];

describe("TgBadge", () => {
  it.each(VALUES)("TG %s: kort form med tekst og lang form som aria-label", (tg) => {
    const html = renderToStaticMarkup(TgBadge({ tg }));
    expect(html).toContain(`>${TG_BADGE_SHORT[tg]}<`);
    expect(html).toContain(`aria-label="${TG_BADGE_SHORT[tg]} ${TG_BADGE_LONG[tg]}"`);
    const token = tg === "IU" ? "tgiu" : `tg${tg}`;
    expect(html).toContain(`bg-${token}-bg`);
    expect(html).toContain(`text-${token}-text`);
  });

  it.each(VALUES)("TG %s: lang form står som tekst", (tg) => {
    const html = renderToStaticMarkup(TgBadge({ tg, long: true }));
    expect(html).toContain(`${TG_BADGE_SHORT[tg]} ${TG_BADGE_LONG[tg]}`);
    expect(html).not.toContain("aria-label");
  });

  it("ingen faste hex-farger og ingen KI-tone", () => {
    for (const tg of VALUES) {
      const html = renderToStaticMarkup(TgBadge({ tg, long: true }));
      expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(html).not.toMatch(/\bai-/);
    }
  });
});
