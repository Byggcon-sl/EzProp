import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { assignments, organizations } from "@/db/schema";
import {
  auditRows,
  createAssignment,
  createEmployee,
  createOrder,
  createOrganization,
  createProperty,
  createTeamMember,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  countWorkQueueByStatus,
  isOverdue,
  listWorkQueue,
  parseWorkQueueParams,
  setAssignmentSchedule,
  updateAssignmentNote,
} from "./index";

/*
 * Utviklerens egne tester for kjernen i arbeidskøen (spørringer, endringer og isolasjon). Den
 * fulle testplanen (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 1 og 2) skrives av
 * testskriveren i egne filer. Oppdiktede data.
 *
 * Støtter hovedmål: tid (køen og søket) og reklamasjoner (frister og befaring synlige).
 */

beforeEach(resetDatabase);

const ALL = { mineOnly: false, query: "" };

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

describe("rene hjelpere", () => {
  it("isOverdue regner dagen i norsk tid", () => {
    const due = { dueDate: "2026-11-04", status: "in_progress" };
    expect(isOverdue(due, new Date("2026-11-04T22:59:59Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-11-04T23:00:00Z"))).toBe(true);
    expect(isOverdue({ ...due, status: "completed" }, new Date("2026-11-10T12:00:00Z"))).toBe(
      false,
    );
  });

  it("parseWorkQueueParams gir standard ved ugyldige verdier", () => {
    expect(parseWorkQueueParams({})).toEqual({
      status: "in_progress",
      mineOnly: true,
      query: "",
    });
    expect(
      parseWorkQueueParams({ status: "cancelled", mine: "0", q: `  ${"x".repeat(150)} ` }),
    ).toEqual({ status: "in_progress", mineOnly: false, query: "x".repeat(100) });
    expect(parseWorkQueueParams({ status: ["ordered", "completed"], mine: ["0", "0"] })).toEqual({
      status: "in_progress",
      mineOnly: true,
      query: "",
    });
  });
});

