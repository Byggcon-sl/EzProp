import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { readSecret } from "@/core/integrations/secrets";
import {
  ANTHROPIC_TEST_KEY,
  ANTHROPIC_TEST_MODEL,
  aiRowCount,
  allAiRows,
  auditCount,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  fakeAiProvider,
  mergeOrganizationSettings,
  requestSuggestion,
  stubAnthropicFetch,
  validRequest,
} from "../../../tests/ai";
import {
  createIntegrationConnection,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { resolveAiProvider } from "./provider-resolution";
import { fakeAiProvider as realFakeProvider } from "./providers/fake";

// Spion på `readSecret` som slipper kallet gjennom (testplanen for KI-leverandør 3.1.4)
vi.mock("@/core/integrations/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/integrations/secrets")>();
  return { ...actual, readSecret: vi.fn(actual.readSecret) };
});

/*
 * Valg av leverandør: én vei (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 5,
 * kortet Omfang 7, A160). Leverandøren kommer bare fra en aktiv rad i `integration_connections`
 * med `port = ai`, og bare når `ai.enabled` er boolsk sann. Aldri fra miljøvariabler.
 * Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (én vei å teste) og færre reklamasjoner (en feil innstilling i
 * miljøet kan aldri sende data til en ekte leverandør).
 */

type Setup = (organizationId: string) => Promise<void>;

const disabledCases: { name: string; setup: Setup }[] = [
  {
    name: "5.1 ai.enabled mangler, aktiv fake-tilkobling",
    setup: async (id) => {
      await enableAi(id, { enabled: undefined });
    },
  },
  {
    name: "5.2 ai.enabled = false, aktiv tilkobling",
    setup: async (id) => {
      await enableAi(id, { enabled: false });
    },
  },
  {
    name: '5.3 ai.enabled = "true" (tekst)',
    setup: async (id) => {
      await enableAi(id, { enabled: "true" });
    },
  },
  {
    name: "5.4 ai.enabled = true, ingen tilkobling",
    setup: async (id) => {
      await enableAi(id, { connection: false });
    },
  },
  {
    name: "5.5 ai.enabled = true, tilkobling med status disabled",
    setup: async (id) => {
      await enableAi(id, { status: "disabled" });
    },
  },
  {
    name: "5.6 ai.enabled = true, mykt slettet tilkobling",
    setup: async (id) => {
      await enableAi(id, { deletedAt: new Date("2026-11-01T10:00:00Z") });
    },
  },
  {
    name: "5.7 ai.enabled = true, ukjent leverandørkode (openai)",
    setup: async (id) => {
      await enableAi(id, { provider: "openai" });
    },
  },
];

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(readSecret).mockClear();
});

async function inspectorIn(organizationId: string) {
  return (await employeeWithGrant(organizationId, ["inspector"])).grant;
}

describe("valg av leverandør: KI av (5.1–5.7, 5.11)", () => {
  it.each(disabledCases)(
    "$name → disabled, fake ikke kalt, ingen rad og ingen audit",
    async ({ setup }) => {
      const org = await createOrganization("Oppdiktet Takst A");
      await setup(org.id);
      const grant = await inspectorIn(org.id);
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const auditBefore = await auditCount();

      const result = await requestSuggestion(grant, validRequest());

      expect(result).toEqual({ kind: "disabled" });
      expect(spy).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );
});

describe("valg av leverandør: KI på (5.8–5.9)", () => {
  it.each([
    { name: "5.8 aktiv fake", status: "active" },
    { name: "5.9 fake med status error (regnes som aktiv)", status: "error" },
  ])("$name → forslag", async ({ status }) => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id, { status });
    const grant = await inspectorIn(org.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestSuggestion(grant, validRequest());

    expect(result.kind).toBe("suggestion");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await aiRowCount()).toBe(1);
  });
});

describe("valg av leverandør: miljøvariabler velger aldri (5.10)", () => {
  it("5.10 AI_PROVIDER=fake og NODE_ENV=development uten tilkobling → fortsatt disabled", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id, { connection: false });
    const grant = await inspectorIn(org.id);
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestSuggestion(grant, validRequest());

    expect(result).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("5.10 med fake-tilkobling og AI_PROVIDER=openai → fortsatt fake", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id);
    const grant = await inspectorIn(org.id);
    vi.stubEnv("AI_PROVIDER", "openai");
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestSuggestion(grant, validRequest());

    expect(result.kind).toBe("suggestion");
    expect(spy).toHaveBeenCalledTimes(1);
    const [row] = await allAiRows();
    expect(row!.provider).toBe("fake");
    expect(row!.model).toBe("fake-v1");
  });
});

