import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, type Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { trialAnswers, trialForms, trialPhotos, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import {
  buildTrialShapeRequest,
  DEVELOPMENT_ELECTRIC_SECRET,
  forwardTrialShape,
} from "./electric-shape";
import { InvalidTrialChangeError } from "./errors";

// Proxyen mellom iPaden og ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 9–10,
// avgjørelse B). Testplan avsnitt 3.1. Ingen Electric-tjeneste i testene: forwardTrialShape får en
// innsatt fetchImpl som tar opp forespørselen og svarer det testen ber om.

const ELECTRIC_URL = "http://electric.test:3000";
/** 40 tegn, oppdiktet. */
const SECRET = "oppdiktet-electrichemmelighet-40-tegn-ab";
const TABLES = ["trial_forms", "trial_answers", "trial_photos"] as const;
type Table3 = (typeof TABLES)[number];
const ALLOWED_KEYS = [
  "columns",
  "cursor",
  "handle",
  "live",
  "offset",
  "params[1]",
  "secret",
  "table",
  "where",
];
const FORBIDDEN_COLUMNS = ["storage_path", "created_by", "updated_by", "deleted_by"];

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("ELECTRIC_URL", ELECTRIC_URL);
  vi.stubEnv("ELECTRIC_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** fetchImpl som tar opp adressen og svarer med `respond()`. */
function fakeFetch(respond: () => Response) {
  const calls: URL[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const href = input instanceof Request ? input.url : String(input);
    calls.push(new URL(href));
    return respond();
  });
  return { fetchImpl: mock as unknown as typeof fetch, mock, calls };
}

function okFetch() {
  return fakeFetch(
    () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  );
}

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

const serverTables: Record<Table3, Table> = {
  trial_forms: trialForms,
  trial_answers: trialAnswers,
  trial_photos: trialPhotos,
};

function serverColumnNames(table: Table): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((column) => column.name));
}

const EXPECTED_COLUMNS: Record<Table3, string[]> = {
  trial_forms: ["id", "name"],
  trial_answers: ["id", "trial_form_id", "field_key", "value", "text_state", "device_id"],
  trial_photos: [
    "id",
    "trial_form_id",
    "field_key",
    "name",
    "size_bytes",
    "sha256",
    "uploaded_at",
    "device_id",
  ],
};

function devSecretFromEnvExample(): string {
  const text = readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
  const line = text.split("\n").find((l) => l.startsWith("ELECTRIC_SECRET="));
  const value = line?.slice("ELECTRIC_SECRET=".length).trim();
  if (!value) throw new Error("ELECTRIC_SECRET mangler i .env.example");
  return value;
}

const UPSTREAM_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "electric-handle": "12345-1730000000000",
  "electric-offset": "26800584_4",
  "electric-schema": '{"id":{"type":"uuid"}}',
  "electric-cursor": "42",
  "electric-up-to-date": "",
  etag: '"12345-1730000000000:-1:26800584_4"',
  age: "12",
  expires: "Wed, 28 Oct 2026 10:00:00 GMT",
  "cache-control": "public, max-age=60",
  "x-powered-by": "Oppdiktet",
};
const FORWARDED = [
  "content-type",
  "electric-handle",
  "electric-offset",
  "electric-schema",
  "electric-cursor",
  "electric-up-to-date",
];

async function expectNoSecret(response: Response) {
  for (const [name, value] of response.headers) {
    expect(value, name).not.toContain(SECRET);
    expect(name).not.toMatch(/secret/i);
  }
  expect(await response.text()).not.toContain(SECRET);
}

