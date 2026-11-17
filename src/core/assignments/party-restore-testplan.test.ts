import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { removeParty, restoreParty } from "@/core/assignments";
import { listTrash } from "@/core/buildings";
import { mergeContacts, removeContact, removeFirm } from "@/core/contacts";
import { db } from "@/db/client";
import { auditLog, employees, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createContact,
  createEmployee,
  createFirm,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Papirkurv for parter på oppdraget (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 7, og
 * delene av 1.12, 2.4, 4 og 5.5 som gjelder `restoreParty`). Oppgavekort:
 * docs/funksjoner/fase2a-papirkurv.md (A415, A417).
 *
 * Signaturen er avtalen i testplanen: restoreParty(actor, organizationId, partyId, how), how er
 * "undo" | "trash" → { restored: { type, id, organizationId }[], changed, notices }. Parter står i
 * `listTrash` fra `@/core/buildings` med bare id, rolle, navn og firmanavn.
 *
 * Testdata er oppdiktet: parten «Ola Testmann», e-post ola.testmann@example.invalid, telefon
 * 90000000, firmaet «Testmegling AS».
 *
 * Støtter hovedmål: de ansatte (en feil fjernet part kommer tilbake med ett trykk), KI i bunnen
 * (hendelsene har bare id og rolle) og færre reklamasjoner (parten kobles aldri til en fjernet
 * kontakt eller en kontakt i en annen organisasjon).
 */

beforeEach(resetDatabase);

const PARTY_NAME = "Ola Testmann";
const PARTY_EMAIL = "ola.testmann@example.invalid";
const PARTY_PHONE = "90000000";
const FIRM_NAME = "Testmegling AS";
const CONTACT_GONE = "Parten kom tilbake, men kontakten den var koblet til, er fjernet.";
const LINK_GONE = /^Parten kom tilbake, men (kontakten|firmaet) den var koblet til, er fjernet\.$/;

type DbRow = Record<string, unknown>;
type Restored = {
  restored: { type: string; id: string; organizationId?: string }[];
  changed: boolean;
  notices: string[];
};

async function partyRow(id: string): Promise<DbRow> {
  const [found] = (await db.execute(
    sql`select * from assignment_parties where id = ${id}`,
  )) as unknown as DbRow[];
  if (!found) throw new Error("fant ikke parten");
  return found;
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

async function eventAndAuditCounts(organizationId: string) {
  const [e] = await db
    .select({ n: count() })
    .from(events)
    .where(eq(events.organizationId, organizationId));
  const [a] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId));
  return { events: e?.n ?? 0, audit: a?.n ?? 0 };
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, et oppdrag og en kjøper koblet til kontakt og firma. */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  const firm = await createFirm(org.id, { name: FIRM_NAME });
  const contact = await createContact(org.id, {
    firstName: "Ola",
    lastName: "Testmann",
    email: PARTY_EMAIL,
    phone: PARTY_PHONE,
    firmId: firm.id,
  });
  const party = await createAssignmentParty(org.id, {
    assignmentId: assignment.id,
    role: "buyer",
    name: PARTY_NAME,
    firmName: FIRM_NAME,
    email: PARTY_EMAIL,
    phone: PARTY_PHONE,
    receivesReport: true,
    contactId: contact.id,
    firmId: firm.id,
  });
  return { org, admin, adminEmployee, office, assignment, firm, contact, party };
}

function stable(r: DbRow): DbRow {
  const copy: DbRow = { ...r };
  for (const key of ["updated_at", "updated_by", "deleted_at", "deleted_by", "row_version"]) {
    delete copy[key];
  }
  return copy;
}

