import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  AI_ERROR_CODES,
  aiOrganization,
  aiRow,
  aiRowCount,
  allAuditRows,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  fakeAiProvider,
  fakeErrorInputs,
  fakeNoMatchInput,
  mergeOrganizationSettings,
  neutralRequestRejection,
  recordDecision,
  requestSuggestion,
  SAMPLE_TEXT,
  snapshot,
  tenYearsAfter,
  validRequest,
  validTarget,
  type AiRequestForTest,
} from "../../../tests/ai";
import {
  createAiUsageLog,
  createAssignment,
  createOrganization,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import {
  containsWord,
  placeholderCounts,
  seedKnownValues,
  type KnownSeed,
} from "../../../tests/known-values";
import { capturing, evalCases, evalFile, makeCasesDir, removeDir } from "../../../tests/evals";
import { stubFailingRegExp } from "../../../tests/failing-regexp";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { AiRequestRejectedError } from "./errors";
import { PROMPT_INPUT_SEPARATOR } from "./features";
import type { AiProvider } from "./providers/types";
import { preparePrompt } from "./prompt";
import { emptyKnownValues, loadKnownValues, type KnownValues } from "./redaction";
import { addYears } from "./usage-log";

/*
 * `requestSuggestion` (docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 6, 9.1–9.3 og
 * 10.2–10.3; kortet Omfang 3 og avklaringene A–C) og vasken før KI i `requestSuggestion`
 * (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 4, 5 og 7). Mot testdatabasen med den
 * falske leverandøren.
 * Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn, alt logges likt), de ansatte (gjentatte kall fra
 * iPaden gir samme svar og ingen dobbel rad) og færre reklamasjoner (et forslag kan aldri avgjøres
 * eller leses av en annen organisasjon, og hvem som ba om hva står i loggen).
 */

const SECRET_MARKER = "hemmelig-markør";

/*
 * Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 4, 5 og 7): leverandøren og
 * oppslaget av kjente verdier kan byttes ut i én test. Standard er de ekte funksjonene, så de andre
 * testene prøver den ekte veien.
 *
 * Flyttet med vilje fra `redactFields` til `loadKnownValues` (evalueringssett, testplanen
 * «Presisering fra prosjektleder» og E5.2): vasken er nå den rene `preparePrompt`, og bare
 * oppslaget går mot databasen. Påstandene er de samme: oppslaget skjer én gang med `grant` og
 * oppdraget, og aldri ved sperre, «KI er av» eller avslag.
 */
const swap = vi.hoisted(() => ({
  provider: null as null | {
    code: string;
    model: string;
    complete: (request: unknown) => Promise<unknown>;
  },
  load: null as null | ((grant: unknown, assignmentId: string) => Promise<unknown>),
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
            features: null,
          }
        : actual.resolveAiProvider(grant),
  };
});

vi.mock("./redaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redaction")>();
  return {
    ...actual,
    loadKnownValues: vi.fn((grant: EmployeeGrant, assignmentId: string) =>
      swap.load
        ? (swap.load(grant, assignmentId) as ReturnType<typeof actual.loadKnownValues>)
        : actual.loadKnownValues(grant, assignmentId),
    ),
  };
});

/*
 * Rekkefølgen i T-0001-testene (rett-t0001-synkko-testplan.md 2c): vasken skal ikke nås ved avslag.
 * Vasken er nå `preparePrompt`; den ekte funksjonen kjøres, kallene telles.
 */
vi.mock("./prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt")>();
  return { ...actual, preparePrompt: vi.fn(actual.preparePrompt) };
});

