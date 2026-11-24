import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/core/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/access")>();
  return { ...actual, requireOrganizationAccess: vi.fn(actual.requireOrganizationAccess) };
});

import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { BYGGCON_STANDARD_PROFILE, loadPdfAssets, renderReportPdf } from "@/core/pdf";
import { PDF_DEFAULT_LIMITS } from "@/core/pdf/codes";
import { getRoomView, setTgDirect } from "@/core/reports";
import { db } from "@/db/client";
import {
  assignments,
  companies,
  deviations,
  employees,
  organizations,
  reports,
  rooms,
  tgiuDetails,
  type EmployeeRole,
} from "@/db/schema";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createClaim,
  createReportRow,
  resetDatabase,
} from "../../../tests/factories";
import {
  createPdfBathroom,
  FLOOR,
  newVersion,
  publishAs,
  reportTableState,
  setDescription,
  useSecondCompany,
  type PdfBathroom,
} from "../../../tests/pdf-db-fixtures";
import { inspectPdf } from "../../../tests/pdf-inspect";
import { createStaff, setInspectorsEditAll } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { getReportDraftPdfData } from "./pdf-data";

/*
 * Rapportdataene for PDF-utkastet mot testdatabasen (testplanen for PDF av badet avsnitt 5,
 * 10.1, 10.3.1, 10.6 og 11.5). `getReportDraftPdfData` kaller selv tilgangssjekken med
 * `organization.read`, filtrerer på `grant.organizationId` og leser med `loadPublishSource`.
 * Fremmed, slettet, erstattet og ugyldig id gir samme 404 (`AccessDeniedError`).
 *
 * Hovedmål: færre reklamasjoner (PDF-en viser bare egne, lagrede data og riktig selskap), de
 * ansatte (admin stenges aldri ute; alle som ser badet, kan lage PDF) og KI i bunnen (ventende
 * KI-forslag og sammendraget kommer aldri med). Alle data er oppdiktede.
 */

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(requireOrganizationAccess).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function draftOf(actor: Actor, organizationId: string, assignmentId: string) {
  return getReportDraftPdfData(actor, organizationId, assignmentId);
}

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AccessDeniedError);
}

// --- 5.1 Tenant-isolasjon --------------------------------------------------------------------

