import { and, eq, isNull } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { ContactNotFoundError, findContactForLink } from "@/core/contacts";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignmentParties, assignments, contacts, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { partyInputSchema, type PartyInput, type PartyValues } from "./schemas";
import { lockAssignment } from "./shared";

/*
 * Partene på oppdraget (A60): megler, selger, kjøper, selgers representant og fakturamottaker,
 * med navn og kontakt som fritekst og hva parten mottar. Endring med `assignment.edit`. Fjerning
 * er myk sletting. Hendelse og revisjonslogg har bare id-er, rollekoden, mottar-valgene og
 * navnene på feltene som er endret, aldri navn, firma, e-post eller telefon. Raden er kilden.
 *
 * Koblingen til kontaktregisteret: bare `contactId` sendes inn. Kjernen slår opp kontakten i
 * organisasjonen fra tilgangssjekken og setter firmaet fra kontakten. Friteksten lagres slik den
 * sendes og overskrives aldri. Kontaktdata sendes aldri til KI.
 */

/** Det som lagres på parten: skjemaverdiene og firmaet fra kontakten. */
type StoredPartyValues = PartyValues & { firmId: string | null };

/** Feltene som sammenlignes ved endring. Navnene (ikke verdiene) står i revisjonsloggen. */
const PARTY_FIELDS = [
  "role",
  "name",
  "firmName",
  "email",
  "phone",
  "receivesReport",
  "receivesInvoice",
  "receivesMessages",
  "contactId",
  "firmId",
] as const satisfies readonly (keyof StoredPartyValues)[];

/** Felt der verdien kan stå i revisjonsloggen (koder, ja/nei og id-er, ingen personopplysninger). */
const LOGGABLE_FIELDS = new Set<string>([
  "role",
  "receivesReport",
  "receivesInvoice",
  "receivesMessages",
  "contactId",
  "firmId",
]);

/**
 * Slår opp kontakten i organisasjonen fra tilgangssjekken og gir verdiene som lagres. Uten
 * kontakt er begge koblingene `null`. Fremmed, ukjent eller slettet kontakt gir
 * `ContactNotFoundError` før noe er skrevet.
 */
async function withContactLink(
  tx: DbExecutor,
  grant: EmployeeGrant,
  values: PartyValues,
): Promise<StoredPartyValues> {
  if (values.contactId === null) return { ...values, contactId: null, firmId: null };
  const contact = await findContactForLink(tx, grant.organizationId, values.contactId);
  if (!contact) throw new ContactNotFoundError();
  return { ...values, contactId: contact.id, firmId: contact.firmId };
}

/**
 * Henter og låser en part som ikke er fjernet, på et oppdrag som ikke er slettet, i
 * organisasjonen fra tilgangssjekken. Ellers `AccessDeniedError`.
 */
