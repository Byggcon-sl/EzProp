import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeGrant } from "@/core/access";
import {
  aiRow,
  employeeWithGrant,
  enableAi,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { createAssignment, createOrganization, resetDatabase } from "../../../tests/factories";

/*
 * Sperren for ekte leverandør bruker fast kode, ikke objektet (docs/funksjoner/fase2a-ki-
 * leverandor-testplan.md 3.2.1, kortet Omfang 6). En adapter med `code = "fake"` som ikke er det
 * samme objektet som `fakeAiProvider`, sperres ikke; alt annet enn `"fake"` sperres for prøvemålet,
 * `answer` og fritekst uten oppdrag. Mot testdatabasen, uten nettkall.
 *
 * Støtter hovedmål: KI i bunnen (en ny adapter kan aldri slippe gjennom sperren fordi den ikke er
 * det falske objektet).
 */

const swap = vi.hoisted(() => ({
  provider: null as null | {
    code: string;
    model: string;
    complete: (r: unknown) => Promise<unknown>;
  },
}));

vi.mock("./provider-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-resolution")>();
  return {
    ...actual,
    resolveAiProvider: async (grant: EmployeeGrant) =>
      swap.provider
        ? {
            kind: "enabled" as const,
            provider: swap.provider,
            model: swap.provider.model,
            features: swap.provider.code === "fake" ? null : ["language_polish"],
          }
        : actual.resolveAiProvider(grant),
  };
});

function providerWithCode(code: string) {
  const complete = vi.fn(async (_request: unknown) => ({
    outcome: "ok" as const,
    text: "Oppdiktet svar.",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0,
    currency: "NOK",
  }));
  return { code, model: "oppdiktet-modell", complete };
}

beforeEach(resetDatabase);
afterEach(() => {
  swap.provider = null;
  vi.restoreAllMocks();
});

describe("isBlocked bruker fast kode (3.2.1)", () => {
  it.each([
    { name: "ai_trial uten oppdrag", type: "ai_trial", withAssignment: false },
    { name: "answer med oppdrag", type: "answer", withAssignment: true },
    { name: "answer uten oppdrag", type: "answer", withAssignment: false },
  ])("$name: kopi med code = fake sperres ikke", async ({ type, withAssignment }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const assignmentId = withAssignment ? (await createAssignment(organization.id)).id : null;
    const provider = providerWithCode("fake");
    swap.provider = provider;
    const request = validRequest({
      assignmentId,
      target: { type, id: randomUUID(), fieldKey: "text" },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it.each(["anthropic", "unknown_vendor", "Fake", "fake "])(
    "kode %j sperres for answer med oppdrag",
    async (code) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      await enableAi(organization.id);
      const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
      const assignment = await createAssignment(organization.id);
      const provider = providerWithCode(code);
      swap.provider = provider;
      const request = validRequest({
        assignmentId: assignment.id,
        target: { type: "answer", id: randomUUID(), fieldKey: "text" },
      });

      const result = await requestSuggestion(grant, request);

      expect(result).toEqual({ kind: "blocked" });
      expect(provider.complete).not.toHaveBeenCalled();
      expect((await aiRow(request.requestId))!.outcome).toBe("blocked");
    },
  );
});
