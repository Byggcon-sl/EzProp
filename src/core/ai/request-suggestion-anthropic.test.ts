import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  aiRow,
  aiRowCount,
  allAiRows,
  anthropicSettings,
  captureError,
  employeeWithGrant,
  enableAi,
  FAKE_ANTHROPIC_KEY,
  fakeAiProvider,
  mergeOrganizationSettings,
  recordDecision,
  requestSuggestion,
  TEST_MODEL,
  validRequest,
  validTarget,
} from "../../../tests/ai";
import { seedKnownValues } from "../../../tests/known-values";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { uuidv7 } from "@/shared/lib/uuid";
import { AI_FEATURES, type AiTargetSpec } from "./features";
import * as promptModule from "./prompt";

/*
 * Sperrene i `requestSuggestion` mot en ekte leverandør (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md 3.2–3.6, R2–R4, R6, R7). Adapteren byttes ut med en stub som registrerer kallene,
 * så testene prøver sperrene uavhengig av kroppen i adapteren, og intet nettkall kan skje. «Intet
 * kall» betyr at stubbens `complete` ikke er kalt. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen, trygt: bare vasket tekst som har bestått lekkasjesjekken når en
 * ekte leverandør, og bare for funksjoner som er slått på.
 */

const adapter = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock("@/core/ai/providers/anthropic", () => ({
  ANTHROPIC_PROVIDER_CODE: "anthropic",
  createAnthropicProvider: (options: { model: string }) => ({
    code: "anthropic",
    model: options.model,
    complete: adapter.complete,
  }),
}));

const SECRET = "ANTHROPIC_API_KEY";

/*
 * `language_polish` har i dag bare mål som er sperret mot en ekte leverandør (`answer` og
 * prøvemålet, A166, A173). For å prøve veien forbi sperren får funksjonen et oppdiktet mål i
 * disse testene, slik et rapportfelt i 2a-2 vil være. Fjernes etter hver test.
 */
const REAL_TARGET: AiTargetSpec = { type: "test_report_field", fieldKey: "text" };
const targets = AI_FEATURES.language_polish.allowedTargets as AiTargetSpec[];

function realTarget(id: string = uuidv7()) {
  return { ...REAL_TARGET, id };
}
const OK_REPLY = {
  outcome: "ok",
  text: "Taket er gammelt og har sprekker.",
  tokensIn: 120,
  tokensOut: 40,
  cost: 0.0096,
  currency: "NOK",
} as const;

async function anthropicOrganization(
  name = "Oppdiktet Takst A",
  settings: Record<string, unknown> = anthropicSettings(),
) {
  const organization = await createOrganization(name);
  await enableAi(organization.id, { provider: "anthropic", settings, secretRef: SECRET });
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  return { organization, ...inspector };
}

beforeEach(async () => {
  await resetDatabase();
  adapter.complete.mockReset();
  adapter.complete.mockResolvedValue(OK_REPLY);
  vi.stubEnv(SECRET, FAKE_ANTHROPIC_KEY);
  targets.push(REAL_TARGET);
});
afterEach(() => {
  targets.splice(targets.indexOf(REAL_TARGET), 1);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sperren for ekte leverandør (R2)", () => {
  it.each([
    { name: "ai_trial", target: () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" }) },
    { name: "answer", target: () => ({ ...validTarget(), type: "answer" }) },
    { name: "fritekst uten oppdrag", target: () => realTarget() },
  ])("$name mot anthropic gir blocked uten kall", async ({ target }) => {
    const { grant } = await anthropicOrganization();
    const request = validRequest({ assignmentId: null, target: target() });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).not.toBe("suggestion");
    expect((await aiRow(request.requestId))?.outcome).toBe("blocked");
    expect((await aiRow(request.requestId))?.provider).toBe("anthropic");
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("kontroll: fritekst uten oppdrag mot fake gir forslag som før", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);

    const result = await requestSuggestion(grant, validRequest());

    expect(result.kind).toBe("suggestion");
  });

  it("isBlocked bruker fast kode: et annet objekt med code = fake sperres ikke", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const copy = {
      code: fakeAiProvider.code,
      model: "fake",
      complete: vi.fn().mockResolvedValue(OK_REPLY),
    };
    const resolution = await import("./provider-resolution");
    vi.spyOn(resolution, "resolveAiProvider").mockResolvedValue({
      kind: "enabled",
      provider: copy,
      model: "fake",
      features: null,
    });

    const result = await requestSuggestion(grant, validRequest());

    expect(result.kind).toBe("suggestion");
    expect(copy.complete).toHaveBeenCalledTimes(1);
  });
});

