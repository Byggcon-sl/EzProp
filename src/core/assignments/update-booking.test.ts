import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { updateOrder } from "@/core/orders";
import { db } from "@/db/client";
import { assignments, auditLog, events } from "@/db/schema";
import {
  TEST_NOW,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  AssignmentChangedError,
  createAssignment as createAssignmentService,
  listAssignmentBookingHistory,
  updateAssignmentBooking,
} from "./index";

/*
 * Endring av bestillingen etter lagring og historikken (testplan for «Nytt oppdrag» 4.6 og 4.7,
 * kontrakten `UpdateAssignmentBooking`). Fremmed, ukjent, slettet og ugyldig id gir samme feil
 * (`AccessDeniedError`, kontrakten). Mot testdatabasen. Oppdiktede adresser og navn.
 *
 * Støtter hovedmål: de ansatte (rette adressen i alle statuser, og se hvem som endret hva) og
 * færre reklamasjoner (ingen overskriving ved samtidig endring, aldri endring i en annen
 * organisasjon).
 */

const ADDRESS = "Testveien 12, 8000 Bodø";

async function rowCounts() {
  const [row] = (await db.execute(sql`
    select (select count(*)::int from assignments) as assignments,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from contacts) as contacts,
      (select count(*)::int from firms) as firms`)) as unknown as Record<string, number>[];
  return row!;
}

let start: Record<string, number>;
beforeEach(async () => {
  await resetDatabase();
  start = await rowCounts();
});
// 4.13: ingen tjeneste i oppgaven sletter rader
afterEach(async () => {
  const now = await rowCounts();
  for (const key of Object.keys(start)) expect(now[key], key).toBeGreaterThanOrEqual(start[key]!);
});

async function setup(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  const admin = await createUser({ name: `Admin ${name}` });
  await createEmployee(admin, org.id, ["admin"]);
  const inspector = await createEmployee(await createUser({ name: "Test Takstmann" }), org.id, [
    "inspector",
  ]);
  const created = await createAssignmentService(
    admin,
    org.id,
    {
      addressText: ADDRESS,
      gnr: "9001",
      bnr: "1",
      officeId: office.id,
      responsibleEmployeeId: inspector.id,
    },
    { now: TEST_NOW },
  );
  return { org, office, admin, inspector, id: created.id };
}

async function rowOf(id: string) {
  const [row] = await db.select().from(assignments).where(eq(assignments.id, id));
  return row!;
}

async function caught(run: Promise<unknown>): Promise<Error | null> {
  return run.then(
    () => null,
    (error: unknown) => error as Error,
  );
}

describe("4.6 fremmed id med egen grant (IDOR)", () => {
  it("Bs oppdrag gir AccessDeniedError på endring og historikk, og Bs rad er uendret", async () => {
    const a = await setup("Oppdiktet Takst A");
    const b = await setup("Oppdiktet Takst B");
    const before = await rowOf(b.id);

    const update = await caught(
      updateAssignmentBooking(a.admin, a.org.id, b.id, { addressText: "Kapret vei 1" }, 1),
    );
    const history = await caught(listAssignmentBookingHistory(a.admin, a.org.id, b.id));

    expect(update).toBeInstanceOf(AccessDeniedError);
    expect(history).toBeInstanceOf(AccessDeniedError);
    expect(await rowOf(b.id)).toEqual(before);
  });

  it("tilfeldig uuid, «ikke-en-id» og et oppdrag slettet mykt gir samme feil og melding", async () => {
    const a = await setup("Oppdiktet Takst A");
    const b = await setup("Oppdiktet Takst B");
    // Slettet (kansellert) oppdrag i egen organisasjon
    const own = await createAssignmentService(a.admin, a.org.id, {
      addressText: ADDRESS,
      officeId: a.office.id,
      responsibleEmployeeId: a.inspector.id,
    });
    await db.update(assignments).set({ deletedAt: TEST_NOW }).where(eq(assignments.id, own.id));

    const baseline = await caught(
      updateAssignmentBooking(a.admin, a.org.id, b.id, { addressText: ADDRESS }, 1),
    );
    for (const id of ["0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c", "ikke-en-id", own.id, ""]) {
      const update = await caught(
        updateAssignmentBooking(a.admin, a.org.id, id, { addressText: ADDRESS }, 1),
      );
      const history = await caught(listAssignmentBookingHistory(a.admin, a.org.id, id));
      for (const error of [update, history]) {
        expect(error, id).toBeInstanceOf(AccessDeniedError);
        expect(error?.message).toBe(baseline?.message);
      }
    }
  });
});

