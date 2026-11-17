import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickable,
  ENGLISH_DEFAULTS,
  mockReactForDirectCall,
  secretError,
} from "../../tests/error-page-harness";

/*
 * Rett T-0071: norsk feilside når rotoppsettet feiler, `src/app/global-error.tsx` (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1f). Egen `<html lang="nb">`,
 * importerer `globals.css` selv og henter ingenting fra andre nettsteder.
 *
 * Støtter hovedmål: de ansatte (norsk feilside også når alt annet har feilet) og personvern
 * (ingen detaljer vises eller sendes).
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type ErrorProps = { error: Error & { digest?: string }; reset: () => void };

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(here, "global-error.tsx"), "utf8");

async function render(): Promise<string> {
  const { default: GlobalError } = (await import("./global-error")) as {
    default: ComponentType<ErrorProps>;
  };
  return renderToStaticMarkup(createElement(GlobalError, { error: secretError(), reset: vi.fn() }));
}

afterEach(() => {
  vi.doUnmock("react");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("1f global-error.tsx: innhold", () => {
  it('har <html lang="nb"> og <body>', async () => {
    const html = await render();
    expect(html).toMatch(/<html[^>]*lang="nb"/);
    expect(html).toContain("<body");
  });

  it("har norsk overskrift, knappen «Prøv igjen» og lenke til /arbeidskoe", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).toMatch(/<button[^>]*>[^<]*Prøv igjen/);
    expect(html).toMatch(/<a[^>]*href="\/arbeidskoe"/);
  });

  it("viser ingen detaljer og ingen engelske standardtekster", async () => {
    const html = await render();
    for (const word of ["hemmelig-detalj", "abc123", "Error", "stack", "fil.ts"]) {
      expect(html).not.toContain(word);
    }
    for (const text of ENGLISH_DEFAULTS) expect(html).not.toContain(text);
  });

  it("knapp og lenke er minst 44 px høye (min-h-11 eller høyere)", async () => {
    const html = await render();
    const button = /<button[^>]*class="([^"]*)"[^>]*>[^<]*Prøv igjen/.exec(html)?.[1] ?? "";
    const link =
      /<a[^>]*class="([^"]*)"[^>]*href="\/arbeidskoe"|<a[^>]*href="\/arbeidskoe"[^>]*class="([^"]*)"/.exec(
        html,
      );
    expect(button).toMatch(/\bmin-h-(11|12|14|16)\b/);
    expect(link?.[1] ?? link?.[2] ?? "").toMatch(/\bmin-h-(11|12|14|16)\b/);
  });

  it("henter ingenting fra andre nettsteder (ingen http-adresse i HTML)", async () => {
    expect(await render()).not.toMatch(/(src|href)="https?:/);
  });
});

describe("1f global-error.tsx: «Prøv igjen»", () => {
  it("ett klikk kaller router.refresh og reset, hver én gang", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.resetModules();
    mockReactForDirectCall();
    const { default: GlobalError } = (await import("./global-error")) as {
      default: (props: ErrorProps) => ReactNode;
    };
    const reset = vi.fn();
    const tree = GlobalError({ error: secretError(), reset });
    const button = clickable(tree, "Prøv igjen");
    expect(button, "knappen «Prøv igjen» har onClick").toBeDefined();
    (button!.props.onClick as () => void)();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("1f global-error.tsx: statisk sjekk", () => {
  it('starter med "use client"', () => {
    expect(SOURCE.trimStart()).toMatch(/^["']use client["'];?/);
  });

  it("importerer globals.css", () => {
    expect(SOURCE).toMatch(/import\s+["']\.\/globals\.css["']/);
  });

  it('har <html lang="nb"> i kildefilen', () => {
    expect(SOURCE).toMatch(/<html[^>]*lang="nb"/);
  });

  it("har ingen console., fetch(, sendBeacon eller adresse som starter med http", () => {
    expect(SOURCE).not.toContain("console.");
    expect(SOURCE).not.toContain("fetch(");
    expect(SOURCE).not.toContain("sendBeacon");
    expect(SOURCE).not.toMatch(/["'`]https?:/);
  });

  it("henter ingen skrifter fra andre nettsteder (ingen next/font/google)", () => {
    expect(SOURCE).not.toContain("next/font/google");
  });

  it("viser aldri error.message, digest eller stack", () => {
    expect(SOURCE).not.toMatch(/error\.(message|digest|stack)/);
  });
});
