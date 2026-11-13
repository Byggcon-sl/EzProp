import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { readInspectorsEditAll, type Actor } from "@/core/access";
import {
  addParty,
  changeAssignmentStatus,
  setAssignmentSchedule,
  setTeamMember,
  updateAssignmentNote,
  type AssignmentStatus,
  type TeamRole,
} from "@/core/assignments";
import { saveBuilding, saveFloor, saveFloorArea, saveRoom } from "@/core/buildings";
import { createClaim, updateClaim } from "@/core/claims";
import { createContact, createFirm } from "@/core/contacts";
import { convertOrderToAssignment, createOrder } from "@/core/orders";
import { saveAssignmentProperty, saveCommonAreas } from "@/core/properties";
import type { Database } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  cadastralUnits,
  certifications,
  claims,
  commonAreas,
  companies,
  contacts,
  employeeRoleAssignments,
  employees,
  events,
  firms,
  offices,
  orders,
  organizations,
  properties,
  reportBuildings,
  users,
  workSessions,
} from "@/db/schema";
import { brand } from "@/shared/config/brand";
import { assertTestdataAllowed } from "./testdata-guard";
import { buildTestdataPlan } from "./testdata-plan";
import { TESTDATA_ORDER_PREFIX } from "./testdata.data";
import type {
  TestdataAssignment,
  TestdataCertification,
  TestdataContact,
  TestdataEmployee,
  TestdataFirm,
  TestdataOrder,
  TestdataPlan,
  TestdataProperty,
} from "./testdata.types";

export { buildTestdataPlan } from "./testdata-plan";

/*
 * `pnpm db:seed:testdata`: testdata som ligner en ekte arbeidshverdag i Byggcon-organisasjonen
 * (docs/funksjoner/fase2a-testdata-arbeidshverdag.md). Støtter hovedmålene: de ansatte ser en full
 * arbeidsdag i testmiljøet etter hver utrulling, og lister, søk og statistikk prøves med en mengde
 * som ligner drift (færre reklamasjoner). Ingen KI-kall og ingen rader i `ai_usage_log`.
 *
 * - Vakten (`assertTestdataAllowed`) kjøres før noe databasekall.
 * - Alle oppslag filtrerer på id-en til Byggcon-raden (aldri en id fra input). Mykt slettede rader
 *   teller som «finnes»: de gjenopplives ikke, og det lages ingen kopi. Skriptet setter aldri
 *   `deleted_at`, endrer aldri `organizations.settings` eller `integration_connections`, og endrer
 *   ingen rader som ikke er testdata.
 * - Grunndata (brukere, ansatte, roller, sertifiseringer) og arbeidsøkter legges inn direkte.
 *   Resten lages gjennom tjenestene i `src/core` med en oppdiktet ansatt som aktør (kontor lager
 *   ordre og oppdrag, ansvarlig takstmann måler og bytter status, leder registrerer reklamasjoner).
 *   Admin fra `SEED_ADMIN_EMAIL` er aldri aktør.
 * - Tjenestene har hver sin transaksjon. Derfor sjekkes delene av hver ordre i fast rekkefølge,
 *   og bare det som mangler, lages (samme mønster som `sample-assignments.ts`). En avbrutt kjøring
 *   fylles ut av neste, og nummerserien får ikke hull utover en transaksjon som ble rullet tilbake.
 * - Domenetidspunktene som tjenestene setter til «nå» (`orders.created_at`,
 *   `assignments.created_at`, `claims.created_at` og `events.occurred_at` på hendelser fra de
 *   oppdiktede ansatte), flyttes til planlagt tid rett etter tjenestekallene, bare på rader som de
 *   oppdiktede ansatte har laget, og bare når verdien er en annen (andre kjøring skriver
 *   ingenting). Ankeret regnes tilbake fra `created_at` på `TD-0001` (`anchorFromCreatedAt`).
 *   `audit_log` røres aldri.
 * - Loggen og feilene har bare antall og `TD-`-nøkler, aldri navn, e-post, telefon eller adresse.
 */

export type Db = Database;

/** Feil i oppsettet (organisasjonen mangler, bruker i annen organisasjon). Meldingen er norsk. */
export class TestdataSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestdataSetupError";
  }
}

/**
 * Feil midt i et steg. `key` er `TD-`-nøkkelen (eller stegets navn), `cause` den opprinnelige
 * feilen. Meldingen har bare nøkkelen, aldri verdier fra databasen.
 */
export class TestdataStepError extends Error {
  readonly key: string;
  constructor(key: string, cause: unknown) {
    super(`Testdata stoppet ved ${key}.`, { cause });
    this.name = "TestdataStepError";
    this.key = key;
  }
}

/** En nødvendig oppdiktet ansatt er slettet eller deaktivert: ordren hoppes over. */
class ActorUnavailableError extends Error {
  constructor() {
    super("Den oppdiktede ansatte er slettet eller deaktivert.");
    this.name = "ActorUnavailableError";
  }
}

export const TESTDATA_ORGANIZATION_MISSING_MESSAGE = "Kjør pnpm db:seed først.";
export const TESTDATA_USER_CONFLICT_MESSAGE =
  "En av e-postadressene til de oppdiktede ansatte er allerede i bruk i en annen organisasjon. Ingenting er endret.";

export const TESTDATA_TABLES = [
  "users",
  "employees",
  "certifications",
  "firms",
  "contacts",
  "orders",
  "assignments",
  "teamMembers",
  "parties",
  "properties",
  "commonAreas",
  "schedules",
  "buildings",
  "floors",
  "floorAreas",
  "rooms",
  "statusChanges",
  "workSessions",
  "claims",
] as const;
export type TestdataTable = (typeof TESTDATA_TABLES)[number];

/** Antall laget og hoppet over (fantes fra før) per del. Bare tall og `TD-`-nøkler. */
export type TestdataSummary = {
  created: Record<TestdataTable, number>;
  existing: Record<TestdataTable, number>;
  /** Ordre som ble hoppet over: slettet, avvist, kansellert, eller aktøren er borte. */
  skippedOrders: string[];
};

