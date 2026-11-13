import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRow,
  aiRowCount,
  auditCount,
  captureError,
  employeeWithGrant,
  fakeErrorInputs,
  fakeNoMatchInput,
  mergeOrganizationSettings,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AiRequestRejectedError } from "./errors";
import { addYears, insertBlockedRow, retainUntilFrom, toSuggestionResult } from "./usage-log";

/*
 * Sperret forespørsel i KI-loggen (docs/funksjoner/fase2a-vask-for-ki.md Omfang 5, ad-1;
 * testplanen avsnitt 5 og 10). Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (sperret forespørsel står i loggen med eget utfall, skilt fra
 * «KI er av») og færre reklamasjoner (ingen tekst, tokens eller kostnad på en sperret rad).
 */

beforeEach(resetDatabase);

function blockedInput(overrides: { requestId?: string; targetId?: string } = {}) {
  return {
    requestId: overrides.requestId ?? uuidv7(),
    feature: "language_polish",
    provider: "oppdiktet-ekte",
    model: "oppdiktet-modell",
    promptVersion: "language_polish.v1",
    assignmentId: null,
    target: { type: "answer", id: overrides.targetId ?? uuidv7(), fieldKey: "text" },
    sourceFields: ["text"],
  };
}

describe("toSuggestionResult: utfallet blocked", () => {
  it("V5.5 en rad med outcome blocked gir { kind: blocked } uten id eller tekst", () => {
    expect(toSuggestionResult({ id: uuidv7(), outcome: "blocked", outputText: null })).toEqual({
      kind: "blocked",
    });
  });
});

describe("insertBlockedRow (V5.1, V5.4, V5.5, V10.1)", () => {
  it("V5.1 skriver blocked-rad uten forslag, status, feilkode, tokens, kostnad og vaskede treff", async () => {
    const { organization, grant } = await aiOrganization();
    const auditBefore = await auditCount();
    const input = blockedInput();

    expect(await insertBlockedRow(grant, input)).toEqual({ kind: "blocked" });

    const row = (await aiRow(input.requestId))!;
    expect(row.organization_id).toBe(organization.id);
    expect(row.employee_id).toBe(grant.employeeId);
    expect(row.outcome).toBe("blocked");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(Number(row.cost)).toBe(0);
    expect(row.currency).toBe("NOK");
    expect(row.redacted_count).toBe(0);
    expect(row.input_summary).toEqual({});
    expect(row.source_fields).toEqual(["text"]);
    expect(row.provider).toBe("oppdiktet-ekte");
    // Ny rad gir ingen linje i revisjonsloggen (bare statusendringer gjør det)
    expect(await auditCount()).toBe(auditBefore);
  });

  it("V10.1 retain_until er opprettet + 10 år", async () => {
    const { grant } = await aiOrganization();
    const input = blockedInput();
    await insertBlockedRow(grant, input);
    const row = (await aiRow(input.requestId))!;
    expect(new Date(row.retain_until).getTime()).toBe(
      retainUntilFrom(new Date(row.created_at)).getTime(),
    );
  });

  it("V5.4 forrige åpne forslag på samme mål står som suggested", async () => {
    const { organization, grant } = await aiOrganization();
    const targetId = uuidv7();
    const previous = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      targetRef: { type: "answer", id: targetId, fieldKey: "text" },
    });
    await insertBlockedRow(grant, blockedInput({ targetId }));
    expect((await aiRow(previous.id))!.status).toBe("suggested");
  });

  it("V5.5 samme requestId igjen gir blocked uten ny rad", async () => {
    const { grant } = await aiOrganization();
    const input = blockedInput();
    await insertBlockedRow(grant, input);
    const count = await aiRowCount();
    expect(await insertBlockedRow(grant, input)).toEqual({ kind: "blocked" });
    expect(await aiRowCount()).toBe(count);
  });

  it("V5.5 samme requestId fra en annen ansatt eller annet mål gir nøytralt avslag", async () => {
    const { organization, grant } = await aiOrganization();
    const input = blockedInput();
    await insertBlockedRow(grant, input);
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const fromOther = await captureError(() => insertBlockedRow(other.grant, input));
    expect(fromOther).toBeInstanceOf(AiRequestRejectedError);
    const otherTarget = await captureError(() =>
      insertBlockedRow(grant, { ...input, target: { ...input.target, id: uuidv7() } }),
    );
    expect(otherTarget).toBeInstanceOf(AiRequestRejectedError);
  });

  it("V7.3 expectTenantIsolation: B kan ikke gjenbruke A sin id, og omvendt", async () => {
    const seeded: { id: string; target: string }[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = blockedInput();
        const b = blockedInput();
        await insertBlockedRow(grantA, a);
        await insertBlockedRow(grantB, b);
        seeded.push(
          { id: a.requestId, target: a.target.id },
          { id: b.requestId, target: b.target.id },
        );
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: { id: string }[] = [];
        for (const { id, target } of seeded) {
          try {
            const result = await insertBlockedRow(
              grant,
              blockedInput({ requestId: id, targetId: target }),
            );
            if (result.kind === "blocked") found.push({ id });
          } catch (error) {
            if (!(error instanceof AiRequestRejectedError)) throw error;
          }
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });
});

/*
 * K7 (docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md 2b, L1): en ny rad får alltid
 * 10 år, uansett innstillingen for avviste forslag. Bare en avvisning bruker innstillingen.
 */
describe("K7 L1 ny rad får alltid 10 år", () => {
  async function expectTenYears(id: string) {
    const row = (await aiRow(id))!;
    expect(new Date(row.retain_until).toISOString()).toBe(
      addYears(new Date(row.created_at), 10).toISOString(),
    );
    expect(row.deleted_at).toBeNull();
  }

  it("L1 ny rad får alltid 10 år, uansett innstilling (ok, no_match, error og blocked)", async () => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { "ai.rejected_retention_years": 1 });

    const ok = validRequest();
    expect((await requestSuggestion(grant, ok)).kind).toBe("suggestion");
    await expectTenYears(ok.requestId);

    const noMatch = validRequest({ fields: { text: fakeNoMatchInput() } });
    expect((await requestSuggestion(grant, noMatch)).kind).toBe("no_match");
    await expectTenYears(noMatch.requestId);

    for (const text of fakeErrorInputs()) {
      const failed = validRequest({ fields: { text } });
      expect((await requestSuggestion(grant, failed)).kind).toBe("error");
      await expectTenYears(failed.requestId);
    }

    const blocked = blockedInput();
    expect(await insertBlockedRow(grant, blocked)).toEqual({ kind: "blocked" });
    await expectTenYears(blocked.requestId);
  });
});
