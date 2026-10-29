import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import { buildTrialShapeRequest, forwardTrialShape } from "./electric-shape";
import { InvalidTrialChangeError } from "./errors";

// Proxy-ruten for Electric-shapes (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 9–10 og
// avgjørelse B). Testplan avsnitt 3.1. Ingen Electric kjører; fetchImpl tar opp forespørselen.
// Hovedmål: reklamasjoner og regel 2 (en annen organisasjons data når aldri iPaden).

const ELECTRIC_URL = "http://electric.test:3000";
const SECRET = "oppdiktet-electric-testhemmelighet-40-tegn";
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
].sort();

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

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

/** fetchImpl som tar opp forespørselen og svarer med det testen sier. */
function recordingFetch(
  respond: () => Response | Promise<Response> = () =>
    new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    calls.push({ url, init });
    return respond();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, spy: fetchImpl };
}

function normalizeWhitespace(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function devSecretFromEnvExample(): string {
  const text = readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
  const line = text.split("\n").find((l) => l.startsWith("ELECTRIC_SECRET="));
  const value = line?.slice("ELECTRIC_SECRET=".length).trim();
  if (!value) throw new Error("ELECTRIC_SECRET mangler i .env.example");
  return value;
}

async function expectInvalid(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(InvalidTrialChangeError);
}

const TABLE_COLUMNS = {
  trial_forms: getTableColumns(trialForms),
  trial_answers: getTableColumns(trialAnswers),
  trial_photos: getTableColumns(trialPhotos),
} as const;

const EXPECTED_COLUMNS = {
  trial_forms: ["id", "name", "created_at", "updated_at", "deleted_at"],
  trial_answers: [
    "id",
    "trial_form_id",
    "field_key",
    "value",
    "text_state",
    "device_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  trial_photos: [
    "id",
    "trial_form_id",
    "field_key",
    "name",
    "size_bytes",
    "sha256",
    "uploaded_at",
    "device_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
} as const;

describe("buildTrialShapeRequest", () => {
  it("buildTrialShapeRequest gir aldri en annen organisasjons utsnitt (expectTenantIsolation)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] }),
      query: async (actor, organizationId) => {
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
    const { actor, organizationId, grant } = await setupOrganization("inspector");
    const other = await setupOrganization("admin", "Annen oppdiktet takst AS");
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params(`params[1]=${other.organizationId}&organization_id=${other.organizationId}`),
    );
    expect(url.searchParams.get("params[1]")).toBe(grant.organizationId);
    expect(url.searchParams.getAll("params[1]")).toHaveLength(1);
    expect(url.searchParams.has("organization_id")).toBe(false);
    expect(url.toString()).not.toContain(other.organizationId);
  });

  it("where er fast: organization_id = $1 AND deleted_at IS NULL", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const table of ["trial_forms", "trial_answers", "trial_photos"]) {
      const { url } = await buildTrialShapeRequest(
        actor,
        organizationId,
        table,
        params("where=1=1"),
      );
      expect(normalizeWhitespace(url.searchParams.get("where"))).toBe(
        "organization_id = $1 AND deleted_at IS NULL",
      );
      expect(url.searchParams.getAll("where")).toHaveLength(1);
      // Organisasjons-id-en står aldri som tekst i filteret
      expect(url.searchParams.get("where")).not.toContain(organizationId);
    }
  });

  it("table kommer bare fra argumentet, aldri fra klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params("table=users&tabell=users"),
    );
    expect(url.searchParams.get("table")).toBe("trial_forms");
    expect(url.searchParams.getAll("table")).toHaveLength(1);
  });

  it("ukjent tabell gir InvalidTrialChangeError uten kall", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const table of ["users", "session", "trial_forms; drop", ""]) {
      await expectInvalid(buildTrialShapeRequest(actor, organizationId, table, params("")));
    }
    const { fetchImpl, spy } = recordingFetch();
    await expectInvalid(
      forwardTrialShape(actor, organizationId, params("tabell=users&offset=-1"), fetchImpl),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["trial_forms", "trial_answers", "trial_photos"] as const)(
    "columns er eksplisitt for alle tre tabellene og har aldri storage_path, created_by, updated_by eller deleted_by (%s)",
    async (table) => {
      const { actor, organizationId } = await setupOrganization();
      const { url } = await buildTrialShapeRequest(actor, organizationId, table, params(""));
      const columns = (url.searchParams.get("columns") ?? "").split(",").map((c) => c.trim());
      expect(columns.length).toBeGreaterThan(1);
      for (const expected of EXPECTED_COLUMNS[table]) expect(columns, expected).toContain(expected);
      for (const forbidden of ["storage_path", "created_by", "updated_by", "deleted_by"]) {
        expect(columns, forbidden).not.toContain(forbidden);
      }
      expect(columns).not.toContain("*");
    },
  );

  it("kolonnene i columns finnes i PostgreSQL-skjemaet", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const table of ["trial_forms", "trial_answers", "trial_photos"] as const) {
      const { url } = await buildTrialShapeRequest(actor, organizationId, table, params(""));
      const columns = (url.searchParams.get("columns") ?? "").split(",").map((c) => c.trim());
      const dbNames = Object.values(TABLE_COLUMNS[table]).map((column) => column.name);
      for (const column of columns) expect(dbNames, `${table}.${column}`).toContain(column);
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
    expect(url.searchParams.get("secret")).toBe(SECRET);
    expect(url.searchParams.getAll("secret")).toHaveLength(1);
    expect(url.searchParams.has("api_secret")).toBe(false);
  });

  it("bare offset, handle, live og cursor kopieres fra klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { url } = await buildTrialShapeRequest(
      actor,
      organizationId,
      "trial_forms",
      params("offset=0_0&handle=abc-1&live=true&cursor=12&replica=full&columns=id&foo=bar"),
    );
    expect(url.searchParams.get("offset")).toBe("0_0");
    expect(url.searchParams.get("handle")).toBe("abc-1");
    expect(url.searchParams.get("live")).toBe("true");
    expect(url.searchParams.get("cursor")).toBe("12");
    expect(url.searchParams.has("replica")).toBe(false);
    expect(url.searchParams.has("foo")).toBe(false);
    expect(url.searchParams.get("columns")).not.toBe("id");
    expect(url.searchParams.getAll("columns")).toHaveLength(1);
    expect(Array.from(new Set(url.searchParams.keys())).sort()).toEqual(ALLOWED_KEYS);
  });

  it("ulovlig format på offset, handle, cursor eller live gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { fetchImpl, spy } = recordingFetch();
    for (const bad of ["offset=../x", "handle=a b", "cursor=<script>", "live=yes", "live=false"]) {
      await expectInvalid(
        buildTrialShapeRequest(actor, organizationId, "trial_forms", params(bad)),
      );
      await expectInvalid(
        forwardTrialShape(actor, organizationId, params(`tabell=trial_forms&${bad}`), fetchImpl),
      );
    }
    expect(spy).not.toHaveBeenCalled();

    for (const ok of ["offset=-1", "offset=26800584_4"]) {
      const { url } = await buildTrialShapeRequest(
        actor,
        organizationId,
        "trial_forms",
        params(ok),
      );
      expect(url.searchParams.get("offset")).toBe(ok.split("=")[1]);
    }
  });

  it("ELECTRIC_URL med sti beholdes og ender på /v1/shape", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("ELECTRIC_URL", "http://electric.test:3000/");
    let { url } = await buildTrialShapeRequest(actor, organizationId, "trial_forms", params(""));
    expect(url.pathname).toBe("/v1/shape");
    expect(url.host).toBe("electric.test:3000");

    vi.stubEnv("ELECTRIC_URL", "http://electric.test:3000/prefix");
    ({ url } = await buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")));
    expect(url.pathname).toBe("/prefix/v1/shape");
  });

  it("uten ELECTRIC_URL eller ELECTRIC_SECRET kastes tydelig feil uten kall", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const key of ["ELECTRIC_URL", "ELECTRIC_SECRET"]) {
      vi.stubEnv("ELECTRIC_URL", ELECTRIC_URL);
      vi.stubEnv("ELECTRIC_SECRET", SECRET);
      vi.stubEnv(key, "");
      await expect(
        buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
      ).rejects.toThrow(key);
      const { fetchImpl, spy } = recordingFetch();
      await expect(
        forwardTrialShape(actor, organizationId, params("tabell=trial_forms&offset=-1"), fetchImpl),
      ).rejects.toThrow(key);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("for kort ELECTRIC_SECRET (under 32 byte) kastes feil", async () => {
    const { actor, organizationId } = await setupOrganization();
    vi.stubEnv("ELECTRIC_SECRET", "a".repeat(31));
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow();
    vi.stubEnv("ELECTRIC_SECRET", "a".repeat(32));
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).resolves.toBeDefined();
  });

  it("utviklingsverdien for ELECTRIC_SECRET fra .env.example nektes når BETTER_AUTH_URL ikke er localhost", async () => {
    const { actor, organizationId } = await setupOrganization();
    const devSecret = devSecretFromEnvExample();
    vi.stubEnv("ELECTRIC_SECRET", devSecret);

    vi.stubEnv("BETTER_AUTH_URL", "https://test.example.com");
    await expect(
      buildTrialShapeRequest(actor, organizationId, "trial_forms", params("")),
    ).rejects.toThrow();

    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const { url } = await buildTrialShapeRequest(actor, organizationId, "trial_forms", params(""));
    expect(url.searchParams.get("secret")).toBe(devSecret);
  });

  it.each(ALL_ROLES)(
    "alle fire roller får bygge forespørselen, deaktivert ansatt nektes (%s)",
    async (role) => {
      const { actor, organizationId, grant } = await setupOrganization(role);
      const { url } = await buildTrialShapeRequest(
        actor,
        organizationId,
        "trial_photos",
        params(""),
      );
      expect(url.searchParams.get("params[1]")).toBe(grant.organizationId);

      const former = await createDeactivatedEmployee(organizationId);
      await expect(
        buildTrialShapeRequest(former, organizationId, "trial_photos", params("")),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    },
  );
});

