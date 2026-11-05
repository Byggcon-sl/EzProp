import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignments, auditLog, events } from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { cancelAssignment, changeAssignmentStatus } from "./index";

/*
 * Status, hendelse og revisjonslogg skrives i samme transaksjon
 * (docs/funksjoner/fase2a-statusflyt-testplan.md 3.6.5).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster
 * bare én gang der testen ber om det. Kaster en av dem, skal statusen og `deleted_at` være som
 * før, og ingen hendelse eller loggrad skal finnes.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (aldri en statusendring eller kansellering uten spor).
 */

vi.mock("@/core/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/events")>();
  return { ...actual, recordEvent: vi.fn(actual.recordEvent) };
});

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

const actualEvents = await vi.importActual<typeof import("@/core/events")>("@/core/events");
const actualAudit = await vi.importActual<typeof import("@/core/audit")>("@/core/audit");

// mockReset tar også bort en «én gang»-feil som ikke ble brukt i forrige test.
beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordEvent).mockReset().mockImplementation(actualEvents.recordEvent);
  vi.mocked(recordAuditEvent).mockReset().mockImplementation(actualAudit.recordAuditEvent);
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

async function setup(status: "ordered" | "in_progress" | "completed" = "ordered") {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id, { status });
  return { org, admin, assignment };
}

async function row(id: string) {
  const [found] = await db.select().from(assignments).where(eq(assignments.id, id));
  if (!found) throw new Error("fant ikke oppdraget");
  return found;
}

async function rowCount(table: typeof events | typeof auditLog) {
  const [found] = await db.select({ n: count() }).from(table);
  return found?.n ?? 0;
}

describe("3.6.5 samme transaksjon", () => {
  it.each(FAILURES)(
    "changeAssignmentStatus fram: %s kaster, og statusen er uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup("ordered");
      const before = await row(assignment.id);
      fail();

      await expect(
        changeAssignmentStatus(admin, org.id, assignment.id, {
          expectedStatus: "ordered",
          toStatus: "in_progress",
        }),
      ).rejects.toThrow();

      const after = await row(assignment.id);
      expect(after.status).toBe("ordered");
      expect(after.rowVersion).toBe(before.rowVersion);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );

  it.each(FAILURES)(
    "changeAssignmentStatus tilbake: %s kaster, og statusen er uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup("completed");
      fail();

      await expect(
        changeAssignmentStatus(admin, org.id, assignment.id, {
          expectedStatus: "completed",
          toStatus: "in_progress",
          reason: "Feiltrykk",
        }),
      ).rejects.toThrow();

      expect((await row(assignment.id)).status).toBe("completed");
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );

  it.each(FAILURES)("cancelAssignment: %s kaster, og deleted_at er tom", async (_name, fail) => {
    const { org, admin, assignment } = await setup("in_progress");
    const before = await row(assignment.id);
    fail();

    await expect(
      cancelAssignment(admin, org.id, assignment.id, {
        expectedStatus: "in_progress",
        reason: "Kunden trakk bestillingen",
      }),
    ).rejects.toThrow();

    const after = await row(assignment.id);
    expect(after.deletedAt).toBeNull();
    expect(after.deletedBy).toBeNull();
    expect(after.status).toBe("in_progress");
    expect(after.rowVersion).toBe(before.rowVersion);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("etter en feil virker neste kall som vanlig", async () => {
    const { org, admin, assignment } = await setup("ordered");
    failEventOnce();
    await expect(
      changeAssignmentStatus(admin, org.id, assignment.id, {
        expectedStatus: "ordered",
        toStatus: "in_progress",
      }),
    ).rejects.toThrow();

    await changeAssignmentStatus(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      toStatus: "in_progress",
    });
    expect((await row(assignment.id)).status).toBe("in_progress");
    expect(await rowCount(events)).toBe(1);
    expect(await rowCount(auditLog)).toBe(1);
  });
});
