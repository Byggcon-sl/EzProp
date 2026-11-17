import type { SQL } from "drizzle-orm";
import type { Actor } from "@/core/access";
import type { BookingEditableField } from "@/core/assignments/booking/codes";
import type { BookingInput } from "@/core/assignments/booking/contract";
import type { Assignment, Order } from "@/db/schema";
import type {
  OfferDisplayStatus,
  OfferListFilter,
  OfferRejectionReasonKey,
  OrderSource,
  OrderStatus,
} from "./codes";

/*
 * Grensesnittet for «Tilbud i stedet for ordre» (ADR 0012, docs/funksjoner/fase2a-tilbud.md).
 * Utvikler og testskriver bygger mot typene her. Bare typer og konstanter: ingen spørringer og
 * ingen forretningslogikk.
 *
 * Navn: «Tilbud» er navnet i grensesnittet. I koden heter det fortsatt `order` (tabellen `orders`,
 * modulen `src/core/orders`, hendelsene `order.*`, statuskodene `received`, `converted`,
 * `rejected`). Nye navn som bare gjelder tilbudet, heter `offer…` (utløp, visningsstatus, filter).
 *
 * Felles for alle tjenestene (som før):
 * - Tilgang sjekkes først med `requireOrganizationAccess`. Spørringer filtrerer på
 *   `grant.organizationId`, aldri på en id fra adressen eller skjemaet.
 * - Fremmed, ukjent, mykt slettet og ugyldig tilbuds-id gir samme feil: `AccessDeniedError`.
 * - Dagens dato kommer fra `todayInOslo(now)` (`@/shared/lib/dates`) og sendes som parameter,
 *   også til SQL. Aldri `now()` eller `current_date` i databasen.
 * - Personvern: input, raden og Zod-feilen sendes aldri til loggeren, og ingen feil har verdier
 *   i meldingen. Hendelser har bare id-er og feltkoder. Ingenting sendes til KI.
 */

/* ------------------------------------------------------------------ utløp */

/** Et nytt tilbud foreslås gyldig i så mange dager fra i dag. Står bare her (ADR 0012 punkt 3). */
export const OFFER_VALID_DAYS = 30;

/** «Gyldig til» kan være høyst så mange dager fram (A328). */
export const OFFER_VALID_UNTIL_MAX_DAYS = 365;

/**
 * Et åpent tilbud med så mange dager eller færre igjen får merket «Går ut …» og knappen
 * «Forleng 30 dager» (F1, F3, A365, A366). Står bare her.
 */
export const OFFER_EXPIRING_SOON_DAYS = 7;

/**
 * Dager igjen til tilbudet går ut, ren funksjon (`./offer-status.ts`, F3): `validUntil − today` i
 * hele kalenderdager. 0 = går ut i dag, 1 = i morgen, negativt = utløpt. Begge er «ÅÅÅÅ-MM-DD»,
 * så sommertid spiller ingen rolle. Merket vises når status er `open` og svaret er
 * 0–`OFFER_EXPIRING_SOON_DAYS`.
 */
export type OfferDaysLeft = (validUntil: string, today: string) => number;

/**
 * Utløpsregelen, ren funksjon (`./offer-status.ts`): sant når `status` er `received` og
 * `validUntil < today`. Begge datoene er «ÅÅÅÅ-MM-DD» i norsk tid og sammenlignes som tekst.
 * Samme dag er ikke utløpt. `converted` og `rejected` er aldri utløpt.
 */
export type IsOfferExpired = (status: OrderStatus, validUntil: string, today: string) => boolean;

/**
 * Visningsstatusen for ett tilbud: `expired` når `isOfferExpired` er sann, ellers `received` →
 * `open`, `converted` → `converted`, `rejected` → `rejected`.
 */
export type OfferDisplayStatusOf = (
  status: OrderStatus,
  validUntil: string,
  today: string,
) => OfferDisplayStatus;

/**
 * SQL med samme regel som `isOfferExpired`, for `orders` uten alias:
 * `status = 'received' and valid_until < $today`. `today` er alltid en parameter. Paritetstesten
 * kjører de samme sakene mot funksjonen og uttrykket.
 */
