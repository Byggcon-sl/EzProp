"use client";

import { useEffect } from "react";

const CARD_HASH = /^#kort-[0-9a-f-]{36}$/;

/**
 * Gir kortet i adressen (`#kort-<id>`) fokus etter «Lagre» på notatet. Next.js ruller til
 * kortet, men flytter ikke fokus, så tastaturbrukeren ville startet øverst på siden. Kjører etter
 * hver ny visning av siden, men tar aldri fokus fra et felt der noen skriver.
 */
export function FocusCard() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!CARD_HASH.test(hash)) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    document.getElementById(hash.slice(1))?.focus({ preventScroll: true });
  });
  return null;
}
