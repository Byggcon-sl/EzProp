import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import type { ReportFieldChange } from "@/core/reports/types";
import { NO_ACCESS, SIGNED_OUT_MESSAGE, UNKNOWN_ERROR } from "../../../../form-state";
import { ROOM_ACTION_MESSAGES } from "./room-messages";

/*
 * Server actions for badet (docs/funksjoner/fase2a-badet-pc.md Omfang 8–10). Kjernen og
 * konteksten er byttet ut; tjenestene, tilgangen og tenant-isolasjonen testes i
 * `src/core/reports`. Her: organisasjonen kommer alltid fra konteksten (aldri fra innholdet), id-er
 * som ikke er uuid stoppes før kjernen, feil blir norsk melding, og loggen får aldri feltverdier.
 * Testdata er oppdiktet.
 * Støtter hovedmål: færre reklamasjoner (aldri feil organisasjon) og de ansatte (tydelige feil).
 */

class FakeReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}
class FakeReportTemplateMissingError extends Error {
  constructor() {
    super("Mangler mal");
    this.name = "ReportTemplateMissingError";
  }
}

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  getEmployeeContextForAction: vi.fn(),
  logError: vi.fn(),
  core: {
    startReport: vi.fn(),
    saveField: vi.fn(),
    addDeviation: vi.fn(),
    removeDeviation: vi.fn(),
    restoreDeviation: vi.fn(),
    addMeasure: vi.fn(),
    removeMeasure: vi.fn(),
    setTgDirect: vi.fn(),
    decideSuggestion: vi.fn(),
    setCheckpointDone: vi.fn(),
    changeSuggestedDeviationTg: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../employee-context", () => ({
  getEmployeeContext: mocks.getEmployeeContext,
  getEmployeeContextForAction: mocks.getEmployeeContextForAction,
}));
vi.mock("@/core/reports", () => ({
  ...mocks.core,
  ReportValidationError: FakeReportValidationError,
  ReportTemplateMissingError: FakeReportTemplateMissingError,
}));

const actions = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const ROOM = "0190a000-0000-7000-8000-000000000060";
const DEVIATION = "0190a000-0000-7000-8000-000000000070";
const SECRET_TEXT = "Oppdiktet fritekst som aldri skal i loggen";
const actor = { id: "user-takstmann", email: "takstmann@eksempel.no", name: "Takstmann Testesen" };
const ref = { assignmentId: ASSIGNMENT, roomId: ROOM };
const change: ReportFieldChange = {
  table: "deviations",
  id: DEVIATION,
  field: "cause_text",
  value: SECRET_TEXT,
  base: null,
};
const SAVED = {
  status: "saved",
  refresh: { checkpoints: [], suggestions: [], progress: { done: 0, total: 8 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  for (const fn of Object.values(mocks.core)) fn.mockResolvedValue(SAVED);
});

describe("handlingene på badet", () => {
  it.each([
    ["saveFieldAction", () => actions.saveFieldAction(ref, change), "saveField", change],
    [
      "addDeviationAction",
      () =>
        actions.addDeviationAction(ref, {
          id: DEVIATION,
          checkpointKey: "wet_room.floor",
          questionKey: "q",
          outcomeKey: "tg2",
          tg: 2,
        }),
      "addDeviation",
      expect.objectContaining({ id: DEVIATION }),
    ],
    [
      "removeDeviationAction",
      () => actions.removeDeviationAction(ref, DEVIATION),
      "removeDeviation",
      DEVIATION,
    ],
    [
      "setCheckpointDoneAction",
      () => actions.setCheckpointDoneAction(ref, { checkpointKey: "wet_room.floor", done: true }),
      "setCheckpointDone",
      { checkpointKey: "wet_room.floor", done: true },
    ],
  ] as const)(
    "%s bruker organisasjonen fra konteksten og bare rom-id-ene",
    async (_name, call, core, input) => {
      const result = await call();
      expect(result).toEqual(SAVED);
      const fn = mocks.core[core as keyof typeof mocks.core];
      expect(fn).toHaveBeenCalledWith(
        actor,
        ORG,
        { assignmentId: ASSIGNMENT, roomId: ROOM },
        input,
      );
    },
  );

  it("organisasjon i innholdet leses aldri", async () => {
    const forged = { ...ref, organizationId: OTHER_ORG } as typeof ref;
    await actions.saveFieldAction(forged, change);
    expect(mocks.core.saveField).toHaveBeenCalledWith(
      actor,
      ORG,
      { assignmentId: ASSIGNMENT, roomId: ROOM },
      change,
    );
  });

  it.each([
    ["ugyldig oppdrags-id", { assignmentId: "1; drop table", roomId: ROOM }],
    ["ugyldig rom-id", { assignmentId: ASSIGNMENT, roomId: "abc" }],
    ["mangler", null],
  ])("%s stoppes før kjernen", async (_name, badRef) => {
    const result = await actions.saveFieldAction(badRef as typeof ref, change);
    expect(result).toEqual({ status: "error", message: NO_ACCESS });
    expect(mocks.core.saveField).not.toHaveBeenCalled();
  });

  it("uten ansatt i organisasjonen: ingen tilgang, kjernen kalles ikke", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    expect(
      await actions.decideSuggestionAction(ref, {
        id: DEVIATION,
        ruleKey: "r",
        decision: "accepted",
      }),
    ).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    expect(mocks.core.decideSuggestion).not.toHaveBeenCalled();
  });

  it.each([
    ["AccessDeniedError (kontor eller annen organisasjon)", new AccessDeniedError(), NO_ACCESS],
    [
      "ReportValidationError",
      new FakeReportValidationError("Teksten er for lang."),
      "Teksten er for lang.",
    ],
    [
      "ReportTemplateMissingError",
      new FakeReportTemplateMissingError(),
      ROOM_ACTION_MESSAGES.templateMissing,
    ],
    ["ZodError", new ZodError([]), ROOM_ACTION_MESSAGES.invalid],
  ])("%s gir norsk melding uten logg", async (_name, error, message) => {
    mocks.core.saveField.mockRejectedValue(error);
    expect(await actions.saveFieldAction(ref, change)).toEqual({ status: "error", message });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ukjent feil logges med id-er og feilnavn, aldri med feltverdien", async () => {
    mocks.core.saveField.mockRejectedValue(new Error(`databasen sa nei: ${SECRET_TEXT}`));
    expect(await actions.saveFieldAction(ref, change)).toEqual({
      status: "error",
      message: UNKNOWN_ERROR,
    });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls[0]);
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).toContain(ASSIGNMENT);
    expect(logged).toContain("save_field");
  });
});