describe("buildTrialShapeRequest", () => {
  it("buildTrialShapeRequest gir aldri en annen organisasjons utsnitt (expectTenantIsolation)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [grantA.organizationId],
        b: [grantB.organizationId],
      }),
      query: async (actor: Actor, organizationId: string) => {
        const { url } = await buildTrialShapeRequest(
          actor,
          organizationId,
          "trial_answers",
          new URLSearchParams(),
        );
        return [{ id: url.searchParams.get("params[1]")! }];
      },
      idOf: (row) => row.id,
    });
  });

  it("params[1] er alltid grant.organizationId, aldri fra spørrestrengen", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const { url } = await buildTrialShapeRequest(
      a.actor,
      a.organizationId,
      "trial_answers",
      params(`params[1]=${b.organizationId}&organization_id=${b.organizationId}`),
    );
    expect(url.searchParams.get("params[1]")).toBe(a.grant.organizationId);
    expect(url.searchParams.getAll("params[1]")).toEqual([a.grant.organizationId]);
    expect(url.searchParams.has("organization_id")).toBe(false);
    expect(url.href).not.toContain(b.organizationId);
  });

  it("where er fast: organization_id = $1 AND deleted_at IS NULL", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params("where=1=1"),
    );
    expect(url.searchParams.getAll("where")).toHaveLength(1);
    const where = (url.searchParams.get("where") ?? "").replace(/\s+/g, " ").trim();
    expect(where).toBe("organization_id = $1 AND deleted_at IS NULL");
    expect(where).not.toContain(organizationId);
  });

  it("table kommer bare fra argumentet, aldri fra klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params("table=users"),
    );
    expect(url.searchParams.getAll("table")).toEqual(["trial_forms"]);
  });

  it("ukjent tabell gir InvalidTrialChangeError uten kall", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const table of ["users", "session", "trial_forms; drop", ""]) {
      await expect(
        buildTrialShapeRequest(actor, organizationId, table, new URLSearchParams()),
        table,
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    const { fetchImpl, mock } = okFetch();
    await expect(
      forwardTrialShape(actor, organizationId, params("tabell=users&offset=-1"), fetchImpl),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(mock).not.toHaveBeenCalled();
  });

  describe("columns er eksplisitt for alle tre tabellene og har aldri storage_path, created_by, updated_by eller deleted_by", () => {
    it.each(TABLES)(
      "columns er eksplisitt for alle tre tabellene og har aldri storage_path, created_by, updated_by eller deleted_by (%s)",
      async (table) => {
        const { actor, organizationId } = await setupOrganization();
        const { url } = await buildTrialShapeRequest(
          actor,
          organizationId,
          table,
          params("columns=storage_path"),
        );
        const columns = (url.searchParams.get("columns") ?? "").split(",").map((c) => c.trim());
        for (const column of [...EXPECTED_COLUMNS[table], "deleted_at", "updated_at"]) {
          expect(columns, `${table}.${column}`).toContain(column);
        }
        for (const column of FORBIDDEN_COLUMNS) {
          expect(columns, `${table}.${column}`).not.toContain(column);
        }
      },
    );
  });

  it("kolonnene i columns finnes i PostgreSQL-skjemaet", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const table of TABLES) {
      const { url } = await buildTrialShapeRequest(
        actor,
        organizationId,
        table,
        new URLSearchParams(),
      );
      const allowed = serverColumnNames(serverTables[table]);
      const columns = (url.searchParams.get("columns") ?? "").split(",");
      expect(columns.length, table).toBeGreaterThan(1);
      for (const column of columns) {
        expect(allowed.has(column), `${table}.${column}`).toBe(true);
      }
    }
  });

  it("secret settes fra ELECTRIC_SECRET og aldri fra klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params("secret=x&api_secret=y"),
    );
    expect(url.searchParams.get("secret")).toBe(process.env.ELECTRIC_SECRET);
    expect(url.searchParams.getAll("secret")).toEqual([SECRET]);
    expect(url.searchParams.has("api_secret")).toBe(false);
  });

  it("bare offset, handle, live og cursor kopieres fra klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_answers",
      params("offset=0_0&handle=abc-1&live=true&cursor=12&replica=full&columns=id&foo=bar"),
    );
    expect(url.searchParams.get("offset")).toBe("0_0");
    expect(url.searchParams.get("handle")).toBe("abc-1");
    expect(url.searchParams.get("live")).toBe("true");
    expect(url.searchParams.get("cursor")).toBe("12");
    expect(url.searchParams.has("replica")).toBe(false);
    expect(url.searchParams.has("foo")).toBe(false);
    expect(url.searchParams.get("columns")).not.toBe("id");
    expect(Array.from(url.searchParams.keys()).sort()).toEqual(ALLOWED_KEYS);
  });

  it("ulovlig format på offset, handle, cursor eller live gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { fetchImpl, mock } = okFetch();
    for (const query of [
      "offset=../x",
      "handle=a b",
      "cursor=<script>",
      "live=yes",
      "live=false",
    ]) {
      await expect(
        buildTrialShapeRequest(actor, organizationId, "trial_forms", params(query)),
        query,
      ).rejects.toThrow(InvalidTrialChangeError);
      await expect(
        forwardTrialShape(actor, organizationId, params(`tabell=trial_forms&${query}`), fetchImpl),
        query,
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    expect(mock).not.toHaveBeenCalled();

    for (const offset of ["-1", "26800584_4"]) {
      const { url } = await buildTrialShapeRequest(
        actor,
        organizationId,
        "trial_forms",
        params(`offset=${offset}`),
      );
      expect(url.searchParams.get("offset")).toBe(offset);
    }
  });

  it("ELECTRIC_URL med sti beholdes og ender på /v1/shape", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("ELECTRIC_URL", "http://electric.test:3000/");
    const plain = await buildTrialShapeRequest(actor, organizationId, "trial_forms", params(""));
    expect(plain.url.host).toBe("electric.test:3000");
    expect(plain.url.pathname).toBe("/v1/shape");

    vi.stubEnv("ELECTRIC_URL", "http://electric.test:3000/prefix");
    const prefixed = await buildTrialShapeRequest(actor, organizationId, "trial_forms", params(""));
    expect(prefixed.url.pathname).toBe("/prefix/v1/shape");
  });

  it("uten ELECTRIC_URL eller ELECTRIC_SECRET kastes tydelig feil uten kall", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { fetchImpl, mock } = okFetch();

    vi.stubEnv("ELECTRIC_URL", "");
    await expect(
      forwardTrialShape(actor, organizationId, params("tabell=trial_forms"), fetchImpl),
    ).rejects.toThrow(/ELECTRIC_URL/);
    vi.stubEnv("ELECTRIC_URL", undefined);
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow(/ELECTRIC_URL/);

    vi.stubEnv("ELECTRIC_URL", ELECTRIC_URL);
    vi.stubEnv("ELECTRIC_SECRET", "");
    await expect(
      forwardTrialShape(actor, organizationId, params("tabell=trial_forms"), fetchImpl),
    ).rejects.toThrow(/ELECTRIC_SECRET/);
    vi.stubEnv("ELECTRIC_SECRET", undefined);
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow(/ELECTRIC_SECRET/);

    expect(mock).not.toHaveBeenCalled();
  });

  it("for kort ELECTRIC_SECRET (under 32 byte) kastes feil", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("ELECTRIC_SECRET", "x".repeat(31));
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow(Error);
    vi.stubEnv("ELECTRIC_SECRET", "x".repeat(32));
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).resolves.toHaveProperty("url");
  });

  it("utviklingsverdien for ELECTRIC_SECRET fra .env.example nektes når BETTER_AUTH_URL ikke er localhost", async () => {
    const { actor, organizationId } = await setupOrganization();
    const devSecret = devSecretFromEnvExample();
    expect(devSecret).toBe(DEVELOPMENT_ELECTRIC_SECRET);
    expect(Buffer.byteLength(devSecret)).toBeGreaterThanOrEqual(32);
    vi.stubEnv("ELECTRIC_SECRET", devSecret);

    vi.stubEnv("BETTER_AUTH_URL", "https://test.example.com");
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow(Error);

    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).resolves.toHaveProperty("url");
  });

  describe("alle fire roller får bygge forespørselen, deaktivert ansatt nektes", () => {
    it.each(ALL_ROLES)(
      "alle fire roller får bygge forespørselen, deaktivert ansatt nektes (%s)",
      async (role: EmployeeRole) => {
        const { actor, organizationId } = await setupOrganization(role);
        const { url } = await buildTrialShapeRequest(
          actor,
          organizationId,
          "trial_answers",
          new URLSearchParams(),
        );
        expect(url.searchParams.get("params[1]")).toBe(organizationId);
      },
    );

    it("alle fire roller får bygge forespørselen, deaktivert ansatt nektes (deaktivert)", async () => {
      const { organizationId } = await setupOrganization("admin");
      const gone = await createDeactivatedEmployee(organizationId);
      await expect(
        buildTrialShapeRequest(gone, organizationId, "trial_answers", new URLSearchParams()),
      ).rejects.toThrow(AccessDeniedError);
    });
  });
});

