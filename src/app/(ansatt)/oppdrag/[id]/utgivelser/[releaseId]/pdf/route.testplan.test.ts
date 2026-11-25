import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
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
vi.mock("@/core/reports/release-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/reports/release-pdf")>();
  return { ...actual, getReleasePdfData: vi.fn(actual.getReleasePdfData) };
});

import { PdfRenderError } from "@/core/pdf";
import { renderReportPdf } from "@/core/pdf/render.node";
import { getReleasePdfData } from "@/core/reports/release-pdf";
import { db } from "@/db/client";
import { assignments, reportReleases } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { createClaim, resetDatabase } from "../../../../../../../../tests/factories";
import {
  createPdfBathroom,
  eventsOf,
  newVersion,
  publishAs,
  reportTableState,
  setDeviationText,
} from "../../../../../../../../tests/pdf-db-fixtures";
import { inspectPdf } from "../../../../../../../../tests/pdf-inspect";
import {
  BUSY_TEXT,
  deferred,
  DRAFT_ERROR_TEXT,
  isPdf,
  loggedText,
  NOT_FOUND_TEXT,
  releaseRequest,
  settle,
  tmpEntries,
} from "../../../../../../../../tests/pdf-route-helpers";
import { createStaff, setInspectorsEditAll } from "../../../../../../../../tests/report-fixtures";
import * as route from "./route";

/*
 * Ruten for PDF av en utgivelse, GET /oppdrag/[id]/utgivelser/[releaseId]/pdf (testplanen for PDF
 * av badet avsnitt 10.2, 10.7.4–10.7.6, 11.1–11.6; kortet Omfang 6b, F7 og T26). Bygges fra
 * utgivelsens lagrede snapshot uten «UTKAST». Innloggingen og motoren er byttet ut der testen
 * trenger det; tilgangssjekken og databasen er ekte.
 *
 * Hovedmål: færre reklamasjoner (leder kan vise teksten og TG slik de ble publisert) og de
 * ansatte (ett trykk på «Åpne PDF», samme tilgang som skjermen). Alle data er oppdiktede.
 */

const { GET } = route;

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
  vi.mocked(renderReportPdf).mockClear();
  vi.mocked(getReleasePdfData).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function params(id: string, releaseId: string) {
  return { params: Promise.resolve({ id, releaseId }) };
}

async function getRelease(assignmentId: string, releaseId: string) {
  return settle(() =>
    GET(releaseRequest(assignmentId, releaseId), params(assignmentId, releaseId)),
  );
}

async function published(options: Parameters<typeof createPdfBathroom>[0] = {}) {
  const f = await createPdfBathroom(options);
  const { releaseId, versionNumber } = await publishAs(f.actor, f);
  session.actor = f.actor;
  return { ...f, releaseId, versionNumber };
}

function pdfText(bytes: Uint8Array): string {
  return inspectPdf(bytes)
    .pages.map((p) => p.text)
    .join("\n");
}

describe("10.2.1 og 10.7.4 svaret", () => {
  it("200 med filnavn med versjon, sikkerhetshoder og PDF uten utkastdelene", async () => {
    const f = await published({ mark: "UTGIVELSE" });
    await db
      .update(assignments)
      .set({ number: '2026-<0042>"x' })
      .where(eq(assignments.id, f.assignmentId));
    const res = await getRelease(f.assignmentId, f.releaseId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf/);
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="tilstandsrapport-2026-0042-v1.pdf"',
    );
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(isPdf(res.body)).toBe(true);
    const pdf = inspectPdf(res.body);
    const text = pdfText(res.body);
    expect(text).toContain("UTGIVELSE");
    expect(text).not.toContain("UTKAST");
    expect(text).not.toContain("Ikke med i PDF-en");
    expect(text).not.toMatch(/Ikke satt|Mangler:|Sjekk:/);
    expect(pdf.info.title).toMatch(/^Tilstandsrapport .*0042.*versjon 1$/);
    expect(pdf.info.title).not.toContain("UTKAST");
    for (const page of pdf.pages) {
      for (const link of page.links) expect(JSON.stringify(link)).not.toMatch(/\/oppdrag\//);
    }
  }, 30_000);

  it("10.7.4 datoene i PDF-en er publiseringstidspunktet, også med en annen klokke", async () => {
    const f = await published();
    const [row] = await db
      .select({ at: reportReleases.releasedAt })
      .from(reportReleases)
      .where(eq(reportReleases.id, f.releaseId));
    await getRelease(f.assignmentId, f.releaseId);
    const options = vi.mocked(renderReportPdf).mock.calls.at(-1)![2];
    expect(options.generatedAt.toISOString()).toBe(row!.at.toISOString());
    expect(options.draft).toBe(false);
  }, 30_000);

  it("to kall uten endring gir like byte", async () => {
    const f = await published();
    const first = await getRelease(f.assignmentId, f.releaseId);
    const second = await getRelease(f.assignmentId, f.releaseId);
    expect(Buffer.from(second.body).equals(Buffer.from(first.body))).toBe(true);
  }, 30_000);

  it("bare GET og HEAD er eksportert", () => {
    const exported = Object.keys(route).filter((k) => /^[A-Z]+$/.test(k));
    expect(exported.filter((k) => !["GET", "HEAD"].includes(k))).toEqual([]);
  });

  it("11.4.1 HEAD gir 405 uten gjengivelse og uten hendelse", async () => {
    const f = await published();
    const head = (route as Record<string, unknown>).HEAD as
      ((req: Request, ctx: ReturnType<typeof params>) => Promise<Response>) | undefined;
    expect(head).toBeTypeOf("function");
    const res = await settle(() =>
      head!(
        releaseRequest(f.assignmentId, f.releaseId, { method: "HEAD" }),
        params(f.assignmentId, f.releaseId),
      ),
    );
    expect(res.status).toBe(405);
    expect(vi.mocked(renderReportPdf)).not.toHaveBeenCalled();
    expect(await eventsOf(f.organizationId, "report.release_pdf_created")).toEqual([]);
  });
});

