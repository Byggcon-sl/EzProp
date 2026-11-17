import type { Actor } from "@/core/access";
import type { AssignmentStatus, CreateAssignmentInput } from "@/core/assignments";
import type { ClaimType } from "./codes";

/*
 * Grensesnittet for reklamasjonskoblingen (ADR 0013, docs/funksjoner/fase2a-reklamasjonskobling.md,
 * Omfang 5). Utvikler og testskriver bygger mot typene her. Bare typer og konstanter: ingen
 * spørringer og ingen forretningslogikk. Tjenestene bygges i `./reinspections.ts`.
 *
 * Kjeden: opprinnelig oppdrag (`claims.assignment_id`) → sak (`claims`) → ny befaring
 * (`claim_reinspections.assignment_id`).
 *
 * Felles for alle seks tjenestene:
 * - Tilgang sjekkes først med `requireOrganizationAccess`, før noe leses eller skrives.
 *   Spørringer filtrerer på `grant.organizationId`, aldri på en id fra adressen eller skjemaet.
 * - Id-er og oppdragsnummer valideres før spørringen (Zod i `./schemas.ts`).
 * - «Finnes ikke» er `AccessDeniedError`, samme feil for: uten tilgang, ukjent eller ugyldig id,
 *   id i en annen organisasjon, fjernet sak, fjernet opprinnelig oppdrag, fjernet nytt oppdrag
 *   og fjernet kobling. Feilen sier aldri hvilken av dem det var.
 * - Lesing joiner alltid mot sak, opprinnelig oppdrag og nytt oppdrag som ikke er fjernet. Et
 *   nytt oppdrag i papirkurven skjuler koblingen, men raden står og sperrer (A425).
 * - Ingen eksporterte spørrehjelpere uten tilgangssjekk.
 * - Personvern: ingen fritekst fra saken ut av disse tjenestene, i hendelser, revisjonslogg eller
 *   applikasjonslogg. Ingenting sendes til KI. Ingen feil har verdier i meldingen.
 * - Hendelser og revisjonslogg (A426): `claim_reinspection.linked` og `.unlinked` har sakens
 *   opprinnelige oppdrag i `assignmentId` og `data: { claimId, reinspectionId,
 *   reinspectionAssignmentId }`. Revisjonsraden har `entityType: "claim_reinspection"`, aldri
 *   `"assignment"`. Ingenting om saken skrives på det nye oppdragets egne rader.
 */

/** Regelkodene. Navnene brukes i testene. */
export const REINSPECTION_RULES = [
  "reinspection_not_original",
  "reinspection_one_active_claim",
  "reinspection_same_organization",
  "reinspection_no_duplicate",
  "reinspection_creation_key_reuse",
] as const;
export type ReinspectionRule = (typeof REINSPECTION_RULES)[number];

/** Navnet på den unike delindeksen (migrering 0036). Brudd (23505) oversettes i tjenestene. */
export const REINSPECTION_ACTIVE_ASSIGNMENT_INDEX =
  "claim_reinspections_organization_id_assignment_id_idx";

/** Høyst så mange foreslåtte oppdrag (A427). */
export const REINSPECTION_CANDIDATES_LIMIT = 20;

/** Verdiene i revisjonsloggen og hendelsene for koblingen. */
export const CLAIM_REINSPECTION_ENTITY_TYPE = "claim_reinspection";

/* ------------------------------------------------------------------ typer */

/** En aktiv kobling slik den vises på saken. Bare id-er, nummer, status og dato. */
export type ClaimReinspection = {
  /** Koblingens id (`claim_reinspections.id`). */
  id: string;
  claimId: string;
  /** Oppdraget for ny befaring. */
  assignmentId: string;
  assignmentNumber: string;
  assignmentStatus: AssignmentStatus;
  inspectionAt: Date | null;
  createdAt: Date;
};

/** Et foreslått oppdrag å knytte til (F1). Fast nøkkelliste: aldri adresse, matrikkel eller parter. */
export type ReinspectionCandidate = {
  assignmentId: string;
  assignmentNumber: string;
  status: AssignmentStatus;
  inspectionAt: Date | null;
  /** Navnet til ansvarlig takstmann, eller `null` når ingen er satt. */
  responsibleName: string | null;
};

