import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { convertOrderToAssignment } from "@/core/orders";
import { db } from "@/db/client";
import { auditLog, employees, events, firms, type EmployeeRole } from "@/db/schema";
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
import { suggestAgreementForAssignment } from "./index";

/*
 * Forslaget om avtale på oppdraget (A110), regeltest som data mot databasen.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 6.
 *
 * Oppsett: ordre med `orderedByFirmId` = firma F, gjort om til oppdrag (`createAssignment` med
 * `orderId`). Fast tid: `TEST_NOW` (2026-11-03 i Oslo). Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (ett trykk når bestilleren er fra avtalefirmaet), reklamasjoner (aldri
 * forslag ved tvil: to avtaler, utløpt, slettet) og KI først (forslaget settes aldri automatisk;
 * takstmannen godkjenner).
 */

beforeEach(resetDatabase);

const NOW = TEST_NOW;
const DELETED = new Date("2026-11-01T08:00:00Z");

type Ctx = {
  organizationId: string;
  admin: Awaited<ReturnType<typeof createUser>>;
  firmId: string;
  otherFirmId: string;
};

type Setup = {
  /** Avtalene for casen. Returnerer id-en til den som skal foreslås, eller `null`. */
  agreements: (ctx: Ctx) => Promise<string | null>;
  /** Hvordan oppdraget lages. Standard: ordre med bestillerfirma F. */
  assignment?: "no_order" | "order_without_firm" | "broker_party_only";
  firmDeleted?: boolean;
  /** Oppdraget har allerede en avtale (en gyldig avtale for F). */
  alreadyHasAgreement?: boolean;
};

const valid = (ctx: Ctx, name = "Testavtale gyldig") =>
  createClientAgreement(ctx.organizationId, { firmId: ctx.firmId, name });

const CASES: ({ name: string } & Setup)[] = [
  {
    name: "F har én gyldig avtale → ja, den avtalen",
    agreements: async (ctx) => (await valid(ctx)).id,
  },
  { name: "F har ingen avtale → nei", agreements: async () => null },
  {
    name: "F har to gyldige avtaler → nei",
    agreements: async (ctx) => {
      await valid(ctx, "Testavtale 1");
      await valid(ctx, "Testavtale 2");
      return null;
    },
  },
  {
    name: "F har én gyldig og én utløpt → ja, den gyldige",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, {
        firmId: ctx.firmId,
        validFrom: "2025-01-01",
        validTo: "2025-12-31",
      });
      return (await valid(ctx)).id;
    },
  },
  {
    name: "F har én gyldig og én slettet → ja, den gyldige",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, { firmId: ctx.firmId, deletedAt: DELETED });
      return (await valid(ctx)).id;
    },
  },
  {
    name: "eneste avtale er utløpt → nei",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, {
        firmId: ctx.firmId,
        validFrom: "2026-01-01",
        validTo: "2026-11-02",
      });
      return null;
    },
  },
  {
    name: "eneste avtale er ikke påbegynt → nei",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, {
        firmId: ctx.firmId,
        validFrom: "2026-11-04",
      });
      return null;
    },
  },
  {
    name: "eneste avtale er slettet → nei",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, { firmId: ctx.firmId, deletedAt: DELETED });
      return null;
    },
  },
  {
    name: "oppdraget har allerede avtale → nei",
    alreadyHasAgreement: true,
    agreements: async () => null,
  },
  {
    name: "oppdraget har ingen ordre → nei",
    assignment: "no_order",
    agreements: async (ctx) => {
      await valid(ctx);
      return null;
    },
  },
  {
    name: "ordren har ikke bestillerfirma → nei",
    assignment: "order_without_firm",
    agreements: async (ctx) => {
      await valid(ctx);
      return null;
    },
  },
  {
    name: "F er slettet → nei",
    firmDeleted: true,
    agreements: async (ctx) => {
      await valid(ctx);
      return null;
    },
  },
  {
    name: "avtalen tilhører et annet firma → nei",
    agreements: async (ctx) => {
      await createClientAgreement(ctx.organizationId, { firmId: ctx.otherFirmId });
      return null;
    },
  },
  {
    name: "megler-parten er F, men ikke bestilleren → nei (A110)",
    assignment: "broker_party_only",
    agreements: async (ctx) => {
      await valid(ctx);
      return null;
    },
  },
];

async function setupCase(setup: Setup) {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const firm = await createFirm(org.id, { name: "Testforsikring AS", firmType: "insurer" });
  const otherFirm = await createFirm(org.id, { name: "Testmegling AS" });
  const ctx: Ctx = { organizationId: org.id, admin, firmId: firm.id, otherFirmId: otherFirm.id };

  let assignmentId: string;
  if (setup.assignment === "no_order") {
    assignmentId = (await createAssignment(org.id)).id;
  } else if (setup.assignment === "order_without_firm" || setup.assignment === "broker_party_only") {
    const order = await createOrder(org.id, { orderedByFirmId: null });
    assignmentId = (await createAssignment(org.id, { orderId: order.id })).id;
    if (setup.assignment === "broker_party_only") {
      await createAssignmentParty(org.id, { assignmentId, role: "broker", firmId: firm.id });
    }
  } else {
    const order = await createOrder(org.id, { orderedByFirmId: firm.id });
    assignmentId = (await createAssignment(org.id, { orderId: order.id })).id;
  }

  const expected = await setup.agreements(ctx);
  if (setup.alreadyHasAgreement) {
    const existing = await valid(ctx, "Testavtale satt");
    await db.execute(
      sql`update assignments set client_agreement_id = ${existing.id} where id = ${assignmentId}`,
    );
  }
  if (setup.firmDeleted) {
    await db.update(firms).set({ deletedAt: DELETED }).where(eq(firms.id, firm.id));
  }
  return { ctx, assignmentId, expected };
}

