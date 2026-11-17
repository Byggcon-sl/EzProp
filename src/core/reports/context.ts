import { and, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { ROOM_TYPES } from "@/core/buildings";
import { getTemplateVersion, type TemplateDocument, type TemplateKind } from "@/core/templates";
import type { DbExecutor } from "@/db/client";
import {
  assignments,
  checkpoints,
  deviationQuestions,
  floors,
  outcomes,
  reportBuildings,
  reports,
  rooms,
  rules,
  templateElements,
  type ReportStatus,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import type { InspectionYear, RoomRef, RoomTemplateDocument } from "./types";

/*
 * Oppslagene alle tjenestene i rapportkjernen bruker (docs/funksjoner/fase2a-badet-pc.md Omfang 9):
 * kjeden rom → etasje → bygning → oppdrag → rapport med `grant.organizationId` og
 * `deleted_at is null` i alle ledd, og rapportens låste malversjon med id-ene til radene.
 * Fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError` (404) uten å si hvorfor.
 */

/** Romgruppen badet gjelder. Andre rom gir 404 (bare våtrom i «Badet på PC»). */
export const SUPPORTED_ROOM_GROUP = "wet_room";

/** Ugyldig id gir 404 før noe slås opp (kortet Omfang 9). */
export function requireUuid(...ids: unknown[]): void {
  if (!ids.every((id) => typeof id === "string" && isUuid(id))) throw new AccessDeniedError();
}

export type RoomContext = {
  room: { id: string; name: string | null; roomType: string; group: string };
  assignmentId: string;
  inspectionAt: Date | null;
  report: {
    id: string;
    status: ReportStatus;
    templateVersionId: string;
    reportType: string;
  } | null;
};

function roomGroupOf(roomType: string): string | null {
  return ROOM_TYPES.find((type) => type.key === roomType)?.group ?? null;
}

/**
 * Rommet med kjeden opp til oppdraget, og oppdragets gjeldende rapport (eller `null`). Rommet må
 * være et våtrom og høre til oppdraget. `lock` låser rapportraden (`FOR UPDATE`), slik at
 * skrivinger i samme rapport går etter hverandre.
 */
export async function loadRoomContext(
  ex: DbExecutor,
  grant: EmployeeGrant,
  ref: RoomRef,
  options: { lock: boolean },
): Promise<RoomContext> {
  const orgId = grant.organizationId;
  const [row] = await ex
    .select({
      roomId: rooms.id,
      roomName: rooms.name,
      roomType: rooms.roomType,
      assignmentId: assignments.id,
      inspectionAt: assignments.inspectionAt,
    })
    .from(rooms)
    .innerJoin(
      floors,
      and(eq(floors.id, rooms.floorId), eq(floors.organizationId, orgId), isNull(floors.deletedAt)),
    )
    .innerJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, floors.reportBuildingId),
        eq(reportBuildings.organizationId, orgId),
        isNull(reportBuildings.deletedAt),
      ),
    )
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, reportBuildings.assignmentId),
        eq(assignments.organizationId, orgId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(
      and(
        eq(rooms.id, ref.roomId),
        eq(rooms.organizationId, orgId),
        isNull(rooms.deletedAt),
        eq(assignments.id, ref.assignmentId),
      ),
    );
  if (!row) throw new AccessDeniedError();
  const group = roomGroupOf(row.roomType);
  if (group !== SUPPORTED_ROOM_GROUP) throw new AccessDeniedError();

  const reportQuery = ex
    .select({
      id: reports.id,
      status: reports.status,
      templateVersionId: reports.templateVersionId,
      reportType: reports.reportType,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, orgId),
        eq(reports.assignmentId, row.assignmentId),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    );
  const [report] = options.lock ? await reportQuery.for("update") : await reportQuery;

  return {
    room: { id: row.roomId, name: row.roomName, roomType: row.roomType, group },
    assignmentId: row.assignmentId,
    inspectionAt: row.inspectionAt,
    report: report ?? null,
  };
}

