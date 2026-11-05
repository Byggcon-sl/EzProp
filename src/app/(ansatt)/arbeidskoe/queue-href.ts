import type { AssignmentStatus } from "@/core/assignments";

/*
 * Adressene i arbeidskøen. Fanene, Mine/Alle, «Avbryt», «Tøm søk» og svaret etter «Lagre» lages
 * her, slik at fane, filter og søk alltid følger med. Verdiene skal komme fra
 * `parseWorkQueueParams`, aldri rett fra adressen eller skjemaet. Ren funksjon.
 */

export const QUEUE_PATH = "/arbeidskoe";

/** Fane, filter og søk, som fra `parseWorkQueueParams`. */
export type QueueState = {
  status: AssignmentStatus;
  mineOnly: boolean;
  query: string;
};

/** Faste koder for notatfeil i adressen. Teksten slås opp i siden; avvist tekst står aldri her. */
export const NOTE_ERROR_CODES = [
  "for_langt",
  "fnr",
  "ikke_funnet",
  "ingen_tilgang",
  "ukjent",
] as const;
export type NoteErrorCode = (typeof NOTE_ERROR_CODES)[number];

export function isNoteErrorCode(value: unknown): value is NoteErrorCode {
  return typeof value === "string" && (NOTE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Adressen til køen. `status` står alltid med; `mine=0` bare for «Alle»; `q` bare når søket ikke
 * er tomt. `noteError` gir `notatfeil` og `feil`; `hash` legges til sist (`#kort-{id}`).
 */
export function queueHref(
  state: QueueState,
  options: { noteError?: { assignmentId?: string; code: NoteErrorCode }; hash?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set("status", state.status);
  if (!state.mineOnly) params.set("mine", "0");
  if (state.query !== "") params.set("q", state.query);
  if (options.noteError) {
    if (options.noteError.assignmentId) params.set("notatfeil", options.noteError.assignmentId);
    params.set("feil", options.noteError.code);
  }
  const hash = options.hash ? `#${encodeURIComponent(options.hash)}` : "";
  return `${QUEUE_PATH}?${params.toString()}${hash}`;
}

/** Id-en til kortet, som `#kort-{id}` peker til. */
export function cardAnchor(assignmentId: string): string {
  return `kort-${assignmentId}`;
}
