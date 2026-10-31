import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Checkbox, ChoiceGroup, Field, Input, Radio, Textarea } from "./form";
import { Notice } from "./notice";

function field(props: { hint?: string; error?: string }) {
  return renderToStaticMarkup(
    createElement(
      Field,
      { label: "Navn", htmlFor: "name", ...props },
      createElement(Input, { id: "name", name: "name" }),
    ),
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
    expect(html).toContain("aria-invalid:border-red-700");
    expect(html).toContain("min-h-11");
  });

  it("Textarea har samme stil som Input og kan gjøres høyere", () => {
    const html = renderToStaticMarkup(createElement(Textarea, { rows: 6 }));
    expect(html).toContain("<textarea");
    expect(html).toContain("border-field");
    expect(html).toContain("resize-y");
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
      createElement(
        ChoiceGroup,
        { id: "roles", legend: "Roller", error: "Velg en rolle." },
        createElement(Checkbox, { name: "roles", label: "Admin" }),
      ),
    );
    expect(html).toMatch(/^<fieldset aria-describedby="roles-error" aria-invalid="true"/);
    expect(html).toContain("<legend");
    expect(html).toContain("Roller</legend>");
    expect(html).toContain('id="roles-error"');
  });
});

describe("Badge og Notice", () => {
  it("merket bærer teksten, ikke bare fargen", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { tone: "warning" }, "Forsikring utløpt"),
    );
    expect(html).toContain("Forsikring utløpt");
    expect(html).toContain("bg-amber-50 text-amber-900");
  });

  it("kvitteringen leses opp som status", () => {
    const html = renderToStaticMarkup(createElement(Notice, { message: "Rollene er lagret." }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Rollene er lagret.");
  });
});
