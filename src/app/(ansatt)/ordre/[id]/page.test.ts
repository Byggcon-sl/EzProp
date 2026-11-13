import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";

/*
 * Ordresiden med varselet «Mulig dublett» (docs/funksjoner/fase2a-varsel-dublett-testplan.md
 * avsnitt 6). Bare innloggingen, loggen og serverhandlingene er byttet ut; ordren leses av den
 * ekte kjernen fra testdatabasen. Oppslaget for dubletter pakkes inn, så testen kan tvinge feil.
 * Oppdiktede data.
 *
 * Støtter hovedmål: de ansatte (ordresiden blir aldri utilgjengelig på grunn av varselet) og
 * færre reklamasjoner (varselet står der når regelen gir treff).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  findPossibleDuplicateOrders: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("../actions", () => ({
  convertOrderAction: vi.fn(),
  rejectOrderAction: vi.fn(),
  updateOrderAction: vi.fn(),
}));
vi.mock("@/core/orders", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/orders")>();
  return { ...original, findPossibleDuplicateOrders: mocks.findPossibleDuplicateOrders };
});

const { default: OrderPage } = await import("./page");

const ADDRESS = "Dublettveien 77B, 8009 Bodø";
const CADASTRE = { gnr: "98765", bnr: "54321", snr: "13579" };

async function setup() {
  const organization = await createOrganization();
  await createOffice(organization.id);
  const actor = await createUser({ name: "Test Kontor Dublett" });
  await createEmployee(actor, organization.id, ["office"]);
  const order = await createOrder(organization.id, { addressText: ADDRESS, ...CADASTRE });
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: organization.id,
    canEditOrders: true,
    canManageContacts: false,
    canReadClaims: false,
    canManageClaims: false,
    canManageOrganization: false,
    canReadStatistics: false,
    defaultMineOnly: false,
    officeId: null,
  });
  return { organization, actor, order };
}

async function renderPage(orderId: string, endret?: string) {
  const element = await OrderPage({
    params: Promise.resolve({ id: orderId }),
    searchParams: Promise.resolve(endret ? { endret } : {}),
  });
  return renderToStaticMarkup(element);
}

beforeEach(async () => {
  await resetDatabase();
  mocks.getEmployeeContext.mockReset();
  mocks.findPossibleDuplicateOrders.mockReset();
  mocks.log.error.mockClear();
  mocks.log.warn.mockClear();
  mocks.log.info.mockClear();
});

describe("ordresiden og varselet «Mulig dublett»", () => {
  it("kaller oppslaget med organisasjonen fra innloggingen og viser varselet", async () => {
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
    const html = await renderPage(order.id, "1");
    expect(mocks.findPossibleDuplicateOrders).toHaveBeenCalledWith(
      actor,
      organization.id,
      order.id,
    );
    expect(html).toContain("Mulig dublett");
    expect(html).toContain('href="/ordre/22222222-2222-4222-8222-222222222222"');
    // Kvitteringen står over varselet.
    expect(html.indexOf("Endringene er lagret.")).toBeLessThan(html.indexOf("Mulig dublett"));
  });

  it("ingen treff gir ingen varsel", async () => {
    const { order } = await setup();
    mocks.findPossibleDuplicateOrders.mockResolvedValue({ items: [], hasMore: false });
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
    // Ordren og knappene vises som vanlig.
    expect(html).toContain(ADDRESS);
    expect(html).toContain("Gjør om til oppdrag");
    expect(html).toContain("Avvis");
    expect(html).toContain("Endre ordren");

    expect(mocks.log.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.log.error.mock.calls);
    for (const value of [ADDRESS, "Dublettveien", CADASTRE.gnr, CADASTRE.bnr, CADASTRE.snr]) {
      expect(logged).not.toContain(value);
    }
    expect(logged).not.toContain(failure.message);
  });
});