beforeEach(resetDatabase);
afterEach(() => {
  vi.mocked(preparePrompt).mockClear();
  swap.provider = null;
  swap.load = null;
  vi.mocked(loadKnownValues).mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

/** Leaf-verdiene i et JSON-objekt. */
function leaves(value: unknown): unknown[] {
  if (value === null || typeof value !== "object") return [value];
  return Object.values(value as Record<string, unknown>).flatMap(leaves);
}

const trialTarget = () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" });

/** Antall oppslag av kjente verdier (bare med oppdrag). */
function lookupCalls(): number {
  return vi.mocked(loadKnownValues).mock.calls.length;
}

/** Teksten fra den ansatte slik leverandøren fikk den (etter skillet i ledeteksten). */
function sentInput(prompt: string): string {
  const index = prompt.lastIndexOf(PROMPT_INPUT_SEPARATOR);
  return index === -1 ? prompt : prompt.slice(index + PROMPT_INPUT_SEPARATOR.length);
}

/** Om verdien finnes i teksten: som eget ord for tekst, som delstreng for tall og e-post. */
function stillThere(text: string, value: string): boolean {
  if (/^[\p{L}\s'-]+$/u.test(value)) return containsWord(text, value);
  return text.normalize("NFC").toLowerCase().includes(value.normalize("NFC").toLowerCase());
}

/** Organisasjon med KI på (`fake`), en takstmann og et oppdrag med de kjente verdiene. */
async function organizationWithKnownValues(seed: KnownSeed) {
  const ai = await aiOrganization();
  const assignmentId = await seedKnownValues(ai.organization.id, seed);
  return { ...ai, assignmentId };
}

/** Sender teksten til `language_polish` på oppdraget og gir det leverandøren fikk. */
async function sendAndCapture(grant: EmployeeGrant, assignmentId: string | null, text: string) {
  const spy = vi.spyOn(fakeAiProvider, "complete");
  const request = validRequest({ assignmentId, fields: { text } });
  const result = await requestSuggestion(grant, request);
  expect(spy, "leverandøren skulle vært kalt én gang").toHaveBeenCalledTimes(1);
  const prompt = spy.mock.calls[0]![0].prompt;
  return { request, result, prompt, input: sentInput(prompt) };
}

type ColumnCase = { column: string; seed: KnownSeed; text: string; gone: string[] };

/** Én rad per kolonne i kortets punkt 2 (V4.1). `gone` må ikke finnes i ledeteksten. */
const COLUMN_CASES: ColumnCase[] = [
  {
    column: "assignment_parties.name (hel frase, fornavn, etternavn, annen skrift)",
    seed: { parties: [{ name: "Åse Testesen" }] },
    text: "Møtte Åse Testesen. Senere kom åse alene, og TESTESEN ringte.",
    gone: ["Åse Testesen", "Åse", "Testesen"],
  },
  {
    column: "assignment_parties.firm_name",
    seed: { parties: [{ name: "Qxz Partsen", firmName: "Prøvemegling Nordtest AS" }] },
    text: "Oppdraget kom fra Prøvemegling Nordtest AS i fjor.",
    gone: ["Prøvemegling Nordtest AS"],
  },
  {
    column: "assignment_parties.email",
    seed: { parties: [{ name: "Qxz Partsen", email: "qxz.partsen@example.no" }] },
    text: "Svar sendt til QXZ.Partsen@example.no i dag.",
    gone: ["qxz.partsen@example.no"],
  },
  {
    column: "assignment_parties.phone",
    seed: { parties: [{ name: "Qxz Partsen", phone: "+47 41 23 45 67" }] },
    text: "Ring 41234567 eller 412 34 567 for nøkkel.",
    gone: ["41234567", "412 34 567"],
  },
  {
    column: "contacts.first_name og contacts.last_name",
    seed: { partyContacts: [{ firstName: "Kåre", lastName: "Kontaktesen" }] },
    text: "Kåre Kontaktesen viste rundt. KÅRE sa at kontaktesen eier boden.",
    gone: ["Kåre Kontaktesen", "Kåre", "Kontaktesen"],
  },
  {
    column: "contacts.email",
    seed: { partyContacts: [{ firstName: "Qxzkon", email: "kontakt.prove@example.no" }] },
    text: "Kopi til kontakt.prove@example.no.",
    gone: ["kontakt.prove@example.no"],
  },
  {
    column: "contacts.phone",
    seed: { partyContacts: [{ firstName: "Qxzkon", phone: "93456781" }] },
    text: "Kontakten nås på 934 56 781.",
    gone: ["934 56 781", "93456781"],
  },
  {
    column: "firms.name",
    seed: { partyFirms: [{ name: "Rørlegger Prøvesen AS", orgNumber: null }] },
    text: "Røropplegget er lagt av Rørlegger Prøvesen AS.",
    gone: ["Rørlegger Prøvesen AS"],
  },
  {
    column: "firms.org_number",
    seed: { partyFirms: [{ name: "Qxzfirma AS", orgNumber: "000444555" }] },
    text: "Faktura merket 000444555.",
    gone: ["000444555"],
  },
  {
    column: "orders.ordered_by_contact_id (navn, e-post, telefon)",
    seed: {
      order: {
        orderedByContact: {
          firstName: "Berit",
          lastName: "Bestillersen",
          email: "berit.b@example.no",
          phone: "45678912",
        },
      },
    },
    text: "Bestilt av Berit Bestillersen (berit.b@example.no, 45678912). Bestillersen var hjemme.",
    gone: ["Berit Bestillersen", "Bestillersen", "Berit", "berit.b@example.no", "45678912"],
  },
  {
    column: "orders.ordered_by_firm_id (navn og org.nr.)",
    seed: { order: { orderedByFirm: { name: "Testmegling Vest AS", orgNumber: "000555666" } } },
    text: "Bestiller er Testmegling Vest AS, org.nr. 000555666.",
    gone: ["Testmegling Vest AS", "000555666"],
  },
  {
    column: "orders.ordered_by_text",
    seed: { order: { orderedByText: "Oppgjør og Megling Test AS" } },
    text: "Bestilt via Oppgjør og Megling Test AS.",
    gone: ["Oppgjør og Megling Test AS"],
  },
  {
    column: "orders.address_text",
    seed: { order: { addressText: "Måketunet 9, 8098 Prøvevåg" } },
    text: "Befaring på Måketunet 9, 8098 Prøvevåg. Måketunet har felles innkjørsel.",
    gone: ["Måketunet", "8098", "Prøvevåg"],
  },
  {
    column: "orders.gnr/bnr/snr",
    seed: { order: { gnr: "41", bnr: "52", snr: "6" } },
    text: "Eiendommen 41/52/0/6 og 41/52 er befart.",
    gone: ["41/52"],
  },
  {
    column: "orders.housing_association_name",
    seed: { order: { housingAssociationName: "Sameiet Prøvehagen" } },
    text: "Styret i Sameiet Prøvehagen har gitt nøkkel.",
    gone: ["Sameiet Prøvehagen"],
  },
  {
    column: "employees.name via assignment_team_members",
    seed: { team: [{ name: "Tor Takstesen" }] },
    text: "Befart av Tor Takstesen. Takstesen tok bilder, og tor målte.",
    gone: ["Tor Takstesen", "Takstesen", "Tor"],
  },
  {
    column: "properties.address",
    seed: { property: { address: "Lundetunet 3" } },
    text: "Huset Lundetunet 3 er gult, og Lundetunet er stille.",
    gone: ["Lundetunet"],
  },
  {
    column: "properties.postal_code og properties.city",
    seed: { property: { postalCode: "8097", city: "Qxzvik" } },
    text: "Vi kjørte til 8097 Qxzvik, og Qxzvik har ferje.",
    gone: ["Qxzvik", "8097"],
  },
  {
    column: "properties.municipality_name",
    seed: { property: { municipalityName: "Prøvekommune" } },
    text: "Byggesaken ligger hos Prøvekommune.",
    gone: ["Prøvekommune"],
  },
  {
    column: "properties.municipality_number med matrikkelen",
    seed: { property: { municipalityNumber: "1898", gnr: "61", bnr: "72" } },
    text: "Matrikkel 1898-61/72 er riktig.",
    gone: ["1898", "61/72"],
  },
  {
    column: "cadastral_units.gnr/bnr/fnr/snr",
    seed: { property: { gnr: "63", bnr: "74", fnr: "2", snr: "8" } },
    text: "Seksjonen 63/74/2/8 er befart, og gnr 63 er samme gård.",
    gone: ["63/74", "gnr 63"],
  },
  {
    column: "cadastral_units.share_number",
    seed: { property: { shareNumber: "29" } },
    text: "Leiligheten har andelsnummer 29 i laget.",
    gone: ["andelsnummer 29"],
  },
  {
    column: "cadastral_units.association_name",
    seed: { property: { associationName: "Borettslaget Testtunet" } },
    text: "Borettslaget Testtunet har vedlikeholdsplan.",
    gone: ["Borettslaget Testtunet"],
  },
  {
    column: "cadastral_units.association_org_number",
    seed: { property: { associationOrgNumber: "000777888" } },
    text: "Laget har nummer 000777888.",
    gone: ["000777888"],
  },
  {
    column: "common_areas.managing_agent",
    seed: { managingAgent: "Forvaltning Nordtest AS" },
    text: "Forretningsfører er Forvaltning Nordtest AS.",
    gone: ["Forvaltning Nordtest AS"],
  },
];

describe("requestSuggestion: vellykket kall (6.1–6.4)", () => {
  it("6.1 forslag: svaret og én rad med funksjon, fake, fake-v1, ledetekstversjon, 0 NOK", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    const request = validRequest({ assignmentId: assignment.id });

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({
      kind: "suggestion",
      usageId: request.requestId,
      status: "suggested",
      text: expect.any(String),
      candidateId: null,
    });
    if (result.kind !== "suggestion") return;
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(await aiRowCount()).toBe(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.organization_id).toBe(grant.organizationId);
    expect(row.employee_id).toBe(grant.employeeId);
    expect(row.feature).toBe("language_polish");
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("fake-v1");
    // Endret med vilje fra v1 til v2 (evalueringssett, E5.7)
    expect(row.prompt_version).toBe("language_polish.v2");
    expect(Number(row.cost)).toBe(0);
    expect(row.currency).toBe("NOK");
    expect(row.target_ref).toEqual(request.target);
    expect(row.assignment_id).toBe(assignment.id);
    expect(row.report_id).toBeNull();
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
    expect(row.output_text).toBe(result.text);
    expect(row.error_code).toBeNull();
    expect(row.decided_by).toBeNull();
    expect(row.decided_at).toBeNull();
    expect(row.deleted_at).toBeNull();
  });

  it('6.2 source_fields er nøyaktig ["text"]; input_summary har bare feltnavn og antall tegn', async () => {
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(row.source_fields).toEqual(["text"]);
    const summary = JSON.stringify(row.input_summary);
    expect(summary).toContain('"text"');
    expect(summary).not.toContain("Taket");
    expect(summary).not.toContain("sprekker");
    // Bare tall som verdier, og antallet tegn i teksten finnes
    for (const leaf of leaves(row.input_summary)) expect(typeof leaf, summary).toBe("number");
    expect(leaves(row.input_summary)).toContain(SAMPLE_TEXT.length);
  });

  it("6.3 retain_until er opprettet + 10 år (fast tid)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe(tenYearsAfter(TEST_NOW).toISOString());
    expect(new Date(row.retain_until).toISOString()).toBe("2036-11-03T10:00:00.000Z");
  });

  it("6.3 opprettet 29.02.2028 gir retain_until 01.03.2038 (minst ti år)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-29T10:00:00Z"));
    const { grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe("2038-03-01T10:00:00.000Z");
  });

  it("6.4 assignmentId = null godtas og gir tom assignment_id", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ assignmentId: null });
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    expect((await aiRow(request.requestId))!.assignment_id).toBeNull();
  });

  it("2.5 ledeteksten leverandøren får: language_polish.v2, fake-v1, med teksten og uten gjetteord", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    await requestSuggestion(grant, validRequest());
    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]![0];
    expect(sent.feature).toBe("language_polish");
    expect(sent.promptVersion).toBe("language_polish.v2");
    expect(sent.model).toBe("fake-v1");
    expect(sent.prompt).toContain(SAMPLE_TEXT);
    const instruction = sent.prompt.replace(SAMPLE_TEXT, "").trim();
    expect(instruction.length, "ledeteksten har mer enn bare teksten").toBeGreaterThan(0);
    expect(sent.prompt).not.toMatch(/\b(antas|trolig)\b/i);
    // Ingen organisasjon, ansatt eller oppdrag i det leverandøren får
    expect(JSON.stringify(sent)).not.toContain(grant.organizationId);
    expect(JSON.stringify(sent)).not.toContain(grant.employeeId);
  });
});

describe("requestSuggestion: utfall uten forslag (6.5–6.7)", () => {
  it("6.5 ingen treff: no_match, tom status og output_text", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: fakeNoMatchInput() } });
    const result = await requestSuggestion(grant, request);
    expect(result).toEqual({ kind: "no_match", usageId: request.requestId });
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("no_match");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
  });

  it("6.6 feil fra leverandøren: error, error_code er en fast kode", async () => {
    const { grant } = await aiOrganization();
    for (const input of fakeErrorInputs()) {
      const request = validRequest({ fields: { text: input } });
      const result = await requestSuggestion(grant, request);
      expect(result).toEqual({ kind: "error", usageId: request.requestId });
      const row = (await aiRow(request.requestId))!;
      expect(row.outcome).toBe("error");
      expect(AI_ERROR_CODES).toContain(row.error_code);
      expect(row.status).toBeNull();
      expect(row.output_text).toBeNull();
    }
  });

  it("6.7 unntak i leverandøren: error med unknown, ingen unntak ut, markøren ikke i rad eller logger", async () => {
    const { grant } = await aiOrganization();
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(new Error(SECRET_MARKER));
    const logSpies = spyOnLogger();
    const request = validRequest();

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "error", usageId: request.requestId });
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("error");
    expect(row.error_code).toBe("unknown");
    expect(JSON.stringify(row)).not.toContain(SECRET_MARKER);
    expect(loggedText(logSpies)).not.toContain(SECRET_MARKER);
  });
});

