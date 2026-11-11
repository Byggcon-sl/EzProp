import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeGrant } from "@/core/access";
import { readSecret } from "@/core/integrations/secrets";
import {
  aiRowCount,
  anthropicSettings,
  ANTHROPIC_TEST_PRICING,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  fakeAiProvider,
  mergeOrganizationSettings,
} from "../../../tests/ai";
import { fakeAnthropicFetch, TEST_ANTHROPIC_KEY, TEST_MODEL } from "../../../tests/fake-anthropic";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import { resolveAiProvider, type ResolvedAiProvider } from "./provider-resolution";

/*
 * Låsene for den ekte leverandøren i `resolveAiProvider` (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md avsnitt 3.1, kortet Omfang 5, R1 og R5). Én lås mangler om gangen, alt annet er på
 * plass. Mot testdatabasen; rå rader legges inn forbi skjemaet. Ingen nettkall: `fetch` er falsk
 * og skal aldri bli kalt her. Nøkkelen er oppdiktet og settes med `vi.stubEnv`.
 *
 * Støtter hovedmål: KI i bunnen (den ekte leverandøren slås bare på når alle låsene er på plass,
 * og en feil innstilling i miljøet sender aldri data ut).
 */

const SECRET_NAME = "ANTHROPIC_API_KEY";

// Spion på hemmelighetene: kaller den ekte funksjonen, men registrerer navnet
vi.mock("@/core/integrations/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/integrations/secrets")>();
  return { ...actual, readSecret: vi.fn(actual.readSecret) };
});

let fetchCalls: unknown[] = [];

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(readSecret).mockClear();
  const fake = fakeAnthropicFetch({ kind: "ok" });
  fetchCalls = fake.calls;
  vi.stubGlobal("fetch", fake.fetchFn);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
}

async function inspectorIn(organizationId: string): Promise<EmployeeGrant> {
  return (await employeeWithGrant(organizationId, ["inspector"])).grant;
}

type Setup = (organizationId: string) => Promise<void>;

const allInPlace: Setup = async (id) => {
  vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
  await enableAnthropic(id);
};

const lockCases: { name: string; setup: Setup }[] = [
  {
    name: "ai.enabled mangler",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { enabled: undefined });
    },
  },
  {
    name: "ai.enabled = false",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { enabled: false });
    },
  },
  {
    name: 'ai.enabled = "true" (tekst)',
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { enabled: "true" });
    },
  },
  {
    name: "ingen tilkobling",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAi(id, { connection: false });
    },
  },
  {
    name: "tilkoblingen er slettet mykt",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { deletedAt: new Date("2026-11-01T10:00:00Z") });
    },
  },
  {
    name: "tilkoblingen har status disabled",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { status: "disabled" });
    },
  },
  {
    name: "ukjent leverandørkode med ellers gyldig oppsett",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAi(id, {
        provider: "unknown_vendor",
        settings: anthropicSettings(),
        secretRef: SECRET_NAME,
      });
    },
  },
  {
    name: "model mangler (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      const { model: _m, ...rest } = anthropicSettings();
      void _m;
      await enableAnthropic(id, { settings: rest });
    },
  },
  {
    name: "model er tom (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { settings: anthropicSettings({ model: "" }) });
    },
  },
  {
    name: "pricing mangler (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      const { pricing: _p, ...rest } = anthropicSettings();
      void _p;
      await enableAnthropic(id, { settings: rest });
    },
  },
  {
    name: "pricing er ugyldig (negativ, rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, {
        settings: anthropicSettings({
          pricing: { ...ANTHROPIC_TEST_PRICING, inputPerMillion: -1 },
        }),
      });
    },
  },
  {
    name: "pricing har annen valuta (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, {
        settings: anthropicSettings({ pricing: { ...ANTHROPIC_TEST_PRICING, currency: "USD" } }),
      });
    },
  },
  {
    name: "ekstra felt baseUrl i settings (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, {
        settings: anthropicSettings({ baseUrl: "https://example.invalid/" }),
      });
    },
  },
  {
    name: "secret_ref er en annen gyldig hemmelighet (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      vi.stubEnv("MS_GRAPH_CLIENT_SECRET", TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { secretRef: "MS_GRAPH_CLIENT_SECRET" });
    },
  },
  {
    name: "secret_ref mangler (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { secretRef: null });
    },
  },
  {
    name: "secret_ref står på nektlisten, DATABASE_URL (rå rad)",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(id, { secretRef: "DATABASE_URL" });
    },
  },
  {
    name: "nøkkelen finnes ikke i miljøet",
    setup: async (id) => {
      await enableAnthropic(id);
    },
  },
  {
    name: 'nøkkelen er ""',
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, "");
      await enableAnthropic(id);
    },
  },
  {
    name: "nøkkelen er bare mellomrom",
    setup: async (id) => {
      vi.stubEnv(SECRET_NAME, "   \t ");
      await enableAnthropic(id);
    },
  },
];