describe("10.2.2 og 10.7.5 tilgang", () => {
  it("ikke innlogget gir 401 eller videresending, ingen PDF", async () => {
    const f = await published();
    session.actor = null;
    const res = await getRelease(f.assignmentId, f.releaseId);
    expect(res.status === 401 || res.redirected).toBe(true);
    expect(isPdf(res.body)).toBe(false);
    expect(vi.mocked(getReleasePdfData)).not.toHaveBeenCalled();
  });

  it("organisasjon B gir 404-siden, uten verdier fra A", async () => {
    const a = await published({ mark: "ORG-A" });
    const b = await published({ mark: "ORG-B" });
    session.actor = b.actor;
    const res = await getRelease(a.assignmentId, a.releaseId);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.text).toContain(NOT_FOUND_TEXT);
    expect(res.text).not.toContain("ORG-A");
    const mixed = await getRelease(b.assignmentId, a.releaseId);
    expect(mixed.status).toBe(404);
  });

  it("utgivelse fra et annet oppdrag i samme organisasjon gir 404", async () => {
    const f = await published();
    const other = await createPdfBathroom({ organizationId: f.organizationId, mark: "ANNET" });
    session.actor = f.actor;
    expect((await getRelease(other.assignmentId, f.releaseId)).status).toBe(404);
  });

  it.each(["abc", "' or 1=1 --", "00000000-0000-0000-0000-000000000000"])(
    "ugyldig releaseId «%s» gir 404",
    async (releaseId) => {
      const f = await published();
      const res = await getRelease(f.assignmentId, releaseId);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("or 1=1");
    },
  );

  it("myk slettet oppdrag og slettet utgivelse gir 404", async () => {
    const f = await published();
    await db
      .update(reportReleases)
      .set({ deletedAt: new Date() })
      .where(eq(reportReleases.id, f.releaseId));
    expect((await getRelease(f.assignmentId, f.releaseId)).status).toBe(404);
    const g = await published({ organizationId: f.organizationId, mark: "G" });
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, g.assignmentId));
    expect((await getRelease(g.assignmentId, g.releaseId)).status).toBe(404);
  });

  it.each([
    { roles: ["admin"] as const, editAll: false },
    { roles: ["inspector"] as const, editAll: false },
    { roles: ["office"] as const, editAll: false },
    { roles: ["manager"] as const, editAll: true },
  ])(
    "$roles (inspectors_edit_all $editAll) får PDF-en, også med reklamasjon",
    async ({ roles, editAll }) => {
      const f = await published();
      await setInspectorsEditAll(f.organizationId, editAll);
      await createClaim(f.organizationId, {
        assignmentId: f.assignmentId,
        description: "MERKE-KLAGE",
      });
      const { actor } = await createStaff(f.organizationId, [...roles]);
      session.actor = actor;
      const res = await getRelease(f.assignmentId, f.releaseId);
      expect(res.status).toBe(200);
      expect(pdfText(res.body)).not.toContain("MERKE-KLAGE");
    },
    30_000,
  );
});

