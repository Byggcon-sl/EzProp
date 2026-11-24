import { inflateSync } from "node:zlib";

/*
 * Leser en PDF fra motoren for testene (testplanen, «Testhjelper tests/pdf-inspect.ts»). Ren
 * TypeScript uten ny avhengighet: objektene, sidene, teksten (via ToUnicode), lenkene, bildene,
 * vektorbanene og egenskapene. Laget for PDF-ene Typst lager (ingen objektstrømmer, ingen
 * kryptering). Ikke en generell PDF-leser.
 */

type PdfValue =
  | number
  | boolean
  | null
  | { name: string }
  | { ref: number }
  | { str: Uint8Array }
  | PdfValue[]
  | { dict: Map<string, PdfValue> };

type PdfObject = { value: PdfValue; stream: Uint8Array | null };

export type InspectedLine = { y: number; x: number; text: string; fontSize: number };

export type InspectedLink = {
  rect: [number, number, number, number];
  uri: string | null;
  dest: string | null;
  contents: string | null;
};

export type InspectedPath = {
  stroke: string | null;
  fill: string | null;
  bbox: [number, number, number, number];
  artifact: boolean;
};

export type InspectedImage = { bbox: [number, number, number, number]; bytes: Uint8Array };

export type InspectedPage = {
  width: number;
  height: number;
  text: string;
  /** Linjene ovenfra og ned. `y` er avstanden fra toppen av siden i punkter. */
  lines: InspectedLine[];
  /** Linjene som ikke er gjenstander (artifacts): uten topplinje, bunntekst og vannmerke. */
  contentLines: InspectedLine[];
  links: InspectedLink[];
  images: InspectedImage[];
  vectorPaths: InspectedPath[];
  /** Fargene som er brukt til fyll og strek, som `#rrggbb`. */
  colors: Set<string>;
};

export type InspectedPdf = {
  info: {
    title: string | null;
    author: string | null;
    producer: string | null;
    creator: string | null;
    subject: string | null;
    keywords: string | null;
    creationDate: string | null;
    modDate: string | null;
    id: string | null;
  };
  xmp: string | null;
  lang: string | null;
  tagged: boolean;
  pages: InspectedPage[];
  fonts: string[];
  /** All tekst fra alle sider, sidene skilt med linjeskift. */
  text: string;
};

// --- Leser for PDF-syntaks -----------------------------------------------------------------------

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

class Lexer {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}

  skip(): void {
    for (;;) {
      while (this.pos < this.bytes.length && WHITESPACE.has(this.bytes[this.pos]!)) this.pos += 1;
      if (this.bytes[this.pos] === 0x25) {
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x0a) this.pos += 1;
        continue;
      }
      return;
    }
  }

  word(): string {
    const start = this.pos;
    while (
      this.pos < this.bytes.length &&
      !WHITESPACE.has(this.bytes[this.pos]!) &&
      !DELIMITERS.has(this.bytes[this.pos]!)
    ) {
      this.pos += 1;
    }
    return Buffer.from(this.bytes.subarray(start, this.pos)).toString("latin1");
  }

  literal(): Uint8Array {
    // Står på «(».
    this.pos += 1;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos]!;
      this.pos += 1;
      if (byte === 0x5c) {
        const next = this.bytes[this.pos]!;
        this.pos += 1;
        const escapes: Record<number, number> = {
          0x6e: 0x0a,
          0x72: 0x0d,
          0x74: 0x09,
          0x62: 0x08,
          0x66: 0x0c,
          0x28: 0x28,
          0x29: 0x29,
          0x5c: 0x5c,
        };
        if (next >= 0x30 && next <= 0x37) {
          let value = next - 0x30;
          for (let i = 0; i < 2; i += 1) {
            const digit = this.bytes[this.pos]!;
            if (digit < 0x30 || digit > 0x37) break;
            value = value * 8 + (digit - 0x30);
            this.pos += 1;
          }
          out.push(value & 0xff);
        } else if (next === 0x0a || next === 0x0d) {
          if (next === 0x0d && this.bytes[this.pos] === 0x0a) this.pos += 1;
        } else {
          out.push(escapes[next] ?? next);
        }
        continue;
      }
      if (byte === 0x28) depth += 1;
      if (byte === 0x29) {
        depth -= 1;
        if (depth === 0) break;
      }
      out.push(byte);
    }
    return Uint8Array.from(out);
  }

  hex(): Uint8Array {
    this.pos += 1;
    let digits = "";
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x3e) {
      const char = String.fromCharCode(this.bytes[this.pos]!);
      if (/[0-9a-fA-F]/.test(char)) digits += char;
      this.pos += 1;
    }
    this.pos += 1;
    if (digits.length % 2 === 1) digits += "0";
    return Uint8Array.from(Buffer.from(digits, "hex"));
  }

  /** Én verdi, eller en operator (i innholdsstrømmer) som `{ op }`. */
  value(): PdfValue | { op: string } | undefined {
    this.skip();
    if (this.pos >= this.bytes.length) return undefined;
    const byte = this.bytes[this.pos]!;
    if (byte === 0x2f) {
      this.pos += 1;
      return { name: this.word() };
    }
    if (byte === 0x28) return { str: this.literal() };
    if (byte === 0x3c) {
      if (this.bytes[this.pos + 1] === 0x3c) {
        this.pos += 2;
        const dict = new Map<string, PdfValue>();
        for (;;) {
          this.skip();
          if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
            this.pos += 2;
            return { dict };
          }
          const key = this.value();
          const value = this.value();
          if (!key || typeof key !== "object" || !("name" in key)) throw new Error("PDF: nøkkel");
          dict.set(key.name, value as PdfValue);
        }
      }
      return { str: this.hex() };
    }
    if (byte === 0x5b) {
      this.pos += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.bytes[this.pos] === 0x5d) {
          this.pos += 1;
          return items;
        }
        items.push(this.value() as PdfValue);
      }
    }
    if (DELIMITERS.has(byte)) {
      this.pos += 1;
      return { op: String.fromCharCode(byte) };
    }
    const word = this.word();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      // «12 0 R» er en referanse.
      const save = this.pos;
      this.skip();
      const second = this.word();
      this.skip();
      const third = this.word();
      if (/^\d+$/.test(word) && /^\d+$/.test(second) && third === "R") {
        return { ref: Number(word) };
      }
      this.pos = save;
      return Number(word);
    }
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return { op: word };
  }
}