/** Det delen «Reklamasjon» på det nye oppdraget trenger. Aldri fritekst fra saken. */
export type ReinspectionOrigin = {
  reinspectionId: string;
  claimId: string;
  claimType: ClaimType;
  /** Sakens opprinnelige oppdrag. */
  originalAssignmentId: string;
  originalAssignmentNumber: string;
};

/**
 * Skjemaet «Lag oppdrag for ny befaring». Alt annet (adresse, gnr/bnr/snr, borettslag, kontor og
 * eiendom) leses fra det opprinnelige oppdraget i samme transaksjon og tas aldri fra skjemaet.
 * Ukjente felt tas bort.
 */
export type CreateReinspectionAssignmentInput = Pick<
  CreateAssignmentInput,
  "responsibleEmployeeId" | "inspectionAt" | "internalNote" | "creationKey"
>;

export type CreateReinspectionAssignmentResult = {
  reinspection: ClaimReinspection;
  /** `false` når engangsnøkkelen alt var brukt for samme sak og koblingen ble gitt tilbake. */
  created: boolean;
};

/** Oppdraget som skal knyttes til: id fra kandidatlisten, eller nummer fra søket (reserve). */
export type LinkReinspectionTarget = { assignmentId: string } | { assignmentNumber: string };

export type LinkReinspectionResult = {
  reinspection: ClaimReinspection;
  /** `false` når oppdraget alt var knyttet til samme sak (`reinspection_no_duplicate`). */
  created: boolean;
};

/* -------------------------------------------------------------- tjenester */

/**
 * Kontrakten for `createReinspectionAssignment`:
 * - Krever `claims.manage` og `assignment.edit`. `claims.manage` sjekkes først, og
 *   `assignment.edit` sjekkes (i tillegg til sjekken inne i `createAssignment`) før transaksjonen
 *   åpnes, slik at ingenting leses for den som mangler én av dem. Kontor og takstmann får
 *   `AccessDeniedError`.
 * - Ugyldig skjema gir `ZodError` før noe skrives (også notat med elleve sifre på rad).
 * - Én transaksjon: (1) `lockClaim` (saken og det opprinnelige oppdraget, ikke fjernet);
 *   (2) les det opprinnelige oppdraget med `grant.organizationId`; (3) `createAssignment` med
 *   `{ executor: tx, propertyId, now }` og input bygd av kjernen: `addressText`, `gnr`, `bnr`,
 *   `snr`, `housingAssociationName` og `officeId` fra det opprinnelige oppdraget, og
 *   `responsibleEmployeeId`, `inspectionAt`, `internalNote` og `creationKey` fra skjemaet;
 *   (4) koblingen settes inn med `createdBy = grant.employeeId`; (5) hendelsen
 *   `claim_reinspection.linked` og revisjonsraden `claim_reinspection`/`create`. Feiler ett
 *   steg, lagres ingenting: aldri et oppdrag uten kobling.
 * - Kopieres aldri: `orderedByText`, `orderedByContactId`, firma, `externalRef`, parter, team,
 *   pris, ordre og avtale. Selskapet følger ansvarlig takstmann (A65–A68). `receivedAt` er nå.
 * - `reinspection_creation_key_reuse`: gir `createAssignment` `created: false`, gis koblingen
 *   tilbake (`created: false`) bare når det oppdraget har en aktiv kobling til samme sak og ikke
 *   er fjernet. Ellers `AccessDeniedError`, og ingen ny kobling.
 * - Samtidige kall med samme nøkkel: brudd på
 *   `assignments_organization_id_creation_key_idx` (23505) fanges utenfor transaksjonen;
 *   tjenesten leser på nytt og følger regelen over. Aldri en uhåndtert databasefeil.
 * - Feil fra `createAssignment` slippes gjennom: `EmployeeNotFoundError`,
 *   `ResponsibleNotInspectorError`, `OfficeNotFoundError`.
 */
export type CreateReinspectionAssignment = (
  actor: Actor,
  organizationId: string,
  claimId: string,
  input: CreateReinspectionAssignmentInput,
  now?: Date,
) => Promise<CreateReinspectionAssignmentResult>;

