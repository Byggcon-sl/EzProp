import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  AGREEMENT_DELETED_MESSAGE,
  AGREEMENT_EXPIRED_MESSAGE,
  AgreementNotUsableError,
  NotFoundError,
} from "@/core/agreements";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Server action for kortet «Avtale» på oppdragssiden: «Bruk avtalen», velgeren og «Fjern»
 * (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 8). Kjernen og konteksten er
 * byttet ut; `setAssignmentAgreement` testes i src/core/agreements. Testene viser at
 * organisasjonen kommer fra serveren, at id-er som ikke er uuid stoppes før kjernen, at
 * «Ingen avtale» sendes som `null`, og at kjernens norske meldinger vises i kortet.
 *
 * Feltnavn: assignmentId, agreementId («» = «Ingen avtale»). Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (ett trykk på «Bruk avtalen») og reklamasjoner (utløpt eller fjernet
 * avtale gir en tydelig melding i stedet for feil premisser, aldri feil organisasjon).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  setAssignmentAgreement: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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
const AGREEMENT = "0190a000-0000-7000-8000-000000000040";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const PREMISE = "Premiss for test. Ikke ekte tekst.";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function agreementForm(overrides: Record<string, string> = {}) {
  return form({ assignmentId: ASSIGNMENT, agreementId: AGREEMENT, ...overrides });
}

/** Kjører handlingen; videresending (redirect kaster) gir `null`. */
async function run(promise: Promise<FormState>): Promise<FormState | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT ")) return null;
    throw error;
  }
}

async function failed(promise: Promise<FormState>): Promise<FormState> {
  const state = await run(promise);
  expect(state, "handlingen skulle svart med en feil").not.toBeNull();
  expect(state!.message, "handlingen skulle svart med en melding").toBeTruthy();
  return state!;
}

function allMessages(state: FormState): string[] {
  return [...Object.values(state.fieldErrors), state.message ?? ""];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    canReadClaims: false,
    canManageClaims: false,
    officeId: null,
  });
  mocks.setAssignmentAgreement.mockResolvedValue({ changed: true });
});

describe("8.1 uten kontekst", () => {
  it("getEmployeeContext gir null → NO_ACCESS uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await failed(setAgreementAction(initialFormState, agreementForm()));
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.setAssignmentAgreement).not.toHaveBeenCalled();
  });
});

describe("8.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x"];

  it.each([...BAD_IDS, ""])("oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(
      setAgreementAction(initialFormState, agreementForm({ assignmentId: id })),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.setAssignmentAgreement).not.toHaveBeenCalled();
  });

  it.each(BAD_IDS)("avtale-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(
      setAgreementAction(initialFormState, agreementForm({ agreementId: id })),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.setAssignmentAgreement).not.toHaveBeenCalled();
  });
});

describe("8.3 organisasjonen kommer fra konteksten", () => {
  it("organizationId i skjemaet endrer ikke kallet", async () => {
    await run(setAgreementAction(initialFormState, agreementForm({ organizationId: OTHER_ORG })));
    expect(mocks.setAssignmentAgreement).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, calledAssignment, calledAgreement] =
      mocks.setAssignmentAgreement.mock.calls[0]!;
    expect([calledActor, calledOrg, calledAssignment, calledAgreement]).toEqual([
      actor,
      ORG,
      ASSIGNMENT,
      AGREEMENT,
    ]);
    expect(JSON.stringify(mocks.setAssignmentAgreement.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("vellykket valg gir svar uten feil, ingen videresending, og siden lastes på nytt", async () => {
    const state = await run(setAgreementAction(initialFormState, agreementForm()));
    expect(state).not.toBeNull();
    expect(state!.message).toBeNull();
    expect(state!.fieldErrors).toEqual({});
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });
});

describe("8.5 «Ingen avtale» sendes som null", () => {
  it.each([
    ["tom streng", ""],
    ["bare mellomrom", "  "],
  ])("agreementId som %s → null", async (_name, value) => {
    const state = await run(
      setAgreementAction(initialFormState, agreementForm({ agreementId: value })),
    );
    expect(state?.message ?? null).toBeNull();
    expect(mocks.setAssignmentAgreement).toHaveBeenCalledTimes(1);
    expect(mocks.setAssignmentAgreement.mock.calls[0]!.slice(0, 4)).toEqual([
      actor,
      ORG,
      ASSIGNMENT,
      null,
    ]);
  });

  it("uten feltet agreementId → null (fjerne)", async () => {
    await run(setAgreementAction(initialFormState, form({ assignmentId: ASSIGNMENT })));
    expect(mocks.setAssignmentAgreement.mock.calls[0]![3]).toBeNull();
  });
});

describe("8.4 feil fra kjernen", () => {
  it("AccessDeniedError → NO_ACCESS", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new AccessDeniedError());
    const state = await failed(setAgreementAction(initialFormState, agreementForm()));
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each([AGREEMENT_EXPIRED_MESSAGE, AGREEMENT_DELETED_MESSAGE] as const)(
    "AgreementNotUsableError «%s» vises i kortet",
    async (message) => {
      mocks.setAssignmentAgreement.mockRejectedValue(new AgreementNotUsableError(message));
      const state = await failed(setAgreementAction(initialFormState, agreementForm()));
      expect(allMessages(state)).toContain(message);
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );

  it("meldingene er de norske fra kortet", () => {
    expect(AGREEMENT_EXPIRED_MESSAGE).toBe("Avtalen gjelder ikke i dag.");
    expect(AGREEMENT_DELETED_MESSAGE).toBe("Avtalen er fjernet.");
  });

  it("NotFoundError (fremmed eller ukjent avtale/oppdrag) → norsk melding, ikke UNKNOWN_ERROR", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new NotFoundError());
    const state = await failed(setAgreementAction(initialFormState, agreementForm()));
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ZodError → melding, aldri krasj", async () => {
    const error = new ZodError([
      { code: "custom", path: ["agreementId"], message: "Velg en avtale.", input: "x" },
    ]);
    mocks.setAssignmentAgreement.mockRejectedValue(error);
    const state = await failed(setAgreementAction(initialFormState, agreementForm()));
    expect(allMessages(state).some((text) => text.length > 0)).toBe(true);
  });

  it("ukjent feil → UNKNOWN_ERROR og én loggrad", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new Error("databasen svarte ikke"));
    const state = await failed(setAgreementAction(initialFormState, agreementForm()));
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});

describe("8.6 loggkontrakt", () => {
  it("loggen har id-er og feilnavn, men aldri premisseteksten eller feilmeldingen", async () => {
    mocks.setAssignmentAgreement.mockRejectedValue(new TypeError(`krasj med ${PREMISE}`));
    await failed(setAgreementAction(initialFormState, agreementForm()));
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(PREMISE);
    expect(logged).not.toContain("krasj med");
    expect(logged).toContain(ASSIGNMENT);
    expect(logged).toContain(actor.id);
    expect(logged).toContain("TypeError");
  });
});
