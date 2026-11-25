import type { OverrideClaimMarker } from "../override-types";

/*
 * Testsakene for markeringen (docs/funksjoner/fase2a-overstyringer-leder-testplan.md O1.5, O1.6,
 * O2.1 og O4.6). Samme tabell brukes av enhetstesten (`claim-marker.test.ts`) og av
 * integrasjonstesten mot databasen (`overrides.test.ts`), så en snudd forventning gjør begge røde.
 * Alle verdier er oppdiktede.
 */

export type ClaimMarkerCaseClaim = {
  /** Mottatt dato (`claims.received_at`), norsk dato. */
  receivedAt: string;
  checkpointKey: string | null;
  deleted?: boolean;
  /** Saken står på et annet oppdrag i samme organisasjon. */
  otherAssignment?: boolean;
  /** Saken står i en annen organisasjon (oppdrag der med samme punkt). */
  otherOrganization?: boolean;
};

export type ClaimMarkerCase = {
  name: string;
  /** Punktet overstyringen gjelder. `null` = hele rapporten. */
  checkpointKey: string | null;
  /** Utgivelsene av rapporten, i versjonsrekkefølge, som UTC-tidspunkt. */
  releases: readonly string[];
  /** Versjonene som har overstyringen (1-basert). */
  overriddenVersions: readonly number[];
  claims: readonly ClaimMarkerCaseClaim[];
  /** Forventet markering per versjon med overstyring. */
  expected: Readonly<Record<number, OverrideClaimMarker>>;
};

export const CLAIM_MARKER_CHECKPOINT = "wet_room.membrane_drain";
const OTHER_CHECKPOINT = "wet_room.ventilation";

export const CLAIM_MARKER_CASES: readonly ClaimMarkerCase[] = [
  {
    name: "reklamasjon før utgivelsen gir ingen markering",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-13", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "none" },
  },
  {
    name: "reklamasjon samme dag som utgivelsen er rød",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-14", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "same_checkpoint" },
  },
  {
    name: "utgivelse kl. 23:30 norsk tid og reklamasjon neste dag er rød",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    // 14.10.2026 kl. 23:30 i Oslo (sommertid, UTC+2)
    releases: ["2026-10-14T21:30:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-15", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "same_checkpoint" },
  },
  {
    name: "vintertid: utgivelse 00:30 norsk tid er dagen etter UTC-datoen, reklamasjon dagen før er ingen",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    // 16.11.2026 kl. 00:30 i Oslo (UTC+1), UTC-datoen er 15.11
    releases: ["2026-11-15T23:30:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-11-15", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "none" },
  },
  {
    name: "vintertid: utgivelse 00:30 norsk tid og reklamasjon samme norske dag er rød",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-11-15T23:30:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-11-16", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "same_checkpoint" },
  },
  {
    name: "sommertid: utgivelse 00:30 norsk tid er dagen etter UTC-datoen, reklamasjon dagen før er ingen",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    // 16.06.2026 kl. 00:30 i Oslo (UTC+2), UTC-datoen er 15.06
    releases: ["2026-06-15T22:30:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-06-15", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "none" },
  },
  {
    name: "reklamasjon på et annet punkt gir ingen markering",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-20", checkpointKey: OTHER_CHECKPOINT }],
    expected: { 1: "none" },
  },
  {
    name: "reklamasjon uten punkt er nøytral",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-20", checkpointKey: null }],
    expected: { 1: "checkpoint_not_selected" },
  },
  {
    name: "slettet reklamasjon gir ingen markering",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [{ receivedAt: "2026-10-20", checkpointKey: CLAIM_MARKER_CHECKPOINT, deleted: true }],
    expected: { 1: "none" },
  },
  {
    name: "reklamasjon på et annet oppdrag gir ingen markering",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [
      { receivedAt: "2026-10-20", checkpointKey: CLAIM_MARKER_CHECKPOINT, otherAssignment: true },
    ],
    expected: { 1: "none" },
  },
  {
    name: "reklamasjon i en annen organisasjon med samme punkt gir ingen markering",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [
      { receivedAt: "2026-10-20", checkpointKey: CLAIM_MARKER_CHECKPOINT, otherOrganization: true },
    ],
    expected: { 1: "none" },
  },
  {
    name: "v1 og v2 med samme overstyring, reklamasjon etter v2: v2 rød, v1 ingen",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-01T10:00:00Z", "2026-10-10T10:00:00Z"],
    overriddenVersions: [1, 2],
    claims: [{ receivedAt: "2026-10-20", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "none", 2: "same_checkpoint" },
  },
  {
    name: "reklamasjon mellom v1 og v2: v1 rød, v2 ingen",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-01T10:00:00Z", "2026-10-10T10:00:00Z"],
    overriddenVersions: [1, 2],
    claims: [{ receivedAt: "2026-10-05", checkpointKey: CLAIM_MARKER_CHECKPOINT }],
    expected: { 1: "same_checkpoint", 2: "none" },
  },
  {
    name: "hele rapporten blir aldri markert, heller ikke når reklamasjonen mangler punkt",
    checkpointKey: null,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [
      { receivedAt: "2026-10-20", checkpointKey: null },
      { receivedAt: "2026-10-20", checkpointKey: CLAIM_MARKER_CHECKPOINT },
    ],
    expected: { 1: "none" },
  },
  {
    name: "rød vinner over nøytral når oppdraget har begge",
    checkpointKey: CLAIM_MARKER_CHECKPOINT,
    releases: ["2026-10-14T10:00:00Z"],
    overriddenVersions: [1],
    claims: [
      { receivedAt: "2026-10-20", checkpointKey: null },
      { receivedAt: "2026-10-21", checkpointKey: CLAIM_MARKER_CHECKPOINT },
    ],
    expected: { 1: "same_checkpoint" },
  },
];
