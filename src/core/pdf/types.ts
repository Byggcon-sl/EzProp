import type {
  PDF_DRAFT_NOTE_KINDS,
  PDF_FOOTER_PARTS,
  PDF_IMAGE_FORMATS,
  PDF_MARKING_TYPES,
  PDF_ORIENTATIONS,
  PDF_RENDER_ERROR_CODES,
  PDF_SECTION_CODES,
  PDF_TG_VALUES,
} from "./codes";

/**
 * Grensesnittet til PDF-gjengivelsen (ADR 0016, docs/funksjoner/fase2a-pdf-badet.md).
 * Utvikleren bygger mot typene her.
 *
 * - `src/core/pdf` er et rent blad: bare egen mappe og `@/shared`. Aldri `core/reports`,
 *   `core/access`, `core/files`, `core/ai` eller `db` (lint-regelen `pdfLeaf`).
 * - Gjengivelsen er ren: samme `ReportPdfData`, profil og `options` gir samme byte. Den leser
 *   aldri klokke, tilfeldige tall, database, filer eller nett. Alt kommer inn som inndata.
 * - `ReportPdfData` er ferdig til visning: etiketter og tekster er slått opp av `core/reports`.
 *   Gjengivelsen regner aldri TG, formaterer aldri beløp og slår aldri opp koder. Kodene står ved
 *   siden av teksten, og skrives aldri ut.
 * - Rapportdata blir aldri kode: malen er fast kode i repoet, og dataene går inn som JSON
 *   (`sys.inputs`) og settes som tekstverdier.
 * - Persondata (adresse, matrikkel) står bare i `cover`.
 * - Ingen KI: `ReportPdfData` har verken `ai_usage_id`, KI-merker eller `text_source` (A542).
 */

export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];
export type PdfSectionCode = (typeof PDF_SECTION_CODES)[number];
export type PdfTg = (typeof PDF_TG_VALUES)[number];
export type PdfFooterPart = (typeof PDF_FOOTER_PARTS)[number];
export type PdfDraftNoteKind = (typeof PDF_DRAFT_NOTE_KINDS)[number];
export type PdfImageFormat = (typeof PDF_IMAGE_FORMATS)[number];
export type PdfMarkingType = (typeof PDF_MARKING_TYPES)[number];
export type PdfRenderErrorCode = (typeof PDF_RENDER_ERROR_CODES)[number];

// --- Rapportdata -----------------------------------------------------------------------------

/** Forsiden. Eneste sted med adresse og matrikkel. Aldri navn på eier, bestiller eller megler. */
export type PdfCover = {
  assignmentNumber: string;
  /** Ferdig satt sammen til visning, én linje per element. */
  addressLines: string[];
  /** For eksempel «Gnr. 12, bnr. 34». `null` når matrikkel mangler. */
  cadastralText: string | null;
  /** ÅÅÅÅ-MM-DD i norsk tid, eller `null`. Gjengivelsen skriver den som «24.11.2026». */
  inspectionDate: string | null;
};

/** Juridisk selskap fra oppdraget (utkast) eller utgivelsen. Aldri `organizations.brand_name` (A538). */
export type PdfCompany = { legalName: string; orgNumber: string };

/** En merknad som bare står i utkastet: «Mangler: …» eller «Sjekk: …» (A536, F8). */
export type PdfDraftNote = {
  kind: PdfDraftNoteKind;
  /** `PublishCheckCode`. Skrives aldri ut. */
  checkCode: string;
  /** Teksten fra publiseringssjekken, uten forstavelsen. */
  text: string;
};

/** Et svar på et felt med `show_in_report = true` (A540). Tomme svar er aldri med. */
export type PdfAnswer = {
  elementKey: string;
  label: string;
  /** Valgtekst, tekst eller tall med komma og enhet («12,4 vekt-%»). */
  valueText: string;
};

export type PdfPoint = { x: number; y: number };

/** Koordinater er andeler av bildet, 0–1 fra øverste venstre hjørne. Fargen kommer fra profilen. */
export type PdfMarking =
  | { type: "arrow"; from: PdfPoint; to: PdfPoint }
  | { type: "circle"; center: PdfPoint; radius: number }
  | { type: "rectangle"; topLeft: PdfPoint; width: number; height: number };

/** Visningskopien av et bilde. Sjekkes med `src/shared/images` før motoren (ingen EXIF, XMP, IPTC). */
export type PdfImage = {
  id: string;
  format: PdfImageFormat;
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  caption: string | null;
  /** Tegnes som vektorlag over bildet, i lagret rekkefølge. */
  markings: PdfMarking[];
};

export type PdfCost = {
  /** `CostType` og intervallkoden. Skrives aldri ut. */
  type: string;
  bandKey: string | null;
  amount: number | null;
  /** Fra `costDisplayText`, med harde mellomrom. `null` gir ingen kostnadslinje. Deles aldri over to linjer. */
  displayText: string | null;
  /** `cost_text` når den finnes. */
  text: string | null;
};

