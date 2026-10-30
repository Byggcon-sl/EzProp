import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSession,
  createSessionChecker,
  nextSignInRequired,
  shouldCheckSession,
  type SessionCheckResult,
  type SessionCheckTrigger,
} from "./session-check";

// Prøve F – innlogging som har gått ut (docs/funksjoner/fase1-prove-f-innlogging.md, punkt 1).
// Testplan: docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 1. Støtter reklamasjoner
// (appen sier fra når innloggingen har gått ut, i stedet for å la endringer bli liggende i det
// stille). Svarene fra serveren er data: tabellene under er testsakene. Ingen ekte nett: `fetch`
// sendes inn. E-post og navn i svarene er oppdiktet.

const FAKE_EMAIL = "oppdiktet.takstmann@eksempel.no";
const FAKE_NAME = "Oppdiktet Takstmann";
const RESULTS: readonly SessionCheckResult[] = ["valid", "expired", "unknown"];

/** Et svar fra Better Auth med en økt (formen fra `get-session`), med oppdiktet e-post og navn. */
const SESSION_BODY = {
  session: {
    id: "oppdiktet-okt",
    token: "oppdiktet-token",
    userId: "oppdiktet-bruker",
    expiresAt: "2026-11-29T12:00:00.000Z",
  },
  user: { id: "oppdiktet-bruker", email: FAKE_EMAIL, name: FAKE_NAME },
};

