import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import {
  aiRow,
  aiRowCount,
  allAiRows,
  captureError,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  anthropicSettings,
  fakeAiProvider,
  mergeOrganizationSettings,
  recordDecision,
  requestSuggestion,
  validRequest,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  fakeAnthropicFetch,
  hasSecretOrMark,
  PROVIDER_MESSAGE_MARK,
  TEST_ANTHROPIC_KEY,
  TEST_MODEL,
  type FakeAnthropicReply,
} from "../../../tests/fake-anthropic";
import { createAssignment, createOrganization, resetDatabase } from "../../../tests/factories";
import { seedKnownValues } from "../../../tests/known-values";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { preparePrompt } from "./prompt";
import { STANDARD_KNOWN_VALUES } from "./redaction-cases";

/*
 * Den ekte veien gjennom `requestSuggestion` med Anthropic-adapteren og falsk HTTP
 * (docs/funksjoner/fase2a-ki-leverandor-testplan.md avsnitt 3.2–3.6, kortet Omfang 5 og 6,
 * R2–R7). Mot testdatabasen. Ingen nettkall: `fetch` legges inn med `vi.stubGlobal`.
 * Nøkkel, modell, navn og adresser er oppdiktet.
 *
 * Testsøm: `language_polish` har i dag bare målene `answer` og `ai_trial`, og begge er sperret
 * mot en ekte leverandør (A166, A173). For å prøve den vellykkede veien legger testen til ett
 * oppdiktet mål (`TEST_REAL_TARGET`) i funksjonsdefinisjonen. Alt annet er den ekte koden.
 *
 * Støtter hovedmål: KI i bunnen (bare vasket tekst forlater oss, sperrene kommer før vask og
 * kall, og en annen organisasjons tilkobling brukes aldri) og de ansatte (godta, endre og avvis
 * virker som før).
 */

const SECRET_NAME = "ANTHROPIC_API_KEY";
const TEST_REAL_TARGET = "test_real_target";

vi.mock("./features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features")>();
  const polish = actual.AI_FEATURES.language_polish;
  const patched = {
    ...actual.AI_FEATURES,
    language_polish: {
      ...polish,
      allowedTargets: [...polish.allowedTargets, { type: "test_real_target", fieldKey: "text" }],
    },
  };
  return {
    ...actual,
    AI_FEATURES: patched,
    getFeatureDefinition: (code: string) =>
      Object.prototype.hasOwnProperty.call(patched, code)
        ? patched[code as keyof typeof patched]
        : null,
  };
});

// Vasken kan slås av i én test (3.4.2), så lekkasjesjekken må stoppe kallet på egen hånd
const swap = vi.hoisted(() => ({ skipRedaction: false }));
vi.mock("./redact-text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redact-text")>();
  return {
    ...actual,
    redactFieldValues: (fields: Record<string, string>, known: unknown) =>
      swap.skipRedaction
        ? { fields: { ...fields }, count: 0 }
        : actual.redactFieldValues(fields, known as Parameters<typeof actual.redactFieldValues>[1]),
  };
});

// Vasken telles (3.3.3: sperren kommer før vasken)
vi.mock("./prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt")>();
  return { ...actual, preparePrompt: vi.fn(actual.preparePrompt) };
});

let http = fakeAnthropicFetch({ kind: "ok" });

function useHttp(...replies: FakeAnthropicReply[]) {
  http = fakeAnthropicFetch(...replies);
  vi.stubGlobal("fetch", http.fetchFn);
  return http;
}

