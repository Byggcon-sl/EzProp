import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { sendEmail } from "@/core/email";
import { resolveEmailSender } from "@/core/email/resolve";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import type { Env } from "@/shared/config/env";
import { scrubText } from "@/shared/lib/logger";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { findActiveConnection } from "./connections";
import {
  ConnectionNotFoundError,
  ConnectionValidationError,
  createConnection,
  InvalidSecretRefError,
  listConnections,
  markConnectionDeleted,
  readSecret,
  SecretNotFoundError,
  updateConnection,
} from "./index";

/*
 * Utviklerens egne tester av tilkoblingslaget og e-postporten. Testskriverens fulle tester
 * følger testplanen docs/funksjoner/fase0b-tilkoblingslag-testplan.md. Alt er oppdiktet; ingen
 * kall går ut på nettet (falsk `fetchFn`).
 */

const SECRET_NAME = "EZ_TEST_GRAPH_SECRET";
const SECRET_VALUE = "hemmelig-test-verdi";
const M365 = { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" };

const env = {
  DEV_MAILBOX: false,
  SEED_ADMIN_EMAIL: "admin@example.com",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "oppdiktet-hemmelighet-som-er-lang-nok-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
} as Env;

function okFetch() {
  return vi.fn<typeof fetch>(async (input) =>
    String(input).includes("/token")
      ? new Response(JSON.stringify({ access_token: "tok" }), { status: 200 })
      : new Response(null, { status: 202 }),
  );
}

async function adminIn(name: string) {
  const org = await createOrganization(name);
  const user = await createUser({ name: `Admin ${name}` });
  await createEmployee(user, org.id, ["admin"]);
  return { org, user };
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("tilkoblinger", () => {
  it("listConnections holder organisasjonene fra hverandre", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await db
          .insert(integrationConnections)
          .values({ organizationId: grantA.organizationId, port: "email", provider: "server_log" })
          .returning();
        const b = await db
          .insert(integrationConnections)
          .values({ organizationId: grantB.organizationId, port: "email", provider: "server_log" })
          .returning();
        return { a: a.map((r) => r.id), b: b.map((r) => r.id) };
      },
      query: (actor, organizationId) => listConnections(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("findActiveConnection holder organisasjonene fra hverandre", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const rows = await db
          .insert(integrationConnections)
          .values([
            { organizationId: grantA.organizationId, port: "email", provider: "server_log" },
            { organizationId: grantB.organizationId, port: "email", provider: "server_log" },
          ])
          .returning();
        return { a: [rows[0]!.id], b: [rows[1]!.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const row = await findActiveConnection(grant.organizationId, "email");
        return row ? [row] : [];
      },
      idOf: (row) => row.id,
    });
  });

  it("lager, endrer og sletter med revisjonslogg uten verdier fra settings", async () => {
    const { org, user } = await adminIn("A");
    const created = await createConnection(user, org.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: SECRET_NAME,
      settings: M365,
    });
    expect(Object.keys(created).sort()).toEqual(
      ["id", "lastError", "lastOkAt", "port", "provider", "secretRef", "settings", "status"].sort(),
    );
    expect(created.status).toBe("active");

    await expect(
      createConnection(user, org.id, { port: "email", provider: "server_log" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);

    // Ingen endring gir ingen loggrad
    await updateConnection(user, org.id, created.id, { settings: M365 });
    await updateConnection(user, org.id, created.id, {
      status: "disabled",
      settings: { ...M365, from: "ny@example.com" },
    });
    await expect(
      updateConnection(user, org.id, created.id, { secretRef: null }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    await markConnectionDeleted(user, org.id, created.id);

    const audit = await auditRows(org.id);
    expect(audit.map((r) => r.action).sort()).toEqual(["create", "delete", "update"]);
    const update = audit.find((r) => r.action === "update")!;
    expect(update.changes).toEqual({
      status: { from: "active", to: "disabled" },
      settings: { keys: ["from"] },
    });
    const all = JSON.stringify(audit);
    for (const value of ["noreply@example.com", "ny@example.com", "t-oppdiktet", "c-oppdiktet"]) {
      expect(all).not.toContain(value);
    }
    expect(await listConnections(user, org.id)).toEqual([]);
  });

  it("avviser ukjent leverandør, ugyldig hemmelighetsnavn og nektlisten", async () => {
    const { org, user } = await adminIn("A");
    for (const input of [
      { port: "sms", provider: "server_log" },
      { port: "email", provider: "microsoft365", settings: M365 },
      { port: "email", provider: "microsoft365", secretRef: "ikke-gyldig", settings: M365 },
      { port: "email", provider: "microsoft365", secretRef: "DATABASE_URL", settings: M365 },
      { port: "email", provider: "server_log", settings: { from: "x" } },
    ]) {
      await expect(createConnection(user, org.id, input)).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
    }
    expect(await listConnections(user, org.id)).toEqual([]);
  });

  it("fremmed id og andres organisasjon gir feil og endrer ingenting", async () => {
    const a = await adminIn("A");
    const b = await adminIn("B");
    const own = await createConnection(b.user, b.org.id, { port: "email", provider: "server_log" });
    await expect(
      updateConnection(a.user, a.org.id, own.id, { status: "disabled" }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    await expect(markConnectionDeleted(a.user, b.org.id, own.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      updateConnection(a.user, a.org.id, "ikke-uuid", { status: "disabled" }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect((await listConnections(b.user, b.org.id))[0]!.status).toBe("active");
  });
});

describe("hemmeligheter", () => {
  it("leser bare gyldige navn, og verdien står aldri i feilen", () => {
    vi.stubEnv(SECRET_NAME, SECRET_VALUE);
    expect(readSecret(SECRET_NAME)).toBe(SECRET_VALUE);
    expect(() => readSecret("BETTER_AUTH_SECRET")).toThrow(InvalidSecretRefError);
    expect(() => readSecret("lite")).toThrow(InvalidSecretRefError);
    expect(() => readSecret("FINNES_IKKE_HER")).toThrow(SecretNotFoundError);
  });

  it("loggeren vasker client_secret, men ikke client_secret_name", () => {
    expect(scrubText("a=1&client_secret=abc&b=2")).toBe("a=1&client_secret=[fjernet]&b=2");
    expect(scrubText("client_secret_name=X")).toBe("client_secret_name=X");
  });
});

describe("e-postporten gjennom laget", () => {
  it("tabell → Microsoft 365 med falsk fetch, og last_ok_at settes", async () => {
    vi.stubEnv(SECRET_NAME, SECRET_VALUE);
    const { org, user } = await adminIn("A");
    const created = await createConnection(user, org.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: SECRET_NAME,
      settings: M365,
    });
    const fetchFn = okFetch();
    await sendEmail(
      { to: "mottaker@example.com", subject: "Emne", text: "x" },
      { organizationId: org.id, fetchFn },
      env,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, created.id));
    expect(row!.lastOkAt).not.toBeNull();
    expect(row!.status).toBe("active");
    expect(await auditRows(org.id)).toHaveLength(1);
  });

  it("manglende hemmelighet markerer tilkoblingen med error, uten verdier", async () => {
    const { org, user } = await adminIn("A");
    const created = await createConnection(user, org.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: "FINNES_IKKE_HER",
      settings: M365,
    });
    const fetchFn = okFetch();
    await expect(
      sendEmail(
        { to: "mottaker@example.com", subject: "Emne", text: "x" },
        { organizationId: org.id, fetchFn },
        env,
      ),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(fetchFn).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, created.id));
    expect(row!.status).toBe("error");
    expect(row!.lastError).toContain("FINNES_IKKE_HER");
  });

  it("systemvalget: Microsoft 365 fra miljøet leser hemmeligheten bare ved sending", async () => {
    const fetchFn = okFetch();
    const graphEnv = {
      ...env,
      MS_GRAPH_TENANT_ID: "t-oppdiktet",
      MS_GRAPH_CLIENT_ID: "c-oppdiktet",
      MAIL_FROM: "noreply@example.com",
    } as Env;
    const resolved = await resolveEmailSender({ fetchFn }, graphEnv);
    expect(resolved.sender.provider).toBe("microsoft365");
    expect(resolved.connectionId).toBeNull();
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "");
    await expect(
      resolved.sender.send({ to: "a@example.com", subject: "s", text: "t" }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(fetchFn).not.toHaveBeenCalled();

    const none = await resolveEmailSender({}, env);
    expect(none.sender.provider).toBe("server_log");
    const dev = await resolveEmailSender({}, { ...graphEnv, DEV_MAILBOX: true });
    expect(dev.sender.provider).toBe("dev_mailbox");
  });
});
