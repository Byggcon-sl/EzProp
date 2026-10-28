import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, organizations } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { AccessDeniedError } from "./errors";
import { listOrganizationsForActor, requireOrganizationAccess } from "./guards";
import { permissions } from "./permissions";

beforeEach(resetDatabase);

describe("requireOrganizationAccess", () => {
  it("gir en ansatt tilgang til egen organisasjon med rollene sine", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);

    const grant = await requireOrganizationAccess(user, org.id);
    expect(grant).toEqual({
      employeeId: employee.id,
      organizationId: org.id,
      roles: ["inspector"],
    });
  });

  it("nekter en ansatt i organisasjon A tilgang til organisasjon B (tenant-isolasjon)", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const user = await createUser();
    await createEmployee(user, orgA.id, ["admin"]);

    await expect(requireOrganizationAccess(user, orgB.id)).rejects.toThrow(AccessDeniedError);
    // Heller ikke admin i A ser B
    for (const permission of permissions) {
      await expect(requireOrganizationAccess(user, orgB.id, permission)).rejects.toThrow(
        AccessDeniedError,
      );
    }
  });

  it("nekter noen som ikke er ansatt, ukjent id og ugyldig id", async () => {
    const org = await createOrganization();
    const outsider = await createUser();
    await expect(requireOrganizationAccess(outsider, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      requireOrganizationAccess(outsider, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(AccessDeniedError);
    await expect(requireOrganizationAccess(outsider, "ikke-en-id")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("nekter når den ansatte er fjernet (myk sletting) eller har sluttet", async () => {
    const org = await createOrganization();
    const removed = await createUser();
    const gone = await createUser();
    const a = await createEmployee(removed, org.id, ["inspector"]);
    const b = await createEmployee(gone, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, a.id));
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, b.id));

    await expect(requireOrganizationAccess(removed, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(requireOrganizationAccess(gone, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("nekter tilgang til slettet organisasjon, også for admin", async () => {
    const org = await createOrganization();
    const admin = await createUser();
    await createEmployee(admin, org.id, ["admin"]);
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, org.id));

    await expect(requireOrganizationAccess(admin, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("følger rettighetsmatrisen: takstmann og kontor ser, leder ser reklamasjoner, admin alt", async () => {
    const org = await createOrganization();
    const inspector = await createUser();
    const office = await createUser();
    const manager = await createUser();
    const admin = await createUser();
    await createEmployee(inspector, org.id, ["inspector"]);
    await createEmployee(office, org.id, ["office"]);
    await createEmployee(manager, org.id, ["manager"]);
    await createEmployee(admin, org.id, ["admin"]);

    for (const actor of [inspector, office, manager, admin]) {
      await expect(
        requireOrganizationAccess(actor, org.id, "organization.read"),
      ).resolves.toBeDefined();
    }
    for (const actor of [inspector, office]) {
      await expect(requireOrganizationAccess(actor, org.id, "claims.read")).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(requireOrganizationAccess(actor, org.id, "organization.manage")).rejects.toThrow(
        AccessDeniedError,
      );
    }
    await expect(requireOrganizationAccess(manager, org.id, "claims.read")).resolves.toBeDefined();
    await expect(requireOrganizationAccess(manager, org.id, "organization.manage")).rejects.toThrow(
      AccessDeniedError,
    );
    // Admin har alle rettigheter. Denne testen skal aldri fjernes.
    for (const permission of permissions) {
      await expect(requireOrganizationAccess(admin, org.id, permission)).resolves.toBeDefined();
    }
  });

  it("en ansatt uten roller kan ingenting, heller ikke lese", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, []);
    await expect(requireOrganizationAccess(user, org.id)).rejects.toThrow(AccessDeniedError);
  });
});

describe("listOrganizationsForActor", () => {
  it("viser bare organisasjonene personen er ansatt i", async () => {
    const orgA = await createOrganization("A");
    await createOrganization("B");
    const user = await createUser();
    await createEmployee(user, orgA.id, ["inspector"]);
    const stranger = await createUser();

    expect(await listOrganizationsForActor(user)).toEqual([{ id: orgA.id, name: "A" }]);
    expect(await listOrganizationsForActor(stranger)).toEqual([]);
  });
});
