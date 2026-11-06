"use client";

import { useEffect } from "react";
import { shouldSendActivity } from "@/core/work-sessions/activity";
import { recordWorkActivityAction } from "./work-session-action";

/** Hvor ofte måleren spør `shouldSendActivity`. Selve grensen (60 s) står i kjernen. */
const CHECK_INTERVAL_MS = 15_000;
/** Musebevegelser registreres høyst så ofte, slik at lytteren ikke gjør arbeid ved hver piksel. */
const POINTER_THROTTLE_MS = 1_000;

/**
 * Måler tiden mens oppdraget er åpent (docs/funksjoner/fase2a-tidsmaling.md punkt 4). Ingen synlig
 * del. Når det sendes, avgjør `shouldSendActivity`; komponenten bare samler aktivitet og spør.
 * Feil svelges, slik at siden virker som før selv om målingen ikke kommer fram.
 * Støtter hovedmål: tid (takstmannen fører ingen timer).
 */
export function WorkSessionTracker({ assignmentId }: { assignmentId: string }) {
  useEffect(() => {
    let lastSentAt: Date | null = null;
    let lastActivityAt: Date | null = null;
    let lastPointerAt = 0;

    const check = () => {
      const now = new Date();
      const visible = document.visibilityState === "visible";
      if (!shouldSendActivity({ lastSentAt, lastActivityAt, visible, now })) return;
      lastSentAt = now;
      recordWorkActivityAction(assignmentId).catch(() => undefined);
    };
    const markActivity = () => {
      lastActivityAt = new Date();
    };
    const markPointer = () => {
      const now = Date.now();
      if (now - lastPointerAt < POINTER_THROTTLE_MS) return;
      lastPointerAt = now;
      markActivity();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    const options = { passive: true } as const;
    window.addEventListener("keydown", markActivity, options);
    window.addEventListener("pointerdown", markActivity, options);
    window.addEventListener("pointermove", markPointer, options);
    window.addEventListener("touchstart", markActivity, options);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    check();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("pointermove", markPointer);
      window.removeEventListener("touchstart", markActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [assignmentId]);

  return null;
}