describe("valg av leverandør: en annen organisasjon teller ikke (5.12)", () => {
  it("5.12 B har aktiv fake og ai.enabled, A har ingenting → A får disabled", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    const grantA = await inspectorIn(orgA.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    expect(await requestSuggestion(grantA, validRequest())).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("5.12 A har bare ai.enabled, B har bare tilkoblingen → A får disabled", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await mergeOrganizationSettings(orgA.id, { "ai.enabled": true });
    await createIntegrationConnection(orgB.id, { port: "ai", provider: "fake" });
    const grantA = await inspectorIn(orgA.id);

    expect(await requestSuggestion(grantA, validRequest())).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
  });

  it("5.12 A har bare tilkoblingen, B har bare ai.enabled → A får disabled", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await createIntegrationConnection(orgA.id, { port: "ai", provider: "fake" });
    await mergeOrganizationSettings(orgB.id, { "ai.enabled": true });
    const grantA = await inspectorIn(orgA.id);

    expect(await requestSuggestion(grantA, validRequest())).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
  });
});

describe("tenant-isolasjon for KI av/på og tilkoblingen (9.5–9.6)", () => {
  it("9.5 lesing av ai.enabled: query gir organisasjonen bare når egen bryter er på", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const result = await requestSuggestion(grant, validRequest());
        return result.kind === "suggestion" ? [{ id: grant.organizationId }] : [];
      },
      idOf: (row) => row.id,
    });
  });

  it("9.6 oppslag av tilkobling: query gir tilkoblingen som ble brukt, bare egen", async () => {
    const connectionByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await enableAi(grantA.organizationId);
        const b = await enableAi(grantB.organizationId);
        connectionByOrg.set(grantA.organizationId, a!.id);
        connectionByOrg.set(grantB.organizationId, b!.id);
        return { a: [a!.id], b: [b!.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const result = await requestSuggestion(grant, validRequest());
        if (result.kind !== "suggestion") return [];
        return [{ id: connectionByOrg.get(grant.organizationId)! }];
      },
      idOf: (row) => row.id,
    });
  });

  it("9.5–9.6 A med KI av ser ikke Bs bryter, og B med KI på får fortsatt forslag", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgA.id, { enabled: false });
    await enableAi(orgB.id);
    const grantA = await inspectorIn(orgA.id);
    const grantB = await inspectorIn(orgB.id);

    expect((await requestSuggestion(grantA, validRequest())).kind).toBe("disabled");
    expect((await requestSuggestion(grantB, validRequest())).kind).toBe("suggestion");
  });
});

/*
 * Låsene for `anthropic` (docs/funksjoner/fase2a-ki-leverandor-testplan.md 3.1, R1, R5). Én lås
 * mangler om gangen, alt annet er på plass. Nøkkelen er oppdiktet og settes med `vi.stubEnv`.
 * Falsk HTTP: ingen ekte nettkall, ingen kostnad.
 */
type LockCase = {
  name: string;
  /** Tilkoblingen; `null` betyr ingen `enableAnthropic`. */
  options: Parameters<typeof enableAnthropic>[1] | null;
  /** Verdien på nøkkelen i miljøet; `undefined` fjerner den. */
  key?: string | undefined;
};

