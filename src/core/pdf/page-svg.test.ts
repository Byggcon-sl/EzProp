import { describe, expect, it } from "vitest";
import { cleanPageSvg, isSafePageSvg } from "./page-svg";
import type { PdfEnginePage } from "./types";

/*
 * Rydding og sjekk av én side (tillegget til ADR 0016, punkt 16; testplanen LF1.6–LF1.7). Ren,
 * med små SVG-er i samme form som rendereren 0.7.0 skriver. Støtter hovedmål: færre
 * reklamasjoner og de ansatte (ingenting i siden kan kjøre eller hente noe).
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Et dokument med tre sider i rendererens form; side 2 har innhold. */
function rendered(content: string, extra = ""): string {
  return (
    `<svg style="overflow: visible;" class="typst-doc" viewBox="0 0 596.000 2526.000" width="596.000" height="2526.000" data-width="596.000" data-height="2526.000" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h5="http://www.w3.org/1999/xhtml">` +
    `<defs class="glyph"><path id="gB" class="outline_glyph" d="M 1 0 L 2 2 Z "/><path id="gA" class="outline_glyph" d="M 0 0 L 1 1 Z "/><path id="gUnused" class="outline_glyph" d="M 9 9 Z "/></defs>` +
    `<defs class="clip-path"></defs><style type="text/css"></style>` +
    `<g class="typst-page" transform="translate(0, 0)" data-tid="pAQ" data-page-width="596" data-page-height="842" data-dummy="1"></g>` +
    `<g class="typst-page" transform="translate(0, 842)" data-tid="pX" data-page-width="596" data-page-height="842"><g data-tid="gX" class="typst-group">${content}</g></g>` +
    `<g class="typst-page" transform="translate(0, 1684)" data-tid="pAQ" data-page-width="596" data-page-height="842" data-dummy="1"></g>` +
    extra +
    `</svg>`
  );
}

const TEXT =
  `<g class="typst-text" transform="scale(0.05,-0.05)"><use x="0" y="0" href="#gA"/><use x="10" y="0" href="#gB"/>` +
  `<g transform="scale(16,-16)"><foreignObject x="0" y="-125.00" width="50" height="128.00"><h5:div class="tsel" style="font-size: 128px">&lt;script&gt;alert(1)&lt;/script&gt; Prøvevegen 1</h5:div></foreignObject></g></g>`;
const LINK = `<g><a xlink:href="#" onclick="handleTypstLocation(this, 3, 51.02362, 51.02362); return false"><rect class="pseudo-link" width="493.2" height="10"></rect></a></g>`;
const EXTERNAL_LINK = `<g><a xlink:href="https://app.example.invalid/oppdrag/x#punkt-y" target="_blank"><rect class="pseudo-link" width="10" height="10"></rect></a></g>`;
const IMAGE = `<image class="typst-image" width="97.05" height="39.68" preserveAspectRatio="none" xlink:href="${PNG}" alt="Logo"/>`;
const SHAPE = `<path class="typst-shape" d="M 0 0 L 0 841.8898 L 595.2756 841.8898 Z " fill-rule="nonzero" fill="#fff" />`;

const PAGE: PdfEnginePage = {
  svg: "",
  widthPt: 595.2755737,
  heightPt: 841.8897705,
  offsetYPt: 842,
};

