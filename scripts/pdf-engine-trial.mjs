// Prøve av PDF-motoren (ADR 0016). Kjøres fra mappen appen rulles ut fra, slik at den viser at
// motoren, WASM-filen og skriftene faktisk ligger i pakken:
//
//   pnpm build && cp -r public .next/standalone/public
//   cd .next/standalone && node ../../scripts/pdf-engine-trial.mjs
//
// Skriptet bruker bare oppdiktet tekst. Det leser ingen database, og alle nettverkskall er
// sperret og telt. Motoren kjører i en egen arbeidstråd, som i appen. Avslutter med kode 1 når
// et krav ikke holder. `--json` skriver bare tallene.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { crc32, deflateSync } from "node:zlib";

const ROOT = process.cwd();
const requireFromRoot = createRequire(path.join(ROOT, "trial.js"));
const ENGINE = "@myriaddreamin/typst.ts";
const ENGINE_WASM = "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm";

// --- Arbeidstråden: eneste sted motoren lastes ---------------------------------------------------
if (!isMainThread) {
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("network is blocked"));
  };
  const { createTypstCompiler } = requireFromRoot(`${ENGINE}/compiler`);
  const init = requireFromRoot(`${ENGINE}/options.init`);
  const compiler = createTypstCompiler();
  const started = performance.now();
  await compiler.init({
    getModule: () => readFileSync(requireFromRoot.resolve(ENGINE_WASM)),
    beforeBuild: [
      init.disableDefaultFontAssets(),
      init.loadFonts(workerData.fonts, { assets: false }),
    ],
  });
  const initMs = performance.now() - started;
  parentPort.on("message", async (job) => {
    const t0 = performance.now();
    try {
      compiler.resetShadow();
      compiler.addSource("/main.typ", job.source);
      for (const [name, bytes] of job.files) compiler.mapShadow(name, bytes);
      const options = { mainFilePath: "/main.typ", inputs: job.inputs, diagnostics: "full" };
      let bytes = null;
      let query = null;
      if (job.query) {
        query = await compiler.runWithWorld(options, async (world) => {
          await world.compile();
          return world.query({ selector: job.query, field: "value" });
        });
      } else {
        const compiled = await compiler.compile({ ...options, format: 1 });
        if (!compiled.result)
          throw new Error(compiled.diagnostics?.[0]?.message ?? "compile failed");
        bytes = compiled.result;
      }
      parentPort.postMessage({
        ok: true,
        bytes,
        query,
        ms: performance.now() - t0,
        initMs,
        fetchCalls,
        // Minnet til hele prosessen (hovedtråden og arbeidstrådene deler det).
        rssMb: process.memoryUsage().rss / 1e6,
      });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        message: String(error?.message ?? error).slice(0, 200),
        fetchCalls,
      });
    }
  });
}

// --- Oppdiktet innhold ------------------------------------------------------------------------
function png(width, height) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * row + 1 + x * 3;
      raw[at] = Math.floor((x * 255) / width);
      raw[at + 1] = Math.floor((y * 255) / height);
      raw[at + 2] = 120;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const HYPHENATION_TEXT =
  "Fuktsikringsdokumentasjonen og membranunderlagskonstruksjonen i våtromsgulvkonstruksjonen mangler. " +
  "Tettesjiktsovergangen ved gulvvarmefordelingsskapet har lekkasjeindikasjoner.";

/** Tekst som ville vært kode i en mal. Skal stå som vanlig tekst i PDF-en. */
const INJECTION = [
  "<script>alert(1)</script>",
  "<img src=http://example.invalid/x.png onerror=alert(1)>",
  "</style> url(http://example.invalid) @import 'x'",
  "{{ 7*7 }}",
  '#import "@preview/cetz:0.3.0"',
  '#read("/etc/passwd")',
  "file:///etc/passwd",
  "#sys.inputs $ x^2 $ *fet* _kursiv_ `kode` <label> @ref \\",
];

