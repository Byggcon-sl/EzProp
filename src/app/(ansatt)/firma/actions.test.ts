import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { FirmDuplicateError, MergeSameRecordError } from "@/core/contacts/errors";
import { firmInputSchema } from "@/core/contacts/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";

/*
 * Server actions i /firma (docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 7).
 * Kjernen og konteksten er byttet ut her; de testes i src/core/contacts og
 * employee-context.test.ts. Testene viser at hver handling henter organisasjonen på serveren,
 * sjekker id-en før kjernen kalles, gir de faste meldingene og aldri logger skjemaverdier.
 *
 * Avtalt med utvikler (kortet punkt 5): `createFirmAction` og `updateFirmAction` i
 * `./actions.ts`, signatur `(previous: FormState, formData: FormData)`. Feltnavn som i kjernen:
 * name, orgNumber, firmType, notes; id-en til firmaet i `firmId`.
 *
 * Testdata er oppdiktet. Støtter hovedmål: tid (dubletten gir lenke til firmaet som finnes) og
 * reklamasjoner (aldri feil organisasjon, aldri navn, nummer eller notat i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    listFirms: vi.fn(),
    getFirm: vi.fn(),
    createFirm: vi.fn(),
    updateFirm: vi.fn(),
    listContacts: vi.fn(),
    getContact: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    removeContact: vi.fn(),
    mergeContacts: vi.fn(),
    removeFirm: vi.fn(),
    mergeFirms: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/contacts")>()),
  ...mocks.core,
}));

const { createFirmAction, updateFirmAction, removeFirmAction, mergeFirmsAction } =
  await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const FIRM = "0190a000-0000-7000-8000-000000000060";
const EXISTING = "0190a000-0000-7000-8000-000000000061";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const NAME = "Testmegling AS";
const ORG_NUMBER = "000000019";
const NOTE = "Vil ha rapport før kl. 12";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function firmForm(overrides: Record<string, string> = {}) {
  return form({
    name: NAME,
    orgNumber: ORG_NUMBER,
    firmType: "broker_firm",
    notes: NOTE,
    ...overrides,
  });
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

function allMessages(state: FormState): string[] {
  return [...Object.values(state.fieldErrors), state.message ?? ""];
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "handlingen skulle sendt videre").toBeInstanceOf(Error);
  const match = /^REDIRECT (.+)$/.exec((error as Error).message);
  expect(match, `ventet videresending, fikk ${String(error)}`).not.toBeNull();
  return match![1]!;
}

const ACTIONS = [
  ["createFirmAction", (data: FormData) => createFirmAction(initialFormState, data)],
  [
    "updateFirmAction",
    (data: FormData) => {
      if (!data.has("firmId")) data.append("firmId", FIRM);
      return updateFirmAction(initialFormState, data);
    },
  ],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  mocks.core.createFirm.mockResolvedValue({ id: FIRM, name: NAME });
  mocks.core.updateFirm.mockResolvedValue({ id: FIRM, name: NAME });
});

describe("7.1 uten kontekst", () => {
  it.each(ACTIONS)(
    "%s: getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen",
    async (_n, run) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await run(firmForm());
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("7.2 id som ikke er uuid", () => {
  it.each(["ikke-en-id", "1 or 1=1", "", "../x"])(
    "updateFirmAction med firma-id «%s» → «ingen tilgang» uten kall til kjernen",
    async (firmId) => {
      const state = await updateFirmAction(initialFormState, firmForm({ firmId }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("7.3 organisasjonen kommer fra konteksten", () => {
  it.each(ACTIONS)("%s: organizationId i skjemaet endrer ikke kallet", async (name, run) => {
    await run(firmForm({ organizationId: OTHER_ORG })).catch(() => undefined);
    const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toEqual(actor);
    expect(mock.mock.calls[0]?.[1]).toBe(ORG);
    expect(JSON.stringify(mock.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("updateFirmAction sender firma-id-en fra skjemaet", async () => {
    await updateFirmAction(initialFormState, firmForm({ firmId: FIRM })).catch(() => undefined);
    expect(mocks.core.updateFirm).toHaveBeenCalledWith(actor, ORG, FIRM, expect.anything());
  });
});

describe("7.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → «ingen tilgang»", async (name, run) => {
    const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
    mock.mockRejectedValue(new AccessDeniedError());
    const state = await run(firmForm());
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each(ACTIONS)("%s: ZodError → feil ved feltet med kortets tekster", async (name, run) => {
    const result = firmInputSchema.safeParse({ name: " ", orgNumber: "000000018" });
    expect(result.success).toBe(false);
    const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
    mock.mockRejectedValue(result.error);

    const state = await run(firmForm({ name: " ", orgNumber: "000000018" }));
    expect(state.fieldErrors.name).toBe("Skriv inn navnet.");
    expect(state.fieldErrors.orgNumber).toBe("Organisasjonsnummeret er ikke gyldig.");
  });

  it.each(ACTIONS)("%s: for kort nummer → «må ha 9 sifre» ved feltet", async (name, run) => {
    const result = firmInputSchema.safeParse({ name: NAME, orgNumber: "00000001" });
    expect(result.success).toBe(false);
    const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
    mock.mockRejectedValue(result.error);
    const state = await run(firmForm({ orgNumber: "00000001" }));
    expect(state.fieldErrors.orgNumber).toBe("Organisasjonsnummeret må ha 9 sifre.");
  });

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, run) => {
    const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
    mock.mockRejectedValue(new Error("oppdiktet"));
    const state = await run(firmForm());
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("7.5 dublett", () => {
  it.each(ACTIONS)(
    "%s: FirmDuplicateError → meldingen med navnet og lenken /firma/<id>",
    async (name, run) => {
      const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
      mock.mockRejectedValue(new FirmDuplicateError(EXISTING, NAME));
      const state = await run(firmForm({ name: "Annet navn AS" }));
      expect(allMessages(state)).toContain(
        "Et firma med dette organisasjonsnummeret finnes allerede: Testmegling AS.",
      );
      expect(JSON.stringify(state)).toContain(`/firma/${EXISTING}`);
      // Verdiene står igjen i skjemaet, så brukeren slipper å skrive dem på nytt
      expect(state.values.name).toBe("Annet navn AS");
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );
});

describe("7.7 suksess", () => {
  it("createFirmAction sender videre til /firma/<id>", async () => {
    const url = await redirectOf(createFirmAction(initialFormState, firmForm()));
    expect(url).toBe(`/firma/${FIRM}`);
    expect(mocks.core.createFirm.mock.calls[0]?.[2]).toMatchObject({
      name: NAME,
      orgNumber: ORG_NUMBER,
      firmType: "broker_firm",
      notes: NOTE,
    });
  });

  it("updateFirmAction sender videre til /firma/<id>", async () => {
    const url = await redirectOf(updateFirmAction(initialFormState, firmForm({ firmId: FIRM })));
    expect(url).toBe(`/firma/${FIRM}`);
  });
});

describe("7.8 loggkontrakt", () => {
  it.each(ACTIONS)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (name, run) => {
      const boom = new Error(`databasen sa nei til ${NAME} ${ORG_NUMBER}`);
      boom.name = "OppdiktetFeil";
      const mock = name === "createFirmAction" ? mocks.core.createFirm : mocks.core.updateFirm;
      mock.mockRejectedValue(boom);

      const state = await run(firmForm());
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(mocks.logError.mock.calls);
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of [NAME, ORG_NUMBER, NOTE, "Testmegling"]) {
        expect(logged).not.toContain(value);
      }
    },
  );
});

/*
 * Fjerne og slå sammen firma (docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md
 * avsnitt 4). Kjernen er byttet ut; tjenestene testes mot databasen i src/core/contacts.
 * Avtalt med utvikler: `removeFirmAction` (id-en i `firmId`) og `mergeFirmsAction` (`keepId` og
 * `removeId`), signatur `(previous: FormState, formData: FormData)`.
 * Støtter hovedmål: reklamasjoner (ingen 500 og ingen navn eller organisasjonsnummer i loggen) og
 * tid (riktig melding med én gang).
 */

