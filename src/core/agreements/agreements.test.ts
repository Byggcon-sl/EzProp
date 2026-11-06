import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, organizations, type EmployeeRole } from "@/db/schema";
import {
  createClientAgreement,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import * as core from "./index";

/*
 * Avtale med oppdragsgiver: kjernen i src/core/agreements (opprette, endre, fjerne, liste, hente).
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 4. Avtalen på oppdraget
 * står i assignment-agreement.test.ts, forslaget i suggest.test.ts.
 *
 * Avvises uten: 4.1 (med admin-testen 4.1.5), 4.2 og 4.3. Regel 2 og 11.
 *
 * Testdata er oppdiktet: firmaet «Testforsikring AS», avtalen «Testavtale forsikring»,
 * premisseteksten «Premiss for test. Ikke ekte tekst.», rapportprofilen `test-profil`.
 *
 * Støtter hovedmål: reklamasjoner (premisseteksten ligger ett sted, bare admin endrer den, og
 * den finnes aldri i en annen organisasjon eller i revisjonsloggen) og tid (alle kan se avtalene).
 */

beforeEach(resetDatabase);

const FIRM_NAME = "Testforsikring AS";
const AGREEMENT_NAME = "Testavtale forsikring";
const PREMISE = "Premiss for test. Ikke ekte tekst.";
const PROFILE = "test-profil";

type AgreementInput = Parameters<typeof core.createAgreement>[2];

function agreementInput(firmId: string, overrides: Record<string, unknown> = {}): AgreementInput {
  return {
    firmId,
    name: AGREEMENT_NAME,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    premiseText: PREMISE,
    reportProfileCode: PROFILE,
    ...overrides,
  } as AgreementInput;
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
  const { actor: admin } = await person(org.id, ["admin"]);
  const firm = await createFirm(org.id, { name: FIRM_NAME, firmType: "insurer" });
  return { org, admin, firm };
}

type AgreementDbRow = {
  id: string;
  organization_id: string;
  firm_id: string;
  name: string;
  valid_from: string;
  valid_to: string | null;
  premise_text: string | null;
  report_profile_code: string | null;
  updated_at: string;
  deleted_at: string | null;
};

/** Raden rett fra databasen (datoer som tekst), eller `undefined`. */
async function agreementRow(id: string): Promise<AgreementDbRow | undefined> {
  const [row] = (await db.execute(sql`
    select id, organization_id, firm_id, name, valid_from::text as valid_from,
      valid_to::text as valid_to, premise_text, report_profile_code,
      updated_at::text as updated_at, deleted_at::text as deleted_at
    from client_agreements where id = ${id}`)) as unknown as AgreementDbRow[];
  return row;
}

async function agreementRowsIn(organizationId: string): Promise<AgreementDbRow[]> {
  return (await db.execute(sql`
    select id, organization_id, firm_id, name, valid_from::text as valid_from,
      valid_to::text as valid_to, premise_text, report_profile_code,
      updated_at::text as updated_at, deleted_at::text as deleted_at
    from client_agreements where organization_id = ${organizationId}
    order by created_at`)) as unknown as AgreementDbRow[];
}

async function counts() {
  const [agreements] = (await db.execute(
    sql`select count(*)::int as n from client_agreements`,
  )) as unknown as { n: number }[];
  const [audit] = await db.select({ n: count() }).from(auditLog);
  return { agreements: agreements?.n ?? 0, audit: audit?.n ?? 0 };
}

async function auditFor(organizationId: string) {
  return db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
}

async function agreementAudit(organizationId: string) {
  return (await auditFor(organizationId)).filter((row) => row.entityType === "client_agreement");
}

/** Feilen fra et kall, eller `null` når kallet lyktes. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Postgres-feilkoden når feilen kommer fra databasen (også innpakket). */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** «Fant ikke» eller «ingen tilgang», aldri databasefeil. */
function expectNotFoundOrDenied(error: unknown) {
  expect(error, "kallet skulle blitt avvist").not.toBeNull();
  expect(
    error instanceof core.NotFoundError || error instanceof AccessDeniedError,
    `ventet NotFoundError eller AccessDeniedError, fikk ${String(error)}`,
  ).toBe(true);
  expect(pgCode(error)).toBeUndefined();
}

/** Avvist i kjernen med norsk melding, ikke en databasefeil. */
function expectCoreRejection(error: unknown) {
  expect(error, "kallet skulle blitt avvist").toBeInstanceOf(Error);
  expect(pgCode(error), `databasefeil: ${String(error)}`).toBeUndefined();
  const message = (error as Error).message;
  expect(message).not.toMatch(/violates|constraint|insert or update|Failed query/i);
  expect(message.trim()).not.toBe("");
}

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

const ALL_ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];
const NON_ADMIN: EmployeeRole[] = ["inspector", "office", "manager"];

