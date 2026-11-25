import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import type { ReportPdfData } from "@/core/pdf";
import {
  buildReportPdfData,
  getPublishCheck,
  getReleasePdfData,
  getRoomView,
  publishReport,
  saveField,
  setTgDirect,
  startNewVersion,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  assignments,
  companies,
  employees,
  reportReleases,
  reports,
  templateVersions,
  type EmployeeRole,
} from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createClaim,
  createCompany,
  createTemplate,
  nextFakeOrgNumber,
  resetDatabase,
} from "../../../tests/factories";
import {
  createPublishableBathroom,
  writeCounts,
  type PublishableBathroom,
} from "../../../tests/publish-fixtures";
import { CP, createStaff, setInspectorsEditAll } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { coverRowOf } from "./pdf-data";
import { pdfTemplateLabelsOf } from "./pdf-data-build";
import { buildPublishCheckInput, loadPublishSource } from "./signals";
import { buildReportSnapshot } from "./snapshot";

/*
 * PDF av en utgivelse mot testdatabasen (docs/funksjoner/fase2a-pdf-badet-testplan.md 10.2,
 * 10.3, 10.7.5, 11.1 og 11.5, kortet T25 og T26). Alle data er oppdiktede.
 */

beforeEach(resetDatabase);

type Published = PublishableBathroom & { releaseId: string; versionNumber: number };

async function describeFloor(f: PublishableBathroom, text: string, base: string | null) {
  const result = await saveField(f.actor, f.organizationId, f.room, {
    table: "checkpoint_results",
    checkpointKey: CP.floor,
    field: "description_text",
    value: text,
    base,
  });
  if (result.status !== "saved") throw new Error(`beskrivelsen ble ikke lagret: ${result.status}`);
}

async function publish(f: PublishableBathroom) {
  const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error("forventet utkast");
  const result = await publishReport(f.actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: [],
  });
  if (result.status !== "published") throw new Error(`ikke publisert: ${result.status}`);
  return result;
}

/** Et publisert bad (versjon 1) med beskrivelse på gulvet og selskap med org.nr. */
async function publishedBathroom(
  options: { organizationId?: string; marker?: string } = {},
): Promise<Published> {
  const f = await createPublishableBathroom({ organizationId: options.organizationId });
  await db
    .update(companies)
    .set({ legalName: "Testselskap takst AS", orgNumber: nextFakeOrgNumber() })
    .where(eq(companies.id, f.companyId));
  await db
    .update(assignments)
    .set({ addressText: "Prøvevegen 1\n8000 Bodø", gnr: "12", bnr: "34" })
    .where(eq(assignments.id, f.assignmentId));
  await describeFloor(f, options.marker ?? "Gulvet har normal slitasje.", null);
  const result = await publish(f);
  return { ...f, releaseId: result.releaseId, versionNumber: result.versionNumber };
}

function releaseOf(
  actor: Actor,
  f: Pick<Published, "organizationId" | "assignmentId" | "releaseId">,
) {
  return getReleasePdfData(actor, f.organizationId, f.assignmentId, f.releaseId);
}

function checkpointIn(data: ReportPdfData, key: string) {
  return data.rooms.flatMap((r) => r.checkpoints).find((c) => c.checkpointKey === key) ?? null;
}

// --- Svaret -----------------------------------------------------------------------------------

describe("10.2 PDF-data for en utgivelse", () => {
  it("bygges fra snapshotet uten utkastdeler, med versjon og generatedAt = released_at", async () => {
    const f = await publishedBathroom();
    const result = await releaseOf(f.actor, f);
    const [release] = await db
      .select({ releasedAt: reportReleases.releasedAt })
      .from(reportReleases)
      .where(eq(reportReleases.id, f.releaseId));
    expect(result.generatedAt).toEqual(release!.releasedAt);
    expect(result.versionNumber).toBe(1);
    expect(result.reportId).toBe(f.reportId);
    expect(result.employeeId).toBe(f.employeeId);
    const { data } = result;
    expect(data.kind).toBe("release");
    expect(data.versionNumber).toBe(1);
    expect(data.missing).toBeNull();
    expect(data.company).toMatchObject({ legalName: "Testselskap takst AS" });
    expect(data.cover.addressLines).toEqual(["Prøvevegen 1", "8000 Bodø"]);
    const checkpoints = data.rooms.flatMap((r) => r.checkpoints);
    expect(checkpoints.length).toBeGreaterThan(0);
    for (const c of checkpoints) {
      expect(c.editPath).toBeNull();
      expect(c.notes).toEqual([]);
      expect(c.tgNotSet).toBe(false);
    }
    expect(JSON.stringify(data)).not.toContain("/oppdrag/");
  });

  it("to kall gir like data og ingenting lagres", async () => {
    const f = await publishedBathroom();
    const before = await writeCounts(f.organizationId);
    const first = await releaseOf(f.actor, f);
    const second = await releaseOf(f.actor, f);
    expect(second).toEqual(first);
    expect(await writeCounts(f.organizationId)).toEqual(before);
  });
});

