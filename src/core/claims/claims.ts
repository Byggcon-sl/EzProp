import { and, desc, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignmentParties, assignments, claims } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import type { ClaimOutcome, ClaimType } from "./codes";
import { ClaimantPartyNotFoundError } from "./errors";
import { claimInputSchema, type ClaimInput, type ClaimValues } from "./schemas";

/*
 * Reklamasjonssaker på oppdraget (docs/funksjoner/fase2a-reklamasjoner.md). Bare leder og admin:
 * lesing med `claims.read`, alt annet med `claims.manage` (Ståle 27.10.2026, A120).
 *
 * All filtrering bruker `grant.organizationId` fra tilgangssjekken, aldri parameteren. Ugyldig
 * id, fremmed eller fjernet oppdrag og fremmed eller fjernet sak gir `AccessDeniedError` med samme
 * melding som manglende rettighet, så det ikke kan avsløres at saken finnes (sidene viser 404).
 *
 * Revisjonsloggen og hendelsen får bare id-er, koder og feltnavn, aldri innholdet i
 * `claimantText`, `description` eller `buildingPartText` (kan inneholde navn og helseopplysninger).
 * Ingen permanent sletting.
 */

/** Feltene som kan endres, i fast rekkefølge (navnene går til revisjonsloggen). */
const CLAIM_FIELDS = [
  "claimType",
  "receivedAt",
  "claimantPartyId",
  "claimantText",
  "description",
  "buildingPartText",
  "outcome",
  "amount",
] as const satisfies readonly (keyof ClaimValues)[];

/** Én reklamasjonssak ut av kjernen. Ingen organisasjon eller slettefelt. */
export type Claim = {
  id: string;
  assignmentId: string;
  claimType: ClaimType;
  receivedAt: string;
  claimantPartyId: string | null;
  /** Navnet på parten når klageren er en part (også om parten senere er fjernet). */
  claimantPartyName: string | null;
  claimantText: string | null;
  description: string;
  buildingPartText: string | null;
  outcome: ClaimOutcome;
  amount: number | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Den ansatte som registrerte saken. */
  createdBy: string;
};

/** En sak i listen på oppdraget. Samme felt som `Claim`. */
export type ClaimListItem = Claim;

function notFound(): never {
  throw new AccessDeniedError();
}

/** Kolonnene i `Claim`. Parten hentes med left join i samme spørring (ingen N+1). */
const claimColumns = {
  id: claims.id,
  assignmentId: claims.assignmentId,
  claimType: claims.claimType,
  receivedAt: claims.receivedAt,
  claimantPartyId: claims.claimantPartyId,
  claimantPartyName: assignmentParties.name,
  claimantText: claims.claimantText,
  description: claims.description,
  buildingPartText: claims.buildingPartText,
  outcome: claims.outcome,
  amount: claims.amount,
  closedAt: claims.closedAt,
  createdAt: claims.createdAt,
  updatedAt: claims.updatedAt,
  createdBy: claims.createdBy,
};

/** Kodene er sikret av CHECK-reglene i databasen. */
function toClaim(
  row: Omit<Claim, "claimType" | "outcome"> & { claimType: string; outcome: string },
): Claim {
  return { ...row, claimType: row.claimType as ClaimType, outcome: row.outcome as ClaimOutcome };
}

/**
 * Sakene i organisasjonen som ikke er fjernet, på oppdrag som ikke er fjernet. Parten joines på
 * id, organisasjon og oppdrag, så et navn fra et annet oppdrag vises aldri.
 */
function selectClaims(executor: DbExecutor, orgId: string) {
  return executor
    .select(claimColumns)
    .from(claims)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, claims.assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .leftJoin(
      assignmentParties,
      and(
        eq(assignmentParties.id, claims.claimantPartyId),
        eq(assignmentParties.organizationId, orgId),
        eq(assignmentParties.assignmentId, claims.assignmentId),
      ),
    );
}

async function loadClaim(executor: DbExecutor, orgId: string, claimId: string): Promise<Claim> {
  const [row] = await selectClaims(executor, orgId).where(
    and(eq(claims.id, claimId), eq(claims.organizationId, orgId), isNull(claims.deletedAt)),
  );
  if (!row) notFound();
  return toClaim(row);
}

/** Oppdraget må finnes i organisasjonen og ikke være fjernet. Låses mot samtidig fjerning. */
async function requireAssignment(tx: DbExecutor, orgId: string, assignmentId: string) {
  const [row] = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("share");
  if (!row) notFound();
}

/** Parten må høre til samme oppdrag og organisasjon og ikke være fjernet. */
async function requireClaimantParty(
  tx: DbExecutor,
  orgId: string,
  assignmentId: string,
  partyId: string | null,
) {
  if (partyId === null) return;
  const [row] = await tx
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .where(
      and(
        eq(assignmentParties.id, partyId),
        eq(assignmentParties.organizationId, orgId),
        eq(assignmentParties.assignmentId, assignmentId),
        isNull(assignmentParties.deletedAt),
      ),
    );
  if (!row) throw new ClaimantPartyNotFoundError();
}

