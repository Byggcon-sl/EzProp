import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { AI_FIELD_MAX_LENGTH } from "@/core/ai";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  aiRow,
  allAiRows,
  allAuditRows,
  enableAi,
  fakeAiProvider,
  fakeErrorInputs,
  fakeNoMatchInput,
  mergeOrganizationSettings,
} from "../../../../../tests/ai";
import {
  createAiUsageLog,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../../../tests/factories";

/*
 * Serverhandlingene for /prove/ki (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 11,
 * tilgangstabellen i avsnitt 6 og 5.4). Mot testdatabasen; bare innloggingen er byttet ut, som i
 * employee-context.test.ts. Teksten er oppdiktet.
 * Støtter hovedmål: KI i bunnen (forslaget vises, takstmannen avgjør, loggen viser det) og
 * reklamasjoner (organisasjonen kommer alltid fra økten, og ingen tekst havner i loggene).
 */

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({
  requireActor: vi.fn(async () => {
    if (!session.actor) throw new Error("ikke innlogget (test)");
    return session.actor;
  }),
  getCurrentActor: vi.fn(async () => session.actor),
  LOGIN_PATH: "/logg-inn",
}));

const { decideTrialSuggestion, readTrialStatus, requestTrialSuggestion } =
  await import("./actions");

const TEXT = "taket er gammelt og har noen sprekker";
const FIXED_MESSAGES = [
  "Du har ikke tilgang til dette.",
  `Skriv en setning på høyst ${AI_FIELD_MAX_LENGTH} tegn.`,
  "Forslaget finnes ikke.",
  "Valget kan ikke gjøres nå. Forslaget er endret.",
  "Noe gikk galt. Teksten din er uendret. Prøv igjen.",
];

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Role = "inspector" | "office" | "manager" | "admin";

/** Organisasjon med KI på (`fake`) og en innlogget ansatt med rollene. */
async function signedIn(roles: Role[] = ["inspector"], name = "Oppdiktet Takst A") {
  const organization = await createOrganization(name);
  await enableAi(organization.id);
  const actor = await createUser({ name: "Oppdiktet takstmann" });
  const employee = await createEmployee(actor, organization.id, roles);
  session.actor = actor;
  return { organization, actor, employee };
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return { requestId: randomUUID(), targetId: randomUUID(), text: TEXT, ...overrides };
}

async function suggestion(input = requestInput()) {
  const result = await requestTrialSuggestion(input);
  if (result.kind !== "suggestion") throw new Error(`ventet forslag, fikk ${result.kind}`);
  return result;
}

