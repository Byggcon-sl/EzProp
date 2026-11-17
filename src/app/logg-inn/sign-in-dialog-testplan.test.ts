import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Rett T-0070: innloggingsdialogen over skjemaet (`SignInDialog`, testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1g). Bare innlogging med kode
 * («Logg inn med Microsoft» forlater siden, A390), en overskrift, og e-posten står aldri i en
 * adresse. E-posten er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (logger inn uten å forlate skjemaet) og personvern (e-posten går
 * aldri i adresser eller logg).
 */

const EMAIL = "oppdiktet.takstmann@eksempel.invalid";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/core/auth/auth-client", () => ({
  authClient: {
    signIn: { emailOtp: vi.fn(), social: vi.fn() },
    emailOtp: { sendVerificationOtp: vi.fn() },
    getSession: vi.fn(),
  },
}));

type DialogProps = {
  open: boolean;
  email?: string;
  onClose: () => void;
  onSignedIn: () => void;
};

async function render(open = true): Promise<string> {
  const { SignInDialog } = (await import("./sign-in-dialog")) as unknown as {
    SignInDialog: ComponentType<DialogProps>;
  };
  return renderToStaticMarkup(
    createElement(SignInDialog, { open, email: EMAIL, onClose: vi.fn(), onSignedIn: vi.fn() }),
  );
}

describe("1g SignInDialog", () => {
  it("er en innebygd <dialog>", async () => {
    expect(await render()).toContain("<dialog");
  });

  it("viser ikke «Logg inn med Microsoft»", async () => {
    const html = await render();
    expect(html).not.toContain("Microsoft");
  });

  it("har en overskrift, og dialogen er merket med den", async () => {
    const html = await render();
    const heading = /<h([1-3])[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h\1>/.exec(html);
    expect(heading, "overskrift med id").not.toBeNull();
    expect(heading![3]!.trim().length).toBeGreaterThan(0);
    expect(html).toContain(`aria-labelledby="${heading![2]}"`);
  });

  it("e-posten er fylt ut, men står ikke i noen adresse (href, action, src)", async () => {
    const html = await render();
    expect(html).toContain(`value="${EMAIL}"`);
    const addresses = [...html.matchAll(/\s(?:href|action|src|formaction)="([^"]*)"/g)].map(
      (match) => match[1],
    );
    for (const address of addresses) {
      expect(address).not.toContain(EMAIL);
      expect(address).not.toContain(encodeURIComponent(EMAIL));
    }
  });

  it("viser bare innlogging med kode («Send meg en kode»)", async () => {
    expect(await render()).toContain("Send meg en kode");
  });

  it("kildefilen bruker LoginForm uten microsoft og skriver ikke e-posten til logg", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "sign-in-dialog.tsx"), "utf8");
    expect(source).toContain("LoginForm");
    expect(source).not.toMatch(/microsoft(\s*=\s*\{?\s*true|\s*[,}])/);
    expect(source).not.toContain("console.");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});
