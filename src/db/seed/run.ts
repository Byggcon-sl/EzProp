import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  companies,
  employeeRoleAssignments,
  employees,
  offices,
  organizations,
  users,
} from "@/db/schema";
import { brand } from "@/shared/config/brand";

/**
 * Grunndata (trygt å kjøre flere ganger):
 * - organisasjonen Byggcon (én rad, docs/05-domenemodell.md 4.1)
 * - første admin (SEED_ADMIN_EMAIL) som ansatt med rollen admin
 * - Byggcons selskaper og kontorer, bare navn og rekkefølge (beslutning A16). Org.nr., adresse,
 *   forsikring og firmatekst fylles ut av admin. Admin får ikke selskap eller kontor her.
 * Ingen kundeopplysninger, ingen eksempeloppdrag.
 */
const seedCompanies = [
  "Byggcon AS",
  "Byggcon Nord AS",
  "Byggcon Helgeland AS",
  "Byggcon Troms AS",
] as const;
const seedOffices = ["Bodø", "Mo i Rana", "Mosjøen", "Narvik", "Tromsø"] as const;

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

  const inserted = await db
    .insert(users)
    .values({ id: randomUUID(), email: adminEmail, name: adminName })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
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
  // Adressen skrives aldri ut (serverloggen i drift skal ikke ha personopplysninger)
  console.log(inserted.length > 0 ? "Admin: opprettet" : "Admin: finnes fra før");

  // Selskaper: sjekkes mot alle rader, også slettede, så et slettet selskap aldri lages på nytt
  const existingCompanies = await db
    .select({ legalName: companies.legalName })
    .from(companies)
    .where(eq(companies.organizationId, organization.id));
  const existingNames = new Set(existingCompanies.map((company) => company.legalName));
  const newCompanies = seedCompanies.filter((legalName) => !existingNames.has(legalName));
  if (newCompanies.length > 0) {
    await db
      .insert(companies)
      .values(newCompanies.map((legalName) => ({ organizationId: organization.id, legalName })));
  }
  console.log(`Selskaper: ${newCompanies.length} nye`);

  // Kontorer: sjekkes mot alle rader, også slettede, så et slettet kontor aldri lages på nytt
  const existingOffices = await db
    .select({ name: offices.name })
    .from(offices)
    .where(eq(offices.organizationId, organization.id));
  const existingOfficeNames = new Set(existingOffices.map((office) => office.name));
  const newOffices = seedOffices
    .map((name, index) => ({ organizationId: organization.id, name, sortOrder: index + 1 }))
    .filter((office) => !existingOfficeNames.has(office.name));
  if (newOffices.length > 0) {
    await db.insert(offices).values(newOffices);
  }
  console.log(`Kontorer: ${newOffices.length} nye`);
}
