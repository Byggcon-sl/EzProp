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
import { setTgDirect } from "@/core/reports";
import { db } from "@/db/client";
import {
  assignments,
  companies,
  employees,
  organizations,
  reportReleases,
  reports,
  type EmployeeRole,
} from "@/db/schema";
import { createClaim, resetDatabase } from "../../../tests/factories";
import {
  createPdfBathroom,
  FLOOR,
  newVersion,
  publishAs,
  reportTableState,
  setDeviationText,
  useSecondCompany,
} from "../../../tests/pdf-db-fixtures";
import { inspectPdf } from "../../../tests/pdf-inspect";
import { createStaff, setInspectorsEditAll } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { getReleasePdfData } from "./release-pdf";

/*
 * PDF-dataene for én utgivelse (testplanen for PDF av badet avsnitt 10.2, 10.7.4–10.7.5, 11.1 og
 * 11.5; kortet Omfang 6b, F7, T26). Bygges fra det lagrede snapshotet med `draft: false`,
 * selskapet fra `report_releases.company_id` og `generatedAt` = `released_at`.
 *
 * Hovedmål: færre reklamasjoner (leder kan vise teksten og TG slik de ble publisert) og de
 * ansatte (samme tilgang som utkastet; admin stenges aldri ute). Alle data er oppdiktede.
 */

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(requireOrganizationAccess).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function releaseOf(actor: Actor, organizationId: string, assignmentId: string, releaseId: string) {
  return getReleasePdfData(actor, organizationId, assignmentId, releaseId);
}

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AccessDeniedError);
}

async function published(options: Parameters<typeof createPdfBathroom>[0] = {}) {
  const f = await createPdfBathroom(options);
  const { releaseId, versionNumber } = await publishAs(f.actor, f);
  return { ...f, releaseId, versionNumber };
}

async function releasedAt(releaseId: string): Promise<Date> {
  const [row] = await db
    .select({ at: reportReleases.releasedAt })
    .from(reportReleases)
    .where(eq(reportReleases.id, releaseId));
  return row!.at;
}

function floorOf(data: Awaited<ReturnType<typeof releaseOf>>["data"]) {
  return data.rooms.flatMap((r) => r.checkpoints).find((c) => c.checkpointKey === FLOOR);
}

