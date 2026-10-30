import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSession,
  createSessionChecker,
  nextSignInRequired,
  SESSION_CHECK_PATH,
  shouldCheckSession,
  type SessionCheckResult,
  type SessionCheckTrigger,
} from "./session-check";

// Testplan docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 1. Alle navn og
// e-poster er oppdiktet.

const FAKE_EMAIL = "ola.testperson@eksempel.invalid";
const FAKE_NAME = "Ola Testperson";

const VALID_BODY = {
  session: { id: "s-1", token: "hemmelig-token", userId: "u-1", expiresAt: "2026-11-29" },
  user: { id: "u-1", email: FAKE_EMAIL, name: FAKE_NAME },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(response: () => Response | Promise<Response>) {
  return vi.fn((_input: string, _init?: RequestInit) => Promise.resolve(response()));
}

const RESULTS: SessionCheckResult[] = ["valid", "expired", "unknown"];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("checkSession: svar fra serveren", () => {
  it("200 med en økt gir valid", async () => {
    expect(await checkSession(fetchReturning(() => jsonResponse(200, VALID_BODY)))).toBe("valid");
  });

  it("200 med null gir expired", async () => {
    expect(await checkSession(fetchReturning(() => jsonResponse(200, null)))).toBe("expired");
  });

  it.each<[string, () => Response]>([
    ["200 med {}", () => jsonResponse(200, {})],
    ["200 uten session", () => jsonResponse(200, { user: { email: FAKE_EMAIL } })],
    ["200 med session null", () => jsonResponse(200, { session: null, user: null })],
    ["200 med liste", () => jsonResponse(200, [])],
    ["401", () => jsonResponse(401, null)],
    ["403", () => jsonResponse(403, null)],
    ["500", () => jsonResponse(500, VALID_BODY)],
    ["503", () => new Response("feil", { status: 503 })],
    ["ugyldig JSON", () => new Response("{ikke json", { status: 200 })],
  ])("%s gir unknown", async (_name, response) => {
    expect(await checkSession(fetchReturning(response))).toBe("unknown");
  });

  it("nettverksfeil gir unknown og kaster ikke", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(checkSession(fetchImpl)).resolves.toBe("unknown");
  });

  it("synkron feil i fetch gir unknown og kaster ikke", async () => {
    const fetchImpl = vi.fn((): Promise<Response> => {
      throw new Error("brått");
    });
    await expect(checkSession(fetchImpl)).resolves.toBe("unknown");
  });

  it("tidsavbrudd gir unknown og avbryter kallet", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const result = checkSession(fetchImpl, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("unknown");
    expect(signal?.aborted).toBe(true);
  });

  it("kaller bare /api/auth/get-session på samme opprinnelse, med kapselen og uten hurtiglager", async () => {
    const fetchImpl = fetchReturning(() => jsonResponse(200, VALID_BODY));
    await checkSession(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    expect(input).toBe(SESSION_CHECK_PATH);
    expect(input).toBe("/api/auth/get-session");
    expect(["same-origin", "include"]).toContain(init?.credentials);
    expect(init?.cache).toBe("no-store");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("resultatet er alltid en av tre verdier og inneholder aldri e-post, navn eller token", async () => {
    const bodies: Array<() => Response> = [
      () => jsonResponse(200, VALID_BODY),
      () => jsonResponse(200, null),
      () => jsonResponse(200, { user: { email: FAKE_EMAIL, name: FAKE_NAME } }),
      () => jsonResponse(401, { email: FAKE_EMAIL }),
    ];
    for (const body of bodies) {
      const result = await checkSession(fetchReturning(body));
      expect(RESULTS).toContain(result);
      const text = JSON.stringify(result);
      expect(text).not.toContain(FAKE_EMAIL);
      expect(text).not.toContain(FAKE_NAME);
      expect(text).not.toContain("hemmelig-token");
    }
  });

  it("skriver aldri til konsollen", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await checkSession(fetchReturning(() => jsonResponse(200, VALID_BODY)));
    await checkSession(fetchReturning(() => jsonResponse(200, null)));
    await checkSession(fetchReturning(() => new Response("{ikke json", { status: 200 })));
    await checkSession(vi.fn(() => Promise.reject(new Error(FAKE_EMAIL))));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("shouldCheckSession: når sjekken kjøres", () => {
  it.each<[SessionCheckTrigger, boolean, boolean]>([
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
  ])("%s med nett=%s gir %s", (trigger, online, expected) => {
    expect(shouldCheckSession(trigger, online)).toBe(expected);
  });
});

describe("nextSignInRequired: tilstandsregelen", () => {
  it.each<[boolean, SessionCheckResult, boolean]>([
    [false, "unknown", false],
    [true, "unknown", true],
    [false, "expired", true],
    [true, "expired", true],
    [false, "valid", false],
    [true, "valid", false],
  ])("forrige=%s og %s gir %s", (previous, result, expected) => {
    expect(nextSignInRequired(previous, result)).toBe(expected);
  });

  it("expired gir meldingen, unknown beholder den, en senere valid fjerner den", () => {
    const steps: SessionCheckResult[] = ["unknown", "expired", "unknown", "valid"];
    const seen: boolean[] = [];
    steps.reduce((previous, result) => {
      const next = nextSignInRequired(previous, result);
      seen.push(next);
      return next;
    }, false);
    expect(seen).toEqual([false, true, true, false]);
  });
});

describe("createSessionChecker: høyst én sjekk om gangen", () => {
  it("to samtidige utløsere gir ett fetch-kall; en ny sjekk etterpå gir et nytt kall", async () => {
    let release: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const check = createSessionChecker(() => checkSession(fetchImpl));

    // `online` og feilet synkrunde samtidig.
    const first = check();
    const second = check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(jsonResponse(200, null));
    expect(await first).toBe("expired");
    expect(await second).toBe("expired");

    const third = check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    release(jsonResponse(200, VALID_BODY));
    expect(await third).toBe("valid");
  });
});
