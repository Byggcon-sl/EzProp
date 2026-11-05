import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  auditLog,
  contacts as contactsTable,
  employees,
  events,
  firms as firmsTable,
  organizations,
  type EmployeeRole,
} from "@/db/schema";
import {
  createContact as insertContact,
  createEmployee,
  createFirm as insertFirm,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as contactsCore from "./index";
import { FirmDuplicateError } from "./index";

/*
 * Firma i kjernen (src/core/contacts/firms.ts).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 5 (firmadelen).
 * Kontaktdelen står i contacts.test.ts. Testdata er oppdiktet.
 * Støtter hovedmål: tid (ett firma per organisasjonsnummer, raskt søk) og reklamasjoner
 * (dubletten stoppes med lenke til firmaet som finnes; ingen personopplysninger i loggen).
 */

beforeEach(resetDatabase);

const { createFirm, getFirm, listFirms, updateFirm } = contactsCore;

const FIRM_INPUT = {
  name: "Testmegling AS",
  orgNumber: "000000019",
  firmType: "broker_firm",
  notes: "Vil ha rapport før kl. 12",
};

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

async function firmRow(id: string) {
  const [row] = await db.select().from(firmsTable).where(eq(firmsTable.id, id));
  if (!row) throw new Error("fant ikke firmaet");
  return row;
}

async function counts() {
  const [f] = await db.select({ n: count() }).from(firmsTable);
  const [c] = await db.select({ n: count() }).from(contactsTable);
  const [a] = await db.select({ n: count() }).from(auditLog);
  return { firms: f?.n ?? 0, contacts: c?.n ?? 0, audit: a?.n ?? 0 };
}

/** Alle fire firmatjenestene kalt én gang; kaster ved første feil. */
async function readFirms(actor: Actor, organizationId: string, firmId: string) {
  await listFirms(actor, organizationId);
  await getFirm(actor, organizationId, firmId);
}

async function writeFirms(actor: Actor, organizationId: string, firmId: string) {
  await createFirm(actor, organizationId, { name: "Testmegling Nord AS", orgNumber: null });
  await updateFirm(actor, organizationId, firmId, { name: "Testmegling Endret AS" });
}

// ---------------------------------------------------------------------------------------------
// 5.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

type RoleCase = { roles: EmployeeRole[]; editAll: boolean };

const roleCases: RoleCase[] = (["inspector", "office", "manager", "admin"] as const).flatMap(
  (role) => [
    { roles: [role], editAll: true },
    { roles: [role], editAll: false },
  ],
);

describe("5.1 tilgang per rolle (firma)", () => {
  it.each(roleCases)("$roles med innstillingen $editAll kan lese", async ({ roles, editAll }) => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, editAll);
    const firm = await insertFirm(org.id);
    const { actor } = await person(org.id, roles);
    await expect(readFirms(actor, org.id, firm.id)).resolves.toBeUndefined();
  });

  it.each(roleCases.filter((c) => !(c.roles[0] === "inspector" && !c.editAll)))(
    "$roles med innstillingen $editAll kan skrive",
    async ({ roles, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const firm = await insertFirm(org.id);
      const { actor } = await person(org.id, roles);
      await expect(writeFirms(actor, org.id, firm.id)).resolves.toBeUndefined();
    },
  );

  it("takstmann med innstillingen av får ikke skrive; ingenting endres", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const firm = await insertFirm(org.id);
    const { actor } = await person(org.id, ["inspector"]);
    const before = await counts();

    await expect(createFirm(actor, org.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateFirm(actor, org.id, firm.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);
    expect((await firmRow(firm.id)).name).toBe(firm.name);
  });

  it("takstmann med innstillingen av og enkeltrettigheten assignment.edit kan skrive", async () => {
    const org = await createOrganization();
    await setInspectorsEditAll(org.id, false);
    const firm = await insertFirm(org.id);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");
    await expect(writeFirms(actor, org.id, firm.id)).resolves.toBeUndefined();
  });

  it("bruker uten ansattrad får verken lese eller skrive", async () => {
    const org = await createOrganization();
    const firm = await insertFirm(org.id);
    const stranger = await createUser();
    await expect(listFirms(stranger, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(getFirm(stranger, org.id, firm.id)).rejects.toThrow(AccessDeniedError);
    await expect(createFirm(stranger, org.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateFirm(stranger, org.id, firm.id, FIRM_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)("%s ansatt (admin) får verken lese eller skrive", async (_name, set) => {
    const org = await createOrganization();
    const firm = await insertFirm(org.id);
    const { actor, employee } = await person(org.id, ["admin"]);
    await db.update(employees).set(set).where(eq(employees.id, employee.id));
    await expect(listFirms(actor, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(getFirm(actor, org.id, firm.id)).rejects.toThrow(AccessDeniedError);
    await expect(createFirm(actor, org.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
    await expect(updateFirm(actor, org.id, firm.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
  });

  it("ansatt uten roller får verken lese eller skrive", async () => {
    const org = await createOrganization();
    const firm = await insertFirm(org.id);
    const { actor } = await person(org.id, []);
    await expect(readFirms(actor, org.id, firm.id)).rejects.toThrow(AccessDeniedError);
    await expect(createFirm(actor, org.id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("admin uten andre roller og med innstillingen av kan lese og skrive", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const created = await createFirm(admin, org.id, FIRM_INPUT);
    await updateFirm(admin, org.id, created.id, { ...FIRM_INPUT, name: "Testmegling Endret AS" });
    expect((await getFirm(admin, org.id, created.id)).name).toBe("Testmegling Endret AS");
    expect((await listFirms(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("5.2 tenant-isolasjon (firma)", () => {
  it("listFirms", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => ({
        a: [(await insertFirm(a.organizationId)).id],
        b: [(await insertFirm(b.organizationId)).id],
      }),
      query: (actor, organizationId) => listFirms(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("getFirm", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        const firmA = await insertFirm(a.organizationId);
        const firmB = await insertFirm(b.organizationId);
        ids.set(a.organizationId, firmA.id).set(b.organizationId, firmB.id);
        return { a: [firmA.id], b: [firmB.id] };
      },
      // Mot fremmed organisasjon brukes en tilfeldig id: tilgangssjekken skal stoppe først
      query: async (actor, organizationId) => [
        await getFirm(actor, organizationId, ids.get(organizationId) ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
  });

  it("getFirm(...).contacts", async () => {
    const ids = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (a, b) => {
        const firmA = await insertFirm(a.organizationId);
        const firmB = await insertFirm(b.organizationId);
        ids.set(a.organizationId, firmA.id).set(b.organizationId, firmB.id);
        const contactA = await insertContact(a.organizationId, { firmId: firmA.id });
        const contactB = await insertContact(b.organizationId, { firmId: firmB.id });
        return { a: [contactA.id], b: [contactB.id] };
      },
      query: async (actor, organizationId) =>
        (await getFirm(actor, organizationId, ids.get(organizationId) ?? randomUUID())).contacts,
      idOf: (row) => row.id,
    });
  });

  it("createFirm (samme nummer i begge organisasjoner er lov)", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (a, b) => {
        orgB = b.organizationId;
        return { a: [a.organizationId], b: [b.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await createFirm(actor, organizationId, FIRM_INPUT);
        const [stored] = await db
          .select({ organizationId: firmsTable.organizationId })
          .from(firmsTable)
          .where(eq(firmsTable.id, row.id));
        return [stored!];
      },
      idOf: (row) => row.organizationId,
    });
    const inB = await db.select().from(firmsTable).where(eq(firmsTable.organizationId, orgB));
    expect(inB).toHaveLength(1);
  });

  it("updateFirm", async () => {
    const ids = new Map<string, string>();
    let firmB = "";
    await expectTenantIsolation({
      seed: async (a, b) => {
        const fa = await insertFirm(a.organizationId);
        const fb = await insertFirm(b.organizationId);
        ids.set(a.organizationId, fa.id).set(b.organizationId, fb.id);
        firmB = fb.id;
        return { a: [fa.id], b: [fb.id] };
      },
      query: async (actor, organizationId) => [
        await updateFirm(actor, organizationId, ids.get(organizationId) ?? randomUUID(), {
          name: `Endret av ${actor.id}`,
        }),
      ],
      idOf: (row) => row.id,
    });
    const row = await firmRow(firmB);
    const [adminB] = await db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.organizationId, row.organizationId));
    expect(row.name).toBe(`Endret av ${adminB?.userId}`);
    expect(row.rowVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.3 Fremmed id i egen organisasjon (IDOR), 5.4 myk sletting
// ---------------------------------------------------------------------------------------------

describe("5.3 og 5.4 fremmed, ukjent og slettet id", () => {
  it("Bs firma-id med A sin organisasjon gir AccessDeniedError, og Bs firma er uendret", async () => {
    const { org: orgA, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await insertFirm(orgB.id);
    const before = await firmRow(firmB.id);
    const auditBefore = (await counts()).audit;

    await expect(getFirm(admin, orgA.id, firmB.id)).rejects.toThrow(AccessDeniedError);
    await expect(updateFirm(admin, orgA.id, firmB.id, FIRM_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await firmRow(firmB.id)).toEqual(before);
    expect((await counts()).audit).toBe(auditBefore);
  });

  it.each([randomUUID(), "ikke-en-id", ""])(
    "ukjent eller ugyldig id %j gir AccessDeniedError, aldri databasefeil",
    async (id) => {
      const { org, admin } = await orgWithAdmin();
      await expect(getFirm(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
      await expect(updateFirm(admin, org.id, id, FIRM_INPUT)).rejects.toThrow(AccessDeniedError);
    },
  );

  it("slettet firma: get og update gir AccessDeniedError, raden er urørt, og listen viser det ikke", async () => {
    const { org, admin } = await orgWithAdmin();
    const deleted = await insertFirm(org.id, { deletedAt: new Date("2026-11-01T08:00:00Z") });
    const before = await firmRow(deleted.id);

    await expect(getFirm(admin, org.id, deleted.id)).rejects.toThrow(AccessDeniedError);
    await expect(updateFirm(admin, org.id, deleted.id, FIRM_INPUT)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await firmRow(deleted.id)).toEqual(before);
    expect(await listFirms(admin, org.id)).toEqual([]);
    expect(await listFirms(admin, org.id, { query: "Testmegling" })).toEqual([]);
  });

  it("getFirm viser ikke slettede kontakter", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const active = await insertContact(org.id, { firmId: firm.id });
    await insertContact(org.id, { firmId: firm.id, deletedAt: new Date() });
    expect((await getFirm(admin, org.id, firm.id)).contacts.map((c) => c.id)).toEqual([active.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.5 Dubletter (D17)
// ---------------------------------------------------------------------------------------------

describe("5.5 dubletter", () => {
  it.each(["000000019", "000 000 019"])(
    "createFirm med nummer som finnes (%j) gir FirmDuplicateError med id og navn",
    async (orgNumber) => {
      const { org, admin } = await orgWithAdmin();
      const existing = await insertFirm(org.id, {
        name: "Testmegling Sør AS",
        orgNumber: "000000019",
      });
      const before = await counts();

      const error = await createFirm(admin, org.id, { ...FIRM_INPUT, orgNumber }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(FirmDuplicateError);
      expect(error).toMatchObject({ firmId: existing.id, firmName: "Testmegling Sør AS" });
      expect(await counts()).toEqual(before);
    },
  );

  it("updateFirm til et nummer et annet firma har gir FirmDuplicateError; firmaet er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const existing = await insertFirm(org.id, { orgNumber: "000000019" });
    const other = await insertFirm(org.id, { name: "Testmegling Nord AS", orgNumber: "000000027" });
    const before = await firmRow(other.id);
    const auditBefore = (await counts()).audit;

    const error = await updateFirm(admin, org.id, other.id, {
      name: "Testmegling Nord AS",
      orgNumber: "000000019",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirmDuplicateError);
    expect(error).toMatchObject({ firmId: existing.id, firmName: existing.name });
    expect(await firmRow(other.id)).toEqual(before);
    expect((await counts()).audit).toBe(auditBefore);
  });

  it("updateFirm med sitt eget nummer går gjennom", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { orgNumber: "000000019" });
    const row = await updateFirm(admin, org.id, firm.id, { ...FIRM_INPUT, name: "Nytt navn AS" });
    expect(row).toMatchObject({ name: "Nytt navn AS", orgNumber: "000000019" });
  });

  it("slettet firma og firma i en annen organisasjon gir ikke dublett", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");
    await insertFirm(org.id, { orgNumber: "000000019", deletedAt: new Date() });
    await insertFirm(other.id, { orgNumber: "000000027" });
    await expect(createFirm(admin, org.id, FIRM_INPUT)).resolves.toBeDefined();
    await expect(
      createFirm(admin, org.id, { ...FIRM_INPUT, orgNumber: "000000027" }),
    ).resolves.toBeDefined();
  });

  it("etter FirmDuplicateError kan tjenesten kalles igjen og lykkes", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id, { orgNumber: "000000019" });
    await expect(createFirm(admin, org.id, FIRM_INPUT)).rejects.toThrow(FirmDuplicateError);
    await expect(
      createFirm(admin, org.id, { ...FIRM_INPUT, orgNumber: "000000027" }),
    ).resolves.toMatchObject({ orgNumber: "000000027" });
  });

  it("ugyldig nummer gir valideringsfeil, ingen rad", async () => {
    const { org, admin } = await orgWithAdmin();
    await expect(
      createFirm(admin, org.id, { ...FIRM_INPUT, orgNumber: "000000018" }),
    ).rejects.toThrow(ZodError);
    expect((await counts()).firms).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.6 Søk
// ---------------------------------------------------------------------------------------------

describe("5.6 søk (firma)", () => {
  it("treffer del av navn uten hensyn til store og små bokstaver, og del av nummeret", async () => {
    const { org, admin } = await orgWithAdmin();
    const named = await insertFirm(org.id, { name: "Testmegling AS", orgNumber: null });
    const numbered = await insertFirm(org.id, { name: "Annet AS", orgNumber: "000000108" });
    expect((await listFirms(admin, org.id, { query: "MEGLING" })).map((r) => r.id)).toEqual([
      named.id,
    ]);
    expect((await listFirms(admin, org.id, { query: "0108" })).map((r) => r.id)).toEqual([
      numbered.id,
    ]);
  });

  it("% og _ søker etter tegnet", async () => {
    const { org, admin } = await orgWithAdmin();
    const underscore = await insertFirm(org.id, { name: "Test_megling" });
    await insertFirm(org.id, { name: "Testxmegling" });
    const percent = await insertFirm(org.id, { name: "Hundre % megling" });
    expect((await listFirms(admin, org.id, { query: "_" })).map((r) => r.id)).toEqual([
      underscore.id,
    ]);
    expect((await listFirms(admin, org.id, { query: "%" })).map((r) => r.id)).toEqual([percent.id]);
  });

  it("tomt søk og bare mellomrom gir hele listen; langt søk gir ingen feil", async () => {
    const { org, admin } = await orgWithAdmin();
    await insertFirm(org.id);
    await insertFirm(org.id);
    expect(await listFirms(admin, org.id, { query: "" })).toHaveLength(2);
    expect(await listFirms(admin, org.id, { query: "   " })).toHaveLength(2);
    expect(await listFirms(admin, org.id, { query: "a".repeat(500) })).toEqual([]);
  });

  it("sortert på navn og høyst 200 rader", async () => {
    const { org, admin } = await orgWithAdmin();
    await db.insert(firmsTable).values(
      Array.from({ length: 201 }, (_, i) => ({
        organizationId: org.id,
        name: `Testmegling ${String(200 - i).padStart(3, "0")}`,
      })),
    );
    const rows = await listFirms(admin, org.id);
    expect(rows).toHaveLength(200);
    expect(rows[0]?.name).toBe("Testmegling 000");
    expect(rows.map((r) => r.name)).toEqual([...rows.map((r) => r.name)].sort());
  });

  it("søket filtrerer på organisasjonen", async () => {
    const { org, admin } = await orgWithAdmin();
    const other = await createOrganization("Organisasjon B");
    await insertFirm(other.id, { name: "Fjernmegling AS" });
    expect(await listFirms(admin, org.id, { query: "Fjernmegling" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5.7 Faste felt, 5.8 revisjonslogg
// ---------------------------------------------------------------------------------------------

const TRACKING_KEYS = ["deletedAt", "deletedBy", "rowVersion", "organizationId", "createdBy"];

describe("5.7 faste felt (firma)", () => {
  it("svarene har faste feltlister uten sporingsfelt", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createFirm(admin, org.id, FIRM_INPUT);
    await insertContact(org.id, { firmId: created.id });
    const detail = await getFirm(admin, org.id, created.id);
    const [listed] = await listFirms(admin, org.id);

    expect(Object.keys(created).sort()).toEqual(
      ["firmType", "id", "name", "notes", "orgNumber"].sort(),
    );
    expect(Object.keys(detail).sort()).toEqual(
      ["contacts", "firmType", "id", "name", "notes", "orgNumber"].sort(),
    );
    expect(Object.keys(listed!).sort()).toEqual(["firmType", "id", "name", "orgNumber"].sort());
    expect(Object.keys(detail.contacts[0]!).sort()).toEqual(
      ["email", "firstName", "id", "lastName", "phone"].sort(),
    );
    for (const key of TRACKING_KEYS) {
      expect(created).not.toHaveProperty(key);
      expect(detail).not.toHaveProperty(key);
    }
  });

  it("createFirm lagrer i organisasjonen fra tilgangssjekken med den ansatte som createdBy", async () => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["office"]);
    const created = await createFirm(actor, org.id, {
      ...FIRM_INPUT,
      organizationId: randomUUID(),
    } as typeof FIRM_INPUT);
    const row = await firmRow(created.id);
    expect(row).toMatchObject({ organizationId: org.id, createdBy: employee.id });
  });

  it("getFirm sorterer kontaktene på etternavn og fornavn", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const b = await insertContact(org.id, { firmId: firm.id, firstName: "Ola", lastName: "Berg" });
    const a2 = await insertContact(org.id, { firmId: firm.id, firstName: "Kari", lastName: "Aas" });
    const a1 = await insertContact(org.id, { firmId: firm.id, firstName: "Anne", lastName: "Aas" });
    expect((await getFirm(admin, org.id, firm.id)).contacts.map((c) => c.id)).toEqual([
      a1.id,
      a2.id,
      b.id,
    ]);
  });
});

describe("5.8 revisjonslogg (firma)", () => {
  it("én rad per skriving med id, kode og navnene på endrede felt, uten personopplysninger", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createFirm(admin, org.id, FIRM_INPUT);
    await updateFirm(admin, org.id, created.id, { ...FIRM_INPUT, notes: "Nytt notat 1" });

    const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, org.id));
    expect(rows.map((r) => [r.entityType, r.action, r.entityId])).toEqual([
      ["firm", "create", created.id],
      ["firm", "update", created.id],
    ]);
    expect(rows[0]?.changes).toEqual({ firmId: created.id, firmType: "broker_firm" });
    expect(rows[1]?.changes).toEqual({
      firmId: created.id,
      firmType: "broker_firm",
      changedFields: ["notes"],
    });
    const text = JSON.stringify(rows);
    for (const secret of ["Testmegling AS", "000000019", "Vil ha rapport", "Nytt notat 1"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("ingen rader i events", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await createFirm(admin, org.id, FIRM_INPUT);
    await updateFirm(admin, org.id, created.id, FIRM_INPUT);
    const [row] = await db.select({ n: count() }).from(events);
    expect(row?.n).toBe(0);
  });

  it("ingen loggrad ved valideringsfeil", async () => {
    const { org, admin } = await orgWithAdmin();
    await expect(createFirm(admin, org.id, { name: "" })).rejects.toThrow(ZodError);
    expect((await counts()).audit).toBe(0);
  });
});
