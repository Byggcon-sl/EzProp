import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, count, eq, inArray } from "drizzle-orm";
import { expect, vi } from "vitest";
import { getPublishCheck, publishReport } from "@/core/reports";
import { db } from "@/db/client";
import { events, files } from "@/db/schema";
import { createPublishableBathroom, type PublishableOptions } from "./publish-fixtures";

/*
 * Hjelpere til rutetestene for PDF-ene (docs/funksjoner/fase2a-pdf-badet-testplan.md avsnitt 6,
 * 10.2, 10.5, 10.7 og 11). Testfilene mocker selv `server-only`, innloggingen og (der det trengs)
 * gjengivelsen. Alle data er oppdiktede.
 */

export const APP_ORIGIN = "http://localhost:3000";

export const PDF_TEXTS = {
  notFound: "Fant ikke rapporten",
  busy: "En PDF lages allerede. Vent litt og prøv igjen.",
  failed: "PDF-en kunne ikke lages. Prøv igjen.",
} as const;

export function pdfRequest(
  pathname: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal; method?: string } = {},
): Request {
  return new Request(`${APP_ORIGIN}${pathname}`, {
    method: init.method ?? "GET",
    headers: init.headers,
    signal: init.signal,
  });
}

export function draftPath(assignmentId: string): string {
  return `/oppdrag/${assignmentId}/pdf`;
}

export function releasePath(assignmentId: string, releaseId: string): string {
  return `/oppdrag/${assignmentId}/utgivelser/${releaseId}/pdf`;
}

/** Et løfte som testen løser selv, for å holde gjengivelsen igjen. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Venter til betingelsen holder (høyst to sekunder). */
export async function until(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 2000) throw new Error("Ventet for lenge");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** PDF-hendelsene i organisasjonen. */
export async function pdfEvents(organizationId: string) {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.organizationId, organizationId),
        inArray(events.type, ["report.draft_pdf_created", "report.release_pdf_created"]),
      ),
    );
}

export async function fileRowCount(): Promise<number> {
  return Number((await db.select({ n: count() }).from(files))[0]?.n ?? 0);
}

/**
 * Tomme mapper for temp og lagring under testen (`TMPDIR`, `FILE_STORAGE_DIR`,
 * `TRIAL_UPLOAD_DIR`). `expectEmpty` viser at ingenting ble skrevet; `cleanup` rydder.
 */
export async function isolatedDirs() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pdf-route-test-"));
  const dirs = {
    temp: path.join(root, "tmp"),
    storage: path.join(root, "files"),
    uploads: path.join(root, "uploads"),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir);
  vi.stubEnv("TMPDIR", dirs.temp);
  vi.stubEnv("TEMP", dirs.temp);
  vi.stubEnv("TMP", dirs.temp);
  vi.stubEnv("FILE_STORAGE_DIR", dirs.storage);
  vi.stubEnv("TRIAL_UPLOAD_DIR", dirs.uploads);
  return {
    async expectEmpty() {
      for (const dir of Object.values(dirs)) expect(await readdir(dir)).toEqual([]);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Feilsiden: HTML på norsk med fast tekst, CSP med `frame-ancestors 'none'` og no-store. */
export async function expectErrorPage(response: Response, status: number, text: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const html = await response.text();
  expect(html).toContain('<html lang="nb">');
  expect(html).toContain(text);
  expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
  if (status !== 404) expect(html).toContain('<a href="">Prøv igjen</a>');
  return html;
}

/** Svarhodene på en PDF (testplan 6.1.1). */
export function expectPdfHeaders(response: Response, fileName: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toBe(`inline; filename="${fileName}"`);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(fileName).toMatch(/^(utkast|tilstandsrapport)(-[0-9-]+)?(-v\d+)?\.pdf$/);
}

/** Et publisert bad: rapporten er publisert i versjon 1. */
export async function publishedBathroom(options: PublishableOptions = {}) {
  const f = await createPublishableBathroom(options);
  const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error(`forventet draft, fikk ${view.state}`);
  const result = await publishReport(f.actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: [],
  });
  if (result.status !== "published") throw new Error(`publisering feilet: ${result.status}`);
  return { ...f, releaseId: result.releaseId, versionNumber: result.versionNumber };
}

/** Henter alle bytene fra svaret. */
export async function bodyBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}
