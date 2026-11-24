/*
 * KI-målene i rapporten (`AiTargetRef.type` og `fieldKey`, ADR 0006 del 1, A350, A356 og A486).
 * Én liste som både `@/core/ai` (lovlige mål per funksjon) og `@/core/reports` (hvilke felt som
 * kan få et forslag) leser, slik at de to aldri importerer hverandre for å finne den.
 *
 * `fieldKey` er lik kolonnenavnet i tabellen. For `field_answer` er `fieldKey` feltets faste kode
 * i malen, derfor `null` her. Kodene er faste (regel 6): en type eller et felt tas aldri bort og
 * får aldri ny betydning. Et TG-felt står aldri her (ADR 0006 del 7).
 *
 * `ai_usage_log` (`report_id` + `target_ref`) er eneste fasit for om en tekst kom fra KI (A355).
 *
 * Filen har ingen importer, så den kan lastes i nettleseren.
 */
export const REPORT_AI_TARGET_FIELDS = {
  deviation: ["deviation_text", "cause_text", "consequence_text"],
  deviation_measure: ["text"],
  checkpoint_result: ["description_text"],
  tgiu_detail: ["reason", "risk_assessment", "how_to_examine"],
  field_answer: null,
  /** Sammendraget for hele rapporten (`reports.summary_text`, A486). */
  report: ["summary_text"],
} as const;

export type ReportAiTargetType = keyof typeof REPORT_AI_TARGET_FIELDS;

/**
 * Feltkoden for «forslag til nytt tiltak på avviket» (måltype `deviation`). Ikke en kolonne:
 * tiltaksraden finnes ikke før takstmannen har valgt en kandidat, så forslaget kan ikke peke på
 * `deviation_measure` / `text`. Brukes bare av `phrase_suggest`.
 */
export const DEVIATION_NEW_MEASURE_FIELD_KEY = "new_measure";

/**
 * Feltkoden for «forklaring av graden» på et kontrollpunkt (måltype `checkpoint_result`,
 * docs/funksjoner/fase2a-tg-spor.md, ADR 0006 tillegg 24.11.2026). Ikke en kolonne: forklaringen
 * lagres aldri i rapporten, bare som utkast og status i `ai_usage_log` (A590). Står derfor ikke i
 * `REPORT_AI_TARGET_FIELDS.checkpoint_result`, som er listen over tekstfelt i rapporten som kan få
 * KI-merke. Brukes bare av funksjonen `tg_explanation`. Fast kode (regel 6).
 *
 * Koden er `explanation`, ikke `tg_explanation` som funksjonen heter: en feltkode som er `tg`
 * eller starter med `tg_`, regnes som et TG-felt og kan aldri være KI-mål (ADR 0006 del 7,
 * kontrollen i `src/core/ai/features/features.test.ts`). Den kontrollen skal ikke svekkes.
 */
export const TG_EXPLANATION_FIELD_KEY = "explanation";

/**
 * Måltypene der `@/core/ai` selv slår opp målraden og utleder rapport og oppdrag (ADR 0006,
 * tillegg 17.11.2026). `field_answer` og `tgiu_detail` kontrolleres ikke ennå og kan derfor ikke
 * gå til en ekte leverandør.
 */
export const RESOLVED_AI_TARGET_TYPES = [
  "deviation",
  "deviation_measure",
  "checkpoint_result",
  "report",
] as const satisfies readonly ReportAiTargetType[];
export type ResolvedAiTargetType = (typeof RESOLVED_AI_TARGET_TYPES)[number];

/**
 * Høyeste antall kandidater i ett svar fra `phrase_suggest`: så mange vises i forslagslisten og
 * lagres i `ai_usage_log.candidate_refs` (CHECK-regelen bruker samme tall). Tallet står bare her.
 * `@/db/schema` og `@/core/ai` (`AI_SUGGESTED_CANDIDATES_MAX`) leser det herfra.
 */
export const AI_CANDIDATE_REFS_MAX = 5;
