import { TG_BADGE_SHORT, tgBadgeFullText } from "@/shared/ui/tg-badge";
import { PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN, PDF_PAGE_ANCHOR_ID_PATTERN } from "./codes";
import { PDF_TEXTS } from "./pdf-texts";
import type {
  PdfAnswer,
  PdfCheckpoint,
  PdfColor,
  PdfDeviation,
  PdfDraftMarkKind,
  PdfDraftNote,
  PdfImage,
  PdfMarking,
  PdfPageAnchor,
  PdfProfile,
  PdfRoom,
  PdfTg,
  ReportPdfData,
} from "./types";

/*
 * Oppsettet av PDF-en som ren logikk (docs/funksjoner/fase2a-pdf-badet-design.md avsnitt 2–4).
 * Bestemmer hvilke deler, overskrifter, merker, lenker og rader som står i PDF-en, og i hvilken
 * rekkefølge. Typst-malen (`template.ts`) tegner bare det som står her. Ingen klokke, ingen
 * tilfeldighet, ingen filer: samme inndata gir samme modell.
 *
 * Tomme deler gir ingen overskrift og står ikke i innholdsfortegnelsen. Utkastdelene (merknader,
 * «Ikke satt», lenker og siden «Ikke med i PDF-en») er bare med når `draft` er sann.
 *
 * Sidekartet (tillegget til ADR 0016, punkt 17): bare når `pageMap` er sann får avsnittene et
 * anker (`LayoutPageMark`), og malen skriver usynlige start- og sluttmerker rundt dem. Ellers er
 * alle merkene `null`, og malen tegner nøyaktig det samme som før (fast SHA-256 i
 * `render-unchanged.test.ts`). Ankrene bygges fra `checkpointId`, `deviationId` og `elementKey`,
 * aldri fra `editPath` og aldri fra tellerne `a1`, `a2`.
 */

// --- Modellen malen får (JSON i `sys.inputs.data`) ---------------------------------------------

export type LayoutBadge = {
  /** `tg`: fylt pille i TG-fargen. `not_set`: hvit med stiplet kant. `hms`: flat pille i panel. */
  style: "tg" | "not_set" | "hms";
  text: string;
  background: PdfColor;
  color: PdfColor;
};

/** Lenken til skjemaet. Motoren gir lenken adressen som alternativ tekst. */
export type LayoutLink = { url: string };

export type LayoutNote = { kind: "missing" | "check"; text: string; link: LayoutLink | null };

export type LayoutRow = { label: string; value: string };

/** Et avsnitt i sidekartet: ankeret og utkastmerket. Bare id-er og faste koder, aldri tekst. */
export type LayoutPageMark = { anchor: PdfPageAnchor; mark: PdfDraftMarkKind | null };

/** Merkene for et avvikskort. `null` for deler som ikke står i kortet. */
export type LayoutDeviationPageMarks = {
  deviation: LayoutPageMark;
  text: LayoutPageMark | null;
  cause: LayoutPageMark | null;
  consequence: LayoutPageMark | null;
  measures: LayoutPageMark | null;
  cost: LayoutPageMark | null;
};

/** Merkene for et kontrollpunkt. `answers` står i samme rekkefølge som radene i `answers`. */
export type LayoutCheckpointPageMarks = {
  checkpoint: LayoutPageMark;
  description: LayoutPageMark | null;
  answers: (LayoutPageMark | null)[];
  tgiu: LayoutPageMark | null;
};

/** Mål i millimeter, regnet fra bildet og rammen. Markeringene er i samme mål, fra øverste venstre. */
export type LayoutMarking =
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "rectangle"; x: number; y: number; width: number; height: number };

export type LayoutImage = {
  path: string;
  alt: string;
  caption: string | null;
  widthMm: number;
  heightMm: number;
  markings: LayoutMarking[];
};

