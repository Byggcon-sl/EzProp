import type { CleanPageSvg, IsSafePageSvg, PdfEnginePage } from "./types";

/*
 * Rydding og sjekk av én side som SVG (tillegget til ADR 0016, punkt 15 og 16). Ren: ingen
 * klokke, ingen filer, ingen nett, ingen DOM. Rendereren (0.7.0) legger alltid ved et
 * markeringslag for tekst (`foreignObject` med teksten som HTML), lenker (`<a>` med `onclick`),
 * tomme plassholdere for de andre sidene og glyfer for hele dokumentet. Ryddingen bygger en ny SVG
 * med bare den ene siden, glyfene siden bruker, og ingen tekst. Etterpå må resultatet bestå
 * `isSafePageSvg`; vi stoler ikke på ryddingen, vi sjekker den.
 */

type SvgElement = {
  name: string;
  attrs: [name: string, value: string][];
  children: SvgNode[];
};
type SvgNode = SvgElement | string;

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
/** Attributter står alltid med doble anførselstegn hos rendereren. Verdien har aldri `<` eller `"`. */
const ATTRIBUTE = /\s+([A-Za-z_][A-Za-z0-9_.:-]*)="([^"<]*)"/y;
const SPACE = /\s*/y;

/** Treff som begynner nøyaktig på `at`, uten å kopiere resten av teksten. */
function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}
const skipSpace = (text: string, at: number) => at + (matchAt(SPACE, text, at)?.[0].length ?? 0);

/**
 * Leser SVG-en som et tre. Gir `null` for alt som ikke er enkle elementer, attributter og tekst:
 * kommentarer, `<!DOCTYPE`, `<![CDATA[`, `<?xml`, attributter uten anførselstegn, feil nesting og
 * mer enn ett rotelement.
 */
function parseSvg(svg: string): SvgElement | null {
  const root: SvgElement = { name: "#root", attrs: [], children: [] };
  const stack: SvgElement[] = [root];
  let at = 0;
  while (at < svg.length) {
    const open = svg.indexOf("<", at);
    const textEnd = open === -1 ? svg.length : open;
    if (textEnd > at) stack[stack.length - 1]!.children.push(svg.slice(at, textEnd));
    if (open === -1) break;
    at = open + 1;

    if (svg[at] === "/") {
      const name = matchAt(NAME, svg, at + 1)?.[0];
      if (!name) return null;
      at = skipSpace(svg, at + 1 + name.length);
      if (svg[at] !== ">") return null;
      at += 1;
      const current = stack.pop();
      if (!current || current.name !== name || stack.length === 0) return null;
      continue;
    }

    const name = matchAt(NAME, svg, at)?.[0];
    if (!name) return null; // `<!--`, `<!DOCTYPE`, `<?xml` og annet.
    at += name.length;
    const element: SvgElement = { name, attrs: [], children: [] };
    for (;;) {
      const attribute = matchAt(ATTRIBUTE, svg, at);
      if (!attribute) break;
      element.attrs.push([attribute[1]!, attribute[2]!]);
      at += attribute[0].length;
    }
    at = skipSpace(svg, at);
    stack[stack.length - 1]!.children.push(element);
    if (svg.startsWith("/>", at)) {
      at += 2;
    } else if (svg[at] === ">") {
      at += 1;
      stack.push(element);
    } else {
      return null;
    }
  }
  if (stack.length !== 1) return null;
  const elements = root.children.filter((child): child is SvgElement => typeof child !== "string");
  const strayText = root.children.some((child) => typeof child === "string" && child.trim());
  if (elements.length !== 1 || strayText) return null;
  return elements[0]!;
}

const attr = (element: SvgElement, name: string): string | undefined =>
  element.attrs.find(([key]) => key === name)?.[1];