async function counts() {
  const [audit] = await db.select({ n: count() }).from(auditLog);
  const [event] = await db.select({ n: count() }).from(events);
  return { audit: audit?.n ?? 0, events: event?.n ?? 0 };
}

describe("6. forslaget (regeltest som data)", () => {
  it.each(CASES)("$name", async (setup) => {
    const { ctx, assignmentId, expected } = await setupCase(setup);

    const suggestion = await suggestAgreementForAssignment(
      ctx.admin,
      ctx.organizationId,
      assignmentId,
      NOW,
    );

    if (expected === null) expect(suggestion).toBeNull();
    else expect(suggestion?.agreementId).toBe(expected);
  });

  it("forslaget har avtalens navn og bestillerfirmaets navn (til teksten på kortet)", async () => {
    const { ctx, assignmentId } = await setupCase({
      agreements: async (c) => (await valid(c, "Testavtale forsikring")).id,
    });
    const suggestion = await suggestAgreementForAssignment(
      ctx.admin,
      ctx.organizationId,
      assignmentId,
      NOW,
    );
    expect(suggestion).toMatchObject({
      agreementName: "Testavtale forsikring",
      firmName: "Testforsikring AS",
    });
  });

  it("6.1 tidssone: avtale som starter 2026-11-04, now = 2026-11-03T23:30Z (Oslo: 04.11) → forslag", async () => {
    const { ctx, assignmentId } = await setupCase({
      agreements: async (c) => {
        await createClientAgreement(c.organizationId, { firmId: c.firmId, validFrom: "2026-11-04" });
        return null;
      },
    });
    const [agreement] = (await db.execute(
      sql`select id from client_agreements where organization_id = ${ctx.organizationId}`,
    )) as unknown as { id: string }[];

    const late = await suggestAgreementForAssignment(
      ctx.admin,
      ctx.organizationId,
      assignmentId,
      new Date("2026-11-03T23:30:00Z"),
    );
    expect(late?.agreementId).toBe(agreement!.id);

    // Samme dag kl. 11 norsk tid er avtalen ikke påbegynt
    expect(
      await suggestAgreementForAssignment(ctx.admin, ctx.organizationId, assignmentId, NOW),
    ).toBeNull();
  });

  it.each(["inspector", "office", "manager", "admin"] as EmployeeRole[])(
    "6.2 %s kan hente forslaget (lesing)",
    async (role) => {
      const { ctx, assignmentId, expected } = await setupCase({
        agreements: async (c) => (await valid(c)).id,
      });
      const actor = await createUser();
      await createEmployee(actor, ctx.organizationId, [role]);

      const suggestion = await suggestAgreementForAssignment(
        actor,
        ctx.organizationId,
        assignmentId,
        NOW,
      );
      expect(suggestion?.agreementId).toBe(expected);
    },
  );

  it("6.2 uten ansattrad og deaktivert ansatt → AccessDeniedError", async () => {
    const { ctx, assignmentId } = await setupCase({
      agreements: async (c) => (await valid(c)).id,
    });
    const stranger = await createUser();
    await expect(
      suggestAgreementForAssignment(stranger, ctx.organizationId, assignmentId, NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const former = await createUser();
    const employee = await createEmployee(former, ctx.organizationId, ["office"]);
    await db
      .update(employees)
      .set({ deactivatedAt: DELETED })
      .where(eq(employees.id, employee.id));
    await expect(
      suggestAgreementForAssignment(former, ctx.organizationId, assignmentId, NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("6.3 forslaget skriver ingenting: oppdraget uendret, ingen hendelse, ingen loggrad", async () => {
    const { ctx, assignmentId } = await setupCase({
      agreements: async (c) => (await valid(c)).id,
    });
    const before = await counts();

    await suggestAgreementForAssignment(ctx.admin, ctx.organizationId, assignmentId, NOW);
    await suggestAgreementForAssignment(ctx.admin, ctx.organizationId, assignmentId, NOW);

    expect(await counts()).toEqual(before);
    const [row] = (await db.execute(
      sql`select client_agreement_id from assignments where id = ${assignmentId}`,
    )) as unknown as { client_agreement_id: string | null }[];
    expect(row?.client_agreement_id).toBeNull();
  });

  it("6.4 ingen automatikk: convertOrderToAssignment med bestiller fra F gir oppdrag uten avtale", async () => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const office = await createOffice(org.id);
    const firm = await createFirm(org.id, { name: "Testforsikring AS", firmType: "insurer" });
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const order = await createOrder(org.id, { orderedByFirmId: firm.id });

    const { assignment } = await convertOrderToAssignment(admin, org.id, order.id, {
      officeId: office.id,
      now: NOW,
    });

    const [row] = (await db.execute(
      sql`select client_agreement_id from assignments where id = ${assignment.id}`,
    )) as unknown as { client_agreement_id: string | null }[];
    expect(row?.client_agreement_id).toBeNull();
    // Men forslaget finnes, så takstmannen kan godkjenne med ett trykk
    const suggestion = await suggestAgreementForAssignment(admin, org.id, assignment.id, NOW);
    expect(suggestion?.agreementId).toBe(agreement.id);
  });
});
