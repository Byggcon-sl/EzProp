import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SecretNotFoundError, updateConnection } from "@/core/integrations";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { resetEnvCache, type Env } from "@/shared/config/env";
import {
  auditRows,
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { fakeFetch } from "../../../tests/fake-fetch";
import { EmailSendError, readDevMailbox, sendEmail } from "./index";
import { resolveEmailSender } from "./resolve";

/*
 * `sendEmail` gjennom tilkoblingslaget, testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md
 * avsnitt 8. Støtter hovedmål: tid (alle ansatte kan få innloggingskoden på e-post) og
 * reklamasjoner (`last_ok_at`/`last_error` viser svikt, og feilen har aldri adresse, kode eller
 * hemmelighet). Ingen test gjør nettkall: `globalThis.fetch` har en spion som skal være ukalt.
 * Hemmeligheter settes bare med `vi.stubEnv`. Alle verdier er oppdiktet.
 */

const SECRET = "hemmelig-test-verdi";
const ORG_SECRET = "hemmelig-org-verdi";

/** Drift uten e-post: ingen postkasse, ingen Microsoft 365. Oppdiktede verdier. */
const env = {
  DEV_MAILBOX: false,
  SEED_ADMIN_EMAIL: "admin@example.com",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "oppdiktet-hemmelighet-som-er-lang-nok-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
} as Env;

/** Systemvalget for Microsoft 365. Hemmeligheten her skal aldri brukes (bare via `readSecret`). */
const graph = {
  MS_GRAPH_TENANT_ID: "t-oppdiktet",
  MS_GRAPH_CLIENT_ID: "c-oppdiktet",
  MS_GRAPH_CLIENT_SECRET: "fra-env-objektet",
  MAIL_FROM: "noreply@example.com",
};

const ORG_SETTINGS = { from: "org@example.com", tenantId: "t-org", clientId: "c-org" };

const logLine = "Engangskode til første admin: 123456 (gyldig i 10 minutter)";
const NOT_CONFIGURED =
  "E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.";

function spyConsole() {
  return {
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Ingen nett i tester"));
  vi.stubEnv("MS_GRAPH_CLIENT_SECRET", undefined);
  vi.stubEnv("ORG_HEMMELIGHET", undefined);
  vi.stubEnv("FINNES_IKKE", undefined);
});

afterEach(() => {
  // 8.2.10: fetch aldri kalt, i hele filen
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("8.1 e-post uten organisasjon (som før)", () => {
  it("1a. bruker utviklings-postkassen i test, og viser nyeste først", async () => {
    spyConsole();
    expect((await resolveEmailSender({})).sender.provider).toBe("dev_mailbox");
    await sendEmail({ to: "a@example.com", subject: "Første", text: "x" });
    await sendEmail({ to: "b@example.com", subject: "Andre", text: "y" });
    const [latest] = readDevMailbox();
    expect(latest).toMatchObject({ to: "b@example.com", subject: "Andre" });
  });

  it("1b. velger tjeneste ut fra innstillingene", async () => {
    expect((await resolveEmailSender({}, env)).sender.provider).toBe("server_log");
    expect((await resolveEmailSender({}, { ...env, ...graph })).sender.provider).toBe(
      "microsoft365",
    );
  });

  it("1c. velger dev_mailbox når DEV_MAILBOX er på", async () => {
    expect((await resolveEmailSender({}, { ...env, DEV_MAILBOX: true })).sender.provider).toBe(
      "dev_mailbox",
    );
    expect(
      (await resolveEmailSender({}, { ...env, ...graph, DEV_MAILBOX: true })).sender.provider,
    ).toBe("dev_mailbox");
  });

  it("1d. postkassen vinner lokalt også når alle fire Microsoft 365-verdier er satt i miljøet", async () => {
    vi.stubEnv("MS_GRAPH_TENANT_ID", "t-oppdiktet");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "c-oppdiktet");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    vi.stubEnv("MAIL_FROM", "noreply@example.com");
    resetEnvCache();
    expect((await resolveEmailSender({})).sender.provider).toBe("dev_mailbox");
  });

  it("1e. velger microsoft365 når de tre verdiene er satt (hemmeligheten via readSecret)", async () => {
    expect((await resolveEmailSender({}, { ...env, ...graph })).sender.provider).toBe(
      "microsoft365",
    );
  });

  it("1f. velger server_log når e-post ikke er satt opp", async () => {
    expect((await resolveEmailSender({}, env)).sender.provider).toBe("server_log");
  });

  it("2. microsoft365 sender gjennom fetchFn: ett token-kall og ett sendekall", async () => {
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    const { fetchFn, calls } = fakeFetch();
    await sendEmail(
      { to: "a@example.com", subject: "Emne", text: "x", logLine },
      { fetchFn },
      { ...env, ...graph },
    );
    expect(calls.map((call) => call.kind)).toEqual(["token", "send"]);
    expect(calls[0]!.body).toContain(`client_secret=${SECRET}`);
    expect(JSON.stringify(calls)).not.toContain("fra-env-objektet");
  });

  it("3a. readDevMailbox gir tom liste når DEV_MAILBOX er av", () => {
    vi.stubEnv("DEV_MAILBOX", "0");
    resetEnvCache();
    expect(readDevMailbox()).toEqual([]);
  });

  it("3b. postkassen beholder de 50 siste, nyeste først", async () => {
    spyConsole();
    for (let i = 1; i <= 51; i += 1) {
      await sendEmail({ to: "a@example.com", subject: `Nr ${i}`, text: "x" });
    }
    const mailbox = readDevMailbox();
    expect(mailbox).toHaveLength(50);
    expect(mailbox[0]!.subject).toBe("Nr 51");
    expect(mailbox[49]!.subject).toBe("Nr 2");
  });

  it("4a. server_log skriver koden for første admin, uten adressen", async () => {
    const spies = spyConsole();
    await sendEmail(
      { to: "Admin@Example.com", subject: "Emne", text: "x", logLine },
      undefined,
      env,
    );
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).toContain("[innlogging]");
    expect(line).toContain("docs/drift/testmiljo-azure.md");
    expect(line).not.toContain("@");
  });

  it("4b. server_log går ikke gjennom loggeren", async () => {
    const spies = spyConsole();
    await sendEmail(
      { to: "Admin@Example.com", subject: "Emne", text: "x", logLine },
      undefined,
      env,
    );
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(() => JSON.parse(line)).toThrow();
  });

  it("4c. server_log nekter alle andre mottakere og skriver ingenting", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail({ to: "annen@example.com", subject: "Emne", text: "x", logLine }, undefined, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("4d. server_log nekter når SEED_ADMIN_EMAIL mangler", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail({ to: "admin@example.com", subject: "Emne", text: "x", logLine }, undefined, {
        ...env,
        SEED_ADMIN_EMAIL: undefined,
      }),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("4e. server_log nekter når logLine mangler", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail({ to: "admin@example.com", subject: "Emne", text: "x" }, undefined, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("4f. server_log skriver aldri hele e-posten", async () => {
    const spies = spyConsole();
    await sendEmail(
      {
        to: "admin@example.com",
        subject: "Emne",
        text: "Koden din er: 999999 (sendt til admin@example.com)",
        logLine,
      },
      undefined,
      env,
    );
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).not.toContain("999999");
    expect(line).not.toContain("Emne");
  });
});

describe("8.2 e-post gjennom en tilkobling", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const ADMIN_EMAIL = { to: "admin@example.com", subject: "Emne", text: "x", logLine };
  const OTHER_EMAIL = { to: "annen@example.com", subject: "Emne", text: "x", logLine };

  async function connectionRow(id: string) {
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    if (!row) throw new Error("fant ikke tilkoblingen i testen");
    return row;
  }

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  it("1. suksess setter last_ok_at, nullstiller last_error og setter active", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      status: "error",
      lastError: "gammel feil",
    });

    const before = Date.now();
    await sendEmail(ADMIN_EMAIL, { organizationId: orgA.id }, env);
    const after = Date.now();

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("active");
    expect(updated.lastError).toBeNull();
    expect(updated.lastOkAt).not.toBeNull();
    expect(updated.lastOkAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(updated.lastOkAt!.getTime()).toBeLessThanOrEqual(after + 1000);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("2. feil setter last_error og error, last_ok_at uendret", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    const lastOkAt = new Date("2026-11-01T10:00:00.000Z");
    const row = await createIntegrationConnection(orgA.id, { lastOkAt });

    await expect(sendEmail(OTHER_EMAIL, { organizationId: orgA.id }, env)).rejects.toThrow(
      NOT_CONFIGURED,
    );

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("error");
    expect(updated.lastError).toBeTruthy();
    expect(updated.lastError).not.toContain("annen@example.com");
    expect(updated.lastOkAt?.toISOString()).toBe(lastOkAt.toISOString());
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("3. last_error er vasket og høyst 500 tegn", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "ORG_HEMMELIGHET",
      settings: ORG_SETTINGS,
    });
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const { fetchFn } = fakeFetch({
      token: new Error(
        `til a@example.com kode 123456 client_secret=${SECRET} +47 912 34 567` + "x".repeat(2000),
      ),
    });

    await expect(
      sendEmail(
        { to: "a@example.com", subject: "Emne", text: "Hei" },
        { organizationId: orgA.id, fetchFn },
        env,
      ),
    ).rejects.toBeInstanceOf(Error);

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("error");
    expect(updated.lastError).toBeTruthy();
    for (const text of ["a@example.com", SECRET, ORG_SECRET, "+47 912 34 567", "912 34 567"]) {
      expect(updated.lastError).not.toContain(text);
    }
    expect(updated.lastError!.length).toBeLessThanOrEqual(500);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("4. svikt før sending teller: hemmelighet som mangler gir error med navnet, aldri verdi", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "FINNES_IKKE",
      settings: ORG_SETTINGS,
    });
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const { fetchFn, calls } = fakeFetch();

    const error = await rejection(
      sendEmail(
        { to: "a@example.com", subject: "Emne", text: "Hei" },
        { organizationId: orgA.id, fetchFn },
        env,
      ),
    );
    expect(error).toBeInstanceOf(SecretNotFoundError);

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("error");
    expect(updated.lastError).toContain("FINNES_IKKE");
    expect(updated.lastError).not.toContain(SECRET);
    expect(updated.lastError).not.toContain(ORG_SECRET);
    expect(calls).toHaveLength(0);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("5. systemets egne skrivinger gir ingen rad i revisjonsloggen", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    await createIntegrationConnection(orgA.id, { status: "error", lastError: "gammel feil" });

    await sendEmail(ADMIN_EMAIL, { organizationId: orgA.id }, env);
    await expect(sendEmail(OTHER_EMAIL, { organizationId: orgA.id }, env)).rejects.toThrow();
    await sendEmail(ADMIN_EMAIL, { organizationId: orgA.id }, env);

    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("6a. systemvalget uten tilkobling skriver ingenting til tabellen", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    await sendEmail(ADMIN_EMAIL, { organizationId: orgA.id }, env);
    expect(await db.select().from(integrationConnections)).toEqual([]);
  });

  it("6b. disabled tilkobling røres ikke (systemvalget brukes)", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      status: "disabled",
      lastError: "gammel feil",
    });
    const before = await connectionRow(row.id);

    await sendEmail(ADMIN_EMAIL, { organizationId: orgA.id }, env);
    await expect(sendEmail(OTHER_EMAIL, { organizationId: orgA.id }, env)).rejects.toThrow();

    expect(await connectionRow(row.id)).toEqual(before);
  });

  it("7. DEV_MAILBOX skriver ingenting til tabellen, e-posten ligger i postkassen", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "ORG_HEMMELIGHET",
      settings: ORG_SETTINGS,
    });
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const before = await connectionRow(row.id);
    const { fetchFn, calls } = fakeFetch();

    await sendEmail(
      { to: "a@example.com", subject: "Postkasse 8.2.7", text: "x" },
      { organizationId: orgA.id, fetchFn },
      { ...env, DEV_MAILBOX: true },
    );

    expect(await connectionRow(row.id)).toEqual(before);
    expect(calls).toHaveLength(0);
    expect(readDevMailbox()[0]).toMatchObject({ subject: "Postkasse 8.2.7" });
  });

  it("8. feilen kastes videre etter at raden er oppdatert", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "ORG_HEMMELIGHET",
      settings: ORG_SETTINGS,
    });
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    const { fetchFn } = fakeFetch({ send: { status: 403, body: "{}" } });

    const error = await rejection(
      sendEmail(
        { to: "a@example.com", subject: "Emne", text: "Hei" },
        { organizationId: orgA.id, fetchFn },
        env,
      ),
    );
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).statusCode).toBe(403);

    // Ikke først ved neste kall: raden er alt oppdatert
    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("error");
    expect(updated.lastError).toBeTruthy();
  });

  it("9. B sin rad røres ikke når A feiler", async () => {
    spyConsole();
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await createIntegrationConnection(orgA.id);
    const rowB = await createIntegrationConnection(orgB.id);
    const beforeB = await connectionRow(rowB.id);

    await expect(sendEmail(OTHER_EMAIL, { organizationId: orgA.id }, env)).rejects.toThrow();

    const afterB = await connectionRow(rowB.id);
    expect(afterB.status).toBe("active");
    expect(afterB.lastError).toBeNull();
    expect(afterB).toEqual(beforeB);
  });

  // 8.2.10 (fetch aldri kalt) sjekkes i afterEach for hele filen.

  async function brokenSettingsConnection() {
    const orgA = await createOrganization("Organisasjon A");
    const admin = await createUser({ name: "Admin A" });
    await createEmployee(admin, orgA.id, ["admin"]);
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "ORG_HEMMELIGHET",
      settings: {},
    });
    vi.stubEnv("ORG_HEMMELIGHET", ORG_SECRET);
    return { orgA, admin, row };
  }

  it("11. ugyldige settings på raden teller som feil", async () => {
    const { orgA, row } = await brokenSettingsConnection();
    const { fetchFn, calls } = fakeFetch();

    await expect(
      sendEmail(
        { to: "a@example.com", subject: "Emne", text: "Hei" },
        { organizationId: orgA.id, fetchFn },
        env,
      ),
    ).rejects.toBeInstanceOf(Error);

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("error");
    expect(updated.lastError).toBeTruthy();
    expect(updated.lastError).not.toContain(ORG_SECRET);
    expect(calls).toHaveLength(0);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("12. ny sending etter at admin har rettet settings lykkes; loggen har bare admins update", async () => {
    const { orgA, admin, row } = await brokenSettingsConnection();
    const broken = fakeFetch();
    await expect(
      sendEmail(
        { to: "a@example.com", subject: "Emne", text: "Hei" },
        { organizationId: orgA.id, fetchFn: broken.fetchFn },
        env,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect((await connectionRow(row.id)).status).toBe("error");

    await updateConnection(admin, orgA.id, row.id, { settings: ORG_SETTINGS });

    const { fetchFn, calls } = fakeFetch();
    await sendEmail(
      { to: "a@example.com", subject: "Emne", text: "Hei" },
      { organizationId: orgA.id, fetchFn },
      env,
    );
    expect(calls.map((call) => call.kind)).toEqual(["token", "send"]);
    expect(calls[0]!.body).toContain(`client_secret=${ORG_SECRET}`);

    const updated = await connectionRow(row.id);
    expect(updated.status).toBe("active");
    expect(updated.lastError).toBeNull();
    expect(updated.lastOkAt).not.toBeNull();
    const audit = await auditRows(orgA.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "integration_connection", action: "update" });
  });
});
