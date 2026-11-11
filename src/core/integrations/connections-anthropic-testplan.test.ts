import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { integrationConnections, type EmployeeRole } from "@/db/schema";
import { anthropicSettings } from "../../../tests/ai";
import { TEST_ANTHROPIC_KEY } from "../../../tests/fake-anthropic";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { REQUIRED_SECRET_REF_BY_PROVIDER, settingsSchemaFor } from "./connections";
import {
  ConnectionValidationError,
  createConnection,
  listConnections,
  updateConnection,
  type CreateConnectionInput,
} from "./index";
import { PROVIDERS_BY_PORT } from "./ports";
import { isValidSecretRef } from "./secrets";

/*
 * Tilkoblingen `anthropic` på porten `ai` (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * avsnitt 2, kortet Omfang 2 og 3, A193). Mot testdatabasen. Alle verdier er oppdiktet; nøkkelen
 * settes bare med `vi.stubEnv`.
 *
 * Støtter hovedmål: KI i bunnen (tilkoblingen kan bare peke på den ene nøkkelen, og nøkkelen kan
 * aldri sendes til en annen leverandør) og de ansatte (admin stenges aldri ute).
 */

const SECRET_NAME = "ANTHROPIC_API_KEY";
const ANTHROPIC_INPUT = {
  port: "ai",
  provider: "anthropic",
  secretRef: SECRET_NAME,
  settings: anthropicSettings(),
};
const M365 = { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" };

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function create(actor: Actor, organizationId: string, input: Record<string, unknown>) {
  return createConnection(actor, organizationId, input as unknown as CreateConnectionInput);
}

async function adminIn(organizationId: string, roles: EmployeeRole[] = ["admin"]) {
  const actor = await createUser({ name: `Test ${roles.join(" ")}` });
  await createEmployee(actor, organizationId, roles);
  return actor;
}

async function aiRows(organizationId: string) {
  return db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.port, "ai"),
      ),
    );
}

async function expectRejected(call: () => Promise<unknown>) {
  let error: unknown;
  try {
    await call();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ConnectionValidationError);
}

describe("leverandøren anthropic på porten ai (2.1)", () => {
  it("anthropic er kjent på porten ai, og det navnet på hemmeligheten er fast", () => {
    expect(PROVIDERS_BY_PORT.ai).toContain("anthropic");
    expect(REQUIRED_SECRET_REF_BY_PROVIDER.anthropic).toBe(SECRET_NAME);
  });

  it("anthropic krever hemmelighet: uten secretRef avvises, ingen rad", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    const { secretRef: _omit, ...withoutSecret } = ANTHROPIC_INPUT;
    void _omit;
    await expectRejected(() => create(admin, organization.id, withoutSecret));
    expect(await aiRows(organization.id)).toHaveLength(0);
  });

  it("ukjent kode på ai avvises som før", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    await expectRejected(() =>
      create(admin, organization.id, { ...ANTHROPIC_INPUT, provider: "unknown_vendor" }),
    );
    expect(await aiRows(organization.id)).toHaveLength(0);
  });
});

describe("skjemaet for settings (2.2, regler som data)", () => {
  const schema = settingsSchemaFor("anthropic");
  const valid = anthropicSettings() as Record<string, unknown>;
  const pricing = valid.pricing as Record<string, unknown>;

  it.each([
    { name: "gyldige innstillinger", input: valid, features: ["language_polish"] },
    {
      name: "features mangler (blir tom liste)",
      input: { model: valid.model, pricing },
      features: [],
    },
    { name: "features er tom liste", input: { ...valid, features: [] }, features: [] },
  ])("godtatt: $name", ({ input, features }) => {
    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.features).toEqual(features);
  });

  it.each([
    { name: "model mangler", input: { features: [], pricing } },
    { name: 'model er ""', input: { ...valid, model: "" } },
    { name: "model med mellomrom", input: { ...valid, model: "MERKE MODELL" } },
    { name: "model med /", input: { ...valid, model: "MERKE/MODELL" } },
    { name: "model over 100 tegn", input: { ...valid, model: "M".repeat(101) } },
    { name: "features med ukjent kode", input: { ...valid, features: ["phrase_suggestion"] } },
    { name: "pricing mangler", input: { model: valid.model, features: [] } },
    {
      name: "inputPerMillion negativ",
      input: { ...valid, pricing: { ...pricing, inputPerMillion: -1 } },
    },
    {
      name: "inputPerMillion som tekst",
      input: { ...valid, pricing: { ...pricing, inputPerMillion: "30" } },
    },
    {
      name: "inputPerMillion NaN",
      input: { ...valid, pricing: { ...pricing, inputPerMillion: Number.NaN } },
    },
    {
      name: "inputPerMillion Infinity",
      input: { ...valid, pricing: { ...pricing, inputPerMillion: Number.POSITIVE_INFINITY } },
    },
    {
      name: "outputPerMillion -Infinity",
      input: { ...valid, pricing: { ...pricing, outputPerMillion: Number.NEGATIVE_INFINITY } },
    },
    {
      name: "inputPerMillion 1e309",
      input: { ...valid, pricing: { ...pricing, inputPerMillion: 1e309 } },
    },
    {
      name: "currency annet enn NOK",
      input: { ...valid, pricing: { ...pricing, currency: "USD" } },
    },
    { name: "ekstra felt i pricing", input: { ...valid, pricing: { ...pricing, perRequest: 1 } } },
    { name: "ekstra felt baseUrl", input: { ...valid, baseUrl: "https://example.invalid/" } },
    { name: "ekstra felt apiKey", input: { ...valid, apiKey: TEST_ANTHROPIC_KEY } },
    { name: "ekstra felt url", input: { ...valid, url: "https://example.invalid/" } },
  ])("avvist: $name", ({ input }) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});

