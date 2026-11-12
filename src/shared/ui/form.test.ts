import { createElement } from "react";

// Komponentene uten tilstand kalles direkte, slik at barna kan sendes med typene i behold.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Checkbox, ChoiceGroup, Field, Input, Radio, Select, Textarea } from "./form";
import { Notice } from "./notice";

function field(props: { hint?: string; error?: string }) {
  return renderToStaticMarkup(
    Field({
      label: "Navn",
      htmlFor: "name",
      ...props,
      children: createElement(Input, { id: "name", name: "name" }),
    }),
  );
}

describe("Field", () => {
  it("uten hjelpetekst og feil: ingen aria-describedby eller aria-invalid", () => {
    const html = field({});
    expect(html).toContain('<label for="name"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid=");
  });

  it("knytter hjelpeteksten til feltet", () => {
    const html = field({ hint: "9 siffer" });
    expect(html).toContain('aria-describedby="name-hint"');
    expect(html).toContain('id="name-hint"');
    expect(html).not.toContain("aria-invalid=");
  });

  it("knytter feilen til feltet og merker det ugyldig", () => {
    const html = field({ hint: "9 siffer", error: "Skriv inn navnet." });
    expect(html).toContain('aria-describedby="name-hint name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="name-error"');
    expect(html).toContain("Feil: </span>Skriv inn navnet.");
  });
});

describe("Input og Textarea", () => {
  it("får rød kant bare ved aria-invalid", () => {
    const html = renderToStaticMarkup(createElement(Input, {}));
    expect(html).toContain("aria-invalid:border-urgent-line");
    expect(html).toContain("min-h-11");
  });

  it("Textarea har samme stil som Input og kan gjøres høyere", () => {
    const html = renderToStaticMarkup(createElement(Textarea, { rows: 6 }));
    expect(html).toContain("<textarea");
    expect(html).toContain("border-field");
    expect(html).toContain("resize-y");
  });
});

/*
 * Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 3, form.test.ts):
 * felt med 8 px hjørner (`rounded-lg`) og kanten fra temaet (`border-field`, minst 3:1, sjekket i
 * contrast.test.ts). Ingen krav over er svekket.
 */
describe("feltene i Byggcon-profilen", () => {
  const fields = [
    ["Input", () => renderToStaticMarkup(createElement(Input, {}))],
    ["Textarea", () => renderToStaticMarkup(createElement(Textarea, {}))],
    ["Select", () => renderToStaticMarkup(createElement(Select, {}))],
  ] as const;

  function classes(html: string): string[] {
    return (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
  }

  it.each(fields)("%s har rounded-lg (8 px), border og border-field", (_name, html) => {
    const list = classes(html());
    expect(list).toContain("rounded-lg");
    expect(list).not.toContain("rounded-xl");
    expect(list).toContain("border");
    expect(list).toContain("border-field");
  });

  it.each(fields)("%s er minst 44 px høyt og får urgent-kant ved feil", (_name, html) => {
    const list = classes(html());
    expect(list.some((name) => /^min-h-(11|14|20|32)$/.test(name))).toBe(true);
    expect(list).toContain("aria-invalid:border-urgent-line");
  });

  it("feilen ved feltet bruker urgent-text", () => {
    const html = field({ error: "Skriv inn navnet." });
    expect(html).toMatch(/<p id="name-error" class="[^"]*text-urgent-text/);
  });
});

describe("Checkbox, Radio og ChoiceGroup", () => {
  it("hele raden er etiketten (trykkflate minst 44 px)", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { name: "roles", value: "inspector", label: "Takstmann" }),
    );
    expect(html).toMatch(/^<label class="[^"]*min-h-11/);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Takstmann");
  });

  it("Radio er en radioknapp", () => {
    const html = renderToStaticMarkup(createElement(Radio, { name: "officeId", label: "Bodø" }));
    expect(html).toContain('type="radio"');
  });

  it("gruppen er fieldset med legend, og feilen er knyttet til gruppen", () => {
    const html = renderToStaticMarkup(
      ChoiceGroup({
        id: "roles",
        legend: "Roller",
        error: "Velg en rolle.",
        children: createElement(Checkbox, { name: "roles", label: "Admin" }),
      }),
    );
    expect(html).toMatch(/^<fieldset aria-describedby="roles-error" aria-invalid="true"/);
    expect(html).toContain("<legend");
    expect(html).toContain("Roller</legend>");
    expect(html).toContain('id="roles-error"');
  });
});

describe("Badge og Notice", () => {
  it("merket bærer teksten, ikke bare fargen", () => {
    const html = renderToStaticMarkup(Badge({ tone: "warning", children: "Forsikring utløpt" }));
    expect(html).toContain("Forsikring utløpt");
    expect(html).toContain("bg-watch-fill text-watch-text");
  });

  it("kvitteringen leses opp som status", () => {
    const html = renderToStaticMarkup(createElement(Notice, { message: "Rollene er lagret." }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Rollene er lagret.");
  });
});
