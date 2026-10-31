import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { initialFormState, NO_ACCESS } from "../../form-state";

/*
 * Server actions for sertifiseringer på /admin/ansatte/[id] (docs/funksjoner/fase0b-sertifisering.md,
 * Omfang 6). Kjernen er byttet ut her; den testes i src/core/organization. Testene viser at
 * organisasjonen kommer fra serveren, at id-er sjekkes før kjernen kalles, og at feilene havner
 * ved riktig felt.
 * Støtter hovedmål: reklamasjoner (bare gyldig sertifisering gir publisering) og tid (ett skjema).
 */

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  addCertification: vi.fn(),
  removeCertification: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("../../admin-context", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("@/core/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/organization")>()),
  addCertification: mocks.addCertification,
  removeCertification: mocks.removeCertification,
}));

const { addCertificationAction, removeCertificationAction } =
  await import("./certification-actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000010";
const CERTIFICATION = "0190a000-0000-7000-8000-000000000040";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const filled = {
  area: "condition_report",
  validTo: "2027-10-31",
  validFrom: "",
  certificateNumber: " TEST-CERT-0001 ",
  issuer: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminContext.mockResolvedValue({ actor, organizationId: ORG });
});

describe("addCertificationAction", () => {
  it("bruker organisasjonen fra serveren, ikke fra skjemaet, og sender videre", async () => {
    await expect(
      addCertificationAction(
        EMPLOYEE,
        initialFormState,
        form({ ...filled, organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${EMPLOYEE}?lagret=sertifisering`);
    expect(mocks.addCertification).toHaveBeenCalledWith(actor, ORG, {
      employeeId: EMPLOYEE,
      area: "condition_report",
      validTo: "2027-10-31",
      validFrom: null,
      certificateNumber: "TEST-CERT-0001",
      issuer: null,
    });
  });

  it("uten admin: ingen tilgang, og kjernen kalles ikke", async () => {
    mocks.getAdminContext.mockResolvedValue(null);
    const result = await addCertificationAction(EMPLOYEE, initialFormState, form(filled));
    expect(result.message).toBe(NO_ACCESS);
    expect(mocks.addCertification).not.toHaveBeenCalled();
  });

  it("ugyldig id på den ansatte: ingen tilgang, og kjernen kalles ikke", async () => {
    const result = await addCertificationAction("ikke-en-id", initialFormState, form(filled));
    expect(result.message).toBe(NO_ACCESS);
    expect(mocks.addCertification).not.toHaveBeenCalled();
  });

  it("avvist i kjernen (fremmed ansatt): ingen tilgang", async () => {
    mocks.addCertification.mockRejectedValue(new AccessDeniedError());
    const result = await addCertificationAction(EMPLOYEE, initialFormState, form(filled));
    expect(result.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["validTo", "Velg dato for gyldig til."],
    ["validFrom", "Gyldig fra kan ikke være etter gyldig til."],
  ])("feil i %s havner ved feltet, og verdiene beholdes", async (field, message) => {
    mocks.addCertification.mockRejectedValue(
      new ZodError([{ code: "custom", path: [field], message, input: undefined }]),
    );
    const result = await addCertificationAction(EMPLOYEE, initialFormState, form(filled));
    expect(result.fieldErrors).toEqual({ [field]: message });
    expect(result.values.certificateNumber).toBe(" TEST-CERT-0001 ");
    expect(result.attempt).toBe(1);
  });
});

describe("removeCertificationAction", () => {
  it("fjerner med organisasjonen fra serveren og sender videre", async () => {
    await expect(
      removeCertificationAction(EMPLOYEE, CERTIFICATION, initialFormState),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${EMPLOYEE}?lagret=sertifisering-fjernet`);
    expect(mocks.removeCertification).toHaveBeenCalledWith(actor, ORG, CERTIFICATION);
  });

  it.each([
    ["uten admin", EMPLOYEE, CERTIFICATION, false],
    ["ugyldig id på den ansatte", "x", CERTIFICATION, true],
    ["ugyldig id på sertifiseringen", EMPLOYEE, "x", true],
  ])("%s: ingen tilgang, og kjernen kalles ikke", async (_, employeeId, certId, admin) => {
    if (!admin) mocks.getAdminContext.mockResolvedValue(null);
    const result = await removeCertificationAction(employeeId, certId, initialFormState);
    expect(result.message).toBe(NO_ACCESS);
    expect(mocks.removeCertification).not.toHaveBeenCalled();
  });

  it("avvist i kjernen (fremmed sertifisering): ingen tilgang", async () => {
    mocks.removeCertification.mockRejectedValue(new AccessDeniedError());
    const result = await removeCertificationAction(EMPLOYEE, CERTIFICATION, initialFormState);
    expect(result.message).toBe(NO_ACCESS);
  });
});
