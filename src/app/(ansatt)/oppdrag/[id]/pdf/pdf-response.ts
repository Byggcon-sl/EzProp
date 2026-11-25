import "server-only";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { getCurrentActor, LOGIN_PATH } from "@/core/auth/session";
import { recordEvent, type DraftPdfEventData, type ReleasePdfEventData } from "@/core/events";
import { findEmployeeGrant } from "@/core/organization";
import {
  BYGGCON_STANDARD_PROFILE,
  loadPdfAssets,
  PDF_DEFAULT_LIMITS,
  PDF_MAX_CONCURRENT,
  PDF_MAX_CONCURRENT_PER_EMPLOYEE,
  PdfRenderError,
  renderReportPdf,
  type ReportPdfData,
} from "@/core/pdf";
import { db } from "@/db/client";
import { getEnv } from "@/shared/config/env";
import { contentSecurityPolicy } from "@/shared/config/security-headers";
import { createKeyedLimiter } from "@/shared/lib/keyed-limiter";
import { logger } from "@/shared/lib/logger";
import { isSafeNextPath } from "@/shared/navigation/safe-next-path";

/*
 * Felles for de to PDF-rutene (docs/funksjoner/fase2a-pdf-badet.md Omfang 6, 6b og 8, ADR 0016):
 * utkastet `/oppdrag/[id]/pdf` og utgivelsen `/oppdrag/[id]/utgivelser/[releaseId]/pdf`.
 *
 * Rekkefølgen er fast (A539): innlogging → tilgang og data (`core/reports`) → taket (nøkkel
 * `employeeId`) → gjengivelse → hendelsen. Ikke innlogget og 404 tar aldri plass i taket.
 * Ingenting lagres: PDF-en lages i minnet og sendes rett i svaret.
 *
 * Ingen tilgangslogikk her. Tilgangen sjekkes i `core/reports` (`organization.read`), og
 * organisasjonen kommer fra tilgangssjekken (`findEmployeeGrant`), aldri fra adressen.
 *
 * Logging uten persondata: bare rute, rapport-id, profilkode og feilnavn eller
 * `PdfRenderError.code`. Aldri `error.message` eller stakk, fordi de kan sitere adresse,
 * rapporttekst eller parametre fra databasen.
 */

/**
 * Taket på pågående PDF-er (ADR 0016 punkt 9): 2 per prosess, 1 per ansatt. Én instans deles av
 * begge rutene, så et utkast og en utgivelse samtidig for samme ansatt gir 429. En plass som ikke
 * er frigitt etter tidsgrensen pluss 10 sekunder, regnes som tapt.
 */
export const pdfLimiter = createKeyedLimiter({
  maxTotal: PDF_MAX_CONCURRENT,
  maxPerKey: PDF_MAX_CONCURRENT_PER_EMPLOYEE,
  staleAfterMs: PDF_DEFAULT_LIMITS.timeoutMs + 10_000,
});

/** Det `core/reports` gir ruten. Samme form for utkast og utgivelse. */
export type LoadedReportPdf = {
  data: ReportPdfData;
  reportId: string;
  /** Nøkkelen til taket. */
  employeeId: string;
  /** Utkast: nå. Utgivelse: `released_at`. */
  generatedAt: Date;
  /** `null` i utkast. */
  versionNumber: number | null;
};

export type ReportPdfRoute = {
  /** Ruten til loggen, med plassholdere, aldri id-er. */
  route: string;
  kind: "draft" | "release";
  load: (actor: Actor, organizationId: string) => Promise<LoadedReportPdf>;
};

/** Fast tekst på feilsidene. Ingen verdi fra adressen, rapporten eller feilen. */
export const PDF_ERROR_TEXTS = {
  notFound: {
    title: "Fant ikke rapporten",
    text: "Rapporten finnes ikke, eller du har ikke tilgang til den.",
  },
  busy: { title: "En PDF lages allerede. Vent litt og prøv igjen.", text: null },
  failed: { title: "PDF-en kunne ikke lages. Prøv igjen.", text: null },
} as const;

const NO_STORE = "no-store, private";

/** Svaret på `HEAD`: 405 uten gjengivelse, hendelse eller plass i taket (testplan 11.4). */
export function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: "GET",
      "Cache-Control": NO_STORE,
      "Content-Security-Policy": contentSecurityPolicy,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Lager PDF-en for ruten, eller en enkel feilside på norsk. */
