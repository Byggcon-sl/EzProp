import { logRejectedOperationsCall, verifyOperationsSecret } from "@/core/access";
import { purgeExpiredAuthData } from "@/core/auth/auth-cleanup";

/*
 * Rydding av innloggingsdata (ADR 0014). Kalles av en planlagt jobb med driftshemmeligheten.
 * En innlogget bruker gir ikke tilgang, bare `Authorization: Bearer <AUTH_CLEANUP_SECRET>`.
 *
 * Bare POST. Ruten leser verken body eller adresseparametre: grenser og tid kan aldri styres
 * utenfra. Uten, med feil eller med feil oppsatt hemmelighet svarer den 404 uten innhold, slik at
 * endepunktet ikke røpes. Ingen svar mellomlagres.
 */
export const dynamic = "force-dynamic";

const ROUTE = "/api/intern/rydd-innloggingsdata";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  if (!verifyOperationsSecret(request.headers.get("authorization"))) {
    logRejectedOperationsCall(ROUTE);
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  try {
    const { loginAttempts, verifications, sessions, durationMs } = await purgeExpiredAuthData();
    return Response.json(
      { loginAttempts, verifications, sessions, durationMs },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    // Ryddefunksjonen har allerede logget feilen med referansekode. Ingen detaljer i svaret.
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}
