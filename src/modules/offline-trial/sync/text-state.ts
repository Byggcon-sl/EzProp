/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Felles for alle kandidater: hvordan et tekstfelt får ny tekst-tilstand (Yjs) når brukeren har
 * skrevet. Ren fil: ingen React, ingen database, ingen `window`. Flyttet hit fra PowerSync-lageret
 * så ElectricSQL-lageret bruker nøyaktig samme regel (ingen ny flettekode).
 */
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "../text-merge";

/** Ventetid fra siste tastetrykk til tekstfeltet skrives lokalt. */
export const TEXT_WRITE_DELAY_MS = 300;

/** Teksten i tilstanden, eller null hvis tilstanden ikke kan leses. */
export function safeTextOf(state: string): string | null {
  try {
    return textOf(state);
  } catch {
    return null;
  }
}

/** Hvor mange tegn to tekster har felles i starten og slutten (grovt mål på hvor like de er). */
function sharedEdges(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return start + end;
}

/**
 * Ny tekst-tilstand for et felt. Endringen regnes fra den tilstanden brukeren skrev ut fra:
 * enten det denne enheten skrev sist (brukeren skriver videre), eller det som ligger lagret (en
 * annen enhet har skrevet, og brukeren har sett det). Resultatet flettes med det lagrede.
 */
export function nextTextState(
  stored: string | null,
  ownLast: string | null,
  newText: string,
): string {
  let base = stored ?? createTextState("");
  if (stored && ownLast) {
    const storedText = safeTextOf(stored);
    const ownText = safeTextOf(ownLast);
    if (
      storedText !== null &&
      ownText !== null &&
      storedText !== ownText &&
      sharedEdges(ownText, newText) > sharedEdges(storedText, newText)
    ) {
      base = ownLast;
    }
  }
  const edited = applyTextEdit(base, newText);
  return stored ? mergeTextStates(stored, edited) : edited;
}
