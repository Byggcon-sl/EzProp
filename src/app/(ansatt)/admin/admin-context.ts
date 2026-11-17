import "server-only";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { findAdminOrganizationId } from "@/core/organization";

export type AdminContext = { actor: Actor; organizationId: string };

/**
 * Innlogget bruker og organisasjonen der hen er admin (`organization.manage`), eller `null`.
 * Brukes av hver side og hver server action i /admin. Organisasjons-id-en kommer alltid herfra,
 * aldri fra adressen eller skjemaet. Selve tilgangssjekken skjer i `src/core`.
 */
export async function getAdminContext(): Promise<AdminContext | null> {
  const actor = await requireActor();
  const organizationId = await findAdminOrganizationId(actor);
  return organizationId ? { actor, organizationId } : null;
}

/**
 * Om ansatt-id-en er admin selv i organisasjonen fra konteksten (tilgangssjekken gir den
 * ansattes id). Brukes bare til å vise «Du blir også logget ut her» og til å vite om klienten skal
 * logge ut etterpå. Kjernen krever selv bekreftelsen når admin velger seg selv.
 */
export async function isOwnEmployee(context: AdminContext, employeeId: string): Promise<boolean> {
  const grant = await requireOrganizationAccess(
    context.actor,
    context.organizationId,
    "organization.manage",
  );
  return grant.employeeId === employeeId;
}
