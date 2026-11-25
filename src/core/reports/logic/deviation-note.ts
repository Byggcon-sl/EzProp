import type { AppendNoteToDeviationText, CanReplaceDeviationTextWithNote } from "./types";

/*
 * Notatet som avvikstekst etter «Skriv det du ser» (docs/funksjoner/fase2a-skriv-det-du-ser.md,
 * A556). Rent blad: samme svar i nettleseren og på serveren. Notatet er takstmannens egne ord og
 * lagres som en vanlig endring av avviksteksten.
 *
 * Hovedmål: færre reklamasjoner (malens tekst med måling og årstall forsvinner aldri uten at
 * takstmannen ber om det) og best for de ansatte (ett trykk legger notatet til).
 */

/** Et flettefelt i malens tekst, for eksempel `{måleverdi}` eller `{årstall}`. */
const MERGE_FIELD = /\{[^{}]+\}/u;
/** Tegnene som avslutter en setning. */
const SENTENCE_END = /[.!?]$/u;

/** Notatet som egen setning: trimmet, stor forbokstav og punktum når det mangler. */
function noteAsSentence(note: string): string {
  const trimmed = note.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (trimmed === "") return "";
  const [first = "", ...rest] = [...trimmed];
  const sentence = first.toLocaleUpperCase("nb") + rest.join("");
  return SENTENCE_END.test(sentence) ? sentence : `${sentence}.`;
}

/** Se `AppendNoteToDeviationText` i `./types`. */
export const appendNoteToDeviationText: AppendNoteToDeviationText = (deviationText, note) => {
  const sentence = noteAsSentence(note);
  const base = deviationText ?? "";
  if (base.trim() === "") return sentence;
  if (sentence === "") return base;
  return `${base.trimEnd()} ${sentence}`;
};

/** Se `CanReplaceDeviationTextWithNote` i `./types`. */
export const canReplaceDeviationTextWithNote: CanReplaceDeviationTextWithNote = (
  templateDeviationText,
) => templateDeviationText === null || !MERGE_FIELD.test(templateDeviationText);

/**
 * «Bruk bare notatet»: notatet som egen setning (samme formatering som «Legg notatet til»). Gir
 * `null` når malens tekst har flettefelt (`canReplaceDeviationTextWithNote` er usann), eller når
 * notatet er tomt, så målingen eller årstallet aldri faller ut av rapporten.
 */
export function replaceDeviationTextWithNote(
  templateDeviationText: string | null,
  note: string,
): string | null {
  if (!canReplaceDeviationTextWithNote(templateDeviationText)) return null;
  const sentence = noteAsSentence(note);
  return sentence === "" ? null : sentence;
}
