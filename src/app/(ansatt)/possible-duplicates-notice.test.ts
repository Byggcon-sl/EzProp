import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOOKING_DUPLICATES_TEXT,
  BookingDuplicatesNotice,
  bookingDuplicateHref,
  bookingDuplicateLine,
  canConvertDuplicate,
  CONVERT_OFFER_LABEL,
  convertOfferHref,
  type BookingDuplicateItem,
} from "./possible-duplicates-notice";

/*
 * Varselet «Mulig dublett» med treff fra både tilbud og oppdrag
 * (docs/funksjoner/fase2a-nytt-oppdrag-design.md avsnitt 5, docs/funksjoner/fase2a-tilbud-design.md
 * 7.2, testplan 7.2.5). «Gjør om tilbudet» bare for åpne og utløpte tilbud, og bare i «Nytt
 * oppdrag». Oppdiktede adresser.
 * Støtter hovedmål: færre reklamasjoner (samme bolig blir ikke tatt to ganger, og et tilbud som
 * finnes blir gjort om i stedet for at et nytt oppdrag registreres).
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<BookingDuplicateItem> = {}): BookingDuplicateItem {
  return {
    kind: "assignment",
    id: ID,
    number: "2026-00042",
    status: "in_progress",
    addressText: "Storgata 1A, 8006 Bodø",
    reasons: ["address"],
    ...overrides,
  };
}

/** Et tilbudstreff med visningsstatusen fra kjernen. */
function offerItem(
  displayStatus: NonNullable<BookingDuplicateItem["displayStatus"]>,
  status = "received",
): BookingDuplicateItem {
  return item({ kind: "order", id: OFFER_ID, number: null, status, displayStatus });
}

/** Lenkene «Gjør om tilbudet» i HTML-en. */
function convertLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*>Gjør om tilbudet<\/a>/g)].map((match) => match[0]);
}

describe("bookingDuplicateLine og lenken", () => {
  it("oppdrag: nummer, adresse, status og grunn; lenke til oppdraget", () => {
    expect(bookingDuplicateLine(item())).toBe(
      "Oppdrag 2026-00042 – Storgata 1A, 8006 Bodø – Under arbeid – samme adresse",
    );
    expect(bookingDuplicateHref(item())).toBe(`/oppdrag/${ID}`);
  });

  it("tilbud: uten nummer, med visningsstatusen; lenke til tilbudet", () => {
    const offer = item({
      kind: "order",
      number: null,
      status: "received",
      reasons: ["cadastre"],
      displayStatus: "open",
    });
    expect(bookingDuplicateLine(offer)).toBe(
      "Tilbud – Storgata 1A, 8006 Bodø – Åpent – samme matrikkel",
    );
    expect(bookingDuplicateHref(offer)).toBe(`/tilbud/${ID}`);
  });

  it("utløpt tilbud: «Utløpt» i linjen (visningsstatusen fra kjernen)", () => {
    expect(bookingDuplicateLine(offerItem("expired"))).toBe(
      "Tilbud – Storgata 1A, 8006 Bodø – Utløpt – samme adresse",
    );
  });

  it("tilbud uten visningsstatus: den lagrede statusen med tilbudsord («Åpent»)", () => {
    expect(bookingDuplicateLine(item({ kind: "order", number: null, status: "received" }))).toBe(
      "Tilbud – Storgata 1A, 8006 Bodø – Åpent – samme adresse",
    );
  });

  it("ingen lenke peker til /ordre, og ingen tekst sier «ordre»", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, {
        items: [offerItem("open"), item()],
        hasMore: false,
        offerAction: true,
      }),
    );
    expect(html).not.toContain("/ordre");
    expect(html).not.toMatch(/\bordre/i);
  });

  it("begge grunnene", () => {
    expect(bookingDuplicateLine(item({ reasons: ["address", "cadastre"] }))).toContain(
      "samme adresse og samme matrikkel",
    );
  });
});

