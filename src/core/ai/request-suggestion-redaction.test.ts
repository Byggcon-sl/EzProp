import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRow,
  aiRowCount,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  expectSameRejection,
  fakeAiProvider,
  neutralRequestRejection,
  recordDecision,
  requestSuggestion,
  SAMPLE_TEXT,
  snapshot,
  tenYearsAfter,
  validRequest,
  validTarget,
} from "../../../tests/ai";
import {
  createAiUsageLog,
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
import { PROMPT_INPUT_SEPARATOR } from "./features";
import type { AiProvider, AiProviderRequest } from "./providers/types";

/*
 * Vask før KI i `requestSuggestion` (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 4, 5
 * og 7). Mot testdatabasen. De øvrige testene for `requestSuggestion` ligger i
 * `request-suggestion.test.ts`.
 * Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (én vei inn, alt logges likt), de ansatte (gjentatte kall fra
 * iPaden gir samme svar og ingen dobbel rad) og færre reklamasjoner (et forslag kan aldri avgjøres
 * eller leses av en annen organisasjon, og hvem som ba om hva står i loggen).
 */

/*
 * Vask før KI (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 4, 5 og 7): én test kan late
 * som om koden hadde en ekte adapter (`override.provider`), og oppslaget av kjente verdier og
 * vasken i `./redaction` kan telles og feile med vilje. Ellers brukes den ekte koden, så de andre
 * testene i filen prøver den ekte veien.
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

const redactionControl = vi.hoisted(() => ({
  loadCalls: 0,
  redactCalls: 0,
  failLoad: null as Error | null,
  failRedact: null as Error | null,
}));
vi.mock("./redaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redaction")>();
  // Vasken går gjennom `redactFields` (oppslag av kjente verdier bare med oppdrag, så vask).
  return {
    ...actual,
    redactFields: async (
      grant: EmployeeGrant,
      assignmentId: string | null,
      fields: Record<string, string>,
    ) => {
      if (assignmentId !== null) {
        redactionControl.loadCalls += 1;
        if (redactionControl.failLoad) throw redactionControl.failLoad;
      }
      redactionControl.redactCalls += 1;
      if (redactionControl.failRedact) throw redactionControl.failRedact;
      return actual.redactFields(grant, assignmentId, fields);
    },
  };
});

beforeEach(resetDatabase);
afterEach(() => {
  override.provider = null;
  redactionControl.loadCalls = 0;
  redactionControl.redactCalls = 0;
  redactionControl.failLoad = null;
  redactionControl.failRedact = null;
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

const trialTarget = () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" });

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

/** En «ekte» leverandør (annen kode enn `fake`) som tar vare på ledeteksten. */
function realProvider() {
  const prompts: string[] = [];
  const provider: AiProvider = {
    code: "anthropic",
    model: "oppdiktet-modell",
    complete: vi.fn(async (request: AiProviderRequest) => {
      prompts.push(request.prompt);
      return {
        outcome: "ok" as const,
        text: "Oppdiktet forslag.",
        tokensIn: 7,
        tokensOut: 3,
        cost: 0.01,
        currency: "NOK",
      };
    }),
  };
  return { provider, prompts };
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

  it("V4.3 redacted_count står ikke i svaret til kalleren", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    const { result } = await sendAndCapture(grant, assignmentId, "Åse Testesen kom.");
    expect(JSON.stringify(result)).not.toMatch(/redact/iu);
  });
});

