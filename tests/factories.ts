import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import type { FileStorage } from "@/core/files";
import type { TemplateDocumentInput } from "@/core/templates";
// Bare testfabrikken bruker denne; den eksporteres ikke fra `@/core/templates`.
import { insertTemplateWithoutAccessCheck } from "@/core/templates/templates";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
  cadastralUnits,
  certifications,
  checkpoints,
  commonAreas,
  companies,
  contacts,
  deviationQuestions,
  employeePermissions,
  employeeRoleAssignments,
  employees,
  files,
  firms,
  integrationConnections,
  numberSequences,
  offices,
  orders,
  organizations,
  outcomes,
  properties,
  ruleConditions,
  rules,
  ruleTestCases,
  standardMeasures,
  templateElementOptions,
  templateElements,
  templateFamilies,
  templateSections,
  templateVersions,
  users,
  workSessions,
  type EmployeeRole,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";

/**
 * Tabellene `resetDatabase` tømmer. Ny tabell? Legg den til her. `tests/factories.test.ts`
 * sjekker at alle tabellene i databasen står i listen.
 */
export const RESET_TABLES = [
  "rule_test_cases",
  "rule_conditions",
  "rules",
  "standard_measures",
  "outcomes",
  "deviation_questions",
  "template_element_options",
  "template_elements",
  "checkpoints",
  "template_sections",
  "template_versions",
  "template_families",
  "work_sessions",
  "rooms",
  "floor_areas",
  "floors",
  "report_buildings",
  "number_sequences",
  "orders",
  "claims",
  "common_areas",
  "cadastral_units",
  "assignment_team_members",
  "assignment_parties",
  "assignments",
  "client_agreements",
  "contacts",
  "firms",
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

type WorkSessionOverrides = {
  assignmentId?: string;
  employeeId?: string;
  phase?: string;
  startedAt?: Date;
  endedAt?: Date;
  deletedAt?: Date | null;
};

/**
 * En arbeidsøkt (`work_sessions`) satt inn direkte uten tilgangssjekk. Standard: fasen
 * `preparation`, 30 minutter som slutter ved `TEST_NOW`. Lager oppdrag og ansatt (rolle
 * takstmann, oppdiktet navn) i samme organisasjon når de mangler. `phase` er fri tekst, så
 * testene kan vise at databasen avviser ukjente koder.
 */
export async function createWorkSession(
  organizationId: string,
  overrides: WorkSessionOverrides = {},
) {
  const assignmentId = overrides.assignmentId ?? (await createAssignment(organizationId)).id;
  const employeeId =
    overrides.employeeId ??
    (await createEmployee(await createUser({ name: "Test Måling" }), organizationId, ["inspector"]))
      .id;
  const endedAt = overrides.endedAt ?? TEST_NOW;
  const startedAt = overrides.startedAt ?? new Date(endedAt.getTime() - 30 * 60 * 1000);
  const [row] = await db
    .insert(workSessions)
    .values({
      organizationId,
      assignmentId,
      employeeId,
      phase: overrides.phase ?? "preparation",
      startedAt,
      endedAt,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette arbeidsøkt");
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
  /** Kontakten i registeret. Må høre til samme organisasjon (fremmednøkkel). */
  contactId?: string | null;
  /** Firmaet. Må høre til samme organisasjon (fremmednøkkel). */
  firmId?: string | null;
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
      contactId: overrides.contactId ?? null,
      firmId: overrides.firmId ?? null,
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

const ORG_NUMBER_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Kontrollsifferet (modulus 11) for de åtte første sifrene, eller `null` når det blir 10 (da
 * finnes ikke noe gyldig nummer med disse sifrene).
 */
function orgNumberCheckDigit(firstEight: string): number | null {
  const sum = ORG_NUMBER_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(firstEight[index]),
    0,
  );
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check === 10 ? null : check;
}

// Starter høyt, så faste numre i testene (000000019, 000000027 …) aldri lages av fabrikken.
let firmOrgNumberCounter = 50000;

/**
 * Neste oppdiktede, gyldige organisasjonsnummer: `000` + løpenummer på fem sifre + kontrollsiffer.
 * Løpenumre der kontrollsifferet blir 10, hoppes over. Løpenummeret starter på 50001. Starter med
 * `000`, så det kan ikke finnes i Brønnøysundregistrene.
 */
export function nextFakeOrgNumber(): string {
  for (;;) {
    firmOrgNumberCounter += 1;
    const firstEight = `000${String(firmOrgNumberCounter).padStart(5, "0")}`;
    const check = orgNumberCheckDigit(firstEight);
    if (check !== null) return `${firstEight}${check}`;
  }
}

type FirmOverrides = {
  name?: string;
  orgNumber?: string | null;
  firmType?: string;
  notes?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * Et firma (`firms`), satt inn direkte uten tilgangssjekk og uten Zod, slik at testene kan lage
 * rader tjenesten ville avvist (ukjent `firmType`). Standard: «Testmegling AS», meglerforetak, uten
 * notat, og et nytt gyldig organisasjonsnummer fra `nextFakeOrgNumber()` per kall. Derfor gir to
 * kall i samme organisasjon aldri unik-feil. `orgNumber: null` gir firma uten nummer.
 */
export async function createFirm(organizationId: string, overrides: FirmOverrides = {}) {
  const [row] = await db
    .insert(firms)
    .values({
      organizationId,
      name: overrides.name ?? "Testmegling AS",
      orgNumber: overrides.orgNumber === undefined ? nextFakeOrgNumber() : overrides.orgNumber,
      firmType: (overrides.firmType ?? "broker_firm") as typeof firms.$inferInsert.firmType,
      notes: overrides.notes ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette firma");
  return row;
}

type ContactOverrides = {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  firmId?: string | null;
  notes?: string | null;
  source?: string;
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * En kontakt (`contacts`), satt inn direkte uten tilgangssjekk og uten Zod. Standard: «Megler
 * Test», lagt inn for hånd (`manual`), uten firma, e-post, telefon og notat. `source` er fri tekst,
 * så testene kan vise at databasen avviser ukjente koder. Oppdiktede data.
 */
export async function createContact(organizationId: string, overrides: ContactOverrides = {}) {
  const [row] = await db
    .insert(contacts)
    .values({
      organizationId,
      firstName: overrides.firstName ?? "Megler",
      lastName: overrides.lastName === undefined ? "Test" : overrides.lastName,
      email: overrides.email ?? null,
      phone: overrides.phone ?? null,
      firmId: overrides.firmId ?? null,
      notes: overrides.notes ?? null,
      source: (overrides.source ?? "manual") as typeof contacts.$inferInsert.source,
      deletedAt: overrides.deletedAt ?? null,
      deletedBy: overrides.deletedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette kontakt");
  return row;
}

// --- Avtale med oppdragsgiver (docs/funksjoner/fase2a-oppdragsgiveravtale.md) -----------------

export type TestClientAgreement = {
  id: string;
  organizationId: string;
  firmId: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  premiseText: string | null;
  reportProfileCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type ClientAgreementOverrides = {
  /** Firmaet (oppdragsgiveren). Mangler det, lages «Testforsikring AS» i organisasjonen. */
  firmId?: string;
  name?: string;
  validFrom?: string;
  validTo?: string | null;
  premiseText?: string | null;
  reportProfileCode?: string | null;
  deletedAt?: Date | null;
};

/** Ren dato («ÅÅÅÅ-MM-DD») fra databasen, også når driveren gir et `Date`. */
function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * En avtale med oppdragsgiver (`client_agreements`), satt inn med SQL uten tilgangssjekk og uten
 * Zod, slik at testene kan lage rader kjernen ville avvist (utløpt, ikke påbegynt, slettet).
 * Standard: «Testavtale forsikring», gyldig fra 2026-01-01 og løpende (gyldig på `TEST_NOW`), uten
 * premissetekst og rapportprofil. Uten `firmId` lages et eget firma «Testforsikring AS» (forsikring)
 * i samme organisasjon. Oppdiktede data.
 */
export async function createClientAgreement(
  organizationId: string,
  overrides: ClientAgreementOverrides = {},
): Promise<TestClientAgreement> {
  const firmId =
    overrides.firmId ??
    (await createFirm(organizationId, { name: "Testforsikring AS", firmType: "insurer" })).id;
  const row = firstRowOf(
    await db.execute(sql`
      insert into client_agreements
        (organization_id, firm_id, name, valid_from, valid_to, premise_text, report_profile_code, deleted_at)
      values (${organizationId}, ${firmId}, ${overrides.name ?? "Testavtale forsikring"},
        ${overrides.validFrom ?? "2026-01-01"}::date, ${overrides.validTo ?? null}::date,
        ${overrides.premiseText ?? null}, ${overrides.reportProfileCode ?? null},
        ${isoOrNull(overrides.deletedAt)}::timestamptz)
      returning *`),
    "client_agreements",
  );
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    firmId: row.firm_id as string,
    name: row.name as string,
    validFrom: dateText(row.valid_from) as string,
    validTo: dateText(row.valid_to),
    premiseText: (row.premise_text as string | null) ?? null,
    reportProfileCode: (row.report_profile_code as string | null) ?? null,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string | Date) : null,
  };
}

// --- Malmotoren (docs/funksjoner/fase2a-malmotor.md) -------------------------------------------

/**
 * En malfamilie med én versjon og innholdet i `document`, lagt rett inn i databasen uten
 * tilgangssjekk og uten revisjonslogg (testplanen, «Avtale om signaturer»). Standard: systemmal,
 * utkast, versjon 1, tomt innhold. `status` `published` og `retired` får `published_at`.
 * `familyId` legger versjonen i en familie som finnes fra før.
 */
export async function createTemplate(
  organizationId: string,
  options: {
    status?: "draft" | "published" | "retired";
    versionNumber?: number;
    document?: TemplateDocumentInput;
    deletedAt?: Date | null;
    versionDeletedAt?: Date | null;
    familyId?: string;
    name?: string;
  } = {},
): Promise<{ familyId: string; versionId: string }> {
  return insertTemplateWithoutAccessCheck(organizationId, options);
}

// --- Reklamasjoner (docs/funksjoner/fase2a-reklamasjoner.md) ----------------------------------

export type TestClaim = {
  id: string;
  organizationId: string;
  assignmentId: string;
  claimType: string;
  receivedAt: string;
  claimantPartyId: string | null;
  claimantText: string | null;
  description: string;
  buildingPartText: string | null;
  outcome: string;
  amount: number | null;
  closedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  rowVersion: number;
};

type ClaimOverrides = {
  /** Oppdraget. Mangler det, lages et oppdrag i samme organisasjon. */
  assignmentId?: string;
  claimType?: string;
  /** Mottatt dato («ÅÅÅÅ-MM-DD»). Standard 2026-11-02 (dagen før `TEST_NOW`). */
  receivedAt?: string;
  claimantPartyId?: string | null;
  claimantText?: string | null;
  description?: string;
  buildingPartText?: string | null;
  outcome?: string;
  amount?: number | null;
  closedAt?: Date | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  /** Ansatt-id-en som registrerte saken. Standard: en tilfeldig uuid. */
  createdBy?: string;
};

/**
 * En reklamasjonssak (`claims`), satt inn med SQL uten tilgangssjekk og uten Zod, slik at testene
 * kan lage rader kjernen ville avvist (ukjente koder, beløp på åpen sak, fjernede saker). Standard:
 * reklamasjon mottatt 2026-11-02, klager «Kjøper Test» som fritekst, beskrivelse «Fukt i kjeller
 * ikke nevnt», bygningsdel «Kjeller, yttervegg», åpen, uten beløp. Lager oppdraget i samme
 * organisasjon når det mangler. Oppdiktede data.
 */
export async function createClaim(
  organizationId: string,
  overrides: ClaimOverrides = {},
): Promise<TestClaim> {
  const assignmentId = overrides.assignmentId ?? (await createAssignment(organizationId)).id;
  const pick = <T>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;
  const row = firstRowOf(
    await db.execute(sql`
      insert into claims (organization_id, assignment_id, claim_type, received_at,
        claimant_party_id, claimant_text, description, building_part_text, outcome, amount,
        closed_at, created_at, created_by, deleted_at, deleted_by)
      values (${organizationId}, ${assignmentId}, ${overrides.claimType ?? "complaint"},
        ${overrides.receivedAt ?? "2026-11-02"}::date, ${pick(overrides.claimantPartyId, null)},
        ${pick(overrides.claimantText, "Kjøper Test")}, ${overrides.description ?? "Fukt i kjeller ikke nevnt"},
        ${pick(overrides.buildingPartText, "Kjeller, yttervegg")}, ${overrides.outcome ?? "open"},
        ${pick(overrides.amount, null)}::integer, ${isoOrNull(overrides.closedAt)}::timestamptz,
        ${(overrides.createdAt ?? new Date()).toISOString()}::timestamptz,
        ${overrides.createdBy ?? randomUUID()}, ${isoOrNull(overrides.deletedAt)}::timestamptz,
        ${overrides.deletedBy ?? null})
      returning *`),
    "claims",
  );
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    assignmentId: row.assignment_id as string,
    claimType: row.claim_type as string,
    receivedAt: dateText(row.received_at) as string,
    claimantPartyId: (row.claimant_party_id as string | null) ?? null,
    claimantText: (row.claimant_text as string | null) ?? null,
    description: row.description as string,
    buildingPartText: (row.building_part_text as string | null) ?? null,
    outcome: row.outcome as string,
    amount: numberOrNull(row.amount),
    closedAt: row.closed_at ? new Date(row.closed_at as string | Date) : null,
    createdAt: new Date(row.created_at as string | Date),
    createdBy: String(row.created_by),
    updatedAt: new Date(row.updated_at as string | Date),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string | Date) : null,
    deletedBy: (row.deleted_by as string | null) ?? null,
    rowVersion: Number(row.row_version),
  };
}

// --- Malmotoren (docs/funksjoner/fase2a-malmotor.md) -----------------------------------------
//
// Enkle radbyggere som legger én rad rett i databasen, uten tilgangssjekk og uten Zod, og lager
// foreldrene som mangler i samme organisasjon. Kodene får et løpenummer (`section_1`,
// `checkpoint_2` …), så to rader aldri kolliderer på den delvis unike indeksen. Oppdiktede,
// nøytrale tekster uten fagstoff.

let templateCounter = 0;

function nextTemplateKey(prefix: string): string {
  templateCounter += 1;
  return `${prefix}_${templateCounter}`;
}

function insertedRow<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (!row) throw new Error(`kunne ikke legge inn rad i ${table}`);
  return row;
}

type TemplateOverrides<T> = Partial<Omit<T, "organizationId">>;

/** En malfamilie. Standard: systemmal for tilstandsrapport. */
export async function createTemplateFamilyRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof templateFamilies.$inferInsert> = {},
) {
  return insertedRow(
    await db
      .insert(templateFamilies)
      .values({ name: "Testmal", kind: "system", ...overrides, organizationId })
      .returning(),
    "template_families",
  );
}

/**
 * En malversjon. Lager familien når `familyId` mangler. Standard: utkast med neste ledige
 * versjonsnummer i familien. Publisert og utgått får `publishedAt = TEST_NOW` (CHECK i databasen).
 */
export async function createTemplateVersionRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof templateVersions.$inferInsert> = {},
) {
  const familyId = overrides.familyId ?? (await createTemplateFamilyRow(organizationId)).id;
  const [highest] = await db
    .select({ value: sql<number>`coalesce(max(${templateVersions.versionNumber}), 0)` })
    .from(templateVersions)
    .where(eq(templateVersions.familyId, familyId));
  const status = overrides.status ?? "draft";
  return insertedRow(
    await db
      .insert(templateVersions)
      .values({
        versionNumber: Number(highest?.value ?? 0) + 1,
        publishedAt: status === "draft" ? null : TEST_NOW,
        ...overrides,
        status,
        familyId,
        organizationId,
      })
      .returning(),
    "template_versions",
  );
}

/** Malversjonen til en seksjon (felt og kontrollpunkt skal ha samme versjon som seksjonen). */
async function sectionVersionId(sectionId: string): Promise<string> {
  const [row] = await db
    .select({ versionId: templateSections.versionId })
    .from(templateSections)
    .where(eq(templateSections.id, sectionId));
  if (!row) throw new Error("fant ikke seksjonen");
  return row.versionId;
}

/** En seksjon. Lager versjonen når `versionId` mangler. */
export async function createTemplateSectionRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof templateSections.$inferInsert> = {},
) {
  const versionId = overrides.versionId ?? (await createTemplateVersionRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(templateSections)
      .values({
        key: nextTemplateKey("section"),
        title: "Testseksjon",
        ...overrides,
        versionId,
        organizationId,
      })
      .returning(),
    "template_sections",
  );
}

/** Et kontrollpunkt. Lager seksjonen (og versjonen) når `sectionId` mangler. */
export async function createCheckpointRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof checkpoints.$inferInsert> = {},
) {
  const sectionId =
    overrides.sectionId ??
    (await createTemplateSectionRow(organizationId, { versionId: overrides.versionId })).id;
  const versionId = overrides.versionId ?? (await sectionVersionId(sectionId));
  return insertedRow(
    await db
      .insert(checkpoints)
      .values({
        key: nextTemplateKey("checkpoint"),
        name: "Testpunkt",
        group: "interior",
        ...overrides,
        sectionId,
        versionId,
        organizationId,
      })
      .returning(),
    "checkpoints",
  );
}

/** Et felt. Lager seksjonen (og versjonen) når `sectionId` mangler. Standard: tekstfelt. */
export async function createTemplateElementRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof templateElements.$inferInsert> = {},
) {
  const sectionId =
    overrides.sectionId ??
    (await createTemplateSectionRow(organizationId, { versionId: overrides.versionId })).id;
  const versionId = overrides.versionId ?? (await sectionVersionId(sectionId));
  return insertedRow(
    await db
      .insert(templateElements)
      .values({
        key: nextTemplateKey("element"),
        label: "Testfelt",
        fieldType: "text",
        ...overrides,
        sectionId,
        versionId,
        organizationId,
      })
      .returning(),
    "template_elements",
  );
}

