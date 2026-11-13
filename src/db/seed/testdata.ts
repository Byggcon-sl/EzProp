import { and, asc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
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
import { createClaim } from "@/core/claims";
import { createContact, createFirm } from "@/core/contacts";
import { convertOrderToAssignment, createOrder } from "@/core/orders";
import { saveAssignmentProperty, saveCommonAreas } from "@/core/properties";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
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
import { addDays, parseOsloDateTime, todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import { createSeededRandom } from "./seeded-random";
import {
  TESTDATA_EMAIL_DOMAIN,
  TESTDATA_EMPLOYEES,
  TESTDATA_FIRMS,
  TESTDATA_GNR_RANGE,
  TESTDATA_MUNICIPALITIES,
  TESTDATA_ORDERS,
  TESTDATA_PROPERTIES,
  TESTDATA_SEED,
  testdataPropertyInput,
  type TestdataEmployee,
  type TestdataOrder,
  type TestdataProperty,
} from "./testdata.data";
import { assertTestdataAllowed } from "./testdata-guard";

/*
 * `pnpm db:seed:testdata`: oppdiktede testdata som ligner en ekte arbeidshverdag, i organisasjonen
 * fra `pnpm db:seed` (docs/funksjoner/fase2a-testdata-arbeidshverdag.md). Kan kjøres flere ganger.
 *
 * - Produksjonsvakten (`assertTestdataAllowed`) kjøres før noen spørring, transaksjon eller
 *   nummerserie.
 * - Grunndataene (brukere, ansatte, roller, sertifiseringer) legges inn direkte, som i `runSeed`,
 *   én transaksjon per ansatt. Firma, kontakter, ordre, oppdrag, team, parter, eiendom, bygninger,
 *   statusbytter og reklamasjoner lages gjennom tjenestene i `src/core`, med en oppdiktet ansatt
 *   med riktig rolle som aktør: kontoret lager firma, ordre og oppdrag, ansvarlig takstmann måler
 *   og bytter status, leder registrerer reklamasjoner. Admin fra `SEED_ADMIN_EMAIL` brukes bare
 *   til å lese (tilgangssjekken for oppslagene), aldri som aktør.
 * - Idempotent: hver del sjekkes først (også mykt slettede rader teller som «finnes»), og bare det
 *   som mangler, lages. Andre kjøring kaller ingen tjeneste som skriver. En avbrutt kjøring fylles
 *   ut av neste.
 * - Datoanker: datoen (Europe/Oslo) for `created_at` på Byggcons `TD-0001`, ellers `now`. Alle
 *   dager i datafila regnes fra ankeret, og klokkeslettene trekkes med fast frø.
 * - Tilbakedatering: tidspunktene tjenestene setter til «nå» (ordre, oppdrag, hendelser,
 *   revisjonslogg og reklamasjoner) flyttes til planlagt tid rett etter kallene for hver ordre, og
 *   en gang til til slutt (tåler avbrudd). Bare TD-rader laget av oppdiktede ansatte, og bare der
 *   verdien er ulik den planlagte. Er raden tilbakedatert fra før, røres den ikke.
 * - Ingenting slettes, og ingen rad uten TD-nøkkel endres, kobles til eller får roller.
 * - Loggen har bare antall og TD-nøkler, aldri navn, e-post, telefon, gate eller firmanavn.
 */

export class TestdataSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestdataSeedError";
  }
}

/** Tabellene (og statusbyttene) sammendraget teller. */
export const TESTDATA_SUMMARY_TABLES = [
  "users",
  "employees",
  "employee_roles",
  "certifications",
  "firms",
  "contacts",
  "orders",
  "assignments",
  "assignment_team_members",
  "assignment_parties",
  "properties",
  "common_areas",
  "report_buildings",
  "floors",
  "floor_areas",
  "rooms",
  "status_changes",
  "work_sessions",
  "claims",
] as const;
export type TestdataSummaryTable = (typeof TESTDATA_SUMMARY_TABLES)[number];

/** Resultatet for én ordre: noe laget nå, alt fantes fra før, eller hoppet over. */
export type TestdataOrderResult = "created" | "existing" | "skipped";

export type TestdataSummary = {
  /** Antall rader laget nå per tabell (`status_changes`: antall statusbytter). */
  created: Record<TestdataSummaryTable, number>;
  /**
   * Antall hoppet over per tabell: fantes fra før (også mykt slettet), eller kunne ikke lages
   * fordi det de hører til, er slettet.
   */
  skipped: Record<TestdataSummaryTable, number>;
  /** Resultatet per ordre, i fast rekkefølge. */
  orders: { externalRef: string; result: TestdataOrderResult }[];
  /** TD-nøklene i datafila, i fast rekkefølge. */
  keys: string[];
};

const RESULT_LABELS: Record<TestdataOrderResult, string> = {
  created: "laget",
  existing: "finnes fra før",
  skipped: "hoppet over",
};

const TD_REF_PATTERN = "TD-%";
const TD_EMAIL_PATTERN = `%@${TESTDATA_EMAIL_DOMAIN}`;
const CERTIFICATION_AREA = "condition_report";
/** Statusene i rekkefølge. «Fakturert» nås bare gjennom gyldige steg. */
const STATUS_PATH: readonly AssignmentStatus[] = [
  "ordered",
  "in_progress",
  "completed",
  "invoiced",
];
type ReachedStatus = Exclude<AssignmentStatus, "ordered">;

// ---------------------------------------------------------------------------------------------
// Oppslag («finnes fra før»). Alle filtrerer på `grant.organizationId` og tar med mykt slettede.
// ---------------------------------------------------------------------------------------------

export type TestdataOrderRow = {
  id: string;
  externalRef: string;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
  assignmentId: string | null;
  assignmentStatus: string | null;
  assignmentDeletedAt: Date | null;
  propertyId: string | null;
  inspectionAt: Date | null;
  dueDate: string | null;
};

/** Ordrene med `external_ref` som starter med `TD-`, med oppdraget (left join). */
export async function findTestdataOrders(grant: EmployeeGrant): Promise<TestdataOrderRow[]> {
  const organizationId = grant.organizationId;
  const rows = await db
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
    })
    .from(orders)
    .leftJoin(
      assignments,
      and(eq(assignments.id, orders.assignmentId), eq(assignments.organizationId, organizationId)),
    )
    .where(and(eq(orders.organizationId, organizationId), like(orders.externalRef, TD_REF_PATTERN)))
    .orderBy(asc(orders.createdAt), asc(orders.id));
  return rows.map((row) => ({ ...row, externalRef: row.externalRef ?? "" }));
}

export type TestdataEmployeeRow = {
  id: string;
  userId: string;
  email: string;
  name: string;
  deletedAt: Date | null;
  deactivatedAt: Date | null;
};

/** De ansatte i organisasjonen med e-post på `testdata.invalid`. */
export async function findTestdataEmployees(grant: EmployeeGrant): Promise<TestdataEmployeeRow[]> {
  const organizationId = grant.organizationId;
  return db
    .select({
      id: employees.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      deletedAt: employees.deletedAt,
      deactivatedAt: employees.deactivatedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.organizationId, organizationId), like(users.email, TD_EMAIL_PATTERN)))
    .orderBy(asc(employees.createdAt), asc(employees.id));
}

