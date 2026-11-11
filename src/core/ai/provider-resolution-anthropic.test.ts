import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as secrets from "@/core/integrations/secrets";
import {
  aiRowCount,
  anthropicSettings,
  employeeWithGrant,
  enableAi,
  FAKE_ANTHROPIC_KEY,
  fakeAiProvider,
  TEST_MODEL,
} from "../../../tests/ai";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import { resolveAiProvider } from "./provider-resolution";

/*
 * Låsene for den ekte leverandøren (docs/funksjoner/fase2a-ki-leverandor-testplan.md 3.1, R1 og
 * R5). `anthropic` er på bare når alle låsene er på plass. Adapteren byttes ut med en stub her,
 * så testene prøver låsene uavhengig av kroppen i adapteren, og intet nettkall kan skje.
 * Nøkkelen og modellen er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen, trygt: ekte leverandør er bare på når alle låser er på plass.
 */

const adapter = vi.hoisted(() => ({
  create: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/core/ai/providers/anthropic", () => ({
  ANTHROPIC_PROVIDER_CODE: "anthropic",
  createAnthropicProvider: (options: { model: string; apiKey: string }) => {
    adapter.create(options);
    return { code: "anthropic", model: options.model, complete: adapter.complete };
  },
}));

const SECRET = "ANTHROPIC_API_KEY";

type Setup = (organizationId: string) => Promise<void>;

async function anthropicConnection(
  organizationId: string,
  options: Parameters<typeof enableAi>[1] = {},
) {
  await enableAi(organizationId, {
    provider: "anthropic",
    settings: anthropicSettings(),
    secretRef: SECRET,
    ...options,
  });
}

const { pricing: _pricing, ...settingsWithoutPricing } = anthropicSettings();
const { model: _model, ...settingsWithoutModel } = anthropicSettings();
void _pricing;
void _model;

const lockCases: { name: string; setup: Setup; key?: string | null }[] = [
  {
    name: "ai.enabled mangler",
    setup: (id) => anthropicConnection(id, { enabled: undefined }),
  },
  { name: "ai.enabled = false", setup: (id) => anthropicConnection(id, { enabled: false }) },
  { name: 'ai.enabled = "true"', setup: (id) => anthropicConnection(id, { enabled: "true" }) },
  { name: "ingen tilkobling", setup: (id) => anthropicConnection(id, { connection: false }) },
  {
    name: "tilkoblingen er slettet mykt",
    setup: (id) => anthropicConnection(id, { deletedAt: new Date("2026-11-01T10:00:00Z") }),
  },
  {
    name: "tilkoblingen har status disabled",
    setup: (id) => anthropicConnection(id, { status: "disabled" }),
  },
  {
    name: "ukjent leverandørkode",
    setup: (id) => anthropicConnection(id, { provider: "unknown_vendor" }),
  },
  {
    name: "model mangler",
    setup: (id) => anthropicConnection(id, { settings: settingsWithoutModel }),
  },
  {
    name: "model er tom",
    setup: (id) => anthropicConnection(id, { settings: anthropicSettings({ model: "" }) }),
  },
  {
    name: "pricing mangler",
    setup: (id) => anthropicConnection(id, { settings: settingsWithoutPricing }),
  },
  {
    name: "pricing er ugyldig (negativ)",
    setup: (id) =>
      anthropicConnection(id, {
        settings: anthropicSettings({
          pricing: { inputPerMillion: -1, outputPerMillion: 150, currency: "NOK" },
        }),
      }),
  },
  {
    name: "ekstra felt baseUrl i settings",
    setup: (id) =>
      anthropicConnection(id, {
        settings: anthropicSettings({ baseUrl: "https://oppdiktet.example" }),
      }),
  },
  {
    name: "features = null (rå rad)",
    setup: (id) => anthropicConnection(id, { settings: anthropicSettings({ features: null }) }),
  },
  {
    name: "secret_ref er en annen gyldig hemmelighet",
    setup: (id) => anthropicConnection(id, { secretRef: "MS_GRAPH_CLIENT_SECRET" }),
  },
  { name: "secret_ref mangler", setup: (id) => anthropicConnection(id, { secretRef: null }) },
  {
    name: "secret_ref på nektlisten (DATABASE_URL)",
    setup: (id) => anthropicConnection(id, { secretRef: "DATABASE_URL" }),
  },
  { name: "nøkkelen finnes ikke", setup: (id) => anthropicConnection(id), key: null },
  { name: 'nøkkelen er ""', setup: (id) => anthropicConnection(id), key: "" },
  { name: "nøkkelen er bare mellomrom", setup: (id) => anthropicConnection(id), key: "   " },
  {
    name: "nøkkelen er en uhentet referanse til nøkkelboksen",
    setup: (id) => anthropicConnection(id),
    key: "@Microsoft.KeyVault(SecretUri=https://oppdiktet.vault.azure.net/secrets/x/)",
  },
];

