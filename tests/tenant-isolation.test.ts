import { beforeEach, describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { listAuditEvents, recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { resetDatabase } from "./factories";
import { TenantIsolationError, expectTenantIsolation } from "./tenant-isolation";

beforeEach(resetDatabase);

/** Én hendelse i hver organisasjon. Oppdiktede verdier. */
async function seedOneEventEach(grantA: EmployeeGrant, grantB: EmployeeGrant) {
  await recordAuditEvent(db, grantA, { entityType: "x", entityId: "1", action: "create" });
  await recordAuditEvent(db, grantB, { entityType: "x", entityId: "2", action: "create" });
  const rows = await db
    .select({ id: auditLog.id, organizationId: auditLog.organizationId })
    .from(auditLog);
  return {
    a: rows.filter((r) => r.organizationId === grantA.organizationId).map((r) => r.id),
    b: rows.filter((r) => r.organizationId === grantB.organizationId).map((r) => r.id),
  };
}

const idOf = (row: { id: string }) => row.id;

describe("expectTenantIsolation", () => {
  it("godtar en spørring som filtrerer på grant.organizationId", async () => {
    await expectTenantIsolation({ seed: seedOneEventEach, query: listAuditEvents, idOf });
  });

  it("feiler når spørringen returnerer rader fra den andre organisasjonen", async () => {
    // Feil spørring, bare her i testen: sjekker tilgang, men glemmer where.
    const leaky = async (actor: Actor, organizationId: string) => {
      await requireOrganizationAccess(actor, organizationId);
      return db.select({ id: auditLog.id }).from(auditLog);
    };
    const run = expectTenantIsolation({ seed: seedOneEventEach, query: leaky, idOf });
    await expect(run).rejects.toThrow(TenantIsolationError);
    await expect(
      expectTenantIsolation({ seed: seedOneEventEach, query: leaky, idOf }),
    ).rejects.toThrow(/Lekkasje: bruker i organisasjon A fikk rad .* fra organisasjon B/);
  });

  it("feiler når spørringen ikke kaster AccessDeniedError for fremmed id", async () => {
    // Nekter bare i én retning. Begge varianter skal feile.
    const deniesOnlyOneWay = (denyWhenActorNamed: string) => {
      return async (actor: Actor, organizationId: string) => {
        if (actor.name === denyWhenActorNamed) {
          const grant = await requireOrganizationAccess(actor, organizationId);
          return listAuditEvents(actor, grant.organizationId);
        }
        try {
          return await listAuditEvents(actor, organizationId);
        } catch (error) {
          if (error instanceof AccessDeniedError) return [];
          throw error;
        }
      };
    };
    await expect(
      expectTenantIsolation({ seed: seedOneEventEach, query: deniesOnlyOneWay("Admin A"), idOf }),
    ).rejects.toThrow(/Ikke nektet: bruker i organisasjon B .* organisasjon A sin id/);
    await expect(
      expectTenantIsolation({ seed: seedOneEventEach, query: deniesOnlyOneWay("Admin B"), idOf }),
    ).rejects.toThrow(/Ikke nektet: bruker i organisasjon A .* organisasjon B sin id/);
  });

  it("feiler når spørringen ikke returnerer organisasjonens egne rader", async () => {
    const empty = async (actor: Actor, organizationId: string) => {
      await requireOrganizationAccess(actor, organizationId);
      return [] as { id: string }[];
    };
    await expect(
      expectTenantIsolation({ seed: seedOneEventEach, query: empty, idOf }),
    ).rejects.toThrow(/Mangler egne rader: bruker i organisasjon A/);
  });
});
