import { and, count, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { assignmentParties, contacts, firms, orders } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { MergeSameRecordError } from "./errors";

/*
 * Fjerne og slå sammen kontakter og firma (docs/05-domenemodell.md 4.2,
 * docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md). Bare med `contacts.manage` (leder og
 * admin). All filtrering bruker `grant.organizationId` fra tilgangssjekken. Fremmed, ukjent,
 * allerede fjernet eller ugyldig id gir `AccessDeniedError`, og ingenting endres.
 *
 * Ingenting slettes permanent: fjerning og sammenslåing setter `deleted_at`. Alt skjer i én
 * transaksjon. Radene låses med `for update` i fast rekkefølge (sortert på id), slik at A→B og
 * B→A samtidig ikke gir vranglås: den som kommer sist, finner en fjernet rad og får avslag.
 *
 * Revisjonsloggen får bare id-er og antall, aldri navn, e-post, telefon, notat eller
 * organisasjonsnummer. Mislykkede forsøk logges ikke (transaksjonen rulles tilbake).
 */

export type MergeInput = { keepId: string; removeId: string };

type Kind = "contact" | "firm";

/** Begge id-ene må være gyldige og ulike. Ulike id-er sjekkes før databasen. */
function checkMergeIds(kind: Kind, { keepId, removeId }: MergeInput) {
  if (keepId === removeId) throw new MergeSameRecordError(kind);
  if (!isUuid(keepId) || !isUuid(removeId)) throw new AccessDeniedError();
}

/** Id-ene sortert, slik at radene alltid låses i samme rekkefølge. */
function lockOrder(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** Låser en aktiv kontakt i organisasjonen. Gir `AccessDeniedError` hvis den ikke finnes. */
async function lockContact(tx: DbExecutor, organizationId: string, contactId: string) {
  const [row] = await tx
    .select({ id: contacts.id, firmId: contacts.firmId })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, organizationId),
        isNull(contacts.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/** Låser et aktivt firma i organisasjonen. Gir `AccessDeniedError` hvis det ikke finnes. */
async function lockFirm(tx: DbExecutor, organizationId: string, firmId: string) {
  const [row] = await tx
    .select({ id: firms.id })
    .from(firms)
    .where(
      and(eq(firms.id, firmId), eq(firms.organizationId, organizationId), isNull(firms.deletedAt)),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/**
 * Firmaet til kontakten som beholdes, hvis det er aktivt. Låses for deling, slik at det ikke
 * fjernes mens koblingene flyttes. Slettet eller manglende firma gir `null`.
 */
async function activeFirmId(tx: DbExecutor, organizationId: string, firmId: string | null) {
  if (firmId === null) return null;
  const [row] = await tx
    .select({ id: firms.id })
    .from(firms)
    .where(
      and(eq(firms.id, firmId), eq(firms.organizationId, organizationId), isNull(firms.deletedAt)),
    )
    .for("share");
  return row?.id ?? null;
}

/** Fjerner en kontakt (myk sletting). Koblingene på parter og ordrer står urørt. */
export async function removeContact(
  actor: Actor,
  organizationId: string,
  contactId: string,
): Promise<void> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  if (!isUuid(contactId)) throw new AccessDeniedError();

  await db.transaction(async (tx) => {
    await lockContact(tx, grant.organizationId, contactId);
    const now = new Date();
    await tx
      .update(contacts)
      .set({
        deletedAt: now,
        deletedBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, grant.organizationId)));
    await recordAuditEvent(tx, grant, {
      entityType: "contact",
      entityId: contactId,
      action: "removed",
      changes: { contactId },
    });
  });
}

/**
 * Fjerner et firma (myk sletting). Kontaktene i firmaet beholdes; `firm_id` står, og skjermen
 * viser dem uten firma. Returnerer antall aktive kontakter i firmaet.
 */
export async function removeFirm(
  actor: Actor,
  organizationId: string,
  firmId: string,
): Promise<{ contactCount: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  if (!isUuid(firmId)) throw new AccessDeniedError();

  return db.transaction(async (tx) => {
    await lockFirm(tx, grant.organizationId, firmId);
    const [counted] = await tx
      .select({ n: count() })
      .from(contacts)
      .where(
        and(
          eq(contacts.firmId, firmId),
          eq(contacts.organizationId, grant.organizationId),
          isNull(contacts.deletedAt),
        ),
      );
    const contactCount = counted?.n ?? 0;

    const now = new Date();
    await tx
      .update(firms)
      .set({
        deletedAt: now,
        deletedBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(and(eq(firms.id, firmId), eq(firms.organizationId, grant.organizationId)));
    await recordAuditEvent(tx, grant, {
      entityType: "firm",
      entityId: firmId,
      action: "removed",
      changes: { firmId, contactCount },
    });
    return { contactCount };
  });
}

/**
 * Slår sammen to kontakter. Parter og ordrer (også myk-slettede) flyttes fra `removeId` til
 * `keepId`, og firmaet på de flyttede radene blir firmaet til kontakten som beholdes (slettet
 * eller manglende firma gir `null`). Friteksten røres ikke. `removeId` myk-slettes; `keepId`
 * endres ikke.
 */
export async function mergeContacts(
  actor: Actor,
  organizationId: string,
  input: MergeInput,
): Promise<{ partyCount: number; orderCount: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  checkMergeIds("contact", input);
  const { keepId, removeId } = input;
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    const locked = new Map<string, { id: string; firmId: string | null }>();
    for (const id of lockOrder([keepId, removeId])) {
      locked.set(id, await lockContact(tx, orgId, id));
    }
    const keep = locked.get(keepId);
    if (!keep) throw new AccessDeniedError();
    const firmId = await activeFirmId(tx, orgId, keep.firmId);

    const movedParties = await tx
      .update(assignmentParties)
      .set({ contactId: keepId, firmId, updatedBy: grant.employeeId })
      .where(
        and(eq(assignmentParties.organizationId, orgId), eq(assignmentParties.contactId, removeId)),
      )
      .returning({ id: assignmentParties.id });
    const movedOrders = await tx
      .update(orders)
      .set({ orderedByContactId: keepId, orderedByFirmId: firmId, updatedBy: grant.employeeId })
      .where(and(eq(orders.organizationId, orgId), eq(orders.orderedByContactId, removeId)))
      .returning({ id: orders.id });

    const now = new Date();
    await tx
      .update(contacts)
      .set({
        deletedAt: now,
        deletedBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(and(eq(contacts.id, removeId), eq(contacts.organizationId, orgId)));

    const result = { partyCount: movedParties.length, orderCount: movedOrders.length };
    await recordAuditEvent(tx, grant, {
      entityType: "contact",
      entityId: removeId,
      action: "merged",
      changes: { keepId, removeId, ...result },
    });
    return result;
  });
}

/**
 * Slår sammen to firma. Kontakter (også myk-slettede), parter og ordrer flyttes fra `removeId`
 * til `keepId`, og `removeId` myk-slettes. Firmaet som beholdes, endres ikke.
 */
export async function mergeFirms(
  actor: Actor,
  organizationId: string,
  input: MergeInput,
): Promise<{ contactCount: number; partyCount: number; orderCount: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "contacts.manage");
  checkMergeIds("firm", input);
  const { keepId, removeId } = input;
  const orgId = grant.organizationId;

  return db.transaction(async (tx) => {
    for (const id of lockOrder([keepId, removeId])) {
      await lockFirm(tx, orgId, id);
    }

    const movedContacts = await tx
      .update(contacts)
      .set({ firmId: keepId, updatedBy: grant.employeeId })
      .where(and(eq(contacts.organizationId, orgId), eq(contacts.firmId, removeId)))
      .returning({ id: contacts.id });
    const movedParties = await tx
      .update(assignmentParties)
      .set({ firmId: keepId, updatedBy: grant.employeeId })
      .where(
        and(eq(assignmentParties.organizationId, orgId), eq(assignmentParties.firmId, removeId)),
      )
      .returning({ id: assignmentParties.id });
    const movedOrders = await tx
      .update(orders)
      .set({ orderedByFirmId: keepId, updatedBy: grant.employeeId })
      .where(and(eq(orders.organizationId, orgId), eq(orders.orderedByFirmId, removeId)))
      .returning({ id: orders.id });

    const now = new Date();
    await tx
      .update(firms)
      .set({
        deletedAt: now,
        deletedBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(and(eq(firms.id, removeId), eq(firms.organizationId, orgId)));

    const result = {
      contactCount: movedContacts.length,
      partyCount: movedParties.length,
      orderCount: movedOrders.length,
    };
    await recordAuditEvent(tx, grant, {
      entityType: "firm",
      entityId: removeId,
      action: "merged",
      changes: { keepId, removeId, ...result },
    });
    return result;
  });
}
