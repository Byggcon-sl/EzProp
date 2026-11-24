import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import {
  assignments,
  checkpointResults,
  deviationMeasures,
  deviations,
  reports,
  tgiuDetails,
  type CheckpointResult,
  type TgDirect,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  loadLockedTemplate,
  loadRoomContext,
  requireUuid,
  roomDocumentOf,
  type LockedTemplate,
  type RoomContext,
} from "./context";
import { guardReportErrors, ReportValidationError } from "./errors";
import { computeRoomRefresh, toRefresh } from "./room-view";
import type {
  ReportWriteScope,
  RoomRef,
  RoomRefresh,
  RoomTemplateDocument,
  WithReportWrite,
} from "./types";

/*
 * Felles ramme for alt som skriver i rapporten (docs/funksjoner/fase2a-badet-pc.md Omfang 9 og 10):
 * `report.edit` sjekkes på serveren, kjeden og rapporten slås opp med `grant.organizationId` i en
 * transaksjon, og rapportraden låses, så skrivinger i samme rapport går etter hverandre.
 * Revisjonsloggen får bare id-er, faste koder, feltkoder, TG og tall, aldri tekst.
 */

export type WriteScope = {
  tx: DbExecutor;
  actor: Actor;
  grant: EmployeeGrant;
  orgId: string;
  context: RoomContext & { report: NonNullable<RoomContext["report"]> };
  reportId: string;
  template: LockedTemplate;
  roomDoc: RoomTemplateDocument;
  now: Date;
};

/**
 * Kjører `fn` i en transaksjon med låst rapport. Tilgang først (`report.edit`), så id-ene, så
 * kjeden. TG-logikken gjelder bare systemmalen for tilstandsrapport (regel 5).
 */
export async function withRoomWrite<T>(
  actor: Actor,
  organizationId: string,
  room: RoomRef,
  fn: (scope: WriteScope) => Promise<T>,
): Promise<T> {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(room?.assignmentId, room?.roomId);
  return guardReportErrors("write", () =>
    db.transaction(async (tx) => {
      const context = await loadRoomContext(tx, grant, room, { lock: true });
      const report = context.report;
      if (!report) throw new ReportValidationError("report_not_started");
      if (report.status !== "draft") throw new ReportValidationError("report_not_editable");
      const template = await loadLockedTemplate(tx, actor, grant, report.templateVersionId);
      if (template.kind !== "system" || template.reportType !== "condition_report") {
        throw new ReportValidationError("not_applicable");
      }
      return fn({
        tx,
        actor,
        grant,
        orgId: grant.organizationId,
        context: { ...context, report },
        reportId: report.id,
        template,
        roomDoc: roomDocumentOf(template.document, context.room.group),
        now: new Date(),
      });
    }),
  );
}

/**
 * Skriverammen på rapportnivå (A469), for det som ikke hører til ett rom (sammendraget). Samme
 * rekkefølge og samme feil som `withRoomWrite`: `report.edit` først, så id-en, så oppdraget og
 * rapporten med `grant.organizationId` og `deleted_at is null`. Rapportraden låses (`for update`),
 * så skrivinger i samme rapport går etter hverandre, også mot `withRoomWrite`. Låserekkefølgen er
 * fast: rapportraden her, deretter KI-låsen i `recordDecisionIn`.
 */
export const withReportWrite: WithReportWrite = async (actor, organizationId, assignmentId, fn) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(assignmentId);
  return guardReportErrors("write", () =>
    db.transaction(async (tx) => {
      const orgId = grant.organizationId;
      const [assignment] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.organizationId, orgId),
            eq(assignments.id, assignmentId),
            isNull(assignments.deletedAt),
          ),
        );
      if (!assignment) throw new AccessDeniedError();
      const [report] = await tx
        .select({
          id: reports.id,
          status: reports.status,
          rowVersion: reports.rowVersion,
          templateVersionId: reports.templateVersionId,
        })
        .from(reports)
        .where(
          and(
            eq(reports.organizationId, orgId),
            eq(reports.assignmentId, assignment.id),
            isNull(reports.deletedAt),
            ne(reports.status, "superseded"),
          ),
        )
        .for("update");
      if (!report) throw new ReportValidationError("report_not_started");
      if (report.status !== "draft") throw new ReportValidationError("report_not_editable");
      const scope: ReportWriteScope = {
        tx,
        actor,
        grant,
        orgId,
        reportId: report.id,
        reportRowVersion: report.rowVersion,
        templateVersionId: report.templateVersionId,
        now: new Date(),
      };
      return fn(scope);
    }),
  );
};

