import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  ConnectionValidationError,
  SecretNotFoundError,
  updateConnection,
} from "@/core/integrations";
import { resetEnvCache, type Env } from "@/shared/config/env";
import {
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { fakeFetch, type FakeFetchCall } from "../../../tests/fake-fetch";
import { resolveEmailSender } from "./resolve";

/*
 * Valg av leverandør for e-post, testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md
 * avsnitt 7. Støtter hovedmål: tid (én funksjon velger leverandør for all e-post) og
 * reklamasjoner (en annen organisasjons tilkobling brukes aldri, hemmeligheten leses bare gjennom
 * `readSecret`). Fasit-tabellen er skrevet inn her, ikke importert fra koden. Hemmeligheter
 * settes bare med `vi.stubEnv`; `globalThis.fetch` skal aldri kalles. Alle verdier er oppdiktet.
 */

const SECRET = "hemmelig-test-verdi";
const ORG_SECRET = "hemmelig-org-verdi";
/** Står bevisst i env-objektet: `resolve.ts` skal aldri lese den derfra (bare via `readSecret`). */
const ENV_OBJECT_SECRET = "fra-env-objektet";

/** Drift uten e-post: ingen postkasse, ingen Microsoft 365. Oppdiktede verdier. */
const env = {
  DEV_MAILBOX: false,
  SEED_ADMIN_EMAIL: "admin@example.com",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "oppdiktet-hemmelighet-som-er-lang-nok-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
} as Env;

/** Systemvalget for Microsoft 365 i miljøet. */
const graph = {
  MS_GRAPH_TENANT_ID: "t-oppdiktet",
  MS_GRAPH_CLIENT_ID: "c-oppdiktet",
  MS_GRAPH_CLIENT_SECRET: ENV_OBJECT_SECRET,
  MAIL_FROM: "noreply@example.com",
};

const ORG_SETTINGS = { from: "org@example.com", tenantId: "t-org", clientId: "c-org" };
const EMAIL = { to: "a@example.com", subject: "Emne", text: "Hei" };

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Ingen nett i tester"));
  vi.stubEnv("MS_GRAPH_CLIENT_SECRET", undefined);
  vi.stubEnv("ORG_HEMMELIGHET", undefined);
  vi.stubEnv("FINNES_IKKE", undefined);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectNoEnvObjectSecret(calls: FakeFetchCall[]) {
  expect(JSON.stringify(calls)).not.toContain(ENV_OBJECT_SECRET);
}

describe("7.1 uten organisasjon", () => {
  it.each([
    { devMailbox: true, graphSet: false, provider: "dev_mailbox" },
    { devMailbox: true, graphSet: true, provider: "dev_mailbox" },
    { devMailbox: false, graphSet: true, provider: "microsoft365" },
    { devMailbox: false, graphSet: false, provider: "server_log" },
  ])(
    "1. DEV_MAILBOX $devMailbox, Microsoft 365 i miljøet $graphSet → $provider, connectionId null",
    async ({ devMailbox, graphSet, provider }) => {
      const resolved = await resolveEmailSender(
        {},
        { ...env, ...(graphSet ? graph : {}), DEV_MAILBOX: devMailbox },
      );
      expect(resolved.sender.provider).toBe(provider);
      expect(resolved.connectionId).toBeNull();
    },
  );

  it("2. microsoft365 leser hemmeligheten gjennom readSecret, aldri fra env-objektet", async () => {
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const ok = fakeFetch();
    const { sender } = await resolveEmailSender({ fetchFn: ok.fetchFn }, { ...env, ...graph });
    expect(sender.provider).toBe("microsoft365");
    await sender.send(EMAIL);
    expect(ok.calls.map((call) => call.kind)).toEqual(["token", "send"]);
    expect(ok.calls[0]!.body).toContain(`client_secret=${SECRET}`);
    expectNoEnvObjectSecret(ok.calls);

    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", undefined);
    const missing = fakeFetch();
    const error = await rejection(
      (async () => {
        const resolved = await resolveEmailSender(
          { fetchFn: missing.fetchFn },
          { ...env, ...graph },
        );
        await resolved.sender.send(EMAIL);
      })(),
    );
    expect(error).toBeInstanceOf(SecretNotFoundError);
    expect(String(error)).not.toContain(ENV_OBJECT_SECRET);
    expectNoEnvObjectSecret(missing.calls);
    expect(missing.calls.filter((call) => call.kind === "send")).toHaveLength(0);
  });

  it("3. fetchFn sendes videre, globalThis.fetch er ukalt", async () => {
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const { fetchFn, calls } = fakeFetch();
    const { sender } = await resolveEmailSender({ fetchFn }, { ...env, ...graph });
    await sender.send(EMAIL);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("/users/noreply%40example.com/");
  });
});

describe("7.2 med organisasjon", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function twoOrganizations() {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    return { orgA, orgB };
  }

  async function m365Connection(organizationId: string, status = "active") {
    return createIntegrationConnection(organizationId, {
      provider: "microsoft365",
      status,
      secretRef: "ORG_HEMMELIGHET",
      settings: ORG_SETTINGS,
    });
  }

  it("1. aktiv microsoft365-tilkobling brukes med sine settings og sin hemmelighet", async () => {
    const { orgA } = await twoOrganizations();
    const row = await m365Connection(orgA.id);
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    // Systemvalget i miljøet har andre verdier, som ikke skal brukes
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const { fetchFn, calls } = fakeFetch();

    const resolved = await resolveEmailSender(
      { organizationId: orgA.id, fetchFn },
      { ...env, ...graph },
    );
    expect(resolved.sender.provider).toBe("microsoft365");
    expect(resolved.connectionId).toBe(row.id);

    await resolved.sender.send(EMAIL);
    const [token, send] = calls;
    expect(token!.url).toBe("https://login.microsoftonline.com/t-org/oauth2/v2.0/token");
    expect(token!.body).toContain("client_id=c-org");
    expect(token!.body).toContain(`client_secret=${ORG_SECRET}`);
    expect(send!.url).toContain("/users/org%40example.com/");
    const all = JSON.stringify(calls);
    for (const unused of [SECRET, ENV_OBJECT_SECRET, "t-oppdiktet", "c-oppdiktet"]) {
      expect(all).not.toContain(unused);
    }
    expect(all).not.toContain("noreply%40example.com");
  });

  it("2. disabled tilkobling gir systemvalget, connectionId null", async () => {
    const { orgA } = await twoOrganizations();
    await m365Connection(orgA.id, "disabled");

    const plain = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(plain.sender.provider).toBe("server_log");
    expect(plain.connectionId).toBeNull();

    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const { fetchFn, calls } = fakeFetch();
    const fromEnv = await resolveEmailSender(
      { organizationId: orgA.id, fetchFn },
      { ...env, ...graph },
    );
    expect(fromEnv.sender.provider).toBe("microsoft365");
    expect(fromEnv.connectionId).toBeNull();
    await fromEnv.sender.send(EMAIL);
    expect(calls[0]!.url).toContain("/t-oppdiktet/");
    expect(calls[0]!.body).toContain(`client_secret=${SECRET}`);
  });

  it("3. ingen tilkobling gir systemvalget, connectionId null", async () => {
    const { orgA } = await twoOrganizations();
    const plain = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(plain.sender.provider).toBe("server_log");
    expect(plain.connectionId).toBeNull();

    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const fromEnv = await resolveEmailSender({ organizationId: orgA.id }, { ...env, ...graph });
    expect(fromEnv.sender.provider).toBe("microsoft365");
    expect(fromEnv.connectionId).toBeNull();
  });

  it("4. tilkobling i error brukes fortsatt, connectionId satt", async () => {
    const { orgA } = await twoOrganizations();
    const row = await m365Connection(orgA.id, "error");
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const resolved = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(resolved.sender.provider).toBe("microsoft365");
    expect(resolved.connectionId).toBe(row.id);
  });

  it("5. DEV_MAILBOX vinner også over en aktiv microsoft365-tilkobling", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { orgA } = await twoOrganizations();
    await m365Connection(orgA.id);
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const { fetchFn, calls } = fakeFetch();

    const resolved = await resolveEmailSender(
      { organizationId: orgA.id, fetchFn },
      { ...env, DEV_MAILBOX: true },
    );
    expect(resolved.sender.provider).toBe("dev_mailbox");
    expect(resolved.connectionId).toBeNull();
    await resolved.sender.send(EMAIL);
    expect(calls).toHaveLength(0);
  });

  it("6. B sin tilkobling brukes aldri for A", async () => {
    const { orgA, orgB } = await twoOrganizations();
    await m365Connection(orgB.id);
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);

    const resolved = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(resolved.sender.provider).toBe("server_log");
    expect(resolved.connectionId).toBeNull();
  });

  it("7. organisasjon som ikke finnes gir systemvalget, ingen feil", async () => {
    await twoOrganizations();
    const resolved = await resolveEmailSender({ organizationId: randomUUID() }, env);
    expect(resolved.sender.provider).toBe("server_log");
    expect(resolved.connectionId).toBeNull();
  });

  it("8a. hemmelighet som mangler: connectionId satt, send avvises med SecretNotFoundError", async () => {
    const { orgA } = await twoOrganizations();
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "FINNES_IKKE",
      settings: ORG_SETTINGS,
    });
    const { fetchFn, calls } = fakeFetch();

    const resolved = await resolveEmailSender({ organizationId: orgA.id, fetchFn }, env);
    expect(resolved.connectionId).toBe(row.id);
    const error = await rejection(resolved.sender.send(EMAIL));
    expect(error).toBeInstanceOf(SecretNotFoundError);
    expect((error as Error).message).toContain("FINNES_IKKE");
    expect(calls).toHaveLength(0);
  });

  it("8b. ugyldige settings på raden: connectionId satt, send avvises, fetchFn ukalt", async () => {
    const { orgA } = await twoOrganizations();
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "ORG_HEMMELIGHET",
      settings: { from: "ikke-en-adresse" },
    });
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const { fetchFn, calls } = fakeFetch();

    const resolved = await resolveEmailSender({ organizationId: orgA.id, fetchFn }, env);
    expect(resolved.connectionId).toBe(row.id);
    const error = await rejection(resolved.sender.send(EMAIL));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(ORG_SECRET);
    expect(calls).toHaveLength(0);
  });

  it("8c. server_log-rad med ugyldige settings: connectionId satt, send avvises med ConnectionValidationError, ingen logglinje", async () => {
    // Feiltypen er den eneste påstanden som skiller: den ekte server_log-senderen avviser også
    // EMAIL (mottakeren er ikke SEED_ADMIN_EMAIL), men med en annen feil.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { orgA } = await twoOrganizations();
    const row = await createIntegrationConnection(orgA.id, {
      provider: "server_log",
      settings: { x: 1 },
      status: "active",
    });

    const resolved = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(resolved.connectionId).toBe(row.id);
    await expect(resolved.sender.send(EMAIL)).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(info).not.toHaveBeenCalled();
  });

  it("9. ny sender per kall: disabled virker straks", async () => {
    const { orgA } = await twoOrganizations();
    const admin = await createUser({ name: "Admin A" });
    await createEmployee(admin, orgA.id, ["admin"]);
    const row = await m365Connection(orgA.id);
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);

    const first = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(first.sender.provider).toBe("microsoft365");
    expect(first.connectionId).toBe(row.id);

    await updateConnection(admin, orgA.id, row.id, { status: "disabled" });

    const second = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(second.sender.provider).toBe("server_log");
    expect(second.connectionId).toBeNull();
    expect(second.sender).not.toBe(first.sender);
  });

  it("10. server_log-tilkobling gir server_log med connectionId satt", async () => {
    const { orgA } = await twoOrganizations();
    const row = await createIntegrationConnection(orgA.id);
    const resolved = await resolveEmailSender({ organizationId: orgA.id }, env);
    expect(resolved.sender.provider).toBe("server_log");
    expect(resolved.connectionId).toBe(row.id);
  });
});
