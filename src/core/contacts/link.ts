import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { contacts, firms } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";

/**
 * Slår opp en kontakt som skal kobles til en part eller en ordre, i transaksjonen til den som
 * kaller. `organizationId` skal komme fra tilgangssjekken (`grant.organizationId`) hos den som
 * kaller; funksjonen sjekker ikke tilgang selv.
 *
 * Gir `null` når kontakten ikke finnes i organisasjonen eller er slettet. Er firmaet slettet,
 * blir `firmId` `null` (samme regel som når kontakten vises). Returnerer bare id-er, aldri navn,
 * e-post eller telefon.
 */
export async function findContactForLink(
  tx: DbExecutor,
  organizationId: string,
  contactId: string,
): Promise<{ id: string; firmId: string | null } | null> {
  if (!isUuid(contactId)) return null;
  const [row] = await tx
    .select({ id: contacts.id, firmId: firms.id })
    .from(contacts)
    .leftJoin(
      firms,
      and(
        eq(firms.id, contacts.firmId),
        eq(firms.organizationId, organizationId),
        isNull(firms.deletedAt),
      ),
    )
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, organizationId),
        isNull(contacts.deletedAt),
      ),
    );
  return row ?? null;
}
