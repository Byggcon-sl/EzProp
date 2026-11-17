import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { NO_ACCESS, UNKNOWN_ERROR } from "../../../form-state";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * Serverhandlingene på publiser-siden (docs/funksjoner/fase2a-publisering-badet.md Omfang 5–7 og
 * 11, F2–F4). Kjernen, KI-modulen og økten er byttet ut; tjenestene, tilgangen og
 * tenant-isolasjonen testes i `src/core/reports` og `src/core/ai`. Her: organisasjonen og aktøren
 * kommer alltid fra økten (aldri fra skjemaet), rapport-id, ansatt og tid fra skjemaet tas ikke
 * med, «Bruk» skriver forslagsteksten fra serveren (aldri en tekst fra skjemaet), feil blir norsk
 * melding, og loggen får aldri begrunnelser. Testdata er oppdiktet.
 * Støtter hovedmål: færre reklamasjoner (aldri feil organisasjon eller rapport) og KI i bunnen.
 */

class FakeReportValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReportValidationError";
  }
}
class FakeReportTemplateMissingError extends Error {}
class FakeAiDecisionError extends Error {}
class FakeAiRequestRejectedError extends Error {}

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  logError: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  recordDecision: vi.fn(),
  core: {
    getPublishCheck: vi.fn(),
    getRoomView: vi.fn(),
    publishReport: vi.fn(),
    saveField: vi.fn(),
    startNewVersion: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/access")>()),
  requireOrganizationAccess: mocks.requireOrganizationAccess,
}));
vi.mock("@/core/ai", () => ({
  AI_FIELD_MAX_LENGTH: 4000,
  AiDecisionError: FakeAiDecisionError,
  AiRequestRejectedError: FakeAiRequestRejectedError,
  recordDecision: mocks.recordDecision,
}));
vi.mock("@/core/reports", () => ({
  ...mocks.core,
  HOLE_DRILLING_SIGNAL: {
    elementKey: "wet_room.hole_drilling",
    notDoneOptionKey: "not_done",
    reasonElementKey: "wet_room.hole_drilling_reason",
  },
  ReportValidationError: FakeReportValidationError,
  ReportTemplateMissingError: FakeReportTemplateMissingError,
}));

const actions = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const ROOM = "0190a000-0000-7000-8000-000000000060";
const RESULT = "0190a000-0000-7000-8000-000000000070";
const AI = "0190a000-0000-7000-8000-000000000080";
const NEW_ID = "0190a000-0000-7000-8000-000000000090";
const SECRET = "Oppdiktet begrunnelse Merke-8PQ2";
const actor = { id: "user-takstmann", email: "takstmann@eksempel.no", name: "Takstmann Testesen" };
const grant = { organizationId: ORG, employeeId: "emp", roles: ["inspector"] };

const DRAFT = {
  state: "draft",
  findings: [],
  pendingAiSuggestions: [
    {
      aiUsageId: AI,
      target: {
        roomId: ROOM,
        checkpointId: null,
        checkpointKey: "wet_room.general",
        deviationId: null,
        ruleKey: null,
        aiUsageId: AI,
        missing: [],
      },
      field: { type: "checkpoint_result", id: RESULT, fieldKey: "description_text" },
      outputText: "Forslagstekst fra loggen.",
    },
  ],
};

