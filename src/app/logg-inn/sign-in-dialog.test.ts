import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const { firstStepSelector, SignInDialog, SIGN_IN_DIALOG_TITLE } = await import("./sign-in-dialog");
const { GuardedFormNotice, SignedOutNotice } = await import("./signed-out-notice");
const messages = await import("@/shared/forms/messages");

/*
 * Innloggingsdialogen over skjemaet og meldingene (testplan 1g, tillegg F1). Støtter hovedmål:
 * de ansatte (logg inn uten å forlate skjemaet, meldingene leses opp). E-posten er oppdiktet og
 * står aldri i en adresse.
 */

const EMAIL = "oppdiktet.takstmann@example.test";

function dialogHtml(open: boolean) {
  return renderToStaticMarkup(
    createElement(SignInDialog, {
      open,
      email: EMAIL,
      onClose: () => {},
      onSignedIn: () => {},
    }),
  );
}

describe("SignInDialog", () => {
  it("har en overskrift og er knyttet til den", () => {
    const html = dialogHtml(true);
    expect(html).toMatch(/^<dialog[^>]*aria-labelledby="sign-in-dialog-title"/);
    expect(html).toContain(`<h2 id="sign-in-dialog-title"`);
    expect(html).toContain(SIGN_IN_DIALOG_TITLE);
  });

  it("viser ikke «Logg inn med Microsoft» (A390)", () => {
    expect(dialogHtml(true)).not.toContain("Microsoft");
  });

  it("fyller ut e-posten, men har den aldri i en adresse", () => {
    const html = dialogHtml(true);
    expect(html).toContain(`value="${EMAIL}"`);
    for (const match of html.matchAll(/(?:href|action)="([^"]*)"/g)) {
      expect(match[1]).not.toContain(EMAIL);
      expect(match[1]).not.toContain(encodeURIComponent(EMAIL));
    }
  });

  it("viser ingenting inni før den er åpnet", () => {
    expect(dialogHtml(false)).not.toContain(EMAIL);
  });

  it("fokus til «Send meg en kode» når e-posten er kjent, ellers e-postfeltet", () => {
    expect(firstStepSelector(EMAIL)).toBe('form button[type="submit"]');
    expect(firstStepSelector(undefined)).toBe('input[type="email"]');
  });

  it("stopper cancel og close, så en dialog rundt ikke lukkes", () => {
    const file = join(process.cwd(), "src/app/logg-inn/sign-in-dialog.tsx");
    const source = readFileSync(file, "utf8");
    expect(source.match(/event\.stopPropagation\(\)/g)?.length).toBe(2);
  });
});

describe("meldingene", () => {
  const link = { href: "/logg-inn?neste=%2Foppdrag%2Fx", text: messages.SIGN_IN_LINK_TEXT };

  it("«logget ut» er role=alert med lenken «Logg inn» til innloggingssiden", () => {
    const html = renderToStaticMarkup(
      createElement(SignedOutNotice, {
        message: messages.SIGNED_OUT_MESSAGE,
        link,
        onSignIn: () => {},
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(messages.SIGNED_OUT_MESSAGE);
    expect(html).toContain(`href="${link.href}"`);
    expect(html).toContain(">Logg inn</a>");
    expect(html).toContain("min-h-11");
  });

  it("«tilbake» og «logget inn igjen» er aria-live=polite, ikke alert", () => {
    for (const message of [messages.BACK_ONLINE_MESSAGE, messages.SIGNED_IN_AGAIN_MESSAGE]) {
      const html = renderToStaticMarkup(
        createElement(GuardedFormNotice, {
          notice: { message, tone: "polite", signedOut: false },
          attempt: 1,
          onSignIn: () => {},
        }),
      );
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(message);
      expect(html).not.toContain('role="alert"');
    }
  });

  it("feil uten nett er role=alert", () => {
    const html = renderToStaticMarkup(
      createElement(GuardedFormNotice, {
        notice: { message: messages.OFFLINE_MESSAGE, tone: "alert", signedOut: false },
        attempt: 1,
        onSignIn: () => {},
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(messages.OFFLINE_MESSAGE);
  });

  it("meldingene er de faste norske tekstene", () => {
    expect(messages.OFFLINE_MESSAGE).toBe("Du er uten nett. Endringen er ikke lagret.");
    expect(messages.BACK_ONLINE_MESSAGE).toBe("Nettet er tilbake. Trykk Lagre.");
    expect(messages.SIGNED_OUT_MESSAGE).toBe("Du er logget ut. Logg inn igjen.");
    expect(messages.SIGNED_OUT_ON_FOCUS_MESSAGE).toBe("Du er logget ut. Logg inn før du lagrer.");
    expect(messages.SIGNED_IN_AGAIN_MESSAGE).toBe("Du er logget inn igjen. Trykk Lagre.");
  });
});