/**
 * Befaringsåret reglene regner alder mot: året for oppdragets befaringstid i norsk tid, ellers
 * dagens år i norsk tid på serveren (kortet Omfang 1).
 */
export function inspectionYearOf(
  inspectionAt: Date | null,
  now: Date = new Date(),
): InspectionYear {
  if (inspectionAt)
    return { year: Number(todayInOslo(inspectionAt).slice(0, 4)), source: "assignment" };
  return { year: Number(todayInOslo(now).slice(0, 4)), source: "today" };
}

// --- Den låste malversjonen --------------------------------------------------------------------

/** Nøkkel for spørsmål og utfall: punkt, spørsmål (og utfall) med `|` mellom. */
export function refKey(...parts: string[]): string {
  return parts.join("|");
}

export type LockedTemplate = {
  versionId: string;
  kind: TemplateKind;
  reportType: string;
  document: TemplateDocument;
  checkpointIdByKey: Map<string, string>;
  checkpointKeyById: Map<string, string>;
  elementIdByKey: Map<string, string>;
  elementKeyById: Map<string, string>;
  /** `refKey(punkt, spørsmål)` → id. */
  questionIdByRef: Map<string, string>;
  /** `refKey(punkt, spørsmål, utfall)` → id. */
  outcomeIdByRef: Map<string, string>;
  outcomeRefById: Map<string, { checkpointKey: string; questionKey: string; outcomeKey: string }>;
  questionRefById: Map<string, { checkpointKey: string; questionKey: string }>;
  ruleIdByKey: Map<string, string>;
  ruleKeyById: Map<string, string>;
};

/**
 * Malversjonen rapporten er låst til, med hele dokumentet og id-ene til radene. Publiserte
 * versjoner endres aldri, så id-ene er stabile. Fast antall spørringer.
 */