beforeEach(async () => {
  await resetDatabase();
  adapter.create.mockClear();
  adapter.complete.mockReset();
  vi.stubEnv(SECRET, FAKE_ANTHROPIC_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("valg av leverandør: låsene for anthropic (R1)", () => {
  it.each(lockCases)("$name gir disabled, uten adapter og uten lekkasje", async (testCase) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await testCase.setup(organization.id);
    if (testCase.key === null) vi.stubEnv(SECRET, undefined);
    else if (testCase.key !== undefined) vi.stubEnv(SECRET, testCase.key);
    const { grant } = await employeeWithGrant(organization.id);
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    const resolved = await resolveAiProvider(grant);

    expect(resolved).toEqual({ kind: "disabled" });
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    const logged = JSON.stringify(consoleSpies.map((spy) => spy.mock.calls));
    expect(logged).not.toContain(FAKE_ANTHROPIC_KEY);
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(resolved)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it.each(["active", "error"])(
    "alt på plass (status %s) gir enabled med modell og features fra innstillingene",
    async (status) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      await anthropicConnection(organization.id, { status });
      const { grant } = await employeeWithGrant(organization.id);

      const resolved = await resolveAiProvider(grant);

      expect(resolved.kind).toBe("enabled");
      if (resolved.kind !== "enabled") return;
      expect(resolved.provider.code).toBe("anthropic");
      expect(resolved.model).toBe(TEST_MODEL);
      expect(resolved.features).toEqual(["language_polish"]);
      // Det validerte resultatet fra skjemaet går rett til adapteren, nøkkelen fra hemmeligheten
      expect(adapter.create).toHaveBeenCalledTimes(1);
      expect(adapter.create).toHaveBeenCalledWith({
        model: TEST_MODEL,
        apiKey: FAKE_ANTHROPIC_KEY,
        pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" },
      });
      expect(JSON.stringify(resolved)).not.toContain(FAKE_ANTHROPIC_KEY);
    },
  );

  it("manglende features gir tom liste, aldri null", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const { features: _features, ...withoutFeatures } = anthropicSettings();
    void _features;
    await anthropicConnection(organization.id, { settings: withoutFeatures });
    const { grant } = await employeeWithGrant(organization.id);

    const resolved = await resolveAiProvider(grant);

    expect(resolved.kind).toBe("enabled");
    if (resolved.kind !== "enabled") return;
    expect(resolved.features).toEqual([]);
    expect(resolved.features).not.toBeNull();
  });

  it("readSecret kalles bare med ANTHROPIC_API_KEY, aldri med en annen verdi fra raden", async () => {
    const readSecret = vi.spyOn(secrets, "readSecret");
    const a = await createOrganization("Oppdiktet Takst A");
    await anthropicConnection(a.id, { secretRef: "MS_GRAPH_CLIENT_SECRET" });
    const b = await createOrganization("Oppdiktet Takst B");
    await anthropicConnection(b.id);

    await resolveAiProvider((await employeeWithGrant(a.id)).grant);
    await resolveAiProvider((await employeeWithGrant(b.id)).grant);

    expect(readSecret).toHaveBeenCalledTimes(1);
    for (const call of readSecret.mock.calls) expect(call[0]).toBe(SECRET);
  });
});

describe("valg av leverandør: fake som før, miljøet velger aldri (R5, A160)", () => {
  it("fake gir samme faste objekt og features = null", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);

    const resolved = await resolveAiProvider(grant);

    expect(resolved.kind).toBe("enabled");
    if (resolved.kind !== "enabled") return;
    expect(resolved.provider).toBe(fakeAiProvider);
    expect(resolved.features).toBeNull();
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("nøkkel og NODE_ENV=production uten tilkobling gir disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id, { connection: false });
    const { grant } = await employeeWithGrant(organization.id);

    expect(await resolveAiProvider(grant)).toEqual({ kind: "disabled" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("nøkkel satt og bare fake-tilkobling gir fake", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);

    const resolved = await resolveAiProvider(grant);

    expect(resolved.kind === "enabled" && resolved.provider.code).toBe("fake");
    expect(adapter.create).not.toHaveBeenCalled();
  });
});
