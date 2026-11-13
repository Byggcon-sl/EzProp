import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { saveTimeTrackingSettings } from "@/core/work-sessions";
import { db } from "@/db/client";
import { organizations, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  getAiRetentionSettings,
  readRejectedRetentionYears,
  retainUntilFor,
  saveAiRetentionSettings,
} from "./retention";
import { addYears } from "./usage-log";

/*
 * Oppbevaringstid for avviste KI-forslag som innstilling (K7). Testplan:
 * docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md avsnitt 1 (U1–U8) og 2a (I1–I13).
 * Kortet: docs/agenter/oppgaver/ki-oppbevaring-avviste.md, A272–A275.
 *
 * Enhetstestene kjører uten database. Integrasjonstestene går mot testdatabasen, og innstillingen
 * settes rått i `organizations.settings`, så ugyldige verdier kan prøves. Alle data er oppdiktet.
 *
 * Avvises uten: I1–I3 (bare admin, admin aldri stengt ute, regel 11), I12–I13 (tenant-isolasjon,
 * regel 2) og I5/I11 (andre nøkler går aldri tapt).
 *
 * Støtter hovedmål: KI i bunnen (loggen står minst så lenge innstillingen sier, regnet ut ett
 * sted), de ansatte (admin endrer tallet selv, med tydelig feilmelding) og færre reklamasjoner
 * (godtatte og endrede forslag står alltid i 10 år).
 */

const KEY = "ai.rejected_retention_years";
const FIELD_ERROR = "Skriv et helt antall år fra 1 til 10.";
/** Organisasjons-id uten sifre, så sjekken av loggen ikke får falske treff på tall. */
const ORG_WITHOUT_DIGITS = "org-test-uten-sifre";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Om den serialiserte teksten inneholder verdien (tall som eget tall, ikke del av et annet). */
function containsValue(serialized: string, value: unknown): boolean {
  const asNumberText =
    typeof value === "number"
      ? String(value)
      : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())
        ? value.trim()
        : null;
  if (asNumberText !== null) {
    const escaped = asNumberText.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    return new RegExp(`(?<![0-9.\\-])${escaped}(?![0-9.])`).test(serialized);
  }
  if (typeof value === "string") return value.length > 0 && serialized.includes(value);
  if (value === null) return /\bnull\b/.test(serialized);
  if (typeof value === "boolean") return new RegExp(`\\b${value}\\b`).test(serialized);
  return serialized.includes(JSON.stringify(value));
}

function spyOnLogger() {
  return {
    debug: vi.spyOn(logger, "debug"),
    info: vi.spyOn(logger, "info"),
    warn: vi.spyOn(logger, "warn"),
    error: vi.spyOn(logger, "error"),
  };
}

function serializedCalls(spy: { mock: { calls: unknown[][] } }): string {
  return JSON.stringify(spy.mock.calls);
}

/** Loggteksten uten id-er og tidsstempler, så tallsjekken ikke treffer sifre i dem. */
function withoutIds(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "");
}

// --- 1. Enhetstester (uten database) ---