describe("createConnection og updateConnection med anthropic (2.3–2.5)", () => {
  it("2.3 admin kan lage anthropic med ANTHROPIC_API_KEY", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    const summary = await create(admin, organization.id, ANTHROPIC_INPUT);
    expect(summary.provider).toBe("anthropic");
    expect(summary.secretRef).toBe(SECRET_NAME);
    expect(summary.settings).toEqual(anthropicSettings());
    expect(await aiRows(organization.id)).toHaveLength(1);
  });

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY", "OPENAI_API_KEY"])(
    "2.3 anthropic med secret_ref %s avvises uten rad",
    async (secretRef) => {
      vi.stubEnv(secretRef, "oppdiktet-verdi");
      const organization = await createOrganization("Oppdiktet Takst A");
      const admin = await adminIn(organization.id);
      await expectRejected(() => create(admin, organization.id, { ...ANTHROPIC_INPUT, secretRef }));
      expect(await aiRows(organization.id)).toHaveLength(0);
    },
  );

  it.each(["MS_GRAPH_CLIENT_SECRET", "ANTHROPIC_KEY"])(
    "2.3 updateConnection som bytter secret_ref til %s avvises, raden er uendret",
    async (secretRef) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      const admin = await adminIn(organization.id);
      const summary = await create(admin, organization.id, ANTHROPIC_INPUT);
      await expectRejected(() =>
        updateConnection(admin, organization.id, summary.id, { secretRef }),
      );
      await expectRejected(() =>
        updateConnection(admin, organization.id, summary.id, { secretRef: null }),
      );
      const [row] = await aiRows(organization.id);
      expect(row!.secretRef).toBe(SECRET_NAME);
    },
  );

  it("2.3 updateConnection med gyldige nye settings godtas, ugyldige avvises", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    const summary = await create(admin, organization.id, ANTHROPIC_INPUT);
    const updated = await updateConnection(admin, organization.id, summary.id, {
      settings: anthropicSettings({ features: [] }),
    });
    expect(updated.settings).toMatchObject({ features: [] });
    await expectRejected(() =>
      updateConnection(admin, organization.id, summary.id, {
        settings: { ...anthropicSettings(), baseUrl: "https://example.invalid/" },
      }),
    );
  });

  it("2.3 motsatt lås: microsoft365 med ANTHROPIC_API_KEY avvises ved oppretting", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    await expectRejected(() =>
      create(admin, organization.id, {
        port: "email",
        provider: "microsoft365",
        secretRef: SECRET_NAME,
        settings: M365,
      }),
    );
    const [count] = (await db.execute(
      sql`select count(*)::int as n from integration_connections where organization_id = ${organization.id}`,
    )) as unknown as { n: number }[];
    expect(count!.n).toBe(0);
  });

  it("2.3 motsatt lås: microsoft365 som bytter til ANTHROPIC_API_KEY avvises ved endring", async () => {
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "oppdiktet-verdi");
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    const summary = await create(admin, organization.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });
    await expectRejected(() =>
      updateConnection(admin, organization.id, summary.id, { secretRef: SECRET_NAME }),
    );
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, summary.id));
    expect(row!.secretRef).toBe("MS_GRAPH_CLIENT_SECRET");
  });

  it("2.4 ANTHROPIC_API_KEY står ikke på nektlisten", () => {
    expect(isValidSecretRef(SECRET_NAME)).toBe(true);
  });

  it("2.5 listen over tilkoblinger viser aldri nøkkelens verdi", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id);
    await create(admin, organization.id, ANTHROPIC_INPUT);
    const list = await listConnections(admin, organization.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(TEST_ANTHROPIC_KEY);
    const audit = await db.execute(sql`select * from audit_log`);
    expect(JSON.stringify(audit)).not.toContain(TEST_ANTHROPIC_KEY);
  });
});

describe("tilgang per rolle (2.6)", () => {
  it.each([
    { name: "takstmann", roles: ["inspector"] as EmployeeRole[] },
    { name: "kontor", roles: ["office"] as EmployeeRole[] },
    { name: "leder", roles: ["manager"] as EmployeeRole[] },
  ])("$name får AccessDeniedError og ingen rad", async ({ roles }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const actor = await adminIn(organization.id, roles);
    let error: unknown;
    try {
      await create(actor, organization.id, ANTHROPIC_INPUT);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await aiRows(organization.id)).toHaveLength(0);
  });

  it("admin uten andre roller lykkes (regel 11, admin stenges aldri ute)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await adminIn(organization.id, ["admin"]);
    const grant = await requireOrganizationAccess(admin, organization.id);
    expect(grant.roles).toEqual(["admin"]);
    const summary = await create(admin, organization.id, ANTHROPIC_INPUT);
    expect(summary.provider).toBe("anthropic");
  });
});

describe("tenant-isolasjon for createConnection med anthropic (2.7)", () => {
  it("expectTenantIsolation: tilkoblingen havner bare i egen organisasjon", async () => {
    await expectTenantIsolation<{ id: string }>({
      seed: async (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] }),
      query: async (actor, organizationId) => {
        const summary = await create(actor, organizationId, ANTHROPIC_INPUT);
        const [row] = await db
          .select({ organizationId: integrationConnections.organizationId })
          .from(integrationConnections)
          .where(eq(integrationConnections.id, summary.id));
        return [{ id: row!.organizationId }];
      },
      idOf: (row) => row.id,
    });
    // Hver organisasjon har nøyaktig én aktiv ai-tilkobling, med egen organisasjons-id
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.port, "ai"), isNull(integrationConnections.deletedAt)));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.organizationId)).size).toBe(2);
  });
});