export type OfferExpiredSql = (today: string) => SQL;

/**
 * WHERE-vilkåret for et filter i tilbudslisten. `all` gir `undefined` (ingen ekstra vilkår).
 * `open`: `received` og `valid_until >= today`. `expired`: `offerExpiredSql(today)`.
 * Bruker indeksen `OFFER_LIST_INDEX` sammen med organisasjon og `deleted_at is null`.
 */
export type OfferListFilterSql = (filter: OfferListFilter, today: string) => SQL | undefined;

/** Indeksen fra migrering 0035: `(organization_id, status, valid_until) where deleted_at is null`. */
export const OFFER_LIST_INDEX = "orders_organization_id_status_valid_until_idx";

/* ------------------------------------------------------------------- felt */

/** Feltkoden for «Gyldig til» (`validUntil`). Fast fra merge (regel 6). Står i `./codes`. */
export { VALID_UNTIL_FIELD } from "./codes";

/**
 * Feltkodene som kan endres på et tilbud: bestillingsfeltene og `validUntil`, i den rekkefølgen.
 * `ORDER_EDITABLE_FIELDS` i `./codes` blir `[...BOOKING_EDITABLE_FIELDS, VALID_UNTIL_FIELD]`.
 * `validUntil` legges aldri i `@/core/assignments/booking/codes`, så `updateAssignmentBooking`
 * godtar ikke feltet.
 */
export type OfferEditableField = BookingEditableField | "validUntil";

/**
 * Skjemaet for nytt og endret tilbud: bestillingsfeltene (`bookingInputSchema(now)`) og
 * `validUntil`. Zod-regelen `orderInputSchema(now)` utvides i `./schemas`.
 *
 * `validUntil`: «ÅÅÅÅ-MM-DD», en dato som finnes. Tom eller utelatt: ved oppretting brukes
 * `addDays(todayInOslo(now), OFFER_VALID_DAYS)`; ved endring betyr det uendret. Grensene
 * (ikke før i dag, høyst `OFFER_VALID_UNTIL_MAX_DAYS` fram) sjekkes ved oppretting, og ved
 * endring bare når datoen er ulik den lagrede. Meldinger: «Gyldig til kan ikke være før i dag.»
 * og «Gyldig til kan være høyst ett år fram.»
 */
export type OfferInput = BookingInput & { validUntil?: string | null };

/* ------------------------------------------------------------------ liste */

/**
 * `query` er søketeksten fra `?q=`. `status` er filteret fra `?status=`; utelatt eller ukjent
 * verdi gir `open`. `now` kan sendes inn i tester.
 */
export type ListOffersOptions = {
  query?: string | null;
  status?: OfferListFilter | null;
  now?: Date;
};

/** Én rad i tilbudslisten. Fast feltliste, ingen sporingsfelt. */
export type OfferListItem = {
  id: string;
  receivedAt: Date;
  source: OrderSource;
  externalRef: string | null;
  orderedByText: string | null;
  addressText: string;
  /** Lagret status. Aldri `expired`. */
  status: OrderStatus;
  /** «ÅÅÅÅ-MM-DD». */
  validUntil: string;
  /** Regnet ut med `offerDisplayStatus` og samme `today` som filteret. */
  displayStatus: OfferDisplayStatus;
  assignmentId: string | null;
  /** Nummeret vises også når oppdraget er kansellert. */
  assignmentNumber: string | null;
  /** Oppdraget er kansellert (mykt slettet). Listen viser «(kansellert)» (T-0031). */
  assignmentCancelled: boolean;
};

export type OfferListResult = {
  items: OfferListItem[];
  /** Antallet som passer filteret og søket, også når listen er kuttet ved `ORDER_LIST_LIMIT`. */
  total: number;
  /** Filteret som ble brukt (etter standardverdi). */
  status: OfferListFilter;
  /**
   * Antallet per filter med samme søk og samme `today` (F3, tallet på filterknappene).
   * `counts[status]` er alltid lik `total`. Mykt slettede telles ikke.
   */
  counts: Record<OfferListFilter, number>;
};

