import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import type { EmployeeRole } from "@/db/schema";
import { anthropicSettings, FAKE_ANTHROPIC_KEY } from "../../../tests/ai";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { settingsSchemaFor } from "./connections";
import {
  ConnectionValidationError,
  createConnection,
  listConnections,
  PROVIDERS_BY_PORT,
  updateConnection,
  type CreateConnectionInput,
} from "./index";
import { isValidSecretRef } from "./secrets";

/*
 * Tilkoblingen til den ekte KI-leverandøren (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * avsnitt 2). `anthropic` er kjent på porten `ai`, krever hemmelighet, har et strengt skjema for
 * `settings`, og navnet på hemmeligheten er låst begge veier (A193). Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen, trygt: en tilkobling kan ikke lagres uten låsene, og nøkkelen
 * kan ikke sendes til feil leverandør.
 */

const SECRET_REF = "ANTHROPIC_API_KEY";
const INPUT: CreateConnectionInput = {
  port: "ai",
  provider: "anthropic",
  secretRef: SECRET_REF,
  settings: anthropicSettings(),
};

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv(SECRET_REF, FAKE_ANTHROPIC_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function adminIn(name = "Oppdiktet Takst A", roles: EmployeeRole[] = ["admin"]) {
  const organization = await createOrganization(name);
  const actor = await createUser({ name: "Test Admin" });
  await createEmployee(actor, organization.id, roles);
  return { organization, actor };
}

async function connectionCount(): Promise<number> {
  const [row] = (await db.execute(
    sql`select count(*)::int as n from integration_connections`,
  )) as unknown as { n: number }[];
  return row?.n ?? -1;
}

function create(actor: Actor, organizationId: string, input: Record<string, unknown>) {
  return createConnection(actor, organizationId, input as CreateConnectionInput);
}

describe("leverandørkoden anthropic (2.1)", () => {
  it("anthropic er kjent på porten ai", () => {
    expect(PROVIDERS_BY_PORT.ai).toContain("anthropic");
    expect(PROVIDERS_BY_PORT.ai).toContain("fake");
  });

  it("anthropic krever navnet på en hemmelighet", async () => {
    const { organization, actor } = await adminIn();
    await expect(
      create(actor, organization.id, { ...INPUT, secretRef: undefined }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await connectionCount()).toBe(0);
  });

  it("ukjent kode på ai avvises som før", async () => {
    const { organization, actor } = await adminIn();
    await expect(
      create(actor, organization.id, { ...INPUT, provider: "unknown_vendor" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
  });
});

describe("skjemaet for settings (2.2)", () => {
  const schema = settingsSchemaFor("anthropic");
  const { features: _features, ...withoutFeatures } = anthropicSettings();
  const { pricing: _pricing, ...withoutPricing } = anthropicSettings();
  const { model: _model, ...withoutModel } = anthropicSettings();
  void _features;
  void _pricing;
  void _model;
  const price = (overrides: Record<string, unknown>) =>
    anthropicSettings({
      pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK", ...overrides },
    });

  it.each([
    { name: "gyldige innstillinger", settings: anthropicSettings() },
    { name: "features mangler", settings: withoutFeatures },
    { name: "features er tom", settings: anthropicSettings({ features: [] }) },
  ])("godtatt: $name", ({ settings }) => {
    const parsed = schema.safeParse(settings);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Array.isArray(parsed.data.features)).toBe(true);
  });

  it.each([
    { name: "model mangler", settings: withoutModel },
    { name: 'model er ""', settings: anthropicSettings({ model: "" }) },
    { name: "model med mellomrom", settings: anthropicSettings({ model: "a b" }) },
    { name: "model med /", settings: anthropicSettings({ model: "a/b" }) },
    { name: "model over 100 tegn", settings: anthropicSettings({ model: "a".repeat(101) }) },
    { name: "ukjent funksjonskode", settings: anthropicSettings({ features: ["tg_suggest"] }) },
    { name: "pricing mangler", settings: withoutPricing },
    { name: "negativ pris", settings: price({ inputPerMillion: -1 }) },
    { name: "pris som tekst", settings: price({ inputPerMillion: "30" }) },
    { name: "NaN", settings: price({ inputPerMillion: Number.NaN }) },
    { name: "Infinity", settings: price({ outputPerMillion: Number.POSITIVE_INFINITY }) },
    { name: "-Infinity", settings: price({ outputPerMillion: Number.NEGATIVE_INFINITY }) },
    { name: "1e309", settings: price({ inputPerMillion: 1e309 }) },
    { name: "annen valuta", settings: price({ currency: "USD" }) },
    { name: "ekstra felt i pricing", settings: price({ discount: 0 }) },
    { name: "baseUrl", settings: anthropicSettings({ baseUrl: "https://oppdiktet.example" }) },
    { name: "apiKey", settings: anthropicSettings({ apiKey: "x" }) },
    { name: "url", settings: anthropicSettings({ url: "https://oppdiktet.example" }) },
  ])("avvist: $name", ({ settings }) => {
    expect(schema.safeParse(settings).success).toBe(false);
  });
});

describe("createConnection og updateConnection: navnet på hemmeligheten (2.3, 2.4, A193)", () => {
  it("anthropic med ANTHROPIC_API_KEY godtas av admin", async () => {
    const { organization, actor } = await adminIn();
    const created = await create(actor, organization.id, INPUT);
    expect(created.provider).toBe("anthropic");
    expect(created.secretRef).toBe(SECRET_REF);
    expect(created.settings).toEqual(anthropicSettings());
  });

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY"])(
    "anthropic med secret_ref %s avvises uten rad",
    async (secretRef) => {
      const { organization, actor } = await adminIn();
      await expect(create(actor, organization.id, { ...INPUT, secretRef })).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await connectionCount()).toBe(0);
    },
  );

  it("ugyldige settings avvises uten rad", async () => {
    const { organization, actor } = await adminIn();
    await expect(
      create(actor, organization.id, { ...INPUT, settings: anthropicSettings({ baseUrl: "x" }) }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await connectionCount()).toBe(0);
  });

  it("updateConnection som bytter secret_ref bort fra ANTHROPIC_API_KEY avvises", async () => {
    const { organization, actor } = await adminIn();
    const created = await create(actor, organization.id, INPUT);
    for (const secretRef of ["MS_GRAPH_CLIENT_SECRET", null]) {
      await expect(
        updateConnection(actor, organization.id, created.id, { secretRef }),
      ).rejects.toBeInstanceOf(ConnectionValidationError);
    }
    const [after] = await listConnections(actor, organization.id);
    expect(after?.secretRef).toBe(SECRET_REF);
  });

  it("updateConnection med ugyldige settings avvises, gyldige godtas", async () => {
    const { organization, actor } = await adminIn();
    const created = await create(actor, organization.id, INPUT);
    await expect(
      updateConnection(actor, organization.id, created.id, {
        settings: anthropicSettings({ url: "x" }),
      }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    const updated = await updateConnection(actor, organization.id, created.id, {
      settings: anthropicSettings({ features: [] }),
    });
    expect(updated.settings.features).toEqual([]);
  });

  it("motsatt lås: en annen leverandør med ANTHROPIC_API_KEY avvises ved oppretting", async () => {
    const { organization, actor } = await adminIn();
    await expect(
      create(actor, organization.id, {
        port: "email",
        provider: "microsoft365",
        secretRef: SECRET_REF,
        settings: { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-1" },
      }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    await expect(
      create(actor, organization.id, { port: "ai", provider: "fake", secretRef: SECRET_REF }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await connectionCount()).toBe(0);
  });

  it("motsatt lås: en annen leverandør kan ikke endres til ANTHROPIC_API_KEY", async () => {
    const { organization, actor } = await adminIn();
    const created = await create(actor, organization.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-1" },
    });
    await expect(
      updateConnection(actor, organization.id, created.id, { secretRef: SECRET_REF }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
  });

  it("ANTHROPIC_API_KEY står ikke på nektlisten", () => {
    expect(isValidSecretRef(SECRET_REF)).toBe(true);
  });

  it("listen over tilkoblinger viser aldri nøkkelens verdi (2.5)", async () => {
    const { organization, actor } = await adminIn();
    await create(actor, organization.id, INPUT);
    const list = await listConnections(actor, organization.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(FAKE_ANTHROPIC_KEY);
  });
});

describe("tilgang per rolle (2.6)", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager"])(
    "%s får AccessDeniedError på createConnection med anthropic",
    async (role) => {
      const { organization, actor } = await adminIn("Oppdiktet Takst A", [role]);
      await expect(create(actor, organization.id, INPUT)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await connectionCount()).toBe(0);
    },
  );

  it("admin uten andre roller lykkes (regel 11, admin stenges aldri ute)", async () => {
    const { organization, actor } = await adminIn("Oppdiktet Takst A", ["admin"]);
    const created = await create(actor, organization.id, INPUT);
    expect(created.provider).toBe("anthropic");
  });
});

describe("tenant-isolasjon (2.7)", () => {
  it("createConnection med anthropic lager tilkoblingen bare i egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] }),
      query: async (actor, organizationId) => {
        await create(actor, organizationId, INPUT);
        const rows = (await db.execute(
          sql`select organization_id from integration_connections where port = 'ai' and organization_id = ${organizationId}`,
        )) as unknown as { organization_id: string }[];
        return rows.map((row) => ({ organizationId: row.organization_id }));
      },
      idOf: (row) => row.organizationId,
    });
    const rows = (await db.execute(
      sql`select organization_id, count(*)::int as n from integration_connections where port = 'ai' group by organization_id`,
    )) as unknown as { organization_id: string; n: number }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.n).toBe(1);
  });
});
