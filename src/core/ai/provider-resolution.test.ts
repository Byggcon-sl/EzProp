import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import {
  aiRowCount,
  allAiRows,
  auditCount,
  employeeWithGrant,
  enableAi,
  fakeAiProvider,
  mergeOrganizationSettings,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import {
  createIntegrationConnection,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

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