describe("settings.features (R3, A194)", () => {
  it("tom liste gir disabled uten rad, uten vask og uten kall", async () => {
    const { organization, grant } = await anthropicOrganization(
      "Oppdiktet Takst A",
      anthropicSettings({ features: [] }),
    );
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen" }],
    });
    const prepare = vi.spyOn(promptModule, "preparePrompt");

    const result = await requestSuggestion(
      grant,
      validRequest({ assignmentId, target: realTarget() }),
    );

    expect(result).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("manglende liste (rå rad) gir disabled", async () => {
    const { features: _features, ...withoutFeatures } = anthropicSettings();
    void _features;
    const { organization, grant } = await anthropicOrganization(
      "Oppdiktet Takst A",
      withoutFeatures,
    );
    const assignmentId = await seedKnownValues(organization.id, {});

    expect(
      await requestSuggestion(grant, validRequest({ assignmentId, target: realTarget() })),
    ).toEqual({
      kind: "disabled",
    });
    expect(await aiRowCount()).toBe(0);
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("fake har ingen liste og tar alle funksjoner", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);

    expect((await requestSuggestion(grant, validRequest())).kind).toBe("suggestion");
  });
});

describe("hele flyten mot en ekte leverandør (R4)", () => {
  const TEXT = "Åse Testesen på 12345678 sier at taket i Oppdiktetveien 7 er gammelt.";

  it("bare vasket tekst sendes, og raden har anthropic, modell, tokens og kostnad", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen", phone: "12345678" }],
      property: { address: "Oppdiktetveien 7" },
    });
    const request = validRequest({ assignmentId, target: realTarget(), fields: { text: TEXT } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(adapter.complete).toHaveBeenCalledTimes(1);
    const sent = (adapter.complete.mock.calls[0]![0] as { prompt: string; model: string }).prompt;
    for (const value of ["Åse", "Testesen", "12345678", "Oppdiktetveien"]) {
      expect(sent).not.toContain(value);
    }
    const row = await aiRow(request.requestId);
    expect(row?.provider).toBe("anthropic");
    expect(row?.model).toBe(TEST_MODEL);
    expect(row?.outcome).toBe("ok");
    expect(row?.tokens_in).toBe(120);
    expect(row?.tokens_out).toBe(40);
    expect(Number(row?.cost)).toBeCloseTo(0.0096, 4);

    // Forslaget kan godtas som før
    if (result.kind !== "suggestion") return;
    await recordDecision(grant, result.usageId, "accepted");
    expect((await aiRow(result.usageId))?.status).toBe("accepted");
  });

  it("lekkasjesjekken stopper en ledetekst med persondata: blocked-rad uten kall", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen", phone: "12345678" }],
    });
    // Vasken bommer (stubbet), så lekkasjesjekken er siste vern
    vi.spyOn(promptModule, "preparePrompt").mockReturnValue({
      prompt: "Skriv om: Åse Testesen sier at taket er gammelt.",
      redactedFields: { text: "Åse Testesen sier at taket er gammelt." },
      redactedCount: 0,
    });
    const request = validRequest({ assignmentId, target: realTarget(), fields: { text: TEXT } });

    await requestSuggestion(grant, request);

    expect(adapter.complete).not.toHaveBeenCalled();
    const row = await aiRow(request.requestId);
    expect(row?.outcome).toBe("blocked");
    expect(row?.output_text).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Testesen");
  });

  it("lekkasjesjekken gjelder ikke fake (ingenting forlater oss)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen" }],
    });
    vi.spyOn(promptModule, "preparePrompt").mockReturnValue({
      prompt: "Skriv om: Åse Testesen sier at taket er gammelt.",
      redactedFields: { text: "x" },
      redactedCount: 0,
    });

    const result = await requestSuggestion(
      grant,
      validRequest({ assignmentId, target: realTarget() }),
    );

    expect(result.kind).toBe("suggestion");
  });

  it("nøkkelen står ingen steder i databasen etter kall og feil", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, {});
    await requestSuggestion(grant, validRequest({ assignmentId, target: realTarget() }));
    adapter.complete.mockResolvedValueOnce({ outcome: "error", errorCode: "rejected" });
    const failed = validRequest({ assignmentId, target: realTarget() });
    await requestSuggestion(grant, failed);

    expect((await aiRow(failed.requestId))?.error_code).toBe("rejected");
    for (const table of ["ai_usage_log", "integration_connections", "audit_log"]) {
      const rows = await db.execute(sql.raw(`select * from ${table}`));
      expect(JSON.stringify(rows), table).not.toContain(FAKE_ANTHROPIC_KEY);
    }
  });
});