type FetchArgs = [input: string, init?: RequestInit];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchReturning(response: () => Response | Promise<Response>) {
  return vi.fn(async (..._args: FetchArgs) => response());
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;

let consoleSpies: { mock: { calls: unknown[][] } }[] = [];

beforeEach(() => {
  consoleSpies = consoleMethods.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Alt som ble skrevet til konsollen, som én tekst. */
function consoleOutput(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      args.map((arg: unknown) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
    )
    .join("\n");
}

describe("checkSession: svar fra serveren (session-check.ts)", () => {
  it("200 med en økt gir valid", async () => {
    const fetchImpl = fetchReturning(() => jsonResponse(200, SESSION_BODY));
    await expect(checkSession(fetchImpl)).resolves.toBe("valid");
  });

  it("200 med null gir expired", async () => {
    const fetchImpl = fetchReturning(() => jsonResponse(200, null));
    await expect(checkSession(fetchImpl)).resolves.toBe("expired");
  });

  // Heller ingen melding enn feil melding (avgjørelse 9 i kortet)
  it.each<[string, () => Response | Promise<Response>]>([
    ["200 med {}", () => jsonResponse(200, {})],
    ["200 uten session", () => jsonResponse(200, { user: SESSION_BODY.user })],
    ["200 med session: null", () => jsonResponse(200, { session: null, user: null })],
    ["200 med en liste", () => jsonResponse(200, [])],
    ["200 med tekst", () => jsonResponse(200, "ok")],
    ["401", () => jsonResponse(401, null)],
    ["403", () => jsonResponse(403, null)],
    ["500", () => jsonResponse(500, { message: "feil" })],
    ["502", () => new Response("Bad Gateway", { status: 502 })],
    ["503 med null", () => jsonResponse(503, null)],
    ["ugyldig JSON", () => new Response("{ikke json", { status: 200 })],
    ["tom kropp", () => new Response("", { status: 200 })],
    ["nettverksfeil", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "tidsavbrudd fra nettleseren",
      () => Promise.reject(new DOMException("Tidsavbrudd", "TimeoutError")),
    ],
    ["avbrutt", () => Promise.reject(new DOMException("Avbrutt", "AbortError"))],
  ])("%s gir unknown", async (_label, response) => {
    const fetchImpl = fetchReturning(response);
    await expect(checkSession(fetchImpl)).resolves.toBe("unknown");
  });

  it("tidsavbrudd: svarer serveren ikke, gir sjekken unknown og avbryter kallet", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const result = checkSession(fetchImpl, 5_000);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(result).resolves.toBe("unknown");
    expect(signal?.aborted, "kallet avbrytes, så det ikke henger").toBe(true);
  });

  it("kaster aldri, heller ikke når fetch kaster synkront eller json() kaster", async () => {
    const throwsSync = vi.fn(() => {
      throw new Error("synkron feil");
    }) as unknown as (input: string, init?: RequestInit) => Promise<Response>;
    await expect(checkSession(throwsSync)).resolves.toBe("unknown");

    const badJson = fetchReturning(
      () =>
        ({
          status: 200,
          ok: true,
          json: () => Promise.reject(new SyntaxError("ugyldig")),
          text: () => Promise.reject(new SyntaxError("ugyldig")),
        }) as unknown as Response,
    );
    await expect(checkSession(badJson)).resolves.toBe("unknown");
  });

  it("kaller bare /api/auth/get-session på samme opprinnelse, med informasjonskapselen", async () => {
    const fetchImpl = fetchReturning(() => jsonResponse(200, SESSION_BODY));
    await checkSession(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    // Relativ sti = samme opprinnelse. Aldri en annen vert.
    expect(String(input)).toBe("/api/auth/get-session");
    expect(init?.method ?? "GET").toBe("GET");
    expect(["same-origin", "include"]).toContain(init?.credentials ?? "same-origin");
    expect(init?.credentials).not.toBe("omit");
  });

  it("resultatet er alltid en av de tre verdiene, og aldri e-post, navn eller andre felt", async () => {
    const bodies: unknown[] = [
      SESSION_BODY,
      null,
      {},
      { user: SESSION_BODY.user },
      { session: null, user: SESSION_BODY.user },
    ];
    for (const body of bodies) {
      const result = await checkSession(fetchReturning(() => jsonResponse(200, body)));
      expect(RESULTS, JSON.stringify(body)).toContain(result);
      expect(typeof result).toBe("string");
      const text = JSON.stringify(result);
      expect(text).not.toContain(FAKE_EMAIL);
      expect(text).not.toContain(FAKE_NAME);
      expect(text).not.toContain("oppdiktet-token");
    }
  });

  it("skriver aldri e-post, navn eller svaret til konsollen", async () => {
    const responses: (() => Response | Promise<Response>)[] = [
      () => jsonResponse(200, SESSION_BODY),
      () => jsonResponse(200, null),
      () => jsonResponse(200, { user: SESSION_BODY.user }),
      () => jsonResponse(401, SESSION_BODY),
      () => jsonResponse(500, SESSION_BODY),
      () => new Response(`{ugyldig ${FAKE_EMAIL}`, { status: 200 }),
      () => Promise.reject(new TypeError(`Failed to fetch ${FAKE_EMAIL}`)),
    ];
    for (const response of responses) {
      await checkSession(fetchReturning(response));
    }
    const output = consoleOutput();
    expect(output).not.toContain(FAKE_EMAIL);
    expect(output).not.toContain(FAKE_NAME);
    expect(output).not.toContain("oppdiktet-token");
    expect(output).not.toContain("oppdiktet-okt");
  });
});

describe("shouldCheckSession: når sjekken kjøres (session-check.ts)", () => {
  // Reglene er data: [utløser, nett, sjekk?]
  const cases: [SessionCheckTrigger, boolean, boolean][] = [
    ["online", true, true],
    ["cameOnline", true, true],
    ["visible", true, true],
    ["syncFailed", true, true],
    ["poll", true, false],
    ["online", false, false],
    ["cameOnline", false, false],
    ["visible", false, false],
    ["syncFailed", false, false],
    ["poll", false, false],
  ];

  it.each(cases)("%s med nett=%s gir sjekk=%s", (trigger, online, expected) => {
    expect(shouldCheckSession(trigger, online)).toBe(expected);
  });

  it("ingen sjekk uten nett, uansett hva som utløser", () => {
    const triggers: SessionCheckTrigger[] = [
      "online",
      "cameOnline",
      "visible",
      "syncFailed",
      "poll",
    ];
    expect(triggers.filter((trigger) => shouldCheckSession(trigger, false))).toEqual([]);
  });
});

describe("nextSignInRequired: hva svaret gjør med meldingen (session-check.ts)", () => {
  // [før, svar, etter]
  const cases: [boolean, SessionCheckResult, boolean][] = [
    [false, "unknown", false],
    [true, "unknown", true],
    [false, "expired", true],
    [true, "expired", true],
    [false, "valid", false],
    [true, "valid", false],
  ];

  it.each(cases)("melding=%s og %s gir melding=%s", (before, result, after) => {
    expect(nextSignInRequired(before, result)).toBe(after);
  });

  it("expired, så unknown, så valid: meldingen kommer, blir stående, og forsvinner", () => {
    const steps: SessionCheckResult[] = ["expired", "unknown", "valid"];
    const states: boolean[] = [];
    let current = false;
    for (const step of steps) {
      current = nextSignInRequired(current, step);
      states.push(current);
    }
    expect(states).toEqual([true, true, false]);
  });
});

describe("createSessionChecker: høyst én sjekk om gangen (session-check.ts)", () => {
  it("to utløsere samtidig (online og feilet synkrunde) gir ett kall til fetch", async () => {
    let release: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(
      (_input: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const check = createSessionChecker(() => checkSession(fetchImpl));
    const fromOnline = check();
    const fromSyncFailed = check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(jsonResponse(200, null));
    await expect(Promise.all([fromOnline, fromSyncFailed])).resolves.toEqual([
      "expired",
      "expired",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("en ny sjekk etter at den første er ferdig, gir et nytt kall", async () => {
    const fetchImpl = fetchReturning(() => jsonResponse(200, SESSION_BODY));
    const check = createSessionChecker(() => checkSession(fetchImpl));
    await expect(check()).resolves.toBe("valid");
    await expect(check()).resolves.toBe("valid");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("en sjekk som feilet, slipper låsen", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return jsonResponse(200, null);
    });
    const check = createSessionChecker(() => checkSession(fetchImpl));
    await expect(check()).resolves.toBe("unknown");
    await expect(check()).resolves.toBe("expired");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
