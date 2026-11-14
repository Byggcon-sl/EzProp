import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, orders } from "@/db/schema";
import { MAX_DUPLICATE_WINDOW_MS } from "./duplicates";

/*
 * SQL-uttrykkene for mulig dublett (T3). Tekstene står bare her. Migreringen
 * `src/db/migrations/0033_indekser-mulig-dublett.sql` har uttrykksindekser med nøyaktig samme
 * tekst, slik at oppslaget kan bruke indeks (A291). Endres et uttrykk, må det lages en ny
 * migrering som bytter indeksen, og paritetstesten må være grønn.
 *
 * Bare IMMUTABLE-funksjoner (`split_part`, `translate`, `regexp_replace`, `ltrim`, `nullif`), ellers
 * kan ikke PostgreSQL lage indeksen. Store bokstaver gjøres små med `translate` og en fast liste
 * (A–Z og ÆØÅ), ikke med `lower`, fordi `lower` og tegnklasser som `[[:alnum:]]` avhenger av
 * `LC_CTYPE` i databasen. Da gir uttrykket samme svar i alle databaser og samme svar som
 * `normalizeAddressKey` og `normalizeCadastreNumber` i `./duplicates.ts`. Tom nøkkel blir `NULL`
 * (`nullif(..., '')`), som `null` i TS, og `NULL` er aldri lik noe.
 *
 * Konstantene har kolonnene uten tabellnavn, slik indeksen har dem. Fra migrering 0034 har også
 * `assignments` kolonnene `address_text`, `gnr`, `bnr` og `snr` (ADR 0011). Spørringen under
 * kobler på `assignments` og skriver derfor kolonnene med tabellnavn (`forOrders`); PostgreSQL
 * bruker fortsatt indeksen. Når spørringen deles i to delspørringer med `UNION ALL` (ADR 0011
 * punkt 10) og filen flyttes til `@/core/assignments/booking/`, faller dette bort.
 */

/** Normalisert adresse: delen før første komma, små bokstaver, bare a–z, 0–9 og æøå. */
export const ORDER_ADDRESS_KEY_SQL =
  "nullif(regexp_replace(translate(split_part(address_text, ',', 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', 'abcdefghijklmnopqrstuvwxyzæøå'), '[^a-z0-9æøå]', '', 'g'), '')";

/** Normalisert gnr, bnr eller snr: uten mellomrom og innledende nuller. Tom eller bare nuller blir `NULL`. */
function cadastreNumberSql(column: "gnr" | "bnr" | "snr"): string {
  return `nullif(ltrim(regexp_replace(${column}, '[ \\t\\n\\r\\u00a0]', '', 'g'), '0'), '')`;
}

export const ORDER_GNR_KEY_SQL = cadastreNumberSql("gnr");
export const ORDER_BNR_KEY_SQL = cadastreNumberSql("bnr");
export const ORDER_SNR_KEY_SQL = cadastreNumberSql("snr");

/** Uttrykket med kolonnen skrevet som `"orders".kolonne`, til spørringer som kobler på `assignments`. */
function forOrders(expression: string): string {
  return expression.replace(/\b(address_text|gnr|bnr|snr)\b/g, '"orders".$1');
}

/** Navnene på indeksene i migreringen. */
export const ORDER_ADDRESS_KEY_INDEX = "orders_organization_id_address_key_idx";
export const ORDER_CADASTRE_KEY_INDEX = "orders_organization_id_cadastre_key_idx";

/** Oppdragsstatusene som regnes som åpne: den andre ordren gir treff uansett hvor gammel den er. */
const OPEN_ASSIGNMENT_STATUSES = ["ordered", "in_progress"];

/** Hentes én mer enn vist, så `hasMore` kan settes uten å telle. */
export const POSSIBLE_DUPLICATES_LIMIT = 10;

/** Normaliserte verdier for ordren det sammenlignes med. Lages av tjenesten fra ordrefeltene. */
export type PossibleDuplicatesCriteria = {
  addressKey: string | null;
  cadastre: { gnr: string; bnr: string; snr: string } | null;
  receivedAt: Date;
  excludeOrderId: string | null;
};

/**
 * Spørringen for mulig dublett, brukt av tjenesten og av `EXPLAIN`-testen. `organizationId` skal
 * være `grant.organizationId` fra tilgangssjekken. Minst én av `addressKey` og `cadastre` må være
 * satt (tjenesten spør ikke ellers). Gir høyst `POSSIBLE_DUPLICATES_LIMIT + 1` rader, nyeste
 * mottatt først og så `id`, én rad per ordre.
 */
export function possibleDuplicatesQuery(
  organizationId: string,
  criteria: PossibleDuplicatesCriteria,
) {
  const addressMatch: SQL =
    criteria.addressKey === null
      ? sql`false`
      : sql`${sql.raw(forOrders(ORDER_ADDRESS_KEY_SQL))} = ${criteria.addressKey}`;
  const cadastreMatch: SQL =
    criteria.cadastre === null
      ? sql`false`
      : sql`(${sql.raw(forOrders(ORDER_GNR_KEY_SQL))} = ${criteria.cadastre.gnr} and ${sql.raw(
          forOrders(ORDER_BNR_KEY_SQL),
        )} = ${criteria.cadastre.bnr} and coalesce(${sql.raw(forOrders(ORDER_SNR_KEY_SQL))}, '') = ${
          criteria.cadastre.snr
        })`;

  const time = criteria.receivedAt.getTime();
  return db
    .select({
      id: orders.id,
      receivedAt: orders.receivedAt,
      addressText: orders.addressText,
      status: orders.status,
      assignmentNumber: assignments.number,
      assignmentStatus: assignments.status,
      addressMatch: sql<boolean>`(${addressMatch})`,
      cadastreMatch: sql<boolean>`(${cadastreMatch})`,
    })
    .from(orders)
    .leftJoin(
      assignments,
      and(eq(assignments.id, orders.assignmentId), eq(assignments.organizationId, organizationId)),
    )
    .where(
      and(
        eq(orders.organizationId, organizationId),
        isNull(orders.deletedAt),
        criteria.excludeOrderId === null ? undefined : ne(orders.id, criteria.excludeOrderId),
        ne(orders.status, "rejected"),
        // Kansellert oppdrag (myk-slettet) teller ikke
        or(isNull(orders.assignmentId), isNull(assignments.deletedAt)),
        or(addressMatch, cadastreMatch),
        // Overlappende tid: fortsatt åpen, eller høyst 90 × 24 timer mellom `received_at`
        or(
          eq(orders.status, "received"),
          inArray(assignments.status, OPEN_ASSIGNMENT_STATUSES),
          and(
            gte(orders.receivedAt, new Date(time - MAX_DUPLICATE_WINDOW_MS)),
            lte(orders.receivedAt, new Date(time + MAX_DUPLICATE_WINDOW_MS)),
          ),
        ),
      ),
    )
    .orderBy(desc(orders.receivedAt), desc(orders.id))
    .limit(POSSIBLE_DUPLICATES_LIMIT + 1);
}
