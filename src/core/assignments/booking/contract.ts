import type { Actor } from "@/core/access";
import type { AssignmentStatus } from "../codes";
import type { BookingEditableField, BookingSource, DuplicateKind, DuplicateReason } from "./codes";

/*
 * Grensesnittet for «Nytt oppdrag» og bestillingen på oppdraget (ADR 0011,
 * docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 4). Utvikler og testskriver bygger mot typene
 * her. Bare typer og konstanter: ingen spørringer og ingen forretningslogikk.
 *
 * Felles for alle tjenestene:
 * - Tilgang sjekkes først med `requireOrganizationAccess`. Spørringer filtrerer på
 *   `grant.organizationId`, aldri på en id fra adressen eller skjemaet.
 * - Fremmed, ukjent, slettet og ugyldig oppdrags-id gir samme feil: `AccessDeniedError`.
 * - Ingen eksporterte spørrehjelpere uten tilgangssjekk.
 * - Personvern: input, raden og Zod-feilen sendes aldri til loggeren, og ingen feil har verdier
 *   i meldingen. Hendelser har bare id-er og feltkoder. Ingenting sendes til KI.
 *
 * Filene i `booking/` (utvikler flytter dit fra `@/core/orders`, som så importerer herfra):
 * `schemas.ts` (felles Zod-regler), `duplicates.ts` (normalisering og regel), `duplicate-sql.ts`
 * (SQL-uttrykk og spørring), `history.ts` (lesing av revisjonsloggen), `update.ts` (felles
 * sammenligning av gammel og ny verdi for ordre og oppdrag).
 */

/* ------------------------------------------------------------------ felt */

/**
 * Bestillingsfeltene slik skjemaet sender dem. Samme navn og regler for ordre og oppdrag (den
 * felles Zod-regelen `bookingInputSchema(now)` i `./schemas`). Tom tekst blir `null`. Elleve
 * sifre på rad avvises i `addressText`, `orderedByText`, `externalRef` og
 * `housingAssociationName` (A299). Ukjente felt, også `organizationId`, tas bort.
 */
export type BookingInput = {
  /** Påkrevd, 1–300 tegn. */
  addressText: string;
  /** Oslo-tid fra skjemaet, eller `Date`. Aldri frem i tid. Tom: se hver tjeneste. */
  receivedAt?: string | Date | null;
  /** Meglerens ordrenummer, høyst 200 tegn. */
  externalRef?: string | null;
  /** Hvem som bestilte som fritekst, høyst 200 tegn. */
  orderedByText?: string | null;
  /** Bestilleren i kontaktregisteret. Firmaet settes fra kontakten, aldri fra skjemaet. */
  orderedByContactId?: string | null;
  /** Bare sifre, høyst 10. */
  gnr?: string | null;
  bnr?: string | null;
  snr?: string | null;
  /** Borettslag eller sameie, høyst 200 tegn. */
  housingAssociationName?: string | null;
  /** Avkrysningen sender `"on"`. Ikke i skjemaet «Nytt oppdrag»; følger med fra ordren. */
  sellerDeclarationReceived?: boolean | string | null;
};

/** Bestillingen slik den er lagret på oppdraget. Vises på kortet «Bestilling». */
export type AssignmentBooking = {
  receivedAt: Date;
  source: BookingSource;
  externalRef: string | null;
  orderedByText: string | null;
  orderedByContactId: string | null;
  /** Navnet til kontakten, eller `null` når ingen er koblet eller kontakten er fjernet. */
  orderedByContactName: string | null;
  orderedByFirmId: string | null;
  orderedByFirmName: string | null;
  addressText: string;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  housingAssociationName: string | null;
  sellerDeclarationReceived: boolean;
};

/* ------------------------------------------------------------- oppretting */

/**
 * Skjemaet «Nytt oppdrag». `organizationId`, `number`, `status`, `source`, `assignmentType`,
 * utstedende selskap og firma tas aldri fra skjemaet. `sellerDeclarationReceived` er ikke med.
 */
