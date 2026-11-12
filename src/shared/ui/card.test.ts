import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

/*
 * Kortet i Byggcon-profilen (docs/funksjoner/fase2a-byggcon-profil-testplan.md avsnitt 3,
 * card.test.ts; designspesifikasjonen 4.2): tynn kant, 12 px hjørner, ingen skygge. Framhevet kort
 * i sand uten kant.
 * Støtter hovedmål: de ansatte (rolig flate, samme uttrykk som byggcon.no og Optiplan).
 */

function classes(html: string): string[] {
  const value = /^<div[^>]*class="([^"]*)"/.exec(html)?.[1];
  if (value === undefined) throw new Error(`Fant ikke kortet i ${html}`);
  return value.split(/\s+/).filter(Boolean);
}

describe("Card", () => {
  it("1 vanlig kort: 1 px kant, rounded-card og ingen skygge", () => {
    const list = classes(renderToStaticMarkup(createElement(Card, null, "Innhold")));
    expect(list).toContain("border");
    expect(list).toContain("border-line");
    expect(list).toContain("rounded-card");
    expect(list).toContain("bg-white");
    expect(list.filter((name) => /(^|:)shadow/.test(name))).toEqual([]);
  });

  it("1 tone default er det samme som uten tone", () => {
    expect(renderToStaticMarkup(createElement(Card, { tone: "default" }, "x"))).toBe(
      renderToStaticMarkup(createElement(Card, null, "x")),
    );
  });

  it("2 framhevet kort: sand, uten kant og uten skygge", () => {
    const list = classes(renderToStaticMarkup(createElement(Card, { tone: "sand" }, "Innhold")));
    expect(list).toContain("bg-sand");
    expect(list).toContain("rounded-card");
    expect(list.filter((name) => /^(border|ring)(-|$)/.test(name))).toEqual([]);
    expect(list.filter((name) => /(^|:)shadow/.test(name))).toEqual([]);
    expect(list).not.toContain("bg-white");
  });

  it("teksten og egne klasser kommer med", () => {
    const html = renderToStaticMarkup(createElement(Card, { className: "p-5" }, "Innhold"));
    expect(html).toContain("Innhold");
    expect(classes(html)).toContain("p-5");
  });

  it("--radius-card er 12 px (0.75rem), og --shadow-card er borte", () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/--radius-card:\s*0\.75rem;/);
    expect(css).not.toContain("--shadow-card");
  });
});