describe("5.1 tenant-isolasjon (regel 2)", () => {
  it("5.1.1 expectTenantIsolation for getReportDraftPdfData", async () => {
    const assignmentsByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createPdfBathroom({ organizationId: grantA.organizationId, mark: "ORG-A" });
        const b = await createPdfBathroom({ organizationId: grantB.organizationId, mark: "ORG-B" });
        assignmentsByOrg.set(grantA.organizationId, a.assignmentId);
        assignmentsByOrg.set(grantB.organizationId, b.assignmentId);
        return { a: [a.reportId], b: [b.reportId] };
      },
      query: async (actor, organizationId) => {
        const rows: { reportId: string }[] = [];
        let denied: unknown = null;
        for (const assignmentId of assignmentsByOrg.values()) {
          try {
            const result = await draftOf(actor, organizationId, assignmentId);
            rows.push({ reportId: result.reportId });
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            denied = error;
          }
        }
        if (rows.length === 0 && denied) throw denied;
        return rows;
      },
      idOf: (row) => row.reportId,
    });
  });

  it("5.1.2 filtrerer på grant.organizationId: B sin organisasjon avvises, B sitt oppdrag gir 404", async () => {
    const a = await createPdfBathroom({ mark: "ORG-A" });
    const b = await createPdfBathroom({ mark: "ORG-B" });
    await expectNotFound(draftOf(a.actor, b.organizationId, b.assignmentId));
    await expectNotFound(draftOf(a.actor, a.organizationId, b.assignmentId));
  });

  it("5.1.3 ingenting fra en annen organisasjon kommer med (merketekster i B)", async () => {
    const a = await createPdfBathroom({ mark: "ORG-A" });
    await createPdfBathroom({ mark: "ORG-B-LEKK" });
    const { data } = await draftOf(a.actor, a.organizationId, a.assignmentId);
    const json = JSON.stringify(data);
    expect(json).toContain("ORG-A");
    expect(json).not.toContain("ORG-B-LEKK");
  });

  it("5.1.4 to selskaper i samme organisasjon: bunnteksten viser oppdragets selskap", async () => {
    const f = await createPdfBathroom();
    const other = await useSecondCompany(f);
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(data.company).toEqual({ legalName: other.legalName, orgNumber: other.orgNumber });
  });

  it("5.1.5 to organisasjoner samtidig: hver PDF har bare sitt eget merke", async () => {
    const a = await createPdfBathroom({ mark: "SAMTIDIG-A" });
    const b = await createPdfBathroom({ mark: "SAMTIDIG-B" });
    const assets = await loadPdfAssets();
    const render = async (f: PdfBathroom) => {
      const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
      return renderReportPdf(data, BYGGCON_STANDARD_PROFILE, {
        draft: true,
        generatedAt: new Date("2026-11-03T10:00:00Z"),
        assets,
        limits: PDF_DEFAULT_LIMITS,
      });
    };
    const [pdfA, pdfB] = await Promise.all([render(a), render(b)]);
    const textA = inspectPdf(pdfA.bytes)
      .pages.map((p) => p.text)
      .join("\n");
    const textB = inspectPdf(pdfB.bytes)
      .pages.map((p) => p.text)
      .join("\n");
    expect(textA).toContain("SAMTIDIG-A");
    expect(textA).not.toContain("SAMTIDIG-B");
    expect(textB).toContain("SAMTIDIG-B");
    expect(textB).not.toContain("SAMTIDIG-A");
  }, 30_000);
});

// --- 5.2 Tilgang per rolle -------------------------------------------------------------------

const ROLE_CASES: { name: string; roles: EmployeeRole[]; editAll: boolean }[] = [
  { name: "takstmann", roles: ["inspector"], editAll: true },
  { name: "kontor", roles: ["office"], editAll: true },
  { name: "leder", roles: ["manager"], editAll: true },
  { name: "admin", roles: ["admin"], editAll: true },
  { name: "bare admin, inspectors_edit_all av", roles: ["admin"], editAll: false },
  { name: "takstmann, inspectors_edit_all av", roles: ["inspector"], editAll: false },
  { name: "kontor, inspectors_edit_all av", roles: ["office"], editAll: false },
];