describe("10.2 og 10.7.4 PDF-data for en utgivelse", () => {
  it("bygges uten utkastdelene, med versjon og generatedAt = released_at", async () => {
    const f = await published({ mark: "UTGITT" });
    const result = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(result.reportId).toBe(f.reportId);
    expect(result.versionNumber).toBe(1);
    expect(result.employeeId).toBe(f.employeeId);
    expect(result.generatedAt.toISOString()).toBe((await releasedAt(f.releaseId)).toISOString());
    expect(result.data.kind).toBe("release");
    expect(result.data.versionNumber).toBe(1);
    expect(result.data.missing).toBeNull();
    const json = JSON.stringify(result.data);
    expect(json).not.toMatch(/"editPath":"/);
    expect(json).not.toMatch(/"tgNotSet":true/);
    expect(json).not.toMatch(/"notes":\[\{/);
    expect(json).toContain("Oppdiktet avvik UTGITT.");
  });

  it("generatedAt er publiseringstidspunktet også når klokka er en annen", async () => {
    const f = await published();
    const first = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    try {
      const later = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
      expect(later.generatedAt.toISOString()).toBe(first.generatedAt.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("kaller requireOrganizationAccess med organization.read", async () => {
    const f = await published();
    vi.mocked(requireOrganizationAccess).mockClear();
    await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(vi.mocked(requireOrganizationAccess)).toHaveBeenCalledWith(
      f.actor,
      f.organizationId,
      "organization.read",
    );
  });

  it("ingen rader endres i rapporttabellene, report_releases eller files", async () => {
    const f = await published();
    const before = await reportTableState(f.organizationId);
    await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(await reportTableState(f.organizationId)).toEqual(before);
  });
});

describe("10.2.2 og 10.7.5 tilgang og 404", () => {
  it("expectTenantIsolation for getReleasePdfData", async () => {
    const byOrg = new Map<string, { assignmentId: string; releaseId: string }>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await published({ organizationId: grantA.organizationId, mark: "ORG-A" });
        const b = await published({ organizationId: grantB.organizationId, mark: "ORG-B" });
        byOrg.set(grantA.organizationId, a);
        byOrg.set(grantB.organizationId, b);
        return { a: [a.releaseId], b: [b.releaseId] };
      },
      query: async (actor, organizationId) => {
        const rows: { releaseId: string }[] = [];
        let denied: unknown = null;
        for (const { assignmentId, releaseId } of byOrg.values()) {
          try {
            await releaseOf(actor, organizationId, assignmentId, releaseId);
            rows.push({ releaseId });
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

  it("utgivelse i org A, ansatt i org B gir 404, også med eget oppdrag", async () => {
    const a = await published({ mark: "ORG-A" });
    const b = await published({ mark: "ORG-B" });
    await expectNotFound(releaseOf(b.actor, b.organizationId, a.assignmentId, a.releaseId));
    await expectNotFound(releaseOf(b.actor, b.organizationId, b.assignmentId, a.releaseId));
    await expectNotFound(releaseOf(b.actor, a.organizationId, a.assignmentId, a.releaseId));
  });

  it("utgivelse på et annet oppdrag i samme organisasjon gir 404", async () => {
    const f = await published();
    const other = await createPdfBathroom({ organizationId: f.organizationId, mark: "ANNET" });
    await expectNotFound(releaseOf(f.actor, f.organizationId, other.assignmentId, f.releaseId));
  });

  it.each(["abc", "", "' or 1=1 --", "00000000-0000-0000-0000-000000000000"])(
    "ugyldig releaseId «%s» gir 404",
    async (releaseId) => {
      const f = await published();
      await expectNotFound(releaseOf(f.actor, f.organizationId, f.assignmentId, releaseId));
      await expectNotFound(releaseOf(f.actor, f.organizationId, releaseId, f.releaseId));
    },
  );

  it("11.5.1 slettet oppdrag, slettet rapport og slettet utgivelse gir 404", async () => {
    const a = await published();
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, a.assignmentId));
    await expectNotFound(releaseOf(a.actor, a.organizationId, a.assignmentId, a.releaseId));

    const b = await published({ organizationId: a.organizationId, mark: "B" });
    await db.update(reports).set({ deletedAt: new Date() }).where(eq(reports.id, b.reportId));
    await expectNotFound(releaseOf(b.actor, b.organizationId, b.assignmentId, b.releaseId));

    const c = await published({ organizationId: a.organizationId, mark: "C" });
    await db
      .update(reportReleases)
      .set({ deletedAt: new Date() })
      .where(eq(reportReleases.id, c.releaseId));
    await expectNotFound(releaseOf(c.actor, c.organizationId, c.assignmentId, c.releaseId));
  });

  const ROLES: { name: string; roles: EmployeeRole[]; editAll: boolean }[] = [
    { name: "takstmann", roles: ["inspector"], editAll: true },
    { name: "kontor", roles: ["office"], editAll: true },
    { name: "leder", roles: ["manager"], editAll: true },
    { name: "admin", roles: ["admin"], editAll: true },
    { name: "bare admin, inspectors_edit_all av", roles: ["admin"], editAll: false },
    { name: "takstmann, inspectors_edit_all av", roles: ["inspector"], editAll: false },
    { name: "kontor, inspectors_edit_all av", roles: ["office"], editAll: false },
  ];

  it.each(ROLES)(
    "$name får data, med og uten reklamasjon (samme svar)",
    async ({ roles, editAll }) => {
      const f = await published();
      await setInspectorsEditAll(f.organizationId, editAll);
      const { actor } = await createStaff(f.organizationId, roles);
      const without = await releaseOf(actor, f.organizationId, f.assignmentId, f.releaseId);
      await createClaim(f.organizationId, {
        assignmentId: f.assignmentId,
        description: "Oppdiktet reklamasjon MERKE-KLAGE",
      });
      const withClaim = await releaseOf(actor, f.organizationId, f.assignmentId, f.releaseId);
      expect(withClaim.data).toEqual(without.data);
      expect(JSON.stringify(withClaim.data)).not.toContain("MERKE-KLAGE");
    },
  );

  it("sluttet ansatt og ansatt uten rolle avvises", async () => {
    const f = await published();
    const gone = await createStaff(f.organizationId, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, gone.employee.id));
    await expectNotFound(releaseOf(gone.actor, f.organizationId, f.assignmentId, f.releaseId));
    const none = await createStaff(f.organizationId, []);
    await expectNotFound(releaseOf(none.actor, f.organizationId, f.assignmentId, f.releaseId));
  });
});

describe("10.2.3 T26 og 11.1 en eldre utgivelse viser teksten og TG slik de ble publisert", () => {
  it("versjon 1 beholder tekst, TG og selskap etter at rapporten er endret og publisert på nytt", async () => {
    const f = await published({ mark: "V1" });
    const v1Before = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    const v1Company = v1Before.data.company;
    expect(v1Company).not.toBeNull();

    await newVersion(f);
    // Endre teksten og TG på gulvet, og bytt selskap på oppdraget
    const newDeviationId = (
      await (
        await import("./pdf-data")
      ).getReportDraftPdfData(f.actor, f.organizationId, f.assignmentId)
    ).data.rooms
      .flatMap((r) => r.checkpoints)
      .flatMap((c) => c.deviations)[0]!.deviationId;
    await setDeviationText(f, newDeviationId, "deviation_text", "Oppdiktet avvik V2.");
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey: "wet_room.ventilation",
      tgDirect: "0",
      base: "1",
    });
    await useSecondCompany(f);
    const v2 = await publishAs(f.actor, f);
    expect(v2.versionNumber).toBe(2);

    const v1After = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(v1After.versionNumber).toBe(1);
    const json = JSON.stringify(v1After.data);
    expect(json).toContain("Oppdiktet avvik V1.");
    expect(json).not.toContain("Oppdiktet avvik V2.");
    const ventilation = v1After.data.rooms
      .flatMap((r) => r.checkpoints)
      .find((c) => c.checkpointKey === "wet_room.ventilation")!;
    expect(ventilation.tg).toBe("1");
    expect(floorOf(v1After.data)!.tg).toBe("2");
    // Selskapet fra utgivelsens company_id, ikke oppdragets nye selskap
    expect(v1After.data.company).toEqual(v1Company);

    const v2Data = await releaseOf(f.actor, f.organizationId, f.assignmentId, v2.releaseId);
    expect(JSON.stringify(v2Data.data)).toContain("Oppdiktet avvik V2.");
    expect(v2Data.data.company).not.toEqual(v1Company);
  }, 30_000);

  it("to kall uten endring gir like data og like byte", async () => {
    const f = await published();
    const assets = await loadPdfAssets();
    const render = async () => {
      const r = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
      return renderReportPdf(r.data, BYGGCON_STANDARD_PROFILE, {
        draft: false,
        generatedAt: r.generatedAt,
        assets,
        limits: PDF_DEFAULT_LIMITS,
      });
    };
    const first = await render();
    const second = await render();
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    const text = inspectPdf(first.bytes)
      .pages.map((p) => p.text)
      .join("\n");
    expect(text).not.toContain("UTKAST");
  }, 30_000);

  it("11.1.1 endret adresse etter publisering: samme avvik og TG, forsiden viser dagens adresse", async () => {
    const f = await published({ mark: "ADR-GAMMEL" });
    const before = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    await db
      .update(assignments)
      .set({ addressText: "Prøvevegen 99 ADR-NY, 8000 Oppdiktet" })
      .where(eq(assignments.id, f.assignmentId));
    const after = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(after.data.rooms).toEqual(before.data.rooms);
    expect(after.data.cover.addressLines.join(" ")).toContain("ADR-NY");
  });

  it("11.5.2 selskapet til utgivelsen er slettet: company null, aldri brand_name", async () => {
    const f = await published();
    await db
      .update(organizations)
      .set({ brandName: "MERKE-BRAND" })
      .where(eq(organizations.id, f.organizationId));
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, f.companyId));
    const { data } = await releaseOf(f.actor, f.organizationId, f.assignmentId, f.releaseId);
    expect(data.company).toBeNull();
    expect(JSON.stringify(data)).not.toContain("MERKE-BRAND");
  });
});
