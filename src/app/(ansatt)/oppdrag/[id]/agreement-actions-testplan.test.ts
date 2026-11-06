import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { AgreementNotUsableError, NotFoundError } from "@/core/agreements";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Handlingen for kortet «Avtale» på oppdragssiden (`setAgreementAction`), kjernen og konteksten
 * byttet ut. Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 8.
 *
 * Feltnavn: assignmentId, agreementId («» = «Ingen avtale»). Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (aldri feil organisasjon; «Avtalen gjelder ikke i dag.» og
 * «Avtalen er fjernet.» vises) og tid («Ingen avtale» er ett trykk).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  setAssignmentAgreement: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/agreements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/agreements")>()),
  setAssignmentAgreement: mocks.setAssignmentAgreement,
}));

const { setAgreementAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const AGREEMENT = "0190a000-0000-7000-8000-0000000000a1";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function run(entries: Record<string, string>): Promise<FormState> {
  return setAgreementAction(initialFormState, form(entries)).catch((error: unknown) => {
    // Handlingen kan sende videre ved suksess; da er svaret «ingen feil»
    if (/^REDIRECT /.test((error as Error).message)) return initialFormState;
    throw error;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.setAssignmentAgreement.mockResolvedValue({
    id: ASSIGNMENT,
    organizationId: ORG,
    clientAgreementId: AGREEMENT,
    changed: true,
  });
});

describe("8 setAgreementAction", () => {
  it("8.1 getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT });
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.setAssignmentAgreement).not.toHaveBeenCalled();
  });

  it.each([
    { name: "assignmentId", entries: { assignmentId: "ikke-en-id", agreementId: AGREEMENT } },
    { name: "agreementId", entries: { assignmentId: ASSIGNMENT, agreementId: "ikke-en-id" } },
  ])("8.2 $name som ikke er uuid → «ingen tilgang» uten kall", async ({ entries }) => {
    const state = await run(entries);
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.setAssignmentAgreement).not.toHaveBeenCalled();
  });

  it("8.3 organizationId i skjemaet endrer ikke kallet", async () => {
    await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT, organizationId: OTHER_ORG });
    expect(mocks.setAssignmentAgreement).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, calledAssignment, calledAgreement] =
      mocks.setAssignmentAgreement.mock.calls[0]!;
    expect(calledActor).toEqual(actor);
    expect(calledOrg).toBe(ORG);
    expect(calledAssignment).toBe(ASSIGNMENT);
    expect(calledAgreement).toBe(AGREEMENT);
    expect(JSON.stringify(mocks.setAssignmentAgreement.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("8.5 «Ingen avtale» (tom agreementId) sendes som null", async () => {
    await run({ assignmentId: ASSIGNMENT, agreementId: "" });
    expect(mocks.setAssignmentAgreement).toHaveBeenCalledTimes(1);
    expect(mocks.setAssignmentAgreement.mock.calls[0]![3]).toBeNull();
  });

  it("8.4 AccessDeniedError → «ingen tilgang»", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new AccessDeniedError());
    const state = await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT });
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each(["Avtalen gjelder ikke i dag.", "Avtalen er fjernet."] as const)(
    "8.4 «%s» vises",
    async (message) => {
      mocks.setAssignmentAgreement.mockRejectedValue(new AgreementNotUsableError(message));
      const state = await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT });
      const shown = [state.message ?? "", ...Object.values(state.fieldErrors)];
      expect(shown).toContain(message);
    },
  );

  it("8.4 NotFoundError → norsk melding, ikke «ukjent feil»", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new NotFoundError());
    const state = await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT });
    expect(state.message ?? "").not.toBe("");
    expect(state.message).not.toBe(UNKNOWN_ERROR);
  });

  it("8.4 ukjent feil → «ukjent feil», loggen har ingen avtalenavn eller premisser", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new Error("boom"));
    const state = await run({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT });
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalled();
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toMatch(/Premiss|Testavtale/);
  });
});
