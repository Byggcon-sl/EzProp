import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { listAgreements, suggestAgreementForAssignment } from "@/core/agreements";
import { claimOutcomeLabel, claimTypeLabel, listClaimsForAssignment } from "@/core/claims";
import {
  allowedTransitions,
  ASSIGNMENT_STATUSES,
  assignmentStatusLabel,
  canCancel,
  defaultReceives,
  findPossibleDuplicatesForAssignment,
  getAssignment,
  getAssignmentBooking,
  listAssignmentBookingHistory,
  listWorkQueue,
  PARTY_ROLES,
  partyRoleLabel,
  TEAM_ROLES,
  teamRoleLabel,
} from "@/core/assignments";
import {
  getAssignmentProperty,
  hasCommonAreas,
  HOUSING_TYPES,
  housingTypeLabel,
  OWNERSHIP_FORMS,
  ownershipFormLabel,
  YES_NO_UNKNOWN,
  yesNoUnknownLabel,
  type AssignmentProperty,
} from "@/core/properties";
import { logger } from "@/shared/lib/logger";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { Detail, EMPTY } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import {
  addPartyAction,
  cancelAssignmentAction,
  changeStatusAction,
  removePartyAction,
  saveCommonAreasAction,
  savePropertyAction,
  setAgreementAction,
  setScheduleAction,
  setTeamMemberAction,
  updatePartyAction,
} from "./actions";
import {
  CommonAreasDetails,
  CommonAreasForm,
  type CommonAreasFormValues,
} from "./common-areas-form";
import { formatOsloDateTime, osloDateTimeLocal } from "../../ordre/received-at";
import { BookingDuplicatesNotice } from "../../possible-duplicates-notice";
import { AgreementCard } from "./agreement-card";
import { updateAssignmentBookingAction } from "./booking-actions";
import { BookingCard } from "./booking-card";
import { AssignmentBookingHistory } from "./booking-history";
import { ClaimsSection, type ClaimListItem } from "./claims-section";
import { PartyCard } from "./party-card";
import { AddPartySection, type PartyRoleOption } from "./party-form";
import { PropertyDetails, PropertyForm, type PropertyFormValues } from "./property-form";
import { formatDueDate, formatInspectionAt, toDateTimeLocal } from "../../oslo-format";
import { ScheduleCard } from "./schedule-card";
import { StatusCard, type StatusOption } from "./status-card";
import { TeamMemberForm } from "./team-form";
import { WorkSessionTracker } from "./work-session-tracker";

export const metadata: Metadata = { title: "Oppdrag" };

/** Skjemaverdiene fra den lagrede eiendommen, eller fra ordren når eiendom mangler. */
function propertyFormValues(data: AssignmentProperty): PropertyFormValues {
  const { property, prefill } = data;
  const unit = property?.cadastralUnit ?? null;
  return {
    address: property?.address ?? prefill.address ?? "",
    postalCode: property?.postalCode ?? "",
    city: property?.city ?? "",
    municipalityNumber: property?.municipalityNumber ?? "",
    municipalityName: property?.municipalityName ?? "",
    housingType: property?.housingType ?? "",
    ownershipForm: property?.ownershipForm ?? "",
    gnr: property ? (unit?.gnr ?? "") : (prefill.gnr ?? ""),
    bnr: property ? (unit?.bnr ?? "") : (prefill.bnr ?? ""),
    fnr: unit?.fnr ?? "",
    snr: property ? (unit?.snr ?? "") : (prefill.snr ?? ""),
    associationName: property ? (unit?.associationName ?? "") : (prefill.associationName ?? ""),
    associationOrgNumber: unit?.associationOrgNumber ?? "",
    shareNumber: unit?.shareNumber ?? "",
  };
}

