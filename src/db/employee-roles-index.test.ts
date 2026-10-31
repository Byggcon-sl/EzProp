import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { employeeRoleAssignments } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../tests/factories";

// Den delvise unike indeksen på employee_roles (A27, docs/funksjoner/fase0b-admin-organisasjon.md
// Omfang 5): en rolle kan tas bort med myk sletting og gis på nytt som en ny rad, men samme
// rolle kan aldri være aktiv to ganger. Testplan avsnitt 4.

beforeEach(resetDatabase);

const INDEX = "employee_roles_employee_id_role_idx";

async function inspectorEmployee() {
  const org = await createOrganization();
  const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
  return { org, employee };
}

describe("delvis unik indeks på employee_roles", () => {
  it("godtar en ny rad med samme rolle når den gamle er myk-slettet", async () => {
    const { org, employee } = await inspectorEmployee();
    await db
      .update(employeeRoleAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(employeeRoleAssignments.employeeId, employee.id));

    await db
      .insert(employeeRoleAssignments)
      .values({ organizationId: org.id, employeeId: employee.id, role: "inspector" });

    const rows = await db
      .select()
      .from(employeeRoleAssignments)
      .where(eq(employeeRoleAssignments.employeeId, employee.id));
    expect(rows).toHaveLength(2);
    const active = rows.filter((row) => row.deletedAt === null);
    expect(active).toHaveLength(1);
  });

  it("stopper to aktive rader med samme rolle", async () => {
    const { org, employee } = await inspectorEmployee();

    const error: unknown = await db
      .insert(employeeRoleAssignments)
      .values({ organizationId: org.id, employeeId: employee.id, role: "inspector" })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(Error);
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    expect(cause?.constraint_name).toBe(INDEX);
    const active = await db
      .select()
      .from(employeeRoleAssignments)
      .where(
        and(
          eq(employeeRoleAssignments.employeeId, employee.id),
          isNull(employeeRoleAssignments.deletedAt),
        ),
      );
    expect(active).toHaveLength(1);
  });

  it("indeksen er delvis (bare rader uten deleted_at)", async () => {
    const result = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'employee_roles' and indexname = ${INDEX}`,
    );
    const rows = [...result];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });
});
