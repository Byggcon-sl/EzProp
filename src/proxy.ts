import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "@/core/auth/request-path";

/*
 * Next sin innebygde proxy (rett T-0070, docs/agenter/oppgaver/rett-t0070-t0071.md punkt 2).
 * Setter hodet `x-request-path` med stien til siden som ble bedt om, slik at `requireActor` kan
 * sende til `/logg-inn?neste=<sti>` og brukeren kommer tilbake etter innlogging.
 *
 * - Et hode med samme navn fra klienten slettes alltid.
 * - Bare `pathname`, aldri spørrestreng (den kan bære søketekst eller navn).
 * - Ingen innloggingssjekk, ingen tilgangssjekk og ingen logging her. Tilgang sjekkes bare i
 *   src/core/access, og `requireActor` sjekker stien på nytt med `isSafeNextPath`.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(REQUEST_PATH_HEADER);
  headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Hopper over /api, /_next, /logg-inn og filer med endelse (f.eks. favicon.ico, sw.js).
  matcher: ["/((?!api/|api$|_next/|logg-inn/|logg-inn$|.*\\..*).*)"],
};
