import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAssignment,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";
import {
  CREATED_FROM_OFFER_LINK_LABEL,
  CREATED_FROM_OFFER_MESSAGE,
  OWN_BOOKING_COPY_TEXT,
  TEAM_ANCHOR,
} from "./created-from-offer";

/*
 * Oppdraget etter «Gjør om til oppdrag» (docs/funksjoner/fase2a-tilbud.md F5 og T-0075, design
 * avsnitt 6, testplan 4.3 og 7.5, A367 og A368): kvitteringen med pekeren til «Team», ankeret,
 * lenken «Laget fra tilbud» og teksten om at tilbud og oppdrag har hver sin kopi. Bare
 * innloggingen, loggen og serverhandlingene er byttet ut; oppdraget leses av den ekte kjernen fra
 * testdatabasen. Oppdiktede data.
 * Støtter hovedmål: de ansatte (neste steg pekes ut) og færre reklamasjoner (teksten om kopiene
 * stemmer, så ingen tror at en rettelse på oppdraget også retter tilbudet).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/oppdrag/x",
  notFound: mocks.notFound,
  redirect: vi.fn(),
}));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("./actions", () => ({
  addPartyAction: vi.fn(),
  cancelAssignmentAction: vi.fn(),
  changeStatusAction: vi.fn(),
  removePartyAction: vi.fn(),
  saveCommonAreasAction: vi.fn(),
  savePropertyAction: vi.fn(),
  setAgreementAction: vi.fn(),
  setScheduleAction: vi.fn(),
  setTeamMemberAction: vi.fn(),
  updatePartyAction: vi.fn(),
}));
vi.mock("./booking-actions", () => ({ updateAssignmentBookingAction: vi.fn() }));
vi.mock("./work-session-action", () => ({ recordWorkActivityAction: vi.fn() }));

const { CreatedFromOfferNotice } = await import("./created-from-offer-notice");
const { default: AssignmentPage } = await import("./page");

const PAGE_SOURCE = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

async function setup() {
  const organization = await createOrganization();
  const office = await createOffice(organization.id, { name: "Testkontor Bodø" });
  const actor = await createUser({ name: "Test Kontor Oppdrag" });
  await createEmployee(actor, organization.id, ["office"]);
  // Statusen på tilbudet spiller ingen rolle for oppdragssiden; oppdraget peker på tilbudet.
  const order = await createOrder(organization.id, { addressText: "Tilbudsveien 5, 8006 Bodø" });
  const fromOffer = await createAssignment(organization.id, {
    officeId: office.id,
    orderId: order.id,
    addressText: "Tilbudsveien 5, 8006 Bodø",
  });
  const direct = await createAssignment(organization.id, {
    officeId: office.id,
    addressText: "Direkteveien 9, 8006 Bodø",
  });
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: organization.id,
    canEditOrders: true,
    canCreateAssignments: true,
    canManageContacts: false,
    canReadClaims: false,
    canManageClaims: false,
    canManageOrganization: false,
    canReadStatistics: false,
    defaultMineOnly: false,
    officeId: office.id,
  });
  return { organization, actor, order, fromOffer, direct };
}

async function renderPage(id: string, searchParams: Record<string, string> = {}) {
  const element = await AssignmentPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

beforeEach(async () => {
  await resetDatabase();
  mocks.getEmployeeContext.mockReset();
  mocks.replace.mockClear();
  mocks.notFound.mockClear();
});

describe("kvitteringen etter omgjøring (F5)", () => {
  it("teksten og lenken er låst (A367)", () => {
    expect(CREATED_FROM_OFFER_MESSAGE).toBe("Oppdraget er laget.");
    expect(CREATED_FROM_OFFER_LINK_LABEL).toBe("Velg takstmann og befaringsdato");
    expect(TEAM_ANCHOR).toBe("takstmann");
  });

  it("med show: role=status, meldingen og lenken til #takstmann", () => {
    const html = renderToStaticMarkup(createElement(CreatedFromOfferNotice, { show: true }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Oppdraget er laget.");
    expect(html).toMatch(/<a[^>]*href="#takstmann"[^>]*>Velg takstmann og befaringsdato/);
    // Lenken er minst 44 px høy (Notice med lenke).
    expect(/<a[^>]*>/.exec(html)?.[0]).toContain("min-h-11");
  });

  it("uten show: ingenting", () => {
    expect(renderToStaticMarkup(createElement(CreatedFromOfferNotice, { show: false }))).toBe("");
  });

  it("parameteren tas bort med router.replace når kvitteringen er vist (T-0089-mønsteret)", () => {
    const source = readFileSync(path.join(__dirname, "created-from-offer-notice.tsx"), "utf8");
    expect(source).toMatch(/if \(show\) router\.replace\(pathname, \{ scroll: false \}\)/);
    expect(source).toContain("useState(show)");
  });

  it("siden med ?fra=tilbud viser kvitteringen; uten parameteren gjør den ikke det", async () => {
    const { fromOffer } = await setup();
    const shown = await renderPage(fromOffer.id, { fra: "tilbud" });
    expect(shown).toContain("Oppdraget er laget.");
    expect(shown).toContain('href="#takstmann"');

    const plain = await renderPage(fromOffer.id);
    expect(plain).not.toContain("Oppdraget er laget.");
    expect(plain).not.toContain("Velg takstmann og befaringsdato");

    const other = await renderPage(fromOffer.id, { fra: "noe-annet" });
    expect(other).not.toContain("Oppdraget er laget.");
  });

  it("ankeret står på seksjonen «Team», som kan få fokus (A368)", async () => {
    const { fromOffer } = await setup();
    const html = await renderPage(fromOffer.id, { fra: "tilbud" });
    const section = /<section[^>]*id="takstmann"[^>]*>/.exec(html)?.[0] ?? "";
    expect(section).toContain('tabindex="-1"');
    expect(section).toContain('aria-labelledby="team-heading"');
    expect(html.match(/id="takstmann"/g)).toHaveLength(1);
    // Kvitteringen står over seksjonen.
    expect(html.indexOf("Oppdraget er laget.")).toBeLessThan(html.indexOf('id="takstmann"'));
  });
});

describe("«Laget fra tilbud» og T-0075 på oppdraget (testplan 4.3)", () => {
  it("oppdrag laget fra tilbud lenker til /tilbud/<id> med nye tekster", async () => {
    const { fromOffer, order } = await setup();
    const html = await renderPage(fromOffer.id);
    expect(html).toContain(`href="/tilbud/${order.id}"`);
    expect(html).toContain("Laget fra tilbud");
    expect(html).toContain("Åpne tilbudet");
    expect(html).toMatch(/Tilbudet<\/a>/);
    expect(html).not.toContain("/ordre");
    expect(html).not.toMatch(/\bordre(?!nummer|nr)/i);
  });

  it("T-0075: teksten sier at oppdraget har sin egen kopi, og påstår ikke noe annet", async () => {
    expect(OWN_BOOKING_COPY_TEXT).toBe(
      "Oppdraget har sin egen kopi av bestillingen. Endringer her endrer ikke tilbudet.",
    );
    const { fromOffer } = await setup();
    const html = await renderPage(fromOffer.id);
    expect(html).toContain(OWN_BOOKING_COPY_TEXT);
    expect(html).not.toContain("Rettelser for oppdraget gjøres på oppdraget.");
    expect(html).not.toContain("Fylt ut fra ordren");
  });

  it("oppdrag laget direkte har verken lenken eller teksten om kopien", async () => {
    const { direct } = await setup();
    const html = await renderPage(direct.id);
    expect(html).not.toContain("Laget fra tilbud");
    expect(html).not.toContain("/tilbud/");
    expect(html).not.toContain(OWN_BOOKING_COPY_TEXT);
  });

  it("annen organisasjons oppdrag gir «ikke funnet», også med ?fra=tilbud", async () => {
    const { fromOffer } = await setup();
    // Ansatt i organisasjon B åpner oppdraget i A (organisasjonen kommer fra innloggingen).
    const other = await createOrganization("Organisasjon B");
    const stranger = await createUser({ name: "Kontor B" });
    await createEmployee(stranger, other.id, ["admin"]);
    mocks.getEmployeeContext.mockResolvedValue({
      actor: stranger,
      organizationId: other.id,
      canEditOrders: true,
      canCreateAssignments: true,
      canManageContacts: false,
      canReadClaims: false,
      canManageClaims: false,
      canManageOrganization: true,
      canReadStatistics: false,
      defaultMineOnly: false,
      officeId: null,
    });
    await expect(renderPage(fromOffer.id, { fra: "tilbud" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("siden har ingen lenker til /ordre i kildeteksten", () => {
    expect(PAGE_SOURCE).not.toMatch(/["'`]\/ordre(\/|["'`?#])/);
  });
});