export type TestdataFirmRow = {
  id: string;
  name: string;
  firmType: string;
  deletedAt: Date | null;
};

/** Firmaene i organisasjonen med navn fra den faste lista i datafila. */
export async function findTestdataFirms(grant: EmployeeGrant): Promise<TestdataFirmRow[]> {
  const names = TESTDATA_FIRMS.map((firm) => firm.name);
  return db
    .select({
      id: firms.id,
      name: firms.name,
      firmType: firms.firmType,
      deletedAt: firms.deletedAt,
    })
    .from(firms)
    .where(and(eq(firms.organizationId, grant.organizationId), inArray(firms.name, names)))
    .orderBy(asc(firms.createdAt), asc(firms.id));
}

export type TestdataContactRow = { id: string; email: string; deletedAt: Date | null };

/** Kontaktene i organisasjonen med e-post på `testdata.invalid`. */
export async function findTestdataContacts(grant: EmployeeGrant): Promise<TestdataContactRow[]> {
  const rows = await db
    .select({ id: contacts.id, email: contacts.email, deletedAt: contacts.deletedAt })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, grant.organizationId),
        like(contacts.email, TD_EMAIL_PATTERN),
      ),
    )
    .orderBy(asc(contacts.createdAt), asc(contacts.id));
  return rows.map((row) => ({ ...row, email: row.email ?? "" }));
}

export type TestdataPropertyRow = {
  id: string;
  /** Kommune + gnr + bnr + fnr + snr, som `propertyKey` gir for datafila. */
  key: string;
  deletedAt: Date | null;
};

