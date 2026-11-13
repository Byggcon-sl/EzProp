import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { OrderChangedError } from "@/core/orders";
import { OfficeNotFoundError, OrderAlreadyHandledError } from "@/core/orders/errors";
import { orderInputSchema } from "@/core/orders/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";
import { initialOrderEditState } from "./order-form-error";

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
  logWarn: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: mocks.logWarn, info: vi.fn() },
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
 * «Endre ordren» (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 3.3 og 10). Kjernen er
 * byttet ut; `updateOrder` testes i src/core/orders. Støtter hovedmål: de ansatte (ingenting som
 * er skrevet går tapt) og færre reklamasjoner (aldri verdier i loggen, aldri feil organisasjon).
 */
describe("10 updateOrderAction", () => {
  const CONTACT_ID = "0190a000-0000-7000-8000-000000000090";
  const FOREIGN_FIRM = "0190a000-0000-7000-8000-000000000091";
  const MARKERS = {
    addressText: "MARKOR-ADR-91c2 1",
    orderedByText: "MARKOR-NAVN-91c2",
    externalRef: "MARKOR-REF-91c2",
    housingAssociationName: "MARKOR-BRL-91c2",
    gnr: "9173",
  };

  function editForm(overrides: Record<string, string> = {}) {
    return form({
      orderId: ORDER,
      rowVersion: "3",
      receivedAtInitial: "2026-11-04T10:30",
      receivedAt: "2026-11-04T10:30",
      ...MARKERS,
      ...overrides,
    });
  }

  function loggedText() {
    return JSON.stringify([mocks.logError.mock.calls, mocks.logWarn.mock.calls]);
  }

  it.each(["ikke-en-id", "1 or 1=1", "", "../x"])(
    "10.1 ordre-id «%s» som ikke er uuid gir NO_ACCESS uten kall til kjernen",
    async (orderId) => {
      const state = await updateOrderAction(initialOrderEditState, editForm({ orderId }));
      expect(state.message).toBe(NO_ACCESS);
      expect(state.code).toBe("NO_ACCESS");
      expect(coreCalls()).toBe(0);
    },
  );

  it("uten kontekst gir NO_ACCESS uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await updateOrderAction(initialOrderEditState, editForm());
    expect(state.code).toBe("NO_ACCESS");
    expect(coreCalls()).toBe(0);
  });

  it("kjernen får organisasjonen fra konteksten, ordre-id og rowVersion som tall", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(initialOrderEditState, editForm({ organizationId: OTHER_ORG }));
    expect(mocks.core.updateOrder).toHaveBeenCalledWith(actor, ORG, ORDER, expect.anything(), 3);
    expect(JSON.stringify(mocks.core.updateOrder.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("suksess: revalidatePath, tilstand som lukker skjemaet, ingen videresending", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    const state = await updateOrderAction(initialOrderEditState, editForm());
    expect(state.saved).toBe(true);
    expect(state.code).toBeNull();
    expect(state.message).toBeNull();
    expect(state.values).toEqual({});
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/ordre/${ORDER}`);
  });

  it("tomme valgfrie felt sendes som null, slik at de kan tømmes", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(
      initialOrderEditState,
      editForm({
        externalRef: "",
        orderedByText: "  ",
        gnr: "",
        bnr: "",
        snr: "",
        housingAssociationName: "",
        orderedByContactId: "",
      }),
    );
    const input = mocks.core.updateOrder.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(input).toMatchObject({
      addressText: MARKERS.addressText,
      externalRef: null,
      orderedByText: null,
      gnr: null,
      bnr: null,
      snr: null,
      housingAssociationName: null,
      orderedByContactId: null,
      sellerDeclarationReceived: false,
    });
  });

  it.each([
    ["tom", ""],
    ["uendret", "2026-11-04T10:30"],
  ])("%s receivedAt sendes som udefinert (kjernen beholder verdien)", async (_n, receivedAt) => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(initialOrderEditState, editForm({ receivedAt }));
    const input = mocks.core.updateOrder.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(input.receivedAt).toBeUndefined();
  });

  it("endret receivedAt sendes som ISO-tidspunkt regnet i norsk tid", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(initialOrderEditState, editForm({ receivedAt: "2026-11-03T08:15" }));
    const input = mocks.core.updateOrder.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(input.receivedAt).toBe("2026-11-03T07:15:00.000Z");
  });

  it("ugyldig receivedAt gir feil ved feltet uten kall", async () => {
    const state = await updateOrderAction(initialOrderEditState, editForm({ receivedAt: "i går" }));
    expect(state.fieldErrors.receivedAt).toBeTruthy();
    expect(coreCalls()).toBe(0);
  });

  it("orderedByFirmId fra skjemaet sendes aldri til kjernen", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(
      initialOrderEditState,
      editForm({ orderedByContactId: CONTACT_ID, orderedByFirmId: FOREIGN_FIRM }),
    );
    const input = mocks.core.updateOrder.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(input).not.toHaveProperty("orderedByFirmId");
    expect(JSON.stringify(mocks.core.updateOrder.mock.calls)).not.toContain(FOREIGN_FIRM);
    expect(input.orderedByContactId).toBe(CONTACT_ID);
  });

  it.each(["abc", "1 or 1=1"])(
    "kontakt-id «%s» som ikke er uuid gir feil ved feltet uten kall",
    async (orderedByContactId) => {
      const state = await updateOrderAction(
        initialOrderEditState,
        editForm({ orderedByContactId }),
      );
      expect(state.fieldErrors.orderedByContactId).toBe("Kontakten finnes ikke.");
      expect(coreCalls()).toBe(0);
    },
  );

  it.each(["", "abc", "-1", "1.5"])(
    "rowVersion «%s» som ikke er et heltall gir ORDER_CHANGED uten kall",
    async (rowVersion) => {
      const state = await updateOrderAction(initialOrderEditState, editForm({ rowVersion }));
      expect(state.code).toBe("ORDER_CHANGED");
      expect(coreCalls()).toBe(0);
    },
  );

  function zodError() {
    const result = orderInputSchema(new Date()).safeParse({ addressText: " ", gnr: "12a" });
    if (result.success) throw new Error("skulle feilet");
    return result.error;
  }
  function dbError() {
    const error = new Error(`databasen sa nei til ${MARKERS.addressText}`);
    error.name = "OppdiktetFeil";
    return error;
  }

  type Branch = {
    name: string;
    error: () => Error;
    check: (state: Awaited<ReturnType<typeof updateOrderAction>>) => void;
  };
  const branches: Branch[] = [
    {
      name: "AccessDeniedError → NO_ACCESS",
      error: () => new AccessDeniedError(),
      check: (state) => {
        expect(state.message).toBe(NO_ACCESS);
        expect(state.code).toBe("NO_ACCESS");
      },
    },
    {
      name: "OrderChangedError → ORDER_CHANGED med norsk melding",
      error: () => new OrderChangedError(),
      check: (state) => {
        expect(state.code).toBe("ORDER_CHANGED");
        expect(state.message).toBe("Ordren er endret av en annen. Last siden på nytt.");
      },
    },
    {
      name: "ContactNotFoundError → feil ved feltet",
      error: () => new ContactNotFoundError(),
      check: (state) => {
        expect(state.fieldErrors.orderedByContactId).toBe("Kontakten finnes ikke.");
        expect(state.code).toBeNull();
      },
    },
    {
      name: "Zod-feil → meldinger per felt",
      error: zodError,
      check: (state) => {
        expect(state.fieldErrors.addressText).toBe("Skriv inn adressen.");
        expect(state.fieldErrors.gnr).toBe("Gårdsnummer kan bare ha sifre.");
        expect(state.code).toBeNull();
      },
    },
    {
      name: "databasefeil → UNKNOWN",
      error: dbError,
      check: (state) => {
        expect(state.message).toBe(UNKNOWN_ERROR);
        expect(state.code).toBe("UNKNOWN");
      },
    },
  ];

  it.each(branches)("10.2 $name", async ({ error, check }) => {
    mocks.core.updateOrder.mockRejectedValue(error());
    const state = await updateOrderAction(
      initialOrderEditState,
      editForm({ orderedByContactId: CONTACT_ID }),
    );
    check(state);
    expect(state.saved).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(branches)("10.3 $name: alle innsendte verdier står i tilstanden", async ({ error }) => {
    mocks.core.updateOrder.mockRejectedValue(error());
    const state = await updateOrderAction(
      initialOrderEditState,
      editForm({ orderedByContactId: CONTACT_ID, sellerDeclarationReceived: "on" }),
    );
    expect(state.values).toMatchObject({
      ...MARKERS,
      receivedAt: "2026-11-04T10:30",
      orderedByContactId: CONTACT_ID,
      sellerDeclarationReceived: "on",
    });
    expect(state.attempt).toBe(1);
  });

  it.each(branches)("3.3 $name: ingen verdier fra skjemaet i loggen", async ({ error }) => {
    mocks.core.updateOrder.mockRejectedValue(error());
    await updateOrderAction(initialOrderEditState, editForm({ orderedByContactId: CONTACT_ID }));
    const logged = loggedText();
    for (const marker of Object.values(MARKERS)) expect(logged).not.toContain(marker);
    expect(logged).not.toContain("MARKOR");
  });

  it("3.3 konflikt og ukjent feil logges med ordre-id, bruker-id og feilkode", async () => {
    mocks.core.updateOrder.mockRejectedValueOnce(new OrderChangedError());
    await updateOrderAction(initialOrderEditState, editForm());
    mocks.core.updateOrder.mockRejectedValueOnce(dbError());
    await updateOrderAction(initialOrderEditState, editForm());
    const logged = loggedText();
    expect(logged).toContain(ORDER);
    expect(logged).toContain(actor.id);
    expect(logged).toContain("ORDER_CHANGED");
    expect(logged).toContain("OppdiktetFeil");
  });

  it("3.3 suksess logger ingen verdier", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER });
    await updateOrderAction(initialOrderEditState, editForm());
    expect(loggedText()).not.toContain("MARKOR");
  });
});

/*
 * Ingen lokal lagring av skjemaverdier, og ikke ordet for rapportversjon 2 på ordresiden
 * (testplanen 10.7 og 11.9, statisk).
 */
describe("10.7 statisk: filene for ordresiden", () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "[id]");
  const files = readdirSync(dir).filter(
    (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts"),
  );
  const forbidden = [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "IndexedDB",
    "pushState",
    "replaceState",
  ];

  it("finner filene", () => {
    expect(files).toEqual(expect.arrayContaining(["order-edit-form.tsx", "page.tsx"]));
  });

  it.each(files)("%s nevner ikke lokal lagring eller endring av adressen", (name) => {
    const text = readFileSync(path.join(dir, name), "utf8");
    for (const word of forbidden) expect(text, `${name} nevner ${word}`).not.toContain(word);
  });

  it.each(files)("%s bruker ikke ordet «Rettet»", (name) => {
    const text = readFileSync(path.join(dir, name), "utf8");
    expect(text).not.toMatch(/Rettet/);
  });
});