describe("listWorkQueue og countWorkQueueByStatus", () => {
  it("teller per status, skjuler kansellerte og sorterer etter nærmeste dato", async () => {
    const { org, admin } = await orgWithAdmin();
    const a1 = await createAssignment(org.id, { status: "in_progress", number: "2026-00001" });
    const a2 = await createAssignment(org.id, { status: "in_progress", number: "2026-00002" });
    const later = await createAssignment(org.id, {
      status: "in_progress",
      number: "2026-00003",
      inspectionAt: new Date("2026-11-10T08:00:00Z"),
    });
    const soon = await createAssignment(org.id, {
      status: "in_progress",
      number: "2026-00004",
      dueDate: "2026-11-05",
    });
    await createAssignment(org.id, { status: "ordered" });
    await createAssignment(org.id, { status: "in_progress", deletedAt: new Date() });

    const counts = await countWorkQueueByStatus(admin, org.id, ALL);
    expect(counts).toEqual({ ordered: 1, in_progress: 4, completed: 0, invoiced: 0 });

    const { items, total } = await listWorkQueue(admin, org.id, { ...ALL, status: "in_progress" });
    expect(total).toBe(4);
    expect(items.map((item) => item.id)).toEqual([soon.id, later.id, a2.id, a1.id]);
    expect(Object.keys(items[0]!).sort()).toEqual(
      [
        "address",
        "corrected",
        "dueDate",
        "id",
        "inspectionAt",
        "internalNote",
        "number",
        "responsibleName",
        "status",
      ].sort(),
    );
  });

  it("viser eiendommens adresse før ordrens, og søker med %, _ og store bokstaver som vanlige tegn", async () => {
    const { org, admin } = await orgWithAdmin();
    const withProperty = await createAssignment(org.id, { status: "in_progress" });
    await createProperty(org.id, { assignmentId: withProperty.id, address: "Fjordgata 1" });
    await createOrder(org.id, {
      status: "converted",
      assignmentId: withProperty.id,
      addressText: "Testveien 12, 8000 Bodø",
    });
    const withOrder = await createAssignment(org.id, { status: "in_progress" });
    await createOrder(org.id, {
      status: "converted",
      assignmentId: withOrder.id,
      addressText: "Storgata 100% 8000 Bodø",
    });

    const all = await listWorkQueue(admin, org.id, { ...ALL, status: "in_progress" });
    const byId = new Map(all.items.map((item) => [item.id, item.address]));
    expect(byId.get(withProperty.id)).toBe("Fjordgata 1");
    expect(byId.get(withOrder.id)).toBe("Storgata 100% 8000 Bodø");

    const search = async (query: string) =>
      (
        await listWorkQueue(admin, org.id, { status: "in_progress", mineOnly: false, query })
      ).items.map((item) => item.id);
    expect(await search("fjordGATA")).toEqual([withProperty.id]);
    expect(await search("%")).toEqual([withOrder.id]);
    expect(await search("_")).toEqual([]);
    expect(await search("BODØ")).toEqual([withOrder.id]);
    expect(await search(withOrder.number.slice(-3))).toEqual([withOrder.id]);
  });

  it("«Mine» tar med alle roller i aktivt team, uten dubletter, og ikke slettede rader", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const mine = await createAssignment(org.id, { status: "in_progress" });
    await createTeamMember(org.id, {
      assignmentId: mine.id,
      employeeId: adminEmployee.id,
      teamRole: "inspector",
    });
    await createTeamMember(org.id, {
      assignmentId: mine.id,
      employeeId: adminEmployee.id,
      teamRole: "peer_reviewer",
    });
    const deleted = await createAssignment(org.id, { status: "in_progress" });
    await createTeamMember(org.id, {
      assignmentId: deleted.id,
      employeeId: adminEmployee.id,
      deletedAt: new Date(),
    });
    await createAssignment(org.id, { status: "in_progress" });

    const result = await listWorkQueue(admin, org.id, {
      status: "in_progress",
      mineOnly: true,
      query: "",
    });
    expect(result.items.map((item) => item.id)).toEqual([mine.id]);
    expect(result.total).toBe(1);
    expect((await countWorkQueueByStatus(admin, org.id, ALL)).in_progress).toBe(3);
  });

  it("viser aktiv ansvarlig takstmann", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id, { status: "in_progress" });
    const inspector = await createEmployee(await createUser({ name: "Kari Takst" }), org.id, [
      "inspector",
    ]);
    await createTeamMember(org.id, { assignmentId: assignment.id, employeeId: inspector.id });
    const { items } = await listWorkQueue(admin, org.id, { ...ALL, status: "in_progress" });
    expect(items[0]?.responsibleName).toBeTruthy();
  });
});

