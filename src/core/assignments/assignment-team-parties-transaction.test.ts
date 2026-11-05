import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignmentParties, assignmentTeamMembers, auditLog, events } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createCompany,
  createEmployee,
  createOrganization,
  createTeamMember,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { addParty, removeParty, setTeamMember, updateParty } from "./index";

/*
 * Hendelser og revisjonslogg skrives i samme transaksjon som endringen i teamet og partene
 * (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md 4.8.5).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster
 * bare der testen ber om det. Kaster en av dem, skal endringen ikke finnes.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (aldri et bytte i teamet eller en endret part uten spor).
 */

vi.mock("@/core/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/events")>();
  return { ...actual, recordEvent: vi.fn(actual.recordEvent) };
});

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

const LATER = new Date(TEST_NOW.getTime() + 60 * 60 * 1000);

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
  table: typeof assignmentTeamMembers | typeof assignmentParties | typeof events | typeof auditLog,
) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  const other = await createEmployee(await createUser(), org.id, ["inspector"]);
  return { org, admin, assignment, other };
}

const PARTY = {
  role: "broker",
  name: "Megler Test",
  firmName: "Testmegling AS",
  email: "megler@example.com",
  phone: "00000000",
  receivesReport: true,
  receivesInvoice: false,
  receivesMessages: true,
} as Parameters<typeof addParty>[3];

describe("4.8.5 feiler hendelsen eller loggen, finnes ingen endring", () => {
  it("modulene er pakket inn (ellers tester filen ingenting)", async () => {
    const { org, admin, assignment } = await setup();
    await addParty(admin, org.id, assignment.id, PARTY);
    expect(vi.mocked(recordEvent)).toHaveBeenCalled();
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalled();
  });

  it.each(FAILURES)(
    "setTeamMember ved bytte: %s kaster, den gamle raden er fortsatt aktiv og ingen ny rad finnes",
    async (_name, fail) => {
      const { org, admin, assignment, other } = await setup();
      const active = await createTeamMember(org.id, { assignmentId: assignment.id });
      fail();

      await expect(
        setTeamMember(admin, org.id, assignment.id, {
          teamRole: "responsible",
          employeeId: other.id,
          reason: "Ferie",
          now: LATER,
        }),
      ).rejects.toThrow();

      const rows = await db
        .select()
        .from(assignmentTeamMembers)
        .where(eq(assignmentTeamMembers.assignmentId, assignment.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: active.id, toAt: null, handedOverReason: null });
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );

  it.each(FAILURES)("addParty: %s kaster, og ingen part finnes", async (_name, fail) => {
    const { org, admin, assignment } = await setup();
    fail();

    await expect(addParty(admin, org.id, assignment.id, PARTY)).rejects.toThrow();

    expect(await rowCount(assignmentParties)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it.each(FAILURES)("updateParty: %s kaster, og parten er uendret", async (_name, fail) => {
    const { org, admin, assignment } = await setup();
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
    fail();

    await expect(
      updateParty(admin, org.id, party.id, { ...PARTY, name: "Megler Endret" }),
    ).rejects.toThrow();

    const [row] = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.id, party.id));
    expect(row?.name).toBe("Megler Test");
    expect(row?.rowVersion).toBe(party.rowVersion);
    expect(await rowCount(events)).toBe(0);
  });

  it.each(FAILURES)(
    "removeParty: %s kaster, og parten har deleted_at = null",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });
      fail();

      await expect(removeParty(admin, org.id, party.id)).rejects.toThrow();

      const [row] = await db
        .select()
        .from(assignmentParties)
        .where(eq(assignmentParties.id, party.id));
      expect(row?.deletedAt).toBeNull();
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );
});

/*
 * Utstedende selskap (docs/agenter/oppgaver/fase2a-utstedende-selskap-testplan.md 3.5): kaster
 * hendelsen `assignment.company_changed` eller revisjonsloggen for oppdraget, rulles hele byttet
 * tilbake. Viser at selskapet skrives i samme transaksjon som teamet.
 */
describe("3.5 feiler hendelsen eller loggen for selskapet, rulles hele byttet tilbake", () => {
  const actualEvents = vi.importActual<typeof import("@/core/events")>("@/core/events");
  const actualAudit = vi.importActual<typeof import("@/core/audit")>("@/core/audit");

  async function failOnCompanyEvent() {
    const actual = (await actualEvents).recordEvent;
    vi.mocked(recordEvent).mockImplementation(async (...args) => {
      if ((args[2] as { type?: string }).type === "assignment.company_changed") {
        throw new Error("hendelsen for selskapet feilet (test)");
      }
      return actual(...args);
    });
  }

  async function failOnAssignmentAudit() {
    const actual = (await actualAudit).recordAuditEvent;
    vi.mocked(recordAuditEvent).mockImplementation(async (...args) => {
      if ((args[2] as { entityType?: string }).entityType === "assignment") {
        throw new Error("revisjonsloggen for oppdraget feilet (test)");
      }
      return actual(...args);
    });
  }

  afterEach(async () => {
    vi.mocked(recordEvent).mockImplementation((await actualEvents).recordEvent);
    vi.mocked(recordAuditEvent).mockImplementation((await actualAudit).recordAuditEvent);
  });

  async function companyIdOf(assignmentId: string): Promise<string | null> {
    const rows = (await db.execute(
      sql`select company_id from assignments where id = ${assignmentId}`,
    )) as unknown as { company_id: string | null }[];
    return rows[0]!.company_id;
  }

  it.each([
    ["recordEvent (assignment.company_changed)", failOnCompanyEvent],
    ["recordAuditEvent (entityType assignment)", failOnAssignmentAudit],
  ] as const)(
    "%s kaster: ingen ny teamrad, den gamle er aktiv, company_id uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      const a1 = await createCompany(org.id, { legalName: "Selskap A1 AS" });
      const a2 = await createCompany(org.id, { legalName: "Selskap A2 AS" });
      const first = await createEmployee(
        await createUser({ name: "Rita Ansvarlig" }),
        org.id,
        ["inspector"],
        { companyId: a1.id },
      );
      const second = await createEmployee(
        await createUser({ name: "Randi Ansvarlig" }),
        org.id,
        ["inspector"],
        { companyId: a2.id },
      );
      const active = await createTeamMember(org.id, {
        assignmentId: assignment.id,
        employeeId: first.id,
      });
      await db.execute(
        sql`update assignments set company_id = ${a1.id} where id = ${assignment.id}`,
      );
      await fail();

      await expect(
        setTeamMember(admin, org.id, assignment.id, {
          teamRole: "responsible",
          employeeId: second.id,
          reason: "Ferie",
          now: LATER,
        }),
      ).rejects.toThrow();

      const rows = await db
        .select()
        .from(assignmentTeamMembers)
        .where(eq(assignmentTeamMembers.assignmentId, assignment.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: active.id, toAt: null, handedOverReason: null });
      expect(await companyIdOf(assignment.id)).toBe(a1.id);
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );
});