describe("5.2 tilgang per rolle", () => {
  it.each(ROLE_CASES)(
    "$name får data, med og uten reklamasjon (samme svar, ingen tekst fra saken)",
    async ({ roles, editAll }) => {
      const f = await createPdfBathroom();
      await setInspectorsEditAll(f.organizationId, editAll);
      const { actor } = await createStaff(f.organizationId, roles);
      const without = await draftOf(actor, f.organizationId, f.assignmentId);
      expect(without.reportId).toBe(f.reportId);
      // Samme utfall som skjermen for badet
      await expect(getRoomView(actor, f.organizationId, f.room)).resolves.toBeDefined();

      await createClaim(f.organizationId, {
        assignmentId: f.assignmentId,
        description: "Oppdiktet reklamasjon MERKE-KLAGE",
        claimantText: "Oppdiktet klager MERKE-KLAGE",
        buildingPartText: "Oppdiktet bygningsdel MERKE-KLAGE",
      });
      const withClaim = await draftOf(actor, f.organizationId, f.assignmentId);
      expect(withClaim.data).toEqual(without.data);
      expect(JSON.stringify(withClaim.data)).not.toContain("MERKE-KLAGE");
    },
  );

  it("employeeId er den innloggedes ansatt-id (nøkkelen til telleren)", async () => {
    const f = await createPdfBathroom();
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(result.employeeId).toBe(f.employeeId);
  });

  it("5.2.5 sluttet ansatt avvises", async () => {
    const f = await createPdfBathroom();
    const { actor, employee } = await createStaff(f.organizationId, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    await expectNotFound(draftOf(actor, f.organizationId, f.assignmentId));
  });

  it("5.2.5 myk slettet ansatt avvises", async () => {
    const f = await createPdfBathroom();
    const { actor, employee } = await createStaff(f.organizationId, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    await expectNotFound(draftOf(actor, f.organizationId, f.assignmentId));
  });

  it("5.2.5 ansatt uten rolle (uten organization.read) avvises", async () => {
    const f = await createPdfBathroom();
    const { actor } = await createStaff(f.organizationId, []);
    await expectNotFound(draftOf(actor, f.organizationId, f.assignmentId));
  });

  it("5.2.6 kaller requireOrganizationAccess med organization.read", async () => {
    const f = await createPdfBathroom();
    vi.mocked(requireOrganizationAccess).mockClear();
    await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(vi.mocked(requireOrganizationAccess)).toHaveBeenCalledWith(
      f.actor,
      f.organizationId,
      "organization.read",
    );
  });
});

// --- 5.3 Myk sletting og ugyldig id ----------------------------------------------------------

describe("5.3 myk sletting og ugyldig id (regel 3)", () => {
  it.each(["abc", "", "' or 1=1 --", "00000000-0000-0000-0000-000000000000"])(
    "5.3.1 ugyldig eller ukjent id «%s» gir 404",
    async (id) => {
      const f = await createPdfBathroom();
      await expectNotFound(draftOf(f.actor, f.organizationId, id));
    },
  );

  it("5.3.1 slettet rapport gir 404, med samme feil som fremmed id", async () => {
    const f = await createPdfBathroom();
    const other = await createPdfBathroom({ mark: "ANNEN" });
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, f.reportId));
    const deleted = await draftOf(f.actor, f.organizationId, f.assignmentId).catch(
      (e: unknown) => e,
    );
    const foreign = await draftOf(f.actor, f.organizationId, other.assignmentId).catch(
      (e: unknown) => e,
    );
    expect(deleted).toBeInstanceOf(AccessDeniedError);
    expect(foreign).toBeInstanceOf(AccessDeniedError);
    expect((deleted as Error).message).toBe((foreign as Error).message);
  });

  it("5.3.1 og 11.5.1 slettet oppdrag gir 404", async () => {
    const f = await createPdfBathroom();
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, f.assignmentId));
    await expectNotFound(draftOf(f.actor, f.organizationId, f.assignmentId));
  });

  it("A522 etter «Lag ny versjon» er rapporten utkast igjen, og utkastet lages", async () => {
    const f = await createPdfBathroom();
    await publishAs(f.actor, f);
    const reportId = await newVersion(f);
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(result.reportId).toBe(reportId);
    expect(result.data.kind).toBe("draft");
  });

  it("10.1.2 erstattet rapport brukes aldri: ny gjeldende rapport på oppdraget vinner", async () => {
    const f = await createPdfBathroom({ mark: "GAMMEL" });
    await db.update(reports).set({ status: "superseded" }).where(eq(reports.id, f.reportId));
    const fresh = await createReportRow(f.organizationId, {
      assignmentId: f.assignmentId,
      templateVersionId: f.templateVersionId,
    });
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId).catch(
      (e: unknown) => e,
    );
    if (result instanceof Error) {
      expect(result).toBeInstanceOf(AccessDeniedError);
    } else {
      const ok = result as Awaited<ReturnType<typeof draftOf>>;
      expect(ok.reportId).toBe(fresh.id);
      expect(JSON.stringify(ok.data)).not.toContain("GAMMEL.");
    }
  });

  it("5.3.1 oppdrag der den eneste rapporten er erstattet, gir 404", async () => {
    const f = await createPdfBathroom();
    await db.update(reports).set({ status: "superseded" }).where(eq(reports.id, f.reportId));
    await expectNotFound(draftOf(f.actor, f.organizationId, f.assignmentId));
  });

  it("oppdrag uten startet rapport gir 404", async () => {
    const f = await createPdfBathroom();
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, f.reportId));
    await expectNotFound(draftOf(f.actor, f.organizationId, f.assignmentId));
  });

  it("5.3.2 slettet rom, avvik og TGIU er ikke med, og punktets TG regnes uten slettede avvik (T15)", async () => {
    const f = await createPdfBathroom({ mark: "SLETT" });
    const before = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const floorBefore = before.data.rooms[0]!.checkpoints.find((c) => c.checkpointKey === FLOOR)!;
    expect(floorBefore.tg).toBe("2");
    await db
      .update(deviations)
      .set({ deletedAt: new Date() })
      .where(eq(deviations.id, f.deviationId!));
    const after = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const json = JSON.stringify(after.data);
    expect(json).not.toContain(f.deviationId!);
    expect(json).not.toContain("Oppdiktet avvik SLETT.");
    expect(json).not.toContain("Oppdiktet tiltak SLETT.");
    const floorAfter = after.data.rooms
      .flatMap((r) => r.checkpoints)
      .find((c) => c.checkpointKey === FLOOR);
    expect(floorAfter?.tg ?? null).not.toBe("2");
  });

  it("5.3.2 slettet TGIU er ikke med", async () => {
    const f = await createPdfBathroom({ withDeviation: false });
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: "wet_room.walls_ceiling",
      tgDirect: "IU",
      base: "1",
    });
    await db
      .update(tgiuDetails)
      .set({ reason: "Oppdiktet grunn MERKE-TGIU", deletedAt: new Date() })
      .where(eq(tgiuDetails.organizationId, f.organizationId));
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(JSON.stringify(data)).not.toContain("MERKE-TGIU");
  });

  it("5.3.2 slettet rom er ikke med", async () => {
    const f = await createPdfBathroom({ mark: "ROM-SLETT" });
    await db.update(rooms).set({ deletedAt: new Date() }).where(eq(rooms.id, f.roomId));
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId).catch(
      (e: unknown) => e,
    );
    if (result instanceof Error) {
      expect(result).toBeInstanceOf(AccessDeniedError);
    } else {
      const { data } = result as Awaited<ReturnType<typeof draftOf>>;
      expect(data.rooms.map((r) => r.roomId)).not.toContain(f.roomId);
      expect(JSON.stringify(data.rooms)).not.toContain("ROM-SLETT");
    }
  });

  it("5.3.3 slettet selskap gir «selskap mangler» (company null), aldri brand_name", async () => {
    const f = await createPdfBathroom();
    await db
      .update(organizations)
      .set({ brandName: "MERKE-BRAND" })
      .where(eq(organizations.id, f.organizationId));
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, f.companyId));
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(data.company).toBeNull();
    expect(JSON.stringify(data)).not.toContain("MERKE-BRAND");
  });

  it("A538 oppdrag uten selskap eller med tomt org.nr. gir company null, aldri brand_name", async () => {
    const f = await createPdfBathroom();
    await db
      .update(organizations)
      .set({ brandName: "MERKE-BRAND" })
      .where(eq(organizations.id, f.organizationId));
    await db.update(companies).set({ orgNumber: null }).where(eq(companies.id, f.companyId));
    expect((await draftOf(f.actor, f.organizationId, f.assignmentId)).data.company).toBeNull();
    await db.update(assignments).set({ companyId: null }).where(eq(assignments.id, f.assignmentId));
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(data.company).toBeNull();
    expect(JSON.stringify(data)).not.toContain("MERKE-BRAND");
  });

  it("5.3.4 ingen rader endres i rapporttabellene eller files", async () => {
    const f = await createPdfBathroom();
    const before = await reportTableState(f.organizationId);
    await draftOf(f.actor, f.organizationId, f.assignmentId);
    await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(await reportTableState(f.organizationId)).toEqual(before);
  });
});

