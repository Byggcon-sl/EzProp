import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { publishCheckResults } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createCertification,
  createCompany,
  createEmployee,
  createOrganization,
  createPublishCheckResultRow,
  createReportReleaseRow,
  createReportRow,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { tenantTables } from "../../../tests/tenant-tables";

/*
 * Databasen selv holder utgivelsene og sjekkradene riktige (migrering `0038_publisering-badet`,
 * ADR 0015, docs/funksjoner/fase2a-publisering-badet-testplan.md avsnitt 3, I9). Rå innsetting med
 * radbyggerne, utenom kjernen og Zod. Feilkoden sjekkes, så en skrivefeil gir ikke falsk grønn test.
 *
 * Støtter hovedmål: færre reklamasjoner (en sperre kan ikke stå i en utgivelse uten grunn, og en
 * utgivelse kan ikke peke inn i en annen organisasjon) og KI i bunnen (`source = 'ai'` kan aldri
 * bli sperre). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const NOT_NULL = "23502";

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(action: () => Promise<unknown>, code: string) {
  let found: string | undefined = "ingen feil";
  try {
    await action();
  } catch (error) {
    found = pgCode(error);
  }
  expect(found).toBe(code);
}

const TARGET = {
  roomId: null,
  checkpointId: null,
  checkpointKey: null,
  deviationId: null,
  ruleKey: null,
  aiUsageId: null,
  missing: [],
};

/** Organisasjon med en utgivelse og en ansatt som kan stå som `overridden_by`. */
async function releaseFixture(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
  const release = await createReportReleaseRow(org.id, { releasedBy: employee.id });
  return { org, employee, release };
}

type CheckRow = Partial<typeof publishCheckResults.$inferInsert>;

/** En overstyrt sperre som er gyldig. */
function overriddenBlocker(employeeId: string): CheckRow {
  return {
    checkCode: "tg3_missing_cost",
    severity: "blocker",
    targetRef: TARGET,
    overridden: true,
    overriddenBy: employeeId,
    overriddenAt: new Date("2026-11-17T10:00:00Z"),
    overrideReasonCode: "no_access_or_refused",
    overrideReason: null,
  };
}

describe("3.1 CHECK-reglene i publish_check_results", () => {
  type CheckCase = {
    name: string;
    row: (employeeId: string) => CheckRow;
    ok: boolean;
  };

  const CASES: CheckCase[] = [
    { name: "advarsel som ikke er overstyrt", row: () => ({}), ok: true },
    { name: "overstyrt sperre med fast grunn og uten tekst", row: overriddenBlocker, ok: true },
    {
      name: "overstyrt sperre med «Annet» og tekst",
      row: (e) => ({
        ...overriddenBlocker(e),
        overrideReasonCode: "other",
        overrideReason: "Oppdiktet grunn med nok tegn.",
      }),
      ok: true,
    },
    {
      name: "ukjent check_code",
      row: () => ({ checkCode: "unknown_code" as never }),
      ok: false,
    },
    {
      name: "advarselskode som sperre",
      row: (e) => ({ ...overriddenBlocker(e), checkCode: "tg2_tg3_missing_measure" }),
      ok: false,
    },
    {
      name: "sperrekode som advarsel",
      row: () => ({ checkCode: "tg3_missing_cost", severity: "warning" }),
      ok: false,
    },
    {
      name: "overstyrt advarsel",
      row: (e) => ({
        ...overriddenBlocker(e),
        checkCode: "tg2_tg3_missing_measure",
        severity: "warning",
      }),
      ok: false,
    },
    {
      name: "sperre i utgivelse som ikke er overstyrt",
      row: () => ({ checkCode: "tg3_missing_cost", severity: "blocker", overridden: false }),
      ok: false,
    },
    {
      name: "overstyrt uten overridden_by",
      row: (e) => ({ ...overriddenBlocker(e), overriddenBy: null }),
      ok: false,
    },
    {
      name: "overstyrt uten overridden_at",
      row: (e) => ({ ...overriddenBlocker(e), overriddenAt: null }),
      ok: false,
    },
    {
      name: "overstyrt uten override_reason_code",
      row: (e) => ({
        ...overriddenBlocker(e),
        overrideReasonCode: null,
        overrideReason: "Tekst her nok.",
      }),
      ok: false,
    },
    {
      name: "ikke overstyrt med overridden_by",
      row: (e) => ({ overriddenBy: e }),
      ok: false,
    },
    {
      name: "ikke overstyrt med overridden_at",
      row: () => ({ overriddenAt: new Date("2026-11-17T10:00:00Z") }),
      ok: false,
    },
    {
      name: "ikke overstyrt med override_reason_code",
      row: () => ({ overrideReasonCode: "described_elsewhere" }),
      ok: false,
    },
    {
      name: "ikke overstyrt med override_reason",
      row: () => ({ overrideReason: "Oppdiktet tekst." }),
      ok: false,
    },
    {
      name: "«Annet» uten tekst",
      row: (e) => ({ ...overriddenBlocker(e), overrideReasonCode: "other", overrideReason: null }),
      ok: false,
    },
    {
      name: "blank tekst",
      row: (e) => ({ ...overriddenBlocker(e), overrideReasonCode: "other", overrideReason: "   " }),
      ok: false,
    },
    {
      name: "tekst på 1000 tegn",
      row: (e) => ({ ...overriddenBlocker(e), overrideReason: "a".repeat(1000) }),
      ok: true,
    },
    {
      name: "tekst over 1000 tegn",
      row: (e) => ({ ...overriddenBlocker(e), overrideReason: "a".repeat(1001) }),
      ok: false,
    },
    {
      name: "ukjent grunn",
      row: (e) => ({ ...overriddenBlocker(e), overrideReasonCode: "because" as never }),
      ok: false,
    },
    {
      name: "source = 'ai' med severity = 'blocker'",
      row: (e) => ({ ...overriddenBlocker(e), source: "ai" }),
      ok: false,
    },
    {
      name: "source = 'ai' med severity = 'warning'",
      row: () => ({ source: "ai", checkCode: "tg2_tg3_missing_measure", severity: "warning" }),
      ok: true,
    },
    {
      name: "ukjent source",
      row: () => ({ source: "human" as never }),
      ok: false,
    },
    {
      name: "target_ref som ikke er et objekt",
      row: () => ({ targetRef: ["x"] as never }),
      ok: false,
    },
  ];

  it.each(CASES)("$name → $ok", async ({ row, ok }) => {
    const { org, employee, release } = await releaseFixture();
    const insert = () =>
      createPublishCheckResultRow(org.id, {
        releaseId: release.id,
        reportId: release.reportId,
        ...row(employee.id),
      });
    if (ok) await expect(insert()).resolves.toMatchObject({ organizationId: org.id });
    else await expectPgError(insert, CHECK);
  });

  it("source er 'rule' når den ikke er satt", async () => {
    const { org, release } = await releaseFixture();
    const row = await createPublishCheckResultRow(org.id, {
      releaseId: release.id,
      reportId: release.reportId,
    });
    expect(row.source).toBe("rule");
  });
});

