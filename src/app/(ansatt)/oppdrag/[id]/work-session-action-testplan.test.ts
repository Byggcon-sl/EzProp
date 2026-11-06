import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { workSessions } from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";

/*
 * Serverhandlingen måleren på oppdragssiden kaller (docs/funksjoner/fase2a-tidsmaling-testplan.md
 * avsnitt 6). Bare innloggingen (`getEmployeeContext`) og loggen er byttet ut; kjernen er ekte og
 * kjører mot testdatabasen, men pakkes inn så testen ser hvordan den kalles. Oppdiktede data.
 *
 * Støtter hovedmål: tid (måleren forstyrrer aldri siden) og reklamasjoner (organisasjonen kommer
 * alltid fra den innloggede, aldri fra argumentet).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  recordWorkActivity: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  failCore: null as Error | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/work-sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/work-sessions")>();
  mocks.recordWorkActivity.mockImplementation(
    async (...args: Parameters<typeof original.recordWorkActivity>) => {
      if (mocks.failCore) throw mocks.failCore;
      return original.recordWorkActivity(...args);
    },
  );
  return { ...original, recordWorkActivity: mocks.recordWorkActivity };
});

const { recordWorkActivityAction } = await import("./work-session-action");

const ACTOR_NAME = "Test Takstmann Handling";

beforeEach(async () => {
  await resetDatabase();
  mocks.getEmployeeContext.mockReset();
  mocks.recordWorkActivity.mockClear();
  mocks.log.error.mockClear();
  mocks.log.warn.mockClear();
  mocks.log.info.mockClear();
  mocks.failCore = null;
});

async function sessionCount(organizationId?: string) {
  const query = db.select({ n: count() }).from(workSessions);
  const [row] = organizationId
    ? await query.where(eq(workSessions.organizationId, organizationId))
    : await query;
  return row?.n ?? 0;
}

/** Organisasjon med en innlogget takstmann og et oppdrag under arbeid. */
async function loggedIn(name = "Organisasjon A") {
  const org = await createOrganization(name);
  const actor = await createUser({ name: ACTOR_NAME });
  await createEmployee(actor, org.id, ["inspector"]);
  const assignment = await createAssignment(org.id, { status: "in_progress" });
  mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: org.id });
  return { org, actor, assignment };
}

function loggedText() {
  return JSON.stringify([
    ...mocks.log.error.mock.calls,
    ...mocks.log.warn.mock.calls,
    ...mocks.log.info.mock.calls,
  ]);
}

describe("recordWorkActivityAction", () => {
  it("lager én økt for den innloggede (grunnlaget for de andre testene)", async () => {
    const { org, assignment } = await loggedIn();
    await recordWorkActivityAction(assignment.id);
    expect(await sessionCount(org.id)).toBe(1);
  });

  it("6.1 uten innlogging avvises uten kall til kjernen, ingen rad", async () => {
    const { assignment } = await loggedIn();
    mocks.getEmployeeContext.mockResolvedValue(null);
    await expect(recordWorkActivityAction(assignment.id)).resolves.toBeUndefined();
    expect(mocks.recordWorkActivity).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it.each([
    ["ikke-en-id", "ikke-en-id"],
    ["tom tekst", ""],
    ["SQL-tekst", "' or 1=1 --"],
    ["uuid med ekstra tegn", "0190a000-0000-7000-8000-000000000050x"],
  ])("6.2 %s avvises uten kall til kjernen", async (_label, id) => {
    await loggedIn();
    await expect(recordWorkActivityAction(id)).resolves.toBeUndefined();
    expect(mocks.recordWorkActivity).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it("6.2 tall eller objekt i stedet for tekst avvises uten kall til kjernen", async () => {
    await loggedIn();
    await recordWorkActivityAction(42 as unknown as string);
    await recordWorkActivityAction({ id: "x" } as unknown as string);
    expect(mocks.recordWorkActivity).not.toHaveBeenCalled();
  });

  it("6.3 organisasjonen kommer fra konteksten, ikke fra oppdraget", async () => {
    const a = await loggedIn("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentB = await createAssignment(orgB.id, { status: "in_progress" });

    await recordWorkActivityAction(assignmentB.id);

    expect(mocks.recordWorkActivity).toHaveBeenCalledTimes(1);
    const [actorArg, organizationArg, assignmentArg] = mocks.recordWorkActivity.mock.calls[0]!;
    expect(actorArg).toEqual(a.actor);
    expect(organizationArg).toBe(a.org.id);
    expect(assignmentArg).toBe(assignmentB.id);
  });

  it("6.4 oppdrags-id fra en annen organisasjon gir ingen rad", async () => {
    const a = await loggedIn("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentB = await createAssignment(orgB.id, { status: "in_progress" });

    await expect(recordWorkActivityAction(assignmentB.id)).resolves.toBeUndefined();

    expect(await sessionCount(a.org.id)).toBe(0);
    expect(await sessionCount(orgB.id)).toBe(0);
  });

  it("6.5 feil i kjernen kastes ikke videre, og loggen har ikke oppdrags-id eller navn", async () => {
    const { actor, assignment } = await loggedIn();
    mocks.failCore = new Error(`databasefeil for ${assignment.id} og ${ACTOR_NAME}`);

    await expect(recordWorkActivityAction(assignment.id)).resolves.toBeUndefined();

    const text = loggedText();
    expect(text).not.toContain(assignment.id);
    expect(text).not.toContain(ACTOR_NAME);
    expect(text).not.toContain(actor.email);
  });

  it("6.5 tilgangsfeil fra kjernen (deaktivert ansatt) kastes ikke videre", async () => {
    const org = await createOrganization();
    const actor = await createUser({ name: ACTOR_NAME });
    const assignment = await createAssignment(org.id, { status: "in_progress" });
    // Ingen ansattrad: kjernen gir AccessDeniedError
    mocks.getEmployeeContext.mockResolvedValue({ actor, organizationId: org.id });

    await expect(recordWorkActivityAction(assignment.id)).resolves.toBeUndefined();
    expect(await sessionCount()).toBe(0);
    expect(loggedText()).not.toContain(ACTOR_NAME);
  });

  it("6.5 feil i konteksten kastes ikke videre", async () => {
    mocks.getEmployeeContext.mockRejectedValue(new Error("sesjonen feilet"));
    await expect(
      recordWorkActivityAction("0190a000-0000-7000-8000-000000000050"),
    ).resolves.toBeUndefined();
  });
});
