import "server-only";
import { grantHasPermission, type Actor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { findEmployeeGrant } from "@/core/organization";

export type EmployeeContext = {
  actor: Actor;
  organizationId: string;
  /** Bare til å vise eller skjule knappene. Selve sjekken skjer i kjernen. */
  canEditOrders: boolean;
  /** Bare til å vise «Fjern» og «Slå sammen med …». Selve sjekken skjer i kjernen. */
  canManageContacts: boolean;
  /** Bare til å vise delen «Reklamasjoner». Selve sjekken skjer i kjernen (`claims.read`). */
  canReadClaims: boolean;
  /** Bare til å vise «Registrer reklamasjon» og skjemaet. Selve sjekken skjer i kjernen. */
  canManageClaims: boolean;
  /** Kontoret på den ansattes egen rad, eller `null`. Bare til forhåndsvalget av kontor. */
  officeId: string | null;
};

/**
 * Innlogget bruker og organisasjonen der hen er ansatt (`organization.read`), eller `null`.
 * Brukes av hver side og hver server action i /ordre. Organisasjons-id-en kommer alltid herfra,
 * aldri fra adressen eller skjemaet. Selve tilgangssjekken skjer i `src/core`.
 */
export async function getEmployeeContext(): Promise<EmployeeContext | null> {
  const actor = await requireActor();
  const found = await findEmployeeGrant(actor);
  if (!found) return null;
  return {
    actor,
    organizationId: found.grant.organizationId,
    canEditOrders: grantHasPermission(found.grant, "assignment.edit"),
    canManageContacts: grantHasPermission(found.grant, "contacts.manage"),
    canReadClaims: grantHasPermission(found.grant, "claims.read"),
    canManageClaims: grantHasPermission(found.grant, "claims.manage"),
    officeId: found.officeId,
  };
}