describe("7. parter (A415)", () => {
  it("7.1 vanlig gjenoppretting: samme id, rolle, navn og koblinger; updated_by er den som gjenopprettet", async () => {
    const { org, admin, adminEmployee, party } = await setup();
    const before = stable(await partyRow(party.id));
    await removeParty(admin, org.id, party.id);

    const result = (await restoreParty(admin, org.id, party.id, "undo")) as unknown as Restored;

    const after = await partyRow(party.id);
    expect(stable(after)).toEqual(before);
    expect(after.deleted_at).toBeNull();
    expect(after.deleted_by).toBeNull();
    expect(after.updated_by).toBe(adminEmployee.id);
    expect(result.changed).toBe(true);
    expect(result.notices).toEqual([]);
    expect(result.restored.map((r) => `${r.type}:${r.id}`)).toEqual([`party:${party.id}`]);
  });

  it("7.2 kontakten er fjernet: contactId og firmId blir null, navn og verdier står, og beskjeden kommer", async () => {
    const { org, admin, contact, party } = await setup();
    await removeParty(admin, org.id, party.id);
    await removeContact(admin, org.id, contact.id);

    const result = (await restoreParty(admin, org.id, party.id, "trash")) as unknown as Restored;

    const after = await partyRow(party.id);
    expect(after.deleted_at).toBeNull();
    expect(after.contact_id).toBeNull();
    expect(after.firm_id).toBeNull();
    expect(after.name).toBe(PARTY_NAME);
    expect(after.firm_name).toBe(FIRM_NAME);
    expect(after.email).toBe(PARTY_EMAIL);
    expect(after.phone).toBe(PARTY_PHONE);
    expect(after.role).toBe("buyer");
    expect(after.receives_report).toBe(true);
    expect(result.notices).toEqual([CONTACT_GONE]);
  });

  it("7.3 firmaet er fjernet: firmaet blir null, kontakten står, verdiene står, og beskjeden kommer", async () => {
    const { org, admin, firm, contact, party } = await setup();
    await removeParty(admin, org.id, party.id);
    await removeFirm(admin, org.id, firm.id);

    const result = (await restoreParty(admin, org.id, party.id, "trash")) as unknown as Restored;

    const after = await partyRow(party.id);
    expect(after.deleted_at).toBeNull();
    // Kontakter beholdes når firmaet fjernes (A415), så koblingen til kontakten står.
    expect(after.contact_id).toBe(contact.id);
    expect(after.firm_id).toBeNull();
    expect(after.name).toBe(PARTY_NAME);
    expect(after.firm_name).toBe(FIRM_NAME);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(LINK_GONE);
  });

  it("7.4 kontakten er slått sammen mens parten var fjernet: parten kommer tilbake med den flyttede koblingen", async () => {
    const { org, admin, contact, party } = await setup();
    const keepFirm = await createFirm(org.id, { name: "Testtakst Nord AS" });
    const keep = await createContact(org.id, {
      firstName: "Ola",
      lastName: "Testmann",
      firmId: keepFirm.id,
    });
    await removeParty(admin, org.id, party.id);
    await mergeContacts(admin, org.id, { keepId: keep.id, removeId: contact.id });

    const result = (await restoreParty(admin, org.id, party.id, "trash")) as unknown as Restored;

    const after = await partyRow(party.id);
    expect(after.deleted_at).toBeNull();
    expect(after.contact_id).toBe(keep.id);
    expect(after.firm_id).toBe(keepFirm.id);
    expect(result.notices).toEqual([]);
  });

  it("7.5 kontakt i en annen organisasjon: databasen godtar aldri koblingen (sammensatt fremmednøkkel), så parten kan aldri kobles til B sin kontakt", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const error = await caught(
      db.execute(sql`
        update assignment_parties set contact_id = ${b.contact.id}
        where id = ${a.party.id}`),
    );
    expect(error, "fremmednøkkelen stopper koblingen").not.toBeNull();
    expect(String((error as { cause?: unknown }).cause ?? error)).toMatch(/foreign key|fremmed/i);

    // Gjenopprettingen i A rører aldri B sin kontakt.
    await removeParty(a.admin, a.org.id, a.party.id);
    await restoreParty(a.admin, a.org.id, a.party.id, "trash");
    expect((await partyRow(a.party.id)).contact_id).toBe(a.contact.id);
    expect((await partyRow(b.party.id)).deleted_at).toBeNull();
  });

  it("7.6 listTrash for parter gir bare id, rolle, navn og firmanavn, aldri e-post, telefon, contactId eller firmId", async () => {
    const { org, admin, assignment, party } = await setup();
    await removeParty(admin, org.id, party.id);

    const result = (await listTrash(admin, org.id, assignment.id)) as unknown as Record<
      string,
      unknown
    >[];
    const line = result.find((l) => l.id === party.id);
    expect(line, "parten står i papirkurven").toBeDefined();
    expect(line!.role).toBe("buyer");
    expect(line!.name).toBe(PARTY_NAME);
    expect(line!.firmName).toBe(FIRM_NAME);
    for (const key of ["email", "phone", "contactId", "firmId"]) {
      expect(line, key).not.toHaveProperty(key);
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain(PARTY_EMAIL);
    expect(text).not.toContain(PARTY_PHONE);
  });
});

describe("1.12 og 2.4 for parter", () => {
  it("1.12 restoreParty to ganger: andre kall gir changed: false, samme rad, ingen nye hendelser eller loggrader", async () => {
    const { org, admin, party } = await setup();
    await removeParty(admin, org.id, party.id);
    expect(
      ((await restoreParty(admin, org.id, party.id, "undo")) as unknown as Restored).changed,
    ).toBe(true);
    const rowAfterFirst = await partyRow(party.id);
    const counts = await eventAndAuditCounts(org.id);

    const second = (await restoreParty(admin, org.id, party.id, "undo")) as unknown as Restored;

    expect(second.changed).toBe(false);
    expect(await partyRow(party.id)).toEqual(rowAfterFirst);
    expect(await eventAndAuditCounts(org.id)).toEqual(counts);
  });

  it("2.2 party_restored med bare id, rolle, how og secondsSinceRemoval; revisjonslogg «restore» på assignment_party", async () => {
    const { org, admin, assignment, party } = await setup();
    await removeParty(admin, org.id, party.id);
    await restoreParty(admin, org.id, party.id, "trash");

    const restored = (
      await db.select().from(events).where(eq(events.organizationId, org.id))
    ).filter((e) => e.type === "assignment.party_restored");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.assignmentId).toBe(assignment.id);
    expect(restored[0]!.data.partyId).toBe(party.id);
    expect(restored[0]!.data.role).toBe("buyer");
    expect(restored[0]!.data.how).toBe("trash");
    expect(typeof restored[0]!.data.secondsSinceRemoval).toBe("number");

    const audit = (
      await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id))
    ).filter((r) => r.action === "restore");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entityType).toBe("assignment_party");
    expect(audit[0]!.entityId).toBe(party.id);
  });

  it("2.4 ingen navn, e-post eller telefon i events.data eller audit_log.changes etter fjerning og gjenoppretting", async () => {
    const { org, admin, contact, party } = await setup();
    await removeParty(admin, org.id, party.id);
    await restoreParty(admin, org.id, party.id, "undo");
    await removeParty(admin, org.id, party.id);
    await removeContact(admin, org.id, contact.id);
    await restoreParty(admin, org.id, party.id, "trash");

    const text = JSON.stringify([
      (await db.select().from(events).where(eq(events.organizationId, org.id))).map((e) => e.data),
      (await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id))).map(
        (a) => a.changes,
      ),
    ]);
    for (const value of [PARTY_NAME, "Testmann", PARTY_EMAIL, PARTY_PHONE, FIRM_NAME]) {
      expect(text, value).not.toContain(value);
    }
  });
});

