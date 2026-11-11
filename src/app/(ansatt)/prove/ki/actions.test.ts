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
      expect(result).toEqual({ kind: "failed", message: "Du har ikke tilgang til dette." });
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
      expect(result).toEqual({ kind: "failed", message: "Du har ikke tilgang til dette." });
      expect((await aiRow(rowId))?.status).toBe("suggested");
      expect((await allAuditRows()).length).toBe(before);
    }
  });

  it("uten innlogget ansattrad: ingen tilgang", async () => {
    session.actor = await createUser();
    expect(await requestTrialSuggestion(requestInput())).toEqual({
      kind: "failed",
      message: "Du har ikke tilgang til dette.",
    });
  });
});