describe("U1–U4 retainUntilFor", () => {
  const created = new Date("2026-11-02T09:15:30.250Z");

  it("U1 retainUntilFor: rejected bruker innstillingen", () => {
    expect(retainUntilFor("rejected", created, 2).toISOString()).toBe(
      addYears(created, 2).toISOString(),
    );
  });

  it.each(["suggested", "accepted", "edited", null] as const)(
    "U2 retainUntilFor: alle andre statuser gir 10 år (%s, innstilling 1)",
    (status) => {
      expect(retainUntilFor(status, created, 1).toISOString()).toBe(
        addYears(created, 10).toISOString(),
      );
    },
  );

  it("U3 retainUntilFor: grensene 1 og 10", () => {
    expect(retainUntilFor("rejected", created, 1).toISOString()).toBe(
      addYears(created, 1).toISOString(),
    );
    expect(retainUntilFor("rejected", created, 10).toISOString()).toBe(
      addYears(created, 10).toISOString(),
    );
    expect(retainUntilFor("rejected", created, 1).toISOString()).toBe("2027-11-02T09:15:30.250Z");
    expect(retainUntilFor("rejected", created, 10).toISOString()).toBe("2036-11-02T09:15:30.250Z");
  });

  it("U4 retainUntilFor: 29. februar gir 1. mars", () => {
    const leap = new Date("2028-02-29T12:00:00Z");
    const oneYear = retainUntilFor("rejected", leap, 1);
    expect(oneYear.toISOString()).toBe("2029-03-01T12:00:00.000Z");
    expect(oneYear.toISOString()).toBe(addYears(leap, 1).toISOString());
    expect(retainUntilFor("rejected", leap, 4).toISOString()).toBe("2032-02-29T12:00:00.000Z");
    // Ti år (ikke-avvist) fra 29. februar: 2038 er ikke skuddår
    expect(retainUntilFor("accepted", leap, 1).toISOString()).toBe("2038-03-01T12:00:00.000Z");
  });

  it("U4 retainUntilFor endrer ikke datoen den får", () => {
    const input = new Date("2026-11-02T09:00:00Z");
    retainUntilFor("rejected", input, 3);
    expect(input.toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });
});

describe("U5–U7 readRejectedRetentionYears", () => {
  it.each([1, 5, 10])("U5 gyldig tall %i gir samme tall uten advarsel", (years) => {
    const spies = spyOnLogger();
    expect(readRejectedRetentionYears(ORG_WITHOUT_DIGITS, { [KEY]: years })).toBe(years);
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["tomt objekt", {}],
    ["andre nøkler, ikke denne", { "access.inspectors_edit_all": false, "ai.enabled": true }],
  ])("U6 mangler (%s) gir 10 uten advarsel", (_label, settings) => {
    const spies = spyOnLogger();
    expect(readRejectedRetentionYears(ORG_WITHOUT_DIGITS, settings)).toBe(10);
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  const invalidValues: [string, unknown][] = [
    ["0", 0],
    ["11", 11],
    ["2.5", 2.5],
    ["tekst «5»", "5"],
    ["null", null],
    ["-1", -1],
    ["tomt objekt", {}],
    ["tom liste", []],
    ["true", true],
    ["NaN-tekst", "NaN"],
    ["Infinity-tekst", "Infinity"],
    ["stort tall", 1e21],
  ];

  it.each(invalidValues)(
    "U7 ugyldig verdi (%s) gir 10 og advarsel uten verdien",
    (_label, value) => {
      const spies = spyOnLogger();
      expect(readRejectedRetentionYears(ORG_WITHOUT_DIGITS, { [KEY]: value, annet: "x" })).toBe(10);
      expect(spies.warn).toHaveBeenCalled();
      const calls = serializedCalls(spies.warn);
      expect(calls).toContain(ORG_WITHOUT_DIGITS);
      expect(calls).toContain(KEY);
      // Verdien står aldri i loggen (den faste meldingen kan nevne standarden 10)
      for (const call of spies.warn.mock.calls) {
        const text = JSON.stringify(call).replaceAll(KEY, "").replaceAll(ORG_WITHOUT_DIGITS, "");
        // Den faste meldingen kan nevne standarden 10
        expect(containsValue(text.replace(/\b10\b/g, ""), value)).toBe(false);
      }
      for (const level of ["debug", "info", "error"] as const) {
        expect(serializedCalls(spies[level])).not.toContain(KEY);
      }
    },
  );

  it.each([
    ["settings = null", null],
    ["settings = tekst", "oppdiktet-tekst-i-stedet-for-objekt"],
    ["settings = liste", [1, 2]],
  ])("U7 %s gir 10 og advarsel uten verdien", (_label, settings) => {
    const spies = spyOnLogger();
    expect(readRejectedRetentionYears(ORG_WITHOUT_DIGITS, settings)).toBe(10);
    expect(spies.warn).toHaveBeenCalled();
    const calls = serializedCalls(spies.warn);
    expect(calls).toContain(ORG_WITHOUT_DIGITS);
    expect(calls).toContain(KEY);
    expect(calls).not.toContain("oppdiktet-tekst-i-stedet-for-objekt");
  });
});

// --- 2a. Integrasjonstester mot testdatabasen ---

async function person(organizationId: string, roles: EmployeeRole[], name = "Test Admin") {
  const actor = await createUser({ name });
  await createEmployee(actor, organizationId, roles);
  return actor;
}

async function orgWithAdmin(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const admin = await person(org.id, ["admin"]);
  return { orgId: org.id, admin };
}

/** Hjelper fra testplanen: setter `organizations.settings` rått (også ugyldige verdier). */
async function setOrgSettings(organizationId: string, settings: unknown) {
  await db.execute(
    sql`update organizations set settings = ${JSON.stringify(settings)}::jsonb where id = ${organizationId}`,
  );
}

async function settingsOf(organizationId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return (row?.settings ?? {}) as Record<string, unknown>;
}

/** Verdien og JSON-typen rett fra databasen. */
async function rawSetting(
  organizationId: string,
): Promise<{ value: unknown; type: string | null }> {
  const [row] = (await db.execute(
    sql`select settings -> ${KEY} as value, jsonb_typeof(settings -> ${KEY}) as type
        from organizations where id = ${organizationId}`,
  )) as unknown as { value: unknown; type: string | null }[];
  return row ?? { value: undefined, type: null };
}

async function updatedAtOf(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ updatedAt: organizations.updatedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row!.updatedAt.toISOString();
}

async function captureError(call: () => Promise<unknown>): Promise<Error> {
  try {
    await call();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`kastet noe som ikke er Error: ${String(error)}`);
  }
  throw new Error("kallet skulle gitt feil, men gikk gjennom");
}

/** Alle tekster i feilen som en bruker eller loggen kan se (melding og feltfeil). */
function errorTexts(error: Error): string {
  const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors;
  return JSON.stringify({ message: error.message, fieldErrors: fieldErrors ?? null });
}

type NumberLeaf = { path: string; value: number };

function numberLeaves(value: unknown, path = ""): NumberLeaf[] {
  if (typeof value === "number") return [{ path, value }];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
      numberLeaves(inner, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Gammel og ny verdi i revisjonsloggen, funnet på feltnavn (old/from/before og new/to/after). */
function oldAndNew(changes: unknown): { old: number; next: number } {
  const leaves = numberLeaves(changes);
  const old = leaves.find((leaf) => /(^|\.)(old|from|before|previous)[^.]*$/i.test(leaf.path));
  const next = leaves.find((leaf) => /(^|\.)(new|to|after|next)[^.]*$/i.test(leaf.path));
  if (!old || !next) {
    throw new Error(`fant ikke gammel og ny verdi som tall i ${JSON.stringify(changes)}`);
  }
  return { old: old.value, next: next.value };
}

const OTHER_SETTINGS = {
  "access.inspectors_edit_all": false,
  "time_tracking.enabled": false,
  "time_tracking.baseline": {
    preparation: 30,
    inspection: 90,
    office: 240,
    delivery: 20,
    source: "Oppdiktet måling, 3 oppdrag",
  },
  "photo.retention.original_days": 30,
  "photo.retention.display_days": 365,
  "test.ukjent_nokkel": { nested: ["a", 1, true] },
};

describe("I1–I3 tilgang (regel 11)", () => {
  beforeEach(resetDatabase);

  it.each(["inspector", "office", "manager"] as const)(
    "I1 bare admin lagrer: %s får AccessDeniedError, settings uendret, ingen revisjonslogg",
    async (role) => {
      const { orgId } = await orgWithAdmin();
      await setOrgSettings(orgId, OTHER_SETTINGS);
      const actor = await person(orgId, [role], "Test Ikke Admin");
      const auditBefore = (await auditRows(orgId)).length;

      await expect(
        saveAiRetentionSettings(actor, orgId, { rejectedRetentionYears: 3 }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await settingsOf(orgId)).toEqual(OTHER_SETTINGS);
      expect((await auditRows(orgId)).length).toBe(auditBefore);
    },
  );

  it("I1 leder med alle andre roller unntatt admin får heller ikke lagre", async () => {
    const { orgId } = await orgWithAdmin();
    const actor = await person(orgId, ["inspector", "office", "manager"], "Test Alt Unntatt Admin");
    await expect(
      saveAiRetentionSettings(actor, orgId, { rejectedRetentionYears: 3 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect((await settingsOf(orgId))[KEY]).toBeUndefined();
  });

  it("I2 admin med bare adminrollen lagrer (regel 11, skal aldri fjernes)", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 3 });
    expect((await settingsOf(orgId))[KEY]).toBe(3);
  });

  it.each(["inspector", "office", "manager"] as const)(
    "I3 leser for siden: %s får AccessDeniedError",
    async (role) => {
      const { orgId } = await orgWithAdmin();
      await setOrgSettings(orgId, { [KEY]: 4 });
      const actor = await person(orgId, [role], "Test Ikke Admin");
      await expect(getAiRetentionSettings(actor, orgId)).rejects.toBeInstanceOf(AccessDeniedError);
    },
  );

  it("I3 leser for siden: admin får verdien, og 10 når den mangler eller er ugyldig", async () => {
    const { orgId, admin } = await orgWithAdmin();
    expect(JSON.stringify(await getAiRetentionSettings(admin, orgId))).toMatch(/\b10\b/);
    await setOrgSettings(orgId, { [KEY]: 4 });
    const found = await getAiRetentionSettings(admin, orgId);
    expect(numberLeaves(found).map((leaf) => leaf.value)).toEqual([4]);
    await setOrgSettings(orgId, { [KEY]: "4" });
    expect(numberLeaves(await getAiRetentionSettings(admin, orgId)).map((l) => l.value)).toEqual([
      10,
    ]);
  });
});

describe("I4–I7 lagring", () => {
  beforeEach(resetDatabase);

  it("I4 lagrer som tall også når skjemaet sender tekst", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: "4" });
    const raw = await rawSetting(orgId);
    expect(raw.type).toBe("number");
    expect(raw.value).toBe(4);
    expect(typeof (await settingsOf(orgId))[KEY]).toBe("number");
  });

  it("I5 beholder andre nøkler (dyp likhet), bare den nye nøkkelen er endret", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, OTHER_SETTINGS);
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 6 });
    expect(await settingsOf(orgId)).toEqual({ ...OTHER_SETTINGS, [KEY]: 6 });
  });

  it("I6 nøkler sendt med i input kommer aldri inn", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, OTHER_SETTINGS);
    const other = await createOrganization("Oppdiktet Takst B");
    await saveAiRetentionSettings(admin, orgId, {
      rejectedRetentionYears: 5,
      "access.inspectors_edit_all": true,
      "time_tracking.enabled": true,
      organizationId: other.id,
      [KEY]: 1,
    });
    expect(await settingsOf(orgId)).toEqual({ ...OTHER_SETTINGS, [KEY]: 5 });
    expect(await settingsOf(other.id)).toEqual({});
  });

  it("I7 revisjonslogg: én rad med nøkkel, gammel og ny verdi som tall", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, { ...OTHER_SETTINGS, [KEY]: 10 });
    const before = (await auditRows(orgId)).length;

    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 3 });

    const rows = await auditRows(orgId);
    expect(rows.length).toBe(before + 1);
    const row = rows.at(-1)!;
    expect(row.entityId).toBe(orgId);
    const changes = JSON.stringify(row.changes);
    expect(changes).toContain(KEY);
    expect(oldAndNew(row.changes)).toEqual({ old: 10, next: 3 });
    for (const otherKey of Object.keys(OTHER_SETTINGS)) {
      expect(changes).not.toContain(otherKey);
    }
    // Ingen verdier fra de andre nøklene heller
    expect(changes).not.toContain("Oppdiktet måling");
  });
});

