import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AccessDeniedError } from "@/core/access";

/*
 * «Lagre» på notatet i arbeidskøen (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 3.1).
 * Kjernen og konteksten er byttet ut her; kjernen testes i src/core/assignments. Testene viser at
 * handlingen henter organisasjonen på serveren, stopper id-er som ikke er uuid før kjernen kalles,
 * sender brukeren tilbake til samme fane, filter og søk, og aldri har notatet i adressen eller
 * loggen. Testdata er oppdiktet; «fødselsnummeret» er elleve sifre som ikke er et gyldig nummer.
 *
 * Støtter hovedmål: tid (tilbake til samme kort etter lagring) og reklamasjoner (aldri feil
 * organisasjon, aldri et avvist fødselsnummer i adressen eller loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  updateAssignmentNote: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: mocks.logError, info: mocks.logError },
}));
vi.mock("../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assignments")>()),
  updateAssignmentNote: mocks.updateAssignmentNote,
}));

const { saveNoteAction } = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000060";
const actor = { id: "user-takstmann", email: "takstmann@eksempel.no", name: "Takstmann Test" };

const NOTE = "Venter på nøkkel fra megler";
const FAKE_NATIONAL_ID = "12345678901";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function noteForm(overrides: Record<string, string> = {}) {
  return form({
    assignmentId: ASSIGNMENT,
    note: NOTE,
    status: "ordered",
    mine: "0",
    q: "Testveien",
    ...overrides,
  });
}

/** Kjører handlingen og gir adressen den sendte brukeren til. */
async function redirectOf(data: FormData): Promise<URL> {
  try {
    await saveNoteAction(data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT ")) {
      return new URL(error.message.slice("REDIRECT ".length), "http://localhost");
    }
    throw error;
  }
  throw new Error("handlingen sendte ikke brukeren videre");
}

function zodError(message: string) {
  const result = z
    .string()
    .refine(() => false, { error: message })
    .safeParse("x");
  return result.error!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    canReadClaims: false,
    canManageClaims: false,
    canManageContacts: false,
    officeId: null,
  });
  mocks.updateAssignmentNote.mockResolvedValue({
    id: ASSIGNMENT,
    number: "2026-00001",
    internalNote: NOTE,
  });
});

describe("3.1.1 uten kontekst", () => {
  it("getEmployeeContext gir null → ingen tilgang uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const url = await redirectOf(noteForm());
    expect(url.pathname).toBe("/arbeidskoe");
    expect(url.searchParams.get("feil")).toBe("ingen_tilgang");
    expect(mocks.updateAssignmentNote).not.toHaveBeenCalled();
  });
});

describe("3.1.2 id som ikke er uuid", () => {
  it.each(["ikke-en-id", "1 or 1=1", "../x", ""])(
    "oppdrags-id «%s» → ingen tilgang uten kall, og id-en står ikke i adressen",
    async (id) => {
      const url = await redirectOf(noteForm({ assignmentId: id }));
      expect(url.searchParams.get("feil")).toBe("ingen_tilgang");
      expect(url.searchParams.has("notatfeil")).toBe(false);
      expect(url.hash).toBe("");
      expect(mocks.updateAssignmentNote).not.toHaveBeenCalled();
    },
  );
});

describe("3.1.3 organisasjonen kommer fra konteksten", () => {
  it("organizationId og employeeId i skjemaet endrer ikke kallet", async () => {
    await redirectOf(noteForm({ organizationId: OTHER_ORG, employeeId: EMPLOYEE }));
    expect(mocks.updateAssignmentNote).toHaveBeenCalledTimes(1);
    expect(mocks.updateAssignmentNote).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT, NOTE);
  });

  it("tomt notat sendes som tom tekst (kjernen lagrer null)", async () => {
    await redirectOf(noteForm({ note: "" }));
    expect(mocks.updateAssignmentNote).toHaveBeenCalledWith(actor, ORG, ASSIGNMENT, "");
  });
});