describe("tenant-isolasjon for veien med anthropic (R6)", () => {
  it("A med anthropic og B med fake: hver får sin egen leverandør og rad", async () => {
    const assignments = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId, {
          provider: "anthropic",
          settings: anthropicSettings(),
          secretRef: SECRET,
        });
        await enableAi(grantB.organizationId);
        assignments.set(grantA.organizationId, await seedKnownValues(grantA.organizationId, {}));
        assignments.set(grantB.organizationId, await seedKnownValues(grantB.organizationId, {}));
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const { requireOrganizationAccess } = await import("@/core/access");
        const grant = await requireOrganizationAccess(actor, organizationId);
        const request = validRequest({
          assignmentId: assignments.get(organizationId) ?? null,
          target: realTarget(),
        });
        await requestSuggestion(grant, request);
        const row = await aiRow(request.requestId);
        return row ? [{ organizationId: row.organization_id, provider: row.provider }] : [];
      },
      idOf: (row) => row.organizationId,
    });

    const rows = await allAiRows();
    const anthropicRows = rows.filter((row) => row.provider === "anthropic");
    const fakeRows = rows.filter((row) => row.provider === "fake");
    expect(anthropicRows.length).toBeGreaterThan(0);
    expect(fakeRows.length).toBeGreaterThan(0);
    expect(new Set(anthropicRows.map((row) => row.organization_id)).size).toBe(1);
    expect(new Set(fakeRows.map((row) => row.organization_id)).size).toBe(1);
    expect(anthropicRows[0]!.organization_id).not.toBe(fakeRows[0]!.organization_id);
    expect(adapter.complete).toHaveBeenCalledTimes(anthropicRows.length);
  });

  it.each([
    { name: "A har alt, B har bare ai.enabled", full: "A", empty: "B" },
    { name: "B har alt, A har bare ai.enabled", full: "B", empty: "A" },
  ])("$name: den uten tilkobling får disabled og ingen rad", async ({ full, empty }) => {
    const sides: Record<string, { organizationId: string; grant: EmployeeGrant }> = {};
    for (const side of ["A", "B"]) {
      const organization = await createOrganization(`Oppdiktet Takst ${side}`);
      if (side === full) {
        await enableAi(organization.id, {
          provider: "anthropic",
          settings: anthropicSettings(),
          secretRef: SECRET,
        });
      } else {
        await mergeOrganizationSettings(organization.id, { "ai.enabled": true });
      }
      const { grant } = await employeeWithGrant(organization.id);
      sides[side] = { organizationId: organization.id, grant };
    }
    const without = sides[empty]!;
    const assignmentId = await seedKnownValues(without.organizationId, {});

    const result = await requestSuggestion(
      without.grant,
      validRequest({ assignmentId, target: realTarget() }),
    );

    expect(result).toEqual({ kind: "disabled" });
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    // Kontroll: den andre siden har KI på
    const withAll = sides[full]!;
    const own = await seedKnownValues(withAll.organizationId, {});
    expect(
      (
        await requestSuggestion(
          withAll.grant,
          validRequest({ assignmentId: own, target: realTarget() }),
        )
      ).kind,
    ).toBe("suggestion");
  });

  it("en id fra en annen organisasjon i forespørselen velger aldri tilkoblingen", async () => {
    const a = await anthropicOrganization("Oppdiktet Takst A");
    const bOrganization = await createOrganization("Oppdiktet Takst B");
    await enableAi(bOrganization.id);
    const b = await employeeWithGrant(bOrganization.id);
    const assignmentId = await seedKnownValues(bOrganization.id, {});
    // A sin organisasjons-id står i forespørselen (som mål-id); B sin tilkobling brukes likevel
    const request = validRequest({ assignmentId, target: realTarget(a.organization.id) });

    const result = await requestSuggestion(b.grant, request);

    expect(result.kind).toBe("suggestion");
    expect((await aiRow(request.requestId))?.provider).toBe("fake");
    expect((await aiRow(request.requestId))?.organization_id).toBe(bOrganization.id);
    expect(adapter.complete).not.toHaveBeenCalled();
  });
});

describe("tilgang per rolle mot anthropic (R7)", () => {
  const VARIANTS = [
    { name: "takstmann", roles: ["inspector"], allowed: true },
    { name: "kontor", roles: ["office"], allowed: false },
    { name: "leder", roles: ["manager"], allowed: true },
    { name: "admin uten andre roller (regel 11)", roles: ["admin"], allowed: true },
  ] as const;

  it.each(VARIANTS)("$name: be om = $allowed", async (variant) => {
    const { organization } = await anthropicOrganization();
    const person = await employeeWithGrant(organization.id, [...variant.roles], "Test Ansatt");
    const assignmentId = await seedKnownValues(organization.id, {});
    const request = validRequest({ assignmentId, target: realTarget() });

    if (variant.allowed) {
      const result = await requestSuggestion(person.grant, request);
      expect(result.kind).toBe("suggestion");
      expect(adapter.complete).toHaveBeenCalledTimes(1);
      return;
    }
    const error = await captureError(() => requestSuggestion(person.grant, request));
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });
});
