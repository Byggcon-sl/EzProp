import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
  employees,
  events,
  orders,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createTeamMember,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./codes";
import * as errors from "./errors";
import { AssignmentStatusConflictError } from "./errors";
import { cancelAssignment, changeAssignmentStatus, getAssignment } from "./index";

/*
 * Statusflyten, kansellering og «Rettet»: kjernen i src/core/assignments mot databasen.
 * Testplan: docs/funksjoner/fase2a-statusflyt-testplan.md avsnitt 3. 3.6.5 (samme transaksjon)
 * står i status-transaction.test.ts, og 3.7.2 (getOrder(...).assignmentCancelled) i
 * src/core/orders/orders.test.ts.
 *
 * Signaturene (testplanen, «Avtale om signaturer»):
 * - changeAssignmentStatus(actor, organizationId, assignmentId, { expectedStatus, toStatus, reason? })
 * - cancelAssignment(actor, organizationId, assignmentId, { expectedStatus, reason })
 * Begge returnerer minst `{ id, status }`. Feilen for ulovlig overgang har utviklerens navn;
 * testen godtar den hvis den ikke er AccessDeniedError eller konflikten og har norsk melding.
 *
 * Testdata er oppdiktet: grunn «Feiltrykk» og «Kunden trakk bestillingen».
 *
 * Støtter hovedmål: reklamasjoner (hver overgang og kansellering har hvem, når og grunn; ingenting
 * slettes; aldri en annen organisasjon), tid (ett trykk fram) og KI først (samme funksjoner kan
 * brukes av automatikken senere).
 */

beforeEach(resetDatabase);

const BACK_REASON = "Feiltrykk";
const CANCEL_REASON = "Kunden trakk bestillingen";
const CONFLICT_MESSAGE = "Statusen er endret av noen andre. Last siden på nytt.";

type ChangeInput = Parameters<typeof changeAssignmentStatus>[3];
type CancelInput = Parameters<typeof cancelAssignment>[3];

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett kontor og ett oppdrag med statusen. */
async function orgWithAdmin(status: AssignmentStatus = "ordered", name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id, status });
  return { org, admin, adminEmployee, office, assignment };
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

function change(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: Record<string, unknown>,
) {
  return changeAssignmentStatus(actor, organizationId, assignmentId, input as ChangeInput);
}

function cancel(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: Record<string, unknown>,
) {
  return cancelAssignment(actor, organizationId, assignmentId, input as CancelInput);
}

async function assignmentRow(id: string) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
  if (!row) throw new Error("fant ikke oppdraget");
  return row;
}

async function rowCount(
  table: typeof events | typeof auditLog | typeof assignments | typeof orders,
): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function counts() {
  return {
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
    assignments: await rowCount(assignments),
  };
}

/** Feltene som ikke skal endres når et kall avvises. */
async function snapshot(id: string) {
  const row = await assignmentRow(id);
  return {
    status: row.status,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    rowVersion: row.rowVersion,
  };
}

async function eventsFor(assignmentId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.assignmentId, assignmentId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(assignmentId: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, assignmentId));
  return rows.filter((row) => row.entityType === "assignment");
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Feilen for ulovlig overgang, hvis utvikleren har et navn med «Transition» i errors.ts. */
const IllegalTransitionError = (Object.values(errors) as unknown[]).find(
  (value) => typeof value === "function" && /transition/i.test(value.name),
) as (new (...args: never[]) => Error) | undefined;

/** En norsk melding, ikke en databasefeil eller Zods engelske standardtekst. */
function expectNorwegian(message: string) {
  expect(message.trim().length).toBeGreaterThan(0);
  expect(message).not.toMatch(
    /^(Invalid|Too (small|big)|Expected|String must|Required|Cannot|Unexpected)/,
  );
  expect(message).not.toMatch(/violates|syntax|relation|column|duplicate key/i);
}