// --- T25 og T26 -------------------------------------------------------------------------------

describe("én rapportform (F6) og eldre utgivelser (F7)", () => {
  it("T25 dagens data med draft: false gir det samme som snapshotet lagret ved publisering", async () => {
    const f = await publishedBathroom();
    const { data: fromRelease } = await releaseOf(f.actor, f);

    const grant = await requireOrganizationAccess(f.actor, f.organizationId, "organization.read");
    const [report] = await db.select().from(reports).where(eq(reports.id, f.reportId));
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, f.assignmentId));
    const [company] = await db.select().from(companies).where(eq(companies.id, f.companyId));
    const source = await loadPublishSource(
      db,
      f.actor,
      grant,
      {
        assignmentId: f.assignmentId,
        inspectionAt: assignment!.inspectionAt,
        report: {
          id: report!.id,
          status: report!.status,
          templateVersionId: report!.templateVersionId,
          reportType: report!.reportType,
        },
      },
      new Date(),
    );
    expect(buildPublishCheckInput(source).rooms.length).toBe(1);
    const fromToday = buildReportPdfData({
      snapshot: buildReportSnapshot(source),
      template: pdfTemplateLabelsOf(source.template.document),
      cover: coverRowOf({ assignmentId: assignment!.id, ...assignment! }),
      company: { legalName: company!.legalName, orgNumber: company!.orgNumber },
      findings: null,
      versionNumber: 1,
      options: { draft: false },
    });
    expect(fromToday).toEqual(fromRelease);
  });

  it("T26 eldre utgivelse viser sin gamle tekst, TG og sitt selskap etter ny versjon", async () => {
    const f = await publishedBathroom({ marker: "Merke-V1 gulv" });
    const v1Before = await releaseOf(f.actor, f);

    // Ny versjon: ny tekst, ny TG og nytt selskap på oppdraget
    await startNewVersion(f.actor, f.organizationId, f.assignmentId);
    await describeFloor(f, "Merke-V2 gulv", "Merke-V1 gulv");
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: CP.floor,
      tgDirect: "0",
      base: "1",
    });
    const other = await createCompany(f.organizationId, {
      legalName: "Nytt selskap AS",
      orgNumber: nextFakeOrgNumber(),
    });
    await db
      .update(assignments)
      .set({ companyId: other.id })
      .where(eq(assignments.id, f.assignmentId));
    const v2 = await publish(f);
    expect(v2.versionNumber).toBe(2);

    const v1 = await releaseOf(f.actor, f);
    expect(v1).toEqual(v1Before);
    expect(checkpointIn(v1.data, CP.floor)).toMatchObject({
      tg: "1",
      descriptionText: "Merke-V1 gulv",
    });
    expect(v1.data.company?.legalName).toBe("Testselskap takst AS");

    const latest = await releaseOf(f.actor, { ...f, releaseId: v2.releaseId });
    expect(latest.versionNumber).toBe(2);
    expect(checkpointIn(latest.data, CP.floor)).toMatchObject({
      tg: "0",
      descriptionText: "Merke-V2 gulv",
    });
    expect(latest.data.company?.legalName).toBe("Nytt selskap AS");
  });

  it("11.1 endret adresse etter publisering: samme tekst og TG, forsiden viser dagens adresse", async () => {
    const f = await publishedBathroom();
    const before = await releaseOf(f.actor, f);
    await db
      .update(assignments)
      .set({ addressText: "Nyvegen 2\n8000 Bodø" })
      .where(eq(assignments.id, f.assignmentId));
    const after = await releaseOf(f.actor, f);
    expect(after.data.rooms).toEqual(before.data.rooms);
    expect(after.data.cover.addressLines).toEqual(["Nyvegen 2", "8000 Bodø"]);
  });

  it("5.4 etikettene kommer fra snapshotets malversjon", async () => {
    const f = await publishedBathroom();
    const [version] = await db
      .select({ familyId: templateVersions.familyId })
      .from(templateVersions)
      .where(eq(templateVersions.id, f.templateVersionId));
    await db
      .update(templateVersions)
      .set({ status: "retired" })
      .where(eq(templateVersions.id, f.templateVersionId));
    await createTemplate(f.organizationId, {
      status: "published",
      versionNumber: 2,
      familyId: version!.familyId,
      document: {
        ...wetRoomTemplate,
        checkpoints: wetRoomTemplate.checkpoints.map((c) => ({ ...c, name: `Ny ${c.name}` })),
        elements: wetRoomTemplate.elements.map((e) => ({ ...e, label: `Ny ${e.label}` })),
      },
    });
    const { data } = await releaseOf(f.actor, f);
    expect(checkpointIn(data, CP.floor)!.label).toBe("Overflater gulv");
    expect(checkpointIn(data, CP.adjacent)!.answers.map((a) => a.label)).toContain("Hulltaking");
    expect(JSON.stringify(data)).not.toContain("Ny ");
  });

  it("malversjonen i snapshotet finnes ikke lenger: PDF-en lages likevel, uten svar på felt", async () => {
    const f = await publishedBathroom();
    const [release] = await db
      .select({ snapshot: reportReleases.snapshot })
      .from(reportReleases)
      .where(eq(reportReleases.id, f.releaseId));
    const snapshot = release!.snapshot as { report: Record<string, unknown> };
    await db
      .update(reportReleases)
      .set({
        snapshot: { ...snapshot, report: { ...snapshot.report, template_version_id: uuidv7() } },
      })
      .where(eq(reportReleases.id, f.releaseId));
    const { data } = await releaseOf(f.actor, f);
    expect(checkpointIn(data, CP.floor)).not.toBeNull();
    expect(data.rooms.flatMap((r) => r.checkpoints).flatMap((c) => c.answers)).toEqual([]);
  });

  it("11.5.2 selskap uten org.nr. gir company null, aldri brand_name", async () => {
    const f = await publishedBathroom();
    await db.update(companies).set({ orgNumber: null }).where(eq(companies.id, f.companyId));
    expect((await releaseOf(f.actor, f)).data.company).toBeNull();
  });
});

