import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { FirmNotFoundError } from "@/core/contacts/errors";
import { contactInputSchema } from "@/core/contacts/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";

/*
 * Server actions i /kontakter (docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 7).
 * Kjernen og konteksten er byttet ut her; de testes i src/core/contacts og
 * employee-context.test.ts.
 *
 * Avtalt med utvikler (kortet punkt 5): `createContactAction` og `updateContactAction` i
 * `./actions.ts`, signatur `(previous: FormState, formData: FormData)`. Feltnavn som i kjernen:
 * firstName, lastName, email, phone, firmId (nedtrekkslisten, «Ingen» = tom verdi), notes;
 * id-en til kontakten i `contactId`. Skjemaet sender aldri `source`.
 *
 * Kontakter er personopplysninger. Testdata er oppdiktet. Støtter hovedmål: reklamasjoner
 * (aldri feil organisasjon, aldri navn, e-post, telefon eller notat i loggen) og tid (feilen
 * står ved feltet).
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

const { createContactAction, updateContactAction, searchContactsAction } =
  await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const CONTACT = "0190a000-0000-7000-8000-000000000070";
const FIRM = "0190a000-0000-7000-8000-000000000060";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const FIRST = "Megler";
const LAST = "Test";
const EMAIL = "megler@example.com";
const PHONE = "00000000";
const NOTE = "Vil ha rapport før kl. 12";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function contactForm(overrides: Record<string, string> = {}) {
  return form({
    firstName: FIRST,
    lastName: LAST,
    email: EMAIL,
    phone: PHONE,
    firmId: FIRM,
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
  ["createContactAction", (data: FormData) => createContactAction(initialFormState, data)],
  [
    "updateContactAction",
    (data: FormData) => {
      if (!data.has("contactId")) data.append("contactId", CONTACT);
      return updateContactAction(initialFormState, data);
    },
  ],
] as const;

function coreMock(name: string) {
  return name === "createContactAction" ? mocks.core.createContact : mocks.core.updateContact;
}

/** Det handlingen sendte til kjernen: tredje argument ved ny, fjerde (etter id-en) ved endring. */
function inputOf(name: string) {
  const call = coreMock(name).mock.calls[0];
  return (name === "createContactAction" ? call?.[2] : call?.[3]) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  mocks.core.createContact.mockResolvedValue({ id: CONTACT, source: "manual" });
  mocks.core.updateContact.mockResolvedValue({ id: CONTACT, source: "manual" });
});