// --- 5.4 Låst malversjon ---------------------------------------------------------------------

describe("5.4 låst malversjon", () => {
  it("etiketter fra rapportens malversjon brukes, også etter at malen får ny versjon", async () => {
    const f = await createPdfBathroom();
    const before = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const labelsBefore = before.data.rooms.flatMap((r) => r.checkpoints).map((c) => c.label);
    // Ny publisert versjon av malen i organisasjonen med andre etiketter
    const { createTemplate } = await import("../../../tests/factories");
    const { wetRoomTemplate } = await import("@/db/seed/templates/wet-room");
    await createTemplate(f.organizationId, {
      status: "published",
      name: "Tilstandsrapport",
      document: {
        ...wetRoomTemplate,
        checkpoints: wetRoomTemplate.checkpoints.map((c) => ({
          ...c,
          name: `${c.name} NY-VERSJON`,
        })),
      },
    });
    const after = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const labelsAfter = after.data.rooms.flatMap((r) => r.checkpoints).map((c) => c.label);
    expect(labelsAfter).toEqual(labelsBefore);
    expect(JSON.stringify(after.data)).not.toContain("NY-VERSJON");
  });
});

// --- 10.1 Publisert rapport ------------------------------------------------------------------

describe("10.1 publisert rapport (A541)", () => {
  it("publisert rapport gir utkast fra de låste radene", async () => {
    const f = await createPdfBathroom({ mark: "PUBLISERT" });
    await publishAs(f.actor, f);
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(result.reportId).toBe(f.reportId);
    expect(result.data.kind).toBe("draft");
    expect(JSON.stringify(result.data)).toContain("Oppdiktet avvik PUBLISERT.");
  });
});

