import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import type { FileStorage } from "@/core/files";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  certifications,
  companies,
  employeePermissions,
  employeeRoleAssignments,
  employees,
  files,
  integrationConnections,
  numberSequences,
  offices,
  orders,
  organizations,
  users,
  type EmployeeRole,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";

/**
 * Tabellene `resetDatabase` tømmer. Ny tabell? Legg den til her. `tests/factories.test.ts`
 * sjekker at alle tabellene i databasen står i listen.
 */
export const RESET_TABLES = [
  "number_sequences",
  "orders",
  "assignments",
  "certifications",
  "trial_photos",
  "trial_answers",
  "trial_forms",
  "audit_log",
  "events",
  "employee_permissions",
  "employee_roles",
  "employees",
  "companies",
  "offices",
  "files",
  "integration_connections",
  "organizations",
  "sessions",
  "accounts",
  "verifications",
  "login_attempts",
  "users",
] as const;

/** Tømmer alle tabeller i testdatabasen. */
export async function resetDatabase() {
  await db.execute(sql.raw(`truncate table ${RESET_TABLES.join(", ")} restart identity cascade`));
}

/** En innlogging (Better Auth-bruker). Oppdiktet e-post. */
export async function createUser(
  overrides: { name?: string; email?: string } = {},
): Promise<Actor> {
  const id = randomUUID();
  const actor: Actor = {
    id,
    name: overrides.name ?? "Test Takstmann",
    email: overrides.email ?? `${id}@example.com`,
  };
  await db.insert(users).values(actor);
  return actor;
}

export async function createOrganization(name = "Testfirma takst") {
  const [organization] = await db
    .insert(organizations)
    .values({ name, brandName: name })
    .returning();
  if (!organization) throw new Error("kunne ikke opprette organisasjon");
  return organization;
}

type CompanyOverrides = Partial<Omit<typeof companies.$inferInsert, "organizationId">>;
type OfficeOverrides = Partial<Omit<typeof offices.$inferInsert, "organizationId">>;

/**
 * Et selskap i organisasjonen. Oppdiktet navn; org.nr. og forsikring er tomme med mindre
 * testen ber om dem (org.nr. er unikt blant aktive per organisasjon).
 */
export async function createCompany(organizationId: string, overrides: CompanyOverrides = {}) {
  const [company] = await db
    .insert(companies)
    .values({ legalName: "Testselskap A AS", orgNumber: null, ...overrides, organizationId })
    .returning();
  if (!company) throw new Error("kunne ikke opprette selskap");
  return company;
}

let officeCounter = 0;

/** Et kontor i organisasjonen. Standardnavnet får et løpenummer, fordi navnet er unikt blant aktive. */
export async function createOffice(organizationId: string, overrides: OfficeOverrides = {}) {
  officeCounter += 1;
  const [office] = await db
    .insert(offices)
    .values({ name: `Testkontor Nord ${officeCounter}`, ...overrides, organizationId })
    .returning();
  if (!office) throw new Error("kunne ikke opprette kontor");
  return office;
}

/** Ansetter personen i organisasjonen med rollene, eventuelt i et selskap og på et kontor. */
export async function createEmployee(
  actor: Actor,
  organizationId: string,
  roles: EmployeeRole[],
  options: { companyId?: string; officeId?: string } = {},
) {
  const [employee] = await db
    .insert(employees)
    .values({
      organizationId,
      userId: actor.id,
      name: actor.name,
      createdBy: actor.id,
      companyId: options.companyId ?? null,
      officeId: options.officeId ?? null,
    })
    .returning();
  if (!employee) throw new Error("kunne ikke opprette ansatt");
  if (roles.length > 0) {
    await db
      .insert(employeeRoleAssignments)
      .values(roles.map((role) => ({ organizationId, employeeId: employee.id, role })));
  }
  return employee;
}

/**
 * Gir den ansatte én enkeltrettighet (som admin gjør). Tar fri tekst, slik at tester kan sette
 * inn ukjente navn og vise at de ikke gir tilgang. `createdBy` er bruker-id-en til den som ga
 * rettigheten (admin), som i `createEmployee`.
 */
