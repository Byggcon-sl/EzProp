import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/shared/config/env";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  callAuth,
  clearDevMailbox,
  FAKE_UA,
  SESSION_UA_MARK,
  sessionForCookie,
  sessionIdsOf,
  signInThroughAuth,
} from "../../../tests/sessions";

/*
 * Better Auths egne økt-endepunkter er stengt over HTTP (docs/funksjoner/fase2a-mine-innlogginger.md
 * Omfang 1, testplan 7.2). Kallene går gjennom `auth.handler` med en gyldig, signert kapsel fra
 * ekte innlogging, ikke bare uten kapsel. Ellers ville klienten fått token, IP og rå user-agent,
 * og utlogging gått utenom kjernen og revisjonsloggen.
 *
 * Støtter hovedmål: de ansatte (all utlogging går ett sted og logges) og KI i bunnen (øktdata
 * forlater aldri serveren).
 */

beforeAll(() => {
  expect(getEnv().DEV_MAILBOX).toBe(true);
});

beforeEach(async () => {
  await resetDatabase();
  clearDevMailbox();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function inspectorWithTwoLogins() {
  const org = await createOrganization("Organisasjon A");
  const t = await createUser({ name: "Tora Takstmann", email: "tora.takst@example.com" });
  await createEmployee(t, org.id, ["inspector"]);
  const first = await signInThroughAuth(t.email, FAKE_UA.iPadSafari);
  const second = await signInThroughAuth(t.email, FAKE_UA.windowsEdge);
  return { t, first, second };
}

describe("7.2 Better Auths økt-stier over HTTP", () => {
  it("1–3. de fire stiene gir 404 med gyldig kapsel, øktene står, og svaret har ingen øktdata", async () => {
    const { t, first, second } = await inspectorWithTwoLogins();
    const before = await sessionIdsOf(t.id);
    expect(before).toHaveLength(2);

    const calls: [string, Parameters<typeof callAuth>[1]][] = [
      ["/list-sessions", { cookie: first.cookie }],
      ["/revoke-session", { cookie: first.cookie, body: { token: second.token } }],
      ["/revoke-sessions", { cookie: first.cookie, method: "POST" }],
      ["/revoke-other-sessions", { cookie: first.cookie, method: "POST" }],
    ];
    for (const [route, init] of calls) {
      const response = await callAuth(route, init);
      expect(response.status, route).toBe(404);
      const text = await response.text();
      for (const secret of [first.token, second.token, "192.0.2", "127.0.0.1", SESSION_UA_MARK]) {
        expect(text, route).not.toContain(secret);
      }
    }

    expect(await sessionIdsOf(t.id)).toEqual(before);
    expect(await sessionForCookie(first.cookie)).not.toBeNull();
    expect(await sessionForCookie(second.cookie)).not.toBeNull();
  });

  it("4. /get-session og /sign-out virker fortsatt", async () => {
    const { t, first, second } = await inspectorWithTwoLogins();
    const session = await callAuth("/get-session", { cookie: first.cookie });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { id?: string } } | null;
    expect(body?.user?.id).toBe(t.id);

    const signOut = await callAuth("/sign-out", { cookie: second.cookie, method: "POST" });
    expect(signOut.status).toBe(200);
    expect(await sessionForCookie(second.cookie)).toBeNull();
    expect(await sessionForCookie(first.cookie)).not.toBeNull();
  });
});