function emptyCounts(): Record<TestdataTable, number> {
  return Object.fromEntries(TESTDATA_TABLES.map((table) => [table, 0])) as Record<
    TestdataTable,
    number
  >;
}

// ---------------------------------------------------------------------------------------------
// Oppslag. Alle som tar `organizationId`, filtrerer på den. Mykt slettede rader er med.
// ---------------------------------------------------------------------------------------------

export type TestdataEmployeeRow = {
  employeeId: string;
  userId: string;
  email: string;
  name: string;
  deletedAt: Date | null;
  deactivatedAt: Date | null;
};

/** De oppdiktede ansatte i organisasjonen, slått opp på nøyaktig e-post (aldri `LIKE`). */
export async function findTestdataEmployees(
  db: Db,
  organizationId: string,
  emails: readonly string[],
): Promise<TestdataEmployeeRow[]> {
  if (emails.length === 0) return [];
  return db
    .select({
      employeeId: employees.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      deletedAt: employees.deletedAt,
      deactivatedAt: employees.deactivatedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.organizationId, organizationId), inArray(users.email, [...emails])))
    .orderBy(asc(employees.createdAt), asc(employees.id));
}

export type TestdataContactRow = {
  id: string;
  email: string | null;
  firmId: string | null;
  deletedAt: Date | null;
};

/** Kontaktene i organisasjonen med e-post fra den faste listen. */
export async function findTestdataContacts(
  db: Db,
  organizationId: string,
  emails: readonly string[],
): Promise<TestdataContactRow[]> {
  if (emails.length === 0) return [];
  return db
    .select({
      id: contacts.id,
      email: contacts.email,
      firmId: contacts.firmId,
      deletedAt: contacts.deletedAt,
    })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.email, [...emails])))
    .orderBy(asc(contacts.createdAt), asc(contacts.id));
}

export type TestdataFirmRow = {
  id: string;
  name: string;
  firmType: string;
  deletedAt: Date | null;
};

/** Firmaene i organisasjonen med navn fra den faste listen (typen sjekkes av kalleren). */
export async function findTestdataFirms(
  db: Db,
  organizationId: string,
  names: readonly string[],
): Promise<TestdataFirmRow[]> {
  if (names.length === 0) return [];
  return db
    .select({
      id: firms.id,
      name: firms.name,
      firmType: firms.firmType,
      deletedAt: firms.deletedAt,
    })
    .from(firms)
    .where(and(eq(firms.organizationId, organizationId), inArray(firms.name, [...names])))
    .orderBy(asc(firms.createdAt), asc(firms.id));
}

export type TestdataPropertyRow = {
  /** `kommunenummer-gnr-bnr-fnr-snr`, som `TestdataProperty.key`. */
  key: string;
  propertyId: string;
  deletedAt: Date | null;
};

/** Nøkkelen for en eiendom: kommune + gnr + bnr (+ fnr/snr). Tomme deler er tomme. */
export function propertyKey(parts: {
  municipalityNumber: string | null;
  gnr: string;
  bnr: string;
  fnr: string | null;
  snr: string | null;
}): string {
  return [
    parts.municipalityNumber ?? "",
    parts.gnr,
    parts.bnr,
    parts.fnr ?? "",
    parts.snr ?? "",
  ].join("-");
}

/** Eiendommene i organisasjonen med kommune og gårdsnummer fra planen, med nøkkel. */
export async function findTestdataProperties(
  db: Db,
  organizationId: string,
  keys: readonly Pick<TestdataProperty, "municipalityNumber" | "gnr">[],
): Promise<TestdataPropertyRow[]> {
  if (keys.length === 0) return [];
  const municipalities = [...new Set(keys.map((key) => key.municipalityNumber))];
  const gnrs = [...new Set(keys.map((key) => key.gnr))];
  const rows = await db
    .select({
      propertyId: properties.id,
      municipalityNumber: properties.municipalityNumber,
      gnr: cadastralUnits.gnr,
      bnr: cadastralUnits.bnr,
      fnr: cadastralUnits.fnr,
      snr: cadastralUnits.snr,
      deletedAt: properties.deletedAt,
    })
    .from(cadastralUnits)
    .innerJoin(
      properties,
      and(
        eq(properties.id, cadastralUnits.propertyId),
        eq(properties.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(cadastralUnits.organizationId, organizationId),
        inArray(properties.municipalityNumber, municipalities),
        inArray(cadastralUnits.gnr, gnrs),
      ),
    )
    .orderBy(asc(properties.createdAt), asc(properties.id));
  return rows.map((row) => ({
    key: propertyKey(row),
    propertyId: row.propertyId,
    deletedAt: row.deletedAt,
  }));
}

export type TestdataOrderRow = {
  id: string;
  externalRef: string | null;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
  assignmentId: string | null;
  assignmentStatus: string | null;
  assignmentDeletedAt: Date | null;
  propertyId: string | null;
  inspectionAt: Date | null;
  dueDate: string | null;
  internalNote: string | null;
};

/** Ordrene i organisasjonen med `external_ref` fra planen, med oppdraget. */
export async function findTestdataOrders(
  db: Db,
  organizationId: string,
  refs: readonly string[],
): Promise<TestdataOrderRow[]> {
  if (refs.length === 0) return [];
  return db
    .select({
      id: orders.id,
      externalRef: orders.externalRef,
      status: orders.status,
      createdAt: orders.createdAt,
      deletedAt: orders.deletedAt,
      assignmentId: orders.assignmentId,
      assignmentStatus: assignments.status,
      assignmentDeletedAt: assignments.deletedAt,
      propertyId: assignments.propertyId,
      inspectionAt: assignments.inspectionAt,
      dueDate: assignments.dueDate,
      internalNote: assignments.internalNote,
    })
    .from(orders)
    .leftJoin(
      assignments,
      and(eq(assignments.id, orders.assignmentId), eq(assignments.organizationId, organizationId)),
    )
    .where(and(eq(orders.organizationId, organizationId), inArray(orders.externalRef, [...refs])))
    .orderBy(asc(orders.createdAt), asc(orders.id));
}

/** Ordren `TD-0001` i organisasjonen (også slettet). `created_at` er ankeret for datoene. */
export async function findAnchorOrder(
  db: Db,
  organizationId: string,
): Promise<{ id: string; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: orders.id, createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.externalRef, `${TESTDATA_ORDER_PREFIX}0001`),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(1);
  return row ?? null;
}