describe("forwardTrialShape", () => {
  describe("forwardTrialShape videresender 200, 204, 400, 409 og 429 uendret", () => {
    it.each([200, 204, 400, 409, 429])(
      "forwardTrialShape videresender 200, 204, 400, 409 og 429 uendret (%i)",
      async (status) => {
        const { actor, organizationId } = await setupOrganization();
        // 204 kan ikke ha kropp
        const body = status === 204 ? null : '[{"x":1}]';
        const { fetchImpl, mock } = fakeFetch(
          () => new Response(body, { status, headers: { "content-type": "application/json" } }),
        );
        const response = await forwardTrialShape(
          actor,
          organizationId,
          params("tabell=trial_forms&offset=-1"),
          fetchImpl,
        );
        expect(response.status).toBe(status);
        expect(await response.text()).toBe(body ?? "");
        expect(mock).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("forwardTrialShape svarer alltid Cache-Control: private, no-store og videresender bare content-type og electric-hodene", () => {
    it.each([200, 204, 400, 409, 429])(
      "forwardTrialShape svarer alltid Cache-Control: private, no-store og videresender bare content-type og electric-hodene (%i)",
      async (status) => {
        const { actor, organizationId } = await setupOrganization();
        const { fetchImpl } = fakeFetch(
          () =>
            new Response(status === 204 ? null : "[]", {
              status,
              headers: UPSTREAM_HEADERS,
            }),
        );
        const response = await forwardTrialShape(
          actor,
          organizationId,
          params("tabell=trial_answers&offset=-1"),
          fetchImpl,
        );
        expect(response.status).toBe(status);
        for (const name of FORWARDED) {
          expect(response.headers.get(name), name).toBe(UPSTREAM_HEADERS[name]);
        }
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        for (const name of ["etag", "age", "expires", "x-powered-by"]) {
          expect(response.headers.has(name), name).toBe(false);
        }
      },
    );
  });

  it("forwardTrialShape gir 502 med { feil } uten Electrics tekst ved nettverksfeil og tidsavbrudd", async () => {
    const { actor, organizationId } = await setupOrganization();
    const failures: (() => Error)[] = [
      () => new TypeError("fetch failed"),
      () => new DOMException("This operation was aborted", "AbortError"),
      () => new DOMException("The operation timed out.", "TimeoutError"),
    ];
    for (const failure of failures) {
      const { fetchImpl, mock } = fakeFetch(() => {
        throw failure();
      });
      const response = await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_forms&offset=-1"),
        fetchImpl,
      );
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const text = await response.text();
      const body = JSON.parse(text) as { feil?: unknown };
      expect(typeof body.feil).toBe("string");
      expect(String(body.feil).length).toBeGreaterThan(0);
      expect(text).not.toContain("fetch failed");
      expect(text).not.toMatch(/aborted|timed out/i);
      expect(text).not.toContain("electric.test");
      expect(text).not.toContain(SECRET);
      // Ingen ny prøving på serveren
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });

  it("forwardTrialShape sender secret til Electric, men aldri til klienten", async () => {
    const { actor, organizationId } = await setupOrganization();

    const ok = fakeFetch(() => new Response("[]", { status: 200, headers: UPSTREAM_HEADERS }));
    const okResponse = await forwardTrialShape(
      actor,
      organizationId,
      params("tabell=trial_forms&offset=-1"),
      ok.fetchImpl,
    );
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.host).toBe("electric.test:3000");
    expect(ok.calls[0]!.searchParams.get("secret")).toBe(SECRET);
    await expectNoSecret(okResponse);

    // Proxyen legger ikke selv hemmeligheten til i en avvisning fra Electric
    const rejected = fakeFetch(
      () =>
        new Response('{"message":"ugyldig offset"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await expectNoSecret(
      await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_forms&offset=-1"),
        rejected.fetchImpl,
      ),
    );

    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expectNoSecret(
      await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_forms&offset=-1"),
        down.fetchImpl,
      ),
    );
  });

  it("forwardTrialShape logger bare rute, bruker, tabell og status", async () => {
    const { actor, organizationId } = await setupOrganization();
    // Loggeren skriver ikke i testmiljøet, så både loggeren og console følges
    const spies: MockInstance[] = [
      ...(["debug", "info", "warn", "error"] as const).map((method) => vi.spyOn(logger, method)),
      ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      ),
    ];

    const answers: (() => Response)[] = [
      () => new Response("[]", { status: 200 }),
      () => new Response('{"message":"ugyldig offset"}', { status: 400 }),
      () => new Response("[]", { status: 409 }),
      () => new Response("intern feil", { status: 500 }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const answer of answers) {
      const { fetchImpl } = fakeFetch(answer);
      await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_answers&offset=-1&handle=abc-1"),
        fetchImpl,
      );
    }

    const lines = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
    expect(lines.length, "proxyen logger avviste og feilede kall").toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toMatch(/secret/i);
      expect(line).not.toMatch(/where/i);
      expect(line).not.toMatch(/params/i);
      expect(line).not.toContain("electric.test");
      expect(line).not.toContain("abc-1");
    }
    // Det som logges, er nok til å finne igjen kallet
    expect(lines.some((line) => line.includes("trial_answers") && line.includes(actor.id))).toBe(
      true,
    );
  });

  it("fremmed organisasjon gir AccessDeniedError uten kall", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const { fetchImpl, mock } = okFetch();
    await expect(
      forwardTrialShape(a.actor, b.organizationId, params("tabell=trial_forms"), fetchImpl),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      buildTrialShapeRequest(a.actor, b.organizationId, "trial_forms", params("")),
    ).rejects.toThrow(AccessDeniedError);
    expect(mock).not.toHaveBeenCalled();
  });
});
