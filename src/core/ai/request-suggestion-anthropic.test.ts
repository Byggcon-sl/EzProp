import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  ANTHROPIC_TEST_KEY,
  ANTHROPIC_TEST_MODEL,
  PROVIDER_MESSAGE_MARKER,
  aiRow,
  aiRowCount,
  allAiRows,
  anthropicErrorResponse,
  anthropicSettings,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  fakeAiProvider,
  recordDecision,
  requestSuggestion,
  stubAnthropicFetch,
  validRequest,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  createAssignment,
  createOrganization,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { STANDARD_KNOWN_VALUES } from "./redaction-cases";
import { seedKnownValues } from "../../../tests/known-values";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { preparePrompt } from "./prompt";
import { createConnection } from "@/core/integrations";
import { mergeOrganizationSettings } from "../../../tests/ai";

/*
 * Veien til en ekte leverandør i `requestSuggestion` (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md 3.2–3.6, R2–R7). Mot testdatabasen, med falsk HTTP (`vi.stubGlobal("fetch")`):
 * ingen ekte nettkall og ingen kostnad. Nøkkelen er oppdiktet og settes med `vi.stubEnv`.
 *
 * `language_polish` har i dag bare mål som er sperret mot ekte leverandør (`answer`, `ai_trial`).
 * For å prøve den åpne veien får funksjonen her et ekstra, oppdiktet mål (`TEST_TARGET_TYPE`) som
 * bare finnes i denne testfilen.
 *
 * Støtter hovedmål: KI i bunnen (bare vasket tekst som har bestått lekkasjesjekken forlater oss,
 * og bare når funksjonen er slått på) og de ansatte (forslagsflyten er den samme som med fake).
 */

const TEST_TARGET_TYPE = "oppdiktet_mal";

type FakeRequest = Parameters<typeof fakeAiProvider.complete>[0];

vi.mock("./features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features")>();
  const patched = {
    ...actual.AI_FEATURES.language_polish,
    allowedTargets: [
      ...actual.AI_FEATURES.language_polish.allowedTargets,
      { type: "oppdiktet_mal", fieldKey: "text" },
    ],
  };
  return {
    ...actual,
    getFeatureDefinition: (code: string) =>
      code === "language_polish" ? patched : actual.getFeatureDefinition(code),
  };
});

const swap = vi.hoisted(() => ({
  provider: null as null | {
    code: string;
    model: string;
    complete: (request: unknown) => Promise<unknown>;
  },
  features: null as null | string[],
  prompt: null as null | string,
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
            features: swap.features,
          }
        : actual.resolveAiProvider(grant),
  };
});

vi.mock("./prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt")>();
  return {
    ...actual,
    preparePrompt: vi.fn((...args: Parameters<typeof actual.preparePrompt>) => {
      const prepared = actual.preparePrompt(...args);
      return swap.prompt === null ? prepared : { ...prepared, prompt: swap.prompt };
    }),
  };
});

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_TEST_KEY);
});