describe("vask før KI: feil stenger (V4.5, A176)", () => {
  const TEXT = "Åse Testesen ringte fra 12345678.";

  it.each([
    { name: "oppslaget av kjente verdier kaster", fail: "load" as const },
    { name: "vasken kaster", fail: "redact" as const },
  ])(
    "V4.5 $name: leverandøren kalles ikke, ingen ok-rad, ingen verdier i feil eller logger",
    async ({ fail }) => {
      const { grant, assignmentId } = await organizationWithKnownValues({
        parties: [{ name: "Åse Testesen", phone: "12345678" }],
      });
      if (fail === "load") redactionControl.failLoad = new Error("oppdiktet feil i oppslaget");
      else redactionControl.failRedact = new Error("oppdiktet feil i vasken");
      const spy = vi.spyOn(fakeAiProvider, "complete");
      const logSpies = spyOnLogger();
      const request = validRequest({ assignmentId, fields: { text: TEXT } });

      let failure: unknown = null;
      let result: unknown = null;
      try {
        result = await requestSuggestion(grant, request);
      } catch (error) {
        failure = error;
      }

      expect(spy).not.toHaveBeenCalled();
      const okRows = (await db.execute(
        sql`select id from ai_usage_log where outcome = 'ok'`,
      )) as unknown as unknown[];
      expect(okRows).toHaveLength(0);
      expect(failure ?? result, "feilen skal gå ut som ved uventet feil").not.toBeNull();
      const seen = [
        failure instanceof Error ? `${failure.message} ${failure.stack ?? ""}` : "",
        JSON.stringify(result),
        loggedText(logSpies),
      ].join(" ");
      for (const value of ["Åse", "Testesen", "12345678"]) expect(seen).not.toContain(value);
      if (fail === "load") expect(redactionControl.loadCalls).toBeGreaterThan(0);
      else expect(redactionControl.redactCalls).toBeGreaterThan(0);
    },
  );
});

describe("vask før KI: rekkefølgen og oppslaget (V4.6–V4.8)", () => {
  it("V4.6 «KI er av» kjører ikke oppslaget av kjente verdier", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Åse Testesen" }],
    });
    const result = await requestSuggestion(
      grant,
      validRequest({ assignmentId, fields: { text: "Åse Testesen kom." } }),
    );
    expect(result).toEqual({ kind: "disabled" });
    expect(redactionControl.loadCalls).toBe(0);
  });

  it("V4.6 blocked kjører ikke oppslaget av kjente verdier", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    override.provider = realProvider().provider;
    const result = await requestSuggestion(
      grant,
      validRequest({ assignmentId, fields: { text: "Åse Testesen kom." } }),
    );
    expect(result).toEqual({ kind: "blocked" });
    expect(redactionControl.loadCalls).toBe(0);
  });

  it("V4.6 gyldig forespørsel med oppdrag kjører oppslaget én gang og vasken", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    await sendAndCapture(grant, assignmentId, "Åse Testesen kom.");
    expect(redactionControl.loadCalls).toBe(1);
    expect(redactionControl.redactCalls).toBeGreaterThan(0);
  });

  it("V4.7 den falske leverandøren vaskes også: ai_trial uten oppdrag gir [telefon] i forslaget", async () => {
    const { grant } = await aiOrganization();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const request = validRequest({
      target: trialTarget(),
      fields: { text: "ring 12345678 og skriv til ola.prove@example.no" },
    });
    const result = await requestSuggestion(grant, request);
    expect(result.kind).toBe("suggestion");
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
    expect(redactionControl.loadCalls).toBe(0);
    expect(input).toContain("[telefon]");
    expect(input).not.toContain("12345678");
    // Uten oppdrag er navnet ingen kjent verdi, og mønstrene kjenner ikke navn (restrisiko)
    expect(input).toContain("Åse Testesen");
  });
});

