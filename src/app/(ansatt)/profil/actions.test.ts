import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";

/*
 * Serverhandlingene på /profil (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 5 og
 * «Avklart før bygging» 5–7; testplan 7.1). Kjernen er byttet ut her; den testes mot databasen i
 * src/core/auth/sessions-list.integration.test.ts. Testene viser at innlogget bruker og nåværende
 * økt kommer fra serveren, at feil blir tydelige norske meldinger uten detaljer, og at utlogging
 * bare skjer i serverhandlinger (POST).
 *
 * Navnene på handlingene var ikke låst i testplanen; de finnes ut fra eksportene i actions.ts
 * (én for én økt, én for «alle andre»).
 *
 * Støtter hovedmål: de ansatte (ett trykk med tydelig kvittering, og ingen kan flytte merket
 * «denne enheten» eller logge ut en annens økt via skjemaet).
 */

const mocks = vi.hoisted(() => ({
  actor: null as null | { id: string; email: string; name: string; sessionId?: string },
  listOwnSessions: vi.fn(),
  revokeOwnSession: vi.fn(),
  revokeOtherOwnSessions: vi.fn(),
  listEmployeeSessions: vi.fn(),
  revokeAllEmployeeSessions: vi.fn(),
  logError: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/core/auth/session", () => ({
  getActorForAction: vi.fn(async () => mocks.actor),
  getCurrentActor: vi.fn(async () => mocks.actor),
  requireActor: vi.fn(async () => {
    if (!mocks.actor) throw new Error("REDIRECT /logg-inn");
    return mocks.actor;
  }),
}));
vi.mock("@/core/auth/sessions-list", () => ({
  listOwnSessions: mocks.listOwnSessions,
  revokeOwnSession: mocks.revokeOwnSession,
  revokeOtherOwnSessions: mocks.revokeOtherOwnSessions,
  listEmployeeSessions: mocks.listEmployeeSessions,
  revokeAllEmployeeSessions: mocks.revokeAllEmployeeSessions,
}));

const actions = (await import("./actions")) as unknown as Record<string, unknown>;

type Action = (previous: unknown, formData: FormData) => Promise<unknown>;

function pick(test: (name: string) => boolean, label: string): Action {
  const names = Object.keys(actions).filter(
    (name) => typeof actions[name] === "function" && test(name),
  );
  if (names.length !== 1) {
    throw new Error(`Fant ${names.length} handlinger for ${label} i profil/actions.ts: ${names}`);
  }
  return actions[names[0]!] as Action;
}

const revokeOne = pick(
  (name) => /revoke|logOut|signOut/i.test(name) && !/other|all/i.test(name),
  "«Logg ut» på én enhet",
);
const revokeOthers = pick((name) => /other/i.test(name), "«Logg ut av alle andre enheter»");

const ACTOR = {
  id: "user-oppdiktet-1",
  email: "tora.takst@example.com",
  name: "Tora Takstmann",
  sessionId: "okt-naa-0001",
};
const OTHER_SESSION = "okt-annen-0002";
const previous = { fieldErrors: {}, message: null, values: {}, attempt: 0 };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function run(action: Action, data: FormData): Promise<string> {
  try {
    return JSON.stringify(await action(previous, data));
  } catch (error) {
    return `THROWN ${(error as Error).message}`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor = { ...ACTOR };
  mocks.revokeOwnSession.mockResolvedValue({ ok: true, count: 1 });
  mocks.revokeOtherOwnSessions.mockResolvedValue({ ok: true, count: 2 });
});