describe("requestSuggestion: avslag før kallet (6.8–6.10)", () => {
  const cases: { name: string; change: (request: AiRequestForTest) => AiRequestForTest }[] = [
    { name: "ukjent funksjon", change: (r) => ({ ...r, feature: "tg_suggest" }) },
    {
      name: "felt utenfor tillatt-listen",
      change: (r) => ({ ...r, fields: { ...r.fields, email: "ola@example.com" } }),
    },
    { name: "ulovlig mål", change: (r) => ({ ...r, target: { ...r.target, type: "contact" } }) },
    { name: "TG-felt som mål", change: (r) => ({ ...r, target: { ...r.target, fieldKey: "tg" } }) },
    { name: "reportId satt", change: (r) => ({ ...r, reportId: randomUUID() }) },
    {
      name: "candidates med innhold",
      change: (r) => ({ ...r, candidates: [{ id: randomUUID(), text: "Fast frase" }] }),
    },
    { name: "verdi på 5 001 tegn", change: (r) => ({ ...r, fields: { text: "a".repeat(5001) } }) },
    { name: "ugyldig requestId", change: (r) => ({ ...r, requestId: "ikke-en-uuid" }) },
  ];

  it.each(cases)(
    "6.8 $name → nøytralt avslag, fake ikke kalt, ingen rad, ingen audit",
    async ({ change }) => {
      const { grant } = await aiOrganization();
      const baseline = await neutralRequestRejection(grant);
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const auditBefore = await auditCount();

      const error = await captureError(() => requestSuggestion(grant, change(validRequest())));

      expectSameRejection(error, baseline);
      expect(spy).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it.each([
    { name: "ukjent oppdrag (tilfeldig UUID)", assignment: async () => randomUUID() },
    {
      name: "mykt slettet oppdrag",
      assignment: async (organizationId: string) =>
        (await createAssignment(organizationId, { deletedAt: new Date("2026-11-01T10:00:00Z") }))
          .id,
    },
    {
      name: "oppdrag i en annen organisasjon (6.10)",
      assignment: async () => {
        const other = await createOrganization("Oppdiktet Takst B");
        return (await createAssignment(other.id)).id;
      },
    },
  ])("6.9 $name → samme nøytrale avslag, ingen rad", async ({ assignment }) => {
    const { organization, grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const assignmentId = await assignment(organization.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const auditBefore = await auditCount();

    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ assignmentId })),
    );

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("requestSuggestion: samme requestId igjen (6.11–6.18, 10.3)", () => {
  it("6.11 etter hverandre: likt svar, fake kalt én gang, én rad, ingen ny audit", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    const auditAfterFirst = await auditCount();
    const rowAfterFirst = snapshot(await aiRow(request.requestId));

    const second = await requestSuggestion(grant, request);

    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await aiRowCount()).toBe(1);
    expect(await auditCount()).toBe(auditAfterFirst);
    expect(snapshot(await aiRow(request.requestId))).toBe(rowAfterFirst);
  });

  it("6.12 samtidig (Promise.all): én rad og like svar", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest();
    const [first, second] = await Promise.all([
      requestSuggestion(grant, request),
      requestSuggestion(grant, { ...request }),
    ]);
    expect(second).toEqual(first);
    expect(first.kind).toBe("suggestion");
    expect(await aiRowCount()).toBe(1);
  });

  it.each([
    { name: "annen target.id", change: (r: AiRequestForTest) => ({ ...r, target: validTarget() }) },
    {
      name: "annen fieldKey",
      change: (r: AiRequestForTest) => ({ ...r, target: { ...r.target, fieldKey: "other_text" } }),
    },
    {
      name: "annen funksjon",
      change: (r: AiRequestForTest) => ({ ...r, feature: "dictation_structuring" }),
    },
  ])("6.13 samme id, $name → nøytralt avslag, første rad uendret", async ({ change }) => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(grant, change(request)));

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("6.14 samme id fra en annen ansatt i samme organisasjon → nøytralt avslag, teksten røpes ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const baseline = await neutralRequestRejection(other.grant);
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    if (first.kind !== "suggestion") throw new Error("forventet forslag");
    const before = snapshot(await aiRow(request.requestId));

    const error = await captureError(() => requestSuggestion(other.grant, request));

    expectSameRejection(error, baseline);
    expect(error.message).not.toContain(first.text);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("6.15 samme id fra en annen organisasjon → nøytralt avslag, A sin rad helt uendret, ingen rad i B", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const baseline = await neutralRequestRejection(b.grant);
    const request = validRequest();
    const first = await requestSuggestion(a.grant, request);
    if (first.kind !== "suggestion") throw new Error("forventet forslag");
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(b.grant, request));
    // B prøver også å sende med A sin organisasjon og ansatt i forespørselen (brukes aldri)
    const withForeignIds = await captureError(() =>
      requestSuggestion(b.grant, {
        ...request,
        organizationId: a.organization.id,
        employeeId: a.grant.employeeId,
      }),
    );

    expectSameRejection(error, baseline);
    expectSameRejection(withForeignIds, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(error.message).not.toContain(first.text);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
    expect(await aiRowCount()).toBe(1);
  });

  it("4.8/6.15 ukjente nøkler på toppnivå brukes aldri: raden får grant sin organisasjon og ansatt", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const request = validRequest();
    try {
      await requestSuggestion(b.grant, {
        ...request,
        organizationId: a.organization.id,
        employeeId: a.grant.employeeId,
        provider: "openai",
      });
    } catch {
      // Avvist er også riktig (testplanen 4.8)
    }
    const row = await aiRow(request.requestId);
    if (row) {
      expect(row.organization_id).toBe(b.organization.id);
      expect(row.employee_id).toBe(b.grant.employeeId);
      expect(row.provider).toBe("fake");
    }
    const rowsInA = (await db.execute(
      sql`select id from ai_usage_log where organization_id = ${a.organization.id}`,
    )) as unknown as unknown[];
    expect(rowsInA).toHaveLength(0);
  });

  it.each([
    { name: "no_match", text: () => fakeNoMatchInput(), kind: "no_match" },
    { name: "error", text: () => fakeErrorInputs()[0]!, kind: "error" },
  ])(
    "6.16 gjentatt kall for et $name-svar gir samme svar uten nytt kall",
    async ({ text, kind }) => {
      const { grant } = await aiOrganization();
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const request = validRequest({ fields: { text: text() } });
      const first = await requestSuggestion(grant, request);
      expect(first.kind).toBe(kind);
      const second = await requestSuggestion(grant, request);
      expect(second).toEqual(first);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await aiRowCount()).toBe(1);
    },
  );

  it("6.17 gjentatt kall etter at KI er slått av gir det lagrede svaret (avklaring B)", async () => {
    const { organization, grant } = await aiOrganization();
    const request = validRequest();
    const first = await requestSuggestion(grant, request);
    await mergeOrganizationSettings(organization.id, { "ai.enabled": false });
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const second = await requestSuggestion(grant, request);

    expect(second).toEqual(first);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
    // Og et nytt kall nå gir disabled
    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
  });

  it("6.18 gjentatt kall uten rettighet (takstmann har mistet report.edit) → AccessDeniedError", async () => {
    const { organization, actor, grant } = await aiOrganization();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const weaker = await requireOrganizationAccess(actor, organization.id);

    const error = await captureError(() => requestSuggestion(weaker, request));

    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });

  it("10.3 mykt slettet rad med samme requestId → nøytralt avslag, ingen ny rad (avklaring C)", async () => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const request = validRequest();
    await requestSuggestion(grant, request);
    await db.execute(
      sql`update ai_usage_log set deleted_at = now(), deleted_by = ${grant.employeeId} where id = ${request.requestId}`,
    );
    const before = snapshot(await aiRow(request.requestId));
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() => requestSuggestion(grant, request));

    expectSameRejection(error, baseline);
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });
});

