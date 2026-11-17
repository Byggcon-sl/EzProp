import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Rett T-0070: sidevisning uten innlogging går tilbake til samme side, og serverhandlinger
 * videresender aldri (testplan docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1e).
 * Bare Better Auth, forespørselshodene og `redirect` er byttet ut; `session.ts` er ekte.
 *
 * Støtter hovedmål: de ansatte (kommer tilbake til siden de ba om) og personvern (`neste` bærer
 * aldri spørrestreng, og en farlig sti gir innloggingen uten `neste`).
 */

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string } },
  headers: new Headers(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  getSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mocks.headers) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

const { requireActor, getActorForAction } = await import("./session");

const USER = {
  id: "user-oppdiktet",
  email: "takstmann@eksempel.invalid",
  name: "Oppdiktet Takstmann",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.headers = new Headers();
  mocks.getSession.mockImplementation(async () => mocks.session);
});

/** Kjører requireActor og gir adressen den sendte til, eller `null` uten videresending. */
async function redirectedTo(): Promise<string | null> {
  try {
    await requireActor();
    return null;
  } catch (error) {
    const url = (error as { url?: string }).url;
    if (url === undefined) throw error;
    return url;
  }
}

describe("1e requireActor uten innlogging", () => {
  it("med x-request-path: /oppdrag/<uuid> sendes den til /logg-inn?neste=%2Foppdrag%2F<uuid>", async () => {
    mocks.headers = new Headers({ "x-request-path": `/oppdrag/${UUID}` });
    expect(await redirectedTo()).toBe(`/logg-inn?neste=%2Foppdrag%2F${UUID}`);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it("med bygningssiden kommer hele stien med", async () => {
    mocks.headers = new Headers({ "x-request-path": `/oppdrag/${UUID}/bygninger` });
    expect(await redirectedTo()).toBe(`/logg-inn?neste=%2Foppdrag%2F${UUID}%2Fbygninger`);
  });

  it("uten hode sendes den til /logg-inn uten neste", async () => {
    expect(await redirectedTo()).toBe("/logg-inn");
  });

  it.each([
    "//evil.example",
    "/logg-inn",
    "/api/x",
    "/%2F%2Fevil.example",
    "/arbeidskoe?q=Oppdiktet",
    "https://evil.example",
    "",
  ])("med en sti isSafeNextPath avviser (%s) sendes den til /logg-inn uten neste", async (path) => {
    mocks.headers = new Headers({ "x-request-path": path });
    const url = await redirectedTo();
    expect(url).toBe("/logg-inn");
    expect(url).not.toContain("evil");
    expect(url).not.toContain("q=");
  });
});

describe("1e requireActor med innlogging", () => {
  it("gir aktøren uten videresending", async () => {
    mocks.session = { user: USER };
    mocks.headers = new Headers({ "x-request-path": `/oppdrag/${UUID}` });
    const actor = await requireActor();
    expect(actor).toEqual({ id: USER.id, email: USER.email, name: USER.name });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("1e getActorForAction", () => {
  it("gir null uten økt og videresender aldri", async () => {
    mocks.headers = new Headers({ "x-request-path": `/oppdrag/${UUID}` });
    expect(await getActorForAction()).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("gir aktøren med økt", async () => {
    mocks.session = { user: USER };
    expect(await getActorForAction()).toEqual({ id: USER.id, email: USER.email, name: USER.name });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
