import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { APP0, APP1_EXIF, APP1_XMP, SOF0, jpeg } from "../../../tests/jpeg-bytes";
import {
  bathroomPdfData,
  IDS,
  pngBytes,
  TEST_LANDSCAPE_PROFILE,
  testImage,
} from "../../../tests/pdf-fixtures";
import { expectNoInternalCodes, inspectPdf, type InspectedPdf } from "../../../tests/pdf-inspect";

vi.mock("server-only", () => ({}));

const { loadPdfAssets } = await import("./assets.node");
const { createNodeWorkerEngine } = await import("./engine.node");
const { PDF_DEFAULT_LIMITS } = await import("./codes");
const { PdfRenderError } = await import("./errors");
const { BYGGCON_STANDARD_PROFILE } = await import("./profiles");
const { createReportPdfRenderer } = await import("./render");
const { renderReportPdf } = await import("./index");
type ReportPdfData = import("./types").ReportPdfData;
type RenderReportPdfOptions = import("./types").RenderReportPdfOptions;
type PdfEngine = import("./types").PdfEngine;
type PdfAssets = import("./types").PdfAssets;
type PdfLimits = import("./types").PdfLimits;

/*
 * Gjengivelsen mot motoren (testplanen 4.1–4.6 og 10.5). Oppdiktede data, ingen database.
 * Støtter hovedmål: færre reklamasjoner (samme PDF hver gang, alle delene med, ingen koder, ingen
 * overskrift alene nederst), de ansatte (under ett sekund) og KI i bunnen (lukket motor).
 */

const NOW = new Date("2026-11-03T10:00:00Z");
const BASE = "https://app.example.invalid";
const engine = createNodeWorkerEngine();
const render = createReportPdfRenderer(engine);
let assets: PdfAssets;