describe("I8 ugyldig input", () => {
  beforeEach(resetDatabase);

  it.each([
    ["0 (tekst)", "0"],
    ["11 (tekst)", "11"],
    ["2.5 (tekst)", "2.5"],
    ["abc", "abc"],
    ["tom verdi", ""],
    ["-1 (tekst)", "-1"],
    ["1e1", "1e1"],
    ["0 (tall)", 0],
    ["11 (tall)", 11],
    ["2.5 (tall)", 2.5],
    ["-1 (tall)", -1],
    ["null", null],
  ])("I8/U8 %s avvises uten å gjengi det som ble skrevet", async (_label, value) => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, OTHER_SETTINGS);
    const auditBefore = (await auditRows(orgId)).length;
    const updatedBefore = await updatedAtOf(orgId);
    const spies = spyOnLogger();

    const error = await captureError(() =>
      saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: value }),
    );

    expect(error).not.toBeInstanceOf(AccessDeniedError);
    const texts = errorTexts(error);
    expect(texts).toContain(FIELD_ERROR);
    // Den faste teksten nevner 1 og 10; resten skal ikke inneholde inputen
    const rest = texts.replaceAll(FIELD_ERROR, "");
    if (value !== "" && value !== null) expect(containsValue(rest, value)).toBe(false);
    for (const spy of Object.values(spies)) {
      const logged = withoutIds(serializedCalls(spy).replaceAll(FIELD_ERROR, ""));
      if (value !== "" && value !== null) expect(containsValue(logged, value)).toBe(false);
    }
    expect(await settingsOf(orgId)).toEqual(OTHER_SETTINGS);
    expect((await auditRows(orgId)).length).toBe(auditBefore);
    expect(await updatedAtOf(orgId)).toBe(updatedBefore);
  });

  it("U8 «3» blir tallet 3", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: "3" });
    expect(await rawSetting(orgId)).toEqual({ value: 3, type: "number" });
  });

  it("U8 « 3 » med mellomrom gir enten 3 eller samme feilmelding, aldri noe annet", async () => {
    const { orgId, admin } = await orgWithAdmin();
    try {
      await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: " 3 " });
      expect(await rawSetting(orgId)).toEqual({ value: 3, type: "number" });
    } catch (error) {
      expect(error).not.toBeInstanceOf(AccessDeniedError);
      expect(errorTexts(error as Error)).toContain(FIELD_ERROR);
      expect((await settingsOf(orgId))[KEY]).toBeUndefined();
    }
  });

  it("U8 input som ikke er et objekt avvises", async () => {
    const { orgId, admin } = await orgWithAdmin();
    for (const input of [null, "3", 3, []]) {
      const error = await captureError(() => saveAiRetentionSettings(admin, orgId, input));
      expect(error).not.toBeInstanceOf(AccessDeniedError);
    }
    expect((await settingsOf(orgId))[KEY]).toBeUndefined();
  });
});

