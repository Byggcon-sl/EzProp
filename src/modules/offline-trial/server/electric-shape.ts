/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Proxyen mellom iPaden og synktjenesten ElectricSQL (kandidat 2). iPaden leser bare via
 * `GET /api/prove/synk/shape`; Electric er aldri åpen utad. Serveren bestemmer alt i shapen
 * (tabell, filter, organisasjon, kolonner og hemmelighet). Fra klienten kopieres bare posisjonen i
 * strømmen (`offset`, `handle`, `live`, `cursor`) etter formatsjekk. Skriving går som før via
 * `POST /api/prove/synk/endringer`. Se docs/funksjoner/fase1-kandidat-electricsql.md pkt. 9 og
 * avgjørelse B.
 */
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { logger } from "@/shared/lib/logger";
import { isTrialTableName, localColumnsOf } from "../sync/local-columns";
import { InvalidTrialChangeError } from "./errors";
import {
  ELECTRIC_SECRET_MIN_BYTES,
  SHAPE_CACHE_CONTROL,
  SHAPE_CLIENT_PARAMS,
  SHAPE_FORWARDED_HEADERS,
  SHAPE_FORWARDED_STATUSES,
  SHAPE_PARAM_PATTERN,
  SHAPE_UPSTREAM_TIMEOUT_MS,
  SHAPE_WHERE,
  type BuildTrialShapeRequest,
  type ForwardTrialShape,
} from "./types";

const ROUTE = "/api/prove/synk/shape";

/**
 * Utviklingsverdien fra `.env.example`. Den er ikke hemmelig og nektes derfor når appen ikke kjører
 * på localhost (samme mønster som `POWERSYNC_JWT_SECRET`). Må være lik verdien i `.env.example`.
 */
export const DEVELOPMENT_ELECTRIC_SECRET =
  "utvikling-ikke-hemmelig-electricnokkel-bare-for-mac-0123456789";

/** Egen vokter for Electric (avgjørelse F), med vilje ikke delt med `sync-token.ts`. */
function isLocalhostAppUrl(): boolean {
  const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  try {
    const host = new URL(appUrl).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Leses ved hvert kall (ikke ved modul-last), så testene kan bytte verdien. */
function readElectricUrl(): URL {
  const value = (process.env.ELECTRIC_URL ?? "").trim();
  if (value === "") throw new Error("ELECTRIC_URL mangler. Se .env.example.");
  try {
    return new URL(value);
  } catch {
    throw new Error("ELECTRIC_URL er ikke en gyldig adresse. Se .env.example.");
  }
}

/** Leses ved hvert kall. Minst `ELECTRIC_SECRET_MIN_BYTES` byte; utviklingsverdien bare på localhost. */
function readElectricSecret(): string {
  const secret = process.env.ELECTRIC_SECRET ?? "";
  const bytes = new TextEncoder().encode(secret).length;
  if (secret.trim() === "" || bytes < ELECTRIC_SECRET_MIN_BYTES) {
    throw new Error(
      `ELECTRIC_SECRET mangler eller er kortere enn ${ELECTRIC_SECRET_MIN_BYTES} byte. Se .env.example.`,
    );
  }
  if (secret === DEVELOPMENT_ELECTRIC_SECRET && !isLocalhostAppUrl()) {
    throw new Error(
      "ELECTRIC_SECRET har utviklingsverdien fra .env.example. Den kan bare brukes når BETTER_AUTH_URL er localhost.",
    );
  }
  return secret;
}

/** `http://x/` → `/v1/shape`, `http://x/prefix` → `/prefix/v1/shape`. */
function shapeUrl(base: URL): URL {
  const url = new URL(base.href);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/shape`;
  url.search = "";
  url.hash = "";
  return url;
}

function isValidClientParam(name: string, value: string): boolean {
  if (name === "live") return value === "true";
  return SHAPE_PARAM_PATTERN.test(value);
}

export const buildTrialShapeRequest: BuildTrialShapeRequest = async (
  actor: Actor,
  organizationId: string,
  table: string,
  clientParams: URLSearchParams,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isTrialTableName(table)) {
    throw new InvalidTrialChangeError("Ukjent tabell i shape-forespørselen.");
  }
  // Formatet sjekkes før miljøet leses, så en ugyldig forespørsel alltid gir 400.
  const copied: [string, string][] = [];
  for (const name of SHAPE_CLIENT_PARAMS) {
    const value = clientParams.get(name);
    if (value === null) continue;
    if (!isValidClientParam(name, value)) {
      throw new InvalidTrialChangeError("Ugyldig posisjon i shape-forespørselen.");
    }
    copied.push([name, value]);
  }

  const url = shapeUrl(readElectricUrl());
  const secret = readElectricSecret();
  url.searchParams.set("table", table);
  url.searchParams.set("where", SHAPE_WHERE);
  // Alltid organisasjonen fra tilgangssjekken, aldri id-en fra adressen eller klienten.
  url.searchParams.set("params[1]", grant.organizationId);
  url.searchParams.set("columns", localColumnsOf(table).join(","));
  url.searchParams.set("secret", secret);
  for (const [name, value] of copied) url.searchParams.set(name, value);
  return { url };
};

function badGateway(): Response {
  return Response.json(
    { feil: "Synktjenesten svarer ikke. Prøv igjen om litt." },
    { status: 502, headers: { "Cache-Control": SHAPE_CACHE_CONTROL } },
  );
}

function isForwardedStatus(status: number): boolean {
  return (SHAPE_FORWARDED_STATUSES as readonly number[]).includes(status);
}

/** Bare rute, bruker-id, tabell og status. Aldri spørrestrengen (den har `secret`) eller rader. */
function logShape(message: string, userId: string, table: string, status: number): void {
  logger.warn(message, { route: ROUTE, userId, table, status });
}

export const forwardTrialShape: ForwardTrialShape = async (
  actor: Actor,
  organizationId: string,
  searchParams: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
) => {
  const table = searchParams.get("tabell") ?? "";
  const { url } = await buildTrialShapeRequest(actor, organizationId, table, searchParams);

  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(SHAPE_UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Feilen fra fetch kan ha vertsnavnet i seg; den logges ikke og sendes aldri videre.
    logShape("Synktjenesten (ElectricSQL) svarte ikke", actor.id, table, 502);
    return badGateway();
  }

  if (!isForwardedStatus(upstream.status)) {
    // F.eks. 401 (feil hemmelighet) eller 5xx. Electrics tekst når aldri klienten.
    await upstream.body?.cancel().catch(() => undefined);
    logShape("Uventet svar fra synktjenesten (ElectricSQL)", actor.id, table, upstream.status);
    return badGateway();
  }
  if (upstream.status !== 200 && upstream.status !== 204) {
    logShape(
      "Synktjenesten (ElectricSQL) avviste shape-forespørselen",
      actor.id,
      table,
      upstream.status,
    );
  }

  // Nye hoder: bare innholdstypen og Electrics posisjonshoder. `Cache-Control` settes sist.
  const headers = new Headers();
  for (const name of SHAPE_FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("Cache-Control", SHAPE_CACHE_CONTROL);

  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
};
