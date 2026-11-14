import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { assignments, orders } from "@/db/schema";
import type { DuplicateKind } from "./codes";
import { POSSIBLE_DUPLICATES_LIMIT } from "./contract";
import { MAX_DUPLICATE_WINDOW_MS } from "./duplicates";

/*
 * SQL-uttrykkene for mulig dublett (T3), felles for ordre og oppdrag (ADR 0011). Tekstene står
 * bare her. Migreringene `0033_indekser-mulig-dublett.sql` (`orders`) og
 * `0034_oppdrag-bestilling.sql` (`assignments`) har uttrykksindekser med nøyaktig samme tekst,
 * slik at oppslaget kan bruke indeks (A291). Indeksnavnene står i `DUPLICATE_KEY_INDEXES`
 * (`./contract`). Endres et uttrykk, må det lages en ny migrering som bytter begge indeksene, og
 * paritetstesten må være grønn.
 *
 * Bare IMMUTABLE-funksjoner (`split_part`, `translate`, `regexp_replace`, `ltrim`, `nullif`), ellers
 * kan ikke PostgreSQL lage indeksen. Store bokstaver gjøres små med `translate` og en fast liste
 * (A–Z og ÆØÅ), ikke med `lower`, fordi `lower` og tegnklasser som `[[:alnum:]]` avhenger av
 * `LC_CTYPE` i databasen. Da gir uttrykket samme svar i alle databaser og samme svar som
 * `normalizeAddressKey` og `normalizeCadastreNumber` i `./duplicates.ts`. Tom nøkkel blir `NULL`
 * (`nullif(..., '')`), som `null` i TS, og `NULL` er aldri lik noe.
 *
 * Uttrykkene har kolonnene uten tabellnavn, slik indeksene har dem. Spørringen er derfor to
 * delspørringer med én tabell hver, satt sammen med `UNION ALL` (ADR 0011 punkt 10).
 */

/** Normalisert adresse: delen før første komma, små bokstaver, bare a–z, 0–9 og æøå. */
export const ADDRESS_KEY_SQL =
  "nullif(regexp_replace(translate(split_part(address_text, ',', 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', 'abcdefghijklmnopqrstuvwxyzæøå'), '[^a-z0-9æøå]', '', 'g'), '')";

/** Normalisert gnr, bnr eller snr: uten mellomrom og innledende nuller. Tom eller bare nuller blir `NULL`. */
function cadastreNumberSql(column: "gnr" | "bnr" | "snr"): string {
  return `nullif(ltrim(regexp_replace(${column}, '[ \\t\\n\\r\\u00a0]', '', 'g'), '0'), '')`;
}

export const GNR_KEY_SQL = cadastreNumberSql("gnr");
export const BNR_KEY_SQL = cadastreNumberSql("bnr");
export const SNR_KEY_SQL = cadastreNumberSql("snr");

/** Oppdragsstatusene som regnes som åpne: oppdraget gir treff uansett hvor gammelt det er. */
export const OPEN_ASSIGNMENT_STATUSES = ["ordered", "in_progress"] as const;

/**
 * Normaliserte verdier for bestillingen det sammenlignes med. Lages av tjenesten fra feltene.
 * `excludeOrderId` tar bort ordren og oppdraget som ble laget fra den. `excludeAssignmentId` tar
 * bort oppdraget og ordren som peker på det.
 */
export type PossibleDuplicatesCriteria = {
  addressKey: string | null;
  cadastre: { gnr: string; bnr: string; snr: string } | null;
  receivedAt: Date;
  excludeOrderId: string | null;
  excludeAssignmentId?: string | null;
};

/** Treff på adressen: uttrykket mot nøkkelen, eller `false` når nøkkelen mangler. */
function addressMatch(criteria: PossibleDuplicatesCriteria): SQL {
  return criteria.addressKey === null
    ? sql`false`
    : sql`${sql.raw(ADDRESS_KEY_SQL)} = ${criteria.addressKey}`;
}

/** Treff på matrikkelen. Tom `snr` er lik `0` og lik tom (`coalesce(..., '')`). */
function cadastreMatch(criteria: PossibleDuplicatesCriteria): SQL {
  const cadastre = criteria.cadastre;
  if (cadastre === null) return sql`false`;
  return sql`(${sql.raw(GNR_KEY_SQL)} = ${cadastre.gnr} and ${sql.raw(BNR_KEY_SQL)} = ${
    cadastre.bnr
  } and coalesce(${sql.raw(SNR_KEY_SQL)}, '') = ${cadastre.snr})`;
}

