import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  AssignmentCannotBeCancelledError,
  AssignmentStatusConflictError,
  AssignmentTransitionNotAllowedError,
} from "@/core/assignments/errors";
import { cancelAssignmentInputSchema } from "@/core/assignments/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR } from "../../form-state";

/*
 * Statushandlingene på oppdragssiden (docs/funksjoner/fase2a-statusflyt-testplan.md avsnitt 4).
 * Kjernen og konteksten er byttet ut; kjernen testes i src/core/assignments. Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (feil vises i kortet, kansellering sender videre med kvittering) og
 * reklamasjoner (aldri feil organisasjon, aldri grunnen i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  core: {
    changeAssignmentStatus: vi.fn(),
    cancelAssignment: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assignments")>()),
  ...mocks.core,
}));

const { changeStatusAction, cancelAssignmentAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const NUMBER = "2026-00042";
const REASON = "Kunden trakk bestillingen";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function changeForm(overrides: Record<string, string> = {}) {
  return form({
    assignmentId: ASSIGNMENT,
    expectedStatus: "in_progress",
    toStatus: "ordered",
    reason: "Feiltrykk",
    ...overrides,
  });
}

function cancelForm(overrides: Record<string, string> = {}) {
  return form({
    assignmentId: ASSIGNMENT,
    expectedStatus: "ordered",
    reason: REASON,
    ...overrides,
  });
}

const ACTIONS = [
  ["changeStatusAction", () => changeStatusAction(initialFormState, changeForm())],
  ["cancelAssignmentAction", () => cancelAssignmentAction(initialFormState, cancelForm())],
] as const;

const CORE_FOR_ACTION = {
  changeStatusAction: mocks.core.changeAssignmentStatus,
  cancelAssignmentAction: mocks.core.cancelAssignment,
} as const;

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    canManageContacts: false,
    officeId: null,
  });
  const result = { id: ASSIGNMENT, number: NUMBER, status: "ordered", deletedAt: null };
  mocks.core.changeAssignmentStatus.mockResolvedValue(result);
  mocks.core.cancelAssignment.mockResolvedValue({ ...result, deletedAt: new Date() });
});

describe("4.1 uten kontekst", () => {
  it.each(ACTIONS)("%s: NO_ACCESS uten kall til kjernen", async (_name, action) => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await action();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("4.2 ugyldige verdier i skjemaet", () => {
  it.each(["ikke-en-id", "1 or 1=1", ""])("oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const change = await changeStatusAction(initialFormState, changeForm({ assignmentId: id }));
    const cancel = await cancelAssignmentAction(initialFormState, cancelForm({ assignmentId: id }));
    expect(change.message).toBe(NO_ACCESS);
    expect(cancel.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("ukjent statuskode → NO_ACCESS uten kall", async () => {
    const a = await changeStatusAction(initialFormState, changeForm({ toStatus: "cancelled" }));
    const b = await changeStatusAction(initialFormState, changeForm({ expectedStatus: "done" }));
    const c = await cancelAssignmentAction(initialFormState, cancelForm({ expectedStatus: "x" }));
    for (const state of [a, b, c]) expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("4.3 organisasjonen kommer fra konteksten", () => {
  it("changeStatusAction: organizationId i skjemaet endrer ikke kallet", async () => {
    await changeStatusAction(initialFormState, changeForm({ organizationId: OTHER_ORG }));
    expect(mocks.core.changeAssignmentStatus).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT, {
      expectedStatus: "in_progress",
      toStatus: "ordered",
      reason: "Feiltrykk",
    });
    expect(JSON.stringify(mocks.core.changeAssignmentStatus.mock.calls)).not.toContain(OTHER_ORG);
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("changeStatusAction: tom grunn ved steg fram sendes som undefined", async () => {
    await changeStatusAction(
      initialFormState,
      changeForm({ expectedStatus: "ordered", toStatus: "in_progress", reason: "" }),
    );
    const input = mocks.core.changeAssignmentStatus.mock.calls[0]![3] as Record<string, unknown>;
    expect(input.reason).toBeUndefined();
  });

  it("cancelAssignmentAction: organizationId i skjemaet endrer ikke kallet", async () => {
    await expect(
      cancelAssignmentAction(initialFormState, cancelForm({ organizationId: OTHER_ORG })),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.core.cancelAssignment).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT, {
      expectedStatus: "ordered",
      reason: REASON,
    });
    expect(JSON.stringify(mocks.core.cancelAssignment.mock.calls)).not.toContain(OTHER_ORG);
  });
});

describe("4.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → NO_ACCESS", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
    expect((await action()).message).toBe(NO_ACCESS);
  });

  it.each(ACTIONS)("%s: konflikt → kortets tekst", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AssignmentStatusConflictError());
    expect((await action()).message).toBe("Statusen er endret av noen andre. Last siden på nytt.");
  });

  it("changeStatusAction: ulovlig overgang → norsk melding", async () => {
    mocks.core.changeAssignmentStatus.mockRejectedValue(
      new AssignmentTransitionNotAllowedError("ordered", "invoiced"),
    );
    const state = await changeStatusAction(initialFormState, changeForm());
    expect(state.message).toBe("Oppdraget kan ikke flyttes fra Bestilt til Fakturert.");
  });

  it("cancelAssignmentAction: kan ikke kanselleres → norsk melding", async () => {
    mocks.core.cancelAssignment.mockRejectedValue(new AssignmentCannotBeCancelledError());
    const state = await cancelAssignmentAction(initialFormState, cancelForm());
    expect(state.message).toBe("Et oppdrag som er Ferdig eller Fakturert kan ikke kanselleres.");
  });

  it.each(ACTIONS)("%s: ZodError → melding ved grunnfeltet", async (name, action) => {
    const result = cancelAssignmentInputSchema.safeParse({
      expectedStatus: "ordered",
      reason: " ",
    });
    expect(result.success).toBe(false);
    CORE_FOR_ACTION[name].mockRejectedValue(result.error);
    const state = await action();
    expect(state.fieldErrors.reason).toBe("Skriv en grunn.");
  });

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new Error("oppdiktet feil"));
    expect((await action()).message).toBe(UNKNOWN_ERROR);
  });
});

describe("4.5 kansellering lykkes", () => {
  it("sender til arbeidskøen med oppdragsnummeret", async () => {
    await expect(cancelAssignmentAction(initialFormState, cancelForm())).rejects.toThrow(
      `REDIRECT /arbeidskoe?kansellert=${NUMBER}`,
    );
  });

  it("nummer som ikke ser ut som et oppdragsnummer, kommer ikke med i adressen", async () => {
    mocks.core.cancelAssignment.mockResolvedValue({ id: ASSIGNMENT, number: "<b>x</b>" });
    await expect(cancelAssignmentAction(initialFormState, cancelForm())).rejects.toThrow(
      /^REDIRECT \/arbeidskoe$/,
    );
  });
});

describe("4.6 loggkontrakt", () => {
  it.each(ACTIONS)("%s: grunnen står aldri i loggen", async (name, action) => {
    const boom = new Error(`databasen sa nei til ${REASON} Feiltrykk`);
    boom.name = "OppdiktetFeil";
    CORE_FOR_ACTION[name].mockRejectedValue(boom);
    await action();
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).not.toContain(REASON);
    expect(logged).not.toContain("Feiltrykk");
  });
});
