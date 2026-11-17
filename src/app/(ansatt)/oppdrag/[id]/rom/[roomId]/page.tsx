import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { getAssignmentBuildings, roomTypeLabel } from "@/core/buildings";
import {
  getReportSummary,
  getRoomView,
  type ReportSummaryView,
  type RoomReportView,
} from "@/core/reports";
import type { MergeFieldSources } from "@/core/reports/logic";
import { mergeSourcesFor } from "@/core/reports/merge-sources";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../../../../employee-context";
import { NoAccess } from "../../../../no-access";
import { RoomView } from "./room-view";
import { StartReport } from "./start-report";

export const metadata: Metadata = { title: "Badet" };

/*
 * Badet på PC (docs/funksjoner/fase2a-badet-pc.md, fase 2a-2). Leser rommet med kjernen
 * (`getRoomView`), som sjekker tilgangen og kjeden rom → etasje → bygning → oppdrag → rapport.
 * Siden skriver aldri: rapporten startes bare med «Start rapporten». Ugyldig id, rom fra et annet
 * oppdrag eller en annen organisasjon, og rom som ikke er våtrom, gir «Fant ikke siden».
 * Nettleseren får bare maldokumentet og svarene for rommet, aldri parter eller adresse.
 */

/** Rommets navn, eller romtypen når det ikke har navn. */
function titleOf(room: { name: string | null; roomType: string }): string {
  return room.name ?? roomTypeLabel(room.roomType);
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; roomId: string }>;
  searchParams: Promise<{ punkt?: string | string[] }>;
}) {
  const [{ id, roomId }, query] = await Promise.all([params, searchParams]);
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id) || !isUuid(roomId)) notFound();
  const room = { assignmentId: id, roomId };

  let view: RoomReportView;
  let assignmentNumber: string | null;
  try {
    const [roomView, assignment] = await Promise.all([
      getRoomView(context.actor, context.organizationId, room),
      getAssignment(context.actor, context.organizationId, id),
    ]);
    view = roomView;
    assignmentNumber = assignment.number;
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  if (view.state === "not_started") {
    let roomTitle = "";
    try {
      const buildings = await getAssignmentBuildings(context.actor, context.organizationId, id);
      const found = buildings.buildings
        .flatMap((b) => b.floors)
        .flatMap((f) => f.rooms)
        .find((r) => r.id === roomId);
      roomTitle = found ? titleOf(found) : "";
    } catch (error) {
      if (error instanceof AccessDeniedError) notFound();
      throw error;
    }
    return <StartReport assignmentId={id} canStart={view.canStart} roomTitle={roomTitle} />;
  }

  // Sammendraget for hele rapporten («KI i veien», A434). Kjernen sjekker tilgangen.
  let summary: ReportSummaryView | null = null;
  try {
    summary = await getReportSummary(context.actor, context.organizationId, id);
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) throw error;
  }
  // Hvor flettefeltene i standardtekstene henter verdien, så forslagslisten viser teksten slik den
  // havner i feltet. Bare feltkoder, ingen verdier.
  const mergeSources: Record<string, MergeFieldSources> = Object.fromEntries(
    view.document.checkpoints.map((c) => [c.key, mergeSourcesFor(c.key)]),
  );

  const punkt = typeof query.punkt === "string" ? query.punkt : null;
  return (
    <RoomView
      key={view.reportId}
      view={view}
      room={room}
      assignmentNumber={assignmentNumber}
      roomTitle={titleOf(view.room)}
      requestedCheckpoint={punkt}
      summary={summary}
      mergeSources={mergeSources}
    />
  );
}
