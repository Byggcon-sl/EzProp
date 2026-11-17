import { MERGE_FIELD_KEYS } from "./codes";
import { mergeFieldMissingText } from "./labels";
import type { FillMergeFields, MergeFieldKey, MergeSegment } from "./types";

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
