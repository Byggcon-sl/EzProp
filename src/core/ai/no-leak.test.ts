import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiRequestRejectedError,
  FAKE_ERROR_INPUT,
  fakeAiProvider,
  recordDecision,
  requestSuggestion,
} from "@/core/ai";
import { logger } from "@/shared/lib/logger";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import {
  aiOrganization,
  auditRows,
  polishField,
  polishRequest,
  polishTarget,
  usageRow,
} from "../../../tests/ai";

/*
 * Ingen innhold på avveie (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 11,
 * ADR 0006 del 5). En unik markør i inndataene skal bare kunne havne i `output_text` (fordi `fake`
 * kan gjenta den), aldri i andre kolonner, i `audit_log` eller i `logger`. Alle data er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (tekst fra befaringen lekker ikke ut i logger) og
 * færre reklamasjoner (revisjonsloggen viser hvem som gjorde hva, ikke innholdet).
 */

const MARKER = "MARKOR-7f3a";
const field = polishField();
const LEVELS = ["debug", "info", "warn", "error"] as const;

let loggerSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(fakeAiProvider, "complete");
  loggerSpies = LEVELS.map((level) => vi.spyOn(logger, level));
});
afterEach(() => vi.restoreAllMocks());

function loggedText(): string {
  return JSON.stringify(loggerSpies.map((spy) => spy.mock.calls));
}

async function expectNoMarkerOutsideOutput(usageId: string) {
  const row = await usageRow(usageId);
  expect(row, "raden finnes").not.toBeNull();
  const { outputText: _outputText, ...rest } = row!;
  expect(JSON.stringify(rest)).not.toContain(MARKER);
  expect(JSON.stringify(await auditRows())).not.toContain(MARKER);
  expect(loggedText()).not.toContain(MARKER);
}

describe("ingen innhold på avveie (11)", () => {
  it("11.1 vellykket kall: markøren bare i output_text", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    // Et forrige forslag på målet, så kallet også skriver i revisjonsloggen
    await createAiUsageLog(organization.id, { targetRef: target });
    const request = polishRequest({
      target,
      fields: { [field]: `kledningen er råteskadet ${MARKER}` },
    });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("suggestion");
    expect((await auditRows()).length).toBeGreaterThan(0);
    await expectNoMarkerOutsideOutput(request.requestId);
  });

  it("11.2 feilveien: fake gir error → markøren finnes ikke i raden, audit_log eller logger", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: `${FAKE_ERROR_INPUT} ${MARKER}` } });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("error");
    const row = (await usageRow(request.requestId))!;
    expect(JSON.stringify(row)).not.toContain(MARKER);
    await expectNoMarkerOutsideOutput(request.requestId);
  });

  it("11.2 feilveien: fake kaster med markøren i meldingen → markøren finnes ikke noe sted", async () => {
    const { inspector } = await aiOrganization();
    vi.mocked(fakeAiProvider.complete).mockRejectedValue(
      new Error(`leverandøren feilet på «${MARKER}»`),
    );
    const request = polishRequest({ fields: { [field]: `taket lekker ${MARKER}` } });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("error");
    const row = (await usageRow(request.requestId))!;
    expect(JSON.stringify(row)).not.toContain(MARKER);
    await expectNoMarkerOutsideOutput(request.requestId);
  });

  it("11.2 loggkallet på feilveien har bare funksjon, leverandørkode, feilkode og id", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: `${FAKE_ERROR_INPUT} ${MARKER}` } });

    await requestSuggestion(inspector.grant, request);

    const calls = loggerSpies.flatMap((spy) => spy.mock.calls);
    expect(calls.length, "feilen logges").toBeGreaterThan(0);
    for (const [, fields] of calls) {
      const values = Object.values((fields ?? {}) as Record<string, unknown>);
      for (const value of values) {
        expect(["string", "number", "undefined"]).toContain(typeof value);
      }
      const text = JSON.stringify(fields ?? {});
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain("taket");
      expect(text).toContain(request.requestId);
      expect(text).toContain("fake");
      expect(text).toContain("language_polish");
    }
  });

  it("11.3 avslag: felt utenfor tillatt-listen med markøren → ikke i feilmeldingen eller logger", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: "kort tekst", email: MARKER } });

    const error = await requestSuggestion(inspector.grant, request).catch((e) => e);

    expect(error).toBeInstanceOf(AiRequestRejectedError);
    expect(String(error)).not.toContain(MARKER);
    expect(JSON.stringify(error)).not.toContain(MARKER);
    expect(String((error as Error).stack ?? "")).not.toContain(MARKER);
    expect(loggedText()).not.toContain(MARKER);
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
  });

  it("11.3 avslag: for lang verdi med markøren → ikke i feilmeldingen eller logger", async () => {
    const { inspector } = await aiOrganization();
    const request = polishRequest({ fields: { [field]: `${MARKER}${"a".repeat(5001)}` } });

    const error = await requestSuggestion(inspector.grant, request).catch((e) => e);

    expect(error).toBeInstanceOf(AiRequestRejectedError);
    expect(String(error)).not.toContain(MARKER);
    expect(JSON.stringify(error)).not.toContain(MARKER);
    expect(loggedText()).not.toContain(MARKER);
  });

  it("11.4 recordDecision: markør i output_text finnes ikke i audit_log eller logger", async () => {
    const { organization, inspector } = await aiOrganization();
    const row = await createAiUsageLog(organization.id, {
      outputText: `Forslaget nevner ${MARKER}.`,
    });

    await recordDecision(inspector.grant, row.id, "accepted");
    await recordDecision(inspector.grant, row.id, "undo");
    await recordDecision(inspector.grant, row.id, "rejected");

    expect((await auditRows()).length).toBe(3);
    expect(JSON.stringify(await auditRows())).not.toContain(MARKER);
    expect(loggedText()).not.toContain(MARKER);
  });
});