const KEEP = FIRM;
const REMOVE = EXISTING;
const FIRM_NOT_FOUND = "Firmaet finnes ikke.";
const SAME_FIRM = "Velg to ulike firma.";

function runRemove(overrides: Record<string, string> = {}) {
  return removeFirmAction(initialFormState, form({ firmId: REMOVE, ...overrides }));
}

function runMerge(overrides: Record<string, string> = {}) {
  return mergeFirmsAction(initialFormState, form({ keepId: KEEP, removeId: REMOVE, ...overrides }));
}

const REMOVE_MERGE = [
  ["removeFirmAction", () => mocks.core.removeFirm, runRemove],
  ["mergeFirmsAction", () => mocks.core.mergeFirms, runMerge],
] as const;

describe("4. fjerne og slå sammen firma", () => {
  beforeEach(() => {
    mocks.core.removeFirm.mockResolvedValue({ contactCount: 1 });
    mocks.core.mergeFirms.mockResolvedValue({ contactCount: 1, partyCount: 1, orderCount: 1 });
  });

  it.each([
    ["removeFirmAction", "firmId", "abc", runRemove],
    ["removeFirmAction", "firmId", "", runRemove],
    ["mergeFirmsAction", "keepId", "abc", runMerge],
    ["mergeFirmsAction", "keepId", "", runMerge],
    ["mergeFirmsAction", "removeId", "abc", runMerge],
    ["mergeFirmsAction", "removeId", "", runMerge],
  ] as const)(
    "4.1 invalid_id_no_core_call: %s med %s = «%s» gir «Firmaet finnes ikke.» uten kall til kjernen",
    async (_name, field, value, run) => {
      const state = await run({ [field]: value });
      expect(state.message).toBe(FIRM_NOT_FOUND);
      expect(coreCalls()).toBe(0);
    },
  );

  it("4.2 same_record_message: MergeSameRecordError gir «Velg to ulike firma.», ikke 500", async () => {
    mocks.core.mergeFirms.mockRejectedValue(new MergeSameRecordError("firm"));
    const state = await runMerge({ keepId: KEEP, removeId: KEEP });
    expect(state.message).toBe(SAME_FIRM);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each(REMOVE_MERGE)(
    "4.3 access_denied_message: %s med AccessDeniedError gir «Firmaet finnes ikke.» uten detaljer",
    async (_name, core, run) => {
      core().mockRejectedValue(new AccessDeniedError());
      const state = await run();
      expect(state.message).toBe(FIRM_NOT_FOUND);
      expect(JSON.stringify(state)).not.toContain("AccessDenied");
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );

  it.each(REMOVE_MERGE)(
    "4.3b %s: organisasjonen og brukeren kommer fra konteksten, ikke fra skjemaet",
    async (_name, core, run) => {
      await run({ organizationId: OTHER_ORG }).catch(() => undefined);
      expect(core()).toHaveBeenCalledTimes(1);
      expect(core().mock.calls[0]?.[0]).toEqual(actor);
      expect(core().mock.calls[0]?.[1]).toBe(ORG);
      expect(JSON.stringify(core().mock.calls)).not.toContain(OTHER_ORG);
    },
  );

  it("4.3c mergeFirmsAction sender keepId og removeId fra skjemaet", async () => {
    await runMerge().catch(() => undefined);
    expect(mocks.core.mergeFirms).toHaveBeenCalledWith(actor, ORG, {
      keepId: KEEP,
      removeId: REMOVE,
    });
  });

  it.each(REMOVE_MERGE)(
    "4.4 logger_contract: %s logger ukjent feil bare med rute, bruker-id, id-er og feilnavn",
    async (_name, core, run) => {
      const boom = new Error(`databasen sa nei til ${NAME} ${ORG_NUMBER} ${NOTE}`);
      boom.name = "OppdiktetFeil";
      core().mockRejectedValue(boom);

      const state = await run();
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(mocks.logError.mock.calls)
        .replaceAll(KEEP, "<behold>")
        .replaceAll(REMOVE, "<fjern>")
        .replaceAll(ORG, "<org>");
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of [NAME, ORG_NUMBER, NOTE, "Testmegling", "databasen sa nei"]) {
        expect(logged, value).not.toContain(value);
      }
    },
  );

  it("4.4b removeFirmAction sender tilbake til listen etter fjerning", async () => {
    const url = await redirectOf(runRemove());
    expect(url.startsWith("/firma")).toBe(true);
    expect(url).not.toContain(REMOVE);
    expect(mocks.core.removeFirm).toHaveBeenCalledWith(actor, ORG, REMOVE);
  });

  it("4.4c mergeFirmsAction sender videre til firmaet som beholdes", async () => {
    const url = await redirectOf(runMerge());
    expect(url.startsWith(`/firma/${KEEP}`)).toBe(true);
  });
});