function commonAreasFormValues(data: AssignmentProperty): CommonAreasFormValues {
  const areas = data.commonAreas;
  return {
    managingAgent: areas?.managingAgent ?? "",
    conditionReportStatus: areas?.conditionReportStatus ?? "unknown",
    maintenancePlanStatus: areas?.maintenancePlanStatus ?? "unknown",
    notes: areas?.notes ?? "",
  };
}

/**
 * Avtalt befaring og frist for oppdraget. `getAssignment` gir dem ikke, så de hentes fra
 * arbeidskøen i kjernen (samme tilgangssjekk og organisasjonsfilter): søk på oppdragsnummeret i
 * oppdragets fane, «Alle», og velg raden med samme id.
 */
async function loadSchedule(
  context: NonNullable<Awaited<ReturnType<typeof getEmployeeContext>>>,
  assignment: { id: string; number: string; status: string },
) {
  const status = ASSIGNMENT_STATUSES.find((code) => code === assignment.status);
  if (!status) return { inspectionAt: null, dueDate: null };
  const { items } = await listWorkQueue(context.actor, context.organizationId, {
    status,
    mineOnly: false,
    query: assignment.number,
  });
  const item = items.find((row) => row.id === assignment.id);
  return { inspectionAt: item?.inspectionAt ?? null, dueDate: item?.dueDate ?? null };
}

/**
 * «Eiendom» og, når eiendommen har fellesdeler (A72), «Fellesdeler». Skjemaene vises bare med
 * `canEdit`; ellers står verdiene som tekst. Skjemaene får ny `key` når de lagrede verdiene
 * endres, så feltene starter med det som er lagret.
 */
function PropertySection({
  assignmentId,
  data,
  canEdit,
}: {
  assignmentId: string;
  data: AssignmentProperty;
  canEdit: boolean;
}) {
  const { property } = data;
  const values = propertyFormValues(data);
  const showCommonAreas = property !== null && hasCommonAreas(property);
  const areas = commonAreasFormValues(data);

  return (
    <>
      <section aria-labelledby="property-heading" className="mb-8">
        <h2 id="property-heading" className="mb-3 text-xl font-semibold text-slate-900">
          Eiendom
        </h2>
        <Card>
          {canEdit ? (
            <PropertyForm
              key={property ? JSON.stringify(values) : "prefill"}
              assignmentId={assignmentId}
              initial={values}
              fromOrder={property === null}
              housingTypes={HOUSING_TYPES.map((code) => ({
                value: code,
                label: housingTypeLabel(code),
              }))}
              ownershipForms={OWNERSHIP_FORMS.map((code) => ({
                value: code,
                label: ownershipFormLabel(code),
              }))}
              action={savePropertyAction}
            />
          ) : property ? (
            <PropertyDetails
              values={values}
              housingTypeText={housingTypeLabel(property.housingType)}
              ownershipFormText={ownershipFormLabel(property.ownershipForm)}
            />
          ) : (
            <p className="text-slate-600">Eiendommen er ikke lagt inn ennå.</p>
          )}
        </Card>
      </section>

      {showCommonAreas && (
        <section aria-labelledby="common-areas-heading" className="mb-8">
          <h2 id="common-areas-heading" className="mb-3 text-xl font-semibold text-slate-900">
            Fellesdeler
          </h2>
          <Card>
            {canEdit ? (
              <CommonAreasForm
                key={JSON.stringify(areas)}
                assignmentId={assignmentId}
                initial={areas}
                answers={YES_NO_UNKNOWN.map((code) => ({
                  value: code,
                  label: yesNoUnknownLabel(code),
                }))}
                action={saveCommonAreasAction}
              />
            ) : (
              <CommonAreasDetails
                values={areas}
                conditionReportText={yesNoUnknownLabel(areas.conditionReportStatus)}
                maintenancePlanText={yesNoUnknownLabel(areas.maintenancePlanStatus)}
              />
            )}
          </Card>
        </section>
      )}
    </>
  );
}

/**
 * Sakene til delen «Reklamasjoner», eller `null` når delen ikke skal vises. Flagget fra konteksten
 * styrer bare om vi spør; kjernen avgjør, og `AccessDeniedError` skjuler delen.
 */
