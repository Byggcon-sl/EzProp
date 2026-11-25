import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { hasReportForPdf, listCheckpointAnchors, startReport } from "@/core/reports";
import { db } from "@/db/client";
import { assignments, checkpoints, reports } from "@/db/schema";
import { resetDatabase } from "../../../tests/factories";
import {
  createBathroomFixture,
  createStaff,
  startedBathroom,
} from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Det skjermene trenger for PDF-knappene (docs/funksjoner/fase2a-pdf-badet.md, Skjermer og F4):
 * om oppdraget har en rapport, og id-ene til kontrollpunktene for ankrene `#punkt-<id>`. Alle data
 * er oppdiktede.
 */

beforeEach(resetDatabase);

describe("hasReportForPdf", () => {
  it("er usann før rapporten er startet og sann etterpå", async () => {
    const f = await createBathroomFixture();
    expect(await hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).toBe(false);
    await startReport(f.actor, f.organizationId, f.assignmentId);
    expect(await hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).toBe(true);
  });

  it("publisert rapport gir sann, erstattet og slettet rapport gir usann", async () => {
    const f = await startedBathroom();
    await db.update(reports).set({ status: "published" }).where(eq(reports.id, f.reportId));
    expect(await hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).toBe(true);
    await db.update(reports).set({ status: "superseded" }).where(eq(reports.id, f.reportId));
    expect(await hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).toBe(false);
    await db
      .update(reports)
      .set({ status: "draft", deletedAt: new Date() })
      .where(eq(reports.id, f.reportId));
    expect(await hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).toBe(false);
  });

  it("slettet oppdrag og ugyldig id avvises", async () => {
    const f = await startedBathroom();
    await expect(hasReportForPdf(f.actor, f.organizationId, "ikke-en-id")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(eq(assignments.id, f.assignmentId));
    await expect(hasReportForPdf(f.actor, f.organizationId, f.assignmentId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it.each([["inspector"], ["office"], ["manager"], ["admin"]] as const)(
    "rollen %s får samme svar",
    async (role) => {
      const f = await startedBathroom();
      const { actor } = await createStaff(f.organizationId, [role]);
      expect(await hasReportForPdf(actor, f.organizationId, f.assignmentId)).toBe(true);
    },
  );

  it("tenant-isolasjon: svaret gjelder bare oppdrag i organisasjonen fra tilgangssjekken", async () => {
    const assignmentByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await startedBathroom({ organizationId: grantA.organizationId });
        const b = await startedBathroom({ organizationId: grantB.organizationId });
        assignmentByOrg.set(grantA.organizationId, a.assignmentId);
        assignmentByOrg.set(grantB.organizationId, b.assignmentId);
        return { a: [a.assignmentId], b: [b.assignmentId] };
      },
      query: async (actor, organizationId) => {
        // Fremmed organisasjon: tilgangen stopper før oppdragene prøves (punkt 3 og 4)
        await requireOrganizationAccess(actor, organizationId);
        const all = [...assignmentByOrg.values()];
        const rows: { id: string }[] = [];
        for (const assignmentId of all) {
          try {
            if (await hasReportForPdf(actor, organizationId, assignmentId)) {
              rows.push({ id: assignmentId });
            }
          } catch (error) {
            // Oppdraget i den andre organisasjonen finnes ikke for denne
            if (!(error instanceof AccessDeniedError)) throw error;
          }
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });
});

describe("listCheckpointAnchors", () => {
  it("gir id-ene fra rapportens låste malversjon", async () => {
    const f = await startedBathroom();
    const anchors = await listCheckpointAnchors(f.actor, f.organizationId, f.assignmentId);
    const rows = await db
      .select({ id: checkpoints.id, key: checkpoints.key })
      .from(checkpoints)
      .where(eq(checkpoints.versionId, f.templateVersionId));
    expect(anchors.length).toBe(rows.length);
    expect(anchors.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(anchors).toContainEqual({ checkpointId: row.id, checkpointKey: row.key });
    }
  });

  it("uten rapport gir tom liste", async () => {
    const f = await createBathroomFixture();
    expect(await listCheckpointAnchors(f.actor, f.organizationId, f.assignmentId)).toEqual([]);
  });

  it("slettet kontrollpunkt er ikke med", async () => {
    const f = await startedBathroom();
    const [first] = await listCheckpointAnchors(f.actor, f.organizationId, f.assignmentId);
    await db
      .update(checkpoints)
      .set({ deletedAt: new Date() })
      .where(eq(checkpoints.id, first!.checkpointId));
    const after = await listCheckpointAnchors(f.actor, f.organizationId, f.assignmentId);
    expect(after.map((a) => a.checkpointId)).not.toContain(first!.checkpointId);
  });

  it("tenant-isolasjon: filtrerer på organisasjonen fra tilgangssjekken", async () => {
    const assignmentByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: Record<"a" | "b", string[]> = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const f = await startedBathroom({ organizationId: grant.organizationId });
          assignmentByOrg.set(grant.organizationId, f.assignmentId);
          const rows = await db
            .select({ id: checkpoints.id })
            .from(checkpoints)
            .where(eq(checkpoints.versionId, f.templateVersionId));
          ids[side] = rows.map((r) => r.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const assignmentId =
          assignmentByOrg.get(organizationId) ?? [...assignmentByOrg.values()][0]!;
        return listCheckpointAnchors(actor, organizationId, assignmentId);
      },
      idOf: (row) => row.checkpointId,
    });
  });

  it("et oppdrag fra en annen organisasjon gir AccessDeniedError, også for hasReportForPdf", async () => {
    const a = await startedBathroom();
    const b = await startedBathroom();
    await expect(
      listCheckpointAnchors(b.actor, b.organizationId, a.assignmentId),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(hasReportForPdf(b.actor, b.organizationId, a.assignmentId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });
});
