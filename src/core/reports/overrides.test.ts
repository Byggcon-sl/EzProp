import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { overrideSummaries } from "@/db/schema";
import { createOverrideSummaryRow, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Overstyringer for leder (docs/funksjoner/fase2a-overstyringer-leder.md). Testfilen til tjenesten
 * i `overrides.ts`. Arkitekten har lagt inn tenant-testen for tabellen `override_summaries`
 * (migrering `0039_overstyringer-leder`); testskriveren bygger videre her og bytter spørringen
 * under med `getOverrideSummary` når tjenesten finnes.
 *
 * Støtter hovedmål: færre reklamasjoner og KI i bunnen (lederens oppsummering og
 * reklamasjonsdata lekker aldri mellom organisasjoner). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

describe("tenant-isolasjon for override_summaries", () => {
  it("en annen organisasjon får verken rader eller tilgang", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await createOverrideSummaryRow(grantA.organizationId)).id],
        b: [(await createOverrideSummaryRow(grantB.organizationId)).id],
      }),
      // Samme rettighet og samme filter som tjenesten skal bruke: `claims.read` og
      // `grant.organizationId` fra tilgangssjekken.
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "claims.read");
        return db
          .select({ id: overrideSummaries.id })
          .from(overrideSummaries)
          .where(
            and(
              eq(overrideSummaries.organizationId, grant.organizationId),
              isNull(overrideSummaries.deletedAt),
            ),
          );
      },
      idOf: (row) => row.id,
    });
  });
});
