import { readFileSync } from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", async () => {
  const { redirect } = await import("next/navigation");
  return {
    getCurrentActor: vi.fn(async () => session.actor),
    getActorForAction: vi.fn(async () => session.actor),
    requireActor: vi.fn(async () => {
      if (!session.actor) redirect("/logg-inn");
      return session.actor;
    }),
    LOGIN_PATH: "/logg-inn",
  };
});
vi.mock("@/core/pdf/render.node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/pdf/render.node")>();
  return { ...actual, renderReportPdf: vi.fn(actual.renderReportPdf) };
});
vi.mock("@/core/reports/pdf-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/reports/pdf-data")>();
  return { ...actual, getReportDraftPdfData: vi.fn(actual.getReportDraftPdfData) };
});

import { PdfRenderError } from "@/core/pdf";
import { renderReportPdf } from "@/core/pdf/render.node";
import { getReportDraftPdfData } from "@/core/reports/pdf-data";
import { db } from "@/db/client";
import { assignments, files, reports } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../../../../tests/factories";
import {
  createPdfBathroom,
  eventsOf,
  publishAs,
  reportTableState,
  type PdfBathroom,
} from "../../../../../../tests/pdf-db-fixtures";
import { inspectPdf } from "../../../../../../tests/pdf-inspect";
import {
  BUSY_TEXT,
  deferred,
  draftRequest,
  DRAFT_ERROR_TEXT,
  isPdf,
  loggedText,
  NOT_FOUND_TEXT,
  releaseRequest,
  settle,
  tmpEntries,
} from "../../../../../../tests/pdf-route-helpers";
import { createStaff } from "../../../../../../tests/report-fixtures";
import * as releaseRoute from "../utgivelser/[releaseId]/pdf/route";
import * as route from "./route";

/*
 * Ruten for PDF-utkastet, GET /oppdrag/[id]/pdf (testplanen for PDF av badet avsnitt 6, 10.1,
 * 10.5, 11.2–11.4 og 11.6; kortet Omfang 6 og A539). Innloggingen og motoren er byttet ut der
 * testen trenger det; tilgangssjekken, rapportdataene og databasen er ekte.
 *
 * Hovedmål: de ansatte (ett trykk gir PDF-en, tydelige feilsider på norsk, én ansatt kan ikke
 * stenge for de andre), færre reklamasjoner (bare egne data, «UTKAST» på hver side, ingenting
 * lagres) og KI i bunnen (målingen er én hendelse uten persondata). Alle data er oppdiktede.
 */

const { GET } = route;

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
  vi.mocked(renderReportPdf).mockClear();
  vi.mocked(getReportDraftPdfData).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function getDraft(assignmentId: string, init: Parameters<typeof draftRequest>[1] = {}) {
  return settle(() => GET(draftRequest(assignmentId, init), params(assignmentId)));
}

function as(actor: Actor | null) {
  session.actor = actor;
}

async function bathroom(
  options: Parameters<typeof createPdfBathroom>[0] = {},
): Promise<PdfBathroom> {
  const f = await createPdfBathroom(options);
  as(f.actor);
  return f;
}

async function fileCount(organizationId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(files)
    .where(eq(files.organizationId, organizationId));
  return Number(row?.n ?? 0);
}

function pdfText(bytes: Uint8Array): string {
  return inspectPdf(bytes)
    .pages.map((p) => p.text)
    .join("\n");
}

const SECURITY_HEADERS = {
  "cache-control": /no-store/,
  "x-content-type-options": /^nosniff$/,
  "cross-origin-resource-policy": /^same-origin$/,
};

// --- 6.1 Svar --------------------------------------------------------------------------------

