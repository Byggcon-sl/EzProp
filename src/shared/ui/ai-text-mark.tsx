/*
 * KI-merket (docs/funksjoner/fase2a-forslagsmonster-design.md avsnitt 5). Én fast tekst, ingen
 * varianter. Vises bare når statusen er lest fra serveren (statusoppslaget) og er `accepted` eller
 * `edited`, og bare når teksten har en `ai_usage_id`. Samme merke brukes overalt der KI-tekst vises.
 * Støtter hovedmål: reklamasjoner (KI-tekst er alltid tydelig merket) og de ansatte (takstmannen
 * ser hva hen har godkjent).
 */

/** Den faste teksten på merket. */
export const AI_TEXT_MARK_LABEL = "Tekst fra KI, godkjent";

const APPROVED_STATUSES: readonly string[] = ["accepted", "edited"];

export type AiTextMarkProps = {
  /** Id-en til raden i KI-loggen. Uten id vises ikke merket. */
  aiUsageId?: string | null;
  /** Statusen lest fra serveren, aldri fra tilstand i nettleseren. */
  status: string | null | undefined;
};

/** Gnisteikonet for KI. Bare pynt; ordet «KI» står alltid i teksten. */
export function AiSparkIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

/** Om merket skal vises. Ren funksjon, testet for seg. */
export function showsAiTextMark({ aiUsageId, status }: AiTextMarkProps): boolean {
  return Boolean(aiUsageId) && typeof status === "string" && APPROVED_STATUSES.includes(status);
}

export function AiTextMark(props: AiTextMarkProps) {
  if (!showsAiTextMark(props)) return null;
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ai-50 px-2.5 text-xs font-medium whitespace-nowrap text-ai-900 ring-1 ring-ai-200 ring-inset">
      <AiSparkIcon />
      {AI_TEXT_MARK_LABEL}
    </span>
  );
}