type RoleCase = {
  name: string;
  roles: EmployeeRole[];
  editAll: boolean;
  deleted?: boolean;
  allowed: boolean;
};

const ROLE_CASES: RoleCase[] = [
  { name: "takstmann, innstillingen på", roles: ["inspector"], editAll: true, allowed: true },
  { name: "takstmann, innstillingen av", roles: ["inspector"], editAll: false, allowed: false },
  { name: "kontor", roles: ["office"], editAll: false, allowed: true },
  { name: "leder", roles: ["manager"], editAll: false, allowed: true },
  { name: "admin (eneste rolle)", roles: ["admin"], editAll: false, allowed: true },
  {
    name: "ansatt med deleted_at",
    roles: ["manager"],
    editAll: true,
    deleted: true,
    allowed: false,
  },
];

describe("4. tilgang per rolle for restoreParty", () => {
  it.each(ROLE_CASES)("$name → tilgang: $allowed", async (c) => {
    const { org, admin, party } = await setup();
    await setInspectorsEditAll(org.id, c.editAll);
    const actor = await createUser({ name: "Test Ansatt" });
    const employee = await createEmployee(actor, org.id, c.roles);
    if (c.deleted) {
      await db
        .update(employees)
        .set({ deletedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }
    await removeParty(admin, org.id, party.id);
    const before = await partyRow(party.id);
    const counts = await eventAndAuditCounts(org.id);

    const result = await caught(restoreParty(actor, org.id, party.id, "trash"));

    if (c.allowed) {
      expect(result).toBeNull();
      expect((await partyRow(party.id)).deleted_at).toBeNull();
    } else {
      expect(result).toBeInstanceOf(AccessDeniedError);
      expect(await partyRow(party.id)).toEqual(before);
      expect(await eventAndAuditCounts(org.id)).toEqual(counts);
    }
  });

  it("4.1 samme avslag uten lekkasje: ukjent id, id fra annen organisasjon, ugyldig UUID og kansellert oppdrag", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    await removeParty(b.admin, b.org.id, b.party.id);
    const cancelled = await createAssignment(a.org.id, {
      officeId: a.office.id,
      deletedAt: new Date("2026-11-03T10:00:00Z"),
    });
    const onCancelled = await createAssignmentParty(a.org.id, {
      assignmentId: cancelled.id,
      deletedAt: new Date("2026-11-03T10:05:00Z"),
    });

    const messages: string[] = [];
    for (const [name, id] of [
      ["ukjent id", "0190a000-0000-7000-8000-00000000dead"],
      ["annen organisasjon", b.party.id],
      ["ugyldig UUID", "ikke-en-id"],
      ["kansellert oppdrag", onCancelled.id],
    ] as const) {
      const error = await caught(restoreParty(a.admin, a.org.id, id, "trash"));
      expect(error, name).toBeInstanceOf(AccessDeniedError);
      messages.push((error as Error).message);
    }
    expect(new Set(messages).size).toBe(1);
    expect((await partyRow(b.party.id)).deleted_at, "B-parten er fortsatt fjernet").not.toBeNull();
  });
});

describe("5.5 tenant-isolasjon", () => {
  it("restoreParty gjenoppretter bare i egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [grantA.organizationId],
        b: [grantB.organizationId],
      }),
      query: async (actor: Actor, organizationId: string) => {
        // En fersk fjernet part i organisasjonen, slik at hvert kall har noe å gi tilbake.
        const party = await createAssignmentParty(organizationId, {
          role: "seller",
          name: "Selger Test",
          deletedAt: new Date("2026-11-03T10:00:00Z"),
        });
        const result = (await restoreParty(
          actor,
          organizationId,
          party.id,
          "trash",
        )) as unknown as Restored;
        return result.restored;
      },
      idOf: (r) => String(r.organizationId),
    });
  });
});