/** Et valg i et felt. Lager et valgfelt når `elementId` mangler. */
export async function createTemplateElementOptionRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof templateElementOptions.$inferInsert> = {},
) {
  const elementId =
    overrides.elementId ??
    (await createTemplateElementRow(organizationId, { fieldType: "choice" })).id;
  return insertedRow(
    await db
      .insert(templateElementOptions)
      .values({
        key: nextTemplateKey("option"),
        label: "Testvalg",
        ...overrides,
        elementId,
        organizationId,
      })
      .returning(),
    "template_element_options",
  );
}

/** Et avviksspørsmål. Lager kontrollpunktet når `checkpointId` mangler. */
export async function createDeviationQuestionRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof deviationQuestions.$inferInsert> = {},
) {
  const checkpointId = overrides.checkpointId ?? (await createCheckpointRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(deviationQuestions)
      .values({
        key: nextTemplateKey("question"),
        text: "Testspørsmål",
        ...overrides,
        checkpointId,
        organizationId,
      })
      .returning(),
    "deviation_questions",
  );
}

/** Et utfall. Lager spørsmålet når `deviationQuestionId` mangler. Standard: `tg2`. */
export async function createOutcomeRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof outcomes.$inferInsert> = {},
) {
  const deviationQuestionId =
    overrides.deviationQuestionId ?? (await createDeviationQuestionRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(outcomes)
      .values({
        key: nextTemplateKey("outcome"),
        kind: "tg2",
        ...overrides,
        deviationQuestionId,
        organizationId,
      })
      .returning(),
    "outcomes",
  );
}

