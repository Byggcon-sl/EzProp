import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allElements,
  clickable,
  ENGLISH_DEFAULTS,
  mockReactForDirectCall,
  secretError,
} from "../../tests/error-page-harness";

/*
 * Rett T-0071: norsk feilside `src/app/error.tsx` (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1f). `renderToStaticMarkup` som i
 * src/shared/ui/notice.test.ts, og et direkte kall med hookene byttet ut for klikket og for
 * «uten nett» (serveren regner seg alltid som på nett).
 *
 * Støtter hovedmål: de ansatte (norsk, rolig feilside med vei videre, ingen tekniske detaljer)
 * og personvern (feilen vises ikke, logges ikke og sendes ingen steder).
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type ErrorProps = { error: Error & { digest?: string }; reset: () => void };

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(here, "error.tsx"), "utf8");

async function render(): Promise<string> {
  const { default: ErrorPage } = (await import("./error")) as {
    default: ComponentType<ErrorProps>;
  };
  return renderToStaticMarkup(createElement(ErrorPage, { error: secretError(), reset: vi.fn() }));
}

/** Kaller komponenten direkte med hookene byttet ut, og gir treet og `reset`. */
async function callDirectly(online: boolean) {
  vi.stubGlobal("navigator", { onLine: online });
  vi.resetModules();
  mockReactForDirectCall();
  const { default: ErrorPage } = (await import("./error")) as {
    default: (props: ErrorProps) => ReactNode;
  };
  const reset = vi.fn();
  const tree = ErrorPage({ error: secretError(), reset });
  return { tree, reset };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("1f error.tsx: innhold", () => {
  it("har norsk overskrift, en setning, knappen «Prøv igjen» og lenke til /arbeidskoe", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).toContain("Prøv igjen");
    expect(html).toMatch(/<button[^>]*>[^<]*Prøv igjen/);
    expect(html).toMatch(/<a[^>]*href="\/arbeidskoe"/);
    expect(html).toMatch(/<p[^>]*>[^<]{10,}<\/p>/);
  });

  it("viser ingen detaljer: verken melding, kjennetegn, «Error» eller stakk", async () => {
    const html = await render();
    for (const word of ["hemmelig-detalj", "abc123", "Error", "stack", "stack-linje", "fil.ts"]) {
      expect(html).not.toContain(word);
    }
  });

  it("har ingen engelske standardtekster", async () => {
    const html = await render();
    for (const text of ENGLISH_DEFAULTS) expect(html).not.toContain(text);
  });

  it("knapp og lenke er minst 44 px høye (min-h-11 eller høyere)", async () => {
    const html = await render();
    const button = /<button[^>]*class="([^"]*)"[^>]*>[^<]*Prøv igjen/.exec(html)?.[1] ?? "";
    const link =
      /<a[^>]*class="([^"]*)"[^>]*href="\/arbeidskoe"|<a[^>]*href="\/arbeidskoe"[^>]*class="([^"]*)"/.exec(
        html,
      );
    const linkClass = link?.[1] ?? link?.[2] ?? "";
    expect(button).toMatch(/\bmin-h-(11|12|14|16)\b/);
    expect(linkClass).toMatch(/\bmin-h-(11|12|14|16)\b/);
  });

  it("på serveren (på nett) vises ikke teksten om manglende nett", async () => {
    expect(await render()).not.toContain("Du er uten nett");
  });

  it("logger ikke feilen i konsollen", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    await render();
    for (const spy of spies) {
      for (const call of spy.mock.calls)
        expect(JSON.stringify(call)).not.toContain("hemmelig-detalj");
    }
  });
});

describe("1f error.tsx: «Prøv igjen» og uten nett", () => {
  it("ett klikk kaller router.refresh og reset, hver én gang", async () => {
    const { tree, reset } = await callDirectly(true);
    const button = clickable(tree, "Prøv igjen");
    expect(button, "knappen «Prøv igjen» har onClick").toBeDefined();
    (button!.props.onClick as () => void)();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("uten nett viser den «Du er uten nett. Siden kan ikke hentes nå.»", async () => {
    const { tree } = await callDirectly(false);
    const html = renderToStaticMarkup(tree as Parameters<typeof renderToStaticMarkup>[0]);
    expect(html).toContain("Du er uten nett. Siden kan ikke hentes nå.");
    expect(html).not.toContain("hemmelig-detalj");
  });

  it("med nett vises ikke teksten om manglende nett", async () => {
    const { tree } = await callDirectly(true);
    const html = renderToStaticMarkup(tree as Parameters<typeof renderToStaticMarkup>[0]);
    expect(html).not.toContain("Du er uten nett");
    expect(allElements(tree).length).toBeGreaterThan(0);
  });
});

describe("1f error.tsx: statisk sjekk", () => {
  it('starter med "use client"', () => {
    expect(SOURCE.trimStart()).toMatch(/^["']use client["'];?/);
  });

  it("har ingen console., fetch(, sendBeacon eller adresse som starter med http", () => {
    expect(SOURCE).not.toContain("console.");
    expect(SOURCE).not.toContain("fetch(");
    expect(SOURCE).not.toContain("sendBeacon");
    expect(SOURCE).not.toMatch(/["'`]https?:/);
  });

  it("viser aldri error.message, digest eller stack", () => {
    expect(SOURCE).not.toMatch(/error\.(message|digest|stack)/);
  });
});
