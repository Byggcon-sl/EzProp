/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * «Siste endring vinner» med minste mulige varsel (oppgavekortet pkt. 19): feltene der verdien
 * ble endret av en annen enhet. Bare TG, valg og tall; tekst flettes, tabell og bilder har ikke
 * varsel. Første lasting (tom `previousRows`) gir aldri varsel.
 */
import { latestAnswerRows } from "./sync/answer-rows";
import type { TrialAnswerRow } from "./sync/types";
import { listTrialFields, trialForm } from "./trial-form";

const WARNED_FIELD_KEYS = new Set(
  listTrialFields(trialForm)
    .filter((field) => field.type === "tg" || field.type === "choice" || field.type === "number")
    .map((field) => field.key),
);

export function detectForeignChanges(
  previousRows: readonly TrialAnswerRow[],
  nextRows: readonly TrialAnswerRow[],
  deviceId: string,
): Set<string> {
  const changed = new Set<string>();
  if (previousRows.length === 0) return changed;
  const previous = latestAnswerRows(previousRows);
  for (const [fieldKey, row] of latestAnswerRows(nextRows)) {
    if (!WARNED_FIELD_KEYS.has(fieldKey)) continue;
    if (row.deviceId === deviceId) continue;
    const before = previous.get(fieldKey);
    if (before && before.value === row.value) continue;
    changed.add(fieldKey);
  }
  return changed;
}