export type LayoutDeviation = {
  anchor: string;
  badge: LayoutBadge | null;
  stroke: PdfColor;
  link: LayoutLink | null;
  notes: LayoutNote[];
  text: string | null;
  cause: string | null;
  consequence: string | null;
  measures: string[];
  /** Kostnaden som udelelig enhet, og `cost_text` under den. */
  cost: { display: string | null; text: string | null } | null;
  /** To bilder per rad. */
  imageRows: LayoutImage[][];
  continued: string;
  /** Bare med sidekart, ellers `null`. */
  pageMarks: LayoutDeviationPageMarks | null;
};

export type LayoutTgiu = {
  badge: LayoutBadge;
  rows: LayoutRow[];
  ownerInformedText: string | null;
};

export type LayoutCheckpoint = {
  anchor: string;
  title: string;
  badge: LayoutBadge | null;
  link: LayoutLink | null;
  notes: LayoutNote[];
  description: string | null;
  answers: LayoutRow[];
  deviations: LayoutDeviation[];
  tgiu: LayoutTgiu | null;
  /** Bare med sidekart, ellers `null`. */
  pageMarks: LayoutCheckpointPageMarks | null;
};

export type LayoutSection =
  | {
      kind: "cover";
      title: string;
      addressLines: string[];
      cadastralText: string | null;
      facts: LayoutRow[];
      logo: { path: string; alt: string } | null;
    }
  | { kind: "toc"; heading: string }
  | {
      kind: "tg_explanation";
      anchor: string;
      heading: string;
      items: { badge: LayoutBadge; text: string }[];
      hmsText: string;
    }
  | {
      kind: "room";
      anchor: string;
      heading: string;
      answers: LayoutRow[];
      checkpoints: LayoutCheckpoint[];
    }
  | {
      kind: "missing";
      anchor: string;
      heading: string;
      intro: string;
      reportNotes: LayoutNote[];
      emptyHeading: string | null;
      empty: { label: string; link: LayoutLink | null; pageMark: LayoutPageMark | null }[];
    };

export type LayoutTocEntry = {
  level: 1 | 2;
  text: string;
  anchor: string;
  /** Kort TG («TG3») foran sidetallet. Bare kontrollpunkter med TG. */
  tg: LayoutBadge | null;
};

export type LayoutFooterPart =
  | { kind: "legal_company"; text: string; missing: boolean }
  | { kind: "assignment_number"; text: string }
  | { kind: "page_of_pages"; prefix: string; middle: string };

export type PdfLayout = {
  meta: {
    title: string;
    /** År, måned, dag, time, minutt, sekund i UTC, fra `generatedAt`. */
    date: [number, number, number, number, number, number];
  };
  draft: { banner: string; watermark: string } | null;
  page: { flipped: boolean };
  colors: PdfProfile["colors"] & { page: PdfColor };
  fonts: PdfProfile["fonts"];
  texts: {
    cause: string;
    consequence: string;
    measures: string;
    cost: string;
    draftLink: string;
  };
  footer: LayoutFooterPart[];
  toc: LayoutTocEntry[];
  sections: LayoutSection[];
  /** Sann gir usynlige merker for sidekartet (bare forhåndsvisningen). */
  pageMap: boolean;
};

/** Et bilde som har bestått sjekken, med stien malen finner det under. */
export type LayoutImageInput = { image: PdfImage; path: string };

export type LayoutOptions = {
  draft: boolean;
  generatedAt: Date;
  /** Allerede sjekket av `normalizeAppBaseUrl`. `null` gir ingen interne lenker. */
  appBaseUrl: string | null;
  /** Stien til logoen i `files`, eller `null` når profilen ikke har logo i `PdfAssets`. */
  logoPath: string | null;
  /** Bildene etter sjekken, slått opp på `PdfImage.id` og rekkefølgen i avviket. */
  imagePath: (image: PdfImage) => string;
  /** Sann gir ankere og merker for sidekartet (bare forhåndsvisningen). Utelatt er `false`. */
  pageMap?: boolean;
};

// --- Faste mål (design avsnitt 2.4) --------------------------------------------------------------

