import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { NotFoundError } from "@/core/agreements";
import { agreementSchema } from "@/core/agreements/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Server actions i /admin/avtaler, kjernen og konteksten byttet ut.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 8.
 *
 * Testene viser at organisasjonen kommer fra konteksten, at id-er sjekkes før kjernen kalles,
 * at feilene gir faste meldinger, og at premisseteksten aldri havner i loggen.
 * Feltnavn i skjemaet (som i kjernen): id, firmId, name, validFrom, validTo, premiseText,
 * reportProfileCode. Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (aldri feil organisasjon, aldri premisseteksten i loggen) og
 * tid (feil periode vises ved feltet).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  core: {
    createAgreement: vi.fn(),
    updateAgreement: vi.fn(),
    deleteAgreement: vi.fn(),
    listAgreements: vi.fn(),
    getAgreement: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: mocks.logWarn, info: mocks.logInfo },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/agreements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/agreements")>()),
  ...mocks.core,
}));

const { saveAgreementAction, deleteAgreementAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const AGREEMENT = "0190a000-0000-7000-8000-0000000000a1";
const FIRM = "0190a000-0000-7000-8000-0000000000f1";
const PREMISE = "Premiss for test. Ikke ekte tekst.";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function agreementForm(overrides: Record<string, string> = {}): FormData {
  return form({
    id: "",
    firmId: FIRM,
    name: "Testavtale forsikring",
    validFrom: "2026-01-01",
    validTo: "",
    premiseText: PREMISE,
    reportProfileCode: "test-profil",
    ...overrides,
  });
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

async function settle(run: Promise<FormState>): Promise<FormState | string> {
  return run.then(
    (state) => state,
    (error: unknown) => {
      const match = /^REDIRECT (.+)$/.exec((error as Error).message);
      if (!match) throw error;
      return match[1]!;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.core.createAgreement.mockResolvedValue({ id: AGREEMENT });
  mocks.core.updateAgreement.mockResolvedValue({ id: AGREEMENT });
  mocks.core.deleteAgreement.mockResolvedValue({ id: AGREEMENT });
});

describe("8.1 uten kontekst", () => {
  it.each([
    ["saveAgreementAction (ny)", () => saveAgreementAction(initialFormState, agreementForm())],
    [
      "saveAgreementAction (endre)",
      () => saveAgreementAction(initialFormState, agreementForm({ id: AGREEMENT })),
    ],
    ["deleteAgreementAction", () => deleteAgreementAction(initialFormState, form({ id: AGREEMENT }))],
  ])("%s: getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen", async (_n, run) => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = (await settle(run())) as FormState;
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("8.2 id som ikke er uuid", () => {
  it.each([
    [
      "saveAgreementAction",
      () => saveAgreementAction(initialFormState, agreementForm({ id: "ikke-en-id" })),
    ],
    [
      "deleteAgreementAction",
      () => deleteAgreementAction(initialFormState, form({ id: "ikke-en-id" })),
    ],
    ["deleteAgreementAction (tom)", () => deleteAgreementAction(initialFormState, form({ id: "" }))],
  ])("%s → «ingen tilgang» uten kall til kjernen", async (_n, run) => {
    const state = (await settle(run())) as FormState;
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("8.3 organisasjonen kommer fra konteksten", () => {
  it("organizationId i skjemaet endrer ikke kallet (ny, endre, fjerne)", async () => {
    await settle(saveAgreementAction(initialFormState, agreementForm({ organizationId: OTHER_ORG })));
    await settle(
      saveAgreementAction(
        initialFormState,
        agreementForm({ id: AGREEMENT, organizationId: OTHER_ORG }),
      ),
    );
    await settle(
      deleteAgreementAction(initialFormState, form({ id: AGREEMENT, organizationId: OTHER_ORG })),
    );

    expect(mocks.core.createAgreement).toHaveBeenCalledWith(actor, ORG, expect.anything());
    expect(mocks.core.updateAgreement).toHaveBeenCalledWith(
      actor,
      ORG,
      AGREEMENT,
      expect.anything(),
    );
    expect(mocks.core.deleteAgreement).toHaveBeenCalledWith(actor, ORG, AGREEMENT);
    const calls = JSON.stringify([
      mocks.core.createAgreement.mock.calls,
      mocks.core.updateAgreement.mock.calls,
      mocks.core.deleteAgreement.mock.calls,
    ]);
    expect(calls).not.toContain(OTHER_ORG);
  });
});

describe("8.4 feilene fra kjernen", () => {
  it("AccessDeniedError → «ingen tilgang»", async () => {
    mocks.core.createAgreement.mockRejectedValue(new AccessDeniedError());
    const state = (await settle(saveAgreementAction(initialFormState, agreementForm()))) as FormState;
    expect(state.message).toBe(NO_ACCESS);
  });

  it("ZodError (til-dato før fra-dato) → feil ved feltet validTo", async () => {
    const parsed = agreementSchema.safeParse({
      firmId: FIRM,
      name: "Testavtale forsikring",
      validFrom: "2026-03-01",
      validTo: "2026-02-28",
    });
    expect(parsed.success).toBe(false);
    mocks.core.createAgreement.mockRejectedValue(parsed.error);

    const state = (await settle(
      saveAgreementAction(
        initialFormState,
        agreementForm({ validFrom: "2026-03-01", validTo: "2026-02-28" }),
      ),
    )) as FormState;
    expect(state.fieldErrors.validTo).toBeTruthy();
    // Verdiene beholdes
    expect(state.values.validTo).toBe("2026-02-28");
  });

  it("NotFoundError → norsk melding, ikke «ukjent feil»", async () => {
    mocks.core.updateAgreement.mockRejectedValue(new NotFoundError());
    const state = (await settle(
      saveAgreementAction(initialFormState, agreementForm({ id: AGREEMENT })),
    )) as FormState;
    const messages = [state.message ?? "", ...Object.values(state.fieldErrors)].join(" ");
    expect(messages.trim()).not.toBe("");
    expect(state.message).not.toBe(UNKNOWN_ERROR);
  });

  it("ukjent feil → «ukjent feil»", async () => {
    mocks.core.deleteAgreement.mockRejectedValue(new Error("boom"));
    const state = (await settle(
      deleteAgreementAction(initialFormState, form({ id: AGREEMENT })),
    )) as FormState;
    expect(state.message).toBe(UNKNOWN_ERROR);
  });

  it("vellykket lagring sender videre til listen", async () => {
    const result = await settle(saveAgreementAction(initialFormState, agreementForm()));
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^\/admin\/avtaler/);
  });
});

describe("8.6 loggkontrakt", () => {
  it("loggkallene inneholder ikke premisseteksten", async () => {
    mocks.core.createAgreement.mockRejectedValue(new Error("boom"));
    mocks.core.updateAgreement.mockRejectedValue(new TypeError("boom"));

    await settle(saveAgreementAction(initialFormState, agreementForm()));
    await settle(saveAgreementAction(initialFormState, agreementForm({ id: AGREEMENT })));

    expect(mocks.logError).toHaveBeenCalled();
    const logged = JSON.stringify([
      mocks.logError.mock.calls,
      mocks.logWarn.mock.calls,
      mocks.logInfo.mock.calls,
    ]);
    expect(logged).not.toContain("Premiss for test");
  });
});