function expectFixedMessage(result: { kind: string; message?: string }) {
  expect(result.kind).toBe("failed");
  expect(FIXED_MESSAGES).toContain(result.message);
  const json = JSON.stringify(result);
  expect(json).not.toMatch(/stack|select |insert |update |Error|at \//i);
}

describe("11.1 be om forslag", () => {
  it("gir én rad med målet ai_trial i riktig organisasjon, og svaret har forslaget", async () => {
    const { organization, employee } = await signedIn();
    const input = requestInput();
    const result = await suggestion(input);

    expect(result.text).toBe("Taket er gammelt og har noen sprekker.");
    expect(result.usageId).toBe(input.requestId);
    expect(result.logged).toEqual({ status: "suggested", outcome: "ok" });
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    const row = await aiRow(input.requestId);
    expect(row?.organization_id).toBe(organization.id);
    expect(row?.employee_id).toBe(employee.id);
    expect(row?.target_ref).toEqual({ type: "ai_trial", id: input.targetId, fieldKey: "text" });
  });

  it("KI av i organisasjonen gir «disabled» og ingen rad", async () => {
    const organization = await createOrganization("Oppdiktet uten KI");
    const actor = await createUser();
    await createEmployee(actor, organization.id, ["inspector"]);
    session.actor = actor;
    expect(await requestTrialSuggestion(requestInput())).toEqual({ kind: "disabled" });
    expect(await allAiRows()).toHaveLength(0);
  });

  it("V5.8 blocked fra kjernen gir samme svar som KI av, og ingen ny rad", async () => {
    const { organization, employee } = await signedIn();
    const input = requestInput();
    // Samme requestId som en sperret forespørsel: kjernen svarer `blocked` fra raden
    await createAiUsageLog(organization.id, {
      id: input.requestId,
      employeeId: employee.id,
      targetRef: { type: "ai_trial", id: input.targetId, fieldKey: "text" },
      outcome: "blocked",
      status: null,
      outputText: null,
    });
    expect(await requestTrialSuggestion(input)).toEqual({ kind: "disabled" });
    expect(await allAiRows()).toHaveLength(1);
  });
});

describe("11.2 og 5.4 organisasjon og ansatt kommer bare fra økten", () => {
  it("organisasjons-id fra klienten ignoreres; raden havner i øktens organisasjon", async () => {
    const other = await createOrganization("Oppdiktet Takst A");
    await enableAi(other.id);
    const { organization } = await signedIn(["inspector"], "Oppdiktet Takst B");
    const input = requestInput({
      organizationId: other.id,
      employeeId: randomUUID(),
      decidedBy: randomUUID(),
    });
    await suggestion(input);
    const row = await aiRow(input.requestId);
    expect(row?.organization_id).toBe(organization.id);
    expect((await allAiRows()).filter((r) => r.organization_id === other.id)).toHaveLength(0);
  });

  it("ekstra felt i avgjørelsen ignoreres; decided_by er den innloggede", async () => {
    const { employee } = await signedIn();
    const created = await suggestion();
    const result = await decideTrialSuggestion({
      usageId: created.usageId,
      decision: "accepted",
      decidedBy: randomUUID(),
      organizationId: randomUUID(),
    });
    expect(result).toMatchObject({ kind: "decided", logged: { status: "accepted" } });
    expect((await aiRow(created.usageId))?.decided_by).toBe(employee.id);
  });

  it("en annen organisasjon kan verken avgjøre eller lese status (samme melding som ukjent id)", async () => {
    await signedIn(["admin"], "Oppdiktet Takst A");
    const created = await suggestion();
    await signedIn(["admin"], "Oppdiktet Takst B");

    const foreign = await decideTrialSuggestion({ usageId: created.usageId, decision: "accepted" });
    const unknown = await decideTrialSuggestion({ usageId: randomUUID(), decision: "accepted" });
    expect(foreign).toEqual(unknown);
    expectFixedMessage(foreign);
    expect((await aiRow(created.usageId))?.status).toBe("suggested");

    const status = await readTrialStatus({ usageId: created.usageId });
    expect(status).toEqual(await readTrialStatus({ usageId: randomUUID() }));
  });
});

describe("11.3 Zod: ugyldig inndata gir fast melding, ingen rad og intet kall", () => {
  it.each<[string, Record<string, unknown>]>([
    ["requestId er ikke uuid", { requestId: "abc" }],
    ["requestId er tom", { requestId: "" }],
    ["mål-id er ikke uuid", { targetId: "1; drop table" }],
    ["mål-id mangler", { targetId: undefined }],
    ["tom tekst", { text: "" }],
    ["for lang tekst", { text: "a".repeat(AI_FIELD_MAX_LENGTH + 1) }],
    ["tekst er ikke tekst", { text: 42 }],
  ])("be om forslag: %s", async (_name, patch) => {
    await signedIn();
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const result = await requestTrialSuggestion(requestInput(patch));
    expectFixedMessage(result);
    expect(await allAiRows()).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ["ukjent avgjørelse", { decision: "delete" }],
    ["avgjørelse mangler", { decision: undefined }],
    ["id er ikke uuid", { usageId: "abc" }],
  ])("avgjørelse: %s", async (_name, patch) => {
    await signedIn();
    const created = await suggestion();
    const before = (await allAuditRows()).length;
    const result = await decideTrialSuggestion({
      usageId: created.usageId,
      decision: "accepted",
      ...patch,
    });
    expectFixedMessage(result);
    expect((await aiRow(created.usageId))?.status).toBe("suggested");
    expect((await allAuditRows()).length).toBe(before);
  });

  it("nøyaktig høyeste lengde godtas", async () => {
    await signedIn();
    const result = await requestTrialSuggestion(
      requestInput({ text: "a".repeat(AI_FIELD_MAX_LENGTH) }),
    );
    expect(result.kind).toBe("suggestion");
  });
});

// KI-køen leser bare den faste koden `reason`, aldri meldingen (docs/funksjoner/fase2a-ki-ko.md
// Omfang 2, testplan avsnitt 6).
describe("KI-kø: fast kode reason på feil", () => {
  const NO_ACCESS = "Du har ikke tilgang til dette.";
  const INVALID_TEXT = `Skriv en setning på høyst ${AI_FIELD_MAX_LENGTH} tegn.`;
  const UNKNOWN = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";

  it("uten ansattrad (ingen tilgang fra økten): no_access og ingen rad", async () => {
    session.actor = await createUser();
    expect(await requestTrialSuggestion(requestInput())).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
    expect(await allAiRows()).toHaveLength(0);
  });

  it("uten report.edit (kontor): no_access og ingen rad", async () => {
    await signedIn(["office"]);
    expect(await requestTrialSuggestion(requestInput())).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
    expect(await allAiRows()).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["tom tekst", { text: "" }],
    ["for lang tekst", { text: "a".repeat(AI_FIELD_MAX_LENGTH + 1) }],
    ["ugyldig id", { requestId: "abc" }],
  ])("Zod avviser (%s): invalid", async (_name, patch) => {
    await signedIn();
    expect(await requestTrialSuggestion(requestInput(patch))).toEqual({
      kind: "failed",
      message: INVALID_TEXT,
      reason: "invalid",
    });
    expect(await allAiRows()).toHaveLength(0);
  });

  it("kjernen avviser forespørselen (tom etter vask): invalid med samme melding som før", async () => {
    await signedIn();
    expect(await requestTrialSuggestion(requestInput({ text: "\u0000" }))).toEqual({
      kind: "failed",
      message: UNKNOWN,
      reason: "invalid",
    });
    expect(await allAiRows()).toHaveLength(0);
  });

  it("ukjent feil: unknown", async () => {
    // Ingen aktør: test-økten kaster en vanlig feil, som ikke er omdirigering eller tilgangsfeil.
    vi.spyOn(logger, "error").mockImplementation(() => {});
    session.actor = null;
    expect(await requestTrialSuggestion(requestInput())).toEqual({
      kind: "failed",
      message: UNKNOWN,
      reason: "unknown",
    });
  });

  it("avgjørelse og status: ugyldig id gir invalid", async () => {
    await signedIn();
    expect(await decideTrialSuggestion({ usageId: "abc", decision: "accepted" })).toMatchObject({
      kind: "failed",
      reason: "invalid",
    });
    expect(await readTrialStatus({ usageId: "abc" })).toMatchObject({
      kind: "failed",
      reason: "invalid",
    });
  });

  it("avgjørelse og status uten ansattrad: no_access", async () => {
    session.actor = await createUser();
    const usageId = randomUUID();
    expect(await decideTrialSuggestion({ usageId, decision: "accepted" })).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
    expect(await readTrialStatus({ usageId })).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
  });
});

describe("11.4 og 11.5 dobbelttrykk", () => {
  it("to kall med samme requestId samtidig gir én rad og ingen ekstra linje i audit_log", async () => {
    await signedIn();
    const first = await suggestion(); // et forslag fra før på et annet mål
    const auditBefore = (await allAuditRows()).length;
    const input = requestInput();
    const [a, b] = await Promise.all([
      requestTrialSuggestion(input),
      requestTrialSuggestion(input),
    ]);
    // Kjernen kan gi det andre kallet nøytralt avslag når det første rakk å lagre raden mellom
    // de to oppslagene (meldt til KI-modulen). Det viktige: én rad, og aldri stakk eller to rader.
    const results = [a, b];
    expect(results.some((result) => result.kind === "suggestion")).toBe(true);
    for (const result of results) {
      if (result.kind === "suggestion") expect(result.usageId).toBe(input.requestId);
      else expectFixedMessage(result);
    }
    const rows = await allAiRows();
    expect(rows.map((row) => row.id).sort()).toEqual([first.usageId, input.requestId].sort());
    expect((await allAuditRows()).length).toBe(auditBefore);
  });

  it("«Bruk» to ganger samtidig gir én statusendring og én linje i audit_log", async () => {
    await signedIn();
    const created = await suggestion();
    const before = (await allAuditRows()).length;
    const results = await Promise.all([
      decideTrialSuggestion({ usageId: created.usageId, decision: "accepted" }),
      decideTrialSuggestion({ usageId: created.usageId, decision: "accepted" }),
    ]);
    for (const result of results) {
      expect(["decided", "not_allowed"]).toContain(result.kind);
      expect(JSON.stringify(result)).not.toMatch(/stack/i);
    }
    expect((await aiRow(created.usageId))?.status).toBe("accepted");
    const lines = (await allAuditRows()).slice(before);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.entity_id).toBe(created.usageId);
  });
});