function asDict(value: PdfValue | undefined): Map<string, PdfValue> | null {
  return value && typeof value === "object" && "dict" in value ? value.dict : null;
}
function asName(value: PdfValue | undefined): string | null {
  return value && typeof value === "object" && "name" in value ? value.name : null;
}
function asNumber(value: PdfValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function decodeTextString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return out;
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return Buffer.from(bytes.subarray(3)).toString("utf8");
  }
  return Buffer.from(bytes).toString("latin1");
}

function readObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = Buffer.from(bytes).toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text))) {
    const lexer = new Lexer(bytes);
    lexer.pos = match.index + match[0].length;
    const value = lexer.value() as PdfValue;
    lexer.skip();
    let stream: Uint8Array | null = null;
    if (text.startsWith("stream", lexer.pos)) {
      let start = lexer.pos + "stream".length;
      if (bytes[start] === 0x0d) start += 1;
      if (bytes[start] === 0x0a) start += 1;
      const dict = asDict(value);
      const length = asNumber(dict?.get("Length"));
      const end = length !== null ? start + length : text.indexOf("endstream", start);
      let raw = bytes.subarray(start, end);
      if (asName(dict?.get("Filter")) === "FlateDecode") raw = new Uint8Array(inflateSync(raw));
      stream = raw;
      header.lastIndex = end;
    }
    objects.set(Number(match[1]), { value, stream });
  }
  return objects;
}

// --- Tekst ---------------------------------------------------------------------------------------

type CMap = { map: Map<number, string>; bytes: number };

