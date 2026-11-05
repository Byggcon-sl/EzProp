import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { assignmentTeamMembers, assignments, employees, orders, properties } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import type { AssignmentStatus } from "./codes";
import {
  assignmentNoteSchema,
  assignmentScheduleSchema,
  type AssignmentScheduleInput,
} from "./schemas";
import { isCorrected } from "./status-flow";
import { WORK_QUEUE_LIMIT } from "./work-queue-params";

/*
 * Arbeidskøen (docs/funksjoner/fase2a-arbeidsko.md): oppdragene i én fane, antall per fane og de
 * små endringene fra køen og oppdragssiden (notat, befaring og frist). Lesing krever
 * `organization.read`, endring `assignment.edit`. Alle spørringer filtrerer på
 * `grant.organizationId`, aldri på parameteren. «Mine» bruker `grant.employeeId`. Kansellerte
 * oppdrag (myk sletting) vises og telles aldri.
 */

export type WorkQueueFilter = { mineOnly: boolean; query: string };

export type WorkQueueItem = {
  id: string;
  number: string;
  /** Eiendommens adresse, ellers adressen fra ordren. */
  address: string | null;
  status: AssignmentStatus;
  /** Merket «Rettet» (A77), fra `isCorrected`. */
  corrected: boolean;
  inspectionAt: Date | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Aktiv ansvarlig takstmann, eller `null`. */
  responsibleName: string | null;
  internalNote: string | null;
};

export type WorkQueueCounts = Record<AssignmentStatus, number>;

/** Adressen fra ordren til oppdraget (eldste ikke-slettede ordre i samme organisasjon). */
function orderAddress(organizationId: string): SQL<string | null> {
  return sql<string | null>`(
    select ${orders.addressText} from ${orders}
    where ${orders.organizationId} = ${organizationId}
      and ${orders.deletedAt} is null
      and (${orders.id} = ${assignments.orderId} or ${orders.assignmentId} = ${assignments.id})
    order by ${orders.createdAt}, ${orders.id}
    limit 1
  )`;
}

/** Eiendommens adresse, ellers ordrens. Brukes både i søket og på kortet. */
function addressExpression(organizationId: string): SQL<string | null> {
  return sql<string | null>`coalesce(${properties.address}, ${orderAddress(organizationId)})`;
}

/** Søketeksten som vanlige tegn i `ILIKE`: `\`, `%` og `_` escapes. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Det felles filteret for begge lesespørringene: organisasjonen fra tilgangssjekken, ikke
 * kansellert, «Mine» (aktiv, ikke slettet teamrad for den innloggede ansatte, uansett rolle) og
 * søk på nummer og adresse. EXISTS gir aldri doble rader.
 */
function workQueueWhere(grant: EmployeeGrant, filter: WorkQueueFilter): SQL {
  const orgId = grant.organizationId;
  const conditions: (SQL | undefined)[] = [
    eq(assignments.organizationId, orgId),
    isNull(assignments.deletedAt),
  ];
  if (filter.mineOnly) {
    conditions.push(sql`exists (
      select 1 from ${assignmentTeamMembers}
      where ${assignmentTeamMembers.organizationId} = ${orgId}
        and ${assignmentTeamMembers.assignmentId} = ${assignments.id}
        and ${assignmentTeamMembers.employeeId} = ${grant.employeeId}
        and ${assignmentTeamMembers.toAt} is null
        and ${assignmentTeamMembers.deletedAt} is null
    )`);
  }
  const query = filter.query.trim();
  if (query) {
    const pattern = likePattern(query);
    conditions.push(
      sql`(${assignments.number} ilike ${pattern} escape '\\' or ${addressExpression(orgId)} ilike ${pattern} escape '\\')`,
    );
  }
  return and(...conditions)!;
}

/** Eiendommen hentes bare fra samme organisasjon og bare når den ikke er slettet. */
function propertyJoin(organizationId: string): SQL {
  return and(
    eq(properties.id, assignments.propertyId),
    eq(properties.organizationId, organizationId),
    isNull(properties.deletedAt),
  )!;
}

/** Antall per status for filteret og søket. Én spørring gruppert på status; tomme faner gir 0. */
async function countByStatus(
  grant: EmployeeGrant,
  filter: WorkQueueFilter,
): Promise<WorkQueueCounts> {
  const rows = await db
    .select({ status: assignments.status, count: sql<number>`count(*)::int` })
    .from(assignments)
    .leftJoin(properties, propertyJoin(grant.organizationId))
    .where(workQueueWhere(grant, filter))
    .groupBy(assignments.status);
  const counts: WorkQueueCounts = { ordered: 0, in_progress: 0, completed: 0, invoiced: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as AssignmentStatus] = Number(row.count);
  }
  return counts;
}

/**
 * Antall oppdrag per status (alle fire faner) for «Mine»/«Alle» og søket, slik at tallene stemmer
 * med kortene som vises.
 */
export async function countWorkQueueByStatus(
  actor: Actor,
  organizationId: string,
  filter: WorkQueueFilter,
): Promise<WorkQueueCounts> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  return countByStatus(grant, filter);
}

/**
 * Kortene i én fane, høyst `WORK_QUEUE_LIMIT`. Sortering (A103): nærmeste dato (befaring, ellers
 * frist) først, oppdrag uten dato sist, og så nyeste nummer. `total` er antallet for fanen.
 */
