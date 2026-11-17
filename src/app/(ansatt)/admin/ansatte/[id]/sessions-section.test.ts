import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Delen «Innlogginger» og bekreftelsen for «Har sluttet» på /admin/ansatte/[id]
 * (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 6.7, 8.7 og 8.8). Markupen med
 * `renderToStaticMarkup`; dialogen står i markupen også når den er lukket. Navn er oppdiktet.
 * Støtter hovedmål: de ansatte (admin ser hva som logges ut, og stenger seg ikke ute ved et uhell).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/ansatte/0190a000-0000-7000-8000-000000000010",
}));
vi.mock("@/core/auth/auth-client", () => ({ authClient: { signOut: vi.fn(async () => ({})) } }));

const { SessionsSection, activeSessionsLabel } = await import("./sessions-section");
const { StatusForm, deactivateSessionsLine } = await import("../employee-forms");

const NAME = "Tea Testdatter";
const sessions = [
  { device: "iPad", browser: "Safari" },
  { device: "Windows-PC", browser: "Edge" },
];
const noop = vi.fn();

function render(props: { sessions: typeof sessions; isSelf?: boolean }): string {
  return renderToStaticMarkup(
    createElement(SessionsSection, {
      employeeName: NAME,
      sessions: props.sessions,
      isSelf: props.isSelf ?? false,
      revokeAll: noop,
    }),
  );
}

/** Tekst uten tagger, slik skjermleseren leser den. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("SessionsSection (8.7)", () => {
  it("viser enhet, nettleser og antall, uten «Aktiv …», dato eller økt-id", () => {
    const html = render({ sessions });
    const shown = text(html);
    expect(shown).toContain("Innlogginger");
    expect(shown).toContain("iPad · Safari");
    expect(shown).toContain("Windows-PC · Edge");
    expect(shown).toContain("2 aktive innlogginger");
    expect(shown).not.toMatch(/Aktiv (nå|i dag|i går|\d)/);
    expect(shown).not.toMatch(/logget inn \d/);
    expect(shown).not.toMatch(/\d{1,2}\.\s?(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des)/);
    expect(shown).not.toMatch(/\d{1,2}[:.]\d{2}/);
    expect(html).not.toMatch(/okt-|sessionId/);
  });

  it("knappen vises når det finnes innlogginger", () => {
    const html = render({ sessions });
    expect(html.match(/Logg ut av alle enheter/g)?.length).toBe(2); // knappen og dialogknappen
  });

  it("knappen er skjult når listen er tom", () => {
    const html = render({ sessions: [] });
    expect(text(html)).toContain("Ingen aktive innlogginger.");
    // Bare knappen i den lukkede dialogen står i markupen
    expect(html.match(/Logg ut av alle enheter/g)?.length).toBe(1);
    expect(html).not.toContain("<ul");
  });

  it.each([
    [0, "Ingen aktive innlogginger."],
    [1, "1 aktiv innlogging"],
    [5, "5 aktive innlogginger"],
  ])("antallsteksten for %i", (count, label) => {
    expect(activeSessionsLabel(count)).toBe(label);
  });
});

describe("Bekreftelsesdialogen (8.8)", () => {
  it("har teksten fra kortet med navnet, er en tilgjengelig dialog og har «Avbryt»", () => {
    const html = render({ sessions });
    const shown = text(html);
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    expect(shown).toContain(`Logg ut ${NAME} fra alle enheter?`);
    expect(shown).toContain(
      "Hen må logge inn på nytt med kode eller Microsoft. Data som ligger lagret på iPaden slettes ikke. Har hen sluttet, sett også hen til «Har sluttet», ellers kan hen logge inn igjen.",
    );
    expect(shown).toContain("Avbryt");
    expect(shown).not.toContain("Du blir også logget ut her");
    expect(html).not.toContain('name="confirmSelf"');
  });

  it("admin selv: «Du blir også logget ut her» og et avkryssingsfelt som må krysses først", () => {
    const html = render({ sessions, isSelf: true });
    expect(text(html)).toContain("Du blir også logget ut her.");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="confirmSelf"[^>]*value="yes"/);
    // Bekreftknappen er låst til feltet er krysset av
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Logg ut av alle enheter/);
  });

  it("admin selv logges ut her med vanlig utlogging (som tømmer KI-køen)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "sessions-section.tsx"), "utf8");
    expect(source).toMatch(/import \{ logOutThisDevice \} from "\.\.\/\.\.\/\.\.\/log-out-button"/);
    expect(source).toMatch(/result\.isSelf\) await logOutHere\(\)/);
    expect(source).toContain('router.replace("/logg-inn")');
  });

  it("ikke admin selv: bekreftknappen er ikke låst", () => {
    const html = render({ sessions });
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe("Bekreftelsen for «Har sluttet» (6.7)", () => {
  it.each([
    [0, "Hen blir også logget ut av alle enheter (0)."],
    [1, "Hen blir også logget ut av alle enheter (1)."],
    [3, "Hen blir også logget ut av alle enheter (3)."],
  ])("linjen med N = %i", (count, line) => {
    expect(deactivateSessionsLine(count)).toBe(line);
  });

  it("«Har sluttet» er en knapp som åpner bekreftelsen, ikke en innsending", () => {
    const html = renderToStaticMarkup(
      createElement(StatusForm, {
        deactivatedOn: null,
        canReactivate: true,
        sessionCount: 2,
        action: noop,
      }),
    );
    expect(html).toMatch(/<button type="button"[^>]*>Har sluttet<\/button>/);
    expect(html).not.toContain('type="submit"');
  });

  it("«Sluttet» viser «Angre sluttet» som før", () => {
    const html = renderToStaticMarkup(
      createElement(StatusForm, {
        deactivatedOn: "31.10.2026",
        canReactivate: true,
        sessionCount: 0,
        action: noop,
      }),
    );
    expect(text(html)).toContain("Sluttet 31.10.2026.");
    expect(html).toMatch(/type="submit"[^>]*>Angre sluttet/);
  });
});