describe("6.1 svaret", () => {
  it("6.1.1 takstmann får PDF med riktige hoder og filnavn med bare sifre og bindestrek", async () => {
    const f = await bathroom({ mark: "RUTE" });
    await db
      .update(assignments)
      .set({ number: '2026-<0042>"x' })
      .where(eq(assignments.id, f.assignmentId));
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf/);
    for (const [name, pattern] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toMatch(pattern);
    }
    expect(res.headers.get("cache-control")).toMatch(/private/);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^inline; filename="utkast-[0-9-]+\.pdf"$/);
    expect(disposition).toContain("utkast-2026-0042");
    expect(isPdf(res.body)).toBe(true);
    const text = pdfText(res.body);
    expect(text).toContain("RUTE");
    expect(text).toContain("UTKAST");
  }, 30_000);

  it("6.1.2 og 11.4.2 bare GET og HEAD er eksportert", () => {
    const exported = Object.keys(route)
      .filter((k) => /^[A-Z]+$/.test(k))
      .sort();
    expect(exported.filter((k) => !["GET", "HEAD"].includes(k))).toEqual([]);
    expect(exported).toContain("GET");
    const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/);
  });

  it("6.1.3 ikke innlogget gir 401 eller videresending, ingen PDF og ingen kall til dataene", async () => {
    const f = await createPdfBathroom();
    as(null);
    const res = await getDraft(f.assignmentId);
    expect(res.status === 401 || res.redirected).toBe(true);
    expect(isPdf(res.body)).toBe(false);
    expect(vi.mocked(getReportDraftPdfData)).not.toHaveBeenCalled();
    expect(vi.mocked(renderReportPdf)).not.toHaveBeenCalled();
  });

  it("6.1.4 organisasjon B med oppdraget til A gir 404-siden «Fant ikke rapporten» (HTML, norsk)", async () => {
    const a = await createPdfBathroom({ mark: "ORG-A" });
    const b = await bathroom({ mark: "ORG-B" });
    as(b.actor);
    const res = await getDraft(a.assignmentId);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.text).toContain(NOT_FOUND_TEXT);
    expect(res.text).not.toContain("ORG-A");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(vi.mocked(renderReportPdf)).not.toHaveBeenCalled();
  });

  it.each(["abc", "' or 1=1 --", "00000000-0000-0000-0000-000000000000"])(
    "6.1.5 ugyldig id «%s» gir samme 404-side",
    async (id) => {
      await bathroom();
      const res = await getDraft(id);
      expect(res.status).toBe(404);
      expect(res.text).toContain(NOT_FOUND_TEXT);
      expect(res.text).not.toContain(id.replace(/'/g, "&#x27;"));
      expect(res.text).not.toContain("or 1=1");
    },
  );

  it("6.1.5 slettet rapport gir samme 404-side", async () => {
    const f = await bathroom();
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, f.reportId));
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(404);
    expect(res.text).toContain(NOT_FOUND_TEXT);
  });

  it("10.1.2 erstattet rapport gir 404", async () => {
    const f = await bathroom();
    await db.update(reports).set({ status: "superseded" }).where(eq(reports.id, f.reportId));
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(404);
  });

  it("10.1.1 publisert rapport gir utkast med «UTKAST» fra de låste radene", async () => {
    const f = await bathroom({ mark: "PUBL" });
    await publishAs(f.actor, f);
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(200);
    const text = pdfText(res.body);
    expect(text).toContain("UTKAST");
    expect(text).toContain("PUBL");
  }, 30_000);

  it("6.1.6 feil i motoren gir 500-siden med «Prøv igjen» som vanlig lenke, HTML og ingen motortekst", async () => {
    const f = await bathroom({ mark: "MOTORFEIL" });
    vi.mocked(renderReportPdf).mockRejectedValueOnce(
      new Error("motoren sier MERKE-MOTOR Prøvevegen 1 MOTORFEIL"),
    );
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.text).toContain(DRAFT_ERROR_TEXT);
    // «Prøv igjen» laster samme adresse på nytt (`href=""`): kortet Omfang 6 sier at ingen verdi
    // fra adressen skrives ut på feilsidene, så id-en står ikke i lenken
    expect(res.text).toMatch(/<a\s[^>]*href=""[^>]*>Prøv igjen<\/a>/);
    expect(res.text).not.toContain(f.assignmentId);
    expect(res.text).not.toContain("MERKE-MOTOR");
    expect(res.text).not.toContain("MOTORFEIL");
    expect(res.text).not.toContain("Prøvevegen");
    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).not.toMatch(/\son[a-z]+=/i);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("6.1.7 to samtidige for samme ansatt gir én 200 og én 429 med fast tekst", async () => {
    const f = await bathroom();
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementationOnce(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    const first = getDraft(f.assignmentId);
    await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(1));
    const second = await getDraft(f.assignmentId);
    expect(second.status).toBe(429);
    expect(second.headers.get("content-type")).toMatch(/^text\/html/);
    expect(second.text).toContain(BUSY_TEXT);
    expect(second.headers.get("cache-control")).toMatch(/no-store/);
    hold.resolve();
    expect((await first).status).toBe(200);
    // Plassen er frigjort
    expect((await getDraft(f.assignmentId)).status).toBe(200);
  }, 30_000);

  it.each([
    ["tidsavbrudd", () => new PdfRenderError("timeout")],
    ["krasj i tråden", () => new PdfRenderError("engine_failed")],
    ["vanlig feil", () => new Error("oppdiktet")],
  ])(
    "6.1.8 og 11.2.2 %s gir feilsiden, og plassen frigjøres",
    async (_name, makeError) => {
      const f = await bathroom();
      vi.mocked(renderReportPdf).mockRejectedValueOnce(makeError());
      const failed = await getDraft(f.assignmentId);
      expect(failed.status).toBe(500);
      expect(failed.text).toContain(DRAFT_ERROR_TEXT);
      expect((await getDraft(f.assignmentId)).status).toBe(200);
    },
    30_000,
  );

  it("11.2.2 forespørselen avbrytes mens PDF-en lages: plassen frigjøres", async () => {
    const f = await bathroom();
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementationOnce(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    const controller = new AbortController();
    const first = getDraft(f.assignmentId, { signal: controller.signal }).catch(() => null);
    await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(1));
    controller.abort();
    hold.resolve();
    await first;
    expect((await getDraft(f.assignmentId)).status).toBe(200);
  }, 30_000);

  it("10.5.3 og 11.2.3 ikke innlogget og 404 tar ikke plass i telleren", async () => {
    const f = await createPdfBathroom();
    const other = await createPdfBathroom({ mark: "ANNEN" });
    as(null);
    for (let i = 0; i < 5; i += 1) await getDraft(f.assignmentId);
    as(f.actor);
    for (let i = 0; i < 5; i += 1) expect((await getDraft(other.assignmentId)).status).toBe(404);
    expect((await getDraft(f.assignmentId)).status).toBe(200);
  }, 30_000);
});

