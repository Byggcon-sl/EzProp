import { describe, expect, it } from "vitest";
import {
  DUPLICATE_REASONS,
  MAX_DUPLICATE_WINDOW_DAYS,
  duplicateReasons,
  isWithinDuplicateWindow,
  normalizeAddressKey,
  normalizeCadastreNumber,
} from "./index";
import { ADDRESS_CASES, CADASTRE_NUMBER_CASES } from "../../../tests/duplicate-cases";

/*
 * Regelen for mulig dublett som rene funksjoner (T3, Ståle 12.11.2026: «fast regel uten KI, og
 * varselet stopper ikke lagringen»). Testplan: docs/funksjoner/fase2a-varsel-dublett-testplan.md
 * avsnitt 1. Ingen database. Tabellene står i `tests/duplicate-cases.ts` og brukes også i
 * paritetstesten mot SQL (`duplicates-parity.test.ts`).
 *
 * Testdata er oppdiktet («Storgata 1A, 8006 Bodø», «Øvre gate 2», matrikkel 9999/123).
 *
 * Støtter hovedmål: færre reklamasjoner (regelen er låst med testsaker, så samme bolig ikke blir
 * bestilt eller tatt to ganger) og KI i bunnen (samme regel kan kalles for et ordreforslag fra
 * e-post, uten å sende adressen til KI).
 */

describe("1.1 normalizeAddressKey", () => {
  it.each(ADDRESS_CASES)("«%s» → %s", (input, expected) => {
    expect(normalizeAddressKey(input)).toBe(expected);
  });

  it("1.1.1 alle skrivemåtene av Storgata 1A gir samme nøkkel", () => {
    const keys = new Set(
      ["Storgata 1A, 8006 Bodø", "storgata 1 a", "Storgata 1a", "STORGATA 1-A."].map(
        normalizeAddressKey,
      ),
    );
    expect([...keys]).toEqual(["storgata1a"]);
  });

  it("1.1.5 «Øvre gate 2» er ikke lik «Ovre gate 2», og «Ærfuglveien 3» starter med æ", () => {
    expect(normalizeAddressKey("Øvre gate 2")).not.toBe(normalizeAddressKey("Ovre gate 2"));
    expect(normalizeAddressKey("Ærfuglveien 3")?.startsWith("æ")).toBe(true);
  });

  it("1.1.8 ulik husbokstav eller nummer gir ulik nøkkel", () => {
    expect(normalizeAddressKey("Storgata 1A")).not.toBe(normalizeAddressKey("Storgata 1B"));
    expect(normalizeAddressKey("Storgata 1")).not.toBe(normalizeAddressKey("Storgata 11"));
  });
});

describe("1.2 normalizeCadastreNumber", () => {
  it.each(CADASTRE_NUMBER_CASES)("«%s» → %s", (input, expected) => {
    expect(normalizeCadastreNumber(input)).toBe(expected);
  });
});

type Fields = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
};

function fields(overrides: Partial<Fields> = {}): Fields {
  return {
    addressText: "Storgata 1A, 8006 Bodø",
    gnr: "9999",
    bnr: "123",
    snr: null,
    ...overrides,
  };
}

