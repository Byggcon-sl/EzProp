/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Fast id per nettleser-installasjon, bare for varselet «Endret av en annen» i prøve B
 * (oppgavekortet pkt. 6). Ikke tabellen `devices` (fase 2b).
 */
import { uuidv7 } from "@/shared/lib/uuid";

export const TRIAL_DEVICE_ID_KEY = "trial_device_id";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** Gir id-en som ligger lagret, eller lager og lagrer en ny uuidv7. */
export function getTrialDeviceId(storage: KeyValueStorage = globalThis.localStorage): string {
  const stored = storage.getItem(TRIAL_DEVICE_ID_KEY);
  if (stored) return stored;
  const id = uuidv7();
  storage.setItem(TRIAL_DEVICE_ID_KEY, id);
  return id;
}
