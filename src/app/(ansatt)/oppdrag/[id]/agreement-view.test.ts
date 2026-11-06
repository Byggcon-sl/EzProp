import { describe, expect, it } from "vitest";
import { agreementBadge, selectableAgreements, suggestionText } from "./agreement-view";

/*
 * Kortet «Avtale» på oppdragssiden, som rene regler
 * (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 7, punkt 1–6). Prosjektet har
 * ikke komponenttester, så merket, velgerlisten og forslagsteksten testes i hjelpefilen kortet
 * bruker. Punkt 7 (ingen knapper uten rett) dekkes i e2e (9.5 og 9.6).
 *
 * Fast dag: 2026-11-03 (TEST_NOW i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (slettet og utløpt avtale vises med merke og kan aldri velges
 * på nytt) og tid (forslaget sier hvorfor, så takstmannen kan godta med ett trykk).
 */

const TODAY = "2026-11-03";
const DELETED_AT = new Date("2026-10-01T08:00:00Z");

type Row = {
  id: string;
  validFrom: string;
  validTo: string | null;
  deletedAt: Date | string | null;
};

const ACTIVE: Row = { id: "aktiv", validFrom: "2026-01-01", validTo: null, deletedAt: null };
const ACTIVE_CLOSED: Row = {
  id: "aktiv-med-slutt",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  deletedAt: null,
};
const EXPIRED: Row = {
  id: "utlopt",
  validFrom: "2026-01-01",
  validTo: "2026-11-02",
  deletedAt: null,
};
const NOT_STARTED: Row = {
  id: "ikke-startet",
  validFrom: "2026-11-04",
  validTo: null,
  deletedAt: null,
};
const DELETED: Row = {
  id: "slettet",
  validFrom: "2026-01-01",
  validTo: null,
  deletedAt: DELETED_AT,
};
const DELETED_AS_TEXT: Row = {
  ...DELETED,
  id: "slettet-tekst",
  deletedAt: DELETED_AT.toISOString(),
};

describe("7.1–7.3 merket på avtalen", () => {
  it.each([
    ["løpende avtale", ACTIVE, null],
    ["avtale med sluttdato fram i tid", ACTIVE_CLOSED, null],
    ["startdagen er i dag", { ...ACTIVE, validFrom: TODAY }, null],
    ["siste dag er i dag", { ...ACTIVE, validTo: TODAY }, null],
    ["én-dags avtale i dag", { ...ACTIVE, validFrom: TODAY, validTo: TODAY }, null],
    ["sluttet i går", EXPIRED, "Utløpt"],
    ["starter i morgen", NOT_STARTED, "Ikke startet"],
    ["slettet (Date)", DELETED, "Slettet"],
    ["slettet (tekst fra JSON)", DELETED_AS_TEXT, "Slettet"],
  ] as const)("%s → %s", (_name, agreement, expected) => {
    expect(agreementBadge(agreement, TODAY)).toBe(expected);
  });

  it("«Slettet» har forrang foran «Utløpt» og «Ikke startet»", () => {
    expect(agreementBadge({ ...EXPIRED, deletedAt: DELETED_AT }, TODAY)).toBe("Slettet");
    expect(agreementBadge({ ...NOT_STARTED, deletedAt: DELETED_AT }, TODAY)).toBe("Slettet");
  });

  it("dagen er den som sendes inn (norsk dato), ikke klokka på maskinen", () => {
    // Avtalen slutter 3. november: gyldig den dagen, utløpt dagen etter.
    const endsToday = { ...ACTIVE, validTo: "2026-11-03" };
    expect(agreementBadge(endsToday, "2026-11-03")).toBeNull();
    expect(agreementBadge(endsToday, "2026-11-04")).toBe("Utløpt");
  });
});

describe("7.4 forslaget", () => {
  it("«Forslag: <avtale> (bestilleren er fra <firma>)»", () => {
    expect(
      suggestionText({ agreementName: "Testavtale forsikring", firmName: "Testforsikring AS" }),
    ).toBe("Forslag: Testavtale forsikring (bestilleren er fra Testforsikring AS)");
  });

  it("navnene står som de er (ingen avkorting eller omskriving)", () => {
    const longName = "Avtale ".repeat(17).trim();
    expect(suggestionText({ agreementName: longName, firmName: "Firma & co AS" })).toBe(
      `Forslag: ${longName} (bestilleren er fra Firma & co AS)`,
    );
  });
});

describe("7.5–7.6 velgeren viser bare gyldige avtaler", () => {
  it("av gyldig, utløpt, slettet og ikke påbegynt står bare de gyldige igjen", () => {
    const list = [ACTIVE, EXPIRED, DELETED, NOT_STARTED, ACTIVE_CLOSED, DELETED_AS_TEXT];
    expect(selectableAgreements(list, TODAY).map((row) => row.id)).toEqual([
      "aktiv",
      "aktiv-med-slutt",
    ]);
  });

  it("slettet avtale som ellers gjelder i dag tas ikke med", () => {
    expect(selectableAgreements([DELETED], TODAY)).toEqual([]);
  });

  it("tom liste gir tom liste (bare «Ingen avtale» i velgeren)", () => {
    expect(selectableAgreements([], TODAY)).toEqual([]);
  });

  it.each([
    ["startdagen", { ...ACTIVE, validFrom: TODAY }, true],
    ["siste dag", { ...ACTIVE, validTo: TODAY }, true],
    ["dagen etter siste dag", { ...ACTIVE, validTo: "2026-11-02" }, false],
    ["dagen før startdagen", { ...ACTIVE, validFrom: "2026-11-04" }, false],
  ] as const)("grensen %s → med: %s", (_name, agreement, included) => {
    expect(selectableAgreements([agreement], TODAY)).toHaveLength(included ? 1 : 0);
  });

  it("beholder resten av feltene og rekkefølgen", () => {
    const named = [
      { ...ACTIVE_CLOSED, name: "B-avtale" },
      { ...EXPIRED, name: "Utløpt avtale" },
      { ...ACTIVE, name: "A-avtale" },
    ];
    expect(selectableAgreements(named, TODAY)).toEqual([named[0], named[2]]);
  });

  it("merket og velgeren er enige: alt som kan velges, har ikke merke", () => {
    const list = [ACTIVE, EXPIRED, DELETED, NOT_STARTED, ACTIVE_CLOSED];
    for (const agreement of list) {
      const selectable = selectableAgreements([agreement], TODAY).length === 1;
      expect(agreementBadge(agreement, TODAY) === null, agreement.id).toBe(selectable);
    }
  });
});
