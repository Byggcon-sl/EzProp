import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../form-state";

/*
 * Server action for /admin/ki (K7, docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md
 * avsnitt 3, A1–A5). Samme mønster som ../actions.test.ts: `getAdminContext` er byttet ut, og
 * `saveAiRetentionSettings` i kjernen er en spion. I A4 kjører den ekte valideringen i kjernen
 * (bare tilgangssjekken er byttet ut), så feilen er den kjernen faktisk gir.
 *
 * Støtter hovedmål: de ansatte (admin får tydelig feilmelding ved feltet og kvittering) og KI i
 * bunnen (organisasjonen kommer alltid fra økten, aldri fra skjemaet).
 */

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  save: vi.fn(),
  actualSave: null as null | ((...args: unknown[]) => Promise<unknown>),
  requireOrganizationAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../admin-context", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("@/core/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/access")>();
  return { ...actual, requireOrganizationAccess: mocks.requireOrganizationAccess };
});
vi.mock("@/core/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/ai")>();
  mocks.actualSave = (
    actual as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  ).saveAiRetentionSettings!;
  return { ...actual, saveAiRetentionSettings: mocks.save };
});

const actionsModule = (await import("./actions")) as unknown as Record<string, unknown>;
const actionEntries = Object.entries(actionsModule).filter(
  ([, value]) => typeof value === "function",
);

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Den ene server action i filen (navnet er utviklerens valg). */
const saveAction = actionEntries[0]?.[1] as Action;

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const FIELD = "rejectedRetentionYears";
const FIELD_ERROR = "Skriv et helt antall år fra 1 til 10.";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

type Outcome = { kind: "state"; state: FormState } | { kind: "redirect"; url: string };

async function run(entries: Record<string, string>): Promise<Outcome> {
  try {
    return { kind: "state", state: await saveAction(initialFormState, form(entries)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT ")) return { kind: "redirect", url: message.slice(9) };
    throw error;
  }
}

/** Kvittering: enten videre til /admin/ki, eller en tilstand uten feil. */
function expectReceipt(outcome: Outcome) {
  if (outcome.kind === "redirect") {
    expect(outcome.url).toMatch(/^\/admin\/ki(\?|$)/);
    return;
  }
  expect(outcome.state.fieldErrors).toEqual({});
  expect(outcome.state.message).not.toBe(NO_ACCESS);
  expect(outcome.state.message).not.toBe(UNKNOWN_ERROR);
}

/** Det skjemaet sendte videre for feltet, som tekst. */
function sentValue(input: unknown): string {
  const record = input as Record<string, unknown>;
  return String(record[FIELD]).trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminContext.mockResolvedValue({ actor, organizationId: ORG });
  mocks.save.mockResolvedValue({ rejectedRetentionYears: 3, changed: true });
  mocks.requireOrganizationAccess.mockImplementation(
    async (_actor: unknown, organizationId: string) => ({
      organizationId,
      employeeId: "0190a000-0000-7000-8000-000000000010",
      roles: ["admin"],
      permissions: [],
    }),
  );
});

describe("server action for /admin/ki", () => {
  it("filen har én server action", () => {
    expect(actionEntries).toHaveLength(1);
  });

  it("A1 ikke admin gir «ingen tilgang» uten kall til kjernen (takstmann, kontor og leder)", async () => {
    // getAdminContext gir null for alle som ikke er admin
    mocks.getAdminContext.mockResolvedValue(null);
    const outcome = await run({ [FIELD]: "3" });
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") expect(outcome.state.message).toBe(NO_ACCESS);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("A1 AccessDeniedError fra kjernen gir «ingen tilgang», ingen kvittering", async () => {
    const { AccessDeniedError } = await import("@/core/access");
    mocks.save.mockRejectedValue(new AccessDeniedError());
    const outcome = await run({ [FIELD]: "3" });
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") expect(outcome.state.message).toBe(NO_ACCESS);
  });

  it("A2 organisasjonen kommer fra økten, aldri fra skjemaet", async () => {
    const outcome = await run({ [FIELD]: "3", organizationId: OTHER_ORG });
    expectReceipt(outcome);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, input] = mocks.save.mock.calls[0]!;
    expect(calledActor).toBe(actor);
    expect(calledOrg).toBe(ORG);
    expect(JSON.stringify(input)).not.toContain(OTHER_ORG);
  });

  it("A3 tekst fra skjemaet sendes videre og lagres som tall, med kvittering", async () => {
    const outcome = await run({ [FIELD]: "3" });
    expectReceipt(outcome);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const input = mocks.save.mock.calls[0]![2];
    // Teksten går videre til kjernen, som gjør den om til tallet 3 (I4 i retention-testplan)
    expect(sentValue(input)).toBe("3");
  });

  it.each(["0", "11", "2.5", "abc", "", "-1", "1e1"])(
    "A4 «%s» gir feil ved feltet uten å gjengi inputen",
    async (value) => {
      mocks.save.mockImplementation((...args: unknown[]) => mocks.actualSave!(...args));
      const outcome = await run({ [FIELD]: value });
      expect(outcome.kind).toBe("state");
      if (outcome.kind !== "state") return;
      const { state } = outcome;
      expect(state.fieldErrors[FIELD]).toBe(FIELD_ERROR);
      const messages = JSON.stringify({
        message: state.message,
        fieldErrors: state.fieldErrors,
      }).replaceAll(FIELD_ERROR, "");
      if (value !== "" && value !== "0" && value !== "1e1") expect(messages).not.toContain(value);
      expect(messages).not.toContain("1e1");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain(`"${value}"`);
    },
  );

  it("A5 samme verdi gir vanlig kvittering (kjernen skrev ingenting)", async () => {
    mocks.save.mockResolvedValue({ rejectedRetentionYears: 3, changed: false });
    const outcome = await run({ [FIELD]: "3" });
    expectReceipt(outcome);
  });

  it("ukjent feil fra kjernen gir den faste meldingen og logger ikke inputen", async () => {
    mocks.save.mockRejectedValue(new Error("tilfeldig databasefeil"));
    const outcome = await run({ [FIELD]: "7" });
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") expect(outcome.state.message).toBe(UNKNOWN_ERROR);
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain('"7"');
  });
});