describe("10.7.6 hendelse, tak og ingen lagring", () => {
  it("nøyaktig én report.release_pdf_created med versionNumber og bare tillatte felt", async () => {
    const f = await published({ mark: "HENDELSE" });
    const res = await getRelease(f.assignmentId, f.releaseId);
    expect(res.status).toBe(200);
    const rows = await eventsOf(f.organizationId, "report.release_pdf_created");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.actorId).toBe(f.employeeId);
    expect(row!.reportId).toBe(f.reportId);
    const data = row!.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      ["durationMs", "imageCount", "pageCount", "profileCode", "reportId", "versionNumber"].sort(),
    );
    expect(data.versionNumber).toBe(1);
    const json = JSON.stringify(row);
    for (const forbidden of [
      "HENDELSE",
      f.assignmentNumber,
      "Prøvevegen",
      "Testselskap",
      "tilstandsrapport-",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect(await eventsOf(f.organizationId, "report.draft_pdf_created")).toEqual([]);
  }, 30_000);

  it("404, 429 og 500 gir ingen hendelse; plassen frigjøres etter feil", async () => {
    const f = await published();
    expect((await getRelease(f.assignmentId, "00000000-0000-0000-0000-000000000000")).status).toBe(
      404,
    );
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("timeout"));
    const failed = await getRelease(f.assignmentId, f.releaseId);
    expect(failed.status).toBe(500);
    expect(failed.text).toContain(DRAFT_ERROR_TEXT);
    const hold = deferred<void>();
    const real = vi.mocked(renderReportPdf).getMockImplementation()!;
    vi.mocked(renderReportPdf).mockImplementationOnce(async (...args) => {
      await hold.promise;
      return real(...args);
    });
    const first = getRelease(f.assignmentId, f.releaseId);
    await vi.waitFor(() => expect(vi.mocked(renderReportPdf)).toHaveBeenCalledTimes(2));
    const busy = await getRelease(f.assignmentId, f.releaseId);
    expect(busy.status).toBe(429);
    expect(busy.text).toContain(BUSY_TEXT);
    hold.resolve();
    expect((await first).status).toBe(200);
    expect(await eventsOf(f.organizationId, "report.release_pdf_created")).toHaveLength(1);
  }, 30_000);

  it("ingen rader i files, ingen endring i report_releases og ingen temp-filer", async () => {
    const f = await published();
    const before = await reportTableState(f.organizationId);
    const tmpBefore = tmpEntries();
    expect((await getRelease(f.assignmentId, f.releaseId)).status).toBe(200);
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new PdfRenderError("engine_failed"));
    expect((await getRelease(f.assignmentId, f.releaseId)).status).toBe(500);
    expect(await reportTableState(f.organizationId)).toEqual(before);
    expect(tmpEntries()).toEqual(tmpBefore);
  }, 30_000);

  it("11.6.1 feil fra getReleasePdfData logges uten melding og stakk", async () => {
    const f = await published();
    const spies = [vi.spyOn(logger, "error"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "info")];
    vi.mocked(getReleasePdfData).mockRejectedValueOnce(
      Object.assign(new Error("Failed query params: MERKE-PARAM Prøvevegen 1"), {
        params: ["MERKE-PARAM"],
      }),
    );
    const res = await getRelease(f.assignmentId, f.releaseId);
    expect(res.status).toBe(500);
    const logged = loggedText(spies.flatMap((s) => s.mock.calls as unknown[][]));
    expect(logged).not.toContain("MERKE-PARAM");
    expect(logged).not.toContain("Prøvevegen");
    expect(logged).not.toMatch(/\.ts:\d+:\d+|stack/);
    expect(res.text).not.toContain("MERKE-PARAM");
  });
});

describe("T26 og 11.1 en eldre utgivelse viser sin egen tekst", () => {
  it("versjon 1 viser fortsatt sin tekst etter at versjon 2 er publisert", async () => {
    const f = await published({ mark: "V1" });
    await newVersion(f);
    await setDeviationText(f, f.deviationId!, "deviation_text", "Oppdiktet avvik V2.");
    const v2 = await publishAs(f.actor, f);
    session.actor = f.actor;
    const v1Text = pdfText((await getRelease(f.assignmentId, f.releaseId)).body);
    expect(v1Text).toContain("Oppdiktet avvik V1.");
    expect(v1Text).not.toContain("Oppdiktet avvik V2.");
    const v2Res = await getRelease(f.assignmentId, v2.releaseId);
    expect(v2Res.headers.get("content-disposition")).toMatch(/-v2\.pdf"$/);
    expect(pdfText(v2Res.body)).toContain("Oppdiktet avvik V2.");
  }, 60_000);
});

describe("statisk", () => {
  const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");

  it("ruten bruker ikke Host-hodene og leser ikke databasen selv", () => {
    expect(source).not.toMatch(/x-forwarded-host/i);
    expect(source).not.toMatch(/from\s+["']@\/db/);
    expect(source).not.toMatch(/error\.message|\.stack\b/);
  });
});
