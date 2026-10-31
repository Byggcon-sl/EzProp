import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCertification,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  CERTIFICATION_EXPIRY_WARNING_DAYS,
  addDaysToIsoDate,
  certificationAreaLabels,
  certificationAreas,
  isCertificationValid,
  todayInOslo,
} from "./certification";
import { AccessDeniedError } from "./errors";
import { requireOrganizationAccess } from "./guards";
import { permissions } from "./permissions";

const TODAY = "2026-10-31";

describe("datoregelen for sertifisering", () => {
  it.each([
    { name: "utløper i dag", validFrom: null, validTo: "2026-10-31", deletedAt: null, ok: true },
    { name: "utløp i går", validFrom: null, validTo: "2026-10-30", deletedAt: null, ok: false },
    {
      name: "starter i morgen",
      validFrom: "2026-11-01",
      validTo: "2028-01-01",
      deletedAt: null,
      ok: false,
    },
    {
      name: "starter i dag",
      validFrom: "2026-10-31",
      validTo: "2027-10-31",
      deletedAt: null,
      ok: true,
    },
    { name: "uten gyldig fra", validFrom: null, validTo: "2027-10-31", deletedAt: null, ok: true },
    {
      name: "slettet",
      validFrom: null,
      validTo: "2027-10-31",
      deletedAt: new Date("2026-10-01T10:00:00Z"),
      ok: false,
    },
  ])("$name = $ok", ({ validFrom, validTo, deletedAt, ok }) => {
    expect(isCertificationValid({ validFrom, validTo, deletedAt }, TODAY)).toBe(ok);
  });

  it.each([
    ["2026-10-30T23:30:00Z", "2026-10-31"],
    ["2026-10-30T22:30:00Z", "2026-10-30"],
    ["2026-10-31T22:59:59Z", "2026-10-31"],
    ["2026-10-31T23:00:00Z", "2026-11-01"],
    ["2026-06-30T22:30:00Z", "2026-07-01"],
  ])("todayInOslo(%s) = %s", (iso, expected) => {
    expect(todayInOslo(new Date(iso))).toBe(expected);
  });

  it("legger til dager over månedsskifte og nyttår", () => {
    expect(addDaysToIsoDate("2026-10-31", 60)).toBe("2026-12-30");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(CERTIFICATION_EXPIRY_WARNING_DAYS).toBe(60);
  });

  it("område er fast kode med én verdi", () => {
    expect(certificationAreas).toEqual(["condition_report"]);
    expect(certificationAreaLabels).toEqual({ condition_report: "Tilstandsrapport bolig" });
  });
});

describe("report.publish krever gyldig sertifisering", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["inspector", "manager", "admin"] as const)(
    "%s uten, med utgått og med gyldig sertifisering",
    async (role) => {
      const org = await createOrganization();
      const user = await createUser();
      const employee = await createEmployee(user, org.id, [role]);

      await expect(requireOrganizationAccess(user, org.id, "report.publish")).rejects.toThrow(
        AccessDeniedError,
      );
      await createCertification(employee, { validTo: "2026-10-30" });
      await expect(requireOrganizationAccess(user, org.id, "report.publish")).rejects.toThrow(
        AccessDeniedError,
      );
      await createCertification(employee, { validTo: "2026-10-31" });
      await expect(
        requireOrganizationAccess(user, org.id, "report.publish"),
      ).resolves.toBeDefined();
    },
  );

  it("utløp ved midnatt i norsk tid", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await createCertification(employee, { validTo: "2026-10-31" });

    vi.setSystemTime(new Date("2026-10-31T22:59:59Z"));
    await expect(requireOrganizationAccess(user, org.id, "report.publish")).resolves.toBeDefined();
    vi.setSystemTime(new Date("2026-10-31T23:00:00Z"));
    await expect(requireOrganizationAccess(user, org.id, "report.publish")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("sertifisering i en annen organisasjon eller på en kollega teller ikke", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const user = await createUser();
    const colleague = await createUser();
    await createEmployee(user, orgA.id, ["inspector"]);
    const inB = await createEmployee(user, orgB.id, ["inspector"]);
    const colleagueInA = await createEmployee(colleague, orgA.id, ["inspector"]);
    await createCertification(inB);
    await createCertification(colleagueInA);

    await expect(requireOrganizationAccess(user, orgA.id, "report.publish")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(requireOrganizationAccess(user, orgB.id, "report.publish")).resolves.toBeDefined();
  });

  // Regel 11: admin stenges aldri ute. Denne testen skal aldri fjernes.
  it("admin uten sertifisering har alt unntatt report.publish", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["admin"]);

    const grant = await requireOrganizationAccess(user, org.id, "organization.manage");
    expect([...grant.permissions].sort()).toEqual(
      permissions.filter((p) => p !== "report.publish").sort(),
    );
    await expect(requireOrganizationAccess(user, org.id, "staff.manage")).resolves.toBeDefined();
  });
});