describe("I9–I10 gammel verdi og samme verdi (A275)", () => {
  beforeEach(resetDatabase);

  it.each([
    ["tekst «5»", { [KEY]: "5" }],
    ["0", { [KEY]: 0 }],
    ["manglende nøkkel", {}],
  ])("I9 gammel verdi er 10 når det som stod var %s", async (_label, settings) => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, settings);
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 3 });
    const row = (await auditRows(orgId)).at(-1)!;
    expect(oldAndNew(row.changes)).toEqual({ old: 10, next: 3 });
    const changes = JSON.stringify(row.changes);
    expect(changes).not.toContain('"5"');
    expect(changes).not.toContain("null");
    expect(await rawSetting(orgId)).toEqual({ value: 3, type: "number" });
  });

  it("I10 samme verdi som før: ingen skriving og ingen rad i revisjonsloggen", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 3 });
    const auditAfterFirst = (await auditRows(orgId)).length;
    const updatedAfterFirst = await updatedAtOf(orgId);

    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: "3" });
    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 3 });

    expect((await auditRows(orgId)).length).toBe(auditAfterFirst);
    expect(await updatedAtOf(orgId)).toBe(updatedAfterFirst);
    expect(await rawSetting(orgId)).toEqual({ value: 3, type: "number" });
  });

  it("I10 ingenting lagret (standard 10) og lagre 10: ingen skriving og ingen rad", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, OTHER_SETTINGS);
    const auditBefore = (await auditRows(orgId)).length;
    const updatedBefore = await updatedAtOf(orgId);

    await saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 10 });

    expect((await auditRows(orgId)).length).toBe(auditBefore);
    expect(await updatedAtOf(orgId)).toBe(updatedBefore);
    expect(await settingsOf(orgId)).toEqual(OTHER_SETTINGS);
  });
});

