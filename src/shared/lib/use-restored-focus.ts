"use client";

import { useCallback, useEffect, useRef } from "react";

/*
 * Etter «Angre» eller «Gjenopprett» (docs/funksjoner/fase2a-papirkurv-design.md avsnitt 5):
 * finn det som kom tilbake (`data-restore-id="{type}:{id}"`), gi det fokus uten å hoppe, rull dit
 * og uthev det i 2 sekunder. Uthevingen er attributtet `data-restored`; fargen
 * (`--color-restored`) og overgangen står i globals.css, uten overgang ved redusert bevegelse.
 */

/** Hvor lenge raden er uthevet. */
export const RESTORED_HIGHLIGHT_MS = 2000;
/** Hvor lenge vi venter på at siden er lastet på nytt og elementet finnes. */
const WAIT_FOR_ELEMENT_MS = 5000;

/** Nøkkelen i `data-restore-id`, for eksempel «room:0190…». */
export function restoreKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function selectorFor(key: string): string {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : key.replace(/["\\]/g, "\\$&");
  return `[data-restore-id="${escaped}"]`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fokus, rulling og utheving på elementet. Gir en funksjon som fjerner uthevingen. */
function highlight(element: HTMLElement): () => void {
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  element.scrollIntoView({
    block: "center",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  element.setAttribute("data-restored", "true");
  const timer = window.setTimeout(
    () => element.removeAttribute("data-restored"),
    RESTORED_HIGHLIGHT_MS,
  );
  return () => {
    window.clearTimeout(timer);
    element.removeAttribute("data-restored");
  };
}

/**
 * Finner elementet med nøkkelen, også når det først kommer med neste oppfrisking av siden, og
 * gir det fokus og utheving. Gir en funksjon som avbryter ventingen.
 */
export function focusRestored(key: string, waitMs: number = WAIT_FOR_ELEMENT_MS): () => void {
  if (typeof document === "undefined") return () => {};
  const selector = selectorFor(key);
  const found = document.querySelector<HTMLElement>(selector);
  if (found) return highlight(found);

  let cleanup: (() => void) | null = null;
  const observer = new MutationObserver(() => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    stop();
    cleanup = highlight(element);
  });
  const timeout = window.setTimeout(() => stop(), waitMs);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timeout);
  }
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    stop();
    cleanup?.();
  };
}

/**
 * Gir en funksjon som flytter fokus til det som kom tilbake (se `focusRestored`). Bare den siste
 * ventingen gjelder, og den avbrytes når komponenten forsvinner.
 */
export function useRestoredFocus(): (key: string) => void {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );
  return useCallback((key: string) => {
    cancel.current?.();
    cancel.current = focusRestored(key);
  }, []);
}
