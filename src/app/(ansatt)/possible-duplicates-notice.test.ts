import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOOKING_DUPLICATES_TEXT,
  BookingDuplicatesNotice,
  bookingDuplicateHref,
  bookingDuplicateLine,
  type BookingDuplicateItem,
} from "./possible-duplicates-notice";

/*
 * Varselet «Mulig dublett» med treff fra både ordre og oppdrag
 * (docs/funksjoner/fase2a-nytt-oppdrag-design.md avsnitt 5). Oppdiktede adresser.
 * Støtter hovedmål: færre reklamasjoner (samme bolig blir ikke tatt to ganger).
 */

const ID = "11111111-1111-4111-8111-111111111111";

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

describe("bookingDuplicateLine og lenken", () => {
  it("oppdrag: nummer, adresse, status og grunn; lenke til oppdraget", () => {
    expect(bookingDuplicateLine(item())).toBe(
      "Oppdrag 2026-00042 – Storgata 1A, 8006 Bodø – Under arbeid – samme adresse",
    );
    expect(bookingDuplicateHref(item())).toBe(`/oppdrag/${ID}`);
  });

  it("ordre: uten nummer, med ordrestatus; lenke til ordren", () => {
    const order = item({ kind: "order", number: null, status: "received", reasons: ["cadastre"] });
    expect(bookingDuplicateLine(order)).toBe(
      "Ordre – Storgata 1A, 8006 Bodø – Mottatt – samme matrikkel",
    );
    expect(bookingDuplicateHref(order)).toBe(`/ordre/${ID}`);
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
