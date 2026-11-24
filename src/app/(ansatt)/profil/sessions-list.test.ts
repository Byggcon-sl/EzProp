import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/config/brand";

/*
 * Profilsiden og listen «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger-testplan.md
 * avsnitt 8.1–8.6 og 8.9). Markupen med `renderToStaticMarkup`, F3 som ren funksjon. Navn, e-post,
 * id-er og user-agenter er oppdiktet.
 * Støtter hovedmål: de ansatte (raden sier tydelig hvilken enhet det er, og knappen sier hvilken
 * enhet den logger ut).
 */

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  listOwnSessions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/core/auth/auth-client", () => ({ authClient: { signOut: vi.fn(async () => ({})) } }));
vi.mock("@/core/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/core/auth/sessions-list", () => ({ listOwnSessions: mocks.listOwnSessions }));
vi.mock("./actions", () => ({
  revokeOwnSessionAction: vi.fn(),
  revokeOtherOwnSessionsAction: vi.fn(),
}));

const { SessionsList, localDeviceView } = await import("./sessions-list");
const { default: ProfilePage } = await import("./page");

const here = path.dirname(fileURLToPath(import.meta.url));
const noop = vi.fn();

const current = {
  id: "okt-ipad",
  device: "iPad",
  browser: "Safari",
  lastUsedLabel: "Aktiv nå",
  createdLabel: "logget inn 3. nov.",
  isCurrent: true,
};
const other = {
  id: "okt-pc",
  device: "Windows-PC",
  browser: "Edge",
  lastUsedLabel: "Aktiv i går",
  createdLabel: "logget inn 1. nov.",
  isCurrent: false,
};

function render(sessions: (typeof current)[]): string {
  return renderToStaticMarkup(
    createElement(SessionsList, { sessions, revokeOne: noop, revokeOthers: noop }),
  );
}

