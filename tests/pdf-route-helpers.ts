import { readdirSync } from "node:fs";
import os from "node:os";

/*
 * Hjelpere for rutetestene for PDF-en (testplanen for PDF av badet avsnitt 6, 10.2, 10.5, 10.7
 * og 11). Innloggingen og motoren mockes i testfilen; tilgangssjekken og databasen er ekte.
 */

export const DRAFT_ERROR_TEXT = "PDF-en kunne ikke lages. Prøv igjen.";
export const NOT_FOUND_TEXT = "Fant ikke rapporten";
export const BUSY_TEXT = "En PDF lages allerede. Vent litt og prøv igjen.";

/** Et løfte som testen avgjør selv (for å holde motoren igjen). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function draftRequest(
  assignmentId: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return new Request(`http://localhost:3000/oppdrag/${encodeURIComponent(assignmentId)}/pdf`, {
    method: init.method ?? "GET",
    headers: init.headers,
    signal: init.signal,
  });
}

export function releaseRequest(
  assignmentId: string,
  releaseId: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return new Request(
    `http://localhost:3000/oppdrag/${encodeURIComponent(assignmentId)}/utgivelser/${encodeURIComponent(releaseId)}/pdf`,
    { method: init.method ?? "GET", headers: init.headers, signal: init.signal },
  );
}

/** Svaret, eller videresendingen Next kaster (`redirect`), som et felles svar. */
export async function settle(
  run: () => Promise<Response>,
): Promise<{
  status: number;
  headers: Headers;
  body: Uint8Array;
  text: string;
  redirected: boolean;
}> {
  try {
    const response = await run();
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      body,
      text: new TextDecoder().decode(body),
      redirected: response.status >= 300 && response.status < 400,
    };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return {
        status: 307,
        headers: new Headers(),
        body: new Uint8Array(),
        text: "",
        redirected: true,
      };
    }
    throw error;
  }
}

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

/**
 * Filene i temp-mappen som kan komme fra PDF-gjengivelsen (for «ingen nye filer»). Andre
 * prosesser på maskinen kan skrive i temp-mappen, så bare navn med pdf, typst eller ezprop telles.
 */
export function tmpEntries(): string[] {
  return readdirSync(os.tmpdir())
    .filter((name) => /pdf|typst|ezprop/i.test(name))
    .sort();
}

/** Alle argumentene til loggeren som tekst. */
export function loggedText(calls: unknown[][]): string {
  return calls.map((args) => JSON.stringify(args)).join("\n");
}
