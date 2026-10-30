import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import {
  auditLog,
  employees,
  organizations,
  trialAnswers,
  trialForms,
  trialPhotos,
} from "@/db/schema";
import { parseTrialNumber } from "@/modules/offline-trial/answers";
import { evaluateTrialRules, trialRules } from "@/modules/offline-trial/rules";
import { trialRuleCases } from "@/modules/offline-trial/rules/trial-rule-cases";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  putTrialForm,
  setupOrganization,
} from "../../../../../tests/offline-trial";
import { POST } from "./route";

// Prøve E: serverruten POST /api/prove/regler (docs/funksjoner/fase1-prove-e-regler.md pkt. 4,
// AK 5, 7 og 8). Testplan avsnitt 4.1. Bare innloggingen er mocket; tilgangssjekken i
// src/core/access kjøres ekte mot testdatabasen. Alle data er oppdiktet.

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const URL_PATH = "http://localhost/api/prove/regler";
const NO_STORE = "private, no-store";

type RuleResult = { key: string; state: string; message: string };

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function loggedInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

/** Sender `body` som JSON (eller som rå tekst hvis det er en streng). */
async function post(body: unknown, raw = false): Promise<Response> {
  return POST(
    new Request(URL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

/** Regelsvarene i kroppen: `{ results: [...] }` eller en liste. */
function resultsFrom(body: unknown): RuleResult[] {
  const list = Array.isArray(body) ? body : (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) throw new Error(`Fant ingen regelsvar i ${JSON.stringify(body)}`);
  return list as RuleResult[];
}

function stateFor(results: RuleResult[], key: string) {
  return results.find((entry) => entry.key === key)?.state;
}

async function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe(NO_STORE);
  const body = (await response.json()) as Record<string, unknown>;
  expect(typeof body.feil).toBe("string");
  expect(body).not.toHaveProperty("results");
  expect(Array.isArray(body)).toBe(false);
  return body;
}

async function countRows() {
  const [forms] = await db.select({ n: count() }).from(trialForms);
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  const [audit] = await db.select({ n: count() }).from(auditLog);
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n, audit: audit!.n };
}

describe("POST /api/prove/regler", () => {
  it("uten innlogging gir 401", async () => {
    loggedInAs(null);
    const response = await post({ organizationId: randomUUID(), answers: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
    expect(await response.json()).toEqual({ feil: "Du må logge inn." });
  });

  // Obligatorisk (AK 8, admin stenges aldri ute)
  it.each(ALL_ROLES)("alle fire roller får 200 i egen organisasjon: %s", async (role) => {
    const { actor, organizationId } = await setupOrganization(role);
    loggedInAs(actor);
    const response = await post({
      organizationId,
      answers: { water_heater_age: 7.5, moisture_floor: 41.9 },
    });
    expect(response.status).toBe(200);
    const results = resultsFrom(await response.json());
    expect(results.map((entry) => entry.key)).toEqual(trialRules.map((rule) => rule.key));
    expect(stateFor(results, "trial_water_heater_age")).toBe("triggered");
    expect(stateFor(results, "trial_moisture_floor_limit")).toBe("not_triggered");
  });

  // Obligatorisk (tenant)
  it("annen organisasjon gir 403", async () => {
    const a = await setupOrganization("admin", "Oppdiktet takst A");
    const b = await setupOrganization("admin", "Oppdiktet takst B");
    loggedInAs(a.actor);
    const response = await post({
      organizationId: b.organizationId,
      answers: { water_heater_age: 8, moisture_floor: 50 },
    });
    const body = await expectError(response, 403);
    expect(JSON.stringify(body)).not.toContain("trial_");
    expect(JSON.stringify(body)).not.toContain("Prøveregel");
  });

  it("organisasjon som ikke finnes gir 403", async () => {
    const { actor } = await setupOrganization("admin");
    loggedInAs(actor);
    await expectError(await post({ organizationId: randomUUID(), answers: {} }), 403);
  });

  it("mykt slettet organisasjon gir 403", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    loggedInAs(actor);
    await expectError(await post({ organizationId, answers: {} }), 403);
  });

  // Obligatorisk
  it("mykt slettet ansatt gir 403", async () => {
    const { organizationId } = await setupOrganization("admin");
    // Ansatt som har sluttet (deaktivert)
    const gone = await createDeactivatedEmployee(organizationId);
    loggedInAs(gone);
    await expectError(await post({ organizationId, answers: { water_heater_age: 8 } }), 403);

    // Ansatt som er mykt slettet (deleted_at)
    const deleted = await setupOrganization("admin", "Oppdiktet takst C");
    await db
      .update(employees)
      .set({ deletedAt: new Date() })
      .where(eq(employees.id, deleted.employee.id));
    loggedInAs(deleted.actor);
    await expectError(
      await post({ organizationId: deleted.organizationId, answers: { water_heater_age: 8 } }),
      403,
    );
  });

  it("ugyldig innhold gir 400", async () => {
    // Én sak per type feil; rene varianter av samme type er slått sammen
    const cases: [string, (organizationId: string) => unknown, boolean?][] = [
      [
        "tekst i stedet for tall",
        (id) => ({ organizationId: id, answers: { water_heater_age: "7" } }),
      ],
      [
        "ekstra felt i answers",
        (id) => ({ organizationId: id, answers: { water_heater_age: 1, roof_tg: "TG2" } }),
      ],
      ["ekstra felt i kroppen", (id) => ({ organizationId: id, answers: {}, ekstra: 1 })],
      ["manglende organizationId", () => ({ answers: { water_heater_age: 1 } })],
      ["organizationId som ikke er uuid", () => ({ organizationId: "ikke-en-uuid", answers: {} })],
      ["answers mangler", (id) => ({ organizationId: id })],
      ["answers er feil type", (id) => ({ organizationId: id, answers: "7" })],
      ["kroppen er ikke JSON", () => "{ikke json", true],
      ["kroppen er ikke et objekt", (id) => [{ organizationId: id, answers: {} }]],
    ];
    const { actor, organizationId } = await setupOrganization("admin");
    loggedInAs(actor);
    for (const [name, build, raw] of cases) {
      const response = await post(build(organizationId), raw ?? false);
      expect(response.status, name).toBe(400);
      await expectError(response, 400);
    }
  });

  it("tilgang sjekkes før svar gis", async () => {
    const a = await setupOrganization("admin", "Oppdiktet takst A");
    const b = await setupOrganization("admin", "Oppdiktet takst B");
    loggedInAs(a.actor);
    // Gyldig kropp for annen organisasjon
    for (const answers of [
      {},
      { water_heater_age: 8, moisture_floor: 50 },
      { moisture_floor: 0 },
    ]) {
      const response = await post({ organizationId: b.organizationId, answers });
      await expectError(response, 403);
    }
    // Ugyldig kropp for annen organisasjon: 400 eller 403, aldri 200
    for (const body of [
      { organizationId: b.organizationId, answers: { water_heater_age: "8" } },
      { organizationId: b.organizationId, answers: { roof_tg: "TG3" } },
      { organizationId: b.organizationId, answers: {}, ekstra: true },
    ]) {
      const response = await post(body);
      expect([400, 403], JSON.stringify(body)).toContain(response.status);
      await expectError(response, response.status);
    }
  });

  it("null og manglende felt gir ikke vurdert", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    for (const answers of [
      {},
      { water_heater_age: null, moisture_floor: null },
      { water_heater_age: null },
      { moisture_floor: null },
    ]) {
      const response = await post({ organizationId, answers });
      expect(response.status, JSON.stringify(answers)).toBe(200);
      const results = resultsFrom(await response.json());
      for (const rule of trialRules) {
        expect(stateFor(results, rule.key), `${rule.key} ${JSON.stringify(answers)}`).toBe(
          "not_evaluated",
        );
      }
    }
  });

  it("negativt tall gir ikke vurdert, ikke 400", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    for (const value of [-1, -0.01]) {
      const response = await post({
        organizationId,
        answers: { water_heater_age: value, moisture_floor: value },
      });
      expect(response.status, String(value)).toBe(200);
      const results = resultsFrom(await response.json());
      for (const rule of trialRules) {
        expect(stateFor(results, rule.key), `${rule.key} ${value}`).toBe("not_evaluated");
      }
    }
  });

  it("tall for stort for JSON slår aldri til", async () => {
    // 1e400 blir Infinity i JSON.parse. Det er ingen gyldig måling: 400 eller ikke vurdert.
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const response = await post(
      `{"organizationId":"${organizationId}","answers":{"water_heater_age":1e400,"moisture_floor":1e400}}`,
      true,
    );
    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      const results = resultsFrom(await response.json());
      for (const rule of trialRules) {
        expect(stateFor(results, rule.key), rule.key).toBe("not_evaluated");
      }
    }
  });

  // Obligatorisk (AK 5)
  it("ruten svarer likt motoren for alle testsakene", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    for (const entry of trialRuleCases) {
      const label = `${entry.rule_key} / ${entry.name} («${entry.input}»)`;
      const rule = trialRules.find((candidate) => candidate.key === entry.rule_key);
      expect(rule, label).toBeDefined();
      const answers = { [rule!.field]: parseTrialNumber(entry.input) };
      const response = await post({ organizationId, answers });
      expect(response.status, label).toBe(200);
      const fromServer = resultsFrom(await response.json());
      const fromEngine = evaluateTrialRules(trialRules, answers);
      expect(fromServer, label).toEqual(fromEngine);
      expect(stateFor(fromServer, entry.rule_key), label).toBe(entry.expect_state);
    }
  });

  it("svaret mellomlagres ikke", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    loggedInAs(actor);
    const ok = await post({ organizationId, answers: { water_heater_age: 3 } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe(NO_STORE);

    const bad = await post({ organizationId, answers: { water_heater_age: "3" } });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe(NO_STORE);

    const foreign = await post({ organizationId: randomUUID(), answers: {} });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("cache-control")).toBe(NO_STORE);

    loggedInAs(null);
    const anonymous = await post({ organizationId, answers: {} });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe(NO_STORE);
  });

  // Obligatorisk (AK 7)
  it("kroppen logges aldri, heller ikke ved 400", async () => {
    const MARKER = "markor-7f3a";
    const AGE = 7.3141;
    const MOISTURE = 41.2718;
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg) ?? String(arg);
            } catch {
              return String(arg);
            }
          })
          .join(" "),
      );
    };
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(capture);
    }
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const statuses: number[] = [];
    try {
      const { actor, organizationId } = await setupOrganization("admin");
      const other = await setupOrganization("admin", "Oppdiktet takst B");
      loggedInAs(actor);
      const answers = { water_heater_age: AGE, moisture_floor: MOISTURE };
      // Gyldig
      statuses.push((await post({ organizationId, answers })).status);
      // Ugyldig: ekstra felt med markør, i answers og i kroppen
      statuses.push(
        (await post({ organizationId, answers: { ...answers, notat: MARKER } })).status,
      );
      statuses.push((await post({ organizationId, answers, ekstra: MARKER })).status);
      // Ugyldig: markør der tallet skal stå
      statuses.push((await post({ organizationId, answers: { water_heater_age: MARKER } })).status);
      // Ikke JSON
      statuses.push((await post(`{"${MARKER}": ${AGE}`, true)).status);
      // Annen organisasjon
      statuses.push((await post({ organizationId: other.organizationId, answers })).status);
      // Organisasjonsfeltet med markør
      statuses.push((await post({ organizationId: MARKER, answers })).status);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(statuses).toEqual([200, 400, 400, 400, 400, 403, 400]);
    for (const line of lines) {
      expect(line).not.toContain(MARKER);
      expect(line).not.toContain(String(AGE));
      expect(line).not.toContain(String(MOISTURE));
    }
  });

  it("ruten skriver ingenting til databasen", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    // Et skjema med data fra før, så tellingen ikke bare er 0 = 0
    await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    const before = await countRows();
    expect(before.forms).toBeGreaterThan(0);

    const ok = await post({ organizationId, answers: { water_heater_age: 9, moisture_floor: 43 } });
    expect(ok.status).toBe(200);
    await post({ organizationId, answers: { water_heater_age: "9" } });
    await post({ organizationId: randomUUID(), answers: {} });

    expect(await countRows()).toEqual(before);
  });
});