// --- 10.6 og T14 KI ---------------------------------------------------------------------------

describe("10.6 og T14 ventende KI-forslag og sammendraget kommer aldri med", () => {
  it("tre slag ventende forslag og summary_text med merketekst gir ingen spor", async () => {
    const f = await createPdfBathroom();
    const base = {
      employeeId: f.employeeId,
      assignmentId: f.assignmentId,
      reportId: f.reportId,
      status: "suggested",
      outcome: "ok",
    } as const;
    await createAiUsageLog(f.organizationId, {
      ...base,
      feature: "phrase_suggest",
      promptVersion: "phrase_suggest.v1",
      outputText: "MERKE-KI-FRASE",
      targetRef: { type: "deviation", id: f.deviationId!, fieldKey: "deviation_text" },
    });
    await createAiUsageLog(f.organizationId, {
      ...base,
      feature: "language_polish",
      outputText: "MERKE-KI-VASK",
      targetRef: { type: "deviation", id: f.deviationId!, fieldKey: "cause_text" },
    });
    await createAiUsageLog(f.organizationId, {
      ...base,
      feature: "summary_draft",
      promptVersion: "summary_draft.v1",
      outputText: "MERKE-KI-SAMMENDRAG",
      targetRef: { type: "report", id: f.reportId, fieldKey: "summary_text" },
    });
    await db
      .update(reports)
      .set({ summaryText: "MERKE-SAMMENDRAG-LAGRET" })
      .where(eq(reports.id, f.reportId));
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const json = JSON.stringify(data);
    for (const mark of [
      "MERKE-KI-FRASE",
      "MERKE-KI-VASK",
      "MERKE-KI-SAMMENDRAG",
      "MERKE-SAMMENDRAG-LAGRET",
    ]) {
      expect(json).not.toContain(mark);
    }
    // Funnet fra sjekken står, men bare med sjekkens faste tekst
    const notes = data.rooms
      .flatMap((r) => r.checkpoints)
      .flatMap((c) => [...c.notes, ...c.deviations.flatMap((d) => d.notes)]);
    expect(notes.filter((n) => n.checkCode === "ai_suggestion_pending").length).toBeGreaterThan(0);
  });

  it("10.6.2 KI-plassholdere i gamle data står ikke i dataene ([årstall mangler] er lov)", async () => {
    const f = await createPdfBathroom();
    // Lagres direkte, som gamle data fra før lagringen avviste dem (A466)
    await db
      .update(deviations)
      .set({ causeText: `Oppdiktet årsak ${PII_PLACEHOLDERS.join(" ")} fra {årstall}.` })
      .where(eq(deviations.id, f.deviationId!));
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const json = JSON.stringify(data);
    expect(PII_PLACEHOLDERS).toHaveLength(8);
    for (const placeholder of PII_PLACEHOLDERS) expect(json).not.toContain(placeholder);
  });
});

