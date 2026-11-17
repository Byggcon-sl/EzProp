import type { OfferDisplayStatus, OrderStatus } from "@/core/orders/codes";

/*
 * Testsakene for utløpsregelen til tilbud (ADR 0012, testplan 1.1). Brukes av den rene funksjonen
 * (`src/core/orders/offer-status.test.ts`) og av paritetstesten mot SQL
 * (`src/core/orders/offer-status-parity.test.ts`), så begge prøver nøyaktig de samme sakene.
 */

/** Saker som går gjennom både funksjonen og SQL-uttrykket. `now` gir `today` med norsk tid. */
export const EXPIRY_CASES: {
  name: string;
  status: OrderStatus;
  validUntil: string;
  now: Date;
  expired: boolean;
  display: OfferDisplayStatus;
}[] = [
  {
    name: "åpent, gyldig til i går",
    status: "received",
    validUntil: "2026-11-02",
    now: new Date("2026-11-03T10:00:00Z"),
    expired: true,
    display: "expired",
  },
  {
    name: "åpent, gyldig til i dag",
    status: "received",
    validUntil: "2026-11-03",
    now: new Date("2026-11-03T10:00:00Z"),
    expired: false,
    display: "open",
  },
  {
    name: "åpent, gyldig til i morgen",
    status: "received",
    validUntil: "2026-11-04",
    now: new Date("2026-11-03T10:00:00Z"),
    expired: false,
    display: "open",
  },
  {
    name: "avslått for ett år siden",
    status: "rejected",
    validUntil: "2025-11-03",
    now: new Date("2026-11-03T10:00:00Z"),
    expired: false,
    display: "rejected",
  },
  {
    name: "gjort om for ett år siden",
    status: "converted",
    validUntil: "2025-11-03",
    now: new Date("2026-11-03T10:00:00Z"),
    expired: false,
    display: "converted",
  },
  {
    name: "vinter, 00:30 norsk tid dagen etter",
    status: "received",
    validUntil: "2026-01-14",
    now: new Date("2026-01-14T23:30:00Z"),
    expired: true,
    display: "expired",
  },
  {
    name: "vinter, 23:30 norsk tid samme dag",
    status: "received",
    validUntil: "2026-01-14",
    now: new Date("2026-01-14T22:30:00Z"),
    expired: false,
    display: "open",
  },
  {
    name: "sommer, 00:30 norsk tid dagen etter",
    status: "received",
    validUntil: "2026-06-14",
    now: new Date("2026-06-14T22:30:00Z"),
    expired: true,
    display: "expired",
  },
  {
    name: "sommer, 23:30 norsk tid samme dag",
    status: "received",
    validUntil: "2026-06-14",
    now: new Date("2026-06-14T21:30:00Z"),
    expired: false,
    display: "open",
  },
];
