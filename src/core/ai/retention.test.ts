import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { saveTimeTrackingSettings } from "@/core/work-sessions";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { employeeWithGrant } from "../../../tests/ai";
import { auditRows, createOrganization, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  AI_REJECTED_RETENTION_KEY,
  AI_RETENTION_YEARS_ERROR,
  AiRetentionValidationError,
  getAiRetentionSettings,
  readRejectedRetentionYears,
  retainUntilFor,
  saveAiRetentionSettings,
} from "./index";
import { aiRetentionSettingsSchema } from "./retention";
import { addYears } from "./usage-log";

/*
 * Oppbevaringstid for avviste KI-forslag (K7, A272–A275). Testplanen
 * docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md avsnitt 1 (U1–U8) og 2a (I1–I13).
 * Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (loggen står minst så lenge innstillingen sier, regnet ett sted)
 * og færre reklamasjoner (godtatte og endrede forslag står alltid 10 år).
 */

const T = new Date("2026-11-13T08:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

/** Setter `organizations.settings` rått, så ugyldige verdier kan prøves. */
async function setOrgSettings(organizationId: string, settings: unknown) {
  await db.execute(
    sql`update organizations set settings = ${JSON.stringify(settings)}::jsonb where id = ${organizationId}`,
  );
}

async function rawSettings(organizationId: string): Promise<Record<string, unknown>> {
  const [row] = (await db.execute(
    sql`select settings from organizations where id = ${organizationId}`,
  )) as unknown as { settings: Record<string, unknown> }[];
  return row!.settings;
}

async function updatedAt(organizationId: string): Promise<string> {
  const [row] = (await db.execute(
    sql`select updated_at from organizations where id = ${organizationId}`,
  )) as unknown as { updated_at: Date }[];
  return new Date(row!.updated_at).toISOString();
}

describe("retainUntilFor og readRejectedRetentionYears (U1–U7)", () => {
  it("U1 retainUntilFor: rejected bruker innstillingen", () => {
    expect(retainUntilFor("rejected", T, 2).toISOString()).toBe(addYears(T, 2).toISOString());
  });

  it("U2 retainUntilFor: alle andre statuser gir 10 år", () => {
    for (const status of ["suggested", "accepted", "edited", null] as const) {
      expect(retainUntilFor(status, T, 1).toISOString()).toBe(addYears(T, 10).toISOString());
    }
  });

  it("U3 retainUntilFor: grensene 1 og 10", () => {
    expect(retainUntilFor("rejected", T, 1).toISOString()).toBe("2027-11-13T08:00:00.000Z");
    expect(retainUntilFor("rejected", T, 10).toISOString()).toBe("2036-11-13T08:00:00.000Z");
  });

  it("U4 retainUntilFor: 29. februar gir 1. mars", () => {
    const leap = new Date("2028-02-29T12:00:00Z");
    expect(retainUntilFor("rejected", leap, 1).toISOString()).toBe("2029-03-01T12:00:00.000Z");
    expect(retainUntilFor("rejected", leap, 1).toISOString()).toBe(addYears(leap, 1).toISOString());
    expect(retainUntilFor("rejected", leap, 4).toISOString()).toBe("2032-02-29T12:00:00.000Z");
  });

  it("U4 retainUntilFor endrer ikke datoen den får", () => {
    const input = new Date("2026-11-02T09:00:00Z");
    retainUntilFor("rejected", input, 3);
    retainUntilFor("accepted", input, 3);
    expect(input.toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("U5 readRejectedRetentionYears: gyldige tall", () => {
    const warn = vi.spyOn(logger, "warn");
    for (const value of [1, 5, 10]) {
      expect(readRejectedRetentionYears("org", { [AI_REJECTED_RETENTION_KEY]: value })).toBe(value);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("U6 readRejectedRetentionYears: mangler gir 10 uten advarsel", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(readRejectedRetentionYears("org", {})).toBe(10);
    expect(readRejectedRetentionYears("org", { "time_tracking.enabled": true })).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });

  const invalid: { name: string; settings: unknown; marker: string | null }[] = [
    { name: "0", settings: { [AI_REJECTED_RETENTION_KEY]: 0 }, marker: null },
    { name: "11", settings: { [AI_REJECTED_RETENTION_KEY]: 11 }, marker: "11" },
    { name: "2.5", settings: { [AI_REJECTED_RETENTION_KEY]: 2.5 }, marker: "2.5" },
    { name: '"5"', settings: { [AI_REJECTED_RETENTION_KEY]: "5" }, marker: '"5"' },
    { name: "null", settings: { [AI_REJECTED_RETENTION_KEY]: null }, marker: null },
    { name: "-1", settings: { [AI_REJECTED_RETENTION_KEY]: -1 }, marker: "-1" },
    { name: "{}", settings: { [AI_REJECTED_RETENTION_KEY]: {} }, marker: null },
    { name: "[]", settings: { [AI_REJECTED_RETENTION_KEY]: [] }, marker: null },
    { name: "true", settings: { [AI_REJECTED_RETENTION_KEY]: true }, marker: "true" },
    { name: "tekst", settings: { [AI_REJECTED_RETENTION_KEY]: "mange-år" }, marker: "mange-år" },
    { name: "settings = null", settings: null, marker: null },
    { name: "settings = tekst", settings: "ugyldig-oppsett", marker: "ugyldig-oppsett" },
    { name: "settings = liste", settings: [1, 2], marker: null },
  ];

  it.each(invalid)(
    "U7 ugyldig verdi ($name) gir 10 og advarsel uten verdien",
    ({ settings, marker }) => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      expect(readRejectedRetentionYears("org-x", settings)).toBe(10);
      expect(warn).toHaveBeenCalledTimes(1);
      const [, context] = warn.mock.calls[0]!;
      expect(context).toEqual({ organizationId: "org-x", key: AI_REJECTED_RETENTION_KEY });
      if (marker !== null) {
        for (const arg of warn.mock.calls[0]!) {
          expect(JSON.stringify(arg)).not.toContain(marker);
        }
      }
    },
  );
});

describe("aiRetentionSettingsSchema (U8)", () => {
  it("U8 tekst blir tall, ugyldig avvises", () => {
    expect(aiRetentionSettingsSchema.parse({ rejectedRetentionYears: "3" })).toEqual({
      rejectedRetentionYears: 3,
    });
    expect(aiRetentionSettingsSchema.parse({ rejectedRetentionYears: " 3 " })).toEqual({
      rejectedRetentionYears: 3,
    });
    expect(aiRetentionSettingsSchema.parse({ rejectedRetentionYears: 7 })).toEqual({
      rejectedRetentionYears: 7,
    });
    for (const value of ["0", "11", "2.5", "abc", "", "-1", "1e1", 0, 11, 2.5, null]) {
      expect(
        aiRetentionSettingsSchema.safeParse({ rejectedRetentionYears: value }).success,
        String(value),
      ).toBe(false);
    }
  });
});

describe("lagring og lesing av innstillingen (I1–I13)", () => {
  beforeEach(resetDatabase);

  async function orgWithAdmin() {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await employeeWithGrant(organization.id, ["admin"], "Admin A");
    return { organization, admin: admin.actor as Actor };
  }

  it.each(["inspector", "office", "manager"] as const)(
    "I1 bare admin lagrer: %s får AccessDeniedError",
    async (role) => {
      const { organization } = await orgWithAdmin();
      const { actor } = await employeeWithGrant(organization.id, [role], "Ikke admin");
      const before = await rawSettings(organization.id);
      const auditBefore = (await auditRows(organization.id)).length;
      await expect(
        saveAiRetentionSettings(actor, organization.id, { rejectedRetentionYears: 3 }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await rawSettings(organization.id)).toEqual(before);
      expect((await auditRows(organization.id)).length).toBe(auditBefore);
    },
  );

  it("I1 leder med alle andre roller unntatt admin får heller ikke lagre", async () => {
    const { organization } = await orgWithAdmin();
    const { actor } = await employeeWithGrant(
      organization.id,
      ["inspector", "office", "manager"],
      "Alt unntatt admin",
    );
    await expect(
      saveAiRetentionSettings(actor, organization.id, { rejectedRetentionYears: 3 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await rawSettings(organization.id)).not.toHaveProperty(AI_REJECTED_RETENTION_KEY);
    expect(await auditRows(organization.id)).toHaveLength(0);
  });

  it("I2 admin med bare adminrollen lagrer (regel 11, skal aldri fjernes)", async () => {
    const { organization, admin } = await orgWithAdmin();
    const result = await saveAiRetentionSettings(admin, organization.id, {
      rejectedRetentionYears: 3,
    });
    expect(result).toEqual({ rejectedRetentionYears: 3, changed: true });
    expect((await rawSettings(organization.id))[AI_REJECTED_RETENTION_KEY]).toBe(3);
  });

  it.each(["inspector", "office", "manager"] as const)(
    "I3 leser for siden: %s får AccessDeniedError, admin får verdien",
    async (role) => {
      const { organization, admin } = await orgWithAdmin();
      await setOrgSettings(organization.id, { [AI_REJECTED_RETENTION_KEY]: 4 });
      const { actor } = await employeeWithGrant(organization.id, [role], "Ikke admin");
      await expect(getAiRetentionSettings(actor, organization.id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      expect(await getAiRetentionSettings(admin, organization.id)).toEqual({
        rejectedRetentionYears: 4,
      });
    },
  );

  it("I4 lagrer som tall også når skjemaet sender tekst", async () => {
    const { organization, admin } = await orgWithAdmin();
    await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: "4" });
    const value = (await rawSettings(organization.id))[AI_REJECTED_RETENTION_KEY];
    expect(typeof value).toBe("number");
    expect(value).toBe(4);
  });

  it("I5 beholder andre nøkler", async () => {
    const { organization, admin } = await orgWithAdmin();
    const others = {
      "access.inspectors_edit_all": true,
      "time_tracking.enabled": false,
      "time_tracking.baseline": { office: 60, inspector: 120 },
      "photo.retention.years": 10,
      "ukjent.nokkel": { a: [1, 2] },
    };
    await setOrgSettings(organization.id, others);
    await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 2 });
    expect(await rawSettings(organization.id)).toEqual({
      ...others,
      [AI_REJECTED_RETENTION_KEY]: 2,
    });
  });

  it("I6 nøkler sendt med i input kommer aldri inn", async () => {
    const { organization, admin } = await orgWithAdmin();
    await setOrgSettings(organization.id, { "access.inspectors_edit_all": true });
    await saveAiRetentionSettings(admin, organization.id, {
      rejectedRetentionYears: 2,
      "access.inspectors_edit_all": false,
      organizationId: "00000000-0000-0000-0000-000000000000",
    });
    expect(await rawSettings(organization.id)).toEqual({
      "access.inspectors_edit_all": true,
      [AI_REJECTED_RETENTION_KEY]: 2,
    });
  });

  it("I7 revisjonslogg: én rad med nøkkel, gammel og ny verdi som tall", async () => {
    const { organization, admin } = await orgWithAdmin();
    await setOrgSettings(organization.id, {
      [AI_REJECTED_RETENTION_KEY]: 10,
      "access.inspectors_edit_all": true,
    });
    await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 3 });
    const rows = await auditRows(organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe("organization");
    expect(rows[0]!.entityId).toBe(organization.id);
    expect(rows[0]!.changes).toEqual({ key: AI_REJECTED_RETENTION_KEY, old: 10, new: 3 });
    expect(JSON.stringify(rows[0]!.changes)).not.toContain("inspectors_edit_all");
  });

  it.each([0, 11, 2.5, "abc", "", -1, "-1", "1e1"])(
    "I8 ugyldig input (%s) avvises uten å gjengi det som ble skrevet",
    async (value) => {
      const { organization, admin } = await orgWithAdmin();
      await setOrgSettings(organization.id, { [AI_REJECTED_RETENTION_KEY]: 4 });
      const warn = vi.spyOn(logger, "warn");
      const error = vi.spyOn(logger, "error");
      const caught = await saveAiRetentionSettings(admin, organization.id, {
        rejectedRetentionYears: value,
      }).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(AiRetentionValidationError);
      const validation = caught as AiRetentionValidationError;
      expect(validation.fieldErrors).toEqual({ rejectedRetentionYears: AI_RETENTION_YEARS_ERROR });
      expect(AI_RETENTION_YEARS_ERROR).toBe("Skriv et helt antall år fra 1 til 10.");
      const text = String(value);
      if (text.length > 0 && !AI_RETENTION_YEARS_ERROR.includes(text)) {
        expect(validation.message).not.toContain(text);
        expect(JSON.stringify(validation.fieldErrors)).not.toContain(text);
      }
      if (text.length > 0) {
        for (const call of [...warn.mock.calls, ...error.mock.calls]) {
          expect(JSON.stringify(call)).not.toContain(`"${text}"`);
        }
      }
      expect(await rawSettings(organization.id)).toEqual({ [AI_REJECTED_RETENTION_KEY]: 4 });
      expect(await auditRows(organization.id)).toHaveLength(0);
    },
  );

  it("U8 input som ikke er et objekt avvises", async () => {
    const { organization, admin } = await orgWithAdmin();
    for (const input of [null, "3", 3, []]) {
      const caught = await saveAiRetentionSettings(admin, organization.id, input).catch(
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(AiRetentionValidationError);
    }
    expect(await rawSettings(organization.id)).not.toHaveProperty(AI_REJECTED_RETENTION_KEY);
    expect(await auditRows(organization.id)).toHaveLength(0);
  });

  it.each([
    { name: "tekst «5»", settings: { [AI_REJECTED_RETENTION_KEY]: "5" } },
    { name: "0", settings: { [AI_REJECTED_RETENTION_KEY]: 0 } },
    { name: "manglende nøkkel", settings: {} },
  ])("I9 gammel verdi er 10 når det som stod var ugyldig ($name)", async ({ settings }) => {
    const { organization, admin } = await orgWithAdmin();
    await setOrgSettings(organization.id, settings);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 5 });
    const rows = await auditRows(organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toEqual({ key: AI_REJECTED_RETENTION_KEY, old: 10, new: 5 });
    expect((await rawSettings(organization.id))[AI_REJECTED_RETENTION_KEY]).toBe(5);
  });

  it("I10 samme verdi som før: ingen skriving og ingen rad i revisjonsloggen", async () => {
    const { organization, admin } = await orgWithAdmin();
    // Ingenting lagret (standard 10) og lagre 10: ingen skriving
    const untouched = await updatedAt(organization.id);
    expect(
      await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 10 }),
    ).toEqual({ rejectedRetentionYears: 10, changed: false });
    expect(await updatedAt(organization.id)).toBe(untouched);
    expect(await rawSettings(organization.id)).not.toHaveProperty(AI_REJECTED_RETENTION_KEY);
    expect(await auditRows(organization.id)).toHaveLength(0);

    await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 3 });
    const afterFirst = await updatedAt(organization.id);
    expect(
      await saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: "3" }),
    ).toEqual({ rejectedRetentionYears: 3, changed: false });
    expect(await updatedAt(organization.id)).toBe(afterFirst);
    expect(await auditRows(organization.id)).toHaveLength(1);
  });

  it("I11 samtidig lagring mister ingen nøkkel", async () => {
    const { organization, admin } = await orgWithAdmin();
    await Promise.all([
      saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 2 }),
      saveTimeTrackingSettings(admin, organization.id, { enabled: false }),
    ]);
    const settings = await rawSettings(organization.id);
    expect(settings[AI_REJECTED_RETENTION_KEY]).toBe(2);
    expect(settings["time_tracking.enabled"]).toBe(false);
  });

  it("I11 to samtidige lagringer av innstillingen gir én gyldig verdi og ingen tapt nøkkel", async () => {
    const { organization, admin } = await orgWithAdmin();
    const others = { "access.inspectors_edit_all": true, "time_tracking.enabled": false };
    await setOrgSettings(organization.id, others);
    await Promise.all([
      saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 2 }),
      saveAiRetentionSettings(admin, organization.id, { rejectedRetentionYears: 7 }),
    ]);
    const settings = await rawSettings(organization.id);
    const final = settings[AI_REJECTED_RETENTION_KEY];
    expect([2, 7]).toContain(final);
    expect(settings).toEqual({ ...others, [AI_REJECTED_RETENTION_KEY]: final });
    // Radlåsen gjør at den andre ser den første: to rader, kjedet gammel → ny
    const rows = await auditRows(organization.id);
    expect(rows).toHaveLength(2);
    // Radene kan ha samme tidspunkt, så rekkefølgen finnes fra kjeden, ikke fra sorteringen
    const changes = rows.map((row) => row.changes as { old: number; new: number });
    const first = changes.find((change) => change.old === 10);
    const second = changes.find((change) => change !== first);
    expect(first).toBeDefined();
    expect(second!.old).toBe(first!.new);
    expect(second!.new).toBe(final);
  });

  it("I12 tenant-isolasjon: lagring", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        await saveAiRetentionSettings(actor, organizationId, { rejectedRetentionYears: 4 });
        return [{ id: organizationId }];
      },
      idOf: (row) => row.id,
    });
    // B er lagret én gang av sin egen admin; forsøket fra A endret ingenting mer
    expect((await rawSettings(orgB))[AI_REJECTED_RETENTION_KEY]).toBe(4);
    expect(await auditRows(orgB)).toHaveLength(1);
  });

  it("I12 admin i A med Bs id endrer ikke B", async () => {
    const a = await orgWithAdmin();
    const orgB = await createOrganization("Oppdiktet Takst B");
    await setOrgSettings(orgB.id, { [AI_REJECTED_RETENTION_KEY]: 6 });
    await expect(
      saveAiRetentionSettings(a.admin, orgB.id, { rejectedRetentionYears: 2 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(getAiRetentionSettings(a.admin, orgB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await rawSettings(orgB.id)).toEqual({ [AI_REJECTED_RETENTION_KEY]: 6 });
    expect(await auditRows(orgB.id)).toHaveLength(0);
  });

  it("I13 tenant-isolasjon: lesing", async () => {
    const seen = new Map<string, number>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await setOrgSettings(grantA.organizationId, { [AI_REJECTED_RETENTION_KEY]: 7 });
        await setOrgSettings(grantB.organizationId, { [AI_REJECTED_RETENTION_KEY]: 2 });
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const result = await getAiRetentionSettings(actor, organizationId);
        seen.set(organizationId, result.rejectedRetentionYears);
        return [{ id: organizationId }];
      },
      idOf: (row) => row.id,
    });
    expect([...seen.values()].sort()).toEqual([2, 7]);
  });
});
