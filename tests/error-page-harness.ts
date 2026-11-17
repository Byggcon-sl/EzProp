import { isValidElement, type ReactNode } from "react";
import { vi } from "vitest";

/*
 * Hjelp til testene av feilsidene (rett T-0071, testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1f). Prosjektet har ingen DOM i
 * Vitest, så klikket prøves ved å kalle komponenten som en funksjon med hookene byttet ut, og så
 * kalle `onClick` på knappen i treet den gir tilbake.
 */

/** En feil med detaljer som aldri skal vises. Oppdiktet. */
export function secretError(): Error & { digest: string } {
  const error = new Error("hemmelig-detalj") as Error & { digest: string };
  error.digest = "abc123";
  error.stack = "Error: hemmelig-detalj\n    at stack-linje (fil.ts:1:1)";
  return error;
}

/** Engelsk standardtekst fra Next og React som aldri skal stå på feilsiden. */
export const ENGLISH_DEFAULTS = [
  "Application error",
  "Something went wrong",
  "a client-side exception has occurred",
  "Try again",
  "Internal Server Error",
];

/**
 * Bytter ut hookene i `react` for et direkte kall av komponenten. `useSyncExternalStore` gir
 * verdien i nettleseren (ikke serverens), og `startTransition` kjører med en gang.
 */
export function mockReactForDirectCall() {
  vi.doMock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    return {
      ...actual,
      default: actual,
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
      startTransition: (fn: () => void) => fn(),
      useTransition: () => [false, (fn: () => void) => fn()],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useState: (initial: unknown) => [
        typeof initial === "function" ? (initial as () => unknown)() : initial,
        () => {},
      ],
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useRef: (initial: unknown) => ({ current: initial ?? null }),
      useId: () => "test-id",
    };
  });
}

type AnyElement = { type: unknown; props: Record<string, unknown> };

/** Teksten i et tre av elementer (bare strenger og tall). */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as AnyElement).props.children as ReactNode);
  return "";
}

/** Alle elementer i treet (uten å kalle komponenter). */
export function allElements(node: ReactNode): AnyElement[] {
  const found: AnyElement[] = [];
  const walk = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (!isValidElement(current)) return;
    const element = current as AnyElement;
    found.push(element);
    walk(element.props.children as ReactNode);
  };
  walk(node);
  return found;
}

/** Elementet med `onClick` og teksten. */
export function clickable(node: ReactNode, text: string): AnyElement | undefined {
  return allElements(node).find(
    (element) =>
      typeof element.props.onClick === "function" &&
      textOf(element.props.children as ReactNode).trim() === text,
  );
}
