import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { EVENT_TYPES } from "@/core/events";
import { db } from "@/db/client";
import { auditLog, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createClientAgreement,
  createEmployee,
  createFirm,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as core from "./index";

/*
 * Avtalen på oppdraget: `setAssignmentAgreement` og avtalen i `getAssignment`.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 5 (og 5.4.2 for
 * forslaget, som også har egne tester i suggest.test.ts).
 *
 * Avvises uten: 5.3 (med admin-testen 5.3.3) og 5.4. Regel 2 og 11.
 *
 * Fast tid: `TEST_NOW` (2026-11-03 i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (slettet, utløpt eller ikke påbegynt avtale kan aldri velges,
 * og en avtale fra en annen organisasjon stoppes i kjernen) og tid (valget lagres med ett kall,
 * og hendelse og logg kommer bare når noe faktisk endres).
 */

beforeEach(resetDatabase);

const NOW = TEST_NOW;
const YESTERDAY = "2026-11-02";
const TOMORROW = "2026-11-04";
const EVENT = "assignment.agreement_changed";

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
  const { actor: admin } = await person(org.id, ["admin"]);
  return { org, admin };
}

/** `client_agreement_id` på oppdraget, rett fra databasen. */
async function agreementIdOn(assignmentId: string): Promise<string | null> {
  const [row] = (await db.execute(
    sql`select client_agreement_id from assignments where id = ${assignmentId}`,
  )) as unknown as { client_agreement_id: string | null }[];
  if (!row) throw new Error("fant ikke oppdraget");
  return row.client_agreement_id;
}

async function setAgreementIdDirectly(assignmentId: string, agreementId: string | null) {
  await db.execute(
    sql`update assignments set client_agreement_id = ${agreementId} where id = ${assignmentId}`,
  );
}

