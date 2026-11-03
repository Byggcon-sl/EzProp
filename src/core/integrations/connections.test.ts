import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, integrationConnections, organizations, type EmployeeRole } from "@/db/schema";
import { formatLogLine, logger } from "@/shared/lib/logger";
import {
  auditRows,
  createEmployee,
  createIntegrationConnection,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { findActiveConnection, recordConnectionResult } from "./connections";
import {
  ConnectionNotFoundError,
  ConnectionValidationError,
  createConnection,
  listConnections,
  markConnectionDeleted,
  updateConnection,
  type CreateConnectionInput,
  type UpdateConnectionInput,
} from "./index";

/*
 * Tjenesten for tilkoblinger, testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md
 * avsnitt 3. Støtter hovedmål: reklamasjoner (bare admin endrer tilkoblinger, hver endring står
 * i revisjonsloggen, og en organisasjon ser aldri en annens tilkobling), tid (ett lag for alle
 * senere tilkoblinger) og KI først (porten `ai` får samme tilgang og samme hemmelighetsregler).
 * Fasiten er skrevet inn her. Alle verdier er oppdiktet; hemmeligheter bare via `vi.stubEnv`.
 */

const SECRET = "hemmelig-test-verdi";
const M365 = { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" };
const M365_INPUT = {
  port: "email",
  provider: "microsoft365",
  secretRef: "MS_GRAPH_CLIENT_SECRET",
  settings: M365,
};
const SUMMARY_KEYS = [
  "id",
  "lastError",
  "lastOkAt",
  "port",
  "provider",
  "secretRef",
  "settings",
  "status",
];
const DENYLIST = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "POWERSYNC_JWT_SECRET",
  "FILE_STORAGE_AZURE_CONNECTION_STRING",
];

beforeEach(async () => {
  await resetDatabase();
  // Miljøet har hemmeligheten; den skal aldri havne i liste, feil eller revisjonslogg
  vi.stubEnv("MS_GRAPH_CLIENT_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Lar testene sende inn feil former (det er det som prøves). */
function create(actor: Actor, organizationId: string, input: Record<string, unknown>) {
  return createConnection(actor, organizationId, input as unknown as CreateConnectionInput);
}

function update(
  actor: Actor,
  organizationId: string,
  connectionId: string,
  input: Record<string, unknown>,
) {
  return updateConnection(
    actor,
    organizationId,
    connectionId,
    input as unknown as UpdateConnectionInput,
  );
}

async function allRows() {
  return db.select().from(integrationConnections);
}

async function rowCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(integrationConnections);
  return row?.n ?? 0;
}

async function rowById(id: string) {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  if (!row) throw new Error("fant ikke tilkoblingen i testen");
  return row;
}

async function addEmployee(organizationId: string, roles: EmployeeRole[], name: string) {
  const user = await createUser({ name });
  const employee = await createEmployee(user, organizationId, roles);
  return { user, employee };
}

/** A med admin, takstmann, kontor og leder; B med admin. */
async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const adminA = await addEmployee(orgA.id, ["admin"], "Admin A");
  const inspectorA = await addEmployee(orgA.id, ["inspector"], "Takstmann A");
  const officeA = await addEmployee(orgA.id, ["office"], "Kontor A");
  const managerA = await addEmployee(orgA.id, ["manager"], "Leder A");
  const adminB = await addEmployee(orgB.id, ["admin"], "Admin B");
  return { orgA, orgB, adminA, inspectorA, officeA, managerA, adminB };
}

describe("3.1 opprette", () => {
  it("1. e-post via Microsoft 365: rad i A, active, tomme tidspunkt, laget av admin", async () => {
    const { orgA, adminA } = await setup();
    const created = await create(adminA.user, orgA.id, M365_INPUT);

    const row = await rowById(created.id);
    expect(row.organizationId).toBe(orgA.id);
    expect(row.port).toBe("email");
    expect(row.provider).toBe("microsoft365");
    expect(row.status).toBe("active");
    expect(row.secretRef).toBe("MS_GRAPH_CLIENT_SECRET");
    expect(row.settings).toEqual(M365);
    expect(row.lastOkAt).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.createdBy).toBe(adminA.employee.id);
    expect(row.rowVersion).toBe(1);
    expect(row.deletedAt).toBeNull();
  });

  it.each([
    ["server_log", { settings: {} }],
    ["server_log", {}],
    ["dev_mailbox", { settings: {} }],
    ["dev_mailbox", {}],
  ])("2. %s uten secretRef og med tomme settings (%j) godtas", async (provider, extra) => {
    const { orgA, adminA } = await setup();
    const created = await create(adminA.user, orgA.id, { port: "email", provider, ...extra });
    const row = await rowById(created.id);
    expect(row.provider).toBe(provider);
    expect(row.secretRef).toBeNull();
    expect(row.settings).toEqual({});
    expect(row.status).toBe("active");
  });

  it("3. createConnection gir nøyaktig feltene i ConnectionSummary, ingen sporingsfelt", async () => {
    const { orgA, adminA } = await setup();
    const created = await create(adminA.user, orgA.id, M365_INPUT);
    expect(Object.keys(created).sort()).toEqual(SUMMARY_KEYS);
    expect(created).toMatchObject({
      port: "email",
      provider: "microsoft365",
      status: "active",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
      lastOkAt: null,
      lastError: null,
    });
    expect(JSON.stringify(created)).not.toContain(SECRET);
  });
});

describe("3.2 validering før skriving", () => {
  const without = (key: keyof typeof M365) => {
    const settings: Record<string, string> = { ...M365 };
    delete settings[key];
    return settings;
  };

  const cases: [string, Record<string, unknown>][] = [
    ["1. ukjent port fax", { port: "fax", provider: "server_log", settings: {} }],
    ["1. tom port", { port: "", provider: "server_log", settings: {} }],
    ["2. ukjent leverandør sendgrid på email", { port: "email", provider: "sendgrid" }],
    [
      "3. microsoft365 på accounting",
      {
        port: "accounting",
        provider: "microsoft365",
        secretRef: "MS_GRAPH_CLIENT_SECRET",
        settings: M365,
      },
    ],
    ["3. server_log på accounting", { port: "accounting", provider: "server_log", settings: {} }],
    ...["a=b", "ms graph", "lowercase", "hemmelig-test-verdi=abc", "", "A"].map(
      (secretRef): [string, Record<string, unknown>] => [
        `4. ugyldig secretRef ${JSON.stringify(secretRef)}`,
        { ...M365_INPUT, secretRef },
      ],
    ),
    [
      "5. ukjent nøkkel sandbox for microsoft365",
      { ...M365_INPUT, settings: { ...M365, sandbox: true } },
    ],
    [
      "5. ukjent nøkkel x for server_log",
      { port: "email", provider: "server_log", settings: { x: 1 } },
    ],
    ["6. microsoft365 uten secretRef", { port: "email", provider: "microsoft365", settings: M365 }],
    ["6. microsoft365 med secretRef null", { ...M365_INPUT, secretRef: null }],
    ["6. microsoft365 uten from", { ...M365_INPUT, settings: without("from") }],
    ["6. microsoft365 uten tenantId", { ...M365_INPUT, settings: without("tenantId") }],
    ["6. microsoft365 uten clientId", { ...M365_INPUT, settings: without("clientId") }],
    [
      "6. microsoft365 uten settings",
      { port: "email", provider: "microsoft365", secretRef: "MS_GRAPH_CLIENT_SECRET" },
    ],
    ["6. tom from", { ...M365_INPUT, settings: { ...M365, from: "" } }],
    ["6. tom tenantId", { ...M365_INPUT, settings: { ...M365, tenantId: "" } }],
    ["6. tom clientId", { ...M365_INPUT, settings: { ...M365, clientId: "" } }],
    ["7. tenantId t/oppdiktet", { ...M365_INPUT, settings: { ...M365, tenantId: "t/oppdiktet" } }],
    ["7. tenantId med mellomrom", { ...M365_INPUT, settings: { ...M365, tenantId: "a b" } }],
    ["7. tenantId på 65 tegn", { ...M365_INPUT, settings: { ...M365, tenantId: "t".repeat(65) } }],
    ["7. from ikke-en-adresse", { ...M365_INPUT, settings: { ...M365, from: "ikke-en-adresse" } }],
    ["7. from uten toppdomene", { ...M365_INPUT, settings: { ...M365, from: "a@b" } }],
    [
      "x. clientId på 129 tegn",
      { ...M365_INPUT, settings: { ...M365, clientId: "c".repeat(129) } },
    ],
    [
      "x. from på 255 tegn",
      { ...M365_INPUT, settings: { ...M365, from: "a".repeat(243) + "@example.com" } },
    ],
    ...DENYLIST.map((secretRef): [string, Record<string, unknown>] => [
      `8. nektlisten: ${secretRef}`,
      { ...M365_INPUT, secretRef },
    ]),
    ...DENYLIST.map((secretRef): [string, Record<string, unknown>] => [
      `8. nektlisten på server_log: ${secretRef}`,
      { port: "email", provider: "server_log", secretRef, settings: {} },
    ]),
  ];

  it.each(cases)(
    "%s: ConnectionValidationError, ingen rad, ingen loggrad (10)",
    async (_name, input) => {
      const { orgA, adminA } = await setup();
      await expect(create(adminA.user, orgA.id, input)).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await allRows()).toEqual([]);
      expect(await auditRows(orgA.id)).toEqual([]);
    },
  );

  it("y. clientId på 128 tegn og from på 254 tegn godtas (grensen er nøyaktig 128/254)", async () => {
    const { orgA, adminA } = await setup();
    const settings = { ...M365, clientId: "c".repeat(128), from: "a".repeat(242) + "@example.com" };
    expect(settings.from).toHaveLength(254);
    const created = await create(adminA.user, orgA.id, { ...M365_INPUT, settings });
    expect((await rowById(created.id)).settings).toEqual(settings);
  });

  it("4. feilmeldingen gjentar ikke en innlimt verdi", async () => {
    const { orgA, adminA } = await setup();
    const error = await create(adminA.user, orgA.id, {
      ...M365_INPUT,
      secretRef: `${SECRET}=abc`,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConnectionValidationError);
    expect(String(error)).not.toContain(SECRET);
  });

  it.each(["dev_mailbox", "server_log"])(
    "9. %s med secretRef satt godtas (navnet skader ikke)",
    async (provider) => {
      const { orgA, adminA } = await setup();
      const created = await create(adminA.user, orgA.id, {
        port: "email",
        provider,
        secretRef: "ANNET_NAVN",
        settings: {},
      });
      expect((await rowById(created.id)).secretRef).toBe("ANNET_NAVN");
    },
  );
});

describe("3.3 unikhet: én per organisasjon og port blant rader som ikke er slettet", () => {
  it("1. to for samme port avvises; fortsatt én rad og én loggrad", async () => {
    const { orgA, adminA } = await setup();
    await create(adminA.user, orgA.id, { port: "email", provider: "server_log" });
    await expect(
      create(adminA.user, orgA.id, { port: "email", provider: "dev_mailbox" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await rowCount()).toBe(1);
    expect(await auditRows(orgA.id)).toHaveLength(1);
  });

  it("2. en disabled rad sperrer også", async () => {
    const { orgA, adminA } = await setup();
    const first = await create(adminA.user, orgA.id, { port: "email", provider: "server_log" });
    await update(adminA.user, orgA.id, first.id, { status: "disabled" });
    await expect(
      create(adminA.user, orgA.id, { port: "email", provider: "dev_mailbox" }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    expect(await rowCount()).toBe(1);
  });

  it("3. etter myk sletting kan en ny lages; begge radene finnes", async () => {
    const { orgA, adminA } = await setup();
    const first = await create(adminA.user, orgA.id, { port: "email", provider: "server_log" });
    await markConnectionDeleted(adminA.user, orgA.id, first.id);
    const second = await create(adminA.user, orgA.id, M365_INPUT);

    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect((await rowById(first.id)).deletedAt).not.toBeNull();
    expect((await rowById(second.id)).deletedAt).toBeNull();
  });

  it("4. samme port i B påvirker ikke A", async () => {
    const { orgA, orgB, adminA, adminB } = await setup();
    await create(adminB.user, orgB.id, { port: "email", provider: "server_log" });
    const inA = await create(adminA.user, orgA.id, { port: "email", provider: "server_log" });
    expect((await rowById(inA.id)).organizationId).toBe(orgA.id);
  });

  it("5. databasen stopper en rå dublett; med deleted_at på den første godtas den andre", async () => {
    const { orgA, orgB } = await setup();
    await createIntegrationConnection(orgA.id);
    await expect(
      createIntegrationConnection(orgA.id, { provider: "dev_mailbox" }),
    ).rejects.toThrow();

    await createIntegrationConnection(orgB.id, { deletedAt: new Date(), deletedBy: "oppdiktet" });
    await createIntegrationConnection(orgB.id);
    expect((await allRows()).filter((row) => row.organizationId === orgB.id)).toHaveLength(2);
  });
});

describe("3.4 liste", () => {
  it("1. sortert på port (og leverandør)", async () => {
    // Unikheten gir én rad per port, så rekkefølgen mellom porter er det som kan vises
    const { orgA, adminA } = await setup();
    await createIntegrationConnection(orgA.id, { port: "email", provider: "server_log" });
    await createIntegrationConnection(orgA.id, { port: "sms", provider: "x" });
    await createIntegrationConnection(orgA.id, { port: "accounting", provider: "x" });

    const list = await listConnections(adminA.user, orgA.id);
    expect(list.map((row) => `${row.port}/${row.provider}`)).toEqual([
      "accounting/x",
      "email/server_log",
      "sms/x",
    ]);
  });

  it("2. slettede rader er borte, disabled og error er med", async () => {
    const { orgA, adminA } = await setup();
    const disabled = await createIntegrationConnection(orgA.id, { status: "disabled" });
    const failed = await createIntegrationConnection(orgA.id, {
      port: "accounting",
      provider: "x",
      status: "error",
    });
    await createIntegrationConnection(orgA.id, {
      port: "sms",
      provider: "x",
      deletedAt: new Date(),
      deletedBy: "oppdiktet",
    });

    const list = await listConnections(adminA.user, orgA.id);
    expect(list.map((row) => row.id).sort()).toEqual([disabled.id, failed.id].sort());
  });

  it("3. fast feltliste uten sporingsfelt", async () => {
    const { orgA, adminA } = await setup();
    await createIntegrationConnection(orgA.id);
    await createIntegrationConnection(orgA.id, { port: "accounting", provider: "x" });

    const list = await listConnections(adminA.user, orgA.id);
    expect(list).toHaveLength(2);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(SUMMARY_KEYS);
      const text = JSON.stringify(row);
      for (const field of ["createdBy", "rowVersion", "deletedAt", "organizationId"]) {
        expect(text).not.toContain(field);
      }
    }
  });

  it("4. secretRef er navnet, og verdien fra miljøet står aldri i listen", async () => {
    const { orgA, adminA } = await setup();
    await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });

    const list = await listConnections(adminA.user, orgA.id);
    expect(list[0]!.secretRef).toBe("MS_GRAPH_CLIENT_SECRET");
    expect(JSON.stringify(list)).not.toContain(SECRET);
  });
});

describe("3.5 oppdatere", () => {
  it("1. active → disabled → active; row_version øker per endring", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id);
    expect(row.rowVersion).toBe(1);

    const disabled = await update(adminA.user, orgA.id, row.id, { status: "disabled" });
    expect(disabled.status).toBe("disabled");
    expect((await rowById(row.id)).rowVersion).toBe(2);

    const active = await update(adminA.user, orgA.id, row.id, { status: "active" });
    expect(active.status).toBe("active");
    const after = await rowById(row.id);
    expect(after.status).toBe("active");
    expect(after.rowVersion).toBe(3);
  });

  it("2. status error fra admin avvises, raden uendret, ingen loggrad", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id);
    const before = await rowById(row.id);

    await expect(update(adminA.user, orgA.id, row.id, { status: "error" })).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
    expect(await rowById(row.id)).toEqual(before);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("3. fra error til active beholder last_error", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      status: "error",
      lastError: "gammel feil",
    });

    await update(adminA.user, orgA.id, row.id, { status: "active" });

    const after = await rowById(row.id);
    expect(after.status).toBe("active");
    expect(after.lastError).toBe("gammel feil");
  });

  it("4. secretRef byttes; ugyldig navn og nektlisten avvises uten endring og loggrad", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });

    await update(adminA.user, orgA.id, row.id, { secretRef: "ANNET_NAVN" });
    expect((await rowById(row.id)).secretRef).toBe("ANNET_NAVN");
    expect(await auditRows(orgA.id)).toHaveLength(1);

    const before = await rowById(row.id);
    for (const secretRef of ["a=b", "ms graph", "lowercase", "A", ...DENYLIST]) {
      await expect(
        update(adminA.user, orgA.id, row.id, { secretRef }),
        secretRef,
      ).rejects.toBeInstanceOf(ConnectionValidationError);
    }
    expect(await rowById(row.id)).toEqual(before);
    expect(await auditRows(orgA.id)).toHaveLength(1);
  });

  it("5. settings sjekkes mot leverandøren på raden, ikke fra skjemaet", async () => {
    const { orgA, orgB, adminA, adminB } = await setup();
    const m365 = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });
    // Én tilkobling per port, så server_log-raden ligger i B
    const serverLog = await createIntegrationConnection(orgB.id);

    await update(adminA.user, orgA.id, m365.id, { settings: { ...M365, from: "ny@example.com" } });
    expect((await rowById(m365.id)).settings).toEqual({ ...M365, from: "ny@example.com" });

    const m365Before = await rowById(m365.id);
    const serverLogBefore = await rowById(serverLog.id);
    const audit = (await auditRows(orgA.id)).length;
    const auditB = (await auditRows(orgB.id)).length;

    await expect(
      update(adminA.user, orgA.id, m365.id, { settings: { sandbox: true } }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    await expect(
      update(adminB.user, orgB.id, serverLog.id, { settings: { from: "x@example.com" } }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);
    // Skjemaet kan ikke lure tjenesten til å bruke en annen leverandør
    await expect(
      update(adminA.user, orgA.id, m365.id, { provider: "server_log", settings: {} }),
    ).rejects.toBeInstanceOf(ConnectionValidationError);

    expect(await rowById(m365.id)).toEqual(m365Before);
    expect(await rowById(serverLog.id)).toEqual(serverLogBefore);
    expect(await auditRows(orgA.id)).toHaveLength(audit);
    expect(await auditRows(orgB.id)).toHaveLength(auditB);
  });

  it("6. secretRef kan ikke fjernes for microsoft365, men for server_log", async () => {
    const { orgA, orgB, adminA, adminB } = await setup();
    const m365 = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });
    const serverLog = await createIntegrationConnection(orgB.id, { secretRef: "ANNET_NAVN" });
    const before = await rowById(m365.id);

    await expect(update(adminA.user, orgA.id, m365.id, { secretRef: null })).rejects.toBeInstanceOf(
      ConnectionValidationError,
    );
    expect(await rowById(m365.id)).toEqual(before);

    await update(adminB.user, orgB.id, serverLog.id, { secretRef: null });
    expect((await rowById(serverLog.id)).secretRef).toBeNull();
  });

  it.each([{ port: "sms" }, { provider: "server_log" }])(
    "7. port og leverandør kan ikke endres (%j)",
    async (input) => {
      const { orgA, adminA } = await setup();
      const row = await createIntegrationConnection(orgA.id, {
        provider: "microsoft365",
        secretRef: "MS_GRAPH_CLIENT_SECRET",
        settings: M365,
      });
      const before = await rowById(row.id);

      await expect(update(adminA.user, orgA.id, row.id, input)).rejects.toBeInstanceOf(
        ConnectionValidationError,
      );
      expect(await rowById(row.id)).toEqual(before);
      expect(await auditRows(orgA.id)).toEqual([]);
    },
  );

  it.each([{}, { status: "active" }])(
    "8. input som ikke endrer noe (%j): ingen loggrad, row_version uendret",
    async (input) => {
      const { orgA, adminA } = await setup();
      const row = await createIntegrationConnection(orgA.id);

      await update(adminA.user, orgA.id, row.id, input);

      const after = await rowById(row.id);
      expect(after.rowVersion).toBe(1);
      expect(after.status).toBe("active");
      expect(await auditRows(orgA.id)).toEqual([]);
    },
  );

  it("9. ukjent id, slettet rad og ikke-uuid gir ConnectionNotFoundError uten endring", async () => {
    const { orgA, adminA } = await setup();
    const deleted = await createIntegrationConnection(orgA.id, {
      deletedAt: new Date("2026-11-01T10:00:00.000Z"),
      deletedBy: "oppdiktet",
    });
    const before = await allRows();

    for (const id of [randomUUID(), deleted.id, "ikke-en-id"]) {
      await expect(
        update(adminA.user, orgA.id, id, { status: "disabled" }),
        id,
      ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    }
    expect(await allRows()).toEqual(before);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("10. id fra B gir ConnectionNotFoundError; B er fortsatt active, ingen loggrad", async () => {
    const { orgA, orgB, adminA } = await setup();
    const rowB = await createIntegrationConnection(orgB.id);
    const before = await rowById(rowB.id);

    await expect(
      update(adminA.user, orgA.id, rowB.id, { status: "disabled" }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);

    const after = await rowById(rowB.id);
    expect(after.status).toBe("active");
    expect(after).toEqual(before);
    expect(await auditRows(orgA.id)).toEqual([]);
    expect(await auditRows(orgB.id)).toEqual([]);
  });
});

describe("3.6 myk sletting", () => {
  it("1. merker deleted_at og deleted_by; raden finnes, men ikke i listen", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id);

    await markConnectionDeleted(adminA.user, orgA.id, row.id);

    const after = await rowById(row.id);
    expect(after.deletedAt).not.toBeNull();
    expect(after.deletedBy).toBe(adminA.employee.id);
    expect(await allRows()).toHaveLength(1);
    expect(await listConnections(adminA.user, orgA.id)).toEqual([]);
  });

  it("2. allerede slettet: ConnectionNotFoundError, deleted_at og deleted_by som før", async () => {
    const { orgA, adminA } = await setup();
    const deletedAt = new Date("2026-11-01T10:00:00.000Z");
    const row = await createIntegrationConnection(orgA.id, { deletedAt, deletedBy: "oppdiktet" });

    await expect(markConnectionDeleted(adminA.user, orgA.id, row.id)).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
    const after = await rowById(row.id);
    expect(after.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(after.deletedBy).toBe("oppdiktet");
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("3. id fra B og ikke-uuid: ConnectionNotFoundError, B urørt, ingen loggrad", async () => {
    const { orgA, orgB, adminA } = await setup();
    const rowB = await createIntegrationConnection(orgB.id);
    const before = await rowById(rowB.id);

    for (const id of [rowB.id, "ikke-en-id"]) {
      await expect(markConnectionDeleted(adminA.user, orgA.id, id), id).rejects.toBeInstanceOf(
        ConnectionNotFoundError,
      );
    }
    expect(await rowById(rowB.id)).toEqual(before);
    expect(await auditRows(orgA.id)).toEqual([]);
    expect(await auditRows(orgB.id)).toEqual([]);
  });
});

describe("3.7 revisjonslogg", () => {
  it("1. create: én rad med port, leverandør, navnet og nøklene i settings, aldri verdiene", async () => {
    const { orgA, adminA } = await setup();
    const created = await create(adminA.user, orgA.id, M365_INPUT);

    const rows = await auditRows(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "integration_connection",
      action: "create",
      entityId: created.id,
      organizationId: orgA.id,
      actorEmployeeId: adminA.employee.id,
    });
    expect(rows[0]!.changes).toMatchObject({
      port: "email",
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settingsKeys: expect.arrayContaining(["from", "tenantId", "clientId"]),
    });
    const text = JSON.stringify(rows[0]);
    for (const value of ["noreply@example.com", "t-oppdiktet", "c-oppdiktet", SECRET]) {
      expect(text).not.toContain(value);
    }
  });

  it("2. update: status fra/til, settings bare nøkkelen, secretRef gammelt og nytt navn", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });

    await update(adminA.user, orgA.id, row.id, { status: "disabled" });
    await update(adminA.user, orgA.id, row.id, { settings: { ...M365, from: "ny@example.com" } });
    await update(adminA.user, orgA.id, row.id, { secretRef: "ANNET_NAVN" });

    const rows = await auditRows(orgA.id);
    expect(rows).toHaveLength(3);
    for (const audit of rows) {
      expect(audit).toMatchObject({
        entityType: "integration_connection",
        action: "update",
        entityId: row.id,
        organizationId: orgA.id,
        actorEmployeeId: adminA.employee.id,
      });
    }
    const [status, settings, secretRef] = rows;
    expect(status!.changes.status).toEqual({ from: "active", to: "disabled" });
    expect(settings!.changes.settings).toEqual({ keys: ["from"] });
    expect(secretRef!.changes.secretRef).toEqual({
      from: "MS_GRAPH_CLIENT_SECRET",
      to: "ANNET_NAVN",
    });
    const text = JSON.stringify(rows);
    for (const value of [
      "noreply@example.com",
      "ny@example.com",
      "t-oppdiktet",
      "c-oppdiktet",
      SECRET,
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it("3. delete: én rad med action delete", async () => {
    const { orgA, adminA } = await setup();
    const row = await createIntegrationConnection(orgA.id);

    await markConnectionDeleted(adminA.user, orgA.id, row.id);

    const rows = await auditRows(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "integration_connection",
      action: "delete",
      entityId: row.id,
      organizationId: orgA.id,
      actorEmployeeId: adminA.employee.id,
    });
    expect(rows[0]!.changes).toMatchObject({ port: "email", provider: "server_log" });
  });

  it("4. create + update + delete gir nøyaktig tre rader", async () => {
    const { orgA, adminA } = await setup();
    const created = await create(adminA.user, orgA.id, M365_INPUT);
    await update(adminA.user, orgA.id, created.id, { status: "disabled" });
    await markConnectionDeleted(adminA.user, orgA.id, created.id);

    const rows = await auditRows(orgA.id);
    expect(rows.map((row) => row.action)).toEqual(["create", "update", "delete"]);
  });
});

describe("3.8 tilgang per rolle", () => {
  /** Ingen av de fire virker, ingen rad laget eller endret, ingen loggrad. */
  async function expectDeniedEverywhere(actor: Actor, organizationId: string) {
    const row = await createIntegrationConnection(organizationId);
    const before = await allRows();
    const audit = (await auditRows(organizationId)).length;

    await expect(listConnections(actor, organizationId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      create(actor, organizationId, { port: "email", provider: "dev_mailbox" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      update(actor, organizationId, row.id, { status: "disabled" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(markConnectionDeleted(actor, organizationId, row.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );

    expect(await allRows()).toEqual(before);
    expect(await auditRows(organizationId)).toHaveLength(audit);
  }

  /** Alle fire virker. */
  async function expectAllowedEverywhere(actor: Actor, organizationId: string) {
    const created = await create(actor, organizationId, { port: "email", provider: "server_log" });
    const updated = await update(actor, organizationId, created.id, { status: "disabled" });
    expect(updated.status).toBe("disabled");
    const list = await listConnections(actor, organizationId);
    expect(list.map((row) => row.id)).toEqual([created.id]);
    await markConnectionDeleted(actor, organizationId, created.id);
    expect((await rowById(created.id)).deletedAt).not.toBeNull();
    expect((await auditRows(organizationId)).map((row) => row.action)).toEqual([
      "create",
      "update",
      "delete",
    ]);
  }

  it.each<EmployeeRole>(["inspector", "office", "manager"])(
    "1. %s får AccessDeniedError på alle fire; ingen rad, ingen loggrad",
    async (role) => {
      const org = await createOrganization("Organisasjon A");
      const { user } = await addEmployee(org.id, [role], "Ansatt A");
      await expectDeniedEverywhere(user, org.id);
    },
  );

  it("2. admin kan alt", async () => {
    const { orgA, adminA } = await setup();
    await expectAllowedEverywhere(adminA.user, orgA.id);
  });

  it("3. takstmann som også er admin kan alt", async () => {
    const org = await createOrganization("Organisasjon A");
    const { user } = await addEmployee(org.id, ["inspector", "admin"], "To roller");
    await expectAllowedEverywhere(user, org.id);
  });

  it("4. enkeltrettigheten organization.manage gir ikke tilgang (kan ikke gis, A21)", async () => {
    const org = await createOrganization("Organisasjon A");
    const { user, employee } = await addEmployee(org.id, ["inspector"], "Takstmann A");
    await grantPermission(employee, "organization.manage");
    await expectDeniedEverywhere(user, org.id);
  });

  it("5a. deaktivert admin nektes alt", async () => {
    const org = await createOrganization("Organisasjon A");
    const { user, employee } = await addEmployee(org.id, ["admin"], "Admin A");
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    await expectDeniedEverywhere(user, org.id);
  });

  it("5b. ansatt uten roller nektes alt", async () => {
    const org = await createOrganization("Organisasjon A");
    const { user } = await addEmployee(org.id, [], "Uten roller");
    await expectDeniedEverywhere(user, org.id);
  });

  it("5c. innlogget uten ansettelse i organisasjonen nektes alt", async () => {
    const org = await createOrganization("Organisasjon A");
    const stranger = await createUser({ name: "Uten Ansettelse" });
    await expectDeniedEverywhere(stranger, org.id);
  });

  // Regel 11. Denne testen skal aldri fjernes: admin må alltid kunne styre tilkoblingene.
  it("6. admin stenges aldri ute: access.inspectors_edit_all = false, uten sertifisering og enkeltrettigheter", async () => {
    const org = await createOrganization("Organisasjon A");
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    // createEmployee gir verken sertifisering eller enkeltrettigheter
    const { user } = await addEmployee(org.id, ["admin"], "Admin A");
    await expectAllowedEverywhere(user, org.id);
  });
});

describe("3.9 tenant-isolasjon (regel 2)", () => {
  /** To tilkoblinger i hver organisasjon (email og accounting/x, unikheten er per port). */
  async function seedTwoEach(organizationIdA: string, organizationIdB: string) {
    const ids = { a: [] as string[], b: [] as string[] };
    for (const [organizationId, list] of [
      [organizationIdA, ids.a],
      [organizationIdB, ids.b],
    ] as const) {
      list.push((await createIntegrationConnection(organizationId)).id);
      list.push(
        (await createIntegrationConnection(organizationId, { port: "accounting", provider: "x" }))
          .id,
      );
    }
    return ids;
  }

  it("1. listConnections gir aldri fremmede tilkoblinger, og fremmed organisasjon nektes", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => seedTwoEach(grantA.organizationId, grantB.organizationId),
      query: (actor, organizationId) => listConnections(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it("2. updateConnection endrer bare i egen organisasjon, og fremmed organisasjon nektes", async () => {
    let allIds: string[] = [];
    const seeded = new Map<string, string[]>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = await seedTwoEach(grantA.organizationId, grantB.organizationId);
        allIds = [...ids.a, ...ids.b];
        seeded.set(grantA.organizationId, ids.a);
        seeded.set(grantB.organizationId, ids.b);
        return ids;
      },
      query: async (actor, organizationId) => {
        const found: { id: string }[] = [];
        for (const id of allIds) {
          try {
            await update(actor, organizationId, id, { status: "disabled" });
            found.push({ id });
          } catch (error) {
            if (!(error instanceof ConnectionNotFoundError)) throw error;
          }
        }
        return found;
      },
      idOf: (row) => row.id,
    });

    // Hver organisasjons revisjonslogg nevner bare egne rader: B kunne aldri endre A sine
    for (const [organizationId, ids] of seeded) {
      const audit = await auditRows(organizationId);
      expect(audit.map((row) => row.entityId).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        expect((await rowById(id)).organizationId).toBe(organizationId);
      }
    }
  });

  it("3. findActiveConnection med organisasjonen fra tilgangssjekken gir bare egne rader", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => seedTwoEach(grantA.organizationId, grantB.organizationId),
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
        const found: { id: string }[] = [];
        for (const port of ["email", "accounting"] as const) {
          const row = await findActiveConnection(grant.organizationId, port);
          if (row) found.push({ id: row.id });
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });

  it("4. recordConnectionResult med organisasjonen fra tilgangssjekken endrer bare egne rader", async () => {
    let allIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [organizationId, list] of [
          [grantA.organizationId, ids.a],
          [grantB.organizationId, ids.b],
        ] as const) {
          list.push((await createIntegrationConnection(organizationId, { status: "error" })).id);
          list.push(
            (
              await createIntegrationConnection(organizationId, {
                port: "accounting",
                provider: "x",
                status: "error",
              })
            ).id,
          );
        }
        allIds = [...ids.a, ...ids.b];
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
        // Alle seedede rader tilbake til error, så en lekkasje til den andre organisasjonen synes
        await db
          .update(integrationConnections)
          .set({ status: "error" })
          .where(inArray(integrationConnections.id, allIds));
        for (const id of allIds) {
          await recordConnectionResult(grant.organizationId, id, { ok: true });
        }
        // Alle rader som ble active, uansett organisasjon: fremmede id-er her er en lekkasje
        return db
          .select()
          .from(integrationConnections)
          .where(
            and(
              inArray(integrationConnections.id, allIds),
              eq(integrationConnections.status, "active"),
            ),
          );
      },
      idOf: (row) => row.id,
    });
  });

  it("5. A sender med B sin connectionId: B-raden er uendret ved suksess og feil", async () => {
    const { orgA, orgB } = await setup();
    const rowB = await createIntegrationConnection(orgB.id, {
      status: "error",
      lastError: "gammel feil",
    });
    const before = await rowById(rowB.id);

    await recordConnectionResult(orgA.id, rowB.id, { ok: true });
    expect(await rowById(rowB.id)).toEqual(before);
    await recordConnectionResult(orgA.id, rowB.id, { ok: false, error: "x" });
    expect(await rowById(rowB.id)).toEqual(before);
    expect(before.status).toBe("error");
    expect(before.lastOkAt).toBeNull();
  });
});

// Småfunn (p): docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling-testplan.md avsnitt 2.
describe("3.12 recordConnectionResult", () => {
  it("1. error + ok: active, last_ok_at satt nå, last_error tømt", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      status: "error",
      lastError: "gammel feil",
    });
    const startedAt = Date.now();
    await recordConnectionResult(orgA.id, row.id, { ok: true });
    const after = await rowById(row.id);
    expect(after.status).toBe("active");
    expect(after.lastError).toBeNull();
    expect(after.lastOkAt).not.toBeNull();
    expect(Math.abs(after.lastOkAt!.getTime() - startedAt)).toBeLessThanOrEqual(1000);
  });

  it("2. disabled + ok: raden er uendret", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, { status: "disabled" });
    const before = await rowById(row.id);
    await recordConnectionResult(orgA.id, row.id, { ok: true });
    expect(await rowById(row.id)).toEqual(before);
  });

  it("3. slettet rad + ok: raden er uendret", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      status: "error",
      lastError: "gammel feil",
      deletedAt: new Date(),
      deletedBy: "oppdiktet",
    });
    const before = await rowById(row.id);
    await recordConnectionResult(orgA.id, row.id, { ok: true });
    expect(await rowById(row.id)).toEqual(before);
  });

  it("4. disabled + feil: raden er uendret", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, { status: "disabled" });
    const before = await rowById(row.id);
    await recordConnectionResult(orgA.id, row.id, { ok: false, error: "x" });
    expect(await rowById(row.id)).toEqual(before);
  });

  it("5. slettet rad + feil: raden er uendret", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, {
      deletedAt: new Date(),
      deletedBy: "oppdiktet",
    });
    const before = await rowById(row.id);
    await recordConnectionResult(orgA.id, row.id, { ok: false, error: "x" });
    expect(await rowById(row.id)).toEqual(before);
  });

  it("6. active + feil: error, last_error satt, last_ok_at uendret", async () => {
    const { orgA } = await setup();
    const lastOkAt = new Date("2026-10-01T08:00:00.000Z");
    const row = await createIntegrationConnection(orgA.id, { lastOkAt });
    await recordConnectionResult(orgA.id, row.id, { ok: false, error: "x" });
    const after = await rowById(row.id);
    expect(after.status).toBe("error");
    expect(after.lastError).toBe("x");
    expect(after.lastOkAt).toEqual(lastOkAt);
  });

  it("7. lang feilmelding kortes og vaskes av scrubText", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id);
    await recordConnectionResult(orgA.id, row.id, {
      ok: false,
      error: `client_secret=abc ${"x".repeat(600)}`,
    });
    const after = await rowById(row.id);
    expect(after.lastError).not.toBeNull();
    expect(after.lastError!.length).toBeLessThanOrEqual(503);
    expect(after.lastError!.endsWith(" …")).toBe(true);
    expect(after.lastError).toContain("client_secret=[fjernet]");
    expect(after.lastError).not.toContain("abc");
  });

  it("8. databasefeil: kaster ikke, én logger.error med fast tekst, connectionId og error", async () => {
    const { orgA } = await setup();
    const row = await createIntegrationConnection(orgA.id, { status: "error" });
    const errorSpy = vi.spyOn(logger, "error");
    // Settes sist: fabrikken og oppsettet skal ikke treffes av spionen
    vi.spyOn(db, "update").mockImplementation(() => {
      throw new Error("db nede");
    });

    await expect(
      recordConnectionResult(orgA.id, row.id, { ok: false, error: "sendefeil" }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg, fields] = errorSpy.mock.calls[0]!;
    expect(msg).toBe("Kunne ikke oppdatere status på en tilkobling");
    expect(Object.keys(fields ?? {}).sort()).toEqual(["connectionId", "error"]);
    expect(fields?.connectionId).toBe(row.id);
    const line = JSON.stringify(formatLogLine("error", msg, fields));
    expect(line).toContain("db nede");
    expect(line).not.toContain("sendefeil");
  });

  it("9. ingen rad i revisjonsloggen etter suksess og feil", async () => {
    const { orgA } = await setup();
    const failed = await createIntegrationConnection(orgA.id, { status: "error" });
    const active = await createIntegrationConnection(orgA.id, {
      port: "accounting",
      provider: "x",
    });
    await recordConnectionResult(orgA.id, failed.id, { ok: true });
    await recordConnectionResult(orgA.id, active.id, { ok: false, error: "x" });
    expect((await rowById(failed.id)).status).toBe("active");
    expect((await rowById(active.id)).status).toBe("error");
    expect(await auditRows(orgA.id)).toEqual([]);
  });
});

