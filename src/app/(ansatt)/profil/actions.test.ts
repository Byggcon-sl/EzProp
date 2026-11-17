import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";

/*
 * Serverhandlingene på /profil (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 7.1).
 * Kjernen er byttet ut her; den testes i src/core/auth. Testene viser at ikke innlogget aldri når
 * kjernen, at økt-id-en går uendret videre, at den nåværende økten aldri tas fra skjemaet, og at
 * feilene blir norske meldinger uten detaljer. Id-ene er oppdiktet.
 * Støtter hovedmål: de ansatte (tydelig svar på hvert trykk).
 */

const mocks = vi.hoisted(() => ({
  getActorForAction: vi.fn(),
  revokeOwnSession: vi.fn(),
  revokeOtherOwnSessions: vi.fn(),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/core/auth/session", () => ({ getActorForAction: mocks.getActorForAction }));
vi.mock("@/core/auth/sessions-list", () => ({
  revokeOwnSession: mocks.revokeOwnSession,
  revokeOtherOwnSessions: mocks.revokeOtherOwnSessions,
}));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));

const { revokeOtherOwnSessionsAction, revokeOwnSessionAction } = await import("./actions");

const here = path.dirname(fileURLToPath(import.meta.url));
const actor = {
  id: "user-takstmann",
  email: "takstmann@example.com",
  name: "Tea Testdatter",
  sessionId: "okt-naa",
};
const OTHER_SESSION = "okt-annen-enhet";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActorForAction.mockResolvedValue(actor);
  mocks.revokeOwnSession.mockResolvedValue({ ok: true, count: 1 });
  mocks.revokeOtherOwnSessions.mockResolvedValue({ ok: true, count: 2 });
});

describe("7.1.1 ikke innlogget", () => {
  it("revokeOwnSessionAction gir «logget ut»-svaret og kaller ikke kjernen", async () => {
    mocks.getActorForAction.mockResolvedValue(null);
    const result = await revokeOwnSessionAction(undefined, form({ sessionId: OTHER_SESSION }));
    expect(result).toMatchObject({
      status: "failed",
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
    });
    expect(mocks.revokeOwnSession).not.toHaveBeenCalled();
  });

  it("revokeOtherOwnSessionsAction gir «logget ut»-svaret og kaller ikke kjernen", async () => {
    mocks.getActorForAction.mockResolvedValue(null);
    const result = await revokeOtherOwnSessionsAction();
    expect(result).toMatchObject({
      status: "failed",
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
    });
    expect(mocks.revokeOtherOwnSessions).not.toHaveBeenCalled();
  });
});

describe("7.1.2 økt-id fra skjemaet", () => {
  it("sendes uendret til kjernen med aktøren fra serveren", async () => {
    const result = await revokeOwnSessionAction(undefined, form({ sessionId: OTHER_SESSION }));
    expect(mocks.revokeOwnSession).toHaveBeenCalledWith(actor, OTHER_SESSION);
    expect(result).toMatchObject({ status: "done", message: "Enheten er logget ut.", attempt: 1 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profil");
  });

  it("felt for nåværende økt i skjemaet ignoreres", async () => {
    await revokeOwnSessionAction(
      undefined,
      form({ sessionId: OTHER_SESSION, currentSessionId: OTHER_SESSION, isCurrent: "true" }),
    );
    const [sentActor] = mocks.revokeOwnSession.mock.calls[0] ?? [];
    expect(sentActor).toBe(actor);
    expect(sentActor.sessionId).toBe("okt-naa");
  });

  it("«Logg ut av alle andre enheter» tar ingen id fra klienten", async () => {
    await revokeOtherOwnSessionsAction();
    expect(mocks.revokeOtherOwnSessions).toHaveBeenCalledWith(actor);
  });

  it("forsøkstelleren øker fra forrige svar", async () => {
    const result = await revokeOwnSessionAction(
      { status: "done", message: "x", attempt: 4 },
      form({ sessionId: OTHER_SESSION }),
    );
    expect(result.attempt).toBe(5);
  });
});

describe("7.1.5 svarene fra kjernen", () => {
  it("not_found blir «Enheten er allerede logget ut.»", async () => {
    mocks.revokeOwnSession.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await revokeOwnSessionAction(undefined, form({ sessionId: "ukjent" }));
    expect(result).toMatchObject({ status: "failed", message: "Enheten er allerede logget ut." });
  });

  it("valideringsfeil fra kjernen gir samme svar som «finnes ikke», uten logging", async () => {
    mocks.revokeOwnSession.mockRejectedValue(z.string().min(1).safeParse("").error);
    const result = await revokeOwnSessionAction(undefined, form({}));
    expect(result.message).toBe("Enheten er allerede logget ut.");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("current_session viser til «Logg ut her»", async () => {
    mocks.revokeOwnSession.mockResolvedValue({ ok: false, reason: "current_session" });
    const result = await revokeOwnSessionAction(undefined, form({ sessionId: "okt-naa" }));
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Logg ut her");
  });

  it("ukjent feil gir generell melding og logger uten id-er eller detaljer", async () => {
    mocks.revokeOwnSession.mockRejectedValue(new Error(`databasen sa nei til ${OTHER_SESSION}`));
    const result = await revokeOwnSessionAction(undefined, form({ sessionId: OTHER_SESSION }));
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Noe gikk galt. Ingen enhet er logget ut. Prøv igjen.");
    const logged = JSON.stringify(mocks.logError.mock.calls);
    for (const secret of [OTHER_SESSION, actor.id, actor.email, "databasen sa nei"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it.each<[number, string]>([
    [0, "Ingen enheter var logget inn."],
    [1, "1 enhet er logget ut."],
    [2, "2 enheter er logget ut."],
    [5, "5 enheter er logget ut."],
  ])("alle andre: %i gir «%s»", async (count, message) => {
    mocks.revokeOtherOwnSessions.mockResolvedValue({ ok: true, count });
    const result = await revokeOtherOwnSessionsAction();
    expect(result).toMatchObject({ status: "done", message });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profil");
  });

  it("alle andre: ukjent feil gir generell melding", async () => {
    mocks.revokeOtherOwnSessions.mockRejectedValue(new Error("nede"));
    const result = await revokeOtherOwnSessionsAction();
    expect(result).toMatchObject({
      status: "failed",
      message: "Noe gikk galt. Ingen enhet er logget ut. Prøv igjen.",
    });
  });
});

describe("7.1.6 bare POST", () => {
  it("handlingene er serverhandlinger", () => {
    const source = readFileSync(path.join(here, "actions.ts"), "utf8");
    expect(source.trimStart().startsWith('"use server";')).toBe(true);
  });

  it("ingen rute under /profil logger ut via GET", () => {
    expect(readdirSync(here).filter((file) => file.startsWith("route."))).toEqual([]);
  });
});
