import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import {
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  OrderChangedError,
} from "@/core/orders/errors";
import { orderInputSchema } from "@/core/orders/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";

/*
 * Server actions i /ordre (docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 7, med
 * runde 1: ukjent feil logges uten skjemaverdier). Kjernen og konteksten er byttet ut her; de
 * testes i src/core/orders og employee-context.test.ts. Testene viser at hver handling henter
 * organisasjonen på serveren, sjekker id-er før kjernen kalles, og gir de faste meldingene.
 *
 * Feltnavn i skjemaet: addressText, gnr …, orderId, reason, officeId (som i kjernen).
 * Støtter hovedmål: tid (feil vises ved feltet) og reklamasjoner (aldri feil organisasjon,
 * aldri adresse eller grunn i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    createOrder: vi.fn(),
    rejectOrder: vi.fn(),
    convertOrderToAssignment: vi.fn(),
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    updateOrder: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orders")>()),
  ...mocks.core,
}));

const { createOrderAction, rejectOrderAction, convertOrderAction, updateOrderAction } =
  await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ORDER = "0190a000-0000-7000-8000-000000000040";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const ADDRESS = "Testveien 12, 8000 Bodø";
const ORDERED_BY = "Megler Testesen, Testmegleren AS";
const REASON = "Feil registrering hos Testmegleren";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

/** Alle meldinger i svaret, ved feltene og øverst. */
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    canReadClaims: false,
    canManageClaims: false,
    canManageContacts: false,
    officeId: OFFICE,
  });
});

describe("7.1 uten kontekst", () => {
  it.each([
    [
      "createOrderAction",
      () => createOrderAction(initialFormState, form({ addressText: ADDRESS })),
    ],
    [
      "rejectOrderAction",
      () => rejectOrderAction(initialFormState, form({ orderId: ORDER, reason: REASON })),
    ],
    [
      "convertOrderAction",
      () => convertOrderAction(initialFormState, form({ orderId: ORDER, officeId: OFFICE })),
    ],
  ])("%s: getEmployeeContext gir null → «ingen tilgang» uten kall til kjernen", async (_n, run) => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("7.2 organisasjonen kommer fra konteksten", () => {
  it("createOrderAction: organizationId i skjemaet endrer ingenting", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    await redirectOf(
      createOrderAction(
        initialFormState,
        form({ addressText: ADDRESS, organizationId: OTHER_ORG }),
      ),
    );
    expect(mocks.core.createOrder).toHaveBeenCalledWith(actor, ORG, expect.anything());
    expect(JSON.stringify(mocks.core.createOrder.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("rejectOrderAction og convertOrderAction: kjernen kalles med ORG", async () => {
    mocks.core.rejectOrder.mockResolvedValue({ id: ORDER, status: "rejected" });
    mocks.core.convertOrderToAssignment.mockResolvedValue({
      assignment: {
        id: ASSIGNMENT,
        number: "2026-00001",
        officeId: OFFICE,
        status: "ordered",
        orderId: ORDER,
      },
      order: { id: ORDER, status: "converted" },
    });
    await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON, organizationId: OTHER_ORG }),
    ).catch(() => undefined);
    await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE, organizationId: OTHER_ORG }),
    ).catch(() => undefined);

    expect(mocks.core.rejectOrder).toHaveBeenCalledWith(actor, ORG, ORDER, REASON);
    expect(mocks.core.convertOrderToAssignment).toHaveBeenCalledWith(
      actor,
      ORG,
      ORDER,
      expect.objectContaining({ officeId: OFFICE }),
    );
    expect(JSON.stringify(mocks.core.rejectOrder.mock.calls)).not.toContain(OTHER_ORG);
    expect(JSON.stringify(mocks.core.convertOrderToAssignment.mock.calls)).not.toContain(OTHER_ORG);
  });
});