describe("requestSuggestion: nytt forslag på samme mål (6.19–6.25, 10.2)", () => {
  it("6.19 forrige suggested på samme mål (fra en annen takstmann) settes til rejected, med én audit-linje", async () => {
    const { organization, grant } = await aiOrganization();
    const other = await employeeWithGrant(organization.id, ["inspector"], "Test Takstmann To");
    const target = validTarget();
    const previous = validRequest({ target });
    const previousResult = await requestSuggestion(other.grant, previous);
    if (previousResult.kind !== "suggestion") throw new Error("forventet forslag");
    const auditBefore = await allAuditRows();

    const next = validRequest({ target });
    const result = await requestSuggestion(grant, next);

    expect(result.kind).toBe("suggestion");
    const old = (await aiRow(previous.requestId))!;
    expect(old.status).toBe("rejected");
    expect(old.decided_by).toBe(grant.employeeId);
    expect(old.decided_at).not.toBeNull();
    expect((await aiRow(next.requestId))!.status).toBe("suggested");

    const newAudit = (await allAuditRows()).slice(auditBefore.length);
    const aboutOld = newAudit.filter((line) => line.entity_id === previous.requestId);
    expect(aboutOld).toHaveLength(1);
    const line = aboutOld[0]!;
    expect(line.organization_id).toBe(grant.organizationId);
    expect(line.actor_employee_id).toBe(grant.employeeId);
    const changes = JSON.stringify(line.changes);
    expect(changes).toContain("suggested");
    expect(changes).toContain("rejected");
    expect(changes).not.toContain(previousResult.text);
    expect(changes).not.toContain(SAMPLE_TEXT);
  });

  it.each(["accepted", "edited", "rejected"])(
    "6.20 forslag som allerede er %s røres ikke",
    async (status) => {
      const { organization, grant } = await aiOrganization();
      const target = validTarget();
      const existing = await createAiUsageLog(organization.id, {
        targetRef: target,
        status,
        decidedBy: grant.employeeId,
        decidedAt: new Date("2026-11-02T10:00:00Z"),
        createdAt: new Date("2026-11-02T09:00:00Z"),
      });
      const before = snapshot(await aiRow(existing.id));

      await requestSuggestion(grant, validRequest({ target }));

      expect(snapshot(await aiRow(existing.id))).toBe(before);
    },
  );

  it("6.21 samme mål i en annen organisasjon røres ikke", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const target = validTarget();
    const inB = await createAiUsageLog(b.organization.id, {
      employeeId: b.grant.employeeId,
      targetRef: target,
    });
    const before = snapshot(await aiRow(inB.id));

    await requestSuggestion(a.grant, validRequest({ target }));

    expect(snapshot(await aiRow(inB.id))).toBe(before);
  });

  it("6.22/10.2 mykt slettet suggested-forslag på samme mål røres ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const deleted = await createAiUsageLog(organization.id, {
      targetRef: target,
      deletedAt: new Date("2026-11-02T10:00:00Z"),
      deletedBy: grant.employeeId,
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(deleted.id));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(deleted.id))).toBe(before);
  });

  it.each([
    {
      name: "samme type og id, annen fieldKey",
      target: (t: ReturnType<typeof validTarget>) => ({ ...t, fieldKey: "other_text" }),
    },
    { name: "annen id", target: (t: ReturnType<typeof validTarget>) => ({ ...t, id: uuidv7() }) },
    {
      name: "annen type",
      target: (t: ReturnType<typeof validTarget>) => ({ ...t, type: "other_type" }),
    },
  ])("6.23 annet mål ($name) røres ikke", async ({ target }) => {
    const { organization, grant } = await aiOrganization();
    const mine = validTarget();
    const elsewhere = await createAiUsageLog(organization.id, {
      targetRef: target(mine),
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(elsewhere.id));

    await requestSuggestion(grant, validRequest({ target: mine }));

    expect(snapshot(await aiRow(elsewhere.id))).toBe(before);
  });

  it("6.23 forslag fra en annen funksjon på samme mål røres ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const otherFeature = await createAiUsageLog(organization.id, {
      feature: "dictation_structuring",
      promptVersion: "dictation_structuring.v1",
      targetRef: target,
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const before = snapshot(await aiRow(otherFeature.id));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(otherFeature.id))).toBe(before);
  });

  it("6.24 samme transaksjon: feiler audit-skrivingen, er forrige fortsatt suggested og ny rad finnes ikke", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);

    // Tvinger feil i audit_log med en midlertidig trigger (bare i denne testen)
    await db.execute(sql`
      create or replace function ai_test_fail_audit() returns trigger language plpgsql as $$
      begin raise exception 'tvunget feil i testen'; end $$`);
    await db.execute(sql`
      create trigger ai_test_fail_audit before insert on audit_log
      for each row execute function ai_test_fail_audit()`);
    const next = validRequest({ target });
    try {
      try {
        await requestSuggestion(grant, next);
      } catch {
        // Feilen kan gå ut til kalleren; det som teller, er databasen etterpå
      }
    } finally {
      await db.execute(sql`drop trigger if exists ai_test_fail_audit on audit_log`);
      await db.execute(sql`drop function if exists ai_test_fail_audit()`);
    }

    expect((await aiRow(previous.requestId))!.status).toBe("suggested");
    expect((await aiRow(previous.requestId))!.decided_by).toBeNull();
    expect(await aiRow(next.requestId)).toBeUndefined();
  });

  it.each([
    { name: "no_match", text: () => fakeNoMatchInput() },
    { name: "error", text: () => fakeErrorInputs()[0]! },
  ])("6.25 nytt kall gir $name: forrige suggested står urørt (avklaring A)", async ({ text }) => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);
    const before = snapshot(await aiRow(previous.requestId));
    const auditBefore = await auditCount();

    await requestSuggestion(grant, validRequest({ target, fields: { text: text() } }));

    expect(snapshot(await aiRow(previous.requestId))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("6.25 unntak i leverandøren: forrige suggested står urørt", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const previous = validRequest({ target });
    await requestSuggestion(grant, previous);
    const before = snapshot(await aiRow(previous.requestId));
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(new Error("tilfeldig feil"));

    await requestSuggestion(grant, validRequest({ target }));

    expect(snapshot(await aiRow(previous.requestId))).toBe(before);
  });
});

describe("requestSuggestion: tenant-isolasjon (9.1–9.3)", () => {
  /** Ikke-AccessDenied-feil fra en fremmed id er det nøytrale avslaget: hopp over. */
  async function tryRequest(grant: EmployeeGrant, request: AiRequestForTest) {
    try {
      return await requestSuggestion(grant, request);
    } catch (error) {
      if (error instanceof AccessDeniedError) throw error;
      return null;
    }
  }

  it("9.1 oppslag på requestId: gjentatt kall gir bare egne rader", async () => {
    const requests: AiRequestForTest[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = validRequest();
        const b = validRequest();
        await requestSuggestion(grantA, a);
        await requestSuggestion(grantB, b);
        requests.push(a, b);
        return { a: [a.requestId], b: [b.requestId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const found: { id: string }[] = [];
        for (const request of requests) {
          const result = await tryRequest(grant, request);
          if (result && "usageId" in result) found.push({ id: result.usageId });
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });

  it("9.2 oppslag av oppdrag: bare egne oppdrag godtas", async () => {
    const assignmentIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        assignmentIds.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const accepted: { id: string }[] = [];
        for (const assignmentId of assignmentIds) {
          const result = await tryRequest(grant, validRequest({ assignmentId }));
          if (result && result.kind === "suggestion") accepted.push({ id: assignmentId });
        }
        return accepted;
      },
      idOf: (row) => row.id,
    });
  });

  it("9.3 settet som avviser forrige forslag: bare egne rader blir rejected", async () => {
    const target = validTarget();
    const seeded: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await enableAi(grantA.organizationId);
        await enableAi(grantB.organizationId);
        const a = await createAiUsageLog(grantA.organizationId, {
          employeeId: grantA.employeeId,
          targetRef: target,
          createdAt: new Date("2026-11-02T09:00:00Z"),
        });
        const b = await createAiUsageLog(grantB.organizationId, {
          employeeId: grantB.employeeId,
          targetRef: target,
          createdAt: new Date("2026-11-02T09:00:00Z"),
        });
        seeded.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const before = new Map<string, string | null>();
        for (const id of seeded) before.set(id, (await aiRow(id))!.status);
        await requestSuggestion(grant, validRequest({ target }));
        const changed: { id: string }[] = [];
        for (const id of seeded) {
          const status = (await aiRow(id))!.status;
          if (before.get(id) === "suggested" && status === "rejected") changed.push({ id });
        }
        return changed;
      },
      idOf: (row) => row.id,
    });
  });
});

/** En leverandør som ikke er `fake`. Svarer som en vanlig leverandør hvis den blir kalt. */
function realLikeProvider() {
  const complete = vi.fn(async (_request: unknown) => ({
    outcome: "ok" as const,
    text: "Oppdiktet svar fra annen leverandør.",
    tokensIn: 3,
    tokensOut: 4,
    cost: 0.5,
    currency: "NOK",
  }));
  return { code: "other_test_provider", model: "other-test-v1", complete };
}

/**
 * Oppdiktede kjente verdier for oppdraget: markøren er et kjent navn, så den ekte vasken bytter
 * den med `[navn]` og teller ett treff. Gjelder bare forespørsler med oppdrag.
 */
function markerRedaction() {
  swap.load = async (): Promise<KnownValues> => ({
    ...emptyKnownValues(),
    personNames: [SECRET_MARKER],
  });
}

