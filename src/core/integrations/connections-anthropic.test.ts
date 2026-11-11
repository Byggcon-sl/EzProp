import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { integrationConnections, organizations, type EmployeeRole } from "@/db/schema";
import {
  ANTHROPIC_TEST_KEY,
  ANTHROPIC_TEST_SECRET_REF,
  anthropicSettings,
} from "../../../tests/ai";
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
 * avsnitt 2, kortet Omfang 2 og 3). Mot testdatabasen. Alle verdier er oppdiktet, og nøkkelen
 * settes bare med `vi.stubEnv`.
 *
 * Støtter hovedmål: KI i bunnen (bare en gyldig, streng konfigurasjon kan lagres, og den kan bare
 * peke på én hemmelighet) og færre reklamasjoner (en annen organisasjon kan aldri lage eller se
 * tilkoblingen).
 */

const ANTHROPIC_INPUT = {
  port: "ai",
  provider: "anthropic",
  secretRef: ANTHROPIC_TEST_SECRET_REF,
  settings: anthropicSettings(),
};

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
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

async function aiRows(organizationId?: string) {
  const rows = await db.select().from(integrationConnections);
  return organizationId ? rows.filter((row) => row.organizationId === organizationId) : rows;
}

async function adminIn(organizationId: string, roles: EmployeeRole[] = ["admin"]) {
  const user = await createUser({ name: "Admin Oppdiktet" });
  await createEmployee(user, organizationId, roles);
  return user;
}

describe("2.1 anthropic er kjent på porten ai", () => {
  it("står i PROVIDERS_BY_PORT.ai sammen med fake", () => {
    expect(PROVIDERS_BY_PORT.ai).toContain("anthropic");
    expect(PROVIDERS_BY_PORT.ai).toContain("fake");
  });

  it("krever navnet på en hemmelighet: uten secretRef avvises, ingen rad", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const { secretRef: _omit, ...withoutSecret } = ANTHROPIC_INPUT;
    await expect(create(admin, org.id, withoutSecret)).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
    expect(await aiRows()).toHaveLength(0);
  });

  it("ukjent kode på ai avvises som før", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    await expect(
      create(admin, org.id, { ...ANTHROPIC_INPUT, provider: "unknown_vendor" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await aiRows()).toHaveLength(0);
  });

  it("anthropic på en annen port avvises", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    await expect(
      create(admin, org.id, { ...ANTHROPIC_INPUT, port: "email" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
  });
});

describe("2.2 skjemaet for settings (regler som data)", () => {
  const schema = settingsSchemaFor("anthropic");
  const valid = anthropicSettings();
  const pricing = valid.pricing as Record<string, unknown>;
  const withPricing = (patch: Record<string, unknown>) =>
    anthropicSettings({ pricing: { ...pricing, ...patch } });
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  it.each<[string, Record<string, unknown>, unknown]>([
    ["gyldige innstillinger", valid, ["language_polish"]],
    ["features mangler (blir tom liste)", without("features"), []],
    ["features: []", anthropicSettings({ features: [] }), []],
  ])("godtatt: %s", (_name, settings, features) => {
    const parsed = schema.safeParse(settings);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.features).toEqual(features);
  });

  it.each<[string, Record<string, unknown>]>([
    ["model mangler", without("model")],
    ["model tom", anthropicSettings({ model: "" })],
    ["model med mellomrom", anthropicSettings({ model: "MERKE MODELL" })],
    ["model med /", anthropicSettings({ model: "MERKE/MODELL" })],
    ["model over 100 tegn", anthropicSettings({ model: "M".repeat(101) })],
    ["model er tall", anthropicSettings({ model: 7 })],
    ["features med ukjent kode", anthropicSettings({ features: ["phrase_suggestion"] })],
    ["features er ikke liste", anthropicSettings({ features: "language_polish" })],
    ["pricing mangler", without("pricing")],
    ["inputPerMillion negativ", withPricing({ inputPerMillion: -1 })],
    ["inputPerMillion tekst", withPricing({ inputPerMillion: "30" })],
    ["inputPerMillion NaN", withPricing({ inputPerMillion: Number.NaN })],
    ["inputPerMillion uendelig", withPricing({ inputPerMillion: Number.POSITIVE_INFINITY })],
    ["outputPerMillion negativ", withPricing({ outputPerMillion: -0.01 })],
    [
      "outputPerMillion mangler",
      anthropicSettings({ pricing: { inputPerMillion: 1, currency: "NOK" } }),
    ],
    ["currency USD", withPricing({ currency: "USD" })],
    ["ekstra felt i pricing", withPricing({ vat: 25 })],
    ["ekstra felt baseUrl", anthropicSettings({ baseUrl: "https://example.invalid" })],
    ["ekstra felt apiKey", anthropicSettings({ apiKey: ANTHROPIC_TEST_KEY })],
    ["ekstra felt url", anthropicSettings({ url: "https://example.invalid" })],
  ])("avvist: %s", (_name, settings) => {
    expect(schema.safeParse(settings).success).toBe(false);
  });

  it("modell med punktum, kolon, bindestrek og understrek på 100 tegn godtas", () => {
    const model = `A.b:c-d_${"9".repeat(92)}`;
    expect(model).toHaveLength(100);
    expect(schema.safeParse(anthropicSettings({ model })).success).toBe(true);
  });

  it("pris 0 godtas", () => {
    expect(schema.safeParse(withPricing({ inputPerMillion: 0, outputPerMillion: 0 })).success).toBe(
      true,
    );
  });

  it("createConnection med ugyldige settings gir ingen rad", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    await expect(
      create(admin, org.id, {
        ...ANTHROPIC_INPUT,
        settings: anthropicSettings({ baseUrl: "https://example.invalid" }),
      }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await aiRows()).toHaveLength(0);
  });
});

describe("2.3 secret_ref for anthropic må være ANTHROPIC_API_KEY", () => {
  it("admin lager tilkoblingen med ANTHROPIC_API_KEY: rad med lagrede settings", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, ANTHROPIC_INPUT);
    expect(created).toMatchObject({
      port: "ai",
      provider: "anthropic",
      status: "active",
      secretRef: "ANTHROPIC_API_KEY",
      settings: anthropicSettings(),
    });
  });

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY", "ANTHROPIC_API_KEY_2"])(
    "createConnection med secretRef %s avvises, ingen rad",
    async (secretRef) => {
      vi.stubEnv(secretRef, "oppdiktet-annen-verdi");
      const org = await createOrganization("Organisasjon A");
      const admin = await adminIn(org.id);
      await expect(create(admin, org.id, { ...ANTHROPIC_INPUT, secretRef })).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await aiRows()).toHaveLength(0);
    },
  );

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY"])(
    "updateConnection som bytter secretRef til %s avvises; raden er uendret",
    async (secretRef) => {
      const org = await createOrganization("Organisasjon A");
      const admin = await adminIn(org.id);
      const created = await create(admin, org.id, ANTHROPIC_INPUT);
      await expect(update(admin, org.id, created.id, { secretRef })).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      const [row] = await aiRows(org.id);
      expect(row!.secretRef).toBe("ANTHROPIC_API_KEY");
    },
  );

  it("updateConnection som fjerner secretRef avvises", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, ANTHROPIC_INPUT);
    await expect(update(admin, org.id, created.id, { secretRef: null })).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
  });

  it("updateConnection med samme secretRef og nye gyldige settings går gjennom", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, ANTHROPIC_INPUT);
    const updated = await update(admin, org.id, created.id, {
      secretRef: "ANTHROPIC_API_KEY",
      settings: anthropicSettings({ features: [] }),
    });
    expect(updated.settings).toEqual(anthropicSettings({ features: [] }));
  });

  it("updateConnection med ugyldige settings (baseUrl) avvises", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, ANTHROPIC_INPUT);
    await expect(
      update(admin, org.id, created.id, {
        settings: anthropicSettings({ baseUrl: "https://example.invalid" }),
      }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
  });

  it("andre leverandører kan fortsatt bruke andre hemmeligheter (microsoft365)", async () => {
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "oppdiktet-verdi");
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    const created = await create(admin, org.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" },
    });
    expect(created.secretRef).toBe("MS_GRAPH_CLIENT_SECRET");
  });
});