/** Byggcon-organisasjonen (som `runSeed`). */
async function findOrganization(db: Db) {
  const [row] = await db
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(and(eq(organizations.name, brand.companyName), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.createdAt), asc(organizations.id))
    .limit(1);
  return row ?? null;
}

/**
 * Sant hvis en av e-postene er bruker hos en ansatt i en annen organisasjon enn `organizationId`.
 * `users` har ingen organisasjon, så dette oppslaget går på tvers med vilje; det leser bare.
 */
async function hasUserInOtherOrganization(
  db: Db,
  organizationId: string,
  emails: readonly string[],
): Promise<boolean> {
  if (emails.length === 0) return false;
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(inArray(users.email, [...emails]), sql`${employees.organizationId} <> ${organizationId}`),
    )
    .limit(1);
  return row !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Konteksten for skrivingen
// ---------------------------------------------------------------------------------------------

type EmployeeEntry = {
  employeeId: string;
  actor: Actor;
  available: boolean;
  roles: readonly string[];
};

type Context = {
  db: Db;
  organizationId: string;
  plan: TestdataPlan;
  inspectorsCanEdit: boolean;
  employees: Map<string, EmployeeEntry>;
  /** Id-ene til de oppdiktede ansatte (også slettede): hendelsene deres kan flyttes. */
  employeeIds: string[];
  officeIds: Map<string, string>;
  firmIds: Map<string, { id: string; available: boolean }>;
  contactIds: Map<string, { id: string; available: boolean }>;
  /** Nøklene til eiendommene som finnes (også slettede). */
  propertyKeys: Set<string>;
  summary: TestdataSummary;
};

function employeeOf(context: Context, key: string): EmployeeEntry {
  const entry = context.employees.get(key);
  if (!entry || !entry.available) throw new ActorUnavailableError();
  return entry;
}

function actorOf(context: Context, key: string): Actor {
  return employeeOf(context, key).actor;
}

/**
 * Aktøren for endringer på oppdraget som takstmannen gjør (måling og status). Er
 * `access.inspectors_edit_all` slått av, har ikke en takstmann uten andre roller
 * `assignment.edit`; da gjør kontoret som laget ordren det.
 */
function inspectorActor(context: Context, inspectorKey: string, officeKey: string): Actor {
  const inspector = employeeOf(context, inspectorKey);
  const canEdit = context.inspectorsCanEdit || inspector.roles.some((role) => role !== "inspector");
  return canEdit ? inspector.actor : actorOf(context, officeKey);
}

/** Første tilgjengelige kontoransatte i planen: lager firma og kontakter. */
function officeActor(context: Context): Actor {
  for (const employee of context.plan.employees) {
    const entry = context.employees.get(employee.key);
    if (entry?.available && employee.roles.includes("office")) return entry.actor;
  }
  throw new ActorUnavailableError();
}

function available(entry: { deletedAt: Date | null; deactivatedAt?: Date | null }): boolean {
  return entry.deletedAt === null && (entry.deactivatedAt ?? null) === null;
}

// ---------------------------------------------------------------------------------------------
// Grunndata: brukere, ansatte, roller og sertifiseringer (direkte, som `runSeed`)
// ---------------------------------------------------------------------------------------------

async function ensureEmployees(
  db: Db,
  organizationId: string,
  plan: TestdataPlan,
  summary: TestdataSummary,
): Promise<Map<string, EmployeeEntry>> {
  const emails = plan.employees.map((employee) => employee.email);
  const [companyRows, officeRows, existingRows] = await Promise.all([
    db
      .select({ id: companies.id, legalName: companies.legalName })
      .from(companies)
      .where(and(eq(companies.organizationId, organizationId), isNull(companies.deletedAt)))
      .orderBy(asc(companies.createdAt), asc(companies.id)),
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.organizationId, organizationId), isNull(offices.deletedAt)))
      .orderBy(asc(offices.createdAt), asc(offices.id)),
    findTestdataEmployees(db, organizationId, emails),
  ]);
  const companyIds = new Map<string, string>();
  for (const row of companyRows)
    if (!companyIds.has(row.legalName)) companyIds.set(row.legalName, row.id);
  const officeIds = new Map<string, string>();
  for (const row of officeRows) if (!officeIds.has(row.name)) officeIds.set(row.name, row.id);

  const existing = new Map<string, TestdataEmployeeRow>();
  for (const row of existingRows) if (!existing.has(row.email)) existing.set(row.email, row);

  const result = new Map<string, EmployeeEntry>();
  for (const employee of plan.employees) {
    const found = existing.get(employee.email);
    if (found) {
      summary.existing.employees += 1;
      result.set(employee.key, {
        employeeId: found.employeeId,
        actor: { id: found.userId, email: found.email, name: found.name },
        available: available(found),
        roles: employee.roles,
      });
      // Sertifiseringen kan mangle selv om den ansatte finnes (avbrutt kjøring eller rader lagt
      // inn uten sertifisering). Uten den faller publiseringssperren som testdataene skal vise.
      // Slettede eller deaktiverte ansatte røres ikke (myk sletting respekteres).
      if (employee.certification && available(found))
        await ensureCertification(
          db,
          organizationId,
          found.employeeId,
          employee.certification,
          summary,
        );
      continue;
    }
    const companyId = companyIds.get(employee.companyLegalName);
    const officeId = officeIds.get(employee.officeName);
    if (!companyId || !officeId)
      throw new TestdataSetupError(TESTDATA_ORGANIZATION_MISSING_MESSAGE);
    result.set(
      employee.key,
      await insertEmployee(db, organizationId, employee, { companyId, officeId }, summary),
    );
  }
  return result;
}

