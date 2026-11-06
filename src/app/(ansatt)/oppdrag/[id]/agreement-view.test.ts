import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialFormState } from "../../form-state";
import { AgreementCard } from "./agreement-card";
import { agreementBadge, selectableAgreements, suggestionText } from "./agreement-view";

/*
 * Kortet «Avtale» på oppdragssiden, som rene regler
 * (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 7). Merket, velgerlisten og
 * forslagsteksten testes i hjelpefilen kortet bruker. Til slutt gjengis kortet selv til HTML uten
 * nettleser (`createElement`, fordi Vitest bare tar med `*.test.ts`), for knappene og punkt 7
 * (ingen knapper uten rett). Det samme prøves i nettleseren i e2e (9.5 og 9.6).
 *
 * Fast dag: 2026-11-03 (TEST_NOW i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (slettet og utløpt avtale vises med merke og kan aldri velges
 * på nytt) og tid (forslaget sier hvorfor, så takstmannen kan godta med ett trykk).
 */

vi.mock("server-only", () => ({}));

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

describe("7. kortet «Avtale» gjengitt", () => {
  const VALID = {
    id: "0190a000-0000-7000-8000-0000000000a1",
    name: "Testavtale gyldig",
    validFrom: "2026-03-01",
    validTo: "2026-12-31",
    deletedAt: null,
  };
  const SUGGESTION = {
    agreementId: VALID.id,
    agreementName: VALID.name,
    firmName: "Testforsikring AS",
  };
  type CardAgreement = Row & { name: string };

  function render(props: {
    agreement?: CardAgreement | null;
    suggestion?: typeof SUGGESTION | null;
    canEdit?: boolean;
  }): string {
    return renderToStaticMarkup(
      createElement(AgreementCard, {
        assignmentId: "0190a000-0000-7000-8000-000000000050",
        agreement: props.agreement ?? null,
        suggestion: props.suggestion ?? null,
        agreements: [VALID, { ...EXPIRED, name: "Testavtale utløpt" }],
        today: TODAY,
        canEdit: props.canEdit ?? true,
        action: async () => initialFormState,
      }),
    );
  }

  /** Synlig tekst uten tagger, med enkle mellomrom. */
  function text(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
  }

  it("7.1 gyldig avtale: navn og periode, «Bytt» og «Fjern», ingen merke", () => {
    const visible = text(render({ agreement: VALID }));
    expect(visible).toContain("Testavtale gyldig");
    expect(visible).toMatch(/01\.03\.2026|2026-03-01/);
    expect(visible).toMatch(/31\.12\.2026|2026-12-31/);
    expect(visible).toContain("Bytt");
    expect(visible).toContain("Fjern");
    expect(visible).not.toContain("Utløpt");
    expect(visible).not.toContain("Slettet");
  });

  it("7.2–7.3 merket «Utløpt» og «Slettet» står på kortet", () => {
    expect(text(render({ agreement: { ...EXPIRED, name: "Testavtale utløpt" } }))).toContain(
      "Utløpt",
    );
    expect(text(render({ agreement: { ...DELETED, name: "Testavtale slettet" } }))).toContain(
      "Slettet",
    );
  });

  it("7.4 forslag: teksten og «Bruk avtalen»", () => {
    const visible = text(render({ suggestion: SUGGESTION }));
    expect(visible).toContain("Forslag: Testavtale gyldig (bestilleren er fra Testforsikring AS)");
    expect(visible).toContain("Bruk avtalen");
  });

  it("7.5–7.6 uten avtale og forslag: velgeren med «Ingen avtale» og bare gyldige avtaler", () => {
    const html = render({});
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]!.trim());
    expect(options).toEqual(["Ingen avtale", "Testavtale gyldig"]);
    expect(text(html)).not.toContain("Bruk avtalen");
  });

  it("7.7 uten rett til å endre: ingen «Bytt», «Fjern», «Bruk avtalen» eller velger", () => {
    for (const html of [
      render({ agreement: VALID, canEdit: false }),
      render({ suggestion: SUGGESTION, canEdit: false }),
    ]) {
      const visible = text(html);
      expect(visible).not.toMatch(/\bBytt\b/);
      expect(visible).not.toMatch(/\bFjern\b/);
      expect(visible).not.toContain("Bruk avtalen");
      expect(html).not.toContain("<select");
    }
    expect(text(render({ agreement: VALID, canEdit: false }))).toContain("Testavtale gyldig");
  });
});