describe("startReportAction", () => {
  it("starter rapporten med organisasjonen fra konteksten", async () => {
    mocks.core.startReport.mockResolvedValue({ reportId: DEVIATION, created: true });
    expect(await actions.startReportAction(ASSIGNMENT)).toEqual({
      status: "started",
      reportId: DEVIATION,
    });
    expect(mocks.core.startReport).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT);
  });

  it("ugyldig id stoppes, og mangler mal gir tydelig melding", async () => {
    expect(await actions.startReportAction("x")).toEqual({ status: "error", message: NO_ACCESS });
    mocks.core.startReport.mockRejectedValue(new FakeReportTemplateMissingError());
    expect(await actions.startReportAction(ASSIGNMENT)).toEqual({
      status: "error",
      message: ROOM_ACTION_MESSAGES.templateMissing,
    });
  });
});

describe("changeSuggestedDeviationTgAction (T-0113, A490, FA-I37)", () => {
  const input = {
    id: "0190a000-0000-7000-8000-000000000080",
    deviationId: DEVIATION,
    tg: 2 as const,
    base: 3 as const,
    overrideReasonCode: "other" as const,
    overrideReason: SECRET_TEXT,
  };

  beforeEach(() => {
    mocks.getEmployeeContextForAction.mockResolvedValue({
      status: "ok",
      context: { actor, organizationId: ORG },
    });
  });

  it("bruker organisasjonen fra tilgangssjekken og bare rom-id-ene", async () => {
    const forged = { ...ref, organizationId: OTHER_ORG } as typeof ref;
    expect(await actions.changeSuggestedDeviationTgAction(forged, input)).toEqual(SAVED);
    expect(mocks.core.changeSuggestedDeviationTg).toHaveBeenCalledWith(
      actor,
      ORG,
      { assignmentId: ASSIGNMENT, roomId: ROOM },
      input,
    );
  });

  it("logget ut gir signedOut, og kjernen kalles ikke", async () => {
    mocks.getEmployeeContextForAction.mockResolvedValue({ status: "signed_out" });
    expect(await actions.changeSuggestedDeviationTgAction(ref, input)).toEqual({
      status: "error",
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
    });
    expect(mocks.core.changeSuggestedDeviationTg).not.toHaveBeenCalled();
  });

  it("uten ansatt eller med ugyldig rom: ingen tilgang, kjernen kalles ikke", async () => {
    mocks.getEmployeeContextForAction.mockResolvedValue({ status: "no_access" });
    expect(await actions.changeSuggestedDeviationTgAction(ref, input)).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    mocks.getEmployeeContextForAction.mockResolvedValue({
      status: "ok",
      context: { actor, organizationId: ORG },
    });
    expect(
      await actions.changeSuggestedDeviationTgAction(
        { assignmentId: "x", roomId: ROOM } as typeof ref,
        input,
      ),
    ).toEqual({ status: "error", message: NO_ACCESS });
    expect(mocks.core.changeSuggestedDeviationTg).not.toHaveBeenCalled();
  });

  it.each([
    ["AccessDeniedError", new AccessDeniedError(), NO_ACCESS],
    [
      "ReportValidationError (grunn mangler)",
      new FakeReportValidationError("Velg en grunn for å endre TG fra forslaget."),
      "Velg en grunn for å endre TG fra forslaget.",
    ],
  ])("%s gir norsk melding uten logg", async (_name, error, message) => {
    mocks.core.changeSuggestedDeviationTg.mockRejectedValue(error);
    expect(await actions.changeSuggestedDeviationTgAction(ref, input)).toEqual({
      status: "error",
      message,
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ukjent feil logges med id-er og handlingen, aldri med begrunnelsesteksten", async () => {
    mocks.core.changeSuggestedDeviationTg.mockRejectedValue(new Error(`feil: ${SECRET_TEXT}`));
    expect(await actions.changeSuggestedDeviationTgAction(ref, input)).toEqual({
      status: "error",
      message: UNKNOWN_ERROR,
    });
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).toContain("change_suggested_deviation_tg");
  });
});