describe("4.1 tilgang per rolle", () => {
  it.each(ALL_ROLES)("4.1.1 %s kan liste og hente avtaler", async (role) => {
    const org = await createOrganization();
    const agreement = await createClientAgreement(org.id);
    const { actor } = await person(org.id, [role]);

    expect((await core.listAgreements(actor, org.id)).map((row) => row.id)).toEqual([
      agreement.id,
    ]);
    expect((await core.getAgreement(actor, org.id, agreement.id)).id).toBe(agreement.id);
  });

  it.each(NON_ADMIN.flatMap((role) => [true, false].map((editAll) => ({ role, editAll }))))(
    "4.1.2/4.1.3 $role (innstillingen inspectors_edit_all: $editAll) får AccessDeniedError på create, update og delete; ingenting endres",
    async ({ role, editAll }) => {
      const org = await createOrganization();
      await setInspectorsEditAll(org.id, editAll);
      const firm = await createFirm(org.id);
      const agreement = await createClientAgreement(org.id, { firmId: firm.id });
      const { actor } = await person(org.id, [role]);
      const before = await counts();
      const rowBefore = await agreementRow(agreement.id);

      await expect(
        core.createAgreement(actor, org.id, agreementInput(firm.id)),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(
        core.updateAgreement(actor, org.id, agreement.id, agreementInput(firm.id, { name: "Ny" })),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(core.deleteAgreement(actor, org.id, agreement.id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );

      expect(await counts()).toEqual(before);
      expect(await agreementRow(agreement.id)).toEqual(rowBefore);
    },
  );

  type Denied = { name: string; make: (organizationId: string) => Promise<Actor> };
  const DENIED: Denied[] = [
    { name: "uten ansattrad", make: async () => createUser() },
    {
      name: "deaktivert ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db
          .update(employees)
          .set({ deactivatedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id));
        return actor;
      },
    },
    {
      name: "slettet ansatt (admin)",
      make: async (organizationId) => {
        const { actor, employee } = await person(organizationId, ["admin"]);
        await db
          .update(employees)
          .set({ deletedAt: new Date("2026-11-01T08:00:00Z") })
          .where(eq(employees.id, employee.id));
        return actor;
      },
    },
  ];

  it.each(DENIED)("4.1.4 $name får AccessDeniedError på alle fem", async ({ make }) => {
    const org = await createOrganization();
    // Aktiv admin, så organisasjonen ikke står uten admin
    await person(org.id, ["admin"]);
    const firm = await createFirm(org.id);
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const actor = await make(org.id);
    const before = await counts();

    await expect(core.listAgreements(actor, org.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(core.getAgreement(actor, org.id, agreement.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      core.createAgreement(actor, org.id, agreementInput(firm.id)),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      core.updateAgreement(actor, org.id, agreement.id, agreementInput(firm.id)),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(core.deleteAgreement(actor, org.id, agreement.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await counts()).toEqual(before);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og uten sertifisering kan lese, opprette, endre og slette", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));
    expect((await core.listAgreements(admin, org.id)).map((row) => row.id)).toEqual([created.id]);
    expect((await core.getAgreement(admin, org.id, created.id)).name).toBe(AGREEMENT_NAME);

    const updated = await core.updateAgreement(
      admin,
      org.id,
      created.id,
      agreementInput(firm.id, { name: "Testavtale endret" }),
    );
    expect(updated.name).toBe("Testavtale endret");

    await core.deleteAgreement(admin, org.id, created.id);
    expect((await agreementRow(created.id))?.deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2)
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 listAgreements viser aldri avtaler fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [(await createClientAgreement(grantA.organizationId)).id],
        b: [(await createClientAgreement(grantB.organizationId)).id],
      }),
      query: (actor, organizationId) => core.listAgreements(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("4.2.2 getAgreement henter bare avtaler i egen organisasjon", async () => {
    const agreementFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          agreementFor.set(
            grant.organizationId,
            (await createClientAgreement(grant.organizationId)).id,
          );
        }
        return {
          a: [agreementFor.get(grantA.organizationId)!],
          b: [agreementFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await core.getAgreement(
          actor,
          organizationId,
          agreementFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("4.2.3 createAgreement legger alltid avtalen i egen organisasjon", async () => {
    const firmFor = new Map<string, string>();
    const orgs: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          orgs.push(grant.organizationId);
          firmFor.set(grant.organizationId, (await createFirm(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await core.createAgreement(
          actor,
          organizationId,
          agreementInput(firmFor.get(organizationId) ?? randomUUID()),
        );
        const stored = await agreementRow(row.id);
        return [{ organizationId: stored!.organization_id }];
      },
      idOf: (row) => row.organizationId,
    });
    for (const organizationId of orgs) {
      expect(await agreementRowsIn(organizationId)).toHaveLength(1);
    }
  });

  it("4.2.4 updateAgreement endrer bare avtaler i egen organisasjon", async () => {
    const agreementFor = new Map<string, { id: string; firmId: string }>();
    const editorFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const agreement = await createClientAgreement(grant.organizationId);
          agreementFor.set(grant.organizationId, { id: agreement.id, firmId: agreement.firmId });
        }
        return {
          a: [agreementFor.get(grantA.organizationId)!.id],
          b: [agreementFor.get(grantB.organizationId)!.id],
        };
      },
      query: async (actor, organizationId) => {
        const own = agreementFor.get(organizationId) ?? { id: randomUUID(), firmId: randomUUID() };
        const row = await core.updateAgreement(
          actor,
          organizationId,
          own.id,
          agreementInput(own.firmId, { name: `Endret av ${actor.id}` }),
        );
        editorFor.set(organizationId, actor.id);
        return [row];
      },
      idOf: (row) => row.id,
    });
    for (const [organizationId, agreement] of agreementFor) {
      expect((await agreementRow(agreement.id))?.name).toBe(
        `Endret av ${editorFor.get(organizationId)}`,
      );
    }
  });

  it("4.2.5 deleteAgreement fjerner bare avtaler i egen organisasjon", async () => {
    const agreementFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          agreementFor.set(
            grant.organizationId,
            (await createClientAgreement(grant.organizationId)).id,
          );
        }
        return {
          a: [agreementFor.get(grantA.organizationId)!],
          b: [agreementFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => [
        await core.deleteAgreement(
          actor,
          organizationId,
          agreementFor.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
    for (const [organizationId, id] of agreementFor) {
      expect((await agreementRow(id))?.deleted_at).not.toBeNull();
      const deletes = (await agreementAudit(organizationId)).filter(
        (row) => row.action === "delete",
      );
      expect(deletes.map((row) => row.entityId)).toEqual([id]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed id i egen organisasjon", () => {
  it("4.3.1 Bs avtale-id i getAgreement, updateAgreement og deleteAgreement avvises; Bs avtale er urørt", async () => {
    const { org: orgA, admin, firm: firmA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const agreementB = await createClientAgreement(orgB.id);
    const rowBefore = await agreementRow(agreementB.id);
    const before = await counts();

    expectNotFoundOrDenied(await caught(core.getAgreement(admin, orgA.id, agreementB.id)));
    expectNotFoundOrDenied(
      await caught(
        core.updateAgreement(admin, orgA.id, agreementB.id, agreementInput(firmA.id)),
      ),
    );
    expectNotFoundOrDenied(await caught(core.deleteAgreement(admin, orgA.id, agreementB.id)));

    expect(await agreementRow(agreementB.id)).toEqual(rowBefore);
    expect(await counts()).toEqual(before);
  });

  it("4.3.2 Bs firmId i createAgreement og updateAgreement avvises i kjernen; ingen rad", async () => {
    const { org: orgA, admin, firm: firmA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const firmB = await createFirm(orgB.id);
    const agreementA = await createClientAgreement(orgA.id, { firmId: firmA.id });
    const rowBefore = await agreementRow(agreementA.id);
    const before = await counts();

    expectCoreRejection(
      await caught(core.createAgreement(admin, orgA.id, agreementInput(firmB.id))),
    );
    expectCoreRejection(
      await caught(
        core.updateAgreement(admin, orgA.id, agreementA.id, agreementInput(firmB.id)),
      ),
    );

    expect(await counts()).toEqual(before);
    expect(await agreementRow(agreementA.id)).toEqual(rowBefore);
  });

  it("4.3.3 slettet firma som firmId avvises i kjernen; ingen rad", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const deletedFirm = await createFirm(org.id, { deletedAt: new Date("2026-11-01T08:00:00Z") });
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    const before = await counts();

    expectCoreRejection(
      await caught(core.createAgreement(admin, org.id, agreementInput(deletedFirm.id))),
    );
    expectCoreRejection(
      await caught(
        core.updateAgreement(admin, org.id, agreement.id, agreementInput(deletedFirm.id)),
      ),
    );
    expect(await counts()).toEqual(before);
    expect((await agreementRow(agreement.id))?.firm_id).toBe(firm.id);
  });

  it("4.3.4 organizationId: orgB i input ignoreres; raden lagres i A", async () => {
    const { org: orgA, admin, firm } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");

    const created = await core.createAgreement(admin, orgA.id, {
      ...agreementInput(firm.id),
      organizationId: orgB.id,
    } as AgreementInput);

    expect((await agreementRow(created.id))?.organization_id).toBe(orgA.id);
    expect(await agreementRowsIn(orgB.id)).toEqual([]);
  });

  it.each([
    { name: "tilfeldig uuid", id: () => randomUUID() },
    { name: "«ikke-en-id»", id: () => "ikke-en-id" },
  ])("4.3.5 $name gir NotFoundError/AccessDeniedError, aldri databasefeil", async ({ id }) => {
    const { org, admin, firm } = await orgWithAdmin();
    const before = await counts();

    expectNotFoundOrDenied(await caught(core.getAgreement(admin, org.id, id())));
    expectNotFoundOrDenied(
      await caught(core.updateAgreement(admin, org.id, id(), agreementInput(firm.id))),
    );
    expectNotFoundOrDenied(await caught(core.deleteAgreement(admin, org.id, id())));
    expect(await counts()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Opprette, endre, myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 opprette, endre og myk sletting", () => {
  it("4.4.1 opprette lagrer alle feltene i organisasjonen fra tilgangssjekken", async () => {
    const { org, admin, firm } = await orgWithAdmin();

    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));

    expect(await agreementRow(created.id)).toMatchObject({
      organization_id: org.id,
      firm_id: firm.id,
      name: AGREEMENT_NAME,
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
      premise_text: PREMISE,
      report_profile_code: PROFILE,
      deleted_at: null,
    });
  });

  it("4.4.1 tom til-dato, premissetekst og rapportprofil lagres som null", async () => {
    const { org, admin, firm } = await orgWithAdmin();

    const created = await core.createAgreement(
      admin,
      org.id,
      agreementInput(firm.id, { validTo: "", premiseText: "", reportProfileCode: "" }),
    );

    expect(await agreementRow(created.id)).toMatchObject({
      valid_to: null,
      premise_text: null,
      report_profile_code: null,
    });
  });

  it("4.4.2 endre lagrer nye verdier og oppdaterer updated_at", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const otherFirm = await createFirm(org.id, { name: "Testforsikring Nord AS" });
    const agreement = await createClientAgreement(org.id, { firmId: firm.id });
    await db.execute(
      sql`update client_agreements set updated_at = '2026-01-01T00:00:00Z' where id = ${agreement.id}`,
    );

    await core.updateAgreement(
      admin,
      org.id,
      agreement.id,
      agreementInput(otherFirm.id, {
        name: "Testavtale endret",
        validFrom: "2026-02-01",
        validTo: null,
        premiseText: "Endret premiss for test.",
        reportProfileCode: "test-profil-2",
      }),
    );

    const row = await agreementRow(agreement.id);
    expect(row).toMatchObject({
      firm_id: otherFirm.id,
      name: "Testavtale endret",
      valid_from: "2026-02-01",
      valid_to: null,
      premise_text: "Endret premiss for test.",
      report_profile_code: "test-profil-2",
    });
    expect(new Date(row!.updated_at).getTime()).toBeGreaterThan(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
  });

  it("4.4.3 slette setter deleted_at; raden finnes, vises ikke i listen", async () => {
    const { org, admin } = await orgWithAdmin();
    const kept = await createClientAgreement(org.id, { name: "Testavtale beholdt" });
    const agreement = await createClientAgreement(org.id);

    await core.deleteAgreement(admin, org.id, agreement.id);

    const row = await agreementRow(agreement.id);
    expect(row, "raden finnes fortsatt").toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
    expect((await core.listAgreements(admin, org.id)).map((item) => item.id)).toEqual([kept.id]);

    // getAgreement: enten med deletedAt, eller NotFoundError (kortet åpner for begge)
    const result = await core.getAgreement(admin, org.id, agreement.id).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    if (result.error) expect(result.error).toBeInstanceOf(core.NotFoundError);
    else expect((result.value as { deletedAt?: unknown }).deletedAt).toBeTruthy();
  });

  it("4.4.4 slettet avtale: updateAgreement og deleteAgreement gir NotFoundError, ingen loggrad, deleted_at uendret", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const deletedAt = new Date("2026-10-01T08:00:00Z");
    const agreement = await createClientAgreement(org.id, { firmId: firm.id, deletedAt });
    const rowBefore = await agreementRow(agreement.id);
    const before = await counts();

    await expect(
      core.updateAgreement(admin, org.id, agreement.id, agreementInput(firm.id)),
    ).rejects.toBeInstanceOf(core.NotFoundError);
    await expect(core.deleteAgreement(admin, org.id, agreement.id)).rejects.toBeInstanceOf(
      core.NotFoundError,
    );

    expect(await counts()).toEqual(before);
    expect(await agreementRow(agreement.id)).toEqual(rowBefore);
  });

  it("4.4.5 ingen permanent sletting i src/core/agreements", () => {
    const dir = path.join(process.cwd(), "src/core/agreements");
    const sources = readdirSync(dir).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/\.delete\(\s*clientAgreements/);
      expect(text, file).not.toMatch(/delete\s+from\s+client_agreements/i);
    }
  });

  it("4.4.6 listen har firmanavnet, er sortert på navn og viser utløpte avtaler", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const later = await createClientAgreement(org.id, { firmId: firm.id, name: "Testavtale B" });
    const expired = await createClientAgreement(org.id, {
      firmId: firm.id,
      name: "Testavtale A utløpt",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
    });
    await createClientAgreement(org.id, {
      firmId: firm.id,
      name: "Testavtale 0 slettet",
      deletedAt: new Date("2026-10-01T08:00:00Z"),
    });

    const list = await core.listAgreements(admin, org.id);
    expect(list.map((row) => row.id)).toEqual([expired.id, later.id]);
    for (const row of list) {
      expect((row as { firmName?: unknown }).firmName).toBe(FIRM_NAME);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("4.5 revisjonslogg", () => {
  it("4.5.1 én rad per skriving: client_agreement med create, update og delete", async () => {
    const { org, admin, firm } = await orgWithAdmin();

    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));
    await core.updateAgreement(
      admin,
      org.id,
      created.id,
      agreementInput(firm.id, { premiseText: "Endret premiss for test." }),
    );
    await core.deleteAgreement(admin, org.id, created.id);

    const rows = await agreementAudit(org.id);
    expect(rows.map((row) => row.action)).toEqual(["create", "update", "delete"]);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.entityId).toBe(created.id);
    }
  });

  it("4.5.2 update har navnene på feltene som ble endret", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));

    await core.updateAgreement(
      admin,
      org.id,
      created.id,
      agreementInput(firm.id, { premiseText: "Endret premiss for test." }),
    );

    const [update] = (await agreementAudit(org.id)).filter((row) => row.action === "update");
    expect(update).toBeDefined();
    const changes = JSON.stringify(update!.changes);
    expect(changes).toContain("premiseText");
    expect(changes).not.toContain("Endret premiss for test.");
  });

  it.each(["create", "update", "delete"] as const)(
    "4.5.3 premisseteksten logges aldri (%s)",
    async (action) => {
      const { org, admin, firm } = await orgWithAdmin();
      const created = await core.createAgreement(admin, org.id, agreementInput(firm.id));
      if (action !== "create") {
        await core.updateAgreement(
          admin,
          org.id,
          created.id,
          agreementInput(firm.id, { premiseText: `${PREMISE} Endret.` }),
        );
      }
      if (action === "delete") await core.deleteAgreement(admin, org.id, created.id);

      const rows = (await agreementAudit(org.id)).filter((row) => row.action === action);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toContain("Premiss for test");
    },
  );

  it("4.5.4 ingen loggrad ved avvist tilgang, valideringsfeil eller NotFoundError", async () => {
    const { org, admin, firm } = await orgWithAdmin();
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const before = await counts();

    await expect(
      core.createAgreement(inspector, org.id, agreementInput(firm.id)),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      core.createAgreement(
        admin,
        org.id,
        agreementInput(firm.id, { validFrom: "2026-03-01", validTo: "2026-02-28" }),
      ),
    ).rejects.toThrow();
    await expect(core.deleteAgreement(admin, org.id, randomUUID())).rejects.toBeInstanceOf(
      core.NotFoundError,
    );

    expect(await counts()).toEqual(before);
  });
});