export async function loadLockedTemplate(
  ex: DbExecutor,
  actor: Actor,
  grant: EmployeeGrant,
  versionId: string,
): Promise<LockedTemplate> {
  const orgId = grant.organizationId;
  const [detail, checkpointRows, elementRows, questionRows, outcomeRows, ruleRows] =
    await Promise.all([
      getTemplateVersion(actor, orgId, versionId),
      ex
        .select({ id: checkpoints.id, key: checkpoints.key })
        .from(checkpoints)
        .where(
          and(
            eq(checkpoints.organizationId, orgId),
            eq(checkpoints.versionId, versionId),
            isNull(checkpoints.deletedAt),
          ),
        ),
      ex
        .select({ id: templateElements.id, key: templateElements.key })
        .from(templateElements)
        .where(
          and(
            eq(templateElements.organizationId, orgId),
            eq(templateElements.versionId, versionId),
            isNull(templateElements.deletedAt),
          ),
        ),
      ex
        .select({
          id: deviationQuestions.id,
          key: deviationQuestions.key,
          checkpointKey: checkpoints.key,
        })
        .from(deviationQuestions)
        .innerJoin(
          checkpoints,
          and(
            eq(checkpoints.id, deviationQuestions.checkpointId),
            eq(checkpoints.organizationId, orgId),
            isNull(checkpoints.deletedAt),
          ),
        )
        .where(
          and(
            eq(deviationQuestions.organizationId, orgId),
            eq(checkpoints.versionId, versionId),
            isNull(deviationQuestions.deletedAt),
          ),
        ),
      ex
        .select({
          id: outcomes.id,
          key: outcomes.key,
          questionKey: deviationQuestions.key,
          checkpointKey: checkpoints.key,
        })
        .from(outcomes)
        .innerJoin(
          deviationQuestions,
          and(
            eq(deviationQuestions.id, outcomes.deviationQuestionId),
            eq(deviationQuestions.organizationId, orgId),
            isNull(deviationQuestions.deletedAt),
          ),
        )
        .innerJoin(
          checkpoints,
          and(
            eq(checkpoints.id, deviationQuestions.checkpointId),
            eq(checkpoints.organizationId, orgId),
            isNull(checkpoints.deletedAt),
          ),
        )
        .where(
          and(
            eq(outcomes.organizationId, orgId),
            eq(checkpoints.versionId, versionId),
            isNull(outcomes.deletedAt),
          ),
        ),
      ex
        .select({ id: rules.id, key: rules.key })
        .from(rules)
        .where(
          and(
            eq(rules.organizationId, orgId),
            eq(rules.versionId, versionId),
            isNull(rules.deletedAt),
          ),
        ),
    ]);

  const questionRefById = new Map(
    questionRows.map((q) => [q.id, { checkpointKey: q.checkpointKey, questionKey: q.key }]),
  );
  const outcomeRefById = new Map(
    outcomeRows.map((o) => [
      o.id,
      { checkpointKey: o.checkpointKey, questionKey: o.questionKey, outcomeKey: o.key },
    ]),
  );
  return {
    versionId,
    kind: detail.kind,
    reportType: detail.reportType,
    document: detail.document,
    checkpointIdByKey: new Map(checkpointRows.map((c) => [c.key, c.id])),
    checkpointKeyById: new Map(checkpointRows.map((c) => [c.id, c.key])),
    elementIdByKey: new Map(elementRows.map((e) => [e.key, e.id])),
    elementKeyById: new Map(elementRows.map((e) => [e.id, e.key])),
    questionIdByRef: new Map(questionRows.map((q) => [refKey(q.checkpointKey, q.key), q.id])),
    questionRefById,
    outcomeIdByRef: new Map(
      outcomeRows.map((o) => [refKey(o.checkpointKey, o.questionKey, o.key), o.id]),
    ),
    outcomeRefById,
    ruleIdByKey: new Map(ruleRows.map((r) => [r.key, r.id])),
    ruleKeyById: new Map(ruleRows.map((r) => [r.id, r.key])),
  };
}

/** Kontrollpunktet en regel gjelder: målpunktet, ellers punktet til det foreslåtte utfallet. */
export function ruleCheckpointKey(rule: TemplateDocument["rules"][number]): string | null {
  return rule.target_checkpoint_key ?? rule.suggested_outcome?.checkpoint_key ?? null;
}

/**
 * Den delen av malen som gjelder rommet: kontrollpunktene per rom for romgruppen, med felt, valg,
 * spørsmål, utfall og tiltak. Reglene sendes ikke til nettleseren.
 */
export function roomDocumentOf(document: TemplateDocument, group: string): RoomTemplateDocument {
  const checkpointList = document.checkpoints
    .filter(
      (c) =>
        c.scope === "room" &&
        (c.room_type_groups.length === 0 || (c.room_type_groups as string[]).includes(group)),
    )
    .sort((a, b) => a.sort_order - b.sort_order);
  const checkpointKeys = new Set(checkpointList.map((c) => c.key));
  const sectionKeys = new Set(checkpointList.map((c) => c.section_key));
  const elements = document.elements.filter(
    (e) => e.checkpoint_key !== null && checkpointKeys.has(e.checkpoint_key),
  );
  const elementKeys = new Set(elements.map((e) => e.key));
  return {
    sections: document.sections.filter((s) => sectionKeys.has(s.key)),
    checkpoints: checkpointList,
    elements,
    element_options: document.element_options.filter((o) => elementKeys.has(o.element_key)),
    deviation_questions: document.deviation_questions.filter((q) =>
      checkpointKeys.has(q.checkpoint_key),
    ),
    outcomes: document.outcomes.filter((o) => checkpointKeys.has(o.checkpoint_key)),
    standard_measures: document.standard_measures.filter((m) =>
      checkpointKeys.has(m.checkpoint_key),
    ),
  };
}