/** Rommet regnet på nytt i samme transaksjon. */
export async function refreshOf(scope: WriteScope): Promise<RoomRefresh> {
  return toRefresh(
    await computeRoomRefresh(scope.tx, scope.orgId, scope.context, scope.template, scope.now),
  );
}

/** Revisjonsrad. `changes` har bare id-er, faste koder, feltkoder, TG og tall. */
export async function auditReport(
  scope: WriteScope,
  entityType: string,
  entityId: string,
  action: string,
  changes: Record<string, string | number | boolean | null | string[]> = {},
): Promise<void> {
  await recordAuditEvent(scope.tx, scope.grant, {
    entityType,
    entityId,
    action,
    changes: { reportId: scope.reportId, ...changes },
  });
}

/** Kontrollpunktet i rommet, eller `unknown_key`. */
export function requireRoomCheckpoint(scope: WriteScope, checkpointKey: string) {
  const checkpoint = scope.roomDoc.checkpoints.find((c) => c.key === checkpointKey);
  const checkpointId = scope.template.checkpointIdByKey.get(checkpointKey);
  if (!checkpoint || !checkpointId) throw new ReportValidationError("unknown_key");
  return { checkpoint, checkpointId };
}

/** Resultatraden for punktet i rommet, eller `null` når punktet ikke har fått en ennå. */
export async function findCheckpointResult(
  scope: WriteScope,
  checkpointId: string,
): Promise<CheckpointResult | null> {
  const [row] = await scope.tx
    .select()
    .from(checkpointResults)
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.checkpointId, checkpointId),
        eq(checkpointResults.roomId, scope.context.room.id),
        isNull(checkpointResults.deletedAt),
      ),
    );
  return row ?? null;
}

/**
 * Resultatraden for punktet, laget ved første skriving på punktet. Id-en lages på serveren
 * (UUID v7). Rapporten er låst, så to kall kan ikke lage hver sin rad.
 */
export async function ensureCheckpointResult(
  scope: WriteScope,
  checkpointKey: string,
): Promise<CheckpointResult> {
  const { checkpointId } = requireRoomCheckpoint(scope, checkpointKey);
  const existing = await findCheckpointResult(scope, checkpointId);
  if (existing) return existing;
  const [created] = await scope.tx
    .insert(checkpointResults)
    .values({
      id: uuidv7(),
      organizationId: scope.orgId,
      reportId: scope.reportId,
      checkpointId,
      roomId: scope.context.room.id,
      createdBy: scope.grant.employeeId,
    })
    .returning();
  if (!created) throw new Error("kunne ikke lage resultat for kontrollpunktet");
  return created;
}

/** Avvikene på punktet som ikke er slettet. */
export async function liveDeviationsOf(scope: WriteScope, checkpointResultId: string) {
  return scope.tx
    .select()
    .from(deviations)
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.checkpointResultId, checkpointResultId),
        isNull(deviations.deletedAt),
      ),
    )
    .orderBy(asc(deviations.sortOrder), asc(deviations.id));
}

/**
 * Fjerner avvikene mykt med tiltakene som ikke alt er fjernet, med samme `deleted_at`, slik at
 * Angre vet hvilke tiltak som hørte til (ADR 0013 12c).
 */
