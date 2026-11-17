import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, organizations } from "@/db/schema";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";
import {
  createAssignment,
  createEmployee,
  createOffice,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";
import { initialFormState, NO_ACCESS, type FormState } from "../../form-state";

/*
 * Rett T-0070: «Lagre eiendom» med utløpt innlogging (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1d). Integrasjon mot testdatabasen.
 * Bare Better Auth (økten), forespørselshodene, `redirect`, `revalidatePath` og loggeren er
 * byttet ut. `session.ts`, `employee-context.ts` og kjernen er ekte; kjernefunksjonen er pakket
 * i en spion som kaller den ekte.
 *
 * Testdata er oppdiktet («Oppdiktet gate 1», gnr/bnr 999). Støtter hovedmål: de ansatte (det
 * som er skrevet kommer tilbake med «Du er logget ut»), og færre reklamasjoner (aldri lagret i
 * feil organisasjon, aldri skjemaverdier i loggen).
 */

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string } },
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  revalidatePath: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  saveAssignmentProperty: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/core/auth/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));
vi.mock("@/core/properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/properties")>();
  mocks.saveAssignmentProperty.mockImplementation(actual.saveAssignmentProperty);
  return { ...actual, saveAssignmentProperty: mocks.saveAssignmentProperty };
});

const { savePropertyAction } = await import("./actions");

const ADDRESS = "Oppdiktet gate 1";
const MISSING_ID = "0190a000-0000-7000-8000-00000000dead";

const PROPERTY_VALUES = {
  address: ADDRESS,
  postalCode: "8006",
  city: "Oppdiktet sted",
  municipalityNumber: "1804",
  municipalityName: "Oppdiktet kommune",
  housingType: "detached",
  ownershipForm: "freehold",
  gnr: "999",
  bnr: "999",
  fnr: "",
  snr: "",
  associationName: "",
  associationOrgNumber: "",
  shareNumber: "",
};
const FORM_TEXTS = [ADDRESS, "Oppdiktet sted", "Oppdiktet kommune"];

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  mocks.session = null;
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function signIn(actor: Actor) {
  mocks.session = { user: { id: actor.id, email: actor.email, name: actor.name } };
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Alle rader for eiendom, matrikkel og oppdrag i organisasjonen, med alle kolonnene. */
async function snapshot(organizationId: string): Promise<string> {
  const all: Record<string, unknown> = {};
  for (const table of ["properties", "cadastral_units", "assignments", "events"]) {
    all[table] = await db.execute(
      sql`select * from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`,
    );
  }
  return JSON.stringify(all);
}

async function propertyAddress(assignmentId: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`select p.address from assignments a join properties p on p.id = a.property_id
        where a.id = ${assignmentId} and p.deleted_at is null`,
  )) as unknown as { address: string }[];
  return rows[0]?.address ?? null;
}

async function orgWithAssignment(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  const assignment = await createAssignment(org.id, { officeId: office.id });
  return { org, assignment };
}

function expectOnlySentFields(state: FormState, sent: Record<string, string>) {
  for (const [key, value] of Object.entries(state.values)) {
    expect(Object.keys(sent), `feltet ${key} ble sendt`).toContain(key);
    expect(value, key).toBe(sent[key]);
  }
  expect(state.values).not.toHaveProperty("organizationId");
}

describe("1d savePropertyAction: logget ut", () => {
  it("svaret er «logget ut» med verdiene, ingen videresending, ingenting lagret og kjernen kalles ikke", async () => {
    const { org, assignment } = await orgWithAssignment();
    const before = await snapshot(org.id);
    const sent = { assignmentId: assignment.id, organizationId: org.id, ...PROPERTY_VALUES };

    const state = await savePropertyAction(initialFormState, form(sent));

    expect(state.signedOut).toBe(true);
    expect(state.message).toBe(SIGNED_OUT_MESSAGE);
    expect(state.message).toBe("Du er logget ut. Logg inn igjen.");
    expect(state.fieldErrors).toEqual({});
    expect(state.attempt).toBe(1);
    expect(state.values).toMatchObject({ address: ADDRESS, housingType: "detached" });
    expectOnlySentFields(state, sent);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.saveAssignmentProperty).not.toHaveBeenCalled();
    expect(await snapshot(org.id)).toBe(before);
  });

  it("ugyldig skjema gir også «logget ut», og kjernen (validering) kalles ikke", async () => {
    const { assignment } = await orgWithAssignment();
    const sent = {
      assignmentId: assignment.id,
      ...PROPERTY_VALUES,
      postalCode: "80",
      housingType: "",
    };
    const state = await savePropertyAction(initialFormState, form(sent));

    expect(state.signedOut).toBe(true);
    expect(state.message).toBe(SIGNED_OUT_MESSAGE);
    expect(state.fieldErrors).toEqual({});
    expect(mocks.saveAssignmentProperty).not.toHaveBeenCalled();
  });

  it("svaret er det samme for en id som finnes, en som ikke finnes og en som ikke er uuid", async () => {
    const { assignment } = await orgWithAssignment();
    const answers = [];
    for (const id of [assignment.id, MISSING_ID, "ikke-en-id"]) {
      answers.push(
        await savePropertyAction(initialFormState, form({ assignmentId: id, ...PROPERTY_VALUES })),
      );
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(answers[0]!.signedOut).toBe(true);
    expect(mocks.saveAssignmentProperty).not.toHaveBeenCalled();
  });

  it("ingen skjemaverdier i loggen", async () => {
    const { assignment } = await orgWithAssignment();
    await savePropertyAction(
      initialFormState,
      form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
    );
    const logged = JSON.stringify(Object.values(mocks.log).map((fn) => fn.mock.calls));
    for (const text of FORM_TEXTS) expect(logged).not.toContain(text);
  });
});

