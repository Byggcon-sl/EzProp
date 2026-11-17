import { MERGE_FIELD_KEYS } from "./codes";
import { mergeFieldMissingText } from "./labels";
import type { FillMergeFields, MergeFieldKey, MergeSegment, MergeValues } from "./types";

/**
 * Flettefeltene i standardtekstene (docs/funksjoner/fase2a-badet-pc.md Omfang 5). Uten verdi
 * vises feltet tydelig som manglende, aldri som `{…}`. Ukjente `{…}` står som vanlig tekst.
 */

const MERGE_FIELD_PATTERN = /\{([^{}]+)\}/gu;

function isMergeFieldKey(value: string): value is MergeFieldKey {
  return (MERGE_FIELD_KEYS as readonly string[]).includes(value);
}

/** Deler teksten i biter: vanlig tekst, fylt verdi og manglende verdi. Tom tekst og bare mellomrom regnes som manglende. */
export const fillMergeFields: FillMergeFields = (text, values) => {
  const segments: MergeSegment[] = [];
  let plain = "";
  let last = 0;
  for (const match of text.matchAll(MERGE_FIELD_PATTERN)) {
    const name = match[1] ?? "";
    if (!isMergeFieldKey(name)) continue;
    plain += text.slice(last, match.index);
    last = match.index + match[0].length;
    if (plain !== "") segments.push({ type: "text", text: plain });
    plain = "";
    const value = values[name]?.trim();
    segments.push(
      value ? { type: "value", field: name, text: value } : { type: "missing", field: name },
    );
  }
  plain += text.slice(last);
  if (plain !== "") segments.push({ type: "text", text: plain });
  return segments;
};

/**
 * Teksten med verdiene satt inn, og feltene som mangler (hvert felt én gang, i den rekkefølgen de
 * står). Manglende felt står som «[årstall mangler]», aldri som `{…}`.
 */
export function mergeFieldsText(
  text: string,
  values: Parameters<FillMergeFields>[1],
): { text: string; missing: MergeFieldKey[] } {
  const missing: MergeFieldKey[] = [];
  const out = fillMergeFields(text, values)
    .map((segment) => {
      if (segment.type !== "missing") return segment.text;
      if (!missing.includes(segment.field)) missing.push(segment.field);
      return mergeFieldMissingText(segment.field);
    })
    .join("");
  return { text: out, missing };
}

// --- Verdiene fra svarene -------------------------------------------------------------------

/**
 * Hvor ett flettefelt henter verdien: feltkodene i malen. `first` tar første svar som finnes (for
 * eksempel sjiktets årstall, ellers byggeåret); `all` tar alle og skriver «5 og 7,5». Kodene står i
 * tjenesten, aldri her (A396).
 */
export type MergeFieldSource = { keys: readonly string[]; pick: "first" | "all" };
export type MergeFieldSources = Partial<Record<MergeFieldKey, MergeFieldSource>>;

/** Etiketten til et valg i malen, eller `null`. */
export type OptionLabelOf = (elementKey: string, optionKey: string) => string | null;

const numberFormat = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });
const yearFormat = new Intl.NumberFormat("nb-NO", { useGrouping: false, maximumFractionDigits: 0 });

/** Et måletall slik det står i teksten: norsk desimalkomma, høyst én desimal. */
export function mergeNumberText(value: number): string {
  return numberFormat.format(value);
}

/** Et svar som tekst i rapporten. Valg vises med etiketten fra malen, aldri som kode. */
function answerText(
  field: MergeFieldKey,
  elementKey: string,
  value: unknown,
  optionLabel: OptionLabelOf,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return field === "årstall" ? yearFormat.format(value) : numberFormat.format(value);
  }
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (Array.isArray(value)) {
    const labels = value
      .filter((v): v is string => typeof v === "string")
      .map((key) => optionLabel(elementKey, key))
      .filter((label): label is string => label !== null && label !== "");
    return labels.length > 0 ? labels.join(", ") : null;
  }
  return null;
}

/**
 * Verdiene til flettefeltene fra lagrede svar. Mangler svaret, mangler verdien, og teksten får
 * «[måleverdi mangler]» (aldri `{…}`). Leser bare egne nøkler i svarene og i kildene.
 */
export function mergeFieldValues(
  sources: MergeFieldSources,
  answers: Readonly<Record<string, unknown>>,
  optionLabel: OptionLabelOf,
): MergeValues {
  const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
  const values: MergeValues = {};
  for (const field of MERGE_FIELD_KEYS) {
    const source = own(sources, field) ? sources[field] : undefined;
    if (!source) continue;
    const texts: string[] = [];
    for (const key of source.keys) {
      const text = answerText(
        field,
        key,
        own(answers, key) ? answers[key] : undefined,
        optionLabel,
      );
      if (text === null) continue;
      texts.push(text);
      if (source.pick === "first") break;
    }
    if (texts.length > 0) values[field] = texts.join(" og ");
  }
  return values;
}