/** Saken (ikke fjernet) på et oppdrag som ikke er fjernet, låst for endring. */
async function lockClaim(tx: DbExecutor, orgId: string, claimId: string) {
  const [row] = await tx
    .select({
      id: claims.id,
      assignmentId: claims.assignmentId,
      claimType: claims.claimType,
      receivedAt: claims.receivedAt,
      claimantPartyId: claims.claimantPartyId,
      claimantText: claims.claimantText,
      description: claims.description,
      buildingPartText: claims.buildingPartText,
      outcome: claims.outcome,
      amount: claims.amount,
      closedAt: claims.closedAt,
    })
    .from(claims)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, claims.assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(and(eq(claims.id, claimId), eq(claims.organizationId, orgId), isNull(claims.deletedAt)))
    .for("update", { of: claims });
  if (!row) notFound();
  return row;
}

function parseInput(input: ClaimInput, now: Date): ClaimValues {
  return claimInputSchema(todayInOslo(now)).parse(input);
}

/** Feltene som er fylt ut ved registrering (bare navnene går til revisjonsloggen). */
function filledFields(values: ClaimValues): string[] {
  return CLAIM_FIELDS.filter((field) => values[field] !== null);
}

async function audit(
  tx: DbExecutor,
  grant: EmployeeGrant,
  action: "create" | "update" | "delete",
  claim: { id: string; assignmentId: string },
  fields: readonly string[] = [],
) {
  await recordAuditEvent(tx, grant, {
    entityType: "claim",
    entityId: claim.id,
    action,
    // Aldri verdiene: friteksten kan inneholde personopplysninger, og loggen ryddes aldri.
    changes: { claimId: claim.id, assignmentId: claim.assignmentId, fields: [...fields] },
  });
}

/** Sakene på oppdraget, mottatt dato nyest først, så registrert nyest først. */
export async function listClaimsForAssignment(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
): Promise<ClaimListItem[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
  if (!isUuid(assignmentId)) notFound();
  const orgId = grant.organizationId;
  await requireAssignment(db, orgId, assignmentId);
  const rows = await selectClaims(db, orgId)
    .where(
      and(
        eq(claims.organizationId, orgId),
        eq(claims.assignmentId, assignmentId),
        isNull(claims.deletedAt),
      ),
    )
    .orderBy(desc(claims.receivedAt), desc(claims.createdAt), desc(claims.id));
  return rows.map(toClaim);
}

/** Én sak. Fremmed, fjernet eller ugyldig id gir `AccessDeniedError`. */
export async function getClaim(
  actor: Actor,
  organizationId: string,
  claimId: string,
): Promise<Claim> {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
  if (!isUuid(claimId)) notFound();
  return loadClaim(db, grant.organizationId, claimId);
}

/**
 * Registrerer en sak på oppdraget. `closed_at` settes til `now` når saken registreres lukket.
 * Lagrer hendelsen `claim.registered` med bare id-er, type og dato.
 */
export async function createClaim(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: ClaimInput,
  now: Date = new Date(),
): Promise<Claim> {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.manage");
  if (!isUuid(assignmentId)) notFound();
  const values = parseInput(input, now);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    await requireAssignment(tx, orgId, assignmentId);
    await requireClaimantParty(tx, orgId, assignmentId, values.claimantPartyId);

    const [row] = await tx
      .insert(claims)
      .values({
        ...values,
        organizationId: orgId,
        assignmentId,
        closedAt: values.outcome === "open" ? null : now,
        createdBy: grant.employeeId,
        updatedBy: grant.employeeId,
      })
      .returning({ id: claims.id });
    if (!row) throw new Error("Fant ikke saken etter at den ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "claim.registered",
      assignmentId,
      data: {
        claimId: row.id,
        assignmentId,
        claimType: values.claimType,
        receivedAt: values.receivedAt,
      },
    });
    await audit(tx, grant, "create", { id: row.id, assignmentId }, filledFields(values));
    return loadClaim(tx, orgId, row.id);
  });
}

/**
 * Endrer saken. Lukking er en vanlig endring: går utfallet fra «åpen», settes `closed_at` til
 * `now`; tilbake til «åpen» nullstiller den; bytte mellom lukkede utfall lar den stå. Ingen
 * endring gir ingen loggrad.
 */
export async function updateClaim(
  actor: Actor,
  organizationId: string,
  claimId: string,
  input: ClaimInput,
  now: Date = new Date(),
): Promise<Claim> {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.manage");
  if (!isUuid(claimId)) notFound();
  const values = parseInput(input, now);
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const before = await lockClaim(tx, orgId, claimId);
    await requireClaimantParty(tx, orgId, before.assignmentId, values.claimantPartyId);

    const changed = CLAIM_FIELDS.filter((field) => before[field] !== values[field]);
    if (changed.length === 0) return loadClaim(tx, orgId, before.id);

    let closedAt = before.closedAt;
    if (values.outcome === "open") closedAt = null;
    else if (before.outcome === "open") closedAt = now;

    await tx
      .update(claims)
      .set({ ...values, closedAt, updatedBy: grant.employeeId })
      .where(and(eq(claims.id, before.id), eq(claims.organizationId, orgId)));
    await audit(tx, grant, "update", before, changed);
    return loadClaim(tx, orgId, before.id);
  });
}

/** Fjerner saken (myk sletting). Raden står i databasen med `deleted_at`. */
export async function removeClaim(
  actor: Actor,
  organizationId: string,
  claimId: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "claims.manage");
  if (!isUuid(claimId)) notFound();
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const before = await lockClaim(tx, orgId, claimId);
    await tx
      .update(claims)
      .set({ deletedAt: now, deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(and(eq(claims.id, before.id), eq(claims.organizationId, orgId)));
    await audit(tx, grant, "delete", before);
    return { id: before.id };
  });
}