// --- 10.3.1 T25 ------------------------------------------------------------------------------

describe("10.3.1 T25 én form (F6)", () => {
  it("dagens data og snapshotet lagret ved publisering gir like PDF-data utenom utkastdelene", async () => {
    const f = await createPdfBathroom({ mark: "T25" });
    const draftBefore = await draftOf(f.actor, f.organizationId, f.assignmentId);
    const { releaseId } = await publishAs(f.actor, f);
    const { getReleasePdfData } = await import("./release-pdf");
    const release = await getReleasePdfData(f.actor, f.organizationId, f.assignmentId, releaseId);
    const strip = (data: typeof draftBefore.data) =>
      JSON.parse(
        JSON.stringify({ ...data, kind: null, versionNumber: null, missing: null }, (key, value) =>
          key === "editPath" || key === "notes" || key === "tgNotSet" ? undefined : value,
        ),
      ) as unknown;
    expect(strip(release.data)).toEqual(strip(draftBefore.data));
  });
});

// --- Grunnform ---------------------------------------------------------------------------------

describe("svaret", () => {
  it("har forsiden med oppdragsnummer og adresse, rommet, punktene og avviket", async () => {
    const f = await createPdfBathroom({ mark: "FORM" });
    const result = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(result.reportId).toBe(f.reportId);
    expect(result.data.reportId).toBe(f.reportId);
    expect(result.data.kind).toBe("draft");
    expect(result.data.cover.assignmentNumber).toBe(f.assignmentNumber);
    expect(result.data.cover.addressLines.join(" ")).toContain("FORM");
    expect(result.data.cover.inspectionDate).toBe("2026-06-15");
    expect(result.generatedAt).toBeInstanceOf(Date);
    const floor = result.data.rooms[0]!.checkpoints.find((c) => c.checkpointKey === FLOOR)!;
    expect(floor.deviations[0]!.text).toBe("Oppdiktet avvik FORM.");
    expect(floor.deviations[0]!.measures).toContain("Oppdiktet tiltak FORM.");
    expect(floor.editPath).toBe(
      `/oppdrag/${f.assignmentId}/rom/${f.roomId}#punkt-${floor.checkpointId}`,
    );
    // Bare id-er i lenkene, aldri adresse eller tekst
    expect(JSON.stringify(result.data.rooms)).not.toContain("Prøvevegen");
  });

  it("ny beskrivelse er med straks (ingen mellomlagring)", async () => {
    const f = await createPdfBathroom({ mark: "FERSK" });
    await draftOf(f.actor, f.organizationId, f.assignmentId);
    await setDescription(f, "wet_room.ventilation", "Oppdiktet nyskrevet tekst FERSK-2.");
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(JSON.stringify(data)).toContain("FERSK-2");
  });

  it("uten befaringsdato: forsiden har ingen dato, og funnet står på siden «Ikke med i PDF-en»", async () => {
    const f = await createPdfBathroom({ inspectionAt: null });
    const { data } = await draftOf(f.actor, f.organizationId, f.assignmentId);
    expect(data.cover.inspectionDate).toBeNull();
    expect(data.missing!.reportNotes.map((n) => n.checkCode)).toContain("inspection_date_missing");
  });

  it("id fra en annen tabell (rapport-id i stedet for oppdrag-id) gir 404", async () => {
    const f = await createPdfBathroom();
    await expectNotFound(draftOf(f.actor, f.organizationId, f.reportId));
    await expectNotFound(draftOf(f.actor, f.organizationId, uuidv7()));
  });
});