// --- 11.2.4 Tak på tvers av rutene og ansatte -------------------------------------------------

describe("11.2.4 felles tak", () => {
  it("utkast og utgivelse samtidig for samme ansatt gir én 429", async () => {
    const f = await bathroom();
    const { releaseId } = await publishAs(f.actor, f);
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementationOnce(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    const draft = getDraft(f.assignmentId);
    await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(1));
    const release = await settle(() =>
      releaseRoute.GET(releaseRequest(f.assignmentId, releaseId), {
        params: Promise.resolve({ id: f.assignmentId, releaseId }),
      }),
    );
    expect(release.status).toBe(429);
    expect(release.text).toContain(BUSY_TEXT);
    hold.resolve();
    expect((await draft).status).toBe(200);
  }, 30_000);

  it("tre ansatte samtidig med felles tak 2 gir nøyaktig én 429", async () => {
    const f = await bathroom();
    const others = [
      (await createStaff(f.organizationId, ["inspector"])).actor,
      (await createStaff(f.organizationId, ["office"])).actor,
    ];
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementation(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    try {
      as(f.actor);
      const first = getDraft(f.assignmentId);
      await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(1));
      as(others[0]!);
      const second = getDraft(f.assignmentId);
      await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(2));
      as(others[1]!);
      const third = await getDraft(f.assignmentId);
      expect(third.status).toBe(429);
      expect(third.text).toContain(BUSY_TEXT);
      hold.resolve();
      expect([(await first).status, (await second).status]).toEqual([200, 200]);
    } finally {
      hold.resolve();
      vi.mocked(renderReportPdf).mockImplementation(real);
    }
  }, 60_000);
});

// --- 11.4 HEAD ---------------------------------------------------------------------------------

describe("11.4.1 HEAD", () => {
  it("HEAD gir 405 uten gjengivelse, uten hendelse og uten plass i taket", async () => {
    const f = await bathroom();
    const head = (route as Record<string, unknown>).HEAD as
      ((req: Request, ctx: ReturnType<typeof params>) => Promise<Response>) | undefined;
    expect(head).toBeTypeOf("function");
    const res = await settle(() =>
      head!(draftRequest(f.assignmentId, { method: "HEAD" }), params(f.assignmentId)),
    );
    expect(res.status).toBe(405);
    expect(vi.mocked(renderReportPdf)).not.toHaveBeenCalled();
    expect(await eventsOf(f.organizationId, "report.draft_pdf_created")).toEqual([]);
    expect((await getDraft(f.assignmentId)).status).toBe(200);
  }, 30_000);
});

// --- 6.2 Ingen lagring ----------------------------------------------------------------------