/** Tekst uten tagger, så vi kan lese det skjermleseren leser. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireActor.mockResolvedValue({
    id: "user-1",
    email: "tea.testdatter@example.com",
    name: "Tea Testdatter",
    sessionId: "okt-ipad",
  });
  mocks.listOwnSessions.mockResolvedValue([
    {
      id: "okt-ipad",
      device: "iPad",
      browser: "Safari",
      lastUsed: new Date("2026-11-17T07:12:00Z"),
      createdAt: new Date("2026-11-03T07:00:00Z"),
      isCurrent: true,
    },
  ]);
});

describe("8.1 profilsiden", () => {
  it("viser navn og e-post bare som tekst, og delen «Mine innlogginger»", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toContain("Tea Testdatter");
    expect(html).toContain("tea.testdatter@example.com");
    expect(html).not.toMatch(/<input|<textarea|<select/);
    expect(html).toContain("Mine innlogginger");
    expect(text(html)).toContain("iPad · Safari · Aktiv nå · logget inn 3. nov.");
  });

  it("sender bare id, enhet, nettleser og tidstekst videre (ingen rå datoer)", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).not.toContain("2026-11-17T07:12");
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("8.2 og 8.3 radene", () => {
  it("raden har enhet, nettleser og tidstekst, og «Denne enheten» som tekst", () => {
    const html = render([current, other]);
    expect(text(html)).toContain("iPad · Safari · Aktiv nå · logget inn 3. nov.");
    expect(text(html)).toContain("Windows-PC · Edge · Aktiv i går · logget inn 1. nov.");
    expect(text(html)).toContain("Denne enheten");
    expect(html.match(/Denne enheten/g)).toHaveLength(1);
  });

  it("«Logg ut her» på denne enheten og «Logg ut» med enhetsnavn på andre", () => {
    const html = render([current, other]);
    expect(text(html)).toContain("Logg ut her");
    expect(text(html)).toContain("Logg ut Windows-PC, Edge");
    expect(html).toMatch(/<span class="sr-only"> Windows-PC, Edge<\/span>/);
  });

  it("ingen klokkeslett i listen", () => {
    expect(text(render([current, other]))).not.toMatch(/\d{1,2}[:.]\d{2}/);
  });
});

describe("8.4 «Logg ut av alle andre enheter»", () => {
  it("vises når det finnes andre økter", () => {
    expect(render([current, other])).toContain("Logg ut av alle andre enheter");
  });

  it("vises ikke når bare denne enheten er logget inn", () => {
    expect(render([current])).not.toContain("Logg ut av alle andre enheter");
  });
});

describe("8.5 visning på denne enheten (F3)", () => {
  const mac = { ...current, device: "iPad eller Mac", browser: "Safari" };
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Oppdiktet/9.9 Safari/605.1.15";

  it("Macintosh med berøring blir «iPad»", () => {
    expect(localDeviceView(mac, { userAgent: ua, maxTouchPoints: 5, standalone: false })).toEqual({
      device: "iPad",
      browser: "Safari",
    });
  });

  it("Macintosh uten berøring står som «iPad eller Mac»", () => {
    expect(localDeviceView(mac, { userAgent: ua, maxTouchPoints: 0, standalone: false })).toEqual({
      device: "iPad eller Mac",
      browser: "Safari",
    });
  });

  it("fra hjemskjermen vises appnavnet i stedet for nettleseren", () => {
    expect(localDeviceView(mac, { userAgent: ua, maxTouchPoints: 5, standalone: true })).toEqual({
      device: "iPad",
      browser: `${brand.productName}-appen`,
    });
  });

  it("andre rader endres aldri", () => {
    const otherMac = { ...mac, isCurrent: false };
    expect(
      localDeviceView(otherMac, { userAgent: ua, maxTouchPoints: 5, standalone: true }),
    ).toEqual({ device: "iPad eller Mac", browser: "Safari" });
  });

  it("før nettleseren er lest, vises det serveren sa", () => {
    expect(localDeviceView(mac, null)).toEqual({ device: "iPad eller Mac", browser: "Safari" });
  });

  it("komponenten sender ingenting selv (ingen fetch)", () => {
    const source = readFileSync(path.join(here, "sessions-list.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|sendBeacon/);
  });
});

describe("8.6 produktnavnet", () => {
  it("står ikke i komponenten, bare via brand.ts", () => {
    const source = readFileSync(path.join(here, "sessions-list.tsx"), "utf8");
    expect(source).toContain("brand.productName");
    expect(source).not.toContain(brand.productName);
  });
});

describe("8.9 «Logg ut her»", () => {
  it("bruker samme utlogging som knappen i toppen, ikke kjernens revokeOwnSession", () => {
    const source = readFileSync(path.join(here, "sessions-list.tsx"), "utf8");
    expect(source).toMatch(/import \{ logOutThisDevice \} from "\.\.\/log-out-button"/);
    expect(source).toMatch(/onClick=\{logOutHere\}/);
    expect(source).not.toContain("@/core/auth/sessions-list");
  });

  it("logOutThisDevice går gjennom logOutAndClear og tømmer KI-køen først", async () => {
    const order: string[] = [];
    vi.doMock("@/core/ai/client", () => ({
      clearAiQueue: vi.fn(async () => {
        order.push("clear");
      }),
    }));
    const { authClient } = await import("@/core/auth/auth-client");
    vi.mocked(authClient.signOut).mockImplementationOnce(async () => {
      order.push("signOut");
      return {} as never;
    });
    const { logOutThisDevice } = await import("../log-out-button");
    await expect(logOutThisDevice()).resolves.toEqual({ failed: false });
    expect(order).toEqual(["clear", "signOut"]);
  });

  it("logOutThisDevice melder feil fra innloggingen i stedet for å late som det gikk", async () => {
    vi.doMock("@/core/ai/client", () => ({ clearAiQueue: vi.fn(async () => {}) }));
    const { authClient } = await import("@/core/auth/auth-client");
    vi.mocked(authClient.signOut).mockResolvedValueOnce({ error: { status: 500 } } as never);
    const { logOutThisDevice } = await import("../log-out-button");
    await expect(logOutThisDevice()).resolves.toEqual({ failed: true });
  });
});
