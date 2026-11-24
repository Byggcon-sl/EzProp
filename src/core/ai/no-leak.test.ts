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
import { candidate, createAiReportChain } from "../../../tests/ai-report";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { seedKnownValues } from "../../../tests/known-values";
import { uuidv7 } from "@/shared/lib/uuid";
import { AI_FEATURES, findFieldSourceViolations, PROMPT_INPUT_SEPARATOR } from "./features";
import { NEVER_FIELDS } from "./never-fields";
import { extractPlaceholders } from "./guards";
import { findPromptLeaks } from "./prompt-leaks";
import { loadKnownValues } from "./redaction";
import { requestSuggestion as requestWithServerInput } from "./request-suggestion";

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
      JSON.stringify(complete.mock.calls),
    ]
      .join("\n")
      // Tilfeldige id-er (UUID) kan inneholde for eksempel «8099»; de er ikke persondata.
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]");
    for (const value of VALUES) expect(seen, value).not.toContain(value);
    // A466: bare teksten til klienten får verdiene tilbake, i minnet under kallet
    if (result.kind === "suggestion") {
      expect(result.text).toContain("Åse Testesen");
      expect(result.text).toContain("12345678");
    }

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

/*
 * «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md 4e, K4.22–K4.24): kandidater og funn
 * vaskes hver for seg, felt som aldri skal til KI kan ikke gis inn, og loggen har bare antall og
 * `{ source, id }`. Kjernedelen; serverinngangene i rapportkjernen prøves der. Alle verdier er
 * oppdiktet (gnr 999, «Åse Testesen», 12345678, ase.testesen@eksempel.no, «Testveien 1»).
 */
describe("KI i veien: vask av kandidater og funn (K4.22–K4.24)", () => {
  const PII = ["Åse", "Testesen", "12345678", "ase.testesen@eksempel.no", "Testveien", "999/34"];

  async function setup() {
    const { organization, grant } = await aiOrganization();
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen", phone: "12345678", email: "ase.testesen@eksempel.no" }],
      property: { address: "Testveien 1", gnr: "999", bnr: "34" },
    });
    const chain = await createAiReportChain(organization.id, { assignmentId });
    const known = await loadKnownValues(grant, assignmentId);
    return { grant, chain, known };
  }

  function promptOf(spy: { mock: { calls: unknown[][] } }): string {
    return (spy.mock.calls[0]![0] as { prompt: string }).prompt;
  }

  it("K4.22 phrase_suggest: kandidattekst og felt med persondata når aldri leverandøren", async () => {
    const { grant, chain, known } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = {
      requestId: uuidv7(),
      feature: "phrase_suggest" as const,
      assignmentId: null,
      reportId: null,
      target: { type: "deviation", id: chain.deviationId, fieldKey: "cause_text" },
      fields: { text: "Åse Testesen ringte", outcome_key: "membrane_crack", group: "tg2" },
    };
    await requestWithServerInput(grant, request, {
      candidates: [
        candidate("Ring Åse Testesen på 12345678 om sluket"),
        candidate("Skriv til ase.testesen@eksempel.no om Testveien 1, gnr 999 bnr 34"),
      ],
    });
    const prompt = promptOf(spy);
    for (const value of PII) expect(prompt, value).not.toContain(value);
    expect(findPromptLeaks(prompt, known)).toEqual([]);
    const row = (await aiRow(request.requestId))!;
    // Antall vasket = antall plassholdere i det leverandøren fikk
    expect(row.redacted_count).toBe(extractPlaceholders(prompt).length);
    expect(row.redacted_count).toBeGreaterThanOrEqual(6);
    // K4.24 bare tall i input_summary, bare { source, id } i candidate_refs
    for (const value of Object.values(row.input_summary as Record<string, unknown>)) {
      expect(typeof value).toBe("number");
    }
    for (const ref of (row.candidate_refs ?? []) as Record<string, unknown>[]) {
      expect(Object.keys(ref).sort()).toEqual(["id", "source"]);
    }
    expect(JSON.stringify(row)).not.toContain("sluket");
  });

  it("K4.22 summary_draft: funn, tiltak og TGIU-linjer med persondata når aldri leverandøren", async () => {
    const { grant, chain, known } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = {
      requestId: uuidv7(),
      feature: "summary_draft" as const,
      assignmentId: null,
      reportId: null,
      target: { type: "report", id: chain.reportId, fieldKey: "summary_text" },
      fields: {},
    };
    await requestWithServerInput(grant, request, {
      summaryGroups: [
        {
          group: "tg2",
          heading: "TG2 Vesentlige avvik",
          findings: [
            {
              checkpointName: "Sluk",
              deviationText: "Åse Testesen opplyste om lekkasje",
              causeText: "Ring 12345678",
              consequenceText: "Skriv til ase.testesen@eksempel.no",
              measures: ["Kontakt eier i Testveien 1, gnr 999 bnr 34"],
            },
          ],
          fixedLines: [],
        },
        {
          group: "tgiu",
          heading: "TGIU Ikke undersøkt",
          findings: [],
          fixedLines: [{ checkpointName: "Hulltaking", text: "Åse Testesen sa nei" }],
        },
      ],
    });
    const prompt = promptOf(spy);
    for (const value of PII) expect(prompt, value).not.toContain(value);
    expect(prompt).not.toContain("Hulltaking");
    expect(findPromptLeaks(prompt, known)).toEqual([]);
    const row = (await aiRow(request.requestId))!;
    // Antall vasket = antall plassholdere i det leverandøren fikk (TGIU-linjen sendes ikke)
    expect(row.redacted_count).toBe(extractPlaceholders(prompt).length);
    expect(row.redacted_count).toBeGreaterThanOrEqual(5);
    for (const value of PII) expect(row.output_text ?? "", value).not.toContain(value);
    for (const value of Object.values(row.input_summary as Record<string, unknown>)) {
      expect(typeof value).toBe("number");
    }
  });

  it.each([
    { name: "romnavn", key: "roomName" },
    { name: "etasje", key: "floorName" },
    { name: "bygning", key: "buildingName" },
    { name: "eier informert", key: "ownerInformed" },
    { name: "bildetekst", key: "imageCaption" },
    { name: "interne notater", key: "internalNote" },
    { name: "kostnad", key: "costAmount" },
  ])("K4.23 et funn med $name kan ikke gis inn (strengt skjema), intet kall", async ({ key }) => {
    const { grant, chain } = await setup();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const finding = {
      checkpointName: "Sluk",
      deviationText: "Klemringen mangler",
      causeText: null,
      consequenceText: null,
      measures: [],
      [key]: "Mxq-merke-ÆØ",
    };
    await expect(
      requestWithServerInput(
        grant,
        {
          requestId: uuidv7(),
          feature: "summary_draft",
          assignmentId: null,
          reportId: null,
          target: { type: "report", id: chain.reportId, fieldKey: "summary_text" },
          fields: {},
        },
        {
          summaryGroups: [{ group: "tg2", heading: "TG2", findings: [finding], fixedLines: [] }],
        },
      ),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("K4.23 tillatt-listene er grønne og de nye «aldri»-kolonnene står på listen", () => {
    expect(findFieldSourceViolations(Object.values(AI_FEATURES))).toEqual([]);
    for (const column of [
      "rooms.name",
      "floors.name",
      "report_buildings.name",
      "tgiu_details.owner_informed",
      "deviations.cost_amount",
      "deviations.cost_text",
      "assignments.internal_note",
    ]) {
      expect(NEVER_FIELDS, column).toContain(column);
    }
  });
});
