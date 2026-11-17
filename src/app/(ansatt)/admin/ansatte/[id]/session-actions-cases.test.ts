import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { initialFormState, NO_ACCESS } from "../../../form-state";

/*
 * Serverhandlingen «Logg ut av alle enheter» på /admin/ansatte/[id]
 * (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 6, «Avklart før bygging» 5 og 6; testplan
 * 7.1). Kjernen er byttet ut her; den testes mot databasen i
 * src/core/auth/sessions-admin.integration.test.ts. Testene viser at organisasjonen kommer fra
 * serveren, at ansatt-id-en sjekkes før kjernen kalles, at `confirmSelf` bare sendes når
 * bekreftelsen er krysset av, og at kvitteringen har riktig tall og bøyning.
 *
 * Navnet på handlingen var ikke låst i testplanen; den finnes ut fra eksportene i
 * session-actions.ts. Signaturen er som de andre handlingene på siden:
 * `(employeeId, previous, formData)`.
 *
 * Støtter hovedmål: de ansatte (admin stenger alle enheter med én handling, og stenger aldri seg
 * selv ute ved et uhell).
 */

const mocks = vi.hoisted(() => ({
  getActorForAction: vi.fn(),
  findAdminOrganizationId: vi.fn(),
  isOwnEmployee: vi.fn(),
  revokeAllEmployeeSessions: vi.fn(),
  listEmployeeSessions: vi.fn(),
  logError: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/core/auth/session", () => ({ getActorForAction: mocks.getActorForAction }));
vi.mock("@/core/organization", () => ({
  findAdminOrganizationId: mocks.findAdminOrganizationId,
}));
vi.mock("../../admin-context", () => ({ isOwnEmployee: mocks.isOwnEmployee }));
vi.mock("@/core/auth/sessions-list", () => ({
  listOwnSessions: vi.fn(),
  revokeOwnSession: vi.fn(),
  revokeOtherOwnSessions: vi.fn(),
  listEmployeeSessions: mocks.listEmployeeSessions,
  revokeAllEmployeeSessions: mocks.revokeAllEmployeeSessions,
}));

const exported = (await import("./session-actions")) as unknown as Record<string, unknown>;
const actionNames = Object.keys(exported).filter(
  (name) => typeof exported[name] === "function" && /revoke|logOut|signOut/i.test(name),
);
if (actionNames.length !== 1) {
  throw new Error(`Fant ${actionNames.length} handlinger i session-actions.ts: ${actionNames}`);
}
const revokeAll = exported[actionNames[0]!] as (
  employeeId: string,
  previous: unknown,
  formData: FormData,
) => Promise<unknown>;

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000010";
const actor = { id: "user-admin", email: "ada.admin@example.com", name: "Ada Admin" };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function run(employeeId: string, data: FormData): Promise<string> {
  try {
    return JSON.stringify(await revokeAll(employeeId, initialFormState, data));
  } catch (error) {
    return `THROWN ${(error as Error).message}`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActorForAction.mockResolvedValue(actor);
  mocks.findAdminOrganizationId.mockResolvedValue(ORG);
  mocks.isOwnEmployee.mockResolvedValue(false);
  mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: true, count: 3 });
});

describe("7.1 «Logg ut av alle enheter»", () => {
  it("1. ikke admin eller ikke innlogget: ingen kjernekall", async () => {
    mocks.getActorForAction.mockResolvedValue(null);
    expect(await run(EMPLOYEE, form({}))).not.toContain('"status":"done"');
    mocks.getActorForAction.mockResolvedValue(actor);
    mocks.findAdminOrganizationId.mockResolvedValue(null);
    expect(await run(EMPLOYEE, form({}))).toContain(NO_ACCESS);
    expect(mocks.revokeAllEmployeeSessions).not.toHaveBeenCalled();
  });

  it("organisasjonen kommer fra serveren, ikke fra skjemaet; årsaken er manual", async () => {
    const result = await run(EMPLOYEE, form({ organizationId: OTHER_ORG, reason: "deactivated" }));
    expect(mocks.revokeAllEmployeeSessions).toHaveBeenCalledTimes(1);
    const [calledActor, organizationId, employeeId, options] =
      mocks.revokeAllEmployeeSessions.mock.calls[0]!;
    expect(calledActor).toEqual(actor);
    expect(organizationId).toBe(ORG);
    expect(employeeId).toBe(EMPLOYEE);
    expect((options as { reason: string }).reason).toBe("manual");
    expect(result).toContain(
      "3 enheter er logget ut. Data som ligger på enhetene, er ikke slettet.",
    );
  });

  it.each(["../x", "", "ikke-en-uuid", `${EMPLOYEE}/../x`])(
    "3. ansatt-id «%s» avvises uten kjernekall",
    async (employeeId) => {
      const result = await run(employeeId, form({}));
      expect(result).not.toContain('"status":"done"');
      expect(mocks.revokeAllEmployeeSessions).not.toHaveBeenCalled();
    },
  );

  it("4. confirmSelf sendes bare når bekreftelsen er krysset av", async () => {
    await run(EMPLOYEE, form({}));
    const without = mocks.revokeAllEmployeeSessions.mock.calls[0]![3] as { confirmSelf?: unknown };
    expect(without.confirmSelf === true).toBe(false);

    await run(EMPLOYEE, form({ confirmSelf: "yes" }));
    const withIt = mocks.revokeAllEmployeeSessions.mock.calls[1]![3] as { confirmSelf?: unknown };
    expect(withIt.confirmSelf).toBe(true);
  });

  it.each([
    [1, "1 enhet er logget ut. Data som ligger på enhetene, er ikke slettet."],
    [2, "2 enheter er logget ut. Data som ligger på enhetene, er ikke slettet."],
    [0, "Ingen enheter var logget inn."],
  ])("bøyning: %i gir «%s» (avklart punkt 5)", async (count, text) => {
    mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: true, count });
    expect(await run(EMPLOYEE, form({}))).toContain(text);
  });

  it("5. confirm_self_required gir en melding og ingen kvittering", async () => {
    mocks.revokeAllEmployeeSessions.mockResolvedValue({
      ok: false,
      reason: "confirm_self_required",
    });
    const result = await run(EMPLOYEE, form({}));
    expect(result).not.toContain("THROWN");
    expect(result).not.toMatch(/er logget ut\./);
  });

  it("5. «finnes ikke» gir en melding uten krasj", async () => {
    mocks.revokeAllEmployeeSessions.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await run(EMPLOYEE, form({}));
    expect(result).not.toContain("THROWN");
    expect(result).not.toMatch(/enheter? er logget ut\./);
  });

  it("5. AccessDeniedError blir «ingen tilgang»", async () => {
    mocks.revokeAllEmployeeSessions.mockRejectedValue(new AccessDeniedError());
    expect(await run(EMPLOYEE, form({}))).toContain(NO_ACCESS);
  });

  it("5. ukjent feil gir generell melding uten detaljer", async () => {
    mocks.revokeAllEmployeeSessions.mockRejectedValue(new Error("hemmelig detalj 192.0.2.10"));
    const result = await run(EMPLOYEE, form({}));
    expect(result).not.toContain("THROWN");
    expect(result).not.toContain("hemmelig detalj");
    expect(result).toMatch(/Noe gikk galt/);
  });

  it("6. session-actions.ts er en serverhandling-fil", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(ansatt)/admin/ansatte/[id]/session-actions.ts"),
      "utf8",
    );
    expect(source.trimStart().startsWith('"use server"')).toBe(true);
  });
});
