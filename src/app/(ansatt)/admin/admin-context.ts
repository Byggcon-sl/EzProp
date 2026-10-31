import "server-only";
import type { Actor } from "@/core/access";
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