/** Et standardtiltak. Lager utfallet når `outcomeId` mangler. */
export async function createStandardMeasureRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof standardMeasures.$inferInsert> = {},
) {
  const outcomeId = overrides.outcomeId ?? (await createOutcomeRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(standardMeasures)
      .values({ text: "Testtiltak", ...overrides, outcomeId, organizationId })
      .returning(),
    "standard_measures",
  );
}

/** En regel. Lager versjonen når `versionId` mangler. Standard: `show` uten mål. */
export async function createRuleRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof rules.$inferInsert> = {},
) {
  const versionId = overrides.versionId ?? (await createTemplateVersionRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(rules)
      .values({
        key: nextTemplateKey("rule"),
        name: "Testregel",
        purpose: "show",
        ...overrides,
        versionId,
        organizationId,
      })
      .returning(),
    "rules",
  );
}

/** En betingelse. Lager regelen når `ruleId` mangler. Standard: `always`. */
export async function createRuleConditionRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof ruleConditions.$inferInsert> = {},
) {
  const ruleId = overrides.ruleId ?? (await createRuleRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(ruleConditions)
      .values({ type: "always", ...overrides, ruleId, organizationId })
      .returning(),
    "rule_conditions",
  );
}

/** Et testtilfelle. Lager regelen når `ruleId` mangler. Standard: tomme svar, skal slå til. */
export async function createRuleTestCaseRow(
  organizationId: string,
  overrides: TemplateOverrides<typeof ruleTestCases.$inferInsert> = {},
) {
  const ruleId = overrides.ruleId ?? (await createRuleRow(organizationId)).id;
  return insertedRow(
    await db
      .insert(ruleTestCases)
      .values({
        name: "Testtilfelle",
        input: {},
        expectTriggered: true,
        ...overrides,
        ruleId,
        organizationId,
      })
      .returning(),
    "rule_test_cases",
  );
}
