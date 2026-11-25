import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { PublishCheckCode, PublishOverrideReasonCode } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAssignment,
  createCertification,
  createCheckpointRow,
  createClaim,
  createCompany,
  createEmployee,
  createPublishCheckResultRow,
  createReportReleaseRow,
  createReportRow,
  createTemplateVersionRow,
  createUser,
} from "./factories";

/*
 * Oppsett for testene av «Overstyringer for leder» (docs/funksjoner/fase2a-overstyringer-leder-testplan.md
 * avsnitt 4 til 6): rapporter med utgivelser og overstyrte sperrer satt rett inn med kjente
 * tider, uten å gå via publiseringen. Tider settes eksplisitt i UTC med kjent norsk dato.
 *
 * Merkene under står i fritekst, navn og reklamasjoner, og skal aldri finnes i svarene fra
 * tjenesten eller i grunnlaget til KI. Alle verdier er oppdiktede.
 */

export const LEAK_MARKERS = {
  reason: "Mxq-grunn-ÆØ",
  claimDescription: "Mxq-krav-ÆØ",
  claimant: "Mxq-krever-ÆØ",
  buildingPart: "Mxq-del-ÆØ",
  employeeName: "Mxqline Testesen",
} as const;

/** Punktene i malversjonen, med navn. */
export const OVERRIDE_CHECKPOINTS = {
  "wet_room.membrane_drain": "Membran og sluk",
  "wet_room.ventilation": "Ventilasjon",
  "wet_room.floor": "Gulv",
} as const;

export type OverrideOrg = {
  organizationId: string;
  employeeId: string;
  certificationId: string;
  companyId: string;
  templateVersionId: string;
};

/** Takstmann (med merkenavnet), sertifisering, selskap og en malversjon med punktene over. */
export async function overrideOrg(organizationId: string): Promise<OverrideOrg> {
  const user = await createUser({ name: LEAK_MARKERS.employeeName });
  const employee = await createEmployee(user, organizationId, ["inspector"]);
  const certification = await createCertification({ id: employee.id, organizationId });
  const company = await createCompany(organizationId);
  const version = await createTemplateVersionRow(organizationId);
  for (const [key, name] of Object.entries(OVERRIDE_CHECKPOINTS)) {
    await createCheckpointRow(organizationId, { versionId: version.id, key, name });
  }
  return {
    organizationId,
    employeeId: employee.id,
    certificationId: certification.id,
    companyId: company.id,
    templateVersionId: version.id,
  };
}

export type OverrideReport = { reportId: string; assignmentId: string; assignmentNumber: string };

/** En rapport på et nytt oppdrag (eller på `assignmentId`), med malversjonen til `org`. */
export async function overrideReport(
  org: OverrideOrg,
  options: { assignmentId?: string; templateVersionId?: string } = {},
): Promise<OverrideReport> {
  const assignment = options.assignmentId
    ? { id: options.assignmentId, number: "" }
    : await createAssignment(org.organizationId);
  const report = await createReportRow(org.organizationId, {
    assignmentId: assignment.id,
    templateVersionId: options.templateVersionId ?? org.templateVersionId,
  });
  const [row] = (await db.execute(
    sql`select number from assignments where id = ${assignment.id}`,
  )) as unknown as { number: string }[];
  return { reportId: report.id, assignmentId: assignment.id, assignmentNumber: row!.number };
}

export type OverrideSpec = {
  checkCode?: PublishCheckCode;
  /** `null` = hele rapporten. Standard: membran og sluk. */
  checkpointKey?: string | null;
  reasonCode?: PublishOverrideReasonCode;
  /** Standard: utgivelsestidspunktet. */
  createdAt?: Date;
  /** En advarsel i stedet for en overstyrt sperre (aldri med i listen). */
  warning?: boolean;
  deletedAt?: Date | null;
};

