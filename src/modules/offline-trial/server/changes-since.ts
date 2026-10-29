/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kandidat 3 (egenbygd): «endringer siden sist» for hente-ruten `GET /api/prove/synk/hent`
 * (docs/funksjoner/fase1-kandidat-egenbygd.md, forarbeid pkt. 2 og bit 2). Tilgangen sjekkes først,
 * så leses markøren, og hver spørring filtrerer på `grant.organizationId`, aldri på en id fra
 * adressen eller markøren (CLAUDE.md regel 2). Myk slettede rader er med, så enheten fjerner dem.
 *
 * Markørens tid (`u`) er alltid tekst med mikrosekunder i UTC, lest fra PostgreSQL med `to_char`.
 * Den går aldri gjennom JS `Date` som helhet: overlappet trekkes fra på millisekund-delen, og de tre
 * siste sifrene (mikrosekundene) beholdes uendret.
 *
 * Ingen indeks på `(organization_id, updated_at, id)` i prøven (funn til ADR-en).
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { isUuid } from "@/shared/lib/uuid";
import { localColumnsOf } from "../sync/local-columns";
import { normalizeLocalRow } from "../sync/local/normalize-row";
import { InvalidTrialCursorError } from "./errors";
import {
  NIL_UUID,
  TRIAL_PULL_CURSOR_MAX_LENGTH,
  TRIAL_PULL_LIMIT,
  TRIAL_PULL_OVERLAP_MS,
  TRIAL_PULL_TABLE_ORDER,
  type DecodeTrialPullCursor,
  type EncodeTrialPullCursor,
  type ListTrialChangesSince,
  type TrialChangeTable,
  type TrialChangesSinceResult,
  type TrialPullCursor,
  type TrialPullPosition,
} from "./types";

/** `YYYY-MM-DDTHH:MM:SS.ffffffZ` i UTC, år 0001–9999 (PostgreSQL tar ikke år 0). */
const CURSOR_TIME = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Startverdien for en tabell som ikke er lest ennå: før alle rader. */
export const START_POSITION: TrialPullPosition = { u: "1970-01-01T00:00:00.000000Z", id: NIL_UUID };

/** `to_char`-mønsteret som gir samme form som `CURSOR_TIME`. */
const PG_CURSOR_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** Tiden finnes i kalenderen (ikke 30. februar) og har riktig form. */
function isCursorTime(value: string): boolean {
  if (!CURSOR_TIME.test(value)) return false;
  const millis = Date.parse(`${value.slice(0, 23)}Z`);
  return (
    !Number.isNaN(millis) && new Date(millis).toISOString().slice(0, 23) === value.slice(0, 23)
  );
}

const positionSchema = z
  .object({
    u: z.string().refine(isCursorTime),
    id: z.string().refine(isUuid),
  })
  .strict();

const cursorSchema = z
  .object({
    v: z.literal(1),
    t: z
      .object({
        trial_forms: positionSchema.optional(),
        trial_answers: positionSchema.optional(),
        trial_photos: positionSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const encodeTrialPullCursor: EncodeTrialPullCursor = (cursor: TrialPullCursor) =>
  Buffer.from(JSON.stringify({ v: cursor.v, t: cursor.t }), "utf8").toString("base64url");

export const decodeTrialPullCursor: DecodeTrialPullCursor = (text: string) => {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > TRIAL_PULL_CURSOR_MAX_LENGTH ||
    !BASE64URL.test(text)
  ) {
    throw new InvalidTrialCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw new InvalidTrialCursorError();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw new InvalidTrialCursorError();
  return result.data;
};

/**
 * Trekker overlappet fra en markørtid uten å miste mikrosekundene: millisekund-delen regnes med
 * `Date`, de tre siste sifrene følger med uendret.
 */
export function subtractOverlap(u: string, overlapMs: number = TRIAL_PULL_OVERLAP_MS): string {
  const millis = Date.parse(`${u.slice(0, 23)}Z`) - overlapMs;
  return `${new Date(millis).toISOString().slice(0, 23)}${u.slice(23, 26)}Z`;
}

type PulledRow = Record<string, unknown> & { pull_u: string; id: string };

/** Én tabell fra posisjonen, høyst `limit` rader, sortert på `(updated_at, id)`. */
async function readTable(
  table: TrialChangeTable,
  organizationId: string,
  from: TrialPullPosition,
  limit: number,
): Promise<PulledRow[]> {
  const columns = localColumnsOf(table).map((column) =>
    // `value` er jsonb; som tekst kommer den ut som JSON-tekst, slik enheten lagrer den.
    column === "value" ? sql`"value"::text as "value"` : sql.identifier(column),
  );
  const rows = await db.execute<PulledRow>(sql`
    select ${sql.join(columns, sql`, `)},
      to_char(updated_at at time zone 'UTC', ${PG_CURSOR_FORMAT}) as pull_u
    from ${sql.identifier(table)}
    where organization_id = ${organizationId}
      and (updated_at, id) > (${from.u}::timestamptz, ${from.id}::uuid)
    order by updated_at, id
    limit ${limit}
  `);
  return [...rows];
}

export const listTrialChangesSince: ListTrialChangesSince = async (
  actor: Actor,
  organizationId: string,
  cursor: string | null,
) => {
  // Tilgangen først: en fremmed organisasjon får 403 før markøren i det hele tatt leses.
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const previous = cursor === null ? null : decodeTrialPullCursor(cursor);

  const endringer: TrialChangesSinceResult["endringer"] = {
    trial_forms: [],
    trial_answers: [],
    trial_photos: [],
  };
  const next: TrialPullCursor = { v: 1, t: {} };
  let remaining = TRIAL_PULL_LIMIT;
  let ferdig = true;

  for (const table of TRIAL_PULL_TABLE_ORDER) {
    const from = previous?.t[table] ?? START_POSITION;
    if (remaining === 0) {
      // Ikke nådd i dette svaret: markøren står, neste side tar den.
      next.t[table] = from;
      ferdig = false;
      continue;
    }

    const rows = await readTable(table, grant.organizationId, from, remaining);
    remaining -= rows.length;
    endringer[table] = rows.map((row) => normalizeLocalRow(table, row));
    const last = rows.at(-1);

    if (remaining === 0 && last) {
      // Siden er full: ren keyset uten overlapp, så sidene ikke kan gå i ring.
      next.t[table] = { u: last.pull_u, id: last.id };
      ferdig = false;
    } else if (last) {
      // Ferdig lest: de siste 60 s leses på nytt neste gang (klokkene, se types.ts).
      next.t[table] = { u: subtractOverlap(last.pull_u), id: NIL_UUID };
    } else if (from.id !== NIL_UUID) {
      // Ferdig lest uten nye rader, men markøren var en ren keyset fra en full side: legg på
      // overlappet nå, ellers kunne en eldre transaksjon som committer senere, bli hoppet over.
      next.t[table] = { u: subtractOverlap(from.u), id: NIL_UUID };
    } else {
      next.t[table] = from;
    }
  }

  return { endringer, markor: encodeTrialPullCursor(next), ferdig };
};
