import { eq } from "drizzle-orm";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { removeContact, removeFirm } from "@/core/contacts";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import {
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { MergeHits } from "./merge-hits";

/*
 * Sidene /kontakter/[id]/sla-sammen og /firma/[id]/sla-sammen
 * (docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md 4.6 og 4.7).
 *
 * Det fantes ikke noe mønster for sidetester fra før. Sidene er asynkrone serverkomponenter, så
 * testen kaller sidefunksjonen direkte mot testdatabasen og leser treffene fra det den gir
 * tilbake (elementet `MergeHits`). Bare innloggingen og `notFound` er byttet ut; konteksten og
 * kjernen er ekte. Det viser selve siden, ikke bare funksjonene den bruker: 404 for den som mangler
 * `contacts.manage`, og at siden selv tar ut den åpne raden og kutter til 10 treff.
 *
 * Støtter hovedmål: reklamasjoner (takstmann og kontor kommer ikke inn, heller ikke via adressen,
 * og en fremmed eller fjernet id gir 404) og tid (høyst 10 treff, aldri den åpne eller fjernede).
 * Testdata er oppdiktet.
 */

const session = vi.hoisted(() => ({ actor: null as Actor | null }));
const NOT_FOUND = "NEXT_NOT_FOUND (test)";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND);
  }),
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

const { default: MergeContactsPage } = await import("./kontakter/[id]/sla-sammen/page");
const { default: MergeFirmsPage } = await import("./firma/[id]/sla-sammen/page");

type Page = typeof MergeContactsPage;

const PAGES = [
  ["/kontakter/[id]/sla-sammen", MergeContactsPage, "contact"],
  ["/firma/[id]/sla-sammen", MergeFirmsPage, "firm"],
] as const;

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});

function render(page: Page, id: string, search: { q?: string; med?: string } = {}) {
  return page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
}

async function expectNotFound(run: Promise<unknown>, why: string) {
  await expect(run, why).rejects.toThrow(NOT_FOUND);
}

/** Alle elementer av typen i treet siden gir tilbake (uten å tegne noe). */
function findElements(node: ReactNode, type: unknown): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child as ReactNode, type));
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  const own = node.type === type ? [{ props }] : [];
  return [...own, ...findElements(props.children as ReactNode, type)];
}

function hitIds(tree: ReactNode): string[] {
  const lists = findElements(tree, MergeHits);
  expect(lists, "siden viser treffene").toHaveLength(1);
  return (lists[0]!.props.hits as { id: string }[]).map((hit) => hit.id);
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function logInAs(organizationId: string, role: "admin" | "manager" | "inspector" | "office") {
  const actor = await createUser();
  await createEmployee(actor, organizationId, [role]);
  session.actor = actor;
  return actor;
}

/** Én kontakt og ett firma i hver av to organisasjoner. */
async function seed() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const firmA = await createFirm(orgA.id, { name: "Testmegling AS" });
  const firmB = await createFirm(orgB.id, { name: "Testmegling AS" });
  const contactA = await createContact(orgA.id, { firstName: "Megler", lastName: "Test" });
  const contactB = await createContact(orgB.id, { firstName: "Megler", lastName: "Test" });
  return {
    orgA,
    own: { contact: contactA.id, firm: firmA.id },
    foreign: { contact: contactB.id, firm: firmB.id },
  };
}