/** En utgivelse av rapporten med overstyrte sperrer. Gir id-en til utgivelsen. */
export async function overrideRelease(
  org: OverrideOrg,
  report: OverrideReport,
  options: {
    versionNumber?: number;
    releasedAt: Date;
    overrides?: readonly OverrideSpec[];
    deletedAt?: Date | null;
  },
): Promise<string> {
  const release = await createReportReleaseRow(org.organizationId, {
    reportId: report.reportId,
    versionNumber: options.versionNumber ?? 1,
    releasedAt: options.releasedAt,
    releasedBy: org.employeeId,
    signedByEmployeeId: org.employeeId,
    certificationId: org.certificationId,
    companyId: org.companyId,
    deletedAt: options.deletedAt ?? null,
  });
  for (const spec of options.overrides ?? [{}]) {
    const createdAt = spec.createdAt ?? options.releasedAt;
    const checkpointKey =
      spec.checkpointKey === undefined ? "wet_room.membrane_drain" : spec.checkpointKey;
    const target = {
      roomId: null,
      checkpointId: null,
      checkpointKey,
      deviationId: null,
      ruleKey: null,
      aiUsageId: null,
      missing: [],
    };
    if (spec.warning) {
      await createPublishCheckResultRow(org.organizationId, {
        reportId: report.reportId,
        releaseId: release.id,
        checkCode: "tg2_tg3_missing_measure",
        severity: "warning",
        targetRef: target,
        createdAt,
        deletedAt: spec.deletedAt ?? null,
      });
      continue;
    }
    const reasonCode = spec.reasonCode ?? "no_access_or_refused";
    await createPublishCheckResultRow(org.organizationId, {
      reportId: report.reportId,
      releaseId: release.id,
      checkCode: spec.checkCode ?? "wet_or_below_ground_missing_hole",
      severity: "blocker",
      targetRef: target,
      overridden: true,
      overriddenBy: org.employeeId,
      overriddenAt: createdAt,
      overrideReasonCode: reasonCode,
      // Merket står i begrunnelsen på alle overstyringer, ikke bare «Annet»
      overrideReason: LEAK_MARKERS.reason,
      createdAt,
      deletedAt: spec.deletedAt ?? null,
    });
  }
  return release.id;
}

/** En reklamasjon på oppdraget med merkene i friteksten. */
export async function overrideClaim(
  organizationId: string,
  assignmentId: string,
  options: { receivedAt: string; checkpointKey: string | null; deletedAt?: Date | null },
) {
  return createClaim(organizationId, {
    assignmentId,
    receivedAt: options.receivedAt,
    checkpointKey: options.checkpointKey,
    description: LEAK_MARKERS.claimDescription,
    claimantText: LEAK_MARKERS.claimant,
    buildingPartText: LEAK_MARKERS.buildingPart,
    deletedAt: options.deletedAt ?? null,
  });
}

/**
 * Mange overstyringer satt inn med én SQL per tabell (ytelsestesten O4.10): `reports` rapporter
 * med én utgivelse hver i dag minus 0–80 dager, og `perReport` overstyringer per utgivelse.
 * Reklamasjonene står på de første `claims` oppdragene.
 */
export async function bulkOverrides(
  org: OverrideOrg,
  options: { reports: number; perReport: number; claims: number; now: Date },
) {
  const keys = Object.keys(OVERRIDE_CHECKPOINTS);
  const reasons = ["no_access_or_refused", "not_applicable_to_room", "described_elsewhere"];
  const codes = ["wet_or_below_ground_missing_hole", "tg3_missing_cost", "mandatory_without_tg"];
  for (let i = 0; i < options.reports; i += 1) {
    const report = await overrideReport(org);
    const releasedAt = new Date(options.now.getTime() - (i % 80) * 24 * 60 * 60 * 1000);
    const release = await createReportReleaseRow(org.organizationId, {
      reportId: report.reportId,
      releasedAt,
      releasedBy: org.employeeId,
      signedByEmployeeId: org.employeeId,
      certificationId: org.certificationId,
      companyId: org.companyId,
    });
    const values = Array.from({ length: options.perReport }, (_, j) => {
      const key = keys[(i + j) % keys.length]!;
      return sql`(${uuidv7()}, ${org.organizationId}, ${report.reportId}, ${release.id},
        ${codes[j % codes.length]!}, 'blocker', 'rule',
        ${JSON.stringify({ roomId: uuidv7(), checkpointId: null, checkpointKey: key, deviationId: null, ruleKey: null, aiUsageId: null, missing: [] })}::jsonb,
        true, ${org.employeeId}, ${releasedAt.toISOString()}::timestamptz,
        ${reasons[j % reasons.length]!}, ${releasedAt.toISOString()}::timestamptz)`;
    });
    await db.execute(sql`
      insert into publish_check_results (id, organization_id, report_id, release_id, check_code,
        severity, source, target_ref, overridden, overridden_by, overridden_at,
        override_reason_code, created_at)
      values ${sql.join(values, sql`, `)}`);
    if (i < options.claims) {
      await overrideClaim(org.organizationId, report.assignmentId, {
        receivedAt: todayInOslo(options.now),
        checkpointKey: keys[i % keys.length]!,
      });
    }
  }
}
