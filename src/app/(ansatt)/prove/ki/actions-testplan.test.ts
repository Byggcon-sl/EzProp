import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { AI_FIELD_MAX_LENGTH, FAKE_ERROR_INPUT, FAKE_NO_MATCH_INPUT } from "@/core/ai";
import { db } from "@/db/client";
import {
  aiRow,
  allAiRows,
  allAuditRows,
  auditCount,
  enableAi,
  fakeAiProvider,
  mergeOrganizationSettings,
  snapshot,
  type EmployeeVariant,
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
 * Serverhandlingene for prøvesiden /prove/ki (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 11, 5.4 og 6). Bare innloggingen er byttet ut (samme mønster som
 * employee-context.test.ts). Mot testdatabasen. All tekst er oppdiktet.
 *
 * Handlingene: `requestTrialSuggestion({ requestId, targetId, text })` og
 * `decideTrialSuggestion({ usageId, decision })`. Et svar med `kind: "failed"` har en fast norsk
 * melding.
 *
 * Støtter hovedmål: KI i bunnen («Ferdig når» for 2a-1: forslaget vises, takstmannen godtar
 * eller avviser, og loggen viser det) og færre reklamasjoner (organisasjonen kommer alltid fra
 * økten, og teksten havner aldri i revisjonsloggen eller den tekniske loggen).
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

const actions = (await import("./actions")) as unknown as {
  requestTrialSuggestion(input: unknown): Promise<Record<string, unknown>>;
  decideTrialSuggestion(input: unknown): Promise<Record<string, unknown>>;
};
const { logger } = await import("@/shared/lib/logger");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});
afterEach(() => vi.restoreAllMocks());

/** Organisasjon med KI på (`fake`) og en innlogget ansatt med rollene. */
async function signedIn(roles: EmployeeVariant[] = ["inspector"], name = "Oppdiktet Takst A") {
  const organization = await createOrganization(name);
  await enableAi(organization.id);
  const actor = await createUser({ name: "Test Ansatt Prøve" });
  const employee = await createEmployee(actor, organization.id, roles);
  session.actor = actor;
  return { organization, actor, employee };
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    targetId: randomUUID(),
    text: "taket er gammelt og har noen sprekker",
    ...overrides,
  };
}

async function suggest(input: Record<string, unknown> = {}) {
  const full = requestInput(input);
  const response = await actions.requestTrialSuggestion(full);
  return { input: full, response };
}

/** Svaret er en fast norsk feilmelding uten tekniske detaljer. */
function expectFixedFailure(response: Record<string, unknown>) {
  expect(response.kind).toBe("failed");
  const message = response.message;
  expect(typeof message).toBe("string");
  expect((message as string).length).toBeGreaterThan(0);
  // `reason` er en fast kode (K6.1) og kan selv hete «invalid»; resten sjekkes for tekniske detaljer.
  expect(["invalid", "no_access", "unknown"]).toContain(response.reason);
  const { reason: _reason, ...rest } = response;
  const all = JSON.stringify(rest);
  expect(all).not.toMatch(
    /stack|\n\s+at |Error\b|select |insert |update |postgres|zod|invalid|required/i,
  );
  expect(Object.keys(response).sort()).toEqual(["kind", "message", "reason"]);
}

describe("serverhandlingene: be om forslag (11.1, 11.2, 5.4)", () => {
  it("11.1 takstmann gir én rad med målet ai_trial i egen organisasjon, og svaret har forslaget", async () => {
    const { organization, employee } = await signedIn();
    const { input, response } = await suggest();

    expect(response.kind).toBe("suggestion");
    expect(response.text).toBe("Taket er gammelt og har noen sprekker.");
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(organization.id);
    expect(rows[0]!.employee_id).toBe(employee.id);
    expect(rows[0]!.target_ref).toEqual({ type: "ai_trial", id: input.targetId, fieldKey: "text" });
    expect(rows[0]!.status).toBe("suggested");
  });

  it("11.2 og 5.4 organisasjons-id, employeeId og decidedBy fra klienten ignoreres", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    await enableAi(orgA.id);
    const strangerA = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const { organization: orgB, employee } = await signedIn(["inspector"], "Oppdiktet Takst B");

    const { response } = await suggest({
      organizationId: orgA.id,
      employeeId: strangerA.id,
      decidedBy: strangerA.id,
    });

    expect(response.kind).toBe("suggestion");
    const rows = await allAiRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(orgB.id);
    expect(rows[0]!.employee_id).toBe(employee.id);

    const decided = await actions.decideTrialSuggestion({
      usageId: response.usageId,
      decision: "accepted",
      organizationId: orgA.id,
      decidedBy: strangerA.id,
    });
    expect(decided.kind).toBe("decided");
    const row = (await aiRow(String(response.usageId)))!;
    expect(row.decided_by).toBe(employee.id);
    expect(row.organization_id).toBe(orgB.id);
  });
});

