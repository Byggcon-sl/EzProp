import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { organizations, type EmployeeRole } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { saveTimeTrackingSettings, TimeTrackingValidationError } from "./index";

/*
 * Lagring av nullpunktet og bryteren «Mål tid» (docs/funksjoner/fase2a-tidsmaling-testplan.md
 * avsnitt 8, A121 og A123). Mot testdatabasen. Oppdiktet kilde «Oppdiktet måling, 3 oppdrag».
 *
 * Avvises uten: sammenslått lagring som beholder `access.inspectors_edit_all = false` (8.3),
 * admin med bare adminrollen (8.2) og tenant-isolasjon (8.7). Regel 2 og 11.
 *
 * Støtter hovedmål: tid (nullpunktet fra IVIT ligger klart for sammenligning) og reklamasjoner
 * (lagringen endrer aldri tilgangsinnstillingene i det stille).
 */

beforeEach(resetDatabase);

const SOURCE = "Oppdiktet måling, 3 oppdrag";
const BASELINE = { preparation: 30, inspection: 90, office: 240, delivery: 20, source: SOURCE };
const OTHER_SETTINGS = { "access.inspectors_edit_all": false, "test.annet": "x" };

async function person(organizationId: string, roles: EmployeeRole[], name = "Test Admin") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor } = await person(org.id, ["admin"]);
  return { orgId: org.id, admin: actor };
}

async function settingsOf(organizationId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return (row?.settings ?? {}) as Record<string, unknown>;
}

async function setSettings(organizationId: string, settings: Record<string, unknown>) {
  await db.update(organizations).set({ settings }).where(eq(organizations.id, organizationId));
}

describe("8.1–8.2 bare admin lagrer", () => {
  it.each(["manager", "inspector", "office"] as const)(
    "8.1 %s får AccessDeniedError, settings uendret, ingen revisjonslogg",
    async (role) => {
      const { orgId } = await orgWithAdmin();
      await setSettings(orgId, OTHER_SETTINGS);
      const { actor } = await person(orgId, [role], "Test Ikke Admin");
      const auditBefore = (await auditRows(orgId)).length;

      await expect(
        saveTimeTrackingSettings(actor, orgId, { enabled: false, baseline: BASELINE }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await settingsOf(orgId)).toEqual(OTHER_SETTINGS);
      expect((await auditRows(orgId)).length).toBe(auditBefore);
    },
  );

  it("8.2 admin med bare adminrollen lagrer (regel 11, skal aldri fjernes)", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, { "access.inspectors_edit_all": false });
    await saveTimeTrackingSettings(admin, orgId, { enabled: false, baseline: BASELINE });
    const settings = await settingsOf(orgId);
    expect(settings["time_tracking.enabled"]).toBe(false);
    expect(settings["time_tracking.baseline"]).toEqual(BASELINE);
  });
});

describe("8.3–8.4 sammenslått lagring", () => {
  it("8.3 bare time_tracking.* endres; access.inspectors_edit_all og andre nøkler beholdes", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, OTHER_SETTINGS);

    await saveTimeTrackingSettings(admin, orgId, { enabled: true, baseline: BASELINE });

    expect(await settingsOf(orgId)).toEqual({
      ...OTHER_SETTINGS,
      "time_tracking.enabled": true,
      "time_tracking.baseline": BASELINE,
    });
  });

  it("8.3 nøkler som sendes med i input, kommer aldri inn i settings", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, OTHER_SETTINGS);
    await saveTimeTrackingSettings(admin, orgId, {
      enabled: true,
      "access.inspectors_edit_all": true,
      organizationId: "0190a000-0000-7000-8000-000000000002",
    });
    const settings = await settingsOf(orgId);
    expect(settings["access.inspectors_edit_all"]).toBe(false);
    expect(Object.keys(settings).sort()).toEqual([
      "access.inspectors_edit_all",
      "test.annet",
      "time_tracking.enabled",
    ]);
  });

  it("8.4 bryteren alene endrer ikke nullpunktet", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, OTHER_SETTINGS);
    await saveTimeTrackingSettings(admin, orgId, { baseline: BASELINE });
    await saveTimeTrackingSettings(admin, orgId, { enabled: false });

    const settings = await settingsOf(orgId);
    expect(settings["time_tracking.baseline"]).toEqual(BASELINE);
    expect(settings["time_tracking.enabled"]).toBe(false);
    expect(settings["access.inspectors_edit_all"]).toBe(false);
  });

  it("8.4 nullpunktet alene endrer ikke bryteren", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveTimeTrackingSettings(admin, orgId, { enabled: false });
    await saveTimeTrackingSettings(admin, orgId, { baseline: BASELINE });

    const settings = await settingsOf(orgId);
    expect(settings["time_tracking.enabled"]).toBe(false);
    expect(settings["time_tracking.baseline"]).toEqual(BASELINE);
  });

  it("8.4 nytt nullpunkt erstatter det gamle helt", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveTimeTrackingSettings(admin, orgId, { baseline: BASELINE });
    const next = { preparation: 0, inspection: 0, office: 60, delivery: 0, source: "" };
    await saveTimeTrackingSettings(admin, orgId, { baseline: next });
    expect((await settingsOf(orgId))["time_tracking.baseline"]).toEqual(next);
  });
});

