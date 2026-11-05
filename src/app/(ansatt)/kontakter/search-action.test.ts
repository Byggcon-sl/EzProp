import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import {
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../tests/factories";

/*
 * Søket i kontaktvelgeren mot testdatabasen (docs/funksjoner/fase2a-koble-kontakter-testplan.md
 * 8.4 og 8.5). Bare innloggingen er byttet ut; `getEmployeeContext` og `listContacts` er ekte, så
 * testen viser at organisasjonen kommer fra serveren og at treffene aldri er fra en annen
 * organisasjon. Ingen ny kjernefunksjon (`listContacts` har sin egen tenant-test i
 * src/core/contacts/contacts.test.ts).
 *
 * Støtter hovedmål: tid (megleren finnes med noen bokstaver) og reklamasjoner (aldri en kontakt
 * fra en annen organisasjon i trefflisten). Testdata er oppdiktet.
 */

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/core/auth/session", () => ({
  requireActor: vi.fn(async () => {
    if (!session.actor) throw new Error("ikke innlogget (test)");
    return session.actor;
  }),
  getCurrentActor: vi.fn(async () => session.actor),
  LOGIN_PATH: "/logg-inn",
}));

const { searchContactsAction } = await import("./actions");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});

/** Organisasjon A med 12 kontakter som passer, og B med 1 som passer. */
async function seed() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const firmA = await createFirm(orgA.id, { name: "Testmegling AS" });
  const firmB = await createFirm(orgB.id, { name: "Testmegling AS" });
  const idsA: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const contact = await createContact(orgA.id, {
      firstName: "Megler",
      lastName: `Testesen ${String(i).padStart(2, "0")}`,
      email: `megler${i}@example.com`,
      phone: "00000000",
      firmId: firmA.id,
    });
    idsA.push(contact.id);
  }
  const contactB = await createContact(orgB.id, {
    firstName: "Megler",
    lastName: "Testesen B",
    email: "megler.b@example.com",
    phone: "00000000",
    firmId: firmB.id,
  });
  return { orgA, orgB, firmA, idsA, contactB };
}

describe("8. searchContactsAction mot testdatabasen", () => {
  it("8.4 search_returns_max_10_own_org_only: 12 i A og 1 i B gir 10 treff, alle fra A, med fem felt", async () => {
    const s = await seed();
    const actor = await createUser({ name: "Kontor Test" });
    await createEmployee(actor, s.orgA.id, ["office"]);
    session.actor = actor;

    const hits = await searchContactsAction("Megl");

    expect(hits).toHaveLength(10);
    for (const hit of hits) {
      expect(s.idsA).toContain(hit.id);
      expect(hit.id).not.toBe(s.contactB.id);
      expect(Object.keys(hit).sort()).toEqual(["email", "firmName", "id", "name", "phone"]);
      expect(hit.firmName).toBe("Testmegling AS");
      expect(hit.phone).toBe("00000000");
      expect(hit.email).toMatch(/^megler\d+@example\.com$/);
      expect(hit.name).toContain("Megler");
      expect(hit.name).toContain("Testesen");
    }
  });

  it("8.4b takstmann i B ser bare B sin kontakt", async () => {
    const s = await seed();
    const actor = await createUser();
    await createEmployee(actor, s.orgB.id, ["inspector"]);
    session.actor = actor;

    const hits = await searchContactsAction("Testesen");

    expect(hits.map((hit) => hit.id)).toEqual([s.contactB.id]);
  });

  it("8.4c søket treffer firmanavnet og e-posten", async () => {
    const s = await seed();
    const actor = await createUser();
    await createEmployee(actor, s.orgA.id, ["office"]);
    session.actor = actor;

    expect((await searchContactsAction("megler3@example")).map((hit) => hit.id)).toEqual([
      s.idsA[3],
    ]);
    expect(await searchContactsAction("Testmegling")).toHaveLength(10);
  });

  it("8.4d slettet kontakt i egen organisasjon vises ikke", async () => {
    const org = await createOrganization();
    await createContact(org.id, {
      firstName: "Slettet",
      lastName: "Kontakt",
      deletedAt: new Date("2026-11-01T08:00:00Z"),
    });
    const actor = await createUser();
    await createEmployee(actor, org.id, ["admin"]);
    session.actor = actor;

    expect(await searchContactsAction("Slettet")).toEqual([]);
  });

  it("8.5 search_no_access_gives_no_hits: bruker uten ansattrad får ingen treff (ingen unntak)", async () => {
    await seed();
    session.actor = await createUser();

    await expect(searchContactsAction("Megler")).resolves.toEqual([]);
  });

  it.each([
    ["slettet ansattkobling", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
    ["deaktivert ansatt", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)("8.5 %s (admin) får ingen treff (ingen unntak)", async (_name, set) => {
    const s = await seed();
    const actor = await createUser();
    const employee = await createEmployee(actor, s.orgA.id, ["admin"]);
    await db.update(employees).set(set).where(eq(employees.id, employee.id));
    session.actor = actor;

    await expect(searchContactsAction("Megler")).resolves.toEqual([]);
  });

  it("8.5b ansatt uten roller får ingen treff (ingen unntak)", async () => {
    const s = await seed();
    const actor = await createUser();
    await createEmployee(actor, s.orgA.id, []);
    session.actor = actor;

    await expect(searchContactsAction("Megler")).resolves.toEqual([]);
  });
});
