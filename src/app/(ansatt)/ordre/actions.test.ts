import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { orderInputSchema, rejectReasonSchema } from "@/core/orders";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR } from "../form-state";

/*
 * Server actions i /ordre (testplan docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 7,
 * med runde 1 og 2). Kjernen og `getEmployeeContext` er byttet ut her, som i
 * admin/actions.test.ts; kjernen testes i src/core/orders. Testene viser at organisasjonen kommer
 * fra serveren, at id-er sjekkes før kjernen kalles, at feilene står ved feltet med kortets
 * tekster, og at en ukjent feil logges uten skjemaverdier. Testdata er oppdiktet.
 * Støtter hovedmål: tid (feilen står ved feltet) og reklamasjoner (ingen personopplysninger i
 * loggen, aldri en annen organisasjon).
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
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orders")>()),
  ...mocks.core,
}));

const { convertOrderAction, createOrderAction, rejectOrderAction } = await import("./actions");
const { OfficeNotFoundError, OrderAlreadyHandledError } = await import("@/core/orders");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ORDER = "0190a000-0000-7000-8000-000000000040";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const actor = { id: "user-office", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

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

const NOW = new Date("2026-11-03T10:00:00Z");

/** En ekte ZodError fra kjernens skjema, som kjernen ville kastet. */
function zodErrorFor(input: Record<string, unknown>) {
  const result = orderInputSchema(NOW).safeParse(input);
  if (result.success) throw new Error("skjemaet skulle feilet");
  return result.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: OFFICE,
  });
});

describe("7.1 uten ansattkontekst", () => {
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
  ])("%s svarer «ingen tilgang» uten kall til kjernen", async (_name, run) => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await run();
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });
});

