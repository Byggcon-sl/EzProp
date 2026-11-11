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
import { seedKnownValues } from "../../../tests/known-values";
import { PROMPT_INPUT_SEPARATOR } from "./features";

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

/*
 * Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md V4.4, kortet Omfang 2 og 4, A172).
 * De kjente verdiene lever bare i minnet under kallet: de finnes ikke i raden (`input_summary`,
 * `source_fields`, `target_ref` og resten), i `audit_log`, i loggeren eller i svaret. Alle
 * verdier er oppdiktet.
 */
describe("vask før KI: ingen lekkasje av persondata (V4.4)", () => {
  const VALUES = [
    "Åse",
    "Testesen",
    "12345678",
    "ase.testesen@example.no",
    "Prøvetunet",
    "Testvik",
    "8099",
    "12/34",
    "01019912345",
  ];

  it("V4.4 verdiene finnes ikke i raden, audit_log, logger eller svaret; input_summary er regnet av vasket tekst", async () => {
    const { organization, grant } = await aiOrganization();
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen", email: "ase.testesen@example.no", phone: "12345678" }],
      property: {
        address: "Prøvetunet 7",
        postalCode: "8099",
        city: "Testvik",
        gnr: "12",
        bnr: "34",
      },
    });
    const spies = spyOnLogger();
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const text =
      "Åse Testesen (ase.testesen@example.no, 12345678) bor i Prøvetunet 7, 8099 Testvik, " +
      "eiendom 12/34. Personnummer 01019912345.";
    const request = validRequest({ assignmentId, fields: { text } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    const row = (await aiRow(request.requestId))!;
    const seen = [
      JSON.stringify(row),
      JSON.stringify(await allAuditRows()),
      loggedText(spies),
      JSON.stringify(result),
      JSON.stringify(complete.mock.calls),
    ].join("\n");
    for (const value of VALUES) expect(seen, value).not.toContain(value);

    // input_summary er antall tegn i den vaskede teksten, ikke i originalen
    const prompt = complete.mock.calls[0]![0].prompt;
    const sent = prompt.slice(
      prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR) + PROMPT_INPUT_SEPARATOR.length,
    );
    expect(row.input_summary).toEqual({ text: sent.length });
    expect(sent.length).not.toBe(text.length);
    expect(row.source_fields).toEqual(["text"]);
  });
});
