import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, orders } from "@/db/schema";
import { MAX_DUPLICATE_WINDOW_DAYS } from "./codes";

/*
 * SQL-delen av regelen for mulig dublett (T3, docs/funksjoner/fase2a-varsel-dublett.md). Uttrykkene
 * under står bare her. Migreringen `0033_indekser-mulig-dublett.sql` har nøyaktig samme tekst i
 * uttrykksindeksene, og paritetstesten (`duplicates-parity.test.ts`) krever at TS-funksjonene i
 * `duplicates.ts`, uttrykkene her og uttrykkene i indeksene gir samme svar.
 *
 * Bare IMMUTABLE-funksjoner (`lower`, `split_part`, `regexp_replace`, `ltrim`, `nullif`), ellers kan
 * de ikke stå i en indeks. Tom nøkkel er `NULL`, aldri tom tekst, slik at den aldri gir treff.
 * Kolonnenavnene står uten tabellnavn, så samme tekst virker i indeksen og i spørringen (ingen av
 * kolonnene finnes på `assignments`).
 *
 * Endres et uttrykk, må det lages en ny migrering som bytter indeksen, ellers slutter spørringen
 * å bruke den.
 */

/** Adressenøkkel: delen før første komma, små bokstaver, bare bokstaver og tall. */
export const ORDER_ADDRESS_KEY_SQL =
  "nullif(regexp_replace(lower(split_part(address_text, ',', 1)), '[^[:alnum:]]', '', 'g'), '')";

/** Matrikkelnummer: uten mellomrom og innledende nuller. Tomt eller bare nuller er `NULL`. */
function cadastreNumberSql(column: "gnr" | "bnr" | "snr"): string {
  return `nullif(ltrim(regexp_replace(${column}, '[[:space:]]', '', 'g'), '0'), '')`;
}

export const ORDER_GNR_KEY_SQL = cadastreNumberSql("gnr");
export const ORDER_BNR_KEY_SQL = cadastreNumberSql("bnr");
export const ORDER_SNR_KEY_SQL = cadastreNumberSql("snr");

/** Tidsvinduet som fast varighet (90 × 24 timer), så sommertid ikke flytter grensen. */
const WINDOW_INTERVAL_SQL = `interval '${MAX_DUPLICATE_WINDOW_DAYS * 24} hours'`;

/** Oppdragsstatusene der oppdraget fortsatt er åpent. */
const OPEN_ASSIGNMENT_STATUSES = ["ordered", "in_progress"];

/** Én side mer enn det som vises, så tjenesten vet om det finnes flere. */
export const POSSIBLE_DUPLICATES_SHOWN = 10;

/** Normaliserte nøkler for oppslaget. `snr` er tom tekst når ordren ikke har seksjon. */
export type PossibleDuplicatesQueryCriteria = {
  addressKey: string | null;
  cadastre: { gnr: string; bnr: string; snr: string } | null;
  receivedAt: Date;
  excludeOrderId: string | null;
};

/**
 * Spørringen etter mulige dubletter i én organisasjon. `organizationId` skal alltid være
 * `grant.organizationId` fra tilgangssjekken. Hver gren (adresse, matrikkel) er en egen betingelse
 * som treffer sin indeks; mangler nøkkelen, er grenen ikke med i det hele tatt. Henter én rad mer
 * enn det som vises. Rekkefølge: nyeste `received_at` først, så `id`.
 *
 * Eksporteres for EXPLAIN-testen; tjenestene står i `duplicates.ts`.
 */
export function possibleDuplicatesQuery(
  organizationId: string,
  criteria: PossibleDuplicatesQueryCriteria,
) {
  const addressExpr = sql.raw(ORDER_ADDRESS_KEY_SQL);
  const gnrExpr = sql.raw(ORDER_GNR_KEY_SQL);
  const bnrExpr = sql.raw(ORDER_BNR_KEY_SQL);
  const snrExpr = sql.raw(ORDER_SNR_KEY_SQL);

  const addressMatch: SQL | null =
    criteria.addressKey === null ? null : sql`${addressExpr} = ${criteria.addressKey}`;
  const cadastreMatch: SQL | null =
    criteria.cadastre === null
      ? null
      : sql`(${gnrExpr} = ${criteria.cadastre.gnr} and ${bnrExpr} = ${criteria.cadastre.bnr} and coalesce(${snrExpr}, '') = ${criteria.cadastre.snr})`;
  const branches = [addressMatch, cadastreMatch].filter((branch): branch is SQL => branch !== null);

  const receivedAt = sql`${criteria.receivedAt.toISOString()}::timestamptz`;
  const window = sql.raw(WINDOW_INTERVAL_SQL);

  return db
    .select({
      id: orders.id,
      receivedAt: orders.receivedAt,
      addressText: orders.addressText,
      status: orders.status,
      assignmentNumber: assignments.number,
      assignmentStatus: assignments.status,
      addressMatch: addressMatch === null ? sql<boolean>`false` : sql<boolean>`${addressMatch}`,
      cadastreMatch: cadastreMatch === null ? sql<boolean>`false` : sql<boolean>`${cadastreMatch}`,
    })
    .from(orders)
    .leftJoin(
      assignments,
      and(
        eq(assignments.id, orders.assignmentId),
        eq(assignments.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(orders.organizationId, organizationId),
        isNull(orders.deletedAt),
        criteria.excludeOrderId === null ? undefined : ne(orders.id, criteria.excludeOrderId),
        ne(orders.status, "rejected"),
        // Kansellert oppdrag gir ikke treff. Uten oppdrag er kolonnen NULL fra joinen.
        isNull(assignments.deletedAt),
        or(
          eq(orders.status, "received"),
          inArray(assignments.status, OPEN_ASSIGNMENT_STATUSES),
          sql`${orders.receivedAt} between ${receivedAt} - ${window} and ${receivedAt} + ${window}`,
        ),
        branches.length === 0 ? sql`false` : or(...branches),
      ),
    )
    .orderBy(desc(orders.receivedAt), desc(orders.id))
    .limit(POSSIBLE_DUPLICATES_SHOWN + 1);
}
