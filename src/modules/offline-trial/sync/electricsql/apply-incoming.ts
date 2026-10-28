/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Innfletting av rader fra serveren i den lokale lagringen (`ApplyIncoming` i `sync/types.ts`).
 * Ren fil: ingen nettleser-API, ingen SDK. Kan gjenbrukes av kandidat 3 (egenbygd).
 *
 * Regler:
 * - Nøkler som venter (i køen, underveis eller bekreftet men ikke speilet ennå): ingen kolonne
 *   overskrives. Bare innkommende `text_state` flettes inn, så en annen enhets ord ikke går tapt.
 * - Andre: `insert` legger til, `update` patcher per kolonne, `text_state` flettes alltid,
 *   `delete` eller `deleted_at` satt fjerner raden lokalt (serveren beholder den, regel 3).
 * - Svar kjennes igjen på `(trial_form_id, field_key)`; serverens `id` vinner. Mangler meldingen
 *   de kolonnene (update eller delete med bare endrede kolonner), finnes raden på `id`.
 * - Tekstfelt (bare de): `value` er alltid teksten i `text_state` når den finnes. `text_state` lages aldri
 *   fra en gammel `value`. Ugyldig `text_state` gir urørt lokal rad, aldri en feil.
 */
import { mergeTextStates, textOf } from "../../text-merge";
import { listTrialFields, trialForm } from "../../trial-form";
import type { TrialTableName } from "../local-columns";
import type { ApplyIncoming, IncomingChange, LocalRow } from "../types";
import { localRowKey } from "./outbox";

const TEXT_FIELDS = new Set(
  listTrialFields(trialForm)
    .filter((field) => field.type === "text")
    .map((field) => field.key),
);

/** Bare tekstfelt har `value` som følger `text_state`. */
function isTextField(row: LocalRow): boolean {
  return typeof row.field_key === "string" && TEXT_FIELDS.has(row.field_key);
}

function hasKeyColumns(table: TrialTableName, row: LocalRow): boolean {
  if (table === "trial_answers") {
    return typeof row.trial_form_id === "string" && typeof row.field_key === "string";
  }
  return typeof row.id === "string";
}

/** Flettet tilstand, eller null når en av dem ikke kan leses. */
function tryMerge(local: unknown, incoming: string): string | null {
  try {
    const merged =
      typeof local === "string" && local !== "" ? mergeTextStates(local, incoming) : incoming;
    textOf(merged);
    return merged;
  } catch {
    return null;
  }
}

/** `value` som JSON-tekst av teksten i tilstanden. */
function valueOf(state: string): string {
  return JSON.stringify(textOf(state));
}

/** Patcher en eksisterende rad. Gir null når innkommende `text_state` er ugyldig (raden urørt). */
function patchRow(local: LocalRow, incoming: LocalRow): LocalRow | null {
  const next: LocalRow = { ...local };
  for (const [column, value] of Object.entries(incoming)) {
    if (value === undefined || column === "text_state") continue;
    next[column] = value;
  }
  const incomingState = incoming.text_state;
  if (typeof incomingState === "string" && incomingState !== "") {
    const merged = tryMerge(local.text_state, incomingState);
    if (merged === null) return null;
    next.text_state = merged;
  }
  // Sannheten for tekst er tilstanden: `value` følger den, aldri omvendt.
  if (isTextField(next) && typeof next.text_state === "string" && next.text_state !== "") {
    next.value = valueOf(next.text_state);
  }
  return next;
}

/** Ny rad fra serveren. Ugyldig `text_state` tas ikke med; `value` står da som den kom. */
function newRow(incoming: LocalRow): LocalRow {
  const row: LocalRow = { ...incoming };
  const state = row.text_state;
  if (typeof state === "string" && state !== "") {
    const valid = tryMerge(null, state);
    if (valid === null) row.text_state = null;
    else if (isTextField(row)) row.value = valueOf(valid);
  }
  return row;
}

function isSoftDeleted(row: LocalRow): boolean {
  return row.deleted_at !== undefined && row.deleted_at !== null;
}

export const applyIncoming: ApplyIncoming = (table, localRows, changes, pendingKeys) => {
  const rows: (LocalRow | null)[] = localRows.map((row) => ({ ...row }));
  const skipped = new Set<string>();

  function findIndex(change: IncomingChange): number {
    const byKey = rows.findIndex((row) => row !== null && localRowKey(table, row) === change.key);
    if (byKey !== -1) return byKey;
    const id = change.row.id;
    if (typeof id !== "string") return -1;
    return rows.findIndex((row) => row !== null && row.id === id);
  }

  for (const change of changes) {
    const index = findIndex(change);
    const local = index === -1 ? null : rows[index]!;
    const key = local ? localRowKey(table, local) : change.key;

    if (pendingKeys.has(key) || pendingKeys.has(change.key)) {
      skipped.add(key);
      // Ingen kolonne overskrives; bare en annen enhets tekst flettes inn.
      const incomingState = change.row.text_state;
      if (local && change.kind !== "delete" && typeof incomingState === "string" && incomingState) {
        const merged = tryMerge(local.text_state, incomingState);
        if (merged !== null) {
          rows[index] = {
            ...local,
            text_state: merged,
            ...(isTextField(local) && { value: valueOf(merged) }),
          };
        }
      }
      continue;
    }

    if (change.kind === "delete" || isSoftDeleted(change.row)) {
      if (index !== -1) rows[index] = null;
      continue;
    }

    if (local) {
      const patched = patchRow(local, change.row);
      if (patched !== null) rows[index] = patched;
      continue;
    }

    // Ukjent rad: legges til bare når meldingen har nøkkelkolonnene.
    if (hasKeyColumns(table, change.row) && typeof change.row.id === "string") {
      rows.push(newRow(change.row));
    }
  }

  return { rows: rows.filter((row): row is LocalRow => row !== null), skippedKeys: [...skipped] };
};