describe("7.1 /profil: serverhandlingene", () => {
  it("1. ikke innlogget: «logget ut»-svaret, kjernen kalles ikke", async () => {
    mocks.actor = null;
    for (const action of [revokeOne, revokeOthers]) {
      const result = await run(action, form({ sessionId: OTHER_SESSION }));
      expect(result.includes(SIGNED_OUT_MESSAGE) || result.includes('"signedOut":true')).toBe(true);
    }
    expect(mocks.revokeOwnSession).not.toHaveBeenCalled();
    expect(mocks.revokeOtherOwnSessions).not.toHaveBeenCalled();
  });

  it("2. økt-id fra skjemaet sendes videre; nåværende økt kommer aldri fra skjemaet", async () => {
    const result = await run(
      revokeOne,
      form({
        sessionId: OTHER_SESSION,
        currentSessionId: OTHER_SESSION,
        isCurrent: "true",
        userId: "user-annen",
      }),
    );
    expect(result).toContain("Enheten er logget ut.");
    expect(mocks.revokeOwnSession).toHaveBeenCalledTimes(1);
    const [actor, sessionId] = mocks.revokeOwnSession.mock.calls[0]!;
    expect(sessionId).toBe(OTHER_SESSION);
    expect(actor).toEqual(ACTOR);
  });

  it("2. «alle andre» bruker aktøren fra serveren og gir antallet i kvitteringen", async () => {
    const result = await run(revokeOthers, form({ currentSessionId: OTHER_SESSION }));
    expect(mocks.revokeOtherOwnSessions).toHaveBeenCalledTimes(1);
    expect(mocks.revokeOtherOwnSessions.mock.calls[0]![0]).toEqual(ACTOR);
    expect(result).toContain("2 enheter er logget ut.");
  });

  it.each([
    [1, "1 enhet er logget ut."],
    [3, "3 enheter er logget ut."],
    [0, "Ingen enheter var logget inn."],
  ])("bøyning: %i andre enheter gir «%s» (avklart punkt 5)", async (count, text) => {
    mocks.revokeOtherOwnSessions.mockResolvedValue({ ok: true, count });
    expect(await run(revokeOthers, form({}))).toContain(text);
  });

  it("5. «finnes ikke» blir «Enheten er allerede logget ut.»", async () => {
    mocks.revokeOwnSession.mockResolvedValue({ ok: false, reason: "not_found" });
    expect(await run(revokeOne, form({ sessionId: OTHER_SESSION }))).toContain(
      "Enheten er allerede logget ut.",
    );
  });

  it("5. AccessDeniedError blir «ingen tilgang»", async () => {
    mocks.revokeOwnSession.mockRejectedValue(new AccessDeniedError());
    expect(await run(revokeOne, form({ sessionId: OTHER_SESSION }))).toContain(
      "Du har ikke tilgang til dette.",
    );
  });

  it("5. ukjent feil gir en generell melding uten detaljer", async () => {
    mocks.revokeOwnSession.mockRejectedValue(new Error("hemmelig detalj okt-annen-0002"));
    mocks.revokeOtherOwnSessions.mockRejectedValue(new Error("hemmelig detalj okt-annen-0002"));
    for (const action of [revokeOne, revokeOthers]) {
      const result = await run(action, form({ sessionId: OTHER_SESSION }));
      expect(result).not.toContain("THROWN");
      expect(result).not.toContain("hemmelig detalj");
      expect(result).toMatch(/Noe gikk galt/);
    }
  });

  it("5. tom eller manglende økt-id gir melding uten krasj", async () => {
    mocks.revokeOwnSession.mockResolvedValue({ ok: false, reason: "not_found" });
    for (const data of [form({}), form({ sessionId: "" })]) {
      const result = await run(revokeOne, data);
      expect(result).not.toContain("THROWN");
      expect(result).not.toContain('"ok":true');
    }
  });
});

describe("7.1.6 bare POST: ingen GET-rute logger ut", () => {
  function routeFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return routeFiles(full);
      return name === "route.ts" ? [full] : [];
    });
  }

  it("ingen route.ts med GET kaller kjernens utlogging av økter", () => {
    const offenders = routeFiles(path.join(process.cwd(), "src/app")).filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /export\s+(async\s+)?function\s+GET|export\s+const\s+GET/.test(source) &&
        /revoke(Own|Other|All)\w*Session|sessions-list/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("actions.ts er en serverhandling-fil", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(ansatt)/profil/actions.ts"),
      "utf8",
    );
    expect(source.trimStart().startsWith('"use server"')).toBe(true);
  });
});
