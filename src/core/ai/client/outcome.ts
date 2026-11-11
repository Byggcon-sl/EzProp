import type { AiQueueOutcome, ClassifyQueueOutcome } from "./types";

/*
 * Avgjør hva køen gjør med en post etter ett kall til `send`. Ren funksjon: om enheten har nett,
 * gis inn av den som kaller. Leser bare `kind` og `reason` i svaret, aldri tekst.
 */

const DONE_KINDS: ReadonlySet<string> = new Set(["suggestion", "no_match", "error", "disabled"]);
const DONE_FAILURE_REASONS: ReadonlySet<string> = new Set(["invalid", "no_access"]);

function classifyAnswer(result: unknown): AiQueueOutcome {
  if (typeof result !== "object" || result === null) return "server_error";
  const { kind, reason } = result as { kind?: unknown; reason?: unknown };
  if (typeof kind !== "string") return "server_error";
  if (DONE_KINDS.has(kind)) return "done";
  if (kind === "failed" && typeof reason === "string" && DONE_FAILURE_REASONS.has(reason)) {
    return "done";
  }
  // `failed` med `unknown`, og svar køen ikke kjenner (et fremtidig svar), gir nytt forsøk.
  return "server_error";
}

export const classifyQueueOutcome: ClassifyQueueOutcome = (attempt, online) => {
  if (!online) return "retry_later";
  switch (attempt.kind) {
    case "timed_out":
      return "retry_later";
    case "threw":
      // `fetch` kaster `TypeError` ved nettfeil. Alt annet regnes som feil på serveren.
      return attempt.error instanceof TypeError ? "retry_later" : "server_error";
    case "answered":
      return classifyAnswer(attempt.result);
    default:
      return "server_error";
  }
};
