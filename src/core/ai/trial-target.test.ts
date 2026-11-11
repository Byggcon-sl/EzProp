import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeGrant } from "@/core/access";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiRow,
  aiRowCount,
  allAiRows,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  fakeAiProvider,
  neutralRequestRejection,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import type { AiProvider } from "./providers/types";

/*
 * Vakten for prøvemålet `ai_trial` (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 2,
 * kortet Omfang 4, A166). Målet godtas bare når organisasjonens leverandør på porten `ai` er den
 * falske. Ellers samme svar som «KI er av»: ingen rad, intet leverandørkall og ingen fetch.
 * Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (prøvesiden kan vise forslagsmønsteret fra første dag) og færre
 * reklamasjoner (fritekst uten vask kan aldri nå en ekte leverandør).
 */

/**
 * Lar én test late som om koden hadde en ekte adapter. Ellers brukes valget av leverandør slik
 * det er, så de andre testene prøver den ekte veien.
 */
const override = vi.hoisted(() => ({ provider: null as AiProvider | null }));
vi.mock("./provider-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-resolution")>();
  return {
    ...actual,
    resolveAiProvider: async (grant: EmployeeGrant) =>
      override.provider
        ? { kind: "enabled" as const, provider: override.provider, model: "oppdiktet-modell" }
        : actual.resolveAiProvider(grant),
  };
});

beforeEach(resetDatabase);
afterEach(() => {
  override.provider = null;
  vi.restoreAllMocks();
});

const trialTarget = (fieldKey = "text") => ({ type: "ai_trial", id: uuidv7(), fieldKey });

type Setup = "fake" | "other_provider" | "no_connection" | "ai_disabled";

async function organizationWith(setup: Setup, name = "Oppdiktet Takst A") {
  const organization = await createOrganization(name);
  if (setup === "fake") await enableAi(organization.id);
  if (setup === "other_provider") await enableAi(organization.id, { provider: "anthropic" });
  if (setup === "no_connection") await enableAi(organization.id, { connection: false });
  if (setup === "ai_disabled") await enableAi(organization.id, { enabled: false });
  const inspector = await employeeWithGrant(organization.id, ["inspector"]);
  return { organization, ...inspector };
}

describe("vakten for ai_trial: leverandør × mål (2)", () => {
  it.each([
    { name: "2.2 annen leverandørkode på porten ai", setup: "other_provider" as const },
    { name: "2.3 ingen tilkobling", setup: "no_connection" as const },
    { name: "2.4 ai.enabled = false med fake", setup: "ai_disabled" as const },
  ])("$name + ai_trial: «KI er av», ingen rad, intet kall, ingen fetch", async ({ setup }) => {
    const { grant } = await organizationWith(setup);
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const auditBefore = await auditCount();

    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));

    expect(result).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await auditCount()).toBe(auditBefore);
  });

  it("2.1 fake + ai_trial/text: forslag og én rad med målet, status suggested", async () => {
    const { grant, organization } = await organizationWith("fake");
    const target = trialTarget();
    const result = await requestSuggestion(grant, validRequest({ target }));
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    const row = await aiRow(result.usageId);
    expect(row!.target_ref).toEqual(target);
    expect(row!.status).toBe("suggested");
    expect(row!.outcome).toBe("ok");
    expect(row!.organization_id).toBe(organization.id);
  });

  it.each(["title", "tg"])(
    "2.5 ai_trial med feltet %s: nøytralt avslag, ingen rad",
    async (fieldKey) => {
      const { grant } = await organizationWith("fake");
      const baseline = await neutralRequestRejection(grant);
      const complete = vi.spyOn(fakeAiProvider, "complete");
      const error = await captureError(() =>
        requestSuggestion(grant, validRequest({ target: trialTarget(fieldKey) })),
      );
      expectSameRejection(error, baseline);
      expect(error.name).toBe("AiRequestRejectedError");
      expect(complete).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
    },
  );

  it("2.6 answer/text med fake virker fortsatt", async () => {
    const { grant } = await organizationWith("fake");
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
    const [row] = await allAiRows();
    expect((row!.target_ref as { type: string }).type).toBe("answer");
  });

  it("2.7 vakten ligger i kjernen: en annen adapter enn fake får aldri ai_trial", async () => {
    const { grant } = await organizationWith("fake");
    const imagined: AiProvider = {
      code: "oppdiktet_leverandor",
      model: "oppdiktet-modell",
      complete: vi.fn(async () => ({
        outcome: "ok" as const,
        text: "Oppdiktet svar",
        tokensIn: 1,
        tokensOut: 1,
        cost: 0,
        currency: "NOK",
      })),
    } as unknown as AiProvider;
    override.provider = imagined;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));

    // Vask før KI (A171): sperret forespørsel gir `blocked` (én rad), ikke «KI er av»
    expect(result).toEqual({ kind: "blocked" });
    expect(imagined.complete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("blocked");

    // Målet answer er også sperret mot en annen adapter til `answers` finnes (A173)
    const answer = await requestSuggestion(grant, validRequest());
    expect(answer).toEqual({ kind: "blocked" });
    expect(imagined.complete).not.toHaveBeenCalled();
  });

  it("2.8 tenant: A har fake, B annen leverandør; B får «KI er av», A sin tilkobling brukes aldri", async () => {
    const a = await organizationWith("fake", "Oppdiktet Takst A");
    const b = await organizationWith("other_provider", "Oppdiktet Takst B");
    const complete = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestSuggestion(b.grant, validRequest({ target: trialTarget() }));
    expect(result).toEqual({ kind: "disabled" });
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);

    const own = await requestSuggestion(a.grant, validRequest({ target: trialTarget() }));
    expect(own.kind).toBe("suggestion");
    const rows = await allAiRows();
    expect(rows.map((row) => row.organization_id)).toEqual([a.organization.id]);
  });
});