/** Bilderammen: 84 × 63 mm (4:3). Bildet skaleres inn i rammen uten å beskjæres. */
export const IMAGE_FRAME_MM = { width: 84, height: 63 } as const;
/** Bunnteksten: selskapsnavnet kortes slik at navn og org.nr. alltid får plass. */
export const FOOTER_COMPANY_MAX_CHARS = 44;

const WHITE: PdfColor = "#ffffff";

// --- Hjelpere ----------------------------------------------------------------------------------

/** «2026-11-24» blir «24.11.2026». Annet format gir `null` (raden vises da ikke). */
export function formatPdfDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Tekst som er tom eller bare mellomrom, regnes som tom. */
function present(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  return text.trim() === "" ? null : text;
}

/**
 * Adressen til appen, bare fra serveroppsettet (F4). Bare `http` og `https`, uten søk, anker og
 * avsluttende skråstrek. Tom eller ugyldig gir `null`, og da lages ingen interne lenker.
 */
export function normalizeAppBaseUrl(appBaseUrl: string | undefined): string | null {
  const value = appBaseUrl?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Stien til skjemaet har bare id-er og faste ord (F4): `/oppdrag/<id>/rom/<id>#punkt-<id>`. */
const EDIT_PATH =
  /^\/oppdrag\/[0-9a-f-]{1,36}\/rom\/[0-9a-f-]{1,36}#(?:punkt|avvik)-[0-9a-f-]{1,36}$/;

export function isSafeEditPath(editPath: string): boolean {
  return EDIT_PATH.test(editPath);
}

function editLink(
  editPath: string | null,
  options: Pick<LayoutOptions, "draft" | "appBaseUrl">,
): LayoutLink | null {
  if (!options.draft || !options.appBaseUrl || !editPath || !isSafeEditPath(editPath)) return null;
  return { url: `${options.appBaseUrl}${editPath}` };
}

export function tgBadge(tg: PdfTg, profile: PdfProfile, form: "long" | "short"): LayoutBadge {
  const tone = profile.colors.tg[tg];
  return {
    style: "tg",
    text: form === "long" ? tgBadgeFullText(tg) : TG_BADGE_SHORT[tg],
    background: tone.background,
    color: tone.text,
  };
}

function notSetBadge(profile: PdfProfile): LayoutBadge {
  return {
    style: "not_set",
    text: PDF_TEXTS.draft.notSet,
    background: WHITE,
    color: profile.colors.text,
  };
}

function hmsBadge(profile: PdfProfile): LayoutBadge {
  return {
    style: "hms",
    text: PDF_TEXTS.deviation.hms,
    background: profile.colors.panel,
    color: profile.colors.text,
  };
}

/** «Mangler» før «Sjekk», ellers i rekkefølgen fra publiseringssjekken. Bare i utkast. */
function layoutNotes(
  notes: readonly PdfDraftNote[],
  link: LayoutLink | null,
  draft: boolean,
): LayoutNote[] {
  if (!draft) return [];
  const ordered = [
    ...notes.filter((note) => note.kind === "missing"),
    ...notes.filter((note) => note.kind === "check"),
  ];
  return ordered
    .filter((note) => present(note.text) !== null)
    .map((note) => ({
      kind: note.kind,
      text:
        note.kind === "missing"
          ? PDF_TEXTS.draft.missing(note.text)
          : PDF_TEXTS.draft.check(note.text),
      link,
    }));
}

function shownAnswers(answers: readonly PdfAnswer[]): PdfAnswer[] {
  return answers.filter(
    (answer) => present(answer.label) !== null && present(answer.valueText) !== null,
  );
}

function layoutAnswers(answers: readonly PdfAnswer[]): LayoutRow[] {
  return shownAnswers(answers).map((answer) => ({ label: answer.label, value: answer.valueText }));
}

// --- Ankere for sidekartet (A604) ---------------------------------------------------------------

const isAnchorId = (value: unknown): value is string =>
  typeof value === "string" && PDF_PAGE_ANCHOR_ID_PATTERN.test(value);

const isElementKey = (value: unknown): value is string =>
  typeof value === "string" && PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN.test(value);

/**
 * Ankeret for et avsnitt, eller `null` når id-ene ikke har formen sidekartet godtar. Da får
 * avsnittet ikke noe merke, og sidene lages likevel (resten av kartet er riktig).
 */
function pageMark(
  kind: PdfPageAnchor["kind"],
  ids: { checkpointId: string; deviationId?: string; elementKey?: string },
  mark: PdfDraftMarkKind | null = null,
): LayoutPageMark | null {
  if (!isAnchorId(ids.checkpointId)) return null;
  if (ids.deviationId !== undefined && !isAnchorId(ids.deviationId)) return null;
  if (ids.elementKey !== undefined && !isElementKey(ids.elementKey)) return null;
  return {
    anchor: {
      kind,
      checkpointId: ids.checkpointId,
      deviationId: ids.deviationId ?? null,
      elementKey: ids.elementKey ?? null,
    },
    mark,
  };
}

/** Utkastmerket for et kort: «Ikke satt» før «Mangler» før «Sjekk» (`PDF_DRAFT_MARK_KINDS`). */
function draftMark(
  badge: LayoutBadge | null,
  notes: readonly LayoutNote[],
): PdfDraftMarkKind | null {
  if (badge?.style === "not_set") return "tg_not_set";
  if (notes.some((note) => note.kind === "missing")) return "missing";
  if (notes.some((note) => note.kind === "check")) return "check";
  return null;
}

/** Avrundet til hundredels millimeter, så modellen (og PDF-en) blir lik på alle maskiner. */
function mm(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Bildets mål i rammen (84 × 63 mm), uten beskjæring, så markeringen aldri havner utenfor.
 * Markeringene regnes om fra andeler av bildet til millimeter på det tegnede bildet. Radius på en
 * sirkel er en andel av bildets bredde.
 */
export function layoutImage(input: LayoutImageInput, fallbackAlt: string): LayoutImage {
  const { image, path } = input;
  const scale = Math.min(
    IMAGE_FRAME_MM.width / image.widthPx,
    IMAGE_FRAME_MM.height / image.heightPx,
  );
  const width = image.widthPx * scale;
  const height = image.heightPx * scale;
  const caption = present(image.caption);
  return {
    path,
    alt: caption ?? fallbackAlt,
    caption,
    widthMm: mm(width),
    heightMm: mm(height),
    markings: image.markings.map((marking) => layoutMarking(marking, width, height)),
  };
}

function layoutMarking(marking: PdfMarking, width: number, height: number): LayoutMarking {
  switch (marking.type) {
    case "arrow":
      return {
        type: "arrow",
        x1: mm(marking.from.x * width),
        y1: mm(marking.from.y * height),
        x2: mm(marking.to.x * width),
        y2: mm(marking.to.y * height),
      };
    case "circle":
      return {
        type: "circle",
        cx: mm(marking.center.x * width),
        cy: mm(marking.center.y * height),
        r: mm(marking.radius * width),
      };
    case "rectangle":
      return {
        type: "rectangle",
        x: mm(marking.topLeft.x * width),
        y: mm(marking.topLeft.y * height),
        width: mm(marking.width * width),
        height: mm(marking.height * height),
      };
  }
}

function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

function layoutDeviation(
  deviation: PdfDeviation,
  checkpoint: PdfCheckpoint,
  profile: PdfProfile,
  options: LayoutOptions,
  anchor: string,
): LayoutDeviation {
  let badge: LayoutBadge | null = null;
  if (deviation.kind === "hms") badge = hmsBadge(profile);
  else if (deviation.tg) badge = tgBadge(deviation.tg, profile, "long");
  else if (options.draft && deviation.tgNotSet) badge = notSetBadge(profile);

  const causeLabel = present(deviation.causeLabel);
  const causeText = present(deviation.causeText);
  const cause =
    causeLabel && causeText ? `${causeLabel}. ${causeText}` : (causeText ?? causeLabel ?? null);
  const costDisplay = present(deviation.cost.displayText);
  const costText = present(deviation.cost.text);
  const link = editLink(deviation.editPath, options);
  const fallbackAlt = PDF_TEXTS.deviation.imageAlt(checkpoint.label);
  const notes = layoutNotes(deviation.notes, link, options.draft);
  const text = present(deviation.text);
  const consequence = present(deviation.consequenceText);
  const measures = deviation.measures.filter((measure) => present(measure) !== null);
  const cost = costDisplay || costText ? { display: costDisplay, text: costText } : null;

  let pageMarks: LayoutDeviationPageMarks | null = null;
  if (options.pageMap) {
    const ids = { checkpointId: checkpoint.checkpointId, deviationId: deviation.deviationId };
    const whole = pageMark("deviation", ids, draftMark(badge, notes));
    const part = (kind: PdfPageAnchor["kind"], shown: boolean) =>
      shown ? pageMark(kind, ids) : null;
    if (whole) {
      pageMarks = {
        deviation: whole,
        text: part("deviation.text", text !== null),
        cause: part("deviation.cause", cause !== null),
        consequence: part("deviation.consequence", consequence !== null),
        measures: part("deviation.measures", measures.length > 0),
        cost: part("deviation.cost", cost !== null),
      };
    }
  }

  return {
    anchor,
    badge,
    stroke:
      deviation.kind === "tg" && deviation.tg
        ? profile.colors.tg[deviation.tg].stroke
        : profile.colors.rule,
    link,
    notes,
    text,
    cause,
    consequence,
    measures,
    cost,
    imageRows: pairs(
      deviation.images.map((image) =>
        layoutImage({ image, path: options.imagePath(image) }, fallbackAlt),
      ),
    ),
    continued: PDF_TEXTS.deviation.continued(checkpoint.label),
    pageMarks,
  };
}

function layoutTgiu(checkpoint: PdfCheckpoint, profile: PdfProfile): LayoutTgiu | null {
  const tgiu = checkpoint.tgiu;
  if (!tgiu) return null;
  const rows = tgiu.details
    .filter((detail) => present(detail.label) !== null && present(detail.text) !== null)
    .map((detail) => ({ label: detail.label, value: detail.text }));
  const ownerInformedText = present(tgiu.ownerInformedText);
  if (rows.length === 0 && !ownerInformedText) return null;
  return { badge: tgBadge("IU", profile, "long"), rows, ownerInformedText };
}

function layoutCheckpoint(
  checkpoint: PdfCheckpoint,
  profile: PdfProfile,
  options: LayoutOptions,
  anchors: () => string,
): LayoutCheckpoint {
  let badge: LayoutBadge | null = null;
  if (checkpoint.tg) badge = tgBadge(checkpoint.tg, profile, "long");
  else if (options.draft && checkpoint.tgNotSet) badge = notSetBadge(profile);
  const link = editLink(checkpoint.editPath, options);
  const notes = layoutNotes(checkpoint.notes, link, options.draft);
  const description = present(checkpoint.descriptionText);
  const answers = shownAnswers(checkpoint.answers);
  const tgiu = layoutTgiu(checkpoint, profile);

  let pageMarks: LayoutCheckpointPageMarks | null = null;
  if (options.pageMap) {
    const ids = { checkpointId: checkpoint.checkpointId };
    const whole = pageMark("checkpoint", ids, draftMark(badge, notes));
    if (whole) {
      pageMarks = {
        checkpoint: whole,
        description: description !== null ? pageMark("checkpoint.description", ids) : null,
        answers: answers.map((answer) =>
          pageMark("checkpoint.answer", { ...ids, elementKey: answer.elementKey }),
        ),
        tgiu: tgiu !== null ? pageMark("tgiu", ids) : null,
      };
    }
  }

  return {
    anchor: anchors(),
    title: checkpoint.label,
    badge,
    link,
    notes,
    description,
    answers: answers.map((answer) => ({ label: answer.label, value: answer.valueText })),
    deviations: checkpoint.deviations.map((deviation) =>
      layoutDeviation(deviation, checkpoint, profile, options, anchors()),
    ),
    tgiu,
    pageMarks,
  };
}

/** Har punktet noe å vise? Et punkt uten innhold står ikke i rommet (i utkast: på siden «Ikke med»). */
function hasContent(checkpoint: LayoutCheckpoint): boolean {
  return (
    checkpoint.badge !== null ||
    checkpoint.description !== null ||
    checkpoint.answers.length > 0 ||
    checkpoint.deviations.length > 0 ||
    checkpoint.tgiu !== null ||
    checkpoint.notes.length > 0
  );
}

function roomHeading(room: PdfRoom): string {
  return [room.title, room.buildingName, room.floorName]
    .map((part) => present(part))
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function truncateCompany(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length <= FOOTER_COMPANY_MAX_CHARS) return chars.join("");
  return `${chars
    .slice(0, FOOTER_COMPANY_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}

/** Tittelen i PDF-ens egenskaper. Har oppdragsnummeret, aldri adresse eller navn. */
export function pdfTitle(data: ReportPdfData, draft: boolean): string {
  const number = data.cover.assignmentNumber;
  if (draft) return PDF_TEXTS.meta.titleDraft(number);
  return data.versionNumber === null
    ? PDF_TEXTS.meta.titleReleaseNoVersion(number)
    : PDF_TEXTS.meta.titleRelease(number, data.versionNumber);
}

function utcParts(date: Date): PdfLayout["meta"]["date"] {
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
}

// --- Oppsettet ---------------------------------------------------------------------------------

/**
 * Hele oppsettet for PDF-en. Rekkefølgen på delene følger profilen. `summary` er reservert til
 * 2a-3 og gir ingen side. Deler uten innhold er ikke med, og står ikke i innholdsfortegnelsen.
 */
export function layoutReportPdf(
  data: ReportPdfData,
  profile: PdfProfile,
  options: LayoutOptions,
): PdfLayout {
  const draft = options.draft;
  let anchorIndex = 0;
  const nextAnchor = () => `a${(anchorIndex += 1)}`;
  const sections: LayoutSection[] = [];
  const toc: LayoutTocEntry[] = [];

  for (const code of profile.sections) {
    switch (code) {
      case "cover": {
        const facts: LayoutRow[] = [
          { label: PDF_TEXTS.cover.assignmentNumber, value: data.cover.assignmentNumber },
        ];
        const inspectionDate = formatPdfDate(data.cover.inspectionDate);
        if (inspectionDate)
          facts.push({ label: PDF_TEXTS.cover.inspectionDate, value: inspectionDate });
        const companyName = present(data.company?.legalName);
        if (companyName) facts.push({ label: PDF_TEXTS.cover.company, value: companyName });
        sections.push({
          kind: "cover",
          title: PDF_TEXTS.cover.title,
          addressLines: data.cover.addressLines.filter((line) => present(line) !== null),
          cadastralText: present(data.cover.cadastralText),
          facts,
          logo: options.logoPath ? { path: options.logoPath, alt: PDF_TEXTS.cover.logoAlt } : null,
        });
        break;
      }
      case "toc":
        sections.push({ kind: "toc", heading: PDF_TEXTS.toc.heading });
        break;
      case "summary":
        // Reservert til 2a-3 (sammendraget). Ingen side nå.
        break;
      case "tg_explanation": {
        const items = data.tgExplanation.items
          .filter((item) => present(item.text) !== null)
          .map((item) => ({ badge: tgBadge(item.tg, profile, "long"), text: item.text }));
        if (items.length === 0) break;
        const anchor = nextAnchor();
        const heading = data.tgExplanation.title;
        sections.push({
          kind: "tg_explanation",
          anchor,
          heading,
          items,
          hmsText: data.tgExplanation.hmsText,
        });
        toc.push({ level: 1, text: heading, anchor, tg: null });
        break;
      }
      case "room": {
        for (const room of data.rooms) {
          const anchor = nextAnchor();
          const laidOut = room.checkpoints
            .map((source) => ({
              source,
              checkpoint: layoutCheckpoint(source, profile, options, nextAnchor),
            }))
            .filter(({ checkpoint }) => hasContent(checkpoint));
          const answers = layoutAnswers(room.answers);
          if (laidOut.length === 0 && answers.length === 0) continue;
          const heading = roomHeading(room);
          const checkpoints = laidOut.map(({ checkpoint }) => checkpoint);
          sections.push({ kind: "room", anchor, heading, answers, checkpoints });
          toc.push({ level: 1, text: heading, anchor, tg: null });
          for (const { source, checkpoint } of laidOut) {
            toc.push({
              level: 2,
              text: checkpoint.title,
              anchor: checkpoint.anchor,
              tg: source.tg ? tgBadge(source.tg, profile, "short") : null,
            });
          }
        }
        break;
      }
      case "missing": {
        if (!draft || !data.missing) break;
        const reportNotes = layoutNotes(data.missing.reportNotes, null, true);
        const empty = data.missing.emptyCheckpoints
          .filter((item) => present(item.label) !== null)
          .map((item) => ({
            label: present(item.roomTitle) ? `${item.label} (${item.roomTitle})` : item.label,
            link: editLink(item.editPath, options),
            // Punktet står ikke i rommet; linjen her fører til det («Ikke med i PDF-en»).
            pageMark: options.pageMap
              ? pageMark("checkpoint", { checkpointId: item.checkpointId }, "missing")
              : null,
          }));
        if (reportNotes.length === 0 && empty.length === 0) break;
        const anchor = nextAnchor();
        sections.push({
          kind: "missing",
          anchor,
          heading: PDF_TEXTS.missing.heading,
          intro: PDF_TEXTS.missing.intro,
          reportNotes,
          emptyHeading: empty.length > 0 ? PDF_TEXTS.missing.emptyHeading : null,
          empty,
        });
        toc.push({ level: 1, text: PDF_TEXTS.missing.heading, anchor, tg: null });
        break;
      }
    }
  }

  // Innholdsfortegnelsen uten innhold gir ingen side.
  const withToc = toc.length > 0 ? sections : sections.filter((section) => section.kind !== "toc");

  const footer: LayoutFooterPart[] = profile.footer.map((part) => {
    switch (part) {
      case "legal_company": {
        const name = present(data.company?.legalName);
        const orgNumber = present(data.company?.orgNumber);
        return name && orgNumber
          ? {
              kind: "legal_company",
              text: `${truncateCompany(name)} · ${PDF_TEXTS.footer.orgNumber(orgNumber)}`,
              missing: false,
            }
          : { kind: "legal_company", text: PDF_TEXTS.footer.noCompany, missing: true };
      }
      case "assignment_number":
        return { kind: "assignment_number", text: data.cover.assignmentNumber };
      case "page_of_pages":
        return {
          kind: "page_of_pages",
          prefix: PDF_TEXTS.footer.pagePrefix,
          middle: PDF_TEXTS.footer.pageMiddle,
        };
    }
  });

  return {
    meta: { title: pdfTitle(data, draft), date: utcParts(options.generatedAt) },
    draft: draft ? { banner: PDF_TEXTS.draft.banner, watermark: PDF_TEXTS.draft.watermark } : null,
    page: { flipped: profile.orientation === "landscape" },
    colors: { ...profile.colors, page: WHITE },
    fonts: profile.fonts,
    texts: {
      cause: PDF_TEXTS.deviation.cause,
      consequence: PDF_TEXTS.deviation.consequence,
      measures: PDF_TEXTS.deviation.measures,
      cost: PDF_TEXTS.deviation.cost,
      draftLink: PDF_TEXTS.draft.link,
    },
    footer,
    toc,
    sections: withToc,
    pageMap: options.pageMap === true,
  };
}
