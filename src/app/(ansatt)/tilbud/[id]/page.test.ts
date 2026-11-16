import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import {
  createAssignment,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";

/*
 * Tilbudssiden (docs/funksjoner/fase2a-tilbud-testplan.md avsnitt 4.2 og 4.3.2, og
 * docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 6). Bare innloggingen, loggen og
 * serverhandlingene er byttet ut; tilbudet leses av den ekte kjernen fra testdatabasen. Oppslaget
 * for dubletter pakkes inn, så testen kan tvinge feil. Datoene regnes fra dagens dato, så et
 * utløpt tilbud alltid er utløpt. Oppdiktede data.
 *
 * Støtter hovedmål: de ansatte («Gjør om til oppdrag» står øverst, kontoret er valgt) og færre
 * reklamasjoner (varselet står der når regelen gir treff, og teksten om kopiene stemmer).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  findPossibleDuplicateOrders: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/tilbud",
  redirect: vi.fn(),
}));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("../actions", () => ({
  convertOfferAction: vi.fn(),
  extendOfferAction: vi.fn(),
  rejectOfferAction: vi.fn(),
  updateOfferAction: vi.fn(),
}));
vi.mock("@/core/orders", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/orders")>();
  return { ...original, findPossibleDuplicateOrders: mocks.findPossibleDuplicateOrders };
});

const { default: OfferPage } = await import("./page");

const ADDRESS = "Dublettveien 77B, 8009 Bodø";
const CADASTRE = { gnr: "98765", bnr: "54321", snr: "13579" };
const TODAY = todayInOslo();

type Setup = { officeId?: string | null; order?: Parameters<typeof createOrder>[1] };

async function setup({ officeId = undefined, order: overrides = {} }: Setup = {}) {
  const organization = await createOrganization();
  const office = await createOffice(organization.id, { name: "Testkontor Bodø" });
  const actor = await createUser({ name: "Test Kontor Tilbud" });
  await createEmployee(actor, organization.id, ["office"]);
  const order = await createOrder(organization.id, {
    addressText: ADDRESS,
    ...CADASTRE,
    validUntil: addDays(TODAY, 20),
    ...overrides,
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
    officeId: officeId === undefined ? office.id : officeId,
  });
  return { organization, actor, order, office };
}

async function renderPage(orderId: string, searchParams: Record<string, string> = {}) {
  const element = await OfferPage({
    params: Promise.resolve({ id: orderId }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

beforeEach(async () => {
  await resetDatabase();
  mocks.getEmployeeContext.mockReset();
  mocks.findPossibleDuplicateOrders.mockReset();
  mocks.findPossibleDuplicateOrders.mockResolvedValue({ items: [], hasMore: false });
  mocks.log.error.mockClear();
  mocks.log.warn.mockClear();
  mocks.log.info.mockClear();
});

describe("tilbudssiden og varselet «Mulig dublett»", () => {
  it("kaller oppslaget med organisasjonen fra innloggingen og viser varselet under knappen", async () => {
    const { organization, actor, order } = await setup();
    mocks.findPossibleDuplicateOrders.mockResolvedValue({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          receivedAt: new Date("2026-11-01T10:00:00Z"),
          addressText: "Dublettveien 77 b",
          status: "received",
          assignmentNumber: null,
          assignmentStatus: null,
          reasons: ["address"],
        },
      ],
      hasMore: false,
    });
    const html = await renderPage(order.id, { ny: "1" });
    expect(mocks.findPossibleDuplicateOrders).toHaveBeenCalledWith(
      actor,
      organization.id,
      order.id,
    );
    expect(html).toContain('href="/tilbud/22222222-2222-4222-8222-222222222222"');
    const heading = html.search(/<h2[^>]*>Mulig dublett<\/h2>/);
    expect(heading).toBeGreaterThan(-1);
    // Kvitteringen, så knappen, så varselet (A369). Linjen over knappen peker ned.
    expect(html.indexOf("Tilbudet er laget.")).toBeLessThan(html.indexOf("Gjør om til oppdrag"));
    expect(html.indexOf("Gjør om til oppdrag")).toBeLessThan(heading);
    expect(html).toContain('href="#mulig-dublett-tittel"');
    expect(html.indexOf("Se varselet under")).toBeLessThan(html.indexOf("Gjør om til oppdrag"));
  });

  it("ingen treff gir ingen varsel og ingen linje over knappen", async () => {
    const { order } = await setup();
    const html = await renderPage(order.id);
    expect(html).not.toContain("Mulig dublett");
  });

  it.each([
    ["databasefeil", new Error(`feil i spørringen for ${ADDRESS} ${CADASTRE.gnr}/${CADASTRE.bnr}`)],
    ["tilgangsfeil", Object.assign(new Error("ingen tilgang"), { name: "AccessDeniedError" })],
  ])("%s i oppslaget gir siden uten varsel og logg uten verdier", async (_name, failure) => {
    const { order } = await setup();
    mocks.findPossibleDuplicateOrders.mockRejectedValue(failure);
    const html = await renderPage(order.id);

    expect(html).not.toContain("Mulig dublett");
    expect(html).toContain(ADDRESS);
    expect(html).toContain("Gjør om til oppdrag");
    expect(html).toContain("Avslå tilbud");
    expect(html).toContain("Endre tilbudet");

    expect(mocks.log.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.log.error.mock.calls);
    for (const value of [ADDRESS, "Dublettveien", CADASTRE.gnr, CADASTRE.bnr, CADASTRE.snr]) {
      expect(logged).not.toContain(value);
    }
    expect(logged).not.toContain(failure.message);
  });
});

describe("4.2 rekkefølge, knapper og kontor", () => {
  it("4.2.1 tittel, merke, «Gjør om til oppdrag», «Avslå tilbud» og så detaljkortet", async () => {
    const { order } = await setup();
    const html = await renderPage(order.id);
    const positions = [
      html.search(/<h1[^>]*>/),
      html.indexOf("Åpent"),
      html.indexOf('id="gjor-om"'),
      html.indexOf("Gjør om til oppdrag"),
      html.indexOf("Avslå tilbud"),
      html.indexOf("<dl"),
      html.indexOf("Endre tilbudet"),
      html.indexOf("Endringer"),
    ];
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Hovedknappen er 56 px.
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*class="[^"]*min-h-14[^"]*"[^>]*>Gjør om til oppdrag/,
    );
  });

  it.each([
    ["åpent", { validUntil: addDays(TODAY, 20) }],
    ["utløpt", { validUntil: addDays(TODAY, -3) }],
  ])("4.2.2 knappene vises for %s tilbud", async (_name, overrides) => {
    const { order } = await setup({ order: overrides });
    const html = await renderPage(order.id);
    expect(html).toContain("Gjør om til oppdrag");
    expect(html).toContain("Avslå tilbud");
  });

  it("4.2.2 knappene vises ikke for avslått tilbud, og «Avslått: Pris» står med teksten", async () => {
    const { order } = await setup({
      order: { status: "rejected", rejectedReasonKey: "price", rejectedReason: "For dyrt nå" },
    });
    const html = await renderPage(order.id);
    expect(html).not.toContain("Gjør om til oppdrag");
    expect(html).not.toContain(">Avslå tilbud<");
    expect(html).not.toContain("Forleng 30 dager");
    expect(html).toContain("Avslått: Pris");
    expect(html).toContain("For dyrt nå");
    expect(html).toContain("Endre tilbudet");
  });

  it("4.2.2 knappene vises ikke for tilbud som er gjort om; lenken går til oppdraget", async () => {
    const { organization } = await setup();
    const assignment = await createAssignment(organization.id, { number: "2026-04242" });
    const order = await createOrder(organization.id, {
      addressText: ADDRESS,
      validUntil: addDays(TODAY, 20),
      status: "converted",
      assignmentId: assignment.id,
    });
    const html = await renderPage(order.id);
    expect(html).not.toContain(">Gjør om til oppdrag<");
    expect(html).not.toContain(">Avslå tilbud<");
    expect(html).toContain(`href="/oppdrag/${assignment.id}"`);
    expect(html).toContain("Gjort om til oppdrag");
  });

  it("T-0031: oppdraget er kansellert → nummeret med «(kansellert)» og ingen lenke", async () => {
    const { organization } = await setup();
    const assignment = await createAssignment(organization.id, {
      number: "2026-04243",
      deletedAt: new Date("2026-11-10T10:00:00Z"),
    });
    const order = await createOrder(organization.id, {
      addressText: ADDRESS,
      validUntil: addDays(TODAY, 20),
      status: "converted",
      assignmentId: assignment.id,
    });
    const html = await renderPage(order.id);
    expect(html).toContain("2026-04243");
    expect(html).toContain("(kansellert)");
    expect(html).not.toContain(`href="/oppdrag/${assignment.id}"`);
  });

  it("4.2.3 med kontor: kontoret er forhåndsvalgt (skjult felt og «Kontor: …»), ingen radioer", async () => {
    const { order, office } = await setup();
    const html = await renderPage(order.id);
    expect(html).toMatch(new RegExp(`<input type="hidden" name="officeId" value="${office.id}"`));
    expect(html).toContain("Kontor: Testkontor Bodø");
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*name="officeId"/);
    expect(html).not.toContain("<select");
  });

  it("4.2.3 flere kontorer: «Velg et annet kontor» med radioer og den ansattes valgt", async () => {
    const { organization, order, office } = await setup();
    await createOffice(organization.id, { name: "Testkontor Mo" });
    const html = await renderPage(order.id);
    expect(html).toContain("Velg et annet kontor");
    expect(html).toMatch(/<details/);
    expect(html.match(/<input[^>]*type="radio"[^>]*name="officeId"/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<input[^>]*value="${office.id}"[^>]*checked`));
  });

  it("4.2.3 uten kontor (admin): radioene står over knappen, uten noe valgt", async () => {
    const { order } = await setup({ officeId: null });
    const html = await renderPage(order.id);
    expect(html).not.toContain("Kontor: ");
    const radio = html.search(/<input[^>]*type="radio"[^>]*name="officeId"/);
    expect(radio).toBeGreaterThan(-1);
    expect(radio).toBeLessThan(html.indexOf("Gjør om til oppdrag"));
    expect(html).not.toMatch(/<input[^>]*name="officeId"[^>]*checked/);
  });

  it("4.2.4 utløpt: «Utløpt [dato]» i merket, «Forleng 30 dager» vises", async () => {
    const validUntil = addDays(TODAY, -3);
    const { order } = await setup({ order: { validUntil } });
    const html = await renderPage(order.id);
    const [y, m, d] = validUntil.split("-");
    expect(html).toContain(`Utløpt ${d}.${m}.${y}`);
    expect(html).toContain("Forleng 30 dager");
  });

  it("F3: åpent med 3 dager igjen viser «Går ut om 3 dager» og «Forleng 30 dager»", async () => {
    const { order } = await setup({ order: { validUntil: addDays(TODAY, 3) } });
    const html = await renderPage(order.id);
    expect(html).toContain("Går ut om 3 dager");
    expect(html).toContain("Forleng 30 dager");
    expect(html).not.toContain(">Åpent<");
  });

  it("F1: åpent med 20 dager igjen har ikke «Forleng 30 dager»", async () => {
    const { order } = await setup();
    const html = await renderPage(order.id);
    expect(html).not.toContain("Forleng 30 dager");
    expect(html).toContain("Åpent");
  });

  it("uten endringsrett: bare visning (ingen knapper, ingen «Endre tilbudet»)", async () => {
    const { order } = await setup();
    const context = await mocks.getEmployeeContext();
    mocks.getEmployeeContext.mockResolvedValue({ ...context, canEditOrders: false });
    const html = await renderPage(order.id);
    expect(html).toContain(ADDRESS);
    expect(html).not.toContain("Gjør om til oppdrag");
    expect(html).not.toContain("Endre tilbudet");
  });

  it("detaljkortet sier «Meglerens ordrenummer», «Matrikkel» og «Gyldig til»", async () => {
    const { order } = await setup({ order: { externalRef: "TEST-55" } });
    const html = await renderPage(order.id);
    expect(html).toContain("Meglerens ordrenummer");
    expect(html).toContain("Gnr. 98765, bnr. 54321, snr. 13579");
    expect(html).toContain("Gyldig til");
    expect(html).not.toContain("Ekstern referanse");
  });

  it("?ny=1 viser «Tilbudet er laget. Gyldig til [dato].», uten parameteren ingen kvittering", async () => {
    const validUntil = addDays(TODAY, 30);
    const { order } = await setup({ order: { validUntil } });
    const [y, m, d] = validUntil.split("-");
    expect(await renderPage(order.id, { ny: "1" })).toContain(
      `Tilbudet er laget. Gyldig til ${d}.${m}.${y}.`,
    );
    expect(await renderPage(order.id)).not.toContain("Tilbudet er laget.");
    // T-0089: «Endringene er lagret.» kommer aldri fra adressen.
    expect(await renderPage(order.id, { endret: "1" })).not.toContain("Endringene er lagret.");
  });

  it("fremmed eller ukjent id gir samme svar som manglende tilgang", async () => {
    await setup();
    const html = await renderPage("33333333-3333-4333-8333-333333333333");
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toContain("Gjør om til oppdrag");
  });
});
