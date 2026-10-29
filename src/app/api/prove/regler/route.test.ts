import { count } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { auditLog, trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { parseTrialNumber } from "@/modules/offline-trial/answers";
import { evaluateTrialRules, trialRuleCases, trialRules } from "@/modules/offline-trial/rules";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  setupOrganization,
} from "../../../../../tests/offline-trial";
import { POST } from "./route";

// Prøve E: serverruten for regelsvaret (docs/funksjoner/fase1-prove-e-regler.md pkt. 4, AK 5, 7, 8).
// Testplan avsnitt 4.1. Bare innloggingen mockes; tilgangssjekken i src/core/access kjøres ekte
// mot testdatabasen. Ruten leser ingen data, så tenant-isolasjon vises med 403 for annen organisasjon.

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const RULE_KEYS = trialRules.map((rule) => rule.key);

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getCurrentActor).mockReset();
});

function logInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function post(body: unknown, raw = false): Promise<Response> {
  return POST(
    new Request("http://localhost/api/prove/regler", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

type RuleResponse = { results?: { key: string; state: string; message: string }[]; feil?: string };

async function json(response: Response): Promise<RuleResponse> {
  return (await response.json()) as RuleResponse;
}

async function countRows() {
  const [forms] = await db.select({ n: count() }).from(trialForms);
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  const [audit] = await db.select({ n: count() }).from(auditLog);
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n, audit: audit!.n };
}

/** Ugyldige kropper (pkt. 4). `organizationId` settes inn der den trengs. */
function invalidBodies(organizationId: string): [string, unknown, boolean][] {
  return [
    ["tekst i stedet for tall", { organizationId, answers: { water_heater_age: "7" } }, false],
    ["ekstra felt i answers", { organizationId, answers: { roof_tg: "TG2" } }, false],
    ["ekstra felt i kroppen", { organizationId, answers: {}, extra: 1 }, false],
    ["manglende organizationId", { answers: {} }, false],
    ["organizationId som ikke er uuid", { organizationId: "ikke-en-uuid", answers: {} }, false],
    ["answers mangler", { organizationId }, false],
    ["answers er tekst", { organizationId, answers: "7" }, false],
    ["answers er en liste", { organizationId, answers: [] }, false],
    ["answers er null", { organizationId, answers: null }, false],
    ["kroppen er ikke JSON", "{ikke json", true],
    ["kroppen er en liste", [{ organizationId, answers: {} }], false],
  ];
}

describe("POST /api/prove/regler", () => {
  it("uten innlogging gir 401", async () => {
    logInAs(null);
    const response = await post({ organizationId: uuidv7(), answers: {} });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ feil: "Du må logge inn." });
  });

  // Obligatorisk (AK 8, admin stenges aldri ute)
  it.each(ALL_ROLES)("alle fire roller får 200 i egen organisasjon (%s)", async (role) => {
    const { actor, organizationId } = await setupOrganization(role);
    logInAs(actor);
    const response = await post({
      organizationId,
      answers: { water_heater_age: 8, moisture_floor: 1 },
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.results?.map((entry) => entry.key)).toEqual(RULE_KEYS);
    expect(body.results?.map((entry) => entry.state)).toEqual(["triggered", "not_triggered"]);
  });

  // Obligatorisk (tenant)
  it("annen organisasjon gir 403", async () => {
    const a = await setupOrganization("admin", "Oppdiktet A AS");
    const b = await setupOrganization("admin", "Oppdiktet B AS");
    logInAs(a.actor);
    const response = await post({
      organizationId: b.organizationId,
      answers: { water_heater_age: 8, moisture_floor: 43 },
    });
    expect(response.status).toBe(403);
    const body = await json(response);
    expect(body.results).toBeUndefined();
    expect(body.feil).toEqual(expect.any(String));
  });

  it("organisasjon som ikke finnes gir 403", async () => {
    const { actor } = await setupOrganization("admin");
    logInAs(actor);
    const response = await post({ organizationId: crypto.randomUUID(), answers: {} });
    expect(response.status).toBe(403);
    expect((await json(response)).results).toBeUndefined();
  });

  // Obligatorisk
  it("mykt slettet ansatt gir 403", async () => {
    const { organizationId } = await setupOrganization("admin");
    const gone = await createDeactivatedEmployee(organizationId);
    logInAs(gone);
    const response = await post({ organizationId, answers: { water_heater_age: 8 } });
    expect(response.status).toBe(403);
    expect((await json(response)).results).toBeUndefined();
  });

  describe("ugyldig innhold gir 400", () => {
    it.each(invalidBodies("00000000-0000-0000-0000-000000000000").map(([name]) => name))(
      "%s",
      async (name) => {
        const { actor, organizationId } = await setupOrganization("admin");
        logInAs(actor);
        const [, body, raw] = invalidBodies(organizationId).find(([entry]) => entry === name)!;
        const response = await post(body, raw);
        expect(response.status).toBe(400);
        const result = await json(response);
        expect(result.feil).toEqual(expect.any(String));
        expect(result.results).toBeUndefined();
      },
    );
  });

  it("tilgang sjekkes før svar gis", async () => {
    const a = await setupOrganization("admin", "Oppdiktet A AS");
    const b = await setupOrganization("admin", "Oppdiktet B AS");
    logInAs(a.actor);
    const valid = await post({
      organizationId: b.organizationId,
      answers: { water_heater_age: 7.5, moisture_floor: 42.01 },
    });
    expect(valid.status).toBe(403);
    expect((await json(valid)).results).toBeUndefined();

    for (const [name, body, raw] of invalidBodies(b.organizationId)) {
      const response = await post(body, raw);
      expect([400, 403], name).toContain(response.status);
      expect((await json(response)).results, name).toBeUndefined();
    }
  });

  it("null og manglende felt gir ikke vurdert", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    logInAs(actor);
    for (const answers of [{}, { water_heater_age: null, moisture_floor: null }]) {
      const response = await post({ organizationId, answers });
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.results?.map((entry) => entry.state)).toEqual(["not_evaluated", "not_evaluated"]);
    }
  });

  it("negativt tall gir ikke vurdert, ikke 400", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    logInAs(actor);
    const response = await post({
      organizationId,
      answers: { water_heater_age: -1, moisture_floor: -1 },
    });
    expect(response.status).toBe(200);
    expect((await json(response)).results?.map((entry) => entry.state)).toEqual([
      "not_evaluated",
      "not_evaluated",
    ]);
  });

  // Obligatorisk (AK 5)
  it("ruten svarer likt motoren for alle testsakene", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    logInAs(actor);
    for (const testCase of trialRuleCases) {
      const label = `${testCase.rule_key}: ${testCase.name}`;
      const rule = trialRules.find((entry) => entry.key === testCase.rule_key);
      expect(rule, label).toBeDefined();
      const answers = { [rule!.field]: parseTrialNumber(testCase.input) };
      const response = await post({ organizationId, answers });
      expect(response.status, label).toBe(200);
      const fromRoute = (await json(response)).results?.find((e) => e.key === testCase.rule_key);
      const fromEngine = evaluateTrialRules(trialRules, answers).find(
        (e) => e.key === testCase.rule_key,
      );
      expect(fromRoute, label).toEqual(fromEngine);
      expect(fromRoute?.state, label).toBe(testCase.expect_state);
    }
  });

  it("svaret mellomlagres ikke", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    logInAs(actor);
    const ok = await post({ organizationId, answers: {} });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");

    const invalid = await post({ organizationId, answers: { water_heater_age: "7" } });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");

    const forbidden = await post({ organizationId: crypto.randomUUID(), answers: {} });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");

    logInAs(null);
    const anonymous = await post({ organizationId, answers: {} });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  });

  // Obligatorisk (AK 7)
  it("kroppen logges aldri, heller ikke ved 400", async () => {
    const MARKER = "markor-7f3a";
    const AGE = 7.4271;
    const MOISTURE = 41.3917;
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    for (const method of ["info", "warn", "error", "debug"] as const) {
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

    const { actor, organizationId } = await setupOrganization("admin");
    logInAs(actor);
    try {
      const answers = { water_heater_age: AGE, moisture_floor: MOISTURE };
      expect((await post({ organizationId, answers })).status).toBe(200);
      expect((await post({ organizationId, answers, [MARKER]: MARKER })).status).toBe(400);
      expect((await post({ organizationId, answers: { ...answers, note: MARKER } })).status).toBe(
        400,
      );
      expect((await post(`{"${MARKER}": ${AGE}`, true)).status).toBe(400);
      expect((await post({ organizationId: crypto.randomUUID(), answers })).status).toBe(403);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    for (const line of lines) {
      expect(line).not.toContain(MARKER);
      expect(line).not.toContain(String(AGE));
      expect(line).not.toContain(String(MOISTURE));
    }
  });

  it("ruten skriver ingenting til databasen", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    logInAs(actor);
    const before = await countRows();
    const response = await post({
      organizationId,
      answers: { water_heater_age: 8, moisture_floor: 43 },
    });
    expect(response.status).toBe(200);
    expect(await countRows()).toEqual(before);
  });
});