afterEach(() => {
  swap.provider = null;
  swap.features = null;
  swap.prompt = null;
  vi.mocked(preparePrompt).mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function openTarget() {
  return { type: TEST_TARGET_TYPE, id: uuidv7(), fieldKey: "text" };
}

/** Organisasjon med `anthropic` og en ansatt. */
async function anthropicOrganization(
  roles: EmployeeVariant[] = ["inspector"],
  options: Parameters<typeof enableAnthropic>[1] = {},
) {
  const organization = await createOrganization("Oppdiktet Takst A");
  const connection = await enableAnthropic(organization.id, options);
  const person = await employeeWithGrant(organization.id, roles);
  return { organization, connection, ...person };
}

/** En forespørsel på det åpne målet, med oppdrag. */
async function openRequest(organizationId: string, text = "Taket er gammelt og har noen sprekker") {
  const assignment = await createAssignment(organizationId);
  return validRequest({ assignmentId: assignment.id, target: openTarget(), fields: { text } });
}

function spyOnOutput() {
  return [
    ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    ),
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function outputText(spies: ReturnType<typeof spyOnOutput>): string {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

/** Alle rader i tabellen som JSON-tekst (alle kolonner). */
async function tableText(table: "ai_usage_log" | "integration_connections" | "audit_log") {
  const rows = (await db.execute(
    sql`select row_to_json(t)::text as j from ${sql.identifier(table)} t`,
  )) as unknown as { j: string }[];
  return rows.map((row) => row.j).join("\n");
}

/** Kroppen som ble sendt i kall nummer `index`, som tekst. */
function sentBody(fetchMock: ReturnType<typeof stubAnthropicFetch>, index = 0): string {
  const init = fetchMock.mock.calls[index]?.[1];
  return typeof init?.body === "string" ? init.body : "";
}

describe("3.2 sperren for ekte leverandør (R2)", () => {
  it.each([
    {
      name: "ai_trial",
      target: () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" }),
      assignment: false,
    },
    {
      name: "answer med oppdrag",
      target: () => ({ type: "answer", id: uuidv7(), fieldKey: "text" }),
      assignment: true,
    },
    { name: "fritekst uten oppdrag", target: openTarget, assignment: false },
  ])("$name mot anthropic → blocked-rad, fetch ikke kalt", async ({ target, assignment }) => {
    const { organization, grant } = await anthropicOrganization();
    const fetchMock = stubAnthropicFetch();
    const assignmentId = assignment ? (await createAssignment(organization.id)).id : null;
    const request = validRequest({ assignmentId, target: target() });

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("blocked");
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe(ANTHROPIC_TEST_MODEL);
  });

  it.each([
    { name: "ai_trial", target: () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" }) },
    { name: "fritekst uten oppdrag", target: openTarget },
  ])("kontroll: $name mot fake → ikke blocked", async ({ target }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const result = await requestSuggestion(grant, validRequest({ target: target() }));
    expect(result.kind).toBe("suggestion");
  });

  it("isBlocked bruker fast kode: en annen adapter med code fake sperres ikke", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const complete = vi.fn(async () => ({
      outcome: "ok" as const,
      text: "Oppdiktet svar.",
      tokensIn: 1,
      tokensOut: 1,
      cost: 0,
      currency: "NOK",
    }));
    swap.provider = { code: "fake", model: "fake-kopi", complete };

    const result = await requestSuggestion(
      grant,
      validRequest({ target: { type: "ai_trial", id: uuidv7(), fieldKey: "text" } }),
    );

    expect(result.kind).toBe("suggestion");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("isBlocked bruker fast kode: alt annet enn fake sperres, også et objekt som likner fake", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const complete = vi.fn((request: unknown) => fakeAiProvider.complete(request as FakeRequest));
    swap.provider = { code: "fake2", model: "fake-v1", complete };

    const result = await requestSuggestion(
      grant,
      validRequest({ target: { type: "ai_trial", id: uuidv7(), fieldKey: "text" } }),
    );

    expect(result).toEqual({ kind: "blocked" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("3.3 settings.features (R3)", () => {
  it.each([
    { name: "tom liste", settings: anthropicSettings({ features: [] }) },
    {
      name: "manglende liste (rå rad)",
      settings: { model: ANTHROPIC_TEST_MODEL, pricing: anthropicSettings().pricing },
    },
  ])("$name → disabled, ingen rad, ingen vask, fetch ikke kalt", async ({ settings }) => {
    const { organization, grant } = await anthropicOrganization(["inspector"], { settings });
    const fetchMock = stubAnthropicFetch();

    const result = await requestSuggestion(grant, await openRequest(organization.id));

    expect(result).toEqual({ kind: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(preparePrompt).not.toHaveBeenCalled();
  });

  it("funksjon som ikke står i listen → disabled før vasken, ingen rad, intet kall", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const complete = vi.fn((request: unknown) => fakeAiProvider.complete(request as FakeRequest));
    swap.provider = { code: "other_test_provider", model: "other-test-v1", complete };
    swap.features = ["phrase_suggestion"];

    const result = await requestSuggestion(grant, await openRequest(organization.id));

    expect(result).toEqual({ kind: "disabled" });
    expect(complete).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
    expect(preparePrompt).not.toHaveBeenCalled();
  });

  it("sperret mål går foran funksjonslisten (blocked-rad, som før)", async () => {
    const { grant } = await anthropicOrganization(["inspector"], {
      settings: anthropicSettings({ features: [] }),
    });
    const result = await requestSuggestion(
      grant,
      validRequest({ target: { type: "ai_trial", id: uuidv7(), fieldKey: "text" } }),
    );
    expect(result).toEqual({ kind: "blocked" });
  });

  it("fake har ingen liste og tar alle funksjoner som før", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    expect((await requestSuggestion(grant, validRequest())).kind).toBe("suggestion");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("3.4 hele flyten med falsk HTTP (R4)", () => {
  it("vellykket kall: kroppen er vasket, raden har anthropic, modellen, tokens og kostnad; forslaget kan godtas", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, STANDARD_KNOWN_VALUES);
    const fetchMock = stubAnthropicFetch();
    const text =
      "Åse Testesen på Prøvetunet 7 ringte fra 12345678 om gnr 12 bnr 34. Taket bør skiftes.";
    const request = validRequest({ assignmentId, target: openTarget(), fields: { text } });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody(fetchMock);
    for (const value of ["Åse", "Testesen", "Prøvetunet", "12345678", "12/34", "gnr 12"]) {
      expect(body).not.toContain(value);
    }
    expect(body).toContain("[navn]");
    // Ingen identitet i kroppen
    for (const id of [grant.organizationId, grant.employeeId, assignmentId, request.requestId]) {
      expect(body).not.toContain(id);
    }
    expect(body).not.toContain("Oppdiktet Takst A");
    expect(body).not.toContain(ANTHROPIC_TEST_KEY);

    const row = (await aiRow(request.requestId))!;
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe(ANTHROPIC_TEST_MODEL);
    expect(row.outcome).toBe("ok");
    expect(row.tokens_in).toBe(120);
    expect(row.tokens_out).toBe(40);
    expect(Number(row.cost)).toBeCloseTo((120 * 30 + 40 * 150) / 1_000_000, 10);
    expect(row.currency).toBe("NOK");
    expect(row.status).toBe("suggested");

    await recordDecision(grant, request.requestId, "accepted");
    expect((await aiRow(request.requestId))!.status).toBe("accepted");
  });

  it.each(["edited", "rejected"])("forslaget fra anthropic kan også få %s", async (decision) => {
    const { organization, grant } = await anthropicOrganization();
    stubAnthropicFetch();
    const request = await openRequest(organization.id);
    expect((await requestSuggestion(grant, request)).kind).toBe("suggestion");
    await recordDecision(grant, request.requestId, decision);
    expect((await aiRow(request.requestId))!.status).toBe(decision);
  });

  it.each([
    { name: "telefon som slapp gjennom vasken", leaked: "Ring 912 34 567 i morgen." },
    { name: "e-post som slapp gjennom vasken", leaked: "Skriv til qxz.partsen@example.no." },
  ])("lekkasjesjekken stopper: $name → blocked-rad, fetch ikke kalt", async ({ leaked }) => {
    const { organization, grant } = await anthropicOrganization();
    const fetchMock = stubAnthropicFetch();
    swap.prompt = leaked;
    const request = await openRequest(organization.id);

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("blocked");
    expect(row.provider).toBe("anthropic");
    expect(row.output_text).toBeNull();
  });

  it("lekkasjesjekken bruker kjente verdier fra oppdraget: et kjent navn som slapp gjennom stopper kallet", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, {
      parties: [{ name: "Qxzolav Partsen" }],
    });
    const fetchMock = stubAnthropicFetch();
    swap.prompt = "Teksten nevner Qxzolav.";
    const request = validRequest({ assignmentId, target: openTarget() });

    expect(await requestSuggestion(grant, request)).toEqual({ kind: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lekkasjesjekken kjører ikke mot fake (uendret oppførsel)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id);
    swap.prompt = "Ring 912 34 567 i morgen.";
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
  });

  it("feil fra leverandøren: 401 gir rejected; merket og nøkkelen står ikke i logg, rader eller last_error", async () => {
    const { organization, grant, connection } = await anthropicOrganization();
    const fetchMock = stubAnthropicFetch(() => anthropicErrorResponse(401));
    const spies = spyOnOutput();
    const request = await openRequest(organization.id);

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.error_code).toBe("rejected");
    for (const table of ["ai_usage_log", "integration_connections", "audit_log"] as const) {
      const text = await tableText(table);
      expect(text, table).not.toContain(PROVIDER_MESSAGE_MARKER);
      expect(text, table).not.toContain(ANTHROPIC_TEST_KEY);
    }
    const [after] = (await db.execute(
      sql`select last_error, status from integration_connections where id = ${connection!.id}`,
    )) as unknown as { last_error: string | null; status: string }[];
    expect(after).toEqual({ last_error: null, status: "active" });
    const seen = outputText(spies);
    expect(seen).not.toContain(PROVIDER_MESSAGE_MARKER);
    expect(seen).not.toContain(ANTHROPIC_TEST_KEY);
  });

  it("nøkkelen står ingen steder i databasen etter vellykket kall og etter feil", async () => {
    const { organization, grant } = await anthropicOrganization();
    stubAnthropicFetch();
    await requestSuggestion(grant, await openRequest(organization.id));
    vi.unstubAllGlobals();
    stubAnthropicFetch(() => anthropicErrorResponse(500));
    await requestSuggestion(grant, await openRequest(organization.id));

    expect(await aiRowCount()).toBe(2);
    for (const table of ["ai_usage_log", "integration_connections", "audit_log"] as const) {
      expect(await tableText(table), table).not.toContain(ANTHROPIC_TEST_KEY);
    }
  });
});

describe("3.5 tenant-isolasjon for veien med anthropic (R6, regel 2)", () => {
  it.each([
    { name: "A har anthropic, B har fake", a: "anthropic", b: "fake" },
    { name: "A har fake, B har anthropic", a: "fake", b: "anthropic" },
  ])("$name: hver organisasjon bruker bare sin egen tilkobling", async ({ a, b }) => {
    const providerOf = new Map<string, string>();
    const assignmentOf = new Map<string, string>();
    const fetchMock = stubAnthropicFetch();

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const [grant, provider] of [
          [grantA, a],
          [grantB, b],
        ] as const) {
          if (provider === "anthropic") await enableAnthropic(grant.organizationId);
          else await enableAi(grant.organizationId);
          providerOf.set(grant.organizationId, provider);
          assignmentOf.set(grant.organizationId, (await createAssignment(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const result = await requestSuggestion(
          grant,
          validRequest({
            assignmentId: assignmentOf.get(grant.organizationId)!,
            target: openTarget(),
          }),
        );
        if (result.kind !== "suggestion") return [];
        const row = (await aiRow(result.usageId))!;
        expect(row.provider).toBe(providerOf.get(grant.organizationId));
        return [{ id: row.organization_id }];
      },
      idOf: (row) => row.id,
    });

    // fetch er kalt bare for organisasjonen med anthropic, én gang
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await allAiRows();
    expect(rows.map((row) => row.provider).sort()).toEqual(["anthropic", "fake"]);
    for (const row of rows) {
      expect(row.provider).toBe(providerOf.get(row.organization_id));
      expect(row.model).toBe(row.provider === "anthropic" ? ANTHROPIC_TEST_MODEL : "fake-v1");
    }
  });

  it.each([
    { name: "A har alt, B har bare ai.enabled → B får disabled", full: "A" },
    { name: "B har alt, A har ingenting → A får disabled", full: "B" },
  ])("$name", async ({ full }) => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    const [withAll, without] = full === "A" ? [orgA, orgB] : [orgB, orgA];
    await enableAnthropic(withAll.id);
    if (full === "A") await mergeOrganizationSettings(without.id, { "ai.enabled": true });
    const { grant } = await employeeWithGrant(without.id);
    const fetchMock = stubAnthropicFetch();

    const result = await requestSuggestion(grant, await openRequest(without.id));

    expect(result).toEqual({ kind: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  it("organisasjons-id i forespørselen brukes aldri: B sin tilkobling brukes for B", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAnthropic(orgA.id);
    await enableAi(orgB.id);
    const { grant } = await employeeWithGrant(orgB.id);
    const fetchMock = stubAnthropicFetch();
    const request = validRequest({
      assignmentId: (await createAssignment(orgB.id)).id,
      target: { type: TEST_TARGET_TYPE, id: orgA.id, fieldKey: "text" },
    });

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(fetchMock).not.toHaveBeenCalled();
    const row = (await aiRow(request.requestId))!;
    expect(row.provider).toBe("fake");
    expect(row.organization_id).toBe(orgB.id);
  });
});

describe("3.6 tilgang per rolle (R7)", () => {
  it.each<{ name: string; roles: EmployeeVariant[]; reportEdit?: boolean }>([
    { name: "takstmann", roles: ["inspector"] },
    { name: "kontor med report.edit", roles: ["office"], reportEdit: true },
    { name: "leder", roles: ["manager"] },
    { name: "admin", roles: ["admin"] },
  ])("$name kan be om forslag mot anthropic og godta det", async ({ roles, reportEdit }) => {
    const { organization, employee, actor } = await anthropicOrganization(roles);
    if (reportEdit) await grantPermission(employee, "report.edit");
    const grant = await requireOrganizationAccess(actor, organization.id);
    const fetchMock = stubAnthropicFetch();
    const request = await openRequest(organization.id);
    expect((await requestSuggestion(grant, request)).kind).toBe("suggestion");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await recordDecision(grant, request.requestId, "accepted");
  });

  it("kontor uten report.edit: AccessDeniedError, ingen rad, intet kall", async () => {
    const { organization, grant } = await anthropicOrganization(["office"]);
    const fetchMock = stubAnthropicFetch();
    await expect(
      requestSuggestion(grant, await openRequest(organization.id)),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });

  // Regel 11. Denne testen skal aldri fjernes: admin stenges aldri ute.
  it("admin uten andre roller kan slå KI på, lage anthropic-tilkoblingen og be om forslag", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const { actor, grant } = await employeeWithGrant(organization.id, ["admin"]);
    await mergeOrganizationSettings(organization.id, { "ai.enabled": true });
    await createConnection(actor, organization.id, {
      port: "ai",
      provider: "anthropic",
      secretRef: "ANTHROPIC_API_KEY",
      settings: anthropicSettings(),
    });
    const fetchMock = stubAnthropicFetch();
    const request = await openRequest(organization.id);

    expect((await requestSuggestion(grant, request)).kind).toBe("suggestion");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fjernet ansatt får AccessDeniedError før noe fetch-kall", async () => {
    const { organization, actor } = await anthropicOrganization();
    const fetchMock = stubAnthropicFetch();
    await db.execute(
      sql`update employees set deactivated_at = now() where organization_id = ${organization.id}`,
    );
    await expect(
      requireOrganizationAccess(actor, organization.id, "report.edit"),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
