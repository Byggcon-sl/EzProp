import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSecret } from "@/core/integrations/secrets";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import {
  aiRowCount,
  anthropicSettings,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  removeOrganizationSetting,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { fakeAnthropic, TEST_ANTHROPIC_KEY, TEST_MODEL } from "../../../tests/fake-anthropic-http";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import { resolveAiProvider } from "./provider-resolution";
import { fakeAiProvider } from "./providers/fake";

/*
 * Låsene for den ekte leverandøren i `resolveAiProvider` (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md 3.1, kortet Omfang 5, R1 og R5). Én lås mangler om gangen, alt annet er på plass.
 * Tabellen er regler som data. Mot testdatabasen, med falsk HTTP og oppdiktet nøkkel.
 *
 * Støtter hovedmål: KI i bunnen (den ekte leverandøren slås bare på når alle låsene er på plass,
 * og en feil innstilling sender aldri data ut) og færre reklamasjoner (ingen halvveis påslått KI).
 */

vi.mock("@/core/integrations/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/integrations/secrets")>();
  return { ...actual, readSecret: vi.fn(actual.readSecret) };
});

const KEY_NAME = "ANTHROPIC_API_KEY";
const OTHER_SECRET_VALUE = "oppdiktet-annen-hemmelighet-K7Q";

let http: ReturnType<typeof fakeAnthropic>;
let spies: ReturnType<typeof spyOnOutput>;

function spyOnOutput() {
  return [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function outputText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => inspect(args, { depth: 6 }))
    .join("\n");
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(readSecret).mockClear();
  http = fakeAnthropic();
  vi.stubGlobal("fetch", http.fetchFn);
  vi.stubEnv(KEY_NAME, TEST_ANTHROPIC_KEY);
  spies = spyOnOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function inspectorIn(organizationId: string) {
  return (await employeeWithGrant(organizationId, ["inspector"])).grant;
}

/** Skriver `settings` eller `secret_ref` rett i raden, forbi skjemaet. */
async function rawConnectionUpdate(
  connectionId: string,
  patch: { settings?: unknown; secretRef?: string },
) {
  if (patch.settings !== undefined) {
    await db.execute(
      sql`update integration_connections set settings = ${JSON.stringify(patch.settings)}::jsonb where id = ${connectionId}`,
    );
  }
  if (patch.secretRef !== undefined) {
    await db.execute(
      sql`update integration_connections set secret_ref = ${patch.secretRef} where id = ${connectionId}`,
    );
  }
}

const withoutKey = (key: string) =>
  Object.fromEntries(Object.entries(anthropicSettings()).filter(([name]) => name !== key));

type LockCase = { name: string; setup: (organizationId: string) => Promise<void> };

const LOCK_CASES: LockCase[] = [
  {
    name: "ai.enabled mangler",
    setup: async (id) => {
      await enableAnthropic(id);
      await removeOrganizationSetting(id, "ai.enabled");
    },
  },
  {
    name: "ai.enabled = false",
    setup: async (id) => void (await enableAnthropic(id, { enabled: false })),
  },
  {
    name: 'ai.enabled = "true" (tekst)',
    setup: async (id) => void (await enableAnthropic(id, { enabled: "true" })),
  },
  {
    name: "ingen tilkobling",
    setup: async (id) => void (await enableAnthropic(id, { connection: false })),
  },
  {
    name: "tilkoblingen er slettet mykt",
    setup: async (id) =>
      void (await enableAnthropic(id, { deletedAt: new Date("2026-11-01T10:00:00Z") })),
  },
  {
    name: "tilkoblingen er inaktiv",
    setup: async (id) => void (await enableAnthropic(id, { status: "disabled" })),
  },
  {
    name: "ukjent leverandørkode (rå rad)",
    setup: async (id) => void (await enableAnthropic(id, { provider: "unknown_vendor" })),
  },
  {
    name: "model mangler (rå rad)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, { settings: withoutKey("model") });
    },
  },
  {
    name: "model er tom (rå rad)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, { settings: anthropicSettings({ model: "" }) });
    },
  },
  {
    name: "pricing mangler (rå rad)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, { settings: withoutKey("pricing") });
    },
  },
  {
    name: "pricing er ugyldig (rå rad, negativ pris)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, {
        settings: anthropicSettings({
          pricing: { inputPerMillion: -30, outputPerMillion: 150, currency: "NOK" },
        }),
      });
    },
  },
  {
    name: "pricing i annen valuta (rå rad)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, {
        settings: anthropicSettings({
          pricing: { inputPerMillion: 3, outputPerMillion: 15, currency: "USD" },
        }),
      });
    },
  },
  {
    name: "ekstra felt baseUrl i settings (rå rad)",
    setup: async (id) => {
      const row = await enableAnthropic(id);
      await rawConnectionUpdate(row!.id, {
        settings: anthropicSettings({ baseUrl: "https://example.com/proxy" }),
      });
    },
  },
  {
    name: "secret_ref er en annen gyldig hemmelighet (rå rad)",
    setup: async (id) => {
      vi.stubEnv("MS_GRAPH_CLIENT_SECRET", OTHER_SECRET_VALUE);
      await enableAnthropic(id, { secretRef: "MS_GRAPH_CLIENT_SECRET" });
    },
  },
  {
    name: "secret_ref er på nektlisten, DATABASE_URL (rå rad)",
    setup: async (id) => void (await enableAnthropic(id, { secretRef: "DATABASE_URL" })),
  },
  {
    name: "secret_ref mangler (rå rad)",
    setup: async (id) => void (await enableAnthropic(id, { secretRef: null })),
  },
  {
    name: "nøkkelen finnes ikke i miljøet",
    setup: async (id) => {
      vi.stubEnv(KEY_NAME, undefined);
      await enableAnthropic(id);
    },
  },
  {
    name: 'nøkkelen er ""',
    setup: async (id) => {
      vi.stubEnv(KEY_NAME, "");
      await enableAnthropic(id);
    },
  },
  {
    name: "nøkkelen er bare mellomrom",
    setup: async (id) => {
      vi.stubEnv(KEY_NAME, "   \t ");
      await enableAnthropic(id);
    },
  },
];