describe("7.3 createOrderAction", () => {
  it("ZodError fra kjernen gir feil ved feltet med kortets tekster", async () => {
    const result = orderInputSchema(new Date()).safeParse({ addressText: " ", gnr: "12a" });
    expect(result.success).toBe(false);
    mocks.core.createOrder.mockRejectedValue(result.error);

    const state = await createOrderAction(initialFormState, form({ addressText: " ", gnr: "12a" }));
    expect(state.fieldErrors.addressText).toBe("Skriv inn adressen.");
    expect(state.fieldErrors.gnr).toBe("Gårdsnummer kan bare ha sifre.");
  });

  it("mottatt frem i tid gir «Mottatt kan ikke være frem i tid.» ved feltet", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const result = orderInputSchema(now).safeParse({ addressText: ADDRESS, receivedAt: future });
    expect(result.success).toBe(false);
    mocks.core.createOrder.mockRejectedValue(result.error);

    // Feltet er `datetime-local` («ÅÅÅÅ-MM-DDTtt:mm», norsk tid)
    const futureLocal = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(new Date(future))
      .replace(" ", "T");
    const state = await createOrderAction(
      initialFormState,
      form({ addressText: ADDRESS, receivedAt: futureLocal }),
    );
    expect(state.fieldErrors.receivedAt).toBe("Mottatt kan ikke være frem i tid.");
  });

  it("suksess sender videre til /ordre/<id>", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    const url = await redirectOf(
      createOrderAction(
        initialFormState,
        form({ addressText: ADDRESS, gnr: "12", bnr: "34", sellerDeclarationReceived: "on" }),
      ),
    );
    expect(url).toBe(`/ordre/${ORDER}`);
    const input = mocks.core.createOrder.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(input).toMatchObject({ addressText: ADDRESS, gnr: "12", bnr: "34" });
  });

  it("AccessDeniedError gir «ingen tilgang»", async () => {
    mocks.core.createOrder.mockRejectedValue(new AccessDeniedError());
    const state = await createOrderAction(initialFormState, form({ addressText: ADDRESS }));
    expect(state.message).toBe(NO_ACCESS);
  });

  it("ukjent feil gir UNKNOWN_ERROR og en logglinje uten adresse eller bestiller", async () => {
    const boom = new Error(`databasen sa nei til ${ADDRESS}`);
    boom.name = "OppdiktetFeil";
    mocks.core.createOrder.mockRejectedValue(boom);

    const state = await createOrderAction(
      initialFormState,
      form({ addressText: ADDRESS, orderedByText: ORDERED_BY, gnr: "12" }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).toContain(actor.id);
    for (const value of [ADDRESS, ORDERED_BY, "Testveien", "Testmegleren"]) {
      expect(logged).not.toContain(value);
    }
  });
});

describe("7.4 rejectOrderAction", () => {
  it.each(["", "   "])(
    "tom grunn «%s» gir «Skriv inn en grunn.» uten kall til kjernen",
    async (reason) => {
      const state = await rejectOrderAction(initialFormState, form({ orderId: ORDER, reason }));
      expect(allMessages(state)).toContain("Skriv inn en grunn.");
      expect(coreCalls()).toBe(0);
    },
  );

  it("OrderAlreadyHandledError gir «Ordren er allerede behandlet.»", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON }),
    );
    expect(allMessages(state)).toContain("Ordren er allerede behandlet.");
  });

  it.each(["ikke-en-id", "1 or 1=1", "", "../x"])(
    "ordre-id «%s» som ikke er uuid gir «ingen tilgang» uten kall",
    async (orderId) => {
      const state = await rejectOrderAction(initialFormState, form({ orderId, reason: REASON }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it("AccessDeniedError fra kjernen (fremmed id) gir «ingen tilgang»", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new AccessDeniedError());
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON }),
    );
    expect(state.message).toBe(NO_ACCESS);
  });

  it("ukjent feil logges uten grunnen", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new Error(REASON));
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(REASON);
    expect(logged).not.toContain("Testmegleren");
  });
});

