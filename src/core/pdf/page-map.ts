import type { IsPdfPageAnchor, PdfPageAnchor, PdfPageAnchorKey, SamePdfPageAnchor } from "./types";

/*
 * Ankrene i sidekartet for klienten (tillegget til ADR 0016, punkt 22). Ingen importer av
 * verdier, så filen kan lastes i nettleseren uten `server-only`. Kodene og formkravene står også
 * i `codes.ts`; `page-map.test.ts` holder dem like, og typen under stopper bygget hvis en kode
 * mangler her.
 */

const ANCHOR_KINDS = [
  "checkpoint",
  "checkpoint.description",
  "checkpoint.answer",
  "deviation",
  "deviation.text",
  "deviation.cause",
  "deviation.consequence",
  "deviation.measures",
  "deviation.cost",
  "tgiu",
] as const satisfies readonly PdfPageAnchor["kind"][];

/** Feiler i typesjekken hvis `PDF_PAGE_ANCHOR_KINDS` får en kode som ikke står over. */
type MissingKind = Exclude<PdfPageAnchor["kind"], (typeof ANCHOR_KINDS)[number]>;
const allKindsListed: MissingKind extends never ? true : never = true;
void allKindsListed;

/** Samme som `PDF_PAGE_ANCHOR_ID_PATTERN` og `PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN` i `codes.ts`. */
export const PAGE_ANCHOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PAGE_ANCHOR_ELEMENT_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
/** Lengste `field_key` som godtas. Lengre er ikke en ekte nøkkel. */
const MAX_ELEMENT_KEY_LENGTH = 200;

const KINDS: ReadonlySet<string> = new Set(ANCHOR_KINDS);
const ANCHOR_FIELDS = ["kind", "checkpointId", "deviationId", "elementKey"];

const isId = (value: unknown): value is string =>
  typeof value === "string" && PAGE_ANCHOR_ID.test(value);

/**
 * Sann bare for et anker med nøyaktig de fire feltene, en kjent kode og id-er med riktig form:
 * `deviationId` bare for `deviation` og `deviation.*`, `elementKey` bare for `checkpoint.answer`.
 * Alt annet (ukjent kode, tekst, ekstra felt, arvede felt) er ikke et anker.
 */
export const isPdfPageAnchor: IsPdfPageAnchor = (value: unknown): value is PdfPageAnchor => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  if (keys.length !== ANCHOR_FIELDS.length || !ANCHOR_FIELDS.every((key) => keys.includes(key))) {
    return false;
  }
  const anchor = value as Record<string, unknown>;
  if (typeof anchor.kind !== "string" || !KINDS.has(anchor.kind)) return false;
  if (!isId(anchor.checkpointId)) return false;

  const isDeviation = anchor.kind === "deviation" || anchor.kind.startsWith("deviation.");
  if (isDeviation ? !isId(anchor.deviationId) : anchor.deviationId !== null) return false;

  if (anchor.kind === "checkpoint.answer") {
    return (
      typeof anchor.elementKey === "string" &&
      anchor.elementKey.length <= MAX_ELEMENT_KEY_LENGTH &&
      PAGE_ANCHOR_ELEMENT_KEY.test(anchor.elementKey)
    );
  }
  return anchor.elementKey === null;
};

/**
 * Fast tekstnøkkel for et anker, til sammenligning og React-nøkler. Aldri i en selector eller
 * adresse. Delene skilles med `|`, som verken id-er, koder eller `field_key` kan ha.
 */
export const pdfPageAnchorKey: PdfPageAnchorKey = (anchor: PdfPageAnchor): string =>
  [anchor.kind, anchor.checkpointId, anchor.deviationId ?? "", anchor.elementKey ?? ""].join("|");

export const samePdfPageAnchor: SamePdfPageAnchor = (a: PdfPageAnchor, b: PdfPageAnchor) =>
  a.kind === b.kind &&
  a.checkpointId === b.checkpointId &&
  a.deviationId === b.deviationId &&
  a.elementKey === b.elementKey;
