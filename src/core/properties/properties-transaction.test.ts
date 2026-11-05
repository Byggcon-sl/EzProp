import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { saveAssignmentProperty, saveCommonAreas } from "@/core/properties";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  cadastralUnits,
  commonAreas,
  events,
  properties,
} from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Hendelser og revisjonslogg skrives i samme transaksjon som eiendommen og fellesdelene
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md 4.7.5).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster
 * bare der testen ber om det. Kaster en av dem, skal endringen ikke finnes.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation (den står i
 * properties.test.ts). Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (aldri en eiendom
 * eller fellesdeler uten spor).
 */

vi.mock("@/core/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/events")>();
  return { ...actual, recordEvent: vi.fn(actual.recordEvent) };
});

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordEvent).mockClear();
  vi.mocked(recordAuditEvent).mockClear();
});

function failEventOnce() {
  vi.mocked(recordEvent).mockImplementationOnce(async () => {
    throw new Error("hendelsen feilet (test)");
  });
}

function failAuditOnce() {
  vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
    throw new Error("revisjonsloggen feilet (test)");
  });
}

const FAILURES = [
  ["recordEvent", failEventOnce],
  ["recordAuditEvent", failAuditOnce],
] as const;

async function rowCount(
  table:
    | typeof properties
    | typeof cadastralUnits
    | typeof commonAreas
    | typeof events
    | typeof auditLog,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  return { org, admin, assignment };
}

const PROPERTY = {
  address: "Testveien 1",
  housingType: "apartment",
  ownershipForm: "cooperative",
  gnr: "999",
  bnr: "999",
  associationName: "Borettslaget Test",
} as unknown as Parameters<typeof saveAssignmentProperty>[3];

const COMMON = {
  managingAgent: "Forvalter Test",
  conditionReportStatus: "yes",
  maintenancePlanStatus: "unknown",
  notes: "Sett trapperom og kjeller",
} as unknown as Parameters<typeof saveCommonAreas>[3];

describe("4.7.5 feiler hendelsen eller loggen, finnes ingen endring", () => {
  it("modulene er pakket inn (ellers tester filen ingenting)", async () => {
    const { org, admin, assignment } = await setup();
    await saveAssignmentProperty(admin, org.id, assignment.id, PROPERTY);
    expect(vi.mocked(recordEvent)).toHaveBeenCalled();
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalled();
  });

  it.each(FAILURES)(
    "første saveAssignmentProperty: %s kaster → ingen eiendom, ingen matrikkelrad, property_id = null",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      fail();

      await expect(
        saveAssignmentProperty(admin, org.id, assignment.id, PROPERTY),
      ).rejects.toThrow();

      expect(await rowCount(properties)).toBe(0);
      expect(await rowCount(cadastralUnits)).toBe(0);
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
      const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
      expect(row?.propertyId).toBeNull();
    },
  );

  it.each(FAILURES)(
    "andre saveAssignmentProperty: %s kaster → eiendommen er uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      const { property } = await createProperty(org.id, {
        assignmentId: assignment.id,
        housingType: "apartment",
        ownershipForm: "cooperative",
      });
      fail();

      await expect(
        saveAssignmentProperty(admin, org.id, assignment.id, {
          ...PROPERTY,
          address: "Testveien 2",
        } as typeof PROPERTY),
      ).rejects.toThrow();

      const [row] = await db.select().from(properties).where(eq(properties.id, property.id));
      expect(row?.address).toBe("Testveien 1");
      expect(row?.rowVersion).toBe(property.rowVersion);
      expect(await rowCount(events)).toBe(0);
    },
  );

  it.each(FAILURES)("saveCommonAreas: %s kaster → ingen rad", async (_name, fail) => {
    const { org, admin, assignment } = await setup();
    await createProperty(org.id, {
      assignmentId: assignment.id,
      housingType: "apartment",
      ownershipForm: "cooperative",
    });
    fail();

    await expect(saveCommonAreas(admin, org.id, assignment.id, COMMON)).rejects.toThrow();

    expect(await rowCount(commonAreas)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });
});