describe("requestSuggestion: vasken før kallet (vask før KI V4.3–V4.8)", () => {
  it("V4.3 leverandøren får bare den vaskede teksten, og redacted_count står i raden", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    markerRedaction();
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest({
      assignmentId: assignment.id,
      fields: { text: `Ring ${SECRET_MARKER} om taket` },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(loadKnownValues).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadKnownValues).mock.calls[0]![0]).toBe(grant);
    expect(vi.mocked(loadKnownValues).mock.calls[0]![1]).toBe(assignment.id);
    const prompt = (complete.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Ring [navn] om taket");
    expect(prompt).not.toContain(SECRET_MARKER);
    const row = (await aiRow(request.requestId))!;
    expect(row.redacted_count).toBe(1);
    expect(JSON.stringify(row)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    expect(Object.keys(result)).not.toContain("redactedCount");
  });

  it("V4.4 input_summary regnes av den vaskede teksten", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    markerRedaction();
    const text = `Ring ${SECRET_MARKER} om taket`;
    const request = validRequest({ assignmentId: assignment.id, fields: { text } });

    await requestSuggestion(grant, request);

    const row = (await aiRow(request.requestId))!;
    expect(row.input_summary).toEqual({ text: "Ring [navn] om taket".length });
    expect(row.input_summary).not.toEqual({ text: text.length });
  });

  it.each(["no_match", "error"] as const)(
    "V4.3 redacted_count skrives også for utfallet %s",
    async (outcome) => {
      const { grant } = await aiOrganization();
      // To treff fra mønstrene (to oppdiktede telefonnumre) ved siden av prøveverdien
      const marker = outcome === "no_match" ? fakeNoMatchInput() : fakeErrorInputs()[0]!;
      const text = `${marker} 12345678 87654321`;
      const request = validRequest({ fields: { text } });

      const result = await requestSuggestion(grant, request);

      expect(result.kind).toBe(outcome);
      expect((await aiRow(request.requestId))!.redacted_count).toBe(2);
    },
  );

  it("V4.5 kaster vasken, kalles leverandøren ikke og ingen rad skrives; markøren lekker ikke", async () => {
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    swap.load = async () => {
      throw new Error(SECRET_MARKER);
    };
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const logSpies = spyOnLogger();
    const auditBefore = await auditCount();

    const error = await captureError(() =>
      requestSuggestion(
        grant,
        validRequest({ assignmentId: assignment.id, fields: { text: "Oppdiktet notat" } }),
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
    expect(loggedText(logSpies)).not.toContain(SECRET_MARKER);
  });

  it("V4.6 «KI er av» og blocked kjører ikke vasken", async () => {
    const off = await createOrganization("Oppdiktet Takst Av");
    const offInspector = await employeeWithGrant(off.id, ["inspector"]);
    const offAssignment = await createAssignment(off.id);
    expect(
      await requestSuggestion(offInspector.grant, validRequest({ assignmentId: offAssignment.id })),
    ).toEqual({ kind: "disabled" });

    const { grant } = await aiOrganization();
    swap.provider = realLikeProvider();
    const assignment = await createAssignment(grant.organizationId);
    expect(await requestSuggestion(grant, validRequest({ assignmentId: assignment.id }))).toEqual({
      kind: "blocked",
    });

    expect(loadKnownValues).not.toHaveBeenCalled();
  });

  it("V4.7 den falske leverandøren vaskes også: ai_trial uten oppdrag gir [telefon] i forslaget", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const text = "ring 12345678 og skriv til ola.prove@example.no";
    const request = validRequest({ target: trialTarget(), fields: { text } });
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    // Uten oppdrag: ingen oppslag, men mønstrene vasker likevel
    expect(loadKnownValues).not.toHaveBeenCalled();
    if (result.kind !== "suggestion") return;
    expect(result.text).toContain("[telefon]");
    expect(result.text).toContain("[e-post]");
    expect(result.text).not.toContain("12345678");
    expect(result.text).not.toContain("ola.prove@example.no");
    expect(sentInput(spy.mock.calls[0]![0].prompt)).not.toContain("12345678");
    expect((await aiRow(request.requestId))!.redacted_count).toBe(2);
  });

  it("V4.8 assignmentId null: bare mønstrene, ingen oppslag av kjente verdier", async () => {
    const { grant } = await aiOrganization();
    const { input } = await sendAndCapture(grant, null, "Åse Testesen ringte fra 12345678.");
    expect(lookupCalls()).toBe(0);
    expect(input).toContain("[telefon]");
    expect(input).not.toContain("12345678");
    // Uten oppdrag er navnet ingen kjent verdi, og mønstrene kjenner ikke navn (restrisiko)
    expect(input).toContain("Åse Testesen");
  });

  it("V4.5 oppslaget av kjente verdier kaster: leverandøren kalles ikke, ingen ok-rad, ingen verdier i feil eller logger", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen", phone: "12345678" }],
    });
    swap.load = async () => {
      throw new Error("oppdiktet feil i oppslaget");
    };
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const logSpies = spyOnLogger();
    const request = validRequest({
      assignmentId,
      fields: { text: "Åse Testesen ringte fra 12345678." },
    });

    const failure = await captureError(() => requestSuggestion(grant, request));

    expect(failure).toBeInstanceOf(Error);
    expect(spy).not.toHaveBeenCalled();
    expect(lookupCalls()).toBe(1);
    const okRows = (await db.execute(
      sql`select id from ai_usage_log where outcome = 'ok'`,
    )) as unknown as unknown[];
    expect(okRows).toHaveLength(0);
    const seen = `${failure.message} ${failure.stack ?? ""} ${loggedText(logSpies)}`;
    for (const value of ["Åse", "Testesen", "12345678"]) expect(seen).not.toContain(value);
  });
});

describe("requestSuggestion: utfallet blocked (vask før KI V5.1–V5.7, V10.1)", () => {
  async function expectBlockedRow(requestId: string) {
    const row = (await aiRow(requestId))!;
    expect(row.outcome).toBe("blocked");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(Number(row.cost)).toBe(0);
    expect(row.redacted_count).toBe(0);
    expect(row.provider).toBe("other_test_provider");
    expect(row.input_summary).toEqual({});
    return row;
  }

  it.each([
    { name: "V5.1 answer med oppdrag", target: "answer" as const, withAssignment: true },
    { name: "V5.2 ai_trial uten oppdrag", target: "ai_trial" as const, withAssignment: false },
    {
      name: "V5.2 fritekst uten oppdrag (answer, assignmentId null)",
      target: "answer" as const,
      withAssignment: false,
    },
  ])(
    "$name mot ekte leverandør: blocked-rad, intet kall, ingen audit",
    async ({ target, withAssignment }) => {
      const { organization, grant } = await aiOrganization();
      const assignmentId = withAssignment ? (await createAssignment(organization.id)).id : null;
      const provider = realLikeProvider();
      swap.provider = provider;
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const auditBefore = await auditCount();
      const request = validRequest({
        assignmentId,
        target: { type: target, id: randomUUID(), fieldKey: "text" },
      });

      const result = await requestSuggestion(grant, request);

      expect(result).toEqual({ kind: "blocked" });
      expect(provider.complete).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      const row = await expectBlockedRow(request.requestId);
      expect(row.assignment_id).toBe(assignmentId);
      expect(row.target_ref).toEqual(request.target);
      expect(row.deleted_at).toBeNull();
      expect(await aiRowCount()).toBe(1);
      expect(row.organization_id).toBe(grant.organizationId);
      expect(row.employee_id).toBe(grant.employeeId);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it("V5.3 answer med falsk leverandør virker (A173)", async () => {
    const { grant } = await aiOrganization();
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
  });

  it("V5.3 ai_trial med falsk leverandør virker som før", async () => {
    const { grant } = await aiOrganization();
    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));
    expect(result.kind).toBe("suggestion");
  });

  it("V5.4 en blocked-forespørsel avviser ikke forrige åpne forslag på samme mål", async () => {
    const { grant } = await aiOrganization();
    const target = validTarget();
    const first = validRequest({ target });
    await requestSuggestion(grant, first);
    swap.provider = realLikeProvider();
    const auditBefore = await auditCount();

    expect(await requestSuggestion(grant, validRequest({ target }))).toEqual({ kind: "blocked" });

    expect((await aiRow(first.requestId))!.status).toBe("suggested");
    expect(await auditCount()).toBe(auditBefore);
  });

  it("V5.5 samme requestId igjen gir blocked, ingen ny rad og intet kall", async () => {
    const { grant } = await aiOrganization();
    const provider = realLikeProvider();
    swap.provider = provider;
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));

    // Også etter at leverandøren er byttet til den falske: svaret fra første gang
    swap.provider = null;
    const complete = vi.spyOn(fakeAiProvider, "complete");
    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });

    expect(await aiRowCount()).toBe(1);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });

  it("V5.6 blocked-raden fra requestSuggestion kan ikke avgjøres", async () => {
    const { grant } = await aiOrganization();
    swap.provider = realLikeProvider();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const before = snapshot(await aiRow(request.requestId));
    for (const decision of ["accepted", "edited", "rejected", "undo"]) {
      const error = await captureError(() => recordDecision(grant, request.requestId, decision));
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(ReferenceError);
    }
    expect(snapshot(await aiRow(request.requestId))).toBe(before);
  });

  it("V5.7 «KI er av» gir fortsatt ingen rad og { kind: disabled }", async () => {
    const organization = await createOrganization("Oppdiktet Takst Av");
    await enableAi(organization.id, { enabled: false });
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);

    expect(await requestSuggestion(grant, validRequest())).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
  });

  it("V10.1 blocked-raden får retain_until = opprettet + 10 år", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    const { grant } = await aiOrganization();
    swap.provider = realLikeProvider();
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe(tenYearsAfter(TEST_NOW).toISOString());
  });
});

