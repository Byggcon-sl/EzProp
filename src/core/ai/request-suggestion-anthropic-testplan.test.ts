import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { createConnection, updateConnection } from "@/core/integrations";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiRow,
  aiRowCount,
  allAiRows,
  anthropicSettings,
  captureError,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  mergeOrganizationSettings,
  recordDecision,
  requestSuggestion,
  validRequest,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  errorReply,
  fakeAnthropic,
  okReply,
  PROVIDER_MESSAGE_MARK,
  sentPromptText,
  TEST_ANTHROPIC_KEY,
  TEST_MODEL,
} from "../../../tests/fake-anthropic-http";
import {
  createAssignment,
  createOrganization,
  createUser,
  createEmployee,
  resetDatabase,
} from "../../../tests/factories";
import { containsWord, seedKnownValues, type KnownSeed } from "../../../tests/known-values";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { preparePrompt } from "./prompt";
import { fakeAiProvider } from "./providers/fake";

/*
 * `requestSuggestion` mot Anthropic-adapteren med falsk HTTP (docs/funksjoner/fase2a-ki-
 * leverandor-testplan.md 3.2–3.6, kortet Omfang 5 og 6, R2–R7). Mot testdatabasen. Ingen nettkall:
 * `fetch` er stubbet globalt, og adapteren slår den opp ved kallet. Nøkkel, modell, navn og
 * adresser er oppdiktet.
 *
 * Målet `answer` og prøvemålet `ai_trial` er sperret mot en ekte leverandør til `answers` finnes
 * (A166, A173). For å prøve hele den ekte veien (3.4–3.6) får `language_polish` her et ekstra,
 * oppdiktet mål bare i testen (`TEST_TARGET_TYPE`), med oppdrag. Det står for målene som kommer i
 * 2a-2. Sperren for `ai_trial`, `answer` og fritekst uten oppdrag prøves med de ekte målene (3.2).
 *
 * Støtter hovedmål: KI i bunnen (bare vasket tekst som har bestått lekkasjesjekken forlater oss,
 * og nøkkelen havner aldri i databasen eller loggen), de ansatte (godta, endre og avvis virker som
 * før) og færre reklamasjoner (en annen organisasjons tilkobling brukes aldri).
 */

const TEST_TARGET_TYPE = "test_ekte_mal";
const KEY_NAME = "ANTHROPIC_API_KEY";

const swap = vi.hoisted(() => ({
  /** Når satt: ledeteksten som «vasken» gir tilbake (for å prøve lekkasjesjekken). */
  leakPrompt: null as null | string,
  /** Når satt: adapteren `resolveAiProvider` gir (for å prøve sperren på fast kode). */
  provider: null as null | {
    code: string;
    model: string;
    complete: (request: unknown) => Promise<unknown>;
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
            features: null,
          }
        : actual.resolveAiProvider(grant),
  };
});

vi.mock("./features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features")>();
  return {
    ...actual,
    getFeatureDefinition: (code: string) => {
      const definition = actual.getFeatureDefinition(code);
      if (!definition || definition.code !== "language_polish") return definition;
      return {
        ...definition,
        allowedTargets: [
          ...definition.allowedTargets,
          { type: TEST_TARGET_TYPE, fieldKey: "text" },
        ],
      };
    },
  };
});

vi.mock("./prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt")>();
  return {
    ...actual,
    preparePrompt: vi.fn((...args: Parameters<typeof actual.preparePrompt>) => {
      const prepared = actual.preparePrompt(...args);
      if (swap.leakPrompt === null) return prepared;
      return { ...prepared, prompt: `${prepared.prompt}\n${swap.leakPrompt}` };
    }),
  };
});

/** Kjente verdier på oppdraget. Alle oppdiktet. */
const KNOWN: KnownSeed = {
  parties: [{ name: "Åse Testesen", phone: "+47 41 23 45 67", email: "qxz.partsen@example.no" }],
  property: { address: "Lundetunet 3", gnr: "63", bnr: "74" },
};
const TEXT_WITH_PII =
  "Møtte Åse Testesen på Lundetunet 3. Ring 41234567 eller qxz.partsen@example.no. " +
  "Matrikkel 63/74. taket er gammelt og har noen sprekker";