/** Bruker (gjenbrukes hvis den finnes uten ansatt), ansatt, roller og sertifisering samlet. */
async function insertEmployee(
  db: Db,
  organizationId: string,
  employee: TestdataEmployee,
  placement: { companyId: string; officeId: string },
  summary: TestdataSummary,
): Promise<EmployeeEntry> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ id: randomUUID(), email: employee.email, name: employee.name })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    const [user] = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, employee.email));
    if (!user) throw new Error("Fant ikke brukeren etter at den ble lagret.");
    if (inserted.length > 0) summary.created.users += 1;
    else summary.existing.users += 1;

    const [row] = await tx
      .insert(employees)
      .values({ organizationId, userId: user.id, name: employee.name, ...placement })
      .returning({ id: employees.id });
    if (!row) throw new Error("Fant ikke den ansatte etter at den ble lagret.");
    await tx
      .insert(employeeRoleAssignments)
      .values(employee.roles.map((role) => ({ organizationId, employeeId: row.id, role })));
    if (employee.certification)
      await ensureCertification(tx, organizationId, row.id, employee.certification, summary);
    summary.created.employees += 1;
    return {
      employeeId: row.id,
      actor: { id: user.id, email: user.email, name: user.name },
      available: true,
      roles: employee.roles,
    };
  });
}

type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Legger inn sertifiseringen hvis den mangler (samme organisasjon, ansatt og sertifikatnummer). */
async function ensureCertification(
  db: DbOrTx,
  organizationId: string,
  employeeId: string,
  cert: TestdataCertification,
  summary: TestdataSummary,
): Promise<void> {
  const [existing] = await db
    .select({ id: certifications.id })
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, organizationId),
        eq(certifications.employeeId, employeeId),
        eq(certifications.certificateNumber, cert.certificateNumber),
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    summary.existing.certifications += 1;
    return;
  }
  await db.insert(certifications).values({
    organizationId,
    employeeId,
    area: cert.area,
    issuer: cert.issuer,
    certificateNumber: cert.certificateNumber,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
  });
  summary.created.certifications += 1;
}

// ---------------------------------------------------------------------------------------------
// Firma og kontakter (gjennom tjenestene, kontoret som aktør)
// ---------------------------------------------------------------------------------------------

const firmKey = (firm: { name: string; firmType: string }) => `${firm.name}|${firm.firmType}`;

async function ensureFirms(context: Context, planFirms: readonly TestdataFirm[]) {
  const { db, organizationId, summary } = context;
  const rows = await findTestdataFirms(
    db,
    organizationId,
    planFirms.map((firm) => firm.name),
  );
  for (const row of rows) {
    const key = firmKey(row);
    if (!context.firmIds.has(key)) {
      context.firmIds.set(key, { id: row.id, available: row.deletedAt === null });
    }
  }
  for (const firm of planFirms) {
    if (context.firmIds.has(firm.key)) {
      summary.existing.firms += 1;
      continue;
    }
    const created = await createFirm(officeActor(context), organizationId, {
      name: firm.name,
      firmType: firm.firmType,
      orgNumber: null,
      notes: null,
    });
    context.firmIds.set(firm.key, { id: created.id, available: true });
    summary.created.firms += 1;
  }
}

async function ensureContacts(context: Context, planContacts: readonly TestdataContact[]) {
  const { db, organizationId, summary } = context;
  const rows = await findTestdataContacts(
    db,
    organizationId,
    planContacts.map((contact) => contact.email),
  );
  for (const row of rows) {
    if (row.email !== null && !context.contactIds.has(row.email)) {
      context.contactIds.set(row.email, { id: row.id, available: row.deletedAt === null });
    }
  }
  for (const contact of planContacts) {
    if (context.contactIds.has(contact.email)) {
      summary.existing.contacts += 1;
      continue;
    }
    const firm = contact.firmKey === null ? undefined : context.firmIds.get(contact.firmKey);
    const created = await createContact(officeActor(context), organizationId, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      firmId: firm?.available ? firm.id : null,
      notes: null,
    });
    context.contactIds.set(contact.email, { id: created.id, available: true });
    summary.created.contacts += 1;
  }
}

/** Kontakten fra planen hvis den finnes og ikke er slettet, ellers `null` (ingen kobling). */
function contactIdOf(context: Context, key: string | null): string | null {
  if (key === null) return null;
  const contact = context.contactIds.get(key);
  return contact?.available ? contact.id : null;
}

// ---------------------------------------------------------------------------------------------
// Det som finnes på oppdragene, lest samlet (unngår ett oppslag per oppdrag)
// ---------------------------------------------------------------------------------------------

type AssignmentState = {
  teamRoles: Set<string>;
  parties: Map<string, string>;
  hasCommonAreas: boolean;
  hasBuilding: boolean;
  hasWorkSessions: boolean;
  claim: { id: string; outcome: string; createdBy: string; updatedBy: string | null } | null;
  statusEvents: Set<string>;
};