describe("1.3 duplicateReasons", () => {
  it.each<[string, Fields, Fields, string[]]>([
    [
      "1.3.1 ulik adresse, samme gnr/bnr/snr",
      fields({ snr: "2" }),
      fields({ addressText: "Prøvegata 7, 8006 Bodø", snr: "2" }),
      ["cadastre"],
    ],
    [
      "1.3.2 samme adresse, ulik matrikkel",
      fields(),
      fields({ addressText: "storgata 1 a", gnr: "9998" }),
      ["address"],
    ],
    ["1.3.3 begge like", fields(), fields({ addressText: "Storgata 1a" }), ["address", "cadastre"]],
    [
      "1.3.4 gnr «0» på begge, ellers like",
      fields({ addressText: "Ett sted 1", gnr: "0" }),
      fields({ addressText: "Annet sted 2", gnr: "0" }),
      [],
    ],
    [
      "1.3.4 gnr «000» på begge, ellers like",
      fields({ addressText: "Ett sted 1", gnr: "000" }),
      fields({ addressText: "Annet sted 2", gnr: "000" }),
      [],
    ],
    [
      "1.3.5 bare gnr utfylt på begge",
      fields({ addressText: "Ett sted 1", bnr: null }),
      fields({ addressText: "Annet sted 2", bnr: null }),
      [],
    ],
    [
      "1.3.5 bare gnr utfylt på begge (bnr tom tekst)",
      fields({ addressText: "Ett sted 1", bnr: "" }),
      fields({ addressText: "Annet sted 2", bnr: "" }),
      [],
    ],
    [
      "1.3.6 snr tom mot snr «0»",
      fields({ addressText: "Ett sted 1", snr: null }),
      fields({ addressText: "Annet sted 2", snr: "0" }),
      ["cadastre"],
    ],
    [
      "1.3.6 snr tom tekst mot snr «000»",
      fields({ addressText: "Ett sted 1", snr: "" }),
      fields({ addressText: "Annet sted 2", snr: "000" }),
      ["cadastre"],
    ],
    [
      "1.3.7 samme gnr/bnr, ulikt snr",
      fields({ addressText: "Ett sted 1", snr: "2" }),
      fields({ addressText: "Annet sted 2", snr: "3" }),
      [],
    ],
    [
      "1.3.8 samme gnr/bnr, ett snr tomt og ett «2»",
      fields({ addressText: "Ett sted 1", snr: null }),
      fields({ addressText: "Annet sted 2", snr: "2" }),
      [],
    ],
    [
      "1.3.9 begge adresser tomme",
      fields({ addressText: "", gnr: null, bnr: null }),
      fields({ addressText: "", gnr: null, bnr: null }),
      [],
    ],
    [
      "1.3.9 begge adresser bare komma",
      fields({ addressText: ",", gnr: null, bnr: null }),
      fields({ addressText: " , 8006 Bodø", gnr: null, bnr: null }),
      [],
    ],
    [
      "«012» og «12» er like",
      fields({ addressText: "Ett sted 1", gnr: "09999", bnr: "0123" }),
      fields({ addressText: "Annet sted 2", gnr: "9999", bnr: "123" }),
      ["cadastre"],
    ],
  ])("%s → %j", (_name, a, b, expected) => {
    expect(duplicateReasons(a, b)).toEqual(expected);
    // Regelen er symmetrisk
    expect(duplicateReasons(b, a)).toEqual(expected);
  });
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date("2026-11-03T10:00:00Z");

function plus(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

describe("1.4 isWithinDuplicateWindow", () => {
  it.each<[string, Date, Date, boolean]>([
    ["1.4.1 nøyaktig 90 døgn før", BASE, plus(BASE, -90 * DAY), true],
    ["1.4.1 nøyaktig 90 døgn etter", BASE, plus(BASE, 90 * DAY), true],
    ["samme tid", BASE, BASE, true],
    ["1.4.2 90 døgn og 1 s før", BASE, plus(BASE, -90 * DAY - 1000), false],
    ["1.4.2 90 døgn og 1 s etter", BASE, plus(BASE, 90 * DAY + 1000), false],
    ["1.4.3 91 døgn før", BASE, plus(BASE, -91 * DAY), false],
    ["1.4.3 91 døgn etter", BASE, plus(BASE, 91 * DAY), false],
    [
      "1.4.4 over sommertid: + 2160 timer",
      new Date("2026-01-15T10:00:00Z"),
      plus(new Date("2026-01-15T10:00:00Z"), 2160 * HOUR),
      true,
    ],
    [
      "1.4.4 over sommertid: + 2160 timer + 1 s",
      new Date("2026-01-15T10:00:00Z"),
      plus(new Date("2026-01-15T10:00:00Z"), 2160 * HOUR + 1000),
      false,
    ],
  ])("%s → %s", (_name, a, b, expected) => {
    expect(isWithinDuplicateWindow(a, b)).toBe(expected);
    expect(isWithinDuplicateWindow(b, a)).toBe(expected);
  });

  it("1.4.4 grensen er 2160 timer, ikke 90 kalenderdøgn i Oslo (som er én time kortere over sommertid)", () => {
    // 15.01.2026 kl. 11 i Oslo + 90 kalenderdøgn = 15.04.2026 kl. 11 i Oslo = 09:00Z, som er
    // 2159 timer. Det er innenfor; 2160 timer er grensen.
    const a = new Date("2026-01-15T10:00:00Z");
    expect(isWithinDuplicateWindow(a, new Date("2026-04-15T09:00:00Z"))).toBe(true);
    expect(isWithinDuplicateWindow(a, new Date("2026-04-15T10:00:00Z"))).toBe(true);
    expect(isWithinDuplicateWindow(a, new Date("2026-04-15T10:00:01Z"))).toBe(false);
  });

  it("1.4.5 MAX_DUPLICATE_WINDOW_DAYS er 90", () => {
    expect(MAX_DUPLICATE_WINDOW_DAYS).toBe(90);
  });
});

describe("1.5 faste koder", () => {
  it("1.5.1 DUPLICATE_REASONS er nøyaktig address og cadastre (regel 6)", () => {
    expect([...DUPLICATE_REASONS]).toEqual(["address", "cadastre"]);
  });
});
