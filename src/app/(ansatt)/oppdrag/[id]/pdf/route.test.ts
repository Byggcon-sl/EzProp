import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { PdfRenderError, renderReportPdf, type RenderReportPdf } from "@/core/pdf";
import { createNodeWorkerEngine } from "@/core/pdf/engine.node";
import { createReportPdfRenderer } from "@/core/pdf/render";
import { getReportDraftPdfData } from "@/core/reports";
import { db } from "@/db/client";
import { assignments, reports, type EmployeeRole } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { createClaim, createUser, resetDatabase } from "../../../../../../tests/factories";
import { createDeactivatedEmployee } from "../../../../../../tests/offline-trial";
import { inspectPdf } from "../../../../../../tests/pdf-inspect";
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
  until,
} from "../../../../../../tests/pdf-route";
import {
  createStaff,
  setInspectorsEditAll,
  startedBathroom,
} from "../../../../../../tests/report-fixtures";
import { pdfLimiter } from "./pdf-response";
import * as routeModule from "./route";

const { GET, HEAD } = routeModule;

/*
 * Ruten for PDF-utkastet, GET /oppdrag/[id]/pdf (docs/funksjoner/fase2a-pdf-badet.md Omfang 6 og
 * 8; testplan 6.1–6.5, 10.5, 11.2–11.4 og 11.6). Innloggingen er mocket. Tilgangen og dataene
 * (`getReportDraftPdfData`) og motoren kjøres ekte mot testdatabasen; gjengivelsen byttes bare der
 * testen trenger å holde den igjen eller la den feile. Alle data er oppdiktede.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn(), LOGIN_PATH: "/logg-inn" }));
vi.mock("@/core/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/pdf")>();
  return { ...actual, renderReportPdf: vi.fn(actual.renderReportPdf) };
});
vi.mock("@/core/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/reports")>();
  return { ...actual, getReportDraftPdfData: vi.fn(actual.getReportDraftPdfData) };
});

const actualPdf = await vi.importActual<typeof import("@/core/pdf")>("@/core/pdf");
const actualReports = await vi.importActual<typeof import("@/core/reports")>("@/core/reports");

const ADDRESS_MARK = "Merkevegen 99 MERKE-ADRESSE";
const DEVIATION_MARK = "MERKE-AVVIKSTEKST lekkasje";
const CAPTION_MARK = "MERKE-BILDETEKST sluk";
const FAKE_PDF = { bytes: new TextEncoder().encode("%PDF-1.7 falsk"), pageCount: 3, imageCount: 2 };

let crashDir: string;
let dirs: Awaited<ReturnType<typeof isolatedDirs>>;

beforeAll(async () => {
  // Arbeidstråder som krasjer: kaster med merketekst, og avslutter prosessen sin
  crashDir = await mkdtemp(path.join(os.tmpdir(), "pdf-crash-worker-"));
  await writeFile(
    path.join(crashDir, "throws.mjs"),
    `throw new Error(${JSON.stringify(`${ADDRESS_MARK} ${DEVIATION_MARK}`)});\n`,
  );
  await writeFile(path.join(crashDir, "exits.mjs"), "process.exit(3);\n");
});
afterAll(async () => {
  await rm(crashDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
  vi.mocked(renderReportPdf).mockReset();
  vi.mocked(renderReportPdf).mockImplementation(actualPdf.renderReportPdf);
  vi.mocked(getReportDraftPdfData).mockReset();
  vi.mocked(getReportDraftPdfData).mockImplementation(actualReports.getReportDraftPdfData);
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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function get(assignmentId: string, init: Parameters<typeof pdfRequest>[1] = {}) {
  return GET(pdfRequest(draftPath(assignmentId), init), params(assignmentId));
}

function useFakeRender(implementation?: RenderReportPdf) {
  vi.mocked(renderReportPdf).mockImplementation(implementation ?? (async () => FAKE_PDF));
}

async function setAssignment(
  assignmentId: string,
  values: Partial<typeof assignments.$inferInsert>,
) {
  await db.update(assignments).set(values).where(eq(assignments.id, assignmentId));
}

async function reportIdOf(assignmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.assignmentId, assignmentId));
  return row?.id ?? null;
}

async function bathroom(options: Parameters<typeof startedBathroom>[0] = {}) {
  const f = await startedBathroom(options);
  await setAssignment(f.assignmentId, { number: "26-0042" });
  return f;
}

describe("GET /oppdrag/[id]/pdf: svaret (6.1)", () => {
  it("6.1.1 takstmann får PDF-en med riktige svarhoder og UTKAST på hver side", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const filesBefore = await fileRowCount();

    const response = await get(f.assignmentId);

    expectPdfHeaders(response, "utkast-26-0042.pdf");
    const bytes = await bodyBytes(response);
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    const pdf = inspectPdf(bytes);
    expect(pdf.pages.length).toBeGreaterThan(1);
    for (const page of pdf.pages) expect(page.text).toContain("UTKAST");
    // 6.2: ingenting lagres
    expect(await fileRowCount()).toBe(filesBefore);
    await dirs.expectEmpty();
  });

  it("6.1.1 filnavnet har bare sifre og bindestrek fra oppdragsnummeret", async () => {
    const f = await bathroom();
    await setAssignment(f.assignmentId, { number: 'OPPDRAG 26/0042"; x=<b>' });
    loggedInAs(f.actor);
    useFakeRender();
    const response = await get(f.assignmentId);
    expectPdfHeaders(response, "utkast-260042.pdf");
  });

  it("6.3.1 nøyaktig én hendelse med bare de tillatte feltene", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const response = await get(f.assignmentId);
    expect(response.status).toBe(200);
    const reportId = await reportIdOf(f.assignmentId);

    const rows = await pdfEvents(f.organizationId);
    expect(rows).toHaveLength(1);
    const [event] = rows;
    expect(event?.type).toBe("report.draft_pdf_created");
    expect(event?.organizationId).toBe(f.organizationId);
    expect(event?.actorId).toBe(f.employeeId);
    expect(event?.reportId).toBe(reportId);
    const data = event?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      ["durationMs", "imageCount", "pageCount", "profileCode", "reportId"].sort(),
    );
    expect(data.reportId).toBe(reportId);
    expect(data.profileCode).toBe("byggcon_standard");
    expect(data.pageCount).toBeGreaterThan(1);
    expect(data.imageCount).toBe(0);
    expect(Number.isInteger(data.durationMs)).toBe(true);
  });

  it("10.5.1 forfalsket Host og X-Forwarded-Host endrer ikke lenkene", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const response = await get(f.assignmentId, {
      headers: { Host: "angriper.example", "X-Forwarded-Host": "angriper.example" },
    });
    expect(response.status).toBe(200);
    const options = vi.mocked(renderReportPdf).mock.calls[0]?.[2];
    expect(options?.appBaseUrl).toBe(getEnv().BETTER_AUTH_URL);
    expect(options?.draft).toBe(true);
    const pdf = inspectPdf(await bodyBytes(response));
    const uris = pdf.pages.flatMap((page) => page.links.map((link) => link.uri ?? ""));
    expect(uris.join(" ")).not.toContain("angriper");
    for (const uri of uris.filter(Boolean)) {
      expect(uri.startsWith(getEnv().BETTER_AUTH_URL)).toBe(true);
    }
  });
});

describe("GET /oppdrag/[id]/pdf: innlogging og tilgang (6.1.3–6.1.5, 10.1, 11.5)", () => {
  it("6.1.3 ikke innlogget: videresending til innlogging, ingen PDF, ingen plass i taket", async () => {
    const f = await bathroom();
    loggedInAs(null);
    const response = await get(f.assignmentId);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/logg-inn?neste=${encodeURIComponent(draftPath(f.assignmentId))}`,
    );
    expect(response.headers.get("content-type")).toBeNull();
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(getReportDraftPdfData).not.toHaveBeenCalled();
  });

  it("6.1.4 organisasjon B med oppdrags-id-en til A får 404, uten hendelse", async () => {
    const a = await bathroom();
    const b = await bathroom();
    loggedInAs(b.actor);
    const response = await get(a.assignmentId);
    await expectErrorPage(response, 404, PDF_TEXTS.notFound);
    expect(renderReportPdf).not.toHaveBeenCalled();
    // Spørringen fikk organisasjonen fra tilgangssjekken til B, aldri en id fra adressen
    expect(vi.mocked(getReportDraftPdfData).mock.calls[0]?.[1]).toBe(b.organizationId);
    expect(await pdfEvents(a.organizationId)).toEqual([]);
    expect(await pdfEvents(b.organizationId)).toEqual([]);
  });

  it.each([
    ["ugyldig id", async () => "ikke-en-id"],
    ["ukjent id", async () => uuidv7()],
    [
      "slettet oppdrag",
      async (assignmentId: string) => {
        await setAssignment(assignmentId, { deletedAt: new Date() });
        return assignmentId;
      },
    ],
    [
      "erstattet rapport (superseded)",
      async (assignmentId: string) => {
        await db
          .update(reports)
          .set({ status: "superseded" })
          .where(eq(reports.assignmentId, assignmentId));
        return assignmentId;
      },
    ],
  ])("6.1.5 %s gir samme 404-side", async (_name, prepare) => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const id = await prepare(f.assignmentId);
    await expectErrorPage(await get(id), 404, PDF_TEXTS.notFound);
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(await pdfEvents(f.organizationId)).toEqual([]);
  });

  it("innlogget uten ansettelse gir 404", async () => {
    const f = await bathroom();
    loggedInAs(await createUser({ name: "Oppdiktet uten ansettelse" }));
    await expectErrorPage(await get(f.assignmentId), 404, PDF_TEXTS.notFound);
  });

  it("ansatt som har sluttet gir 404", async () => {
    const f = await bathroom();
    loggedInAs(await createDeactivatedEmployee(f.organizationId));
    await expectErrorPage(await get(f.assignmentId), 404, PDF_TEXTS.notFound);
  });

  it("10.1.1 publisert rapport gir utkast med UTKAST", async () => {
    const f = await bathroom();
    await db
      .update(reports)
      .set({ status: "published" })
      .where(eq(reports.assignmentId, f.assignmentId));
    loggedInAs(f.actor);
    useFakeRender();
    expect((await get(f.assignmentId)).status).toBe(200);
    expect(vi.mocked(renderReportPdf).mock.calls[0]?.[0].kind).toBe("draft");
  });
});

describe("GET /oppdrag/[id]/pdf: rollematrise (5.2, A531)", () => {
  const ROLES: [string, EmployeeRole[], boolean, boolean][] = [
    ["takstmann", ["inspector"], true, false],
    ["takstmann, inspectors_edit_all av", ["inspector"], false, false],
    ["takstmann med reklamasjon på oppdraget", ["inspector"], true, true],
    ["kontor", ["office"], true, false],
    ["kontor med reklamasjon", ["office"], true, true],
    ["leder", ["manager"], true, false],
    ["leder med reklamasjon", ["manager"], true, true],
    ["admin", ["admin"], true, false],
    ["bare admin-rollen, inspectors_edit_all av", ["admin"], false, true],
  ];

  it.each(ROLES)("%s får PDF-en (200)", async (_name, roles, editAll, withClaim) => {
    const f = await bathroom();
    await setInspectorsEditAll(f.organizationId, editAll);
    if (withClaim) await createClaim(f.organizationId, { assignmentId: f.assignmentId });
    const { actor } = await createStaff(f.organizationId, roles);
    loggedInAs(actor);
    useFakeRender();
    const response = await get(f.assignmentId);
    expectPdfHeaders(response, "utkast-26-0042.pdf");
  });

  it("med og uten reklamasjon gir samme data til gjengivelsen", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    useFakeRender();
    await get(f.assignmentId);
    await createClaim(f.organizationId, { assignmentId: f.assignmentId });
    await get(f.assignmentId);
    const [first, second] = vi.mocked(renderReportPdf).mock.calls;
    expect(second?.[0]).toEqual(first?.[0]);
  });

  it("ansatt uten roller (uten organization.read) gir 404", async () => {
    const f = await bathroom();
    const { actor } = await createStaff(f.organizationId, []);
    loggedInAs(actor);
    await expectErrorPage(await get(f.assignmentId), 404, PDF_TEXTS.notFound);
  });
});

describe("GET /oppdrag/[id]/pdf: taket (6.1.7, 10.5.3, 11.2)", () => {
  it("6.1.7 to samtidige for samme ansatt: én 200 og én 429", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const hold = deferred<typeof FAKE_PDF>();
    useFakeRender(() => hold.promise);

    const first = get(f.assignmentId);
    await until(() => pdfLimiter.active() === 1);
    const second = await get(f.assignmentId);
    const html = await expectErrorPage(second, 429, PDF_TEXTS.busy);
    expect(second.headers.get("retry-after")).toBe("5");
    expect(html).toContain(PDF_TEXTS.busy);

    hold.resolve(FAKE_PDF);
    expect((await first).status).toBe(200);
    expect(await pdfEvents(f.organizationId)).toHaveLength(1);
  });

  it("felles tak 2: den tredje ansatte får 429", async () => {
    const f = await bathroom();
    const others = [
      f.actor,
      (await createStaff(f.organizationId, ["inspector"])).actor,
      (await createStaff(f.organizationId, ["manager"])).actor,
    ];
    const hold = deferred<typeof FAKE_PDF>();
    useFakeRender(() => hold.promise);

    vi.mocked(getCurrentActor).mockResolvedValueOnce(others[0] ?? null);
    const first = get(f.assignmentId);
    await until(() => pdfLimiter.active() === 1);
    vi.mocked(getCurrentActor).mockResolvedValueOnce(others[1] ?? null);
    const second = get(f.assignmentId);
    await until(() => pdfLimiter.active() === 2);
    vi.mocked(getCurrentActor).mockResolvedValueOnce(others[2] ?? null);
    await expectErrorPage(await get(f.assignmentId), 429, PDF_TEXTS.busy);

    hold.resolve(FAKE_PDF);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("10.5.3 ikke innlogget og 404 tar ikke plass: et gyldig kall slipper til etterpå", async () => {
    const f = await bathroom();
    useFakeRender();
    loggedInAs(null);
    expect((await get(f.assignmentId)).status).toBe(303);
    loggedInAs(f.actor);
    expect((await get(uuidv7())).status).toBe(404);
    expect(pdfLimiter.active()).toBe(0);
    expect((await get(f.assignmentId)).status).toBe(200);
  });

  it("11.2.2 avbrutt forbindelse: ingen hendelse, plassen frigis, neste kall slipper til", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const hold = deferred<typeof FAKE_PDF>();
    useFakeRender(() => hold.promise);
    const controller = new AbortController();

    const pending = get(f.assignmentId, { signal: controller.signal });
    await until(() => pdfLimiter.active() === 1);
    controller.abort();
    hold.resolve(FAKE_PDF);
    const response = await pending;
    expect(response.status).toBe(499);
    expect(pdfLimiter.active()).toBe(0);
    expect(await pdfEvents(f.organizationId)).toEqual([]);

    useFakeRender();
    expect((await get(f.assignmentId)).status).toBe(200);
  });

  it("avbrutt før gjengivelsen: ingenting lages", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const controller = new AbortController();
    controller.abort();
    const response = await get(f.assignmentId, { signal: controller.signal });
    expect(response.status).toBe(499);
    expect(renderReportPdf).not.toHaveBeenCalled();
  });
});

describe("GET /oppdrag/[id]/pdf: feil i motoren og logging (6.1.6, 6.1.8, 6.4, 11.3, 11.6)", () => {
  async function markedBathroom() {
    const f = await bathroom();
    await setAssignment(f.assignmentId, { addressText: ADDRESS_MARK });
    return f;
  }

  function expectCleanLog(spy: ReturnType<typeof vi.spyOn>, reportId: string | null) {
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    for (const mark of [ADDRESS_MARK, DEVIATION_MARK, CAPTION_MARK, "MERKE", "stack", "at "]) {
      expect(logged).not.toContain(mark);
    }
    const fields = spy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields.profileCode).toBe("byggcon_standard");
    expect(fields.reportId).toBe(reportId);
    expect(Object.keys(fields).sort()).toEqual(
      expect.arrayContaining(["profileCode", "reportId", "route"]),
    );
    expect(fields).not.toHaveProperty("error");
    return fields;
  }

  it.each([
    ["en arbeidstråd som kaster", "throws.mjs"],
    ["en arbeidstråd som avslutter seg selv (krasj)", "exits.mjs"],
  ])("11.3.2 %s gir 500-siden uten motorens melding, og plassen frigis", async (_name, file) => {
    const f = await markedBathroom();
    loggedInAs(f.actor);
    useFakeRender(createReportPdfRenderer(createNodeWorkerEngine(path.join(crashDir, file))));
    const spy = vi.spyOn(logger, "error");
    const filesBefore = await fileRowCount();

    const response = await get(f.assignmentId);
    const html = await expectErrorPage(response, 500, PDF_TEXTS.failed);
    expect(html).not.toContain("MERKE");
    const fields = expectCleanLog(spy, await reportIdOf(f.assignmentId));
    expect(fields.errorCode).toBe("engine_failed");
    expect(pdfLimiter.active()).toBe(0);
    expect(await pdfEvents(f.organizationId)).toEqual([]);
    expect(await fileRowCount()).toBe(filesBefore);
    await dirs.expectEmpty();

    useFakeRender();
    expect((await get(f.assignmentId)).status).toBe(200);
  });

  it("6.1.8 tidsavbrudd gir 500-siden og frigir plassen", async () => {
    const f = await markedBathroom();
    loggedInAs(f.actor);
    useFakeRender(async () => {
      throw new PdfRenderError("timeout");
    });
    const spy = vi.spyOn(logger, "error");
    await expectErrorPage(await get(f.assignmentId), 500, PDF_TEXTS.failed);
    expect(expectCleanLog(spy, await reportIdOf(f.assignmentId)).errorCode).toBe("timeout");
    expect(pdfLimiter.active()).toBe(0);
    await dirs.expectEmpty();
  });

  it("6.4.1 motorfeil med merketekster i meldingen: verken loggen eller svaret har dem", async () => {
    const f = await markedBathroom();
    loggedInAs(f.actor);
    useFakeRender(async () => {
      throw new Error(`${ADDRESS_MARK} ${DEVIATION_MARK} ${CAPTION_MARK}`);
    });
    const spy = vi.spyOn(logger, "error");
    const html = await expectErrorPage(await get(f.assignmentId), 500, PDF_TEXTS.failed);
    expect(html).not.toContain("MERKE");
    const fields = expectCleanLog(spy, await reportIdOf(f.assignmentId));
    expect(fields.errorName).toBe("Error");
  });

  it.each([
    ["feil med merketekst", () => new Error(`${ADDRESS_MARK} ${DEVIATION_MARK}`)],
    [
      "databasefeil med parametre",
      () =>
        Object.assign(new Error(`insert failed params: ${ADDRESS_MARK}`), {
          name: "PostgresError",
          parameters: [ADDRESS_MARK, CAPTION_MARK],
          query: `select '${DEVIATION_MARK}'`,
        }),
    ],
    [
      "feil med tekst i navnet",
      () => Object.assign(new Error("x"), { name: `${ADDRESS_MARK} feil` }),
    ],
  ])("11.6.1 getReportDraftPdfData kaster %s: loggen har bare navnet", async (_name, make) => {
    const f = await markedBathroom();
    loggedInAs(f.actor);
    vi.mocked(getReportDraftPdfData).mockRejectedValueOnce(make());
    const spy = vi.spyOn(logger, "error");
    const html = await expectErrorPage(await get(f.assignmentId), 500, PDF_TEXTS.failed);
    expect(html).not.toContain("MERKE");
    const fields = expectCleanLog(spy, null);
    expect(["Error", "PostgresError"]).toContain(fields.errorName);
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(pdfLimiter.active()).toBe(0);
  });
});

describe("HEAD og andre metoder (6.1.2, 11.4)", () => {
  it("11.4.1 HEAD svarer 405 uten gjengivelse, hendelse eller plass i taket", async () => {
    const f = await bathroom();
    loggedInAs(f.actor);
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(getReportDraftPdfData).not.toHaveBeenCalled();
    expect(pdfLimiter.active()).toBe(0);
    expect(await pdfEvents(f.organizationId)).toEqual([]);
  });

  it("6.1.2 ruten eksporterer bare GET og HEAD (ingen POST, PUT, PATCH eller DELETE)", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "HEAD", "dynamic"]);
    const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/export\s+(async\s+)?(function|const)\s+(POST|PUT|PATCH|DELETE)\b/);
  });
});