describe("2.4 ANTHROPIC_API_KEY står ikke på nektlisten", () => {
  it("isValidSecretRef gir true", () => {
    expect(isValidSecretRef("ANTHROPIC_API_KEY")).toBe(true);
  });
});

describe("2.5 listen viser aldri nøkkelens verdi", () => {
  it("listConnections med nøkkelen i miljøet: verdien finnes ikke i svaret", async () => {
    const org = await createOrganization("Organisasjon A");
    const admin = await adminIn(org.id);
    await create(admin, org.id, ANTHROPIC_INPUT);
    const list = await listConnections(admin, org.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(ANTHROPIC_TEST_KEY);
    expect(list[0]!.secretRef).toBe("ANTHROPIC_API_KEY");
  });
});

describe("2.6 tilgang per rolle", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager"])(
    "%s får AccessDeniedError på createConnection med anthropic, ingen rad",
    async (role) => {
      const org = await createOrganization("Organisasjon A");
      const user = await adminIn(org.id, [role]);
      await expect(create(user, org.id, ANTHROPIC_INPUT)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await aiRows()).toHaveLength(0);
    },
  );

  // Regel 11. Denne testen skal aldri fjernes: admin må alltid kunne lage tilkoblingen.
  it("admin uten andre roller lykkes, også med access.inspectors_edit_all = false", async () => {
    const org = await createOrganization("Organisasjon A");
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const admin = await adminIn(org.id, ["admin"]);
    const created = await create(admin, org.id, ANTHROPIC_INPUT);
    expect(created.provider).toBe("anthropic");
  });
});

describe("2.7 tenant-isolasjon for createConnection med anthropic (regel 2)", () => {
  it("raden havner alltid i organisasjonen fra tilgangssjekken, og fremmed organisasjon nektes", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        // En e-posttilkobling i hver, så hver side har egne rader fra før
        const a = await createIntegrationConnection(grantA.organizationId);
        const b = await createIntegrationConnection(grantB.organizationId);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
        const created = await create(actor, organizationId, ANTHROPIC_INPUT);
        const own = await db
          .select({ id: integrationConnections.id })
          .from(integrationConnections)
          .where(eq(integrationConnections.organizationId, grant.organizationId));
        expect(own.map((row) => row.id)).toContain(created.id);
        return own;
      },
      idOf: (row) => row.id,
    });

    // Hver organisasjon har nøyaktig én ai-tilkobling, med egen organisasjons-id
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const { id } of orgs) {
      const rows = await db
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, id),
            eq(integrationConnections.port, "ai"),
            isNull(integrationConnections.deletedAt),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.organizationId).toBe(id);
      expect(rows[0]!.provider).toBe("anthropic");
    }
  });
});