describe("6.2 ingen lagring (Ståle 16.11.2026)", () => {
  it("ingen nye rader i files, ingen endring i rapporttabellene og ingen nye temp-filer, også ved feil", async () => {
    const f = await bathroom();
    const filesBefore = await fileCount(f.organizationId);
    const stateBefore = await reportTableState(f.organizationId);
    const tmpBefore = tmpEntries();
    expect((await getDraft(f.assignmentId)).status).toBe(200);
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("engine_failed"));
    expect((await getDraft(f.assignmentId)).status).toBe(500);
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("timeout"));
    expect((await getDraft(f.assignmentId)).status).toBe(500);
    expect(await fileCount(f.organizationId)).toBe(filesBefore);
    expect(await reportTableState(f.organizationId)).toEqual(stateBefore);
    expect(tmpEntries()).toEqual(tmpBefore);
  }, 30_000);
});

// --- 6.3 Hendelsen ------------------------------------------------------------------------------

describe("6.3 hendelsen report.draft_pdf_created", () => {
  it("6.3.1 og 11.8.1 nøyaktig én hendelse med bare de tillatte feltene", async () => {
    const f = await bathroom({ mark: "HENDELSE" });
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(200);
    const rows = await eventsOf(f.organizationId, "report.draft_pdf_created");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.organizationId).toBe(f.organizationId);
    expect(row!.actorId).toBe(f.employeeId);
    expect(row!.reportId).toBe(f.reportId);
    const data = row!.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      ["durationMs", "imageCount", "pageCount", "profileCode", "reportId"].sort(),
    );
    expect(data.reportId).toBe(f.reportId);
    expect(data.profileCode).toBe("byggcon_standard");
    expect(data.pageCount).toBe(inspectPdf(res.body).pages.length);
    expect(typeof data.imageCount).toBe("number");
    expect(typeof data.durationMs).toBe("number");
    const json = JSON.stringify(row);
    expect(json).not.toContain("HENDELSE");
    expect(json).not.toContain(f.assignmentNumber);
    expect(json).not.toContain("Prøvevegen");
    expect(json).not.toContain("Testselskap");
    expect(json).not.toContain("utkast-");
  }, 30_000);

  it("6.3.2 feil, 404 og 429 gir ingen hendelse", async () => {
    const f = await bathroom();
    const other = await createPdfBathroom({ mark: "ANNEN" });
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("engine_failed"));
    expect((await getDraft(f.assignmentId)).status).toBe(500);
    expect((await getDraft(other.assignmentId)).status).toBe(404);
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementationOnce(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    const first = getDraft(f.assignmentId);
    await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(2));
    expect((await getDraft(f.assignmentId)).status).toBe(429);
    hold.resolve();
    expect((await first).status).toBe(200);
    expect(await eventsOf(f.organizationId, "report.draft_pdf_created")).toHaveLength(1);
    expect(await eventsOf(other.organizationId, "report.draft_pdf_created")).toHaveLength(0);
  }, 30_000);
});

// --- 6.4 og 11.6 Logging uten persondata --------------------------------------------------------

describe("6.4 og 11.6.1 logging uten persondata", () => {
  const MARKS = ["MERKE-ADRESSE", "MERKE-AVVIK", "MERKE-BILDE", "MERKE-PARAM"];

  function spyLogger() {
    return [vi.spyOn(logger, "error"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "info")];
  }

  function expectClean(calls: unknown[][], body: string) {
    const logged = loggedText(calls);
    for (const mark of MARKS) {
      expect(logged).not.toContain(mark);
      expect(body).not.toContain(mark);
    }
    expect(logged).not.toMatch(/\bat [^\s]+ \(|\.ts:\d+:\d+|stack/);
  }

  it.each([
    [
      "motoren",
      () =>
        vi
          .mocked(renderReportPdf)
          .mockRejectedValueOnce(
            new Error("MERKE-ADRESSE Prøvevegen 1, MERKE-AVVIK og MERKE-BILDE i bildeteksten"),
          ),
    ],
    [
      "getReportDraftPdfData (databasefeil med parametre)",
      () =>
        vi.mocked(getReportDraftPdfData).mockRejectedValueOnce(
          Object.assign(new Error("Failed query: select … params: MERKE-PARAM,MERKE-ADRESSE"), {
            query: "select * from assignments where address_text = $1",
            params: ["MERKE-PARAM", "MERKE-ADRESSE"],
          }),
        ),
    ],
  ])(
    "feil fra %s: loggen har bare rapport-id, profilkode og feilnavn eller kode",
    async (_name, arrange) => {
      const f = await bathroom();
      const spies = spyLogger();
      arrange();
      const res = await getDraft(f.assignmentId);
      expect(res.status).toBe(500);
      const calls = spies.flatMap((s) => s.mock.calls as unknown[][]);
      expect(calls.length).toBeGreaterThan(0);
      expectClean(calls, res.text);
    },
  );

  it("feil fra motoren logges med rapport-id, profilkode og feilkoden", async () => {
    const f = await bathroom();
    const spies = spyLogger();
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("invalid_image"));
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(500);
    const logged = loggedText(spies.flatMap((s) => s.mock.calls as unknown[][]));
    expect(logged).toContain(f.reportId);
    expect(logged).toContain("byggcon_standard");
    expect(logged).toContain("invalid_image");
  });

  it("vellykket PDF logger ingen adresse, tekst eller selskapsnavn", async () => {
    const f = await bathroom({ mark: "MERKE-ADRESSE" });
    const spies = spyLogger();
    expect((await getDraft(f.assignmentId)).status).toBe(200);
    expectClean(
      spies.flatMap((s) => s.mock.calls as unknown[][]),
      "",
    );
  }, 30_000);
});