async function lockParty(tx: DbExecutor, grant: EmployeeGrant, partyId: string) {
  const [row] = await tx
    .select({
      id: assignmentParties.id,
      assignmentId: assignmentParties.assignmentId,
      role: assignmentParties.role,
      name: assignmentParties.name,
      firmName: assignmentParties.firmName,
      email: assignmentParties.email,
      phone: assignmentParties.phone,
      receivesReport: assignmentParties.receivesReport,
      receivesInvoice: assignmentParties.receivesInvoice,
      receivesMessages: assignmentParties.receivesMessages,
      contactId: assignmentParties.contactId,
      firmId: assignmentParties.firmId,
    })
    .from(assignmentParties)
    .innerJoin(
      assignments,
      and(
        eq(assignments.id, assignmentParties.assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .where(
      and(
        eq(assignmentParties.id, partyId),
        eq(assignmentParties.organizationId, grant.organizationId),
        isNull(assignmentParties.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Legger en part til på oppdraget. Mottar-valgene lagres slik de sendes. */
export async function addParty(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: PartyInput,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = partyInputSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const assignment = await lockAssignment(tx, grant, assignmentId);
    const stored = await withContactLink(tx, grant, values);

    const [row] = await tx
      .insert(assignmentParties)
      .values({
        ...stored,
        organizationId: grant.organizationId,
        assignmentId: assignment.id,
        createdBy: grant.employeeId,
      })
      .returning({ id: assignmentParties.id, role: assignmentParties.role });
    if (!row) throw new Error("Fant ikke parten etter at den ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "assignment.party_added",
      assignmentId: assignment.id,
      data: { partyId: row.id, role: row.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: row.id,
      action: "create",
      changes: {
        assignmentId: assignment.id,
        role: values.role,
        receivesReport: values.receivesReport,
        receivesInvoice: values.receivesInvoice,
        receivesMessages: values.receivesMessages,
        // Bare id-er, og bare når parten er koblet (uten kobling er raden som før)
        ...(stored.contactId === null
          ? {}
          : { contactId: stored.contactId, firmId: stored.firmId }),
      },
    });
    return { id: row.id };
  });
}

/**
 * Endrer en part. Alle feltene erstattes, også koblingen: tom eller manglende `contactId` fjerner
 * den. Uten endringer skrives ingenting (ingen hendelse). Revisjonsloggen får navnene på feltene
 * som er endret, og fra/til bare for rollen, mottar-valgene og id-ene til kontakt og firma.
 */
export async function updateParty(
  actor: Actor,
  organizationId: string,
  partyId: string,
  input: PartyInput,
): Promise<{ id: string; changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const values = partyInputSchema.parse(input);
  if (!isUuid(partyId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const before = await lockParty(tx, grant, partyId);
    const stored = await withContactLink(tx, grant, values);

    const fields = PARTY_FIELDS.filter((field) => before[field] !== stored[field]);
    if (fields.length === 0) return { id: before.id, changed: false };

    await tx
      .update(assignmentParties)
      .set({ ...stored, updatedBy: grant.employeeId })
      .where(
        and(
          eq(assignmentParties.id, before.id),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      );

    const changes: Record<string, unknown> = { assignmentId: before.assignmentId, fields };
    for (const field of fields) {
      if (LOGGABLE_FIELDS.has(field)) changes[field] = { from: before[field], to: stored[field] };
    }

    await recordEvent(tx, grant, {
      type: "assignment.party_updated",
      assignmentId: before.assignmentId,
      data: { partyId: before.id, role: values.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: before.id,
      action: "update",
      changes,
    });
    return { id: before.id, changed: true };
  });
}

/** Fjerner en part (myk sletting). Parten kan legges inn igjen som en ny rad. */
export async function removeParty(
  actor: Actor,
  organizationId: string,
  partyId: string,
): Promise<{ id: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(partyId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    const before = await lockParty(tx, grant, partyId);

    await tx
      .update(assignmentParties)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(assignmentParties.id, before.id),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      );

    await recordEvent(tx, grant, {
      type: "assignment.party_removed",
      assignmentId: before.assignmentId,
      data: { partyId: before.id, role: before.role },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: before.id,
      action: "delete",
      changes: { assignmentId: before.assignmentId, role: before.role },
    });
    return { id: before.id };
  });
}

/** Hvordan parten hentes tilbake: «Angre» i meldingen eller «Gjenopprett» i papirkurven. */
export type RestoreHow = "undo" | "trash";

/** Svaret fra `restoreParty`. Raden har `organizationId`, så tenant-testen kan sammenligne. */
export type RestorePartyResult = {
  restored: { type: "party"; id: string; organizationId: string }[];
  changed: boolean;
  notices: string[];
};

/** Beskjed når kontakten parten var koblet til, er fjernet (A415). */
export const PARTY_CONTACT_REMOVED_NOTICE =
  "Parten kom tilbake, men kontakten den var koblet til, er fjernet.";
/** Beskjed når firmaet parten var koblet til, er fjernet (A415). */
export const PARTY_FIRM_REMOVED_NOTICE =
  "Parten kom tilbake, men firmaet den var koblet til, er fjernet.";

/** Om kontakten finnes og ikke er fjernet, i organisasjonen fra tilgangssjekken. */
async function isActiveContact(tx: DbExecutor, organizationId: string, contactId: string) {
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, organizationId),
        isNull(contacts.deletedAt),
      ),
    );
  return row !== undefined;
}

/** Om firmaet finnes og ikke er fjernet, i organisasjonen fra tilgangssjekken. */
async function isActiveFirm(tx: DbExecutor, organizationId: string, firmId: string) {
  const [row] = await tx
    .select({ id: firms.id })
    .from(firms)
    .where(
      and(eq(firms.id, firmId), eq(firms.organizationId, organizationId), isNull(firms.deletedAt)),
    );
  return row !== undefined;
}

/**
 * Henter tilbake en fjernet part (papirkurven, A413 og A415). Bare id-en til parten tas inn;
 * oppdraget slås opp fra raden med organisasjonen fra tilgangssjekken, og raden låses. Ukjent id,
 * annen organisasjon, ugyldig UUID og kansellert oppdrag gir samme `AccessDeniedError`.
 *
 * Er parten allerede aktiv, skrives ingenting (`changed: false`, ingen hendelse eller logg), så
 * dobbelttrykk og ny sending er trygt. Parten står da likevel i `restored`, slik at skjermen kan
 * sette fokus på den.
 *
 * Koblingen (A415): er kontakten fjernet, kommer parten tilbake uten kontakt og firma (som når
 * kontakten tas bort i skjemaet). Er bare firmaet fjernet, settes bare firmaet til `null`.
 * Navnet og verdiene står slik de var. Sammenslått kontakt er allerede flyttet og står.
 *
 * Hendelse og revisjonslogg har bare id, rolle og koblings-id-er, aldri navn, e-post eller telefon.
 */
export async function restoreParty(
  actor: Actor,
  organizationId: string,
  partyId: string,
  how: RestoreHow,
): Promise<RestorePartyResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  if (!isUuid(partyId)) throw new AccessDeniedError();
  // Verdien går inn i hendelsen, så bare de to kodene slipper gjennom (også fra server-handlinger)
  if (how !== "undo" && how !== "trash") throw new Error("Ukjent måte å hente tilbake parten på.");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: assignmentParties.id,
        organizationId: assignmentParties.organizationId,
        assignmentId: assignmentParties.assignmentId,
        role: assignmentParties.role,
        contactId: assignmentParties.contactId,
        firmId: assignmentParties.firmId,
        deletedAt: assignmentParties.deletedAt,
      })
      .from(assignmentParties)
      .innerJoin(
        assignments,
        and(
          eq(assignments.id, assignmentParties.assignmentId),
          eq(assignments.organizationId, grant.organizationId),
          isNull(assignments.deletedAt),
        ),
      )
      .where(
        and(
          eq(assignmentParties.id, partyId),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      )
      .for("update");
    if (!row) throw new AccessDeniedError();

    const restored = [{ type: "party" as const, id: row.id, organizationId: grant.organizationId }];
    if (row.deletedAt === null) return { restored, changed: false, notices: [] };

    const notices: string[] = [];
    let contactId = row.contactId;
    let firmId = row.firmId;
    if (contactId !== null && !(await isActiveContact(tx, grant.organizationId, contactId))) {
      // Uten kontakt er det heller ikke noe firma fra kontakten (som i `withContactLink`)
      contactId = null;
      firmId = null;
      notices.push(PARTY_CONTACT_REMOVED_NOTICE);
    } else if (firmId !== null && !(await isActiveFirm(tx, grant.organizationId, firmId))) {
      firmId = null;
      notices.push(PARTY_FIRM_REMOVED_NOTICE);
    }

    const now = new Date();
    const secondsSinceRemoval = Math.max(
      0,
      Math.round((now.getTime() - row.deletedAt.getTime()) / 1000),
    );

    await tx
      .update(assignmentParties)
      .set({ deletedAt: null, deletedBy: null, updatedBy: grant.employeeId, contactId, firmId })
      .where(
        and(
          eq(assignmentParties.id, row.id),
          eq(assignmentParties.organizationId, grant.organizationId),
        ),
      );

    await recordEvent(tx, grant, {
      type: "assignment.party_restored",
      assignmentId: row.assignmentId,
      data: { partyId: row.id, role: row.role, how, secondsSinceRemoval },
    });
    const changes: Record<string, unknown> = {
      assignmentId: row.assignmentId,
      role: row.role,
      how,
    };
    // Bare id-er, og bare når koblingen er tatt bort fordi kontakten eller firmaet er fjernet
    if (contactId !== row.contactId) changes.contactId = { from: row.contactId, to: contactId };
    if (firmId !== row.firmId) changes.firmId = { from: row.firmId, to: firmId };
    await recordAuditEvent(tx, grant, {
      entityType: "assignment_party",
      entityId: row.id,
      action: "restore",
      changes,
    });
    return { restored, changed: true, notices };
  });
}