describe("forwardTrialShape", () => {
  const UPSTREAM_HEADERS = {
    "content-type": "application/json",
    "electric-handle": "12345-1730000000000",
    "electric-offset": "26800584_4",
    "electric-schema": '{"id":{"type":"uuid"}}',
    "electric-cursor": "1234",
    "electric-up-to-date": "",
    etag: '"oppdiktet-etag"',
    age: "30",
    expires: "Wed, 28 Oct 2026 12:00:00 GMT",
    "cache-control": "public, max-age=60",
    "x-powered-by": "oppdiktet",
  };
  const FORWARDED = [
    "content-type",
    "electric-handle",
    "electric-offset",
    "electric-schema",
    "electric-cursor",
    "electric-up-to-date",
  ];

  function upstream(status: number) {
    // 204 kan ikke ha kropp
    const body = status === 204 ? null : '[{"x":1}]';
    return new Response(body, { status, headers: UPSTREAM_HEADERS });
  }

  it.each([200, 204, 400, 409, 429])(
    "forwardTrialShape videresender 200, 204, 400, 409 og 429 uendret (%i)",
    async (status) => {
      const { actor, organizationId } = await setupOrganization();
      const { fetchImpl, spy } = recordingFetch(() => upstream(status));
      const response = await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_forms&offset=-1"),
        fetchImpl,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(status === 204 ? "" : '[{"x":1}]');
    },
  );

  it.each([200, 204, 400, 409, 429])(
    "forwardTrialShape svarer alltid Cache-Control: private, no-store og videresender bare content-type og electric-hodene (%i)",
    async (status) => {
      const { actor, organizationId } = await setupOrganization();
      const { fetchImpl } = recordingFetch(() => upstream(status));
      const response = await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_forms&offset=-1"),
        fetchImpl,
      );
      for (const name of FORWARDED) {
        expect(response.headers.get(name), name).toBe(
          UPSTREAM_HEADERS[name as keyof typeof UPSTREAM_HEADERS],
        );
      }
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      for (const name of ["etag", "age", "expires", "x-powered-by"]) {
        expect(response.headers.has(name), name).toBe(false);
      }
      const names = Array.from(response.headers.keys()).sort();
      expect(names).toEqual([...FORWARDED, "cache-control"].sort());
    },
  );

  it.each([
    ["nettverksfeil", () => new TypeError("fetch failed")],
    ["tidsavbrudd", () => new DOMException("The operation was aborted.", "AbortError")],
  ] as const)(
    "forwardTrialShape gir 502 med { feil } uten Electrics tekst ved nettverksfeil og tidsavbrudd (%s)",
    async (_name, makeError) => {
      const { actor, organizationId } = await setupOrganization();
      const { fetchImpl, spy } = recordingFetch(() => {
        throw makeError();
      });
      const response = await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_answers&offset=-1"),
        fetchImpl,
      );
      expect(response.status).toBe(502);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const text = await response.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(typeof body.feil).toBe("string");
      expect((body.feil as string).length).toBeGreaterThan(0);
      for (const leak of ["fetch failed", "aborted", "electric.test", ELECTRIC_URL, SECRET]) {
        expect(text, leak).not.toContain(leak);
      }
    },
  );

  it("forwardTrialShape sender secret til Electric, men aldri til klienten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const ok = recordingFetch(() => upstream(200));
    const response = await forwardTrialShape(
      actor,
      organizationId,
      params("tabell=trial_forms&offset=-1"),
      ok.fetchImpl,
    );
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url.searchParams.get("secret")).toBe(SECRET);
    expect(ok.calls[0]!.url.host).toBe("electric.test:3000");
    expect(ok.calls[0]!.url.pathname).toBe("/v1/shape");
    for (const [, value] of response.headers) expect(value).not.toContain(SECRET);
    expect(await response.text()).not.toContain(SECRET);

    const failing = recordingFetch(() => {
      throw new TypeError("fetch failed");
    });
    const bad = await forwardTrialShape(
      actor,
      organizationId,
      params("tabell=trial_forms&offset=-1"),
      failing.fetchImpl,
    );
    expect(bad.status).toBe(502);
    for (const [, value] of bad.headers) expect(value).not.toContain(SECRET);
    expect(await bad.text()).not.toContain(SECRET);

    // 400 fra Electric videresendes uendret. Proxyen legger ikke hemmeligheten til selv; om Electric
    // gjentar spørrestrengen i egen 400-kropp, er et åpent punkt for /security-review.
    const rejected = recordingFetch(
      () =>
        new Response('{"message":"ugyldig offset"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const four = await forwardTrialShape(
      actor,
      organizationId,
      params("tabell=trial_forms&offset=-1"),
      rejected.fetchImpl,
    );
    expect(four.status).toBe(400);
    const fourText = await four.text();
    expect(fourText).toBe('{"message":"ugyldig offset"}');
    expect(fourText).not.toContain(SECRET);
    for (const [, value] of four.headers) expect(value).not.toContain(SECRET);
  });

  it("forwardTrialShape logger bare rute, bruker, tabell og status", async () => {
    const { actor, organizationId } = await setupOrganization();
    const spies: MockInstance[] = [
      vi.spyOn(logger, "debug"),
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    for (const respond of [
      () => upstream(200),
      () => upstream(400),
      () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      const { fetchImpl } = recordingFetch(respond);
      await forwardTrialShape(
        actor,
        organizationId,
        params("tabell=trial_answers&offset=26800584_4&handle=abc-1&secret=klient-hemmelighet"),
        fetchImpl,
      );
    }
    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((call) =>
        JSON.stringify(call, (_key, value: unknown) =>
          value instanceof Error ? { name: value.name, message: value.message } : value,
        ),
      )
      .join("\n");
    for (const forbidden of [
      SECRET,
      "secret",
      "klient-hemmelighet",
      "where",
      "params",
      "26800584_4",
      "abc-1",
      "electric.test",
    ]) {
      expect(logged, forbidden).not.toContain(forbidden);
    }
  });

  it("fremmed organisasjon gir AccessDeniedError uten kall", async () => {
    const a = await setupOrganization("admin", "Oppdiktet takst A AS");
    const b = await setupOrganization("admin", "Oppdiktet takst B AS");
    const { fetchImpl, spy } = recordingFetch();
    await expect(
      forwardTrialShape(
        a.actor,
        b.organizationId,
        params("tabell=trial_forms&offset=-1"),
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      buildTrialShapeRequest(a.actor, b.organizationId, "trial_forms", params("")),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(spy).not.toHaveBeenCalled();
  });
});