const ROOM_VIEW = {
  state: "started",
  checkpoints: [
    {
      checkpointKey: "wet_room.general",
      resultId: RESULT,
      descriptionText: "Egen tekst",
      deviations: [],
      tgiuDetails: null,
    },
  ],
  answers: [],
  document: {
    elements: [{ key: "wet_room.hole_drilling", label: "Hulltaking" }],
    element_options: [
      {
        element_key: "wet_room.hole_drilling",
        key: "not_done",
        label: "Ikke utført",
        sort_order: 1,
      },
      { element_key: "wet_room.hole_drilling", key: "done", label: "Utført", sort_order: 0 },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.requireOrganizationAccess.mockResolvedValue(grant);
  mocks.core.getPublishCheck.mockResolvedValue(DRAFT);
  mocks.core.getRoomView.mockResolvedValue(ROOM_VIEW);
  mocks.core.saveField.mockResolvedValue({ status: "saved" });
  mocks.recordDecision.mockResolvedValue(undefined);
});

describe("publiseringen", () => {
  it("bruker organisasjonen fra økten og tar ikke med rapport, ansatt, tid eller versjon fra skjemaet", async () => {
    mocks.core.publishReport.mockResolvedValue({ status: "published", versionNumber: 1 });
    await actions.publishAction({
      assignmentId: ASSIGNMENT,
      organizationId: OTHER_ORG,
      reportId: "0190a000-0000-7000-8000-0000000000ff",
      employeeId: "noen-andre",
      releasedAt: "2020-01-01",
      versionNumber: 9,
      fingerprint: "f".repeat(64),
      overrides: [{ findingKey: "k", reasonCode: "other", text: SECRET, extra: "x" }],
    });
    expect(mocks.core.publishReport).toHaveBeenCalledWith(actor, ORG, {
      assignmentId: ASSIGNMENT,
      fingerprint: "f".repeat(64),
      overrides: [{ findingKey: "k", reasonCode: "other", text: SECRET }],
    });
  });

  it("ugyldig id eller uten økt gir «ingen tilgang» før kjernen", async () => {
    expect(await actions.publishAction({ assignmentId: "ikke-en-id" })).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    mocks.getEmployeeContext.mockResolvedValue(null);
    expect(await actions.refreshPublishCheckAction(ASSIGNMENT)).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
    expect(mocks.core.publishReport).not.toHaveBeenCalled();
    expect(mocks.core.getPublishCheck).not.toHaveBeenCalled();
  });

  it("annen organisasjon (AccessDeniedError) gir «ingen tilgang»", async () => {
    mocks.core.getPublishCheck.mockRejectedValue(new AccessDeniedError());
    expect(await actions.refreshPublishCheckAction(ASSIGNMENT)).toEqual({
      status: "error",
      message: NO_ACCESS,
    });
  });

  it("alt publisert gir egen kode til lenken «Se utgivelsene»", async () => {
    mocks.core.publishReport.mockRejectedValue(
      new FakeReportValidationError("report_published", "Rapporten er publisert."),
    );
    expect(
      await actions.publishAction({ assignmentId: ASSIGNMENT, fingerprint: null, overrides: [] }),
    ).toEqual({
      status: "error",
      message: PUBLISH_TEXTS.alreadyPublished,
      code: "already_published",
    });
  });

  it("ukjent feil logges uten begrunnelse og gir fast melding", async () => {
    mocks.core.publishReport.mockRejectedValue(new Error(SECRET));
    const result = await actions.publishAction({
      assignmentId: ASSIGNMENT,
      fingerprint: null,
      overrides: [{ findingKey: "k", reasonCode: "other", text: SECRET }],
    });
    expect(result).toEqual({ status: "error", message: PUBLISH_TEXTS.publishFailed });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("Merke-8PQ2");
  });

  it("ny versjon bruker organisasjonen fra økten", async () => {
    mocks.core.startNewVersion.mockResolvedValue({ reportId: "r", nextVersionNumber: 2 });
    expect(await actions.startNewVersionAction(ASSIGNMENT)).toEqual({
      status: "started",
      nextVersionNumber: 2,
    });
    expect(mocks.core.startNewVersion).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT);
    mocks.core.startNewVersion.mockRejectedValue(new Error("x"));
    expect(await actions.startNewVersionAction(ASSIGNMENT)).toEqual({
      status: "error",
      message: PUBLISH_TEXTS.newVersionFailed,
    });
  });
});