describe("7.5 convertOrderAction", () => {
  it("mangler kontor gir melding ved feltet uten kall til kjernen", async () => {
    const state = await convertOrderAction(initialFormState, form({ orderId: ORDER }));
    expect(state.fieldErrors.officeId).toBeTruthy();
    expect(coreCalls()).toBe(0);
  });

  it("OfficeNotFoundError gir «Kontoret finnes ikke.»", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new OfficeNotFoundError());
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(allMessages(state)).toContain("Kontoret finnes ikke.");
  });

  it("OrderAlreadyHandledError gir «Ordren er allerede behandlet.»", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(allMessages(state)).toContain("Ordren er allerede behandlet.");
  });

  it("ordre-id som ikke er uuid gir «ingen tilgang» uten kall", async () => {
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: "ikke-en-id", officeId: OFFICE }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("suksess sender videre til /ordre/<id>", async () => {
    mocks.core.convertOrderToAssignment.mockResolvedValue({
      assignment: {
        id: ASSIGNMENT,
        number: "2026-00001",
        officeId: OFFICE,
        status: "ordered",
        orderId: ORDER,
      },
      order: { id: ORDER, status: "converted" },
    });
    const url = await redirectOf(
      convertOrderAction(initialFormState, form({ orderId: ORDER, officeId: OFFICE })),
    );
    expect(url).toBe(`/ordre/${ORDER}`);
  });

  it("ukjent feil gir UNKNOWN_ERROR og logger bare id-er og feilnavn", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new TypeError(ADDRESS));
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain(ADDRESS);
  });
});

/*
 * Bestilleren fra kontaktregisteret (docs/funksjoner/fase2a-koble-kontakter-testplan.md punkt
 * 8.1, 8.2 og 8.6). Kontaktvelgeren sender det skjulte feltet `orderedByContactId`.
 */
describe("8 bestilleren fra kontaktregisteret", () => {
  const CONTACT_ID = "0190a000-0000-7000-8000-000000000090";
  const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";

  function orderForm(overrides: Record<string, string> = {}) {
    return form({ addressText: ADDRESS, orderedByText: ORDERED_BY, ...overrides });
  }

  it.each(["abc", "1", "1 or 1=1", "../x"])(
    "8.1 invalid_contactId_field_error_no_core_call: «%s» → feil ved feltet uten kall",
    async (orderedByContactId) => {
      const state = await createOrderAction(initialFormState, orderForm({ orderedByContactId }));
      expect(state.fieldErrors.orderedByContactId).toBe(CONTACT_NOT_FOUND);
      expect(coreCalls()).toBe(0);
    },
  );

  it("8.2 ContactNotFoundError_becomes_field_error: feil ved feltet, ikke 500, og ingen logg", async () => {
    mocks.core.createOrder.mockRejectedValue(new ContactNotFoundError());
    const state = await createOrderAction(
      initialFormState,
      orderForm({ orderedByContactId: CONTACT_ID }),
    );
    expect(state.fieldErrors.orderedByContactId).toBe(CONTACT_NOT_FOUND);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ZodError for orderedByContactId fra kjernen står ved feltet", async () => {
    const result = orderInputSchema(new Date()).safeParse({
      addressText: ADDRESS,
      orderedByContactId: "ikke-en-id",
    });
    expect(result.success).toBe(false);
    mocks.core.createOrder.mockRejectedValue(result.error);
    const state = await createOrderAction(initialFormState, orderForm());
    expect(state.fieldErrors.orderedByContactId).toBe(CONTACT_NOT_FOUND);
  });

  it("valgt kontakt sendes med id-en og friteksten, og man går til ordresiden", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    const url = await redirectOf(
      createOrderAction(initialFormState, orderForm({ orderedByContactId: CONTACT_ID })),
    );
    expect(url).toBe(`/ordre/${ORDER}`);
    expect(mocks.core.createOrder.mock.calls[0]?.[2]).toMatchObject({
      orderedByContactId: CONTACT_ID,
      orderedByText: ORDERED_BY,
    });
  });

  it.each([
    ["tomt felt", { orderedByContactId: "" }],
    ["uten feltet", {}],
  ])("%s gir orderedByContactId = null", async (_label, overrides) => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    await redirectOf(createOrderAction(initialFormState, orderForm(overrides)));
    const input = mocks.core.createOrder.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(input.orderedByContactId).toBeNull();
  });

  it("8.1d orderedByFirmId fra skjemaet sendes aldri til kjernen", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    await redirectOf(
      createOrderAction(
        initialFormState,
        orderForm({
          orderedByContactId: CONTACT_ID,
          orderedByFirmId: "0190a000-0000-7000-8000-000000000091",
        }),
      ),
    );
    expect(mocks.core.createOrder.mock.calls[0]?.[2]).not.toHaveProperty("orderedByFirmId");
  });

  it("8.6 logger_never_gets_form_values_or_query: ukjent feil logges uten bestilleren", async () => {
    const boom = new Error(`databasen sa nei til ${ORDERED_BY}`);
    boom.name = "OppdiktetFeil";
    mocks.core.createOrder.mockRejectedValue(boom);
    const state = await createOrderAction(
      initialFormState,
      orderForm({ orderedByContactId: CONTACT_ID }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).not.toContain(ORDERED_BY);
    expect(logged).not.toContain("Testmegleren");
    expect(logged).not.toContain(ADDRESS);
  });
});

