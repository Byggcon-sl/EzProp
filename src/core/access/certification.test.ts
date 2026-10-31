import { describe, expect, it } from "vitest";
import { isCertificationValid, todayInOslo } from "./index";

/*
 * Datoregelen for sertifisering (regeltester som data, uten database og uten falsk klokke).
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 1.
 * Støtter hovedmål: reklamasjoner (ingen publiserer med utgått sertifisering; utløpsdagen er siste
 * gyldige dag, regnet i norsk tid).
 */

const TODAY = "2026-10-31";
const DELETED = new Date("2026-10-01T10:00:00Z");

type Case = {
  navn: string;
  validFrom: string | null;
  validTo: string;
  deletedAt: Date | null;
  forventet: boolean;
};

// 1.1–1.6: fast «i dag» = 2026-10-31
const cases: Case[] = [
  {
    navn: "utløper i dag",
    validFrom: null,
    validTo: "2026-10-31",
    deletedAt: null,
    forventet: true,
  },
  {
    navn: "utløp i går",
    validFrom: null,
    validTo: "2026-10-30",
    deletedAt: null,
    forventet: false,
  },
  {
    navn: "starter i morgen",
    validFrom: "2026-11-01",
    validTo: "2028-01-01",
    deletedAt: null,
    forventet: false,
  },
  {
    navn: "starter i dag",
    validFrom: "2026-10-31",
    validTo: "2027-10-31",
    deletedAt: null,
    forventet: true,
  },
  {
    navn: "uten gyldig fra",
    validFrom: null,
    validTo: "2027-10-31",
    deletedAt: null,
    forventet: true,
  },
  {
    navn: "slettet",
    validFrom: null,
    validTo: "2027-10-31",
    deletedAt: DELETED,
    forventet: false,
  },
];

describe("isCertificationValid (i dag = 2026-10-31)", () => {
  it.each(cases)("$navn → $forventet", ({ validFrom, validTo, deletedAt, forventet }) => {
    expect(isCertificationValid({ validFrom, validTo, deletedAt }, TODAY)).toBe(forventet);
  });
});

// 1.7–1.9: «i dag» i norsk tid
const osloCases: { navn: string; now: string; forventet: string }[] = [
  // Testplanen skrev 2026-10-30T22:30:00Z for 00:30; med +1 er det 23:30. 00:30 er 23:30Z.
  { navn: "23:30 i Oslo (vintertid, +1)", now: "2026-10-30T22:30:00Z", forventet: "2026-10-30" },
  { navn: "00:30 i Oslo (vintertid, +1)", now: "2026-10-30T23:30:00Z", forventet: "2026-10-31" },
  { navn: "23:59:59 i Oslo", now: "2026-10-31T22:59:59Z", forventet: "2026-10-31" },
  { navn: "midnatt i Oslo", now: "2026-10-31T23:00:00Z", forventet: "2026-11-01" },
  { navn: "sommertid (+2)", now: "2026-06-30T22:30:00Z", forventet: "2026-07-01" },
];

describe("todayInOslo", () => {
  it.each(osloCases)("$navn: $now → $forventet", ({ now, forventet }) => {
    expect(todayInOslo(new Date(now))).toBe(forventet);
  });
});

// 1.10: UTC-dato brukes ikke
describe("utløp ved midnatt i Oslo", () => {
  const cert = { validFrom: null, validTo: "2026-10-31", deletedAt: null };

  it.each([
    { now: "2026-10-31T22:59:59Z", forventet: true },
    { now: "2026-10-31T23:00:00Z", forventet: false },
  ])("validTo 2026-10-31 kl. $now → $forventet", ({ now, forventet }) => {
    expect(isCertificationValid(cert, todayInOslo(new Date(now)))).toBe(forventet);
  });
});
