import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
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
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const adminA = await createUser();
    const adminB = await createUser();
    await createEmployee(adminA, orgA.id, ["admin"]);
    await createEmployee(adminB, orgB.id, ["admin"]);
    const grantA = await requireOrganizationAccess(adminA, orgA.id);
    await recordAuditEvent(db, grantA, { entityType: "x", entityId: "1", action: "create" });

    expect(await listAuditEvents(adminB, orgB.id)).toEqual([]);
    await expect(listAuditEvents(adminB, orgA.id)).rejects.toThrow(AccessDeniedError);
  });
});