describe("8.5 ugyldig input", () => {
  it.each([
    ["minutter −1", { baseline: { ...BASELINE, office: -1 } }],
    ["minutter 10 001", { baseline: { ...BASELINE, inspection: 10_001 } }],
    ["desimaltall", { baseline: { ...BASELINE, preparation: 12.5 } }],
    ["tekst i minutter", { baseline: { ...BASELINE, delivery: "20" } }],
    ["kilde på 201 tegn", { baseline: { ...BASELINE, source: "a".repeat(201) } }],
    ["bryteren som tekst", { enabled: "nei" }],
  ])("%s gir valideringsfeil, settings uendret, ingen revisjonslogg", async (_label, input) => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, OTHER_SETTINGS);
    const auditBefore = (await auditRows(orgId)).length;

    await expect(saveTimeTrackingSettings(admin, orgId, input)).rejects.toBeInstanceOf(
      TimeTrackingValidationError,
    );
    expect(await settingsOf(orgId)).toEqual(OTHER_SETTINGS);
    expect((await auditRows(orgId)).length).toBe(auditBefore);
  });
});

describe("8.6 revisjonslogg", () => {
  it("én rad med feltnavnene som ble endret, uten de andre nøklene", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setSettings(orgId, OTHER_SETTINGS);
    const before = (await auditRows(orgId)).length;

    await saveTimeTrackingSettings(admin, orgId, { enabled: false, baseline: BASELINE });

    const rows = await auditRows(orgId);
    expect(rows.length).toBe(before + 1);
    const row = rows.at(-1)!;
    expect(row.entityType).toMatch(/^organization/);
    expect(row.entityId).toBe(orgId);
    const changes = JSON.stringify(row.changes);
    expect(changes).toContain("time_tracking.enabled");
    expect(changes).toContain("time_tracking.baseline");
    expect(changes).not.toContain("access.inspectors_edit_all");
    expect(changes).not.toContain("test.annet");
  });

  it("bare bryteren: revisjonsloggen nevner bare bryteren", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveTimeTrackingSettings(admin, orgId, { enabled: true });
    const row = (await auditRows(orgId)).at(-1)!;
    const changes = JSON.stringify(row.changes);
    expect(changes).toContain("time_tracking.enabled");
    expect(changes).not.toContain("time_tracking.baseline");
  });
});

describe("8.7 tenant-isolasjon (regel 2)", () => {
  it("lagring endrer bare organisasjonsraden til den innloggede", async () => {
    const orgIds = { a: "", b: "" };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgIds.a = grantA.organizationId;
        orgIds.b = grantB.organizationId;
        await setSettings(grantA.organizationId, { "access.inspectors_edit_all": false });
        await setSettings(grantB.organizationId, { "access.inspectors_edit_all": true });
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const enabled = grant.organizationId === orgIds.b;
        const row = await saveTimeTrackingSettings(actor, organizationId, {
          enabled,
          baseline: { ...BASELINE, source: `Kilde ${grant.organizationId}` },
        });
        expect(row.id).toBe(grant.organizationId);
        return [row];
      },
      idOf: (row) => row.id,
    });

    const settingsA = await settingsOf(orgIds.a);
    const settingsB = await settingsOf(orgIds.b);
    expect(settingsA["access.inspectors_edit_all"]).toBe(false);
    expect(settingsA["time_tracking.enabled"]).toBe(false);
    expect((settingsA["time_tracking.baseline"] as { source: string }).source).toBe(
      `Kilde ${orgIds.a}`,
    );
    expect(settingsB["access.inspectors_edit_all"]).toBe(true);
    expect(settingsB["time_tracking.enabled"]).toBe(true);
    expect((settingsB["time_tracking.baseline"] as { source: string }).source).toBe(
      `Kilde ${orgIds.b}`,
    );
  });

  it("admin i A med Bs organisasjons-id: AccessDeniedError, Bs settings uendret", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    await setSettings(b.orgId, OTHER_SETTINGS);
    await expect(
      saveTimeTrackingSettings(a.admin, b.orgId, { enabled: false }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await settingsOf(b.orgId)).toEqual(OTHER_SETTINGS);
  });
});

describe("8.8 samtidig lagring", () => {
  it("bryter og nullpunkt i Promise.all: begge nøklene står etterpå", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      const { orgId, admin } = await orgWithAdmin();
      await setSettings(orgId, OTHER_SETTINGS);
      await Promise.all([
        saveTimeTrackingSettings(admin, orgId, { enabled: false }),
        saveTimeTrackingSettings(admin, orgId, { baseline: BASELINE }),
      ]);
      expect(await settingsOf(orgId)).toEqual({
        ...OTHER_SETTINGS,
        "time_tracking.enabled": false,
        "time_tracking.baseline": BASELINE,
      });
    }
  });
});
