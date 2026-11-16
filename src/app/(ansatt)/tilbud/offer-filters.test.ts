import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OfferFilterNav,
  emptyOfferListText,
  offerListHref,
  offerListParams,
} from "./offer-filters";

/*
 * Filterknappene i tilbudslisten (docs/funksjoner/fase2a-tilbud-testplan.md 5.11, 5.16, 5.19 og
 * 7.3.5; design 3.2, 3.3 og 3.6). Valgt filter står i adressen, «Åpne» er ren /tilbud, tallene
 * leses som «Åpne, 3 tilbud».
 * Støtter hovedmål: de ansatte (filteret følger «Tilbake» og søket, store trykkflater på iPad).
 */

const COUNTS = { open: 3, expired: 2, rejected: 1, converted: 4, all: 10 };

function render(props: Parameters<typeof OfferFilterNav>[0]): string {
  return renderToStaticMarkup(createElement(OfferFilterNav, props));
}

/** Synlig tekst og skjermlesertekst, uten tagger. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("adressen til filteret", () => {
  it.each([
    ["open", "", "/tilbud"],
    ["expired", "", "/tilbud?status=expired"],
    ["rejected", "", "/tilbud?status=rejected"],
    ["converted", "", "/tilbud?status=converted"],
    ["all", "", "/tilbud?status=all"],
    ["open", "Testveien 12", "/tilbud?q=Testveien+12"],
    ["expired", "Testveien", "/tilbud?status=expired&q=Testveien"],
  ] as const)("%s med søk «%s» → %s", (filter, query, href) => {
    expect(offerListHref(filter, query)).toBe(href);
  });

  it("søket får filteret som skjult felt, men ikke «Åpne»", () => {
    expect(offerListParams("expired", "")).toEqual({ status: "expired" });
    expect(offerListParams("open", "")).toEqual({});
  });
});

describe("knappene", () => {
  it("står i rekkefølgen Åpne, Utløpt, Avslått, Gjort om til oppdrag, Alle i nav «Status»", () => {
    const html = render({ current: "open", query: "", counts: COUNTS });
    expect(html).toMatch(/^<nav aria-label="Status"/);
    const labels = [...html.matchAll(/<a [^>]*>([^<]+)/g)].map((match) => match[1]);
    expect(labels).toEqual(["Åpne", "Utløpt", "Avslått", "Gjort om til oppdrag", "Alle"]);
  });

  it("valgt filter har aria-current, de andre ikke", () => {
    const html = render({ current: "expired", query: "", counts: COUNTS });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/tilbud\?status=expired" aria-current="page"/);
  });

  it("knappene er minst 44 px høye", () => {
    const html = render({ current: "open", query: "" });
    for (const [anchor] of html.matchAll(/<a [^>]*>/g)) expect(anchor).toContain("min-h-11");
  });

  it("tallene står på knappene og leses «Åpne, 3 tilbud»", () => {
    const html = render({ current: "open", query: "", counts: COUNTS });
    expect(text(html)).toContain("Åpne, 3 tilbud");
    expect(text(html)).toContain("Alle, 10 tilbud");
    expect(html).toContain('data-testid="offer-count-expired"');
  });

  it("uten tall (listen feilet) står knappene uten tall, aldri «0»", () => {
    const html = render({ current: "open", query: "" });
    expect(html).not.toContain("offer-count-");
    expect(text(html)).not.toContain("tilbud");
  });

  it("lenkene tar med søket", () => {
    const html = render({ current: "open", query: "Testveien" });
    expect(html).toContain('href="/tilbud?status=all&amp;q=Testveien"');
    expect(html).toContain('href="/tilbud?q=Testveien"');
  });
});

describe("tom liste", () => {
  it.each([
    ["open", "Ingen åpne tilbud."],
    ["expired", "Ingen utløpte tilbud."],
    ["rejected", "Ingen avslåtte tilbud."],
    ["converted", "Ingen tilbud er gjort om til oppdrag."],
    ["all", "Ingen tilbud er lagt inn ennå."],
  ] as const)("%s uten søk → «%s»", (filter, expected) => {
    expect(emptyOfferListText(filter, "")).toBe(expected);
  });

  it("med søk → «Ingen tilbud passer søket.»", () => {
    expect(emptyOfferListText("expired", "Testveien")).toBe("Ingen tilbud passer søket.");
  });
});
