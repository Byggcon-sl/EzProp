import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONVERTED_COPY_TEXT, OfferEditSection, VALID_UNTIL_LOCKED_TEXT } from "./offer-edit-form";

/*
 * «Endre tilbudet» (docs/funksjoner/fase2a-tilbud-testplan.md 4.1.4 og 4.3.2, design 5.6).
 * T-0075: teksten for et tilbud som er gjort om, sier det som faktisk skjer (ADR 0011: tilbud og
 * oppdrag har hver sin kopi; oppdraget eier sine bestillingsopplysninger). T-0089: kvitteringen
 * kommer fra svaret på handlingen, aldri fra adressen. Oppdiktede data.
 * Støtter hovedmål: færre reklamasjoner (ingen tror at en rettelse her flytter oppdraget).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), redirect: vi.fn() }));

const SOURCE = readFileSync(path.join(__dirname, "offer-edit-form.tsx"), "utf8");

describe("T-0075 teksten for et tilbud som er gjort om", () => {
  it("er låst", () => {
    expect(CONVERTED_COPY_TEXT).toBe(
      "Tilbudet og oppdraget har hver sin kopi av opplysningene. Endringer her endrer ikke oppdraget. Rett adresse, matrikkel og bestiller på oppdraget, under Bestilling.",
    );
  });

  it("den gamle teksten om at endringer «flytter» oppdraget er borte", () => {
    expect(SOURCE).not.toContain("flytter ikke oppdraget");
    expect(SOURCE).not.toContain("Rettelser for oppdraget gjøres på oppdraget.");
  });

  it("låst dato har egen tekst", () => {
    expect(VALID_UNTIL_LOCKED_TEXT).toBe("Gyldig til kan bare endres på åpne og utløpte tilbud.");
  });
});

describe("T-0089 kvitteringen i «Endre tilbudet»", () => {
  it("lukket skjema viser «Endre tilbudet» og ingen kvittering før noe er lagret", () => {
    const html = renderToStaticMarkup(
      createElement(
        OfferEditSection,
        {
          orderId: "0190a000-0000-7000-8000-000000000040",
          rowVersion: 3,
          converted: false,
          validUntil: null,
          action: vi.fn(),
          defaults: {
            addressText: "Testveien 12, 8000 Bodø",
            receivedAt: "2026-11-02T09:00",
            externalRef: "",
            orderedByText: "",
            orderedByContact: null,
            gnr: "",
            bnr: "",
            snr: "",
            housingAssociationName: "",
            sellerDeclarationReceived: false,
          },
        },
        createElement("p", null, "Detaljkortet"),
      ),
    );
    expect(html).toContain("Endre tilbudet");
    expect(html).toContain("Detaljkortet");
    expect(html).not.toContain("Endringene er lagret.");
  });

  it("kvitteringen leses ikke fra adressen (ingen searchParams, ingen ?endret=1)", () => {
    expect(SOURCE).not.toMatch(/searchParams|useSearchParams|endret=1|lagret=1/);
  });
});
