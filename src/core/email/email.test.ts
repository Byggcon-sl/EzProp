import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache, type Env } from "@/shared/config/env";
import { emailTransport, readDevMailbox, sendEmail } from "./index";

const graphValues = {
  MS_GRAPH_TENANT_ID: "t",
  MS_GRAPH_CLIENT_ID: "c",
  MS_GRAPH_CLIENT_SECRET: "s",
  MAIL_FROM: "noreply@example.com",
};
const env = { DEV_MAILBOX: false, SEED_ADMIN_EMAIL: "admin@example.com" } as Env;
const logLine = "Engangskode til første admin: 123456 (gyldig i 10 minutter)";
const NOT_CONFIGURED =
  "E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("e-post", () => {
  it("bruker utviklings-postkassen i test, og viser nyeste først", async () => {
    expect(emailTransport()).toBe("devMailbox");
    await sendEmail({ to: "a@example.com", subject: "Første", text: "x" });
    await sendEmail({ to: "b@example.com", subject: "Andre", text: "y" });
    const [latest] = readDevMailbox();
    expect(latest).toMatchObject({ to: "b@example.com", subject: "Andre" });
  });

  it("velger tjeneste ut fra innstillingene", () => {
    expect(emailTransport(env)).toBe("serverLog");
    expect(emailTransport({ ...env, ...graphValues })).toBe("graph");
  });

  it("velger devMailbox når DEV_MAILBOX er på", () => {
    expect(emailTransport({ ...env, DEV_MAILBOX: true })).toBe("devMailbox");
    expect(emailTransport({ ...env, ...graphValues, DEV_MAILBOX: true })).toBe("devMailbox");
  });

  it("postkassen vinner lokalt også når alle fire Microsoft 365-verdier er satt", () => {
    vi.stubEnv("MS_GRAPH_TENANT_ID", "t");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "c");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "s");
    vi.stubEnv("MAIL_FROM", "noreply@example.com");
    resetEnvCache();
    expect(emailTransport()).toBe("devMailbox");
  });

  it("velger graph når alle fire Microsoft 365-verdier er satt", () => {
    expect(emailTransport({ ...env, ...graphValues, DEV_MAILBOX: false })).toBe("graph");
  });

  it("velger serverLog når e-post ikke er satt opp", () => {
    expect(emailTransport({ ...env, DEV_MAILBOX: false })).toBe("serverLog");
  });

  it("graph kaster fortsatt feilen om fase 0b", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendEmail({ to: "admin@example.com", subject: "s", text: "t", logLine }, {
        ...env,
        ...graphValues,
      } as Env),
    ).rejects.toThrow(/fase 0b/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serverLog skriver koden for første admin, uten adressen", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendEmail(
      { to: "Admin@Example.com", subject: "Innlogging", text: "Koden din er 123456", logLine },
      env,
    );
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).toContain("[innlogging]");
    expect(line).toContain("docs/drift/testmiljo-azure.md");
    expect(line).not.toContain("@");
  });

  it("serverLog går ikke gjennom loggeren", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendEmail({ to: "admin@example.com", subject: "s", text: "t", logLine }, env);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain("[innlogging]");
    expect(() => JSON.parse(line)).toThrow();
  });

  it("serverLog nekter alle andre mottakere og skriver ingenting", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      sendEmail({ to: "annen@example.com", subject: "s", text: "t", logLine }, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(info).not.toHaveBeenCalled();
  });

  it("serverLog nekter når SEED_ADMIN_EMAIL mangler", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const withoutAdmin = { ...env, SEED_ADMIN_EMAIL: undefined } as Env;
    await expect(
      sendEmail({ to: "admin@example.com", subject: "s", text: "t", logLine }, withoutAdmin),
    ).rejects.toThrow(NOT_CONFIGURED);
    await expect(
      sendEmail({ to: "", subject: "s", text: "t", logLine }, withoutAdmin),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(info).not.toHaveBeenCalled();
  });

  it("serverLog nekter når logLine mangler", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      sendEmail({ to: "admin@example.com", subject: "s", text: "Koden din er 123456" }, env),
    ).rejects.toThrow(NOT_CONFIGURED);
    expect(info).not.toHaveBeenCalled();
  });

  it("serverLog skriver aldri hele e-posten", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendEmail(
      { to: "admin@example.com", subject: "Emnet", text: "Koden din er: 999999 …", logLine },
      env,
    );
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain("123456");
    expect(line).not.toContain("999999");
    expect(line).not.toContain("Emnet");
  });
});
