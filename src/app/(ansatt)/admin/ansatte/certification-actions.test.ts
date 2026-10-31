import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AccessDeniedError } from "@/core/access";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR } from "../form-state";

/*
 * Server actions for sertifiseringer (bit 2). Kjernen er byttet ut her; tilgang og
 * tenant-isolasjon testes i src/core/organization. Testene viser at organisasjonen alltid kommer
 * fra serveren, at id-er sjekkes før kjernen kalles, og at feilmeldingene står ved feltet.
 * Støtter hovedmål: reklamasjoner (riktig utløpsdato, admin ser hvem som må fornye).
 */

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  createCertification: vi.fn(),
  deleteCertification: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("../admin-context", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("@/core/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/organization")>()),
  createCertification: mocks.createCertification,
  deleteCertification: mocks.deleteCertification,
}));

const { createCertificationAction, deleteCertificationAction } =
  await import("./certification-actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000010";
const OTHER_EMPLOYEE = "0190a000-0000-7000-8000-000000000011";
const CERTIFICATION = "0190a000-0000-7000-8000-000000000040";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function coreCalls() {
  return mocks.createCertification.mock.calls.length + mocks.deleteCertification.mock.calls.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminContext.mockResolvedValue({ actor, organizationId: ORG });
});

describe("tilgang", () => {
  it.each([
    ["legg til", () => createCertificationAction(EMPLOYEE, initialFormState, form({}))],
    ["fjern", () => deleteCertificationAction(EMPLOYEE, CERTIFICATION, initialFormState)],
  ])("%s: ikke admin gir «ingen tilgang» uten kall til kjernen", async (_name, run) => {
    mocks.getAdminContext.mockResolvedValue(null);
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each([
    [
      "legg til, ugyldig ansatt-id",
      () =>
        createCertificationAction("1 or 1=1", initialFormState, form({ validTo: "2027-10-31" })),
    ],
    [
      "fjern, ugyldig ansatt-id",
      () => deleteCertificationAction("", CERTIFICATION, initialFormState),
    ],
    [
      "fjern, ugyldig sertifiserings-id",
      () => deleteCertificationAction(EMPLOYEE, "../x", initialFormState),
    ],
  ])("%s gir «ingen tilgang» uten kall til kjernen", async (_name, run) => {
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("organisasjon og ansatt kommer fra serveren, aldri fra skjemaet", async () => {
    mocks.createCertification.mockResolvedValue({ id: CERTIFICATION });
    await expect(
      createCertificationAction(
        EMPLOYEE,
        initialFormState,
        form({
          validTo: "2027-10-31",
          organizationId: OTHER_ORG,
          employeeId: OTHER_EMPLOYEE,
        }),
      ),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${EMPLOYEE}?lagret=sertifisering`);
    expect(mocks.createCertification).toHaveBeenCalledWith(actor, ORG, {
      employeeId: EMPLOYEE,
      area: "condition_report",
      validTo: "2027-10-31",
      validFrom: null,
      certificateNumber: null,
      issuer: null,
    });
  });

  it("kjernen nekter (fremmed id): «ingen tilgang», ingen videresending", async () => {
    mocks.deleteCertification.mockRejectedValue(new AccessDeniedError());
    const state = await deleteCertificationAction(EMPLOYEE, CERTIFICATION, initialFormState);
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("legg til sertifisering", () => {
  it("sender alle feltene, trimmet, og ukjent område blir det forhåndsvalgte", async () => {
    mocks.createCertification.mockResolvedValue({ id: CERTIFICATION });
    await expect(
      createCertificationAction(
        EMPLOYEE,
        initialFormState,
        form({
          area: "electric",
          validTo: "2027-10-31",
          validFrom: "2025-11-01",
          certificateNumber: " TEST-CERT-0001 ",
          issuer: "Testsertifisering AS",
        }),
      ),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.createCertification).toHaveBeenCalledWith(actor, ORG, {
      employeeId: EMPLOYEE,
      area: "condition_report",
      validTo: "2027-10-31",
      validFrom: "2025-11-01",
      certificateNumber: "TEST-CERT-0001",
      issuer: "Testsertifisering AS",
    });
  });

  it("uten «Gyldig til»: melding ved feltet, verdiene står, ingen lagring", async () => {
    const state = await createCertificationAction(
      EMPLOYEE,
      initialFormState,
      form({ certificateNumber: "TEST-CERT-0001" }),
    );
    expect(state.fieldErrors).toEqual({ validTo: "Velg dato for gyldig til." });
    expect(state.values.certificateNumber).toBe("TEST-CERT-0001");
    expect(state.attempt).toBe(1);
    expect(coreCalls()).toBe(0);
  });

  it("«Gyldig fra» etter «Gyldig til»: melding ved «Gyldig fra», ingen lagring", async () => {
    const state = await createCertificationAction(
      EMPLOYEE,
      initialFormState,
      form({ validFrom: "2027-01-02", validTo: "2027-01-01" }),
    );
    expect(state.fieldErrors).toEqual({
      validFrom: "Gyldig fra kan ikke være etter gyldig til.",
    });
    expect(coreCalls()).toBe(0);
  });

  it("samme dag i begge feltene godtas", async () => {
    mocks.createCertification.mockResolvedValue({ id: CERTIFICATION });
    await expect(
      createCertificationAction(
        EMPLOYEE,
        initialFormState,
        form({ validFrom: "2027-01-01", validTo: "2027-01-01" }),
      ),
    ).rejects.toThrow("REDIRECT");
  });

  it("valideringsfeil fra kjernen vises ved feltet", async () => {
    const result = z.object({ validTo: z.string().date("Velg dato for gyldig til.") }).safeParse({
      validTo: "ikke-dato",
    });
    mocks.createCertification.mockRejectedValue(result.error);
    const state = await createCertificationAction(
      EMPLOYEE,
      initialFormState,
      form({ validTo: "ikke-dato" }),
    );
    expect(state.fieldErrors).toEqual({ validTo: "Velg dato for gyldig til." });
  });

  it("ukjent feil gir fast melding og logges uten skjemainnhold", async () => {
    mocks.createCertification.mockRejectedValue(new Error("TEST-CERT-0001 hemmelig"));
    const state = await createCertificationAction(
      EMPLOYEE,
      initialFormState,
      form({ validTo: "2027-10-31", certificateNumber: "TEST-CERT-0001" }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("TEST-CERT-0001");
  });
});

describe("fjern sertifisering", () => {
  it("kaller kjernen med organisasjonen fra serveren og sender tilbake til den ansatte", async () => {
    mocks.deleteCertification.mockResolvedValue({ id: CERTIFICATION });
    await expect(
      deleteCertificationAction(EMPLOYEE, CERTIFICATION, initialFormState),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${EMPLOYEE}?lagret=sertifisering-fjernet`);
    expect(mocks.deleteCertification).toHaveBeenCalledWith(actor, ORG, CERTIFICATION);
  });
});
