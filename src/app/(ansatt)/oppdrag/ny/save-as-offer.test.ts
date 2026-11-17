import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import { ContactNotFoundError } from "@/core/contacts";
import { initialFormState, NO_ACCESS } from "../../form-state";
import { ORDER_OFFLINE_MESSAGE } from "../../order-values";
import {
  ASSIGNMENT_OFFLINE_MESSAGE,
  OFFER_UNKNOWN_ERROR,
  SAVE_AS_OFFER_INTENT,
  SAVE_INTENT_FIELD,
} from "./assignment-values";

/*
 * «Lagre som tilbud i stedet» på «Nytt oppdrag» (docs/funksjoner/fase2a-tilbud.md F2 a, A363;
 * testplan 7.2.1–7.2.4 og 3.9/3.10 for F2 a). Kjernen og konteksten er byttet ut; `createOrder`
 * testes mot databasen i src/core/orders. Testene viser at bestillingsfeltene følger med, at
 * felt som bare gjelder oppdraget ikke gjør det, at organisasjonen alltid kommer fra serveren, at
 * «Gyldig til» er i dag + 30, at adressen etter lagring bare har id-en, og at feil gir skjemaet
 * tilbake med det som er skrevet. Oppdiktede verdier.
 * Støtter hovedmål: de ansatte (ingenting skrives to ganger) og færre reklamasjoner (aldri feil
 * organisasjon, ingen persondata i adressen eller loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  createOrder: vi.fn(),
  createAssignment: vi.fn(),
  findPossibleDuplicatesFor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: vi.fn(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/oppdrag/ny",
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orders")>()),
  createOrder: mocks.createOrder,
}));
vi.mock("@/core/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/assignments")>()),
  createAssignment: mocks.createAssignment,
  findPossibleDuplicatesFor: mocks.findPossibleDuplicatesFor,
}));

const { saveAsOfferAction, findDraftDuplicatesAction } = await import("./actions");
const { AssignmentForm, offlineState } = await import("./assignment-form");

const ORG = "0190a000-0000-7000-8000-000000000001";
const FOREIGN_ORG = "0190a000-0000-7000-8000-0000000000ff";
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const INSPECTOR = "0190a000-0000-7000-8000-000000000031";
const CONTACT = "0190a000-0000-7000-8000-000000000032";
const OFFER = "0190a000-0000-7000-8000-000000000040";
const KEY = "0190a000-0000-7000-8000-000000000060";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };
const ADDRESS = "MERKE-ADR-T2A Testveien 12, 8000 Bodø";
const ORDERED_BY = "MERKE-BEST-T2A Megler Testesen";

/** 16.11.2026 kl. 23:30 UTC er 17.11.2026 i norsk tid: dagen regnes i norsk tid. */
const NOW = new Date("2026-11-16T23:30:00Z");

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