export async function respondWithReportPdf(
  request: Request,
  spec: ReportPdfRoute,
): Promise<Response> {
  const profile = BYGGCON_STANDARD_PROFILE;
  const logFields = (reportId: string | null, error: unknown) => ({
    route: spec.route,
    reportId,
    profileCode: profile.code,
    ...errorFields(error),
  });

  // 1. Innlogging. Layouten i (ansatt) beskytter ikke route.ts, så ruten sjekker selv.
  const actor = await getCurrentActor();
  if (!actor) return loginRedirect(request);

  // 2. Tilgang og data
  let grant: EmployeeGrant;
  let loaded: LoadedReportPdf;
  try {
    const found = await findEmployeeGrant(actor);
    if (!found) return errorPage(404);
    grant = found.grant;
    loaded = await spec.load(actor, grant.organizationId);
  } catch (error) {
    if (isNotFound(error)) return errorPage(404);
    logger.error("PDF-dataene kunne ikke leses", logFields(null, error));
    return errorPage(500);
  }

  // 3. Taket
  const slot = pdfLimiter.tryAcquire(loaded.employeeId);
  if (!slot.ok) return errorPage(429);

  // 4. Gjengivelse og 5. hendelsen. Plassen frigis i `finally` uansett utfall: ved svar, feil,
  // tidsavbrudd, krasj i tråden og avbrutt forbindelse. Ved avbrudd frigis den når tråden er
  // ferdig (høyst tidsgrensen), ikke før: ellers kunne lukkede faner starte flere tråder enn taket.
  try {
    // Har den ansatte lukket fanen før gjengivelsen startet, lages ingenting.
    if (request.signal.aborted) return clientGone();
    const started = performance.now();
    const assets = await loadPdfAssets();
    const rendered = await renderReportPdf(loaded.data, profile, {
      draft: spec.kind === "draft",
      generatedAt: loaded.generatedAt,
      // Bare fra serveroppsettet, aldri fra `Host` eller `X-Forwarded-Host` (F4)
      appBaseUrl: getEnv().BETTER_AUTH_URL,
      assets,
      limits: PDF_DEFAULT_LIMITS,
    });
    const durationMs = Math.round(performance.now() - started);
    // Avbrutt under gjengivelsen: ingen fikk PDF-en, så ingen hendelse.
    if (request.signal.aborted) return clientGone();

    const base: DraftPdfEventData = {
      reportId: loaded.reportId,
      profileCode: profile.code,
      pageCount: rendered.pageCount,
      imageCount: rendered.imageCount,
      durationMs,
    };
    if (spec.kind === "release") {
      const data: ReleasePdfEventData = { ...base, versionNumber: loaded.versionNumber ?? 0 };
      await recordEvent(db, grant, {
        type: "report.release_pdf_created",
        reportId: loaded.reportId,
        data,
      });
    } else {
      await recordEvent(db, grant, {
        type: "report.draft_pdf_created",
        reportId: loaded.reportId,
        data: base,
      });
    }

    return new Response(rendered.bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(spec.kind, loaded)}"`,
        "Content-Length": String(rendered.bytes.byteLength),
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    logger.error("PDF-en kunne ikke lages", logFields(loaded.reportId, error));
    return errorPage(500);
  } finally {
    slot.release();
  }
}

/**
 * Filnavnet: `utkast-<oppdragsnummer>.pdf` eller `tilstandsrapport-<oppdragsnummer>-v<n>.pdf`.
 * Bare sifre og bindestrek fra oppdragsnummeret, så hodet aldri kan brytes eller røpe noe annet.
 */
export function pdfFileName(
  kind: "draft" | "release",
  loaded: Pick<LoadedReportPdf, "data" | "versionNumber">,
): string {
  const number = loaded.data.cover.assignmentNumber.replace(/[^0-9-]/g, "").replace(/^-+|-+$/g, "");
  const numberPart = number ? `-${number}` : "";
  if (kind === "draft") return `utkast${numberPart}.pdf`;
  const version = Number.isSafeInteger(loaded.versionNumber) ? `-v${loaded.versionNumber}` : "";
  return `tilstandsrapport${numberPart}${version}.pdf`;
}

/** Fremmed, ukjent, slettet, erstattet og ugyldig id, og manglende tilgang: samme 404. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof AccessDeniedError || (error instanceof Error && error.name === "NotFoundError")
  );
}

/**
 * Feltene loggen får om en feil: koden fra gjengivelsen, ellers bare navnet på feilklassen.
 * Navnet tas bare med når det ser ut som et klassenavn, så det aldri kan bære tekst.
 */
function errorFields(error: unknown): { errorCode?: string; errorName?: string } {
  if (error === null || error === undefined) return {};
  if (error instanceof PdfRenderError) return { errorCode: error.code };
  const name = error instanceof Error ? error.name : typeof error;
  return { errorName: /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(name) ? name : "Error" };
}

function loginRedirect(request: Request): Response {
  const path = new URL(request.url).pathname;
  const location = isSafeNextPath(path)
    ? `${LOGIN_PATH}?neste=${encodeURIComponent(path)}`
    : LOGIN_PATH;
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": NO_STORE },
  });
}

/** Ingen leser svaret. Plassen frigis i `finally`. */
function clientGone(): Response {
  return new Response(null, { status: 499, headers: { "Cache-Control": NO_STORE } });
}

/**
 * En enkel side på norsk. Faste tekster; «Prøv igjen» er en vanlig lenke til samme adresse
 * (`href=""`), uten skript og uten verdi fra adressen.
 */
function errorPage(status: 404 | 429 | 500): Response {
  const texts =
    status === 404
      ? PDF_ERROR_TEXTS.notFound
      : status === 429
        ? PDF_ERROR_TEXTS.busy
        : PDF_ERROR_TEXTS.failed;
  const retry = status === 404 ? "" : `<p><a href="">Prøv igjen</a></p>`;
  const text = texts.text ? `<p>${texts.text}</p>` : "";
  const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${texts.title}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b2a33;background:#f6f8f9;line-height:1.5}
main{max-width:36rem;margin:4rem auto;padding:0 1.5rem}
h1{font-size:1.5rem;margin:0 0 1rem}
a{display:inline-flex;align-items:center;min-height:44px;color:#0b5c7a;font-weight:600}
a:focus-visible{outline:3px solid #0b5c7a;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>${texts.title}</h1>
${text}${retry}
<p><a href="/arbeidskoe">Til arbeidskøen</a></p>
</main>
</body>
</html>
`;
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": NO_STORE,
    "Content-Security-Policy": contentSecurityPolicy,
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 429) headers["Retry-After"] = "5";
  return new Response(html, { status, headers });
}
