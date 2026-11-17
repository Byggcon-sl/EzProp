import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OFFER_DISPLAY_STATUSES, type OfferDisplayStatus } from "@/core/orders/codes";
import { OfferStatusBadge, offerStatusText } from "./offer-status-badge";

/*
 * Statusmerkene på tilbudet (docs/funksjoner/fase2a-tilbud-testplan.md 1.2 og 7.3.5, design 3.5).
 * Teksten bærer meningen; fargen er bare hjelp. Gult (watch) betyr bare «går ut snart» (A370).
 * Støtter hovedmål: de ansatte (lederen ser hva som haster) og færre reklamasjoner (status leses
 * fra teksten, ikke bare fargen).
 */

function render(props: Parameters<typeof OfferStatusBadge>[0]): string {
  return renderToStaticMarkup(createElement(OfferStatusBadge, props));
}

function classes(html: string): string[] {
  return (/^<span[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

const VALID_UNTIL = "2026-11-14";

describe("1.2 etikettene", () => {
  it.each([
    ["open", "Åpent"],
    ["rejected", "Avslått"],
    ["converted", "Gjort om til oppdrag"],
  ] as const)("%s → «%s»", (status, label) => {
    expect(offerStatusText(status, VALID_UNTIL)).toBe(label);
    expect(render({ displayStatus: status, validUntil: VALID_UNTIL })).toContain(label);
  });

  it("1.2.2 utløpt merke viser «Utløpt 14.11.2026» (norsk dato)", () => {
    expect(offerStatusText("expired", VALID_UNTIL)).toBe("Utløpt 14.11.2026");
    expect(render({ displayStatus: "expired", validUntil: VALID_UNTIL })).toContain(
      "Utløpt 14.11.2026",
    );
  });

  it.each(OFFER_DISPLAY_STATUSES)("1.2.1 %s har en norsk tekst, ikke koden", (status) => {
    const text = offerStatusText(status as OfferDisplayStatus, VALID_UNTIL);
    expect(text).not.toBe(status);
    expect(text.length).toBeGreaterThan(0);
  });

  it("A370: «Avslått» er nøytral, ikke gul", () => {
    const list = classes(render({ displayStatus: "rejected", validUntil: VALID_UNTIL }));
    expect(list).toContain("bg-sand");
    expect(list.filter((name) => name.includes("watch"))).toEqual([]);
  });

  it("«Åpent» har brand-tonen", () => {
    expect(classes(render({ displayStatus: "open", validUntil: VALID_UNTIL }))).toContain(
      "bg-brand-50",
    );
  });
});

describe("7.3 merket «Går ut …» (F3)", () => {
  it("står i stedet for «Åpent», i watch-tonen og med klokkeikon som skjermleseren hopper over", () => {
    const html = render({
      displayStatus: "open",
      validUntil: VALID_UNTIL,
      expiryText: "Går ut om 3 dager",
    });
    expect(html).toContain("Går ut om 3 dager");
    expect(html).not.toContain("Åpent");
    expect(classes(html)).toEqual(expect.arrayContaining(["bg-watch-fill", "text-watch-text"]));
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    // Ett merke, ikke to.
    expect(html.match(/<span[^>]*class="[^"]*rounded-full/g)).toHaveLength(1);
  });

  it.each(["expired", "rejected", "converted"] as const)(
    "brukes ikke for %s, selv om teksten sendes inn",
    (status) => {
      const html = render({
        displayStatus: status,
        validUntil: VALID_UNTIL,
        expiryText: "Går ut i dag",
      });
      expect(html).not.toContain("Går ut i dag");
    },
  );

  it("uten tekst er det et vanlig «Åpent»", () => {
    const html = render({ displayStatus: "open", validUntil: VALID_UNTIL, expiryText: null });
    expect(html).toContain("Åpent");
    expect(html).not.toContain("<svg");
  });
});