function parseToUnicode(stream: Uint8Array): CMap {
  const text = Buffer.from(stream).toString("latin1");
  const map = new Map<number, string>();
  const hexToString = (hex: string) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  };
  let codeBytes = 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      codeBytes = pair[1]!.length / 2;
      map.set(parseInt(pair[1]!, 16), hexToString(pair[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]!.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g,
    )) {
      codeBytes = range[1]!.length / 2;
      const from = parseInt(range[1]!, 16);
      const to = parseInt(range[2]!, 16);
      if (range[4] !== undefined) {
        const base = hexToString(range[4]);
        for (let code = from; code <= to; code += 1) {
          map.set(
            code,
            base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - from),
          );
        }
      } else {
        const items = [...range[5]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((item) =>
          hexToString(item[1]!),
        );
        items.forEach((item, index) => map.set(from + index, item));
      }
    }
  }
  return { map, bytes: codeBytes };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function toHex(components: number[]): string | null {
  if (components.length === 1) components = [components[0]!, components[0]!, components[0]!];
  if (components.length !== 3) return null;
  return `#${components
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

type Run = { x: number; y: number; text: string; size: number; artifact: boolean };

function readPage(
  objects: Map<number, PdfObject>,
  page: Map<string, PdfValue>,
  fontsUsed: Set<string>,
): InspectedPage {
  const resolve = (value: PdfValue | undefined): PdfValue | undefined =>
    value && typeof value === "object" && "ref" in value ? objects.get(value.ref)?.value : value;
  const mediaBox = (resolve(page.get("MediaBox")) as number[]) ?? [0, 0, 0, 0];
  const width = mediaBox[2]! - mediaBox[0]!;
  const height = mediaBox[3]! - mediaBox[1]!;
  const resources = asDict(resolve(page.get("Resources")));
  const fontDict = asDict(resolve(resources?.get("Font")));
  const xobjects = asDict(resolve(resources?.get("XObject")));
  const fonts = new Map<string, CMap>();
  for (const [name, ref] of fontDict ?? []) {
    const font = asDict(resolve(ref));
    const baseFont = asName(font?.get("BaseFont"));
    if (baseFont) fontsUsed.add(baseFont.replace(/^[A-Z]{6}\+/, ""));
    const toUnicode = font?.get("ToUnicode");
    const stream =
      toUnicode && typeof toUnicode === "object" && "ref" in toUnicode
        ? objects.get(toUnicode.ref)?.stream
        : null;
    fonts.set(name, stream ? parseToUnicode(stream) : { map: new Map(), bytes: 1 });
  }

  const contents = page.get("Contents");
  const refs = Array.isArray(contents) ? contents : [contents];
  const content = Buffer.concat(
    refs.map((ref) =>
      ref && typeof ref === "object" && "ref" in ref
        ? (objects.get(ref.ref)?.stream ?? new Uint8Array())
        : new Uint8Array(),
    ),
  );

  const runs: Run[] = [];
  const paths: InspectedPath[] = [];
  const images: InspectedImage[] = [];
  const colors = new Set<string>();
  type State = { ctm: Matrix; stroke: string | null; fill: string | null };
  let state: State = { ctm: IDENTITY, stroke: null, fill: "#000000" };
  const stack: State[] = [];
  const marked: boolean[] = [];
  let font: CMap | null = null;
  let size = 0;
  let textMatrix: Matrix = IDENTITY;
  let pathPoints: [number, number][] = [];
  let operands: PdfValue[] = [];
  const lexer = new Lexer(new Uint8Array(content));
  const inArtifact = () => marked.includes(true);

  const showText = (strings: PdfValue[]) => {
    if (!font) return;
    let text = "";
    for (const item of strings) {
      if (item && typeof item === "object" && "str" in item) {
        const bytes = item.str;
        for (let i = 0; i + font.bytes - 1 < bytes.length; i += font.bytes) {
          let code = 0;
          for (let b = 0; b < font.bytes; b += 1) code = (code << 8) | bytes[i + b]!;
          text += font.map.get(code) ?? "";
        }
      } else if (typeof item === "number" && item < -250) {
        // Stort mellomrom mellom glyfene regnes som ordskille.
        text += " ";
      }
    }
    const [x, y] = apply(multiply(textMatrix, state.ctm), 0, 0);
    runs.push({ x, y: height - y, text, size, artifact: inArtifact() });
  };

  for (;;) {
    const token = lexer.value();
    if (token === undefined) break;
    if (!(token && typeof token === "object" && "op" in token)) {
      operands.push(token);
      continue;
    }
    const op = token.op;
    const num = (index: number) => operands[index] as number;
    switch (op) {
      case "q":
        stack.push({ ...state });
        break;
      case "Q":
        state = stack.pop() ?? state;
        break;
      case "cm":
        state.ctm = multiply([num(0), num(1), num(2), num(3), num(4), num(5)], state.ctm);
        break;
      case "BMC":
        marked.push(asName(operands[0]) === "Artifact");
        break;
      case "BDC":
        marked.push(asName(operands[0]) === "Artifact");
        break;
      case "EMC":
        marked.pop();
        break;
      case "BT":
        textMatrix = IDENTITY;
        break;
      case "Tf":
        font = fonts.get(asName(operands[0]) ?? "") ?? null;
        size = num(1);
        break;
      case "Tm":
        textMatrix = [num(0), num(1), num(2), num(3), num(4), num(5)];
        break;
      case "Td":
        textMatrix = multiply([1, 0, 0, 1, num(0), num(1)], textMatrix);
        break;
      case "Tj":
        showText([operands[0] as PdfValue]);
        break;
      case "TJ":
        showText(operands[0] as PdfValue[]);
        break;
      case "sc":
      case "scn":
      case "rg":
      case "g":
        state.fill = toHex(operands.filter((value): value is number => typeof value === "number"));
        if (state.fill) colors.add(state.fill);
        break;
      case "SC":
      case "SCN":
      case "RG":
      case "G":
        state.stroke = toHex(
          operands.filter((value): value is number => typeof value === "number"),
        );
        if (state.stroke) colors.add(state.stroke);
        break;
      case "m":
      case "l":
        pathPoints.push(apply(state.ctm, num(0), num(1)));
        break;
      case "c":
        pathPoints.push(apply(state.ctm, num(4), num(5)));
        pathPoints.push(apply(state.ctm, num(0), num(1)));
        pathPoints.push(apply(state.ctm, num(2), num(3)));
        break;
      case "re": {
        const [x, y, w, h] = [num(0), num(1), num(2), num(3)];
        pathPoints.push(apply(state.ctm, x, y), apply(state.ctm, x + w, y + h));
        break;
      }
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*": {
        if (pathPoints.length > 0) {
          const xs = pathPoints.map((point) => point[0]);
          const ys = pathPoints.map((point) => height - point[1]);
          const stroking = op !== "f" && op !== "F" && op !== "f*";
          const filling = op !== "S" && op !== "s";
          paths.push({
            stroke: stroking ? state.stroke : null,
            fill: filling ? state.fill : null,
            bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
            artifact: inArtifact(),
          });
        }
        pathPoints = [];
        break;
      }
      case "n":
        pathPoints = [];
        break;
      case "Do": {
        const name = asName(operands[0]) ?? "";
        const ref = xobjects?.get(name);
        const object = ref && typeof ref === "object" && "ref" in ref ? objects.get(ref.ref) : null;
        if (object && asName(asDict(object.value)?.get("Subtype")) === "Image") {
          const [x0, y0] = apply(state.ctm, 0, 0);
          const [x1, y1] = apply(state.ctm, 1, 1);
          images.push({
            bbox: [
              Math.min(x0, x1),
              height - Math.max(y0, y1),
              Math.max(x0, x1),
              height - Math.min(y0, y1),
            ],
            bytes: object.stream ?? new Uint8Array(),
          });
        }
        break;
      }
    }
    operands = [];
  }

  const toLines = (items: Run[]): InspectedLine[] => {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: InspectedLine[] = [];
    for (const run of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - run.y) < 2.5) {
        last.text = `${last.text} ${run.text}`;
        last.fontSize = Math.max(last.fontSize, run.size);
      } else {
        lines.push({ y: run.y, x: run.x, text: run.text, fontSize: run.size });
      }
    }
    // Innenfor samme linje: sortert fra venstre.
    return lines.map((line) => {
      const parts = sorted
        .filter((run) => Math.abs(run.y - line.y) < 2.5)
        .sort((a, b) => a.x - b.x)
        .map((run) => run.text);
      return { ...line, text: parts.join(" ").replace(/\s+/g, " ").trim() };
    });
  };
  const lines = toLines(runs);

  const links: InspectedLink[] = [];
  const annots = resolve(page.get("Annots"));
  for (const ref of Array.isArray(annots) ? annots : []) {
    const annot = asDict(resolve(ref));
    if (asName(annot?.get("Subtype")) !== "Link") continue;
    const rect = (resolve(annot?.get("Rect")) as number[]) ?? [0, 0, 0, 0];
    const action = asDict(resolve(annot?.get("A")));
    const uri = action?.get("URI");
    const dest = annot?.get("Dest");
    const contents = annot?.get("Contents");
    const str = (value: PdfValue | undefined) =>
      value && typeof value === "object" && "str" in value ? decodeTextString(value.str) : null;
    links.push({
      rect: [rect[0]!, height - rect[3]!, rect[2]!, height - rect[1]!],
      uri: str(uri),
      dest: str(dest) ?? asName(dest),
      contents: str(contents),
    });
  }

  return {
    width,
    height,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    contentLines: toLines(runs.filter((run) => !run.artifact)),
    links,
    images,
    vectorPaths: paths,
    colors,
  };
}

/** Leser PDF-en. Kaster når filen ikke er en PDF fra motoren. */
export function inspectPdf(bytes: Uint8Array): InspectedPdf {
  const head = Buffer.from(bytes.subarray(0, 8)).toString("latin1");
  if (!head.startsWith("%PDF-")) throw new Error("Ikke en PDF.");
  const objects = readObjects(bytes);
  const all = Buffer.from(bytes).toString("latin1");
  const resolve = (value: PdfValue | undefined): PdfValue | undefined =>
    value && typeof value === "object" && "ref" in value ? objects.get(value.ref)?.value : value;

  let catalog: Map<string, PdfValue> | null = null;
  for (const object of objects.values()) {
    const dict = asDict(object.value);
    if (asName(dict?.get("Type")) === "Catalog") catalog = dict;
  }
  if (!catalog) throw new Error("PDF uten katalog.");

  const pages: Map<string, PdfValue>[] = [];
  const walk = (node: PdfValue | undefined) => {
    const dict = asDict(resolve(node));
    if (!dict) return;
    if (asName(dict.get("Type")) === "Pages") {
      for (const kid of (resolve(dict.get("Kids")) as PdfValue[]) ?? []) walk(kid);
    } else {
      pages.push(dict);
    }
  };
  walk(catalog.get("Pages"));

  const trailerAt = all.lastIndexOf("trailer");
  let infoDict: Map<string, PdfValue> | null = null;
  let id: string | null = null;
  if (trailerAt >= 0) {
    const lexer = new Lexer(bytes);
    lexer.pos = trailerAt + "trailer".length;
    const trailer = asDict(lexer.value() as PdfValue);
    infoDict = asDict(resolve(trailer?.get("Info")));
    const ids = trailer?.get("ID");
    const first = Array.isArray(ids) ? ids[0] : undefined;
    if (first && typeof first === "object" && "str" in first) {
      id = Buffer.from(first.str).toString("hex");
    }
  }
  const infoText = (key: string) => {
    const value = infoDict?.get(key);
    return value && typeof value === "object" && "str" in value
      ? decodeTextString(value.str)
      : null;
  };
  const metadata = catalog.get("Metadata");
  const xmpStream =
    metadata && typeof metadata === "object" && "ref" in metadata
      ? objects.get(metadata.ref)?.stream
      : null;
  const langValue = catalog.get("Lang");
  const markInfo = asDict(resolve(catalog.get("MarkInfo")));
  const fontsUsed = new Set<string>();
  const inspected = pages.map((page) => readPage(objects, page, fontsUsed));

  return {
    info: {
      title: infoText("Title"),
      author: infoText("Author"),
      producer: infoText("Producer"),
      creator: infoText("Creator"),
      subject: infoText("Subject"),
      keywords: infoText("Keywords"),
      creationDate: infoText("CreationDate"),
      modDate: infoText("ModDate"),
      id,
    },
    xmp: xmpStream ? Buffer.from(xmpStream).toString("utf8") : null,
    lang:
      langValue && typeof langValue === "object" && "str" in langValue
        ? decodeTextString(langValue.str)
        : null,
    tagged: markInfo?.get("Marked") === true && catalog.has("StructTreeRoot"),
    pages: inspected,
    fonts: [...fontsUsed].sort(),
    text: inspected.map((page) => page.text).join("\n"),
  };
}

/**
 * Mønsterlisten for interne koder (oppgavekortet, «Regler»). Hvert mønster er et tegn på at en kode
 * eller en feil verdi har sluppet ut i PDF-teksten.
 */
export const INTERNAL_CODE_PATTERNS: readonly RegExp[] = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\bwet_room\./,
  /\b[a-z]+_[a-z_]+\.[a-z_]+/,
  /\btg[0-3]\b/,
  /\{[^}]*\}/,
  /\bcause_criterion\b/,
  /\btext_source\b/,
  /\bcost_type\b/,
  /\b(?:approx|under_20000|over_500000|from_\d+_to_\d+)\b/,
  /\bmandatory_without_tg\b/,
  /\[object Object\]/,
  /\bundefined\b/,
  /\bnull\b/,
  /\bNaN\b/,
];

/** Kaster med første treff når teksten har en intern kode. */
export function expectNoInternalCodes(text: string): void {
  for (const pattern of INTERNAL_CODE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) throw new Error(`Intern kode i PDF-teksten: «${match[0]}» (${pattern})`);
  }
}
