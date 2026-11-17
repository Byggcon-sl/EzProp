import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const { finishSignIn, LoginForm } = await import("./login-form");

/*
 * Nye egenskaper i innloggingsskjemaet for dialogen over et skjema (testplan 1g, T-0070).
 * Støtter hovedmål: de ansatte (e-posten er fylt ut, og siden blir stående etter innlogging).
 * E-postadressen er oppdiktet.
 */

const EMAIL = "oppdiktet.takstmann@example.test";

describe("LoginForm", () => {
  it("fyller ut e-posten med initialEmail", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { initialEmail: EMAIL }));
    expect(html).toContain(`value="${EMAIL}"`);
  });

  it("uten de nye egenskapene: tomt felt, som før", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, {}));
    expect(html).toContain('id="email"');
    expect(html).toContain('value=""');
    expect(html).not.toContain("Logg inn med Microsoft");
  });

  it("viser Microsoft bare når siden ber om det", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { microsoft: true }));
    expect(html).toContain("Logg inn med Microsoft");
  });
});

describe("finishSignIn", () => {
  it("med onSignedIn: kaller den, og bytter ikke side", () => {
    const router = { replace: vi.fn(), refresh: vi.fn() };
    const onSignedIn = vi.fn();
    finishSignIn({ next: "/oppdrag/x", onSignedIn, router });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("uten onSignedIn: til neste side, som før (sjekket på nytt)", () => {
    const router = { replace: vi.fn(), refresh: vi.fn() };
    finishSignIn({ next: "/arbeidskoe", router });
    expect(router.replace).toHaveBeenCalledWith("/arbeidskoe");
    expect(router.refresh).toHaveBeenCalledTimes(1);

    const unsafe = { replace: vi.fn(), refresh: vi.fn() };
    finishSignIn({ next: "//evil.example", router: unsafe });
    expect(unsafe.replace).toHaveBeenCalledWith("/arbeidskoe");
  });
});