describe("11.6 nytt forslag på samme mål (A164)", () => {
  it("med ok avvises det gamle", async () => {
    await signedIn();
    const targetId = randomUUID();
    const old = await suggestion(requestInput({ targetId }));
    const next = await suggestion(requestInput({ targetId, text: "vinduet er råttent" }));
    expect((await aiRow(old.usageId))?.status).toBe("rejected");
    expect((await aiRow(next.usageId))?.status).toBe("suggested");
  });

  it.each([
    ["no_match", () => fakeNoMatchInput()],
    ["error", () => fakeErrorInputs()[0]!],
  ] as const)("med %s står det gamle som forslag", async (kind, input) => {
    await signedIn();
    const targetId = randomUUID();
    const old = await suggestion(requestInput({ targetId }));
    const result = await requestTrialSuggestion(requestInput({ targetId, text: input() }));
    expect(result.kind).toBe(kind);
    if (result.kind === kind) expect(result.logged).toEqual({ status: null, outcome: kind });
    expect((await aiRow(old.usageId))?.status).toBe("suggested");
  });

  it("angre etter avvisning er ikke lov når et nyere forslag finnes; svaret har status fra loggen", async () => {
    await signedIn();
    const targetId = randomUUID();
    const old = await suggestion(requestInput({ targetId }));
    await suggestion(requestInput({ targetId, text: "vinduet er råttent" }));
    const result = await decideTrialSuggestion({ usageId: old.usageId, decision: "undo" });
    expect(result).toMatchObject({
      kind: "not_allowed",
      message: "Valget kan ikke gjøres nå. Forslaget er endret.",
      logged: { status: "rejected", outcome: "ok" },
    });
  });
});