function options(overrides: Partial<RenderReportPdfOptions> = {}): RenderReportPdfOptions {
  return {
    draft: true,
    generatedAt: NOW,
    appBaseUrl: BASE,
    assets,
    limits: PDF_DEFAULT_LIMITS,
    ...overrides,
  };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const words = (text: string) => text.replace(/\s+/g, " ").trim();

let draft: {
  bytes: Uint8Array;
  pageCount: number;
  imageCount: number;
  pdf: InspectedPdf;
  ms: number;
};
let release: { bytes: Uint8Array; pageCount: number; pdf: InspectedPdf };

beforeAll(async () => {
  assets = await loadPdfAssets();
  const started = performance.now();
  const result = await render(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
  draft = { ...result, pdf: inspectPdf(result.bytes), ms: performance.now() - started };
  const final = await render(
    bathroomPdfData("release"),
    BYGGCON_STANDARD_PROFILE,
    options({ draft: false }),
  );
  release = { ...final, pdf: inspectPdf(final.bytes) };
}, 30_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("4.1 struktur", () => {
  it("alle delene står i PDF-en", () => {
    const text = words(draft.pdf.text);
    for (const part of [
      "Tilstandsrapport",
      "Prøvevegen 1",
      "8000 Prøvestad",
      "Gnr. 999, bnr. 9",
      "Oppdragsnummer 26-1042",
      "Befaringsdato 03.11.2026",
      "Utført av Testselskap takst AS",
      "Innhold",
      "Slik leser du TG",
      "TG0 Ingen avvik",
      "Bad · 1. etasje",
      "Membran og tettesjikt TG3 Store eller alvorlige avvik",
      "Prøvetekst for avviket ved sluket i testbadet.",
      "Årsak Fukt. Prøvetekst for årsaken.",
      "Konsekvens Prøvetekst for konsekvensen.",
      "Tiltak 1. Første prøvetiltak.",
      "2. Andre prøvetiltak.",
      "Kostnad 20 000–100 000 kr",
      "Kostnad ca. 40 000 kr",
      "TGIU Ikke undersøkt",
      "Hva og hvorfor Prøvetekst hva og hvorfor.",
      "Hull tatt Ja",
      "Fuktmåling 12,4 vekt-%",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("bunnteksten står på hver side med selskap, oppdragsnummer og riktig «Side x av y»", () => {
    const pages = draft.pdf.pages;
    expect(pages.length).toBe(draft.pageCount);
    pages.forEach((page, index) => {
      const last = page.lines[page.lines.length - 1]!.text;
      expect(last).toBe(
        `Testselskap takst AS · org.nr. 999 999 999 26-1042 Side ${index + 1} av ${pages.length}`,
      );
    });
  });

  it("innholdsfortegnelsen viser siden overskriften står på, og lenker dit", () => {
    const toc = draft.pdf.pages[1]!;
    const pageOf = (heading: string) =>
      draft.pdf.pages.findIndex(
        (page, index) =>
          index > 1 && page.contentLines.some((line) => line.text.startsWith(heading)),
      ) + 1;
    for (const heading of ["Slik leser du TG", "Bad · 1. etasje", "Sluk", "Ikke med i PDF-en"]) {
      const line = toc.lines.find((item) => item.text.startsWith(`${heading} .`));
      expect(line, heading).toBeDefined();
      expect(line!.text.endsWith(` ${pageOf(heading)}`)).toBe(true);
    }
    expect(toc.links.length).toBeGreaterThanOrEqual(7);
    expect(toc.links.every((link) => link.dest !== null && link.uri === null)).toBe(true);
  });

  it("antall sider og bilder stemmer med PDF-en; forsiden har bare logoen", () => {
    expect(draft.imageCount).toBe(3);
    const images = draft.pdf.pages.reduce((sum, page) => sum + page.images.length, 0);
    expect(images).toBe(draft.imageCount + 1);
    expect(draft.pdf.pages[0]!.images).toHaveLength(1);
  });

  it("badet er klart på under 5 sekunder", () => {
    expect(draft.ms).toBeLessThan(5_000);
  });
});

describe("4.2 samme resultat", () => {
  it("samme data og profil to ganger gir like byte", async () => {
    const again = await render(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
    expect(sha(again.bytes)).toBe(sha(draft.bytes));
  });

  it("annen tidssone og locale gir like byte", async () => {
    vi.stubEnv("TZ", "Pacific/Auckland");
    vi.stubEnv("LANG", "en_US.UTF-8");
    vi.stubEnv("LC_ALL", "en_US.UTF-8");
    const other = await render(bathroomPdfData("draft"), BYGGCON_STANDARD_PROFILE, options());
    expect(sha(other.bytes)).toBe(sha(draft.bytes));
  });

  it("datoene kommer fra generatedAt, og annen generatedAt endrer bare datoene", async () => {
    expect(draft.pdf.info.creationDate).toBe("D:20261103100000Z");
    expect(draft.pdf.info.modDate).toBe("D:20261103100000Z");
    const later = await render(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options({ generatedAt: new Date("2027-01-02T03:04:05Z") }),
    );
    const pdf = inspectPdf(later.bytes);
    expect(pdf.info.creationDate).toBe("D:20270102030405Z");
    expect(pdf.text).toBe(draft.pdf.text);
    expect(later.pageCount).toBe(draft.pageCount);
  });

  it("testprofilen gir liggende sider og andre farger, men samme tekst", async () => {
    const landscape = await render(bathroomPdfData("draft"), TEST_LANDSCAPE_PROFILE, options());
    const pdf = inspectPdf(landscape.bytes);
    for (const page of pdf.pages) expect(page.width).toBeGreaterThan(page.height);
    for (const page of draft.pdf.pages) expect(page.height).toBeGreaterThan(page.width);
    const colors = new Set(pdf.pages.flatMap((page) => [...page.colors]));
    const standard = new Set(draft.pdf.pages.flatMap((page) => [...page.colors]));
    expect(colors.has("#e6efe9")).toBe(true);
    expect(standard.has("#e6efe9")).toBe(false);
    const content = (inspected: InspectedPdf) =>
      inspected.pages
        .slice(2)
        .flatMap((page) => page.contentLines.map((line) => line.text))
        .join(" ");
    expect(words(content(pdf))).toBe(words(content(draft.pdf)));
  });

  it("tekst per side (fanger endringer i utseendet)", () => {
    expect(draft.pdf.pages.map((page) => page.contentLines.map((line) => line.text)))
      .toMatchInlineSnapshot(`
        [
          [
            "Tilstandsrapport",
            "Prøvevegen 1",
            "8000 Prøvestad",
            "Gnr. 999, bnr. 9",
            "Oppdragsnummer 26-1042",
            "Befaringsdato 03.11.2026",
            "Utført av Testselskap takst AS",
          ],
          [
            "Innhold",
            "Slik leser du TG 3",
            "Bad · 1. etasje 4",
            "TG3",
            "Membran og tettesjikt 4",
            "TG2",
            "Sluk 5",
            "TGIU",
            "Tilliggende konstruksjoner 5",
            "Ventilasjon 5",
            "Ikke med i PDF-en 6",
          ],
          [
            "Slik leser du TG",
            "Prøvetekst for TG0 i testene.",
            "TG0 Ingen avvik",
            "Prøvetekst for TG1 i testene.",
            "TG1 Mindre avvik",
            "Prøvetekst for TG2 i testene.",
            "TG2 Vesentlige avvik",
            "Prøvetekst for TG3 i testene.",
            "TG3 Store eller alvorlige avvik",
            "Prøvetekst for TGIU i testene.",
            "TGIU Ikke undersøkt",
            "Prøvetekst om HMS i testene.",
          ],
          [
            "Bad · 1. etasje",
            "Membran og tettesjikt TG3 Store eller alvorlige avvik",
            "Rett i skjemaet ›",
            "Prøvebeskrivelse av membranen i testbadet.",
            "Hull tatt Ja",
            "Fuktmåling 12,4 vekt-%",
            "TG3 Store eller alvorlige avvik Rett i skjemaet ›",
            "Sjekk: Prøvetekst fra sjekken. Rett i skjemaet ›",
            "Prøvetekst for avviket ved sluket i testbadet.",
            "Årsak Fukt. Prøvetekst for årsaken.",
            "Konsekvens Prøvetekst for konsekvensen.",
            "Tiltak 1. Første prøvetiltak.",
            "2. Andre prøvetiltak.",
            "Kostnad 20 000–100 000 kr",
            "Bildetekst en Bildetekst to",
            "HMS Rett i skjemaet ›",
            "Konsekvens Prøvetekst for HMS-konsekvens.",
            "Tiltak 1. Prøvetiltak for HMS.",
          ],
          [
            "Sluk TG2 Vesentlige avvik",
            "Rett i skjemaet ›",
            "TG2 Vesentlige avvik Rett i skjemaet ›",
            "Prøvetekst for avviket ved sluket.",
            "Konsekvens Prøvetekst for konsekvensen ved sluket.",
            "Kostnad ca. 40 000 kr",
            "Tilliggende konstruksjoner TGIU Ikke undersøkt",
            "Rett i skjemaet ›",
            "TGIU Ikke undersøkt",
            "Hva og hvorfor Prøvetekst hva og hvorfor.",
            "Risiko Prøvetekst for risiko.",
            "Ventilasjon Ikke satt",
            "Rett i skjemaet ›",
            "Mangler: Prøvetekst for det som mangler. Rett i skjemaet ›",
            "Prøvebeskrivelse av ventilasjonen.",
          ],
          [
            "Ikke med i PDF-en",
            "Dette står ikke i rapporten ennå. Siden er bare med i utkastet.",
            "Mangler: Prøvetekst for hele rapporten.",
            "Punkter uten innhold",
            "Overflater (Bad) Rett i skjemaet ›",
          ],
        ]
      `);
  });
});

describe("4.3 innhold", () => {
  it("ingen interne koder i utkastet eller i den endelige PDF-en", () => {
    expectNoInternalCodes(draft.pdf.text);
    expectNoInternalCodes(release.pdf.text);
  });

  it("TG står alltid med tekst", () => {
    for (const tg of ["TG0", "TG1", "TG2", "TG3", "TGIU"]) expect(draft.pdf.text).toContain(tg);
  });

  it("utkast: «UTKAST» på hver side; endelig: ingen", () => {
    for (const page of draft.pdf.pages) {
      expect(page.lines[0]!.text).toBe("UTKAST – ikke send til kunde");
    }
    expect(release.pdf.text).not.toContain("UTKAST");
  });

  it("«Ikke med i PDF-en» bare i utkast, med punktet uten innhold", () => {
    const last = draft.pdf.pages[draft.pdf.pages.length - 1]!;
    expect(words(last.text)).toContain("Ikke med i PDF-en");
    expect(words(last.text)).toContain("Overflater (Bad) Rett i skjemaet ›");
    expect(release.pdf.text).not.toContain("Ikke med i PDF-en");
    for (const word of ["Ikke satt", "Mangler:", "Sjekk:", "Rett i skjemaet"]) {
      expect(draft.pdf.text).toContain(word);
      expect(release.pdf.text).not.toContain(word);
    }
  });

  it("4.3.8 lenker i utkastet har bare id-er; endelig PDF har ingen lenker ut", () => {
    const ID = "[0-9a-f-]{36}";
    const pattern = new RegExp(`^${BASE}/oppdrag/${ID}/rom/${ID}#(punkt|avvik)-${ID}$`);
    const uris = draft.pdf.pages
      .flatMap((page) => page.links.map((link) => link.uri))
      .filter(Boolean);
    expect(uris).toContain(
      `${BASE}/oppdrag/${IDS.assignment}/rom/${IDS.room}#avvik-${IDS.devDrain}`,
    );
    for (const uri of uris) expect(uri).toMatch(pattern);
    expect(release.pdf.pages.flatMap((page) => page.links).every((link) => link.uri === null)).toBe(
      true,
    );
  });

  it("10.5.1 lenkene kommer bare fra appBaseUrl, og uten den finnes ingen", async () => {
    const none = await render(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options({ appBaseUrl: "" }),
    );
    const links = inspectPdf(none.bytes).pages.flatMap((page) => page.links);
    expect(links.every((link) => link.uri === null)).toBe(true);
  });

  it("orddeling for bokmål virker, og kronebeløp og TG deles aldri", async () => {
    const data = bathroomPdfData("release");
    const deviation = data.rooms[0]!.checkpoints[0]!.deviations[0]!;
    deviation.causeText = Array.from(
      { length: 12 },
      () => "Fuktsikringskonstruksjonen våtromsmembranoppbygningen gulvvarmefordelingsskapet",
    ).join(" ");
    const result = inspectPdf(
      (await render(data, BYGGCON_STANDARD_PROFILE, options({ draft: false }))).bytes,
    );
    const lines = result.pages.flatMap((page) => page.contentLines.map((line) => line.text));
    // Bindestreken fra orddelingen står som eget tekststykke på slutten av linjen.
    expect(lines.some((line) => /[a-zæøå] ?-$/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes("20 000–100 000 kr"))).toBe(true);
    expect(lines.some((line) => /TG3 Store eller alvorlige avvik/.test(line))).toBe(true);
  });

  it("F2: ingen side slutter med en overskrift, også med et avvikskort lengre enn en side", async () => {
    const data = bathroomPdfData("draft");
    const deviation = data.rooms[0]!.checkpoints[0]!.deviations[0]!;
    deviation.consequenceText = "Prøvetekst som fyller siden med mange ord. ".repeat(160);
    const result = await render(data, BYGGCON_STANDARD_PROFILE, options());
    const pdf = inspectPdf(result.bytes);
    const headings = new Set([
      "Slik leser du TG",
      "Bad · 1. etasje",
      "Ikke med i PDF-en",
      "Punkter uten innhold",
      "Membran og tettesjikt TG3 Store eller alvorlige avvik",
      "Sluk TG2 Vesentlige avvik",
      "Tilliggende konstruksjoner TGIU Ikke undersøkt",
      "Ventilasjon Ikke satt",
    ]);
    for (const page of pdf.pages) {
      const last = page.contentLines[page.contentLines.length - 1]!.text;
      expect(headings.has(last), last).toBe(false);
    }
    // Fortsettelsen er merket øverst på neste side.
    expect(pdf.text).toContain("Membran og tettesjikt · avvik, fortsetter");
    // Bildene står etter sitt avvik og før neste.
    const text = words(pdf.text);
    expect(text.indexOf("Bildetekst en")).toBeGreaterThan(text.indexOf("Kostnad 20 000"));
    expect(text.indexOf("Bildetekst en")).toBeLessThan(text.indexOf("HMS Rett i skjemaet"));
  });

  it("et avvikskort som får plass, står samlet på én side", () => {
    const page = draft.pdf.pages.find((item) => item.text.includes("TG2 Vesentlige avvik Rett"))!;
    expect(page.text).toContain("Kostnad ca. 40 000 kr");
  });

  it("selskap mangler: bunnteksten sier fra på hver side, og forsiden har ikke «Utført av»", async () => {
    const data = bathroomPdfData("release");
    data.company = null;
    const pdf = inspectPdf(
      (await render(data, BYGGCON_STANDARD_PROFILE, options({ draft: false }))).bytes,
    );
    for (const page of pdf.pages) {
      expect(page.lines[page.lines.length - 1]!.text).toMatch(
        /^Juridisk selskap mangler på oppdraget 26-1042 Side \d+ av \d+$/,
      );
    }
    expect(pdf.text).not.toContain("Utført av");
  });
});

describe("4.4 bilder", () => {
  it("bildene står under sitt avvik, med bildetekst, og markeringen er et vektorlag over bildet", () => {
    const page = draft.pdf.pages.find((item) => item.text.includes("Bildetekst en"))!;
    const images = page.images.sort((a, b) => a.bbox[0] - b.bbox[0]);
    expect(images).toHaveLength(2);
    const marked = (bbox: [number, number, number, number]) =>
      page.vectorPaths.filter(
        (path) =>
          path.stroke === "#c0392b" &&
          path.bbox[0] >= bbox[0] - 1 &&
          path.bbox[2] <= bbox[2] + 1 &&
          path.bbox[1] >= bbox[1] - 1 &&
          path.bbox[3] <= bbox[3] + 1,
      );
    expect(marked(images[0]!.bbox).length).toBeGreaterThanOrEqual(2);
    expect(marked(images[1]!.bbox)).toHaveLength(0);
    const caption = page.lines.find((line) => line.text.startsWith("Bildetekst en"))!;
    expect(caption.y).toBeGreaterThan(images[0]!.bbox[3]);
  });

  it("bildene i PDF-en har ingen EXIF eller XMP", () => {
    for (const image of draft.pdf.pages.flatMap((page) => page.images)) {
      const text = Buffer.from(image.bytes).toString("latin1");
      expect(text).not.toMatch(/Exif|GPS|<x:xmpmeta/);
    }
  });
});

describe("grenser og bildesjekk før motoren", () => {
  const noEngine: PdfEngine = () => {
    throw new Error("motoren skal ikke kalles");
  };
  const guarded = createReportPdfRenderer(noEngine);

  function withImages(images: ReturnType<typeof testImage>[]): ReportPdfData {
    const data = bathroomPdfData("draft");
    for (const checkpoint of data.rooms[0]!.checkpoints) {
      for (const deviation of checkpoint.deviations) deviation.images = [];
    }
    data.rooms[0]!.checkpoints[0]!.deviations[0]!.images = images;
    return data;
  }

  async function code(data: ReportPdfData, limits: PdfLimits = PDF_DEFAULT_LIMITS) {
    try {
      await guarded(data, BYGGCON_STANDARD_PROFILE, options({ limits }));
    } catch (error) {
      expect(error).toBeInstanceOf(PdfRenderError);
      return (error as InstanceType<typeof PdfRenderError>).code;
    }
    return "ok";
  }

  it.each([
    [
      "JPEG med GPS i EXIF",
      { format: "jpeg" as const, bytes: jpeg(APP0, APP1_EXIF, SOF0), widthPx: 1, heightPx: 1 },
    ],
    [
      "JPEG med XMP",
      { format: "jpeg" as const, bytes: jpeg(APP0, APP1_XMP, SOF0), widthPx: 1, heightPx: 1 },
    ],
    [
      "PNG med eXIf",
      {
        bytes: pngBytes(8, 8, [{ type: "eXIf", data: new Uint8Array(8) }]),
        widthPx: 8,
        heightPx: 8,
      },
    ],
    ["PNG kalt JPEG", { format: "jpeg" as const }],
    ["feil mål", { widthPx: 10 }],
    ["SVG", { bytes: new TextEncoder().encode("<svg/>") }],
  ])("%s avvises med invalid_image", async (_name, overrides) => {
    expect(await code(withImages([testImage("x", null, overrides)]))).toBe("invalid_image");
  });

  it.each([
    ["negative tall", { type: "circle", center: { x: -0.1, y: 0.5 }, radius: 0.1 }],
    [
      "større enn bildet",
      { type: "rectangle", topLeft: { x: 0.8, y: 0.1 }, width: 0.5, height: 0.2 },
    ],
    ["NaN", { type: "arrow", from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } }],
    ["uendelig", { type: "circle", center: { x: 0.5, y: 0.5 }, radius: Number.POSITIVE_INFINITY }],
    ["ukjent type", { type: "svg", d: "M0 0" }],
    ["tekst i stedet for tall", { type: "circle", center: { x: "0.5", y: 0.5 }, radius: 0.1 }],
    ["HTML", "<img src=x onerror=alert(1)>"],
  ])("markering med %s avvises med invalid_marking", async (_name, marking) => {
    const image = testImage("x", null, { markings: [marking as never] });
    expect(await code(withImages([image]))).toBe("invalid_marking");
  });

  it("for mange bilder, for store bilder og for lang side avvises før motoren", async () => {
    const two = [testImage("a", null), testImage("b", null)];
    expect(await code(withImages(two), { ...PDF_DEFAULT_LIMITS, maxImages: 1 })).toBe(
      "too_many_images",
    );
    expect(await code(withImages(two), { ...PDF_DEFAULT_LIMITS, maxImageBytesTotal: 10 })).toBe(
      "images_too_large",
    );
    expect(await code(withImages(two), { ...PDF_DEFAULT_LIMITS, maxImageEdgePx: 100 })).toBe(
      "images_too_large",
    );
  });

  it("en feil fra motoren blir engine_failed uten motorens melding", async () => {
    const failing = createReportPdfRenderer(() =>
      Promise.reject(new Error("Prøvevegen 1 hemmelig melding")),
    );
    const error = await failing(bathroomPdfData(), BYGGCON_STANDARD_PROFILE, options()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PdfRenderError);
    expect((error as InstanceType<typeof PdfRenderError>).code).toBe("engine_failed");
    expect(String((error as Error).message)).not.toContain("Prøvevegen");
    expect(String((error as Error).stack)).not.toContain("hemmelig");
  });
});

describe("4.5 egenskaper", () => {
  it("tittel, språk, tagget, og ingen adresse eller navn i Info eller XMP", () => {
    expect(draft.pdf.info.title).toBe("UTKAST – Tilstandsrapport 26-1042");
    expect(release.pdf.info.title).toBe("Tilstandsrapport 26-1042, versjon 1");
    expect(draft.pdf.lang).toBe("nb");
    expect(draft.pdf.tagged).toBe(true);
    const meta = JSON.stringify(draft.pdf.info) + (draft.pdf.xmp ?? "");
    for (const marker of ["Prøvevegen", "Prøvestad", "Gnr.", "Testselskap"]) {
      expect(meta).not.toContain(marker);
    }
    expect(draft.pdf.info.author ?? "").toBe("");
  });

  it("skriftene er innebygd fra repoet", () => {
    expect(draft.pdf.fonts).toEqual(
      expect.arrayContaining(["Inter-Regular", "Inter-SemiBold", "SchibstedGrotesk-Bold"]),
    );
  });
});

describe("4.6 malinjeksjon og lukket motor", () => {
  it("tekst som ligner kode står som vanlig tekst; ingen nettkall, ingen fillesing, ingen temp-filer", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const injection = [
      "<script>alert(1)</script>",
      `<img src=http://127.0.0.1:${port}/x.png>`,
      "<img src=x onerror=alert(1)>",
      "</style>",
      `url(http://127.0.0.1:${port}/a)`,
      "@import 'x'",
      "{{7*7}}",
      '#import "x"',
      '#read("/etc/passwd")',
      "file:///etc/passwd",
      `#image("http://127.0.0.1:${port}/b.png")`,
    ];
    const data = bathroomPdfData("draft");
    data.cover.addressLines = ['#read("/etc/passwd")'];
    const deviation = data.rooms[0]!.checkpoints[0]!.deviations[0]!;
    deviation.measures = injection;
    deviation.text = "$ x^2 $ *fet* _kursiv_ `kode` <label> @ref \\";
    deviation.images[0]!.caption = "#sys.inputs";
    const tmpBefore = readdirSync(tmpdir()).length;
    try {
      const pdf = inspectPdf((await render(data, BYGGCON_STANDARD_PROFILE, options())).bytes);
      const text = words(pdf.text);
      for (const line of injection) expect(text).toContain(line);
      expect(text).toContain("$ x^2 $ *fet* _kursiv_ `kode` <label> @ref \\");
      expect(text).toContain("#sys.inputs");
      expect(text).not.toMatch(/\b49\b/);
      expect(text).not.toContain("root:");
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(readdirSync(tmpdir()).length).toBe(tmpBefore);
  });

  it.each([
    ["fil utenfor roten", '#read("/etc/passwd")'],
    ["pakke fra nettet", '#import "@preview/cetz:0.3.0"'],
    ["bilde fra nettet", '#image("https://example.invalid/x.png")'],
  ])("motoren avviser %s", async (_name, source) => {
    const error = await engine(
      { output: "pdf", source, inputs: {}, files: [], fonts: assets.fonts },
      { timeoutMs: 10_000 },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfRenderError);
    expect((error as InstanceType<typeof PdfRenderError>).code).toBe("engine_failed");
  });

  it("tidsavbrudd stopper tråden og gir koden timeout", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const started = performance.now();
    const error = await engine(
      {
        output: "pdf",
        source: "#range(30000).map(i => range(30000).map(j => i * j).sum()).sum()",
        inputs: {},
        files: [],
        fonts: assets.fonts,
      },
      { timeoutMs: 300 },
    ).catch((caught: unknown) => caught);
    expect((error as InstanceType<typeof PdfRenderError>).code).toBe("timeout");
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(terminate).toHaveBeenCalled();
  });

  it("to PDF-er for to organisasjoner samtidig har bare sitt eget innhold", async () => {
    const a = bathroomPdfData("draft");
    a.cover.addressLines = ["Merke A-vegen 1"];
    const b = bathroomPdfData("draft");
    b.cover.addressLines = ["Merke B-vegen 2"];
    b.company = { legalName: "Annet prøveselskap AS", orgNumber: "888 888 888" };
    const [pdfA, pdfB] = (
      await Promise.all([
        render(a, BYGGCON_STANDARD_PROFILE, options()),
        render(b, BYGGCON_STANDARD_PROFILE, options()),
      ])
    ).map((result) => inspectPdf(result.bytes).text);
    expect(pdfA).toContain("Merke A-vegen 1");
    expect(pdfA).not.toContain("Merke B");
    expect(pdfA).not.toContain("Annet prøveselskap");
    expect(pdfB).toContain("Merke B-vegen 2");
    expect(pdfB).not.toContain("Merke A");
  });
});

describe("serverinngangen", () => {
  it("renderReportPdf fra index er koblet til motoren", async () => {
    const result = await renderReportPdf(
      bathroomPdfData("release"),
      BYGGCON_STANDARD_PROFILE,
      options({ draft: false }),
    );
    expect(result.pageCount).toBe(release.pageCount);
    expect(sha(result.bytes)).toBe(sha(release.bytes));
  });

  it("et utkast blir aldri en ferdig rapport, selv om draft er usann", async () => {
    const result = await render(
      bathroomPdfData("draft"),
      BYGGCON_STANDARD_PROFILE,
      options({ draft: false }),
    );
    expect(inspectPdf(result.bytes).text).toContain("UTKAST");
  });

  it("ugyldig generatedAt avvises", async () => {
    await expect(
      render(bathroomPdfData(), BYGGCON_STANDARD_PROFILE, options({ generatedAt: new Date("x") })),
    ).rejects.toBeInstanceOf(PdfRenderError);
  });

  it("PDF-en er en PDF (selvtest av leseren)", () => {
    expect(Buffer.from(draft.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(() => inspectPdf(new TextEncoder().encode("ikke pdf"))).toThrow();
  });
});
