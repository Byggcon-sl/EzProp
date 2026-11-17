import type { CheckOverrideReason } from "./types";

/**
 * Kontrollen av begrunnelsen ved Endre og Avvis (A380, A398). Én regel for skjermen, Zod-skjemaet
 * på serveren og CHECK-regelen i databasen:
 * - `accepted` har verken kode eller tekst.
 * - `changed` og `rejected` krever kode eller tekst.
 * - Koden `other` krever tekst.
 * Tekst med bare mellomrom regnes som tom.
 */
export const checkOverrideReason: CheckOverrideReason = ({ decision, code, text }) => {
  const hasText = text !== null && text.trim() !== "";
  if (decision === "accepted") {
    return code !== null || hasText ? "not_allowed_when_accepted" : "ok";
  }
  if (code === null && !hasText) return "reason_required";
  if (code === "other" && !hasText) return "text_required";
  return "ok";
};