export async function grantPermission(
  employee: { id: string; organizationId: string },
  permission: string,
  createdBy: string | null = null,
) {
  const [row] = await db
    .insert(employeePermissions)
    .values({
      organizationId: employee.organizationId,
      employeeId: employee.id,
      permission,
      createdBy,
    })
    .returning();
  if (!row) throw new Error("kunne ikke gi enkeltrettighet");
  return row;
}

type FileOverrides = {
  kind?: string;
  mimeType?: string;
  retainUntil?: Date | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  storageKey?: string;
  sha256?: string;
};

/**
 * En fil-rad i den felles filtjenesten, satt inn direkte uten tilgangssjekk. Nøkkelen er
 * `<organizationId>/<kind>/<id>` som i tjenesten. Med `storage` skrives også innholdet via
 * porten, og `sha256`/`size_bytes` regnes av innholdet. Standardinnholdet er oppdiktede byte.
 */
export async function createFile(
  organizationId: string,
  overrides: FileOverrides = {},
  options: { storage?: FileStorage; bytes?: Uint8Array } = {},
) {
  const id = randomUUID();
  const kind = overrides.kind ?? "photo";
  const mimeType = overrides.mimeType ?? (kind === "report_pdf" ? "application/pdf" : "image/jpeg");
  const bytes = options.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20, 0x30]);
  const storageKey = overrides.storageKey ?? `${organizationId}/${kind}/${id}`;
  if (options.storage) await options.storage.put(storageKey, bytes, mimeType);
  const [row] = await db
    .insert(files)
    .values({
      id,
      organizationId,
      storageKey,
      kind,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256: overrides.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
      retainUntil: overrides.retainUntil ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette fil");
  return row;
}

type ConnectionInsert = typeof integrationConnections.$inferInsert;

type IntegrationConnectionOverrides = {
  port?: string;
  provider?: string;
  status?: string;
  secretRef?: string | null;
  settings?: Record<string, unknown>;
  lastOkAt?: Date | null;
  lastError?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * En tilkobling (`integration_connections`), satt inn rått uten tilgangssjekk og uten
 * validering, slik at testene kan lage rader tjenesten ville avvist (ukjent leverandør, ugyldige
 * `settings`, dubletter). Standard er e-post via serverloggen, aktiv, tomme `settings`.
 */
export async function createIntegrationConnection(
  organizationId: string,
  overrides: IntegrationConnectionOverrides = {},
) {
  const [row] = await db
    .insert(integrationConnections)
    .values({
      organizationId,
      // Rå tekst: fabrikken skal kunne lage ukjente koder (typene i skjemaet kan være smalere)
      port: (overrides.port ?? "email") as ConnectionInsert["port"],
      provider: (overrides.provider ?? "server_log") as ConnectionInsert["provider"],
      status: (overrides.status ?? "active") as ConnectionInsert["status"],
      secretRef: overrides.secretRef ?? null,
      settings: overrides.settings ?? {},
      lastOkAt: overrides.lastOkAt ?? null,
      lastError: overrides.lastError ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette tilkobling");
  return row;
}

/** Samme dato ett år frem («ÅÅÅÅ-MM-DD»). 29. februar blir 1. mars. */
function oneYearAfter(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year + 1, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * En sertifisering for den ansatte, satt inn direkte. Standard er gyldig i ett år fra i dag
 * (norsk tid), området `condition_report`. Overstyringene brukes til grensesaker og til å vise at
 * databasen avviser fremmede ansatte. Nummer og utsteder er oppdiktet.
 */
export async function createCertification(
  employee: { id: string; organizationId: string },
  overrides: {
    organizationId?: string;
    employeeId?: string;
    validFrom?: string | null;
    validTo?: string;
    area?: string;
    deletedAt?: Date | null;
    issuer?: string | null;
    certificateNumber?: string | null;
  } = {},
) {
  const today = todayInOslo();
  const [row] = await db
    .insert(certifications)
    .values({
      organizationId: overrides.organizationId ?? employee.organizationId,
      employeeId: overrides.employeeId ?? employee.id,
      area: overrides.area ?? "condition_report",
      issuer: overrides.issuer === undefined ? null : overrides.issuer,
      certificateNumber:
        overrides.certificateNumber === undefined ? null : overrides.certificateNumber,
      validFrom: overrides.validFrom === undefined ? today : overrides.validFrom,
      validTo: overrides.validTo ?? oneYearAfter(today),
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette sertifisering");
  return row;
}

/**
 * Antall aktive admin i organisasjonen, etter definisjonen i
 * docs/funksjoner/fase0b-admin-organisasjon.md (Omfang 4): rollen `admin` uten `deleted_at`, og
 * ansatt-raden har `deleted_at`, `deactivated_at` tomme og `user_id` satt.
 */
export async function activeAdminCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeeRoleAssignments)
    .innerJoin(employees, eq(employees.id, employeeRoleAssignments.employeeId))
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, organizationId),
        eq(employees.organizationId, organizationId),
        eq(employeeRoleAssignments.role, "admin"),
        isNull(employeeRoleAssignments.deletedAt),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        isNotNull(employees.userId),
      ),
    );
  return row?.count ?? 0;
}

/** Radene i revisjonsloggen for organisasjonen, eldste først. */
export async function auditRows(organizationId: string) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
}

/**
 * Fast tid i ordretestene (docs/funksjoner/fase2a-manuell-ordre-testplan.md): 03.11.2026 kl. 11
 * i Oslo. `createOrder` bruker den som standard for `receivedAt`.
 */
export const TEST_NOW = new Date("2026-11-03T10:00:00Z");

type OrderInsert = typeof orders.$inferInsert;
type OrderOverrides = Partial<Omit<OrderInsert, "organizationId">>;

/**
 * En ordre satt inn direkte uten tilgangssjekk og uten Zod, slik at testene kan lage rader
 * tjenesten ville avvist. Standard: mottatt, lagt inn for hånd, oppdiktet adresse,
 * `receivedAt = TEST_NOW`. For `converted` må testen sende med `assignmentId` (CHECK i databasen).
 */
export async function createOrder(organizationId: string, overrides: OrderOverrides = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      addressText: "Testveien 12, 8000 Bodø",
      receivedAt: TEST_NOW,
      source: "manual",
      status: "received",
      requestedReportType: "condition_report",
      ...overrides,
      organizationId,
    } as OrderInsert)
    .returning();
  if (!row) throw new Error("kunne ikke opprette ordre");
  return row;
}