/** Hele skjemaet «Nytt oppdrag» slik nettleseren sender det med «Lagre som tilbud i stedet». */
function filledForm(extra: Record<string, string> = {}) {
  return form({
    creationKey: KEY,
    addressText: ADDRESS,
    gnr: "9999",
    bnr: "123",
    snr: "",
    orderedByContactId: CONTACT,
    orderedByText: ORDERED_BY,
    inspectionAt: "2026-11-20T10:00",
    officeId: OFFICE,
    responsibleEmployeeId: INSPECTOR,
    receivedAt: "2026-11-16T09:12",
    externalRef: "55-1234",
    housingAssociationName: "Testlaget borettslag",
    [SAVE_INTENT_FIELD]: SAVE_AS_OFFER_INTENT,
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.createOrder.mockResolvedValue({ id: OFFER });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveAsOfferAction (F2 a)", () => {
  it("lager tilbudet med bestillingsfeltene og gyldig til i dag + 30, og går til tilbudet med ?ny=1", async () => {
    const url = await redirectOf(saveAsOfferAction(initialFormState, filledForm()));
    expect(url).toBe(`/tilbud/${OFFER}?ny=1`);
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    expect(mocks.createAssignment).not.toHaveBeenCalled();

    const [calledActor, organizationId, input, now] = mocks.createOrder.mock.calls[0]!;
    expect(calledActor).toBe(actor);
    expect(organizationId).toBe(ORG);
    expect(now).toEqual(NOW);
    expect(input).toEqual({
      addressText: ADDRESS,
      gnr: "9999",
      bnr: "123",
      snr: undefined,
      orderedByContactId: CONTACT,
      orderedByText: ORDERED_BY,
      receivedAt: "2026-11-16T09:12",
      externalRef: "55-1234",
      housingAssociationName: "Testlaget borettslag",
      // 17.11.2026 i norsk tid + 30 dager
      validUntil: "2026-12-17",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tilbud");
  });

  it("felt som bare gjelder oppdraget (takstmann, befaringsdato, kontor, engangsnøkkel) følger ikke med", async () => {
    await redirectOf(saveAsOfferAction(initialFormState, filledForm()));
    const input = mocks.createOrder.mock.calls[0]![2] as Record<string, unknown>;
    for (const key of [
      "responsibleEmployeeId",
      "inspectionAt",
      "officeId",
      "creationKey",
      SAVE_INTENT_FIELD,
    ]) {
      expect(input).not.toHaveProperty(key);
    }
    const sent = JSON.stringify(input);
    expect(sent).not.toContain(INSPECTOR);
    expect(sent).not.toContain(OFFICE);
    expect(sent).not.toContain("2026-11-20T10:00");
  });

  it("organisasjon, status, kilde og firma fra skjemaet leses aldri; organisasjonen kommer fra serveren", async () => {
    await redirectOf(
      saveAsOfferAction(
        initialFormState,
        filledForm({
          organizationId: FOREIGN_ORG,
          status: "converted",
          source: "email",
          orderedByFirmId: "0190a000-0000-7000-8000-0000000000fe",
          validUntil: "2030-01-01",
        }),
      ),
    );
    const [, organizationId, input] = mocks.createOrder.mock.calls[0]!;
    expect(organizationId).toBe(ORG);
    for (const key of ["organizationId", "status", "source", "orderedByFirmId"]) {
      expect(input).not.toHaveProperty(key);
    }
    // «Gyldig til» settes på serveren, ikke fra et innsmuglet felt.
    expect(input.validUntil).toBe("2026-12-17");
  });

  it("adressen etter lagring har bare tilbud-id-en, ingen felt", async () => {
    const url = await redirectOf(saveAsOfferAction(initialFormState, filledForm()));
    for (const value of ["MERKE-ADR-T2A", "MERKE-BEST-T2A", "9999", "55-1234", "Testlaget"]) {
      expect(url).not.toContain(value);
    }
  });

  it("uten ansattrad: ingen tilgang, kjernen kalles ikke, det som er skrevet står igjen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await saveAsOfferAction(initialFormState, filledForm());
    expect(state.message).toBe(NO_ACCESS);
    expect(state.values.addressText).toBe(ADDRESS);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("annen organisasjon eller manglende rettighet (AccessDeniedError) gir ingen tilgang og ingen videresending", async () => {
    mocks.createOrder.mockRejectedValue(new AccessDeniedError());
    const state = await saveAsOfferAction(initialFormState, filledForm());
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("feil i skjemaet (mangler adresse): feilen står ved feltet på «Nytt oppdrag», og det som er skrevet står igjen", async () => {
    mocks.createOrder.mockRejectedValue(
      new ZodError([
        { code: "custom", path: ["addressText"], message: "Skriv inn adressen.", input: "" },
      ]),
    );
    const state = await saveAsOfferAction(initialFormState, filledForm({ addressText: "" }));
    expect(state.fieldErrors).toEqual({ addressText: "Skriv inn adressen." });
    expect(state.message).toBeNull();
    expect(state.values.orderedByText).toBe(ORDERED_BY);
    expect(state.values.responsibleEmployeeId).toBe(INSPECTOR);
    expect(state.values.inspectionAt).toBe("2026-11-20T10:00");
    expect(state.attempt).toBe(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("ukjent eller fremmed kontakt står ved bestilleren", async () => {
    mocks.createOrder.mockRejectedValue(new ContactNotFoundError());
    const state = await saveAsOfferAction(initialFormState, filledForm());
    expect(state.fieldErrors).toEqual({ orderedByContactId: "Kontakten finnes ikke." });
  });

  it("ukjent feil: «Tilbudet er ikke lagret», og loggen får ingen skjemaverdier", async () => {
    mocks.createOrder.mockRejectedValue(new Error(`feil med ${ADDRESS} og ${ORDERED_BY}`));
    const state = await saveAsOfferAction(initialFormState, filledForm());
    expect(state.message).toBe(OFFER_UNKNOWN_ERROR);
    expect(state.values.addressText).toBe(ADDRESS);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain("MERKE-ADR-T2A");
    expect(logged).not.toContain("MERKE-BEST-T2A");
  });
});

describe("findDraftDuplicatesAction gir visningsstatusen for tilbud (F2 b)", () => {
  it("tilbud får displayStatus fra kjernen, oppdrag får null", async () => {
    mocks.findPossibleDuplicatesFor.mockResolvedValue({
      items: [
        {
          kind: "order",
          id: OFFER,
          number: null,
          status: "received",
          receivedAt: new Date(),
          addressText: "Testveien 12, 8000 Bodø",
          reasons: ["address"],
          displayStatus: "expired",
        },
        {
          kind: "assignment",
          id: KEY,
          number: "2026-00042",
          status: "ordered",
          receivedAt: new Date(),
          addressText: "Testveien 12, 8000 Bodø",
          reasons: ["address"],
          displayStatus: null,
        },
      ],
      hasMore: false,
    });
    const result = await findDraftDuplicatesAction({
      addressText: "Testveien 12, 8000 Bodø",
      gnr: "",
      bnr: "",
      snr: "",
      receivedAt: "",
    });
    expect(result.items.map((item) => [item.kind, item.displayStatus])).toEqual([
      ["order", "expired"],
      ["assignment", null],
    ]);
    // Organisasjonen kommer fra serveren.
    expect(mocks.findPossibleDuplicatesFor.mock.calls[0]![1]).toBe(ORG);
    // Fortsatt ingen mottatt-dato i svaret.
    expect(result.items[0]).not.toHaveProperty("receivedAt");
  });
});

describe("skjemaet «Nytt oppdrag» med «Lagre som tilbud i stedet»", () => {
  function render() {
    return renderToStaticMarkup(
      createElement(AssignmentForm, {
        action: vi.fn(),
        offerAction: vi.fn(),
        duplicatesAction: vi.fn(),
        creationKey: KEY,
        receivedAtDefault: "2026-11-16T09:12",
        options: {
          offices: [{ id: OFFICE, name: "Bodø" }],
          defaultOfficeId: OFFICE,
          officesEmptyMessage: null,
          inspectors: [{ id: INSPECTOR, name: "Oppdiktet takstmann" }],
          currentInspectorId: null,
        },
      }),
    );
  }

  it("«Lagre» står først, så sekundærknappen «Lagre som tilbud i stedet», så «Avbryt»", () => {
    const html = render();
    const save = html.indexOf(">Lagre</button>");
    const offer = html.indexOf(">Lagre som tilbud i stedet</button>");
    const cancel = html.indexOf(">Avbryt</a>");
    expect(save).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(save);
    expect(cancel).toBeGreaterThan(offer);
  });

  it("knappen sender skjemaet med intent=offer og er en sekundær knapp på minst 44 px", () => {
    const html = render();
    const button = /<button[^>]*>Lagre som tilbud i stedet<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('type="submit"');
    expect(button).toContain(`name="${SAVE_INTENT_FIELD}"`);
    expect(button).toContain(`value="${SAVE_AS_OFFER_INTENT}"`);
    expect(button).toContain("ring-slate-700");
    expect(button).toContain("min-h-11");
    expect(button).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("ingen felt for «Gyldig til» og ingen skjult organisasjon i skjemaet", () => {
    const html = render();
    expect(html).not.toContain('name="validUntil"');
    expect(html).not.toContain('name="organizationId"');
  });

  it("uten nett gir «Lagre som tilbud i stedet» samme melding som skjemaene for tilbud (A360), og alt står igjen", () => {
    const state = offlineState(initialFormState, filledForm());
    expect(ORDER_OFFLINE_MESSAGE).toBe("Du er uten nett. Endringen er ikke lagret.");
    expect(state.message).toBe(ORDER_OFFLINE_MESSAGE);
    expect(state.values.addressText).toBe(ADDRESS);
    expect(state.values.orderedByText).toBe(ORDERED_BY);
    expect(state.attempt).toBe(1);
  });

  it("uten nett gir «Lagre» fortsatt meldingen for oppdraget", () => {
    const state = offlineState(initialFormState, filledForm({ [SAVE_INTENT_FIELD]: "assignment" }));
    expect(state.message).toBe(ASSIGNMENT_OFFLINE_MESSAGE);
  });
});
