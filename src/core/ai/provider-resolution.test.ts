import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAiProvider, requestSuggestion } from "@/core/ai";
import {
  createIntegrationConnection,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import {
  addMember,
  auditCount,
  enableAi,
  polishRequest,
  setOrganizationSetting,
  AI_ENABLED,
  usageCount,
  usageRow,
} from "../../../tests/ai";

/*
 * Valg av leverandør, én vei (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 5, A160). Leverandøren kommer bare fra en aktiv tilkobling på porten `ai` og bare når
 * `ai.enabled` er boolsk sann. Miljøvariabler velger aldri leverandør. Mot testdatabasen.
 *
 * Tenant-isolasjonen for lesing av `ai.enabled` og oppslag av tilkobling står i
 * request-suggestion.test.ts (9.5, 9.6). Her prøves «bare den andre har KI på» (5.12, 5.13).
 *
 * Støtter hovedmål: KI i bunnen (én vei å teste) og de ansatte (en feil innstilling i miljøet kan
 * aldri sende data ut).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(fakeAiProvider, "complete");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Setup = (organizationId: string) => Promise<unknown>;

const disabledCases: [string, Setup][] = [
  ["5.1 ai.enabled mangler, aktiv fake", (id) => enableAi(id, { enabled: undefined })],
  ["5.2 ai.enabled = false, aktiv fake", (id) => enableAi(id, { enabled: false })],
  ['5.3 ai.enabled = "true" (tekst)', (id) => enableAi(id, { enabled: "true" })],
  ["5.3 ai.enabled = 1 (tall)", (id) => enableAi(id, { enabled: 1 })],
  ["5.4 ai.enabled = true, ingen tilkobling", (id) => enableAi(id, { provider: null })],
  ["5.5 ai.enabled = true, tilkobling deaktivert", (id) => enableAi(id, { status: "disabled" })],
  [
    "5.6 ai.enabled = true, tilkobling mykt slettet",
    (id) => enableAi(id, { deletedAt: new Date("2026-11-01T10:00:00Z") }),
  ],
  [
    "5.7 ai.enabled = true, ukjent leverandørkode openai",
    (id) => enableAi(id, { provider: "openai" }),
  ],
  [
    "5.7 ai.enabled = true, tilkobling på en annen port (email) og ingen på ai",
    async (id) => {
      await setOrganizationSetting(id, AI_ENABLED, true);
      await createIntegrationConnection(id, { port: "email", provider: "fake" });
    },
  ],
];

describe("valg av leverandør: KI av (5.1–5.7, 5.11)", () => {
  it.each(disabledCases)(
    "%s → disabled, intet kall, ingen rad, ingen revisjonslinje",
    async (_name, setup) => {
      const organization = await createOrganization();
      await setup(organization.id);
      const inspector = await addMember(organization.id, ["inspector"]);
      const auditBefore = await auditCount();

      const result = await requestSuggestion(inspector.grant, polishRequest());

      expect(result).toEqual({ kind: "disabled" });
      expect(fakeAiProvider.complete).not.toHaveBeenCalled();
      expect(await usageCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );
});

describe("valg av leverandør: KI på (5.8, 5.9)", () => {
  it.each([
    ["5.8 ai.enabled = true, aktiv fake", "active"],
    ["5.9 ai.enabled = true, fake med status error", "error"],
  ])("%s → forslag", async (_name, status) => {
    const organization = await createOrganization();
    await enableAi(organization.id, { status });
    const inspector = await addMember(organization.id, ["inspector"]);

    const result = await requestSuggestion(inspector.grant, polishRequest());

    expect(result.kind).toBe("suggestion");
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    expect(await usageCount()).toBe(1);
  });
});

describe("valg av leverandør: miljøvariabler (5.10)", () => {
  it("5.10 AI_PROVIDER = fake og NODE_ENV = development uten tilkobling → fortsatt disabled", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const organization = await createOrganization();
    await enableAi(organization.id, { provider: null });
    const inspector = await addMember(organization.id, ["inspector"]);

    expect(await requestSuggestion(inspector.grant, polishRequest())).toEqual({ kind: "disabled" });
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });

  it("5.10 AI_PROVIDER = openai med aktiv fake-tilkobling → fortsatt fake", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "annen-modell");
    const organization = await createOrganization();
    await enableAi(organization.id);
    const inspector = await addMember(organization.id, ["inspector"]);
    const request = polishRequest();

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("suggestion");
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    const row = await usageRow(request.requestId);
    expect(row?.provider).toBe("fake");
    expect(row?.model).toBe("fake-v1");
  });
});

describe("valg av leverandør: den andre organisasjonen teller ikke (5.12, 5.13)", () => {
  it("5.12 B har aktiv fake og ai.enabled, A har ingenting → A får disabled", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await enableAi(orgB.id);
    const inspectorA = await addMember(orgA.id, ["inspector"]);

    expect(await requestSuggestion(inspectorA.grant, polishRequest())).toEqual({
      kind: "disabled",
    });
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });

  it("5.12 B har tilkobling, A har bare ai.enabled → A får disabled", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await enableAi(orgA.id, { provider: null });
    await enableAi(orgB.id);
    const inspectorA = await addMember(orgA.id, ["inspector"]);

    expect(await requestSuggestion(inspectorA.grant, polishRequest())).toEqual({
      kind: "disabled",
    });
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
  });

  it("5.13 B har ai.enabled = true, A har aktiv fake men ai.enabled = false → A får disabled", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await enableAi(orgA.id, { enabled: false });
    await enableAi(orgB.id, { provider: null });
    const inspectorA = await addMember(orgA.id, ["inspector"]);

    expect(await requestSuggestion(inspectorA.grant, polishRequest())).toEqual({
      kind: "disabled",
    });
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });
});
