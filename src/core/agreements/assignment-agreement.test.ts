import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { EVENT_TYPES } from "@/core/events";
import { db } from "@/db/client";
import { auditLog, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createClientAgreement,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AgreementNotUsableError, NotFoundError, setAssignmentAgreement } from "./index";

/*
 * Avtalen på oppdraget: `setAssignmentAgreement` og avtalen i `getAssignment`.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 5.
 *
 * Avvises uten: 5.3 (med admin-testen 5.3.3) og 5.4. Regel 2 og 11.
 *
 * Fast tid: TEST_NOW = 03.11.2026 kl. 11 i Oslo. Testdata er oppdiktet: «Testavtale forsikring»,
 * premisseteksten «Premiss for test. Ikke ekte tekst.».
 *
 * Støtter hovedmål: reklamasjoner (slettet, utløpt eller ikke påbegynt avtale kan aldri velges,
 * avtale fra en annen organisasjon stoppes i kjernen, en avtale som er satt byttes aldri i
 * stillhet) og tid (å velge avtalen er ett kall, med hendelse bare når noe faktisk endres).
 */

beforeEach(resetDatabase);

const EVENT = "assignment.agreement_changed";
const PREMISE = "Premiss for test. Ikke ekte tekst.";
const PREMISE_MARK = "Premiss for test";
const DELETED = new Date("2026-11-01T08:00:00Z");
/** I går og i morgen sett fra TEST_NOW (03.11.2026 i Oslo). */
const YESTERDAY = "2026-11-02";
const TOMORROW = "2026-11-04";

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

/** Organisasjon med admin, ett oppdrag og to gyldige avtaler (X og Y). */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  const x = await createClientAgreement(org.id, { name: "Testavtale X", premiseText: PREMISE });
  const y = await createClientAgreement(org.id, { name: "Testavtale Y" });
  return { org, admin, assignment, x, y };
}

/** `assignments.client_agreement_id` lest med SQL, utenom kjernen. */
async function agreementOf(assignmentId: string): Promise<string | null> {
  const [row] = await db.execute<{ client_agreement_id: string | null }>(
    sql`select client_agreement_id from assignments where id = ${assignmentId}`,
  );
  if (!row) throw new Error("fant ikke oppdraget");
  return row.client_agreement_id;
}

/** Setter avtalen direkte med SQL (oppsett, uten hendelse og logg). */
async function putAgreement(assignmentId: string, agreementId: string | null) {
  await db.execute(
    sql`update assignments set client_agreement_id = ${agreementId} where id = ${assignmentId}`,
  );
}

async function eventsFor(organizationId: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.organizationId, organizationId), eq(events.type, EVENT)));
}