/**
 * Kontrakten for `listReinspectionCandidates` (F1, A427):
 * - Krever `claims.manage`. Bare lesing.
 * - Oppdrag i organisasjonen på samme eiendom (`property_id`) eller samme adressenøkkel (samme
 *   normalisering og SQL-uttrykk som dublettvarselet, `@/core/assignments`) som det opprinnelige
 *   oppdraget, laget etter det (`created_at`), ikke fjernet (kansellert er fjernet), ikke det
 *   opprinnelige og uten aktiv kobling til noen sak.
 * - Nyeste først (`created_at desc, id desc`), høyst `REINSPECTION_CANDIDATES_LIMIT`.
 */
export type ListReinspectionCandidates = (
  actor: Actor,
  organizationId: string,
  claimId: string,
) => Promise<ReinspectionCandidate[]>;

/**
 * Kontrakten for `linkReinspectionAssignment`:
 * - Krever `claims.manage`.
 * - Målet slås opp med `grant.organizationId`. Ukjent oppdrag, oppdrag i en annen organisasjon
 *   og fjernet oppdrag gir samme `AccessDeniedError`, aldri «allerede koblet»
 *   (`reinspection_same_organization`).
 * - Én transaksjon: `lockClaim`, så reglene, så innsetting, hendelse og revisjonsrad.
 * - `reinspection_not_original`: `ReinspectionIsOriginalAssignmentError`.
 * - `reinspection_no_duplicate`: aktiv kobling til samme sak gis tilbake med `created: false`,
 *   uten ny rad, hendelse eller revisjonsrad.
 * - `reinspection_one_active_claim`: aktiv kobling til en annen sak gir
 *   `ReinspectionAlreadyLinkedError`. Brudd på `REINSPECTION_ACTIVE_ASSIGNMENT_INDEX` (23505) ved
 *   samtidige kall fanges utenfor transaksjonen og følger de to reglene over.
 */
export type LinkReinspectionAssignment = (
  actor: Actor,
  organizationId: string,
  claimId: string,
  target: LinkReinspectionTarget,
) => Promise<LinkReinspectionResult>;

/**
 * Kontrakten for `unlinkReinspectionAssignment`:
 * - Krever `claims.manage`. Myk sletting av koblingen (`deleted_at`, `deleted_by`,
 *   `row_version` øker). Oppdraget røres ikke.
 * - Hendelsen `claim_reinspection.unlinked` og revisjonsraden `claim_reinspection`/`delete`.
 * - Fjernet kobling, ukjent id og id i en annen organisasjon gir samme `AccessDeniedError`.
 */
export type UnlinkReinspectionAssignment = (
  actor: Actor,
  organizationId: string,
  reinspectionId: string,
) => Promise<void>;

/**
 * Kontrakten for `listReinspectionsForClaim`: krever `claims.read`. Sakens aktive koblinger der
 * det nye oppdraget ikke er fjernet, eldste først (`created_at, id`).
 */
export type ListReinspectionsForClaim = (
  actor: Actor,
  organizationId: string,
  claimId: string,
) => Promise<ClaimReinspection[]>;

/**
 * Kontrakten for `getClaimForReinspectionAssignment` (delen «Reklamasjon» på det nye oppdraget):
 * krever `claims.read`. `null` når oppdraget ikke er ny befaring for en sak. Uten `claims.read`
 * kastes `AccessDeniedError`; siden kaller ikke tjenesten da (ingen props om saken til klienten).
 */
export type GetClaimForReinspectionAssignment = (
  actor: Actor,
  organizationId: string,
  assignmentId: string,
) => Promise<ReinspectionOrigin | null>;

/**
 * Tillegg til `updateClaim` (F4, A429): når `claimType` endres, får revisjonsraden også
 * `claimTypeFrom` og `claimTypeTo` (faste koder). Ingen ny hendelse og ingen ny tabell.
 */
export type ClaimTypeTransition = { claimTypeFrom: ClaimType; claimTypeTo: ClaimType };

/**
 * Tillegg til `removeClaim` (A424): sakens aktive koblinger fjernes mykt i samme transaksjon og
 * med samme `deleted_at` som saken. Ingen egne `unlinked`-hendelser; revisjonsraden for saken
 * får `reinspectionIds`.
 */
export type RemoveClaimReinspections = { reinspectionIds: string[] };
