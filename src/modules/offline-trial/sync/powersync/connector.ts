/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Koblingen mellom den lokale databasen og serveren (oppgavekortet pkt. 5). Token hentes fra
 * `/api/prove/synk/token`; endringer sendes én transaksjon om gangen til
 * `/api/prove/synk/endringer` og fullføres bare når serveren svarte 200. Ellers kastes en feil,
 * så SDK-en prøver igjen senere. Serveren tåler at samme bunt kommer to ganger.
 *
 * Organisasjons-id-en sendes bare til tilgangssjekken; serveren stoler bare på `grant`.
 */
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import { TRIAL_TABLE_NAMES, type TrialTableName } from "./schema-columns";

interface UploadOperation {
  op: "PUT" | "PATCH";
  table: TrialTableName;
  id: string;
  data: Record<string, unknown>;
}

/**
 * PATCH fra SDK-en har bare kolonnene som ble endret. Serveren upserter `trial_answers` på
 * `(trial_form_id, field_key)` og må vite skjemaet for tenant-vokteren, så de faste kolonnene
 * hentes fra den lokale raden når de mangler.
 */
const IDENTITY_COLUMNS: Record<TrialTableName, readonly string[]> = {
  trial_forms: ["name"],
  trial_answers: ["trial_form_id", "field_key", "device_id"],
  trial_photos: ["trial_form_id", "field_key", "name", "size_bytes", "device_id"],
};

function isTrialTable(table: string): table is TrialTableName {
  return (TRIAL_TABLE_NAMES as string[]).includes(table);
}

async function withIdentity(
  db: AbstractPowerSyncDatabase,
  table: TrialTableName,
  entry: CrudEntry,
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { ...(entry.opData ?? {}) };
  const missing = IDENTITY_COLUMNS[table].filter((name) => !(name in data));
  if (missing.length === 0) return data;
  const row = await db.getOptional<Record<string, unknown>>(
    `SELECT ${missing.join(", ")} FROM ${table} WHERE id = ?`,
    [entry.id],
  );
  if (row) for (const name of missing) data[name] = row[name];
  return data;
}

export class TrialSyncConnector implements PowerSyncBackendConnector {
  constructor(private readonly organizationId: string) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const params = new URLSearchParams({ organisasjon: this.organizationId });
    const response = await fetch(`/api/prove/synk/token?${params}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Token for synk feilet (${response.status}).`);
    }
    const body = (await response.json()) as { token?: string; endpoint?: string };
    if (!body.token || !body.endpoint) throw new Error("Token for synk mangler i svaret.");
    return { endpoint: body.endpoint, token: body.token };
  }

  async uploadData(db: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await db.getNextCrudTransaction();
    if (!transaction) return;

    const operations: UploadOperation[] = [];
    for (const entry of transaction.crud) {
      if (!isTrialTable(entry.table)) {
        console.warn(`Synk: hopper over ukjent tabell ${entry.table}.`);
        continue;
      }
      if (entry.op !== "PUT" && entry.op !== "PATCH") {
        // Ingen skjerm sletter noe i prøven; DELETE sendes aldri (kortet, avgjørelse 1).
        console.warn(`Synk: hopper over ${entry.op} i ${entry.table}.`);
        continue;
      }
      operations.push({
        op: entry.op,
        table: entry.table,
        id: entry.id,
        data: await withIdentity(db, entry.table, entry),
      });
    }

    if (operations.length === 0) {
      await transaction.complete();
      return;
    }

    const response = await fetch("/api/prove/synk/endringer", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: this.organizationId, operations }),
    });
    if (response.status === 200) {
      await transaction.complete();
      return;
    }
    // Bare status og antall i loggen, aldri innholdet (fritekst fra skjemaet).
    console.warn(
      `Synk: serveren svarte ${response.status} på ${operations.length} endringer. Prøver igjen senere.`,
    );
    throw new Error(`Opplasting av endringer feilet (${response.status}).`);
  }
}