describe("updateAssignmentNote og setAssignmentSchedule", () => {
  it("lagrer, tømmer og logger notatet; avvist fødselsnummer havner aldri i loggen", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);

    await updateAssignmentNote(admin, org.id, assignment.id, "  Venter på nøkkel ");
    await expect(
      updateAssignmentNote(admin, org.id, assignment.id, "Ring 01019012345"),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      updateAssignmentNote(admin, org.id, assignment.id, "x".repeat(201)),
    ).rejects.toBeInstanceOf(ZodError);
    const cleared = await updateAssignmentNote(admin, org.id, assignment.id, "   ");
    expect(cleared.internalNote).toBeNull();

    const rows = (await auditRows(org.id)).filter((row) => row.entityId === assignment.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.changes)).toEqual(
      expect.arrayContaining([
        { internalNote: { from: null, to: "Venter på nøkkel" } },
        { internalNote: { from: "Venter på nøkkel", to: null } },
      ]),
    );
    expect(JSON.stringify(await auditRows(org.id))).not.toContain("01019012345");
  });

  it("setter og tømmer befaring (norsk tid) og frist", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const set = await setAssignmentSchedule(admin, org.id, assignment.id, {
      inspectionAt: "2026-11-06T09:30",
      dueDate: "2026-11-10",
    });
    expect(set.inspectionAt?.toISOString()).toBe("2026-11-06T08:30:00.000Z");
    expect(set.dueDate).toBe("2026-11-10");
    await expect(
      setAssignmentSchedule(admin, org.id, assignment.id, {
        inspectionAt: "",
        dueDate: "2026-13-40",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    const cleared = await setAssignmentSchedule(admin, org.id, assignment.id, {
      inspectionAt: "",
      dueDate: null,
    });
    expect(cleared).toMatchObject({ inspectionAt: null, dueDate: null });
    const rows = (await auditRows(org.id)).filter((row) => row.entityId === assignment.id);
    expect(rows).toHaveLength(2);
  });

  it("takstmann med innstillingen av kan lese, men ikke endre; admin kan alltid", async () => {
    const { org, admin } = await orgWithAdmin();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const inspector = await createUser({ name: "Test Takstmann" });
    await createEmployee(inspector, org.id, ["inspector"]);
    const assignment = await createAssignment(org.id, { status: "in_progress" });

    await expect(
      listWorkQueue(inspector, org.id, { ...ALL, status: "in_progress" }),
    ).resolves.toBeTruthy();
    await expect(
      updateAssignmentNote(inspector, org.id, assignment.id, "Notat"),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      setAssignmentSchedule(inspector, org.id, assignment.id, {
        inspectionAt: null,
        dueDate: "2026-11-10",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateAssignmentNote(admin, org.id, assignment.id, "Notat")).resolves.toBeTruthy();
  });

  it("kansellert, ukjent og ugyldig id gir AccessDeniedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const cancelled = await createAssignment(org.id, { deletedAt: new Date() });
    for (const id of [cancelled.id, randomUUID(), "ikke-en-id"]) {
      await expect(updateAssignmentNote(admin, org.id, id, "Notat")).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(
        setAssignmentSchedule(admin, org.id, id, { inspectionAt: null, dueDate: null }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect(await auditRows(org.id)).toHaveLength(0);
  });
});

describe("tenant-isolasjon", () => {
  async function seedInProgress(organizationId: string, employeeId: string) {
    const assignment = await createAssignment(organizationId, { status: "in_progress" });
    await createTeamMember(organizationId, { assignmentId: assignment.id, employeeId });
    return assignment.id;
  }

  it.each([false, true])("listWorkQueue (mineOnly = %s)", async (mineOnly) => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [await seedInProgress(grantA.organizationId, grantA.employeeId)],
        b: [await seedInProgress(grantB.organizationId, grantB.employeeId)],
      }),
      query: async (actor, organizationId) =>
        (await listWorkQueue(actor, organizationId, { status: "in_progress", mineOnly, query: "" }))
          .items,
      idOf: (row) => row.id,
    });
  });

  it("updateAssignmentNote", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        ids.set(grantA.organizationId, a.id).set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await updateAssignmentNote(actor, organizationId, ids.get(organizationId) ?? "", "Notat"),
      ],
      idOf: (row) => row.id,
    });
  });

  it("setAssignmentSchedule", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        ids.set(grantA.organizationId, a.id).set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await setAssignmentSchedule(actor, organizationId, ids.get(organizationId) ?? "", {
          inspectionAt: null,
          dueDate: "2026-11-10",
        }),
      ],
      idOf: (row) => row.id,
    });
  });

  it("countWorkQueueByStatus gir 0 i den andre organisasjonen og nekter fremmed id", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin();
    const { org: orgB, admin: adminB } = await orgWithAdmin();
    for (const status of ["ordered", "in_progress", "completed", "invoiced"] as const) {
      await createAssignment(orgA.id, { status });
    }
    expect(await countWorkQueueByStatus(adminB, orgB.id, ALL)).toEqual({
      ordered: 0,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
    });
    await expect(countWorkQueueByStatus(adminA, orgB.id, ALL)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("fremmed oppdrags-id (IDOR) gir AccessDeniedError og lar raden stå", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin();
    const { org: orgB } = await orgWithAdmin();
    const foreign = await createAssignment(orgB.id, { internalNote: "Uendret" });
    await expect(
      updateAssignmentNote(adminA, orgA.id, foreign.id, "Endret"),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      setAssignmentSchedule(adminA, orgA.id, foreign.id, {
        inspectionAt: null,
        dueDate: "2026-11-10",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const [row] = await db.select().from(assignments).where(eq(assignments.id, foreign.id));
    expect(row).toMatchObject({ internalNote: "Uendret", dueDate: null, inspectionAt: null });
    expect(row?.updatedAt.getTime()).toBe(foreign.updatedAt.getTime());
    expect(await auditRows(orgB.id)).toHaveLength(0);
  });
});