describe("BookingDuplicatesNotice", () => {
  it("viser ingenting uten treff", () => {
    expect(
      renderToStaticMarkup(createElement(BookingDuplicatesNotice, { items: [], hasMore: true })),
    ).toBe("");
  });

  it("role=status, overskrift, tekst, lenke, og ingen «Lagre likevel»", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, { items: [item()], hasMore: true }),
    );
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<h2[^>]*>Mulig dublett<\/h2>/);
    expect(html).toContain(BOOKING_DUPLICATES_TEXT);
    expect(html).toContain(`href="/oppdrag/${ID}"`);
    expect(html).toContain("Viser de 10 nyeste.");
    expect(html).not.toContain("Lagre likevel");
    expect(html).not.toContain("<button");
  });
});

describe("«Gjør om tilbudet» (F2 b)", () => {
  it.each([
    ["åpent", offerItem("open"), true],
    ["utløpt innenfor 90 dager", offerItem("expired"), true],
    ["avslått", offerItem("open", "rejected"), false],
    ["gjort om", offerItem("open", "converted"), false],
    ["oppdrag", item(), false],
    [
      "tilbud uten visningsstatus",
      item({ kind: "order", number: null, status: "received" }),
      false,
    ],
  ])("%s: knapp = %s", (_name, hit, expected) => {
    expect(canConvertDuplicate(hit)).toBe(expected);
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, { items: [hit], hasMore: false, offerAction: true }),
    );
    expect(convertLinks(html)).toHaveLength(expected ? 1 : 0);
  });

  it("lenken går til tilbudet med «Gjør om til oppdrag» i fokus (#gjor-om)", () => {
    expect(convertOfferHref(offerItem("open"))).toBe(`/tilbud/${OFFER_ID}#gjor-om`);
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, {
        items: [offerItem("expired")],
        hasMore: false,
        offerAction: true,
      }),
    );
    const [link] = convertLinks(html);
    expect(link).toContain(`href="/tilbud/${OFFER_ID}#gjor-om"`);
    expect(CONVERT_OFFER_LABEL).toBe("Gjør om tilbudet");
  });

  it("sekundærknapp på minst 44 px, og skjermleseren får treffets linje med aria-describedby", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, {
        items: [offerItem("open")],
        hasMore: false,
        offerAction: true,
        headingId: "dublett-test",
      }),
    );
    const [link] = convertLinks(html);
    expect(link).toContain("min-h-11");
    expect(link).toContain("ring-slate-700");
    const describedBy = /aria-describedby="([^"]+)"/.exec(link ?? "")?.[1];
    expect(describedBy).toBeTruthy();
    const line = new RegExp(`<span id="${describedBy}"[^>]*>([^<]+)</span>`).exec(html)?.[1];
    expect(line).toBe("Tilbud – Storgata 1A, 8006 Bodø – Åpent – samme adresse");
  });

  it("uten offerAction (oppdragssiden) er varselet bare lenker", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, {
        items: [offerItem("open"), offerItem("expired")],
        hasMore: false,
      }),
    );
    expect(convertLinks(html)).toHaveLength(0);
    expect(html).not.toContain("aria-describedby");
    expect(html).toContain(`href="/tilbud/${OFFER_ID}"`);
  });

  it("flere treff: én knapp per åpent eller utløpt tilbud, hver med sin egen linje", () => {
    const second = { ...offerItem("expired"), id: "33333333-3333-4333-8333-333333333333" };
    const html = renderToStaticMarkup(
      createElement(BookingDuplicatesNotice, {
        items: [offerItem("open"), second, item(), offerItem("open", "rejected")],
        hasMore: false,
        offerAction: true,
      }),
    );
    const links = convertLinks(html);
    expect(links).toHaveLength(2);
    const ids = links.map((link) => /aria-describedby="([^"]+)"/.exec(link)?.[1]);
    expect(new Set(ids).size).toBe(2);
  });
});
