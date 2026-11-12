import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { findActiveConnection } from "./connections";
import {
  ConnectionValidationError,
  createConnection,
  listConnections,
  updateConnection,
  type CreateConnectionInput,
} from "./index";
import { PROVIDERS_BY_PORT, type IntegrationPort } from "./ports";
import { readSecret, RESERVED_SECRET_REFS } from "./secrets";

/*
 * Reservert hemmelighetsnavn (ADR 0008, testplan for Microsoft-innlogging M6.3):
 * `MS_LOGIN_CLIENT_SECRET` kan aldri være `secret_ref` på en tilkobling, for noen leverandør,
 * verken ved lagring, endring eller oppslag. Ellers kunne en rad sende innloggingshemmeligheten
 * til en annen adapter. Appen selv leser den fortsatt med `readSecret`.
 *
 * Støtter hovedmål de ansatte (innloggingen kan ikke lekke via en tilkobling) og KI i bunnen
 * (KI-porten kan aldri få innloggingshemmeligheten). Alle verdier er oppdiktet.
 */

const RESERVED = "MS_LOGIN_CLIENT_SECRET";
const SECRET_VALUE = "test-ms-login-secret";

/** Gyldige `settings` per leverandør, så det bare er hemmelighetsnavnet som prøves. */
const SETTINGS: Record<string, Record<string, unknown>> = {
  microsoft365: {
    from: "noreply@byggcon.example",
    tenantId: "t-oppdiktet",
    clientId: "c-oppdiktet",
  },
  anthropic: {
    model: "modell-oppdiktet",
    features: [],
    pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: "NOK" },
  },
};

const PROVIDERS: [IntegrationPort, string][] = Object.entries(PROVIDERS_BY_PORT).flatMap(
  ([port, providers]) =>
    providers.map((p): [IntegrationPort, string] => [port as IntegrationPort, p]),
);

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv(RESERVED, SECRET_VALUE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function admin(name = "Byggcon oppdiktet") {
  const org = await createOrganization(name);
  const user = await createUser({ name: "Admin Oppdiktet" });
  await createEmployee(user, org.id, ["admin"]);
  return { org, user };
}

describe("M6.3 reservert hemmelighetsnavn", () => {
  it("navnet står på den reserverte listen, og appen kan fortsatt lese det selv", () => {
    expect(RESERVED_SECRET_REFS).toContain(RESERVED);
    expect(readSecret(RESERVED)).toBe(SECRET_VALUE);
    expect(PROVIDERS.length).toBeGreaterThan(0);
  });

  it.each(PROVIDERS)(
    "lagring: %s/%s med MS_LOGIN_CLIENT_SECRET avvises uten rad",
    async (port, provider) => {
      const { org, user } = await admin();
      const input = {
        port,
        provider,
        secretRef: RESERVED,
        settings: SETTINGS[provider] ?? {},
      } as unknown as CreateConnectionInput;
      await expect(createConnection(user, org.id, input)).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await db.select().from(integrationConnections)).toHaveLength(0);
      expect(await auditRows(org.id)).toHaveLength(0);
    },
  );

  it.each(PROVIDERS)(
    "kontroll: %s/%s med et vanlig navn lagres (avvisningen over skyldes bare navnet)",
    async (port, provider) => {
      const { org, user } = await admin();
      const input = {
        port,
        provider,
        secretRef: provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ANNET_NAVN",
        settings: SETTINGS[provider] ?? {},
      } as unknown as CreateConnectionInput;
      await createConnection(user, org.id, input);
      expect(await db.select().from(integrationConnections)).toHaveLength(1);
    },
  );

  it.each(PROVIDERS)(
    "endring: %s/%s kan ikke få MS_LOGIN_CLIENT_SECRET",
    async (port, provider) => {
      const { org, user } = await admin();
      const row = await createIntegrationConnection(org.id, {
        port,
        provider,
        secretRef: provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ANNET_NAVN",
        settings: SETTINGS[provider] ?? {},
      });
      await expect(
        updateConnection(user, org.id, row.id, { secretRef: RESERVED }),
      ).rejects.toBeInstanceOf(ConnectionValidationError);
      const [after] = await db
        .select()
        .from(integrationConnections)
        .where(eq(integrationConnections.id, row.id));
      expect(after?.secretRef).not.toBe(RESERVED);
    },
  );

  it.each(PROVIDERS)(
    "oppslag: rad %s/%s satt inn direkte med MS_LOGIN_CLIENT_SECRET avvises",
    async (port, provider) => {
      const { org } = await admin();
      await createIntegrationConnection(org.id, {
        port,
        provider,
        secretRef: RESERVED,
        settings: SETTINGS[provider] ?? {},
      });
      await expect(findActiveConnection(org.id, port)).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
    },
  );

  it("feilmeldingen har aldri hemmeligheten", async () => {
    const { org } = await admin();
    await createIntegrationConnection(org.id, {
      port: "email",
      provider: "microsoft365",
      secretRef: RESERVED,
      settings: SETTINGS.microsoft365,
    });
    const error = await findActiveConnection(org.id, "email").catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain(SECRET_VALUE);
  });

  it("listen over tilkoblinger er fortsatt isolert per organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createIntegrationConnection(grantA.organizationId, {
          secretRef: "ANNET_NAVN",
        });
        const b = await createIntegrationConnection(grantB.organizationId, {
          secretRef: "ANNET_NAVN",
        });
        return { a: [a.id], b: [b.id] };
      },
      query: (actor, organizationId) => listConnections(actor, organizationId),
      idOf: (row) => row.id,
    });
  });
});
