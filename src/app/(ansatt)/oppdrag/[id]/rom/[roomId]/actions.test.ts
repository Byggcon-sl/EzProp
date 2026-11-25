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
  revalidatePath: vi.fn(),
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
    findOutcomes: vi.fn(),
    chooseOutcomeMatch: vi.fn(),
    rejectOutcomeMatch: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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

  it("publisert rapport gir koden `report_published`, som køen fjerner i stedet for å stoppe (T-0001)", async () => {
    const published = Object.assign(
      new FakeReportValidationError("Rapporten er publisert. Lag ny versjon for å rette."),
      { code: "report_published" },
    );
    mocks.core.saveField.mockRejectedValue(published);
    expect(await actions.saveFieldAction(ref, change)).toEqual({
      status: "error",
      message: "Rapporten er publisert. Lag ny versjon for å rette.",
      code: "report_published",
    });
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

  it("FA-L29 grunnen mangler: svaret har koden `override_reason`, så skjermen ikke prøver igjen", async () => {
    const error = Object.assign(
      new FakeReportValidationError("Velg en grunn for å endre TG fra forslaget."),
      { code: "override_reason" },
    );
    mocks.core.changeSuggestedDeviationTg.mockRejectedValue(error);
    expect(await actions.changeSuggestedDeviationTgAction(ref, input)).toEqual({
      status: "error",
      message: "Velg en grunn for å endre TG fra forslaget.",
      code: "override_reason",
    });
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

// --- Rett forslag og avvik (rett-forslag-og-avvik-testplan.md 2e, FA-I32 og FA-I37) -----------

describe("already_decided og newer_decision", () => {
  const REFRESH = SAVED.refresh;
  const decideInput = {
    id: DEVIATION,
    ruleKey: "wet_room.membrane_before_2000",
    decision: "changed" as const,
    chosenTg: "2" as const,
    overrideReasonCode: "measured_again" as const,
  };

  it("decideSuggestionAction gir already_decided videre uendret, med organisasjonen fra konteksten", async () => {
    const answer = {
      status: "already_decided",
      decision: "accepted",
      chosenTg: "3",
      decidedAt: "2026-11-23T09:42:00.000Z",
      refresh: REFRESH,
    };
    mocks.core.decideSuggestion.mockResolvedValue(answer);
    const forged = { ...ref, organizationId: OTHER_ORG } as typeof ref;
    expect(await actions.decideSuggestionAction(forged, decideInput)).toEqual(answer);
    expect(mocks.core.decideSuggestion).toHaveBeenCalledWith(
      actor,
      ORG,
      { assignmentId: ASSIGNMENT, roomId: ROOM },
      decideInput,
    );
  });

  it("restoreDeviationAction gir newer_decision videre uendret, med organisasjonen fra konteksten", async () => {
    const answer = {
      status: "newer_decision",
      ruleKey: "wet_room.membrane_before_2000",
      checkpointKey: "wet_room.membrane_drain",
      refresh: REFRESH,
    };
    mocks.core.restoreDeviation.mockResolvedValue(answer);
    const forged = { ...ref, organizationId: OTHER_ORG } as typeof ref;
    expect(await actions.restoreDeviationAction(forged, { deviationId: DEVIATION })).toEqual(
      answer,
    );
    expect(mocks.core.restoreDeviation).toHaveBeenCalledWith(
      actor,
      ORG,
      { assignmentId: ASSIGNMENT, roomId: ROOM },
      { deviationId: DEVIATION },
    );
  });

  it("FA-I37 logget ut: ingen tilgang, og kjernen kalles ikke (Godta, Fjern og Angre)", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    for (const call of [
      () => actions.decideSuggestionAction(ref, decideInput),
      () => actions.removeDeviationAction(ref, DEVIATION),
      () => actions.restoreDeviationAction(ref, { deviationId: DEVIATION }),
    ]) {
      expect(await call()).toEqual({ status: "error", message: NO_ACCESS });
    }
    expect(mocks.core.decideSuggestion).not.toHaveBeenCalled();
    expect(mocks.core.removeDeviation).not.toHaveBeenCalled();
    expect(mocks.core.restoreDeviation).not.toHaveBeenCalled();
  });

  it("FA-I32 kjernen nekter (annen organisasjon, kontor, sperret takstmann): samme melding som ellers", async () => {
    mocks.core.decideSuggestion.mockRejectedValue(new AccessDeniedError());
    mocks.core.restoreDeviation.mockRejectedValue(new AccessDeniedError());
    expect(await actions.decideSuggestionAction(ref, decideInput)).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    expect(await actions.restoreDeviationAction(ref, { deviationId: DEVIATION })).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

/*
 * «Skriv det du ser», testplanen avsnitt 9a (S9.1–S9.3). Notatet har et merke som ikke kan
 * forekomme i id-er eller tidsstempler, så et lekket notat blir synlig i svar og logg.
 */
describe("«Skriv det du ser»: findOutcomesAction, chooseOutcomeMatchAction, rejectOutcomeMatchAction", () => {
  const NOTE_MARK = "Mxq-notat-ÆØ";
  const note = `Oppdiktet: fuktig flis ved sluk ${NOTE_MARK}`;
  const USAGE = "0190a000-0000-7000-8000-000000000090";
  const OUTCOME = "0190a000-0000-7000-8000-0000000000a0";
  const REQUEST = "0190a000-0000-7000-8000-0000000000b0";
  const findInput = { requestId: REQUEST, note, openCheckpointKey: null };
  const chooseInput = {
    usageId: USAGE,
    candidate: { source: "template_outcome" as const, id: OUTCOME },
    deviationId: DEVIATION,
    tg: null,
  };
  const rejectInput = { usageId: USAGE };
  const roomRef = { assignmentId: ASSIGNMENT, roomId: ROOM };
  const RANKED = {
    status: "ranked",
    usageId: USAGE,
    hits: [{ checkpointKey: "wet_room.floor", ref: { source: "template_outcome", id: OUTCOME } }],
  };
  const CHOSEN = {
    status: "saved",
    checkpointKey: "wet_room.floor",
    deviationId: DEVIATION,
    refresh: SAVED.refresh,
  };

  type Call = () => Promise<unknown>;
  const calls: [string, Call, keyof typeof mocks.core, unknown][] = [
    [
      "findOutcomesAction",
      () => actions.findOutcomesAction(ref, findInput),
      "findOutcomes",
      findInput,
    ],
    [
      "chooseOutcomeMatchAction",
      () => actions.chooseOutcomeMatchAction(ref, chooseInput),
      "chooseOutcomeMatch",
      chooseInput,
    ],
    [
      "rejectOutcomeMatchAction",
      () => actions.rejectOutcomeMatchAction(ref, rejectInput),
      "rejectOutcomeMatch",
      rejectInput,
    ],
  ];

  beforeEach(() => {
    mocks.getEmployeeContextForAction.mockResolvedValue({
      status: "ok",
      context: { actor, organizationId: ORG },
    });
    mocks.core.findOutcomes.mockResolvedValue(RANKED);
    mocks.core.chooseOutcomeMatch.mockResolvedValue(CHOSEN);
    mocks.core.rejectOutcomeMatch.mockResolvedValue({ status: "saved" });
  });

  it.each(calls)(
    "S9.1 %s bruker organisasjonen fra økten og bare rom-id-ene",
    async (_name, call, core, input) => {
      await call();
      expect(mocks.core[core]).toHaveBeenCalledTimes(1);
      expect(mocks.core[core]).toHaveBeenCalledWith(actor, ORG, roomRef, input);
    },
  );

  it("S9.1 organisasjon i rom-referansen leses aldri", async () => {
    const forged = { ...ref, organizationId: OTHER_ORG } as typeof ref;
    await actions.chooseOutcomeMatchAction(forged, chooseInput);
    expect(mocks.core.chooseOutcomeMatch).toHaveBeenCalledWith(actor, ORG, roomRef, chooseInput);
  });

  it.each([
    ["organizationId", { organizationId: OTHER_ORG }],
    ["checkpointKey", { checkpointKey: "wet_room.floor" }],
    ["outcomeKey", { outcomeKey: "tg3" }],
    ["questionKey", { questionKey: "q" }],
    ["reportId", { reportId: USAGE }],
  ])("S9.1 %s fra klienten avvises før kjernen", async (_name, extra) => {
    const results = [
      await actions.findOutcomesAction(ref, { ...findInput, ...extra } as typeof findInput),
      await actions.chooseOutcomeMatchAction(ref, {
        ...chooseInput,
        ...extra,
      } as typeof chooseInput),
      await actions.rejectOutcomeMatchAction(ref, {
        ...rejectInput,
        ...extra,
      } as typeof rejectInput),
    ];
    for (const result of results) {
      expect(result).toEqual({ status: "error", message: ROOM_ACTION_MESSAGES.invalid });
      expect(JSON.stringify(result)).not.toContain(NOTE_MARK);
    }
    expect(mocks.core.findOutcomes).not.toHaveBeenCalled();
    expect(mocks.core.chooseOutcomeMatch).not.toHaveBeenCalled();
    expect(mocks.core.rejectOutcomeMatch).not.toHaveBeenCalled();
  });

  it("S9.1 ukjent nøkkel i kandidaten avvises, og ugyldig rom gir ingen tilgang", async () => {
    const forgedCandidate = {
      ...chooseInput,
      candidate: { ...chooseInput.candidate, outcomeKey: "tg3" },
    } as typeof chooseInput;
    expect(await actions.chooseOutcomeMatchAction(ref, forgedCandidate)).toEqual({
      status: "error",
      message: ROOM_ACTION_MESSAGES.invalid,
    });
    expect(
      await actions.findOutcomesAction(
        { assignmentId: "x", roomId: ROOM } as typeof ref,
        findInput,
      ),
    ).toEqual({ status: "error", message: NO_ACCESS });
    expect(mocks.core.chooseOutcomeMatch).not.toHaveBeenCalled();
    expect(mocks.core.findOutcomes).not.toHaveBeenCalled();
  });

  it.each(calls)(
    "S9.2 %s uten økt: logget ut, uten kall og uten logg",
    async (_name, call, core) => {
      mocks.getEmployeeContextForAction.mockResolvedValue({ status: "signed_out" });
      expect(await call()).toEqual({
        status: "error",
        message: SIGNED_OUT_MESSAGE,
        signedOut: true,
      });
      expect(mocks.core[core]).not.toHaveBeenCalled();
      expect(mocks.logError).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(calls)("S9.2 %s uten ansatt: ingen tilgang, uten kall", async (_name, call, core) => {
    mocks.getEmployeeContextForAction.mockResolvedValue({ status: "no_access" });
    expect(await call()).toEqual({ status: "error", message: NO_ACCESS });
    expect(mocks.core[core]).not.toHaveBeenCalled();
  });

  it("treff gis videre uendret, uten notatet", async () => {
    const result = await actions.findOutcomesAction(ref, findInput);
    expect(result).toEqual(RANKED);
    expect(JSON.stringify(result)).not.toContain(NOTE_MARK);
  });

  it.each([
    [
      "no_match",
      { status: "no_match", usageId: USAGE },
      "Ingen utfall passer. Bruk søket eller punktlisten.",
    ],
    ["ai_off", { status: "ai_off" }, "KI er av. Bruk søket."],
    ["ai_error", { status: "ai_error" }, "KI svarte ikke. Bruk søket."],
    ["note_too_long", { status: "note_too_long" }, "Notatet er for langt for KI (høyst 500 tegn)."],
    [
      "too_many_candidates",
      { status: "too_many_candidates" },
      "For mange utfall i dette rommet for KI. Bruk søket.",
    ],
  ])("S9.3 søket %s gir norsk melding uten notatet", async (_name, coreResult, message) => {
    mocks.core.findOutcomes.mockResolvedValue(coreResult);
    const result = await actions.findOutcomesAction(ref, findInput);
    expect(result).toEqual({ ...coreResult, message });
    expect(JSON.stringify(result)).not.toContain(NOTE_MARK);
  });

  it("S9.3 fødselsnummer i notatet gir kjernens melding, aldri notatet eller sifrene", async () => {
    const withId = { ...findInput, note: `${note} 01017012345` };
    mocks.core.findOutcomes.mockRejectedValue(
      Object.assign(new FakeReportValidationError("Fødselsnummer skal ikke lagres her."), {
        code: "invalid_input",
      }),
    );
    const result = await actions.findOutcomesAction(ref, withId);
    expect(result).toEqual({ status: "error", message: "Fødselsnummer skal ikke lagres her." });
    expect(JSON.stringify(result)).not.toContain(NOTE_MARK);
    expect(JSON.stringify(result)).not.toContain("01017012345");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each(calls)(
    "S9.3 %s på publisert rapport gir koden report_published",
    async (_name, call, core) => {
      const message = "Rapporten er publisert. Lag ny versjon for å rette.";
      mocks.core[core].mockRejectedValue(
        Object.assign(new FakeReportValidationError(message), { code: "report_published" }),
      );
      expect(await call()).toEqual({ status: "error", message, code: "report_published" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("S9.3 utdatert søk gir meldingen i kortet, og siden revalideres ikke", async () => {
    mocks.core.chooseOutcomeMatch.mockResolvedValue({ status: "suggestion_outdated" });
    expect(await actions.chooseOutcomeMatchAction(ref, chooseInput)).toEqual({
      status: "suggestion_outdated",
      message: "Forslagene er utdatert. Trykk «Finn med KI» på nytt.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("S9.3 avvisning av et brukt søk gir already_decided med melding", async () => {
    mocks.core.rejectOutcomeMatch.mockResolvedValue({ status: "already_decided" });
    expect(await actions.rejectOutcomeMatchAction(ref, rejectInput)).toEqual({
      status: "already_decided",
      message: "Forslaget er alt brukt. Ingenting er endret.",
    });
  });

  it("valgt treff gir avviket og punktet, og rom-siden revalideres", async () => {
    expect(await actions.chooseOutcomeMatchAction(ref, chooseInput)).toEqual(CHOSEN);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/oppdrag/[id]/rom/[roomId]", "page");
  });

  it("TGIU på punktet gis videre, uten revalidering", async () => {
    mocks.core.chooseOutcomeMatch.mockResolvedValue({ status: "tgiu_conflict" });
    expect(await actions.chooseOutcomeMatchAction(ref, chooseInput)).toEqual({
      status: "tgiu_conflict",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("S9.3 ukjent feil logges uten notatet, og svaret gjengir det ikke", async () => {
    mocks.core.findOutcomes.mockRejectedValue(new Error(`uventet: ${note}`));
    const result = await actions.findOutcomesAction(ref, findInput);
    expect(result).toEqual({ status: "error", message: UNKNOWN_ERROR });
    expect(JSON.stringify(result)).not.toContain(NOTE_MARK);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls[0]);
    expect(logged).not.toContain(NOTE_MARK);
    expect(logged).toContain("outcome_match_find");
  });
});
