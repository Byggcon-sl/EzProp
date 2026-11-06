import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { convertOrderToAssignment } from "@/core/orders";
import { db } from "@/db/client";
import { auditLog, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createClientAgreement,
  createEmployee,
  createFirm,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { suggestAgreementForAssignment } from "./index";

/*
 * Forslaget om avtale på oppdraget, som testsaker i data mot databasen.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 6 (og 5.4.2).
 *
 * Regelen (A116): firmaet hentes bare fra ordrens bestillerfirma (`orders.ordered_by_firm_id`)
 * via `assignments.order_id`. Forslag gis bare når oppdraget ikke har avtale, og firmaet har
 * nøyaktig én avtale som ikke er slettet og gjelder i dag (norsk dato).
 *
 * Fast tid: TEST_NOW = 03.11.2026 kl. 11 i Oslo. Testdata er oppdiktet: «Testforsikring AS»,
 * «Testavtale forsikring».
 *
 * Støtter hovedmål: tid (forslaget kommer når det er entydig, så takstmannen trykker én gang),
 * reklamasjoner (ingen forslag ved tvil, så feil premisser ikke kommer inn) og KI først
 * (forslaget godkjennes av takstmannen; ingenting settes automatisk ved «gjør om til oppdrag»).
 */

beforeEach(resetDatabase);

const DELETED = new Date("2026-11-01T08:00:00Z");
const YESTERDAY = "2026-11-02";
const TOMORROW = "2026-11-04";
const FIRM_NAME = "Testforsikring AS";

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function insurer(
  organizationId: string,
  overrides: { name?: string; deletedAt?: Date } = {},
) {
  return createFirm(organizationId, { name: FIRM_NAME, firmType: "insurer", ...overrides });
}

/** Ordre med bestillerfirma (eller uten), gjort om til oppdrag med `orderId`. */
async function assignmentOrderedBy(organizationId: string, firmId: string | null) {
  const order = await createOrder(organizationId, { orderedByFirmId: firmId });
  return createAssignment(organizationId, { orderId: order.id });
}

async function putAgreement(assignmentId: string, agreementId: string | null) {
  await db.execute(
    sql`update assignments set client_agreement_id = ${agreementId} where id = ${assignmentId}`,
  );
}

async function agreementOf(assignmentId: string): Promise<string | null> {
  const [row] = await db.execute<{ client_agreement_id: string | null }>(
    sql`select client_agreement_id from assignments where id = ${assignmentId}`,
  );
  if (!row) throw new Error("fant ikke oppdraget");
  return row.client_agreement_id;
}

async function rowCount(table: typeof auditLog | typeof events) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------
// 6. Forslagsregelen (regeltest som data)
// ---------------------------------------------------------------------------------------------

type Built = {
  assignmentId: string;
  /** Avtalen som skal foreslås, eller `null` for ingen forslag. */
  expected: { agreementId: string; agreementName: string; firmId: string; firmName: string } | null;
};

type SuggestCase = { name: string; build: (organizationId: string) => Promise<Built> };

/** Oppdrag bestilt av firma F; `agreements` legges på F. */
async function orderedByF(
  organizationId: string,
  agreements: Parameters<typeof createClientAgreement>[1][],
) {
  const firm = await insurer(organizationId);
  const assignment = await assignmentOrderedBy(organizationId, firm.id);
  const created = [];
  for (const overrides of agreements) {
    created.push(await createClientAgreement(organizationId, { ...overrides, firmId: firm.id }));
  }
  return { firm, assignment, agreements: created };
}

const SUGGEST_CASES: SuggestCase[] = [
  {
    name: "F har én gyldig avtale → den avtalen",
    build: async (organizationId) => {
      const { firm, assignment, agreements } = await orderedByF(organizationId, [
        { name: "Testavtale forsikring" },
      ]);
      return {
        assignmentId: assignment.id,
        expected: {
          agreementId: agreements[0]!.id,
          agreementName: "Testavtale forsikring",
          firmId: firm.id,
          firmName: FIRM_NAME,
        },
      };
    },
  },
  {
    name: "F har ingen avtale → nei",
    build: async (organizationId) => ({
      assignmentId: (await orderedByF(organizationId, [])).assignment.id,
      expected: null,
    }),
  },
  {
    name: "F har to gyldige avtaler → nei (tvil)",
    build: async (organizationId) => ({
      assignmentId: (
        await orderedByF(organizationId, [{ name: "Testavtale 1" }, { name: "Testavtale 2" }])
      ).assignment.id,
      expected: null,
    }),
  },
  {
    name: "F har én gyldig og én utløpt → den gyldige",
    build: async (organizationId) => {
      const { firm, assignment, agreements } = await orderedByF(organizationId, [
        { name: "Testavtale utløpt", validFrom: "2025-01-01", validTo: YESTERDAY },
        { name: "Testavtale gyldig" },
      ]);
      return {
        assignmentId: assignment.id,
        expected: {
          agreementId: agreements[1]!.id,
          agreementName: "Testavtale gyldig",
          firmId: firm.id,
          firmName: FIRM_NAME,
        },
      };
    },
  },
  {
    name: "F har én gyldig og én slettet → den gyldige",
    build: async (organizationId) => {
      const { firm, assignment, agreements } = await orderedByF(organizationId, [
        { name: "Testavtale slettet", deletedAt: DELETED },
        { name: "Testavtale gyldig" },
      ]);
      return {
        assignmentId: assignment.id,
        expected: {
          agreementId: agreements[1]!.id,
          agreementName: "Testavtale gyldig",
          firmId: firm.id,
          firmName: FIRM_NAME,
        },
      };
    },
  },
  {
    name: "eneste avtale er utløpt → nei",
    build: async (organizationId) => ({
      assignmentId: (
        await orderedByF(organizationId, [{ validFrom: "2025-01-01", validTo: YESTERDAY }])
      ).assignment.id,
      expected: null,
    }),
  },
  {
    name: "eneste avtale er ikke påbegynt → nei",
    build: async (organizationId) => ({
      assignmentId: (await orderedByF(organizationId, [{ validFrom: TOMORROW }])).assignment.id,
      expected: null,
    }),
  },
  {
    name: "eneste avtale er slettet → nei",
    build: async (organizationId) => ({
      assignmentId: (await orderedByF(organizationId, [{ deletedAt: DELETED }])).assignment.id,
      expected: null,
    }),
  },
  {
    name: "oppdraget har allerede avtale → nei",
    build: async (organizationId) => {
      const { assignment, agreements } = await orderedByF(organizationId, [{}]);
      await putAgreement(assignment.id, agreements[0]!.id);
      return { assignmentId: assignment.id, expected: null };
    },
  },
  {
    name: "oppdraget har ingen ordre → nei",
    build: async (organizationId) => {
      await orderedByF(organizationId, [{}]);
      return { assignmentId: (await createAssignment(organizationId)).id, expected: null };
    },
  },
  {
    name: "ordren har ikke bestillerfirma → nei",
    build: async (organizationId) => {
      await orderedByF(organizationId, [{}]);
      return { assignmentId: (await assignmentOrderedBy(organizationId, null)).id, expected: null };
    },
  },
  {
    name: "F er slettet → nei",
    build: async (organizationId) => {
      const firm = await insurer(organizationId, { deletedAt: DELETED });
      await createClientAgreement(organizationId, { firmId: firm.id });
      return {
        assignmentId: (await assignmentOrderedBy(organizationId, firm.id)).id,
        expected: null,
      };
    },
  },
  {
    name: "avtalen tilhører et annet firma → nei",
    build: async (organizationId) => {
      const firm = await insurer(organizationId);
      const other = await insurer(organizationId, { name: "Annen Testforsikring AS" });
      await createClientAgreement(organizationId, { firmId: other.id });
      return {
        assignmentId: (await assignmentOrderedBy(organizationId, firm.id)).id,
        expected: null,
      };
    },
  },
  {
    name: "megler-parten er F, men ikke bestilleren → nei (A116)",
    build: async (organizationId) => {
      const f = await insurer(organizationId);
      await createClientAgreement(organizationId, { firmId: f.id });
      const orderer = await createFirm(organizationId, { name: "Testmegling AS" });
      const assignment = await assignmentOrderedBy(organizationId, orderer.id);
      await createAssignmentParty(organizationId, {
        assignmentId: assignment.id,
        role: "broker",
        firmId: f.id,
        firmName: FIRM_NAME,
      });
      return { assignmentId: assignment.id, expected: null };
    },
  },
];

describe("6. forslaget (regeltest som data)", () => {
  it("har de 14 testsakene fra testplanen", () => {
    expect(SUGGEST_CASES).toHaveLength(14);
  });

  it.each(SUGGEST_CASES)("$name", async ({ build }) => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const { assignmentId, expected } = await build(org.id);

    const suggestion = await suggestAgreementForAssignment(admin, org.id, assignmentId, TEST_NOW);

    if (expected === null) {
      expect(suggestion).toBeNull();
    } else {
      expect(suggestion).toEqual(expected);
    }
  });

  it("6.1 tidssone: avtale som starter 04.11 gir forslag 03.11 kl. 23.30 UTC (04.11 i Norge), ikke kl. 11", async () => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const { assignment, agreements } = await orderedByF(org.id, [{ validFrom: TOMORROW }]);

    expect(await suggestAgreementForAssignment(admin, org.id, assignment.id, TEST_NOW)).toBeNull();
    const late = await suggestAgreementForAssignment(
      admin,
      org.id,
      assignment.id,
      new Date("2026-11-03T23:30:00Z"),
    );
    expect(late?.agreementId).toBe(agreements[0]!.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Tilgang, ingen skriving, ingen automatikk
// ---------------------------------------------------------------------------------------------

describe("6.2–6.4 tilgang, ingen skriving og ingen automatikk", () => {
  it.each<{ role: EmployeeRole; editAll: boolean }>([
    { role: "inspector", editAll: false },
    { role: "inspector", editAll: true },
    { role: "office", editAll: false },
    { role: "manager", editAll: false },
    { role: "admin", editAll: false },
  ])("6.2 $role (innstillingen på: $editAll) kan hente forslaget", async ({ role, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const actor = await createUser();
    await createEmployee(actor, org.id, [role]);
    const { assignment, agreements } = await orderedByF(org.id, [{}]);

    const suggestion = await suggestAgreementForAssignment(actor, org.id, assignment.id, TEST_NOW);
    expect(suggestion?.agreementId).toBe(agreements[0]!.id);
  });

  it("6.2 bruker uten ansattrad får AccessDeniedError", async () => {
    const org = await createOrganization();
    const stranger = await createUser();
    const { assignment } = await orderedByF(org.id, [{}]);
    await expect(
      suggestAgreementForAssignment(stranger, org.id, assignment.id, TEST_NOW),
    ).rejects.toThrow(AccessDeniedError);
  });

  it.each([randomUUID(), "ikke-en-id"])(
    "6.2 oppdrags-id %s gir null eller avvisning, aldri databasefeil",
    async (assignmentId) => {
      const org = await createOrganization();
      const admin = await createUser({ name: "Test Admin" });
      await createEmployee(admin, org.id, ["admin"]);
      const result = await suggestAgreementForAssignment(
        admin,
        org.id,
        assignmentId,
        TEST_NOW,
      ).then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      );
      expect(result.value).toBeNull();
      if (result.error) {
        const name = (result.error as Error).name;
        expect(["NotFoundError", "AccessDeniedError"]).toContain(name);
      }
    },
  );

  it("6.3 forslaget endrer ikke oppdraget, og gir ingen hendelse eller loggrad", async () => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const { assignment } = await orderedByF(org.id, [{}]);
    const [before] = await db.execute<{ updated_at: string; row_version: number }>(
      sql`select updated_at::text as updated_at, row_version from assignments where id = ${assignment.id}`,
    );

    expect(
      await suggestAgreementForAssignment(admin, org.id, assignment.id, TEST_NOW),
    ).not.toBeNull();

    expect(await agreementOf(assignment.id)).toBeNull();
    const [after] = await db.execute<{ updated_at: string; row_version: number }>(
      sql`select updated_at::text as updated_at, row_version from assignments where id = ${assignment.id}`,
    );
    expect(after).toEqual(before);
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("6.4 convertOrderToAssignment med bestiller fra F gir oppdrag uten avtale (ingen automatikk)", async () => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const office = await createOffice(org.id);
    const firm = await insurer(org.id);
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const order = await createOrder(org.id, { orderedByFirmId: firm.id });

    const { assignment } = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: TEST_NOW,
    });

    expect(await agreementOf(assignment.id)).toBeNull();
    // Forslaget finnes, men takstmannen må godkjenne det selv
    const suggestion = await suggestAgreementForAssignment(admin, org.id, assignment.id, TEST_NOW);
    expect(suggestion?.agreementId).toBe(agreement.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.4.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.4.2 tenant-isolasjon", () => {
  it("suggestAgreementForAssignment foreslår aldri en avtale fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<string, string> = {};
        for (const grant of [grantA, grantB]) {
          const { assignment, agreements } = await orderedByF(grant.organizationId, [{}]);
          assignmentFor.set(grant.organizationId, assignment.id);
          ids[grant.organizationId] = agreements[0]!.id;
        }
        return { a: [ids[grantA.organizationId]!], b: [ids[grantB.organizationId]!] };
      },
      query: async (actor, organizationId) => {
        const suggestion = await suggestAgreementForAssignment(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          TEST_NOW,
        );
        return suggestion ? [suggestion] : [];
      },
      idOf: (row) => row.agreementId,
    });
  });

  it("oppdrag i A, admin i A med Bs oppdrags-id → ikke forslag fra B", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminA = await createUser({ name: "Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    const { assignment: assignmentB } = await orderedByF(orgB.id, [{}]);

    const result = await suggestAgreementForAssignment(
      adminA,
      orgA.id,
      assignmentB.id,
      TEST_NOW,
    ).then(
      (value) => value,
      () => null,
    );
    expect(result).toBeNull();
  });
});