// --- Tilgang og tenant ------------------------------------------------------------------------

describe("10.7.5 tilgang og tenant-isolasjon", () => {
  it("5.1.1 getReleasePdfData gir aldri data fra en annen organisasjon", async () => {
    const pairs: { assignmentId: string; releaseId: string }[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await publishedBathroom({ organizationId: grantA.organizationId });
        const b = await publishedBathroom({ organizationId: grantB.organizationId });
        pairs.push(a, b);
        return { a: [a.releaseId], b: [b.releaseId] };
      },
      query: async (actor, organizationId) => {
        const rows: { releaseId: string }[] = [];
        let denied: unknown = null;
        for (const pair of pairs) {
          try {
            await getReleasePdfData(actor, organizationId, pair.assignmentId, pair.releaseId);
            rows.push({ releaseId: pair.releaseId });
          } catch (error) {
            if (!(error instanceof AccessDeniedError)) throw error;
            denied = error;
          }
        }
        if (rows.length === 0 && denied) throw denied;
        return rows;
      },
      idOf: (row) => row.releaseId,
    });
  });

  it("utgivelse på et annet oppdrag i samme organisasjon gir 404", async () => {
    const a = await publishedBathroom();
    const b = await publishedBathroom({ organizationId: a.organizationId });
    await expect(
      getReleasePdfData(a.actor, a.organizationId, a.assignmentId, b.releaseId),
    ).rejects.toThrow(AccessDeniedError);
  });

  it.each([
    ["ugyldig utgivelses-id", (f: Published) => ({ ...f, releaseId: "abc" })],
    ["ugyldig oppdrags-id", (f: Published) => ({ ...f, assignmentId: "' or 1=1 --" })],
    ["ukjent utgivelses-id", (f: Published) => ({ ...f, releaseId: uuidv7() })],
  ])("%s gir 404", async (_name, change) => {
    const f = await publishedBathroom();
    await expect(releaseOf(f.actor, change(f))).rejects.toThrow(AccessDeniedError);
  });

  it("11.5.1 slettet utgivelse, slettet rapport, erstattet rapport og slettet oppdrag gir 404", async () => {
    const release = await publishedBathroom();
    await db
      .update(reportReleases)
      .set({ deletedAt: new Date() })
      .where(eq(reportReleases.id, release.releaseId));
    const report = await publishedBathroom({ organizationId: release.organizationId });
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, report.reportId));
    const superseded = await publishedBathroom({ organizationId: release.organizationId });
    await db
      .update(reports)
      .set({ status: "superseded" })
      .where(eq(reports.id, superseded.reportId));
    const assignment = await publishedBathroom({ organizationId: release.organizationId });
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, assignment.assignmentId));
    for (const f of [release, report, superseded, assignment]) {
      await expect(releaseOf(f.actor, f)).rejects.toThrow(AccessDeniedError);
    }
  });

  type RoleCase = { name: string; roles: EmployeeRole[]; editAll: boolean };
  const ROLE_CASES: RoleCase[] = [
    { name: "takstmann", roles: ["inspector"], editAll: true },
    { name: "kontor", roles: ["office"], editAll: true },
    { name: "leder", roles: ["manager"], editAll: true },
    { name: "admin", roles: ["admin"], editAll: true },
    { name: "takstmann med inspectors_edit_all av", roles: ["inspector"], editAll: false },
    { name: "kontor med inspectors_edit_all av", roles: ["office"], editAll: false },
    { name: "bare admin med inspectors_edit_all av", roles: ["admin"], editAll: false },
  ];

  it.each(ROLE_CASES)("$name får samme data, med og uten reklamasjon", async (c) => {
    const owner = await publishedBathroom();
    const expected = (await releaseOf(owner.actor, owner)).data;
    await setInspectorsEditAll(owner.organizationId, c.editAll);
    const { actor, employee } = await createStaff(owner.organizationId, c.roles);
    expect((await getRoomView(actor, owner.organizationId, owner.room)).state).toBe("started");

    const without = await releaseOf(actor, owner);
    expect(without.data).toEqual(expected);
    expect(without.employeeId).toBe(employee.id);
    await createClaim(owner.organizationId, {
      assignmentId: owner.assignmentId,
      description: "Merke-REKLAMASJON fukt i kjeller",
    });
    const withClaim = await releaseOf(actor, owner);
    expect(withClaim.data).toEqual(without.data);
    expect(JSON.stringify(withClaim.data)).not.toContain("Merke-REKLAMASJON");
  });

  it("sluttet ansatt og ansatt uten organization.read avvises", async () => {
    const owner = await publishedBathroom();
    const gone = await createStaff(owner.organizationId, ["manager"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, gone.employee.id));
    const none = await createStaff(owner.organizationId, []);
    for (const actor of [gone.actor, none.actor]) {
      await expect(releaseOf(actor, owner)).rejects.toThrow(AccessDeniedError);
    }
  });

  it("to organisasjoner samtidig: hver har bare sitt eget merke", async () => {
    const a = await publishedBathroom({ marker: "Merke-ORG-A gulv" });
    const b = await publishedBathroom({ marker: "Merke-ORG-B gulv" });
    const [dataA, dataB] = await Promise.all([releaseOf(a.actor, a), releaseOf(b.actor, b)]);
    expect(JSON.stringify(dataA.data)).toContain("Merke-ORG-A");
    expect(JSON.stringify(dataA.data)).not.toContain("Merke-ORG-B");
    expect(JSON.stringify(dataB.data)).toContain("Merke-ORG-B");
    expect(JSON.stringify(dataB.data)).not.toContain("Merke-ORG-A");
  });
});
