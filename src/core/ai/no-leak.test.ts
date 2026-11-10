import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/shared/lib/logger";
import {
  aiOrganization,
  aiRow,
  allAuditRows,
  captureError,
  fakeAiProvider,
  fakeErrorInputs,
  recordDecision,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";

/*
 * Ingen innhold på avveie (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 11, ADR 0006
 * del 5). En unik markør i inndataene skal bare kunne finnes i `output_text`, aldri i andre
 * kolonner, i `audit_log` eller i kall til `logger`. Mot testdatabasen. Oppdiktet tekst.
 *
 * Støtter hovedmål: KI i bunnen (trygg grunnmur) og færre reklamasjoner (ingen tekst fra
 * rapporten lekker til logger som mange kan lese).
 */

const MARKER = "MARKOR-7f3a";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

function spyOnLogger() {
  return [
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function loggedText(spies: ReturnType<typeof spyOnLogger>): string {
  return JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
  );
}

function withoutOutputText(row: Record<string, unknown>): string {
  const { output_text: _ignored, ...rest } = row;
  void _ignored;
  return JSON.stringify(rest);
}

describe("ingen innhold på avveie (11)", () => {
  it("11.1 vellykket kall: markøren bare i output_text, ikke i andre kolonner, audit_log eller logger", async () => {
    const { grant } = await aiOrganization();
    const spies = spyOnLogger();
    const request = validRequest({
      fields: { text: `Taket er gammelt ${MARKER} og har sprekker` },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    const row = (await aiRow(request.requestId))!;
    expect(withoutOutputText(row)).not.toContain(MARKER);
    expect(JSON.stringify(await allAuditRows())).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);
  });

  it("11.2 feilveien, fake gir error: markøren ikke i raden, audit_log eller logger", async () => {
    const { grant } = await aiOrganization();
    const spies = spyOnLogger();
    const request = validRequest({
      fields: { text: `${fakeErrorInputs()[0]} ${MARKER}` },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("error");
    const row = (await aiRow(request.requestId))!;
    expect(JSON.stringify(row)).not.toContain(MARKER);
    expect(JSON.stringify(await allAuditRows())).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);
  });

  it("11.2 feilveien, fake kaster med markøren i meldingen: loggkallet har bare funksjon, leverandør, kode og id", async () => {
    const { grant } = await aiOrganization();
    const spies = spyOnLogger();
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(
      new Error(`leverandøren sa noe med ${MARKER}`),
    );
    const request = validRequest({ fields: { text: `Taket ${MARKER}` } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("error");
    const row = (await aiRow(request.requestId))!;
    expect(JSON.stringify(row)).not.toContain(MARKER);
    expect(JSON.stringify(await allAuditRows())).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);

    // Feilen logges (testplanen 11.2), uten innhold: bare kjente felt
    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(calls.length).toBeGreaterThan(0);
    const allowedKeys = new Set([
      "feature",
      "provider",
      "providerCode",
      "errorCode",
      "error_code",
      "usageId",
      "id",
      "requestId",
      "organizationId",
    ]);
    for (const [, fields] of calls) {
      if (fields === undefined) continue;
      expect(fields).not.toHaveProperty("error");
      for (const key of Object.keys(fields as Record<string, unknown>)) {
        expect(allowedKeys.has(key), `uventet felt i loggen: ${key}`).toBe(true);
      }
    }
    expect(JSON.stringify(calls)).toContain(request.requestId);
  });

  it("11.3 avslag (felt utenfor tillatt-listen med markøren): ikke i feilmeldingen eller logger", async () => {
    const { grant } = await aiOrganization();
    const spies = spyOnLogger();
    const request = validRequest({ fields: { text: "Taket er gammelt", email: MARKER } });

    const error = await captureError(() => requestSuggestion(grant, request));

    expect(error.message).not.toContain(MARKER);
    expect(String(error.stack ?? "")).not.toContain(MARKER);
    expect(JSON.stringify(error)).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);
  });

  it("11.3 avslag (for lang tekst med markøren): ikke i feilmeldingen eller logger", async () => {
    const { grant } = await aiOrganization();
    const spies = spyOnLogger();
    const text = `${MARKER} ${"a".repeat(5001)}`;
    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { text } })),
    );
    expect(error.message).not.toContain(MARKER);
    expect(JSON.stringify(error)).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);
  });

  it("11.4 recordDecision: markør i output_text finnes ikke i audit_log eller logger", async () => {
    const { organization, grant } = await aiOrganization();
    const spies = spyOnLogger();
    const row = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      outputText: `Forslag ${MARKER}`,
    });
    await recordDecision(grant, row.id, "accepted");
    await recordDecision(grant, row.id, "undo");
    await recordDecision(grant, row.id, "rejected");
    expect(JSON.stringify(await allAuditRows())).not.toContain(MARKER);
    expect(loggedText(spies)).not.toContain(MARKER);
  });
});
