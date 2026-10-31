import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AccessDeniedError } from "@/core/access";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR } from "./form-state";

/*
 * Server actions i /admin (skjermene, bit 2). Kjernen og tilgangssjekken er byttet ut her; de
 * testes i src/core/organization. Testene viser at hver action henter organisasjonen på serveren,
 * sjekker id-er før kjernen kalles, og gir de faste meldingene fra skissen.
 * Støtter hovedmål: reklamasjoner (riktig selskap og forsikring, feil vises ved feltet).
 */

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    createCompany: vi.fn(),
    updateCompany: vi.fn(),
    createOffice: vi.fn(),
    updateOffice: vi.fn(),
    listCompanies: vi.fn(),
    listOffices: vi.fn(),
    createEmployee: vi.fn(),
    updateEmployee: vi.fn(),
    getEmployeeForAdmin: vi.fn(),
    setEmployeeRoles: vi.fn(),
    deactivateEmployee: vi.fn(),
    reactivateEmployee: vi.fn(),
    grantEmployeePermission: vi.fn(),
    revokeEmployeePermission: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("./admin-context", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("@/core/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/organization")>()),
  ...mocks.core,
}));

const { saveCompanyAction } = await import("./selskaper/actions");
const { saveOfficeAction } = await import("./kontorer/actions");
const {
  createEmployeeAction,
  deactivateEmployeeAction,
  setPermissionsAction,
  setRolesAction,
  updateEmployeeAction,
} = await import("./ansatte/actions");
const { DuplicateOrgNumberError, LastAdminError } = await import("@/core/organization");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000010";
const COMPANY = "0190a000-0000-7000-8000-000000000020";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.core.listCompanies.mockResolvedValue([{ id: COMPANY, legalName: "Testselskap AS" }]);
  mocks.core.listOffices.mockResolvedValue([{ id: OFFICE, name: "Testkontor" }]);
});

