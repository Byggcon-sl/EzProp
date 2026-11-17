import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Rett T-0070 (docs/agenter/oppgaver/rett-t0070-t0071.md punkt 2 og 3, testplan 1e):
 * `requireActor` sender til `/logg-inn?neste=<sti>` når stien fra proxyen er trygg, og
 * `getActorForAction` videresender aldri. Innloggingen og hodene er byttet ut. Testdata er
 * oppdiktet. Støtter hovedmål: de ansatte (tilbake til samme side etter innlogging).
 */

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string } },
  headers: new Headers(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));

const { getActorForAction, requireActor, REQUEST_PATH_HEADER } = await import("./session");

const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const USER = { id: "user-oppdiktet", email: "ola@example.invalid", name: "Ola Oppdiktet" };

beforeEach(() => {
  mocks.session = null;
  mocks.headers = new Headers();
  mocks.redirect.mockClear();
});

describe("requireActor uten innlogging", () => {
  it("sender til /logg-inn med neste = stien fra proxyen", async () => {
    mocks.headers.set(REQUEST_PATH_HEADER, `/oppdrag/${ASSIGNMENT}`);
    await expect(requireActor()).rejects.toThrow(
      `REDIRECT /logg-inn?neste=%2Foppdrag%2F${ASSIGNMENT}`,
    );
  });

  it("uten hode: /logg-inn uten neste", async () => {
    await expect(requireActor()).rejects.toThrow(/^REDIRECT \/logg-inn$/);
  });

  it.each(["//evil.example", "/logg-inn", "/api/x", "/arbeidskoe?q=Oppdiktet", "/%5Cevil"])(
    "avvist sti %s: /logg-inn uten neste",
    async (path) => {
      mocks.headers.set(REQUEST_PATH_HEADER, path);
      await expect(requireActor()).rejects.toThrow(/^REDIRECT \/logg-inn$/);
    },
  );
});

describe("requireActor med innlogging", () => {
  it("gir aktøren uten videresending", async () => {
    mocks.session = { user: USER };
    mocks.headers.set(REQUEST_PATH_HEADER, `/oppdrag/${ASSIGNMENT}`);
    await expect(requireActor()).resolves.toEqual(USER);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("getActorForAction", () => {
  it("gir null uten økt og videresender aldri", async () => {
    mocks.headers.set(REQUEST_PATH_HEADER, `/oppdrag/${ASSIGNMENT}`);
    await expect(getActorForAction()).resolves.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("gir aktøren med økt", async () => {
    mocks.session = { user: USER };
    await expect(getActorForAction()).resolves.toEqual(USER);
  });
});
