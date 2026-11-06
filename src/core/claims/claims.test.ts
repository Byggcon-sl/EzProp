import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, events, organizations, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  TEST_NOW,
  auditRows,
  createAssignment,
  createAssignmentParty,
  createClaim as insertClaim,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as core from "./index";

/*
 * Reklamasjonssaker: kjernen i src/core/claims (liste, hente, registrere, endre, fjerne).
 * Testplan: docs/funksjoner/fase2a-reklamasjoner-testplan.md avsnitt 4.
 *
 * Bare leder og admin (Ståle 27.10.2026): lesing med `claims.read`, alt annet med `claims.manage`.
 * Rolle uten rettighet, annen organisasjon, fjernet oppdrag og fjernet eller fremmed sak gir alle
 * `AccessDeniedError` (samme svar, sidene viser «finnes ikke»).
 *
 * Krav før godkjenning: 4.1 (med admin-testen 4.1.6), 4.2, 4.4 og 4.7. Regel 2, 3 og 11.
 *
 * Fast tid: TEST_NOW = 03.11.2026 kl. 11 i Oslo, sendt inn som siste argument (`now`). Testdata er
 * oppdiktet: «Kjøper Test», «Fukt i kjeller ikke nevnt», «Kjeller, yttervegg». Loggtestene bruker
 * merker som ikke kan forekomme tilfeldig.
 *
 * Støtter hovedmål: reklamasjoner (hver sak lagres med dato, utfall og beløp på oppdraget, ingenting
 * slettes, bare leder og admin ser sakene) og KI først (hendelser og logg er uten fritekst, så de
 * kan brukes trygt senere).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = TEST_NOW;
const LATER = new Date("2026-11-03T12:00:00Z");
const EVEN_LATER = new Date("2026-11-03T14:00:00Z");

const MARK_CLAIMANT = "MERKE-KLAGER-7Q2";
const MARK_DESCRIPTION = "MERKE-BESKRIVELSE-7Q2";
const MARK_BUILDING_PART = "MERKE-BYGNINGSDEL-7Q2";
const MARKS = [MARK_CLAIMANT, MARK_DESCRIPTION, MARK_BUILDING_PART];

type Input = Parameters<typeof core.createClaim>[3];

function claimInput(overrides: Record<string, unknown> = {}): Input {
  return {
    claimType: "complaint",
    receivedAt: "2026-11-02",
    claimantText: "Kjøper Test",
    description: "Fukt i kjeller ikke nevnt",
    buildingPartText: "Kjeller, yttervegg",
    ...overrides,
  } as Input;
}

/** Input til endring som speiler en sak (fritekst som klager), med overstyringer. */
function inputFrom(
  claim: { claimType: string; receivedAt: string; claimantText: string | null },
  overrides: Record<string, unknown> = {},
): Input {
  return claimInput({
    claimType: claim.claimType,
    receivedAt: claim.receivedAt,
    claimantText: claim.claimantText,
    ...overrides,
  });
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function person(organizationId: string, roles: EmployeeRole[]) {
  const actor = await createUser();
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor: admin, employee: adminEmployee } = await person(org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

type ClaimDbRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  assignment_id: string;
  outcome: string;
  amount: number | null;
  closed_at: string | null;
  deleted_at: string | null;
  created_by: string;
  claimant_party_id: string | null;
  claimant_text: string | null;
  description: string;
  building_part_text: string | null;
  row_version: number;
};

/** Raden slik den står i databasen (med SQL, utenom kjernen). Tidspunkt og dato som tekst. */
async function claimRow(id: string): Promise<ClaimDbRow> {
  const [row] = await db.execute<ClaimDbRow>(sql`
    select id, organization_id, assignment_id, claim_type, received_at::text as received_at,
      claimant_party_id, claimant_text, description, building_part_text, outcome, amount,
      closed_at::text as closed_at, created_by::text as created_by,
      updated_at::text as updated_at, deleted_at::text as deleted_at, row_version
    from claims where id = ${id}`);
  if (!row) throw new Error("fant ikke saken");
  return { ...row, amount: row.amount === null ? null : Number(row.amount) };
}

async function claimIdsIn(organizationId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from claims where organization_id = ${organizationId}`,
  );
  return [...rows].map((row) => row.id);
}

async function claimCount(): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from claims`);
  return row?.n ?? 0;
}

async function rowCount(table: typeof auditLog | typeof events) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    claims: await claimCount(),
    auditLog: await rowCount(auditLog),
    events: await rowCount(events),
  };
}