describe("requestSuggestion: roller og organisasjon (vask før KI V7.3–V7.4)", () => {
  it("V7.3 A sitt oppdrag i en forespørsel fra B avvises, ingen vask og ingen rad", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const assignment = await createAssignment(a.organization.id);
    const baseline = await neutralRequestRejection(b.grant);
    const complete = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() =>
      requestSuggestion(b.grant, validRequest({ assignmentId: assignment.id })),
    );

    expectSameRejection(error, baseline);
    expect(loadKnownValues).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it.each([
    { role: "inspector" as const, allowed: true },
    { role: "manager" as const, allowed: true },
    { role: "admin" as const, allowed: true },
    { role: "office" as const, allowed: false },
  ])("V7.4 $role får samme svar som før (falsk leverandør, vasket)", async ({ role, allowed }) => {
    const { organization } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    const { grant } = await employeeWithGrant(organization.id, [role], `Test ${role}`);
    markerRedaction();
    const request = validRequest({
      assignmentId: assignment.id,
      fields: { text: `Ring ${SECRET_MARKER}` },
    });

    if (!allowed) {
      await expect(requestSuggestion(grant, request)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(loadKnownValues).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      return;
    }
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    expect(loadKnownValues).toHaveBeenCalledTimes(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("ok");
    expect(row.redacted_count).toBe(1);
  });
});

describe("vask før KI: hver kjent verdi vaskes (V4.1)", () => {
  it.each(COLUMN_CASES)("V4.1 $column", async ({ seed, text, gone }) => {
    const { grant, assignmentId } = await organizationWithKnownValues(seed);
    const { input, result } = await sendAndCapture(grant, assignmentId, text);
    for (const value of gone) {
      expect(stillThere(input, value), `«${value}» i ledeteksten: ${input}`).toBe(false);
    }
    expect(input, "plassholder mangler").toMatch(/\[[a-zæøå-]+\]/u);
    expect(result.kind).toBe("suggestion");
    if (result.kind === "suggestion") {
      for (const value of gone) expect(stillThere(result.text, value), value).toBe(false);
    }
  });
});

describe("vask før KI: mykt slettede kilderader (V4.2, V10.2)", () => {
  const DELETED_SEED: KnownSeed = {
    parties: [{ name: "Pål Partsen", phone: "47112233", deleted: true }],
    partyContacts: [
      {
        firstName: "Sigrun",
        lastName: "Kontaktesen",
        email: "slettet.k@example.no",
        deleted: true,
        firm: { name: "Slettet Firma AS", orgNumber: "000888999", deleted: true },
      },
    ],
    partyFirms: [{ name: "Fjernet Bygg AS", orgNumber: null, deleted: true }],
    team: [{ name: "Gunnvor Bortesen", deleted: true }],
    property: { gnr: "81", bnr: "92", cadastralDeleted: true },
    managingAgent: "Fjernet Forvaltning AS",
    commonAreasDeleted: true,
  };

  it("V4.2 verdier fra mykt slettede parter, kontakter, firma, teammedlemmer, matrikkel og fellesareal vaskes", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues(DELETED_SEED);
    const text = [
      "Partsen ringte på 47112233.",
      "Kontaktesen skrev fra slettet.k@example.no.",
      "Slettet Firma AS (000888999) og Fjernet Bygg AS har jobbet her.",
      "Bortesen var med.",
      "Eiendommen 81/92 forvaltes av Fjernet Forvaltning AS.",
    ].join(" ");
    const { input } = await sendAndCapture(grant, assignmentId, text);
    for (const value of [
      "Partsen",
      "47112233",
      "Kontaktesen",
      "slettet.k@example.no",
      "Slettet Firma AS",
      "000888999",
      "Fjernet Bygg AS",
      "Bortesen",
      "81/92",
      "Fjernet Forvaltning AS",
    ]) {
      expect(stillThere(input, value), `«${value}» i ledeteksten: ${input}`).toBe(false);
    }
  });

  it("V10.2 vasken endrer eller sletter aldri kilderadene", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues(DELETED_SEED);
    const tables = [
      "assignment_parties",
      "contacts",
      "firms",
      "assignment_team_members",
      "properties",
      "cadastral_units",
      "common_areas",
      "orders",
      "employees",
    ];
    const before: Record<string, string> = {};
    for (const table of tables) {
      before[table] = JSON.stringify(
        await db.execute(sql.raw(`select * from ${table} order by id`)),
      );
    }
    await sendAndCapture(grant, assignmentId, "Partsen ringte på 47112233.");
    for (const table of tables) {
      expect(
        JSON.stringify(await db.execute(sql.raw(`select * from ${table} order by id`))),
        table,
      ).toBe(before[table]);
    }
  });
});

describe("vask før KI: alt i én tekst (V4.3)", () => {
  it("V4.3 alle mønstre og kjente verdier i samme tekst: ingen verdier i ledeteksten, redacted_count stemmer", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen", phone: "12345678" }],
      property: { address: "Prøvetunet 7", gnr: "12", bnr: "34" },
    });
    const text =
      "Åse Testesen ringte fra 12345678. Kopi til kari.prove@example.no. " +
      "Personnummer 01019912345, org 123456789, konto 1234.56.78901. " +
      "Naboen i Fjordveien 3B klaget. Eiendommen 12/34 i Prøvetunet 7 er befart.";
    const values = [
      "Åse Testesen",
      "12345678",
      "kari.prove@example.no",
      "01019912345",
      "123456789",
      "1234.56.78901",
      "Fjordveien 3B",
      "12/34",
      "Prøvetunet 7",
    ];
    const { input, request } = await sendAndCapture(grant, assignmentId, text);
    for (const value of values) {
      expect(stillThere(input, value), `«${value}» i ledeteksten: ${input}`).toBe(false);
    }
    expect(placeholderCounts(input)).toEqual({
      "[navn]": 1,
      "[telefon]": 1,
      "[e-post]": 1,
      "[fødselsnummer]": 1,
      "[organisasjonsnummer]": 1,
      "[kontonummer]": 1,
      "[adresse]": 2,
      "[matrikkel]": 1,
    });
    const row = (await aiRow(request.requestId))!;
    expect(row.redacted_count).toBe(9);
    expect(row.outcome).toBe("ok");
  });

  it("V4.3 tekst uten persondata gir redacted_count 0 og samme tekst til leverandøren", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    const { input, request } = await sendAndCapture(grant, assignmentId, SAMPLE_TEXT);
    expect(input).toBe(SAMPLE_TEXT);
    expect((await aiRow(request.requestId))!.redacted_count).toBe(0);
  });
});

describe("vask før KI: tenant (V7.2)", () => {
  it("V7.2 navnet på en part i organisasjon B vaskes ikke i teksten fra A (B sine verdier brukes aldri)", async () => {
    const a = await organizationWithKnownValues({ parties: [{ name: "Åse Testesen" }] });
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    await seedKnownValues(orgB.id, {
      parties: [{ name: "Bjarne Fremmedsen", phone: "98765432" }],
    });
    const { input } = await sendAndCapture(
      a.grant,
      a.assignmentId,
      "Åse Testesen nevnte Bjarne Fremmedsen.",
    );
    expect(stillThere(input, "Åse Testesen")).toBe(false);
    expect(input).toContain("Bjarne Fremmedsen");
  });
});

/*
 * Evalueringssettet (docs/funksjoner/fase2a-evalueringssett-testplan.md E5.1 og E6.2): settet går
 * samme vei som ekte bruk (`preparePrompt`), og en feil fra `new RegExp` i vasken stenger.
 */
describe("evalueringssett: felles ledetekst og vasken stenger (E5.1, E6.2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("E5.1 requestSuggestion og kjøreren gir nøyaktig samme tekst til leverandøren", async () => {
    const known: KnownValues = {
      ...emptyKnownValues(),
      personNames: ["Åse Testesen"],
      phones: ["12345678"],
      emails: ["ase.testesen@example.com"],
      addresses: {
        full: ["Prøvetunet 7, 8099 Testvik"],
        places: ["Testvik"],
        postalCodes: ["8099"],
      },
      cadastral: {
        units: [{ gnr: "999", bnr: "12", fnr: null, snr: null, shareNumber: null }],
        municipalityNumbers: [],
      },
    };
    const text =
      "åse testesen  på Prøvetunet 7 ringte fra 123 45 678 , gnr 999 bnr 12. Det bør\u00ADskiftes. TG2";
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    swap.load = async () => known;
    const { prompt } = await sendAndCapture(grant, assignment.id, text);

    const { runEvals } = await import("./evals/run");
    const provider = capturing(fakeAiProvider as unknown as AiProvider);
    const dir = makeCasesDir({
      "language_polish.cases.json": evalFile(
        evalCases(30, "s", (item) => ({
          ...item,
          fields: { text },
          known: known as unknown as Record<string, unknown>,
          expect: { outcome: "ok" },
        })),
      ),
    });
    try {
      const result = await runEvals({ provider, casesDir: dir, feature: "language_polish" });
      expect(result.errors).toEqual([]);
    } finally {
      removeDir(dir);
    }
    expect(provider.prompts).toHaveLength(30);
    expect(provider.prompts[0]).toBe(prompt);
    // Ikke hult: teksten er faktisk vasket
    expect(prompt).not.toMatch(/testesen|12345678|Prøvetunet|999/iu);
  });

  it("E6.2 feil fra new RegExp i vasken stenger: leverandøren kalles ikke, ingen rad, ingen kjent verdi i feil eller logg", async () => {
    const marker = "Qzxhemmelig";
    const { organization, grant } = await aiOrganization();
    const assignment = await createAssignment(organization.id);
    swap.load = async (): Promise<KnownValues> => ({
      ...emptyKnownValues(),
      personNames: [`${marker} Verdisen`],
      phones: ["98989898"],
    });
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const logSpies = spyOnLogger();
    const auditBefore = await auditCount();

    stubFailingRegExp(marker);
    let failure: unknown;
    try {
      await requestSuggestion(
        grant,
        validRequest({
          assignmentId: assignment.id,
          fields: { text: `${marker} Verdisen ringte fra 98989898.` },
        }),
      );
    } catch (caught) {
      failure = caught;
    }
    vi.unstubAllGlobals();

    expect(failure, "feilen skal stenge (A176)").toBeInstanceOf(Error);
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
    const error = failure as Error;
    expect(error.cause).toBeUndefined();
    const seen = `${error.message} ${error.stack ?? ""} ${loggedText(logSpies)}`;
    for (const value of [marker, "Verdisen", "98989898"]) expect(seen).not.toContain(value);
  });
});