describe("3.10 findActiveConnection", () => {
  it("1. B har den eneste aktive: A får null", async () => {
    const { orgA, orgB } = await setup();
    await createIntegrationConnection(orgB.id, {
      provider: "microsoft365",
      secretRef: "MS_GRAPH_CLIENT_SECRET",
      settings: M365,
    });
    expect(await findActiveConnection(orgA.id, "email")).toBeNull();
  });

  it("2. active og error finnes; disabled og slettet gir null", async () => {
    const orgs = await Promise.all(
      ["active", "error", "disabled", "slettet"].map((name) => createOrganization(`Org ${name}`)),
    );
    const [active, failed, disabled, deleted] = orgs as [
      (typeof orgs)[number],
      (typeof orgs)[number],
      (typeof orgs)[number],
      (typeof orgs)[number],
    ];
    const activeRow = await createIntegrationConnection(active.id);
    const errorRow = await createIntegrationConnection(failed.id, { status: "error" });
    await createIntegrationConnection(disabled.id, { status: "disabled" });
    await createIntegrationConnection(deleted.id, {
      deletedAt: new Date(),
      deletedBy: "oppdiktet",
    });

    expect((await findActiveConnection(active.id, "email"))?.id).toBe(activeRow.id);
    expect((await findActiveConnection(failed.id, "email"))?.id).toBe(errorRow.id);
    expect(await findActiveConnection(disabled.id, "email")).toBeNull();
    expect(await findActiveConnection(deleted.id, "email")).toBeNull();
  });

  it("3. annen port gir null selv om email finnes", async () => {
    const { orgA } = await setup();
    await createIntegrationConnection(orgA.id);
    expect(await findActiveConnection(orgA.id, "sms")).toBeNull();
  });

  it("4. organisasjon som ikke finnes gir null, ingen feil", async () => {
    await setup();
    expect(await findActiveConnection(randomUUID(), "email")).toBeNull();
  });
});

describe("3.11 databasen", () => {
  async function indexDefinitions(): Promise<string[]> {
    const result = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'integration_connections'`,
    );
    return result.map((row) => row.indexdef);
  }

  it("1. en indeks starter med organization_id", async () => {
    const defs = await indexDefinitions();
    expect(defs.some((def) => def.includes("(organization_id"))).toBe(true);
  });

  it("2. den delvise unike indeksen på (organization_id, port) WHERE deleted_at IS NULL finnes", async () => {
    const defs = await indexDefinitions();
    const partial = defs.filter(
      (def) =>
        /\bUNIQUE\b/.test(def) &&
        def.includes("organization_id") &&
        /\bport\b/.test(def) &&
        def.includes("WHERE (deleted_at IS NULL)"),
    );
    expect(partial, defs.join("\n")).toHaveLength(1);
  });

  it("3. fremmednøkkel mot organizations: ukjent organisasjon gir databasefeil", async () => {
    await expect(createIntegrationConnection(randomUUID())).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });
});
