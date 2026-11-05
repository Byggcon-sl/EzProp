import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import type { FileStorage } from "@/core/files";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
  cadastralUnits,
  certifications,
  commonAreas,
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
  properties,
  users,
  type EmployeeRole,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";

/**
 * Tabellene `resetDatabase` tømmer. Ny tabell? Legg den til her. `tests/factories.test.ts`
 * sjekker at alle tabellene i databasen står i listen.
 */
export const RESET_TABLES = [
  "rooms",
  "floor_areas",
  "floors",
  "report_buildings",
  "number_sequences",
  "orders",
  "common_areas",
  "cadastral_units",
  "assignment_team_members",
  "assignment_parties",
  "assignments",
  "properties",
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

type TeamMemberOverrides = {
  assignmentId?: string;
  employeeId?: string;
  teamRole?: string;
  fromAt?: Date;
  toAt?: Date | null;
  handedOverReason?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * En rad i teamet på oppdraget (`assignment_team_members`), satt inn direkte uten tilgangssjekk.
 * Standard: aktiv `responsible` fra `TEST_NOW`. Lager oppdrag og ansatt (rolle takstmann,
 * oppdiktet navn) i samme organisasjon når de mangler. `teamRole` er fri tekst, så testene kan
 * vise at databasen avviser ukjente koder.
 */
export async function createTeamMember(
  organizationId: string,
  overrides: TeamMemberOverrides = {},
) {
  const assignmentId = overrides.assignmentId ?? (await createAssignment(organizationId)).id;
  const employeeId =
    overrides.employeeId ??
    (
      await createEmployee(await createUser({ name: "Test Teammedlem" }), organizationId, [
        "inspector",
      ])
    ).id;
  const [row] = await db
    .insert(assignmentTeamMembers)
    .values({
      organizationId,
      assignmentId,
      employeeId,
      teamRole: (overrides.teamRole ??
        "responsible") as typeof assignmentTeamMembers.$inferInsert.teamRole,
      fromAt: overrides.fromAt ?? TEST_NOW,
      toAt: overrides.toAt ?? null,
      handedOverReason: overrides.handedOverReason ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette teamrad");
  return row;
}

type PartyOverrides = {
  assignmentId?: string;
  role?: string;
  name?: string;
  firmName?: string | null;
  email?: string | null;
  phone?: string | null;
  receivesReport?: boolean;
  receivesInvoice?: boolean;
  receivesMessages?: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * En part på oppdraget (`assignment_parties`), satt inn direkte uten tilgangssjekk og uten Zod.
 * Standard: megler «Megler Test» uten firma, e-post og telefon, og alle tre «mottar» = `false`
 * (fast, ikke etter `defaultReceives`, så testene ser hva de selv setter). Lager oppdraget i
 * samme organisasjon når det mangler. Oppdiktede data.
 */
export async function createAssignmentParty(
  organizationId: string,
  overrides: PartyOverrides = {},
) {
  const assignmentId = overrides.assignmentId ?? (await createAssignment(organizationId)).id;
  const [row] = await db
    .insert(assignmentParties)
    .values({
      organizationId,
      assignmentId,
      role: (overrides.role ?? "broker") as typeof assignmentParties.$inferInsert.role,
      name: overrides.name ?? "Megler Test",
      firmName: overrides.firmName ?? null,
      email: overrides.email ?? null,
      phone: overrides.phone ?? null,
      receivesReport: overrides.receivesReport ?? false,
      receivesInvoice: overrides.receivesInvoice ?? false,
      receivesMessages: overrides.receivesMessages ?? false,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette part");
  return row;
}

type PropertyOverrides = {
  /** Oppdraget som skal peke på eiendommen (`assignments.property_id`). */
  assignmentId?: string;
  address?: string;
  postalCode?: string | null;
  city?: string | null;
  municipalityNumber?: string | null;
  municipalityName?: string | null;
  housingType?: string;
  ownershipForm?: string;
  dataSource?: string;
  gnr?: string;
  bnr?: string;
  fnr?: string | null;
  snr?: string | null;
  associationName?: string | null;
  associationOrgNumber?: string | null;
  shareNumber?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * En eiendom (`properties`) med én matrikkelrad (`cadastral_units`), satt inn direkte uten
 * tilgangssjekk og uten Zod. Standard: enebolig, selveier, «Testveien 1», lagt inn for hånd,
 * gnr/bnr 999. Med `assignmentId` settes `assignments.property_id` på oppdraget. Kodene er fri
 * tekst, så testene kan vise at databasen avviser ukjente koder. Oppdiktede data.
 */
export async function createProperty(organizationId: string, overrides: PropertyOverrides = {}) {
  const [property] = await db
    .insert(properties)
    .values({
      organizationId,
      address: overrides.address ?? "Testveien 1",
      postalCode: overrides.postalCode ?? null,
      city: overrides.city ?? null,
      municipalityNumber: overrides.municipalityNumber ?? null,
      municipalityName: overrides.municipalityName ?? null,
      housingType: (overrides.housingType ??
        "detached") as typeof properties.$inferInsert.housingType,
      ownershipForm: (overrides.ownershipForm ??
        "freehold") as typeof properties.$inferInsert.ownershipForm,
      dataSource: (overrides.dataSource ?? "manual") as typeof properties.$inferInsert.dataSource,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!property) throw new Error("kunne ikke opprette eiendom");
  const [cadastralUnit] = await db
    .insert(cadastralUnits)
    .values({
      organizationId,
      propertyId: property.id,
      gnr: overrides.gnr ?? "999",
      bnr: overrides.bnr ?? "999",
      fnr: overrides.fnr ?? null,
      snr: overrides.snr ?? null,
      associationName: overrides.associationName ?? null,
      associationOrgNumber: overrides.associationOrgNumber ?? null,
      shareNumber: overrides.shareNumber ?? null,
    })
    .returning();
  if (!cadastralUnit) throw new Error("kunne ikke opprette matrikkelrad");
  if (overrides.assignmentId) {
    await db
      .update(assignments)
      .set({ propertyId: property.id })
      .where(
        and(
          eq(assignments.id, overrides.assignmentId),
          eq(assignments.organizationId, organizationId),
        ),
      );
  }
  return { property, cadastralUnit };
}

type CommonAreasOverrides = {
  assignmentId?: string;
  managingAgent?: string | null;
  conditionReportStatus?: string;
  maintenancePlanStatus?: string;
  notes?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * Fellesdelene på et oppdrag (`common_areas`), satt inn direkte uten tilgangssjekk og uten Zod.
 * Uten `assignmentId` lages et oppdrag med en leilighet i borettslag i samme organisasjon.
 * Standard: ingen forretningsfører, ingen notater, «vet ikke» på begge spørsmålene. Kodene er
 * fri tekst, så testene kan vise at databasen avviser ukjente koder. Oppdiktede data.
 */
export async function createCommonAreas(
  organizationId: string,
  overrides: CommonAreasOverrides = {},
) {
  let assignmentId = overrides.assignmentId;
  if (!assignmentId) {
    assignmentId = (await createAssignment(organizationId)).id;
    await createProperty(organizationId, {
      assignmentId,
      housingType: "apartment",
      ownershipForm: "cooperative",
      associationName: "Borettslaget Test",
    });
  }
  type CommonAreasInsert = typeof commonAreas.$inferInsert;
  const [row] = await db
    .insert(commonAreas)
    .values({
      organizationId,
      assignmentId,
      managingAgent: overrides.managingAgent ?? null,
      conditionReportStatus: (overrides.conditionReportStatus ??
        "unknown") as CommonAreasInsert["conditionReportStatus"],
      maintenancePlanStatus: (overrides.maintenancePlanStatus ??
        "unknown") as CommonAreasInsert["maintenancePlanStatus"],
      notes: overrides.notes ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette fellesdeler");
  return row;
}

// --- Bygninger, etasjer, areal og rom (docs/funksjoner/fase2a-bygninger-areal-rom.md) ---------

/*
 * Fabrikkene under setter inn med SQL mot kolonnenavnene i kortet (punkt 1–4), uten
 * tilgangssjekk og uten Zod, slik at testene kan lage rader tjenesten ville avvist (ukjente
 * koder, rader i en annen organisasjon). Mangler forelderen, lages den i samme organisasjon.
 * Raden gis tilbake med feltnavn i camelCase; arealtallene som tall (eller `null`).
 */

type DbRow = Record<string, unknown>;

function firstRowOf(result: unknown, table: string): DbRow {
  const [row] = result as DbRow[];
  if (!row) throw new Error(`kunne ikke opprette rad i ${table}`);
  return row;
}

type BaseRow = {
  id: string;
  organizationId: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  rowVersion: number;
};

function baseOf(row: DbRow): BaseRow {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    createdAt: new Date(row.created_at as string | Date),
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: new Date(row.updated_at as string | Date),
    updatedBy: (row.updated_by as string | null) ?? null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string | Date) : null,
    deletedBy: (row.deleted_by as string | null) ?? null,
    rowVersion: Number(row.row_version),
  };
}

/** Tidspunkt som tekst til SQL (postgres-js tar ikke `Date` i rå spørringer). */
function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export type TestBuilding = BaseRow & { assignmentId: string; name: string };

type BuildingOverrides = {
  /** Oppdraget. Mangler det, lages et oppdrag med eiendom i organisasjonen. */
  assignmentId?: string;
  name?: string;
  createdAt?: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/** En bygning (`report_buildings`). Standard: «Bolighus» på et nytt oppdrag med eiendom. */
export async function createBuilding(
  organizationId: string,
  overrides: BuildingOverrides = {},
): Promise<TestBuilding> {
  let assignmentId = overrides.assignmentId;
  if (!assignmentId) {
    assignmentId = (await createAssignment(organizationId)).id;
    await createProperty(organizationId, { assignmentId });
  }
  const row = firstRowOf(
    await db.execute(sql`
      insert into report_buildings (organization_id, assignment_id, name, created_at, deleted_at, deleted_by)
      values (${organizationId}, ${assignmentId}, ${overrides.name ?? "Bolighus"},
        ${(overrides.createdAt ?? new Date()).toISOString()}::timestamptz, ${isoOrNull(overrides.deletedAt)}::timestamptz, ${overrides.deletedBy ?? null})
      returning *`),
    "report_buildings",
  );
  return { ...baseOf(row), assignmentId: row.assignment_id as string, name: row.name as string };
}

export type TestFloor = BaseRow & {
  reportBuildingId: string;
  name: string;
  level: number;
  belowGround: boolean;
};

type FloorOverrides = {
  buildingId?: string;
  name?: string;
  level?: number;
  belowGround?: boolean;
  createdAt?: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/** En etasje (`floors`). Standard: «1. etasje», nivå 1, over terreng, i en ny bygning. */
export async function createFloor(
  organizationId: string,
  overrides: FloorOverrides = {},
): Promise<TestFloor> {
  const buildingId = overrides.buildingId ?? (await createBuilding(organizationId)).id;
  const row = firstRowOf(
    await db.execute(sql`
      insert into floors (organization_id, report_building_id, name, level, below_ground, created_at, deleted_at, deleted_by)
      values (${organizationId}, ${buildingId}, ${overrides.name ?? "1. etasje"},
        ${overrides.level ?? 1}, ${overrides.belowGround ?? false}, ${(overrides.createdAt ?? new Date()).toISOString()}::timestamptz,
        ${isoOrNull(overrides.deletedAt)}::timestamptz, ${overrides.deletedBy ?? null})
      returning *`),
    "floors",
  );
  return {
    ...baseOf(row),
    reportBuildingId: row.report_building_id as string,
    name: row.name as string,
    level: Number(row.level),
    belowGround: row.below_ground as boolean,
  };
}

export type TestFloorArea = BaseRow & {
  floorId: string;
  braI: number | null;
  braE: number | null;
  braB: number | null;
  alh: number | null;
  measuredBy: string | null;
  method: string | null;
  comment: string | null;
};

type FloorAreaOverrides = {
  floorId?: string;
  braI?: number | string | null;
  braE?: number | string | null;
  braB?: number | string | null;
  alh?: number | string | null;
  /** Ansatt-id (ikke bruker-id). */
  measuredBy?: string | null;
  method?: string | null;
  comment?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/** Arealet på en etasje (`floor_areas`). Standard: alle felt tomme, i en ny etasje. */
export async function createFloorArea(
  organizationId: string,
  overrides: FloorAreaOverrides = {},
): Promise<TestFloorArea> {
  const floorId = overrides.floorId ?? (await createFloor(organizationId)).id;
  const text = (value: number | string | null | undefined) =>
    value === null || value === undefined ? null : String(value);
  const row = firstRowOf(
    await db.execute(sql`
      insert into floor_areas (organization_id, floor_id, bra_i, bra_e, bra_b, alh, measured_by, method, comment, deleted_at, deleted_by)
      values (${organizationId}, ${floorId}, ${text(overrides.braI)}::numeric, ${text(overrides.braE)}::numeric,
        ${text(overrides.braB)}::numeric, ${text(overrides.alh)}::numeric, ${overrides.measuredBy ?? null},
        ${overrides.method ?? null}, ${overrides.comment ?? null}, ${isoOrNull(overrides.deletedAt)}::timestamptz,
        ${overrides.deletedBy ?? null})
      returning *`),
    "floor_areas",
  );
  return {
    ...baseOf(row),
    floorId: row.floor_id as string,
    braI: numberOrNull(row.bra_i),
    braE: numberOrNull(row.bra_e),
    braB: numberOrNull(row.bra_b),
    alh: numberOrNull(row.alh),
    measuredBy: (row.measured_by as string | null) ?? null,
    method: (row.method as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
  };
}

export type TestRoom = BaseRow & {
  floorId: string;
  roomType: string;
  name: string | null;
  areaType: string;
  belowGround: boolean;
};

type RoomOverrides = {
  floorId?: string;
  roomType?: string;
  name?: string | null;
  areaType?: string;
  belowGround?: boolean;
  createdAt?: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/** Et rom (`rooms`). Standard: bad uten navn, BRA-i, over terreng, i en ny etasje. */
export async function createRoom(
  organizationId: string,
  overrides: RoomOverrides = {},
): Promise<TestRoom> {
  const floorId = overrides.floorId ?? (await createFloor(organizationId)).id;
  const row = firstRowOf(
    await db.execute(sql`
      insert into rooms (organization_id, floor_id, room_type, name, area_type, below_ground, created_at, deleted_at, deleted_by)
      values (${organizationId}, ${floorId}, ${overrides.roomType ?? "bathroom"},
        ${overrides.name ?? null}, ${overrides.areaType ?? "bra_i"}, ${overrides.belowGround ?? false},
        ${(overrides.createdAt ?? new Date()).toISOString()}::timestamptz, ${isoOrNull(overrides.deletedAt)}::timestamptz, ${overrides.deletedBy ?? null})
      returning *`),
    "rooms",
  );
  return {
    ...baseOf(row),
    floorId: row.floor_id as string,
    roomType: row.room_type as string,
    name: (row.name as string | null) ?? null,
    areaType: row.area_type as string,
    belowGround: row.below_ground as boolean,
  };
}