/** Kallet ble avvist som ulovlig overgang (ikke tilgang, ikke konflikt). */
async function expectIllegal(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle feilet").toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AccessDeniedError);
  expect(error).not.toBeInstanceOf(AssignmentStatusConflictError);
  if (IllegalTransitionError) expect(error).toBeInstanceOf(IllegalTransitionError);
  expectNorwegian((error as Error).message);
}

/** Kallet ble avvist av en valideringsfeil eller en norsk feil (ikke tilgang, ikke konflikt). */
async function expectRejectedInput(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle feilet").toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AccessDeniedError);
  expect(error).not.toBeInstanceOf(AssignmentStatusConflictError);
}

const FORWARD: [AssignmentStatus, AssignmentStatus][] = [
  ["ordered", "in_progress"],
  ["in_progress", "completed"],
  ["completed", "invoiced"],
];

const BACK: [AssignmentStatus, AssignmentStatus][] = [
  ["in_progress", "ordered"],
  ["completed", "in_progress"],
  ["invoiced", "completed"],
];

// ---------------------------------------------------------------------------------------------
// 3.1 Tilgang per rolle (innstillingen på og av, begge funksjonene)
// ---------------------------------------------------------------------------------------------

const ROLE_CASES = [
  { name: "takstmann", roles: ["inspector"] as EmployeeRole[] },
  { name: "kontor", roles: ["office"] as EmployeeRole[] },
  { name: "leder", roles: ["manager"] as EmployeeRole[] },
  { name: "admin", roles: ["admin"] as EmployeeRole[] },
];

const SETTINGS = [
  { setting: "på", editAll: true },
  { setting: "av", editAll: false },
] as const;

const FUNCTIONS = ["changeAssignmentStatus", "cancelAssignment"] as const;
type FunctionName = (typeof FUNCTIONS)[number];

const MATRIX = FUNCTIONS.flatMap((fn) =>
  SETTINGS.flatMap((s) => ROLE_CASES.map((r) => ({ fn, ...s, ...r }))),
);
const ALLOWED = MATRIX.filter((c) => c.editAll || c.roles[0] !== "inspector");
const DENIED = MATRIX.filter((c) => !c.editAll && c.roles[0] === "inspector");

/** Kaller funksjonen fra «Bestilt» og returnerer forventet tilstand etterpå. */
function callFrom(fn: FunctionName, actor: Actor, organizationId: string, assignmentId: string) {
  return fn === "changeAssignmentStatus"
    ? change(actor, organizationId, assignmentId, {
        expectedStatus: "ordered",
        toStatus: "in_progress",
      })
    : cancel(actor, organizationId, assignmentId, {
        expectedStatus: "ordered",
        reason: CANCEL_REASON,
      });
}

async function expectApplied(fn: FunctionName, assignmentId: string) {
  const row = await assignmentRow(assignmentId);
  if (fn === "changeAssignmentStatus") {
    expect(row.status).toBe("in_progress");
    expect(row.deletedAt).toBeNull();
  } else {
    expect(row.status).toBe("ordered");
    expect(row.deletedAt).not.toBeNull();
  }
}