/** Eiendommene i organisasjonen med gårdsnummer i testdataenes serie (9001–9099). */
export async function findTestdataProperties(grant: EmployeeGrant): Promise<TestdataPropertyRow[]> {
  const organizationId = grant.organizationId;
  const [from, to] = TESTDATA_GNR_RANGE;
  const rows = await db
    .select({
      id: properties.id,
      municipalityNumber: properties.municipalityNumber,
      gnr: cadastralUnits.gnr,
      bnr: cadastralUnits.bnr,
      fnr: cadastralUnits.fnr,
      snr: cadastralUnits.snr,
      deletedAt: properties.deletedAt,
    })
    .from(properties)
    .innerJoin(
      cadastralUnits,
      and(
        eq(cadastralUnits.propertyId, properties.id),
        eq(cadastralUnits.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(properties.organizationId, organizationId),
        // Gnr er tekst; bare sifre gjøres om til tall (CASE, så rekkefølgen er sikker)
        sql`(case when ${cadastralUnits.gnr} ~ '^[0-9]{1,10}$' then ${cadastralUnits.gnr}::bigint end) between ${from} and ${to}`,
      ),
    )
    .orderBy(asc(properties.createdAt), asc(properties.id));
  return rows.map((row) => ({
    id: row.id,
    key: propertyKey({
      municipalityNumber: row.municipalityNumber ?? "",
      gnr: row.gnr,
      bnr: row.bnr,
      fnr: row.fnr ?? undefined,
      snr: row.snr ?? undefined,
    }),
    deletedAt: row.deletedAt,
  }));
}

/** Delene som allerede finnes på TD-oppdragene (også fjernede). Én spørring per tabell. */
export type TestdataAssignmentParts = {
  teamRoles: Map<string, Set<string>>;
  withParties: Set<string>;
  withCommonAreas: Set<string>;
  withBuildings: Set<string>;
  withWorkSessions: Set<string>;
  withClaims: Set<string>;
  /** Statusene oppdraget er flyttet til (hendelsen `assignment.status_changed`). */
  reachedStatuses: Map<string, Set<string>>;
};

/** Leser delene på oppdragene `assignmentIds` i organisasjonen fra tilgangssjekken. */
export async function findTestdataAssignmentParts(
  grant: EmployeeGrant,
  assignmentIds: readonly string[],
): Promise<TestdataAssignmentParts> {
  const organizationId = grant.organizationId;
  const parts: TestdataAssignmentParts = {
    teamRoles: new Map(),
    withParties: new Set(),
    withCommonAreas: new Set(),
    withBuildings: new Set(),
    withWorkSessions: new Set(),
    withClaims: new Set(),
    reachedStatuses: new Map(),
  };
  if (assignmentIds.length === 0) return parts;
  const ids = [...assignmentIds];

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
      .selectDistinct({ assignmentId: assignmentParties.assignmentId })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, organizationId),
          inArray(assignmentParties.assignmentId, ids),
        ),
      ),
    db
      .selectDistinct({ assignmentId: commonAreas.assignmentId })
      .from(commonAreas)
      .where(
        and(eq(commonAreas.organizationId, organizationId), inArray(commonAreas.assignmentId, ids)),
      ),
    db
      .selectDistinct({ assignmentId: reportBuildings.assignmentId })
      .from(reportBuildings)
      .where(
        and(
          eq(reportBuildings.organizationId, organizationId),
          inArray(reportBuildings.assignmentId, ids),
        ),
      ),
    db
      .selectDistinct({ assignmentId: workSessions.assignmentId })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, organizationId),
          inArray(workSessions.assignmentId, ids),
        ),
      ),
    db
      .selectDistinct({ assignmentId: claims.assignmentId })
      .from(claims)
      .where(and(eq(claims.organizationId, organizationId), inArray(claims.assignmentId, ids))),
    db
      .select({
        assignmentId: events.assignmentId,
        to: sql<string | null>`${events.data} ->> 'to'`,
      })
      .from(events)
      .where(
        and(
          eq(events.organizationId, organizationId),
          eq(events.type, "assignment.status_changed"),
          inArray(events.assignmentId, ids),
        ),
      ),
  ]);

  for (const row of team) {
    const roles = parts.teamRoles.get(row.assignmentId) ?? new Set<string>();
    roles.add(row.role);
    parts.teamRoles.set(row.assignmentId, roles);
  }
  for (const row of parties) parts.withParties.add(row.assignmentId);
  for (const row of common) parts.withCommonAreas.add(row.assignmentId);
  for (const row of buildings) parts.withBuildings.add(row.assignmentId);
  for (const row of sessions) parts.withWorkSessions.add(row.assignmentId);
  for (const row of claimRows) parts.withClaims.add(row.assignmentId);
  for (const row of statusRows) {
    if (row.assignmentId === null || row.to === null) continue;
    const reached = parts.reachedStatuses.get(row.assignmentId) ?? new Set<string>();
    reached.add(row.to);
    parts.reachedStatuses.set(row.assignmentId, reached);
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Plan: datoer og klokkeslett fra ankeret og det faste frøet
// ---------------------------------------------------------------------------------------------

type OrderPlan = {
  order: TestdataOrder;
  property: TestdataProperty | null;
  received: Date;
  converted: Date;
  /** Team, parter, eiendom, fellesdeler, befaringstid og notat. */
  setup: Date;
  inspectionAt: Date | null;
  dueDate: string | null;
  /** Bygninger, etasjer, areal og rom (under befaringen). */
  measured: Date | null;
  statusAt: Partial<Record<ReachedStatus, Date>>;
  claimAt: Date | null;
  claimDate: string | null;
};

function minutesToClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function clockToMinutes(clock: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`testdata: ugyldig klokkeslett ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Tidspunktet `day` dager fra ankeret, klokka `minutes` etter midnatt i Europe/Oslo. */
function osloAt(anchor: string, day: number, minutes: number): Date {
  const parsed = parseOsloDateTime(`${addDays(anchor, day)}T${minutesToClock(minutes)}`);
  if (!parsed) throw new Error("testdata: ugyldig dato fra ankeret");
  return parsed;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function propertyKey(value: {
  municipalityNumber: string;
  gnr: string;
  bnr: string;
  fnr?: string | undefined;
  snr?: string | undefined;
}): string {
  return [value.municipalityNumber, value.gnr, value.bnr, value.fnr ?? "", value.snr ?? ""].join(
    "|",
  );
}

/**
 * Planen for alle ordrene. Generatoren trekker like mange tall for hver ordre i fast rekkefølge,
 * så planen er den samme uansett hvilke deler som finnes fra før.
 */
function buildPlans(anchor: string): OrderPlan[] {
  const random = createSeededRandom(TESTDATA_SEED);
  const propertiesByKey = new Map(TESTDATA_PROPERTIES.map((item) => [item.key, item]));
  return TESTDATA_ORDERS.map((order) => {
    const receivedDraw = random.int(0, 48);
    const convertDraw = random.int(3, 24);
    const measureDraw = random.int(12, 24);
    const completedDraw = random.int(0, 18);
    const invoicedDraw = random.int(0, 24);
    const claimDraw = random.int(0, 36);

    // Ordre fra ankerdagen kom tidlig om morgenen, de andre mellom 07.30 og 11.30
    const receivedMinutes =
      order.createdDay >= 0 ? 7 * 60 + (receivedDraw % 7) * 5 : 7 * 60 + 30 + receivedDraw * 5;
    const received = osloAt(anchor, order.createdDay, receivedMinutes);
    const converted = addMinutes(received, convertDraw * 5);
    const setup = addMinutes(converted, 5);

    const property =
      order.propertyKey === undefined ? null : (propertiesByKey.get(order.propertyKey) ?? null);
    if (order.propertyKey !== undefined && property === null) {
      throw new Error(`testdata: ukjent eiendom for ${order.externalRef}`);
    }

    const inspectionAt =
      order.inspectionDay !== undefined && order.inspectionTime !== undefined
        ? osloAt(anchor, order.inspectionDay, clockToMinutes(order.inspectionTime))
        : null;
    const statusAt: Partial<Record<ReachedStatus, Date>> = {};
    if (order.startedDay !== undefined) {
      statusAt.in_progress = osloAt(
        anchor,
        order.startedDay,
        clockToMinutes(order.inspectionTime ?? "09:00"),
      );
    }
    if (order.completedDay !== undefined) {
      statusAt.completed = osloAt(anchor, order.completedDay, 14 * 60 + completedDraw * 5);
    }
    if (order.invoicedDay !== undefined) {
      statusAt.invoiced = osloAt(anchor, order.invoicedDay, 9 * 60 + invoicedDraw * 5);
    }

    return {
      order,
      property,
      received,
      converted,
      setup,
      inspectionAt,
      dueDate: order.dueDay === undefined ? null : addDays(anchor, order.dueDay),
      measured: inspectionAt === null ? null : addMinutes(inspectionAt, measureDraw * 5),
      statusAt,
      claimAt:
        order.claim === undefined
          ? null
          : osloAt(anchor, order.claim.receivedDay, 9 * 60 + claimDraw * 5),
      claimDate: order.claim === undefined ? null : addDays(anchor, order.claim.receivedDay),
    };
  });
}

function targetIndex(order: TestdataOrder): number {
  return order.target === "order_only" ? -1 : STATUS_PATH.indexOf(order.target);
}

/** Siste planlagte tidspunkt på oppdraget (siste statusbytte, ellers oppsettet). */
function lastAssignmentTime(plan: OrderPlan): Date {
  const times = Object.values(plan.statusAt).map((date) => date.getTime());
  return new Date(Math.max(plan.setup.getTime(), ...times));
}

// ---------------------------------------------------------------------------------------------
// Sammendrag og logg
// ---------------------------------------------------------------------------------------------

function emptyCounts(): Record<TestdataSummaryTable, number> {
  return Object.fromEntries(TESTDATA_SUMMARY_TABLES.map((table) => [table, 0])) as Record<
    TestdataSummaryTable,
    number
  >;
}

class Counter {
  readonly created = emptyCounts();
  readonly skipped = emptyCounts();
  add(table: TestdataSummaryTable, created: boolean, count = 1) {
    if (created) this.created[table] += count;
    else this.skipped[table] += count;
  }
}

function buildingCounts(property: TestdataProperty | null) {
  const buildings = property?.buildings ?? [];
  const floorList = buildings.flatMap((building) => building.floors);
  return {
    buildings: buildings.length,
    floors: floorList.length,
    rooms: floorList.reduce((sum, item) => sum + item.rooms.length, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Organisasjonen og grunndata
// ---------------------------------------------------------------------------------------------

type SeedEmployee = {
  data: TestdataEmployee;
  id: string;
  actor: Actor;
  active: boolean;
};

type SeedContext = {
  organizationId: string;
  /** Admin, bare til oppslagene (lesing). Aldri aktør. */
  readGrant: EmployeeGrant;
  anchor: string;
  employees: Map<string, SeedEmployee>;
  officeIds: Map<string, string>;
  /** Aktive kontakter (e-post → id) som parter og ordre kan kobles til. */
  contactIds: Map<string, string>;
  counter: Counter;
};

/** Organisasjonen fra `pnpm db:seed`: der admin fra `SEED_ADMIN_EMAIL` er ansatt, aldri prøveorganisasjonen. */
async function findSeedOrganization(env: Record<string, string | undefined>) {
  const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new TestdataSeedError("SEED_ADMIN_EMAIL mangler. Kjør pnpm db:seed først.");
  }
  const rows = await db
    .select({
      organizationId: organizations.id,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .innerJoin(employees, eq(employees.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(
        eq(users.email, adminEmail),
        eq(organizations.name, brand.companyName),
        isNull(organizations.deletedAt),
        isNull(employees.deletedAt),
        sql`coalesce(${organizations.settings} -> 'sampleData', 'false'::jsonb) <> 'true'::jsonb`,
      ),
    );
  if (rows.length === 0) {
    throw new TestdataSeedError(
      "Fant ikke organisasjonen fra pnpm db:seed med admin som ansatt. Kjør pnpm db:seed først. Ingenting er skrevet.",
    );
  }
  if (rows.length > 1) {
    throw new TestdataSeedError(
      "Fant flere organisasjoner med samme navn der admin er ansatt. Ingenting er skrevet.",
    );
  }
  const [row] = rows;
  if (!row) throw new TestdataSeedError("Fant ikke organisasjonen. Ingenting er skrevet.");
  const admin: Actor = { id: row.userId, email: row.email, name: row.name };
  const readGrant = await requireOrganizationAccess(admin, row.organizationId, "organization.read");
  return { organizationId: readGrant.organizationId, readGrant };
}

/** Datoankeret: datoen for `created_at` på Byggcons `TD-0001`, ellers `now`. */
function findAnchor(existingOrders: readonly TestdataOrderRow[], now: Date): string {
  const first = TESTDATA_ORDERS[0];
  const anchorOrder = existingOrders.find((row) => row.externalRef === first?.externalRef);
  return todayInOslo(anchorOrder?.createdAt ?? now);
}

async function lookupStructure(organizationId: string) {
  const companyNames = [...new Set(TESTDATA_EMPLOYEES.map((item) => item.companyName))];
  const officeNames = [...new Set(TESTDATA_EMPLOYEES.map((item) => item.officeName))];
  const [companyRows, officeRows] = await Promise.all([
    db
      .select({ id: companies.id, name: companies.legalName })
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, organizationId),
          inArray(companies.legalName, companyNames),
          isNull(companies.deletedAt),
        ),
      ),
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(
        and(
          eq(offices.organizationId, organizationId),
          inArray(offices.name, officeNames),
          isNull(offices.deletedAt),
        ),
      ),
  ]);
  const companyIds = new Map(companyRows.map((row) => [row.name, row.id]));
  const officeIds = new Map(officeRows.map((row) => [row.name, row.id]));
  const missing =
    companyNames.some((name) => !companyIds.has(name)) ||
    officeNames.some((name) => !officeIds.has(name));
  if (missing) {
    throw new TestdataSeedError(
      "Selskapene eller kontorene fra pnpm db:seed mangler. Kjør pnpm db:seed først.",
    );
  }
  return { companyIds, officeIds };
}

/**
 * De oppdiktede ansatte. Bruker, ansatt, roller og sertifisering lages i én transaksjon per
 * ansatt, så en avbrutt kjøring aldri gir en ansatt uten roller. Finnes den ansatte (også mykt
 * slettet eller deaktivert), røres den ikke. Finnes brukeren fra før, brukes den uten endring.
 */
async function ensureEmployees(
  readGrant: EmployeeGrant,
  anchor: string,
  now: Date,
  counter: Counter,
): Promise<{ employees: Map<string, SeedEmployee>; officeIds: Map<string, string> }> {
  const organizationId = readGrant.organizationId;
  const { companyIds, officeIds } = await lookupStructure(organizationId);
  const existing = new Map(
    (await findTestdataEmployees(readGrant)).map((row) => [row.email.toLowerCase(), row]),
  );
  const emails = TESTDATA_EMPLOYEES.map((item) => item.email.toLowerCase());
  const existingUsers = new Map(
    (
      await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(inArray(users.email, emails))
    ).map((row) => [row.email, row]),
  );

  const result = new Map<string, SeedEmployee>();
  for (const data of TESTDATA_EMPLOYEES) {
    const email = data.email.toLowerCase();
    const found = existing.get(email);
    if (found) {
      counter.add("users", false);
      counter.add("employees", false);
      counter.add("employee_roles", false, data.roles.length);
      if (data.certification) counter.add("certifications", false);
      result.set(data.key, {
        data,
        id: found.id,
        actor: { id: found.userId, email: found.email, name: found.name },
        active: found.deletedAt === null && found.deactivatedAt === null,
      });
      continue;
    }

    const companyId = companyIds.get(data.companyName) ?? null;
    const officeId = officeIds.get(data.officeName) ?? null;
    const knownUser = existingUsers.get(email);
    const created = await db.transaction(async (tx) => {
      let user = knownUser;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ id: uuidv7(now.getTime()), email, name: data.name })
          .returning({ id: users.id, email: users.email, name: users.name });
      }
      if (!user) throw new Error("testdata: kunne ikke lage brukeren");
      const [employee] = await tx
        .insert(employees)
        .values({ organizationId, userId: user.id, name: data.name, companyId, officeId })
        .returning({ id: employees.id });
      if (!employee) throw new Error("testdata: kunne ikke lage den ansatte");
      await tx
        .insert(employeeRoleAssignments)
        .values(data.roles.map((role) => ({ organizationId, employeeId: employee.id, role })));
      if (data.certification) {
        await tx.insert(certifications).values({
          organizationId,
          employeeId: employee.id,
          area: CERTIFICATION_AREA,
          issuer: data.certification.issuer,
          certificateNumber: data.certification.number,
          validFrom: addDays(anchor, data.certification.validFromDay),
          validTo: addDays(anchor, data.certification.validToDay),
        });
      }
      return { user, employeeId: employee.id };
    });

    counter.add("users", knownUser === undefined);
    counter.add("employees", true);
    counter.add("employee_roles", true, data.roles.length);
    if (data.certification) counter.add("certifications", true);
    result.set(data.key, {
      data,
      id: created.employeeId,
      actor: created.user,
      active: true,
    });
  }
  return { employees: result, officeIds };
}

function hasRole(employee: SeedEmployee, role: TestdataEmployee["roles"][number]): boolean {
  return employee.data.roles.includes(role);
}

/** Kontoransatt på samme kontor, ellers den første aktive kontoransatte. */
function officeStaffFor(context: SeedContext, officeName: string | undefined): SeedEmployee | null {
  const staff = [...context.employees.values()].filter(
    (item) => item.active && hasRole(item, "office"),
  );
  return staff.find((item) => item.data.officeName === officeName) ?? staff[0] ?? null;
}

/** Leder i samme selskap som `employee`, ellers den første aktive lederen. */
function managerFor(context: SeedContext, employee: SeedEmployee | null): SeedEmployee | null {
  const managers = [...context.employees.values()].filter(
    (item) => item.active && hasRole(item, "manager"),
  );
  return (
    managers.find((item) => item.data.companyName === employee?.data.companyName) ??
    managers[0] ??
    null
  );
}

function activeEmployee(context: SeedContext, key: string | undefined): SeedEmployee | null {
  if (key === undefined) return null;
  const found = context.employees.get(key);
  return found?.active ? found : null;
}

/** Firma og meglere gjennom tjenestene, med en kontoransatt som aktør. */
async function ensureFirmsAndContacts(context: SeedContext): Promise<void> {
  const { counter, organizationId, readGrant } = context;
  const office = officeStaffFor(context, undefined);
  const existingFirms = await findTestdataFirms(readGrant);
  const existingContacts = new Map(
    (await findTestdataContacts(readGrant)).map((row) => [row.email.toLowerCase(), row]),
  );

  for (const firm of TESTDATA_FIRMS) {
    let row: { id: string; deletedAt: Date | null } | undefined = existingFirms.find(
      (item) => item.name === firm.name && item.firmType === firm.firmType,
    );
    if (row) {
      counter.add("firms", false);
    } else if (office) {
      const created = await createFirm(office.actor, organizationId, {
        name: firm.name,
        firmType: firm.firmType,
      });
      row = { id: created.id, deletedAt: null };
      counter.add("firms", true);
    } else {
      counter.add("firms", false);
    }

    for (const broker of firm.brokers) {
      const email = broker.email.toLowerCase();
      const contact = existingContacts.get(email);
      if (contact) {
        counter.add("contacts", false);
        if (contact.deletedAt === null) context.contactIds.set(email, contact.id);
        continue;
      }
      // Firmaet er slettet (eller ingen kontoransatt): megleren lages ikke
      if (!row || row.deletedAt !== null || !office) {
        counter.add("contacts", false);
        continue;
      }
      const [firstName, ...rest] = broker.name.split(" ");
      const created = await createContact(office.actor, organizationId, {
        firstName: firstName ?? broker.name,
        lastName: rest.join(" "),
        email,
        phone: broker.phone,
        firmId: row.id,
      });
      context.contactIds.set(email, created.id);
      counter.add("contacts", true);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Én ordre: delene i fast rekkefølge. Hver del lager bare det som mangler.
// ---------------------------------------------------------------------------------------------

type OrderState = {
  orderId: string;
  orderStatus: string;
  assignmentId: string | null;
  assignmentStatus: string | null;
  propertyId: string | null;
  scheduled: boolean;
};

function municipalityFor(postalCode: string | undefined) {
  return TESTDATA_MUNICIPALITIES.find((item) => item.postalCode === postalCode) ?? null;
}

function orderAddressText(plan: OrderPlan): string {
  const street = plan.property?.street ?? plan.order.address ?? "";
  const postalCode = plan.property?.postalCode ?? plan.order.postalCode;
  const municipality = municipalityFor(postalCode);
  return municipality
    ? `${street}, ${municipality.postalCode} ${municipality.postalPlace}`
    : street;
}

async function ensureOrder(
  context: SeedContext,
  plan: OrderPlan,
  existing: TestdataOrderRow | undefined,
): Promise<{ state: OrderState | null; created: boolean }> {
  const { counter, organizationId } = context;
  const { order, property } = plan;
  if (existing) {
    counter.add("orders", false);
    if (existing.assignmentId !== null) counter.add("assignments", false);
    const unusable =
      existing.deletedAt !== null ||
      existing.status === "rejected" ||
      existing.assignmentDeletedAt !== null;
    if (unusable) return { state: null, created: false };
    return {
      state: {
        orderId: existing.id,
        orderStatus: existing.status,
        assignmentId: existing.assignmentId,
        assignmentStatus: existing.assignmentStatus,
        propertyId: existing.propertyId,
        scheduled: existing.inspectionAt !== null || existing.dueDate !== null,
      },
      created: false,
    };
  }

  const office = officeStaffFor(context, order.officeName);
  if (!office) {
    counter.add("orders", false);
    return { state: null, created: false };
  }
  const brokerContactId =
    order.brokerEmail === undefined
      ? null
      : (context.contactIds.get(order.brokerEmail.toLowerCase()) ?? null);
  const created = await createOrder(
    office.actor,
    organizationId,
    {
      addressText: orderAddressText(plan),
      receivedAt: plan.received,
      externalRef: order.externalRef,
      orderedByText: order.orderedByText ?? null,
      orderedByContactId: brokerContactId,
      gnr: property?.gnr ?? order.gnr ?? null,
      bnr: property?.bnr ?? order.bnr ?? null,
      snr: property?.snr ?? null,
      housingAssociationName: property?.cooperativeName ?? null,
      sellerDeclarationReceived: order.selfDeclarationReceived,
    },
    plan.received,
  );
  counter.add("orders", true);
  return {
    state: {
      orderId: created.id,
      orderStatus: created.status,
      assignmentId: null,
      assignmentStatus: null,
      propertyId: null,
      scheduled: false,
    },
    created: true,
  };
}

async function ensureConversion(
  context: SeedContext,
  plan: OrderPlan,
  state: OrderState,
): Promise<boolean> {
  if (state.assignmentId !== null || plan.order.target === "order_only") return false;
  const office = officeStaffFor(context, plan.order.officeName);
  const officeId = context.officeIds.get(plan.order.officeName ?? "");
  if (state.orderStatus !== "received" || !office || !officeId) return false;
  const { assignment } = await convertOrderToAssignment(
    office.actor,
    context.organizationId,
    state.orderId,
    { officeId, now: plan.converted },
  );
  state.assignmentId = assignment.id;
  state.assignmentStatus = assignment.status;
  context.counter.add("assignments", true);
  // Notatet følger med når oppdraget lages (ingen egen «finnes»-sjekk for et tomt notat)
  if (plan.order.note !== undefined) {
    await updateAssignmentNote(
      office.actor,
      context.organizationId,
      assignment.id,
      plan.order.note,
    );
  }
  return true;
}

const TEAM: readonly { role: TeamRole; key: (order: TestdataOrder) => string | undefined }[] = [
  { role: "responsible", key: (order) => order.responsibleKey },
  { role: "peer_reviewer", key: (order) => order.secondKey },
  { role: "office", key: () => undefined },
];

async function ensureTeam(
  context: SeedContext,
  plan: OrderPlan,
  assignmentId: string,
  existingRoles: Set<string> | undefined,
): Promise<boolean> {
  const office = officeStaffFor(context, plan.order.officeName);
  let created = false;
  for (const member of TEAM) {
    const employee =
      member.role === "office" ? office : activeEmployee(context, member.key(plan.order));
    if (existingRoles?.has(member.role) || !employee || !office) {
      context.counter.add("assignment_team_members", false);
      continue;
    }
    await setTeamMember(office.actor, context.organizationId, assignmentId, {
      teamRole: member.role,
      employeeId: employee.id,
      now: plan.setup,
    });
    context.counter.add("assignment_team_members", true);
    created = true;
  }
  return created;
}

async function ensureParties(
  context: SeedContext,
  plan: OrderPlan,
  assignmentId: string,
  hasParties: boolean,
): Promise<boolean> {
  const office = officeStaffFor(context, plan.order.officeName);
  const count = plan.order.parties.length;
  if (hasParties || !office) {
    context.counter.add("assignment_parties", false, count);
    return false;
  }
  for (const party of plan.order.parties) {
    const contactId =
      party.role === "broker" && party.email
        ? (context.contactIds.get(party.email.toLowerCase()) ?? null)
        : null;
    await addParty(office.actor, context.organizationId, assignmentId, { ...party, contactId });
  }
  context.counter.add("assignment_parties", true, count);
  return true;
}

async function ensureProperty(
  context: SeedContext,
  plan: OrderPlan,
  state: OrderState,
  assignmentId: string,
  knownPropertyKeys: Set<string>,
  hasCommonAreas: boolean,
): Promise<boolean> {
  const { property } = plan;
  if (!property) return false;
  const office = officeStaffFor(context, plan.order.officeName);
  let created = false;
  const key = propertyKey(property);
  if (state.propertyId !== null || knownPropertyKeys.has(key) || !office) {
    context.counter.add("properties", false);
  } else {
    const saved = await saveAssignmentProperty(
      office.actor,
      context.organizationId,
      assignmentId,
      testdataPropertyInput(property),
    );
    state.propertyId = saved.id;
    knownPropertyKeys.add(key);
    context.counter.add("properties", true);
    created = true;
  }

  if (property.commonAreas !== undefined) {
    if (hasCommonAreas || !office) {
      context.counter.add("common_areas", false);
    } else {
      await saveCommonAreas(office.actor, context.organizationId, assignmentId, {
        ...property.commonAreas,
      });
      context.counter.add("common_areas", true);
      created = true;
    }
  }
  return created;
}

async function ensureSchedule(
  context: SeedContext,
  plan: OrderPlan,
  state: OrderState,
  assignmentId: string,
): Promise<boolean> {
  const office = officeStaffFor(context, plan.order.officeName);
  if (plan.inspectionAt === null && plan.dueDate === null) return false;
  if (state.scheduled || !office) return false;
  await setAssignmentSchedule(office.actor, context.organizationId, assignmentId, {
    inspectionAt: plan.inspectionAt,
    dueDate: plan.dueDate,
  });
  state.scheduled = true;
  return true;
}

/** Bygningene med etasjer, areal og rom, vurdert samlet. Ansvarlig takstmann måler. */
async function ensureBuildings(
  context: SeedContext,
  plan: OrderPlan,
  assignmentId: string,
  hasBuildings: boolean,
): Promise<boolean> {
  const counts = buildingCounts(plan.property);
  if (targetIndex(plan.order) < 1 || counts.buildings === 0) return false;
  const responsible = activeEmployee(context, plan.order.responsibleKey);
  const { counter } = context;
  if (hasBuildings || !responsible || !plan.property) {
    counter.add("report_buildings", false, counts.buildings);
    counter.add("floors", false, counts.floors);
    counter.add("floor_areas", false, counts.floors);
    counter.add("rooms", false, counts.rooms);
    return false;
  }

  const { actor } = responsible;
  const organizationId = context.organizationId;
  for (const building of plan.property.buildings) {
    const savedBuilding = await saveBuilding(actor, organizationId, assignmentId, null, {
      name: building.name,
    });
    for (const floor of building.floors) {
      const savedFloor = await saveFloor(actor, organizationId, savedBuilding.id, null, {
        name: floor.name,
        level: floor.level,
        belowGround: floor.belowGround,
      });
      await saveFloorArea(actor, organizationId, savedFloor.id, {
        braI: floor.area.braI,
        braE: floor.area.braE,
        braB: floor.area.braB,
        alh: floor.area.alh,
        method: floor.area.method,
        comment: floor.area.comment,
        measuredBy: responsible.id,
      });
      for (const room of floor.rooms) {
        await saveRoom(actor, organizationId, savedFloor.id, null, {
          roomType: room.roomType,
          name: room.name,
          areaType: room.areaType,
          belowGround: room.belowGround,
        });
      }
    }
  }
  counter.add("report_buildings", true, counts.buildings);
  counter.add("floors", true, counts.floors);
  counter.add("floor_areas", true, counts.floors);
  counter.add("rooms", true, counts.rooms);
  return true;
}

/**
 * Statusbyttene fram til målet, ett gyldig steg om gangen, med ansvarlig takstmann som aktør. Et
 * steg som er tatt før (hendelsen finnes), tas ikke igjen. Står oppdraget et annet sted enn
 * ventet, stopper det her.
 */
async function ensureStatuses(
  context: SeedContext,
  plan: OrderPlan,
  state: OrderState,
  assignmentId: string,
  reached: Set<string> | undefined,
): Promise<boolean> {
  const target = targetIndex(plan.order);
  const responsible = activeEmployee(context, plan.order.responsibleKey);
  let created = false;
  for (let index = 1; index <= target; index += 1) {
    const toStatus = STATUS_PATH[index] as ReachedStatus;
    const fromStatus = STATUS_PATH[index - 1] as AssignmentStatus;
    if (reached?.has(toStatus) || state.assignmentStatus !== fromStatus || !responsible) {
      context.counter.add("status_changes", false);
      continue;
    }
    const result = await changeAssignmentStatus(
      responsible.actor,
      context.organizationId,
      assignmentId,
      { expectedStatus: fromStatus, toStatus, now: plan.statusAt[toStatus] },
    );
    state.assignmentStatus = result.status;
    context.counter.add("status_changes", true);
    created = true;
  }
  return created;
}

/** Tidsregistreringen, direkte og bare på oppdiktede ansatte. Finnes økter, røres de ikke. */
async function ensureWorkSessions(
  context: SeedContext,
  plan: OrderPlan,
  assignmentId: string,
  hasSessions: boolean,
): Promise<boolean> {
  const sessions = plan.order.workSessions ?? [];
  if (sessions.length === 0) return false;
  const rows = sessions.flatMap((session) => {
    const employee = activeEmployee(context, session.employeeKey);
    if (!employee) return [];
    const startedAt = osloAt(context.anchor, session.startDay, clockToMinutes(session.startTime));
    const endedAt = addMinutes(startedAt, Math.round(session.hours * 60));
    return [
      {
        organizationId: context.organizationId,
        assignmentId,
        employeeId: employee.id,
        phase: session.phase,
        startedAt,
        endedAt,
        createdAt: startedAt,
        updatedAt: endedAt,
        createdBy: employee.id,
      },
    ];
  });
  if (hasSessions || rows.length === 0) {
    context.counter.add("work_sessions", false, sessions.length);
    return false;
  }
  await db.insert(workSessions).values(rows);
  context.counter.add("work_sessions", true, rows.length);
  return true;
}

/** Reklamasjonen, registrert av en leder etter at oppdraget ble ferdig. */
async function ensureClaim(
  context: SeedContext,
  plan: OrderPlan,
  state: OrderState,
  assignmentId: string,
  hasClaim: boolean,
): Promise<boolean> {
  const claim = plan.order.claim;
  if (!claim || plan.claimAt === null || plan.claimDate === null) return false;
  const done = state.assignmentStatus === "completed" || state.assignmentStatus === "invoiced";
  const manager = managerFor(context, activeEmployee(context, plan.order.responsibleKey));
  if (hasClaim || !done || !manager) {
    context.counter.add("claims", false);
    return false;
  }
  const [claimant] = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .where(
      and(
        eq(assignmentParties.organizationId, context.organizationId),
        eq(assignmentParties.assignmentId, assignmentId),
        eq(assignmentParties.role, claim.claimantRole),
        isNull(assignmentParties.deletedAt),
      ),
    )
    .orderBy(asc(assignmentParties.createdAt), asc(assignmentParties.id))
    .limit(1);
  await createClaim(
    manager.actor,
    context.organizationId,
    assignmentId,
    {
      claimType: claim.claimType,
      receivedAt: plan.claimDate,
      claimantPartyId: claimant?.id ?? null,
      claimantText: claimant ? null : "Kjøper",
      description: claim.description,
      buildingPartText: claim.buildingPart,
      outcome: claim.outcome,
      amount: claim.amount ?? null,
    },
    plan.claimAt,
  );
  context.counter.add("claims", true);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Tilbakedatering av tidspunktene tjenestene satte til «nå»
// ---------------------------------------------------------------------------------------------

type BackdateTarget = { plan: OrderPlan; orderId: string; assignmentId: string | null };

const MEASURED_EVENTS = new Set([
  "assignment.building_saved",
  "assignment.floor_saved",
  "assignment.floor_area_saved",
  "assignment.room_saved",
]);
const SETUP_EVENTS = new Set([
  "assignment.team_changed",
  "assignment.company_changed",
  "assignment.party_added",
  "assignment.property_saved",
  "assignment.common_areas_saved",
]);
const MEASURED_ENTITIES = new Set(["report_building", "floor", "floor_area", "room"]);
const SETUP_ENTITIES = new Set([
  "assignment_team_member",
  "assignment_party",
  "property",
  "cadastral_unit",
  "common_areas",
]);

function statusTime(plan: OrderPlan, to: unknown): Date | null {
  if (to === "in_progress" || to === "completed" || to === "invoiced") {
    return plan.statusAt[to] ?? null;
  }
  return null;
}

/** Planlagt tid for en hendelse. `null`: ukjent hendelse, røres ikke. */
function plannedEventTime(plan: OrderPlan, type: string, data: Record<string, unknown>) {
  if (type === "order.received") return plan.received;
  if (type === "assignment.created") return plan.converted;
  if (type === "assignment.status_changed") return statusTime(plan, data.to);
  if (type === "claim.registered") return plan.claimAt;
  if (MEASURED_EVENTS.has(type)) return plan.measured;
  if (SETUP_EVENTS.has(type)) return plan.setup;
  return null;
}

/** Planlagt tid for en rad i revisjonsloggen. `null`: ukjent rad, røres ikke. */
function plannedAuditTime(
  plan: OrderPlan,
  entityType: string,
  action: string,
  changes: Record<string, unknown>,
) {
  if (entityType === "order") {
    if (action === "create") return plan.received;
    if (action === "convert") return plan.converted;
    return null;
  }
  if (entityType === "assignment") {
    if (action === "create") return plan.converted;
    if (action !== "update") return null;
    const status = changes.status as { to?: unknown } | undefined;
    return status === undefined ? plan.setup : statusTime(plan, status.to);
  }
  if (action !== "create") return null;
  if (entityType === "claim") return plan.claimAt;
  if (MEASURED_ENTITIES.has(entityType)) return plan.measured;
  if (SETUP_ENTITIES.has(entityType)) return plan.setup;
  return null;
}

function differs(at: Date, ...values: (Date | null)[]): boolean {
  return values.some((value) => value === null || value.getTime() !== at.getTime());
}

function valuesList(rows: readonly { id: string; at: Date }[]) {
  return sql.join(
    rows.map((row) => sql`(${row.id}::uuid, ${row.at.toISOString()}::timestamptz)`),
    sql`, `,
  );
}

/**
 * Flytter tidspunktene for TD-ordrene i `targets` til planlagt tid, i én transaksjon. Bare rader i
 * organisasjonen, laget av oppdiktede ansatte, og der verdien er ulik den planlagte. Ordre,
 * oppdrag og reklamasjoner som er tilbakedatert fra før (`created_at` er planlagt tid), røres ikke,
 * så endringer de ansatte har gjort i testmiljøet, står.
 */
async function backdate(context: SeedContext, targets: readonly BackdateTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const organizationId = context.organizationId;
  const actorIds = [...context.employees.values()].map((item) => item.id);
  const orderIds = targets.map((item) => item.orderId);
  const assignmentIds = targets.flatMap((item) => (item.assignmentId ? [item.assignmentId] : []));
  const planByOrder = new Map(targets.map((item) => [item.orderId, item.plan]));
  const planByAssignment = new Map(
    targets.flatMap((item) => (item.assignmentId ? [[item.assignmentId, item.plan] as const] : [])),
  );
  const planByEntity = (id: string) => planByOrder.get(id) ?? planByAssignment.get(id);

  const eventScope =
    assignmentIds.length > 0
      ? or(
          inArray(events.assignmentId, assignmentIds),
          and(
            eq(events.type, "order.received"),
            inArray(sql`${events.data} ->> 'orderId'`, orderIds),
          ),
        )
      : and(
          eq(events.type, "order.received"),
          inArray(sql`${events.data} ->> 'orderId'`, orderIds),
        );
  const auditScope =
    assignmentIds.length > 0
      ? or(
          inArray(auditLog.entityId, [...orderIds, ...assignmentIds]),
          inArray(sql`${auditLog.changes} ->> 'assignmentId'`, assignmentIds),
        )
      : inArray(auditLog.entityId, orderIds);

  const [eventRows, auditRows] = await Promise.all([
    db
      .select({
        id: events.id,
        type: events.type,
        assignmentId: events.assignmentId,
        data: events.data,
        occurredAt: events.occurredAt,
        receivedAt: events.receivedAt,
        createdAt: events.createdAt,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .where(
        and(
          eq(events.organizationId, organizationId),
          inArray(events.actorId, actorIds),
          eventScope,
        ),
      ),
    db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        changes: auditLog.changes,
        occurredAt: auditLog.occurredAt,
        receivedAt: auditLog.receivedAt,
        createdAt: auditLog.createdAt,
        updatedAt: auditLog.updatedAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          inArray(auditLog.actorEmployeeId, actorIds),
          auditScope,
        ),
      ),
  ]);

  const eventUpdates: { id: string; at: Date }[] = [];
  for (const row of eventRows) {
    const plan =
      (row.assignmentId ? planByAssignment.get(row.assignmentId) : undefined) ??
      planByOrder.get(String(row.data.orderId ?? ""));
    const at = plan ? plannedEventTime(plan, row.type, row.data) : null;
    if (at && differs(at, row.occurredAt, row.receivedAt, row.createdAt, row.updatedAt)) {
      eventUpdates.push({ id: row.id, at });
    }
  }
  const auditUpdates: { id: string; at: Date }[] = [];
  for (const row of auditRows) {
    const plan =
      planByEntity(row.entityId) ?? planByAssignment.get(String(row.changes.assignmentId ?? ""));
    const at = plan ? plannedAuditTime(plan, row.entityType, row.action, row.changes) : null;
    if (at && differs(at, row.occurredAt, row.receivedAt, row.createdAt, row.updatedAt)) {
      auditUpdates.push({ id: row.id, at });
    }
  }

  const orderValues = sql.join(
    targets.map((item) => {
      const updated = item.assignmentId ? item.plan.converted : item.plan.received;
      return sql`(${item.orderId}::uuid, ${item.plan.received.toISOString()}::timestamptz, ${updated.toISOString()}::timestamptz)`;
    }),
    sql`, `,
  );
  const assignmentTargets = targets.filter((item) => item.assignmentId !== null);
  const claimTargets = targets.filter(
    (item) => item.assignmentId !== null && item.plan.claimAt !== null,
  );
  const actorIdList = sql.join(
    actorIds.map((id) => sql`${id}`),
    sql`, `,
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${orders} as o
      set created_at = v.created_at, updated_at = v.updated_at, row_version = o.row_version + 1
      from (values ${orderValues}) as v(id, created_at, updated_at)
      where o.id = v.id
        and o.organization_id = ${organizationId}
        and o.external_ref like ${TD_REF_PATTERN}
        and o.created_by in (${actorIdList})
        and o.created_at <> v.created_at`);

    if (assignmentTargets.length > 0) {
      const values = sql.join(
        assignmentTargets.map(
          (item) =>
            sql`(${item.assignmentId}::uuid, ${item.plan.converted.toISOString()}::timestamptz, ${lastAssignmentTime(item.plan).toISOString()}::timestamptz)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update ${assignments} as a
        set created_at = v.created_at, updated_at = v.updated_at, row_version = a.row_version + 1
        from (values ${values}) as v(id, created_at, updated_at)
        where a.id = v.id
          and a.organization_id = ${organizationId}
          and a.created_by in (${actorIdList})
          and a.created_at <> v.created_at`);
    }

    if (claimTargets.length > 0) {
      const values = sql.join(
        claimTargets.map(
          (item) =>
            sql`(${item.assignmentId}::uuid, ${(item.plan.claimAt as Date).toISOString()}::timestamptz)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update ${claims} as c
        set created_at = v.at, updated_at = v.at, row_version = c.row_version + 1
        from (values ${values}) as v(assignment_id, at)
        where c.assignment_id = v.assignment_id
          and c.organization_id = ${organizationId}
          and c.created_by::text in (${actorIdList})
          and c.created_at <> v.at`);
    }

    if (eventUpdates.length > 0) {
      await tx.execute(sql`
        update ${events} as e
        set occurred_at = v.at, received_at = v.at, created_at = v.at, updated_at = v.at
        from (values ${valuesList(eventUpdates)}) as v(id, at)
        where e.id = v.id
          and e.organization_id = ${organizationId}
          and (e.occurred_at <> v.at or e.received_at <> v.at
            or e.created_at <> v.at or e.updated_at <> v.at)`);
    }
    if (auditUpdates.length > 0) {
      await tx.execute(sql`
        update ${auditLog} as l
        set occurred_at = v.at, received_at = v.at, created_at = v.at, updated_at = v.at
        from (values ${valuesList(auditUpdates)}) as v(id, at)
        where l.id = v.id
          and l.organization_id = ${organizationId}
          and (l.occurred_at <> v.at or l.received_at <> v.at
            or l.created_at <> v.at or l.updated_at <> v.at)`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Hele kjøringen
// ---------------------------------------------------------------------------------------------

/**
 * `pnpm db:seed:testdata`. `now` kommer fra inngangen (klokka) eller testene (faste datoer); den brukes bare som datoanker når
 * `TD-0001` ikke finnes. Vakten kjøres før noe annet.
 */
export async function runTestdataSeed(
  env: Record<string, string | undefined>,
  now: Date,
): Promise<TestdataSummary> {
  assertTestdataAllowed(env);

  const { organizationId, readGrant } = await findSeedOrganization(env);
  const existingOrders = await findTestdataOrders(readGrant);
  const anchor = findAnchor(existingOrders, now);
  const plans = buildPlans(anchor);
  const counter = new Counter();

  const { employees: seedEmployees, officeIds } = await ensureEmployees(
    readGrant,
    anchor,
    now,
    counter,
  );
  const context: SeedContext = {
    organizationId,
    readGrant,
    anchor,
    employees: seedEmployees,
    officeIds,
    contactIds: new Map(),
    counter,
  };
  await ensureFirmsAndContacts(context);

  const ordersByRef = new Map(existingOrders.map((row) => [row.externalRef, row]));
  const existingAssignmentIds = existingOrders.flatMap((row) =>
    row.assignmentId ? [row.assignmentId] : [],
  );
  const parts = await findTestdataAssignmentParts(readGrant, existingAssignmentIds);
  const propertyKeys = new Set((await findTestdataProperties(readGrant)).map((row) => row.key));

  const summary: TestdataSummary = {
    created: counter.created,
    skipped: counter.skipped,
    orders: [],
    keys: plans.map((plan) => plan.order.externalRef),
  };

  for (const plan of plans) {
    const ref = plan.order.externalRef;
    const { state, created: orderCreated } = await ensureOrder(context, plan, ordersByRef.get(ref));
    if (!state) {
      summary.orders.push({ externalRef: ref, result: "skipped" });
      console.log(`Testdata ${ref}: ${RESULT_LABELS.skipped}`);
      continue;
    }

    let created = orderCreated;
    created = (await ensureConversion(context, plan, state)) || created;
    const assignmentId = state.assignmentId;
    if (assignmentId !== null) {
      created =
        (await ensureTeam(context, plan, assignmentId, parts.teamRoles.get(assignmentId))) ||
        created;
      created =
        (await ensureParties(context, plan, assignmentId, parts.withParties.has(assignmentId))) ||
        created;
      created =
        (await ensureProperty(
          context,
          plan,
          state,
          assignmentId,
          propertyKeys,
          parts.withCommonAreas.has(assignmentId),
        )) || created;
      created = (await ensureSchedule(context, plan, state, assignmentId)) || created;
      created =
        (await ensureBuildings(
          context,
          plan,
          assignmentId,
          parts.withBuildings.has(assignmentId),
        )) || created;
      created =
        (await ensureStatuses(
          context,
          plan,
          state,
          assignmentId,
          parts.reachedStatuses.get(assignmentId),
        )) || created;
      created =
        (await ensureWorkSessions(
          context,
          plan,
          assignmentId,
          parts.withWorkSessions.has(assignmentId),
        )) || created;
      created =
        (await ensureClaim(
          context,
          plan,
          state,
          assignmentId,
          parts.withClaims.has(assignmentId),
        )) || created;
    }

    if (created) {
      // Rett etter kallene for ordren: tidspunktene flyttes til planlagt tid
      await backdate(context, [{ plan, orderId: state.orderId, assignmentId }]);
    }
    const result: TestdataOrderResult = created ? "created" : "existing";
    summary.orders.push({ externalRef: ref, result });
    console.log(`Testdata ${ref}: ${RESULT_LABELS[result]}`);
  }

  // Til slutt én gang til for alle TD-ordrene, så en avbrutt tilbakedatering blir fullført
  const planByRef = new Map<string, OrderPlan>(plans.map((plan) => [plan.order.externalRef, plan]));
  const finalTargets = (await findTestdataOrders(readGrant)).flatMap((row) => {
    const plan = planByRef.get(row.externalRef);
    return plan ? [{ plan, orderId: row.id, assignmentId: row.assignmentId }] : [];
  });
  await backdate(context, finalTargets);

  const createdTotal = Object.values(summary.created).reduce((sum, value) => sum + value, 0);
  const skippedTotal = Object.values(summary.skipped).reduce((sum, value) => sum + value, 0);
  console.log(`Testdata: ${createdTotal} laget, ${skippedTotal} fantes fra før eller hoppet over`);
  return summary;
}
