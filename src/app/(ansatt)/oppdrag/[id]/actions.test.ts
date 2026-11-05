import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { EmployeeNotFoundError } from "@/core/assignments/errors";
import { partyInputSchema } from "@/core/assignments/schemas";
import { CommonAreasNotApplicableError } from "@/core/properties/errors";
import { commonAreasInputSchema, propertyInputSchema } from "@/core/properties/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Server actions på oppdragssiden /oppdrag/[id]
 * (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 6). Kjernen og konteksten er
 * byttet ut her; de testes i src/core/assignments og employee-context.test.ts. Testene viser at
 * hver handling henter organisasjonen på serveren, sjekker id-er før kjernen kalles, og gir de
 * faste meldingene uten skjemaverdier i loggen.
 *
 * Feltnavn i skjemaene (som i kjernen): assignmentId, teamRole, employeeId («» = «Ingen»),
 * reason; partyId, role, name, firmName, email, phone, receivesReport, receivesInvoice,
 * receivesMessages. Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (feil vises ved feltet) og reklamasjoner (aldri feil organisasjon,
 * aldri navn, e-post, telefon, firma eller grunn i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    getAssignment: vi.fn(),
    setTeamMember: vi.fn(),
    addParty: vi.fn(),
    updateParty: vi.fn(),
    removeParty: vi.fn(),
  },
  properties: {
    getAssignmentProperty: vi.fn(),
    saveAssignmentProperty: vi.fn(),
    saveCommonAreas: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assignments")>()),
  ...mocks.core,
}));
vi.mock("@/core/properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/properties")>()),
  ...mocks.properties,
}));

const {
  setTeamMemberAction,
  addPartyAction,
  updatePartyAction,
  removePartyAction,
  savePropertyAction,
  saveCommonAreasAction,
} = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000060";
const PARTY_ID = "0190a000-0000-7000-8000-000000000070";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const PARTY_NAME = "Megler Test";
const FIRM = "Testmegling AS";
const EMAIL = "megler@example.com";
const PHONE = "00000000";
const REASON = "Ferie";
const PERSONAL_VALUES = [PARTY_NAME, FIRM, EMAIL, PHONE, REASON];

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function teamForm(overrides: Record<string, string> = {}) {
  return form({
    assignmentId: ASSIGNMENT,
    teamRole: "responsible",
    employeeId: EMPLOYEE,
    reason: REASON,
    ...overrides,
  });
}

function partyFields(overrides: Record<string, string> = {}) {
  return {
    assignmentId: ASSIGNMENT,
    role: "broker",
    name: PARTY_NAME,
    firmName: FIRM,
    email: EMAIL,
    phone: PHONE,
    receivesReport: "on",
    receivesMessages: "on",
    ...overrides,
  };
}

function addForm(overrides: Record<string, string> = {}) {
  return form(partyFields(overrides));
}

function updateForm(overrides: Record<string, string> = {}) {
  return form(partyFields({ partyId: PARTY_ID, ...overrides }));
}

function removeForm(overrides: Record<string, string> = {}) {
  return form({ assignmentId: ASSIGNMENT, partyId: PARTY_ID, ...overrides });
}

function coreCalls() {
  return [...Object.values(mocks.core), ...Object.values(mocks.properties)].reduce(
    (sum, fn) => sum + fn.mock.calls.length,
    0,
  );
}

/** Alle meldinger i svaret, ved feltene og øverst. */
function allMessages(state: FormState): string[] {
  return [...Object.values(state.fieldErrors), state.message ?? ""];
}

/** Kjører handlingen; videresending ved suksess (redirect kaster) regnes ikke som feil. */
async function run(promise: Promise<FormState>): Promise<FormState | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT ")) return null;
    throw error;
  }
}

/** Svaret fra en handling som skal feile (ingen videresending). */
async function failed(promise: Promise<FormState>): Promise<FormState> {
  const state = await run(promise);
  expect(state, "handlingen skulle svart med en feil, ikke sendt videre").not.toBeNull();
  return state!;
}

const ACTIONS = [
  ["setTeamMemberAction", () => setTeamMemberAction(initialFormState, teamForm())],
  ["addPartyAction", () => addPartyAction(initialFormState, addForm())],
  ["updatePartyAction", () => updatePartyAction(initialFormState, updateForm())],
  ["removePartyAction", () => removePartyAction(initialFormState, removeForm())],
] as const;

