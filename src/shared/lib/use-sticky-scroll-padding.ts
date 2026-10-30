"use client";

import { type RefObject, useEffect } from "react";

/** CSS-variabelen som `html { scroll-padding-top }` i globals.css leser. */
export const STICKY_BAR_HEIGHT_VAR = "--sticky-bar-height";

type ResizeObserverFactory = (callback: () => void) => {
  observe(target: Element): void;
  disconnect(): void;
};

/**
 * Måler høyden på den faste statuslinjen og skriver den til `--sticky-bar-height` på `root`,
 * nå og ved hver endring. Returnerer opprydding som fjerner variabelen og stopper målingen.
 */
export function observeStickyHeight(
  el: HTMLElement,
  root: HTMLElement,
  createObserver: ResizeObserverFactory = (callback) => new ResizeObserver(callback),
): () => void {
  const update = () => {
    root.style.setProperty(
      STICKY_BAR_HEIGHT_VAR,
      `${Math.ceil(el.getBoundingClientRect().height)}px`,
    );
  };
  update();
  const observer = createObserver(update);
  observer.observe(el);
  return () => {
    observer.disconnect();
    root.style.removeProperty(STICKY_BAR_HEIGHT_VAR);
  };
}

/**
 * Den faste statuslinjen vokser med varsel og feilmelding. Hooken holder scroll-padding-top lik
 * høyden, så felt med fokus ikke dekkes av linjen (WCAG 2.4.11).
 */
export function useStickyScrollPadding(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    return observeStickyHeight(el, document.documentElement);
  }, [ref]);
}