describe("I11 samtidig lagring", () => {
  beforeEach(resetDatabase);

  it("samtidig lagring mister ingen nøkkel (radlåsen virker)", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      const { orgId, admin } = await orgWithAdmin();
      await setOrgSettings(orgId, { "access.inspectors_edit_all": false });
      await Promise.all([
        saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 2 }),
        saveTimeTrackingSettings(admin, orgId, { enabled: false }),
      ]);
      expect(await settingsOf(orgId)).toEqual({
        "access.inspectors_edit_all": false,
        "time_tracking.enabled": false,
        [KEY]: 2,
      });
    }
  });

  it("to samtidige lagringer av innstillingen gir én gyldig verdi og ingen tapt nøkkel", async () => {
    const { orgId, admin } = await orgWithAdmin();
    await setOrgSettings(orgId, OTHER_SETTINGS);
    await Promise.all([
      saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 2 }),
      saveAiRetentionSettings(admin, orgId, { rejectedRetentionYears: 7 }),
    ]);
    const settings = await settingsOf(orgId);
    expect([2, 7]).toContain(settings[KEY]);
    expect(settings).toEqual({ ...OTHER_SETTINGS, [KEY]: settings[KEY] });
    // To ulike endringer gir to rader, og den siste har gammel verdi lik den første nye
    const rows = (await auditRows(orgId)).filter((row) =>
      JSON.stringify(row.changes).includes(KEY),
    );
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => oldAndNew(row.changes));
    expect(first!.old).toBe(10);
    expect(second!.old).toBe(first!.next);
    expect(second!.next).toBe(settings[KEY]);
  });
});

