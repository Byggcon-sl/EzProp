import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SAVE_STATE_TEXTS, SaveState, saveStateText, type SaveStatus } from "./save-state";

/*
 * Lagrestatus (docs/funksjoner/fase2a-badet-pc-design.md avsnitt 10): tekst og ikon alltid
 * sammen, bare synk-tokenene, aldri TG-farger. Bare samlet status har role="status".
 * Støtter hovedmål: de ansatte (ser alltid om teksten er lagret).
 */

const STATUSES: SaveStatus[] = ["saved", "saving", "failed", "offline"];

describe("SaveState", () => {
  it.each(STATUSES)("%s per felt: tekst og ikon, ingen role=status, ingen TG-farge", (status) => {
    const html = renderToStaticMarkup(SaveState({ status, scope: "field" }));
    expect(html).toContain(SAVE_STATE_TEXTS.field[status]);
    expect(html).toContain("<svg");
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/text-sync-/);
    expect(html).not.toMatch(/\b(bg|text)-tg/);
  });

  it.each(STATUSES)("%s samlet: pille med role=status og synk-flate", (status) => {
    const html = renderToStaticMarkup(SaveState({ status, scope: "total", failedCount: 2 }));
    expect(html).toContain('role="status"');
    expect(html).toMatch(/bg-sync-/);
    expect(html).not.toMatch(/\b(bg|text)-tg/);
  });

  it("tekstene fra designet", () => {
    expect(saveStateText({ status: "failed", scope: "field" })).toBe("Ikke lagret – prøv igjen");
    expect(saveStateText({ status: "offline", scope: "total" })).toBe(
      "Uten nett – endringene dine er ikke lagret ennå",
    );
    expect(saveStateText({ status: "failed", scope: "total", failedCount: 1 })).toBe(
      "1 felt er ikke lagret – prøv igjen",
    );
    expect(saveStateText({ status: "saved", scope: "total" })).toBe("Alt er lagret");
  });

  it("«Prøv igjen» vises bare ved feil og bare med handling", () => {
    const retry = () => {};
    expect(
      renderToStaticMarkup(SaveState({ status: "failed", scope: "field", onRetry: retry })),
    ).toContain(SAVE_STATE_TEXTS.retry);
    expect(
      renderToStaticMarkup(SaveState({ status: "saved", scope: "field", onRetry: retry })),
    ).not.toContain(SAVE_STATE_TEXTS.retry);
  });
});
