"use client";

import type { MouseEvent } from "react";

/**
 * «Hopp til hovedinnhold» (WCAG 2.4.1). Målet er sidens egen `<main>`: lenken setter tabindex=-1
 * og fokus på den. Enter på lenken utløser click, så tastaturet er dekket. Uten JS går href til
 * div-en `#hovedinnhold` i layouten, som er reserven.
 */
export function SkipLink() {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const target =
      document.querySelector<HTMLElement>("#hovedinnhold main") ??
      document.getElementById("hovedinnhold");
    if (!target) return;
    if (target.tagName === "MAIN" && !target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
    }
    event.preventDefault();
    target.focus();
  }

  return (
    <a
      href="#hovedinnhold"
      onClick={handleClick}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-night focus:px-5 focus:font-semibold focus:text-white"
    >
      Hopp til hovedinnhold
    </a>
  );
}
