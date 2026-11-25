import { describe, expect, it } from "vitest";
import {
  bathroomPdfData,
  IDS,
  TEST_LANDSCAPE_PROFILE,
  testImage,
} from "../../../tests/pdf-fixtures";
import {
  formatPdfDate,
  isSafeEditPath,
  layoutImage,
  layoutReportPdf,
  normalizeAppBaseUrl,
  pdfTitle,
  type LayoutOptions,
  type LayoutSection,
  type PdfLayout,
} from "./layout";
import { BYGGCON_STANDARD_PROFILE } from "./profiles";
import type { PdfProfile, ReportPdfData } from "./types";

/*
 * Oppsettet uten motor (testplanen 3.5). Ren, uten database. Støtter hovedmål: færre reklamasjoner
 * (ingen tomme overskrifter, ingen interne lenker i rapporten kunden får) og de ansatte (lenker fra
 * utkastet rett til feltet).
 */

const NOW = new Date("2026-11-03T10:00:00Z");
const BASE = "https://app.example.invalid";

function options(overrides: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    draft: true,
    generatedAt: NOW,
    appBaseUrl: BASE,
    logoPath: "/assets/logo",
    imagePath: (image) => `/assets/img/${image.id}.png`,
    ...overrides,
  };
}

function layout(
  data: ReportPdfData,
  overrides: Partial<LayoutOptions> = {},
  profile: PdfProfile = BYGGCON_STANDARD_PROFILE,
): PdfLayout {
  return layoutReportPdf(data, profile, options(overrides));
}

const kinds = (result: PdfLayout) => result.sections.map((section) => section.kind);
const room = (result: PdfLayout) =>
  result.sections.find((section) => section.kind === "room") as Extract<
    LayoutSection,
    { kind: "room" }
  >;
const allText = (result: PdfLayout) => JSON.stringify(result);

function withoutDeviations(data: ReportPdfData): ReportPdfData {
  for (const checkpoint of data.rooms[0]!.checkpoints) checkpoint.deviations = [];
  return data;
}
function withoutTgiu(data: ReportPdfData): ReportPdfData {
  for (const checkpoint of data.rooms[0]!.checkpoints) checkpoint.tgiu = null;
  return data;
}
function withoutImages(data: ReportPdfData): ReportPdfData {
  for (const checkpoint of data.rooms[0]!.checkpoints) {
    for (const deviation of checkpoint.deviations) deviation.images = [];
  }
  return data;
}

describe("rekkefølgen og delene", () => {
  it("utkast: forside, innhold, TG-forklaring, rom og «Ikke med i PDF-en», i profilens rekkefølge", () => {
    expect(kinds(layout(bathroomPdfData()))).toEqual([
      "cover",
      "toc",
      "tg_explanation",
      "room",
      "missing",
    ]);
  });

  it("summary er reservert og gir ingen side", () => {
    expect(kinds(layout(bathroomPdfData()))).not.toContain("summary");
  });

  it("3.5.5 annen delrekkefølge i profilen gir annen rekkefølge, men samme tekst", () => {
    const profile: PdfProfile = {
      ...TEST_LANDSCAPE_PROFILE,
      sections: ["cover", "toc", "room", "tg_explanation", "missing"],
    };
    const other = layout(bathroomPdfData(), {}, profile);
    expect(kinds(other)).toEqual(["cover", "toc", "room", "tg_explanation", "missing"]);
    expect(other.page.flipped).toBe(true);
    const texts = (result: PdfLayout) =>
      result.toc.map((entry) => entry.text).sort((a, b) => a.localeCompare(b));
    expect(texts(other)).toEqual(texts(layout(bathroomPdfData())));
  });
});

