import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { integrationConnections, type EmployeeRole } from "@/db/schema";
import { anthropicSettings } from "../../../tests/ai";
import { TEST_ANTHROPIC_KEY } from "../../../tests/fake-anthropic-http";
import {
  createEmployee,
  createIntegrationConnection,
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
  type UpdateConnectionInput,
} from "./index";
import { isValidSecretRef } from "./secrets";

/*
 * Tilkoblingen `anthropic` på porten `ai` (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * avsnitt 2, kortet Omfang 2, 3 og 15). Mot testdatabasen. Skjemaet for `settings` er regler som
 * data (`it.each`). Nøkkelen er oppdiktet og settes bare med `vi.stubEnv`.
 *
 * Støtter hovedmål: KI i bunnen (admin kobler organisasjonen til leverandøren uten kodeendring, og
 * en feil innstilling slipper aldri gjennom) og færre reklamasjoner (pris og modell står alltid på
 * tilkoblingen, så kostnaden i loggen er riktig).
 */

const SECRET_REF = "ANTHROPIC_API_KEY";

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv(SECRET_REF, TEST_ANTHROPIC_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function create(actor: Actor, organizationId: string, input: Record<string, unknown>) {
  return createConnection(actor, organizationId, input as unknown as CreateConnectionInput);
}

function update(
  actor: Actor,
  organizationId: string,
  connectionId: string,
  input: Record<string, unknown>,
) {
  return updateConnection(
    actor,
    organizationId,
    connectionId,
    input as unknown as UpdateConnectionInput,
  );
}

function anthropicInput(overrides: Record<string, unknown> = {}) {
  return {
    port: "ai",
    provider: "anthropic",
    secretRef: SECRET_REF,
    settings: anthropicSettings(),
    ...overrides,
  };
}

async function personIn(organizationId: string, roles: EmployeeRole[], name: string) {
  const actor = await createUser({ name });
  await createEmployee(actor, organizationId, roles);
  return actor;
}

async function adminIn(organizationId: string) {
  return personIn(organizationId, ["admin"], "Test Admin");
}

async function aiConnections() {
  return db.select().from(integrationConnections).where(eq(integrationConnections.port, "ai"));
}

describe("anthropic er kjent på porten ai (2.1)", () => {
  it("2.1 anthropic står i PROVIDERS_BY_PORT.ai sammen med fake", () => {
    const providers = PROVIDERS_BY_PORT as Record<string, readonly string[]>;
    expect([...providers.ai!].sort()).toEqual(["anthropic", "fake"]);
  });

  it("2.1 anthropic krever hemmelighet: uten secretRef avvises den uten rad", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    const { secretRef: _omit, ...withoutSecret } = anthropicInput();
    void _omit;
    await expect(create(admin, org.id, withoutSecret)).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
    expect(await aiConnections()).toEqual([]);
  });

  it("2.1 ukjent kode på ai avvises som før", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    await expect(
      create(admin, org.id, anthropicInput({ provider: "unknown_vendor" })),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await aiConnections()).toEqual([]);
  });
});