async function agreementEvents(assignmentId: string) {
  return (await db.select().from(events).where(eq(events.assignmentId, assignmentId)))
    .filter((row) => row.type === EVENT)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

async function counts() {
  const [audit] = await db.select({ n: count() }).from(auditLog);
  const [event] = await db.select({ n: count() }).from(events);
  return { audit: audit?.n ?? 0, events: event?.n ?? 0 };
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

function expectNotFoundOrDenied(error: unknown) {
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(
    error instanceof core.NotFoundError || error instanceof AccessDeniedError,
    `ventet NotFoundError eller AccessDeniedError, fikk ${String(error)}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------------------------
// 5.1 Sette, bytte, fjerne
// ---------------------------------------------------------------------------------------------

describe("5.1 sette, bytte og fjerne", () => {
  it("5.1.1–5.1.3 sette, bytte og fjerne gir én hendelse og én loggrad hver", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const x = await createClientAgreement(org.id, { name: "Testavtale X" });
    const y = await createClientAgreement(org.id, { name: "Testavtale Y" });

    // Sette
    let before = await counts();
    await core.setAssignmentAgreement(admin, org.id, assignment.id, x.id, NOW);
    expect(await agreementIdOn(assignment.id)).toBe(x.id);
    expect(await counts()).toEqual({ audit: before.audit + 1, events: before.events + 1 });

    // Bytte
    before = await counts();
    await core.setAssignmentAgreement(admin, org.id, assignment.id, y.id, NOW);
    expect(await agreementIdOn(assignment.id)).toBe(y.id);
    expect(await counts()).toEqual({ audit: before.audit + 1, events: before.events + 1 });

    // Fjerne
    before = await counts();
    await core.setAssignmentAgreement(admin, org.id, assignment.id, null, NOW);
    expect(await agreementIdOn(assignment.id)).toBeNull();
    expect(await counts()).toEqual({ audit: before.audit + 1, events: before.events + 1 });

    const data = (await agreementEvents(assignment.id)).map((row) => row.data);
    expect(data).toEqual([
      expect.objectContaining({ fromAgreementId: null, toAgreementId: x.id }),
      expect.objectContaining({ fromAgreementId: x.id, toAgreementId: y.id }),
      expect.objectContaining({ fromAgreementId: y.id, toAgreementId: null }),
    ]);
    for (const row of await agreementEvents(assignment.id)) {
      expect(row.organizationId).toBe(org.id);
    }
  });

  it.each([
    { name: "slettet", overrides: { deletedAt: new Date("2026-11-01T08:00:00Z") } },
    { name: "utløpt", overrides: { validFrom: "2026-01-01", validTo: YESTERDAY } },
    { name: "ikke påbegynt", overrides: { validFrom: TOMORROW } },
  ])("5.1.3 fjerne er lov også når avtalen er $name", async ({ overrides }) => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id, overrides);
    await setAgreementIdDirectly(assignment.id, agreement.id);

    await core.setAssignmentAgreement(admin, org.id, assignment.id, null, NOW);

    expect(await agreementIdOn(assignment.id)).toBeNull();
    expect((await agreementEvents(assignment.id)).map((row) => row.data)).toEqual([
      expect.objectContaining({ fromAgreementId: agreement.id, toAgreementId: null }),
    ]);
  });

  it("5.1.4 samme verdi to ganger (X → X og null → null) gir ingen ny hendelse eller loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const x = await createClientAgreement(org.id);

    // null → null
    let before = await counts();
    await core.setAssignmentAgreement(admin, org.id, assignment.id, null, NOW);
    expect(await counts()).toEqual(before);

    // X → X
    await core.setAssignmentAgreement(admin, org.id, assignment.id, x.id, NOW);
    before = await counts();
    await core.setAssignmentAgreement(admin, org.id, assignment.id, x.id, NOW);
    expect(await counts()).toEqual(before);
    expect(await agreementIdOn(assignment.id)).toBe(x.id);
    expect(await agreementEvents(assignment.id)).toHaveLength(1);
  });

  it("5.1.5 EVENT_TYPES har assignment.agreement_changed", () => {
    expect(EVENT_TYPES).toContain(EVENT);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.2 Avvisning i kjernen (regeltest som data)
// ---------------------------------------------------------------------------------------------

type RejectCase = {
  name: string;
  make: (organizationId: string) => Promise<string>;
  expected: { message: string } | "not_found";
};

const REJECT_CASES: RejectCase[] = [
  {
    name: "slettet",
    make: async (organizationId) =>
      (
        await createClientAgreement(organizationId, {
          deletedAt: new Date("2026-11-01T08:00:00Z"),
        })
      ).id,
    expected: { message: "Avtalen er fjernet." },
  },
  {
    name: "utløpt (validTo i går)",
    make: async (organizationId) =>
      (await createClientAgreement(organizationId, { validFrom: "2026-01-01", validTo: YESTERDAY }))
        .id,
    expected: { message: "Avtalen gjelder ikke i dag." },
  },
  {
    name: "ikke påbegynt (validFrom i morgen)",
    make: async (organizationId) =>
      (await createClientAgreement(organizationId, { validFrom: TOMORROW })).id,
    expected: { message: "Avtalen gjelder ikke i dag." },
  },
  {
    name: "fra organisasjon B",
    make: async () => (await createClientAgreement((await createOrganization("Org B")).id)).id,
    expected: "not_found",
  },
  { name: "tilfeldig uuid", make: async () => randomUUID(), expected: "not_found" },
];

describe("5.2 avvisning i kjernen", () => {
  it.each(REJECT_CASES)(
    "$name avvises; oppdraget er uendret, ingen hendelse, ingen loggrad",
    async ({ make, expected }) => {
      const { org, admin } = await orgWithAdmin();
      const assignment = await createAssignment(org.id);
      const current = await createClientAgreement(org.id, { name: "Testavtale gjeldende" });
      await setAgreementIdDirectly(assignment.id, current.id);
      const agreementId = await make(org.id);
      const before = await counts();

      const error = await caught(
        core.setAssignmentAgreement(admin, org.id, assignment.id, agreementId, NOW),
      );

      if (expected === "not_found") {
        expect(error).toBeInstanceOf(core.NotFoundError);
      } else {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(expected.message);
        expect(error).not.toBeInstanceOf(AccessDeniedError);
      }
      expect(await agreementIdOn(assignment.id)).toBe(current.id);
      expect(await counts()).toEqual(before);
    },
  );

  it("tidssone: avtale som starter 2026-11-04 kan velges kl. 00:30 norsk tid samme dag", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id, { validFrom: TOMORROW });

    await core.setAssignmentAgreement(
      admin,
      org.id,
      assignment.id,
      agreement.id,
      new Date("2026-11-03T23:30:00Z"),
    );
    expect(await agreementIdOn(assignment.id)).toBe(agreement.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("5.3 tilgang per rolle", () => {
  it("5.3.1 takstmann med access.inspectors_edit_all på kan velge avtale", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, true);
    const { actor } = await person(org.id, ["inspector"]);
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id);

    await core.setAssignmentAgreement(actor, org.id, assignment.id, agreement.id, NOW);
    expect(await agreementIdOn(assignment.id)).toBe(agreement.id);
  });

  it("5.3.1 takstmann med innstillingen av får AccessDeniedError; ingenting endres", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const { actor } = await person(org.id, ["inspector"]);
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id);
    const before = await counts();

    await expect(
      core.setAssignmentAgreement(actor, org.id, assignment.id, agreement.id, NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      core.setAssignmentAgreement(actor, org.id, assignment.id, null, NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await agreementIdOn(assignment.id)).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it.each(["office", "manager", "admin"] as EmployeeRole[])(
    "5.3.2 %s kan velge avtale med innstillingen av",
    async (role) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, [role]);
      const assignment = await createAssignment(org.id);
      const agreement = await createClientAgreement(org.id);

      await core.setAssignmentAgreement(actor, org.id, assignment.id, agreement.id, NOW);
      expect(await agreementIdOn(assignment.id)).toBe(agreement.id);
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("5.3.3 admin uten andre roller, innstillingen av, kan velge, bytte og fjerne", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const assignment = await createAssignment(org.id);
    const x = await createClientAgreement(org.id);
    const y = await createClientAgreement(org.id);

    await core.setAssignmentAgreement(admin, org.id, assignment.id, x.id, NOW);
    await core.setAssignmentAgreement(admin, org.id, assignment.id, y.id, NOW);
    expect(await agreementIdOn(assignment.id)).toBe(y.id);
    await core.setAssignmentAgreement(admin, org.id, assignment.id, null, NOW);
    expect(await agreementIdOn(assignment.id)).toBeNull();
  });

  it("5.3.4 slettet oppdrag eller oppdrag fra B avvises; ingenting endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const orgB = await createOrganization("Organisasjon B");
    const deleted = await createAssignment(org.id, { deletedAt: new Date("2026-11-01T08:00:00Z") });
    const foreign = await createAssignment(orgB.id);
    const agreement = await createClientAgreement(org.id);
    const before = await counts();

    expectNotFoundOrDenied(
      await caught(core.setAssignmentAgreement(admin, org.id, deleted.id, agreement.id, NOW)),
    );
    expectNotFoundOrDenied(
      await caught(core.setAssignmentAgreement(admin, org.id, foreign.id, agreement.id, NOW)),
    );
    expectNotFoundOrDenied(
      await caught(core.setAssignmentAgreement(admin, org.id, "ikke-en-id", agreement.id, NOW)),
    );
    expect(await agreementIdOn(deleted.id)).toBeNull();
    expect(await agreementIdOn(foreign.id)).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it("uten ansattrad får AccessDeniedError", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id);
    const stranger = await createUser();

    await expect(
      core.setAssignmentAgreement(stranger, org.id, assignment.id, agreement.id, NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.4 Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

describe("5.4 tenant-isolasjon", () => {
  it("5.4.1 setAssignmentAgreement endrer bare oppdrag i egen organisasjon", async () => {
    const setup = new Map<string, { assignmentId: string; agreementId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const agreement = await createClientAgreement(grant.organizationId);
          setup.set(grant.organizationId, {
            assignmentId: assignment.id,
            agreementId: agreement.id,
          });
        }
        return {
          a: [setup.get(grantA.organizationId)!.assignmentId],
          b: [setup.get(grantB.organizationId)!.assignmentId],
        };
      },
      query: async (actor, organizationId) => {
        const own = setup.get(organizationId) ?? {
          assignmentId: randomUUID(),
          agreementId: randomUUID(),
        };
        await core.setAssignmentAgreement(
          actor,
          organizationId,
          own.assignmentId,
          own.agreementId,
          NOW,
        );
        return [{ id: own.assignmentId }];
      },
      idOf: (row) => row.id,
    });
    for (const { assignmentId, agreementId } of setup.values()) {
      expect(await agreementIdOn(assignmentId)).toBe(agreementId);
    }
  });

  it("5.4.2 suggestAgreementForAssignment peker aldri på en avtale i en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string> = {};
        for (const grant of [grantA, grantB]) {
          const firm = await createFirm(grant.organizationId, { firmType: "insurer" });
          const agreement = await createClientAgreement(grant.organizationId, { firmId: firm.id });
          const order = await createOrder(grant.organizationId, { orderedByFirmId: firm.id });
          const assignment = await createAssignment(grant.organizationId, { orderId: order.id });
          assignmentFor.set(grant.organizationId, assignment.id);
          ids[grant.organizationId] = agreement.id;
        }
        return { a: [ids[grantA.organizationId]!], b: [ids[grantB.organizationId]!] };
      },
      query: async (actor, organizationId) => {
        const suggestion = await core.suggestAgreementForAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          NOW,
        );
        return suggestion ? [suggestion] : [];
      },
      idOf: (row) => row.agreementId,
    });
  });

  it("5.4.3 getAssignment tar bare med avtalen fra egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string> = {};
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const agreement = await createClientAgreement(grant.organizationId);
          await setAgreementIdDirectly(assignment.id, agreement.id);
          assignmentFor.set(grant.organizationId, assignment.id);
          ids[grant.organizationId] = agreement.id;
        }
        return { a: [ids[grantA.organizationId]!], b: [ids[grantB.organizationId]!] };
      },
      query: async (actor, organizationId) => {
        const detail = await getAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        );
        const agreement = (detail as { agreement?: { id: string } | null }).agreement;
        return agreement ? [agreement] : [];
      },
      idOf: (row) => row.id,
    });
  });

  it("5.4.4 blandet: oppdrag i A med avtale i B, og oppdrag i B med avtale i A, avvises", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB, admin: adminB } = await orgWithAdmin("Organisasjon B");
    const assignmentA = await createAssignment(orgA.id);
    const assignmentB = await createAssignment(orgB.id);
    const agreementA = await createClientAgreement(orgA.id);
    const agreementB = await createClientAgreement(orgB.id);
    const before = await counts();

    expectNotFoundOrDenied(
      await caught(
        core.setAssignmentAgreement(adminA, orgA.id, assignmentA.id, agreementB.id, NOW),
      ),
    );
    expectNotFoundOrDenied(
      await caught(
        core.setAssignmentAgreement(adminA, orgA.id, assignmentB.id, agreementA.id, NOW),
      ),
    );
    expectNotFoundOrDenied(
      await caught(
        core.setAssignmentAgreement(adminB, orgB.id, assignmentB.id, agreementA.id, NOW),
      ),
    );
    expect(await agreementIdOn(assignmentA.id)).toBeNull();
    expect(await agreementIdOn(assignmentB.id)).toBeNull();
    expect(await counts()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5 Samtidighet
// ---------------------------------------------------------------------------------------------

describe("5.5 samtidighet", () => {
  it("5.5.1 to samtidige valg (X og Y): sluttverdien er én av dem, og hendelsene henger sammen", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const x = await createClientAgreement(org.id, { name: "Testavtale X" });
    const y = await createClientAgreement(org.id, { name: "Testavtale Y" });

    const results = await Promise.allSettled([
      core.setAssignmentAgreement(admin, org.id, assignment.id, x.id, NOW),
      core.setAssignmentAgreement(admin, org.id, assignment.id, y.id, NOW),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const final = await agreementIdOn(assignment.id);
    expect([x.id, y.id]).toContain(final);
    const data = (await agreementEvents(assignment.id)).map(
      (row) => row.data as { fromAgreementId: string | null; toAgreementId: string | null },
    );
    expect(data).toHaveLength(2);
    expect(data[0]!.fromAgreementId).toBeNull();
    expect(data[1]!.fromAgreementId).toBe(data[0]!.toAgreementId);
    expect(data[1]!.toAgreementId).toBe(final);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.6 getAssignment med avtalen
// ---------------------------------------------------------------------------------------------

type AgreementOnAssignment = {
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  deletedAt: Date | string | null;
};

async function agreementOf(actor: Parameters<typeof getAssignment>[0], orgId: string, id: string) {
  const detail = await getAssignment(actor, orgId, id);
  return (detail as { agreement?: AgreementOnAssignment | null }).agreement;
}

describe("5.6 getAssignment med avtalen", () => {
  it("5.6.1 har agreement med id, navn, periode og deletedAt; null uten avtale", async () => {
    const { org, admin } = await orgWithAdmin();
    const withAgreement = await createAssignment(org.id);
    const without = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id, {
      name: "Testavtale forsikring",
      validFrom: "2026-03-01",
      validTo: "2026-12-31",
    });
    await setAgreementIdDirectly(withAgreement.id, agreement.id);

    const found = await agreementOf(admin, org.id, withAgreement.id);
    expect(found).toMatchObject({
      id: agreement.id,
      name: "Testavtale forsikring",
      validFrom: "2026-03-01",
      validTo: "2026-12-31",
      deletedAt: null,
    });
    expect(await agreementOf(admin, org.id, without.id)).toBeNull();
  });

  it.each([
    { name: "slettet", overrides: { deletedAt: new Date("2026-10-01T08:00:00Z") }, deleted: true },
    {
      name: "utløpt",
      overrides: { validFrom: "2025-01-01", validTo: "2025-12-31" },
      deleted: false,
    },
  ])("5.6.2 $name avtale tas med (A111)", async ({ overrides, deleted }) => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id, overrides);
    await setAgreementIdDirectly(assignment.id, agreement.id);

    const found = await agreementOf(admin, org.id, assignment.id);
    expect(found?.id).toBe(agreement.id);
    if (deleted) expect(found?.deletedAt).toBeTruthy();
    else expect(found?.deletedAt).toBeNull();
  });

  it("5.6.3 ingen premissetekst i oppdraget", async () => {
    const { org, admin } = await orgWithAdmin();
    const assignment = await createAssignment(org.id);
    const agreement = await createClientAgreement(org.id, {
      premiseText: "Premiss for test. Ikke ekte tekst.",
      reportProfileCode: "test-profil",
    });
    await setAgreementIdDirectly(assignment.id, agreement.id);

    const detail = await getAssignment(admin, org.id, assignment.id);
    expect(JSON.stringify(detail)).not.toContain("Premiss for test");
  });
});
