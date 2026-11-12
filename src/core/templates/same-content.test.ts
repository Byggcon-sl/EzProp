import { describe, expect, it } from "vitest";
import { buildTemplateDocument } from "../../../tests/template-document";
import { isSameTemplateContent, parseTemplateDocument, type TemplateDocument } from "./index";

/*
 * Den rene sammenligningen av to maldokumenter (docs/funksjoner/fase2a-mal-bad.md, Omfang 5).
 * Ingen database. Støtter hovedmål: KI i bunnen og færre reklamasjoner (seed lager ny versjon
 * bare når innholdet, også tekststatusen, faktisk er endret). Testdata er oppdiktet.
 */

type Doc = ReturnType<typeof buildTemplateDocument>;

function parsed(change: (doc: Doc) => void = () => {}): TemplateDocument {
  const doc = buildTemplateDocument();
  change(doc);
  const result = parseTemplateDocument(doc);
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.document;
}

function reversed(doc: TemplateDocument): TemplateDocument {
  return Object.fromEntries(
    Object.entries(doc).map(([list, items]) => [list, [...(items as unknown[])].reverse()]),
  ) as TemplateDocument;
}

describe("isSameTemplateContent", () => {
  it("gir true for samme dokument og for listene i annen rekkefølge", () => {
    const a = parsed();
    expect(isSameTemplateContent(a, parsed())).toBe(true);
    expect(isSameTemplateContent(a, reversed(a))).toBe(true);
  });

  it.each<[string, (doc: Doc) => void]>([
    ["endret avvikstekst", (d) => (d.outcomes[0]!.deviation_text = "Annen oppdiktet tekst.")],
    ["endret årsakstekst", (d) => (d.outcomes[0]!.default_cause_text = "Oppdiktet årsak.")],
    ["text_status på utfall", (d) => (d.outcomes[0]!.text_status = "approved")],
    ["text_status på tiltak", (d) => (d.standard_measures[0]!.text_status = "approved")],
    ["endret tiltakstekst", (d) => (d.standard_measures[0]!.text = "Oppdiktet tiltak.")],
    [
      "ett tiltak mer",
      (d) => d.standard_measures.push({ ...d.standard_measures[0]!, text: "Nytt." }),
    ],
  ])("gir false ved %s", (_, change) => {
    const a = parsed();
    const before = JSON.stringify(a);
    expect(isSameTemplateContent(a, parsed(change))).toBe(false);
    expect(JSON.stringify(a)).toBe(before);
  });
});
