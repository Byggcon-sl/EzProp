import "server-only";
import { canCreateAssignments, grantHasPermission, type Actor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { defaultMineOnly } from "@/core/assignments";
import { findEmployeeGrant } from "@/core/organization";

export type EmployeeContext = {
  actor: Actor;
  organizationId: string;
  /** Bare til å vise eller skjule knappene. Selve sjekken skjer i kjernen. */
  canEditOrders: boolean;
  /**
   * Bare til å vise «Nytt oppdrag» i arbeidskøen og menyen. Regnet ut i `src/core/access`; selve
   * sjekken skjer i `createAssignment`.
   */
  canCreateAssignments: boolean;
  /** Bare til å vise «Fjern» og «Slå sammen med …». Selve sjekken skjer i kjernen. */
  canManageContacts: boolean;
  /** Bare til å vise delen «Reklamasjoner». Selve sjekken skjer i kjernen (`claims.read`). */
  canReadClaims: boolean;
  /** Bare til å vise «Registrer reklamasjon» og skjemaet. Selve sjekken skjer i kjernen. */
  canManageClaims: boolean;
  /** Bare til å vise skjemaet for nullpunkt og bryter i /statistikk/tid. Sjekken skjer i kjernen. */
  canManageOrganization: boolean;
  /** Bare til å vise menylenken «Statistikk». Sjekken skjer i kjernen. */
  canReadStatistics: boolean;
  /**
   * Standardvalget «Mine» i arbeidskøen (T-0029), regnet fra rollene i tilgangssjekken (`grant`),
   * aldri fra adressen. `mine=0`/`mine=1` i adressen overstyrer.
   */
  defaultMineOnly: boolean;
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
    canCreateAssignments: canCreateAssignments(found.grant),
    canManageContacts: grantHasPermission(found.grant, "contacts.manage"),
    canReadClaims: grantHasPermission(found.grant, "claims.read"),
    canManageClaims: grantHasPermission(found.grant, "claims.manage"),
    canManageOrganization: grantHasPermission(found.grant, "organization.manage"),
    canReadStatistics: grantHasPermission(found.grant, "statistics.read"),
    defaultMineOnly: defaultMineOnly(found.grant.roles),
    officeId: found.officeId,
  };
}