describe("3.1.4 feilkart", () => {
  it("AccessDeniedError for den som kan endre → ikke funnet ved kortet", async () => {
    mocks.updateAssignmentNote.mockRejectedValue(new AccessDeniedError());
    const url = await redirectOf(noteForm());
    expect(url.searchParams.get("feil")).toBe("ikke_funnet");
    expect(url.searchParams.get("notatfeil")).toBe(ASSIGNMENT);
    expect(url.hash).toBe(`#kort-${ASSIGNMENT}`);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("AccessDeniedError for den som ikke kan endre → ingen tilgang", async () => {
    mocks.getEmployeeContext.mockResolvedValue({
      actor,
      organizationId: ORG,
      canEditOrders: false,
      canReadClaims: false,
      canManageClaims: false,
      canManageContacts: false,
      officeId: null,
    });
    mocks.updateAssignmentNote.mockRejectedValue(new AccessDeniedError());
    const url = await redirectOf(noteForm());
    expect(url.searchParams.get("feil")).toBe("ingen_tilgang");
  });

  it("ZodError for for lang tekst → for_langt ved feltet", async () => {
    mocks.updateAssignmentNote.mockRejectedValue(zodError("Notatet kan ha høyst 200 tegn."));
    const url = await redirectOf(noteForm({ note: "a".repeat(201) }));
    expect(url.searchParams.get("feil")).toBe("for_langt");
    expect(url.searchParams.get("notatfeil")).toBe(ASSIGNMENT);
  });

  it("ZodError for fødselsnummer → fnr ved feltet", async () => {
    mocks.updateAssignmentNote.mockRejectedValue(zodError("Fødselsnummer skal ikke lagres her."));
    const url = await redirectOf(noteForm({ note: `Nr ${FAKE_NATIONAL_ID}` }));
    expect(url.searchParams.get("feil")).toBe("fnr");
    expect(url.searchParams.get("notatfeil")).toBe(ASSIGNMENT);
  });

  it("ukjent feil → ukjent, og loggen får bare id-er og feilnavn", async () => {
    const boom = new Error(`databasen sa nei til ${NOTE}`);
    boom.name = "OppdiktetFeil";
    mocks.updateAssignmentNote.mockRejectedValue(boom);
    const url = await redirectOf(noteForm());
    expect(url.searchParams.get("feil")).toBe("ukjent");
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).toContain(ASSIGNMENT);
    expect(logged).not.toContain(NOTE);
  });
});

describe("3.1.5 tilbake til samme kø", () => {
  it("etter lagring: samme fane, filter og søk, og kortet som mål", async () => {
    const url = await redirectOf(noteForm());
    expect(url.pathname).toBe("/arbeidskoe");
    expect(url.searchParams.get("status")).toBe("ordered");
    expect(url.searchParams.get("mine")).toBe("0");
    expect(url.searchParams.get("q")).toBe("Testveien");
    expect(url.searchParams.has("feil")).toBe(false);
    expect(url.hash).toBe(`#kort-${ASSIGNMENT}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/arbeidskoe");
  });

  it("«Mine» (mine=1) gir ingen mine-parameter", async () => {
    const url = await redirectOf(noteForm({ mine: "1", q: "" }));
    expect(url.searchParams.has("mine")).toBe(false);
    expect(url.searchParams.has("q")).toBe(false);
  });

  it.each([
    ["status", "https://ondt.example"],
    ["status", "cancelled"],
    ["mine", "//ondt.example"],
  ])("ugyldig %s «%s» gir standardverdien, aldri en annen adresse", async (field, value) => {
    const url = await redirectOf(noteForm({ [field]: value }));
    expect(url.origin).toBe("http://localhost");
    expect(url.pathname).toBe("/arbeidskoe");
    if (field === "status") expect(url.searchParams.get("status")).toBe("in_progress");
    if (field === "mine") expect(url.searchParams.has("mine")).toBe(false);
  });

  it("søket kuttes og trimmes som i adressen, og skrives trygt", async () => {
    const url = await redirectOf(noteForm({ q: `  ${"x".repeat(150)}&feil=ukjent  ` }));
    expect(url.searchParams.get("q")!.length).toBeLessThanOrEqual(100);
    expect(url.searchParams.has("feil")).toBe(false);
  });
});

describe("3.1.6 notatet står aldri i adressen eller loggen", () => {
  it.each([
    ["lagret", null],
    ["for langt", zodError("Notatet kan ha høyst 200 tegn.")],
    ["fødselsnummer", zodError("Fødselsnummer skal ikke lagres her.")],
    ["ukjent feil", new Error("noe")],
  ])("%s: adressen og loggen har ikke teksten", async (_name, error) => {
    if (error) mocks.updateAssignmentNote.mockRejectedValue(error);
    const note = `Notat ${FAKE_NATIONAL_ID}`;
    const url = await redirectOf(noteForm({ note }));
    expect(url.toString()).not.toContain(FAKE_NATIONAL_ID);
    expect(decodeURIComponent(url.toString())).not.toContain("Notat ");
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(FAKE_NATIONAL_ID);
    expect(logged).not.toContain(note);
  });
});