function serialize(node: SvgNode): string {
  if (typeof node === "string") return node;
  const attrs = node.attrs.map(([name, value]) => ` ${name}="${value}"`).join("");
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join("")}</${node.name}>`;
}

/** Tall til SVG uten unødvendige desimaler: 595.2755737 blir «595.276». */
function svgNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

// --- Rydding -------------------------------------------------------------------------------------

/** Elementer som tas bort med alt innhold: tekstlaget, lenkene, stilark og skript. */
const DROPPED_ELEMENTS = new Set(["foreignObject", "a", "style", "script"]);
/** Attributter som aldri tas med: lenker, hendelser, stil og rendererens egne merkelapper. */
const isDroppedAttribute = (name: string) =>
  /^(?:on|data-)/i.test(name) || ["class", "style", "target", "alt"].includes(name);

const LOCAL_REFERENCE = /(?:^#|url\(#)([^)"]+)\)?/;

/** Alle id-er som brukes med `href="#…"` eller `url(#…)` i noden. */
function collectReferences(node: SvgNode, into: Set<string>): void {
  if (typeof node === "string") return;
  for (const [, value] of node.attrs) {
    const match = LOCAL_REFERENCE.exec(value);
    if (match) into.add(match[1]!);
  }
  for (const child of node.children) collectReferences(child, into);
}

/** `translate(0, 842)` gir 842. Annet gir `null`. */
function translateY(transform: string | undefined): number | null {
  const match = /^translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(transform ?? "");
  if (!match || Number(match[1]) !== 0) return null;
  return Number(match[2]);
}

/** Siden fra rendereren ligger i motorens dokument med heltall for hver side. */
const PAGE_OFFSET_TOLERANCE_PT = 1;

/**
 * Rydder én side fra motoren. Rendereren kan ta med nabosiden når vinduet er nær kanten (målt
 * med liggende sider); da beholdes bare siden som står på `offsetYPt`. Gir `null` når ingen eller
 * flere sider står der, når noe ikke kan leses, eller når resultatet ikke består
 * `isSafePageSvg`.
 */
export const cleanPageSvg: CleanPageSvg = (svg: string, page: PdfEnginePage): string | null => {
  if (typeof svg !== "string") return null;
  if (![page.widthPt, page.heightPt, page.offsetYPt].every(Number.isFinite)) return null;
  if (page.widthPt <= 0 || page.heightPt <= 0) return null;
  const root = parseSvg(svg);
  if (!root || root.name !== "svg") return null;

  const defs: SvgElement[] = [];
  const pagesWithContent: SvgElement[] = [];
  let problem = false;

  /** Kopi uten det som tas bort. Tekst utenfor tekstlaget finnes ikke; finnes den, stopper vi. */
  const copy = (node: SvgNode): SvgNode | null => {
    if (typeof node === "string") {
      if (node.trim() !== "") problem = true;
      return null;
    }
    if (DROPPED_ELEMENTS.has(node.name) || node.name.includes(":")) return null;
    return {
      name: node.name,
      attrs: node.attrs.filter(([name]) => !isDroppedAttribute(name)),
      children: node.children.map(copy).filter((child): child is SvgNode => child !== null),
    };
  };

  for (const child of root.children) {
    if (typeof child === "string") {
      if (child.trim() !== "") problem = true;
      continue;
    }
    if (child.name === "defs") {
      defs.push(child);
      continue;
    }
    if (DROPPED_ELEMENTS.has(child.name)) continue;
    const isPage =
      child.name === "g" && (attr(child, "class") ?? "").split(" ").includes("typst-page");
    if (!isPage) {
      problem = true;
      continue;
    }
    // Plassholdere for de andre sidene i dokumentet.
    if (attr(child, "data-dummy") === "1") continue;
    pagesWithContent.push(child);
  }
  if (problem) return null;
  const atOffset = pagesWithContent.filter((candidate) => {
    const offset = translateY(attr(candidate, "transform"));
    return offset !== null && Math.abs(offset - page.offsetYPt) <= PAGE_OFFSET_TOLERANCE_PT;
  });
  if (atOffset.length !== 1) return null;

  const source = atOffset[0]!;
  const content = copy({ ...source, attrs: source.attrs.filter(([name]) => name !== "transform") });
  if (problem || !content) return null;

  // Bare definisjonene siden bruker (glyfer og klipp), sortert på id, så samme side alltid gir
  // samme SVG uansett hva som står på de andre sidene.
  const definitions = new Map<string, SvgNode>();
  for (const group of defs) {
    for (const child of group.children) {
      if (typeof child === "string") {
        if (child.trim() !== "") return null;
        continue;
      }
      const id = attr(child, "id");
      if (!id) return null;
      const copied = copy(child);
      if (problem || !copied) return null;
      definitions.set(id, copied);
    }
  }
  const used = new Set<string>();
  collectReferences(content, used);
  let size = -1;
  while (used.size !== size) {
    size = used.size;
    for (const id of [...used]) {
      const definition = definitions.get(id);
      if (definition) collectReferences(definition, used);
    }
  }
  const kept = [...used]
    .filter((id) => definitions.has(id))
    .sort()
    .map((id) => definitions.get(id)!);

  const width = svgNumber(page.widthPt);
  const height = svgNumber(page.heightPt);
  const cleaned: SvgElement = {
    name: "svg",
    attrs: [
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
      ["viewBox", `0 0 ${width} ${height}`],
      ["width", width],
      ["height", height],
    ],
    children: [...(kept.length > 0 ? [{ name: "defs", attrs: [], children: kept }] : []), content],
  };
  const result = serialize(cleaned);
  return isSafePageSvg(result) ? result : null;
};

// --- Den strenge sjekken -------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "use",
  "image",
  "rect",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
]);