// --- 10.5 Sikkerhet ---------------------------------------------------------------------------

describe("10.5 sikkerhet", () => {
  it("10.5.1 forfalsket Host og X-Forwarded-Host endrer ikke lenkene i PDF-en", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const f = await bathroom();
    await getDraft(f.assignmentId);
    const call = vi.mocked(renderReportPdf).mock.calls.at(-1)!;
    const honest = call[2].appBaseUrl;
    vi.mocked(renderReportPdf).mockClear();
    await getDraft(f.assignmentId, {
      headers: { host: "angriper.example", "x-forwarded-host": "angriper.example" },
    });
    const forged = vi.mocked(renderReportPdf).mock.calls.at(-1)!;
    expect(forged[2].appBaseUrl).toBe(honest);
    expect(String(forged[2].appBaseUrl ?? "")).not.toContain("angriper");
    for (const page of inspectPdf(
      (
        await getDraft(f.assignmentId, {
          headers: { host: "angriper.example", "x-forwarded-host": "angriper.example" },
        })
      ).body,
    ).pages) {
      for (const link of page.links) expect(JSON.stringify(link)).not.toContain("angriper");
    }
  }, 30_000);

  it("10.5.2 feilsidene har ingen verdi fra adressen", async () => {
    await bathroom();
    const id = "%3Cscript%3Ealert(1)%3C%2Fscript%3E";
    const res = await getDraft(decodeURIComponent(id));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<script");
    expect(res.text).not.toContain("alert(1)");
  });

  it("gjengivelsen får draft: true, fast profil og generatedAt fra serveren", async () => {
    const f = await bathroom();
    await getDraft(f.assignmentId);
    const [data, profile, options] = vi.mocked(renderReportPdf).mock.calls.at(-1)!;
    expect(data.kind).toBe("draft");
    expect(profile.code).toBe("byggcon_standard");
    expect(options.draft).toBe(true);
    expect(options.generatedAt).toBeInstanceOf(Date);
    expect(options.limits.timeoutMs).toBeGreaterThan(0);
  }, 30_000);
});

// --- Tid ------------------------------------------------------------------------------------------

describe("7.10 tid", () => {
  it("utkastet av badet svarer på under 5 sekunder, og durationMs er satt", async () => {
    const f = await bathroom();
    // Første kall varmer opp arbeidstråden
    await getDraft(f.assignmentId);
    const start = performance.now();
    const res = await getDraft(f.assignmentId);
    expect(res.status).toBe(200);
    expect(performance.now() - start).toBeLessThan(5000);
    const rows = await eventsOf(f.organizationId, "report.draft_pdf_created");
    for (const row of rows) {
      expect((row.data as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);
});

// --- Statiske sjekker for rutene -----------------------------------------------------------

describe("statisk: rekkefølgen i ruten og ingen tilgangslogikk", () => {
  const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");

  it("ruten bruker ikke Host eller X-Forwarded-Host", () => {
    expect(source).not.toMatch(
      /x-forwarded-host|headers\(\)\.get\(["']host["']\)|request\.headers\.get\(["']host["']\)/i,
    );
  });

  it("ruten skriver ikke tilgangslogikk selv (organisasjonen kommer fra økten)", () => {
    expect(source).not.toMatch(/searchParams\.get\(["']organisasjon["']\)/);
    expect(source).not.toMatch(/from\s+["']@\/db/);
  });

  it("loggen får aldri error.message eller stack", () => {
    expect(source).not.toMatch(/error\.message|\.stack\b|err\.message/);
  });
});