async function loadAssignmentState(
  db: Db,
  organizationId: string,
  assignmentIds: readonly string[],
): Promise<Map<string, AssignmentState>> {
  const state = new Map<string, AssignmentState>();
  if (assignmentIds.length === 0) return state;
  const ids = [...assignmentIds];
  for (const id of ids) {
    state.set(id, {
      teamRoles: new Set(),
      parties: new Map(),
      hasCommonAreas: false,
      hasBuilding: false,
      hasWorkSessions: false,
      claim: null,
      statusEvents: new Set(),
    });
  }
  const [team, parties, common, buildings, sessions, claimRows, statusRows] = await Promise.all([
    db
      .select({
        assignmentId: assignmentTeamMembers.assignmentId,
        role: assignmentTeamMembers.teamRole,
      })
      .from(assignmentTeamMembers)
      .where(
        and(
          eq(assignmentTeamMembers.organizationId, organizationId),
          inArray(assignmentTeamMembers.assignmentId, ids),
        ),
      ),
    db
      .select({
        id: assignmentParties.id,
        assignmentId: assignmentParties.assignmentId,
        role: assignmentParties.role,
        name: assignmentParties.name,
        deletedAt: assignmentParties.deletedAt,
      })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, organizationId),
          inArray(assignmentParties.assignmentId, ids),
        ),
      )
      .orderBy(asc(assignmentParties.createdAt), asc(assignmentParties.id)),
    db
      .select({ assignmentId: commonAreas.assignmentId })
      .from(commonAreas)
      .where(
        and(eq(commonAreas.organizationId, organizationId), inArray(commonAreas.assignmentId, ids)),
      ),
    db
      .select({ assignmentId: reportBuildings.assignmentId })
      .from(reportBuildings)
      .where(
        and(
          eq(reportBuildings.organizationId, organizationId),
          inArray(reportBuildings.assignmentId, ids),
        ),
      ),
    db
      .select({ assignmentId: workSessions.assignmentId })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, organizationId),
          inArray(workSessions.assignmentId, ids),
        ),
      ),
    db
      .select({
        id: claims.id,
        assignmentId: claims.assignmentId,
        outcome: claims.outcome,
        createdBy: claims.createdBy,
        updatedBy: claims.updatedBy,
      })
      .from(claims)
      .where(and(eq(claims.organizationId, organizationId), inArray(claims.assignmentId, ids)))
      .orderBy(asc(claims.createdAt), asc(claims.id)),
    db
      .select({
        assignmentId: events.assignmentId,
        to: sql<string | null>`${events.data} ->> 'to'`,
      })
      .from(events)
      .where(
        and(
          eq(events.organizationId, organizationId),
          inArray(events.assignmentId, ids),
          eq(events.type, "assignment.status_changed"),
        ),
      ),
  ]);
  for (const row of team) state.get(row.assignmentId)?.teamRoles.add(row.role);
  for (const row of parties) {
    const entry = state.get(row.assignmentId);
    const key = `${row.role}|${row.name}`;
    // Fjernede parter teller som «finnes», men kan ikke være klager
    if (entry && !entry.parties.has(key))
      entry.parties.set(key, row.deletedAt === null ? row.id : "");
  }
  for (const row of common) {
    const entry = state.get(row.assignmentId);
    if (entry) entry.hasCommonAreas = true;
  }
  for (const row of buildings) {
    const entry = state.get(row.assignmentId);
    if (entry) entry.hasBuilding = true;
  }
  for (const row of sessions) {
    const entry = state.get(row.assignmentId);
    if (entry) entry.hasWorkSessions = true;
  }
  for (const row of claimRows) {
    const entry = state.get(row.assignmentId);
    if (entry && entry.claim === null) entry.claim = row;
  }
  for (const row of statusRows) {
    if (row.assignmentId !== null && row.to !== null)
      state.get(row.assignmentId)?.statusEvents.add(row.to);
  }
  return state;
}

function emptyState(): AssignmentState {
  return {
    teamRoles: new Set(),
    parties: new Map(),
    hasCommonAreas: false,
    hasBuilding: false,
    hasWorkSessions: false,
    claim: null,
    statusEvents: new Set(),
  };
}

// ---------------------------------------------------------------------------------------------
// Én ordre: delene i fast rekkefølge. Hver del lager bare det som mangler.
// ---------------------------------------------------------------------------------------------

const STATUS_PATH: readonly AssignmentStatus[] = [
  "ordered",
  "in_progress",
  "completed",
  "invoiced",
];

/** Hendelsene fra målingen (bygning, etasje, areal og rom) får befaringstiden. */
const MEASUREMENT_EVENTS = [
  "assignment.building_saved",
  "assignment.floor_saved",
  "assignment.floor_area_saved",
  "assignment.room_saved",
];

function isUnusable(row: TestdataOrderRow): boolean {
  return row.deletedAt !== null || row.status === "rejected" || row.assignmentDeletedAt !== null;
}

async function ensureOrder(
  context: Context,
  order: TestdataOrder,
  existing: TestdataOrderRow | undefined,
  states: Map<string, AssignmentState>,
): Promise<boolean> {
  const { organizationId, summary } = context;
  if (existing && isUnusable(existing)) return false;

  let orderId: string;
  let assignmentId: string | null = existing?.assignmentId ?? null;
  if (existing) {
    orderId = existing.id;
    summary.existing.orders += 1;
  } else {
    const created = await createOrder(
      actorOf(context, order.createdByKey),
      organizationId,
      {
        ...order.fields,
        externalRef: order.externalRef,
        receivedAt: order.receivedAt,
        orderedByContactId: contactIdOf(context, order.orderedByContactKey),
      },
      order.receivedAt,
    );
    orderId = created.id;
    summary.created.orders += 1;
  }

  await alignOrderTime(context, orderId, order);
  if (!order.converted) {
    await alignEventTimes(context, orderId, null, order, null);
    return true;
  }
  const plan = order.converted.assignment;

  if (assignmentId === null) {
    if (existing && existing.status !== "received") return false;
    const officeId = context.officeIds.get(plan.officeName);
    if (!officeId) throw new TestdataSetupError(TESTDATA_ORGANIZATION_MISSING_MESSAGE);
    const { assignment } = await convertOrderToAssignment(
      actorOf(context, order.createdByKey),
      organizationId,
      orderId,
      { officeId, now: plan.convertedAt },
    );
    assignmentId = assignment.id;
    summary.created.assignments += 1;
  } else {
    summary.existing.assignments += 1;
  }

  const state = states.get(assignmentId) ?? emptyState();
  await ensureTeam(context, order, plan, assignmentId, state);
  const partyIds = await ensureParties(context, order, plan, assignmentId, state);
  await ensureProperty(context, order, plan, assignmentId, existing);
  await ensureCommonAreas(context, order, plan, assignmentId, state);
  await ensureSchedule(context, order, plan, assignmentId, existing);
  await ensureBuildings(context, order, plan, assignmentId, state);
  const status = await ensureStatus(context, order, plan, assignmentId, state, existing);
  await ensureWorkSessions(context, plan, assignmentId, state, status);
  const claimId = await ensureClaim(context, plan, assignmentId, state, partyIds, status);
  await alignEventTimes(context, orderId, assignmentId, order, plan);
  await alignRowTimes(context, assignmentId, plan, claimId);
  return true;
}