/**
 * Kontrakten for `listOrders` (erstatter `ListOrders` i `./list`):
 * - Krever `organization.read`. Filtrerer på `grant.organizationId`. Ansatt i en annen
 *   organisasjon gir `AccessDeniedError`, i alle filtre.
 * - Mykt slettede tilbud er aldri med, heller ikke i `expired` eller `all`.
 * - Filter og søk settes sammen med `and`. Søket er som før (ADR 0010).
 * - Sortering: «Åpne» (`open`) etter `valid_until asc, received_at desc, id desc` (de som går ut
 *   først øverst, F3). De andre filtrene etter `received_at desc, id desc`. Høyst
 *   `ORDER_LIST_LIMIT` rader. `total` telles med samme WHERE som listen.
 * - `counts` telles i én spørring med `count(*) filter (where …)` per filter, med samme
 *   uttrykk (`OfferListFilterSql`), samme søk og samme `today` som listen.
 * - Bare lesing: ingen rader i `audit_log`, hendelsene eller `ai_usage_log`.
 */
export type ListOffers = (
  actor: Actor,
  organizationId: string,
  options?: ListOffersOptions,
) => Promise<OfferListResult>;

/* --------------------------------------------------------------- tjenester */

/**
 * Kontrakten for `createOrder` (nytt tilbud): som før (gir raden), pluss `validUntil` (se
 * `OfferInput`).
 * Hendelsen `order.received` og revisjonslogg `order`/`create` er uendret og har ingen verdier.
 */
export type CreateOffer = (
  actor: Actor,
  organizationId: string,
  input: OfferInput,
  now?: Date,
) => Promise<Order>;

/**
 * Ett tilbud slik `getOrder` og `updateOrder` gir det: alle feltene uten sporingsfelt, pluss
 * `rowVersion` (til skjemaet for endring), oppdragsnummeret og om oppdraget er kansellert.
 * `getOrder` legger i tillegg til `displayStatus`, regnet med `todayInOslo(now)`.
 */
export type OfferDetail = Omit<
  Order,
  | "organizationId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "deletedAt"
  | "deletedBy"
> & {
  assignmentNumber: string | null;
  assignmentCancelled: boolean;
};

/**
 * Kontrakten for `updateOrder` (endre tilbud): som før (T1, alle statuser, `expectedRowVersion`,
 * `OrderChangedError`), pluss:
 * - `validUntil` kan bare endres når lagret status er `received` (åpent eller utløpt). Er den
 *   `converted` eller `rejected` og datoen er ulik den lagrede, kastes
 *   `OfferValidUntilLockedError`, og ingenting lagres (heller ikke de andre feltene).
 * - Lik dato som lagret, tom eller utelatt betyr uendret, i alle statuser.
 * - Endret dato står i `fields` og `values` som `validUntil` (tekst «ÅÅÅÅ-MM-DD»), i
 *   revisjonsloggen `order`/`update` og i hendelsen `order.updated` (bare feltkoden).
 * - Statusen endres aldri her. Et utløpt tilbud som får ny dato, er åpent igjen fordi regelen
 *   regnes ut ved lesing.
 */
export type UpdateOffer = (
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OfferInput,
  expectedRowVersion: number,
  now?: Date,
) => Promise<OfferDetail>;

/**
 * Kontrakten for `convertOrderToAssignment` («Gjør om til oppdrag»): uendret signatur og atferd.
 * - Krever `assignment.edit`. Virker når lagret status er `received`, også når tilbudet er
 *   utløpt. `converted` og `rejected` gir `OrderAlreadyHandledError`.
 * - Raden låses med `FOR UPDATE` før status sjekkes og nummeret hentes: to samtidige kall gir
 *   ett oppdrag, og taperen bruker ikke opp et nummer.
 * - Kopierer bestillingsfeltene til oppdraget (ADR 0011 punkt 3). `valid_until` kopieres ikke;
 *   `assignments` har ikke kolonnen.
 * - Logges som før: `assignment.created` med `{ number, orderId }` og revisjonslogg
 *   `order`/`convert`. Ingen ny hendelseskode (A326).
 */
export type ConvertOfferToAssignment = (
  actor: Actor,
  organizationId: string,
  orderId: string,
  options: { officeId: string; now?: Date },
) => Promise<{ assignment: Assignment; order: Order }>;

