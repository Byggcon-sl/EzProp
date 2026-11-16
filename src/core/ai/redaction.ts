/*
 * Vask før KI, oppslaget av kjente verdier (docs/funksjoner/fase2a-vask-for-ki.md, punkt 2 og 3,
 * ADR 0006 del 6). Selve vasken er ren og ligger i `./redact-text.ts`; den re-eksporteres her, så
 * eksisterende importer virker.
 *
 * Hovedmål: KI i bunnen og de ansatte. Navn, e-post, telefon, adresse og matrikkel for oppdraget
 * hentes her, bare i organisasjonen til tilgangen, så de kan vaskes bort før teksten sendes til en
 * leverandør (regel 14).
 *
 * Kjente verdier lever bare i minnet under det ene kallet: ingen mellomlagring her, og de skrives
 * aldri til logger, feilmeldinger eller svar. Feil kastes videre (A176): ingen usvasket tekst slipper
 * gjennom.
 *
 * Endring i denne filen krever gjennomgang av sikkerhet-personvern i PR-en.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignmentTeamMembers,
  assignments,
  cadastralUnits,
  commonAreas,
  contacts,
  employees,
  firms,
  orders,
  properties,
} from "@/db/schema";
import { emptyKnownValues, type KnownValues } from "./redact-text";

export {
  compileKnownValues,
  emptyKnownValues,
  RedactionPatternError,
  redactFieldValues,
  redactText,
  type KnownCadastralUnit,
  type KnownValues,
} from "./redact-text";

function pushValue(list: string[], value: string | null | undefined): void {
  if (value !== null && value !== undefined && value.trim() !== "") list.push(value);
}

function nonNull(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))];
}

/**
 * Henter de kjente verdiene for oppdraget, bare i organisasjonen til `grant`.
 * Mykt slettede parter, kontakter, firma, teammedlemmer, matrikkel og fellesareal tas med (A170).
 * Finnes ikke oppdraget i organisasjonen, kastes en feil (feil skal stenge, A176), så teksten
 * aldri sendes vasket bare med mønstrene når et oppdrag er oppgitt.
 */