async function ensureTeam(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
) {
  const members: [TeamRole, string][] = [
    ["responsible", plan.responsibleKey],
    ["peer_reviewer", plan.secondKey],
    ["office", order.createdByKey],
  ];
  for (const [teamRole, key] of members) {
    // En rolle som har hatt noen (også avsluttet eller fjernet), røres ikke
    if (state.teamRoles.has(teamRole)) {
      context.summary.existing.teamMembers += 1;
      continue;
    }
    await setTeamMember(
      actorOf(context, order.createdByKey),
      context.organizationId,
      assignmentId,
      {
        teamRole,
        employeeId: employeeOf(context, key).employeeId,
        now: plan.convertedAt,
      },
    );
    context.summary.created.teamMembers += 1;
  }
}

/** Partene, hver for seg på rolle og navn. Gir id-en per rolle (til klageren). */
async function ensureParties(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
): Promise<Map<string, string>> {
  const byRole = new Map<string, string>();
  for (const party of plan.parties) {
    const key = `${party.role}|${party.name}`;
    const found = state.parties.get(key);
    if (found !== undefined) {
      if (found !== "" && !byRole.has(party.role)) byRole.set(party.role, found);
      context.summary.existing.parties += 1;
      continue;
    }
    const { contactKey, ...input } = party;
    const created = await addParty(
      actorOf(context, order.createdByKey),
      context.organizationId,
      assignmentId,
      {
        ...input,
        contactId: contactIdOf(context, contactKey),
      },
    );
    if (!byRole.has(party.role)) byRole.set(party.role, created.id);
    context.summary.created.parties += 1;
  }
  return byRole;
}

async function ensureProperty(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  existing: TestdataOrderRow | undefined,
) {
  const { summary } = context;
  const property = plan.property;
  const known = existing?.propertyId != null || context.propertyKeys.has(property.key);
  if (known) {
    summary.existing.properties += 1;
  } else {
    await saveAssignmentProperty(
      actorOf(context, order.createdByKey),
      context.organizationId,
      assignmentId,
      {
        address: property.address,
        postalCode: property.postalCode,
        city: property.city,
        municipalityNumber: property.municipalityNumber,
        municipalityName: property.municipalityName,
        housingType: property.housingType,
        ownershipForm: property.ownershipForm,
        gnr: property.gnr,
        bnr: property.bnr,
        fnr: property.fnr,
        snr: property.snr,
        associationName: property.associationName,
        associationOrgNumber: property.associationOrgNumber,
        shareNumber: property.shareNumber,
      },
    );
    summary.created.properties += 1;
  }
}

/** Fellesdelene ligger på oppdraget og sjekkes for seg (bare sameie og borettslag). */
async function ensureCommonAreas(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
) {
  if (plan.commonAreas === null) return;
  if (state.hasCommonAreas) {
    context.summary.existing.commonAreas += 1;
    return;
  }
  await saveCommonAreas(
    actorOf(context, order.createdByKey),
    context.organizationId,
    assignmentId,
    {
      ...plan.commonAreas,
    },
  );
  context.summary.created.commonAreas += 1;
}

/** Befaring, frist og notat settes bare når feltene er tomme (ellers har noen satt dem). */
async function ensureSchedule(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  existing: TestdataOrderRow | undefined,
) {
  const actor = actorOf(context, order.createdByKey);
  const hasSchedule = plan.inspectionAt !== null || plan.dueDate !== null;
  if (hasSchedule) {
    if (existing && (existing.inspectionAt !== null || existing.dueDate !== null)) {
      context.summary.existing.schedules += 1;
    } else {
      await setAssignmentSchedule(actor, context.organizationId, assignmentId, {
        inspectionAt: plan.inspectionAt,
        dueDate: plan.dueDate,
      });
      context.summary.created.schedules += 1;
    }
  }
  if (plan.internalNote !== null && (existing?.internalNote ?? null) === null) {
    await updateAssignmentNote(actor, context.organizationId, assignmentId, plan.internalNote);
  }
}

/** Bygninger, etasjer, areal og rom. Finnes en bygning på oppdraget, hoppes hele treet over. */
async function ensureBuildings(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
) {
  const { summary, organizationId } = context;
  if (plan.buildings.length === 0) return;
  const floorCount = plan.buildings.reduce((sum, b) => sum + b.floors.length, 0);
  const roomCount = plan.buildings.reduce(
    (sum, b) => sum + b.floors.reduce((inner, f) => inner + f.rooms.length, 0),
    0,
  );
  if (state.hasBuilding) {
    summary.existing.buildings += plan.buildings.length;
    summary.existing.floors += floorCount;
    summary.existing.rooms += roomCount;
    return;
  }
  const actor = inspectorActor(context, plan.responsibleKey, order.createdByKey);
  const measuredBy = context.employees.get(plan.responsibleKey);
  for (const building of plan.buildings) {
    const savedBuilding = await saveBuilding(actor, organizationId, assignmentId, null, {
      name: building.name,
    });
    summary.created.buildings += 1;
    for (const floor of building.floors) {
      const savedFloor = await saveFloor(actor, organizationId, savedBuilding.id, null, {
        name: floor.name,
        level: floor.level,
        belowGround: floor.belowGround,
      });
      summary.created.floors += 1;
      if (floor.area !== null) {
        await saveFloorArea(actor, organizationId, savedFloor.id, {
          braI: floor.area.braI,
          braE: floor.area.braE,
          braB: floor.area.braB,
          alh: floor.area.alh,
          method: floor.area.method,
          comment: null,
          measuredBy: measuredBy?.available ? measuredBy.employeeId : null,
        });
        summary.created.floorAreas += 1;
      }
      for (const room of floor.rooms) {
        await saveRoom(actor, organizationId, savedFloor.id, null, {
          roomType: room.roomType,
          name: room.name,
          areaType: room.areaType,
          belowGround: room.belowGround,
        });
        summary.created.rooms += 1;
      }
    }
  }
}

/**
 * Statusbyttene i planen, ett steg om gangen gjennom gyldige overganger. Et bytte som har en
 * hendelse på oppdraget, er gjort. Står oppdraget i en annen status enn forventet (noen har endret
 * det), stopper byttene. Gir statusen oppdraget står i etterpå.
 */
