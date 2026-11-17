import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import {
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";

/*
 * Ordresiden når oppslaget om mulig dublett feiler (T3). Testplan:
 * docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 6.1. Ordren leses av den ekte kjernen
 * fra testdatabasen; bare innloggingen, loggen, serverhandlingene og oppslaget om dubletter er
 * byttet ut, slik at testen kan tvinge feilen. Oppdiktede data.
 *
 * Støtter hovedmål: de ansatte (tilbudssiden og knappene virker selv om varselet feiler) og færre
 * reklamasjoner (ingen adresse eller matrikkel i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  findPossibleDuplicateOrders: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
vi.mock("@/core/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orders")>()),
  findPossibleDuplicateOrders: mocks.findPossibleDuplicateOrders,
}));

const { default: OfferPage } = await import("./page");

const ADDRESS = "Feilveien 31K, 8010 Prøvested";
const SECRETS = [ADDRESS, "Feilveien", "feilveien31k", "Prøvested", "86421", "97531", "24680"];

async function setup() {
  const organization = await createOrganization();
  await createOffice(organization.id, { name: "Bodø" });
  const actor: Actor = await createUser({ name: "Test Kontor Feil" });
  await createEmployee(actor, organization.id, ["office"]);
  const order = await createOrder(organization.id, {
    addressText: ADDRESS,
    gnr: "86421",
    bnr: "97531",
    snr: "24680",
  });
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

async function renderPage(orderId: string, searchParams: Record<string, string> = {}) {
  const element = await OfferPage({
    params: Promise.resolve({ id: orderId }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

function loggedText(): string {
  return Object.values(mocks.log)
    .flatMap((fn) => fn.mock.calls)
    .map((call) =>
      JSON.stringify(call, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      ),
    )
    .join("\n");
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("6 tilbudssiden når oppslaget om mulig dublett feiler", () => {
  it.each([
    [
      "en vanlig feil med adressen i meldingen",
      () => new Error(`Failed query ... ${ADDRESS} 86421`),
    ],
    ["en feil som ikke er Error", () => ({ detail: ADDRESS })],
  ])(
    "6.1 %s: siden vises med tilbudet og knappene, uten varsel, og loggen har ingen verdier",
    async (_name, makeError) => {
      const { organization, actor, order } = await setup();
      mocks.findPossibleDuplicateOrders.mockRejectedValue(makeError());

      const html = await renderPage(order.id, { ny: "1" });

      // Oppslaget ble gjort med organisasjonen fra innloggingen
      expect(mocks.findPossibleDuplicateOrders).toHaveBeenCalledWith(
        actor,
        organization.id,
        order.id,
      );
      // Ordren, kvitteringen og knappene står; varselet står ikke
      expect(html).toContain(ADDRESS);
      expect(html).toContain("Tilbudet er laget.");
      expect(html).toContain("Gjør om til oppdrag");
      expect(html).toContain("Avslå tilbud");
      expect(html).toContain("Endre tilbudet");
      expect(html).not.toContain("Mulig dublett");

      // Feilen logges, uten adresse, matrikkel eller feilteksten
      expect(mocks.log.error.mock.calls.length + mocks.log.warn.mock.calls.length).toBeGreaterThan(
        0,
      );
      const logged = loggedText();
      for (const secret of SECRETS) {
        expect(logged.includes(secret), `«${secret}» i loggen`).toBe(false);
      }
      expect(logged).not.toContain("Failed query");
    },
  );

  it("6.1 kontroll: med treff står varselet under knappen", async () => {
    const { order } = await setup();
    mocks.findPossibleDuplicateOrders.mockResolvedValue({
      items: [
        {
          id: "0190a000-0000-7000-8000-000000000201",
          receivedAt: new Date("2026-11-02T08:00:00Z"),
          addressText: "feilveien 31 k",
          status: "received",
          assignmentNumber: null,
          assignmentStatus: null,
          reasons: ["address"],
        },
      ],
      hasMore: false,
    });
    const html = await renderPage(order.id, { ny: "1" });
    expect(html).toContain("Mulig dublett");
    expect(html).toContain('href="/tilbud/0190a000-0000-7000-8000-000000000201"');
    // Rekkefølge (A369): kvitteringen, så knappen, så varselet
    const saved = html.indexOf("Tilbudet er laget.");
    const notice = html.search(/<h2[^>]*>Mulig dublett<\/h2>/);
    expect(saved).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(saved);
    expect(html.indexOf("Gjør om til oppdrag")).toBeLessThan(notice);
    expect(html.indexOf("Gjør om til oppdrag")).toBeGreaterThan(saved);
    // A369: én linje over knappen peker ned til varselet.
    expect(html.indexOf("Se varselet under")).toBeLessThan(html.indexOf("Gjør om til oppdrag"));
  });
});