export type CreateAssignmentInput = Omit<BookingInput, "sellerDeclarationReceived"> & {
  /** Kontoret. Må finnes i organisasjonen og ikke være slettet, ellers `OfficeNotFoundError`. */
  officeId: string;
  /**
   * Ansvarlig takstmann (teamrollen `responsible`). Må være ansatt i organisasjonen, ikke slettet
   * og ikke deaktivert (ellers `EmployeeNotFoundError`), og ha rollen `inspector` (ellers
   * `ResponsibleNotInspectorError`).
   */
  responsibleEmployeeId: string;
  /** Avtalt befaring (valgfri), samme regel som `assignmentScheduleSchema.inspectionAt`. */
  inspectionAt?: string | Date | null;
  /**
   * Engangsnøkkel (uuid) laget når skjemaet åpnes (A298). Samme nøkkel to ganger gir det første
   * oppdraget tilbake. Valgfri for kall som ikke kommer fra skjemaet.
   */
  creationKey?: string | null;
};

export type CreateAssignmentOptions = { now?: Date };

export type CreateAssignmentResult = {
  id: string;
  number: string;
  status: AssignmentStatus;
  rowVersion: number;
  /** `false` når `creationKey` allerede var brukt og det første oppdraget ble gitt tilbake. */
  created: boolean;
};

/**
 * Kontrakten for `createAssignment` (`src/core/assignments/create.ts`):
 * - Krever `assignment.edit`. Takstmann uten `access.inspectors_edit_all` får
 *   `AccessDeniedError`; admin har alltid tilgang (regel 11).
 * - Ugyldig skjema gir `ZodError` med norske meldinger per felt. Tom `receivedAt` betyr «nå».
 * - Én transaksjon: (1) finnes `creationKey` fra før i organisasjonen (også på et kansellert
 *   oppdrag), gis det oppdraget tilbake med `created: false`, uten nytt nummer, hendelse eller
 *   loggrad; (2) kontor, ansvarlig og kontakt slås opp med `grant.organizationId`; (3) nummer fra
 *   `nextAssignmentNumber`; (4) oppdraget lagres med `status = ordered`, `source = manual`,
 *   `assignmentType = condition_report`, `orderId = null`, utstedende selskap fra ansvarlig
 *   (samme regel som `setTeamMember`); (5) teamraden `responsible`; (6) hendelsen
 *   `assignment.created` med `{ number, orderId: null }` og revisjonslogg `assignment`/`create`
 *   uten verdier. Feiler ett steg, lagres ingenting og nummeret brukes ikke.
 * - To samtidige kall med samme `creationKey`: den unike indeksen
 *   `assignments_organization_id_creation_key_idx` stopper det andre, som da gir det første
 *   oppdraget tilbake (`created: false`).
 * - Feil: `OfficeNotFoundError`, `EmployeeNotFoundError`, `ResponsibleNotInspectorError`,
 *   `ContactNotFoundError`. Fremmed og ukjent id gir samme feil.
 */
export type CreateAssignment = (
  actor: Actor,
  organizationId: string,
  input: CreateAssignmentInput,
  options?: CreateAssignmentOptions,
) => Promise<CreateAssignmentResult>;

/* ---------------------------------------------------------------- endring */

export type UpdateAssignmentBookingResult = {
  id: string;
  rowVersion: number;
  booking: AssignmentBooking;
  /** Feltkodene som ble endret. Tom når ingenting var endret. */
  fields: BookingEditableField[];
};