describe("11.7 hele flyten: status lest fra loggen, audit_log uten tekst", () => {
  it("forslag, bruk, angre, behold, angre og nytt forslag", async () => {
    const { employee } = await signedIn();
    const marker = `markør-${randomUUID()}`;
    const targetId = randomUUID();
    const first = await suggestion(requestInput({ targetId, text: `${TEXT} ${marker}` }));
    expect(first.text).toContain(marker);

    const steps = [
      ["accepted", "accepted"],
      ["undo", "suggested"],
      ["rejected", "rejected"],
      ["undo", "suggested"],
    ] as const;
    for (const [decision, expected] of steps) {
      const result = await decideTrialSuggestion({ usageId: first.usageId, decision });
      expect(result).toEqual({
        kind: "decided",
        usageId: first.usageId,
        logged: { status: expected, outcome: "ok" },
      });
      expect(await readTrialStatus({ usageId: first.usageId })).toEqual({
        kind: "status",
        logged: { status: expected, outcome: "ok" },
      });
    }
    await suggestion(requestInput({ targetId, text: `ny tekst ${marker}` }));

    const audit = await allAuditRows();
    const own = audit.filter((row) => row.entity_id === first.usageId);
    expect(own).toHaveLength(5); // fire valg og avvisningen fra det nye forslaget
    for (const row of own) expect(row.actor_employee_id).toBe(employee.id);
    expect(JSON.stringify(audit)).not.toContain(marker);
    expect(JSON.stringify(audit)).not.toContain("noen sprekker");
  });
});

