import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { employeePermissions, trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "./factories";

// Fanger at en ny tabell glemmes i truncate-listen (testplan for oppgave 4, avsnitt 3.6).

describe("resetDatabase", () => {
  it("resetDatabase tømmer trial_-tabellene", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const formId = uuidv7();
    await db
      .insert(trialForms)
      .values({ id: formId, organizationId: org.id, name: "Testskjema 1" });
    await db.insert(trialAnswers).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "floors",
      value: 2,
      deviceId: "enhet-1",
    });
    await db.insert(trialPhotos).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "cover_photo",
      name: "test-image.png",
      sizeBytes: 120,
    });

    await resetDatabase();

    for (const table of [trialForms, trialAnswers, trialPhotos]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

describe("grantPermission (fase 0b, roller og rettigheter)", () => {
  it("1. setter inn én rad med den ansattes organisasjon, og rettigheten virker", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser({ name: "Test Leder" });
    const employee = await createEmployee(user, org.id, ["manager"]);

    const row = await grantPermission(employee, "template.edit_structure");

    expect(row.organizationId).toBe(org.id);
    expect(row.employeeId).toBe(employee.id);
    expect(row.permission).toBe("template.edit_structure");
    expect(row.deletedAt).toBeNull();
    await expect(
      requireOrganizationAccess(user, org.id, "template.edit_structure"),
    ).resolves.toBeDefined();
  });

  it("2. resetDatabase tømmer employee_permissions", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await grantPermission(employee, "report.edit");

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(employeePermissions);
    expect(row!.n).toBe(0);
  });
});
