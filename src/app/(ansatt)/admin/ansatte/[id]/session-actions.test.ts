import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";
import { NO_ACCESS } from "../../../form-state";

/*
 * «Logg ut av alle enheter» på /admin/ansatte/[id] (docs/funksjoner/fase2a-mine-innlogginger-testplan.md
 * avsnitt 7.1, adminhandlingen). Kjernen og tilgangssjekken er byttet ut her; de testes i
 * src/core/auth/sessions-admin.integration.test.ts. Testene viser at organisasjonen kommer fra
 * serveren, at ansatt-id-en sjekkes før kjernen kalles, at `confirmSelf` bare sendes når feltet er
 * krysset av, og at svarene er faste norske meldinger uten persondata.
 * Støtter hovedmål: de ansatte (admin stenger alle enheter med én handling og stenges aldri ute).
 */

const mocks = vi.hoisted(() => ({
  getActorForAction: vi.fn(),
  findAdminOrganizationId: vi.fn(),
  isOwnEmployee: vi.fn(),
  revokeAllEmployeeSessions: vi.fn(),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("@/core/auth/session", () => ({ getActorForAction: mocks.getActorForAction }));
vi.mock("@/core/auth/sessions-list", () => ({
  revokeAllEmployeeSessions: mocks.revokeAllEmployeeSessions,
}));
vi.mock("@/core/organization", () => ({
  findAdminOrganizationId: mocks.findAdminOrganizationId,
}));
vi.mock("../../admin-context", () => ({ isOwnEmployee: mocks.isOwnEmployee }));

const { revokeAllEmployeeSessionsAction } = await import("./session-actions");
const { CONFIRM_SELF_FIELD, CONFIRM_SELF_VALUE } = await import("./sessions-state");

const ORG = "0190a000-0000-7000-8000-000000000001";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000010";
const actor = {
  id: "user-admin",
  email: "admin.testdatter@example.com",
  name: "Admin Testdatter",
  sessionId: "okt-admin",
};

function form(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const confirmed = () => form({ [CONFIRM_SELF_FIELD]: CONFIRM_SELF_VALUE });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActorForAction.mockResolvedValue(actor);
  mocks.findAdminOrganizationId.mockResolvedValue(ORG);
  mocks.isOwnEmployee.mockResolvedValue(false);
  mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: true, count: 2 });
});

