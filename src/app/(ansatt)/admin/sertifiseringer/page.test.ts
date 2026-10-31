import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Siden «Sertifiseringer» (bit 2). Kjernen er byttet ut; listen og tilgangen testes i
 * src/core/organization. Her: tom liste, merkene, datoformatet og lenken til den ansatte.
 * Støtter hovedmål: reklamasjoner (admin ser i tide hvem som må fornye).
 */

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  listExpiringCertifications: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../admin-context", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("@/core/organization", () => ({
  listExpiringCertifications: mocks.listExpiringCertifications,
}));

const { default: CertificationsPage } = await import("./page");

const ORG = "0190a000-0000-7000-8000-000000000001";
const actor = { id: "user-admin", email: "admin@eksempel.no", name: "Admin Testdatter" };

async function render(): Promise<string> {
  return renderToStaticMarkup(await CertificationsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  mocks.getAdminContext.mockResolvedValue({ actor, organizationId: ORG });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/admin/sertifiseringer", () => {
  it("ikke admin: «Ingen tilgang» uten kall til kjernen", async () => {
    mocks.getAdminContext.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("Ingen tilgang");
    expect(mocks.listExpiringCertifications).not.toHaveBeenCalled();
  });

  it("tom liste gir meldingen", async () => {
    mocks.listExpiringCertifications.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Ingen sertifiseringer går ut de neste 60 dagene.");
    expect(mocks.listExpiringCertifications).toHaveBeenCalledWith(actor, ORG);
  });

  it("viser navn med lenke, område, dato og merke", async () => {
    mocks.listExpiringCertifications.mockResolvedValue([
      {
        certificationId: "0190a000-0000-7000-8000-000000000041",
        employeeId: "0190a000-0000-7000-8000-000000000011",
        employeeName: "Kari Testdatter",
        area: "condition_report",
        validTo: "2026-10-30",
      },
      {
        certificationId: "0190a000-0000-7000-8000-000000000042",
        employeeId: "0190a000-0000-7000-8000-000000000012",
        employeeName: "Ola Testesen",
        area: "condition_report",
        validTo: "2026-12-30",
      },
    ]);
    const html = await render();
    expect(html).toContain('href="/admin/ansatte/0190a000-0000-7000-8000-000000000011"');
    expect(html).toContain("Kari Testdatter");
    expect(html).toContain("Tilstandsrapport bolig");
    expect(html).toContain("Gyldig til 30.10.2026");
    expect(html).toContain("Utgått");
    expect(html).toContain("Gyldig til 30.12.2026");
    expect(html).toContain("Går ut snart");
    expect(html).not.toContain("Ingen sertifiseringer går ut");
  });
});