describe("tilgang i server actions", () => {
  it.each([
    ["saveCompanyAction", () => saveCompanyAction(null, initialFormState, form({}))],
    ["saveOfficeAction", () => saveOfficeAction(null, initialFormState, form({}))],
    ["createEmployeeAction", () => createEmployeeAction(initialFormState, form({}))],
    ["updateEmployeeAction", () => updateEmployeeAction(EMPLOYEE, initialFormState, form({}))],
    ["setRolesAction", () => setRolesAction(EMPLOYEE, initialFormState, form({}))],
    ["setPermissionsAction", () => setPermissionsAction(EMPLOYEE, initialFormState, form({}))],
    ["deactivateEmployeeAction", () => deactivateEmployeeAction(EMPLOYEE, initialFormState)],
  ])("%s: ikke admin gir «ingen tilgang» uten kall til kjernen", async (_name, run) => {
    mocks.getAdminContext.mockResolvedValue(null);
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each([
    ["saveCompanyAction", () => saveCompanyAction("ikke-en-id", initialFormState, form({}))],
    ["saveOfficeAction", () => saveOfficeAction("ikke-en-id", initialFormState, form({}))],
    ["updateEmployeeAction", () => updateEmployeeAction("1 or 1=1", initialFormState, form({}))],
    ["setRolesAction", () => setRolesAction("", initialFormState, form({}))],
    ["deactivateEmployeeAction", () => deactivateEmployeeAction("../x", initialFormState)],
  ])("%s: ugyldig id gir «ingen tilgang» uten kall til kjernen", async (_name, run) => {
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("organisasjonen kommer fra serveren, aldri fra skjemaet", async () => {
    mocks.core.createCompany.mockResolvedValue({ id: COMPANY });
    await expect(
      saveCompanyAction(
        null,
        initialFormState,
        form({ legalName: "Testselskap AS", organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow("REDIRECT /admin/selskaper?lagret=selskap");
    expect(mocks.core.createCompany).toHaveBeenCalledWith(actor, ORG, expect.any(Object));
    expect(JSON.stringify(mocks.core.createCompany.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("AccessDeniedError fra kjernen (fremmed id) gir «ingen tilgang», ikke en feil", async () => {
    mocks.core.updateCompany.mockRejectedValue(new AccessDeniedError());
    const state = await saveCompanyAction(COMPANY, initialFormState, form({ legalName: "X" }));
    expect(state.message).toBe(NO_ACCESS);
  });
});

describe("selskap", () => {
  it("fjerner mellomrom i org.nr. og gjør tomme felt til null", async () => {
    mocks.core.updateCompany.mockResolvedValue({ id: COMPANY });
    await expect(
      saveCompanyAction(
        COMPANY,
        initialFormState,
        form({ legalName: " Testselskap AS ", orgNumber: "000 000 001", city: "  " }),
      ),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.core.updateCompany).toHaveBeenCalledWith(
      actor,
      ORG,
      COMPANY,
      expect.objectContaining({
        legalName: "Testselskap AS",
        orgNumber: "000000001",
        city: null,
        vatRegistered: false,
      }),
    );
  });

  it("valideringsfeil vises ved feltet med teksten fra skissen, og verdiene står", async () => {
    const zodError = z
      .object({ orgNumber: z.string().length(9), legalName: z.string().min(1) })
      .safeParse({ orgNumber: "1", legalName: "" }).error!;
    mocks.core.createCompany.mockRejectedValue(zodError);
    const state = await saveCompanyAction(
      null,
      initialFormState,
      form({ legalName: "", orgNumber: "12345678" }),
    );
    expect(state.fieldErrors).toEqual({
      orgNumber: "Org.nr. må være 9 siffer.",
      legalName: "Skriv inn det juridiske navnet.",
    });
    expect(state.message).toBe("Rett feltene som er merket.");
    expect(state.values.orgNumber).toBe("12345678");
    expect(state.attempt).toBe(1);
  });

  it("org.nr. som finnes gir meldingen ved feltet", async () => {
    mocks.core.createCompany.mockRejectedValue(new DuplicateOrgNumberError());
    const state = await saveCompanyAction(null, initialFormState, form({ legalName: "X" }));
    expect(state.fieldErrors.orgNumber).toBe("Det finnes alt et selskap med dette org.nr.");
  });

  it("ukjent feil gir fast melding og logger bare feilnavn og id-er, ikke skjemaet", async () => {
    mocks.core.createCompany.mockRejectedValue(new Error("db nede: Hemmelig Testselskap AS"));
    const state = await saveCompanyAction(
      null,
      initialFormState,
      form({ legalName: "Hemmelig Testselskap AS" }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("Hemmelig");
  });
});

describe("kontor", () => {
  it("rekkefølge som ikke er et helt tall, stoppes ved feltet", async () => {
    const state = await saveOfficeAction(
      null,
      initialFormState,
      form({ name: "Testkontor", sortOrder: "1,5" }),
    );
    expect(state.fieldErrors.sortOrder).toBe("Skriv inn et helt tall.");
    expect(mocks.core.createOffice).not.toHaveBeenCalled();
  });

  it("tom rekkefølge blir 0", async () => {
    mocks.core.createOffice.mockResolvedValue({ id: OFFICE });
    await expect(
      saveOfficeAction(null, initialFormState, form({ name: "Testkontor", sortOrder: "" })),
    ).rejects.toThrow("REDIRECT /admin/kontorer?lagret=kontor");
    expect(mocks.core.createOffice).toHaveBeenCalledWith(actor, ORG, {
      name: "Testkontor",
      address: null,
      sortOrder: 0,
    });
  });
});

describe("ansatte", () => {
  it("ny ansatt: bare kjente roller sendes videre", async () => {
    mocks.core.createEmployee.mockResolvedValue({ id: EMPLOYEE });
    await expect(
      createEmployeeAction(
        initialFormState,
        form({
          name: "Kari Testdatter",
          email: " Kari@Eksempel.no ",
          companyId: COMPANY,
          officeId: "",
          roles: ["inspector", "superuser", "admin"],
        }),
      ),
    ).rejects.toThrow("REDIRECT /admin/ansatte?lagret=ny-ansatt");
    expect(mocks.core.createEmployee).toHaveBeenCalledWith(actor, ORG, {
      name: "Kari Testdatter",
      email: "Kari@Eksempel.no",
      jobTitle: null,
      companyId: COMPANY,
      officeId: null,
      roles: ["inspector", "admin"],
    });
  });

  it("selskap eller kontor som ikke finnes i organisasjonen, gir melding ved feltet", async () => {
    const state = await createEmployeeAction(
      initialFormState,
      form({
        name: "Kari Testdatter",
        email: "kari@eksempel.no",
        companyId: "0190a000-0000-7000-8000-0000000000ff",
        officeId: "ikke-en-id",
      }),
    );
    expect(state.fieldErrors).toEqual({
      companyId: "Velg et annet selskap.",
      officeId: "Velg et annet kontor.",
    });
    expect(mocks.core.createEmployee).not.toHaveBeenCalled();
  });

  it("siste admin: meldingen øverst i kortet", async () => {
    mocks.core.setEmployeeRoles.mockRejectedValue(new LastAdminError());
    const state = await setRolesAction(EMPLOYEE, initialFormState, form({ roles: "inspector" }));
    expect(state.message).toBe("Organisasjonen må ha minst én admin.");
    expect(state.fieldErrors).toEqual({});
  });

  it("enkeltrettigheter: gir de nye og tar bort dem som ikke er krysset av", async () => {
    mocks.core.getEmployeeForAdmin.mockResolvedValue({
      id: EMPLOYEE,
      permissions: ["report.edit"],
    });
    await expect(
      setPermissionsAction(
        EMPLOYEE,
        initialFormState,
        form({ permissions: ["template.edit_structure", "organization.manage"] }),
      ),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${EMPLOYEE}?lagret=rettigheter`);
    expect(mocks.core.grantEmployeePermission.mock.calls).toEqual([
      [actor, ORG, EMPLOYEE, "template.edit_structure"],
    ]);
    expect(mocks.core.revokeEmployeePermission.mock.calls).toEqual([
      [actor, ORG, EMPLOYEE, "report.edit"],
    ]);
  });

  it("«Har sluttet» sender til listen med kvittering", async () => {
    mocks.core.deactivateEmployee.mockResolvedValue({});
    await expect(deactivateEmployeeAction(EMPLOYEE, initialFormState)).rejects.toThrow(
      "REDIRECT /admin/ansatte?lagret=sluttet",
    );
    expect(mocks.core.deactivateEmployee).toHaveBeenCalledWith(actor, ORG, EMPLOYEE);
  });
});