describe("4.6 merge_page_404_without_permission", () => {
  it.each(PAGES)("%s: leder og admin får siden (kontroll)", async (_route, page, kind) => {
    const { orgA, own } = await seed();
    for (const role of ["manager", "admin"] as const) {
      await logInAs(orgA.id, role);
      await expect(render(page, own[kind])).resolves.toBeTruthy();
    }
  });

  it.each(
    PAGES.flatMap(
      ([route, page, kind]) =>
        [
          [route, "takstmann, innstillingen av", page, kind, "inspector", false],
          [route, "takstmann, innstillingen på", page, kind, "inspector", true],
          [route, "kontor, innstillingen av", page, kind, "office", false],
          [route, "kontor, innstillingen på", page, kind, "office", true],
        ] as const,
    ),
  )("%s: %s gir notFound()", async (_route, who, page, kind, role, inspectorsEditAll) => {
    const { orgA, own } = await seed();
    await setInspectorsEditAll(orgA.id, inspectorsEditAll);
    await logInAs(orgA.id, role);
    await expectNotFound(render(page, own[kind]), who);
    // Også når den andre er valgt i adressen
    await expectNotFound(render(page, own[kind], { q: "Test", med: own[kind] }), who);
  });

  it.each(PAGES)(
    "%s: fremmed, ukjent og ugyldig id gir notFound() for admin",
    async (_route, page, kind) => {
      const { orgA, foreign } = await seed();
      await logInAs(orgA.id, "admin");
      await expectNotFound(render(page, foreign[kind]), "fremmed id");
      await expectNotFound(render(page, "0190a000-0000-7000-8000-0000000000ff"), "ukjent id");
      await expectNotFound(render(page, "abc"), "ugyldig id");
      await expectNotFound(render(page, ""), "tom id");
    },
  );

  it("/kontakter/[id]/sla-sammen: fjernet kontakt gir notFound()", async () => {
    const { orgA, own } = await seed();
    const actor = await logInAs(orgA.id, "manager");
    await removeContact(actor, orgA.id, own.contact);
    await expectNotFound(render(MergeContactsPage, own.contact), "fjernet kontakt");
  });

  it("/firma/[id]/sla-sammen: fjernet firma gir notFound()", async () => {
    const { orgA, own } = await seed();
    const actor = await logInAs(orgA.id, "manager");
    await removeFirm(actor, orgA.id, own.firm);
    await expectNotFound(render(MergeFirmsPage, own.firm), "fjernet firma");
  });

  it("uten ansattrad gir notFound()", async () => {
    const { own } = await seed();
    session.actor = await createUser();
    await expectNotFound(render(MergeContactsPage, own.contact), "kontakter");
    await expectNotFound(render(MergeFirmsPage, own.firm), "firma");
  });
});

describe("4.7 merge_search_excludes_self_and_removed", () => {
  it("/kontakter/[id]/sla-sammen: høyst 10 treff, aldri den åpne, fjernede eller fra B", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const actor = await logInAs(orgA.id, "manager");
    // Den åpne sorterer først, så den ville vært første treff om siden ikke tok den ut
    const open = await createContact(orgA.id, { firstName: "Megler", lastName: "Dublettsen 00" });
    const others: string[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const row = await createContact(orgA.id, {
        firstName: "Megler",
        lastName: `Dublettsen ${String(i).padStart(2, "0")}`,
      });
      others.push(row.id);
    }
    await removeContact(actor, orgA.id, others[0]!);
    const foreign = await createContact(orgB.id, {
      firstName: "Megler",
      lastName: "Dublettsen 00",
    });

    const ids = hitIds(await render(MergeContactsPage, open.id, { q: "Dublettsen" }));

    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(open.id);
    expect(ids).not.toContain(others[0]);
    expect(ids).not.toContain(foreign.id);
    for (const id of ids) expect(others).toContain(id);
  });

  it("/firma/[id]/sla-sammen: høyst 10 treff, aldri det åpne, fjernede eller fra B", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const actor = await logInAs(orgA.id, "manager");
    const open = await createFirm(orgA.id, { name: "Testmegling Dublett 00 AS" });
    const others: string[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const row = await createFirm(orgA.id, {
        name: `Testmegling Dublett ${String(i).padStart(2, "0")} AS`,
      });
      others.push(row.id);
    }
    await removeFirm(actor, orgA.id, others[0]!);
    const foreign = await createFirm(orgB.id, { name: "Testmegling Dublett 00 AS" });

    const ids = hitIds(await render(MergeFirmsPage, open.id, { q: "Dublett" }));

    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(open.id);
    expect(ids).not.toContain(others[0]);
    expect(ids).not.toContain(foreign.id);
    for (const id of ids) expect(others).toContain(id);
  });

  it("uten søketekst vises ingen treffliste", async () => {
    const orgA = await createOrganization("Organisasjon A");
    await logInAs(orgA.id, "manager");
    const open = await createContact(orgA.id, { firstName: "Megler", lastName: "Dublettsen" });
    await createContact(orgA.id, { firstName: "Megler", lastName: "Dublettsen 2" });
    const tree = await render(MergeContactsPage, open.id);
    expect(findElements(tree, MergeHits)).toHaveLength(0);
  });
});