const CORE_FOR_ACTION = {
  setTeamMemberAction: mocks.core.setTeamMember,
  addPartyAction: mocks.core.addParty,
  updatePartyAction: mocks.core.updateParty,
  removePartyAction: mocks.core.removeParty,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  mocks.core.setTeamMember.mockResolvedValue(undefined);
  mocks.core.addParty.mockResolvedValue({ id: PARTY_ID, organizationId: ORG });
  mocks.core.updateParty.mockResolvedValue({ id: PARTY_ID, organizationId: ORG });
  mocks.core.removeParty.mockResolvedValue({ id: PARTY_ID, organizationId: ORG });
  mocks.properties.saveAssignmentProperty.mockResolvedValue({
    id: PROPERTY_ID,
    created: true,
    changed: true,
  });
  mocks.properties.saveCommonAreas.mockResolvedValue({
    id: COMMON_AREAS_ID,
    created: true,
    changed: true,
  });
});

describe("6.1 uten kontekst", () => {
  it.each(ACTIONS)(
    "%s: getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen",
    async (_name, action) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await failed(action());
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("6.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x"];

  it.each(BAD_IDS)("setTeamMemberAction: oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(
      setTeamMemberAction(initialFormState, teamForm({ assignmentId: id })),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each(BAD_IDS)("setTeamMemberAction: ansatt-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(setTeamMemberAction(initialFormState, teamForm({ employeeId: id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each(BAD_IDS)("addPartyAction: oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(addPartyAction(initialFormState, addForm({ assignmentId: id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each([...BAD_IDS, ""])("updatePartyAction: part-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(updatePartyAction(initialFormState, updateForm({ partyId: id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each([...BAD_IDS, ""])("removePartyAction: part-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(removePartyAction(initialFormState, removeForm({ partyId: id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("6.3 organisasjonen kommer fra konteksten", () => {
  it("setTeamMemberAction: organizationId i skjemaet endrer ikke kallet", async () => {
    await run(setTeamMemberAction(initialFormState, teamForm({ organizationId: OTHER_ORG })));
    expect(mocks.core.setTeamMember).toHaveBeenCalledTimes(1);
    expect(mocks.core.setTeamMember).toHaveBeenCalledWith(
      actor,
      ORG,
      ASSIGNMENT,
      expect.objectContaining({ teamRole: "responsible", employeeId: EMPLOYEE }),
    );
    expect(JSON.stringify(mocks.core.setTeamMember.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("addPartyAction: kjernen kalles med ORG og oppdraget, og verdiene fra skjemaet", async () => {
    await run(addPartyAction(initialFormState, addForm({ organizationId: OTHER_ORG })));
    expect(mocks.core.addParty).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, calledAssignment, input] = mocks.core.addParty.mock.calls[0]!;
    expect([calledActor, calledOrg, calledAssignment]).toEqual([actor, ORG, ASSIGNMENT]);
    expect(input).toMatchObject({ role: "broker", name: PARTY_NAME, email: EMAIL });
    expect(JSON.stringify(mocks.core.addParty.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("updatePartyAction og removePartyAction: kjernen kalles med ORG og part-id", async () => {
    await run(updatePartyAction(initialFormState, updateForm({ organizationId: OTHER_ORG })));
    await run(removePartyAction(initialFormState, removeForm({ organizationId: OTHER_ORG })));
    expect(mocks.core.updateParty).toHaveBeenCalledWith(actor, ORG, PARTY_ID, expect.anything());
    expect(mocks.core.removeParty).toHaveBeenCalledWith(actor, ORG, PARTY_ID);
    expect(JSON.stringify(mocks.core.updateParty.mock.calls)).not.toContain(OTHER_ORG);
    expect(JSON.stringify(mocks.core.removeParty.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("avkrysningene sendes som valgt: rapport og kopi på, faktura av", async () => {
    await run(addPartyAction(initialFormState, addForm()));
    const input = mocks.core.addParty.mock.calls[0]![3] as Record<string, unknown>;
    const truthy = (value: unknown) => value === true || value === "on" || value === "true";
    expect(truthy(input.receivesReport)).toBe(true);
    expect(truthy(input.receivesMessages)).toBe(true);
    expect(truthy(input.receivesInvoice)).toBe(false);
  });
});

describe("6.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → NO_ACCESS", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
    const state = await failed(action());
    expect(state.message).toBe(NO_ACCESS);
  });

  it("setTeamMemberAction: EmployeeNotFoundError → «Den ansatte finnes ikke.»", async () => {
    mocks.core.setTeamMember.mockRejectedValue(new EmployeeNotFoundError());
    const state = await failed(setTeamMemberAction(initialFormState, teamForm()));
    expect(allMessages(state)).toContain("Den ansatte finnes ikke.");
  });

  it.each([
    ["addPartyAction", addPartyAction, addForm],
    ["updatePartyAction", updatePartyAction, updateForm],
  ] as const)("%s: ZodError → feil ved feltet med kortets tekster", async (name, action, make) => {
    const bad = { name: " ", email: "ikke-epost", phone: "abc" };
    const result = partyInputSchema.safeParse({ role: "broker", ...bad });
    expect(result.success).toBe(false);
    CORE_FOR_ACTION[name].mockRejectedValue(result.error);

    const state = await failed(action(initialFormState, make(bad)));
    expect(state.fieldErrors.name).toBe("Skriv inn navnet.");
    expect(state.fieldErrors.email).toBe("E-postadressen er ikke gyldig.");
    expect(state.fieldErrors.phone).toBe("Telefonnummeret kan bare ha sifre, mellomrom og +.");
  });

  it("addPartyAction: ukjent rolle → «Velg en rolle.» ved feltet", async () => {
    const result = partyInputSchema.safeParse({ role: "client", name: PARTY_NAME });
    expect(result.success).toBe(false);
    mocks.core.addParty.mockRejectedValue(result.error);
    const state = await failed(addPartyAction(initialFormState, addForm({ role: "client" })));
    expect(state.fieldErrors.role).toBe("Velg en rolle.");
  });

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new Error("oppdiktet feil"));
    const state = await failed(action());
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("6.5 «Ingen» i nedtrekkslisten", () => {
  it("tom employeeId sendes til kjernen som null", async () => {
    await run(setTeamMemberAction(initialFormState, teamForm({ employeeId: "" })));
    expect(mocks.core.setTeamMember).toHaveBeenCalledTimes(1);
    const options = mocks.core.setTeamMember.mock.calls[0]![3] as Record<string, unknown>;
    expect(options.employeeId).toBeNull();
    expect(options.teamRole).toBe("responsible");
  });
});

describe("6.6 loggkontrakt", () => {
  it.each(ACTIONS)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (name, action) => {
      const boom = new Error(
        `databasen sa nei til ${PARTY_NAME} ${EMAIL} ${PHONE} ${FIRM} ${REASON}`,
      );
      boom.name = "OppdiktetFeil";
      CORE_FOR_ACTION[name].mockRejectedValue(boom);

      const state = await failed(action());
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(mocks.logError.mock.calls);
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of PERSONAL_VALUES) expect(logged, value).not.toContain(value);
      expect(logged).not.toContain("Testmegling");
    },
  );

  it("ingen kall til loggeren gir skjemaverdier, heller ikke ved kjente feil", async () => {
    mocks.core.setTeamMember.mockRejectedValue(new EmployeeNotFoundError());
    mocks.core.addParty.mockRejectedValue(new AccessDeniedError());
    await run(setTeamMemberAction(initialFormState, teamForm()));
    await run(addPartyAction(initialFormState, addForm()));
    const logged = JSON.stringify(mocks.logError.mock.calls);
    for (const value of PERSONAL_VALUES) expect(logged, value).not.toContain(value);
  });
});

// ---------------------------------------------------------------------------------------------
// Eiendom og fellesdeler (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 6).
// Feltnavn i skjemaene (som i kjernen): assignmentId, address, postalCode, city,
// municipalityNumber, municipalityName, housingType, ownershipForm, gnr, bnr, fnr, snr,
// associationName, associationOrgNumber, shareNumber; managingAgent, conditionReportStatus,
// maintenancePlanStatus, notes. Testdata er oppdiktet.
// Støtter hovedmål: reklamasjoner (aldri feil organisasjon, aldri adresse, matrikkel eller
// fritekst i loggen) og tid (feil vises ved feltet).
// ---------------------------------------------------------------------------------------------

const PROPERTY_ID = "0190a000-0000-7000-8000-000000000080";
const COMMON_AREAS_ID = "0190a000-0000-7000-8000-000000000090";

const PROPERTY_VALUES = {
  address: "Testveien 1",
  postalCode: "0000",
  city: "Testby",
  municipalityNumber: "0000",
  municipalityName: "Testkommune",
  housingType: "apartment",
  ownershipForm: "cooperative",
  gnr: "999",
  bnr: "999",
  fnr: "0",
  snr: "9",
  associationName: "Borettslaget Test",
  associationOrgNumber: "000000000",
  shareNumber: "0-0",
};

const COMMON_AREAS_VALUES = {
  managingAgent: "Forvalter Test",
  conditionReportStatus: "yes",
  maintenancePlanStatus: "unknown",
  notes: "Sett trapperom og kjeller",
};

/** Verdier som aldri skal i loggen (6.5). «999» sjekkes uten uuid-er (se `withoutIds`). */
const PROPERTY_PRIVATE = [
  "Testveien 1",
  "Testby",
  "Testkommune",
  "Borettslaget Test",
  "000000000",
  "0-0",
  "Forvalter Test",
  "Sett trapperom",
  "999",
];

function withoutIds(text: string): string {
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
}

function propertyForm(overrides: Record<string, string> = {}) {
  return form({ assignmentId: ASSIGNMENT, ...PROPERTY_VALUES, ...overrides });
}

function commonAreasForm(overrides: Record<string, string> = {}) {
  return form({ assignmentId: ASSIGNMENT, ...COMMON_AREAS_VALUES, ...overrides });
}

const PROPERTY_ACTIONS = [
  ["savePropertyAction", () => savePropertyAction(initialFormState, propertyForm())],
  ["saveCommonAreasAction", () => saveCommonAreasAction(initialFormState, commonAreasForm())],
] as const;

const PROPERTY_CORE = {
  savePropertyAction: mocks.properties.saveAssignmentProperty,
  saveCommonAreasAction: mocks.properties.saveCommonAreas,
} as const;

describe("eiendom 6.1 uten kontekst", () => {
  it.each(PROPERTY_ACTIONS)(
    "%s: getEmployeeContext gir null → NO_ACCESS uten kall til kjernen",
    async (_name, action) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await failed(action());
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("eiendom 6.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x", ""];

  it.each(BAD_IDS)("savePropertyAction: oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(
      savePropertyAction(initialFormState, propertyForm({ assignmentId: id })),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each(BAD_IDS)("saveCommonAreasAction: oppdrags-id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(
      saveCommonAreasAction(initialFormState, commonAreasForm({ assignmentId: id })),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("eiendom 6.3 organisasjonen kommer fra konteksten", () => {
  it("savePropertyAction: organizationId og propertyId i skjemaet endrer ikke kallet", async () => {
    await run(
      savePropertyAction(
        initialFormState,
        propertyForm({ organizationId: OTHER_ORG, propertyId: PROPERTY_ID }),
      ),
    );
    const save = mocks.properties.saveAssignmentProperty;
    expect(save).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, calledAssignment, input] = save.mock.calls[0]!;
    expect([calledActor, calledOrg, calledAssignment]).toEqual([actor, ORG, ASSIGNMENT]);
    expect(input).toMatchObject({
      address: "Testveien 1",
      housingType: "apartment",
      ownershipForm: "cooperative",
      gnr: "999",
      bnr: "999",
      associationName: "Borettslaget Test",
    });
    const text = JSON.stringify(save.mock.calls);
    expect(text).not.toContain(OTHER_ORG);
    expect(text).not.toContain(PROPERTY_ID);
  });

  it("saveCommonAreasAction: kjernen kalles med ORG, oppdraget og verdiene fra skjemaet", async () => {
    await run(
      saveCommonAreasAction(initialFormState, commonAreasForm({ organizationId: OTHER_ORG })),
    );
    const save = mocks.properties.saveCommonAreas;
    expect(save).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, calledAssignment, input] = save.mock.calls[0]!;
    expect([calledActor, calledOrg, calledAssignment]).toEqual([actor, ORG, ASSIGNMENT]);
    expect(input).toMatchObject({
      managingAgent: "Forvalter Test",
      conditionReportStatus: "yes",
      maintenancePlanStatus: "unknown",
    });
    expect(JSON.stringify(save.mock.calls)).not.toContain(OTHER_ORG);
  });
});

describe("eiendom 6.4 feil fra kjernen", () => {
  it.each(PROPERTY_ACTIONS)("%s: AccessDeniedError → NO_ACCESS", async (name, action) => {
    PROPERTY_CORE[name].mockRejectedValue(new AccessDeniedError());
    const state = await failed(action());
    expect(state.message).toBe(NO_ACCESS);
  });

  it("saveCommonAreasAction: CommonAreasNotApplicableError → norsk melding", async () => {
    mocks.properties.saveCommonAreas.mockRejectedValue(new CommonAreasNotApplicableError());
    const state = await failed(saveCommonAreasAction(initialFormState, commonAreasForm()));
    expect(allMessages(state)).toContain(
      "Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.",
    );
  });

  it("savePropertyAction: ZodError → feil ved feltene med kortets tekster", async () => {
    const bad = {
      address: " ",
      gnr: "12a",
      bnr: "",
      postalCode: "123",
      associationOrgNumber: "00000000",
      shareNumber: "A12",
    };
    const result = propertyInputSchema.safeParse({ ...PROPERTY_VALUES, ...bad });
    expect(result.success).toBe(false);
    mocks.properties.saveAssignmentProperty.mockRejectedValue(result.error);

    const state = await failed(savePropertyAction(initialFormState, propertyForm(bad)));
    expect(state.fieldErrors).toMatchObject({
      address: "Skriv inn adressen.",
      gnr: "Gårdsnummer kan bare ha sifre.",
      bnr: "Skriv inn bruksnummer.",
      postalCode: "Postnummeret må ha fire sifre.",
      associationOrgNumber: "Organisasjonsnummeret må ha ni sifre.",
      shareNumber: "Andelsnummeret kan bare ha sifre og bindestrek.",
    });
  });

  it.each([
    ["housingType", "Velg boligtype."],
    ["ownershipForm", "Velg eierform."],
  ])("savePropertyAction: tom %s → «%s» ved feltet", async (field, message) => {
    const result = propertyInputSchema.safeParse({ ...PROPERTY_VALUES, [field]: "" });
    expect(result.success).toBe(false);
    mocks.properties.saveAssignmentProperty.mockRejectedValue(result.error);
    const state = await failed(savePropertyAction(initialFormState, propertyForm({ [field]: "" })));
    expect(state.fieldErrors[field]).toBe(message);
  });

  it("savePropertyAction: fødselsnummer i adressen → «Fødselsnummer skal ikke lagres her.» ved feltet", async () => {
    const result = propertyInputSchema.safeParse({ ...PROPERTY_VALUES, address: "12345678901" });
    expect(result.success).toBe(false);
    mocks.properties.saveAssignmentProperty.mockRejectedValue(result.error);
    const state = await failed(
      savePropertyAction(initialFormState, propertyForm({ address: "12345678901" })),
    );
    expect(state.fieldErrors.address).toBe("Fødselsnummer skal ikke lagres her.");
  });

  it("saveCommonAreasAction: ZodError → feil ved feltet", async () => {
    const result = commonAreasInputSchema.safeParse({ notes: "12345678901" });
    expect(result.success).toBe(false);
    mocks.properties.saveCommonAreas.mockRejectedValue(result.error);
    const state = await failed(
      saveCommonAreasAction(initialFormState, commonAreasForm({ notes: "12345678901" })),
    );
    expect(state.fieldErrors.notes).toBe("Fødselsnummer skal ikke lagres her.");
  });

  it.each(PROPERTY_ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, action) => {
    PROPERTY_CORE[name].mockRejectedValue(new Error("oppdiktet feil"));
    const state = await failed(action());
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("eiendom 6.5 loggkontrakt", () => {
  it.each(PROPERTY_ACTIONS)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (name, action) => {
      const boom = new Error(`databasen sa nei til ${PROPERTY_PRIVATE.join(" ")}`);
      boom.name = "OppdiktetFeil";
      PROPERTY_CORE[name].mockRejectedValue(boom);

      const state = await failed(action());
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(mocks.logError.mock.calls);
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      const text = withoutIds(logged);
      for (const value of PROPERTY_PRIVATE) expect(text, value).not.toContain(value);
    },
  );

  it("ingen kall til loggeren gir skjemaverdier, heller ikke ved kjente feil", async () => {
    mocks.properties.saveAssignmentProperty.mockRejectedValue(new AccessDeniedError());
    mocks.properties.saveCommonAreas.mockRejectedValue(new CommonAreasNotApplicableError());
    await run(savePropertyAction(initialFormState, propertyForm()));
    await run(saveCommonAreasAction(initialFormState, commonAreasForm()));
    const text = withoutIds(JSON.stringify(mocks.logError.mock.calls));
    for (const value of PROPERTY_PRIVATE) expect(text, value).not.toContain(value);
  });
});