// Malen er fast kode. Rapportdata kommer bare inn som JSON i `sys.inputs.data` og settes som
// tekstverdier, aldri gjennom `eval`.
const TEMPLATE = String.raw`
#let data = json(bytes(sys.inputs.data))
#let made = data.generatedAt
#set document(title: data.title, author: (), date: datetime(
  year: made.at(0), month: made.at(1), day: made.at(2), hour: made.at(3), minute: made.at(4), second: made.at(5)))
#set text(lang: "nb", font: "Inter", size: 10pt, hyphenate: data.hyphenate)
#set par(justify: true)
#set page(paper: "a4", margin: 2cm,
  footer: context [#data.company #h(1fr) side #counter(page).display() av #counter(page).final().first()],
  foreground: if data.draft { rotate(-45deg, text(size: 90pt, fill: rgb(200, 0, 0, 40), "UTKAST")) })
#show heading: set text(font: "Schibsted Grotesk")
#outline(title: "Innhold")
#pagebreak()
= Orddeling
#let narrow = block(width: 4.2cm, data.hyphenText)
#narrow
#context [#metadata(measure(narrow).height.pt()) <narrow-height>]
= Tekst som ligner kode
#for line in data.injection [#par(line)]
= Avvik
#for deviation in data.deviations [
  #block(breakable: false, stroke: 0.5pt, inset: 6pt, width: 100%)[
    == #deviation.title
    #box(fill: rgb("#c62828"), inset: 3pt, text(fill: white, "TG" + sym.space.nobreak + str(deviation.tg)))
    #deviation.text #linebreak()
    Kostnad: #box(deviation.cost) #link(data.base + "/oppdrag/x#avvik-" + deviation.id)[Gå til feltet]
  ]
]
= Bilder med markering
#for index in range(data.images) [
  #block(breakable: false)[
    #box(width: 8cm, {
      image("/img/" + str(index) + ".png", width: 8cm, alt: "Bilde av avviket")
      place(top + left, dx: 2cm, dy: 1cm, circle(radius: 0.8cm, stroke: 2pt + red))
    })
    #linebreak() Bildetekst #str(index + 1)
  ]
]
#set page(flipped: true)
= Liggende side
#table(columns: (3cm, 1fr, 3cm), [Punkt], [Beskrivelse], [TG], [Sluk], [Tett og uten avvik], [TG1])
`;

function buildInputs({ deviations, images, hyphenate = true }) {
  return {
    data: JSON.stringify({
      title: "UTKAST – Tilstandsrapport 2026-0001",
      generatedAt: [2026, 11, 24, 12, 0, 0],
      draft: true,
      hyphenate,
      company: "Oppdiktet Takst AS, org.nr. 999 999 999",
      base: "https://app.example.invalid",
      hyphenText: HYPHENATION_TEXT,
      injection: INJECTION,
      deviations: Array.from({ length: deviations }, (_, index) => ({
        id: `d${index}`,
        title: `Avvik ${index + 1}`,
        tg: 2 + (index % 2),
        text: "Fugen mellom gulv og vegg er sprukket. Vann kan trenge inn bak flisene og skade treverket. ".repeat(
          2,
        ),
        cost: "20 000–100 000 kr",
      })),
      images,
    }),
  };
}

