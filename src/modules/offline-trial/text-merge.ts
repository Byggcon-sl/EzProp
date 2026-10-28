/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tekstfletting for tekstfeltene i testskjemaet (docs/funksjoner/fase1-kandidat-powersync.md
 * pkt. 17). Tilstanden er en Yjs-oppdatering kodet som base64, så den kan ligge i en tekstkolonne
 * både i SQLite på iPaden og i PostgreSQL. Rene funksjoner: ingen React, ingen database, ingen
 * `window`. Kjører likt på iPad og server, så begge sider ender med samme tekst.
 */
import * as Y from "yjs";
import type { TextMerge, TextState } from "./sync/types";

/** Navnet på teksten inne i Yjs-dokumentet. Fast, ellers leses ikke gamle tilstander. */
const TEXT_NAME = "text";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(text: string): Uint8Array {
  if (text.length === 0 || !BASE64_PATTERN.test(text)) {
    throw new Error("Teksttilstanden er ikke gyldig base64.");
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function docFrom(...states: TextState[]): Y.Doc {
  const doc = new Y.Doc();
  for (const state of states) {
    const update = decodeBase64(state);
    try {
      Y.applyUpdate(doc, update);
    } catch {
      throw new Error("Teksttilstanden kan ikke leses.");
    }
  }
  return doc;
}

function encodeDoc(doc: Y.Doc): TextState {
  return encodeBase64(Y.encodeStateAsUpdate(doc));
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Ny tilstand som inneholder `text`. */
export function createTextState(text: string): TextState {
  const doc = new Y.Doc();
  if (text.length > 0) doc.getText(TEXT_NAME).insert(0, text);
  return encodeDoc(doc);
}

/**
 * Legger endringen fra forrige tekst til `newText` på tilstanden som innsetting og sletting
 * (felles start og slutt beholdes), så to enheter som skriver hvert sitt sted, begge blir med.
 */
export function applyTextEdit(state: TextState, newText: string): TextState {
  const doc = docFrom(state);
  const ytext = doc.getText(TEXT_NAME);
  const oldText = ytext.toString();
  if (oldText === newText) return encodeDoc(doc);

  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  // Del aldri et tegn som består av to UTF-16-enheter (emoji)
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--;

  const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--;

  const deleteCount = oldText.length - prefix - suffix;
  const insert = newText.slice(prefix, newText.length - suffix);
  doc.transact(() => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  });
  return encodeDoc(doc);
}

/** Fletter to tilstander. Kommutativ og idempotent (Yjs). */
export function mergeTextStates(a: TextState, b: TextState): TextState {
  return encodeDoc(docFrom(a, b));
}

/** Teksten i tilstanden. Kaster `Error` ved ugyldig tilstand, gir aldri tom tekst i stillhet. */
export function textOf(state: TextState): string {
  return docFrom(state).getText(TEXT_NAME).toString();
}

/** Samlet, så det er lett å se at filen oppfyller kontrakten i `sync/types.ts`. */
export const textMerge: TextMerge = { createTextState, applyTextEdit, mergeTextStates, textOf };
