import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  EmployeeNotFoundError,
  OfficeNotFoundError,
  PossibleDuplicatesLookupError,
  ResponsibleNotInspectorError,
} from "@/core/assignments/errors";
import { ContactNotFoundError } from "@/core/contacts";
import { initialFormState, NO_ACCESS } from "../../form-state";
import { ASSIGNMENT_UNKNOWN_ERROR } from "./assignment-values";

/*
 * Server actions på /oppdrag/ny (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 6–8). Kjernen
 * og konteksten er byttet ut; de testes i src/core/assignments og employee-context.test.ts.
 * Testene viser at organisasjonen kommer fra serveren, at felt som kjernen setter aldri leses fra
 * skjemaet, at feilene står ved riktig felt, og at loggen aldri får skjemaverdier.
 * Oppdiktede verdier.
 * Støtter hovedmål: de ansatte (tydelige feil ved feltet) og færre reklamasjoner (aldri feil
 * organisasjon, dublettvarselet stopper aldri lagringen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  createAssignment: vi.fn(),
  findPossibleDuplicatesFor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assignments")>()),
  createAssignment: mocks.createAssignment,
  findPossibleDuplicatesFor: mocks.findPossibleDuplicatesFor,
}));

const { createAssignmentAction, findDraftDuplicatesAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const INSPECTOR = "0190a000-0000-7000-8000-000000000031";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const KEY = "0190a000-0000-7000-8000-000000000060";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };
const ADDRESS = "MERKE-ADR-N7Q Testveien 12, 8000 Bodø";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function validForm(extra: Record<string, string> = {}) {
  return form({
    addressText: ADDRESS,
    officeId: OFFICE,
    responsibleEmployeeId: INSPECTOR,
    creationKey: KEY,
    gnr: "",
    orderedByText: "MERKE-BEST-N7Q",
    ...extra,
  });
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  const match = /^REDIRECT (.+)$/.exec((error as Error).message);
  expect(match, `ventet videresending, fikk ${String(error)}`).not.toBeNull();
  return match![1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
});

describe("createAssignmentAction", () => {
  it("uten ansattrad: ingen tilgang, kjernen kalles ikke", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await createAssignmentAction(initialFormState, validForm());
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });

  it("lagrer med organisasjonen fra serveren og sender til oppdraget med kvitteringen", async () => {
    mocks.createAssignment.mockResolvedValue({ id: ASSIGNMENT, number: "2026-00001" });
    const url = await redirectOf(
      createAssignmentAction(
        initialFormState,
        validForm({
          organizationId: "0190a000-0000-7000-8000-0000000000ff",
          number: "9999",
          status: "invoiced",
          source: "email",
          orderedByFirmId: "0190a000-0000-7000-8000-0000000000fe",
        }),
      ),
    );
    expect(url).toBe(`/oppdrag/${ASSIGNMENT}?ny=1`);
    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
    const [calledActor, organizationId, input] = mocks.createAssignment.mock.calls[0]!;
    expect(calledActor).toBe(actor);
    expect(organizationId).toBe(ORG);
    expect(input).toMatchObject({
      addressText: ADDRESS,
      officeId: OFFICE,
      responsibleEmployeeId: INSPECTOR,
      creationKey: KEY,
      gnr: undefined,
    });
    for (const key of ["organizationId", "number", "status", "source", "orderedByFirmId"]) {
      expect(input).not.toHaveProperty(key);
    }
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/arbeidskoe");
  });

  it.each([
    [new OfficeNotFoundError(), "officeId", "Velg kontor."],
    [new EmployeeNotFoundError(), "responsibleEmployeeId", "Velg ansvarlig takstmann."],
    [new ResponsibleNotInspectorError(), "responsibleEmployeeId", "Velg ansvarlig takstmann."],
    [new ContactNotFoundError(), "orderedByContactId", "Kontakten finnes ikke."],
  ])(
    "%s står ved feltet %s, uten samlemelding, og verdiene står igjen",
    async (error, field, message) => {
      mocks.createAssignment.mockRejectedValue(error);
      const state = await createAssignmentAction(initialFormState, validForm());
      expect(state.fieldErrors).toEqual({ [field]: message });
      expect(state.message).toBeNull();
      expect(state.values.addressText).toBe(ADDRESS);
      expect(state.attempt).toBe(1);
    },
  );

  it("Zod-feil står ved feltet", async () => {
    mocks.createAssignment.mockRejectedValue(
      new ZodError([
        { code: "custom", path: ["addressText"], message: "Skriv inn adressen.", input: "" },
      ]),
    );
    const state = await createAssignmentAction(initialFormState, validForm({ addressText: "" }));
    expect(state.fieldErrors).toEqual({ addressText: "Skriv inn adressen." });
    expect(state.message).toBeNull();
  });

  it("manglende tilgang (takstmann med innstillingen av) gir tydelig melding", async () => {
    mocks.createAssignment.mockRejectedValue(new AccessDeniedError());
    const state = await createAssignmentAction(initialFormState, validForm());
    expect(state.message).toBe(NO_ACCESS);
  });

  it("ukjent feil: egen tekst, og loggen får ingen skjemaverdier", async () => {
    mocks.createAssignment.mockRejectedValue(new Error(`feil med ${ADDRESS}`));
    const state = await createAssignmentAction(initialFormState, validForm());
    expect(state.message).toBe(ASSIGNMENT_UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain("MERKE-ADR-N7Q");
    expect(logged).not.toContain("MERKE-BEST-N7Q");
  });
});

describe("findDraftDuplicatesAction", () => {
  const fields = {
    addressText: ADDRESS,
    gnr: "7771",
    bnr: "7772",
    snr: "",
    receivedAt: "2026-11-14T09:12",
  };

  it("gir bare type, id, nummer, status, adresse og grunn", async () => {
    mocks.findPossibleDuplicatesFor.mockResolvedValue({
      items: [
        {
          kind: "assignment",
          id: ASSIGNMENT,
          number: "2026-00042",
          status: "ordered",
          receivedAt: new Date(),
          addressText: "Testveien 12, 8000 Bodø",
          reasons: ["address"],
        },
      ],
      hasMore: false,
    });
    const result = await findDraftDuplicatesAction(fields);
    expect(result.items).toEqual([
      {
        kind: "assignment",
        id: ASSIGNMENT,
        number: "2026-00042",
        status: "ordered",
        addressText: "Testveien 12, 8000 Bodø",
        reasons: ["address"],
      },
    ]);
    const [, organizationId, sent] = mocks.findPossibleDuplicatesFor.mock.calls[0]!;
    expect(organizationId).toBe(ORG);
    expect(sent).toMatchObject({ addressText: ADDRESS, gnr: "7771", bnr: "7772", snr: null });
    expect(sent.receivedAt).toBeInstanceOf(Date);
  });

  it("uten ansattrad: ingen treff og intet oppslag", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    expect(await findDraftDuplicatesAction(fields)).toEqual({ items: [], hasMore: false });
    expect(mocks.findPossibleDuplicatesFor).not.toHaveBeenCalled();
  });

  it.each([
    new PossibleDuplicatesLookupError(),
    new AccessDeniedError(),
    new ZodError([]),
    new Error(`uventet ${ADDRESS}`),
  ])("feil (%s) gir ingen treff og ingen verdier i loggen", async (error) => {
    mocks.findPossibleDuplicatesFor.mockRejectedValue(error);
    expect(await findDraftDuplicatesAction(fields)).toEqual({ items: [], hasMore: false });
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain("MERKE-ADR-N7Q");
    expect(logged).not.toContain("7771");
  });
});
