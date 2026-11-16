import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_REASONS,
  duplicateReasonLabel,
  orderStatusLabel,
  type PossibleDuplicateOrder,
} from "@/core/orders";
import { PossibleDuplicatesNotice } from "./possible-duplicates-notice";

/*
 * Varselet «Mulig dublett» som komponent (T3). Testplan:
 * docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 5, skrevet av testskriveren mot kortet
 * (tekstene står her, ikke importert fra komponenten, så en endret tekst gjør testen rød).
 * Oppdiktede adresser og ordre.
 *
 * Støtter hovedmål: de ansatte (tydelig varsel med lenke, lest opp av skjermleser, ikke bare farge)
 * og færre reklamasjoner (samme bolig blir ikke bestilt eller tatt to ganger).
 */

const TEXT =
  "Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.";
const MORE = "Viser de 10 nyeste.";
const ID_1 = "0190a000-0000-7000-8000-000000000101";
const ID_2 = "0190a000-0000-7000-8000-000000000102";

function item(overrides: Partial<PossibleDuplicateOrder> = {}): PossibleDuplicateOrder {
  return {
    kind: "order",
    id: ID_1,
    receivedAt: new Date("2026-11-11T23:30:00Z"),
    addressText: "Storgata 1A, 8006 Bodø",
    status: "received",
    assignmentNumber: null,
    assignmentStatus: null,
    reasons: ["address"],
    ...overrides,
  };
}

function render(items: PossibleDuplicateOrder[], hasMore = false): string {
  return renderToStaticMarkup(createElement(PossibleDuplicatesNotice, { items, hasMore }));
}

/** Synlig tekst uten tagger og uten innhold som er skjult for skjermleser. */
function visibleText(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;| /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lenkene i HTML-en: [href, tekst]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => [
    match[1]!,
    visibleText(match[2]!),
  ]);
}

describe("5 varselet «Mulig dublett»", () => {
  it("5.1 ingen treff viser ingenting", () => {
    expect(render([])).toBe("");
    expect(render([], true)).toBe("");
  });

  it("5.2 ett treff: h2 «Mulig dublett», teksten, role=status, ikon med aria-hidden og tekst", () => {
    const html = render([item()]);
    expect(html).toMatch(/role="status"/);
    expect(html).toMatch(/<h2\b[^>]*>\s*Mulig dublett\s*<\/h2>/);
    expect(visibleText(html)).toContain(TEXT);
    // Ikonet er pynt (aria-hidden), og teksten bærer meningen (ikke bare farge)
    const icons = [...html.matchAll(/<svg\b[^>]*>/g)].map((match) => match[0]);
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon).toMatch(/aria-hidden="true"/);
    // Bare én h2 i varselet
    expect(html.match(/<h2\b/g)).toHaveLength(1);
  });

  it("5.3 treff-linjen: adresse, «mottatt» i Oslo-tid, statusord og grunn", () => {
    const [[, line]] = links(render([item()])) as [[string, string]];
    expect(line).toContain("Storgata 1A, 8006 Bodø");
    // 23:30Z 11.11 er 00:30 12.11 i Oslo
    expect(line).toContain("mottatt 12.11.2026");
    expect(line).not.toContain("11.11.2026");
    expect(line).toContain(orderStatusLabel("received"));
    expect(line).toContain("samme adresse");
    expect(line).not.toContain("samme matrikkel");
  });

  it("5.3 Oslo-tid også om sommeren (22:30Z 30.06 er 01.07 i Oslo)", () => {
    const [[, line]] = links(render([item({ receivedAt: new Date("2026-06-30T22:30:00Z") })])) as [
      [string, string],
    ];
    expect(line).toContain("mottatt 01.07.2026");
  });

  it("5.3 gjort om: statusordet og oppdragsnummeret står i linjen", () => {
    const [[, line]] = links(
      render([
        item({
          status: "converted",
          assignmentNumber: "2026-00042",
          assignmentStatus: "in_progress",
          reasons: ["cadastre"],
        }),
      ]),
    ) as [[string, string]];
    expect(line).toContain(orderStatusLabel("converted"));
    expect(line).toContain("2026-00042");
    expect(line).toContain("samme matrikkel");
    expect(line).not.toContain("samme adresse");
  });

  it("5.3 begge grunner står i linjen", () => {
    const [[, line]] = links(render([item({ reasons: ["address", "cadastre"] })])) as [
      [string, string],
    ];
    expect(line).toContain("samme adresse");
    expect(line).toContain("samme matrikkel");
  });

  it("5.3 ikke gjort om: ikke noe oppdragsnummer", () => {
    const [[, line]] = links(render([item()])) as [[string, string]];
    expect(line).not.toMatch(/\d{4}-\d{5}/);
  });

  it("5.4 lenken går til /ordre/<id> for den andre ordren, én lenke per treff", () => {
    const html = render([item(), item({ id: ID_2, addressText: "storgata 1 a" })]);
    expect(links(html).map(([href]) => href)).toEqual([`/ordre/${ID_1}`, `/ordre/${ID_2}`]);
  });

  it("5.5 hasMore viser «Viser de 10 nyeste.», ellers ikke", () => {
    expect(visibleText(render([item()], true))).toContain(MORE);
    expect(visibleText(render([item()], false))).not.toContain(MORE);
  });

  it("5.6 alle koder i DUPLICATE_REASONS har tekst, og teksten står i linjen", () => {
    for (const reason of DUPLICATE_REASONS) {
      const label = duplicateReasonLabel(reason);
      expect(label, reason).not.toBe(reason);
      expect(label.trim().length, reason).toBeGreaterThan(0);
      const [[, line]] = links(render([item({ reasons: [reason] })])) as [[string, string]];
      expect(line, reason).toContain(label);
    }
    expect(duplicateReasonLabel("address")).toBe("samme adresse");
    expect(duplicateReasonLabel("cadastre")).toBe("samme matrikkel");
  });
});