describe("skjemaet for settings til anthropic (2.2, regler som data)", () => {
  const schema = () => {
    const found = settingsSchemaFor("anthropic");
    if (!found) throw new Error('settingsSchemaFor("anthropic") gir null');
    return found;
  };
  const valid = anthropicSettings();
  const pricing = valid.pricing as Record<string, unknown>;
  const without = (key: string) =>
    Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));

  it.each([
    { name: "gyldige innstillinger", settings: valid, features: ["language_polish"] },
    { name: "features mangler (blir tom liste)", settings: without("features"), features: [] },
    { name: "features: []", settings: { ...valid, features: [] }, features: [] },
    {
      name: "modell med punktum, kolon, strek og understrek",
      settings: { ...valid, model: "Merke_modell-K7Q.2:test" },
      features: ["language_polish"],
    },
    {
      name: "modell på 100 tegn",
      settings: { ...valid, model: "M".repeat(100) },
      features: ["language_polish"],
    },
    {
      name: "pris 0",
      settings: { ...valid, pricing: { inputPerMillion: 0, outputPerMillion: 0, currency: "NOK" } },
      features: ["language_polish"],
    },
  ])("2.2 godtatt: $name", ({ settings, features }) => {
    const parsed = schema().safeParse(settings);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as Record<string, unknown>).features).toEqual(features);
  });

  it.each([
    { name: "model mangler", settings: without("model") },
    { name: 'model er ""', settings: { ...valid, model: "" } },
    { name: "model med mellomrom", settings: { ...valid, model: "MERKE MODELL" } },
    { name: "model med /", settings: { ...valid, model: "MERKE/MODELL" } },
    { name: "model over 100 tegn", settings: { ...valid, model: "M".repeat(101) } },
    { name: "model er tall", settings: { ...valid, model: 7 } },
    { name: "features med ukjent kode", settings: { ...valid, features: ["tg_suggest"] } },
    { name: "features er tekst", settings: { ...valid, features: "language_polish" } },
    { name: "pricing mangler", settings: without("pricing") },
    {
      name: "inputPerMillion negativ",
      settings: { ...valid, pricing: { ...pricing, inputPerMillion: -1 } },
    },
    {
      name: "outputPerMillion negativ",
      settings: { ...valid, pricing: { ...pricing, outputPerMillion: -0.01 } },
    },
    {
      name: "inputPerMillion som tekst",
      settings: { ...valid, pricing: { ...pricing, inputPerMillion: "30" } },
    },
    {
      name: "inputPerMillion NaN",
      settings: { ...valid, pricing: { ...pricing, inputPerMillion: Number.NaN } },
    },
    {
      name: "outputPerMillion Infinity",
      settings: { ...valid, pricing: { ...pricing, outputPerMillion: Number.POSITIVE_INFINITY } },
    },
    { name: "currency USD", settings: { ...valid, pricing: { ...pricing, currency: "USD" } } },
    {
      name: "currency mangler",
      settings: { ...valid, pricing: { inputPerMillion: 30, outputPerMillion: 150 } },
    },
    { name: "ekstra felt i pricing", settings: { ...valid, pricing: { ...pricing, rounding: 2 } } },
    { name: "ekstra felt baseUrl", settings: { ...valid, baseUrl: "https://example.com" } },
    { name: "ekstra felt apiKey", settings: { ...valid, apiKey: TEST_ANTHROPIC_KEY } },
    { name: "ekstra felt url", settings: { ...valid, url: "https://example.com" } },
  ])("2.2 avvist: $name", ({ settings }) => {
    expect(schema().safeParse(settings).success).toBe(false);
  });
});

describe("createConnection og updateConnection med anthropic (2.3)", () => {
  it("2.3 admin lager anthropic med secret_ref ANTHROPIC_API_KEY", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, anthropicInput());
    expect(created.provider).toBe("anthropic");
    expect(created.port).toBe("ai");
    expect(created.secretRef).toBe(SECRET_REF);
    expect(created.settings).toEqual(anthropicSettings());
    const rows = await aiConnections();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(org.id);
  });

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY", "ANTHROPIC_API_KEY_2"])(
    "2.3 annen secret_ref (%s) avvises uten rad",
    async (secretRef) => {
      const org = await createOrganization("Oppdiktet Takst A");
      const admin = await adminIn(org.id);
      vi.stubEnv(secretRef, "oppdiktet-annen-verdi");
      await expect(create(admin, org.id, anthropicInput({ secretRef }))).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await aiConnections()).toEqual([]);
    },
  );

  it("2.3 ugyldige settings avvises uten rad", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    await expect(
      create(
        admin,
        org.id,
        anthropicInput({ settings: anthropicSettings({ baseUrl: "https://example.com" }) }),
      ),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await aiConnections()).toEqual([]);
  });

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY"])(
    "2.3 updateConnection som bytter secret_ref til %s avvises, raden er uendret",
    async (secretRef) => {
      const org = await createOrganization("Oppdiktet Takst A");
      const admin = await adminIn(org.id);
      const created = await create(admin, org.id, anthropicInput());
      await expect(update(admin, org.id, created.id, { secretRef })).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      const [row] = await aiConnections();
      expect(row!.secretRef).toBe(SECRET_REF);
    },
  );

  it("2.3 updateConnection som fjerner secret_ref avvises", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, anthropicInput());
    await expect(update(admin, org.id, created.id, { secretRef: null })).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
    const [row] = await aiConnections();
    expect(row!.secretRef).toBe(SECRET_REF);
  });

  it("2.3 updateConnection med gyldige nye settings godtas; ugyldige avvises", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, anthropicInput());
    const changed = await update(admin, org.id, created.id, {
      settings: anthropicSettings({ features: [] }),
    });
    expect(changed.settings.features).toEqual([]);
    await expect(
      update(admin, org.id, created.id, {
        settings: anthropicSettings({ url: "https://example.com" }),
      }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
  });
});

