import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import {
  AREA_TYPES,
  areaTypeLabel,
  COMMON_ROOM_TYPES,
  getAssignmentBuildings,
  MEASURING_METHODS,
  measuringMethodLabel,
  ROOM_PRESETS,
  ROOM_TYPE_GROUPS,
  ROOM_TYPES,
  roomTypeGroupLabel,
  type AssignmentBuildings,
} from "@/core/buildings";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../../../employee-context";
import { NoAccess } from "../../../no-access";
import { WorkSessionTracker } from "../work-session-tracker";
import { BuildingsEditor, type Codes } from "./buildings-editor";

export const metadata: Metadata = { title: "Bygninger, areal og rom" };

/** Kodelistene med norske etiketter. Romtypene gruppert etter gruppe, i fast rekkefølge. */
const CODES: Codes = {
  roomTypeGroups: ROOM_TYPE_GROUPS.map((group) => ({
    label: roomTypeGroupLabel(group),
    options: ROOM_TYPES.filter((type) => type.group === group).map((type) => ({
      value: type.key,
      label: type.label,
      areaType: type.defaultAreaType,
      belowGround: type.defaultBelowGround,
    })),
  })),
  roomPresets: ROOM_PRESETS.map((preset) => ({
    key: preset.key,
    label: preset.label,
    drafts: preset.drafts.map((draft) => ({ roomType: draft.roomType, count: draft.count })),
  })),
  commonRoomTypes: [...COMMON_ROOM_TYPES],
  areaTypes: AREA_TYPES.map((code) => ({ value: code, label: areaTypeLabel(code) })),
  methods: MEASURING_METHODS.map((code) => ({ value: code, label: measuringMethodLabel(code) })),
};

/**
 * Bygninger, etasjer, areal per etasje og rom på oppdraget. Skjemaene vises bare med
 * `canEditOrders`; selve sjekken skjer i kjernen. Ugyldig, ukjent, slettet og fremmed id gir
 * «Fant ikke siden».
 */
export default async function BuildingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let data: AssignmentBuildings;
  try {
    data = await getAssignmentBuildings(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  return (
    <main className="max-w-3xl">
      <WorkSessionTracker assignmentId={id} />
      <Link
        href={`/oppdrag/${id}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Oppdraget
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Bygninger, areal og rom</h1>
      <BuildingsEditor
        assignmentId={id}
        data={data}
        canEdit={context.canEditOrders}
        codes={CODES}
      />
    </main>
  );
}