describe("låsene for anthropic (3.1, R1): én lås mangler → disabled", () => {
  it.each(LOCK_CASES)(
    "$name → disabled, intet kall, ingen rad, ingen lekkasje",
    async ({ setup }) => {
      const org = await createOrganization("Oppdiktet Takst A");
      await setup(org.id);
      const grant = await inspectorIn(org.id);

      let resolved: unknown;
      let thrown: unknown;
      try {
        resolved = await resolveAiProvider(grant);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, "resolveAiProvider skal aldri kaste").toBeUndefined();
      expect(resolved).toEqual({ kind: "disabled" });

      const result = await requestSuggestion(grant, validRequest());
      expect(result).toEqual({ kind: "disabled" });
      expect(await aiRowCount()).toBe(0);
      expect(http.calls).toHaveLength(0);

      const returned = inspect([resolved, result], { depth: 6 });
      for (const text of [returned, outputText()]) {
        expect(text).not.toContain(TEST_ANTHROPIC_KEY);
        expect(text).not.toContain(KEY_NAME);
        expect(text).not.toContain(OTHER_SECRET_VALUE);
      }

      // 3.1.4 readSecret kalles bare med ANTHROPIC_API_KEY, aldri med verdien fra raden
      for (const [name] of vi.mocked(readSecret).mock.calls) expect(name).toBe(KEY_NAME);
    },
  );
});

describe("låsene for anthropic: alt på plass (3.1.1)", () => {
  it("3.1.1 enabled med adapteren anthropic, modellen og features fra innstillingene", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAnthropic(org.id, {
      settings: anthropicSettings({ features: ["language_polish"] }),
    });
    const grant = await inspectorIn(org.id);

    const resolved = await resolveAiProvider(grant);
    expect(resolved.kind).toBe("enabled");
    if (resolved.kind !== "enabled") return;
    expect(resolved.provider.code).toBe("anthropic");
    expect(resolved.provider.model).toBe(TEST_MODEL);
    expect(resolved.model).toBe(TEST_MODEL);
    expect(resolved.features).toEqual(["language_polish"]);
    expect(resolved.provider).not.toBe(fakeAiProvider);
    expect(http.calls).toHaveLength(0);
    expect(inspect(resolved, { depth: 6 })).not.toContain(TEST_ANTHROPIC_KEY);
    expect(JSON.stringify(resolved)).not.toContain(TEST_ANTHROPIC_KEY);
    expect(vi.mocked(readSecret).mock.calls.map(([name]) => name)).toEqual([KEY_NAME]);
  });
});

describe("fake som før (3.1.2, R5)", () => {
  it("3.1.2 fake gir samme faste objekt og features = null", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id);
    const grant = await inspectorIn(org.id);
    const resolved = await resolveAiProvider(grant);
    expect(resolved.kind).toBe("enabled");
    if (resolved.kind !== "enabled") return;
    expect(resolved.provider).toBe(fakeAiProvider);
    expect(resolved.features).toBeNull();
    expect(resolved.model).toBe(fakeAiProvider.model);
    expect(vi.mocked(readSecret)).not.toHaveBeenCalled();
  });
});

describe("miljøet velger aldri (3.1.3, A160)", () => {
  it("3.1.3 nøkkel satt og NODE_ENV=production, men ingen tilkobling → disabled", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id, { connection: false });
    const grant = await inspectorIn(org.id);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "anthropic");

    expect(await resolveAiProvider(grant)).toEqual({ kind: "disabled" });
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
    expect(http.calls).toHaveLength(0);
    expect(await aiRowCount()).toBe(0);
  });

  it("3.1.3 nøkkel satt og bare fake-tilkobling → fake", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    await enableAi(org.id);
    const grant = await inspectorIn(org.id);
    vi.stubEnv("AI_PROVIDER", "anthropic");

    const resolved = await resolveAiProvider(grant);
    expect(resolved.kind === "enabled" && resolved.provider).toBe(fakeAiProvider);
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
    expect(http.calls).toHaveLength(0);
  });
});