/** Attributter med verdier som bare er tall, farger eller faste ord (sjekket under). */
const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "x",
  "y",
  "width",
  "height",
  "d",
  "transform",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-miterlimit",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "viewBox",
  "preserveAspectRatio",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "gradientUnits",
  "gradientTransform",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "fx",
  "fy",
  "offset",
  "stop-color",
  "stop-opacity",
  "spreadMethod",
]);

const ROOT_NAMESPACES: Readonly<Record<string, string>> = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
};

const INTERNAL_HREF = /^#[A-Za-z0-9_.:+/=-]+$/;
const EMBEDDED_IMAGE_HREF = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Verdier: tall, farger, ord og `url(#id)`. Aldri `&`, `<`, `>`, `"`, `'`, `\` eller `:` ellers. */
const PLAIN_VALUE = /^[A-Za-z0-9 #%.,()+\-_/=]*$/;
const URL_FUNCTION = /url\(/g;
const LOCAL_URL = /url\(#[A-Za-z0-9_.+/=-]+\)/g;

function isSafeAttribute(element: SvgElement, name: string, value: string, isRoot: boolean) {
  if (name === "xmlns" || name === "xmlns:xlink") return isRoot && ROOT_NAMESPACES[name] === value;
  if (name === "href" || name === "xlink:href") {
    if (INTERNAL_HREF.test(value)) return element.name === "use" || element.name === "image";
    return element.name === "image" && EMBEDDED_IMAGE_HREF.test(value);
  }
  if (!ALLOWED_ATTRIBUTES.has(name)) return false;
  if (!PLAIN_VALUE.test(value)) return false;
  // Bare `url(#…)` inn i samme SVG.
  const urls = value.match(URL_FUNCTION)?.length ?? 0;
  const local = value.match(LOCAL_URL)?.length ?? 0;
  return urls === local;
}

/**
 * Sann bare når SVG-en har kjente elementer og attributter, ingen tekst, ingen `<script>`,
 * `<style>`, `on*`, `foreignObject` eller `<a>`, og hver `href` enten peker inn i samme SVG
 * (`#…`) eller er et innebygd JPEG- eller PNG-bilde.
 */
export const isSafePageSvg: IsSafePageSvg = (svg: string): boolean => {
  if (typeof svg !== "string" || svg.length === 0) return false;
  const root = parseSvg(svg);
  if (!root || root.name !== "svg") return false;
  if (attr(root, "xmlns") !== ROOT_NAMESPACES.xmlns) return false;

  const check = (node: SvgNode, isRoot: boolean): boolean => {
    if (typeof node === "string") return node.trim() === "";
    if (!ALLOWED_ELEMENTS.has(node.name)) return false;
    if (node.name === "svg" && !isRoot) return false;
    const seen = new Set<string>();
    for (const [name, value] of node.attrs) {
      if (seen.has(name)) return false;
      seen.add(name);
      if (!isSafeAttribute(node, name, value, isRoot)) return false;
    }
    return node.children.every((child) => check(child, false));
  };
  return check(root, true);
};