/*
 * «Rett ordren» (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 3). Skjemaet sender
 * orderId, rowVersion og de samme feltene som «Ny ordre». Mottatt er påkrevd ved retting.
 * Støtter hovedmål: de ansatte (riktig norsk melding per feil) og færre reklamasjoner (aldri feil
 * organisasjon, aldri stille overskriving, ingen personopplysninger i loggen).
 */
describe("3 updateOrderAction", () => {
  const ORDER_CHANGED = "Ordren er endret av en annen. Last siden på nytt.";
  const CONTACT_ID = "0190a000-0000-7000-8000-000000000092";
  const GNR = "56";
  const BNR = "78";
  const EXTERNAL_REF = "TEST-ORD-0002";
  const NEW_ADDRESS = "Prøvegata 7, 8006 Bodø";

  function updateForm(overrides: Record<string, string> = {}) {
    return form({
      orderId: ORDER,
      rowVersion: "3",
      addressText: NEW_ADDRESS,
      receivedAt: "2026-11-02T09:00",
      orderedByText: ORDERED_BY,
      externalRef: EXTERNAL_REF,
      gnr: GNR,
      bnr: BNR,
      ...overrides,
    });
  }

  function updated() {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, changedFields: ["addressText"] });
  }

  it("3.1 gyldig retting kaller updateOrder med organisasjonen fra innloggingen og går til /ordre/<id>?rettet=1", async () => {
    updated();
    const url = await redirectOf(
      updateOrderAction(initialFormState, updateForm({ organizationId: OTHER_ORG })),
    );
    expect(url).toBe(`/ordre/${ORDER}?rettet=1`);
    expect(mocks.core.updateOrder).toHaveBeenCalledTimes(1);
    const [calledActor, organizationId, orderId, input, rowVersion] =
      mocks.core.updateOrder.mock.calls[0]!;
    expect(calledActor).toBe(actor);
    expect(organizationId).toBe(ORG);
    expect(orderId).toBe(ORDER);
    expect(rowVersion).toBe(3);
    expect(input).toMatchObject({
      addressText: NEW_ADDRESS,
      orderedByText: ORDERED_BY,
      externalRef: EXTERNAL_REF,
      gnr: GNR,
      bnr: BNR,
      receivedAt: new Date("2026-11-02T08:00:00.000Z").toISOString(),
    });
    expect(JSON.stringify(mocks.core.updateOrder.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("3.1 orderedByFirmId fra skjemaet sendes aldri til kjernen", async () => {
    updated();
    await redirectOf(
      updateOrderAction(
        initialFormState,
        updateForm({
          orderedByContactId: CONTACT_ID,
          orderedByFirmId: "0190a000-0000-7000-8000-000000000093",
        }),
      ),
    );
    const input = mocks.core.updateOrder.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(input.orderedByContactId).toBe(CONTACT_ID);
    expect(input).not.toHaveProperty("orderedByFirmId");
  });

  it("3.1 uten kontekst gir «ingen tilgang» uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await updateOrderAction(initialFormState, updateForm());
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each(["", "abc", "1", "../x", `${ORDER}x`])(
    "3.2 ordre-id «%s» som ikke er uuid gir NO_ACCESS uten kall til kjernen",
    async (orderId) => {
      const state = await updateOrderAction(initialFormState, updateForm({ orderId }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it("3.3 AccessDeniedError gir NO_ACCESS", async () => {
    mocks.core.updateOrder.mockRejectedValue(new AccessDeniedError());
    const state = await updateOrderAction(initialFormState, updateForm());
    expect(state.message).toBe(NO_ACCESS);
  });

  it("3.3 OrderChangedError gir «Ordren er endret av en annen. Last siden på nytt.» uten logg", async () => {
    mocks.core.updateOrder.mockRejectedValue(new OrderChangedError());
    const state = await updateOrderAction(initialFormState, updateForm());
    expect(state.message).toBe(ORDER_CHANGED);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("3.3 ZodError fra kjernen gir feltfeil med samme tekster som «Ny ordre»", async () => {
    const result = orderInputSchema(new Date()).safeParse({ addressText: " ", gnr: "12a" });
    expect(result.success).toBe(false);
    mocks.core.updateOrder.mockRejectedValue(result.error);

    const state = await updateOrderAction(
      initialFormState,
      updateForm({ addressText: " ", gnr: "12a" }),
    );
    expect(state.fieldErrors.addressText).toBe("Skriv inn adressen.");
    expect(state.fieldErrors.gnr).toBe("Gårdsnummer kan bare ha sifre.");
  });

  it("3.3 ContactNotFoundError gir feltfeil ved kontakten og ingen logg", async () => {
    mocks.core.updateOrder.mockRejectedValue(new ContactNotFoundError());
    const state = await updateOrderAction(
      initialFormState,
      updateForm({ orderedByContactId: CONTACT_ID }),
    );
    expect(state.fieldErrors.orderedByContactId).toBe("Kontakten finnes ikke.");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("3.3 kontakt-id som ikke er uuid gir feltfeil uten kall til kjernen", async () => {
    const state = await updateOrderAction(
      initialFormState,
      updateForm({ orderedByContactId: "ikke-en-id" }),
    );
    expect(state.fieldErrors.orderedByContactId).toBe("Kontakten finnes ikke.");
    expect(coreCalls()).toBe(0);
  });

  it.each(["", "   ", "i går", "2026-13-40T25:00"])(
    "3.3 mottatt «%s» gir «Skriv inn dato og klokkeslett.» ved feltet uten kall",
    async (receivedAt) => {
      const state = await updateOrderAction(initialFormState, updateForm({ receivedAt }));
      expect(state.fieldErrors.receivedAt).toBe("Skriv inn dato og klokkeslett.");
      expect(coreCalls()).toBe(0);
    },
  );

  it("3.3 skjemaverdiene står igjen i svaret ved feil", async () => {
    mocks.core.updateOrder.mockRejectedValue(new OrderChangedError());
    const state = await updateOrderAction(initialFormState, updateForm());
    expect(JSON.stringify(state)).toContain(NEW_ADDRESS);
  });

  it("3.4 loggeren får aldri skjemaverdier (adresse, bestiller, matrikkel) ved ukjent feil", async () => {
    const boom = new Error(`databasen sa nei til ${NEW_ADDRESS}`);
    boom.name = "OppdiktetFeil";
    mocks.core.updateOrder.mockRejectedValue(boom);

    const state = await updateOrderAction(
      initialFormState,
      updateForm({ housingAssociationName: "Testtoppen borettslag", snr: "9" }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).toContain(actor.id);
    for (const value of [
      NEW_ADDRESS,
      "Prøvegata",
      ORDERED_BY,
      "Testmegleren",
      EXTERNAL_REF,
      "Testtoppen",
      `"gnr"`,
      `"bnr"`,
    ]) {
      expect(logged).not.toContain(value);
    }
  });

  it.each(["", "abc", "1.5", "-1", "1e3", " 2 x"])(
    "3.5 rowVersion «%s» som ikke er et heltall gir meldingen om endret ordre, ikke 500, uten kall",
    async (rowVersion) => {
      const state = await updateOrderAction(initialFormState, updateForm({ rowVersion }));
      expect(state.message).toBe(ORDER_CHANGED);
      expect(state.message).not.toBe(UNKNOWN_ERROR);
      expect(coreCalls()).toBe(0);
    },
  );

  it("3.5 rowVersion mangler helt gir meldingen om endret ordre uten kall", async () => {
    const data = updateForm();
    data.delete("rowVersion");
    const state = await updateOrderAction(initialFormState, data);
    expect(state.message).toBe(ORDER_CHANGED);
    expect(coreCalls()).toBe(0);
  });
});
