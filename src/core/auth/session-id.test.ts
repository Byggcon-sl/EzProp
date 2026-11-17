import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `getCurrentActor` fyller `sessionId` fra Better Auth på serveren
 * (docs/funksjoner/fase2a-mine-innlogginger.md, avklart før bygging nr. 7). Innloggingen og
 * hodene er byttet ut. Testdata er oppdiktet.
 * Støtter hovedmål: de ansatte («Denne enheten» er alltid riktig, og kan ikke flyttes).
 */

const mocks = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string; name: string };
    session?: { id: string };
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));

const { getCurrentActor } = await import("./session");

const USER = { id: "user-oppdiktet", email: "ola@example.com", name: "Ola Oppdiktet" };

beforeEach(() => {
  mocks.session = null;
});

describe("getCurrentActor og sessionId", () => {
  it("sessionId kommer fra økten Better Auth fant", async () => {
    mocks.session = { user: USER, session: { id: "okt-oppdiktet-1" } };
    expect(await getCurrentActor()).toEqual({ ...USER, sessionId: "okt-oppdiktet-1" });
  });

  it("uten økt-id: ingen sessionId", async () => {
    mocks.session = { user: USER };
    const actor = await getCurrentActor();
    expect(actor).toEqual(USER);
    expect(actor && "sessionId" in actor).toBe(false);
  });

  it("ikke innlogget gir null", async () => {
    expect(await getCurrentActor()).toBeNull();
  });
});