type AssignmentInsert = typeof assignments.$inferInsert;
type AssignmentOverrides = Partial<Omit<AssignmentInsert, "organizationId">>;

let assignmentCounter = 0;

/**
 * Et oppdrag satt inn direkte. Lager et kontor i samme organisasjon når `officeId` mangler.
 * Nummeret kommer fra en egen teller (`TEST-00001`, `TEST-00002` …), aldri fra nummerserien, så
 * fabrikken ikke rører `number_sequences`.
 */
export async function createAssignment(
  organizationId: string,
  overrides: AssignmentOverrides = {},
) {
  assignmentCounter += 1;
  const officeId = overrides.officeId ?? (await createOffice(organizationId)).id;
  const [row] = await db
    .insert(assignments)
    .values({
      number: `TEST-${String(assignmentCounter).padStart(5, "0")}`,
      assignmentType: "condition_report",
      status: "ordered",
      ...overrides,
      officeId,
      organizationId,
    } as AssignmentInsert)
    .returning();
  if (!row) throw new Error("kunne ikke opprette oppdrag");
  return row;
}

type NumberSequenceInsert = typeof numberSequences.$inferInsert;
type NumberSequenceOverrides = Partial<Omit<NumberSequenceInsert, "organizationId">>;

/** En nummerserie satt inn direkte. Standard: oppdrag, `2026-`, neste verdi 1, fem sifre. */
export async function createNumberSequence(
  organizationId: string,
  overrides: NumberSequenceOverrides = {},
) {
  const [row] = await db
    .insert(numberSequences)
    .values({
      scope: "assignment",
      prefix: "2026-",
      nextValue: 1,
      padding: 5,
      ...overrides,
      organizationId,
    } as NumberSequenceInsert)
    .returning();
  if (!row) throw new Error("kunne ikke opprette nummerserie");
  return row;
}