async function loadClaims(
  context: NonNullable<Awaited<ReturnType<typeof getEmployeeContext>>>,
  assignmentId: string,
): Promise<ClaimListItem[] | null> {
  if (!context.canReadClaims) return null;
  try {
    const claims = await listClaimsForAssignment(
      context.actor,
      context.organizationId,
      assignmentId,
    );
    return claims.map((claim) => ({
      id: claim.id,
      receivedAt: claim.receivedAt,
      typeLabel: claimTypeLabel(claim.claimType),
      description: claim.description,
      open: claim.outcome === "open",
      outcomeLabel: claimOutcomeLabel(claim.outcome),
    }));
  } catch (error) {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  }
}

/**
 * Varselet «Mulig dublett» (T3) skal aldri gjøre oppdragssiden utilgjengelig: feiler oppslaget,
 * vises siden uten varsel. Loggen får bare id-er og feilnavnet, aldri adresse eller matrikkel.
 */
async function loadDuplicates(
  context: NonNullable<Awaited<ReturnType<typeof getEmployeeContext>>>,
  assignmentId: string,
) {
  try {
    return await findPossibleDuplicatesForAssignment(
      context.actor,
      context.organizationId,
      assignmentId,
    );
  } catch (error) {
    logger.error("Kunne ikke sjekke mulig dublett", {
      route: "/oppdrag/[id]",
      assignmentId,
      userId: context.actor.id,
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
    return { items: [], hasMore: false };
  }
}

/** «Gnr. 12, bnr. 34, snr. 5», eller `null` når alle tre mangler. */
function cadastreText(booking: { gnr: string | null; bnr: string | null; snr: string | null }) {
  const parts = [
    booking.gnr ? `Gnr. ${booking.gnr}` : null,
    booking.bnr ? `bnr. ${booking.bnr}` : null,
    booking.snr ? `snr. ${booking.snr}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Oppdraget med status, eiendom (og fellesdeler), team (fem roller), parter og (for leder og admin)
 * reklamasjoner. Skjemaene vises
 * bare med `canEditOrders`; selve sjekken skjer i kjernen. Ugyldig, ukjent, slettet (også
 * kansellert) og fremmed id gir
 * «Fant ikke siden».
 */
export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { ny, endret } = await searchParams;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let assignment: Awaited<ReturnType<typeof getAssignment>>;
  let propertyData: AssignmentProperty;
  let bookingView: Awaited<ReturnType<typeof getAssignmentBooking>>;
  let bookingHistory: Awaited<ReturnType<typeof listAssignmentBookingHistory>>;
  try {
    [assignment, propertyData, bookingView, bookingHistory] = await Promise.all([
      getAssignment(context.actor, context.organizationId, id),
      getAssignmentProperty(context.actor, context.organizationId, id),
      getAssignmentBooking(context.actor, context.organizationId, id),
      listAssignmentBookingHistory(context.actor, context.organizationId, id),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  const canEdit = context.canEditOrders;
  const now = new Date();
  const [schedule, agreements, suggestion, claims, duplicates] = await Promise.all([
    loadSchedule(context, assignment),
    listAgreements(context.actor, context.organizationId),
    suggestAgreementForAssignment(context.actor, context.organizationId, assignment.id, now),
    loadClaims(context, assignment.id),
    loadDuplicates(context, assignment.id),
  ]);
  const booking = bookingView.booking;
  const cadastre = cadastreText(booking);
  // Statusen er alltid en av de fire kodene (CHECK i databasen); ukjent kode gir ingen knapper.
  const status = ASSIGNMENT_STATUSES.find((code) => code === assignment.status) ?? null;
  const { next, previous } = status ? allowedTransitions(status) : { next: null, previous: null };
  const option = (code: typeof next): StatusOption | null =>
    code ? { value: code, label: assignmentStatusLabel(code) } : null;
  const roles: PartyRoleOption[] = PARTY_ROLES.map((role) => ({
    value: role,
    label: partyRoleLabel(role),
    receives: defaultReceives(role),
  }));

  return (
    <main className="max-w-2xl">
      <WorkSessionTracker assignmentId={assignment.id} />
      {assignment.orderId && (
        <Link
          href={`/ordre/${assignment.orderId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
        >
          <span aria-hidden="true">‹&nbsp;</span>
          Ordren
        </Link>
      )}
      <div className="mt-2 mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">
          Oppdrag <span className="tabular-nums">{assignment.number}</span>
        </h1>
      </div>
      {/* Kvitteringene: nummeret kommer fra oppdraget, aldri fra adressen. */}
      {ny === "1" && (
        <div className="mb-4">
          <Notice message={`Oppdrag ${assignment.number} er lagret.`} />
        </div>
      )}
      {endret === "1" && (
        <div className="mb-4">
          <Notice message="Endringene er lagret." />
        </div>
      )}
      <BookingDuplicatesNotice
        items={duplicates.items}
        hasMore={duplicates.hasMore}
        className="mb-4"
      />
      <StatusCard
        key={assignment.status}
        assignmentId={assignment.id}
        status={assignment.status}
        statusLabel={assignmentStatusLabel(assignment.status)}
        corrected={assignment.corrected}
        canEdit={canEdit}
        next={option(next)}
        previous={option(previous)}
        cancellable={status !== null && canCancel(status)}
        changeAction={changeStatusAction}
        cancelAction={cancelAssignmentAction}
      />
      <ScheduleCard
        assignmentId={assignment.id}
        inspectionAt={schedule.inspectionAt ? toDateTimeLocal(schedule.inspectionAt) : ""}
        dueDate={schedule.dueDate ?? ""}
        inspectionText={
          schedule.inspectionAt
            ? formatInspectionAt(schedule.inspectionAt, now)
            : "Befaring ikke avtalt"
        }
        dueDateText={schedule.dueDate ? formatDueDate(schedule.dueDate, now) : "Ingen frist"}
        canEdit={canEdit}
        action={setScheduleAction}
      />
      <p className="text-slate-600">Kontor: {assignment.officeName}</p>
      <div className="mb-6">
        <p className="break-words text-slate-600">
          Utstedende selskap: {assignment.companyName ?? "Ikke satt"}
        </p>
        {!assignment.companyName && (
          <p className="text-sm text-slate-500">
            Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn
            under Ansatte.
          </p>
        )}
      </div>

      <BookingCard
        key={bookingView.rowVersion}
        assignmentId={assignment.id}
        rowVersion={bookingView.rowVersion}
        canEdit={canEdit}
        sellerDeclarationReceived={booking.sellerDeclarationReceived}
        action={updateAssignmentBookingAction}
        defaults={{
          addressText: booking.addressText,
          receivedAt: osloDateTimeLocal(new Date(booking.receivedAt)),
          externalRef: booking.externalRef ?? "",
          orderedByText: booking.orderedByText ?? "",
          orderedByContact: booking.orderedByContactId
            ? {
                id: booking.orderedByContactId,
                name: booking.orderedByContactName ?? "(fjernet kontakt)",
              }
            : null,
          gnr: booking.gnr ?? "",
          bnr: booking.bnr ?? "",
          snr: booking.snr ?? "",
          housingAssociationName: booking.housingAssociationName ?? "",
        }}
      >
        <dl>
          <Detail label="Adresse">{booking.addressText}</Detail>
          <Detail label="Matrikkel">{cadastre ?? EMPTY}</Detail>
          <Detail label="Hvem bestilte">
            {booking.orderedByText || EMPTY}
            {booking.orderedByContactId && (
              <Link
                href={`/kontakter/${booking.orderedByContactId}`}
                className="mt-1 flex min-h-11 w-fit items-center font-medium text-brand-700 underline"
              >
                Kontakt i registeret
                <span aria-hidden="true">&nbsp;›</span>
              </Link>
            )}
          </Detail>
          <Detail label="Meglerens ordrenummer">{booking.externalRef || EMPTY}</Detail>
          <Detail label="Borettslag eller sameie">{booking.housingAssociationName || EMPTY}</Detail>
          <Detail label="Mottatt">{formatOsloDateTime(booking.receivedAt)}</Detail>
          {assignment.orderId && (
            <Detail label="Fra ordre">
              <Link
                href={`/ordre/${assignment.orderId}`}
                className="flex min-h-11 w-fit items-center font-medium text-brand-700 underline"
              >
                Åpne ordren
              </Link>
            </Detail>
          )}
        </dl>
      </BookingCard>
      <AssignmentBookingHistory entries={bookingHistory} />

      <AgreementCard
        key={assignment.agreement?.id ?? "none"}
        assignmentId={assignment.id}
        agreement={assignment.agreement}
        suggestion={suggestion}
        agreements={agreements.map((row) => ({ ...row, deletedAt: null }))}
        today={todayInOslo(now)}
        canEdit={canEdit}
        action={setAgreementAction}
      />

      <PropertySection assignmentId={assignment.id} data={propertyData} canEdit={canEdit} />

      <p className="-mt-4 mb-8">
        <Link
          href={`/oppdrag/${assignment.id}/bygninger`}
          className="inline-flex min-h-11 items-center font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Bygninger, areal og rom
          <span aria-hidden="true">&nbsp;›</span>
        </Link>
      </p>

      <section aria-labelledby="team-heading" className="mb-8">
        <h2 id="team-heading" className="mb-3 text-xl font-semibold text-slate-900">
          Team
        </h2>
        <Card className="p-0">
          <ul>
            {TEAM_ROLES.map((teamRole) => {
              const member = assignment.team.find((row) => row.teamRole === teamRole);
              const label = teamRoleLabel(teamRole);
              return (
                <li
                  key={teamRole}
                  className="border-t border-slate-200 p-6 first:border-t-0"
                  aria-label={label}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-medium text-slate-900">{label}</h3>
                    <p className="break-words text-slate-900">
                      {member ? (
                        member.employeeName
                      ) : (
                        <span className="text-slate-500">Ikke satt</span>
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="mt-4">
                      <TeamMemberForm
                        key={member?.employeeId ?? "none"}
                        assignmentId={assignment.id}
                        teamRole={teamRole}
                        roleLabel={label}
                        currentEmployeeId={member?.employeeId ?? null}
                        candidates={assignment.teamCandidates}
                        action={setTeamMemberAction}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="parties-heading">
        <h2 id="parties-heading" className="mb-3 text-xl font-semibold text-slate-900">
          Parter
        </h2>
        {assignment.parties.length === 0 ? (
          <p className="mb-4 text-slate-600">Ingen parter er lagt inn ennå.</p>
        ) : (
          <ul className="mb-4 space-y-4">
            {assignment.parties.map((party) => (
              <li key={party.id}>
                <PartyCard
                  party={{
                    id: party.id,
                    role: party.role,
                    roleLabel: partyRoleLabel(party.role),
                    name: party.name,
                    firmName: party.firmName ?? "",
                    email: party.email ?? "",
                    phone: party.phone ?? "",
                    contactId: party.contactId ?? null,
                    receivesReport: party.receivesReport,
                    receivesInvoice: party.receivesInvoice,
                    receivesMessages: party.receivesMessages,
                  }}
                  canEdit={canEdit}
                  roles={roles}
                  updateAction={updatePartyAction}
                  removeAction={removePartyAction}
                />
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <AddPartySection assignmentId={assignment.id} roles={roles} action={addPartyAction} />
        )}
      </section>

      {claims && (
        <ClaimsSection
          assignmentId={assignment.id}
          claims={claims}
          canManage={context.canManageClaims}
        />
      )}
    </main>
  );
}