describe("1d savePropertyAction: innlogget uten aktiv ansattrad", () => {
  it("myk slettet ansatt får NO_ACCESS, ikke «logget ut», og ingenting lagres", async () => {
    const { org, assignment } = await orgWithAssignment();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    signIn(user);
    const before = await snapshot(org.id);

    const state = await savePropertyAction(
      initialFormState,
      form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
    );

    expect(state.message).toBe(NO_ACCESS);
    expect(state.signedOut).toBeUndefined();
    expect(mocks.saveAssignmentProperty).not.toHaveBeenCalled();
    expect(await snapshot(org.id)).toBe(before);
  });

  it("bruker uten ansattrad får NO_ACCESS, ikke «logget ut»", async () => {
    const { assignment } = await orgWithAssignment();
    signIn(await createUser());
    const state = await savePropertyAction(
      initialFormState,
      form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(state.signedOut).toBeUndefined();
  });
});

describe("1d savePropertyAction: tenant", () => {
  it("en bruker i A som sender organizationId og oppdrags-id fra B får NO_ACCESS, og B er uendret", async () => {
    const a = await orgWithAssignment("Organisasjon A test");
    const b = await orgWithAssignment("Organisasjon B test");
    await createProperty(b.org.id, { assignmentId: b.assignment.id, address: "Annen gate 2" });
    const userA = await createUser();
    await createEmployee(userA, a.org.id, ["admin"]);
    signIn(userA);
    const beforeB = await snapshot(b.org.id);

    const state = await savePropertyAction(
      initialFormState,
      form({ assignmentId: b.assignment.id, organizationId: b.org.id, ...PROPERTY_VALUES }),
    );

    expect(state.message).toBe(NO_ACCESS);
    expect(await snapshot(b.org.id)).toBe(beforeB);
    expect(await propertyAddress(b.assignment.id)).toBe("Annen gate 2");
    // Kjernen fikk organisasjonen fra tilgangssjekken, aldri B fra skjemaet
    expect(JSON.stringify(mocks.saveAssignmentProperty.mock.calls)).not.toContain(b.org.id);
  });

  it("etter ny innlogging som en bruker fra B i samme test gir Lagre på A sitt oppdrag NO_ACCESS", async () => {
    const a = await orgWithAssignment("Organisasjon A test");
    const b = await orgWithAssignment("Organisasjon B test");
    const userA = await createUser();
    const userB = await createUser();
    await createEmployee(userA, a.org.id, ["admin"]);
    await createEmployee(userB, b.org.id, ["admin"]);

    // Utløpt innlogging: verdiene kommer tilbake
    const signedOut = await savePropertyAction(
      initialFormState,
      form({ assignmentId: a.assignment.id, ...PROPERTY_VALUES }),
    );
    expect(signedOut.signedOut).toBe(true);

    // Logger inn igjen i dialogen, men som en bruker fra B
    signIn(userB);
    const beforeA = await snapshot(a.org.id);
    const state = await savePropertyAction(
      signedOut,
      form({ assignmentId: a.assignment.id, ...PROPERTY_VALUES }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(state.signedOut).toBeUndefined();
    expect(await snapshot(a.org.id)).toBe(beforeA);
    expect(await propertyAddress(a.assignment.id)).toBeNull();
  });
});

describe("1d savePropertyAction: roller (admin stenges aldri ute)", () => {
  it.each(["admin", "manager", "office", "inspector"] as const)(
    "%s får lagret eiendommen",
    async (role) => {
      const { org, assignment } = await orgWithAssignment();
      await setInspectorsEditAll(org.id, true);
      const user = await createUser();
      await createEmployee(user, org.id, [role]);
      signIn(user);

      const state = await savePropertyAction(
        initialFormState,
        form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
      );

      expect(state.message).toBeNull();
      expect(state.signedOut).toBeUndefined();
      expect(await propertyAddress(assignment.id)).toBe(ADDRESS);
      expect(mocks.saveAssignmentProperty).toHaveBeenCalledTimes(1);
      expect(mocks.saveAssignmentProperty.mock.calls[0]![1]).toBe(org.id);
    },
  );

  it("admin får lagret også med innstillingen access.inspectors_edit_all av", async () => {
    const { org, assignment } = await orgWithAssignment();
    await setInspectorsEditAll(org.id, false);
    const user = await createUser();
    await createEmployee(user, org.id, ["admin"]);
    signIn(user);
    const state = await savePropertyAction(
      initialFormState,
      form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
    );
    expect(state.message).toBeNull();
    expect(await propertyAddress(assignment.id)).toBe(ADDRESS);
  });

  it("utløpt innlogging, så ny innlogging som samme ansatt: Lagre lagrer verdiene", async () => {
    const { org, assignment } = await orgWithAssignment();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    await setInspectorsEditAll(org.id, true);

    const signedOut = await savePropertyAction(
      initialFormState,
      form({ assignmentId: assignment.id, ...PROPERTY_VALUES }),
    );
    expect(signedOut.signedOut).toBe(true);
    expect(await propertyAddress(assignment.id)).toBeNull();

    signIn(user);
    const state = await savePropertyAction(
      signedOut,
      form({ assignmentId: assignment.id, ...(signedOut.values as Record<string, string>) }),
    );
    expect(state.message).toBeNull();
    expect(await propertyAddress(assignment.id)).toBe(ADDRESS);
  });
});
