import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { PdfRenderError, renderReportPdf, type RenderReportPdf } from "@/core/pdf";
import { getReleasePdfData } from "@/core/reports";
import { db } from "@/db/client";
import { assignments, reportReleases, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { createClaim, resetDatabase } from "../../../../../../../../tests/factories";
import { createDeactivatedEmployee } from "../../../../../../../../tests/offline-trial";
import { inspectPdf } from "../../../../../../../../tests/pdf-inspect";
import {
  bodyBytes,
  deferred,
  draftPath,
  expectErrorPage,
  expectPdfHeaders,
  fileRowCount,
  isolatedDirs,
  PDF_TEXTS,
  pdfEvents,
  pdfRequest,
  publishedBathroom,
  releasePath,
  until,
} from "../../../../../../../../tests/pdf-route";
import { createStaff, setInspectorsEditAll } from "../../../../../../../../tests/report-fixtures";
import { pdfLimiter } from "../../../pdf/pdf-response";
import { GET as GET_DRAFT } from "../../../pdf/route";
import * as routeModule from "./route";

const { GET, HEAD } = routeModule;

/*
 * Ruten for PDF av en utgivelse, GET /oppdrag/[id]/utgivelser/[releaseId]/pdf
 * (docs/funksjoner/fase2a-pdf-badet.md Omfang 6b, F7; testplan 10.2, 10.7.4–6, 11.2, 11.4–11.6).
 * Innloggingen er mocket. Tilgangen, dataene (`getReleasePdfData`) og motoren kjøres ekte mot
 * testdatabasen; gjengivelsen byttes bare der testen holder den igjen eller lar den feile.
 * Alle data er oppdiktede.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn(), LOGIN_PATH: "/logg-inn" }));
vi.mock("@/core/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/pdf")>();
  return { ...actual, renderReportPdf: vi.fn(actual.renderReportPdf) };
});
vi.mock("@/core/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/reports")>();
  return { ...actual, getReleasePdfData: vi.fn(actual.getReleasePdfData) };
});

const actualPdf = await vi.importActual<typeof import("@/core/pdf")>("@/core/pdf");
const actualReports = await vi.importActual<typeof import("@/core/reports")>("@/core/reports");

const ADDRESS_MARK = "Merkevegen 99 MERKE-ADRESSE";
const DEVIATION_MARK = "MERKE-AVVIKSTEKST lekkasje";
const FAKE_PDF = { bytes: new TextEncoder().encode("%PDF-1.7 falsk"), pageCount: 3, imageCount: 0 };

let dirs: Awaited<ReturnType<typeof isolatedDirs>>;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
  vi.mocked(renderReportPdf).mockReset();
  vi.mocked(renderReportPdf).mockImplementation(actualPdf.renderReportPdf);
  vi.mocked(getReleasePdfData).mockReset();
  vi.mocked(getReleasePdfData).mockImplementation(actualReports.getReleasePdfData);
  dirs = await isolatedDirs();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await dirs.cleanup();
  expect(pdfLimiter.active()).toBe(0);
});

function loggedInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function get(assignmentId: string, releaseId: string, init: Parameters<typeof pdfRequest>[1] = {}) {
  return GET(pdfRequest(releasePath(assignmentId, releaseId), init), {
    params: Promise.resolve({ id: assignmentId, releaseId }),
  });
}

function getDraft(assignmentId: string) {
  return GET_DRAFT(pdfRequest(draftPath(assignmentId)), {
    params: Promise.resolve({ id: assignmentId }),
  });
}

function useFakeRender(implementation?: RenderReportPdf) {
  vi.mocked(renderReportPdf).mockImplementation(implementation ?? (async () => FAKE_PDF));
}

async function published(
  options: Parameters<typeof publishedBathroom>[0] = {},
  number = "26-0042",
) {
  const f = await publishedBathroom(options);
  await db.update(assignments).set({ number }).where(eq(assignments.id, f.assignmentId));
  return f;
}

async function releaseRows(organizationId: string) {
  return db.select().from(reportReleases).where(eq(reportReleases.organizationId, organizationId));
}

describe("GET utgivelse: svaret (10.2.1, 10.7.4)", () => {
  it("200 med filnavn med versjon, svarhoder, uten UTKAST, og datoene fra publiseringen", async () => {
    const f = await published();
    loggedInAs(f.actor);
    const filesBefore = await fileRowCount();
    const releasesBefore = await releaseRows(f.organizationId);

    const response = await get(f.assignmentId, f.releaseId);

    expectPdfHeaders(response, "tilstandsrapport-26-0042-v1.pdf");
    const pdf = inspectPdf(await bodyBytes(response));
    const text = pdf.pages.map((page) => page.text).join("\n");
    for (const word of ["UTKAST", "Ikke med i PDF-en", "Ikke satt", "Mangler", "Sjekk:"]) {
      expect(text).not.toContain(word);
    }
    // Ingen interne lenker i PDF-en av en utgivelse (F4)
    const uris = pdf.pages.flatMap((page) => page.links.map((link) => link.uri ?? ""));
    expect(uris.filter((uri) => uri.includes("/oppdrag/"))).toEqual([]);
    expect(pdf.info.title).toContain("versjon 1");

    const options = vi.mocked(renderReportPdf).mock.calls[0]?.[2];
    expect(options?.draft).toBe(false);
    expect(options?.generatedAt.toISOString()).toBe(releasesBefore[0]?.releasedAt.toISOString());

    // 6.2: ingenting lagres, og utgivelsen endres ikke
    expect(await fileRowCount()).toBe(filesBefore);
    expect(await releaseRows(f.organizationId)).toEqual(releasesBefore);
    await dirs.expectEmpty();
  });

  it("10.7.4 datoene følger publiseringen, også med en annen klokke", async () => {
    const f = await published();
    loggedInAs(f.actor);
    useFakeRender();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-01-01T12:00:00Z") });
    try {
      expect((await get(f.assignmentId, f.releaseId)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const [release] = await releaseRows(f.organizationId);
    const options = vi.mocked(renderReportPdf).mock.calls[0]?.[2];
    expect(options?.generatedAt.toISOString()).toBe(release?.releasedAt.toISOString());
  });

  it("10.7.6 nøyaktig én hendelse med versjonsnummer og bare de tillatte feltene", async () => {
    const f = await published();
    loggedInAs(f.actor);
    useFakeRender();
    expect((await get(f.assignmentId, f.releaseId)).status).toBe(200);
    const rows = await pdfEvents(f.organizationId);
    expect(rows).toHaveLength(1);
    const [event] = rows;
    expect(event?.type).toBe("report.release_pdf_created");
    expect(event?.organizationId).toBe(f.organizationId);
    expect(event?.actorId).toBe(f.employeeId);
    const data = event?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      ["durationMs", "imageCount", "pageCount", "profileCode", "reportId", "versionNumber"].sort(),
    );
    expect(data).toMatchObject({
      reportId: event?.reportId,
      profileCode: "byggcon_standard",
      pageCount: 3,
      imageCount: 0,
      versionNumber: 1,
    });
  });
});

describe("GET utgivelse: innlogging og tilgang (10.2.2, 10.7.5, 11.5)", () => {
  it("ikke innlogget: videresending til innlogging, ingen plass i taket", async () => {
    const f = await published();
    loggedInAs(null);
    const response = await get(f.assignmentId, f.releaseId);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/logg-inn?neste=${encodeURIComponent(releasePath(f.assignmentId, f.releaseId))}`,
    );
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(getReleasePdfData).not.toHaveBeenCalled();
  });

  it("organisasjon B med oppdrags- og utgivelses-id-en til A får 404", async () => {
    const a = await published();
    const b = await published();
    loggedInAs(b.actor);
    await expectErrorPage(await get(a.assignmentId, a.releaseId), 404, PDF_TEXTS.notFound);
    // B sitt eget oppdrag med A sin utgivelse gir også 404
    await expectErrorPage(await get(b.assignmentId, a.releaseId), 404, PDF_TEXTS.notFound);
    expect(vi.mocked(getReleasePdfData).mock.calls[0]?.[1]).toBe(b.organizationId);
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(await pdfEvents(a.organizationId)).toEqual([]);
    expect(await pdfEvents(b.organizationId)).toEqual([]);
  });

  it("utgivelse på et annet oppdrag i samme organisasjon gir 404", async () => {
    const a = await published();
    const other = await published({ organizationId: a.organizationId }, "26-0043");
    loggedInAs(a.actor);
    await expectErrorPage(await get(a.assignmentId, other.releaseId), 404, PDF_TEXTS.notFound);
    expect(renderReportPdf).not.toHaveBeenCalled();
  });

  it.each([
    ["ugyldig utgivelses-id", "ikke-en-id", null],
    ["ugyldig oppdrags-id", null, "ikke-en-id"],
    ["ukjent utgivelses-id", uuidv7(), null],
  ])("%s gir 404", async (_name, releaseOverride, assignmentOverride) => {
    const f = await published();
    loggedInAs(f.actor);
    const response = await get(
      assignmentOverride ?? f.assignmentId,
      releaseOverride ?? f.releaseId,
    );
    await expectErrorPage(response, 404, PDF_TEXTS.notFound);
  });

  it("slettet utgivelse gir 404", async () => {
    const f = await published();
    await db
      .update(reportReleases)
      .set({ deletedAt: new Date() })
      .where(eq(reportReleases.id, f.releaseId));
    loggedInAs(f.actor);
    await expectErrorPage(await get(f.assignmentId, f.releaseId), 404, PDF_TEXTS.notFound);
  });

  it("slettet oppdrag gir 404 i begge rutene", async () => {
    const f = await published();
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, f.assignmentId));
    loggedInAs(f.actor);
    await expectErrorPage(await get(f.assignmentId, f.releaseId), 404, PDF_TEXTS.notFound);
    await expectErrorPage(await getDraft(f.assignmentId), 404, PDF_TEXTS.notFound);
  });

  it("ansatt som har sluttet gir 404", async () => {
    const f = await published();
    loggedInAs(await createDeactivatedEmployee(f.organizationId));
    await expectErrorPage(await get(f.assignmentId, f.releaseId), 404, PDF_TEXTS.notFound);
  });
});

describe("GET utgivelse: rollematrise (10.2.4, 10.7.5)", () => {
  const ROLES: [string, EmployeeRole[], boolean, boolean][] = [
    ["takstmann", ["inspector"], true, false],
    ["takstmann, inspectors_edit_all av", ["inspector"], false, false],
    ["takstmann med reklamasjon", ["inspector"], true, true],
    ["kontor", ["office"], true, false],
    ["kontor med reklamasjon", ["office"], false, true],
    ["leder", ["manager"], true, false],
    ["leder med reklamasjon", ["manager"], true, true],
    ["admin", ["admin"], true, false],
    ["bare admin-rollen, inspectors_edit_all av, med reklamasjon", ["admin"], false, true],
  ];

  it.each(ROLES)("%s får PDF-en (200)", async (_name, roles, editAll, withClaim) => {
    const f = await published();
    await setInspectorsEditAll(f.organizationId, editAll);
    if (withClaim) await createClaim(f.organizationId, { assignmentId: f.assignmentId });
    const { actor } = await createStaff(f.organizationId, roles);
    loggedInAs(actor);
    useFakeRender();
    expectPdfHeaders(await get(f.assignmentId, f.releaseId), "tilstandsrapport-26-0042-v1.pdf");
  });

  it("ansatt uten roller (uten organization.read) gir 404", async () => {
    const f = await published();
    const { actor } = await createStaff(f.organizationId, []);
    loggedInAs(actor);
    await expectErrorPage(await get(f.assignmentId, f.releaseId), 404, PDF_TEXTS.notFound);
  });
});

describe("GET utgivelse: taket, feil og logging (10.7.6, 11.2, 11.6)", () => {
  it("11.2.4 et utkast og en utgivelse samtidig for samme ansatt gir én 429", async () => {
    const f = await published();
    loggedInAs(f.actor);
    const hold = deferred<typeof FAKE_PDF>();
    useFakeRender(() => hold.promise);

    const release = get(f.assignmentId, f.releaseId);
    await until(() => pdfLimiter.active() === 1);
    await expectErrorPage(await getDraft(f.assignmentId), 429, PDF_TEXTS.busy);

    hold.resolve(FAKE_PDF);
    expect((await release).status).toBe(200);
    expect(await pdfEvents(f.organizationId)).toHaveLength(1);
  });

  it("feil i motoren med merketekst: 500-siden, ren logg, ingen hendelse, plassen frigis", async () => {
    const f = await published();
    await db
      .update(assignments)
      .set({ addressText: ADDRESS_MARK })
      .where(eq(assignments.id, f.assignmentId));
    loggedInAs(f.actor);
    useFakeRender(async () => {
      throw new Error(`${ADDRESS_MARK} ${DEVIATION_MARK}`);
    });
    const spy = vi.spyOn(logger, "error");

    const html = await expectErrorPage(
      await get(f.assignmentId, f.releaseId),
      500,
      PDF_TEXTS.failed,
    );
    expect(html).not.toContain("MERKE");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("MERKE");
    const fields = spy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).toMatchObject({
      route: "/oppdrag/[id]/utgivelser/[releaseId]/pdf",
      profileCode: "byggcon_standard",
      errorName: "Error",
    });
    expect(typeof fields.reportId).toBe("string");
    expect(fields).not.toHaveProperty("error");
    expect(await pdfEvents(f.organizationId)).toEqual([]);
    expect(pdfLimiter.active()).toBe(0);

    useFakeRender();
    expect((await get(f.assignmentId, f.releaseId)).status).toBe(200);
  });

  it("tidsavbrudd gir 500-siden med feilkoden i loggen", async () => {
    const f = await published();
    loggedInAs(f.actor);
    useFakeRender(async () => {
      throw new PdfRenderError("timeout");
    });
    const spy = vi.spyOn(logger, "error");
    await expectErrorPage(await get(f.assignmentId, f.releaseId), 500, PDF_TEXTS.failed);
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ errorCode: "timeout" });
    await dirs.expectEmpty();
  });

  it("11.6.1 getReleasePdfData kaster en databasefeil med parametre: loggen har bare navnet", async () => {
    const f = await published();
    loggedInAs(f.actor);
    vi.mocked(getReleasePdfData).mockRejectedValueOnce(
      Object.assign(new Error(`params: ${ADDRESS_MARK}`), {
        name: "PostgresError",
        parameters: [ADDRESS_MARK],
      }),
    );
    const spy = vi.spyOn(logger, "error");
    const html = await expectErrorPage(
      await get(f.assignmentId, f.releaseId),
      500,
      PDF_TEXTS.failed,
    );
    expect(html).not.toContain("MERKE");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("MERKE");
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ errorName: "PostgresError", reportId: null });
    expect(pdfLimiter.active()).toBe(0);
  });
});

describe("HEAD og andre metoder (11.4)", () => {
  it("HEAD svarer 405 uten gjengivelse, hendelse eller plass i taket", async () => {
    const f = await published();
    loggedInAs(f.actor);
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(getReleasePdfData).not.toHaveBeenCalled();
    expect(pdfLimiter.active()).toBe(0);
    expect(await pdfEvents(f.organizationId)).toEqual([]);
  });

  it("ruten eksporterer bare GET og HEAD (ingen POST, PUT, PATCH eller DELETE)", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "HEAD", "dynamic"]);
    const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/export\s+(async\s+)?(function|const)\s+(POST|PUT|PATCH|DELETE)\b/);
  });
});