async function ensureStatus(
  context: Context,
  order: TestdataOrder,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
  existing: TestdataOrderRow | undefined,
): Promise<string> {
  let current = existing?.assignmentStatus ?? "ordered";
  for (const change of plan.statusTimes) {
    if (state.statusEvents.has(change.toStatus)) {
      context.summary.existing.statusChanges += 1;
      continue;
    }
    const from = STATUS_PATH[STATUS_PATH.indexOf(change.toStatus) - 1];
    if (from === undefined || current !== from) break;
    const result = await changeAssignmentStatus(
      inspectorActor(context, plan.responsibleKey, order.createdByKey),
      context.organizationId,
      assignmentId,
      { expectedStatus: from, toStatus: change.toStatus, now: change.at },
    );
    current = result.status;
    context.summary.created.statusChanges += 1;
  }
  return current;
}

/** Arbeidsøktene (direkte, bare oppdiktede ansatte). Har oppdraget økter, hoppes de over. */
async function ensureWorkSessions(
  context: Context,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
  status: string,
) {
  if (plan.workSessions.length === 0) return;
  if (state.hasWorkSessions) {
    context.summary.existing.workSessions += plan.workSessions.length;
    return;
  }
  if (status !== "completed" && status !== "invoiced") return;
  const rows = plan.workSessions.map((session) => {
    const employee = context.employees.get(session.employeeKey);
    if (!employee) throw new ActorUnavailableError();
    return {
      organizationId: context.organizationId,
      assignmentId,
      employeeId: employee.employeeId,
      createdBy: employee.employeeId,
      phase: session.phase,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      createdAt: session.endedAt,
      updatedAt: session.endedAt,
    };
  });
  await context.db.insert(workSessions).values(rows);
  context.summary.created.workSessions += rows.length;
}

/**
 * Reklamasjonen: registreres åpen av lederen, og lukkes med utfallet senere. Har oppdraget en sak,
 * lages ingen ny. En åpen sak som bare lederen har endret, lukkes hvis planen sier det (avbrutt
 * kjøring). Gir id-en til saken.
 */
async function ensureClaim(
  context: Context,
  plan: TestdataAssignment,
  assignmentId: string,
  state: AssignmentState,
  partyIds: Map<string, string>,
  status: string,
): Promise<string | null> {
  const claim = plan.claim;
  if (claim === null) return null;
  const { organizationId, summary } = context;
  const input = {
    claimType: claim.claimType,
    receivedAt: claim.receivedAt,
    claimantPartyId: partyIds.get(claim.claimantPartyRole) ?? null,
    claimantText: null,
    description: claim.description,
    buildingPartText: claim.buildingPartText,
  };

  let claimId: string;
  let untouchedOpen: boolean;
  const manager = employeeOf(context, claim.createdByKey);
  if (state.claim) {
    summary.existing.claims += 1;
    claimId = state.claim.id;
    untouchedOpen =
      state.claim.outcome === "open" &&
      state.claim.createdBy === manager.employeeId &&
      (state.claim.updatedBy === null || state.claim.updatedBy === manager.employeeId);
  } else {
    if (status !== "completed" && status !== "invoiced") return null;
    const created = await createClaim(
      manager.actor,
      organizationId,
      assignmentId,
      { ...input, outcome: "open", amount: null },
      claim.registeredAt,
    );
    claimId = created.id;
    untouchedOpen = true;
    summary.created.claims += 1;
  }

  if (claim.outcome !== "open" && claim.closedAt !== null && untouchedOpen) {
    await updateClaim(
      manager.actor,
      organizationId,
      claimId,
      { ...input, outcome: claim.outcome, amount: claim.amount },
      claim.closedAt,
    );
  }
  return claimId;
}

// ---------------------------------------------------------------------------------------------
// Domenetidspunktene flyttes til planlagt tid (bare testdata-rader, bare når de er ulike)
// ---------------------------------------------------------------------------------------------

/**
 * `events.occurred_at` på hendelsene som de oppdiktede ansatte har laget for ordren og oppdraget.
 * Andre ansattes hendelser røres aldri. Statusbytter får tiden for byttet, målingene
 * befaringstiden, og resten tiden ordren ble gjort om.
 */
/** Tidspunkt som parameter med fast type i SQL. */
const iso = (date: Date): SQL => sql`${date.toISOString()}::timestamptz`;

async function alignEventTimes(
  context: Context,
  orderId: string,
  assignmentId: string | null,
  order: TestdataOrder,
  plan: TestdataAssignment | null,
) {
  if (context.employeeIds.length === 0) return;
  const cases: SQL[] = [sql`when ${events.type} = 'order.received' then ${iso(order.receivedAt)}`];
  if (plan) {
    for (const change of plan.statusTimes) {
      cases.push(
        sql`when ${events.type} = 'assignment.status_changed' and ${events.data} ->> 'to' = ${change.toStatus} then ${iso(change.at)}`,
      );
    }
    cases.push(
      sql`when ${events.type} in (${sql.join(
        MEASUREMENT_EVENTS.map((type) => sql`${type}`),
        sql`, `,
      )}) then ${iso(plan.inspectionAt ?? plan.convertedAt)}`,
    );
    if (plan.claim) {
      cases.push(
        sql`when ${events.type} = 'claim.registered' then ${iso(plan.claim.registeredAt)}`,
      );
    }
  }
  const fallback = plan?.convertedAt ?? order.receivedAt;
  const target = sql`(case ${sql.join(cases, sql` `)} else ${iso(fallback)} end)`;
  const belongs =
    assignmentId === null
      ? sql`${events.assignmentId} is null and ${events.data} ->> 'orderId' = ${orderId}`
      : sql`(${events.assignmentId} = ${assignmentId} or (${events.assignmentId} is null and ${events.data} ->> 'orderId' = ${orderId}))`;
  await context.db
    .update(events)
    .set({ occurredAt: target })
    .where(
      and(
        eq(events.organizationId, context.organizationId),
        inArray(events.actorId, context.employeeIds),
        belongs,
        sql`${events.occurredAt} is distinct from ${target}`,
      ),
    );
}

/** `orders.created_at` får mottatt-tiden. Ankeret leses senere fra den på `TD-0001`. */
async function alignOrderTime(context: Context, orderId: string, order: TestdataOrder) {
  await context.db
    .update(orders)
    .set({ createdAt: order.receivedAt })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.organizationId, context.organizationId),
        inArray(orders.createdBy, context.employeeIds),
        sql`${orders.createdAt} is distinct from ${iso(order.receivedAt)}`,
      ),
    );
}

