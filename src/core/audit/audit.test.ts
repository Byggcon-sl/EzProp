import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listAuditEvents, recordAuditEvent } from "./index";

beforeEach(resetDatabase);

describe("revisjonslogg", () => {
  it("lagrer hendelsen på organisasjonen fra tilgangssjekken, og bare leder og admin leser den", async () => {
    const org = await createOrganization();
    const admin = await createUser();
    const inspector = await createUser();
    await createEmployee(admin, org.id, ["admin"]);
    await createEmployee(inspector, org.id, ["inspector"]);

    const grant = await requireOrganizationAccess(inspector, org.id);
    await recordAuditEvent(db, grant, {
      entityType: "employee",
      entityId: grant.employeeId,
      action: "update",
      changes: { jobTitle: { from: null, to: "Takstingeniør" } },
    });

    const events = await listAuditEvents(admin, org.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "update", actorEmployeeId: grant.employeeId });
    await expect(listAuditEvents(inspector, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser aldri hendelser fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await recordAuditEvent(db, grantA, { entityType: "x", entityId: "1", action: "create" });
        await recordAuditEvent(db, grantB, { entityType: "x", entityId: "2", action: "create" });
        const rows = await db
          .select({ id: auditLog.id, organizationId: auditLog.organizationId })
          .from(auditLog);
        return {
          a: rows.filter((r) => r.organizationId === grantA.organizationId).map((r) => r.id),
          b: rows.filter((r) => r.organizationId === grantB.organizationId).map((r) => r.id),
        };
      },
      query: listAuditEvents,
      idOf: (row) => row.id,
    });
  });
});