describe("3.2 report_releases", () => {
  it("version_number = 0 avvises", async () => {
    const org = await createOrganization();
    await expectPgError(() => createReportReleaseRow(org.id, { versionNumber: 0 }), CHECK);
  });

  it("to utgivelser med samme versjon på samme rapport avvises; ny versjon og annen rapport går", async () => {
    const org = await createOrganization();
    const first = await createReportReleaseRow(org.id);
    await expectPgError(
      () => createReportReleaseRow(org.id, { reportId: first.reportId, versionNumber: 1 }),
      UNIQUE,
    );
    await createReportReleaseRow(org.id, { reportId: first.reportId, versionNumber: 2 });
    await createReportReleaseRow(org.id, { versionNumber: 1 });
  });

  it("mykt slettet utgivelse frigjør ikke versjonsnummeret (indeksen er ikke delvis)", async () => {
    const org = await createOrganization();
    const first = await createReportReleaseRow(org.id, { deletedAt: new Date() });
    await expectPgError(
      () => createReportReleaseRow(org.id, { reportId: first.reportId, versionNumber: 1 }),
      UNIQUE,
    );
  });

  it("content_hash som ikke er 64 tegn hex avvises", async () => {
    const org = await createOrganization();
    await expectPgError(() => createReportReleaseRow(org.id, { contentHash: "abc" }), CHECK);
  });

  it("retain_until som ikke er etter released_at avvises", async () => {
    const org = await createOrganization();
    const releasedAt = new Date("2026-11-17T10:00:00Z");
    await expectPgError(
      () => createReportReleaseRow(org.id, { releasedAt, retainUntil: releasedAt }),
      CHECK,
    );
  });

  it("snapshot uten schema_version avvises", async () => {
    const org = await createOrganization();
    await expectPgError(
      () => createReportReleaseRow(org.id, { snapshot: { report: {} } as never }),
      CHECK,
    );
  });

  it.each([
    "released_by",
    "signed_by_employee_id",
    "certification_id",
    "company_id",
    "content_hash",
    "retain_until",
    "released_at",
    "original_release_date",
    "snapshot",
  ])("%s er NOT NULL", async (column) => {
    const org = await createOrganization();
    const release = await createReportReleaseRow(org.id);
    const report = await createReportRow(org.id);
    // Kopi av en gyldig rad til en ny rapport, med én kolonne satt til null.
    await expectPgError(
      () =>
        db.execute(sql`
          insert into report_releases (id, organization_id, report_id, version_number, released_at,
            released_by, signed_by_employee_id, certification_id, company_id,
            original_release_date, valid_until, snapshot, content_hash, retain_until)
          select ${uuidv7()}, organization_id, ${report.id}, 1,
            ${column === "released_at" ? sql`null` : sql`released_at`},
            ${column === "released_by" ? sql`null` : sql`released_by`},
            ${column === "signed_by_employee_id" ? sql`null` : sql`signed_by_employee_id`},
            ${column === "certification_id" ? sql`null` : sql`certification_id`},
            ${column === "company_id" ? sql`null` : sql`company_id`},
            ${column === "original_release_date" ? sql`null` : sql`original_release_date`},
            valid_until,
            ${column === "snapshot" ? sql`null` : sql`snapshot`},
            ${column === "content_hash" ? sql`null` : sql`content_hash`},
            ${column === "retain_until" ? sql`null` : sql`retain_until`}
          from report_releases where id = ${release.id}`),
      NOT_NULL,
    );
  });

  it("valid_until kan være tom (befaringsdato manglet, sperren krysset bort)", async () => {
    const org = await createOrganization();
    const release = await createReportReleaseRow(org.id, { validUntil: null });
    expect(release.validUntil).toBeNull();
  });
});