describe("revokeAllEmployeeSessionsAction", () => {
  it("ikke innlogget: «logget ut»-svaret, kjernen kalles ikke", async () => {
    mocks.getActorForAction.mockResolvedValue(null);
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form());
    expect(result).toMatchObject({
      status: "failed",
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
    });
    expect(mocks.revokeAllEmployeeSessions).not.toHaveBeenCalled();
  });

  it.each([["../x"], [""], ["ikke-en-uuid"], [42], [null]])(
    "ugyldig ansatt-id %j avvises uten kjernekall",
    async (employeeId) => {
      const result = await revokeAllEmployeeSessionsAction(employeeId, undefined, form());
      expect(result).toMatchObject({ status: "failed", message: "Fant ikke den ansatte." });
      expect(mocks.revokeAllEmployeeSessions).not.toHaveBeenCalled();
      expect(mocks.findAdminOrganizationId).not.toHaveBeenCalled();
    },
  );

  it("ikke admin i noen organisasjon: ingen tilgang, kjernen kalles ikke", async () => {
    mocks.findAdminOrganizationId.mockResolvedValue(null);
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form());
    expect(result).toMatchObject({ status: "failed", message: NO_ACCESS });
    expect(mocks.revokeAllEmployeeSessions).not.toHaveBeenCalled();
  });

  it("organisasjonen kommer fra serveren, aldri fra skjemaet; årsaken er «manual»", async () => {
    await revokeAllEmployeeSessionsAction(
      EMPLOYEE,
      undefined,
      form({ organizationId: "0190a000-0000-7000-8000-000000000002" }),
    );
    expect(mocks.revokeAllEmployeeSessions).toHaveBeenCalledWith(actor, ORG, EMPLOYEE, {
      reason: "manual",
    });
  });

  it("confirmSelf sendes bare når avkryssingsfeltet er satt", async () => {
    await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, confirmed());
    expect(mocks.revokeAllEmployeeSessions).toHaveBeenLastCalledWith(actor, ORG, EMPLOYEE, {
      confirmSelf: true,
      reason: "manual",
    });

    for (const value of ["on", "true", ""]) {
      await revokeAllEmployeeSessionsAction(
        EMPLOYEE,
        undefined,
        form({ [CONFIRM_SELF_FIELD]: value }),
      );
      expect(mocks.revokeAllEmployeeSessions).toHaveBeenLastCalledWith(actor, ORG, EMPLOYEE, {
        reason: "manual",
      });
    }
  });

  it.each([
    [0, "Ingen enheter var logget inn."],
    [1, "1 enhet er logget ut. Data som ligger på enhetene, er ikke slettet."],
    [3, "3 enheter er logget ut. Data som ligger på enhetene, er ikke slettet."],
  ])("kvittering med antall %i", async (count, message) => {
    mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: true, count });
    const result = await revokeAllEmployeeSessionsAction(
      EMPLOYEE,
      { ...idle(), attempt: 4 },
      form(),
    );
    expect(result).toEqual({ status: "done", message, attempt: 5, isSelf: false, count });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/ansatte/${EMPLOYEE}`);
  });

  it("admin selv: svaret sier det, og siden lastes ikke på nytt (klienten logger ut)", async () => {
    mocks.isOwnEmployee.mockResolvedValue(true);
    mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: true, count: 1 });
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, confirmed());
    expect(result).toMatchObject({ status: "done", isSelf: true, count: 1 });
    expect(mocks.isOwnEmployee).toHaveBeenCalledWith({ actor, organizationId: ORG }, EMPLOYEE);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("confirm_self_required: tydelig melding, ingen utlogging her", async () => {
    mocks.isOwnEmployee.mockResolvedValue(true);
    mocks.revokeAllEmployeeSessions.mockResolvedValue({
      ok: false,
      reason: "confirm_self_required",
    });
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form());
    expect(result).toMatchObject({
      status: "failed",
      message: "Kryss av for at du også blir logget ut her.",
      isSelf: false,
    });
  });

  it("not_found (ukjent eller annen organisasjon): «Fant ikke den ansatte.»", async () => {
    mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form());
    expect(result).toMatchObject({ status: "failed", message: "Fant ikke den ansatte." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("AccessDeniedError fra kjernen eller tilgangssjekken: ingen tilgang", async () => {
    mocks.revokeAllEmployeeSessions.mockRejectedValue(new AccessDeniedError());
    expect(await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form())).toMatchObject({
      status: "failed",
      message: NO_ACCESS,
    });
    mocks.isOwnEmployee.mockRejectedValue(new AccessDeniedError());
    expect(await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form())).toMatchObject({
      status: "failed",
      message: NO_ACCESS,
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ukjent feil: generell melding, logget uten id-er og uten detaljer i svaret", async () => {
    mocks.revokeAllEmployeeSessions.mockRejectedValue(
      new Error("hemmelig detalj okt-admin 192.0.2.10"),
    );
    const result = await revokeAllEmployeeSessionsAction(EMPLOYEE, undefined, form());
    expect(result).toMatchObject({
      status: "failed",
      message: "Noe gikk galt. Ingen enheter er logget ut. Prøv igjen.",
    });
    expect(JSON.stringify(result)).not.toContain("hemmelig");
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(EMPLOYEE);
    expect(logged).not.toContain(actor.id);
    expect(logged).not.toContain("okt-admin");
    expect(logged).not.toContain("192.0.2");
  });

  it("bare POST: ingen rute med GET logger ut, og filen er en serverhandling", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "session-actions.ts"), "utf8");
    expect(source.startsWith('"use server";')).toBe(true);
    expect(source).not.toMatch(/export (async )?function GET/);
  });
});

function idle() {
  return { status: "idle" as const, message: null, attempt: 0, isSelf: false };
}