/**
 * Kontrakten for `updateAssignmentBooking` (`src/core/assignments/booking/update.ts`):
 * - Krever `assignment.edit`. Virker i alle statuser. Et kansellert (mykt slettet) oppdrag gir
 *   `AccessDeniedError`.
 * - Raden låses med `FOR UPDATE`. Er `expectedRowVersion` ulik raden, kastes
 *   `AssignmentChangedError` og ingenting endres.
 * - Endrer bare feltene i `BOOKING_EDITABLE_FIELDS`. Firmaet følger kontakten. Kilde, nummer,
 *   status, kontor og ordren endres aldri her, og ordren røres ikke.
 * - Tom `receivedAt` og samme minutt som lagret betyr uendret (som for ordren).
 * - Ved endring: `row_version` øker, revisjonslogg `assignment`/`update` med
 *   `{ fields, values: { felt: { from, to } } }` (A252, samme form som for ordren, laget av én
 *   felles funksjon), og hendelsen `assignment.booking_updated` med `{ assignmentId, fields }`.
 * - Ingen endring: ingen oppdatering, loggrad eller hendelse, og `row_version` er uendret.
 */
export type UpdateAssignmentBooking = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: BookingInput,
  expectedRowVersion: number,
  now?: Date,
) => Promise<UpdateAssignmentBookingResult>;

/* -------------------------------------------------------------- historikk */

export type BookingHistoryValue = {
  field: BookingEditableField;
  /** Tekst, ja/nei eller tom. Bestiller og firma er navn (eller «(fjernet …)»), ikke id-er. */
  from: string | boolean | null;
  to: string | boolean | null;
};

/** Én rad under «Endringer». Samme form for ordre og oppdrag. */
export type BookingHistoryEntry = {
  id: string;
  /** `create` eller `update` for oppdraget. */
  action: string;
  actorName: string | null;
  occurredAt: Date;
  fields: BookingEditableField[];
  values: BookingHistoryValue[];
};

/** Høyst så mange rader vises, de nyeste. */
export const BOOKING_HISTORY_LIMIT = 200;

/**
 * Kontrakten for `listAssignmentBookingHistory`:
 * - Krever `organization.read`. Leser revisjonsloggen for oppdraget, bare handlingene `create`
 *   og `update` der `changes.fields` har bestillingsfelt (andre endringer på oppdraget er ikke
 *   med). Nyeste først, høyst `BOOKING_HISTORY_LIMIT`.
 * - Gir aldri rå `changes`. Ukjente feltkoder og verdier i feil form hoppes over uten unntak.
 * - Vises bare per oppdrag, aldri som oppsummering per ansatt (arbeidsmiljøloven kap. 9).
 */
export type ListAssignmentBookingHistory = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<BookingHistoryEntry[]>;

/* ---------------------------------------------------------------- dublett */

/** Feltene dublettregelen ser på. Kan være et skjema som ikke er lagret. */
export type PossibleDuplicateFields = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  receivedAt: Date | string;
  /** Ordren selv når oppslaget gjelder en lagret ordre. */
  excludeOrderId?: string | null;
  /** Oppdraget selv når oppslaget gjelder et lagret oppdrag. Ordren det kom fra tas også bort. */
  excludeAssignmentId?: string | null;
};

/**
 * Ett treff. Fast nøkkelliste: aldri matrikkel, bestiller, kontakter eller
 * reklamasjonsopplysninger. `addressText` vises bare på skjermen i samme organisasjon (A290),
 * logges aldri og sendes aldri til KI.
 */
export type PossibleDuplicate = {
  kind: DuplicateKind;
  id: string;
  /** Oppdragsnummeret. `null` for en ordre. */
  number: string | null;
  /** Ordrestatus (`received`) eller oppdragsstatus, etter `kind`. */
  status: string;
  receivedAt: Date;
  addressText: string;
  reasons: DuplicateReason[];
};

export type PossibleDuplicates = { items: PossibleDuplicate[]; hasMore: boolean };

/** Hentes én mer enn vist, så `hasMore` kan settes uten å telle. */
export const POSSIBLE_DUPLICATES_LIMIT = 10;

