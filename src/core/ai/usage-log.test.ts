import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRow,
  aiRowCount,
  auditCount,
  captureError,
  employeeWithGrant,
  snapshot,
} from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AiRequestRejectedError } from "./errors";
import { insertBlockedRow, toSuggestionResult, type BlockedRowInput } from "./usage-log";

/*
 * Raden for en sperret forespørsel, `insertBlockedRow` (docs/funksjoner/fase2a-vask-for-ki.md
 * Omfang 5, ad-1, testplanen V5.4, V5.5 og V10.1). Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (en sperret forespørsel står i loggen med eget utfall, skilt fra
 * «KI er av») og de ansatte (ingen tekst lagres, og forrige forslag står urørt).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function blockedInput(overrides: Partial<BlockedRowInput> = {}): BlockedRowInput {
  return {
    requestId: uuidv7(),
    feature: "language_polish",
    provider: "oppdiktet_ekte",
    model: "oppdiktet-modell",
    promptVersion: "language_polish.v1",
    assignmentId: null,
    target: { type: "answer", id: uuidv7(), fieldKey: "text" },
    sourceFields: ["text"],
    ...overrides,
  };
}

describe("toSuggestionResult: blocked", () => {
  it("en blocked-rad gir { kind: blocked } uten id og tekst", () => {
    expect(toSuggestionResult({ id: uuidv7(), outcome: "blocked", outputText: null })).toEqual({
      kind: "blocked",
    });
  });
});

describe("insertBlockedRow (ad-1)", () => {
  it("V5.1 raden har utfall blocked, ingen tekst, 0 i tokens, kostnad og treff, og retain_until 10 år", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-11T08:00:00Z"), toFake: ["Date"] });
    const { grant } = await aiOrganization();
    const input = blockedInput({
      target: { type: "answer", id: uuidv7().toUpperCase(), fieldKey: "text" },
    });
    const audits = await auditCount();

    expect(await insertBlockedRow(grant, input)).toEqual({ kind: "blocked" });

    const row = await aiRow(input.requestId);
    expect(row).toMatchObject({
      organization_id: grant.organizationId,
      employee_id: grant.employeeId,
      feature: "language_polish",
      provider: "oppdiktet_ekte",
      outcome: "blocked",
      status: null,
      output_text: null,
      error_code: null,
      tokens_in: 0,
      tokens_out: 0,
      currency: "NOK",
      redacted_count: 0,
      input_summary: {},
      source_fields: ["text"],
      deleted_at: null,
    });
    expect(Number(row!.cost)).toBe(0);
    expect(row!.target_ref.id).toBe(input.target.id.toLowerCase());
    expect(new Date(row!.retain_until).toISOString()).toBe("2036-11-11T08:00:00.000Z");
    expect(await auditCount()).toBe(audits);
  });

  it("V5.4 forrige åpne forslag på samme mål står som suggested", async () => {
    const { organization, grant } = await aiOrganization();
    const target = { type: "answer", id: uuidv7(), fieldKey: "text" };
    const open = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      targetRef: target,
    });
    const before = snapshot(await aiRow(open.id));
    await insertBlockedRow(grant, blockedInput({ target }));
    expect(snapshot(await aiRow(open.id))).toBe(before);
  });

  it("V5.5 samme requestId på nytt gir blocked, uten ny rad", async () => {
    const { grant } = await aiOrganization();
    const input = blockedInput();
    await insertBlockedRow(grant, input);
    const count = await aiRowCount();
    expect(await insertBlockedRow(grant, input)).toEqual({ kind: "blocked" });
    expect(await aiRowCount()).toBe(count);
  });

  it("samme requestId fra en annen ansatt eller for et annet mål avvises", async () => {
    const { organization, grant } = await aiOrganization();
    const input = blockedInput();
    await insertBlockedRow(grant, input);
    const other = await aiOrganization("Oppdiktet Takst B");
    const colleague = (await employeeWithGrant(organization.id, ["inspector"], "Test Kollega"))
      .grant;
    for (const [who, request] of [
      [colleague, input],
      [grant, { ...input, target: { ...input.target, id: uuidv7() } }],
      [other.grant, input],
    ] as [EmployeeGrant, BlockedRowInput][]) {
      const error = await captureError(() => insertBlockedRow(who, request));
      expect(error).toBeInstanceOf(AiRequestRejectedError);
    }
    expect(await aiRowCount()).toBe(1);
  });

  it("expectTenantIsolation: B får aldri svar fra A sin sperrede rad, og omvendt", async () => {
    const seeded = new Map<string, BlockedRowInput>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = blockedInput();
        const b = blockedInput();
        await insertBlockedRow(grantA, a);
        await insertBlockedRow(grantB, b);
        seeded.set(a.requestId, a);
        seeded.set(b.requestId, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: string[] = [];
        for (const [id, input] of seeded) {
          try {
            const result = await insertBlockedRow(grant, input);
            if (result.kind === "blocked") found.push(id);
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return found;
      },
      idOf: (id) => id,
    });
  });
});