describe("resolveAiProvider: låsene for anthropic (3.1, R1)", () => {
  it.each(lockCases)("$name gir disabled, uten kall, rad eller lekkasje", async ({ setup }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await setup(organization.id);
    const grant = await inspectorIn(organization.id);
    const spies = consoleSpies();

    let result: ResolvedAiProvider | undefined;
    let thrown: unknown;
    try {
      result = await resolveAiProvider(grant);
    } catch (error) {
      thrown = error;
    }

    expect(thrown, String(thrown)).toBeUndefined();
    expect(result).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(fetchCalls).toHaveLength(0);
    const seen = [inspect(result, { depth: 8 }), ...spies.map((s) => inspect(s.mock.calls))].join(
      "\n",
    );
    expect(seen).not.toContain(TEST_ANTHROPIC_KEY);
    expect(seen).not.toContain(SECRET_NAME);
  });

  it.each(["active", "error"])(
    "alt på plass med status %s gir enabled med anthropic, modell og features",
    async (status) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
      await enableAnthropic(organization.id, { status });
      const grant = await inspectorIn(organization.id);

      const result = await resolveAiProvider(grant);

      expect(result.kind).toBe("enabled");
      if (result.kind !== "enabled") return;
      expect(result.provider.code).toBe("anthropic");
      expect(result.provider.model).toBe(TEST_MODEL);
      expect(result.model).toBe(TEST_MODEL);
      expect(result.features).toEqual(["language_polish"]);
      expect(fetchCalls).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(TEST_ANTHROPIC_KEY);
      expect(inspect(result, { depth: 8 })).not.toContain(TEST_ANTHROPIC_KEY);
    },
  );

  it("adapteren fra resolveAiProvider sender nøkkelen fra miljøet og modellen fra raden", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await allInPlace(organization.id);
    const grant = await inspectorIn(organization.id);
    const result = await resolveAiProvider(grant);
    if (result.kind !== "enabled") throw new Error("ventet enabled");
    const fake = fakeAnthropicFetch({ kind: "ok" });
    vi.stubGlobal("fetch", fake.fetchFn);
    await result.provider.complete({
      feature: "language_polish",
      promptVersion: "language_polish.v2",
      prompt: "Oppdiktet ledetekst",
      model: result.model,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.headers["x-api-key"]).toBe(TEST_ANTHROPIC_KEY);
    expect((JSON.parse(fake.calls[0]!.body) as { model: string }).model).toBe(TEST_MODEL);
  });

  it("R5 fake som før: samme objekt og features = null", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const grant = await inspectorIn(organization.id);
    const result = await resolveAiProvider(grant);
    expect(result.kind).toBe("enabled");
    if (result.kind !== "enabled") return;
    expect(result.provider).toBe(fakeAiProvider);
    expect(result.features).toBeNull();
  });

  it("3.1.3 miljøet velger aldri: nøkkel og NODE_ENV=production uten tilkobling gir disabled", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    vi.stubEnv("NODE_ENV", "production");
    await enableAi(organization.id, { connection: false });
    const grant = await inspectorIn(organization.id);
    expect(await resolveAiProvider(grant)).toEqual({ kind: "disabled" });
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("3.1.3 miljøet velger aldri: nøkkel satt og bare fake-tilkobling gir fake", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    vi.stubEnv("NODE_ENV", "production");
    await enableAi(organization.id);
    const grant = await inspectorIn(organization.id);
    const result = await resolveAiProvider(grant);
    expect(result.kind === "enabled" && result.provider).toBe(fakeAiProvider);
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("3.1.4 readSecret kalles bare med ANTHROPIC_API_KEY, aldri med verdien fra raden", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    await enableAnthropic(organization.id);
    const grant = await inspectorIn(organization.id);
    await resolveAiProvider(grant);
    expect(vi.mocked(readSecret).mock.calls.map((call) => call[0])).toEqual([SECRET_NAME]);

    // Raden peker på en annen hemmelighet: den leses aldri
    const other = await createOrganization("Oppdiktet Takst B");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "oppdiktet-verdi");
    await enableAnthropic(other.id, { secretRef: "MS_GRAPH_CLIENT_SECRET" });
    const otherGrant = await inspectorIn(other.id);
    vi.mocked(readSecret).mockClear();
    expect(await resolveAiProvider(otherGrant)).toEqual({ kind: "disabled" });
    for (const call of vi.mocked(readSecret).mock.calls) expect(call[0]).toBe(SECRET_NAME);
  });

  it.each([
    { name: "features: null", settings: anthropicSettings({ features: null }) },
    {
      name: "uten features",
      settings: (() => {
        const { features: _f, ...rest } = anthropicSettings();
        void _f;
        return rest;
      })(),
    },
  ])("3.1.5 rå rad med anthropic og $name gir aldri features = null", async ({ settings }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    await enableAnthropic(organization.id, { settings });
    const grant = await inspectorIn(organization.id);
    const result = await resolveAiProvider(grant);
    if (result.kind === "enabled") {
      expect(result.features).not.toBeNull();
      expect(result.features).toEqual([]);
    } else {
      expect(result).toEqual({ kind: "disabled" });
    }
  });

  it("tilkoblingen hentes bare med grant.organizationId (A har anthropic, B har ingenting)", async () => {
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    const a = await createOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    await enableAnthropic(a.id);
    await mergeOrganizationSettings(b.id, { "ai.enabled": true });
    expect(await resolveAiProvider(await inspectorIn(b.id))).toEqual({ kind: "disabled" });
    expect((await resolveAiProvider(await inspectorIn(a.id))).kind).toBe("enabled");
  });
});