/**
 * Kontrakten for `findPossibleDuplicatesFor`:
 * - Krever `organization.read`. Bare lesing: ingenting skrives, logges med verdier eller sendes
 *   til KI. Skjermen kaller den med POST eller server action, aldri med verdier i adressen.
 * - Treff er `UNION ALL` av (a) ordre med status `received` (ikke gjort om, ikke avvist, ikke
 *   slettet) og (b) oppdrag som ikke er slettet (kansellert teller ikke). Et oppdrag fra en ordre
 *   gir dermed ett treff, oppdraget.
 * - Samme adressenøkkel eller samme gnr/bnr/snr, og overlappende tid: ordren er `received`,
 *   oppdraget er `ordered` eller `in_progress`, eller høyst 90 × 24 timer mellom mottakstidene
 *   (grensen teller med, A291).
 * - Fra ADR 0012 (tilbud): en ordre med `received` gir treff uansett alder bare når
 *   `valid_until >= today`. Er den utløpt, gjelder 90-dagersvinduet (A325). `today` kommer fra
 *   `todayInOslo` og sendes inn i `PossibleDuplicatesCriteria`.
 * - Høyst `POSSIBLE_DUPLICATES_LIMIT`, nyeste mottatt først og så `id`; `hasMore` når det finnes
 *   flere. Uten adressenøkkel og matrikkel: tom liste uten spørring.
 * - Ugyldige felt gir `ZodError`. Feiler databasen, kastes `PossibleDuplicatesLookupError` uten
 *   verdier, og loggen får bare feilnavn og PostgreSQL-kode.
 */
export type FindPossibleDuplicatesFor = (
  actor: Actor,
  organizationId: string,
  fields: PossibleDuplicateFields,
) => Promise<PossibleDuplicates>;

/**
 * Kontrakten for `findPossibleDuplicatesForAssignment` (varselet på oppdragssiden): tynn
 * innpakning som leser feltene fra oppdraget og setter `excludeAssignmentId`. Fremmed, ukjent
 * eller slettet oppdrag gir `AccessDeniedError`.
 */
export type FindPossibleDuplicatesForAssignment = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<PossibleDuplicates>;

/**
 * Navnene på uttrykksindeksene i migreringene 0033 (`orders`) og 0034 (`assignments`).
 * Uttrykkene er de samme for begge tabellene og står ett sted (`./duplicate-sql`). Kolonnene må
 * skrives med tabellnavn eller i hver sin delspørring, fordi begge tabellene nå har
 * `address_text`, `gnr`, `bnr` og `snr`.
 */
export const DUPLICATE_KEY_INDEXES = {
  order: {
    address: "orders_organization_id_address_key_idx",
    cadastre: "orders_organization_id_cadastre_key_idx",
  },
  assignment: {
    address: "assignments_organization_id_address_key_idx",
    cadastre: "assignments_organization_id_cadastre_key_idx",
  },
} as const satisfies Record<DuplicateKind, { address: string; cadastre: string }>;

/* -------------------------------------------------------------- valglister */

/** Valgene i skjemaet «Nytt oppdrag». Kontaktvelgeren bruker kontaktsøket som i dag. */
export type NewAssignmentFormOptions = {
  /** Kontorene som kan velges (ikke slettet), i `sort_order`. */
  offices: { id: string; name: string }[];
  /** Aktive ansatte med rollen `inspector`, sortert på navn. */
  inspectors: { id: string; name: string }[];
  /** Den innloggedes kontor når det finnes blant valgene (A295), ellers `null`. */
  defaultOfficeId: string | null;
  /** Den innloggede når hen er blant `inspectors` (A295), ellers `null`. */
  defaultResponsibleEmployeeId: string | null;
};

/**
 * Kontrakten for `getNewAssignmentFormOptions`: krever `assignment.edit` (samme som oppretting,
 * så siden `/oppdrag/ny` kan avvise tydelig). Bare id og navn, filtrert på
 * `grant.organizationId`.
 */
export type GetNewAssignmentFormOptions = (
  actor: Actor,
  organizationId: string,
) => Promise<NewAssignmentFormOptions>;
