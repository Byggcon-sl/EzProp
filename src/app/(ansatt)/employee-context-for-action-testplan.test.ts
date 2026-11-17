import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Rett T-0070: `getEmployeeContextForAction` (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1d-2). Mot testdatabasen; bare
 * Better Auth, forespørselshodene og `redirect` er byttet ut. `session.ts` og `findEmployeeGrant`
 * er ekte, så testen viser hele veien fra økt til organisasjon.
 *
 * Støtter hovedmål: de ansatte (handlingen svarer «logget ut» i stedet for å sende bort fra
 * skjemaet) og færre reklamasjoner (organisasjonen kommer bare fra tilgangssjekken).
 */

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string } },
  headers: new Headers(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mocks.headers) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("@/core/auth/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));

const { getEmployeeContext, getEmployeeContextForAction } = await import("./employee-context");

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  mocks.session = null;
  mocks.headers = new Headers();
});

function signIn(user: { id: string; email: string; name: string }) {
  mocks.session = { user: { id: user.id, email: user.email, name: user.name } };
}

describe("1d-2 getEmployeeContextForAction", () => {
  it("uten økt: { status: «signed_out» }, uten videresending", async () => {
    mocks.headers = new Headers({ "x-request-path": "/arbeidskoe" });
    expect(await getEmployeeContextForAction()).toEqual({ status: "signed_out" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("innlogget uten ansattrad: { status: «no_access» }", async () => {
    await createOrganization();
    signIn(await createUser());
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("myk slettet ansattrad: { status: «no_access» }", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    signIn(user);
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
  });

  it("deaktivert ansatt: { status: «no_access» }", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    signIn(user);
    expect(await getEmployeeContextForAction()).toEqual({ status: "no_access" });
  });

  it.each(["admin", "manager", "office", "inspector"] as const)(
    "%s: { status: «ok», context } med organisasjonen fra tilgangssjekken",
    async (role) => {
      const org = await createOrganization();
      await createOrganization("Annen organisasjon test");
      const user = await createUser();
      await createEmployee(user, org.id, [role]);
      signIn(user);

      const result = await getEmployeeContextForAction();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.context.organizationId).toBe(org.id);
      expect(result.context.actor.id).toBe(user.id);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("en ansatt i organisasjon B får organisasjon B, aldri A", async () => {
    const orgA = await createOrganization("Organisasjon A test");
    const orgB = await createOrganization("Organisasjon B test");
    const userA = await createUser();
    const userB = await createUser();
    await createEmployee(userA, orgA.id, ["admin"]);
    await createEmployee(userB, orgB.id, ["inspector"]);

    signIn(userB);
    const result = await getEmployeeContextForAction();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.context.organizationId).toBe(orgB.id);
  });
});

describe("1d-2 getEmployeeContext oppfører seg som før", () => {
  it("uten økt videresender den til innloggingen", async () => {
    await expect(getEmployeeContext()).rejects.toMatchObject({
      url: expect.stringMatching(/^\/logg-inn/),
    });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it("uten ansattrad gir den null", async () => {
    await createOrganization();
    signIn(await createUser());
    expect(await getEmployeeContext()).toBeNull();
  });

  it("med ansattrad gir den konteksten med organisasjonen", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["office"]);
    signIn(user);
    expect((await getEmployeeContext())?.organizationId).toBe(org.id);
  });
});