describe("7.1 uten kontekst", () => {
  it.each(ACTIONS)(
    "%s: getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen",
    async (_n, run) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await run(contactForm());
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("7.2 id som ikke er uuid", () => {
  it.each(["ikke-en-id", "1 or 1=1", "", "../x"])(
    "updateContactAction med kontakt-id «%s» → «ingen tilgang» uten kall til kjernen",
    async (contactId) => {
      const state = await updateContactAction(initialFormState, contactForm({ contactId }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("7.3 organisasjonen kommer fra konteksten", () => {
  it.each(ACTIONS)(
    "%s: organizationId og source i skjemaet endrer ikke kallet",
    async (name, run) => {
      await run(contactForm({ organizationId: OTHER_ORG, source: "order" })).catch(() => undefined);
      const mock = coreMock(name);
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0]?.[0]).toEqual(actor);
      expect(mock.mock.calls[0]?.[1]).toBe(ORG);
      const sent = JSON.stringify(mock.mock.calls);
      expect(sent).not.toContain(OTHER_ORG);
      expect(sent).not.toContain('"order"');
    },
  );

  it("updateContactAction sender kontakt-id-en fra skjemaet", async () => {
    await updateContactAction(initialFormState, contactForm({ contactId: CONTACT })).catch(
      () => undefined,
    );
    expect(mocks.core.updateContact).toHaveBeenCalledWith(actor, ORG, CONTACT, expect.anything());
  });
});

describe("7.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → «ingen tilgang»", async (name, run) => {
    coreMock(name).mockRejectedValue(new AccessDeniedError());
    const state = await run(contactForm());
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each(ACTIONS)("%s: ZodError → feil ved feltet med kortets tekster", async (name, run) => {
    const input = {
      firstName: " ",
      email: "ikke-epost",
      phone: "abc",
      notes: "Notat 12345678901 her",
    };
    const result = contactInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    coreMock(name).mockRejectedValue(result.error);

    const state = await run(contactForm(input));
    expect(state.fieldErrors.firstName).toBe("Skriv inn fornavnet.");
    expect(state.fieldErrors.email).toBe("E-postadressen er ikke gyldig.");
    expect(state.fieldErrors.phone).toBe("Telefonnummeret kan bare ha sifre, mellomrom og +.");
    expect(state.fieldErrors.notes).toBe("Fødselsnummer skal ikke lagres her.");
  });

  it.each(ACTIONS)(
    "%s: FirmNotFoundError → «Firmaet finnes ikke.» ved firmafeltet",
    async (name, run) => {
      coreMock(name).mockRejectedValue(new FirmNotFoundError());
      const state = await run(contactForm());
      expect(state.fieldErrors.firmId).toBe("Firmaet finnes ikke.");
    },
  );

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (name, run) => {
    coreMock(name).mockRejectedValue(new Error("oppdiktet"));
    const state = await run(contactForm());
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("7.6 «Ingen» i firmalisten", () => {
  it.each(ACTIONS)("%s: tom firmaverdi sendes som firmId = null", async (name, run) => {
    await run(contactForm({ firmId: "" })).catch(() => undefined);
    const input = inputOf(name);
    expect(input).toHaveProperty("firmId", null);
  });

  it.each(ACTIONS)("%s: valgt firma sendes med id-en", async (name, run) => {
    await run(contactForm({ firmId: FIRM })).catch(() => undefined);
    const input = inputOf(name);
    expect(input).toHaveProperty("firmId", FIRM);
  });
});

describe("7.7 suksess", () => {
  it("createContactAction sender videre til /kontakter/<id> med alle feltene", async () => {
    const url = await redirectOf(createContactAction(initialFormState, contactForm()));
    expect(url).toBe(`/kontakter/${CONTACT}`);
    expect(mocks.core.createContact.mock.calls[0]?.[2]).toMatchObject({
      firstName: FIRST,
      lastName: LAST,
      email: EMAIL,
      phone: PHONE,
      firmId: FIRM,
      notes: NOTE,
    });
  });

  it("updateContactAction sender videre til /kontakter/<id>", async () => {
    const url = await redirectOf(
      updateContactAction(initialFormState, contactForm({ contactId: CONTACT })),
    );
    expect(url).toBe(`/kontakter/${CONTACT}`);
  });
});

describe("7.8 loggkontrakt", () => {
  it.each(ACTIONS)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (name, run) => {
      const boom = new Error(`databasen sa nei til ${FIRST} ${LAST} ${EMAIL}`);
      boom.name = "OppdiktetFeil";
      coreMock(name).mockRejectedValue(boom);

      const state = await run(contactForm());
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      // Id-ene kan stå i loggen; de fjernes før sjekken, fordi «00000000» finnes i test-id-ene
      const logged = JSON.stringify(mocks.logError.mock.calls)
        .replaceAll(CONTACT, "<kontakt>")
        .replaceAll(FIRM, "<firma>")
        .replaceAll(ORG, "<org>");
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of [FIRST, LAST, EMAIL, PHONE, NOTE, "Megler Test"]) {
        expect(logged).not.toContain(value);
      }
    },
  );

  it("valideringsfeil og FirmNotFoundError logges ikke", async () => {
    const result = contactInputSchema.safeParse({ firstName: " " });
    mocks.core.createContact.mockRejectedValueOnce(result.error);
    await createContactAction(initialFormState, contactForm({ firstName: " " }));
    mocks.core.createContact.mockRejectedValueOnce(new FirmNotFoundError());
    const state = await createContactAction(initialFormState, contactForm());
    expect(allMessages(state)).toContain("Firmaet finnes ikke.");
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

/*
 * Søket i kontaktvelgeren (docs/funksjoner/fase2a-koble-kontakter-testplan.md avsnitt 8).
 * `searchContactsAction(query)` kaller `listContacts` og gir høyst 10 treff med
 * `{ id, name, firmName, email, phone }`. Under 2 tegn gir tom liste uten kall. Her er kjernen
 * byttet ut; organisasjonen og tilgangen mot ekte database står i search-action.test.ts.
 * Testdata er oppdiktet.
 */

describe("8. searchContactsAction (kjernen byttet ut)", () => {
  function listRow(index: number) {
    return {
      id: `0190a000-0000-7000-8000-0000000001${String(index).padStart(2, "0")}`,
      firstName: `${FIRST}${index}`,
      lastName: LAST,
      email: EMAIL,
      phone: PHONE,
      firmId: FIRM,
      firmName: "Testmegling AS",
      source: "manual",
    };
  }

  it.each(["", " ", "a", " a ", "Ø"])(
    "8.3 search_under_2_chars_empty_no_call: «%s» gir tom liste, og listContacts kalles ikke",
    async (query) => {
      expect(await searchContactsAction(query)).toEqual([]);
      expect(mocks.core.listContacts).not.toHaveBeenCalled();
    },
  );

  it("8.3b uten kontekst gir tom liste uten kall", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    expect(await searchContactsAction("Megler")).toEqual([]);
    expect(mocks.core.listContacts).not.toHaveBeenCalled();
  });

  it("8.4a kaller listContacts med organisasjonen fra konteksten og søketeksten; høyst 10 treff med fem felt", async () => {
    mocks.core.listContacts.mockResolvedValue(Array.from({ length: 15 }, (_v, i) => listRow(i)));

    const hits = await searchContactsAction("Me");

    expect(mocks.core.listContacts).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, options] = mocks.core.listContacts.mock.calls[0]!;
    expect(calledActor).toEqual(actor);
    expect(calledOrg).toBe(ORG);
    expect(options).toMatchObject({ query: "Me" });
    expect(hits).toHaveLength(10);
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual(["email", "firmName", "id", "name", "phone"]);
    }
    expect(hits[0]).toMatchObject({
      id: listRow(0).id,
      firmName: "Testmegling AS",
      email: EMAIL,
      phone: PHONE,
    });
    expect(hits[0]!.name).toContain(`${FIRST}0`);
    expect(hits[0]!.name).toContain(LAST);
  });

  it("8.5a AccessDeniedError fra kjernen gir tom liste, ikke unntak", async () => {
    mocks.core.listContacts.mockRejectedValue(new AccessDeniedError());
    await expect(searchContactsAction("Megler")).resolves.toEqual([]);
  });

  it("8.6 logger_never_gets_query: ukjent feil logges uten søketeksten, navn, e-post eller telefon", async () => {
    const query = "Hemmeligsøk Testesen";
    const boom = new Error(`databasen sa nei til ${query} ${EMAIL} ${PHONE}`);
    boom.name = "OppdiktetFeil";
    mocks.core.listContacts.mockRejectedValue(boom);

    await expect(searchContactsAction(query)).resolves.toEqual([]);

    const logged = JSON.stringify(mocks.logError.mock.calls).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<id>",
    );
    for (const value of ["Hemmeligsøk", "Testesen", EMAIL, PHONE]) {
      expect(logged, value).not.toContain(value);
    }
  });
});