/** `assignments.created_at` (omgjort) og `claims.created_at` (registrert). */
async function alignRowTimes(
  context: Context,
  assignmentId: string,
  plan: TestdataAssignment,
  claimId: string | null,
) {
  const { db, organizationId } = context;
  await db
    .update(assignments)
    .set({ createdAt: plan.convertedAt })
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, organizationId),
        inArray(assignments.createdBy, context.employeeIds),
        sql`${assignments.createdAt} is distinct from ${iso(plan.convertedAt)}`,
      ),
    );
  if (claimId !== null && plan.claim) {
    await db
      .update(claims)
      .set({ createdAt: plan.claim.registeredAt })
      .where(
        and(
          eq(claims.id, claimId),
          eq(claims.organizationId, organizationId),
          inArray(claims.createdBy, context.employeeIds),
          sql`${claims.createdAt} is distinct from ${iso(plan.claim.registeredAt)}`,
        ),
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Inngangen
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Ankeret fra `created_at` på `TD-0001`. Den får mottatt-tiden fra planen rett etter at den er
 * laget, og den ligger alltid like langt fra midnatt (UTC) på ankerdagen, uansett anker. Derfor
 * gir `created_at` minus den avstanden ankerdagen. Er resultatet ikke midnatt, ble kjøringen
 * avbrutt før tiden ble flyttet, og `created_at` (tiden ordren ble laget) er ankeret.
 */
export function anchorFromCreatedAt(createdAt: Date, seed: number): Date {
  const probe = buildTestdataPlan({ seed, anchor: createdAt });
  const first = probe.orders.find((order) => order.key === `${TESTDATA_ORDER_PREFIX}0001`);
  if (!first) return createdAt;
  const probeBase = Date.UTC(
    createdAt.getUTCFullYear(),
    createdAt.getUTCMonth(),
    createdAt.getUTCDate(),
  );
  const base = createdAt.getTime() - (first.receivedAt.getTime() - probeBase);
  return base % DAY_MS === 0 ? new Date(base) : createdAt;
}

/**
 * Legger testdataene i Byggcon-organisasjonen. `now` er dagens tid (ankeret når `TD-0001` ikke
 * finnes), `seed` frøet for planen. Kaster `TestdataNotAllowedError` (vakten),
 * `TestdataSetupError` (oppsett) eller `TestdataStepError` (feil midt i et steg).
 */
export async function seedTestdata({
  db,
  now,
  seed,
}: {
  db: Db;
  now: Date;
  seed: number;
}): Promise<TestdataSummary> {
  // (a) Vakten før noe databasekall eller transaksjon
  assertTestdataAllowed();

  // (b) Byggcon må finnes
  const organization = await findOrganization(db);
  if (!organization) throw new TestdataSetupError(TESTDATA_ORGANIZATION_MISSING_MESSAGE);
  const organizationId = organization.id;

  // (d, e) Ankeret er `created_at` på TD-0001 i Byggcon, ellers nå. Så planen.
  const anchorOrder = await findAnchorOrder(db, organizationId);
  const plan = buildTestdataPlan({
    seed,
    anchor: anchorOrder ? anchorFromCreatedAt(anchorOrder.createdAt, seed) : now,
  });

  // (c) En TD-e-post som er ansatt i en annen organisasjon stopper alt før første skriving
  const emails = plan.employees.map((employee) => employee.email);
  if (await hasUserInOtherOrganization(db, organizationId, emails)) {
    throw new TestdataSetupError(TESTDATA_USER_CONFLICT_MESSAGE);
  }

  const summary: TestdataSummary = {
    created: emptyCounts(),
    existing: emptyCounts(),
    skippedOrders: [],
  };

  // (f) Skrivingen
  let currentKey = "ansatte";
  try {
    const employeeEntries = await ensureEmployees(db, organizationId, plan, summary);
    const officeRows = await db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.organizationId, organizationId), isNull(offices.deletedAt)))
      .orderBy(asc(offices.createdAt), asc(offices.id));
    const officeIds = new Map<string, string>();
    for (const row of officeRows) if (!officeIds.has(row.name)) officeIds.set(row.name, row.id);

    const context: Context = {
      db,
      organizationId,
      plan,
      inspectorsCanEdit: readInspectorsEditAll(organizationId, organization.settings),
      employees: employeeEntries,
      employeeIds: [...employeeEntries.values()].map((entry) => entry.employeeId),
      officeIds,
      firmIds: new Map(),
      contactIds: new Map(),
      propertyKeys: new Set(),
      summary,
    };

    currentKey = "firma";
    await ensureFirms(context, plan.firms);
    currentKey = "kontakter";
    await ensureContacts(context, plan.contacts);

    currentKey = "ordre";
    const existingOrders = new Map<string, TestdataOrderRow>();
    for (const row of await findTestdataOrders(
      db,
      organizationId,
      plan.orders.map((order) => order.externalRef),
    )) {
      if (row.externalRef !== null && !existingOrders.has(row.externalRef)) {
        existingOrders.set(row.externalRef, row);
      }
    }
    const planProperties = plan.orders.flatMap((order) =>
      order.converted ? [order.converted.assignment.property] : [],
    );
    for (const row of await findTestdataProperties(db, organizationId, planProperties)) {
      context.propertyKeys.add(row.key);
    }
    const states = await loadAssignmentState(
      db,
      organizationId,
      [...existingOrders.values()].flatMap((row) => (row.assignmentId ? [row.assignmentId] : [])),
    );

    for (const order of plan.orders) {
      currentKey = order.key;
      try {
        const done = await ensureOrder(
          context,
          order,
          existingOrders.get(order.externalRef),
          states,
        );
        if (!done) summary.skippedOrders.push(order.key);
      } catch (error) {
        if (error instanceof ActorUnavailableError) {
          summary.skippedOrders.push(order.key);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof TestdataSetupError || error instanceof TestdataStepError) throw error;
    throw new TestdataStepError(currentKey, error);
  }
  return summary;
}
