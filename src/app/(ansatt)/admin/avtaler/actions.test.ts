import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { AgreementFirmNotFoundError, NotFoundError, agreementSchema } from "@/core/agreements";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Server actions for avtaler med oppdragsgiver, /admin/avtaler
 * (docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 8). Kjernen og konteksten er
 * byttet ut her; kjernen testes i src/core/agreements. Testene viser at handlingene henter
 * organisasjonen på serveren, stopper id-er som ikke er uuid før kjernen kalles, gjør feilene om
 * til norske meldinger, og aldri logger premisseteksten eller navnet (A112).
 *
 * Feltnavn i skjemaet: id (tom = ny), firmId, name, validFrom, validTo, premiseText,
 * reportProfileCode. Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (bare admin lagrer, aldri feil organisasjon, premissene havner
 * ikke i loggen) og tid (feilen står ved feltet).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    createAgreement: vi.fn(),
    updateAgreement: vi.fn(),
    deleteAgreement: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/agreements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/agreements")>()),
  ...mocks.core,
}));

const { saveAgreementAction, deleteAgreementAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const FIRM = "0190a000-0000-7000-8000-000000000030";
const AGREEMENT = "0190a000-0000-7000-8000-000000000040";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testesen" };

const AGREEMENT_NAME = "Testavtale forsikring";
const PREMISE = "Premiss for test. Ikke ekte tekst.";
const PROFILE = "test-profil";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function agreementFields(overrides: Record<string, string> = {}) {
  return {
    id: "",
    firmId: FIRM,
    name: AGREEMENT_NAME,
    validFrom: "2026-01-01",
    validTo: "",
    premiseText: PREMISE,
    reportProfileCode: PROFILE,
    ...overrides,
  };
}

function saveForm(overrides: Record<string, string> = {}) {
  return form(agreementFields(overrides));
}

function deleteForm(overrides: Record<string, string> = {}) {
  return form({ id: AGREEMENT, ...overrides });
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

/** Kjører handlingen; videresending ved suksess (redirect kaster) gir `null`. */
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

function allMessages(state: FormState): string[] {
  return [...Object.values(state.fieldErrors), state.message ?? ""];
}

/** Zod-feilen kjernen kaster for verdiene (samme skjema som kjernen bruker). */
function zodErrorFor(values: Record<string, unknown>) {
  const result = agreementSchema.safeParse(values);
  expect(result.success, "verdiene skal være ugyldige").toBe(false);
  return result.error!;
}

const ACTIONS = [
  ["saveAgreementAction (ny)", () => saveAgreementAction(initialFormState, saveForm())],
  [
    "saveAgreementAction (endre)",
    () => saveAgreementAction(initialFormState, saveForm({ id: AGREEMENT })),
  ],
  ["deleteAgreementAction", () => deleteAgreementAction(initialFormState, deleteForm())],
] as const;

const CORE_FOR_ACTION = {
  "saveAgreementAction (ny)": mocks.core.createAgreement,
  "saveAgreementAction (endre)": mocks.core.updateAgreement,
  deleteAgreementAction: mocks.core.deleteAgreement,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  mocks.core.createAgreement.mockResolvedValue({ id: AGREEMENT, organizationId: ORG });
  mocks.core.updateAgreement.mockResolvedValue({ id: AGREEMENT, organizationId: ORG });
  mocks.core.deleteAgreement.mockResolvedValue({ id: AGREEMENT, organizationId: ORG });
});

describe("8.1 uten kontekst", () => {
  it.each(ACTIONS)(
    "%s: getEmployeeContext gir null → NO_ACCESS uten kall til kjernen",
    async (_name, action) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await failed(action());
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});

describe("8.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x"];

  it.each(BAD_IDS)("saveAgreementAction: id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(saveAgreementAction(initialFormState, saveForm({ id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each([...BAD_IDS, ""])("deleteAgreementAction: id «%s» → NO_ACCESS uten kall", async (id) => {
    const state = await failed(deleteAgreementAction(initialFormState, deleteForm({ id })));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("saveAgreementAction: tom id lager ny avtale, uuid endrer den avtalen", async () => {
    expect(await run(saveAgreementAction(initialFormState, saveForm()))).toBeNull();
    expect(mocks.core.createAgreement).toHaveBeenCalledTimes(1);
    expect(mocks.core.updateAgreement).not.toHaveBeenCalled();

    vi.clearAllMocks();
    expect(
      await run(saveAgreementAction(initialFormState, saveForm({ id: AGREEMENT }))),
    ).toBeNull();
    expect(mocks.core.updateAgreement).toHaveBeenCalledTimes(1);
    expect(mocks.core.updateAgreement.mock.calls[0]![2]).toBe(AGREEMENT);
    expect(mocks.core.createAgreement).not.toHaveBeenCalled();
  });
});

describe("8.3 organisasjonen kommer fra konteksten", () => {
  it("saveAgreementAction (ny): organizationId i skjemaet endrer ikke kallet", async () => {
    await run(saveAgreementAction(initialFormState, saveForm({ organizationId: OTHER_ORG })));
    expect(mocks.core.createAgreement).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, input] = mocks.core.createAgreement.mock.calls[0]!;
    expect([calledActor, calledOrg]).toEqual([actor, ORG]);
    expect(input).toMatchObject({
      firmId: FIRM,
      name: AGREEMENT_NAME,
      validFrom: "2026-01-01",
      premiseText: PREMISE,
      reportProfileCode: PROFILE,
    });
    expect(input).not.toHaveProperty("organizationId");
    expect(JSON.stringify(mocks.core.createAgreement.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("saveAgreementAction (endre): kjernen kalles med ORG og avtale-id fra skjemaet", async () => {
    await run(
      saveAgreementAction(
        initialFormState,
        saveForm({ id: AGREEMENT, organizationId: OTHER_ORG, name: "Nytt navn" }),
      ),
    );
    expect(mocks.core.updateAgreement).toHaveBeenCalledWith(
      actor,
      ORG,
      AGREEMENT,
      expect.objectContaining({ name: "Nytt navn", firmId: FIRM }),
    );
    expect(JSON.stringify(mocks.core.updateAgreement.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("deleteAgreementAction: kjernen kalles med ORG og avtale-id", async () => {
    await run(deleteAgreementAction(initialFormState, deleteForm({ organizationId: OTHER_ORG })));
    expect(mocks.core.deleteAgreement).toHaveBeenCalledWith(actor, ORG, AGREEMENT);
    expect(JSON.stringify(mocks.core.deleteAgreement.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("vellykket lagring og fjerning sender tilbake til listen", async () => {
    await run(saveAgreementAction(initialFormState, saveForm()));
    await run(deleteAgreementAction(initialFormState, deleteForm()));
    const urls = mocks.redirect.mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toMatch(/^\/admin\/avtaler(\?|$)/);
  });
});

describe("8.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → NO_ACCESS", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
    const state = await failed(action());
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("ZodError: til-dato før fra-dato → norsk melding ved «validTo»", async () => {
    const bad = { validFrom: "2026-03-01", validTo: "2026-02-28" };
    mocks.core.createAgreement.mockRejectedValue(
      zodErrorFor({ firmId: FIRM, name: AGREEMENT_NAME, ...bad }),
    );
    const state = await failed(saveAgreementAction(initialFormState, saveForm(bad)));
    expect(state.fieldErrors.validTo).toBe("Til-datoen kan ikke være før fra-datoen.");
    expect(state.values).toMatchObject(bad);
  });

  it("ZodError: tomt navn og ikke valgt firma → feil ved begge feltene", async () => {
    mocks.core.createAgreement.mockRejectedValue(
      zodErrorFor({ firmId: "", name: " ", validFrom: "2026-01-01" }),
    );
    const state = await failed(
      saveAgreementAction(initialFormState, saveForm({ firmId: "", name: " " })),
    );
    expect(state.fieldErrors.name).toBe("Skriv inn navnet på avtalen.");
    expect(state.fieldErrors.firmId).toBe("Velg et firma.");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ZodError: for lang premissetekst → feil ved feltet", async () => {
    const long = "x".repeat(10_001);
    mocks.core.updateAgreement.mockRejectedValue(
      zodErrorFor({
        firmId: FIRM,
        name: AGREEMENT_NAME,
        validFrom: "2026-01-01",
        premiseText: long,
      }),
    );
    const state = await failed(
      saveAgreementAction(initialFormState, saveForm({ id: AGREEMENT, premiseText: long })),
    );
    expect(state.fieldErrors.premiseText).toBe("Premisseteksten kan ha høyst 10 000 tegn.");
  });

  it("firmaet finnes ikke (fremmed eller slettet) → «Firmaet finnes ikke.» ved feltet", async () => {
    mocks.core.createAgreement.mockRejectedValue(new AgreementFirmNotFoundError());
    const state = await failed(saveAgreementAction(initialFormState, saveForm()));
    expect(state.fieldErrors.firmId).toBe("Firmaet finnes ikke.");
  });

  it.each([
    ["saveAgreementAction (endre)", mocks.core.updateAgreement],
    ["deleteAgreementAction", mocks.core.deleteAgreement],
  ] as const)("%s: NotFoundError → norsk melding, ikke UNKNOWN_ERROR", async (name, core) => {
    core.mockRejectedValue(new NotFoundError());
    const action = ACTIONS.find(([label]) => label === name)![1];
    const state = await failed(action());
    expect(state.message).toBeTruthy();
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    expect(allMessages(state).join(" ")).toMatch(/avtalen/i);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new Error("databasen svarte ikke"));
    const state = await failed(action());
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});

describe("8.6 loggen får aldri premisseteksten eller navnet (A112)", () => {
  it.each(ACTIONS)("%s: ukjent feil logges med id-er og feilnavn", async (name, action) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new TypeError(`krasj med ${PREMISE}`));
    await failed(action());
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    for (const value of [PREMISE, AGREEMENT_NAME, PROFILE, "krasj med"]) {
      expect(logged).not.toContain(value);
    }
    expect(logged).toContain(actor.id);
    expect(logged).toContain("TypeError");
  });

  it("ingen logg ved kjente feil (tilgang, validering, ikke funnet)", async () => {
    mocks.core.createAgreement.mockRejectedValueOnce(new AccessDeniedError());
    await failed(saveAgreementAction(initialFormState, saveForm()));
    mocks.core.createAgreement.mockRejectedValueOnce(
      zodErrorFor({ firmId: FIRM, name: "", validFrom: "2026-01-01" }),
    );
    await failed(saveAgreementAction(initialFormState, saveForm({ name: "" })));
    mocks.core.deleteAgreement.mockRejectedValueOnce(new NotFoundError());
    await failed(deleteAgreementAction(initialFormState, deleteForm()));
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