export async function loadKnownValues(
  grant: EmployeeGrant,
  assignmentId: string,
): Promise<KnownValues> {
  const organizationId = grant.organizationId;
  const known = emptyKnownValues();

  // Oppdraget eier bestillingsopplysningene (ADR 0011, A292): de leses herfra også når
  // `order_id` og `property_id` er tomme. Ordren og eiendommen er ekstra kilder (en ordre som er
  // rettet etter omgjøring kan ha andre verdier enn oppdraget).
  const [assignment] = await db
    .select({
      orderId: assignments.orderId,
      propertyId: assignments.propertyId,
      orderedByText: assignments.orderedByText,
      orderedByContactId: assignments.orderedByContactId,
      orderedByFirmId: assignments.orderedByFirmId,
      addressText: assignments.addressText,
      gnr: assignments.gnr,
      bnr: assignments.bnr,
      snr: assignments.snr,
      housingAssociationName: assignments.housingAssociationName,
      externalRef: assignments.externalRef,
    })
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.organizationId, organizationId)))
    .limit(1);
  if (!assignment) throw new Error("Oppdraget finnes ikke i organisasjonen.");

  const orderMatch = assignment.orderId
    ? or(eq(orders.id, assignment.orderId), eq(orders.assignmentId, assignmentId))
    : eq(orders.assignmentId, assignmentId);
  const [orderRows, partyRows, teamRows, propertyRows, commonAreaRows] = await Promise.all([
    db
      .select({
        orderedByText: orders.orderedByText,
        orderedByContactId: orders.orderedByContactId,
        orderedByFirmId: orders.orderedByFirmId,
        addressText: orders.addressText,
        gnr: orders.gnr,
        bnr: orders.bnr,
        snr: orders.snr,
        housingAssociationName: orders.housingAssociationName,
        externalRef: orders.externalRef,
      })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), orderMatch)),
    db
      .select({
        name: assignmentParties.name,
        firmName: assignmentParties.firmName,
        email: assignmentParties.email,
        phone: assignmentParties.phone,
        contactId: assignmentParties.contactId,
        firmId: assignmentParties.firmId,
      })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, organizationId),
          eq(assignmentParties.assignmentId, assignmentId),
        ),
      ),
    db
      .select({ name: employees.name })
      .from(assignmentTeamMembers)
      .innerJoin(
        employees,
        and(
          eq(employees.id, assignmentTeamMembers.employeeId),
          eq(employees.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(assignmentTeamMembers.organizationId, organizationId),
          eq(assignmentTeamMembers.assignmentId, assignmentId),
        ),
      ),
    assignment.propertyId
      ? db
          .select({
            address: properties.address,
            postalCode: properties.postalCode,
            city: properties.city,
            municipalityName: properties.municipalityName,
            municipalityNumber: properties.municipalityNumber,
          })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, organizationId),
              eq(properties.id, assignment.propertyId),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ managingAgent: commonAreas.managingAgent })
      .from(commonAreas)
      .where(
        and(
          eq(commonAreas.organizationId, organizationId),
          eq(commonAreas.assignmentId, assignmentId),
        ),
      ),
  ]);

  const bookingRows = [assignment, ...orderRows];
  const contactIds = nonNull([
    ...partyRows.map((p) => p.contactId),
    ...bookingRows.map((o) => o.orderedByContactId),
  ]);
  const contactRows =
    contactIds.length > 0
      ? await db
          .select({
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            firmId: contacts.firmId,
          })
          .from(contacts)
          .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.id, contactIds)))
      : [];

  const firmIds = nonNull([
    ...partyRows.map((p) => p.firmId),
    ...bookingRows.map((o) => o.orderedByFirmId),
    ...contactRows.map((c) => c.firmId),
  ]);
  const firmRows =
    firmIds.length > 0
      ? await db
          .select({ name: firms.name, orgNumber: firms.orgNumber })
          .from(firms)
          .where(and(eq(firms.organizationId, organizationId), inArray(firms.id, firmIds)))
      : [];

  const cadastralRows = assignment.propertyId
    ? await db
        .select({
          gnr: cadastralUnits.gnr,
          bnr: cadastralUnits.bnr,
          fnr: cadastralUnits.fnr,
          snr: cadastralUnits.snr,
          shareNumber: cadastralUnits.shareNumber,
          associationName: cadastralUnits.associationName,
          associationOrgNumber: cadastralUnits.associationOrgNumber,
        })
        .from(cadastralUnits)
        .where(
          and(
            eq(cadastralUnits.organizationId, organizationId),
            eq(cadastralUnits.propertyId, assignment.propertyId),
          ),
        )
    : [];

  for (const party of partyRows) {
    pushValue(known.personNames, party.name);
    pushValue(known.phrases, party.firmName);
    pushValue(known.emails, party.email);
    pushValue(known.phones, party.phone);
  }
  for (const contact of contactRows) {
    pushValue(known.personNames, [contact.firstName, contact.lastName].filter(Boolean).join(" "));
    pushValue(known.emails, contact.email);
    pushValue(known.phones, contact.phone);
  }
  for (const firm of firmRows) {
    pushValue(known.phrases, firm.name);
    pushValue(known.orgNumbers, firm.orgNumber);
  }
  for (const booking of bookingRows) {
    pushValue(known.phrases, booking.orderedByText);
    pushValue(known.phrases, booking.housingAssociationName);
    pushValue(known.phrases, booking.externalRef);
    pushValue(known.addresses.full, booking.addressText);
    if (booking.gnr !== null || booking.bnr !== null || booking.snr !== null) {
      known.cadastral.units.push({
        gnr: booking.gnr,
        bnr: booking.bnr,
        fnr: null,
        snr: booking.snr,
        shareNumber: null,
      });
    }
  }
  for (const member of teamRows) pushValue(known.personNames, member.name);
  for (const property of propertyRows) {
    pushValue(known.addresses.full, property.address);
    pushValue(known.addresses.places, property.city);
    pushValue(known.addresses.places, property.municipalityName);
    pushValue(known.addresses.postalCodes, property.postalCode);
    pushValue(known.cadastral.municipalityNumbers, property.municipalityNumber);
  }
  for (const unit of cadastralRows) {
    known.cadastral.units.push({
      gnr: unit.gnr,
      bnr: unit.bnr,
      fnr: unit.fnr,
      snr: unit.snr,
      shareNumber: unit.shareNumber,
    });
    pushValue(known.phrases, unit.associationName);
    pushValue(known.orgNumbers, unit.associationOrgNumber);
  }
  for (const area of commonAreaRows) pushValue(known.phrases, area.managingAgent);

  return known;
}