/*
 * Tegn databasen ikke tar (docs/agenter/oppgaver/rett-t0001-synkko-testplan.md 2c, test 58–65 og
 * 68): nulltegn og ensomme surrogater fjernes fra verdiene før personvernvasken, og svaret fra
 * leverandøren vaskes før loggen. Feltkodene vaskes ikke.
 */
describe("requestSuggestion: tegn databasen ikke tar (T-0001)", () => {
  const POISON = "Fukt\u0000 i kjeller";
  const CLEAN = "Fukt i kjeller";

  it("58 tekst med nulltegn gir forslag og én rad i ai_usage_log", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: POISON } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.status).toBe("suggested");
    expect(await aiRowCount()).toBe(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("ok");
    expect(JSON.stringify(row)).not.toContain("\\u0000");
    expect(result.text).not.toContain("\u0000");
  });

  it("59 leverandøren får vasket tekst", async () => {
    const { grant } = await aiOrganization();
    const { input, prompt } = await sendAndCapture(grant, null, "Fukt\u0000 i \uD800kjeller");
    expect(prompt).not.toContain("\u0000");
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(input).toBe(CLEAN);
  });

  it("60 svar med nulltegn fra leverandøren lagres vasket, og klienten får samme tekst", async () => {
    const { grant } = await aiOrganization();
    vi.spyOn(fakeAiProvider, "complete").mockResolvedValue({
      outcome: "ok",
      text: "Bedre\u0000 tekst\uDC00",
      tokensIn: 1,
      tokensOut: 1,
      cost: 0,
      currency: "NOK",
    });
    const request = validRequest({ fields: { text: CLEAN } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    const row = (await aiRow(request.requestId))!;
    expect(row.output_text).toBe("Bedre tekst");
    expect(result.text).toBe(row.output_text);
  });

  it("61 input_summary regnes av vasket tekst", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: "Fukt\u0000\u0000 i \uDC00kjeller" } });

    await requestSuggestion(grant, request);

    const row = (await aiRow(request.requestId))!;
    expect(row.input_summary).toEqual({ text: CLEAN.length });
  });

  it.each(["\u0000\u0000", "\uD800", "\u0000\uDC00"])(
    "62 tekst som er tom etter vask (%j) gir samme avslag som tom tekst",
    async (text) => {
      const { grant } = await aiOrganization();
      const baseline = await neutralRequestRejection(grant);
      const empty = await captureError(() =>
        requestSuggestion(grant, validRequest({ fields: { text: "" } })),
      );
      expectSameRejection(empty, baseline);
      const complete = vi.spyOn(fakeAiProvider, "complete");
      const auditBefore = await auditCount();

      const error = await captureError(() =>
        requestSuggestion(grant, validRequest({ fields: { text } })),
      );

      expectSameRejection(error, empty);
      expect(preparePrompt).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(await aiRowCount()).toBe(0);
      expect(await auditCount()).toBe(auditBefore);
    },
  );

  it("63 feltkodene vaskes ikke: feltkode med nulltegn avvises som ukjent felt", async () => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const unknownField = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { email: CLEAN } })),
    );
    expectSameRejection(unknownField, baseline);
    const complete = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { "text\u0000": CLEAN } })),
    );

    expectSameRejection(error, unknownField);
    expect(preparePrompt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("64 rekkefølgen holder: tilgang sjekkes før vask", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    const complete = vi.spyOn(fakeAiProvider, "complete");

    // Bruker i B mot A: stoppes i tilgangssjekken
    await expect(
      requireOrganizationAccess(b.actor, a.organization.id, "report.edit"),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    // Rolle uten rettigheten, med giftig tekst og A sitt oppdrag: stoppes i trinn 2
    const office = await employeeWithGrant(a.organization.id, ["office"], "Test Kontor");
    const assignment = await createAssignment(a.organization.id);
    await expect(
      requestSuggestion(
        office.grant,
        validRequest({ assignmentId: assignment.id, fields: { text: POISON } }),
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      requestSuggestion(office.grant, validRequest({ fields: { text: "\u0000" } })),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    expect(preparePrompt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("65 admin får forslag med giftig tekst", async () => {
    const { organization } = await aiOrganization();
    const { grant } = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const request = validRequest({ fields: { text: "Fukt\u0000 i \uD800kjeller" } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("ok");
    expect(row.employee_id).toBe(grant.employeeId);
  });

  it("68 telefonnummer med nulltegn mellom sifrene blir vasket bort av personvernvasken", async () => {
    const { grant } = await aiOrganization();
    const text = "Ring 9\u00001234567";

    const { input, prompt, request, result } = await sendAndCapture(grant, null, text);

    expect(vi.mocked(preparePrompt).mock.calls[0]![1]).toEqual({ text: "Ring 91234567" });
    for (const seen of [prompt, input]) {
      expect(seen).not.toContain("91234567");
      expect(seen).not.toContain("1234567");
      expect(seen).not.toContain("\u0000");
    }
    expect(input).toContain("[telefon]");
    const row = (await aiRow(request.requestId))!;
    expect(row.redacted_count).toBe(1);
    expect(row.input_summary).toEqual({ text: "Ring [telefon]".length });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("91234567");
    expect(stored).not.toContain("1234567");
    expect(JSON.stringify(result)).not.toContain("1234567");
  });
});

/*
 * Funn T-0001: tegn databasen ikke tar (docs/agenter/oppgaver/rett-t0001-synkko.md Omfang 3,
 * testplan avsnitt 2c, 58–65 og 68). Vasken kommer etter trinn 1–3 og før personvernvasken
 * (`preparePrompt`), og svaret fra leverandøren vaskes før loggen og klienten. Bare den falske
 * leverandøren. Teksten og telefonnummeret er oppdiktet.
 */
describe("requestSuggestion: nulltegn og ensomme surrogater (T-0001)", () => {
  const POISON = "Fukt\u0000 i kjeller";
  const CLEAN = "Fukt i kjeller";

  /** Ingen nulltegn eller ensomme surrogater i raden (JSON skriver dem som \u-koder). */
  function expectStorable(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/\\u0000|\\ud[89a-f][0-9a-f]{2}/i);
  }

  it("tekst med nulltegn gir forslag og én rad i ai_usage_log", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: POISON } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(await aiRowCount()).toBe(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.status).toBe("suggested");
    expect(row.outcome).toBe("ok");
    expectStorable(row);
    expectStorable(result);
  });

  it("ensomt surrogat i teksten gir også forslag og rad", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: "Merk\uD800 her" } });
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
    expectStorable(await aiRow(request.requestId));
  });

  it("leverandøren og personvernvasken får vasket tekst", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");

    await requestSuggestion(grant, validRequest({ fields: { text: POISON } }));

    expect(spy).toHaveBeenCalledTimes(1);
    const prompt = spy.mock.calls[0]![0].prompt;
    expect(prompt).not.toContain("\u0000");
    expect(sentInput(prompt)).toBe(CLEAN);
    expect(vi.mocked(preparePrompt).mock.calls[0]![1]).toEqual({ text: CLEAN });
  });

  it("svar med nulltegn fra leverandøren lagres vasket, og klienten får samme tekst", async () => {
    const { grant } = await aiOrganization();
    vi.spyOn(fakeAiProvider, "complete").mockResolvedValue({
      outcome: "ok",
      text: "Bedre\u0000 tekst\uDC00.",
      tokensIn: 3,
      tokensOut: 2,
      cost: 0,
      currency: "NOK",
    });
    const request = validRequest();

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    const row = (await aiRow(request.requestId))!;
    expect(row.output_text).toBe("Bedre tekst.");
    expect(result.text).toBe(row.output_text);
  });

  it("input_summary regnes av vasket tekst", async () => {
    const { grant } = await aiOrganization();
    const request = validRequest({ fields: { text: POISON } });
    await requestSuggestion(grant, request);
    expect((await aiRow(request.requestId))!.input_summary).toEqual({ text: CLEAN.length });
  });

  it("tekst som er tom etter vask gir avslag, ikke unntak; verken vasken eller leverandøren kalles", async () => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    vi.mocked(preparePrompt).mockClear();
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const auditBefore = await auditCount();

    for (const text of ["\u0000\u0000", "\uD800", "\u0000\uDC00\u0000"]) {
      const error = await captureError(() =>
        requestSuggestion(grant, validRequest({ fields: { text } })),
      );
      expect(error).toBeInstanceOf(AiRequestRejectedError);
      expectSameRejection(error, baseline);
    }
    expect(preparePrompt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("tekst som er tom etter vask avvises før oppdraget slås opp og før sperren", async () => {
    // Sperret leverandør ville gitt en blocked-rad; tom tekst etter vask skal avvises før det
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    swap.provider = realLikeProvider();
    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { text: "\u0000" } })),
    );
    expectSameRejection(error, baseline);
    expect(await aiRowCount()).toBe(0);
  });

  it("feltkodene vaskes ikke: feltkode med nulltegn gir samme avslag som ukjent felt", async () => {
    const { grant } = await aiOrganization();
    const baseline = await neutralRequestRejection(grant);
    const complete = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() =>
      requestSuggestion(grant, validRequest({ fields: { "text\u0000": CLEAN } })),
    );

    expectSameRejection(error, baseline);
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("rekkefølgen holder: annen organisasjon nektes før vask, og ingen rad skrives", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const assignmentA = await createAssignment(a.organization.id);
    const b = await aiOrganization("Oppdiktet Takst B");
    vi.mocked(preparePrompt).mockClear();
    const complete = vi.spyOn(fakeAiProvider, "complete");

    // Tilgangssjekken mot A for en ansatt i B
    await expect(requireOrganizationAccess(b.actor, a.organization.id)).rejects.toThrow(
      AccessDeniedError,
    );
    // A sitt oppdrag i en forespørsel fra B, med giftig tekst
    const baseline = await neutralRequestRejection(b.grant);
    const error = await captureError(() =>
      requestSuggestion(
        b.grant,
        validRequest({ assignmentId: assignmentA.id, fields: { text: POISON } }),
      ),
    );
    expectSameRejection(error, baseline);
    expect(preparePrompt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("admin får forslag med giftig tekst", async () => {
    const { organization } = await aiOrganization();
    const admin = await employeeWithGrant(organization.id, ["admin"], "Oppdiktet Admin");
    const request = validRequest({ fields: { text: POISON } });

    const result = await requestSuggestion(admin.grant, request);

    expect(result.kind).toBe("suggestion");
    expect((await aiRow(request.requestId))!.employee_id).toBe(admin.grant.employeeId);
  });

  it("telefonnummer med nulltegn mellom sifrene blir vasket bort av personvernvasken", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest({
      target: trialTarget(),
      fields: { text: "Ring 9\u00001234567" },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    const input = sentInput(spy.mock.calls[0]![0].prompt);
    expect(input).toContain("[telefon]");
    expect(input).not.toContain("91234567");
    expect(input).not.toContain("1234567");
    expect(input).not.toContain("\u0000");
    const row = (await aiRow(request.requestId))!;
    expect(JSON.stringify(row)).not.toContain("1234567");
    expect(JSON.stringify(row.input_summary)).not.toContain("1234567");
    expect(row.redacted_count).toBe(1);
    expect(JSON.stringify(result)).not.toContain("1234567");
  });
});

/*
 * K7: avvist fordi et nytt forslag erstatter det gamle
 * (docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md 2d, S1–S7; kortet A272–A275).
 * Innstillingen settes rått i `organizations.settings`. Eldre rader lages med fast `created_at`,
 * og forventet dato regnes med `addYears` fra `usage-log.ts`, per rad fra egen `created_at`.
 *
 * Støtter hovedmål: KI i bunnen (avviste forslag står så lenge innstillingen sier, regnet likt
 * overalt) og færre reklamasjoner (rader i andre organisasjoner og på andre mål røres aldri).
 */
describe("K7 avvist fordi nytt forslag erstatter (S1–S7)", () => {
  const RETENTION_KEY = "ai.rejected_retention_years";
  const NOV_1 = new Date("2026-11-01T07:45:00Z");
  const NOV_2 = new Date("2026-11-02T09:00:00Z");
  const NOV_5 = new Date("2026-11-05T13:20:00Z");

  function iso(value: Date | string): string {
    return new Date(value).toISOString();
  }

  async function oldSuggestion(
    organizationId: string,
    employeeId: string,
    target: ReturnType<typeof validTarget>,
    createdAt: Date,
  ) {
    return createAiUsageLog(organizationId, { employeeId, targetRef: target, createdAt });
  }

  it("S1 erstattet forslag får innstillingen, det nye forslaget har 10 år", async () => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { [RETENTION_KEY]: 2 });
    const target = validTarget();
    const old = await oldSuggestion(organization.id, grant.employeeId, target, NOV_2);

    const next = validRequest({ target });
    expect((await requestSuggestion(grant, next)).kind).toBe("suggestion");

    const replaced = (await aiRow(old.id))!;
    expect(replaced.status).toBe("rejected");
    expect(iso(replaced.retain_until)).toBe(addYears(NOV_2, 2).toISOString());
    const fresh = (await aiRow(next.requestId))!;
    expect(fresh.status).toBe("suggested");
    expect(iso(fresh.retain_until)).toBe(addYears(new Date(fresh.created_at), 10).toISOString());
  });

  it("S1 også et forslag laget med requestSuggestion får innstillingen når det erstattes", async () => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { [RETENTION_KEY]: 3 });
    const target = validTarget();
    const first = validRequest({ target });
    await requestSuggestion(grant, first);
    await requestSuggestion(grant, validRequest({ target }));

    const replaced = (await aiRow(first.requestId))!;
    expect(replaced.status).toBe("rejected");
    expect(iso(replaced.retain_until)).toBe(
      addYears(new Date(replaced.created_at), 3).toISOString(),
    );
  });

  it("S2 hver erstattet rad får sin egen dato", async () => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { [RETENTION_KEY]: 2 });
    const target = validTarget();
    const early = await oldSuggestion(organization.id, grant.employeeId, target, NOV_1);
    const late = await oldSuggestion(organization.id, grant.employeeId, target, NOV_5);

    await requestSuggestion(grant, validRequest({ target }));

    const earlyAfter = (await aiRow(early.id))!;
    const lateAfter = (await aiRow(late.id))!;
    expect(earlyAfter.status).toBe("rejected");
    expect(lateAfter.status).toBe("rejected");
    expect(iso(earlyAfter.retain_until)).toBe("2028-11-01T07:45:00.000Z");
    expect(iso(lateAfter.retain_until)).toBe("2028-11-05T13:20:00.000Z");
    expect(iso(earlyAfter.retain_until)).toBe(addYears(NOV_1, 2).toISOString());
    expect(iso(lateAfter.retain_until)).toBe(addYears(NOV_5, 2).toISOString());
  });

  it("S4 uten innstilling: erstattet rad får 10 år", async () => {
    const { organization, grant } = await aiOrganization();
    const target = validTarget();
    const old = await oldSuggestion(organization.id, grant.employeeId, target, NOV_2);
    // Kort dato fra før viser at datoen faktisk regnes ut ved avvisningen
    await db.execute(
      sql`update ai_usage_log set retain_until = ${addYears(NOV_2, 1).toISOString()}::timestamptz where id = ${old.id}`,
    );

    await requestSuggestion(grant, validRequest({ target }));

    const replaced = (await aiRow(old.id))!;
    expect(replaced.status).toBe("rejected");
    expect(iso(replaced.retain_until)).toBe(addYears(NOV_2, 10).toISOString());
  });

  it.each([
    { name: "no_match", setup: () => ({ text: fakeNoMatchInput(), real: false }) },
    { name: "error", setup: () => ({ text: fakeErrorInputs()[0]!, real: false }) },
    { name: "blocked", setup: () => ({ text: SAMPLE_TEXT, real: true }) },
  ])("S5 nytt forslag som ikke er brukbart ($name) avviser ingenting", async ({ name, setup }) => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { [RETENTION_KEY]: 1 });
    const target = validTarget();
    const old = await oldSuggestion(organization.id, grant.employeeId, target, NOV_2);
    const before = snapshot(await aiRow(old.id));
    const { text, real } = setup();
    if (real) swap.provider = realLikeProvider();

    const result = await requestSuggestion(grant, validRequest({ target, fields: { text } }));

    expect(result.kind).toBe(name);
    const after = (await aiRow(old.id))!;
    expect(after.status).toBe("suggested");
    expect(iso(after.retain_until)).toBe(addYears(NOV_2, 10).toISOString());
    expect(snapshot(after)).toBe(before);
  });

  it("S6 rader på andre mål og i andre organisasjoner røres ikke", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    await mergeOrganizationSettings(a.organization.id, { [RETENTION_KEY]: 7 });
    await mergeOrganizationSettings(b.organization.id, { [RETENTION_KEY]: 1 });
    const target = validTarget();
    const inA = await oldSuggestion(a.organization.id, a.grant.employeeId, target, NOV_2);
    const inB = await oldSuggestion(b.organization.id, b.grant.employeeId, target, NOV_2);
    const otherTargetInA = await oldSuggestion(
      a.organization.id,
      a.grant.employeeId,
      validTarget(),
      NOV_2,
    );
    const beforeB = snapshot(await aiRow(inB.id));
    const beforeOther = snapshot(await aiRow(otherTargetInA.id));

    await requestSuggestion(a.grant, validRequest({ target }));

    expect(snapshot(await aiRow(inB.id))).toBe(beforeB);
    expect(snapshot(await aiRow(otherTargetInA.id))).toBe(beforeOther);
    const replaced = (await aiRow(inA.id))!;
    expect(replaced.status).toBe("rejected");
    expect(iso(replaced.retain_until)).toBe(addYears(NOV_2, 7).toISOString());
  });

  it("S7 ingen rad slettes: antallet øker med nøyaktig én", async () => {
    const { organization, grant } = await aiOrganization();
    await mergeOrganizationSettings(organization.id, { [RETENTION_KEY]: 2 });
    const target = validTarget();
    await oldSuggestion(organization.id, grant.employeeId, target, NOV_1);
    await oldSuggestion(organization.id, grant.employeeId, target, NOV_5);
    const before = await aiRowCount();

    await requestSuggestion(grant, validRequest({ target }));

    expect(await aiRowCount()).toBe(before + 1);
    const [deleted] = (await db.execute(
      sql`select count(*)::int as n from ai_usage_log where deleted_at is not null`,
    )) as unknown as { n: number }[];
    expect(deleted!.n).toBe(0);
  });
});