const PII_VALUES = ["Åse", "Testesen", "Lundetunet", "41234567", "qxz.partsen@example.no", "63/74"];
const REPLY_TEXT = "Taket er gammelt og har noen sprekker.";

let http: ReturnType<typeof fakeAnthropic>;
let spies: ReturnType<typeof spyOnOutput>;

function spyOnOutput() {
  return [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
  ];
}

function outputText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => inspect(args, { depth: 6 }))
    .join("\n");
}

function useHttp(...replies: Parameters<typeof fakeAnthropic>) {
  http = fakeAnthropic(...replies);
  vi.stubGlobal("fetch", http.fetchFn);
}

beforeEach(async () => {
  await resetDatabase();
  swap.leakPrompt = null;
  swap.provider = null;
  vi.mocked(preparePrompt).mockClear();
  useHttp(okReply({ text: REPLY_TEXT, inputTokens: 120, outputTokens: 40 }));
  vi.stubEnv(KEY_NAME, TEST_ANTHROPIC_KEY);
  spies = spyOnOutput();
});

afterEach(() => {
  swap.leakPrompt = null;
  swap.provider = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const realTarget = () => ({ type: TEST_TARGET_TYPE, id: uuidv7(), fieldKey: "text" });
const trialTarget = () => ({ type: "ai_trial", id: uuidv7(), fieldKey: "text" });
const answerTarget = () => ({ type: "answer", id: uuidv7(), fieldKey: "text" });

/** Organisasjon med gyldig `anthropic`-tilkobling, en ansatt og et oppdrag med kjente verdier. */
async function anthropicOrganization(
  options: {
    name?: string;
    roles?: EmployeeVariant[];
    connection?: Parameters<typeof enableAnthropic>[1];
  } = {},
) {
  const organization = await createOrganization(options.name ?? "Oppdiktet Takst A");
  const connection = await enableAnthropic(organization.id, options.connection ?? {});
  const assignmentId = await seedKnownValues(organization.id, KNOWN);
  const person = await employeeWithGrant(organization.id, options.roles ?? ["inspector"]);
  return { organization, connection, assignmentId, ...person };
}

function realRequest(assignmentId: string, text = TEXT_WITH_PII) {
  return validRequest({ assignmentId, target: realTarget(), fields: { text } });
}

/** Alle kolonner i tabellene som tekst (rad til tekst), for å lete etter verdier som ikke skal stå der. */
async function tableText(table: "ai_usage_log" | "integration_connections" | "audit_log") {
  const rows = (await db.execute(
    sql`select t::text as row from ${sql.identifier(table)} t`,
  )) as unknown as { row: string }[];
  return rows.map((r) => r.row).join("\n");
}

describe("sperren for ekte leverandør (3.2, R2)", () => {
  it.each([
    {
      name: "ai_trial",
      request: (_assignmentId: string) => validRequest({ target: trialTarget() }),
    },
    {
      name: "answer med oppdrag",
      request: (assignmentId: string) => validRequest({ assignmentId, target: answerTarget() }),
    },
    {
      name: "fritekst uten oppdrag",
      request: (_assignmentId: string) =>
        validRequest({ assignmentId: null, target: realTarget() }),
    },
  ])("3.2 $name mot anthropic → blocked, blocked-rad, intet kall", async ({ request }) => {
    const { grant, assignmentId } = await anthropicOrganization();
    const sent = request(assignmentId);

    const result = await requestSuggestion(grant, sent);

    expect(result).toEqual({ kind: "blocked" });
    const row = await aiRow(sent.requestId);
    expect(row).toBeDefined();
    expect(row!.outcome).toBe("blocked");
    expect(row!.provider).toBe("anthropic");
    expect(row!.output_text).toBeNull();
    expect(http.calls).toHaveLength(0);
    expect(vi.mocked(preparePrompt)).not.toHaveBeenCalled();
  });

  it.each([
    { name: "ai_trial", target: trialTarget, withAssignment: false },
    { name: "answer", target: answerTarget, withAssignment: true },
  ])(
    "3.2 kontroll: $name mot fake gir forslag som før (ikke blocked)",
    async ({ target, withAssignment }) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      await enableAi(organization.id);
      const assignment = await createAssignment(organization.id);
      const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
      const result = await requestSuggestion(
        grant,
        validRequest({ assignmentId: withAssignment ? assignment.id : null, target: target() }),
      );
      expect(result.kind).toBe("suggestion");
      expect(http.calls).toHaveLength(0);
    },
  );
});

describe("isBlocked bruker fast kode (3.2.1)", () => {
  async function fakeOrganization() {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    return (await employeeWithGrant(organization.id, ["inspector"])).grant;
  }

  it("3.2.1 en adapter med code «fake» som ikke er fakeAiProvider-objektet, sperres ikke", async () => {
    const grant = await fakeOrganization();
    const copy = {
      code: "fake",
      model: fakeAiProvider.model,
      complete: vi.fn(fakeAiProvider.complete),
    };
    expect(copy).not.toBe(fakeAiProvider);
    swap.provider = copy as typeof swap.provider;
    const result = await requestSuggestion(grant, validRequest({ target: trialTarget() }));
    expect(result.kind).toBe("suggestion");
    expect(copy.complete).toHaveBeenCalledTimes(1);
  });

  it.each(["anthropic", "FAKE", "fake ", "unknown_vendor"])(
    "3.2.1 alt annet enn code «fake» sperres for ai_trial, også med fake sin complete: %s",
    async (code) => {
      const grant = await fakeOrganization();
      const impostor = { code, model: "fake-v1", complete: vi.fn(fakeAiProvider.complete) };
      swap.provider = impostor as typeof swap.provider;
      const request = validRequest({ target: trialTarget() });
      const result = await requestSuggestion(grant, request);
      expect(result).toEqual({ kind: "blocked" });
      expect(impostor.complete).not.toHaveBeenCalled();
      expect((await aiRow(request.requestId))!.outcome).toBe("blocked");
    },
  );
});

describe("settings.features (3.3, R3)", () => {
  it("3.3.1/3.3.3 funksjonen står ikke i listen → disabled, ingen rad, intet kall, vasken ikke kalt", async () => {
    const { grant, assignmentId } = await anthropicOrganization({
      connection: { settings: anthropicSettings({ features: ["phrase_suggestion"] }) },
    });
    const result = await requestSuggestion(grant, realRequest(assignmentId));
    expect(result).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
    expect(vi.mocked(preparePrompt)).not.toHaveBeenCalled();
  });

  it("3.3.2/3.3.3 tom liste → disabled, ingen rad, intet kall, vasken ikke kalt", async () => {
    const { grant, assignmentId } = await anthropicOrganization({
      connection: { settings: anthropicSettings({ features: [] }) },
    });
    expect(await requestSuggestion(grant, realRequest(assignmentId))).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
    expect(vi.mocked(preparePrompt)).not.toHaveBeenCalled();
  });

  it("3.3.2 manglende liste (rå rad) → disabled, ingen rad, intet kall", async () => {
    const settings = anthropicSettings();
    delete settings.features;
    const { grant, assignmentId } = await anthropicOrganization({ connection: { settings } });
    expect(await requestSuggestion(grant, realRequest(assignmentId))).toEqual({ kind: "disabled" });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it("3.3.4 fake har ingen liste og tar alle funksjoner som før", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const assignmentId = await seedKnownValues(organization.id, KNOWN);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const result = await requestSuggestion(grant, realRequest(assignmentId));
    expect(result.kind).toBe("suggestion");
    expect(http.calls).toHaveLength(0);
  });
});

describe("hele flyten med falsk HTTP (3.4, R4)", () => {
  it("3.4.1 vellykket kall: bare vasket tekst sendes, raden har anthropic, modell, tokens og kostnad", async () => {
    const { grant, assignmentId } = await anthropicOrganization();
    const request = realRequest(assignmentId);

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.text).toBe(REPLY_TEXT);
    expect(http.calls).toHaveLength(1);
    const call = http.calls[0]!;
    const prompt = sentPromptText(call);
    for (const value of PII_VALUES) {
      expect(call.body, value).not.toContain(value);
      expect(containsWord(prompt, value), value).toBe(false);
    }
    expect(prompt).toMatch(/\[[a-zæøå-]+\]/u);
    expect(prompt).toContain("taket er gammelt");
    expect(call.body).not.toContain(grant.organizationId);
    expect(call.body).not.toContain(grant.employeeId);
    expect(call.body).not.toContain(assignmentId);
    expect(call.body).not.toContain(request.requestId);
    expect(call.body).not.toContain("Oppdiktet Takst A");

    const row = await aiRow(result.usageId);
    expect(row!.provider).toBe("anthropic");
    expect(row!.model).toBe(TEST_MODEL);
    expect(row!.outcome).toBe("ok");
    expect(row!.status).toBe("suggested");
    expect(row!.tokens_in).toBe(120);
    expect(row!.tokens_out).toBe(40);
    expect(Number(row!.cost)).toBeCloseTo((120 * 30 + 40 * 150) / 1_000_000, 9);
    expect(row!.currency).toBe("NOK");
    expect(row!.organization_id).toBe(grant.organizationId);
  });

  it.each(["accepted", "edited", "rejected"])(
    "3.4.1 forslaget fra anthropic kan avgjøres med recordDecision: %s",
    async (decision) => {
      const { grant, assignmentId } = await anthropicOrganization();
      const result = await requestSuggestion(grant, realRequest(assignmentId));
      expect(result.kind).toBe("suggestion");
      if (result.kind !== "suggestion") return;
      await recordDecision(grant, result.usageId, decision);
      const row = await aiRow(result.usageId);
      expect(row!.status).toBe(decision);
      expect(row!.decided_by).toBe(grant.employeeId);
      expect(http.calls).toHaveLength(1);
    },
  );

  it("3.4.2 lekkasjesjekken stopper: en kjent verdi i ledeteksten gir blocked-rad og intet kall", async () => {
    const { grant, assignmentId } = await anthropicOrganization();
    swap.leakPrompt = "Eier er Åse Testesen, tlf 41234567.";
    const request = realRequest(assignmentId, "taket er gammelt og har noen sprekker");

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(http.calls).toHaveLength(0);
    const row = await aiRow(request.requestId);
    expect(row).toBeDefined();
    expect(row!.outcome).toBe("blocked");
    expect(row!.provider).toBe("anthropic");
    const logged = outputText();
    expect(logged).not.toContain("Testesen");
    expect(logged).not.toContain("41234567");
  });

  it("3.4.2 lekkasjesjekken gjelder ikke fake (uendret oppførsel)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const assignmentId = await seedKnownValues(organization.id, KNOWN);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const result = await requestSuggestion(grant, realRequest(assignmentId));
    expect(result.kind).toBe("suggestion");
  });

  it("3.4.4 401 fra leverandøren: feilkoden rejected, merket og nøkkelen står ingen steder", async () => {
    useHttp(errorReply(401));
    const { grant, assignmentId, connection } = await anthropicOrganization();
    const request = realRequest(assignmentId);

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("error");
    const row = await aiRow(request.requestId);
    expect(row!.outcome).toBe("error");
    expect(row!.error_code).toBe("rejected");
    expect(row!.output_text).toBeNull();
    expect(http.calls).toHaveLength(1);

    for (const table of ["ai_usage_log", "integration_connections", "audit_log"] as const) {
      const text = await tableText(table);
      expect(text, table).not.toContain(PROVIDER_MESSAGE_MARK);
      expect(text, table).not.toContain(TEST_ANTHROPIC_KEY);
    }
    const [after] = (await db.execute(
      sql`select last_error, status from integration_connections where id = ${connection!.id}`,
    )) as unknown as { last_error: string | null; status: string }[];
    expect(after!.last_error).toBeNull();
    expect(after!.status).toBe("active");
    const logged = outputText();
    expect(logged).not.toContain(PROVIDER_MESSAGE_MARK);
    expect(logged).not.toContain(TEST_ANTHROPIC_KEY);
    expect(inspect(result)).not.toContain(PROVIDER_MESSAGE_MARK);
  });

  it("3.4.5 nøkkelen står ingen steder i databasen etter vellykket kall og etter feil", async () => {
    const { grant, assignmentId } = await anthropicOrganization();
    const ok = await requestSuggestion(grant, realRequest(assignmentId));
    expect(ok.kind).toBe("suggestion");
    useHttp(errorReply(500));
    const failed = await requestSuggestion(grant, realRequest(assignmentId));
    expect(failed.kind).toBe("error");
    expect(http.calls).toHaveLength(1);

    for (const table of ["ai_usage_log", "integration_connections", "audit_log"] as const) {
      const text = await tableText(table);
      expect(text, table).not.toContain(TEST_ANTHROPIC_KEY);
      expect(text, table).not.toContain("OPPDIKTET-TESTNOKKEL");
    }
    expect(outputText()).not.toContain(TEST_ANTHROPIC_KEY);
  });
});

