import { and, eq } from "drizzle-orm";
import type { RedactionCaseKnownValues } from "@/core/ai/redaction-cases";
import { db } from "@/db/client";
import { cadastralUnits } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createCommonAreas,
  createContact,
  createEmployee,
  createFirm,
  createOrder,
  createProperty,
  createTeamMember,
  createUser,
} from "./factories";

/*
 * Kjente verdier for «Vask før KI» som rader i testdatabasen (docs/funksjoner/fase2a-vask-for-ki-
 * testplan.md). Importerer ikke `@/core/ai/redaction`, så testfiler som bare trenger radene (for
 * eksempel `request-suggestion.test.ts`) kan lastes før vasken finnes. Alle verdier er oppdiktet.
 */

/** De kjente verdiene for ett oppdrag, beskrevet med kolonnene i kortets punkt 2. */
export type KnownSeed = RedactionCaseKnownValues;

/** Nøytralt partnavn uten treff i testtekstene (to ord, så det ikke blir et vanlig ord). */
export const NEUTRAL_PARTY_NAME = "Qxzpart Qxzrolle";

/**
 * Lager et oppdrag i organisasjonen og legger de kjente verdiene inn i radene kortets punkt 2
 * nevner. Gir id-en til oppdraget.
 */
export async function seedKnownValues(organizationId: string, seed: KnownSeed): Promise<string> {
  const deletedAt = new Date("2026-11-01T10:00:00Z");
  const assignment = await createAssignment(organizationId);
  const assignmentId = assignment.id;

  for (const party of seed.parties ?? []) {
    await createAssignmentParty(organizationId, {
      assignmentId,
      name: party.name,
      firmName: party.firmName ?? null,
      email: party.email ?? null,
      phone: party.phone ?? null,
      deletedAt: party.deleted ? deletedAt : null,
    });
  }
  for (const contactSeed of seed.partyContacts ?? []) {
    const firm = contactSeed.firm
      ? await createFirm(organizationId, {
          name: contactSeed.firm.name,
          orgNumber: contactSeed.firm.orgNumber ?? null,
          deletedAt: contactSeed.firm.deleted ? deletedAt : null,
        })
      : null;
    const contact = await createContact(organizationId, {
      firstName: contactSeed.firstName,
      lastName: contactSeed.lastName ?? null,
      email: contactSeed.email ?? null,
      phone: contactSeed.phone ?? null,
      firmId: firm?.id ?? null,
      deletedAt: contactSeed.deleted ? deletedAt : null,
    });
    await createAssignmentParty(organizationId, {
      assignmentId,
      name: NEUTRAL_PARTY_NAME,
      contactId: contact.id,
    });
  }
  for (const firmSeed of seed.partyFirms ?? []) {
    const firm = await createFirm(organizationId, {
      name: firmSeed.name,
      orgNumber: firmSeed.orgNumber ?? null,
      deletedAt: firmSeed.deleted ? deletedAt : null,
    });
    await createAssignmentParty(organizationId, {
      assignmentId,
      name: NEUTRAL_PARTY_NAME,
      firmId: firm.id,
    });
  }
  if (seed.order) {
    const order = seed.order;
    const contact = order.orderedByContact
      ? await createContact(organizationId, {
          firstName: order.orderedByContact.firstName,
          lastName: order.orderedByContact.lastName ?? null,
          email: order.orderedByContact.email ?? null,
          phone: order.orderedByContact.phone ?? null,
          deletedAt: order.orderedByContact.deleted ? deletedAt : null,
        })
      : null;
    const firm = order.orderedByFirm
      ? await createFirm(organizationId, {
          name: order.orderedByFirm.name,
          orgNumber: order.orderedByFirm.orgNumber ?? null,
          deletedAt: order.orderedByFirm.deleted ? deletedAt : null,
        })
      : null;
    await createOrder(organizationId, {
      status: "converted",
      assignmentId,
      addressText: order.addressText ?? "Qxzadresse 1",
      orderedByText: order.orderedByText ?? null,
      orderedByContactId: contact?.id ?? null,
      orderedByFirmId: firm?.id ?? null,
      gnr: order.gnr ?? null,
      bnr: order.bnr ?? null,
      snr: order.snr ?? null,
      housingAssociationName: order.housingAssociationName ?? null,
    });
  }
  for (const member of seed.team ?? []) {
    const employee = await createEmployee(await createUser({ name: member.name }), organizationId, [
      "inspector",
    ]);
    await createTeamMember(organizationId, {
      assignmentId,
      employeeId: employee.id,
      deletedAt: member.deleted ? deletedAt : null,
    });
  }
  if (seed.property) {
    const p = seed.property;
    const { cadastralUnit } = await createProperty(organizationId, {
      assignmentId,
      address: p.address ?? "Qxzadresse 2",
      postalCode: p.postalCode ?? null,
      city: p.city ?? null,
      municipalityName: p.municipalityName ?? null,
      municipalityNumber: p.municipalityNumber ?? null,
      gnr: p.gnr ?? "9991",
      bnr: p.bnr ?? "9992",
      fnr: p.fnr ?? null,
      snr: p.snr ?? null,
      shareNumber: p.shareNumber ?? null,
      associationName: p.associationName ?? null,
      associationOrgNumber: p.associationOrgNumber ?? null,
    });
    if (p.cadastralDeleted) {
      await db
        .update(cadastralUnits)
        .set({ deletedAt })
        .where(
          and(
            eq(cadastralUnits.id, cadastralUnit.id),
            eq(cadastralUnits.organizationId, organizationId),
          ),
        );
    }
  }
  if (seed.managingAgent !== undefined || seed.commonAreasDeleted) {
    await createCommonAreas(organizationId, {
      assignmentId,
      managingAgent: seed.managingAgent ?? null,
      deletedAt: seed.commonAreasDeleted ? deletedAt : null,
    });
  }
  return assignmentId;
}

/** Antall forekomster av hver plassholder i teksten. */
export function placeholderCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of text.matchAll(/\[[a-zæøå-]+\]/gu)) {
    counts[match[0]] = (counts[match[0]] ?? 0) + 1;
  }
  return counts;
}

/** Om ordet/frasen står i teksten som eget ord (Unicode-grenser, uten hensyn til store bokstaver). */
export function containsWord(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(
    text.normalize("NFC"),
  );
}