/**
 * Spørringen for mulig dublett, brukt av tjenesten og av `EXPLAIN`-testen. `organizationId` skal
 * være `grant.organizationId` fra tilgangssjekken. Minst én av `addressKey` og `cadastre` må være
 * satt (tjenesten spør ikke ellers).
 *
 * To delspørringer med `UNION ALL`:
 * - ordre med status `received` (ikke gjort om, ikke avvist) som ikke er slettet. En mottatt
 *   ordre er åpen, så den gir treff uansett alder;
 * - oppdrag som ikke er slettet (kansellert teller ikke), med åpen status eller høyst 90 × 24
 *   timer mellom mottakstidene (grensen teller med, A291).
 * Et oppdrag fra en ordre gir dermed ett treff, oppdraget. Gir høyst `POSSIBLE_DUPLICATES_LIMIT
 * + 1` rader, nyeste mottatt først og så `id`.
 */
export function possibleDuplicatesQuery(
  organizationId: string,
  criteria: PossibleDuplicatesCriteria,
) {
  const time = criteria.receivedAt.getTime();
  const excludeOrderId = criteria.excludeOrderId ?? null;
  const excludeAssignmentId = criteria.excludeAssignmentId ?? null;
  const limit = POSSIBLE_DUPLICATES_LIMIT + 1;

  const orderMatches = db
    .select({
      kind: sql<DuplicateKind>`'order'::text`.as("kind"),
      id: orders.id,
      number: sql<string | null>`null::text`.as("number"),
      status: orders.status,
      receivedAt: orders.receivedAt,
      addressText: orders.addressText,
      orderId: sql<string | null>`null::uuid`.as("order_id"),
      addressMatch: sql<boolean>`(${addressMatch(criteria)})`.as("address_match"),
      cadastreMatch: sql<boolean>`(${cadastreMatch(criteria)})`.as("cadastre_match"),
    })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        isNull(orders.deletedAt),
        eq(orders.status, "received"),
        excludeOrderId === null ? undefined : ne(orders.id, excludeOrderId),
        excludeAssignmentId === null
          ? undefined
          : or(isNull(orders.assignmentId), ne(orders.assignmentId, excludeAssignmentId)),
        or(addressMatch(criteria), cadastreMatch(criteria)),
      ),
    )
    .orderBy(desc(orders.receivedAt), desc(orders.id))
    .limit(limit);

  const assignmentMatches = db
    .select({
      kind: sql<DuplicateKind>`'assignment'::text`.as("kind"),
      id: assignments.id,
      number: assignments.number,
      status: assignments.status,
      receivedAt: assignments.receivedAt,
      addressText: assignments.addressText,
      orderId: assignments.orderId,
      addressMatch: sql<boolean>`(${addressMatch(criteria)})`.as("address_match"),
      cadastreMatch: sql<boolean>`(${cadastreMatch(criteria)})`.as("cadastre_match"),
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
        excludeAssignmentId === null ? undefined : ne(assignments.id, excludeAssignmentId),
        excludeOrderId === null
          ? undefined
          : or(isNull(assignments.orderId), ne(assignments.orderId, excludeOrderId)),
        or(addressMatch(criteria), cadastreMatch(criteria)),
        // Overlappende tid: fortsatt åpent, eller høyst 90 × 24 timer mellom `received_at`
        or(
          inArray(assignments.status, [...OPEN_ASSIGNMENT_STATUSES]),
          and(
            gte(assignments.receivedAt, new Date(time - MAX_DUPLICATE_WINDOW_MS)),
            lte(assignments.receivedAt, new Date(time + MAX_DUPLICATE_WINDOW_MS)),
          ),
        ),
      ),
    )
    .orderBy(desc(assignments.receivedAt), desc(assignments.id))
    .limit(limit);

  return unionAll(orderMatches, assignmentMatches)
    .orderBy(desc(sql`received_at`), desc(sql`id`))
    .limit(limit);
}

export type PossibleDuplicateRow = Awaited<ReturnType<typeof possibleDuplicatesQuery>>[number];