describe("7.2 organisasjonen kommer fra konteksten, aldri fra skjemaet", () => {
  it("createOrderAction kaller kjernen med ORG selv om skjemaet sender en annen", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER });
    await expect(
      createOrderAction(
        initialFormState,
        form({ addressText: ADDRESS, organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow(`REDIRECT /ordre/${ORDER}`);
    expect(mocks.core.createOrder).toHaveBeenCalledWith(actor, ORG, expect.any(Object));
    expect(JSON.stringify(mocks.core.createOrder.mock.calls)).not.toContain(OTHER_ORG);
  });

  it("rejectOrderAction og convertOrderAction kaller kjernen med ORG", async () => {
    mocks.core.rejectOrder.mockResolvedValue({ id: ORDER });
    mocks.core.convertOrderToAssignment.mockResolvedValue({ order: { id: ORDER } });
    await expect(
      rejectOrderAction(
        initialFormState,
        form({ orderId: ORDER, reason: REASON, organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow("REDIRECT");
    await expect(
      convertOrderAction(
        initialFormState,
        form({ orderId: ORDER, officeId: OFFICE, organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.core.rejectOrder).toHaveBeenCalledWith(actor, ORG, ORDER, REASON);
    expect(mocks.core.convertOrderToAssignment).toHaveBeenCalledWith(actor, ORG, ORDER, {
      officeId: OFFICE,
    });
    expect(JSON.stringify(mocks.core.rejectOrder.mock.calls)).not.toContain(OTHER_ORG);
    expect(JSON.stringify(mocks.core.convertOrderToAssignment.mock.calls)).not.toContain(OTHER_ORG);
  });
});

describe("7.3 createOrderAction", () => {
  it("sender feltene til kjernen, aldri source eller rapporttype, og går til ordresiden", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER });
    await expect(
      createOrderAction(
        initialFormState,
        form({
          addressText: `  ${ADDRESS} `,
          orderedByText: ORDERED_BY,
          gnr: "12",
          bnr: "34",
          snr: "",
          housingAssociationName: "Testtoppen borettslag",
          externalRef: "TEST-ORD-0001",
          sellerDeclarationReceived: "on",
          source: "email",
          requestedReportType: "bolig",
        }),
      ),
    ).rejects.toThrow(`REDIRECT /ordre/${ORDER}`);

    const input = mocks.core.createOrder.mock.calls[0]![2] as Record<string, unknown>;
    expect(input).toMatchObject({
      addressText: ADDRESS,
      orderedByText: ORDERED_BY,
      gnr: "12",
      bnr: "34",
      housingAssociationName: "Testtoppen borettslag",
      externalRef: "TEST-ORD-0001",
      sellerDeclarationReceived: true,
    });
    expect(input.snr ?? null).toBeNull();
    expect(input).not.toHaveProperty("source");
    expect(input).not.toHaveProperty("requestedReportType");
  });

  it("uten avkrysning sendes egenerklæring som nei", async () => {
    mocks.core.createOrder.mockResolvedValue({ id: ORDER });
    await expect(
      createOrderAction(initialFormState, form({ addressText: ADDRESS })),
    ).rejects.toThrow("REDIRECT");
    const input = mocks.core.createOrder.mock.calls[0]![2] as Record<string, unknown>;
    expect(input.sellerDeclarationReceived ?? false).toBe(false);
  });

  it("ZodError fra kjernen gir feil ved feltene med kortets tekster", async () => {
    mocks.core.createOrder.mockRejectedValue(
      zodErrorFor({
        addressText: "",
        gnr: "12a",
        bnr: "3 4",
        snr: "-1",
        orderedByText: "Ola 12345678901",
        receivedAt: "2026-11-03T10:01:00.000Z",
      }),
    );
    const state = await createOrderAction(
      initialFormState,
      form({ addressText: "", gnr: "12a", orderedByText: "Ola 12345678901" }),
    );
    expect(state.fieldErrors).toMatchObject({
      addressText: "Skriv inn adressen.",
      gnr: "Gårdsnummer kan bare ha sifre.",
      bnr: "Bruksnummer kan bare ha sifre.",
      snr: "Seksjonsnummer kan bare ha sifre.",
      orderedByText: "Fødselsnummer skal ikke lagres her.",
      receivedAt: "Mottatt kan ikke være frem i tid.",
    });
    // Verdiene står igjen i skjemaet
    expect(state.values.gnr).toBe("12a");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("mottatt i feil format stoppes ved feltet uten kall til kjernen", async () => {
    const state = await createOrderAction(
      initialFormState,
      form({ addressText: ADDRESS, receivedAt: "i går" }),
    );
    expect(state.fieldErrors.receivedAt).toBeTruthy();
    expect(coreCalls()).toBe(0);
  });

  it("AccessDeniedError fra kjernen gir «ingen tilgang»", async () => {
    mocks.core.createOrder.mockRejectedValue(new AccessDeniedError());
    const state = await createOrderAction(initialFormState, form({ addressText: ADDRESS }));
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ukjent feil gir UNKNOWN_ERROR og en logglinje uten adresse, bestiller eller matrikkel", async () => {
    mocks.core.createOrder.mockRejectedValue(new TypeError(`krasj med ${ADDRESS}`));
    const state = await createOrderAction(
      initialFormState,
      form({
        addressText: ADDRESS,
        orderedByText: ORDERED_BY,
        gnr: "999",
        housingAssociationName: "Testtoppen borettslag",
      }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const [, fields] = mocks.logError.mock.calls[0]! as [string, Record<string, unknown>];
    expect(fields).toMatchObject({ userId: actor.id, errorName: "TypeError" });
    expect(String(fields.route)).toMatch(/^\/ordre/);
    for (const value of Object.values(fields)) expect(typeof value).toBe("string");
    const line = JSON.stringify(mocks.logError.mock.calls);
    for (const secret of [ADDRESS, "Testveien", ORDERED_BY, "Testesen", "999", "Testtoppen"]) {
      expect(line).not.toContain(secret);
    }
  });
});

describe("7.4 rejectOrderAction", () => {
  it("tom grunn gir «Skriv inn en grunn.» uten kall til kjernen", async () => {
    const state = await rejectOrderAction(initialFormState, form({ orderId: ORDER, reason: "  " }));
    expect(state.fieldErrors.reason).toBe("Skriv inn en grunn.");
    expect(coreCalls()).toBe(0);
  });

  it("OrderAlreadyHandledError gir «Ordren er allerede behandlet.»", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON }),
    );
    expect(state.message).toBe("Ordren er allerede behandlet.");
  });

  it("ZodError fra kjernen (fødselsnummer i grunnen) står ved feltet «Grunn»", async () => {
    const result = rejectReasonSchema.safeParse("Ola 12345678901");
    mocks.core.rejectOrder.mockRejectedValue(result.error);
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: "Ola 12345678901" }),
    );
    expect(state.fieldErrors.reason).toBe("Fødselsnummer skal ikke lagres her.");
  });

  it.each(["ikke-en-id", "", "1 or 1=1", "../x"])(
    "ordre-id «%s» som ikke er uuid gir «ingen tilgang» uten kall",
    async (orderId) => {
      const state = await rejectOrderAction(initialFormState, form({ orderId, reason: REASON }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it("suksess går tilbake til ordresiden", async () => {
    mocks.core.rejectOrder.mockResolvedValue({ id: ORDER });
    await expect(
      rejectOrderAction(initialFormState, form({ orderId: ORDER, reason: REASON })),
    ).rejects.toThrow(`REDIRECT /ordre/${ORDER}`);
  });

  it("ukjent feil logges uten grunnen", async () => {
    mocks.core.rejectOrder.mockRejectedValue(new Error(REASON));
    const state = await rejectOrderAction(
      initialFormState,
      form({ orderId: ORDER, reason: REASON }),
    );
    expect(state.message).toBe(UNKNOWN_ERROR);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(mocks.logError.mock.calls);
    expect(line).not.toContain(REASON);
    expect(line).not.toContain("Testmegleren");
    expect(line).toContain(ORDER);
  });
});

describe("7.5 convertOrderAction", () => {
  it("mangler kontor gir melding ved feltet uten kall", async () => {
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: "" }),
    );
    expect(state.fieldErrors.officeId).toBeTruthy();
    expect(coreCalls()).toBe(0);
  });

  it("OfficeNotFoundError gir «Kontoret finnes ikke.» ved feltet", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new OfficeNotFoundError());
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(state.fieldErrors.officeId).toBe("Kontoret finnes ikke.");
  });

  it("OrderAlreadyHandledError gir «Ordren er allerede behandlet.»", async () => {
    mocks.core.convertOrderToAssignment.mockRejectedValue(new OrderAlreadyHandledError());
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: ORDER, officeId: OFFICE }),
    );
    expect(state.message).toBe("Ordren er allerede behandlet.");
  });

  it("ordre-id som ikke er uuid gir «ingen tilgang» uten kall", async () => {
    const state = await convertOrderAction(
      initialFormState,
      form({ orderId: "ikke-en-id", officeId: OFFICE }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(coreCalls()).toBe(0);
  });

  it("suksess går til ordresiden, der nummeret vises", async () => {
    mocks.core.convertOrderToAssignment.mockResolvedValue({
      assignment: {
        id: "a",
        number: "2026-00001",
        officeId: OFFICE,
        status: "ordered",
        orderId: ORDER,
      },
      order: { id: ORDER },
    });
    await expect(
      convertOrderAction(initialFormState, form({ orderId: ORDER, officeId: OFFICE })),
    ).rejects.toThrow(`REDIRECT /ordre/${ORDER}`);
  });
});