export async function softDeleteDeviations(scope: WriteScope, deviationIds: readonly string[]) {
  for (const deviationId of deviationIds) {
    await scope.tx
      .update(deviationMeasures)
      .set({
        deletedAt: scope.now,
        deletedBy: scope.grant.employeeId,
        updatedBy: scope.grant.employeeId,
      })
      .where(
        and(
          eq(deviationMeasures.organizationId, scope.orgId),
          eq(deviationMeasures.reportId, scope.reportId),
          eq(deviationMeasures.deviationId, deviationId),
          isNull(deviationMeasures.deletedAt),
        ),
      );
    await scope.tx
      .update(deviations)
      .set({
        deletedAt: scope.now,
        deletedBy: scope.grant.employeeId,
        updatedBy: scope.grant.employeeId,
      })
      .where(
        and(
          eq(deviations.organizationId, scope.orgId),
          eq(deviations.reportId, scope.reportId),
          eq(deviations.id, deviationId),
          isNull(deviations.deletedAt),
        ),
      );
    await auditReport(scope, "deviation", deviationId, "delete");
  }
}

/** Setter `tg_direct` på punktet. `null` fjerner den. */
export async function writeTgDirect(
  scope: WriteScope,
  result: CheckpointResult,
  tgDirect: TgDirect | null,
): Promise<void> {
  if (result.tgDirect === tgDirect) return;
  await scope.tx
    .update(checkpointResults)
    .set({ tgDirect, updatedBy: scope.grant.employeeId })
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.id, result.id),
      ),
    );
  if (result.tgDirect === "IU" && tgDirect !== "IU") await softDeleteTgiu(scope, result.id);
  if (tgDirect === "IU" && result.tgDirect !== "IU") await restoreOrCreateTgiu(scope, result.id);
  await auditReport(scope, "checkpoint_result", result.id, "update", {
    field: "tg_direct",
    from: result.tgDirect,
    to: tgDirect,
  });
}

/** «Fjern TGIU»: opplysningene slettes mykt, så de kan gjenopprettes (Angre). */
async function softDeleteTgiu(scope: WriteScope, checkpointResultId: string) {
  await scope.tx
    .update(tgiuDetails)
    .set({
      deletedAt: scope.now,
      deletedBy: scope.grant.employeeId,
      updatedBy: scope.grant.employeeId,
    })
    .where(
      and(
        eq(tgiuDetails.organizationId, scope.orgId),
        eq(tgiuDetails.reportId, scope.reportId),
        eq(tgiuDetails.checkpointResultId, checkpointResultId),
        isNull(tgiuDetails.deletedAt),
      ),
    );
}

/**
 * TGIU settes: siste mykt slettede sett på punktet gjenopprettes, slik at teksten ikke går tapt
 * (Angre etter «Fjern TGIU»). Finnes ikke noe, lages et tomt sett.
 */
async function restoreOrCreateTgiu(scope: WriteScope, checkpointResultId: string) {
  const where = and(
    eq(tgiuDetails.organizationId, scope.orgId),
    eq(tgiuDetails.reportId, scope.reportId),
    eq(tgiuDetails.checkpointResultId, checkpointResultId),
  );
  const [active] = await scope.tx
    .select({ id: tgiuDetails.id })
    .from(tgiuDetails)
    .where(and(where, isNull(tgiuDetails.deletedAt)));
  if (active) return;
  const [latest] = await scope.tx
    .select({ id: tgiuDetails.id })
    .from(tgiuDetails)
    .where(and(where, sql`${tgiuDetails.deletedAt} is not null`))
    .orderBy(sql`${tgiuDetails.deletedAt} desc`, sql`${tgiuDetails.id} desc`)
    .limit(1);
  if (latest) {
    await scope.tx
      .update(tgiuDetails)
      .set({ deletedAt: null, deletedBy: null, updatedBy: scope.grant.employeeId })
      .where(and(where, eq(tgiuDetails.id, latest.id)));
    return;
  }
  await scope.tx.insert(tgiuDetails).values({
    id: uuidv7(),
    organizationId: scope.orgId,
    reportId: scope.reportId,
    checkpointResultId,
    createdBy: scope.grant.employeeId,
  });
}