describe("vask før KI: utfallet blocked (V5, ad-1, A171, A173)", () => {
  async function expectBlockedRow(requestId: string) {
    const row = (await aiRow(requestId))!;
    expect(row, "blocked-raden mangler").toBeDefined();
    expect(row.outcome).toBe("blocked");
    expect(row.status).toBeNull();
    expect(row.output_text).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
    expect(Number(row.cost)).toBe(0);
    expect(row.redacted_count).toBe(0);
    expect(row.provider).toBe("anthropic");
    expect(row.deleted_at).toBeNull();
    return row;
  }

  it("V5.1 answer med ekte leverandør: blocked-rad, intet kall, svar { kind: blocked }", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    const real = realProvider();
    override.provider = real.provider;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const request = validRequest({ assignmentId, fields: { text: "Åse Testesen kom." } });

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(real.provider.complete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
    const row = await expectBlockedRow(request.requestId);
    expect(row.organization_id).toBe(grant.organizationId);
    expect(row.employee_id).toBe(grant.employeeId);
    expect(row.target_ref).toEqual(request.target);
    expect(JSON.stringify(row)).not.toContain("Testesen");
  });

  it.each([
    { name: "ai_trial med ekte leverandør", trial: true },
    { name: "fritekst uten oppdrag (mål ikke ai_trial) med ekte leverandør", trial: false },
  ])("V5.2 $name: blocked-rad, intet kall", async ({ trial }) => {
    const { grant } = await aiOrganization();
    const real = realProvider();
    override.provider = real.provider;
    const request = validRequest({
      assignmentId: null,
      ...(trial ? { target: trialTarget() } : {}),
    });

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(real.provider.complete).not.toHaveBeenCalled();
    await expectBlockedRow(request.requestId);
  });

  it("V5.3 answer med falsk leverandør virker (A173)", async () => {
    const { grant, assignmentId } = await organizationWithKnownValues({
      parties: [{ name: "Åse Testesen" }],
    });
    const { result, request } = await sendAndCapture(grant, assignmentId, SAMPLE_TEXT);
    expect(result.kind).toBe("suggestion");
    expect((await aiRow(request.requestId))!.outcome).toBe("ok");
  });

  it("V5.3 ai_trial med falsk leverandør virker som før", async () => {
    const { grant } = await aiOrganization();
    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));
    expect(result.kind).toBe("suggestion");
  });

  it("V5.4 forrige åpne forslag på samme mål står som suggested etter blocked", async () => {
    const { grant, organization } = await aiOrganization();
    const target = validTarget();
    const previous = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      targetRef: target,
      createdAt: new Date("2026-11-02T09:00:00Z"),
    });
    const auditBefore = await auditCount();
    override.provider = realProvider().provider;

    const result = await requestSuggestion(grant, validRequest({ target }));

    expect(result).toEqual({ kind: "blocked" });
    expect((await aiRow(previous.id))!.status).toBe("suggested");
    expect(await auditCount()).toBe(auditBefore);
  });

  it("V5.5 samme requestId igjen: blocked, ingen ny rad, intet kall", async () => {
    const { grant } = await aiOrganization();
    const real = realProvider();
    override.provider = real.provider;
    const request = validRequest();
    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });
    const rowAfterFirst = snapshot(await aiRow(request.requestId));

    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });

    expect(await aiRowCount()).toBe(1);
    expect(real.provider.complete).not.toHaveBeenCalled();
    expect(snapshot(await aiRow(request.requestId))).toBe(rowAfterFirst);
  });

  it("V5.5 samme requestId igjen etter bytte til falsk leverandør: fortsatt blocked, intet kall", async () => {
    const { grant } = await aiOrganization();
    override.provider = realProvider().provider;
    const request = validRequest();
    await requestSuggestion(grant, request);
    override.provider = null;
    const spy = vi.spyOn(fakeAiProvider, "complete");
    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(1);
  });

  it("V5.6 blocked-raden fra requestSuggestion kan ikke avgjøres", async () => {
    const { grant } = await aiOrganization();
    override.provider = realProvider().provider;
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
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id, { enabled: false });
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));
    expect(result).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
  });

  it("V10.1 blocked-raden får retain_until = opprettet + 10 år", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    const { grant } = await aiOrganization();
    override.provider = realProvider().provider;
    const request = validRequest();
    await requestSuggestion(grant, request);
    const row = (await aiRow(request.requestId))!;
    expect(new Date(row.retain_until).toISOString()).toBe(tenYearsAfter(TEST_NOW).toISOString());
  });
});

describe("vask før KI: tenant (V7.2, V7.3)", () => {
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

  it("V7.3 A sitt oppdrag i en forespørsel fra B: nøytralt avslag, intet oppslag, ingen rad", async () => {
    const a = await organizationWithKnownValues({ parties: [{ name: "Åse Testesen" }] });
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    const b = await employeeWithGrant(orgB.id, ["admin"], "Test Admin B");
    const baseline = await neutralRequestRejection(b.grant);
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const error = await captureError(() =>
      requestSuggestion(
        b.grant,
        validRequest({ assignmentId: a.assignmentId, fields: { text: "Åse Testesen kom." } }),
      ),
    );

    expectSameRejection(error, baseline);
    expect(error.message).not.toContain("Testesen");
    expect(spy).not.toHaveBeenCalled();
    expect(redactionControl.loadCalls).toBe(0);
    expect(await aiRowCount()).toBe(0);
  });
});