describe("tenant-isolasjon for veien med anthropic (3.5, R6, regel 2)", () => {
  it("3.5.1 expectTenantIsolation: A bruker anthropic, B bruker fake, aldri omvendt", async () => {
    const assignmentByOrg = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        await enableAnthropic(orgA);
        await enableAi(orgB);
        assignmentByOrg.set(orgA, await seedKnownValues(orgA, KNOWN));
        assignmentByOrg.set(orgB, (await createAssignment(orgB)).id);
        return { a: [orgA], b: [orgB] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
        const request = realRequest(assignmentByOrg.get(grant.organizationId)!);
        await requestSuggestion(grant, request);
        const rows = (await db.execute(
          sql`select organization_id from ai_usage_log where id = ${request.requestId}`,
        )) as unknown as { organization_id: string }[];
        return rows;
      },
      idOf: (row) => row.organization_id,
    });

    const rows = await allAiRows();
    expect(rows).toHaveLength(2);
    const rowA = rows.find((row) => row.organization_id === orgA);
    const rowB = rows.find((row) => row.organization_id === orgB);
    expect(rowA!.provider).toBe("anthropic");
    expect(rowA!.model).toBe(TEST_MODEL);
    expect(rowB!.provider).toBe("fake");
    expect(http.calls).toHaveLength(1);
  });

  it("3.5.2 A har alt, B har bare ai.enabled: B får disabled, ingen rad i B, intet kall", async () => {
    await anthropicOrganization({ name: "Oppdiktet Takst A" });
    const orgB = await createOrganization("Oppdiktet Takst B");
    await mergeOrganizationSettings(orgB.id, { "ai.enabled": true });
    const assignmentB = await createAssignment(orgB.id);
    const { grant: grantB } = await employeeWithGrant(orgB.id, ["inspector"]);

    expect(await requestSuggestion(grantB, realRequest(assignmentB.id))).toEqual({
      kind: "disabled",
    });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it("3.5.2 speilvendt: B har alt, A har ingenting → A får disabled", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const assignmentA = await createAssignment(orgA.id);
    const { grant: grantA } = await employeeWithGrant(orgA.id, ["inspector"]);
    await anthropicOrganization({ name: "Oppdiktet Takst B" });

    expect(await requestSuggestion(grantA, realRequest(assignmentA.id))).toEqual({
      kind: "disabled",
    });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it("3.5.3 organisasjons-id fra forespørselen brukes aldri: B sin tilkobling brukes", async () => {
    const a = await anthropicOrganization({ name: "Oppdiktet Takst A" });
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    const assignmentB = await createAssignment(orgB.id);
    const { grant: grantB } = await employeeWithGrant(orgB.id, ["inspector"]);

    const request = realRequest(
      assignmentB.id,
      `Gjelder organisasjon ${a.organization.id}. taket er gammelt`,
    );
    const result = await requestSuggestion(grantB, request);
    expect(result.kind).toBe("suggestion");
    const row = await aiRow(request.requestId);
    expect(row!.organization_id).toBe(orgB.id);
    expect(row!.provider).toBe("fake");
    expect(http.calls).toHaveLength(0);

    // Et ekstra felt med organisasjons-id avvises (streng validering), uten kall
    const error = await captureError(() =>
      requestSuggestion(grantB, {
        ...realRequest(assignmentB.id),
        organizationId: a.organization.id,
      }),
    );
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(http.calls).toHaveLength(0);
  });
});

describe("tilgang per rolle mot anthropic (3.6, R7)", () => {
  const VARIANTS: {
    name: string;
    roles: EmployeeVariant[];
    inspectorsEditAll: boolean;
    allowed: boolean;
  }[] = [
    {
      name: "takstmann, innstillingen på",
      roles: ["inspector"],
      inspectorsEditAll: true,
      allowed: true,
    },
    {
      name: "takstmann, innstillingen av",
      roles: ["inspector"],
      inspectorsEditAll: false,
      allowed: false,
    },
    { name: "kontor", roles: ["office"], inspectorsEditAll: true, allowed: false },
    { name: "leder", roles: ["manager"], inspectorsEditAll: true, allowed: true },
    { name: "admin, innstillingen av", roles: ["admin"], inspectorsEditAll: false, allowed: true },
  ];

  it.each(VARIANTS)(
    "3.6.1 $name: be om forslag og avgjøre",
    async ({ roles, inspectorsEditAll, allowed }) => {
      const organization = await createOrganization("Oppdiktet Takst A");
      await enableAnthropic(organization.id);
      if (!inspectorsEditAll) {
        await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
      }
      const assignmentId = await seedKnownValues(organization.id, KNOWN);
      const person = await employeeWithGrant(organization.id, roles, "Test Ansatt");

      if (allowed) {
        const result = await requestSuggestion(person.grant, realRequest(assignmentId));
        expect(result.kind).toBe("suggestion");
        if (result.kind !== "suggestion") return;
        await recordDecision(person.grant, result.usageId, "accepted");
        expect((await aiRow(result.usageId))!.status).toBe("accepted");
        expect(http.calls).toHaveLength(1);
        return;
      }
      const error = await captureError(() =>
        requestSuggestion(person.grant, realRequest(assignmentId)),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await aiRowCount()).toBe(0);
      expect(http.calls).toHaveLength(0);
    },
  );

  it("3.6.2 admin uten andre roller lager anthropic, slår KI av og på og får forslag (regel 11)", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await mergeOrganizationSettings(organization.id, {
      "ai.enabled": true,
      "access.inspectors_edit_all": false,
    });
    const actor = await createUser({ name: "Test Admin Alene" });
    await createEmployee(actor, organization.id, ["admin"]);
    const connection = await createConnection(actor, organization.id, {
      port: "ai",
      provider: "anthropic",
      secretRef: KEY_NAME,
      settings: anthropicSettings(),
    });
    const assignmentId = await seedKnownValues(organization.id, KNOWN);
    const grant: EmployeeGrant = await requireOrganizationAccess(
      actor,
      organization.id,
      "report.edit",
    );

    expect((await requestSuggestion(grant, realRequest(assignmentId))).kind).toBe("suggestion");

    await updateConnection(actor, organization.id, connection.id, { status: "disabled" });
    expect(await requestSuggestion(grant, realRequest(assignmentId))).toEqual({ kind: "disabled" });

    await updateConnection(actor, organization.id, connection.id, { status: "active" });
    expect((await requestSuggestion(grant, realRequest(assignmentId))).kind).toBe("suggestion");
    expect(http.calls).toHaveLength(2);
  });

  it.each(["deleted_at", "deactivated_at"])(
    "3.6.3 fjernet ansatt (%s) får AccessDeniedError før noe fetch-kall",
    async (column) => {
      const { organization, actor, employee, assignmentId } = await anthropicOrganization();
      await db.execute(
        sql`update employees set ${sql.identifier(column)} = now() where id = ${employee.id}`,
      );
      const error = await captureError(async () => {
        const grant = await requireOrganizationAccess(actor, organization.id, "report.edit");
        return requestSuggestion(grant, realRequest(assignmentId));
      });
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await aiRowCount()).toBe(0);
      expect(http.calls).toHaveLength(0);
    },
  );
});
