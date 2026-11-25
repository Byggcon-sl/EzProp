/*
 * «Gå gjennom tekstene» (docs/funksjoner/fase2a-ga-gjennom-tekstene.md, A609): et forslag som bare
 * endrer mellomrom, regnes som uendret. Ren funksjon, kjører likt i nettleseren og på serveren.
 */

/** Alle slags mellomrom og linjeskift (også U+00A0) blir ett mellomrom, og endene trimmes. */
export function normalizeReviewWhitespace(text: string): string {
  return text.replace(/[\s ]+/gu, " ").trim();
}

/** Om to tekster er like når mellomrom ikke regnes med. */
export function isSameIgnoringWhitespace(a: string, b: string): boolean {
  return normalizeReviewWhitespace(a) === normalizeReviewWhitespace(b);
}