// --- Hovedtråden ------------------------------------------------------------------------------
function startWorker(fonts) {
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { fonts } });
  const run = (job, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void worker.terminate().then(() => reject(new Error("timeout")));
      }, timeoutMs);
      worker.once("message", (message) => {
        clearTimeout(timer);
        if (message.ok) resolve(message);
        else reject(new Error(message.message));
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.postMessage(job);
    });
  return { worker, run };
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const trace = (step) => process.env.TRIAL_TRACE && console.error("steg", step);
  const failures = [];
  const check = (name, ok) => {
    if (!ok) failures.push(name);
    return ok;
  };
  const result = {
    root: ROOT,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };

  trace(1);
  // 1. Filene finnes i pakken.
  const fontDir = path.join(ROOT, "public", "fonts");
  const logo = path.join(ROOT, "public", "brand", "byggcon-logo.png");
  const wasm = requireFromRoot.resolve(ENGINE_WASM);
  result.files = {
    wasmMb: Number((statSync(wasm).size / 1e6).toFixed(1)),
    fonts: existsSync(fontDir)
      ? readdirSync(fontDir).filter((name) => name.endsWith(".ttf")).length
      : 0,
    logo: existsSync(logo),
  };
  check("skriftene finnes i public/fonts", result.files.fonts >= 7);
  check("logoen finnes i public/brand", result.files.logo);
  const fonts = readdirSync(fontDir)
    .filter((name) => name.endsWith(".ttf"))
    .sort()
    .map((name) => new Uint8Array(readFileSync(path.join(fontDir, name))));

  trace(2);
  // 2. Badet: tid, minne og like byte (to ganger, og i ny tråd med annen tidssone og locale).
  const bath = buildInputs({ deviations: 6, images: 2 });
  const image = png(1600, 1200);
  const files = [
    ["/img/0.png", image],
    ["/img/1.png", image],
  ];
  const first = startWorker(fonts);
  const a = await first.run({ source: TEMPLATE, inputs: bath, files });
  const b = await first.run({ source: TEMPLATE, inputs: bath, files });
  process.env.TZ = "Asia/Tokyo";
  process.env.LANG = "ja_JP.UTF-8";
  const second = startWorker(fonts);
  const c = await second.run({ source: TEMPLATE, inputs: bath, files });
  result.bath = {
    bytes: a.bytes.length,
    initMs: Math.round(a.initMs),
    firstMs: Math.round(a.ms),
    nextMs: Math.round(b.ms),
    processRssMb: Math.round(b.rssMb),
    sha256: sha(a.bytes).slice(0, 16),
  };
  result.sameBytesTwice = check("like byte to ganger", sha(a.bytes) === sha(b.bytes));
  result.sameBytesOtherTimezone = check(
    "like byte med annen TZ og locale",
    sha(a.bytes) === sha(c.bytes),
  );
  const head = Buffer.from(a.bytes).toString("latin1");
  result.pdf = {
    lang: /\/Lang\s*\(nb\)/.test(head),
    tagged: /\/MarkInfo/.test(head) && /\/StructTreeRoot/.test(head),
    creationDate: /\/CreationDate\s*\(([^)]*)\)/.exec(head)?.[1] ?? null,
  };
  check("språk nb", result.pdf.lang);
  check("tagget PDF", result.pdf.tagged);
  check("fast dato fra inndata", result.pdf.creationDate === "D:20261124120000Z");

  trace(3);
  // 3. Orddeling for bokmål: samme tekst i 4,2 cm kolonne med og uten orddeling.
  const withHyphens = await first.run({
    source: TEMPLATE,
    inputs: bath,
    files,
    query: "<narrow-height>",
  });
  const without = await first.run({
    source: TEMPLATE,
    inputs: buildInputs({ deviations: 6, images: 2, hyphenate: false }),
    files,
    query: "<narrow-height>",
  });
  result.hyphenation = {
    heightWithPt: Number(withHyphens.query[0].toFixed(1)),
    heightWithoutPt: Number(without.query[0].toFixed(1)),
  };
  // Uten orddeling stikker de lange ordene ut av kolonnen, og teksten får færre linjer.
  check("orddeling for bokmål virker", withHyphens.query[0] > without.query[0]);

  trace(4);
  // 4. Lukket motor: malen kan ikke lese filer eller hente pakker, og nettet er aldri brukt.
  const closed = {};
  for (const [name, source] of [
    ["readFile", '#read("/etc/passwd")'],
    ["importPackage", '#import "@preview/cetz:0.3.0"'],
  ]) {
    closed[name] = await first.run({ source, inputs: {}, files: [] }).then(
      () => "GIKK GJENNOM",
      () => "avvist",
    );
    check(`lukket motor: ${name}`, closed[name] === "avvist");
  }
  const after = await first.run({ source: TEMPLATE, inputs: bath, files });
  closed.fetchCalls = after.fetchCalls;
  check("ingen nettverkskall", after.fetchCalls === 0);
  result.closed = closed;

  trace(5);
  // 5. Avbrudd: en mal som aldri blir ferdig, stoppes ved å avslutte tråden.
  const stuck = startWorker(fonts);
  const t0 = performance.now();
  result.timeout = await stuck
    .run(
      {
        source: "#range(30000).map(i => range(30000).map(j => i * j).sum()).sum()",
        inputs: {},
        files: [],
      },
      1500,
    )
    .then(
      () => ({ stopped: false }),
      (error) => ({
        stopped: error.message === "timeout",
        afterMs: Math.round(performance.now() - t0),
      }),
    );
  await stuck.worker.terminate();
  check("tidsavbrudd stopper motoren", result.timeout.stopped);

  trace(6);
  // 6. Femti ulike bilder (anslag; ekte måling med visningskopier i 2a-3).
  const many = Array.from({ length: 50 }, (_, index) => [
    `/img/${index}.png`,
    png(1600 + index, 1200),
  ]);
  const fifty = await second.run(
    { source: TEMPLATE, inputs: buildInputs({ deviations: 40, images: 50 }), files: many },
    60_000,
  );
  result.fiftyImages = {
    inputMb: Number((many.reduce((sum, [, bytes]) => sum + bytes.length, 0) / 1e6).toFixed(1)),
    pdfMb: Number((fifty.bytes.length / 1e6).toFixed(1)),
    ms: Math.round(fifty.ms),
    processRssMb: Math.round(fifty.rssMb),
  };

  await first.worker.terminate();
  await second.worker.terminate();
  result.failures = failures;
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

if (isMainThread) await main();