describe("hemmeligheten (2.4–2.5)", () => {
  it("2.4 ANTHROPIC_API_KEY står ikke på nektlisten", () => {
    expect(isValidSecretRef(SECRET_REF)).toBe(true);
  });

  it("2.5 listen over tilkoblinger viser aldri nøkkelens verdi", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    await create(admin, org.id, anthropicInput());
    const listed = await listConnections(admin, org.id);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(TEST_ANTHROPIC_KEY);
    const audit = await db.execute(sql`select * from audit_log`);
    expect(JSON.stringify(audit)).not.toContain(TEST_ANTHROPIC_KEY);
  });
});

describe("tilgang per rolle (2.6)", () => {
  it.each([
    { role: "inspector" as const },
    { role: "office" as const },
    { role: "manager" as const },
  ])(
    "2.6 $role får AccessDeniedError på createConnection med anthropic, ingen rad",
    async ({ role }) => {
      const org = await createOrganization("Oppdiktet Takst A");
      const actor = await personIn(org.id, [role], `Test ${role}`);
      await expect(create(actor, org.id, anthropicInput())).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      expect(await aiConnections()).toEqual([]);
    },
  );

  it("2.6 admin uten andre roller lykkes (regel 11, admin stenges aldri ute)", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await personIn(org.id, ["admin"], "Test Admin Alene");
    const created = await create(admin, org.id, anthropicInput());
    expect(created.provider).toBe("anthropic");
  });

  it("2.6 admin kan bytte fra fake til anthropic: slette fake mykt og lage anthropic", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(org.id);
    await createIntegrationConnection(org.id, {
      port: "ai",
      provider: "fake",
      deletedAt: new Date("2026-11-01T10:00:00Z"),
    });
    const created = await create(admin, org.id, anthropicInput());
    expect(created.provider).toBe("anthropic");
  });
});

describe("tenant-isolasjon for createConnection med anthropic (2.7)", () => {
  it("2.7 query lager tilkoblingen bare i egen organisasjon; fremmed id nektes", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] }),
      query: async (actor, organizationId) => {
        const created = await create(actor, organizationId, anthropicInput());
        const [row] = await db
          .select({ organizationId: integrationConnections.organizationId })
          .from(integrationConnections)
          .where(eq(integrationConnections.id, created.id));
        return row ? [{ id: row.organizationId }] : [];
      },
      idOf: (row) => row.id,
    });

    const rows = await aiConnections();
    expect(rows).toHaveLength(2);
    const orgIds = new Set(rows.map((row) => row.organizationId));
    expect(orgIds.size).toBe(2);
    for (const organizationId of orgIds) {
      const own = await db
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, organizationId),
            eq(integrationConnections.port, "ai"),
          ),
        );
      expect(own).toHaveLength(1);
      expect(own[0]!.provider).toBe("anthropic");
    }
  });
});