describe("3.1 tilgang per rolle", () => {
  it.each(ALLOWED)("3.1.1–2 $fn: $name med innstillingen $setting lykkes", async (c) => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, c.editAll);
    const { actor } = await person(org.id, c.roles);

    await callFrom(c.fn, actor, org.id, assignment.id);
    await expectApplied(c.fn, assignment.id);
  });

  it.each(DENIED)(
    "3.1.2 $fn: takstmann med innstillingen av får AccessDeniedError, og ingenting endres",
    async (c) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, c.roles);
      const before = await snapshot(assignment.id);
      const beforeCounts = await counts();

      await expect(callFrom(c.fn, actor, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
      expect(await snapshot(assignment.id)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  it.each(FUNCTIONS)(
    "3.1.3 %s: takstmann med innstillingen av og enkeltrettigheten assignment.edit lykkes",
    async (fn) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, false);
      const { actor, employee } = await person(org.id, ["inspector"]);
      await grantPermission(employee, "assignment.edit");

      await callFrom(fn, actor, org.id, assignment.id);
      await expectApplied(fn, assignment.id);
    },
  );

  it.each(FUNCTIONS)("3.1.4 %s: bruker uten ansattrad får AccessDeniedError", async (fn) => {
    const { org, assignment } = await orgWithAdmin();
    const stranger = await createUser();
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    await expect(callFrom(fn, stranger, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  const BLOCKED = FUNCTIONS.flatMap((fn) =>
    (
      [
        ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
        ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
      ] as const
    ).map(([state, set]) => ({ fn, state, set })),
  );

  it.each(BLOCKED)(
    "3.1.4 $fn: $state ansatt (admin) får AccessDeniedError, og ingenting endres",
    async ({ fn, set }) => {
      const { org, assignment } = await orgWithAdmin();
      const { actor, employee } = await person(org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await snapshot(assignment.id);
      const beforeCounts = await counts();

      await expect(callFrom(fn, actor, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
      expect(await snapshot(assignment.id)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  it.each(FUNCTIONS)("3.1.4 %s: ansatt uten roller får AccessDeniedError", async (fn) => {
    const { org, assignment } = await orgWithAdmin();
    const { actor } = await person(org.id, []);
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    await expect(callFrom(fn, actor, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("3.1.5 admin uten andre roller og med innstillingen av kan flytte fram, tilbake og kansellere", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    await change(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      toStatus: "in_progress",
    });
    expect((await assignmentRow(assignment.id)).status).toBe("in_progress");

    await change(admin, org.id, assignment.id, {
      expectedStatus: "in_progress",
      toStatus: "ordered",
      reason: BACK_REASON,
    });
    expect((await assignmentRow(assignment.id)).status).toBe("ordered");

    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });
    expect((await assignmentRow(assignment.id)).deletedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Tenant-isolasjon (regel 2): to kall til expectTenantIsolation
// ---------------------------------------------------------------------------------------------

describe("3.2 tenant-isolasjon", () => {
  it("3.2.1 changeAssignmentStatus endrer aldri et oppdrag i en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const row = await createAssignment(grant.organizationId, { status: "ordered" });
          assignmentFor.set(grant.organizationId, row.id);
        }
        return {
          a: [assignmentFor.get(grantA.organizationId)!],
          b: [assignmentFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await change(actor, organizationId, assignmentFor.get(organizationId) ?? randomUUID(), {
          expectedStatus: "ordered",
          toStatus: "in_progress",
        }),
      ],
      idOf: (row) => row.id,
    });

    const idB = assignmentFor.get(orgB)!;
    expect((await assignmentRow(idB)).status).toBe("in_progress");
    expect(await eventsFor(idB, "assignment.status_changed")).toHaveLength(1);
    expect(await auditFor(idB)).toHaveLength(1);
    for (const row of await eventsFor(idB)) expect(row.organizationId).toBe(orgB);
    for (const row of await auditFor(idB)) expect(row.organizationId).toBe(orgB);
  });

  it("3.2.2 cancelAssignment kansellerer aldri et oppdrag i en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const row = await createAssignment(grant.organizationId, { status: "ordered" });
          assignmentFor.set(grant.organizationId, row.id);
        }
        return {
          a: [assignmentFor.get(grantA.organizationId)!],
          b: [assignmentFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await cancel(actor, organizationId, assignmentFor.get(organizationId) ?? randomUUID(), {
          expectedStatus: "ordered",
          reason: CANCEL_REASON,
        }),
      ],
      idOf: (row) => row.id,
    });

    const idB = assignmentFor.get(orgB)!;
    const rowB = await assignmentRow(idB);
    expect(rowB.deletedAt).not.toBeNull();
    expect(await eventsFor(idB, "assignment.cancelled")).toHaveLength(1);
    expect(await auditFor(idB)).toHaveLength(1);
    for (const row of await eventsFor(idB)) expect(row.organizationId).toBe(orgB);
    for (const row of await auditFor(idB)) expect(row.organizationId).toBe(orgB);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("3.3 fremmed id", () => {
  it.each(FUNCTIONS)(
    "3.3.1 %s: Bs oppdrag med As organisasjon gir AccessDeniedError, og B er urørt",
    async (fn) => {
      const a = await orgWithAdmin("ordered", "Organisasjon A");
      const b = await orgWithAdmin("ordered", "Organisasjon B");
      const before = await snapshot(b.assignment.id);
      const beforeCounts = await counts();

      await expect(callFrom(fn, a.admin, a.org.id, b.assignment.id)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await snapshot(b.assignment.id)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  const BAD_IDS = FUNCTIONS.flatMap((fn) =>
    [randomUUID(), "ikke-en-id", "1 or 1=1"].map((id) => ({ fn, id })),
  );

  it.each(BAD_IDS)("3.3.2 $fn: id «$id» gir AccessDeniedError, aldri databasefeil", async (c) => {
    const { org, admin } = await orgWithAdmin();
    const beforeCounts = await counts();
    await expect(callFrom(c.fn, admin, org.id, c.id)).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("3.3.3 organizationId i input endrer ikke hvilken organisasjon som brukes", async () => {
    const a = await orgWithAdmin("ordered", "Organisasjon A");
    const b = await orgWithAdmin("ordered", "Organisasjon B");

    await change(a.admin, a.org.id, a.assignment.id, {
      expectedStatus: "ordered",
      toStatus: "in_progress",
      organizationId: b.org.id,
    });
    await cancel(a.admin, a.org.id, a.assignment.id, {
      expectedStatus: "in_progress",
      reason: CANCEL_REASON,
      organizationId: b.org.id,
    });

    const rowA = await assignmentRow(a.assignment.id);
    expect(rowA.status).toBe("in_progress");
    expect(rowA.deletedAt).not.toBeNull();
    const eventsA = await eventsFor(a.assignment.id);
    expect(eventsA).toHaveLength(2);
    for (const row of eventsA) expect(row.organizationId).toBe(a.org.id);
    const bEvents = await db.select().from(events).where(eq(events.organizationId, b.org.id));
    const bAudit = await db.select().from(auditLog).where(eq(auditLog.organizationId, b.org.id));
    expect(bEvents).toEqual([]);
    expect(bAudit).toEqual([]);
    expect((await snapshot(b.assignment.id)).status).toBe("ordered");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 Overganger mot databasen
// ---------------------------------------------------------------------------------------------

describe("3.4 overganger", () => {
  it.each(FORWARD)("3.4.1 fram ett steg: %s → %s", async (from, to) => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin(from);
    const startedAt = Date.now();

    const result = await change(admin, org.id, assignment.id, {
      expectedStatus: from,
      toStatus: to,
    });

    expect(result).toMatchObject({ id: assignment.id, status: to });
    const row = await assignmentRow(assignment.id);
    expect(row.status).toBe(to);
    expect(row.deletedAt).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(row.updatedBy).toBeTruthy();
    expect([adminEmployee.id, admin.id]).toContain(row.updatedBy);
  });

  it.each(BACK)("3.4.2 tilbake med grunn: %s → %s", async (from, to) => {
    const { org, admin, assignment } = await orgWithAdmin(from);

    const result = await change(admin, org.id, assignment.id, {
      expectedStatus: from,
      toStatus: to,
      reason: BACK_REASON,
    });

    expect(result).toMatchObject({ id: assignment.id, status: to });
    expect((await assignmentRow(assignment.id)).status).toBe(to);
    const [event] = await eventsFor(assignment.id, "assignment.status_changed");
    expect(event?.data).toMatchObject({ from, to, reason: BACK_REASON });
  });

  it("3.4.2 grunnen trimmes før den lagres i hendelsen", async () => {
    const { org, admin, assignment } = await orgWithAdmin("in_progress");
    await change(admin, org.id, assignment.id, {
      expectedStatus: "in_progress",
      toStatus: "ordered",
      reason: `  ${BACK_REASON}  `,
    });
    const [event] = await eventsFor(assignment.id, "assignment.status_changed");
    expect((event?.data as Record<string, unknown>).reason).toBe(BACK_REASON);
  });

  it.each([
    ["mangler", {}],
    ["tom", { reason: "" }],
    ["bare mellomrom", { reason: "   " }],
    ["null", { reason: null }],
    ["501 tegn", { reason: "G".repeat(501) }],
  ] as const)(
    "3.4.3 tilbake uten gyldig grunn (%s) nektes, ingenting endres",
    async (_n, extra) => {
      const { org, admin, assignment } = await orgWithAdmin("in_progress");
      const before = await snapshot(assignment.id);
      const beforeCounts = await counts();

      await expectRejectedInput(
        change(admin, org.id, assignment.id, {
          expectedStatus: "in_progress",
          toStatus: "ordered",
          ...extra,
        }),
      );
      expect(await snapshot(assignment.id)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  it.each([
    ["ordered", "completed"],
    ["ordered", "invoiced"],
    ["in_progress", "invoiced"],
    ["invoiced", "ordered"],
    ["invoiced", "in_progress"],
    ["completed", "ordered"],
  ] as const)("3.4.4 hopp %s → %s nektes med norsk melding, også med grunn", async (from, to) => {
    const { org, admin, assignment } = await orgWithAdmin(from);
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    await expectIllegal(
      change(admin, org.id, assignment.id, { expectedStatus: from, toStatus: to }),
    );
    await expectIllegal(
      change(admin, org.id, assignment.id, {
        expectedStatus: from,
        toStatus: to,
        reason: BACK_REASON,
      }),
    );
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it.each(ASSIGNMENT_STATUSES)(
    "3.4.5 til samme status (%s) er ulovlig, ingen hendelse",
    async (s) => {
      const { org, admin, assignment } = await orgWithAdmin(s);
      const before = await snapshot(assignment.id);
      const beforeCounts = await counts();

      await expectIllegal(
        change(admin, org.id, assignment.id, {
          expectedStatus: s,
          toStatus: s,
          reason: BACK_REASON,
        }),
      );
      expect(await snapshot(assignment.id)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  it("3.4.6 feil expectedStatus gir AssignmentStatusConflictError med kortets tekst", async () => {
    const { org, admin, assignment } = await orgWithAdmin("in_progress");
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    const error = await caught(
      change(admin, org.id, assignment.id, { expectedStatus: "ordered", toStatus: "in_progress" }),
    );
    expect(error).toBeInstanceOf(AssignmentStatusConflictError);
    expect((error as Error).message).toBe(CONFLICT_MESSAGE);
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("3.4.6 feil expectedStatus ved kansellering gir også konflikt", async () => {
    const { org, admin, assignment } = await orgWithAdmin("in_progress");
    const before = await snapshot(assignment.id);

    await expect(
      cancel(admin, org.id, assignment.id, { expectedStatus: "ordered", reason: CANCEL_REASON }),
    ).rejects.toThrow(AssignmentStatusConflictError);
    expect(await snapshot(assignment.id)).toEqual(before);
  });

  it("3.4.6 konfliktfeilen har kortets tekst", () => {
    expect(new AssignmentStatusConflictError().message).toBe(CONFLICT_MESSAGE);
  });

  it("3.4.7 to samtidige kall fra Bestilt: nøyaktig ett lykkes, det andre får konflikt", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    const { actor: office } = await person(org.id, ["office"]);
    const input = { expectedStatus: "ordered", toStatus: "in_progress" };

    const results = await Promise.allSettled([
      change(admin, org.id, assignment.id, input),
      change(office, org.id, assignment.id, input),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AssignmentStatusConflictError);
    expect((await assignmentRow(assignment.id)).status).toBe("in_progress");
    expect(await eventsFor(assignment.id, "assignment.status_changed")).toHaveLength(1);
    expect(await auditFor(assignment.id)).toHaveLength(1);
  });

  it("3.4.7 samtidig fram og kansellering: nøyaktig ett lykkes", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    const results = await Promise.allSettled([
      change(admin, org.id, assignment.id, { expectedStatus: "ordered", toStatus: "in_progress" }),
      cancel(admin, org.id, assignment.id, { expectedStatus: "ordered", reason: CANCEL_REASON }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await eventsFor(assignment.id)).toHaveLength(1);
    expect(await auditFor(assignment.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Kansellering og myk sletting
// ---------------------------------------------------------------------------------------------

describe("3.5 kansellering", () => {
  it.each(["ordered", "in_progress"] as const)(
    "3.5.1 fra %s: deleted_at og deleted_by satt, status uendret, raden finnes",
    async (status) => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin(status);
      const startedAt = Date.now();
      const beforeRows = await rowCount(assignments);

      const result = await cancel(admin, org.id, assignment.id, {
        expectedStatus: status,
        reason: CANCEL_REASON,
      });

      expect(result).toMatchObject({ id: assignment.id });
      const row = await assignmentRow(assignment.id);
      expect(row.status).toBe(status);
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
      expect([adminEmployee.id, admin.id]).toContain(row.deletedBy);
      expect([adminEmployee.id, admin.id]).toContain(row.updatedBy);
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(await rowCount(assignments)).toBe(beforeRows);
    },
  );

  it("3.5.2 grunnen står bare i hendelsen, ikke i revisjonsloggen", async () => {
    const { org, admin, assignment } = await orgWithAdmin("in_progress");
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "in_progress",
      reason: CANCEL_REASON,
    });

    const [event] = await eventsFor(assignment.id, "assignment.cancelled");
    expect(event?.data).toEqual({ status: "in_progress", reason: CANCEL_REASON });
    const audit = await auditFor(assignment.id);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.changes)).not.toContain(CANCEL_REASON);
    expect(JSON.stringify(audit[0]!.changes)).not.toContain("Kunden");
  });

  it.each(["completed", "invoiced"] as const)(
    "3.5.3 fra %s nektes med norsk melding, deleted_at forblir tom",
    async (status) => {
      const { org, admin, assignment } = await orgWithAdmin(status);
      const before = await snapshot(assignment.id);
      const beforeCounts = await counts();

      const error = await caught(
        cancel(admin, org.id, assignment.id, { expectedStatus: status, reason: CANCEL_REASON }),
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AccessDeniedError);
      expect(error).not.toBeInstanceOf(AssignmentStatusConflictError);
      expectNorwegian((error as Error).message);
      expect(await snapshot(assignment.id)).toEqual(before);
      expect((await assignmentRow(assignment.id)).deletedAt).toBeNull();
      expect(await counts()).toEqual(beforeCounts);
    },
  );

  it.each([
    ["mangler", {}],
    ["tom", { reason: "" }],
    ["bare mellomrom", { reason: "   " }],
    ["501 tegn", { reason: "G".repeat(501) }],
  ] as const)("3.5.4 uten gyldig grunn (%s) nektes, ingenting endres", async (_n, extra) => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    await expectRejectedInput(
      cancel(admin, org.id, assignment.id, { expectedStatus: "ordered", ...extra }),
    );
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("3.5.4 grunn på 500 tegn godtas", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "G".repeat(500),
    });
    expect((await assignmentRow(assignment.id)).deletedAt).not.toBeNull();
  });

  it("3.5.5 kansellert oppdrag er borte for getAssignment", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });
    await expect(getAssignment(admin, org.id, assignment.id)).rejects.toThrow(AccessDeniedError);
  });

  it("3.5.6 kansellert oppdrag kan ikke endres igjen («ikke funnet»), ingen ny hendelse", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });
    const before = await snapshot(assignment.id);
    const beforeCounts = await counts();

    await expect(
      change(admin, org.id, assignment.id, { expectedStatus: "ordered", toStatus: "in_progress" }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      cancel(admin, org.id, assignment.id, { expectedStatus: "ordered", reason: CANCEL_REASON }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await snapshot(assignment.id)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("3.5.6 et oppdrag som var slettet fra før, gir også «ikke funnet»", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const deleted = await createAssignment(org.id, {
      officeId: office.id,
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    const beforeCounts = await counts();
    for (const fn of FUNCTIONS) {
      await expect(callFrom(fn, admin, org.id, deleted.id)).rejects.toThrow(AccessDeniedError);
    }
    expect(await counts()).toEqual(beforeCounts);
  });

  it("3.5.7 ordren beholder status converted og assignment_id", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const order = await createOrder(org.id);
    const assignment = await createAssignment(org.id, { officeId: office.id, orderId: order.id });
    await db
      .update(orders)
      .set({ status: "converted", assignmentId: assignment.id })
      .where(eq(orders.id, order.id));

    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.status).toBe("converted");
    expect(row?.assignmentId).toBe(assignment.id);
    expect(row?.deletedAt).toBeNull();
  });

  it("3.5.8 teamrader og parter på oppdraget slettes ikke", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const member = await createTeamMember(org.id, { assignmentId: assignment.id });
    const party = await createAssignmentParty(org.id, { assignmentId: assignment.id });

    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });

    const team = await db
      .select()
      .from(assignmentTeamMembers)
      .where(eq(assignmentTeamMembers.assignmentId, assignment.id));
    const parties = await db
      .select()
      .from(assignmentParties)
      .where(eq(assignmentParties.assignmentId, assignment.id));
    expect(team.map((row) => row.id)).toEqual([member.id]);
    expect(team[0]?.deletedAt).toBeNull();
    expect(team[0]?.toAt).toBeNull();
    expect(parties.map((row) => row.id)).toEqual([party.id]);
    expect(parties[0]?.deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("3.6 hendelser og revisjonslogg", () => {
  it.each(FORWARD)(
    "3.6.1 fram %s → %s: én status_changed med { from, to }, én loggrad update",
    async (from, to) => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin(from);
      await change(admin, org.id, assignment.id, { expectedStatus: from, toStatus: to });

      const all = await eventsFor(assignment.id);
      expect(all).toHaveLength(1);
      const event = all[0]!;
      expect(event.type).toBe("assignment.status_changed");
      expect(event.organizationId).toBe(org.id);
      expect(event.assignmentId).toBe(assignment.id);
      expect(event.actorType).toBe("employee");
      expect(event.actorId).toBe(adminEmployee.id);
      const { reason, ...rest } = event.data as Record<string, unknown>;
      expect(rest).toEqual({ from, to });
      expect(reason === undefined || reason === null || reason === "").toBe(true);

      const audit = await auditFor(assignment.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        organizationId: org.id,
        entityType: "assignment",
        entityId: assignment.id,
        action: "update",
      });
      expect(audit[0]!.changes).toEqual({ status: { from, to } });
    },
  );

  it.each(BACK)(
    "3.6.2 tilbake %s → %s: data { from, to, reason }; revisjonsloggen har ikke grunnen",
    async (from, to) => {
      const { org, admin, assignment } = await orgWithAdmin(from);
      await change(admin, org.id, assignment.id, {
        expectedStatus: from,
        toStatus: to,
        reason: BACK_REASON,
      });

      const all = await eventsFor(assignment.id);
      expect(all).toHaveLength(1);
      expect(all[0]!.type).toBe("assignment.status_changed");
      expect(all[0]!.data).toEqual({ from, to, reason: BACK_REASON });

      const audit = await auditFor(assignment.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("update");
      expect(audit[0]!.changes).toEqual({ status: { from, to } });
      expect(JSON.stringify(audit[0]!.changes)).not.toContain(BACK_REASON);
    },
  );

  it("3.6.3 kansellering: én assignment.cancelled og én loggrad delete", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin("ordered");
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });

    const all = await eventsFor(assignment.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      type: "assignment.cancelled",
      organizationId: org.id,
      assignmentId: assignment.id,
      actorType: "employee",
      actorId: adminEmployee.id,
    });
    expect(all[0]!.data).toEqual({ status: "ordered", reason: CANCEL_REASON });

    const audit = await auditFor(assignment.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: org.id,
      entityType: "assignment",
      entityId: assignment.id,
      action: "delete",
    });
  });

  it("3.6.4 hele flyten fram og tilbake: nøyaktig én hendelse og én loggrad per kall", async () => {
    const { org, admin, assignment } = await orgWithAdmin("ordered");
    for (const [from, to] of FORWARD) {
      await change(admin, org.id, assignment.id, { expectedStatus: from, toStatus: to });
    }
    // Fra Fakturert og ned igjen til Bestilt
    for (const [from, to] of [...BACK].reverse()) {
      await change(admin, org.id, assignment.id, {
        expectedStatus: from,
        toStatus: to,
        reason: BACK_REASON,
      });
    }
    await cancel(admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: CANCEL_REASON,
    });

    const all = await eventsFor(assignment.id);
    expect(all.filter((row) => row.type === "assignment.status_changed")).toHaveLength(6);
    expect(all.filter((row) => row.type === "assignment.cancelled")).toHaveLength(1);
    expect(all).toHaveLength(7);
    const audit = await auditFor(assignment.id);
    expect(audit.filter((row) => row.action === "update")).toHaveLength(6);
    expect(audit.filter((row) => row.action === "delete")).toHaveLength(1);
    expect(audit).toHaveLength(7);
  });

  it("3.6.4 ingen hendelse og ingen loggrad ved avvist tilgang, valideringsfeil, ulovlig overgang, konflikt eller «ikke funnet»", async () => {
    const { org, admin, office, assignment } = await orgWithAdmin("in_progress");
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const done = await createAssignment(org.id, { officeId: office.id, status: "completed" });
    const before = await counts();

    const failures: [string, () => Promise<unknown>][] = [
      [
        "avvist tilgang",
        () =>
          change(inspector, org.id, assignment.id, {
            expectedStatus: "in_progress",
            toStatus: "completed",
          }),
      ],
      [
        "valideringsfeil",
        () =>
          change(admin, org.id, assignment.id, {
            expectedStatus: "in_progress",
            toStatus: "ordered",
            reason: "",
          }),
      ],
      [
        "ukjent status",
        () =>
          change(admin, org.id, assignment.id, {
            expectedStatus: "in_progress",
            toStatus: "cancelled",
          }),
      ],
      [
        "ulovlig overgang",
        () =>
          change(admin, org.id, assignment.id, {
            expectedStatus: "in_progress",
            toStatus: "invoiced",
          }),
      ],
      [
        "kansellering fra Ferdig",
        () =>
          cancel(admin, org.id, done.id, { expectedStatus: "completed", reason: CANCEL_REASON }),
      ],
      [
        "konflikt",
        () =>
          change(admin, org.id, assignment.id, {
            expectedStatus: "ordered",
            toStatus: "in_progress",
          }),
      ],
      [
        "ikke funnet",
        () =>
          change(admin, org.id, randomUUID(), {
            expectedStatus: "in_progress",
            toStatus: "completed",
          }),
      ],
    ];

    for (const [name, run] of failures) {
      const error = await caught(run());
      expect(error, `${name} skulle feilet`).toBeInstanceOf(Error);
      expect(await counts(), name).toEqual(before);
    }
    expect((await assignmentRow(assignment.id)).status).toBe("in_progress");
    expect((await assignmentRow(done.id)).deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7.1 getAssignment(...).corrected
// ---------------------------------------------------------------------------------------------

describe("3.7.1 corrected", () => {
  it.each(ASSIGNMENT_STATUSES)("getAssignment gir corrected: false for %s", async (status) => {
    const { org, admin, assignment } = await orgWithAdmin(status);
    const result = await getAssignment(admin, org.id, assignment.id);
    expect(result.status).toBe(status);
    expect(result).toHaveProperty("corrected", false);
  });
});