describe("11.8 og 11.9 logger og meldinger", () => {
  it("feil fra leverandøren: loggeren får bare id og feilkode, aldri teksten", async () => {
    await signedIn();
    const marker = `markør-${randomUUID()}`;
    const calls: unknown[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await requestTrialSuggestion(
      requestInput({ text: `${fakeErrorInputs()[0]} ${marker}` }),
    );
    expect(result.kind).toBe("error");
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain(marker);
    expect(JSON.stringify(console_.mock.calls)).not.toContain(marker);
  });

  it("svaret ved feil har ingen stakk, SQL eller engelsk tekst", async () => {
    await signedIn(["office"]);
    for (const result of [
      await requestTrialSuggestion(requestInput()),
      await requestTrialSuggestion(requestInput({ requestId: "x" })),
      await decideTrialSuggestion({ usageId: randomUUID(), decision: "accepted" }),
      await readTrialStatus({ usageId: "x" }),
    ]) {
      expectFixedMessage(result);
    }
  });
});

// Funn T-0001: tekst med nulltegn (limt inn fra PDF) gir forslag, ikke «Noe gikk galt»
// (docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 2d, test 66–67).
describe("T-0001 tekst med tegn databasen ikke tar", () => {
  const POISON = "taket er\u0000 gammelt og har noen\uD800 sprekker";

  it("handlingen gir forslag for tekst med nulltegn", async () => {
    const { organization } = await signedIn();
    const input = requestInput({ text: POISON });
    const result = await requestTrialSuggestion(input);
    expect(result.kind).toBe("suggestion");
    expect(JSON.stringify(result)).not.toMatch(/\\u0000|\\ud800/i);
    const row = await aiRow(input.requestId);
    expect(row?.organization_id).toBe(organization.id);
    expect(await allAiRows()).toHaveLength(1);
  });

  it("fremmed organisasjon gir nei også med giftig tekst", async () => {
    // Organisasjon A har KI på; den innloggede har ingen ansattrad der
    const own = await signedIn(["inspector"], "Oppdiktet Takst A");
    const outsider = await createUser({ name: "Oppdiktet utenforstående" });
    session.actor = outsider;
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const result = await requestTrialSuggestion(requestInput({ text: POISON }));
    expect(result).toEqual({
      kind: "failed",
      message: "Du har ikke tilgang til dette.",
      reason: "no_access",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await allAiRows()).toHaveLength(0);

    // Ansatt i organisasjon B med innstillingen av: nei, og ingen rad i noen organisasjon
    const other = await createOrganization("Oppdiktet Takst B");
    await enableAi(other.id);
    await mergeOrganizationSettings(other.id, { "access.inspectors_edit_all": false });
    const foreign = await createUser({ name: "Oppdiktet takstmann B" });
    await createEmployee(foreign, other.id, ["inspector"]);
    session.actor = foreign;
    expect(await requestTrialSuggestion(requestInput({ text: POISON }))).toEqual({
      kind: "failed",
      message: "Du har ikke tilgang til dette.",
      reason: "no_access",
    });
    expect(spy).not.toHaveBeenCalled();
    const rows = await allAiRows();
    expect(rows.filter((row) => row.organization_id === own.organization.id)).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});

describe("6 tilgang per rolle (requestTrialSuggestion og decideTrialSuggestion)", () => {
  type Setup = {
    name: string;
    roles: Role[];
    inspectorsEditAll?: boolean;
    grant?: string;
    deactivate?: boolean;
    deleted?: boolean;
    allowed: boolean;
  };

  const table: Setup[] = [
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
    { name: "kontor uten report.edit", roles: ["office"], allowed: false },
    { name: "kontor med report.edit", roles: ["office"], grant: "report.edit", allowed: true },
    { name: "leder", roles: ["manager"], allowed: true },
    { name: "admin med bare rollen admin", roles: ["admin"], allowed: true },
    { name: "admin, innstillingen av", roles: ["admin"], inspectorsEditAll: false, allowed: true },
    { name: "deaktivert ansatt", roles: ["inspector"], deactivate: true, allowed: false },
    { name: "mykt slettet ansatt", roles: ["inspector"], deleted: true, allowed: false },
  ];

  async function setUp(setup: Setup) {
    const { organization, actor, employee } = await signedIn(setup.roles);
    // Et forslag fra en annen takstmann i samme organisasjon (ingen eierskapsfilter, A162)
    const other = await createUser({ name: "Oppdiktet kollega" });
    const otherEmployee = await createEmployee(other, organization.id, ["inspector"]);
    const row = await createAiUsageLog(organization.id, {
      employeeId: otherEmployee.id,
      targetRef: { type: "ai_trial", id: randomUUID(), fieldKey: "text" },
    });
    if (setup.inspectorsEditAll !== undefined) {
      await mergeOrganizationSettings(organization.id, {
        "access.inspectors_edit_all": setup.inspectorsEditAll,
      });
    }
    if (setup.grant) await grantPermission(employee, setup.grant);
    if (setup.deactivate) {
      await db
        .update(employees)
        .set({ deactivatedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }
    if (setup.deleted) {
      await db
        .update(employees)
        .set({ deletedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }
    session.actor = actor;
    return { organization, rowId: row.id };
  }

  it.each(table)("be om forslag: $name", async (setup) => {
    await setUp(setup);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const before = (await allAiRows()).length;
    const result = await requestTrialSuggestion(requestInput());
    if (setup.allowed) {
      expect(result.kind).toBe("suggestion");
      expect((await allAiRows()).length).toBe(before + 1);
    } else {
      expect(result).toEqual({
        kind: "failed",
        message: "Du har ikke tilgang til dette.",
        reason: "no_access",
      });
      expect((await allAiRows()).length).toBe(before);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it.each(table)("avgjøre og angre: $name", async (setup) => {
    const { rowId } = await setUp(setup);
    const before = (await allAuditRows()).length;
    const result = await decideTrialSuggestion({ usageId: rowId, decision: "accepted" });
    if (setup.allowed) {
      expect(result).toMatchObject({ kind: "decided", logged: { status: "accepted" } });
      const undo = await decideTrialSuggestion({ usageId: rowId, decision: "undo" });
      expect(undo).toMatchObject({ kind: "decided", logged: { status: "suggested" } });
      expect((await allAuditRows()).length).toBe(before + 2);
    } else {
      expect(result).toEqual({
        kind: "failed",
        message: "Du har ikke tilgang til dette.",
        reason: "no_access",
      });
      expect((await aiRow(rowId))?.status).toBe("suggested");
      expect((await allAuditRows()).length).toBe(before);
    }
  });

  it("uten innlogget ansattrad: ingen tilgang", async () => {
    session.actor = await createUser();
    expect(await requestTrialSuggestion(requestInput())).toEqual({
      kind: "failed",
      message: "Du har ikke tilgang til dette.",
      reason: "no_access",
    });
  });
});

// Funn T-0001: tekst kopiert fra PDF kan ha nulltegn (docs/agenter/oppgaver/rett-t0001-synkko.md
// Omfang 3, testplan avsnitt 2d, 66–67). Teksten er oppdiktet.
describe("T-0001 tekst med nulltegn på /prove/ki", () => {
  const POISON = "taket\u0000 er gammelt";

  it("handlingen gir forslag for tekst med nulltegn, ikke «Noe gikk galt»", async () => {
    await signedIn();
    const input = requestInput({ text: POISON });

    const result = await requestTrialSuggestion(input);

    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.text).toBe("Taket er gammelt.");
    expect(result.logged).toEqual({ status: "suggested", outcome: "ok" });
    const row = await aiRow(input.requestId);
    expect(row?.output_text).toBe(result.text);
    expect(await allAiRows()).toHaveLength(1);
  });

  it("fremmed organisasjon gir nei også med giftig tekst", async () => {
    const other = await createOrganization("Oppdiktet Takst A");
    await enableAi(other.id);
    // Uten ansattrad: ingen tilgang, ingen rad
    session.actor = await createUser();
    expect(await requestTrialSuggestion(requestInput({ text: POISON }))).toEqual({
      kind: "failed",
      message: "Du har ikke tilgang til dette.",
      reason: "no_access",
    });
    expect(await allAiRows()).toHaveLength(0);

    // Ansatt i B med organisasjons-id fra A i inndata: raden havner i B, aldri i A
    const { organization } = await signedIn(["inspector"], "Oppdiktet Takst B");
    const input = requestInput({ text: POISON, organizationId: other.id });
    await requestTrialSuggestion(input);
    const rows = await allAiRows();
    expect(rows.filter((row) => row.organization_id === other.id)).toHaveLength(0);
    expect(rows.every((row) => row.organization_id === organization.id)).toBe(true);
  });
});

/*
 * KI-køen sender gjennom samme serverhandling (docs/funksjoner/fase2a-ki-ko-testplan.md
 * avsnitt 6, K6.1–K6.6). Serveren er uendret; testene låser svarformen køen leser (`reason`) og
 * at alt kommer fra økten, aldri fra posten. Samme requestId to ganger, KI av og
 * tenant-isolasjonen dekkes av src/core/ai/request-suggestion.test.ts (6.11, 6.12, V5.7 og
 * expectTenantIsolation). Teksten er oppdiktet.
 * Støtter hovedmål: KI i bunnen (køen går uendret gjennom requestSuggestion) og færre
 * reklamasjoner (forslaget føres alltid på den som er logget inn).
 */
describe("KI-køen gjennom serverhandlingen (K6.1–K6.6)", () => {
  const NO_ACCESS = "Du har ikke tilgang til dette.";
  const UNKNOWN = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";
  const QUEUE_TEXT = "Fukt i kjellervegg ved sluk";

  /** Det køen sender: bare requestId (v4, slik køen lager den), targetId og text. */
  function queuedInput(overrides: Record<string, unknown> = {}) {
    return { requestId: randomUUID(), targetId: randomUUID(), text: QUEUE_TEXT, ...overrides };
  }

  it("K6.1 requestId som allerede er brukt av en annen ansatt i samme organisasjon: invalid, fast melding, ingen ny rad", async () => {
    const { organization } = await signedIn(["inspector"]);
    const other = await createUser({ name: "Oppdiktet kollega" });
    const otherEmployee = await createEmployee(other, organization.id, ["inspector"]);
    const input = queuedInput();
    await createAiUsageLog(organization.id, {
      id: input.requestId,
      employeeId: otherEmployee.id,
      targetRef: { type: "ai_trial", id: input.targetId, fieldKey: "text" },
    });
    const before = (await allAiRows()).length;

    const result = await requestTrialSuggestion(input);
    expect(result).toEqual({ kind: "failed", message: UNKNOWN, reason: "invalid" });
    expect((await allAiRows()).length).toBe(before);
  });

  it("K6.1 requestId som allerede er brukt i en annen organisasjon: invalid, ingen rad hos oss", async () => {
    const foreign = await createOrganization("Oppdiktet Takst A");
    await enableAi(foreign.id);
    const foreignUser = await createUser({ name: "Oppdiktet fremmed" });
    const foreignEmployee = await createEmployee(foreignUser, foreign.id, ["inspector"]);
    const input = queuedInput();
    await createAiUsageLog(foreign.id, {
      id: input.requestId,
      employeeId: foreignEmployee.id,
      targetRef: { type: "ai_trial", id: input.targetId, fieldKey: "text" },
    });
    const { organization } = await signedIn(["inspector"], "Oppdiktet Takst B");

    const result = await requestTrialSuggestion(input);
    expect(result).toMatchObject({ kind: "failed", reason: "invalid" });
    expectFixedMessage(result as { kind: string; message?: string });
    expect((await allAiRows()).filter((r) => r.organization_id === organization.id)).toHaveLength(
      0,
    );
  });

  it("K6.1 tekst over høyeste lengde og tom tekst: invalid og ingen rad", async () => {
    await signedIn();
    for (const text of ["", "a".repeat(AI_FIELD_MAX_LENGTH + 1)]) {
      const result = await requestTrialSuggestion(queuedInput({ text }));
      expect(result).toMatchObject({ kind: "failed", reason: "invalid" });
      expectFixedMessage(result as { kind: string; message?: string });
    }
    expect(await allAiRows()).toHaveLength(0);
  });

  it.each<[string, "deactivatedAt" | "deletedAt"]>([
    ["deaktivert mens posten lå i kø", "deactivatedAt"],
    ["mykt slettet mens posten lå i kø", "deletedAt"],
  ])("K6.2 ansatt %s: no_access og ingen rad", async (_name, column) => {
    const { employee } = await signedIn();
    await db
      .update(employees)
      .set({ [column]: new Date() })
      .where(eq(employees.id, employee.id));
    const spy = vi.spyOn(fakeAiProvider, "complete");
    expect(await requestTrialSuggestion(queuedInput())).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await allAiRows()).toHaveLength(0);
  });

  it("K6.2 innlogget uten ansattrad (økten gir ingen tilgang): no_access og ingen rad", async () => {
    session.actor = await createUser();
    expect(await requestTrialSuggestion(queuedInput())).toEqual({
      kind: "failed",
      message: NO_ACCESS,
      reason: "no_access",
    });
    expect(await allAiRows()).toHaveLength(0);
  });

  it("K6.3 organizationId og employeeId fra posten ignoreres: raden har øktens organisasjon og ansatt", async () => {
    const otherOrganization = await createOrganization("Oppdiktet Takst A");
    await enableAi(otherOrganization.id);
    const otherUser = await createUser({ name: "Oppdiktet fremmed" });
    const otherEmployee = await createEmployee(otherUser, otherOrganization.id, ["admin"]);
    const { organization, employee } = await signedIn(["inspector"], "Oppdiktet Takst B");
    const colleague = await createEmployee(
      await createUser({ name: "Oppdiktet kollega" }),
      organization.id,
      ["inspector"],
    );

    for (const foreignEmployeeId of [otherEmployee.id, colleague.id]) {
      const input = queuedInput({
        organizationId: otherOrganization.id,
        employeeId: foreignEmployeeId,
        queuedAt: Date.now(),
        attempts: 2,
      });
      const result = await suggestion(input);
      expect(result.usageId).toBe(input.requestId);
      const row = await aiRow(input.requestId);
      expect(row?.organization_id).toBe(organization.id);
      expect(row?.employee_id).toBe(employee.id);
    }
    const rows = await allAiRows();
    expect(rows.filter((r) => r.organization_id === otherOrganization.id)).toHaveLength(0);
    expect(rows.filter((r) => r.employee_id !== employee.id)).toHaveLength(0);
  });

  it("K6.4 forslag fra køen går i samme forslagsflyt: Bruk, Angre og Behold logges som et vanlig forslag", async () => {
    await signedIn();
    const steps = [
      ["accepted", "accepted"],
      ["undo", "suggested"],
      ["rejected", "rejected"],
      ["undo", "suggested"],
    ] as const;

    async function runFlow(input: { requestId: string; targetId: string; text: string }) {
      const created = await suggestion(input as ReturnType<typeof requestInput>);
      const statuses: string[] = [];
      for (const [decision] of steps) {
        const result = await decideTrialSuggestion({ usageId: created.usageId, decision });
        if (result.kind !== "decided") throw new Error(`ventet decided, fikk ${result.kind}`);
        statuses.push(String(result.logged?.status));
      }
      const audit = (await allAuditRows()).filter((row) => row.entity_id === created.usageId);
      return {
        statuses,
        auditActions: audit.map((row) => row.action),
        row: await aiRow(created.usageId),
      };
    }

    const normal = await runFlow(requestInput());
    // Id-en slik køen lager den (crypto.randomUUID, v4)
    const fromQueue = queuedInput();
    expect(fromQueue.requestId.charAt(14)).toBe("4");
    const queued = await runFlow(fromQueue);

    expect(queued.statuses).toEqual(steps.map(([, expected]) => expected));
    expect(queued.statuses).toEqual(normal.statuses);
    expect(queued.auditActions).toEqual(normal.auditActions);
    expect(queued.auditActions).toHaveLength(4);
    expect(queued.row?.id).toBe(fromQueue.requestId);
    expect(queued.row?.status).toBe(normal.row?.status);
    expect(queued.row?.outcome).toBe(normal.row?.outcome);
  });

  it("K6.5 admin uten andre roller sender en køet forespørsel og får forslag", async () => {
    const { organization, employee } = await signedIn(["admin"]);
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const input = queuedInput();
    const result = await requestTrialSuggestion(input);
    expect(result).toMatchObject({ kind: "suggestion", usageId: input.requestId });
    expect((await aiRow(input.requestId))?.employee_id).toBe(employee.id);
  });

  it.each<[string, Role, boolean]>([
    ["takstmann", "inspector", true],
    ["leder", "manager", true],
    ["admin", "admin", true],
    ["kontor uten report.edit", "office", false],
  ])("K6.6 %s: køet forespørsel gir riktig svar", async (_name, role, allowed) => {
    await signedIn([role]);
    const input = queuedInput();
    const result = await requestTrialSuggestion(input);
    if (allowed) {
      expect(result).toMatchObject({ kind: "suggestion", usageId: input.requestId });
      expect(await aiRow(input.requestId)).toBeDefined();
    } else {
      expect(result).toEqual({ kind: "failed", message: NO_ACCESS, reason: "no_access" });
      expect(await allAiRows()).toHaveLength(0);
    }
  });

  it("K6.6 kontor med report.edit får forslag", async () => {
    const { employee } = await signedIn(["office"]);
    await grantPermission(employee, "report.edit");
    const input = queuedInput();
    expect(await requestTrialSuggestion(input)).toMatchObject({ kind: "suggestion" });
  });
});
