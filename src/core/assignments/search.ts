import { and, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { assignmentParties, assignments, cadastralUnits, orders, properties } from "@/db/schema";
import { SEARCH_QUERY_MAX_LENGTH, likePattern } from "@/shared/lib/like-pattern";

/*
 * Søkevilkåret for ordrelisten og arbeidskøen (docs/funksjoner/fase2a-sok-ordre-arbeidsko.md,
 * ADR 0010). Vilkåret står bare her, slik at de to listene alltid finner det samme.
 *
 * Slik brukes det:
 * - Begge spørringene har `assignments` med (arbeidskøen i FROM, ordrelisten som LEFT JOIN).
 *   `assignmentFieldsMatch` peker på den raden. Uten oppdrag (LEFT JOIN uten treff) gir den usant.
 * - `orderFieldsMatch` peker på `orders`-raden der den står. Ordrelisten har `orders` i FROM.
 * - `assignmentBookingFieldsMatch` peker på de samme bestillingsfeltene på `assignments`-raden.
 *   Oppdraget eier bestillingsopplysningene (ADR 0011, A292), så arbeidskøen søker i dem direkte,
 *   uten underspørring mot `orders`. Et oppdrag laget uten ordre finnes da på adresse, matrikkel,
 *   bestiller og meglerens ordrenummer.
 * - Den som kaller, setter vilkårene sammen med `or` og legger resultatet i sin egen WHERE, som
 *   allerede filtrerer på `grant.organizationId`.
 *
 * Regler:
 * - `organizationId` er alltid `grant.organizationId` fra tilgangssjekken, aldri en id fra
 *   adressen. Hver `EXISTS` filtrerer selv på organisasjon og `deleted_at is null`, så en part,
 *   eiendom eller matrikkel i en annen organisasjon aldri gir treff.
 * - Undertabeller hentes bare med `EXISTS`, aldri med join. Da blir det ingen doble rader.
 * - Vilkåret sjekker ikke om oppdraget er kansellert. Ordrelisten finner derfor ordren også når
 *   oppdraget er kansellert; arbeidskøen fjerner kansellerte i sin egen WHERE.
 * - E-post og telefon til parter er ikke søkefelt.
 * - Søketeksten logges aldri og sendes aldri til KI.
 */

/** Et søk som ser ut som matrikkel: gnr/bnr, eventuelt med festenummer og seksjonsnummer. */
export type CadastralQuery = { gnr: string; bnr: string; fnr?: string; snr?: string };

const CADASTRAL_PATTERN = /^(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?$/;

/**
 * Tolker `tall/tall[/tall[/tall]]` som gnr/bnr[/fnr[/snr]]. Mellomrom rundt «/» og i endene
 * tåles. Sifrene gis tilbake slik de er skrevet. Alt annet gir `null` og kaster aldri
 * («12/», «abc», «12/34/», «12/a»).
 */
export function parseCadastralQuery(query: string): CadastralQuery | null {
  const match = CADASTRAL_PATTERN.exec(query.trim());
  if (!match) return null;
  const [, gnr, bnr, fnr, snr] = match;
  if (gnr === undefined || bnr === undefined) return null;
  return {
    gnr,
    bnr,
    ...(fnr === undefined ? {} : { fnr }),
    ...(snr === undefined ? {} : { snr }),
  };
}

/** Delvis treff uten forskjell på store og små bokstaver i minst én av kolonnene. */
function containsAny(pattern: string, columns: AnyColumn[]): SQL | undefined {
  return or(...columns.map((column) => sql`${column} ilike ${pattern} escape '\\'`));
}

/** Samme tekst etter trimming. Tom kolonne (`null`) gir aldri treff. */
function sameTrimmed(column: AnyColumn, value: string): SQL {
  return sql`trim(${column}) = ${value}`;
}

/** Bestillingsfeltene som søkes i. Samme navn på `orders` og `assignments` (ADR 0011). */
type BookingColumns = {
  addressText: AnyColumn;
  externalRef: AnyColumn;
  orderedByText: AnyColumn;
  gnr: AnyColumn;
  bnr: AnyColumn;
  snr: AnyColumn;
};

/**
 * Matrikkelen i bestillingen. Bestillingen har ikke festenummer, så et søk med festenummer
 * (annet enn 0) gir aldri treff her, bare i `cadastral_units`. Ellers ville «12/34/7» funnet alle
 * bestillinger på 12/34.
 */
function bookingCadastralMatch(
  columns: BookingColumns,
  cadastral: CadastralQuery,
): SQL | undefined {
  if (cadastral.fnr !== undefined && Number(cadastral.fnr) !== 0) return undefined;
  return and(
    sameTrimmed(columns.gnr, cadastral.gnr),
    sameTrimmed(columns.bnr, cadastral.bnr),
    cadastral.snr === undefined ? undefined : sameTrimmed(columns.snr, cadastral.snr),
  );
}

/** Søket slik det sammenlignes: trimmet og kuttet som i `likePattern`. */
function cadastralFrom(query: string): CadastralQuery | null {
  return parseCadastralQuery(query.trim().slice(0, SEARCH_QUERY_MAX_LENGTH));
}

/**
 * Treff i bestillingsfeltene: adressen (`address_text`), meglerens ordrenummer (`external_ref`),
 * oppdragsgiveren (`ordered_by_text`) og matrikkelen. Tekstfeltene gir delvis treff. Matrikkelen
 * sammenlignes del for del når søket ser ut som matrikkel: «12/34» finner 12/34, ikke 112/34.
 * Tomt søk gir `undefined` (ingen filtrering).
 */
function bookingFieldsMatch(columns: BookingColumns, query: string): SQL | undefined {
  const pattern = likePattern(query);
  if (pattern === null) return undefined;
  const cadastral = cadastralFrom(query);
  return or(
    containsAny(pattern, [columns.addressText, columns.externalRef, columns.orderedByText]),
    cadastral === null ? undefined : bookingCadastralMatch(columns, cadastral),
  );
}

/** Bestillingsfeltene på ordren (`orders`-raden i spørringen). Se `bookingFieldsMatch`. */
export function orderFieldsMatch(query: string): SQL | undefined {
  return bookingFieldsMatch(orders, query);
}

/**
 * Bestillingsfeltene på oppdraget (`assignments`-raden i spørringen). Se `bookingFieldsMatch`.
 * Brukes av arbeidskøen; ingen underspørring, så det treffer indeksene på `assignments`.
 */
export function assignmentBookingFieldsMatch(query: string): SQL | undefined {
  return bookingFieldsMatch(assignments, query);
}

/**
 * Treff i oppdraget og det som hører til: oppdragsnummeret, eiendommens adresse, partenes navn og
 * firma, og matrikkelen i `cadastral_units`. Peker på `assignments`-raden i spørringen. Slettet
 * part, eiendom eller matrikkel gir aldri treff. Tomt festenummer regnes som 0. Tomt søk gir
 * `undefined` (ingen filtrering).
 *
 * @param organizationId `grant.organizationId` fra tilgangssjekken.
 */
export function assignmentFieldsMatch(organizationId: string, query: string): SQL | undefined {
  const pattern = likePattern(query);
  if (pattern === null) return undefined;
  const cadastral = cadastralFrom(query);

  const propertyMatch = sql`exists (
    select 1 from ${properties}
    where ${properties.organizationId} = ${organizationId}
      and ${properties.deletedAt} is null
      and ${properties.id} = ${assignments.propertyId}
      and ${properties.address} ilike ${pattern} escape '\\'
  )`;

  const partyMatch = sql`exists (
    select 1 from ${assignmentParties}
    where ${assignmentParties.organizationId} = ${organizationId}
      and ${assignmentParties.deletedAt} is null
      and ${assignmentParties.assignmentId} = ${assignments.id}
      and ${containsAny(pattern, [assignmentParties.name, assignmentParties.firmName])}
  )`;

  // Eiendommen er med i spørringen slik at matrikkelen til en slettet eiendom ikke gir treff.
  const cadastralMatch =
    cadastral === null
      ? undefined
      : sql`exists (
    select 1 from ${cadastralUnits}
    inner join ${properties}
      on ${properties.id} = ${cadastralUnits.propertyId}
      and ${properties.organizationId} = ${organizationId}
      and ${properties.deletedAt} is null
    where ${cadastralUnits.organizationId} = ${organizationId}
      and ${cadastralUnits.deletedAt} is null
      and ${cadastralUnits.propertyId} = ${assignments.propertyId}
      and ${and(
        sameTrimmed(cadastralUnits.gnr, cadastral.gnr),
        sameTrimmed(cadastralUnits.bnr, cadastral.bnr),
        cadastral.fnr === undefined
          ? undefined
          : sql`coalesce(nullif(trim(${cadastralUnits.fnr}), ''), '0') = ${cadastral.fnr}`,
        cadastral.snr === undefined ? undefined : sameTrimmed(cadastralUnits.snr, cadastral.snr),
      )}
  )`;

  return or(
    sql`${assignments.number} ilike ${pattern} escape '\\'`,
    propertyMatch,
    partyMatch,
    cadastralMatch,
  );
}