describe("3.3 sammensatte fremmednøkler", () => {
  it("sjekkrad i organisasjon A som peker på utgivelse i B avvises", async () => {
    const a = await releaseFixture("Oppdiktet Takst A");
    const b = await releaseFixture("Oppdiktet Takst B");
    await expectPgError(
      () =>
        createPublishCheckResultRow(a.org.id, {
          releaseId: b.release.id,
          reportId: b.release.reportId,
        }),
      FOREIGN_KEY,
    );
  });

  it("sjekkrad med riktig organisasjon men annen report_id enn utgivelsen avvises", async () => {
    const a = await releaseFixture();
    const otherReport = await createReportRow(a.org.id);
    await expectPgError(
      () =>
        createPublishCheckResultRow(a.org.id, {
          releaseId: a.release.id,
          reportId: otherReport.id,
        }),
      FOREIGN_KEY,
    );
  });

  it("overridden_by fra annen organisasjon avvises", async () => {
    const a = await releaseFixture("Oppdiktet Takst A");
    const b = await releaseFixture("Oppdiktet Takst B");
    await expectPgError(
      () =>
        createPublishCheckResultRow(a.org.id, {
          releaseId: a.release.id,
          reportId: a.release.reportId,
          ...overriddenBlocker(b.employee.id),
        }),
      FOREIGN_KEY,
    );
  });

  it("utgivelse for rapport i annen organisasjon avvises", async () => {
    const a = await createOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    const foreignReport = await createReportRow(b.id);
    await expectPgError(
      () => createReportReleaseRow(a.id, { reportId: foreignReport.id }),
      FOREIGN_KEY,
    );
  });

  it.each(["releasedBy", "signedByEmployeeId"] as const)(
    "%s fra annen organisasjon avvises",
    async (field) => {
      const a = await createOrganization("Oppdiktet Takst A");
      const b = await createOrganization("Oppdiktet Takst B");
      const ownEmployee = await createEmployee(await createUser(), a.id, ["inspector"]);
      const ownCertification = await createCertification({
        id: ownEmployee.id,
        organizationId: a.id,
      });
      const foreignEmployee = await createEmployee(await createUser(), b.id, ["inspector"]);
      await expectPgError(
        () =>
          createReportReleaseRow(a.id, {
            signedByEmployeeId: ownEmployee.id,
            releasedBy: ownEmployee.id,
            certificationId: ownCertification.id,
            [field]: foreignEmployee.id,
          }),
        FOREIGN_KEY,
      );
    },
  );

  it("certification_id fra annen organisasjon avvises", async () => {
    const a = await createOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    const foreignEmployee = await createEmployee(await createUser(), b.id, ["inspector"]);
    const foreignCertification = await createCertification({
      id: foreignEmployee.id,
      organizationId: b.id,
    });
    await expectPgError(
      () => createReportReleaseRow(a.id, { certificationId: foreignCertification.id }),
      FOREIGN_KEY,
    );
  });

  it("company_id fra annen organisasjon avvises", async () => {
    const a = await createOrganization("Oppdiktet Takst A");
    const b = await createOrganization("Oppdiktet Takst B");
    const foreignCompany = await createCompany(b.id);
    await expectPgError(
      () => createReportReleaseRow(a.id, { companyId: foreignCompany.id }),
      FOREIGN_KEY,
    );
  });
});

describe("3.4 tenant-tabellene", () => {
  it.each(["report_releases", "publish_check_results"])(
    "%s står i tests/tenant-tables.ts med radbygger og testfil",
    async (table) => {
      const entry = tenantTables.find((t) => t.table === table);
      expect(entry).toBeDefined();
      expect(entry!.testFile).toMatch(/\.test\.ts$/u);
      const org = await createOrganization();
      await expect(entry!.insertRow(org.id)).resolves.toEqual(expect.any(String));
    },
  );
});