describe("cleanPageSvg", () => {
  const svg = rendered(SHAPE + TEXT + LINK + EXTERNAL_LINK + IMAGE);
  const cleaned = cleanPageSvg(svg, PAGE)!;

  it("gir en sikker SVG med sidens mål", () => {
    expect(cleaned).not.toBeNull();
    expect(isSafePageSvg(cleaned)).toBe(true);
    expect(cleaned.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(cleaned).toContain('viewBox="0 0 595.276 841.89" width="595.276" height="841.89"');
  });

  it("tar bort tekstlaget, lenkene, stil, klasser og rendererens merkelapper", () => {
    expect(cleaned).not.toMatch(
      /foreignObject|h5:|<a[\s>]|onclick|<style|class=|data-|target=|alt=/,
    );
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("Prøvevegen");
    expect(cleaned).not.toContain("app.example.invalid");
    expect(cleaned.replace(/<[^>]*>/g, "").trim()).toBe("");
  });

  it("beholder bare siden selv, uten plassholdere og uten flytting", () => {
    expect(cleaned).not.toContain("translate(0, 842)");
    expect(cleaned.match(/<g/g)?.length).toBe(6);
    expect(cleaned).toContain(PNG);
  });

  it("tar med bare glyfene siden bruker, sortert på id", () => {
    expect(cleaned).toMatch(/<defs><path id="gA"[^>]*\/><path id="gB"[^>]*\/><\/defs>/);
    expect(cleaned).not.toContain("gUnused");
  });

  it("samme side gir samme SVG uansett rekkefølgen på glyfene i dokumentet", () => {
    const reordered = svg.replace(
      /<path id="gB"[^>]*\/><path id="gA"[^>]*\/>/,
      '<path id="gA" class="outline_glyph" d="M 0 0 L 1 1 Z "/><path id="gB" class="outline_glyph" d="M 1 0 L 2 2 Z "/>',
    );
    expect(reordered).not.toBe(svg);
    expect(cleanPageSvg(reordered, PAGE)).toBe(cleaned);
  });

  it("velger siden på riktig plass når rendereren tar med nabosiden", () => {
    const withNeighbour = svg.replace(
      '<g class="typst-page" transform="translate(0, 1684)" data-tid="pAQ" data-page-width="596" data-page-height="842" data-dummy="1"></g>',
      `<g class="typst-page" transform="translate(0, 1684)" data-page-width="596" data-page-height="842"><g>${SHAPE.replace("#fff", "#000")}</g></g>`,
    );
    expect(cleanPageSvg(withNeighbour, PAGE)).toBe(cleaned);
  });

  it.each<[string, string, PdfEnginePage]>([
    ["ingen side på plassen", svg, { ...PAGE, offsetYPt: 0 }],
    ["side på feil plass", svg, { ...PAGE, offsetYPt: 1684 }],
    ["mål som ikke er tall", svg, { ...PAGE, widthPt: Number.NaN }],
    ["null i høyde", svg, { ...PAGE, heightPt: 0 }],
    ["kommentar", svg.replace("<defs", "<!-- x --><defs"), PAGE],
    ["CDATA", svg.replace("<defs", "<![CDATA[x]]><defs"), PAGE],
    ["doctype", `<!DOCTYPE svg>${svg}`, PAGE],
    ["xml-hode", `<?xml version="1.0"?>${svg}`, PAGE],
    ["feil nesting", svg.replace("</g></g>", "</g></defs>"), PAGE],
    ["avkortet", svg.slice(0, -10), PAGE],
    ["attributt uten anførselstegn", svg.replace('fill="#fff"', "fill=#fff"), PAGE],
    ["tekst utenfor tekstlaget", rendered(`${SHAPE}Prøvevegen 1`), PAGE],
    ["ukjent element på toppen", svg.replace("<style", '<g id="x"></g><style'), PAGE],
    ["to rotelementer", `${svg}<svg></svg>`, PAGE],
    ["ikke SVG", "<html><body></body></html>", PAGE],
  ])("gir null: %s", (_name, input, page) => {
    expect(cleanPageSvg(input, page)).toBeNull();
  });

  it("gir null når resultatet ikke består sjekken (ukjent element eller ekstern adresse)", () => {
    expect(cleanPageSvg(rendered(`<iframe src="x"></iframe>`), PAGE)).toBeNull();
    expect(
      cleanPageSvg(rendered(`<use href="https://example.invalid/x.svg#a"/>`), PAGE),
    ).toBeNull();
    expect(
      cleanPageSvg(rendered(`<image xlink:href="data:image/svg+xml;base64,PHN2Zz4="/>`), PAGE),
    ).toBeNull();
    expect(cleanPageSvg(rendered(`<path d="M 0 0" fill="url(https://x)"/>`), PAGE)).toBeNull();
    expect(cleanPageSvg(rendered(`<script>alert(1)</script>`), PAGE)).not.toContain("script");
  });
});

describe("isSafePageSvg", () => {
  const base = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" width="10" height="10">${inner}</svg>`;

  it("godtar kjente elementer, interne referanser og innebygde PNG og JPEG", () => {
    expect(isSafePageSvg(base(""))).toBe(true);
    expect(
      isSafePageSvg(
        base(
          `<defs><path id="gA" d="M 0 0 Z"/><clipPath id="c1"><rect width="1" height="1"/></clipPath></defs>` +
            `<g transform="translate(1,2)" clip-path="url(#c1)"><use x="0" y="0" href="#gA"/>` +
            `<image width="1" height="1" xlink:href="${PNG}"/><image width="1" height="1" href="data:image/jpeg;base64,/9j/4A=="/>` +
            `<path d="M 0 0 L 1 1" stroke="#000" stroke-width="2" stroke-dasharray="3 2" fill="none"/></g>`,
        ),
      ),
    ).toBe(true);
  });

  it.each([
    ["script", `<script>alert(1)</script>`],
    ["style med innhold", `<style>@import url(http://x)</style>`],
    ["tom style", `<style></style>`],
    ["foreignObject", `<foreignObject><div/></foreignObject>`],
    ["lenke", `<a href="#x"><rect width="1" height="1"/></a>`],
    ["on-attributt", `<rect onload="alert(1)" width="1" height="1"/>`],
    ["onclick med store bokstaver", `<rect ONCLICK="x" width="1" height="1"/>`],
    ["ekstern href", `<use href="https://example.invalid/x.svg#a"/>`],
    ["javascript-href", `<use href="javascript:alert(1)"/>`],
    ["svg som bilde", `<image href="data:image/svg+xml;base64,PHN2Zz4="/>`],
    ["html som bilde", `<image href="data:text/html;base64,PGI+"/>`],
    ["href på path", `<path href="#a" d="M 0 0"/>`],
    ["ekstern url", `<rect fill="url(http://example.invalid/x)" width="1" height="1"/>`],
    ["url uten #", `<rect fill="url(x)" width="1" height="1"/>`],
    ["entitet", `<rect fill="&#106;avascript" width="1" height="1"/>`],
    ["style-attributt", `<rect style="fill:red" width="1" height="1"/>`],
    ["class-attributt", `<rect class="x" width="1" height="1"/>`],
    ["ukjent element", `<text>Prøvevegen 1</text>`],
    ["tekst", `Prøvevegen 1`],
    ["svg inni svg", `<svg></svg>`],
    ["animasjon", `<animate attributeName="href" to="javascript:alert(1)"/>`],
    ["set", `<set attributeName="onclick" to="alert(1)"/>`],
    ["dobbel attributt", `<rect width="1" width="2"/>`],
    ["kolon i verdi", `<rect fill="a:b" width="1" height="1"/>`],
  ])("avviser %s", (_name, inner) => {
    expect(isSafePageSvg(base(inner))).toBe(false);
  });

  it("avviser feil rot, manglende navnerom, tomme og ødelagte dokumenter", () => {
    expect(isSafePageSvg("")).toBe(false);
    expect(isSafePageSvg("<g></g>")).toBe(false);
    expect(isSafePageSvg('<svg viewBox="0 0 1 1"></svg>')).toBe(false);
    expect(isSafePageSvg('<svg xmlns="http://example.invalid/"></svg>')).toBe(false);
    expect(isSafePageSvg(base("<g>"))).toBe(false);
    expect(isSafePageSvg(`${base("")}<svg/>`)).toBe(false);
    expect(isSafePageSvg(`<!-- x -->${base("")}`)).toBe(false);
    expect(isSafePageSvg(null as unknown as string)).toBe(false);
  });
});