const VALID_PRICING = { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" };
const VALID_SETTINGS = {
  model: ANTHROPIC_TEST_MODEL,
  features: ["language_polish"],
  pricing: VALID_PRICING,
};

const lockCases: LockCase[] = [
  { name: "ai.enabled mangler", options: { enabled: undefined } },
  { name: "ai.enabled = false", options: { enabled: false } },
  { name: 'ai.enabled = "true" (tekst)', options: { enabled: "true" } },
  { name: "ingen tilkobling", options: { connection: false } },
  {
    name: "tilkoblingen er slettet mykt",
    options: { deletedAt: new Date("2026-11-01T10:00:00Z") },
  },
  { name: "tilkoblingen er inaktiv", options: { status: "disabled" } },
  { name: "ukjent leverandørkode", options: { provider: "unknown_vendor" } },
  {
    name: "model mangler (rå rad)",
    options: { settings: { features: ["language_polish"], pricing: VALID_PRICING } },
  },
  { name: "model er tom (rå rad)", options: { settings: { ...VALID_SETTINGS, model: "" } } },
  {
    name: "pricing mangler (rå rad)",
    options: { settings: { model: ANTHROPIC_TEST_MODEL, features: ["language_polish"] } },
  },
  {
    name: "pricing er ugyldig (rå rad)",
    options: { settings: { ...VALID_SETTINGS, pricing: { ...VALID_PRICING, currency: "USD" } } },
  },
  {
    name: "ekstra felt baseUrl i settings (rå rad)",
    options: { settings: { ...VALID_SETTINGS, baseUrl: "https://example.invalid" } },
  },
  {
    name: "secret_ref er en annen gyldig hemmelighet (rå rad)",
    options: { secretRef: "MS_GRAPH_CLIENT_SECRET" },
  },
  {
    name: "secret_ref er på nektlisten, DATABASE_URL (rå rad)",
    options: { secretRef: "DATABASE_URL" },
  },
  { name: "secret_ref mangler (rå rad)", options: { secretRef: null } },
  { name: "nøkkelen finnes ikke i miljøet", options: {}, key: undefined },
  { name: 'nøkkelen er ""', options: {}, key: "" },
  { name: "nøkkelen er bare mellomrom", options: {}, key: "   " },
];

function spyOnConsole() {
  return (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
}

function consoleText(spies: ReturnType<typeof spyOnConsole>): string {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

describe("valg av leverandør: låsene for anthropic (KI-leverandør 3.1, R1)", () => {
  it.each(lockCases)(
    "$name → disabled, ingen rad, intet kall, ingen lekkasje",
    async ({ options, ...rest }) => {
      const org = await createOrganization("Oppdiktet Takst A");
      if (options !== null) await enableAnthropic(org.id, options);
      // Andre hemmeligheter finnes, så låsen er navnet og ikke at verdien mangler
      vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "oppdiktet-annen-verdi");
      vi.stubEnv("ANTHROPIC_API_KEY", "key" in rest ? rest.key : ANTHROPIC_TEST_KEY);
      const grant = await inspectorIn(org.id);
      const fetchMock = stubAnthropicFetch();
      const consoleSpies = spyOnConsole();

      const resolved = await resolveAiProvider(grant);
      const result = await requestSuggestion(grant, validRequest());

      expect(resolved).toEqual({ kind: "disabled" });
      expect(result).toEqual({ kind: "disabled" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      const seen = `${JSON.stringify(resolved)} ${JSON.stringify(result)} ${consoleText(consoleSpies)}`;
      expect(seen).not.toContain(ANTHROPIC_TEST_KEY);
      expect(seen).not.toContain("ANTHROPIC_API_KEY");
      expect(seen).not.toContain("oppdiktet-annen-verdi");
      // readSecret leses aldri med navnet fra raden
      for (const [name] of vi.mocked(readSecret).mock.calls) {
        expect(name).toBe("ANTHROPIC_API_KEY");
      }
    },
  );

  it("alt på plass → enabled med anthropic, modellen og funksjonslisten fra innstillingene", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAnthropic(org.id);
    vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
    const grant = await inspectorIn(org.id);
    const fetchMock = stubAnthropicFetch();

    const resolved = await resolveAiProvider(grant);

    expect(resolved.kind).toBe("enabled");
    if (resolved.kind !== "enabled") return;
    expect(resolved.provider.code).toBe("anthropic");
    expect(resolved.provider.model).toBe(ANTHROPIC_TEST_MODEL);
    expect(resolved.model).toBe(ANTHROPIC_TEST_MODEL);
    expect(resolved.features).toEqual(["language_polish"]);
    // Nøkkelen ligger ikke på objektet som returneres
    expect(JSON.stringify(resolved)).not.toContain(ANTHROPIC_TEST_KEY);
    expect(Object.values(resolved.provider)).not.toContain(ANTHROPIC_TEST_KEY);
    expect(vi.mocked(readSecret).mock.calls).toEqual([["ANTHROPIC_API_KEY"]]);
    // Å velge leverandøren kaller den ikke
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("R5 fake som før: samme objekt og ingen funksjonsliste; readSecret kalles ikke", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id);
    vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
    const grant = await inspectorIn(org.id);

    const resolved = await resolveAiProvider(grant);

    expect(resolved).toEqual({
      kind: "enabled",
      provider: realFakeProvider,
      model: "fake-v1",
      features: null,
    });
    if (resolved.kind === "enabled") expect(resolved.provider).toBe(realFakeProvider);
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("miljøet velger aldri: nøkkel satt og NODE_ENV=production uten tilkobling → disabled", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id, { connection: false });
    vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const grant = await inspectorIn(org.id);
    const fetchMock = stubAnthropicFetch();

    expect(await resolveAiProvider(grant)).toEqual({ kind: "disabled" });
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("miljøet velger aldri: nøkkel satt og bare fake-tilkobling → fake", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id);
    vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
    vi.stubEnv("NODE_ENV", "production");
    const grant = await inspectorIn(org.id);
    const fetchMock = stubAnthropicFetch();

    const resolved = await resolveAiProvider(grant);
    expect(resolved.kind === "enabled" && resolved.provider).toBe(realFakeProvider);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
