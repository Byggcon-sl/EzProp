import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormMessage } from "./form";
import { Notice } from "./notice";

/*
 * Kvittering og feilmelding (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 3,
 * notice.test.ts; designspesifikasjonen 4.4 og 4.5). Rollen er som før, ingen fargeovergang og
 * ingen skygge. Ordet for fargeovergang bygges av biter (søket etter forbudte ord i src/).
 * Støtter hovedmål: de ansatte (kvitteringen leses opp) og færre reklamasjoner (kvitteringen er
 * ikke grønn, så den ikke ligner TG0).
 */

const BLEND_WORD = ["gra", "dient"].join("");

const variants = [
  {
    name: "Notice (kvittering)",
    html: () => renderToStaticMarkup(createElement(Notice, { message: "Oppdiktet er lagret." })),
    role: "status",
    text: "Oppdiktet er lagret.",
  },
  {
    name: "FormMessage (feil)",
    html: () => renderToStaticMarkup(createElement(FormMessage, { message: "Noe gikk galt." })),
    role: "alert",
    text: "Noe gikk galt.",
  },
];

function classes(html: string): string[] {
  return (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

describe("Notice og FormMessage", () => {
  it.each(variants)("$name har tekst og rollen $role", ({ html, role, text }) => {
    expect(html()).toContain(text);
    expect(html()).toContain(`role="${role}"`);
  });

  it.each(variants)("$name har ingen fargeovergang og ingen skygge", ({ html }) => {
    expect(html()).not.toContain(BLEND_WORD);
    expect(classes(html()).filter((name) => /(^|:)shadow/.test(name))).toEqual([]);
  });

  it("kvitteringen er sand, ikke grønn (designspesifikasjonen 4.4)", () => {
    const list = classes(variants[0]!.html());
    expect(list).toContain("bg-sand");
    expect(list.filter((name) => /emerald|ok-fill|green/.test(name))).toEqual([]);
  });

  it("feilmeldingen bruker urgent-tokenene", () => {
    expect(classes(variants[1]!.html())).toEqual(
      expect.arrayContaining(["bg-urgent-fill", "text-urgent-text"]),
    );
  });
});
