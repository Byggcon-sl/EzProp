import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { initialFormState, NO_ACCESS, type FormState } from "../../form-state";
import { formatDifference, phaseLabels } from "./labels";

/*
 * Server action for nullpunktet og bryteren «Mål tid» på /statistikk/tid
 * (docs/funksjoner/fase2a-tidsmaling.md punkt 6). Konteksten og lagringen i kjernen er byttet ut;
 * selve lagringen, sammenslåingen og tenant-isolasjonen testes i src/core/work-sessions. Testene
 * viser at organisasjonen kommer fra serveren, at feltene får norske feilmeldinger, og at
 * `AccessDeniedError` blir «ingen tilgang». Testdata er oppdiktet.
 *
 * Støtter hovedmål: tid (riktig sammenligning med IVIT).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
  saveTimeTrackingSettings: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/work-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/work-sessions")>()),
  saveTimeTrackingSettings: mocks.saveTimeTrackingSettings,
}));

const { saveTimeTrackingSettingsAction } = await import("./actions");
const real = await vi.importActual<typeof import("@/core/work-sessions")>("@/core/work-sessions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function settingsForm(overrides: Record<string, string> = {}) {
  return form({
    enabled: "on",
    preparation: "30",
    inspection: "120",
    office: "240",
    delivery: "20",
    source: "Oppdiktet måling, 3 oppdrag",
    ...overrides,
  });
}

async function run(promise: Promise<FormState>): Promise<FormState | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT ")) return null;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: ORG });
  // Bruker det ekte skjemaet, slik at feilene ved feltene kommer fra valideringen i kjernen.
  mocks.saveTimeTrackingSettings.mockImplementation(async (_a, _o, input) => {
    const parsed = real.timeTrackingSettingsSchema.safeParse(input);
    if (parsed.success) return;
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    throw new real.TimeTrackingValidationError(fieldErrors);
  });
});

describe("saveTimeTrackingSettingsAction", () => {
  it("lagrer med organisasjonen fra konteksten, selv om skjemaet har en annen", async () => {
    const state = await run(
      saveTimeTrackingSettingsAction(initialFormState, settingsForm({ organizationId: OTHER_ORG })),
    );
    expect(state).toBeNull();
    expect(mocks.saveTimeTrackingSettings).toHaveBeenCalledTimes(1);
    const [calledActor, calledOrg, input] = mocks.saveTimeTrackingSettings.mock.calls[0]!;
    expect(calledActor).toBe(actor);
    expect(calledOrg).toBe(ORG);
    expect(input).toEqual({
      enabled: true,
      baseline: {
        preparation: 30,
        inspection: 120,
        office: 240,
        delivery: 20,
        source: "Oppdiktet måling, 3 oppdrag",
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/statistikk/tid");
    expect(mocks.redirect).toHaveBeenCalledWith("/statistikk/tid?lagret=1");
  });

  it("bryteren av og tomme minutter gir enabled false og 0", async () => {
    await run(
      saveTimeTrackingSettingsAction(
        initialFormState,
        form({ preparation: "", inspection: "", office: "", delivery: "", source: "" }),
      ),
    );
    const input = mocks.saveTimeTrackingSettings.mock.calls[0]![2];
    expect(input.enabled).toBe(false);
    expect(input.baseline).toMatchObject({ preparation: 0, inspection: 0, office: 0, delivery: 0 });
  });

  it("uten ansattrad: ingen tilgang og ingen lagring", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const state = await run(saveTimeTrackingSettingsAction(initialFormState, settingsForm()));
    expect(state?.message).toBe(NO_ACCESS);
    expect(mocks.saveTimeTrackingSettings).not.toHaveBeenCalled();
  });

  it("AccessDeniedError fra kjernen gir ingen tilgang", async () => {
    mocks.saveTimeTrackingSettings.mockRejectedValue(new AccessDeniedError());
    const state = await run(saveTimeTrackingSettingsAction(initialFormState, settingsForm()));
    expect(state?.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["10001", "preparation"],
    ["1.5", "inspection"],
    ["1,5", "office"],
    ["-1", "delivery"],
    ["abc", "preparation"],
  ])("minutter %s i %s gir norsk melding ved feltet", async (value, field) => {
    const state = await run(
      saveTimeTrackingSettingsAction(initialFormState, settingsForm({ [field]: value })),
    );
    expect(state?.fieldErrors[field]).toMatch(
      /^Skriv minutter som et helt tall fra 0 til 10.000\.$/,
    );
    expect(state?.values[field]).toBe(value);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("10 000 minutter godtas", async () => {
    const state = await run(
      saveTimeTrackingSettingsAction(initialFormState, settingsForm({ office: "10000" })),
    );
    expect(state).toBeNull();
  });

  it("kilde på 201 tegn gir norsk melding ved feltet", async () => {
    const state = await run(
      saveTimeTrackingSettingsAction(initialFormState, settingsForm({ source: "a".repeat(201) })),
    );
    expect(state?.fieldErrors.source).toBe("Kilden kan ha høyst 200 tegn.");
  });
});

describe("labels", () => {
  it("har norske navn på alle fasene", () => {
    expect(real.WORK_PHASES.map((phase) => phaseLabels[phase])).toEqual([
      "Forberedelse",
      "Befaring",
      "Kontorarbeid",
      "Levering",
    ]);
  });

  it.each([
    [null, "–"],
    [0, "0 %"],
    [12, "+12 %"],
    [-25, "-25 %"],
  ])("forskjell %s vises som %s", (percent, text) => {
    expect(formatDifference(percent)).toBe(text);
  });
});