/**
 * De faste avslagsgrunnene med norske etiketter (F4): `price` «Pris», `timing` «Tidspunkt passet
 * ikke», `chose_other` «Valgte en annen», `customer_withdrew` «Kunden trakk seg», `other`
 * «Annet». Listen står i `./codes`.
 */
export {
  OFFER_REJECTION_REASON_KEYS,
  offerRejectionReasonLabel,
  type OfferRejectionReasonKey,
} from "./codes";

/**
 * Grunnen til avslaget (F4, A361): en fast kode fra `OFFER_REJECTION_REASON_KEYS` og valgfri
 * fritekst. Teksten er påkrevd bare ved `other`. Uten kode: «Velg en grunn.». `other` uten
 * tekst: «Skriv grunnen.». Teksten trimmes, er høyst 500 tegn og har aldri elleve sifre på rad.
 * Tom tekst blir `null`.
 */
export type OfferRejectionInput = {
  reasonKey: OfferRejectionReasonKey | string | null | undefined;
  reasonText?: string | null;
};

/**
 * Kontrakten for `rejectOrder` («Avslå tilbud»): påkrevd grunn (`rejectReasonSchema`, F4),
 * virker på åpent og utløpt tilbud, `OrderAlreadyHandledError` ellers. Lagrer
 * `rejected_reason_key` og `rejected_reason`. Hendelsen `order.rejected` får
 * `{ orderId, reasonKey }`, aldri friteksten. Koden `rejected` er den samme; bare teksten på
 * skjermen er ny («Avslått»).
 */
export type RejectOffer = (
  actor: Actor,
  organizationId: string,
  orderId: string,
  input: OfferRejectionInput,
) => Promise<Order>;

/*
 * Forbedrerens tillegg uten egne tjenester:
 * - F1 «Forleng 30 dager»: `updateOrder` med `validUntil = addDays(todayInOslo(now),
 *   OFFER_VALID_DAYS)`, de lagrede feltene og gjeldende `rowVersion`. Følger A327/A328.
 * - F2 a «Lagre som tilbud i stedet»: `createOrder` med bestillingsfeltene fra «Nytt oppdrag»
 *   uten `validUntil` (blir i dag + 30). Takstmann, befaringsdato og kontor tas bort av Zod.
 */

/* ---------------------------------------------------------------- historikk */

/**
 * `readBookingHistory` (`@/core/assignments/booking/history`) får listen over tillatte feltkoder
 * som parameter. Oppdraget sender `BOOKING_EDITABLE_FIELDS`, tilbudet sender
 * `ORDER_EDITABLE_FIELDS`. Importretningen fra ADR 0011 punkt 9 holdes: `booking` importerer
 * aldri fra `orders`, derfor er feltkoden `string` her og ikke `OfferEditableField`.
 */
export type HistoryAllowedFields = readonly string[];

/* ------------------------------------------------------------------ dublett */

/**
 * Tillegg til `PossibleDuplicatesCriteria` (`@/core/assignments/booking/duplicate-sql`): `today`
 * («ÅÅÅÅ-MM-DD» fra `todayInOslo`). Delspørringen for `orders` får vilkåret
 * `status = 'received' and (valid_until >= $today or received_at innenfor 90 × 24 timer)`:
 * et åpent tilbud gir treff uansett alder, et utløpt bare innenfor vinduet (A325). `booking`
 * sammenligner `valid_until` selv og importerer ikke utløpsregelen fra `orders`.
 */
export type DuplicateCriteriaToday = { today: string };

/**
 * Treffene i dublettvarselet (F2 b) har `kind` (`order` eller `assignment`) og `displayStatus`.
 * For `kind: "order"` er `displayStatus` visningsstatusen regnet med samme `today` som
 * spørringen: et treff fra `orders` er `open` eller `expired`; et oppdrag som kom fra et tilbud,
 * vises på tilbudssiden som tilbudet med `converted`. Et oppdrag laget direkte har `null`.
 * Bare `open` og `expired` får knappen «Gjør om tilbudet».
 */
export type DuplicateDisplayStatus = OfferDisplayStatus | null;
