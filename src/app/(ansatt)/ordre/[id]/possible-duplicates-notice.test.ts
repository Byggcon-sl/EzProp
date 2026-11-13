import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_REASONS,
  duplicateReasonLabel,
  orderStatusLabel,
  type PossibleDuplicateOrder,
} from "@/core/orders";
import {
  POSSIBLE_DUPLICATES_MORE_TEXT,
  POSSIBLE_DUPLICATES_TEXT,
  PossibleDuplicatesNotice,
} from "./possible-duplicates-notice";

/*
 * Varselet «Mulig dublett» (docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 5).
 * Oppdiktede adresser og ordre.
 * Støtter hovedmål: de ansatte (varselet er tydelig, leses opp og har lenke) og færre
 * reklamasjoner (samme bolig blir ikke bestilt eller tatt to ganger).
 */

const OTHER_ID = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<PossibleDuplicateOrder> = {}): PossibleDuplicateOrder {
  return {
    id: OTHER_ID,
    receivedAt: new Date("2026-11-11T23:30:00Z"),
    addressText: "Storgata 1A, 8006 Bodø",
    status: "received",
    assignmentNumber: null,
    assignmentStatus: null,
    reasons: ["address"],
    ...overrides,
  };
}

function render(items: PossibleDuplicateOrder[], hasMore = false): string {
  return renderToStaticMarkup(createElement(PossibleDuplicatesNotice, { items, hasMore }));
}

/** Teksten i HTML uten tagger, med `&amp;` og lignende gjort om. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");
}

describe("PossibleDuplicatesNotice", () => {
  it("viser ingenting uten treff", () => {
    expect(render([])).toBe("");
    expect(render([], true)).toBe("");
  });

  it("har h2 «Mulig dublett», teksten, role=status og ikon med aria-hidden", () => {
    const html = render([item()]);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<h2[^>]*>Mulig dublett<\/h2>/);
    expect(text(html)).toContain(POSSIBLE_DUPLICATES_TEXT);
    expect(POSSIBLE_DUPLICATES_TEXT).toBe(
      "Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.",
    );
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    // Varselfargen (watch) fra Byggcon-profilen.
    expect(html).toContain("bg-watch-fill");
    expect(html).toContain("text-watch-text");
  });

  it("viser adresse, mottatt-dato i Oslo-tid, status og grunn", () => {
    const line = text(render([item()]));
    expect(line).toContain(
      `Storgata 1A, 8006 Bodø – mottatt 12.11.2026 – ${orderStatusLabel("received")} – samme adresse`,
    );
  });

  it("viser oppdragsnummeret når ordren er gjort om", () => {
    const line = text(
      render([
        item({
          status: "converted",
          assignmentNumber: "A-2026-0042",
          assignmentStatus: "ordered",
        }),
      ]),
    );
    expect(line).toContain(orderStatusLabel("converted"));
    expect(line).toContain("oppdrag A-2026-0042");
  });

  it.each([
    [["address"] as const, "samme adresse"],
    [["cadastre"] as const, "samme matrikkel"],
    [["address", "cadastre"] as const, "samme adresse og samme matrikkel"],
  ])("grunnene %j vises som «%s»", (reasons, expected) => {
    expect(text(render([item({ reasons: [...reasons] })]))).toMatch(new RegExp(`– ${expected}$`));
  });

  it("lenker til den andre ordren, minst 44 px høyt og med tekstbryting", () => {
    const html = render([item()]);
    expect(html).toContain(`href="/ordre/${OTHER_ID}"`);
    expect(html).toMatch(/<a[^>]*class="[^"]*min-h-11[^"]*"/);
    expect(html).toMatch(/<a[^>]*><span class="[^"]*\[overflow-wrap:anywhere\][^"]*"/);
  });

  it("én lenke per treff", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({ id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}` }),
    );
    expect(render(items).match(/<a /g)).toHaveLength(10);
  });

  it("hasMore viser «Viser de 10 nyeste.», ellers ikke", () => {
    expect(POSSIBLE_DUPLICATES_MORE_TEXT).toBe("Viser de 10 nyeste.");
    expect(text(render([item()], true))).toContain("Viser de 10 nyeste.");
    expect(text(render([item()], false))).not.toContain("Viser de 10 nyeste.");
  });

  it.each(DUPLICATE_REASONS)("koden %s har norsk tekst", (reason) => {
    const label = duplicateReasonLabel(reason);
    expect(label).not.toBe(reason);
    expect(label.trim().length).toBeGreaterThan(0);
  });
});