export async function listWorkQueue(
  actor: Actor,
  organizationId: string,
  input: WorkQueueFilter & { status: AssignmentStatus },
): Promise<{ items: WorkQueueItem[]; total: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const orgId = grant.organizationId;
  const filter: WorkQueueFilter = { mineOnly: input.mineOnly, query: input.query };

  const responsibleName = sql<string | null>`(
    select ${employees.name} from ${assignmentTeamMembers}
    inner join ${employees}
      on ${employees.id} = ${assignmentTeamMembers.employeeId}
      and ${employees.organizationId} = ${orgId}
    where ${assignmentTeamMembers.organizationId} = ${orgId}
      and ${assignmentTeamMembers.assignmentId} = ${assignments.id}
      and ${assignmentTeamMembers.teamRole} = 'responsible'
      and ${assignmentTeamMembers.toAt} is null
      and ${assignmentTeamMembers.deletedAt} is null
    limit 1
  )`;

  const [rows, counts] = await Promise.all([
    db
      .select({
        id: assignments.id,
        number: assignments.number,
        address: addressExpression(orgId),
        status: assignments.status,
        inspectionAt: assignments.inspectionAt,
        dueDate: assignments.dueDate,
        responsibleName,
        internalNote: assignments.internalNote,
      })
      .from(assignments)
      .leftJoin(properties, propertyJoin(orgId))
      .where(and(workQueueWhere(grant, filter), eq(assignments.status, input.status)))
      .orderBy(
        sql`coalesce(${assignments.inspectionAt}, ${assignments.dueDate}) nulls last`,
        desc(assignments.number),
      )
      .limit(WORK_QUEUE_LIMIT),
    countByStatus(grant, filter),
  ]);

  const items = rows.map((row): WorkQueueItem => ({
    id: row.id,
    number: row.number,
    address: row.address,
    status: row.status as AssignmentStatus,
    // Utgivelsene finnes ikke ennå, så versjonen er tom og «Rettet» alltid usant (A77).
    corrected: isCorrected({ status: row.status, highestSentReleaseVersion: null }),
    inspectionAt: row.inspectionAt === null ? null : new Date(row.inspectionAt),
    dueDate: row.dueDate,
    responsibleName: row.responsibleName,
    internalNote: row.internalNote,
  }));
  return { items, total: counts[input.status] ?? 0 };
}

/** Låser oppdraget med feltene som kan endres. Ukjent, fremmed eller kansellert gir `AccessDeniedError`. */
async function lockAssignment(tx: DbExecutor, grant: EmployeeGrant, assignmentId: string) {
  const [row] = await tx
    .select({
      id: assignments.id,
      number: assignments.number,
      internalNote: assignments.internalNote,
      inspectionAt: assignments.inspectionAt,
      dueDate: assignments.dueDate,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

export type AssignmentNoteResult = { id: string; number: string; internalNote: string | null };

/**
 * Lagrer det interne notatet (A101). Tom tekst lagres som `null`. Over 200 tegn eller noe som
 * ligner et fødselsnummer gir `ZodError` før noe skrives, så det havner aldri i revisjonsloggen.
 * Samme notat på nytt skriver ingenting og lager ingen loggrad.
 */
export async function updateAssignmentNote(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  note: string | null | undefined,
): Promise<AssignmentNoteResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const internalNote = assignmentNoteSchema.parse(note);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const current = await lockAssignment(tx, grant, assignmentId);
    if (current.internalNote === internalNote) {
      return { id: current.id, number: current.number, internalNote: current.internalNote };
    }
    const [updated] = await tx
      .update(assignments)
      .set({ internalNote, updatedAt: new Date(), updatedBy: grant.employeeId })
      .where(
        and(eq(assignments.id, current.id), eq(assignments.organizationId, grant.organizationId)),
      )
      .returning({
        id: assignments.id,
        number: assignments.number,
        internalNote: assignments.internalNote,
      });
    if (!updated) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: current.id,
      action: "update",
      changes: { internalNote: { from: current.internalNote, to: internalNote } },
    });
    return updated;
  });
}

export type AssignmentScheduleResult = {
  id: string;
  number: string;
  inspectionAt: Date | null;
  dueDate: string | null;
};

function sameTime(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * Setter avtalt befaring og frist (A100). Begge kan tømmes. Ingen regel om rekkefølgen. Ugyldig
 * verdi gir `ZodError` før noe skrives. Revisjonsloggen får bare feltene som endret seg; ingen
 * endring gir ingen skriving og ingen loggrad.
 */
export async function setAssignmentSchedule(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: AssignmentScheduleInput,
): Promise<AssignmentScheduleResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const { inspectionAt, dueDate } = assignmentScheduleSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const current = await lockAssignment(tx, grant, assignmentId);
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (!sameTime(current.inspectionAt, inspectionAt)) {
      changes.inspectionAt = {
        from: current.inspectionAt?.toISOString() ?? null,
        to: inspectionAt?.toISOString() ?? null,
      };
    }
    if (current.dueDate !== dueDate) changes.dueDate = { from: current.dueDate, to: dueDate };
    if (Object.keys(changes).length === 0) {
      const { id, number } = current;
      return { id, number, inspectionAt: current.inspectionAt, dueDate: current.dueDate };
    }

    const [updated] = await tx
      .update(assignments)
      .set({ inspectionAt, dueDate, updatedAt: new Date(), updatedBy: grant.employeeId })
      .where(
        and(eq(assignments.id, current.id), eq(assignments.organizationId, grant.organizationId)),
      )
      .returning({
        id: assignments.id,
        number: assignments.number,
        inspectionAt: assignments.inspectionAt,
        dueDate: assignments.dueDate,
      });
    if (!updated) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: current.id,
      action: "update",
      changes,
    });
    return updated;
  });
}
