import { describe, expect, it } from "vitest";
import { todayInOslo } from "@/shared/lib/dates";
import { EXPIRY_CASES } from "../../../tests/offer-expiry-cases";
import { ORDER_STATUSES, OFFER_DISPLAY_STATUSES } from "./codes";
import { OFFER_EXPIRING_SOON_DAYS, OFFER_VALID_DAYS, OFFER_VALID_UNTIL_MAX_DAYS } from "./contract";
import {
  canExtendOffer,
  isOfferExpired,
  offerDaysLeft,
  offerDisplayStatus,
  offerExpiresLabel,
  parseOfferListFilter,
} from "./offer-status";

/*
 * Utløpsregelen for tilbud som ren funksjon (testplan 1.1, 7.1.1 og 7.3.4; ADR 0012). Sakene
 * brukes også av paritetstesten mot SQL (`offer-status-parity.test.ts`).
 *
 * Støtter hovedmål: de ansatte (listen «Åpne» viser bare det som fortsatt kan bli jobb, og det som
 * haster, får merke) og færre reklamasjoner (utløpte tilbud forsvinner ikke, de kan fortsatt
 * gjøres om).
 */

describe("1.1 utløpsregelen", () => {
  it.each(EXPIRY_CASES)("$name", ({ status, validUntil, now, expired, display }) => {
    const today = todayInOslo(now);
    expect(isOfferExpired(status, validUntil, today)).toBe(expired);
    expect(offerDisplayStatus(status, validUntil, today)).toBe(display);
  });

  it("1.1.7 konstantene er 30, 365 og 7", () => {
    expect(OFFER_VALID_DAYS).toBe(30);
    expect(OFFER_VALID_UNTIL_MAX_DAYS).toBe(365);
    expect(OFFER_EXPIRING_SOON_DAYS).toBe(7);
  });

  it("1.1.8 visningsstatusene er faste, og expired kan ikke lagres som status", () => {
    expect([...OFFER_DISPLAY_STATUSES]).toEqual(["open", "expired", "converted", "rejected"]);
    expect((ORDER_STATUSES as readonly string[]).includes("expired")).toBe(false);
  });
});

describe("7.3.4 dager igjen og merket «Går ut …»", () => {
  const today = "2026-11-03";

  it.each([
    ["2026-11-03", 0, "Går ut i dag"],
    ["2026-11-04", 1, "Går ut i morgen"],
    ["2026-11-10", 7, "Går ut om 7 dager"],
    ["2026-11-11", 8, null],
    ["2026-11-02", -1, null],
  ] as const)("gyldig til %s gir %i dager og merket %s", (validUntil, days, label) => {
    expect(offerDaysLeft(validUntil, today)).toBe(days);
    expect(offerExpiresLabel("received", validUntil, today)).toBe(label);
  });

  it("over sommertid og vintertid er det hele dager", () => {
    // 29.03.2026 og 25.10.2026 er dagene klokka stilles
    expect(offerDaysLeft("2026-03-30", "2026-03-28")).toBe(2);
    expect(offerDaysLeft("2026-10-26", "2026-10-24")).toBe(2);
    expect(offerDaysLeft("2027-11-03", "2026-11-03")).toBe(365);
  });

  it("avslått og gjort om får aldri merket", () => {
    expect(offerExpiresLabel("rejected", "2026-11-03", today)).toBeNull();
    expect(offerExpiresLabel("converted", "2026-11-04", today)).toBeNull();
  });
});

describe("7.1.1 «Forleng 30 dager» vises", () => {
  const today = "2026-11-03";

  it.each([
    ["utløpt", "received", "2026-10-01", true],
    ["åpent, 0 dager igjen", "received", "2026-11-03", true],
    ["åpent, 1 dag igjen", "received", "2026-11-04", true],
    ["åpent, 7 dager igjen", "received", "2026-11-10", true],
    ["åpent, 8 dager igjen", "received", "2026-11-11", false],
    ["avslått", "rejected", "2026-10-01", false],
    ["gjort om", "converted", "2026-11-04", false],
  ] as const)("%s", (_name, status, validUntil, expected) => {
    expect(canExtendOffer(status, validUntil, today)).toBe(expected);
  });
});

describe("filteret fra adressen", () => {
  it.each([
    [undefined, "open"],
    [null, "open"],
    ["", "open"],
    ["slettet", "open"],
    ["expired'--", "open"],
    ["expired", "expired"],
    ["rejected", "rejected"],
    ["converted", "converted"],
    ["all", "all"],
    ["open", "open"],
  ] as const)("%s gir %s", (value, expected) => {
    expect(parseOfferListFilter(value)).toBe(expected);
  });
});