beforeEach(async () => {
  await resetDatabase();
  swap.skipRedaction = false;
  vi.mocked(preparePrompt).mockClear();
  useHttp({
    kind: "ok",
    text: "Taket er gammelt og har sprekker.",
    usage: { input_tokens: 120, output_tokens: 40 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
}

/** Organisasjon med KI på mot anthropic (nøkkel satt), ett oppdrag og en takstmann. */
async function anthropicOrganization(
  name = "Oppdiktet Takst A",
  settings: Record<string, unknown> = anthropicSettings(),
  roles: EmployeeVariant[] = ["inspector"],
) {
  vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
  const organization = await createOrganization(name);
  await enableAnthropic(organization.id, { settings });
  const assignment = await createAssignment(organization.id);
  const person = await employeeWithGrant(organization.id, roles);
  return { organization, assignment, ...person };
}

function realRequest(assignmentId: string, text = "Taket er gammelt og har noen sprekker") {
  return validRequest({
    assignmentId,
    target: { type: TEST_REAL_TARGET, id: randomUUID(), fieldKey: "text" },
    fields: { text },
  });
}

/** All tekst i tabellene, for søk etter nøkkelen og merket. */
async function tableText(table: "ai_usage_log" | "integration_connections" | "audit_log") {
  const rows = await db.execute(sql.raw(`select * from ${table}`));
  return JSON.stringify(rows);
}

describe("sperren for ekte leverandør (3.2, R2)", () => {
  it.each([
    { name: "ai_trial uten oppdrag", type: "ai_trial", withAssignment: false },
    { name: "answer med oppdrag", type: "answer", withAssignment: true },
    { name: "fritekst uten oppdrag (answer)", type: "answer", withAssignment: false },
    { name: "fritekst uten oppdrag (eget mål)", type: TEST_REAL_TARGET, withAssignment: false },
  ])(
    "$name mot anthropic gir blocked-rad og intet fetch-kall",
    async ({ type, withAssignment }) => {
      const { assignment, grant } = await anthropicOrganization();
      const request = validRequest({
        assignmentId: withAssignment ? assignment.id : null,
        target: { type, id: randomUUID(), fieldKey: "text" },
      });

      const result = await requestSuggestion(grant, request);

      expect(result).toEqual({ kind: "blocked" });
      const row = (await aiRow(request.requestId))!;
      expect(row.outcome).toBe("blocked");
      expect(row.provider).toBe("anthropic");
      expect(http.calls).toHaveLength(0);
      expect(preparePrompt).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "ai_trial uten oppdrag", type: "ai_trial" },
    { name: "answer uten oppdrag", type: "answer" },
  ])("kontroll: $name mot fake gir ikke blocked", async ({ type }) => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const result = await requestSuggestion(
      grant,
      validRequest({ target: { type, id: randomUUID(), fieldKey: "text" } }),
    );
    expect(result.kind).toBe("suggestion");
    expect(http.calls).toHaveLength(0);
  });
});

describe("settings.features (3.3, R3)", () => {
  it.each([
    { name: "tom liste", settings: anthropicSettings({ features: [] }) },
    {
      name: "manglende liste (rå rad)",
      settings: (() => {
        const { features: _f, ...rest } = anthropicSettings();
        void _f;
        return rest;
      })(),
    },
  ])(
    "$name: language_polish gir disabled, ingen rad, ingen vask, intet kall",
    async ({ settings }) => {
      const { assignment, grant } = await anthropicOrganization("Oppdiktet Takst A", settings);

      const result = await requestSuggestion(grant, realRequest(assignment.id));

      expect(result).toEqual({ kind: "disabled" });
      expect(await aiRowCount()).toBe(0);
      expect(http.calls).toHaveLength(0);
      expect(preparePrompt).not.toHaveBeenCalled();
    },
  );

  // Kortet Omfang 6: sperren for features ligger etter tillatt-liste og sperre. Et mål som er
  // sperret mot ekte leverandør (fritekst uten oppdrag), gir derfor blocked, uten kall.
  it("tom liste og sperret mål gir blocked (sperren kommer før features), intet kall", async () => {
    const { grant } = await anthropicOrganization(
      "Oppdiktet Takst A",
      anthropicSettings({ features: [] }),
    );
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("blocked");
    expect(http.calls).toHaveLength(0);
  });

  it("fake har ingen liste og tar language_polish som før", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    const result = await requestSuggestion(grant, validRequest());
    expect(result.kind).toBe("suggestion");
  });
});

describe("hele flyten med falsk HTTP (3.4, R4)", () => {
  const SENSITIVE = ["Åse Testesen", "Testesen", "12345678", "Prøvetunet 7", "gnr 12", "bnr 34"];
  const TEXT =
    "Selger Åse Testesen (tlf 12345678) viste taket i Prøvetunet 7. Eiendommen er gnr 12 bnr 34.";

  it("3.4.1 vellykket kall: bare vasket tekst sendes, raden har anthropic, modell, tokens og kostnad", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, STANDARD_KNOWN_VALUES);
    const request = realRequest(assignmentId, TEXT);

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(http.calls).toHaveLength(1);
    const body = http.calls[0]!.body;
    for (const value of SENSITIVE) expect(body, value).not.toContain(value);
    expect(body).toMatch(/\[[a-zæøå-]+\]/u);
    expect(body).not.toContain(organization.id);
    expect(body).not.toContain(grant.employeeId);
    expect(body).not.toContain(request.requestId);
    expect(body).not.toContain(assignmentId);

    const row = (await aiRow(request.requestId))!;
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe(TEST_MODEL);
    expect(row.outcome).toBe("ok");
    expect(row.tokens_in).toBe(120);
    expect(row.tokens_out).toBe(40);
    expect(Number(row.cost)).toBeCloseTo(0.0096, 6);
    expect(row.currency).toBe("NOK");
    expect(row.redacted_count).toBeGreaterThan(0);
  });

  it.each(["accepted", "edited", "rejected"])(
    "3.4.1 forslaget fra anthropic kan avgjøres som før (%s)",
    async (decision) => {
      const { assignment, grant } = await anthropicOrganization();
      const result = await requestSuggestion(grant, realRequest(assignment.id));
      if (result.kind !== "suggestion") throw new Error(`ventet forslag, fikk ${result.kind}`);
      await recordDecision(grant, result.usageId, decision);
      const row = (await aiRow(result.usageId))!;
      expect(row.status).toBe(decision);
      expect(row.decided_by).toBe(grant.employeeId);
    },
  );

  it("3.4.2 lekkasjesjekken stopper: vasken slår feil, blocked-rad, intet kall", async () => {
    const { organization, grant } = await anthropicOrganization();
    const assignmentId = await seedKnownValues(organization.id, STANDARD_KNOWN_VALUES);
    swap.skipRedaction = true;
    const request = realRequest(assignmentId, "Selger Åse Testesen viste taket.");

    const result = await requestSuggestion(grant, request);

    expect(result).toEqual({ kind: "blocked" });
    expect(http.calls).toHaveLength(0);
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("blocked");
    expect(JSON.stringify(row)).not.toContain("Åse Testesen");
  });

  it("3.4.2 lekkasjesjekken fanger også mønstre (telefon) uten kjente verdier", async () => {
    const { assignment, grant } = await anthropicOrganization();
    swap.skipRedaction = true;
    const request = realRequest(assignment.id, "Ring 98765432 om taket.");
    const result = await requestSuggestion(grant, request);
    expect(result).toEqual({ kind: "blocked" });
    expect(http.calls).toHaveLength(0);
  });

  it("3.4.4 feil fra leverandøren: 401 gir rejected; merket og nøkkelen står ingen steder", async () => {
    const { assignment, grant, organization } = await anthropicOrganization();
    useHttp({ kind: "status", status: 401 });
    const [before] = (await db.execute(
      sql`select last_error from integration_connections where organization_id = ${organization.id}`,
    )) as unknown as { last_error: string | null }[];
    const spies = consoleSpies();
    const request = realRequest(assignment.id);

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("error");
    expect(http.calls).toHaveLength(1);
    const row = (await aiRow(request.requestId))!;
    expect(row.outcome).toBe("error");
    expect(row.error_code).toBe("rejected");
    expect(hasSecretOrMark(JSON.stringify(row))).toBe(false);
    expect(hasSecretOrMark(JSON.stringify(result))).toBe(false);
    expect(hasSecretOrMark(spies.map((s) => inspect(s.mock.calls, { depth: 8 })).join("\n"))).toBe(
      false,
    );
    const [after] = (await db.execute(
      sql`select last_error from integration_connections where organization_id = ${organization.id}`,
    )) as unknown as { last_error: string | null }[];
    expect(after!.last_error).toBe(before!.last_error);
    expect(await tableText("integration_connections")).not.toContain(PROVIDER_MESSAGE_MARK);
  });

  it("3.4.5 nøkkelen står ingen steder i databasen, etter vellykket kall og etter feil", async () => {
    const { assignment, grant } = await anthropicOrganization();
    await requestSuggestion(grant, realRequest(assignment.id));
    useHttp({ kind: "status", status: 500 });
    await requestSuggestion(grant, realRequest(assignment.id));
    useHttp({ kind: "throw", error: new TypeError(`fetch failed ${TEST_ANTHROPIC_KEY}`) });
    await requestSuggestion(grant, realRequest(assignment.id));
    expect((await allAiRows()).length).toBe(3);
    for (const table of ["ai_usage_log", "integration_connections", "audit_log"] as const) {
      const text = await tableText(table);
      expect(text, table).not.toContain(TEST_ANTHROPIC_KEY);
      expect(text, table).not.toContain(PROVIDER_MESSAGE_MARK);
    }
  });
});

