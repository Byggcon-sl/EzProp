import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import {
  OfferValidUntilLockedError,
  OfficeNotFoundError,
  OrderAlreadyHandledError,
  OrderChangedError,
} from "@/core/orders/errors";
import { orderInputSchema } from "@/core/orders/schemas";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../form-state";

/*
 * Server actions i /tilbud (docs/funksjoner/fase2a-tilbud-testplan.md avsnitt 4.1 og 7.1, og
 * docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 7, med
 * runde 1: ukjent feil logges uten skjemaverdier). Kjernen og konteksten er byttet ut her; de
 * testes i src/core/orders og employee-context.test.ts. Testene viser at hver handling henter
 * organisasjonen på serveren, sjekker id-er før kjernen kalles, og gir de faste meldingene.
 *
 * Feltnavn i skjemaet: addressText, gnr …, validUntil, orderId, reasonKey, reasonText, officeId.
 * Støtter hovedmål: tid (feil vises ved feltet) og reklamasjoner (aldri feil organisasjon,
 * aldri adresse eller grunn i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  core: {
    createOrder: vi.fn(),
    rejectOrder: vi.fn(),
    convertOrderToAssignment: vi.fn(),
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    updateOrder: vi.fn(),
    listOrderHistory: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: {
    error: mocks.logError,
    warn: mocks.logWarn,
    info: mocks.logInfo,
    debug: mocks.logDebug,
  },
}));
vi.mock("../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orders")>()),
  ...mocks.core,
}));

const {
  createOfferAction: createOrderAction,
  rejectOfferAction: rejectOrderAction,
  convertOfferAction: convertOrderAction,
  updateOfferAction: updateOrderAction,
  extendOfferAction,
} = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ORDER = "0190a000-0000-7000-8000-000000000040";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const ADDRESS = "Testveien 12, 8000 Bodø";
const ORDERED_BY = "Megler Testesen, Testmegleren AS";
const REASON = "Feil registrering hos Testmegleren";

type OfferState = FormState & { notice?: string | null; done?: boolean };

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
      () =>
        rejectOrderAction(
          initialFormState,
          form({ orderId: ORDER, reasonKey: "other", reasonText: REASON }),
        ),
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
      form({ orderId: ORDER, reasonKey: "other", reasonText: REASON, organizationId: OTHER_ORG }),
    ).catch(() => undefined);
    await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE, organizationId: OTHER_ORG }),
    ).catch(() => undefined);

    expect(mocks.core.rejectOrder).toHaveBeenCalledWith(actor, ORG, ORDER, {
      reasonKey: "other",
      reasonText: REASON,
    });
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

  it("suksess sender videre til /tilbud/<id> med kvitteringen «Tilbudet er laget.» (A373)", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    const url = await redirectOf(
      createOrderAction(
        initialFormState,
        form({ addressText: ADDRESS, gnr: "12", bnr: "34", sellerDeclarationReceived: "on" }),
      ),
    );
    expect(url).toBe(`/tilbud/${ORDER}?ny=1`);
    const input = mocks.core.createOrder.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(input).toMatchObject({ addressText: ADDRESS, gnr: "12", bnr: "34" });
    // Tom «Gyldig til» gir null: kjernen bruker i dag + 30.
    expect(input.validUntil).toBeNull();
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

describe("7.4 rejectOfferAction (F4: faste grunner)", () => {
  it("uten valg gir «Velg en grunn.» ved gruppen uten kall til kjernen, og teksten står igjen", async () => {
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reasonText: REASON }),
    );
    expect(state.fieldErrors.reasonKey).toBe("Velg en grunn.");
    expect(state.values.reasonText).toBe(REASON);
    expect(coreCalls()).toBe(0);
  });

  it.each(["pris", "expired'--", "PRICE"])(
    "ukjent grunn «%s» gir «Velg en grunn.» uten kall",
    async (reasonKey) => {
      const state = await rejectOrderAction(initialFormState, form({ orderId: ORDER, reasonKey }));
      expect(state.fieldErrors.reasonKey).toBe("Velg en grunn.");
      expect(coreCalls()).toBe(0);
    },
  );

  it.each(["", "   "])(
    "«Annet» med tom tekst «%s» gir «Skriv grunnen.» ved feltet uten kall",
    async (reasonText) => {
      const state = await rejectOrderAction(
        initialFormState,
        form({ orderId: ORDER, reasonKey: "other", reasonText }),
      );
      expect(state.fieldErrors.reasonText).toBe("Skriv grunnen.");
      expect(state.values.reasonKey).toBe("other");
      expect(coreCalls()).toBe(0);
    },
  );

  it("«Pris» uten tekst sendes med reasonText = null, uten videresending", async () => {
    mocks.core.rejectOrder.mockResolvedValue({ id: ORDER, status: "rejected" });
    const state = (await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reasonKey: "price", reasonText: "  " }),
    )) as OfferState;
    expect(mocks.core.rejectOrder).toHaveBeenCalledWith(actor, ORG, ORDER, {
      reasonKey: "price",
      reasonText: null,
    });
    expect(state.done).toBe(true);
    expect(state.message).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("OrderAlreadyHandledError gir «Tilbudet er allerede gjort om eller avslått.»", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reasonKey: "timing" }),
    );
    expect(allMessages(state)).toContain("Tilbudet er allerede gjort om eller avslått.");
  });

  it.each(["ikke-en-id", "1 or 1=1", "", "../x"])(
    "tilbud-id «%s» som ikke er uuid gir «ingen tilgang» uten kall",
    async (orderId) => {
      const state = await rejectOrderAction(
        initialFormState,
        form({ orderId, reasonKey: "price", reasonText: REASON }),
      );
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it("AccessDeniedError fra kjernen (fremmed id) gir «ingen tilgang»", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new AccessDeniedError());
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reasonKey: "other", reasonText: REASON }),
    );
    expect(state.message).toBe(NO_ACCESS);
  });

  it("ukjent feil logges uten grunnen", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new Error(REASON));
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reasonKey: "other", reasonText: REASON }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(REASON);
    expect(logged).not.toContain("Testmegleren");
  });
});

describe("7.5 convertOrderAction", () => {
  it("mangler kontor gir «Velg kontor.» ved feltet uten kall til kjernen", async () => {
    const state = await convertOrderAction(initialFormState, form({ orderId: ORDER }));
    expect(state.fieldErrors.officeId).toBe("Velg kontor.");
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

  it("OrderAlreadyHandledError gir «Tilbudet er allerede gjort om eller avslått.»", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(allMessages(state)).toContain("Tilbudet er allerede gjort om eller avslått.");
  });

  it("tilbud-id som ikke er uuid gir «ingen tilgang» uten kall", async () => {
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: "ikke-en-id", officeId: OFFICE }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("suksess sender videre til det nye oppdraget med pekeren (F5, ?fra=tilbud)", async () => {
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
    expect(url).toBe(`/oppdrag/${ASSIGNMENT}?fra=tilbud`);
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

  it("valgt kontakt sendes med id-en og friteksten, og man går til tilbudssiden", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER, organizationId: ORG });
    const url = await redirectOf(
      createOrderAction(initialFormState, orderForm({ orderedByContactId: CONTACT_ID })),
    );
    expect(url).toBe(`/tilbud/${ORDER}?ny=1`);
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
 * «Lagre» når tilbudet endres (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 3). Skjemaet
 * sender orderId, rowVersion og feltene fra «Nytt tilbud». Ved suksess gir action-en et svar uten
 * feil med kvitteringen (T-0089: aldri fra adressen).
 * Støtter hovedmål: de ansatte (riktig norsk melding per feil, ingenting går tapt) og færre
 * reklamasjoner (aldri feil organisasjon, aldri verdier i loggen).
 */
