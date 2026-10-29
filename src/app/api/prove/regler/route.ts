/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Prøve E: regner ut regelsvaret på serveren med samme `evaluateTrialRules` som iPaden bruker
 * uten nett. Tar `{ organizationId, answers: { water_heater_age, moisture_floor } }`.
 * Tilgang sjekkes bare i `src/core/access`. Ingen databasespørring, ingenting lagres, og kroppen
 * logges aldri (heller ikke ved 400). Alle svar har `Cache-Control: private, no-store`.
 */
import { z } from "zod";
import { getCurrentActor } from "@/core/auth/session";
import { requireOrganizationAccess } from "@/core/access";
import { evaluateTrialRules, trialRules } from "@/modules/offline-trial/rules";
import { notLoggedIn, trialErrorResponse } from "../error-response";

export const dynamic = "force-dynamic";

const ROUTE = "/api/prove/regler";
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** Hvert felt er et JSON-tall, `null` eller mangler. Negativt tall avgjøres av motoren. */
const trialRulesRequestSchema = z
  .object({
    organizationId: z.string().uuid(),
    answers: z
      .object({
        water_heater_age: z.number().nullable().optional(),
        moisture_floor: z.number().nullable().optional(),
      })
      .strict(),
  })
  .strict();

export async function POST(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return notLoggedIn();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  const parsed = trialRulesRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequest();
  const { organizationId, answers } = parsed.data;

  try {
    await requireOrganizationAccess(actor, organizationId, "organization.read");
  } catch (error) {
    return trialErrorResponse(error, ROUTE, actor.id);
  }

  return Response.json({ results: evaluateTrialRules(trialRules, answers) }, { headers: NO_STORE });
}

/** 400 uten å logge eller gjenta noe fra kroppen. */
function invalidRequest(): Response {
  return Response.json(
    { feil: "Svarene kunne ikke leses. Noe i dem er ugyldig." },
    { status: 400, headers: NO_STORE },
  );
}