export type PdfDeviation = {
  deviationId: string;
  kind: "tg" | "hms";
  /** `null` for HMS, og for avvik der TG ikke er valgt. */
  tg: Extract<PdfTg, "2" | "3"> | null;
  /** Sann bare i utkast, når sjekken har `mandatory_without_tg` på avviket. Gir «Ikke satt». */
  tgNotSet: boolean;
  /** Flettefeltene er fylt ut. Aldri `{…}`. */
  text: string | null;
  /** Etiketten for årsakskriteriet. `null` for «Annet» og når det ikke er valgt. */
  causeLabel: string | null;
  causeText: string | null;
  consequenceText: string | null;
  /** I lagret rekkefølge. Tom liste gir ingen overskrift. */
  measures: string[];
  cost: PdfCost;
  /** Rett under avviket. */
  images: PdfImage[];
  /** Bare i utkast. */
  notes: PdfDraftNote[];
  /** Sti med bare id-er (`/oppdrag/<id>/rom/<romId>#avvik-<id>`). `null` utenom utkast (F4). */
  editPath: string | null;
};

/** Én opplysning under TGIU, med ferdig etikett. Tomme felt er aldri med. */
export type PdfTgiuDetail = {
  /** Feltnavnet i `tgiu_details`. Skrives aldri ut. */
  field: string;
  label: string;
  text: string;
};

export type PdfTgiu = {
  details: PdfTgiuDetail[];
  /** Setningen om utvidet ansvar. `null` når `owner_informed` ikke er sann. */
  ownerInformedText: string | null;
};

export type PdfCheckpoint = {
  checkpointId: string;
  checkpointKey: string;
  label: string;
  /** `SnapshotCheckpoint.tg`. Gjengivelsen regner aldri TG. `null` gir ikke noe TG-merke. */
  tg: PdfTg | null;
  /** Sann bare i utkast, når sjekken har `mandatory_without_tg` på punktet. Gir «Ikke satt». */
  tgNotSet: boolean;
  descriptionText: string | null;
  answers: PdfAnswer[];
  deviations: PdfDeviation[];
  tgiu: PdfTgiu | null;
  /** Bare i utkast. */
  notes: PdfDraftNote[];
  /** `/oppdrag/<id>/rom/<romId>#punkt-<id>`. `null` utenom utkast (F4). */
  editPath: string | null;
};

/** Ett rom. Punkter helt uten innhold står ikke her; i utkast står de i `missing`. */
export type PdfRoom = {
  roomId: string;
  roomType: string;
  /** Romnavn til visning (navnet, ellers etiketten for romtypen). */
  title: string;
  buildingName: string | null;
  floorName: string | null;
  /** Svar på rommet som ikke hører til et kontrollpunkt (`show_in_report = true`). */
  answers: PdfAnswer[];
  checkpoints: PdfCheckpoint[];
};

/** Forklaringen av TG. Innhold fra `core/reports` (`tg-explanation.ts`), ikke fra profilen. */
export type PdfTgExplanation = {
  title: string;
  items: { tg: PdfTg; label: string; text: string }[];
  /** Setningen om at HMS-forhold beskrives uten TG. */
  hmsText: string;
  /** Tekststatus (ADR 0007). Står i dataene, skrives aldri i PDF-en (A533). */
  textStatus: "draft" | "approved";
};

/** Siden «Ikke med i PDF-en» (F3). Bare i utkast. */
export type PdfMissing = {
  /** Funn på hele rapporten, øverst på siden. */
  reportNotes: PdfDraftNote[];
  /** Punkter helt uten innhold, med etiketter og uten koder. */
  emptyCheckpoints: {
    roomTitle: string;
    checkpointId: string;
    label: string;
    editPath: string | null;
  }[];
};

/**
 * Alt gjengivelsen trenger. Bygges av én ren funksjon fra `ReportSnapshot` (`buildReportPdfData` i
 * `core/reports`), likt for utkast og utgivelse (F6). Ingen felt finnes bare i levende rader,
 * utenom `cover`, `company` og utkastdelene (`missing`, merknadene og `editPath`).
 */
export type ReportPdfData = {
  reportId: string;
  /** `draft` gir «UTKAST» på hver side, merknader, lenker og siden «Ikke med i PDF-en». */
  kind: "draft" | "release";
  /** Versjonsnummeret til utgivelsen. `null` i utkast. */
  versionNumber: number | null;
  cover: PdfCover;
  /** `null` gir «Juridisk selskap mangler på oppdraget» i bunnteksten (A538). */
  company: PdfCompany | null;
  tgExplanation: PdfTgExplanation;
  rooms: PdfRoom[];
  /** `null` utenom utkast. */
  missing: PdfMissing | null;
};

