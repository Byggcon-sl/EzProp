import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialFormState } from "../../form-state";
import { AgreementCard } from "./agreement-card";

/*
 * Kortet «Avtale» på oppdragssiden, gjengitt til HTML uten nettleser.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 7.
 *
 * Filen heter `.test.ts` (ikke `.tsx`) fordi Vitest bare tar med `*.test.ts`; derfor
 * `createElement` i stedet for JSX. Fast dag: 2026-11-03. Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (utløpt og slettet avtale vises med merke og kan ikke velges
 * på nytt) og tid (forslaget står med «Bruk avtalen», ett trykk).
 */

vi.mock("server-only", () => ({}));

const TODAY = "2026-11-03";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";

type CardAgreement = {
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  deletedAt: Date | string | null;
};

const VALID: CardAgreement = {
  id: "0190a000-0000-7000-8000-0000000000a1",
  name: "Testavtale gyldig",
  validFrom: "2026-03-01",
  validTo: "2026-12-31",
  deletedAt: null,
};
const EXPIRED: CardAgreement = {
  id: "0190a000-0000-7000-8000-0000000000a2",
  name: "Testavtale utløpt",
  validFrom: "2025-01-01",
  validTo: "2026-11-02",
  deletedAt: null,
};
const DELETED: CardAgreement = {
  id: "0190a000-0000-7000-8000-0000000000a3",
  name: "Testavtale slettet",
  validFrom: "2026-01-01",
  validTo: null,
  deletedAt: new Date("2026-11-01T08:00:00Z"),
};
const NOT_STARTED: CardAgreement = {
  id: "0190a000-0000-7000-8000-0000000000a4",
  name: "Testavtale framtidig",
  validFrom: "2026-11-04",
  validTo: null,
  deletedAt: null,
};

const SUGGESTION = {
  agreementId: VALID.id,
  agreementName: "Testavtale gyldig",
  firmName: "Testforsikring AS",
};

function render(props: {
  agreement?: CardAgreement | null;
  suggestion?: typeof SUGGESTION | null;
  agreements?: CardAgreement[];
  canEdit?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(AgreementCard, {
      assignmentId: ASSIGNMENT,
      agreement: props.agreement ?? null,
      suggestion: props.suggestion ?? null,
      agreements: props.agreements ?? [VALID, EXPIRED, DELETED, NOT_STARTED],
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

/** Navnene i velgeren (option-tekstene). */
function options(html: string): string[] {
  return [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]!.trim());
}

describe("7. kortet «Avtale»", () => {
  it("7.1 avtale satt og gyldig: navn og periode, «Bytt» og «Fjern», ingen merke", () => {
    const html = render({ agreement: VALID });
    const visible = text(html);
    expect(visible).toContain("Testavtale gyldig");
    expect(visible).toMatch(/01\.03\.2026|2026-03-01/);
    expect(visible).toMatch(/31\.12\.2026|2026-12-31/);
    expect(visible).toContain("Bytt");
    expect(visible).toContain("Fjern");
    expect(visible).not.toContain("Utløpt");
    expect(visible).not.toContain("Slettet");
  });

  it("7.2 utløpt avtale: merket «Utløpt»", () => {
    expect(text(render({ agreement: EXPIRED }))).toContain("Utløpt");
  });

  it("7.3 slettet avtale: merket «Slettet»", () => {
    expect(text(render({ agreement: DELETED }))).toContain("Slettet");
  });

  it("7.4 ingen avtale, forslag finnes: «Forslag: <navn> (bestilleren er fra <firma>)» og «Bruk avtalen»", () => {
    const visible = text(render({ agreement: null, suggestion: SUGGESTION }));
    expect(visible).toContain(
      "Forslag: Testavtale gyldig (bestilleren er fra Testforsikring AS)",
    );
    expect(visible).toContain("Bruk avtalen");
  });

  it("7.5 ingen avtale, ingen forslag: velgeren med «Ingen avtale»", () => {
    const html = render({ agreement: null, suggestion: null });
    expect(html).toContain("<select");
    expect(options(html)).toContain("Ingen avtale");
    expect(text(html)).not.toContain("Bruk avtalen");
  });

  it("7.6 velgeren viser bare gyldige avtaler", () => {
    const html = render({ agreement: null, suggestion: null });
    const names = options(html);
    expect(names).toContain("Testavtale gyldig");
    expect(names).not.toContain("Testavtale utløpt");
    expect(names).not.toContain("Testavtale slettet");
    expect(names).not.toContain("Testavtale framtidig");
  });

  it("7.7 uten rett til å endre: ingen «Bytt», «Fjern», «Bruk avtalen» eller velger", () => {
    for (const html of [
      render({ agreement: VALID, canEdit: false }),
      render({ agreement: null, suggestion: SUGGESTION, canEdit: false }),
    ]) {
      const visible = text(html);
      expect(visible).not.toMatch(/\bBytt\b/);
      expect(visible).not.toMatch(/\bFjern\b/);
      expect(visible).not.toContain("Bruk avtalen");
      expect(html).not.toContain("<select");
    }
    // Avtalen vises likevel
    expect(text(render({ agreement: VALID, canEdit: false }))).toContain("Testavtale gyldig");
  });
});
