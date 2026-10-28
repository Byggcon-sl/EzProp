import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache, type Env } from "@/shared/config/env";
import { emailTransport, readDevMailbox, sendEmail } from "./index";

/** Drift uten e-post: ingen postkasse, ingen Microsoft 365. Oppdiktede verdier. */
const env = {
  DEV_MAILBOX: false,
  SEED_ADMIN_EMAIL: "admin@example.com",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "oppdiktet-hemmelighet-som-er-lang-nok-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
} as Env;

const graph = {
  MS_GRAPH_TENANT_ID: "t",
  MS_GRAPH_CLIENT_ID: "c",
  MS_GRAPH_CLIENT_SECRET: "s",
  MAIL_FROM: "noreply@example.com",
};

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("e-post", () => {
  it("bruker utviklings-postkassen i test, og viser nyeste først", async () => {
    spyConsole();
    expect(emailTransport()).toBe("devMailbox");
    await sendEmail({ to: "a@example.com", subject: "Første", text: "x" });
    await sendEmail({ to: "b@example.com", subject: "Andre", text: "y" });
    const [latest] = readDevMailbox();
    expect(latest).toMatchObject({ to: "b@example.com", subject: "Andre" });
  });

  it("velger tjeneste ut fra innstillingene", () => {
    expect(emailTransport(env)).toBe("serverLog");
    expect(emailTransport({ ...env, ...graph })).toBe("graph");
  });

  it("velger devMailbox når DEV_MAILBOX er på", () => {
    expect(emailTransport({ ...env, DEV_MAILBOX: true })).toBe("devMailbox");
    expect(emailTransport({ ...env, ...graph, DEV_MAILBOX: true })).toBe("devMailbox");
  });

  it("postkassen vinner lokalt også når alle fire Microsoft 365-verdier er satt i miljøet", () => {
    vi.stubEnv("MS_GRAPH_TENANT_ID", "t");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "c");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "s");
    vi.stubEnv("MAIL_FROM", "noreply@example.com");
    resetEnvCache();
    expect(emailTransport()).toBe("devMailbox");
  });

  it("velger graph når alle fire Microsoft 365-verdier er satt", () => {
    expect(emailTransport({ ...env, ...graph })).toBe("graph");
  });

  it("velger serverLog når e-post ikke er satt opp", () => {
    expect(emailTransport(env)).toBe("serverLog");
  });

  it("graph kaster fortsatt feilen om fase 0b", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Ingen nett i tester"));
    await expect(
      sendEmail({ to: "a@example.com", subject: "Emne", text: "x", logLine }, { ...env, ...graph }),
    ).rejects.toThrow(/fase 0b/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serverLog skriver koden for første admin, uten adressen", async () => {
    const spies = spyConsole();
    await sendEmail({ to: "Admin@Example.com", subject: "Emne", text: "x", logLine }, env);
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).toContain("[innlogging]");
    expect(line).toContain("docs/drift/testmiljo-azure.md");
    expect(line).not.toContain("@");
  });

  it("serverLog går ikke gjennom loggeren", async () => {
    const spies = spyConsole();
    await sendEmail({ to: "Admin@Example.com", subject: "Emne", text: "x", logLine }, env);
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(() => JSON.parse(line)).toThrow();
  });

  it("serverLog nekter alle andre mottakere og skriver ingenting", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail({ to: "annen@example.com", subject: "Emne", text: "x", logLine }, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("serverLog nekter når SEED_ADMIN_EMAIL mangler", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail(
        { to: "admin@example.com", subject: "Emne", text: "x", logLine },
        { ...env, SEED_ADMIN_EMAIL: undefined },
      ),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("serverLog nekter når logLine mangler", async () => {
    const spies = spyConsole();
    await expect(
      sendEmail({ to: "admin@example.com", subject: "Emne", text: "x" }, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("serverLog skriver aldri hele e-posten", async () => {
    const spies = spyConsole();
    await sendEmail(
      {
        to: "admin@example.com",
        subject: "Emne",
        text: "Koden din er: 999999 (sendt til admin@example.com)",
        logLine,
      },
      env,
    );
    expect(spies.info).toHaveBeenCalledTimes(1);
    const line = String(spies.info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).not.toContain("999999");
    expect(line).not.toContain("Emne");
  });
});