describe("3 updateOrderAction", () => {
  const NEW_ADDRESS = "Prøvegata 7, 8006 Bodø";
  const HOUSING = "Testtoppen borettslag";
  const EXTERNAL_REF = "TEST-ORD-0002";
  const CONTACT = "0190a000-0000-7000-8000-000000000060";
  const CONFLICT = "Tilbudet er endret av en annen. Last siden på nytt.";
  const LEAK_VALUES = [
    NEW_ADDRESS,
    "Prøvegata",
    ORDERED_BY,
    "Testmegleren",
    HOUSING,
    "Testtoppen",
    EXTERNAL_REF,
    "98761",
    "43219",
  ];

  function editForm(overrides: Record<string, string> = {}): FormData {
    return form({
      orderId: ORDER,
      rowVersion: "3",
      addressText: NEW_ADDRESS,
      receivedAt: "2026-11-02T09:00",
      externalRef: EXTERNAL_REF,
      orderedByText: ORDERED_BY,
      orderedByContactId: "",
      gnr: "98761",
      bnr: "43219",
      snr: "",
      housingAssociationName: HOUSING,
      ...overrides,
    });
  }

  /** Kjører action-en; videresending gir `null`, ellers svaret. */
  async function run(data: FormData): Promise<FormState | null> {
    try {
      return await updateOrderAction(initialFormState, data);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("REDIRECT ")) return null;
      throw error;
    }
  }

  function allLogged(): string {
    return JSON.stringify([
      mocks.logError.mock.calls,
      mocks.logWarn.mock.calls,
      mocks.logInfo.mock.calls,
      mocks.logDebug.mock.calls,
    ]);
  }

  function expectNoValuesLogged() {
    const logged = allLogged();
    for (const value of LEAK_VALUES) expect(logged, value).not.toContain(value);
  }

  it("3.1 kjernen kalles med organisasjonen fra innloggingen, aldri fra skjemaet", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, rowVersion: 4 });
    const state = await run(editForm({ organizationId: OTHER_ORG }));
    if (state !== null) {
      expect(state.fieldErrors).toEqual({});
      expect(state.message ?? "").not.toBe(UNKNOWN_ERROR);
    }
    expect(mocks.core.updateOrder).toHaveBeenCalledTimes(1);
    const call = mocks.core.updateOrder.mock.calls[0]!;
    expect(call[0]).toEqual(actor);
    expect(call[1]).toBe(ORG);
    expect(call[2]).toBe(ORDER);
    expect(call[4]).toBe(3);
    expect(call[3]).toMatchObject({ addressText: NEW_ADDRESS, gnr: "98761", bnr: "43219" });
    expect(JSON.stringify(mocks.core.updateOrder.mock.calls)).not.toContain(OTHER_ORG);
    expect(call[3]).not.toHaveProperty("organizationId");
  });

  it("3.1 suksess gir kvitteringen «Endringene er lagret.» i svaret, uten videresending (T-0089)", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, rowVersion: 4 });
    const state = (await updateOrderAction(initialFormState, editForm())) as OfferState;
    expect(state.notice).toBe("Endringene er lagret.");
    expect(state.done).toBe(true);
    expect(state.message).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("3.1 uten kontekst gir «ingen tilgang» uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await run(editForm());
    expect(state?.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it.each(["ikke-en-id", "", "../../admin"])(
    "3.2 tilbud-id «%s» gir NO_ACCESS uten kall til kjernen",
    async (orderId) => {
      const state = await run(editForm({ orderId }));
      expect(state?.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it("3.3 AccessDeniedError gir NO_ACCESS", async () => {
    mocks.core.updateOrder.mockRejectedValue(new AccessDeniedError());
    const state = await run(editForm());
    expect(state?.message).toBe(NO_ACCESS);
    expectNoValuesLogged();
  });

  it("3.3 OrderChangedError gir «Tilbudet er endret av en annen. Last siden på nytt.», og det som er skrevet står", async () => {
    mocks.core.updateOrder.mockRejectedValue(new OrderChangedError());
    const state = await run(editForm());
    expect(state?.message).toBe(CONFLICT);
    expect(state?.values.addressText).toBe(NEW_ADDRESS);
    expectNoValuesLogged();
  });

  it("3.3 ZodError gir feil ved feltene", async () => {
    const result = orderInputSchema(new Date()).safeParse({ addressText: " ", gnr: "12a" });
    expect(result.success).toBe(false);
    mocks.core.updateOrder.mockRejectedValue(result.error);

    const state = await run(editForm({ addressText: " ", gnr: "12a" }));
    expect(state?.fieldErrors.addressText).toBe("Skriv inn adressen.");
    expect(state?.fieldErrors.gnr).toBe("Gårdsnummer kan bare ha sifre.");
    expectNoValuesLogged();
  });

  it("3.3 ContactNotFoundError gir feil ved kontakten", async () => {
    mocks.core.updateOrder.mockRejectedValue(new ContactNotFoundError());
    const state = await run(editForm({ orderedByContactId: CONTACT }));
    expect(state?.fieldErrors.orderedByContactId).toBe("Kontakten finnes ikke.");
    expectNoValuesLogged();
  });

  it.each(["abc", "", "1.5", "-1x", "9".repeat(30)])(
    "3.4 rowVersion «%s» fra skjemaet gir konfliktmelding eller feltfeil, ikke unntak",
    async (rowVersion) => {
      mocks.core.updateOrder.mockRejectedValue(new OrderChangedError());
      const state = await run(editForm({ rowVersion }));
      expect(state, "ingen videresending med ugyldig versjon").not.toBeNull();
      const conflict = state?.message === CONFLICT;
      const fieldError = Object.keys(state?.fieldErrors ?? {}).length > 0;
      expect(conflict || fieldError, JSON.stringify(state)).toBe(true);
      expect(state?.message).not.toBe(UNKNOWN_ERROR);
      // Kjernen får aldri noe annet enn et heltall
      for (const call of mocks.core.updateOrder.mock.calls) {
        expect(Number.isInteger(call[4])).toBe(true);
      }
    },
  );

  it("3.5 ukjent feil gir UNKNOWN_ERROR, og ingen gren logger skjemaverdier", async () => {
    const boom = new Error(`databasen sa nei til ${NEW_ADDRESS} og ${HOUSING}`);
    boom.name = "OppdiktetFeil";
    mocks.core.updateOrder.mockRejectedValue(boom);
    const state = await run(editForm());
    expect(state?.message).toBe(UNKNOWN_ERROR);
    expect(allLogged()).toContain("OppdiktetFeil");
    expectNoValuesLogged();
  });
});

/*
 * «Gyldig til» og kvitteringen (T-0089) i «Endre tilbudet» (testplan 4.1.3 og 4.1.4).
 */
describe("4.1 «Gyldig til» og kvitteringen i «Endre tilbudet»", () => {
  function editForm(overrides: Record<string, string> = {}): FormData {
    return form({ orderId: ORDER, rowVersion: "3", addressText: ADDRESS, ...overrides });
  }

  it("datoen sendes til kjernen som «ÅÅÅÅ-MM-DD», tom dato som null (uendret)", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, rowVersion: 4 });
    await updateOrderAction(initialFormState, editForm({ validUntil: "2026-12-24" }));
    await updateOrderAction(initialFormState, editForm({ validUntil: "" }));
    expect(mocks.core.updateOrder.mock.calls[0]?.[3]).toMatchObject({ validUntil: "2026-12-24" });
    expect(mocks.core.updateOrder.mock.calls[1]?.[3]).toMatchObject({ validUntil: null });
  });

  it("OfferValidUntilLockedError står ved datofeltet, og ingen kvittering", async () => {
    mocks.core.updateOrder.mockRejectedValue(new OfferValidUntilLockedError());
    const state = (await updateOrderAction(
      initialFormState,
      editForm({ validUntil: "2026-12-24" }),
    )) as OfferState;
    expect(state.fieldErrors.validUntil).toBe(
      "Gyldig til kan bare endres på åpne og utløpte tilbud.",
    );
    expect(state.notice ?? null).toBeNull();
    expect(state.values.validUntil).toBe("2026-12-24");
  });

  it("feil i datoen fra kjernen (Zod) står ved feltet, og ingen kvittering", async () => {
    const error = new ZodError([
      { code: "custom", path: ["validUntil"], message: "Gyldig til kan ikke være før i dag." },
    ]);
    mocks.core.updateOrder.mockRejectedValue(error);
    const state = (await updateOrderAction(
      initialFormState,
      editForm({ validUntil: "2020-01-01" }),
    )) as OfferState;
    expect(state.fieldErrors.validUntil).toBe("Gyldig til kan ikke være før i dag.");
    expect(state.notice ?? null).toBeNull();
  });

  it("T-0089: lagring som lyktes og så en som feiler, gir bare feilmeldingen", async () => {
    mocks.core.updateOrder.mockResolvedValueOnce({ id: ORDER, rowVersion: 4 });
    const saved = (await updateOrderAction(initialFormState, editForm())) as OfferState;
    expect(saved.notice).toBe("Endringene er lagret.");

    mocks.core.updateOrder.mockRejectedValueOnce(new OrderChangedError());
    const failed = (await updateOrderAction(saved, editForm())) as OfferState;
    expect(failed.message).toBe("Tilbudet er endret av en annen. Last siden på nytt.");
    expect(failed.notice ?? null).toBeNull();
    expect(failed.done ?? false).toBe(false);
  });

  it("T-0089: ingenting endret (samme versjon tilbake) gir ingen kvittering, men skjemaet lukkes", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, rowVersion: 3 });
    const state = (await updateOrderAction(initialFormState, editForm())) as OfferState;
    expect(state.done).toBe(true);
    expect(state.notice).toBeNull();
  });

  it("T-0089: handlingen sender aldri videre med ?endret=1", async () => {
    mocks.core.updateOrder.mockResolvedValue({ id: ORDER, rowVersion: 4 });
    await updateOrderAction(initialFormState, editForm());
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

/*
 * «Forleng 30 dager» (F1, testplan 7.1). Går gjennom `updateOrder` med de lagrede feltene og
 * `validUntil` = i dag + 30.
 */
describe("7.1 extendOfferAction (F1)", () => {
  const STORED = {
    id: ORDER,
    addressText: ADDRESS,
    externalRef: "TEST-1",
    orderedByText: ORDERED_BY,
    orderedByContactId: null,
    gnr: "12",
    bnr: "34",
    snr: null,
    housingAssociationName: null,
    sellerDeclarationReceived: true,
    validUntil: "2026-01-01",
    rowVersion: 5,
  };

  function expectedDate(): string {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    date.setUTCDate(date.getUTCDate() + 30);
    return date.toISOString().slice(0, 10);
  }

  function norwegian(iso: string): string {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }

  it("setter i dag + 30 med de lagrede feltene og versjonen fra skjemaet", async () => {
    mocks.core.getOrder.mockResolvedValue(STORED);
    mocks.core.updateOrder.mockResolvedValue({ ...STORED, rowVersion: 6 });
    const state = (await extendOfferAction(
      initialFormState,
      form({ orderId: ORDER, rowVersion: "5", organizationId: OTHER_ORG }),
    )) as OfferState;

    const call = mocks.core.updateOrder.mock.calls[0]!;
    expect(call[1]).toBe(ORG);
    expect(call[2]).toBe(ORDER);
    expect(call[4]).toBe(5);
    expect(call[3]).toMatchObject({
      addressText: ADDRESS,
      gnr: "12",
      bnr: "34",
      sellerDeclarationReceived: true,
      validUntil: expectedDate(),
    });
    expect(JSON.stringify(mocks.core.updateOrder.mock.calls)).not.toContain(OTHER_ORG);
    expect(state.notice).toBe(`Gyldig til ${norwegian(expectedDate())}.`);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("i listen (uten versjon) brukes den lagrede versjonen, og kvitteringen har adressen (A372)", async () => {
    mocks.core.getOrder.mockResolvedValue(STORED);
    mocks.core.updateOrder.mockResolvedValue({ ...STORED, rowVersion: 6 });
    const state = (await extendOfferAction(
      initialFormState,
      form({ orderId: ORDER, withAddress: "1" }),
    )) as OfferState;
    expect(mocks.core.updateOrder.mock.calls[0]?.[4]).toBe(5);
    expect(state.notice).toBe(`${ADDRESS} er gyldig til ${norwegian(expectedDate())}.`);
  });

  it("andre trykk (OrderChangedError) gir ingen feilmelding, og kvitteringen når datoen er ny", async () => {
    mocks.core.getOrder
      .mockResolvedValueOnce(STORED)
      .mockResolvedValueOnce({ ...STORED, validUntil: expectedDate(), rowVersion: 6 });
    mocks.core.updateOrder.mockRejectedValue(new OrderChangedError());
    const state = (await extendOfferAction(
      initialFormState,
      form({ orderId: ORDER, rowVersion: "5" }),
    )) as OfferState;
    expect(state.message).toBeNull();
    expect(state.fieldErrors).toEqual({});
    expect(state.done).toBe(true);
    expect(state.notice).toBe(`Gyldig til ${norwegian(expectedDate())}.`);
  });

  it("avslått eller gjort om (OfferValidUntilLockedError) gir meldingen over knappen", async () => {
    mocks.core.getOrder.mockResolvedValue(STORED);
    mocks.core.updateOrder.mockRejectedValue(new OfferValidUntilLockedError());
    const state = await extendOfferAction(initialFormState, form({ orderId: ORDER }));
    expect(state.message).toBe("Gyldig til kan bare endres på åpne og utløpte tilbud.");
  });

  it("fremmed eller ukjent tilbud (AccessDeniedError) gir «ingen tilgang»", async () => {
    mocks.core.getOrder.mockRejectedValue(new AccessDeniedError());
    const state = await extendOfferAction(initialFormState, form({ orderId: ORDER }));
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.core.updateOrder).not.toHaveBeenCalled();
  });

  it.each(["ikke-en-id", ""])("tilbud-id «%s» gir «ingen tilgang» uten kall", async (orderId) => {
    const state = await extendOfferAction(initialFormState, form({ orderId }));
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("ukjent feil logges uten adressen", async () => {
    mocks.core.getOrder.mockResolvedValue(STORED);
    mocks.core.updateOrder.mockRejectedValue(new Error(ADDRESS));
    const state = await extendOfferAction(initialFormState, form({ orderId: ORDER }));
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(ADDRESS);
  });
});

/* Testplan 4.1.5: ingen tilgangslogikk i handlingene utover kall til kjernen. */
describe("4.1.5 ingen tilgangslogikk i handlingene", () => {
  it("actions.ts sjekker ikke roller og bruker aldri organizationId fra skjemaet", () => {
    const source = readFileSync(path.join(__dirname, "actions.ts"), "utf8");
    expect(source).not.toMatch(/roles\.includes/);
    expect(source).not.toMatch(/formData\.get\(["']organizationId["']\)/);
    expect(source).not.toMatch(/requireOrganizationAccess/);
  });
});