describe("3.5.1 tomme deler gir ingen overskrift og står ikke i innholdsfortegnelsen", () => {
  it.each([
    [
      "uten avvik",
      withoutDeviations,
      ["Prøvetekst for årsaken", "Prøvetiltak", "40\u00a0000", '"text":"HMS"'],
    ],
    ["uten TGIU", withoutTgiu, ["Hva og hvorfor", "Risiko"]],
    ["uten bilder", withoutImages, ["Bildetekst en"]],
  ] as const)("%s", (_name, change, absent) => {
    const result = layout(change(bathroomPdfData()));
    const text = JSON.stringify(result.sections);
    for (const word of absent) expect(text).not.toContain(word);
    if (change === withoutDeviations) {
      expect(room(result).checkpoints.every((cp) => cp.deviations.length === 0)).toBe(true);
    }
  });

  it("avvik uten tiltak, årsak eller kostnad har ingen slike rader", () => {
    const result = layout(bathroomPdfData("release"));
    const drain = room(result).checkpoints.find((cp) => cp.title === "Sluk")!;
    expect(drain.deviations[0]!.measures).toEqual([]);
    expect(drain.deviations[0]!.cause).toBeNull();
  });

  it("rom uten innhold gir ingen overskrift og ingen linje i innholdsfortegnelsen", () => {
    const data = bathroomPdfData("release");
    data.rooms.push({
      roomId: "0193a000-0000-7000-8000-0000000000aa",
      roomType: "bathroom",
      title: "Tomt bad",
      buildingName: null,
      floorName: null,
      answers: [{ elementKey: "x", label: "Tom", valueText: "  " }],
      checkpoints: [],
    });
    const result = layout(data, { draft: false });
    expect(allText(result)).not.toContain("Tomt bad");
    expect(result.toc.some((entry) => entry.text.includes("Tomt bad"))).toBe(false);
  });

  it("punkt der bare utkastmerknader gjør det synlig, er borte i endelig PDF", () => {
    const data = bathroomPdfData("draft");
    const ventilation = data.rooms[0]!.checkpoints.find((cp) => cp.label === "Ventilasjon")!;
    ventilation.descriptionText = null;
    expect(room(layout(data)).checkpoints.map((cp) => cp.title)).toContain("Ventilasjon");
    expect(room(layout(data, { draft: false })).checkpoints.map((cp) => cp.title)).not.toContain(
      "Ventilasjon",
    );
  });

  it("uten TG-forklaring og uten rom står bare forsiden igjen", () => {
    const data = bathroomPdfData("release");
    data.rooms = [];
    data.tgExplanation.items = [];
    expect(kinds(layout(data, { draft: false }))).toEqual(["cover"]);
  });
});

describe("3.5.2 og 3.5.3 utkastdelene", () => {
  it("«Ikke med i PDF-en» bare i utkast, og bare når noe mangler", () => {
    expect(kinds(layout(bathroomPdfData()))).toContain("missing");
    expect(kinds(layout(bathroomPdfData(), { draft: false }))).not.toContain("missing");
    const nothingMissing = bathroomPdfData();
    nothingMissing.missing = { reportNotes: [], emptyCheckpoints: [] };
    expect(kinds(layout(nothingMissing))).not.toContain("missing");
  });

  it("«Ikke satt», «Mangler» og «Sjekk» bare i utkast", () => {
    const draft = allText(layout(bathroomPdfData()));
    expect(draft).toContain("Ikke satt");
    expect(draft).toContain("Mangler: Prøvetekst for det som mangler.");
    expect(draft).toContain("Sjekk: Prøvetekst fra sjekken.");
    // Samme data med draft: false (merknadene er fortsatt i dataene).
    const final = allText(layout(bathroomPdfData(), { draft: false }));
    for (const word of ["Ikke satt", "Mangler", "Sjekk", "UTKAST"]) {
      expect(final).not.toContain(word);
    }
  });

  it("«Mangler» står før «Sjekk»", () => {
    const data = bathroomPdfData();
    const cp = data.rooms[0]!.checkpoints[0]!;
    cp.notes = [
      { kind: "check", checkCode: "a", text: "B" },
      { kind: "missing", checkCode: "b", text: "A" },
    ];
    const notes = room(layout(data)).checkpoints[0]!.notes.map((note) => note.text);
    expect(notes).toEqual(["Mangler: A", "Sjekk: B"]);
  });

  it("HMS-avvik har HMS-merket, aldri TG; avvik uten TG har «Ikke satt» bare i utkast", () => {
    const data = bathroomPdfData();
    const drain = data.rooms[0]!.checkpoints[1]!.deviations[0]!;
    drain.tg = null;
    drain.tgNotSet = true;
    const draftRoom = room(layout(data));
    expect(draftRoom.checkpoints[0]!.deviations[1]!.badge?.text).toBe("HMS");
    expect(draftRoom.checkpoints[1]!.deviations[0]!.badge?.style).toBe("not_set");
    expect(room(layout(data, { draft: false })).checkpoints[1]!.deviations[0]!.badge).toBeNull();
  });
});