describe("serverhandlingene: Zod (11.3)", () => {
  it.each([
    { name: "requestId er ikke uuid", input: () => requestInput({ requestId: "abc" }) },
    { name: "mål-id er ikke uuid", input: () => requestInput({ targetId: "abc" }) },
    { name: "mål-id mangler", input: () => ({ requestId: randomUUID(), text: "en setning" }) },
    { name: "tom tekst", input: () => requestInput({ text: "" }) },
    {
      name: "for lang tekst",
      input: () => requestInput({ text: "a".repeat(AI_FIELD_MAX_LENGTH + 1) }),
    },
    { name: "tekst er ikke tekst", input: () => requestInput({ text: 42 }) },
    { name: "ikke et objekt", input: () => "requestId=abc" },
  ])("be om forslag, $name → fast melding, ingen rad og intet kall", async ({ input }) => {
    await signedIn();
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const response = await actions.requestTrialSuggestion(input());

    expectFixedFailure(response);
    expect(spy).not.toHaveBeenCalled();
    expect(await allAiRows()).toHaveLength(0);
  });

  it.each([
    { name: "ukjent avgjørelse", input: (id: string) => ({ usageId: id, decision: "approve" }) },
    { name: "usageId er ikke uuid", input: () => ({ usageId: "abc", decision: "accepted" }) },
    { name: "avgjørelse mangler", input: (id: string) => ({ usageId: id }) },
  ])("avgjøre, $name → fast melding, raden og audit_log uendret", async ({ input }) => {
    const { organization, employee } = await signedIn();
    const row = await createAiUsageLog(organization.id, { employeeId: employee.id });
    const before = snapshot(await aiRow(row.id));
    const auditBefore = await auditCount();

    const response = await actions.decideTrialSuggestion(input(row.id));

    expectFixedFailure(response);
    expect(snapshot(await aiRow(row.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("teksten på nøyaktig AI_FIELD_MAX_LENGTH tegn godtas", async () => {
    await signedIn();
    const { response } = await suggest({ text: "a".repeat(AI_FIELD_MAX_LENGTH) });
    expect(response.kind).toBe("suggestion");
  });
});

describe("serverhandlingene: to raske trykk (11.4, 11.5)", () => {
  it("11.4 to raske kall med samme requestId gir én rad, og forrige forslag avvises bare én gang (én linje i audit_log)", async () => {
    await signedIn();
    const targetId = randomUUID();
    const first = await suggest({ targetId });
    expect(first.response.kind).toBe("suggestion");
    const auditBefore = await auditCount();
    const requestId = randomUUID();
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const [a, b] = await Promise.all([
      actions.requestTrialSuggestion(requestInput({ requestId, targetId })),
      actions.requestTrialSuggestion(requestInput({ requestId, targetId })),
    ]);

    expect(a.kind).toBe("suggestion");
    expect(b.kind).toBe("suggestion");
    expect(a.usageId).toBe(requestId);
    expect(b.usageId).toBe(requestId);
    expect(await allAiRows()).toHaveLength(2);
    expect(await auditCount()).toBe(auditBefore + 1);
    expect((await aiRow(String(first.response.usageId)))!.status).toBe("rejected");
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("11.5 to like avgjørelser («Bruk» to ganger) gir én statusendring og én linje i audit_log, uten unntak", async () => {
    await signedIn();
    const { response } = await suggest();
    const auditBefore = await auditCount();

    const results = await Promise.allSettled([
      actions.decideTrialSuggestion({ usageId: response.usageId, decision: "accepted" }),
      actions.decideTrialSuggestion({ usageId: response.usageId, decision: "accepted" }),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(["decided", "not_allowed", "failed"]).toContain(result.value.kind);
        if (result.value.kind === "failed") expectFixedFailure(result.value);
      }
    }
    expect((await aiRow(String(response.usageId)))!.status).toBe("accepted");
    expect(await auditCount()).toBe(auditBefore + 1);
  });
});

describe("serverhandlingene: «Nytt forslag» (11.6, A164)", () => {
  it("nytt forslag med ok setter det gamle til rejected", async () => {
    await signedIn();
    const targetId = randomUUID();
    const old = await suggest({ targetId });
    const fresh = await suggest({ targetId, text: "taket har sprekker og er gammelt" });

    expect(fresh.response.kind).toBe("suggestion");
    expect((await aiRow(String(old.response.usageId)))!.status).toBe("rejected");
    expect((await aiRow(String(fresh.response.usageId)))!.status).toBe("suggested");
  });

  it.each([
    { name: "FAKE_NO_MATCH_INPUT", text: `taket ${FAKE_NO_MATCH_INPUT}`, kind: "no_match" },
    { name: "FAKE_ERROR_INPUT", text: `taket ${FAKE_ERROR_INPUT}`, kind: "error" },
  ])("nytt forslag med $name: det gamle står som suggested", async ({ text, kind }) => {
    await signedIn();
    const targetId = randomUUID();
    const old = await suggest({ targetId });
    const fresh = await suggest({ targetId, text });

    expect(fresh.response.kind).toBe(kind);
    expect((await aiRow(String(old.response.usageId)))!.status).toBe("suggested");
    expect(await allAiRows()).toHaveLength(2);
  });
});

describe("serverhandlingene: revisjonslogg og teknisk logg (11.7–11.9)", () => {
  const MARKER = "testmerke9q4z";

  it("11.7 hele flyten: audit_log har bare id og status, aldri teksten", async () => {
    await signedIn();
    const targetId = randomUUID();
    const first = await suggest({ targetId, text: `taket ${MARKER} har sprekker` });
    const firstId = String(first.response.usageId);
    expect(first.response.kind).toBe("suggestion");

    // Bruk, angre, behold, angre, nytt forslag
    for (const decision of ["accepted", "undo", "rejected", "undo"]) {
      const result = await actions.decideTrialSuggestion({ usageId: firstId, decision });
      expect(result.kind, decision).toBe("decided");
    }
    const second = await suggest({ targetId, text: `veggen ${MARKER} er fuktig` });
    expect(second.response.kind).toBe("suggestion");
    expect((await aiRow(firstId))!.status).toBe("rejected");

    const audit = (await allAuditRows()).filter((line) => line.entity_type === "ai_usage_log");
    expect(audit.length).toBeGreaterThanOrEqual(5);
    const everything = JSON.stringify(await allAuditRows());
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain("sprekker");
    for (const line of audit) {
      expect(Object.keys(line.changes as Record<string, unknown>)).toEqual(["status"]);
    }
  });

  it("11.8 feil fra leverandøren: loggen får bare id og feilkode, aldri teksten", async () => {
    await signedIn();
    const loggerCalls: unknown[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        loggerCalls.push(args);
      });
    }
    const consoleCalls: unknown[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args);
      });
    }

    const { input, response } = await suggest({ text: `taket ${MARKER} ${FAKE_ERROR_INPUT}` });

    expect(response.kind).toBe("error");
    const logged = JSON.stringify([loggerCalls, consoleCalls]);
    expect(logged).not.toContain(MARKER);
    expect(logged).not.toContain("taket");
    expect(loggerCalls.length + consoleCalls.length).toBeGreaterThan(0);
    expect(logged).toContain(input.requestId);
  });

  it("11.8 leverandøren kaster: loggen får ikke teksten, og svaret er error eller fast melding", async () => {
    await signedIn();
    vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(
      new Error(`leverandørfeil med ${MARKER}`),
    );
    const calls: unknown[] = [];
    for (const level of ["warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }

    const { response } = await suggest({ text: `taket ${MARKER}` });

    expect(["error", "failed"]).toContain(response.kind);
    if (response.kind === "failed") expectFixedFailure(response);
    expect(JSON.stringify(calls)).not.toContain(MARKER);
    expect(JSON.stringify(response)).not.toContain(MARKER);
  });

  it("11.9 feil til klienten er faste meldinger uten stakk, SQL eller engelsk tekst", async () => {
    const { organization } = await signedIn();
    const other = await createOrganization("Oppdiktet Takst B");
    const foreign = await createAiUsageLog(other.id);
    const responses = [
      await actions.decideTrialSuggestion({ usageId: randomUUID(), decision: "accepted" }),
      await actions.decideTrialSuggestion({ usageId: foreign.id, decision: "accepted" }),
      await actions.requestTrialSuggestion(requestInput({ requestId: "abc" })),
    ];
    for (const response of responses) expectFixedFailure(response);
    // Ukjent id og id i annen organisasjon gir samme melding
    expect(responses[0]!.message).toBe(responses[1]!.message);
    expect(organization.id).not.toBe(other.id);
  });
});

describe("serverhandlingene: tilgang per rolle (11.10, 6)", () => {
  type Variant = {
    name: string;
    roles: EmployeeVariant[];
    inspectorsEditAll: boolean;
    grantReportEdit?: boolean;
    allowed: boolean;
  };
  const VARIANTS: Variant[] = [
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
    { name: "kontor uten report.edit", roles: ["office"], inspectorsEditAll: true, allowed: false },
    {
      name: "kontor med report.edit gitt",
      roles: ["office"],
      inspectorsEditAll: true,
      grantReportEdit: true,
      allowed: true,
    },
    { name: "leder", roles: ["manager"], inspectorsEditAll: true, allowed: true },
    {
      name: "admin med bare rollen admin",
      roles: ["admin"],
      inspectorsEditAll: true,
      allowed: true,
    },
    { name: "admin, innstillingen av", roles: ["admin"], inspectorsEditAll: false, allowed: true },
  ];

  it.each(VARIANTS)("$name: be om og avgjøre = $allowed", async (variant) => {
    const { organization, employee } = await signedIn(variant.roles);
    if (!variant.inspectorsEditAll) {
      await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    }
    if (variant.grantReportEdit) await grantPermission(employee, "report.edit");
    const existing = await createAiUsageLog(organization.id);
    const before = snapshot(await aiRow(existing.id));
    const auditBefore = await auditCount();
    const spy = vi.spyOn(fakeAiProvider, "complete");

    const requested = await actions.requestTrialSuggestion(requestInput());
    const decided = await actions.decideTrialSuggestion({
      usageId: existing.id,
      decision: "accepted",
    });

    if (variant.allowed) {
      expect(requested.kind).toBe("suggestion");
      expect(decided.kind).toBe("decided");
      expect((await aiRow(existing.id))!.status).toBe("accepted");
      return;
    }
    expectFixedFailure(requested);
    expectFixedFailure(decided);
    expect(requested.message).toBe(decided.message);
    expect(spy).not.toHaveBeenCalled();
    expect(await allAiRows()).toHaveLength(1);
    expect(snapshot(await aiRow(existing.id))).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
  });

  it.each([
    { name: "mykt slettet", column: "deleted_at" },
    { name: "deaktivert", column: "deactivated_at" },
  ])("$name ansatt: avslag med fast melding, ingen rad og ingen endring", async ({ column }) => {
    const { organization, employee } = await signedIn(["admin"]);
    const existing = await createAiUsageLog(organization.id);
    const before = snapshot(await aiRow(existing.id));
    await db.execute(
      sql`update employees set ${sql.identifier(column)} = now() where id = ${employee.id}`,
    );

    const requested = await actions.requestTrialSuggestion(requestInput());
    const decided = await actions.decideTrialSuggestion({
      usageId: existing.id,
      decision: "accepted",
    });

    expectFixedFailure(requested);
    expectFixedFailure(decided);
    expect(await allAiRows()).toHaveLength(1);
    expect(snapshot(await aiRow(existing.id))).toBe(before);
  });

  it("ansatt i annen organisasjon: avgjørelse på A sin rad gir nøytralt avslag, raden uendret", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const rowA = await createAiUsageLog(orgA.id);
    const before = snapshot(await aiRow(rowA.id));
    await signedIn(["admin"], "Oppdiktet Takst B");

    const foreign = await actions.decideTrialSuggestion({ usageId: rowA.id, decision: "accepted" });
    const unknown = await actions.decideTrialSuggestion({
      usageId: randomUUID(),
      decision: "accepted",
    });

    expectFixedFailure(foreign);
    expect(foreign).toEqual({ ...unknown });
    expect(snapshot(await aiRow(rowA.id))).toBe(before);
  });
});