async function rowCount(table: typeof auditLog | typeof events) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function counts() {
  return { events: await rowCount(events), auditLog: await rowCount(auditLog) };
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Ukjent, fremmed eller slettet id: `NotFoundError` eller `AccessDeniedError`. */
async function expectNotFoundOrDenied(run: Promise<unknown>) {
  const error = await caught(run);
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(
    error instanceof NotFoundError || error instanceof AccessDeniedError,
    `NotFoundError eller AccessDeniedError (fikk ${String(error)})`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------------------------
// 5.1 Sette, bytte, fjerne
// ---------------------------------------------------------------------------------------------

describe("5.1 sette, bytte og fjerne avtalen", () => {
  it("5.1.1–5.1.3 sette, bytte og fjerne gir én hendelse og én loggrad hver, med riktig fra og til", async () => {
    const { org, admin, assignment, x, y } = await setup();

    await setAssignmentAgreement(admin, org.id, assignment.id, x.id, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBe(x.id);
    expect(await counts()).toEqual({ events: 1, auditLog: 1 });

    await setAssignmentAgreement(admin, org.id, assignment.id, y.id, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBe(y.id);
    expect(await counts()).toEqual({ events: 2, auditLog: 2 });

    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBeNull();
    expect(await counts()).toEqual({ events: 3, auditLog: 3 });

    const payloads = (await eventsFor(org.id))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .map((row) => ({ assignmentId: row.assignmentId, data: row.data }));
    expect(payloads).toEqual([
      { assignmentId: assignment.id, data: { fromAgreementId: null, toAgreementId: x.id } },
      { assignmentId: assignment.id, data: { fromAgreementId: x.id, toAgreementId: y.id } },
      { assignmentId: assignment.id, data: { fromAgreementId: y.id, toAgreementId: null } },
    ]);

    // Premisseteksten står aldri i hendelse eller logg
    const log = await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id));
    for (const row of [...log, ...(await eventsFor(org.id))]) {
      expect(JSON.stringify(row)).not.toContain(PREMISE_MARK);
      expect(row.organizationId).toBe(org.id);
    }
  });

  it.each([
    { name: "slettet", overrides: { deletedAt: DELETED } },
    { name: "utløpt", overrides: { validFrom: "2026-01-01", validTo: YESTERDAY } },
  ])("5.1.3 fjerne er lov når avtalen er $name", async ({ overrides }) => {
    const { org, admin, assignment } = await setup();
    const old = await createClientAgreement(org.id, overrides);
    await putAgreement(assignment.id, old.id);

    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);

    expect(await agreementOf(assignment.id)).toBeNull();
    expect((await eventsFor(org.id)).map((row) => row.data)).toEqual([
      { fromAgreementId: old.id, toAgreementId: null },
    ]);
  });

  it("5.1.4 samme verdi to ganger (X → X og null → null) gir ingen ny hendelse og ingen ny loggrad", async () => {
    const { org, admin, assignment, x } = await setup();

    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);
    expect(await counts()).toEqual({ events: 0, auditLog: 0 });

    await setAssignmentAgreement(admin, org.id, assignment.id, x.id, TEST_NOW);
    await setAssignmentAgreement(admin, org.id, assignment.id, x.id, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBe(x.id);
    expect(await counts()).toEqual({ events: 1, auditLog: 1 });

    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);
    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);
    expect(await counts()).toEqual({ events: 2, auditLog: 2 });
  });

  it("5.1.5 EVENT_TYPES har assignment.agreement_changed", () => {
    expect(EVENT_TYPES as readonly string[]).toContain(EVENT);
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
    name: "slettet avtale",
    make: async (organizationId) =>
      (await createClientAgreement(organizationId, { deletedAt: DELETED })).id,
    expected: { message: "Avtalen er fjernet." },
  },
  {
    name: "utløpt avtale (validTo i går)",
    make: async (organizationId) =>
      (await createClientAgreement(organizationId, { validFrom: "2026-01-01", validTo: YESTERDAY }))
        .id,
    expected: { message: "Avtalen gjelder ikke i dag." },
  },
  {
    name: "ikke påbegynt avtale (validFrom i morgen)",
    make: async (organizationId) =>
      (await createClientAgreement(organizationId, { validFrom: TOMORROW })).id,
    expected: { message: "Avtalen gjelder ikke i dag." },
  },
  {
    name: "avtale fra organisasjon B",
    make: async () => {
      const orgB = await createOrganization("Organisasjon B");
      return (await createClientAgreement(orgB.id)).id;
    },
    expected: "not_found",
  },
  { name: "tilfeldig uuid", make: async () => randomUUID(), expected: "not_found" },
];

describe("5.2 avvisning i kjernen", () => {
  it.each(REJECT_CASES)(
    "$name avvises; client_agreement_id uendret, ingen hendelse, ingen loggrad",
    async ({ make, expected }) => {
      const { org, admin, assignment, x } = await setup("Organisasjon A");
      await putAgreement(assignment.id, x.id);
      const agreementId = await make(org.id);
      const before = await counts();

      const error = await caught(
        setAssignmentAgreement(admin, org.id, assignment.id, agreementId, TEST_NOW),
      );

      if (expected === "not_found") {
        expect(error, `NotFoundError (fikk ${String(error)})`).toBeInstanceOf(NotFoundError);
      } else {
        expect(error).toBeInstanceOf(AgreementNotUsableError);
        expect((error as Error).message).toBe(expected.message);
      }
      expect(await agreementOf(assignment.id)).toBe(x.id);
      expect(await counts()).toEqual(before);
    },
  );

  it("utløpt avtale som allerede står på oppdraget, kan ikke settes på nytt, men blir stående", async () => {
    const { org, admin, assignment } = await setup();
    const expired = await createClientAgreement(org.id, {
      validFrom: "2026-01-01",
      validTo: YESTERDAY,
    });
    await putAgreement(assignment.id, expired.id);

    // Samme verdi: ingen endring, uansett om kjernen avviser eller hopper over
    await caught(setAssignmentAgreement(admin, org.id, assignment.id, expired.id, TEST_NOW));
    expect(await agreementOf(assignment.id)).toBe(expired.id);
    expect(await counts()).toEqual({ events: 0, auditLog: 0 });
  });

  it("tidssone: avtale som starter 04.11 kan velges 03.11 kl. 23.30 UTC (04.11 i Norge), ikke kl. 11", async () => {
    const { org, admin, assignment } = await setup();
    const starting = await createClientAgreement(org.id, { validFrom: TOMORROW });

    await expect(
      setAssignmentAgreement(admin, org.id, assignment.id, starting.id, TEST_NOW),
    ).rejects.toThrow(AgreementNotUsableError);
    await setAssignmentAgreement(
      admin,
      org.id,
      assignment.id,
      starting.id,
      new Date("2026-11-03T23:30:00Z"),
    );
    expect(await agreementOf(assignment.id)).toBe(starting.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("5.3 tilgang per rolle", () => {
  it("5.3.1 takstmann med access.inspectors_edit_all på kan sette avtalen", async () => {
    const { org, assignment, x } = await setup();
    await setInspectorsEditAll(org.id, true);
    const { actor } = await person(org.id, ["inspector"]);

    await setAssignmentAgreement(actor, org.id, assignment.id, x.id, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBe(x.id);
  });

  it("5.3.1 takstmann med innstillingen av får AccessDeniedError; ingenting endret", async () => {
    const { org, assignment, x, y } = await setup();
    await putAgreement(assignment.id, x.id);
    await setInspectorsEditAll(org.id, false);
    const { actor } = await person(org.id, ["inspector"]);

    for (const target of [y.id, null]) {
      await expect(
        setAssignmentAgreement(actor, org.id, assignment.id, target, TEST_NOW),
      ).rejects.toThrow(AccessDeniedError);
    }
    expect(await agreementOf(assignment.id)).toBe(x.id);
    expect(await counts()).toEqual({ events: 0, auditLog: 0 });
  });

  it.each<EmployeeRole>(["office", "manager", "admin"])(
    "5.3.2 %s kan sette og fjerne med innstillingen av",
    async (role) => {
      const { org, assignment, x } = await setup();
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, [role]);

      await setAssignmentAgreement(actor, org.id, assignment.id, x.id, TEST_NOW);
      expect(await agreementOf(assignment.id)).toBe(x.id);
      await setAssignmentAgreement(actor, org.id, assignment.id, null, TEST_NOW);
      expect(await agreementOf(assignment.id)).toBeNull();
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("5.3.3 admin uten andre roller, innstillingen av, kan sette, bytte og fjerne", async () => {
    const { org, admin, assignment, x, y } = await setup();
    await setInspectorsEditAll(org.id, false);

    await setAssignmentAgreement(admin, org.id, assignment.id, x.id, TEST_NOW);
    await setAssignmentAgreement(admin, org.id, assignment.id, y.id, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBe(y.id);
    await setAssignmentAgreement(admin, org.id, assignment.id, null, TEST_NOW);
    expect(await agreementOf(assignment.id)).toBeNull();
  });

  it("5.3.4 slettet oppdrag → NotFoundError/AccessDeniedError; ingenting endret", async () => {
    const { org, admin, x } = await setup();
    const deleted = await createAssignment(org.id, { deletedAt: DELETED });

    await expectNotFoundOrDenied(setAssignmentAgreement(admin, org.id, deleted.id, x.id, TEST_NOW));
    expect(await agreementOf(deleted.id)).toBeNull();
    expect(await counts()).toEqual({ events: 0, auditLog: 0 });
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "5.3.4 oppdrags-id %s → NotFoundError/AccessDeniedError, aldri databasefeil",
    async (assignmentId) => {
      const { org, admin, x } = await setup();
      await expectNotFoundOrDenied(
        setAssignmentAgreement(admin, org.id, assignmentId, x.id, TEST_NOW),
      );
      expect(await counts()).toEqual({ events: 0, auditLog: 0 });
    },
  );

  it("5.3.4 bruker uten ansattrad får AccessDeniedError", async () => {
    const { org, assignment, x } = await setup();
    const stranger: Actor = await createUser();
    await expect(
      setAssignmentAgreement(stranger, org.id, assignment.id, x.id, TEST_NOW),
    ).rejects.toThrow(AccessDeniedError);
    expect(await agreementOf(assignment.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 5.4 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.4 tenant-isolasjon", () => {
  it("5.4.1 setAssignmentAgreement endrer bare oppdrag i egen organisasjon, med avtale fra egen organisasjon", async () => {
    const setupFor = new Map<string, { assignmentId: string; agreementId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const agreement = await createClientAgreement(grant.organizationId);
          setupFor.set(grant.organizationId, {
            assignmentId: assignment.id,
            agreementId: agreement.id,
          });
        }
        return {
          a: [setupFor.get(grantA.organizationId)!.assignmentId],
          b: [setupFor.get(grantB.organizationId)!.assignmentId],
        };
      },
      query: async (actor, organizationId) => {
        const target = setupFor.get(organizationId) ?? {
          assignmentId: randomUUID(),
          agreementId: randomUUID(),
        };
        await setAssignmentAgreement(
          actor,
          organizationId,
          target.assignmentId,
          target.agreementId,
          TEST_NOW,
        );
        const [row] = await db.execute<{ id: string; organization_id: string }>(sql`
          select id, organization_id from assignments
          where id = ${target.assignmentId} and organization_id = ${organizationId}
            and client_agreement_id = ${target.agreementId}`);
        return row ? [{ id: row.id }] : [];
      },
      idOf: (row) => row.id,
    });

    // Hver organisasjon har nøyaktig én hendelse, på eget oppdrag
    for (const [organizationId, target] of setupFor) {
      expect((await eventsFor(organizationId)).map((row) => row.assignmentId)).toEqual([
        target.assignmentId,
      ]);
    }
  });

  it("5.4.3 getAssignment viser bare avtalen på oppdrag i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string> = {};
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          const agreement = await createClientAgreement(grant.organizationId);
          await putAgreement(assignment.id, agreement.id);
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
        return detail.agreement ? [detail.agreement] : [];
      },
      idOf: (row) => row.id,
    });
  });

  it("5.4.4 blandet: oppdrag i A med avtale i B, og oppdrag i B med avtale i A, avvises som admin i A", async () => {
    const {
      org: orgA,
      admin: adminA,
      assignment: assignmentA,
      x: agreementA,
    } = await setup("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentB = await createAssignment(orgB.id);
    const agreementB = await createClientAgreement(orgB.id);

    await expect(
      setAssignmentAgreement(adminA, orgA.id, assignmentA.id, agreementB.id, TEST_NOW),
    ).rejects.toThrow(NotFoundError);
    await expectNotFoundOrDenied(
      setAssignmentAgreement(adminA, orgA.id, assignmentB.id, agreementA.id, TEST_NOW),
    );
    // Og med Bs organisasjons-id: admin i A har ingen tilgang til B
    await expect(
      setAssignmentAgreement(adminA, orgB.id, assignmentB.id, agreementB.id, TEST_NOW),
    ).rejects.toThrow(AccessDeniedError);

    expect(await agreementOf(assignmentA.id)).toBeNull();
    expect(await agreementOf(assignmentB.id)).toBeNull();
    expect(await counts()).toEqual({ events: 0, auditLog: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5 Samtidighet
// ---------------------------------------------------------------------------------------------

describe("5.5 samtidighet", () => {
  it("5.5.1 to samtidige valg (X og Y): sluttverdien er én av dem, og hendelsene henger sammen (FOR UPDATE)", async () => {
    const { org, admin, assignment, x, y } = await setup();

    const results = await Promise.allSettled([
      setAssignmentAgreement(admin, org.id, assignment.id, x.id, TEST_NOW),
      setAssignmentAgreement(admin, org.id, assignment.id, y.id, TEST_NOW),
    ]);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);

    const final = await agreementOf(assignment.id);
    expect([x.id, y.id]).toContain(final);

    const data = (await eventsFor(org.id)).map(
      (row) => row.data as { fromAgreementId: string | null; toAgreementId: string | null },
    );
    expect(data).toHaveLength(2);
    const first = data.find((d) => d.fromAgreementId === null);
    const second = data.find((d) => d.fromAgreementId !== null);
    expect(first, "første hendelse har fromAgreementId = null").toBeDefined();
    expect(second, "andre hendelse bygger på den første").toBeDefined();
    expect(second!.fromAgreementId).toBe(first!.toAgreementId);
    expect(second!.toAgreementId).toBe(final);
    expect(await rowCount(auditLog)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.6 getAssignment med avtalen
// ---------------------------------------------------------------------------------------------

describe("5.6 getAssignment med avtalen", () => {
  it("5.6.1 har agreement med id, navn, periode og deletedAt; null uten avtale", async () => {
    const { org, admin, assignment } = await setup();
    const agreement = await createClientAgreement(org.id, {
      name: "Testavtale forsikring",
      validFrom: "2026-03-01",
      validTo: "2027-02-28",
      premiseText: PREMISE,
    });

    expect((await getAssignment(admin, org.id, assignment.id)).agreement).toBeNull();

    await putAgreement(assignment.id, agreement.id);
    const detail = await getAssignment(admin, org.id, assignment.id);
    expect(detail.agreement).toEqual({
      id: agreement.id,
      name: "Testavtale forsikring",
      validFrom: "2026-03-01",
      validTo: "2027-02-28",
      deletedAt: null,
    });
  });

  it.each([
    { name: "slettet", overrides: { deletedAt: DELETED } },
    { name: "utløpt", overrides: { validFrom: "2026-01-01", validTo: YESTERDAY } },
  ])("5.6.2 $name avtale tas med (A117)", async ({ overrides }) => {
    const { org, admin, assignment } = await setup();
    const agreement = await createClientAgreement(org.id, overrides);
    await putAgreement(assignment.id, agreement.id);

    const shown = (await getAssignment(admin, org.id, assignment.id)).agreement;
    expect(shown?.id).toBe(agreement.id);
    if (overrides.deletedAt) {
      expect(new Date(shown!.deletedAt as Date | string).toISOString()).toBe(DELETED.toISOString());
    } else {
      expect(shown?.validTo).toBe(YESTERDAY);
      expect(shown?.deletedAt).toBeNull();
    }
  });

  it("5.6.3 ingen premissetekst i oppdraget", async () => {
    const { org, admin, assignment, x } = await setup();
    await putAgreement(assignment.id, x.id);

    const detail = await getAssignment(admin, org.id, assignment.id);
    expect(detail.agreement).not.toHaveProperty("premiseText");
    expect(JSON.stringify(detail)).not.toContain(PREMISE_MARK);
  });
});