describe("3.5.4 lenker til skjemaet (F4)", () => {
  const ID = "[0-9a-f-]{36}";
  const LINK = new RegExp(`^${BASE}/oppdrag/${ID}/rom/${ID}#(punkt|avvik)-${ID}$`);

  function links(result: PdfLayout): string[] {
    const found: string[] = [];
    JSON.stringify(result, (key, value: unknown) => {
      if (key === "url" && typeof value === "string") found.push(value);
      return value;
    });
    return found;
  }

  it("utkast med appBaseUrl: hvert punkt og avvik har lenke med bare id-er", () => {
    const result = links(layout(bathroomPdfData()));
    expect(result).toContain(
      `${BASE}/oppdrag/${IDS.assignment}/rom/${IDS.room}#punkt-${IDS.cpMembrane}`,
    );
    expect(result).toContain(
      `${BASE}/oppdrag/${IDS.assignment}/rom/${IDS.room}#avvik-${IDS.devMembrane}`,
    );
    for (const url of result) expect(url).toMatch(LINK);
  });

  it.each([
    ["draft: false", { draft: false }],
    ["tom appBaseUrl", { appBaseUrl: null }],
  ])("%s gir ingen interne lenker", (_name, overrides) => {
    expect(links(layout(bathroomPdfData(), overrides))).toEqual([]);
  });

  it("en sti som ikke bare har id-er, gir ingen lenke", () => {
    const data = bathroomPdfData();
    data.rooms[0]!.checkpoints[0]!.editPath = "/oppdrag/x/rom/y#punkt-<script>";
    expect(room(layout(data)).checkpoints[0]!.link).toBeNull();
    expect(isSafeEditPath(`/oppdrag/${IDS.assignment}/rom/${IDS.room}#punkt-${IDS.cpDrain}`)).toBe(
      true,
    );
    expect(isSafeEditPath("https://example.invalid/oppdrag/a/rom/b#punkt-c")).toBe(false);
  });

  it.each([
    ["https://app.example.invalid/", "https://app.example.invalid"],
    ["https://app.example.invalid/sti/?q=1#x", "https://app.example.invalid/sti"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["javascript:alert(1)", null],
    ["file:///etc/passwd", null],
    ["https://bruker:hemmelig@app.example.invalid", null],
    ["", null],
    [undefined, null],
    ["ikke en adresse", null],
  ])("normalizeAppBaseUrl(%s) = %s", (input, expected) => {
    expect(normalizeAppBaseUrl(input)).toBe(expected);
  });
});

describe("forsiden, bunnteksten og egenskapene", () => {
  it("forsiden har adresse, matrikkel, oppdragsnummer, dato og selskapets navn", () => {
    const cover = layout(bathroomPdfData()).sections[0]!;
    expect(cover).toMatchObject({
      kind: "cover",
      title: "Tilstandsrapport",
      addressLines: ["Prøvevegen 1", "8000 Prøvestad"],
      cadastralText: "Gnr. 999, bnr. 9",
      facts: [
        { label: "Oppdragsnummer", value: "26-1042" },
        { label: "Befaringsdato", value: "03.11.2026" },
        { label: "Utført av", value: "Testselskap takst AS" },
      ],
    });
  });

  it("uten befaringsdato og selskap: radene finnes ikke, og bunnteksten sier fra", () => {
    const data = bathroomPdfData();
    data.cover.inspectionDate = null;
    data.company = null;
    const result = layout(data);
    const cover = result.sections[0] as Extract<LayoutSection, { kind: "cover" }>;
    expect(cover.facts.map((fact) => fact.label)).toEqual(["Oppdragsnummer"]);
    expect(result.footer[0]).toEqual({
      kind: "legal_company",
      text: "Juridisk selskap mangler på oppdraget",
      missing: true,
    });
  });

  it("bunnteksten har tre faste deler, og et langt selskapsnavn kortes med org.nr. med", () => {
    const data = bathroomPdfData();
    data.company = {
      legalName: "Et svært langt oppdiktet selskapsnavn for prøving AS",
      orgNumber: "999 999 999",
    };
    const [company, number, pages] = layout(data).footer;
    expect(company).toMatchObject({ kind: "legal_company", missing: false });
    expect((company as { text: string }).text).toMatch(/…\s·\sorg\.nr\. 999 999 999$/);
    expect(number).toEqual({ kind: "assignment_number", text: "26-1042" });
    expect(pages).toEqual({ kind: "page_of_pages", prefix: "Side", middle: "av" });
  });

  it("tittelen har oppdragsnummeret, aldri adressen", () => {
    expect(pdfTitle(bathroomPdfData(), true)).toBe("UTKAST – Tilstandsrapport 26-1042");
    expect(pdfTitle(bathroomPdfData("release"), false)).toBe("Tilstandsrapport 26-1042, versjon 1");
    expect(layout(bathroomPdfData()).meta.date).toEqual([2026, 11, 3, 10, 0, 0]);
  });

  it.each([
    ["2026-11-24", "24.11.2026"],
    ["2026-1-2", null],
    [null, null],
  ])("formatPdfDate(%s) = %s", (input, expected) => {
    expect(formatPdfDate(input)).toBe(expected);
  });

  it("samme inndata gir samme modell (ingen klokke eller tilfeldighet)", () => {
    expect(allText(layout(bathroomPdfData()))).toBe(allText(layout(bathroomPdfData())));
  });
});

describe("bilder og innholdsfortegnelse", () => {
  it("bildene skaleres inn i rammen 84 × 63 mm, og markeringen følger bildet", () => {
    const wide = layoutImage(
      {
        image: testImage("i", null, {
          widthPx: 8000,
          heightPx: 2000,
          markings: [{ type: "rectangle", topLeft: { x: 0.5, y: 0.5 }, width: 0.5, height: 0.5 }],
        }),
        path: "/assets/img/1.png",
      },
      "Bilde til avvik på Sluk",
    );
    expect(wide).toMatchObject({ widthMm: 84, heightMm: 21, alt: "Bilde til avvik på Sluk" });
    expect(wide.markings[0]).toEqual({
      type: "rectangle",
      x: 42,
      y: 10.5,
      width: 42,
      height: 10.5,
    });
    const tall = layoutImage(
      { image: testImage("j", "Tekst", { widthPx: 600, heightPx: 1800 }), path: "p" },
      "x",
    );
    expect(tall).toMatchObject({ widthMm: 21, heightMm: 63, alt: "Tekst", caption: "Tekst" });
  });

  it("to bilder per rad, i lagret rekkefølge, under sitt avvik", () => {
    const deviation = room(layout(bathroomPdfData())).checkpoints[0]!.deviations[0]!;
    expect(deviation.imageRows.map((row) => row.map((image) => image.caption))).toEqual([
      ["Bildetekst en", "Bildetekst to"],
    ]);
  });

  it("innholdsfortegnelsen har delene og punktene med kort TG, og ankrene finnes", () => {
    const result = layout(bathroomPdfData());
    expect(result.toc.map((entry) => [entry.level, entry.text, entry.tg?.text ?? null])).toEqual([
      [1, "Slik leser du TG", null],
      [1, "Bad · 1. etasje", null],
      [2, "Membran og tettesjikt", "TG3"],
      [2, "Sluk", "TG2"],
      [2, "Tilliggende konstruksjoner", "TGIU"],
      [2, "Ventilasjon", null],
      [1, "Ikke med i PDF-en", null],
    ]);
    const anchors = new Set(result.toc.map((entry) => entry.anchor));
    expect(anchors.size).toBe(result.toc.length);
    const text = allText(result);
    for (const anchor of anchors) expect(text).toContain(`"anchor":"${anchor}"`);
  });

  it("TG-merket i lang form er det samme som på skjermen", () => {
    const cp = room(layout(bathroomPdfData())).checkpoints[0]!;
    expect(cp.badge).toEqual({
      style: "tg",
      text: "TG3 Store eller alvorlige avvik",
      background: "#f8d0cc",
      color: "#8b2a1f",
    });
  });
});
