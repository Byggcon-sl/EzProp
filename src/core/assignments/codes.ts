/**
 * Faste koder for oppdrag og nummerserier (docs/05-domenemodell.md 4.3). Kodene står bare her og
 * i CHECK-reglene i `src/db/schema/assignments.ts` og `number-sequences.ts`. En kode endres
 * aldri; skal den få ny betydning, arkiveres den og det lages en ny (regel 6). Nye koder kan
 * legges til.
 */

/** Type oppdrag. Bare tilstandsrapport nå. */
export const ASSIGNMENT_TYPES = ["condition_report"] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

/** Oppdragsstatusene fra Ståle 27.10.2026, i rekkefølge. Overgangene står i `status-flow.ts`. */
export const ASSIGNMENT_STATUSES = ["ordered", "in_progress", "completed", "invoiced"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Hva en nummerserie teller. Bare oppdragsnumre nå. */
export const NUMBER_SEQUENCE_SCOPES = ["assignment"] as const;
export type NumberSequenceScope = (typeof NUMBER_SEQUENCE_SCOPES)[number];

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ordered: "Bestilt",
  in_progress: "Under arbeid",
  completed: "Ferdig",
  invoiced: "Fakturert",
};

/** Norsk etikett for en oppdragsstatus. Ukjent kode gir koden tilbake. */
export function assignmentStatusLabel(code: string): string {
  return (ASSIGNMENT_STATUS_LABELS as Record<string, string>)[code] ?? code;
}

/** Rollene i teamet på oppdraget, i fast rekkefølge. Én aktiv person per rolle (A61). */
export const TEAM_ROLES = [
  "responsible",
  "co_responsible",
  "inspector",
  "peer_reviewer",
  "office",
] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Rollene en part kan ha på oppdraget, i fast rekkefølge (A60). */
export const PARTY_ROLES = [
  "broker",
  "seller",
  "buyer",
  "seller_representative",
  "invoice_recipient",
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  responsible: "Ansvarlig takstmann",
  co_responsible: "Medansvarlig",
  inspector: "Befaringstakstmann",
  peer_reviewer: "Sidemann",
  office: "Saksbehandler",
};

const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  broker: "Megler",
  seller: "Selger",
  buyer: "Kjøper",
  seller_representative: "Selgers representant",
  invoice_recipient: "Fakturamottaker",
};

/** Norsk etikett for en rolle i teamet. Ukjent kode gir koden tilbake. */
export function teamRoleLabel(code: string): string {
  return (TEAM_ROLE_LABELS as Record<string, string>)[code] ?? code;
}

/** Norsk etikett for rollen til en part. Ukjent kode gir koden tilbake. */
export function partyRoleLabel(code: string): string {
  return (PARTY_ROLE_LABELS as Record<string, string>)[code] ?? code;
}

/** Hva en part mottar: rapport, faktura og kopi av meldinger. */
export type PartyReceives = {
  receivesReport: boolean;
  receivesInvoice: boolean;
  receivesMessages: boolean;
};

const DEFAULT_RECEIVES: Record<PartyRole, PartyReceives> = {
  broker: { receivesReport: true, receivesInvoice: false, receivesMessages: true },
  seller: { receivesReport: true, receivesInvoice: false, receivesMessages: true },
  buyer: { receivesReport: true, receivesInvoice: false, receivesMessages: false },
  seller_representative: { receivesReport: true, receivesInvoice: false, receivesMessages: true },
  invoice_recipient: { receivesReport: false, receivesInvoice: true, receivesMessages: false },
};

/**
 * Hva parten mottar som standard etter rollen (A62). Brukes bare til å forhåndsutfylle
 * skjemaet; kontoret kan endre, og kjernen lagrer det som sendes. Ukjent rolle gir alt nei.
 */
export function defaultReceives(role: string): PartyReceives {
  const found = (DEFAULT_RECEIVES as Record<string, PartyReceives | undefined>)[role];
  return found
    ? { ...found }
    : { receivesReport: false, receivesInvoice: false, receivesMessages: false };
}