describe("4.7 endring etter lagring", () => {
  it.each(["ordered", "in_progress", "completed", "invoiced"] as const)(
    "4.7.1 i status %s kan adressen endres, og row_version øker med én",
    async (status) => {
      const { org, admin, id } = await setup();
      await db.update(assignments).set({ status }).where(eq(assignments.id, id));
      const before = await rowOf(id);
      const result = await updateAssignmentBooking(
        admin,
        org.id,
        id,
        { addressText: "Prøvegata 3, 8006 Bodø", gnr: "9001", bnr: "1" },
        before.rowVersion,
        TEST_NOW,
      );
      expect(result.rowVersion).toBe(before.rowVersion + 1);
      const after = await rowOf(id);
      expect(after.addressText).toBe("Prøvegata 3, 8006 Bodø");
      expect(after.status).toBe(status);
      expect(after.number).toBe(before.number);
      expect(after.source).toBe(before.source);
      expect(after.officeId).toBe(before.officeId);
    },
  );

  it("4.7.2 feil row_version: AssignmentChangedError, ingen felt endret, ingen hendelse", async () => {
    const { org, admin, id } = await setup();
    const before = await rowOf(id);
    const error = await caught(
      updateAssignmentBooking(admin, org.id, id, { addressText: "Annen vei 1" }, 5, TEST_NOW),
    );
    expect(error).toBeInstanceOf(AssignmentChangedError);
    expect(await rowOf(id)).toEqual(before);
    const updates = await db
      .select()
      .from(events)
      .where(and(eq(events.assignmentId, id), eq(events.type, "assignment.booking_updated")));
    expect(updates).toHaveLength(0);
  });

  it("4.7.3 samtidig endring med samme row_version: én lagret, én konflikt", async () => {
    const { org, admin, id } = await setup();
    const results = await Promise.allSettled([
      updateAssignmentBooking(admin, org.id, id, { addressText: "Fane en 1" }, 1, TEST_NOW),
      updateAssignmentBooking(admin, org.id, id, { addressText: "Fane to 2" }, 1, TEST_NOW),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(AssignmentChangedError);
    const row = await rowOf(id);
    expect(row.rowVersion).toBe(2);
    expect(["Fane en 1", "Fane to 2"]).toContain(row.addressText);
  });

  it("4.7.4 hendelsen har bare feltkodene som ble endret; ingen endring gir ingen hendelse og ingen loggrad", async () => {
    const { org, admin, id } = await setup();
    const auditBefore = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    const same = await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: ADDRESS, gnr: "9001", bnr: "1" },
      1,
      TEST_NOW,
    );
    expect(same.fields).toEqual([]);
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, id))).toHaveLength(
      auditBefore.length,
    );

    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: ADDRESS, gnr: "9002", bnr: "1", externalRef: "ORD-1" },
      1,
      TEST_NOW,
    );
    const updates = await db
      .select()
      .from(events)
      .where(and(eq(events.assignmentId, id), eq(events.type, "assignment.booking_updated")));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toEqual({ assignmentId: id, fields: ["externalRef", "gnr"] });
  });

  it("4.7.5 revisjonsloggen har samme form som for ordren (fields og values med from/to)", async () => {
    const { org, admin, id } = await setup();
    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: "Prøvegata 3", gnr: "9001", bnr: "1" },
      1,
      TEST_NOW,
    );
    const order = await createOrder(org.id, { addressText: ADDRESS, gnr: "9001", bnr: "1" });
    await updateOrder(
      admin,
      org.id,
      order.id,
      { addressText: "Prøvegata 3", gnr: "9001", bnr: "1" },
      order.rowVersion,
      TEST_NOW,
    );
    const [assignmentLog] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "update")));
    const [orderLog] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, order.id), eq(auditLog.action, "update")));
    expect(assignmentLog?.entityType).toBe("assignment");
    const a = assignmentLog?.changes as Record<string, unknown>;
    const o = orderLog?.changes as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(Object.keys(o).sort());
    expect(a.fields).toEqual(o.fields);
    expect(a.values).toEqual(o.values);
    expect(a.values).toEqual({ addressText: { from: ADDRESS, to: "Prøvegata 3" } });
  });

  it("4.7.6 historikken viser hvem, når og feltkoder, nyeste først, bare for dette oppdraget", async () => {
    const { org, admin, office, inspector, id } = await setup();
    const other = await createAssignmentService(admin, org.id, {
      addressText: "Annen vei 5",
      officeId: office.id,
      responsibleEmployeeId: inspector.id,
    });
    await updateAssignmentBooking(admin, org.id, other.id, { addressText: "Annen vei 6" }, 1);
    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: "Først 1", gnr: "9001", bnr: "1" },
      1,
      new Date(TEST_NOW.getTime() + 60_000),
    );
    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: "Først 1", gnr: "9001", bnr: "2" },
      2,
      new Date(TEST_NOW.getTime() + 120_000),
    );

    const history = await listAssignmentBookingHistory(admin, org.id, id);
    expect(history.map((entry) => [entry.action, entry.fields])).toEqual([
      ["update", ["bnr"]],
      ["update", ["addressText"]],
      ["create", expect.arrayContaining(["addressText", "gnr", "bnr"])],
    ]);
    for (const entry of history) {
      expect(entry.actorName).toBe("Admin Oppdiktet Takst A");
      expect(entry.occurredAt).toBeInstanceOf(Date);
    }
    const times = history.map((entry) => entry.occurredAt.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(JSON.stringify(history)).not.toContain("Annen vei");
  });

  it("4.7.7 kontakt i endring: firma settes fra kontakten, og kontakt fra B avvises uten endring", async () => {
    const { org, admin, id } = await setup();
    const firm = await createFirm(org.id, { name: "Testmegling AS" });
    const contact = await createContact(org.id, { firmId: firm.id });
    const orgB = await createOrganization("Oppdiktet Takst B");
    const foreign = await createContact(orgB.id);

    await updateAssignmentBooking(
      admin,
      org.id,
      id,
      { addressText: ADDRESS, gnr: "9001", bnr: "1", orderedByContactId: contact.id },
      1,
    );
    const row = await rowOf(id);
    expect(row.orderedByContactId).toBe(contact.id);
    expect(row.orderedByFirmId).toBe(firm.id);

    const error = await caught(
      updateAssignmentBooking(
        admin,
        org.id,
        id,
        { addressText: ADDRESS, orderedByContactId: foreign.id },
        row.rowVersion,
      ),
    );
    expect(error).toBeInstanceOf(ContactNotFoundError);
    expect(await rowOf(id)).toEqual(row);
  });
});