describe("tenant-isolasjon for veien med anthropic (3.5, R6)", () => {
  it("3.5.1 expectTenantIsolation: A bruker anthropic, B bruker fake, fetch bare for A", async () => {
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    const assignments = new Map<string, string>();
    let orgA = "";
    let orgB = "";

    await expectTenantIsolation<{ organization_id: string }>({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        await enableAnthropic(orgA);
        await enableAi(orgB);
        assignments.set(orgA, (await createAssignment(orgA)).id);
        assignments.set(orgB, (await createAssignment(orgB)).id);
        return { a: [orgA], b: [orgB] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const assignmentId = assignments.get(organizationId) ?? randomUUID();
        const request = realRequest(assignmentId);
        const result = await requestSuggestion(grant, request);
        if (result.kind !== "suggestion") throw new Error(`ventet forslag, fikk ${result.kind}`);
        const row = await aiRow(request.requestId);
        return row ? [row as unknown as { organization_id: string }] : [];
      },
      idOf: (row) => row.organization_id,
    });

    const rows = await allAiRows();
    const rowsA = rows.filter((row) => row.organization_id === orgA);
    const rowsB = rows.filter((row) => row.organization_id === orgB);
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    for (const row of rowsA) expect(row.provider).toBe("anthropic");
    for (const row of rowsB) expect(row.provider).toBe("fake");
    expect(http.calls).toHaveLength(rowsA.length);
  });

  it("3.5.2 B uten noe får disabled selv om A har alt; og speilvendt", async () => {
    const a = await anthropicOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    await mergeOrganizationSettings(b.id, { "ai.enabled": true });
    const bAssignment = await createAssignment(b.id);
    const bPerson = await employeeWithGrant(b.id, ["inspector"]);

    expect(await requestSuggestion(bPerson.grant, realRequest(bAssignment.id))).toEqual({
      kind: "disabled",
    });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);

    // Speilvendt: B får alt, A mister alt
    await enableAnthropic(b.id);
    await db.execute(
      sql`update integration_connections set deleted_at = now() where organization_id = ${a.organization.id}`,
    );
    expect(await requestSuggestion(a.grant, realRequest(a.assignment.id))).toEqual({
      kind: "disabled",
    });
    expect(await aiRowCount()).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it("3.5.3 organisasjons-id i forespørselen brukes aldri: B sin tilkobling brukes", async () => {
    const a = await anthropicOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    await enableAi(b.id);
    const bAssignment = await createAssignment(b.id);
    const bPerson = await employeeWithGrant(b.id, ["inspector"]);
    const request = validRequest({
      assignmentId: bAssignment.id,
      target: { type: TEST_REAL_TARGET, id: a.organization.id, fieldKey: "text" },
      fields: { text: `Gjelder ${a.organization.id}` },
    });

    const result = await requestSuggestion(bPerson.grant, request);

    expect(result.kind).toBe("suggestion");
    const row = (await aiRow(request.requestId))!;
    expect(row.organization_id).toBe(b.id);
    expect(row.provider).toBe("fake");
    expect(http.calls).toHaveLength(0);
  });
});

describe("tilgang per rolle (3.6, R7)", () => {
  it.each([
    { name: "takstmann", roles: ["inspector"] as EmployeeVariant[], allowed: true },
    { name: "leder", roles: ["manager"] as EmployeeVariant[], allowed: true },
    { name: "admin", roles: ["admin"] as EmployeeVariant[], allowed: true },
    { name: "kontor uten report.edit", roles: ["office"] as EmployeeVariant[], allowed: false },
  ])("$name mot anthropic", async ({ roles, allowed }) => {
    const { assignment, grant } = await anthropicOrganization(
      "Oppdiktet Takst A",
      anthropicSettings(),
      roles,
    );
    if (allowed) {
      const result = await requestSuggestion(grant, realRequest(assignment.id));
      if (result.kind !== "suggestion") throw new Error(`ventet forslag, fikk ${result.kind}`);
      await recordDecision(grant, result.usageId, "accepted");
      expect(http.calls).toHaveLength(1);
    } else {
      const error = await captureError(() => requestSuggestion(grant, realRequest(assignment.id)));
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await aiRowCount()).toBe(0);
      expect(http.calls).toHaveLength(0);
    }
  });

  it("3.6.2 admin stenges aldri ute: lager anthropic-tilkoblingen og ber om forslag (regel 11)", async () => {
    vi.stubEnv(SECRET_NAME, TEST_ANTHROPIC_KEY);
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    expect(admin.grant.roles).toEqual(["admin"]);
    const { createConnection } = await import("@/core/integrations");
    // Det finnes ingen tjeneste for KI av/på ennå; innstillingen settes som i seed
    await mergeOrganizationSettings(organization.id, { "ai.enabled": true });
    await createConnection(admin.actor, organization.id, {
      port: "ai",
      provider: "anthropic",
      secretRef: SECRET_NAME,
      settings: anthropicSettings(),
    });
    const assignment = await createAssignment(organization.id);
    const grant = await requireOrganizationAccess(admin.actor, organization.id);

    const result = await requestSuggestion(grant, realRequest(assignment.id));

    expect(result.kind).toBe("suggestion");
    expect(http.calls).toHaveLength(1);
  });

  it("3.6.3 fjernet ansatt får AccessDeniedError før noe fetch-kall", async () => {
    const { organization, actor, employee } = await anthropicOrganization();
    await db.execute(sql`update employees set deactivated_at = now() where id = ${employee.id}`);
    const error = await captureError(async () => {
      const grant = await requireOrganizationAccess(actor, organization.id, "report.edit");
      return requestSuggestion(grant, realRequest(randomUUID()));
    });
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(http.calls).toHaveLength(0);
    expect(await aiRowCount()).toBe(0);
  });

  it("fake-leverandøren er uendret i denne filen (kontroll av testsømmen)", () => {
    expect(fakeAiProvider.code).toBe("fake");
  });
});