describe("«Rett nå» for hulltaking", () => {
  it("valgene og svaret leses med getRoomView i organisasjonen fra økten", async () => {
    const result = await actions.holeFixContextAction(ASSIGNMENT, ROOM, {
      drilling: NEW_ID,
      reason: NEW_ID,
    });
    expect(mocks.core.getRoomView).toHaveBeenCalledWith(actor, ORG, {
      assignmentId: ASSIGNMENT,
      roomId: ROOM,
    });
    expect(result).toMatchObject({
      status: "ok",
      context: {
        drilling: {
          answerId: NEW_ID,
          options: [
            { key: "done", label: "Utført" },
            { key: "not_done", label: "Ikke utført" },
          ],
        },
        reason: null,
        notDoneOptionKey: "not_done",
      },
    });
  });

  it("ugyldig rom-id stoppes før kjernen", async () => {
    expect(
      await actions.holeFixContextAction(ASSIGNMENT, "x", { drilling: NEW_ID, reason: NEW_ID }),
    ).toEqual({ status: "error", message: NO_ACCESS });
    expect(mocks.core.getRoomView).not.toHaveBeenCalled();
  });
});

describe("KI-forslag (F4)", () => {
  it("«Bruk» skriver forslagsteksten fra loggen, ikke fra skjemaet, og registrerer avgjørelsen", async () => {
    const result = await actions.decideAiSuggestionAction({
      assignmentId: ASSIGNMENT,
      aiUsageId: AI,
      decision: "accepted",
      text: "Tekst fra skjemaet som ikke skal brukes",
    });
    expect(result).toEqual({ status: "decided", aiStatus: "accepted" });
    expect(mocks.core.saveField).toHaveBeenCalledWith(
      actor,
      ORG,
      { assignmentId: ASSIGNMENT, roomId: ROOM },
      {
        table: "checkpoint_results",
        checkpointKey: "wet_room.general",
        field: "description_text",
        value: "Forslagstekst fra loggen.",
        base: "Egen tekst",
      },
    );
    expect(mocks.recordDecision).toHaveBeenCalledWith(grant, AI, "accepted");
    expect(mocks.requireOrganizationAccess).toHaveBeenCalledWith(actor, ORG, "organization.read");
  });

  it("forslag som ikke venter på oppdragets rapport, avvises uten skriving", async () => {
    const result = await actions.decideAiSuggestionAction({
      assignmentId: ASSIGNMENT,
      aiUsageId: "0190a000-0000-7000-8000-0000000000aa",
      decision: "accepted",
    });
    expect(result).toEqual({ status: "error", message: PUBLISH_TEXTS.aiNotAllowed });
    expect(mocks.core.saveField).not.toHaveBeenCalled();
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it("«Behold min tekst» skriver ingenting i rapporten", async () => {
    expect(
      await actions.decideAiSuggestionAction({
        assignmentId: ASSIGNMENT,
        aiUsageId: AI,
        decision: "rejected",
      }),
    ).toEqual({ status: "decided", aiStatus: "rejected" });
    expect(mocks.core.saveField).not.toHaveBeenCalled();
    expect(mocks.recordDecision).toHaveBeenCalledWith(grant, AI, "rejected");
  });

  it("avgjørelse som ikke er lov, gir fast melding", async () => {
    mocks.recordDecision.mockRejectedValue(new FakeAiDecisionError());
    expect(
      await actions.decideAiSuggestionAction({
        assignmentId: ASSIGNMENT,
        aiUsageId: AI,
        decision: "rejected",
      }),
    ).toEqual({ status: "error", message: PUBLISH_TEXTS.aiNotAllowed });
  });

  it("ugyldig innhold gir «ingen tilgang»", async () => {
    expect(
      await actions.decideAiSuggestionAction({ assignmentId: ASSIGNMENT, aiUsageId: "x" }),
    ).toEqual({ status: "error", message: NO_ACCESS });
    expect(UNKNOWN_ERROR).toBeTruthy();
  });
});
