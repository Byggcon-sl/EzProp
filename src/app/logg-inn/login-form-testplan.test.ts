import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Rett T-0070: `LoginForm` i innloggingsdialogen (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1g). `initialEmail` fyller ut
 * e-posten, og med `onSignedIn` blir siden stående (ingen `router.replace` eller `refresh`).
 * Uten de nye egenskapene er oppførselen som før. Prosjektet har ingen DOM i Vitest, så
 * innsendingen prøves ved å kalle komponenten direkte med `useState` byttet ut (kodesteget) og
 * kalle `onSubmit` på skjemaet. E-posten er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (bare koden må skrives, og det som står i skjemaet under, blir
 * stående).
 */

const EMAIL = "oppdiktet.takstmann@eksempel.invalid";
const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
  emailOtp: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/core/auth/auth-client", () => ({
  authClient: {
    signIn: { emailOtp: mocks.emailOtp, social: vi.fn() },
    emailOtp: { sendVerificationOtp: vi.fn(async () => ({ data: {}, error: null })) },
    getSession: vi.fn(),
  },
}));

type LoginFormProps = {
  next?: string;
  microsoft?: boolean;
  initialEmail?: string;
  onSignedIn?: () => void;
};

afterEach(() => {
  vi.doUnmock("react");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("1g LoginForm med initialEmail", () => {
  it("viser e-posten utfylt", async () => {
    const { LoginForm } = await import("./login-form");
    const html = renderToStaticMarkup(
      createElement(LoginForm as (props: LoginFormProps) => ReactNode, { initialEmail: EMAIL }),
    );
    expect(html).toMatch(
      new RegExp(
        `<input[^>]*type="email"[^>]*value="${EMAIL.replace(/\./g, "\\.")}"|<input[^>]*value="${EMAIL.replace(/\./g, "\\.")}"[^>]*type="email"`,
      ),
    );
  });

  it("uten initialEmail er e-postfeltet tomt (som før)", async () => {
    const { LoginForm } = await import("./login-form");
    const html = renderToStaticMarkup(createElement(LoginForm));
    expect(html).toMatch(
      /<input[^>]*type="email"[^>]*value=""|<input[^>]*value=""[^>]*type="email"/,
    );
    expect(html).not.toContain(EMAIL);
  });
});

/** Elementene i treet uten å kalle komponentene. */
function elements(node: ReactNode): { type: unknown; props: Record<string, unknown> }[] {
  const found: { type: unknown; props: Record<string, unknown> }[] = [];
  const walk = (current: ReactNode) => {
    if (Array.isArray(current)) return current.forEach(walk);
    if (!isValidElement(current)) return;
    const element = current as { type: unknown; props: Record<string, unknown> };
    found.push(element);
    walk(element.props.children as ReactNode);
  };
  walk(node);
  return found;
}

/**
 * Kaller `LoginForm` direkte i kodesteget: `useState("email")` gir «code» og den tomme koden gir
 * «123456». Gir `onSubmit` for skjemaet med koden.
 */
async function codeStepSubmit(props: LoginFormProps) {
  vi.stubGlobal("navigator", { onLine: true });
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    return {
      ...actual,
      default: actual,
      useState: (initial: unknown) => {
        const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
        if (value === "email") return ["code", () => {}];
        if (value === "") return ["123456", () => {}];
        return [value, () => {}];
      },
      useSyncExternalStore: (_s: unknown, getSnapshot: () => unknown) => getSnapshot(),
      useEffect: () => {},
      useLayoutEffect: () => {},
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useRef: (initial: unknown) => ({ current: initial ?? null }),
      useId: () => "test-id",
      useTransition: () => [false, (fn: () => void) => fn()],
      startTransition: (fn: () => void) => fn(),
    };
  });
  const { LoginForm } = (await import("./login-form")) as unknown as {
    LoginForm: (props: LoginFormProps) => ReactNode;
  };
  const tree = LoginForm(props);
  const form = elements(tree).find(
    (element) => element.type === "form" && typeof element.props.onSubmit === "function",
  );
  expect(form, "kodeskjemaet har onSubmit").toBeDefined();
  return form!.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>;
}

describe("1g LoginForm med onSignedIn", () => {
  it("kalles etter riktig kode, og router.replace og router.refresh kalles ikke", async () => {
    const onSignedIn = vi.fn();
    const submit = await codeStepSubmit({ initialEmail: EMAIL, onSignedIn });
    await submit({ preventDefault: () => {} });

    expect(mocks.emailOtp).toHaveBeenCalledTimes(1);
    expect(mocks.emailOtp).toHaveBeenCalledWith({ email: EMAIL, otp: "123456" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("kalles ikke når koden er feil", async () => {
    mocks.emailOtp.mockResolvedValueOnce({
      data: null,
      error: { status: 401, message: "x" },
    } as never);
    const onSignedIn = vi.fn();
    const submit = await codeStepSubmit({ initialEmail: EMAIL, onSignedIn });
    await submit({ preventDefault: () => {} });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("uten onSignedIn: som før, router.replace(neste) og router.refresh", async () => {
    const submit = await codeStepSubmit({ next: `/oppdrag/${UUID}` });
    await submit({ preventDefault: () => {} });
    expect(mocks.router.replace).toHaveBeenCalledWith(`/oppdrag/${UUID}`);
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  });

  it("uten onSignedIn og med farlig neste: router.replace(/arbeidskoe)", async () => {
    const submit = await codeStepSubmit({ next: "//evil.example" });
    await submit({ preventDefault: () => {} });
    expect(mocks.router.replace).toHaveBeenCalledWith("/arbeidskoe");
  });
});