// --- Profil ------------------------------------------------------------------------------------

/** Farge som `#rrggbb`. */
export type PdfColor = `#${string}`;

/**
 * Hvordan PDF-en ser ut. Kodedata til `report_profiles` kommer i 2a-3 (A530). Aldri selskapsnavn
 * eller fagtekst. Samme data med en annen profil gir samme tekst.
 */
export type PdfProfile = {
  /** Fast kode (regel 6), for eksempel `byggcon_standard`. */
  code: string;
  /** Øker ved hver endring, så utgivelsen kan vise hvilken profil som ble brukt (D8). */
  version: number;
  /** Navnet i admin. Skrives aldri i PDF-en. */
  name: string;
  orientation: PdfOrientation;
  colors: {
    text: PdfColor;
    muted: PdfColor;
    accent: PdfColor;
    rule: PdfColor;
    /** TG vises alltid med både tekst og farge. */
    tg: Record<PdfTg, { background: PdfColor; text: PdfColor }>;
    marking: PdfColor;
    watermark: PdfColor;
  };
  /** Skriftfamiliene slik de heter i skriftfilene i `PdfAssets.fonts`. */
  fonts: { heading: string; body: string };
  /** Nøkkelen i `PdfAssets.logos`. */
  logo: string;
  coverLayout: "standard";
  /** Rekkefølgen på delene. Deler uten innhold gir aldri side eller linje i innholdsfortegnelsen. */
  sections: readonly PdfSectionCode[];
  footer: readonly PdfFooterPart[];
};

// --- Gjengivelsen ------------------------------------------------------------------------------

/** Skrifter og logoer som byte. Leses bare av `assets.node.ts` på serveren (eneste `node:fs`). */
export type PdfAssets = {
  fonts: readonly Uint8Array[];
  logos: Readonly<Record<string, Uint8Array>>;
};

/** Standard er `PDF_DEFAULT_LIMITS`. Over grensen gir `PdfRenderErrorCode`, aldri en halv PDF. */
export type PdfLimits = {
  timeoutMs: number;
  maxImages: number;
  maxImageBytesTotal: number;
  maxImageEdgePx: number;
};

export type RenderReportPdfOptions = {
  /** Må stemme med `data.kind === "draft"`. Gir «UTKAST» som vannmerke på hver side. */
  draft: boolean;
  /** Styrer alle datoer i PDF-en. Utkast: nå. Utgivelse: `released_at`, så filen blir lik hver gang. */
  generatedAt: Date;
  /** Bare fra serveroppsettet (`BETTER_AUTH_URL`). Tom eller utelatt gir ingen interne lenker. */
  appBaseUrl?: string;
  assets: PdfAssets;
  limits: PdfLimits;
};

export type RenderedPdf = { bytes: Uint8Array; pageCount: number; imageCount: number };

/**
 * Eneste vei til motoren. Sjekker grensene og bildene, bygger inndata til malen og kjører motoren.
 * Avviser med `PdfRenderError` (klasse i `errors.ts` med `code: PdfRenderErrorCode`).
 */
export type RenderReportPdf = (
  data: ReportPdfData,
  profile: PdfProfile,
  options: RenderReportPdfOptions,
) => Promise<RenderedPdf>;

/** Profilen for koden, eller `null` for ukjent kode. Ukjent kode på avtalen gir standardprofilen. */
export type GetPdfProfile = (code: string) => PdfProfile | null;

/** `assets.node.ts`: leser `public/fonts` og `public/brand` én gang per prosess. */
export type LoadPdfAssets = () => Promise<PdfAssets>;

// --- Motoren bak grensesnittet -----------------------------------------------------------------

/**
 * Én jobb til motoren. `source` er alltid en fast mal fra repoet, aldri bygget av rapporttekst.
 * `inputs.data` er JSON. `files` er bildene og logoen, med stier under `/assets/`.
 */
export type PdfEngineJob = {
  source: string;
  inputs: Readonly<Record<string, string>>;
  files: readonly (readonly [path: string, bytes: Uint8Array])[];
  fonts: readonly Uint8Array[];
};

export type PdfEngineResult = { bytes: Uint8Array; pageCount: number };

/**
 * Motoren. På serveren: `engine.node.ts`, som kjører `typst-worker.mjs` i en arbeidstråd og
 * avslutter tråden ved tidsavbrudd (avviser med koden `timeout`). I nettleseren (2b) og i
 * testene kan en annen motor settes inn med `createReportPdfRenderer`.
 */
export type PdfEngine = (
  job: PdfEngineJob,
  options: { timeoutMs: number },
) => Promise<PdfEngineResult>;

/** `renderReportPdf` er `createReportPdfRenderer(nodeWorkerEngine)`. */
export type CreateReportPdfRenderer = (engine: PdfEngine) => RenderReportPdf;