describe("I12–I13 tenant-isolasjon (regel 2)", () => {
  beforeEach(resetDatabase);

  it("I12 tenant-isolasjon: lagring", async () => {
    const orgIds = { a: "", b: "" };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgIds.a = grantA.organizationId;
        orgIds.b = grantB.organizationId;
        await setOrgSettings(grantA.organizationId, { "access.inspectors_edit_all": false });
        await setOrgSettings(grantB.organizationId, { "access.inspectors_edit_all": true });
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const years = grant.organizationId === orgIds.a ? 2 : 7;
        await saveAiRetentionSettings(actor, organizationId, { rejectedRetentionYears: years });
        return [{ id: grant.organizationId }];
      },
      idOf: (row) => row.id,
    });

    expect(await settingsOf(orgIds.a)).toEqual({ "access.inspectors_edit_all": false, [KEY]: 2 });
    expect(await settingsOf(orgIds.b)).toEqual({ "access.inspectors_edit_all": true, [KEY]: 7 });
  });

  it("I12 admin i A med Bs organisasjons-id: AccessDeniedError, Bs settings og logg uendret", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    await setOrgSettings(b.orgId, { ...OTHER_SETTINGS, [KEY]: 9 });
    const auditBefore = (await auditRows(b.orgId)).length;

    await expect(
      saveAiRetentionSettings(a.admin, b.orgId, { rejectedRetentionYears: 1 }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(getAiRetentionSettings(a.admin, b.orgId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await settingsOf(b.orgId)).toEqual({ ...OTHER_SETTINGS, [KEY]: 9 });
    expect((await auditRows(b.orgId)).length).toBe(auditBefore);
    expect((await settingsOf(a.orgId))[KEY]).toBeUndefined();
  });

  it("I13 tenant-isolasjon: lesing (B har 2, A har 7, hver ser bare sin)", async () => {
    const orgIds = { a: "", b: "" };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgIds.a = grantA.organizationId;
        orgIds.b = grantB.organizationId;
        await setOrgSettings(grantA.organizationId, { [KEY]: 7 });
        await setOrgSettings(grantB.organizationId, { [KEY]: 2 });
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const found = await getAiRetentionSettings(actor, organizationId);
        const grant = await requireOrganizationAccess(actor, organizationId);
        const years = numberLeaves(found).map((leaf) => leaf.value);
        expect(years).toEqual([grant.organizationId === orgIds.a ? 7 : 2]);
        return [{ id: grant.organizationId }];
      },
      idOf: (row) => row.id,
    });
  });
});
