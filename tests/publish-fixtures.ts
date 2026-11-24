import { and, count, eq } from "drizzle-orm";
import { decideSuggestion, setTgDirect } from "@/core/reports";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  auditLog,
  events,
  publishCheckResults,
  reportReleases,
  reports,
  rooms,
  type EmployeeRole,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createCertification, createCompany } from "./factories";
import { answerHole, answerMembrane1990, RULE, startedBathroom } from "./report-fixtures";

/*
 * Oppsett for testene av publiseringen (docs/funksjoner/fase2a-publisering-badet-testplan.md
 * avsnitt 4 og 5): et startet bad uten mangler (alle åtte punktene har TG1, hull er tatt med
 * måling), oppdrag med selskap og befaringsdato, og en takstmann med gyldig sertifisering.
 * Testfilen må ha `vi.mock("server-only", () => ({}))`. Alle verdier er oppdiktede.
 */

/** De åtte kontrollpunktene i badmalen som gir TG (A520). */
export const WET_ROOM_CHECKPOINT_KEYS = [
  "wet_room.general",
  "wet_room.documentation",
  "wet_room.walls_ceiling",
  "wet_room.floor",
  "wet_room.membrane_drain",
  "wet_room.fixtures",
  "wet_room.ventilation",
  "wet_room.adjacent",
] as const;

/** Sertifisering som gjelder lenge, så testene ikke avhenger av klokka. */
export const LONG_VALID_TO = "2099-12-31";

export type PublishableOptions = {
  organizationId?: string;
  roles?: EmployeeRole[];
  /** Standard 2026-06-15 10:00 UTC. `null` = oppdraget mangler befaringsdato. */
  inspectionAt?: Date | null;
  /** `null` = ingen sertifisering. Standard gyldig til 2099. */
  certification?: { validFrom?: string | null; validTo: string } | null;
  /** Standard sann: hull tatt med måling, alle punkter TG1. */
  complete?: boolean;
};

/**
 * Et bad som kan publiseres: rapporten er startet, alle punkter har TG1, hull er tatt med måling,
 * oppdraget har selskap, og den innloggede har gyldig sertifisering.
 */
export async function createPublishableBathroom(options: PublishableOptions = {}) {
  const f = await startedBathroom({
    organizationId: options.organizationId,
    roles: options.roles,
    inspectionAt: options.inspectionAt,
  });
  const company = await createCompany(f.organizationId);
  await db
    .update(assignments)
    .set({ companyId: company.id })
    .where(eq(assignments.id, f.assignmentId));
  let certificationId: string | null = null;
  if (options.certification !== null) {
    const cert = options.certification ?? { validFrom: null, validTo: LONG_VALID_TO };
    certificationId = (
      await createCertification(
        { id: f.employeeId, organizationId: f.organizationId },
        { validFrom: cert.validFrom ?? null, validTo: cert.validTo },
      )
    ).id;
  }
  if (options.complete !== false) {
    for (const checkpointKey of WET_ROOM_CHECKPOINT_KEYS) {
      await setTgDirect(f.actor, f.organizationId, f.room, {
        checkpointKey,
        tgDirect: "1",
        base: null,
      });
    }
    await answerHole(f, "done_no_findings", 10);
  }
  return { ...f, companyId: company.id, certificationId };
}

export type PublishableBathroom = Awaited<ReturnType<typeof createPublishableBathroom>>;

/**
 * Legger til ett TG3-avvik uten kostnad på membranpunktet (godtatt regelforslag «før 2000»).
 * Gir sperren `tg3_missing_cost`. Returnerer avvikets id.
 */
export async function addTg3WithoutCost(f: PublishableBathroom): Promise<string> {
  await answerMembrane1990(f);
  const deviationId = uuidv7();
  const result = await decideSuggestion(f.actor, f.organizationId, f.room, {
    id: uuidv7(),
    ruleKey: RULE.before2000,
    decision: "accepted",
    deviationId,
  });
  if (result.status !== "saved") throw new Error(`godta feilet: ${result.status}`);
  return result.deviationId ?? deviationId;
}

/** Sletter badet mykt (rapporten har da ikke noe våtrom). */
export async function softDeleteRoom(roomId: string) {
  await db.update(rooms).set({ deletedAt: new Date() }).where(eq(rooms.id, roomId));
}

/** Antall rader i tabellene publiseringen kan skrive til, for én organisasjon. */
export async function writeCounts(organizationId: string) {
  const countOf = async (
    table:
      | typeof reportReleases
      | typeof publishCheckResults
      | typeof auditLog
      | typeof events
      | typeof aiUsageLog,
  ) =>
    Number(
      (
        await db.select({ n: count() }).from(table).where(eq(table.organizationId, organizationId))
      )[0]?.n ?? 0,
    );
  return {
    releases: await countOf(reportReleases),
    checkResults: await countOf(publishCheckResults),
    audit: await countOf(auditLog),
    events: await countOf(events),
    ai: await countOf(aiUsageLog),
  };
}

/** Rapportens status. */
export async function reportStatus(organizationId: string, reportId: string) {
  const [row] = await db
    .select({ status: reports.status })
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), eq(reports.id, reportId)));
  return row?.status;
}

/** Utgivelsene for rapporten, eldste først. */
export async function releasesOf(organizationId: string, reportId: string) {
  return (
    await db
      .select()
      .from(reportReleases)
      .where(
        and(
          eq(reportReleases.organizationId, organizationId),
          eq(reportReleases.reportId, reportId),
        ),
      )
  ).sort((a, b) => a.versionNumber - b.versionNumber);
}

/** Sjekkradene for en utgivelse. */
export async function checkRowsOf(organizationId: string, releaseId: string) {
  return db
    .select()
    .from(publishCheckResults)
    .where(
      and(
        eq(publishCheckResults.organizationId, organizationId),
        eq(publishCheckResults.releaseId, releaseId),
      ),
    );
}
