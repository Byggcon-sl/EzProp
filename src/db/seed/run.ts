import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employeeRoleAssignments, employees, organizations, users } from "@/db/schema";
import { brand } from "@/shared/config/brand";

/**
 * Grunndata (trygt å kjøre flere ganger):
 * - organisasjonen Byggcon (én rad, docs/05-domenemodell.md 4.1)
 * - første admin (SEED_ADMIN_EMAIL) som ansatt med rollen admin
 * Ingen kundeopplysninger, ingen eksempeloppdrag. Selskaper og kontorer kommer i fase 0b.
 */
export async function runSeed(env: Record<string, string | undefined> = process.env) {
  const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) throw new Error("SEED_ADMIN_EMAIL mangler");
  const adminName = env.SEED_ADMIN_NAME?.trim() || `${brand.companyName} Admin`;

  let [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, brand.companyName));
  if (!organization) {
    [organization] = await db
      .insert(organizations)
      .values({ name: brand.companyName, brandName: brand.companyName })
      .returning();
    console.log(`Organisasjon: ${brand.companyName}`);
  }
  if (!organization) throw new Error("kunne ikke opprette organisasjonen");

  await db
    .insert(users)
    .values({ id: randomUUID(), email: adminEmail, name: adminName })
    .onConflictDoNothing({ target: users.email });
  const [user] = await db.select().from(users).where(eq(users.email, adminEmail));
  if (!user) throw new Error("kunne ikke opprette admin");

  let [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.userId, user.id), eq(employees.organizationId, organization.id)));
  if (!employee) {
    [employee] = await db
      .insert(employees)
      .values({ organizationId: organization.id, userId: user.id, name: user.name })
      .returning();
  }
  if (!employee) throw new Error("kunne ikke opprette ansatt");
  await db
    .insert(employeeRoleAssignments)
    .values({ organizationId: organization.id, employeeId: employee.id, role: "admin" })
    .onConflictDoNothing();
  console.log(`Admin: ${adminEmail}`);
}