async function eventsFor(organizationId: string) {
  return db.select().from(events).where(eq(events.organizationId, organizationId));
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

async function expectDenied(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(error, `AccessDeniedError (fikk ${String(error)})`).toBeInstanceOf(AccessDeniedError);
  return error as Error;
}

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Avvist i kjernen (tilgang, part eller validering), aldri av databasen. */
async function expectRejectedInCore(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(pgCode(error), `databasefeil (fikk ${String(error)})`).toBeUndefined();
  const message = error instanceof Error ? error.message : String(error);
  expect(message).not.toMatch(/violates|foreign key|constraint|insert into|update |select /i);
  return error;
}

/** Regelkodene (`params.rule`) på en valideringsfeil. */
function rulesOf(error: unknown): string[] {
  const issues = (error as { issues?: { params?: { rule?: unknown } }[] }).issues ?? [];
  return issues.map((issue) => String(issue.params?.rule ?? ""));
}

/** Et oppsett med en sak, oppdrag og part i organisasjonen. */
async function claimSetup(organizationId: string) {
  const assignment = await createAssignment(organizationId);
  const party = await createAssignmentParty(organizationId, {
    assignmentId: assignment.id,
    role: "buyer",
    name: "Kjøper Test",
  });
  const claim = await insertClaim(organizationId, { assignmentId: assignment.id });
  return { assignment, party, claim };
}

type Services = {
  name: string;
  run: (actor: Actor, organizationId: string, ids: Ids) => Promise<unknown>;
};
type Ids = { assignmentId: string; claimId: string };

const SERVICES: Services[] = [
  {
    name: "listClaimsForAssignment",
    run: (actor, org, ids) => core.listClaimsForAssignment(actor, org, ids.assignmentId),
  },
  { name: "getClaim", run: (actor, org, ids) => core.getClaim(actor, org, ids.claimId) },
  {
    name: "createClaim",
    run: (actor, org, ids) => core.createClaim(actor, org, ids.assignmentId, claimInput(), NOW),
  },
  {
    name: "updateClaim",
    run: (actor, org, ids) =>
      core.updateClaim(actor, org, ids.claimId, claimInput({ outcome: "rejected" }), NOW),
  },
  { name: "removeClaim", run: (actor, org, ids) => core.removeClaim(actor, org, ids.claimId, NOW) },
];

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

const EDIT_ALL = [true, false];

describe("4.1 tilgang per rolle", () => {
  it.each(
    (["manager", "admin"] as const).flatMap((role) =>
      EDIT_ALL.map((editAll) => ({ role, editAll })),
    ),
  )("4.1.1 $role (innstillingen $editAll) lykkes med alle fem", async ({ role, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const { actor } = await person(org.id, [role]);
    const { assignment, claim } = await claimSetup(org.id);
    const ids = { assignmentId: assignment.id, claimId: claim.id };

    const list = (await core.listClaimsForAssignment(actor, org.id, assignment.id)) as {
      id: string;
    }[];
    expect(list.map((row) => row.id)).toEqual([claim.id]);
    expect((await core.getClaim(actor, org.id, claim.id)).id).toBe(claim.id);
    const created = await core.createClaim(actor, org.id, assignment.id, claimInput(), NOW);
    expect(created.id).toBeTruthy();
    const updated = await core.updateClaim(
      actor,
      org.id,
      claim.id,
      claimInput({ outcome: "rejected" }),
      NOW,
    );
    expect(updated.outcome).toBe("rejected");
    expect((await core.removeClaim(actor, org.id, ids.claimId, NOW)).id).toBe(claim.id);
  });

  it.each(
    (["inspector", "office"] as const).flatMap((role) =>
      EDIT_ALL.flatMap((editAll) => SERVICES.map((service) => ({ role, editAll, service }))),
    ),
  )(
    "4.1.2 $role (innstillingen $editAll) får AccessDeniedError på $service.name, ingenting endres",
    async ({ role, editAll, service }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, [role]);
      const { assignment, claim } = await claimSetup(org.id);
      const before = await tableCounts();
      const rowBefore = await claimRow(claim.id);

      await expectDenied(
        service.run(actor, org.id, { assignmentId: assignment.id, claimId: claim.id }),
      );

      expect(await tableCounts()).toEqual(before);
      expect(await claimRow(claim.id)).toEqual(rowBefore);
    },
  );

  it.each(EDIT_ALL.flatMap((editAll) => SERVICES.map((service) => ({ editAll, service }))))(
    "4.1.3 takstmann med enkeltrettighetene claims.manage og claims.read (innstillingen $editAll) avvises på $service.name",
    async ({ editAll, service }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const { actor, employee } = await person(org.id, ["inspector"]);
      await grantPermission(employee, "claims.manage");
      await grantPermission(employee, "claims.read");
      const { assignment, claim } = await claimSetup(org.id);
      const before = await tableCounts();

      await expectDenied(
        service.run(actor, org.id, { assignmentId: assignment.id, claimId: claim.id }),
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  it.each(SERVICES)(
    "4.1.4 takstmann med enkeltrettigheten assignment.edit (innstillingen av) avvises på $name",
    async (service) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, false);
      const { actor, employee } = await person(org.id, ["inspector"]);
      await grantPermission(employee, "assignment.edit");
      const { assignment, claim } = await claimSetup(org.id);

      await expectDenied(
        service.run(actor, org.id, { assignmentId: assignment.id, claimId: claim.id }),
      );
    },
  );

  type BrokenPerson = { name: string; make: (organizationId: string) => Promise<Actor> };
  const BROKEN: BrokenPerson[] = [
    { name: "ingen ansattrad", make: async () => createUser() },
    {
      name: "deaktivert ansatt (leder)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["manager"]);
        await db.update(employees).set({ deactivatedAt: NOW }).where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "slettet ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db.update(employees).set({ deletedAt: NOW }).where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "ansatt uten roller",
      make: async (organizationId) => (await person(organizationId, [])).actor,
    },
  ];

  it.each(BROKEN)(
    "4.1.5 $name får AccessDeniedError på liste og registrering",
    async ({ make }) => {
      const { org } = await orgWithAdmin();
      const actor = await make(org.id);
      const { assignment } = await claimSetup(org.id);
      const before = await tableCounts();

      await expectDenied(core.listClaimsForAssignment(actor, org.id, assignment.id));
      await expectDenied(core.createClaim(actor, org.id, assignment.id, claimInput(), NOW));
      expect(await tableCounts()).toEqual(before);
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.6 admin uten andre roller, innstillingen av, kan registrere, lese, endre, lukke, gjenåpne og fjerne", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const assignment = await createAssignment(org.id);

    const created = await core.createClaim(admin, org.id, assignment.id, claimInput(), NOW);
    expect(created.outcome).toBe("open");
    expect((await core.getClaim(admin, org.id, created.id)).id).toBe(created.id);
    const list = await core.listClaimsForAssignment(admin, org.id, assignment.id);
    expect(list.map((row) => row.id)).toEqual([created.id]);

    const edited = await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ description: "Fukt i kjeller, endret" }),
      NOW,
    );
    expect(edited.description).toBe("Fukt i kjeller, endret");

    const closed = await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ outcome: "upheld", amount: 50_000 }),
      LATER,
    );
    expect(closed.outcome).toBe("upheld");
    expect(closed.amount).toBe(50_000);

    const reopened = await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ outcome: "open" }),
      EVEN_LATER,
    );
    expect(reopened.outcome).toBe("open");
    expect(reopened.closedAt).toBeNull();

    await core.removeClaim(admin, org.id, created.id, EVEN_LATER);
    expect(await core.listClaimsForAssignment(admin, org.id, assignment.id)).toEqual([]);
    expect((await claimRow(created.id)).deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon: ett expectTenantIsolation per tjeneste
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listClaimsForAssignment viser aldri saker fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await claimSetup(grantA.organizationId);
        const b = await claimSetup(grantB.organizationId);
        assignmentFor.set(grantA.organizationId, a.assignment.id);
        assignmentFor.set(grantB.organizationId, b.assignment.id);
        return { a: [a.claim.id], b: [b.claim.id] };
      },
      query: (actor, organizationId) =>
        core.listClaimsForAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        ),
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 getClaim gir aldri en sak fra en annen organisasjon", async () => {
    const claimFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertClaim(grantA.organizationId);
        const b = await insertClaim(grantB.organizationId);
        claimFor.set(grantA.organizationId, a.id);
        claimFor.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await core.getClaim(actor, organizationId, claimFor.get(organizationId) ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
  });

  it("4.2.3 createClaim registrerer bare i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        assignmentFor.set(grantA.organizationId, a.id);
        assignmentFor.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await core.createClaim(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          claimInput(),
          NOW,
        ),
      ],
      idOf: (row) => row.assignmentId,
    });

    expect(await claimIdsIn(orgB)).toHaveLength(1);
    for (const row of await eventsFor(orgB)) expect(row.organizationId).toBe(orgB);
    for (const row of await auditRows(orgB)) expect(row.organizationId).toBe(orgB);
    expect(await claimCount()).toBe(2);
  });

  it("4.2.4 updateClaim endrer bare saker i egen organisasjon", async () => {
    const claimFor = new Map<string, string>();
    let claimB = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await insertClaim(grantA.organizationId);
        const b = await insertClaim(grantB.organizationId);
        claimFor.set(grantA.organizationId, a.id);
        claimFor.set(grantB.organizationId, b.id);
        claimB = b.id;
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await core.updateClaim(
          actor,
          organizationId,
          claimFor.get(organizationId) ?? randomUUID(),
          claimInput({ outcome: "rejected" }),
          NOW,
        ),
      ],
      idOf: (row) => row.id,
    });

    const rowB = await claimRow(claimB);
    expect(rowB.outcome).toBe("rejected");
    expect(rowB.row_version).toBe(2);
    const auditB = (await auditRows(orgB)).filter((row) => row.entityId === claimB);
    expect(auditB).toHaveLength(1);
    expect(auditB[0]!.organizationId).toBe(orgB);
  });

  it("4.2.5 removeClaim fjerner bare saker i egen organisasjon", async () => {
    const claimFor = new Map<string, string>();
    let claimB = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await insertClaim(grantA.organizationId);
        const b = await insertClaim(grantB.organizationId);
        claimFor.set(grantA.organizationId, a.id);
        claimFor.set(grantB.organizationId, b.id);
        claimB = b.id;
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await core.removeClaim(
          actor,
          organizationId,
          claimFor.get(organizationId) ?? randomUUID(),
          NOW,
        ),
      ],
      idOf: (row) => row.id,
    });

    const rowB = await claimRow(claimB);
    expect(rowB.deleted_at).not.toBeNull();
    expect(rowB.row_version).toBe(2);
    const auditB = (await auditRows(orgB)).filter((row) => row.entityId === claimB);
    expect(auditB).toHaveLength(1);
    expect(await claimCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed id med egen organisasjon", () => {
  it("4.3.1 Bs oppdrag i liste og registrering gir AccessDeniedError, ingen ny rad eller hendelse", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const { assignment: assignmentB } = await claimSetup(b.org.id);
    const before = await tableCounts();

    await expectDenied(core.listClaimsForAssignment(a.admin, a.org.id, assignmentB.id));
    await expectDenied(core.createClaim(a.admin, a.org.id, assignmentB.id, claimInput(), NOW));
    expect(await tableCounts()).toEqual(before);
  });

  it.each(["getClaim", "updateClaim", "removeClaim"] as const)(
    "4.3.2 Bs sak i %s gir AccessDeniedError, saken er uendret",
    async (name) => {
      const a = await orgWithAdmin("Organisasjon A");
      const b = await orgWithAdmin("Organisasjon B");
      const { claim: claimB } = await claimSetup(b.org.id);
      const before = await claimRow(claimB.id);
      const counts = await tableCounts();

      const run =
        name === "getClaim"
          ? core.getClaim(a.admin, a.org.id, claimB.id)
          : name === "updateClaim"
            ? core.updateClaim(
                a.admin,
                a.org.id,
                claimB.id,
                claimInput({ outcome: "settled", amount: 1 }),
                NOW,
              )
            : core.removeClaim(a.admin, a.org.id, claimB.id, NOW);
      await expectDenied(run);

      const after = await claimRow(claimB.id);
      expect(after).toEqual(before);
      expect(after.deleted_at).toBeNull();
      expect(await tableCounts()).toEqual(counts);
    },
  );

  it("4.3.3 organizationId, createdBy og closedAt i input ignoreres", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const other = await person(a.org.id, ["manager"]);
    const assignment = await createAssignment(a.org.id);

    const created = await core.createClaim(
      a.admin,
      a.org.id,
      assignment.id,
      claimInput({
        organizationId: b.org.id,
        createdBy: other.employee.id,
        closedAt: "2026-01-01T00:00:00Z",
      }),
      NOW,
    );

    const row = await claimRow(created.id);
    expect(row.organization_id).toBe(a.org.id);
    // Kortet: `created_by` er den ansatte som registrerte saken, aldri en verdi fra skjemaet
    expect(row.created_by).toBe(a.adminEmployee.id);
    expect(row.closed_at).toBeNull();
    expect(await claimIdsIn(b.org.id)).toEqual([]);
  });

  it.each([
    { name: "tilfeldig uuid", id: randomUUID() },
    { name: "«ikke-en-id»", id: "ikke-en-id" },
  ])("4.3.4 $name som oppdrags-id og sak-id gir AccessDeniedError", async ({ id }) => {
    const { org, admin } = await orgWithAdmin();
    await expectDenied(core.listClaimsForAssignment(admin, org.id, id));
    await expectDenied(core.createClaim(admin, org.id, id, claimInput(), NOW));
    await expectDenied(core.getClaim(admin, org.id, id));
    await expectDenied(core.updateClaim(admin, org.id, id, claimInput(), NOW));
    await expectDenied(core.removeClaim(admin, org.id, id, NOW));
    expect(await claimCount()).toBe(0);
  });

  it.each([
    { name: "tilfeldig uuid", id: randomUUID() },
    { name: "«ikke-en-id»", id: "ikke-en-id" },
  ])("4.3.4 $name som part-id avvises i kjernen, aldri databasefeil", async ({ id }) => {
    const { org, admin } = await orgWithAdmin();
    const { assignment, claim } = await claimSetup(org.id);
    const before = await claimRow(claim.id);

    await expectRejectedInCore(
      core.createClaim(admin, org.id, assignment.id, claimInput({ claimantPartyId: id }), NOW),
    );
    await expectRejectedInCore(
      core.updateClaim(admin, org.id, claim.id, inputFrom(claim, { claimantPartyId: id }), NOW),
    );
    expect(await claimCount()).toBe(1);
    expect(await claimRow(claim.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Fjernet oppdrag og myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 fjernet oppdrag og myk sletting", () => {
  it("4.4.1 fjernet oppdrag gir samme feil som et fremmed oppdrag, og ingen ny rad", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const removed = await createAssignment(a.org.id, { deletedAt: NOW });
    const foreign = await createAssignment(b.org.id);
    const before = await tableCounts();

    const removedCreate = await expectDenied(
      core.createClaim(a.admin, a.org.id, removed.id, claimInput(), NOW),
    );
    const removedList = await expectDenied(
      core.listClaimsForAssignment(a.admin, a.org.id, removed.id),
    );
    const foreignCreate = await expectDenied(
      core.createClaim(a.admin, a.org.id, foreign.id, claimInput(), NOW),
    );
    const foreignList = await expectDenied(
      core.listClaimsForAssignment(a.admin, a.org.id, foreign.id),
    );

    for (const [mine, theirs] of [
      [removedCreate, foreignCreate],
      [removedList, foreignList],
    ] as const) {
      expect(mine.name).toBe(theirs.name);
      expect(mine.message).toBe(theirs.message);
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("4.4.2 removeClaim setter deleted_at, raden står med alle felt urørt", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const { claim } = await claimSetup(org.id);
    const before = await claimRow(claim.id);

    const result = await core.removeClaim(admin, org.id, claim.id, NOW);
    expect(result.id).toBe(claim.id);

    const after = await claimRow(claim.id);
    expect(after.deleted_at).not.toBeNull();
    const deletedBy = (
      await db.execute<{ deleted_by: string | null }>(
        sql`select deleted_by::text as deleted_by from claims where id = ${claim.id}`,
      )
    )[0]?.deleted_by;
    expect([adminEmployee.id, admin.id]).toContain(deletedBy);
    for (const field of [
      "organization_id",
      "assignment_id",
      "claim_type",
      "received_at",
      "claimant_party_id",
      "claimant_text",
      "description",
      "building_part_text",
      "outcome",
      "amount",
      "closed_at",
      "created_by",
    ]) {
      expect(after[field], field).toEqual(before[field]);
    }
  });

  it("4.4.3 fjernet sak vises ikke, og get, update og remove gir AccessDeniedError", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const kept = await insertClaim(org.id, { assignmentId: assignment.id });
    const removed = await insertClaim(org.id, { assignmentId: assignment.id, deletedAt: NOW });
    const before = await claimRow(removed.id);

    const list = await core.listClaimsForAssignment(admin, org.id, assignment.id);
    expect(list.map((row) => row.id)).toEqual([kept.id]);
    await expectDenied(core.getClaim(admin, org.id, removed.id));
    await expectDenied(
      core.updateClaim(admin, org.id, removed.id, claimInput({ outcome: "rejected" }), NOW),
    );
    await expectDenied(core.removeClaim(admin, org.id, removed.id, NOW));
    expect(await claimRow(removed.id)).toEqual(before);
  });

  it("4.4.4 ingen permanent sletting: antall rader er antall registreringer", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const first = await core.createClaim(admin, org.id, assignment.id, claimInput(), NOW);
    const second = await core.createClaim(admin, org.id, assignment.id, claimInput(), NOW);
    await core.updateClaim(
      admin,
      org.id,
      first.id,
      claimInput({ description: "Fukt i kjeller, endret" }),
      NOW,
    );
    await core.updateClaim(admin, org.id, first.id, claimInput({ outcome: "withdrawn" }), LATER);
    await core.removeClaim(admin, org.id, first.id, LATER);
    await core.removeClaim(admin, org.id, second.id, LATER);

    expect(await claimCount()).toBe(2);
    expect(await core.listClaimsForAssignment(admin, org.id, assignment.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Klageren (part eller fritekst)
// ---------------------------------------------------------------------------------------------

type Action = "create" | "update";
const ACTIONS: Action[] = ["create", "update"];

/** Registrerer eller endrer med klageren i `overrides`. Gir id-en til saken det gjelder. */
async function withClaimant(
  action: Action,
  setup: { org: { id: string }; admin: Actor; assignmentId: string; claimId: string },
  overrides: Record<string, unknown>,
) {
  if (action === "create") {
    return core.createClaim(
      setup.admin,
      setup.org.id,
      setup.assignmentId,
      claimInput(overrides),
      NOW,
    );
  }
  return core.updateClaim(setup.admin, setup.org.id, setup.claimId, claimInput(overrides), NOW);
}

describe("4.5 klageren", () => {
  async function setup() {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const { assignment, party, claim } = await claimSetup(org.id);
    return { org, admin, assignmentId: assignment.id, claimId: claim.id, party };
  }

  it.each(ACTIONS)("4.5.1 %s: part på samme oppdrag godtas og lagres", async (action) => {
    const s = await setup();
    const result = await withClaimant(action, s, {
      claimantPartyId: s.party.id,
      claimantText: null,
    });
    const row = await claimRow(result.id);
    expect(row.claimant_party_id).toBe(s.party.id);
    expect(row.claimant_text).toBeNull();
  });

  type BadParty = { name: string; make: (s: Awaited<ReturnType<typeof setup>>) => Promise<string> };
  const BAD_PARTIES: BadParty[] = [
    {
      name: "part på et annet oppdrag i samme organisasjon",
      make: async (s) => (await createAssignmentParty(s.org.id, { role: "buyer" })).id,
    },
    {
      name: "part i en annen organisasjon",
      make: async () => {
        const other = await createOrganization("Organisasjon B");
        return (await createAssignmentParty(other.id, { role: "buyer" })).id;
      },
    },
    {
      name: "fjernet part på samme oppdrag",
      make: async (s) =>
        (
          await createAssignmentParty(s.org.id, {
            assignmentId: s.assignmentId,
            role: "seller",
            deletedAt: NOW,
          })
        ).id,
    },
  ];

  it.each(ACTIONS.flatMap((action) => BAD_PARTIES.map((bad) => ({ action, bad }))))(
    "4.5.2–4 $action: $bad.name avvises, ingenting endres",
    async ({ action, bad }) => {
      const s = await setup();
      const partyId = await bad.make(s);
      const counts = await tableCounts();
      const before = await claimRow(s.claimId);

      await expectRejectedInCore(
        withClaimant(action, s, { claimantPartyId: partyId, claimantText: null }),
      );

      expect(await tableCounts()).toEqual(counts);
      expect(await claimRow(s.claimId)).toEqual(before);
    },
  );

  it.each(ACTIONS)("4.5.5 %s: bare fritekst godtas, claimant_party_id er null", async (action) => {
    const s = await setup();
    const result = await withClaimant(action, s, { claimantText: "Kjøper Test" });
    const row = await claimRow(result.id);
    expect(row.claimant_party_id).toBeNull();
    expect(row.claimant_text).toBe("Kjøper Test");
  });

  it("4.5.6 endring som tar bort både part og fritekst avvises med claimant_required", async () => {
    const s = await setup();
    await core.updateClaim(
      s.admin,
      s.org.id,
      s.claimId,
      claimInput({ claimantPartyId: s.party.id }),
      NOW,
    );
    const before = await claimRow(s.claimId);

    const error = await expectRejectedInCore(
      core.updateClaim(
        s.admin,
        s.org.id,
        s.claimId,
        claimInput({ claimantPartyId: null, claimantText: "" }),
        NOW,
      ),
    );
    expect(rulesOf(error)).toContain("claimant_required");
    expect(await claimRow(s.claimId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Lukking, gjenåpning og closed_at
// ---------------------------------------------------------------------------------------------

describe("4.6 lukking, gjenåpning og closed_at", () => {
  async function registered() {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const claim = await core.createClaim(admin, org.id, assignment.id, claimInput(), NOW);
    return { org, admin, assignment, claim };
  }

  it("4.6.1 ny sak er åpen uten closed_at", async () => {
    const { claim } = await registered();
    expect(claim.outcome).toBe("open");
    expect(claim.closedAt).toBeNull();
    const row = await claimRow(claim.id);
    expect(row.outcome).toBe("open");
    expect(row.closed_at).toBeNull();
  });

  it("4.6.2 lukke med medhold og 50 000: closed_at er tidspunktet, beløpet lagres", async () => {
    const { org, admin, claim } = await registered();
    const closed = await core.updateClaim(
      admin,
      org.id,
      claim.id,
      claimInput({ outcome: "upheld", amount: 50_000 }),
      LATER,
    );
    expect(closed.closedAt?.getTime()).toBe(LATER.getTime());
    const row = await claimRow(claim.id);
    expect(row.amount).toBe(50_000);
    expect(new Date(row.closed_at!).getTime()).toBe(LATER.getTime());
  });

  it("4.6.3 bytte mellom lukkede utfall lar closed_at stå", async () => {
    const { org, admin, claim } = await registered();
    await core.updateClaim(
      admin,
      org.id,
      claim.id,
      claimInput({ outcome: "upheld", amount: 50_000 }),
      LATER,
    );
    const changed = await core.updateClaim(
      admin,
      org.id,
      claim.id,
      claimInput({ outcome: "settled", amount: 30_000 }),
      EVEN_LATER,
    );
    expect(changed.outcome).toBe("settled");
    expect(changed.closedAt?.getTime()).toBe(LATER.getTime());
  });

  it("4.6.4 gjenåpne uten beløp (avvist til åpen) nullstiller closed_at", async () => {
    const { org, admin, claim } = await registered();
    await core.updateClaim(admin, org.id, claim.id, claimInput({ outcome: "rejected" }), LATER);
    const reopened = await core.updateClaim(
      admin,
      org.id,
      claim.id,
      claimInput({ outcome: "open" }),
      EVEN_LATER,
    );
    expect(reopened.closedAt).toBeNull();
    expect((await claimRow(claim.id)).closed_at).toBeNull();
  });

  it("4.6.5 gjenåpne med beløpet stående avvises med amount_only_upheld_or_settled, saken er urørt", async () => {
    const { org, admin, claim } = await registered();
    await core.updateClaim(
      admin,
      org.id,
      claim.id,
      claimInput({ outcome: "settled", amount: 20_000 }),
      LATER,
    );
    const before = await claimRow(claim.id);
    const audits = (await auditRows(org.id)).length;

    const error = await expectRejectedInCore(
      core.updateClaim(
        admin,
        org.id,
        claim.id,
        claimInput({ outcome: "open", amount: 20_000 }),
        EVEN_LATER,
      ),
    );
    expect(rulesOf(error)).toContain("amount_only_upheld_or_settled");
    const after = await claimRow(claim.id);
    expect(after).toEqual(before);
    expect(after.outcome).toBe("settled");
    expect(after.amount).toBe(20_000);
    expect(after.closed_at).not.toBeNull();
    expect((await auditRows(org.id)).length).toBe(audits);
  });

  it("4.6.6 closedAt fra klienten ignoreres ved registrering og endring", async () => {
    const { org, admin, assignment } = await registered();
    const fake = "2020-01-01T00:00:00Z";
    const created = await core.createClaim(
      admin,
      org.id,
      assignment.id,
      claimInput({ closedAt: fake }),
      NOW,
    );
    expect((await claimRow(created.id)).closed_at).toBeNull();

    await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ outcome: "withdrawn", closedAt: fake }),
      LATER,
    );
    expect(new Date((await claimRow(created.id)).closed_at!).getTime()).toBe(LATER.getTime());

    await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ outcome: "open", closedAt: fake }),
      EVEN_LATER,
    );
    expect((await claimRow(created.id)).closed_at).toBeNull();
  });

  it("4.6.7 registrere direkte lukket (avvist) setter closed_at", async () => {
    const { org, admin, assignment } = await registered();
    const created = await core.createClaim(
      admin,
      org.id,
      assignment.id,
      claimInput({ outcome: "rejected" }),
      NOW,
    );
    expect(created.closedAt?.getTime()).toBe(NOW.getTime());
    expect(new Date((await claimRow(created.id)).closed_at!).getTime()).toBe(NOW.getTime());
  });
});

// ---------------------------------------------------------------------------------------------
// 4.7 Revisjonslogg og hendelse (personvern)
// ---------------------------------------------------------------------------------------------

describe("4.7 revisjonslogg og hendelse uten fritekst", () => {
  function markedInput(overrides: Record<string, unknown> = {}) {
    return claimInput({
      claimantText: `Kjøper ${MARK_CLAIMANT}`,
      description: `Fukt i kjeller ${MARK_DESCRIPTION}`,
      buildingPartText: `Kjeller ${MARK_BUILDING_PART}`,
      ...overrides,
    });
  }

  function expectNoMarks(text: string) {
    for (const mark of MARKS) expect(text, `fant ${mark}`).not.toContain(mark);
  }

  it("4.7.1 registrere, endre fritekstene, lukke og fjerne: ingen merker i logg eller hendelser", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const created = await core.createClaim(admin, org.id, assignment.id, markedInput(), NOW);
    await core.updateClaim(
      admin,
      org.id,
      created.id,
      markedInput({
        claimantText: `Selger ${MARK_CLAIMANT}`,
        description: `Lekkasje ${MARK_DESCRIPTION}`,
        buildingPartText: `Bad ${MARK_BUILDING_PART}`,
      }),
      NOW,
    );
    await core.updateClaim(
      admin,
      org.id,
      created.id,
      markedInput({
        claimantText: `Selger ${MARK_CLAIMANT}`,
        description: `Lekkasje ${MARK_DESCRIPTION}`,
        buildingPartText: `Bad ${MARK_BUILDING_PART}`,
        outcome: "settled",
        amount: 20_000,
      }),
      LATER,
    );
    await core.removeClaim(admin, org.id, created.id, LATER);

    const audit = await auditRows(org.id);
    expect(audit.length).toBeGreaterThanOrEqual(4);
    expectNoMarks(JSON.stringify(audit));
    expectNoMarks(JSON.stringify(await eventsFor(org.id)));
  });

  it("4.7.2 endringsraden har feltnavnene, ikke verdiene", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const created = await core.createClaim(admin, org.id, assignment.id, markedInput(), NOW);
    const before = (await auditRows(org.id)).length;
    await core.updateClaim(
      admin,
      org.id,
      created.id,
      markedInput({
        claimantText: `Selger ${MARK_CLAIMANT}`,
        description: `Lekkasje ${MARK_DESCRIPTION}`,
        buildingPartText: `Bad ${MARK_BUILDING_PART}`,
      }),
      NOW,
    );

    const rows = (await auditRows(org.id)).slice(before);
    expect(rows).toHaveLength(1);
    const changes = JSON.stringify(rows[0]!.changes);
    expect(changes).toMatch(/description/);
    expect(changes).toMatch(/claimantText|claimant_text/);
    expect(changes).toMatch(/buildingPartText|building_part_text/);
    expectNoMarks(changes);
    expect(changes).not.toContain("Selger");
    expect(changes).not.toContain("Lekkasje");
  });

  it("4.7.3 claim.registered: én hendelse per registrering med nøyaktig fire nøkler", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const first = await core.createClaim(admin, org.id, assignment.id, markedInput(), NOW);
    await core.createClaim(
      admin,
      org.id,
      assignment.id,
      markedInput({ claimType: "insurance_claim" }),
      NOW,
    );

    const registered = (await eventsFor(org.id)).filter((row) => row.type === "claim.registered");
    expect(registered).toHaveLength(2);
    for (const row of registered) {
      expect(Object.keys(row.data).sort()).toEqual(
        ["assignmentId", "claimId", "claimType", "receivedAt"].sort(),
      );
      expect(row.assignmentId).toBe(assignment.id);
    }
    const firstEvent = registered.find((row) => row.data.claimId === first.id);
    expect(firstEvent?.data).toEqual({
      claimId: first.id,
      assignmentId: assignment.id,
      claimType: "complaint",
      receivedAt: "2026-11-02",
    });

    // Avvist registrering gir ingen hendelse
    const eventsBefore = await rowCount(events);
    await expectRejectedInCore(
      core.createClaim(admin, org.id, assignment.id, markedInput({ description: "" }), NOW),
    );
    expect(await rowCount(events)).toBe(eventsBefore);
  });

  it("4.7.4 registrere, endre og fjerne gir hver nøyaktig én revisjonsrad; avvist handling ingen", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const auditCount = async () => (await auditRows(org.id)).length;

    let before = await auditCount();
    const created = await core.createClaim(admin, org.id, assignment.id, claimInput(), NOW);
    expect(await auditCount()).toBe(before + 1);

    before = await auditCount();
    await core.updateClaim(
      admin,
      org.id,
      created.id,
      claimInput({ outcome: "upheld", amount: 10_000 }),
      NOW,
    );
    expect(await auditCount()).toBe(before + 1);

    before = await auditCount();
    await expectRejectedInCore(
      core.updateClaim(admin, org.id, created.id, claimInput({ outcome: "open", amount: 1 }), NOW),
    );
    await expectRejectedInCore(
      core.createClaim(
        admin,
        org.id,
        assignment.id,
        claimInput({ claimantPartyId: randomUUID() }),
        NOW,
      ),
    );
    expect(await auditCount()).toBe(before);

    before = await auditCount();
    await core.removeClaim(admin, org.id, created.id, NOW);
    expect(await auditCount()).toBe(before + 1);
  });

  it("4.7.5 ingen logglinje inneholder merkene ved mislykket registrering (ugyldig part)", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    const consoleSpies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await expectRejectedInCore(
      core.createClaim(
        admin,
        org.id,
        assignment.id,
        markedInput({ claimantPartyId: randomUUID() }),
        NOW,
      ),
    );

    for (const spy of [...spies, ...consoleSpies]) {
      expectNoMarks(JSON.stringify(spy.mock.calls));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.8 Lesing
// ---------------------------------------------------------------------------------------------

/** Feltene på en sak ut av kjernen (låst etter utviklerens valg, testplanen 4.8.1). */
const CLAIM_KEYS = [
  "amount",
  "assignmentId",
  "buildingPartText",
  "claimType",
  "claimantPartyId",
  "claimantPartyName",
  "claimantText",
  "closedAt",
  "createdAt",
  "createdBy",
  "description",
  "id",
  "outcome",
  "receivedAt",
  "updatedAt",
];

describe("4.8 lesing", () => {
  it("4.8.1 faste felt på saken og i listen, uten organisasjon og slettefelt", async () => {
    const { org, admin } = await orgWithAdmin();
    const { assignment, claim } = await claimSetup(org.id);

    const one = await core.getClaim(admin, org.id, claim.id);
    expect(Object.keys(one).sort()).toEqual(CLAIM_KEYS);
    const list = await core.listClaimsForAssignment(admin, org.id, assignment.id);
    expect(list).toHaveLength(1);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(CLAIM_KEYS);
      for (const forbidden of ["organizationId", "deletedAt", "deletedBy"]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
    for (const forbidden of ["organizationId", "deletedAt", "deletedBy"]) {
      expect(one).not.toHaveProperty(forbidden);
    }
  });

  it("4.8.2 listen er sortert på mottatt dato, nyest først", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const middle = await insertClaim(org.id, {
      assignmentId: assignment.id,
      receivedAt: "2026-10-15",
    });
    const oldest = await insertClaim(org.id, {
      assignmentId: assignment.id,
      receivedAt: "2026-09-01",
    });
    const newest = await insertClaim(org.id, {
      assignmentId: assignment.id,
      receivedAt: "2026-11-02",
    });

    const list = await core.listClaimsForAssignment(admin, org.id, assignment.id);
    expect(list.map((row) => row.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(list.map((row) => row.receivedAt)).toEqual(["2026-11-02", "2026-10-15", "2026-09-01"]);
  });

  it("4.8.3 når klageren er en part, er navnet med i listen og på saken", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "buyer",
      name: "Kjøper Test",
    });
    const claim = await insertClaim(org.id, {
      assignmentId: assignment.id,
      claimantPartyId: party.id,
      claimantText: null,
    });

    const [row] = await core.listClaimsForAssignment(admin, org.id, assignment.id);
    expect(row?.claimantPartyId).toBe(party.id);
    expect(row?.claimantPartyName).toBe("Kjøper Test");
    expect((await core.getClaim(admin, org.id, claim.id)).claimantPartyName).toBe("Kjøper Test");
  });

  it("4.8.4 oppdrag uten saker gir tom liste", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    expect(await core.listClaimsForAssignment(admin, org.id, assignment.id)).toEqual([]);
  });

  it("created_by er den ansatte som registrerte saken", async () => {
    const { org } = await orgWithAdmin();
    const manager = await person(org.id, ["manager"]);
    const assignment = await createAssignment(org.id);
    const created = await core.createClaim(manager.actor, org.id, assignment.id, claimInput(), NOW);
    expect((await claimRow(created.id)).created_by).toBe(manager.employee.id);
  });
});
