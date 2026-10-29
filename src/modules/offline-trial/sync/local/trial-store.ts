/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Lokal kjerne: `TrialSyncStore` over én lokal database (`LocalDb`) og en kandidatleser
 * (`LocalTrialReader`). Flyttet uten logikkendring fra `electricsql/store.ts`
 * (docs/funksjoner/fase1-kandidat-egenbygd.md, forarbeid pkt. 1). Brukes av ElectricSQL og egenbygd.
 * - Skriving: lokalt først i `synced_*` og i `outbox` i samme transaksjon. Buntene sendes i
 *   `seq`-rekkefølge til `POST /api/prove/synk/endringer` og tas ut av køen bare ved 200.
 * - Lesing: leseren henter rader og gir dem til `mergeIncoming`, som fletter dem inn med
 *   `applyIncoming` og skriver synkposisjonen i samme transaksjon, aldri før radene.
 * - Henting blokkerer aldri skriving; skrivingene går i kø etter hverandre (`serial`).
 *
 * Én fane sender køen (ingen `navigator.locks`, kjent svakhet).
 */
import { uuidv7 } from "@/shared/lib/uuid";
import type { TrialPhoto, TrialValue } from "../../answers";
import { textOf } from "../../text-merge";
import { listTrialFields, trialForm, type TrialFieldType } from "../../trial-form";
import { isTrialTableName, type TrialTableName } from "../local-columns";
import { confirmLocalPhoto, listConfirmedPhotoIds, putLocalPhoto } from "../photo-store";
import { isPhotoWaiting } from "../photo-upload";
import { nextTextState, safeTextOf, TEXT_WRITE_DELAY_MS } from "../text-state";
import type {
  IncomingChange,
  LocalRow,
  OutboxEntry,
  OutboxState,
  TrialAnswerRow,
  TrialFormSnapshot,
  TrialFormSummary,
  TrialPhotoRow,
  TrialSyncStatus,
} from "../types";
import { applyIncoming } from "./apply-incoming";
import { ANSWER_FORM_FIELD_INDEX, PHOTO_FORM_INDEX, requestResult } from "./idb";
import { normalizeLocalRow } from "./normalize-row";
import {
  ackBatch,
  createOutboxState,
  enqueue,
  keepBatch,
  localRowKey,
  MAX_OPERATIONS_PER_BATCH,
  outboxBatchBody,
  pendingKeys as outboxPendingKeys,
  retryDelayMs,
  shouldAckBatch,
  takeBatch,
} from "./outbox";
import {
  LOCAL_OUTBOX_STORE,
  LOCAL_SYNCED_STORES,
  OUTBOX_META_KEY,
  type CreateLocalTrialStore,
  type LocalTrialStore,
  type LocalTrialStoreOptions,
} from "./types";

const CHANGES_ROUTE = "/api/prove/synk/endringer";
/**
 * Hvor lenge en bekreftet nøkkel venter på sitt ekko fra serveren. Kommer ekkoet aldri (svaret
 * fikk en annen `id` på serveren), slippes nøkkelen etter dette, så nye endringer vises igjen.
 */
const CONFIRMED_TTL_MS = 120_000;

const FIELD_TYPES = new Map<string, TrialFieldType>(
  listTrialFields(trialForm).map((field) => [field.key, field.type]),
);

interface PendingText {
  formId: string;
  fieldKey: string;
  text: string;
  timer: ReturnType<typeof setTimeout>;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function toFormSummary(row: LocalRow): TrialFormSummary {
  return { id: str(row.id), name: str(row.name), createdAt: str(row.created_at) };
}

function toAnswerRow(row: LocalRow): TrialAnswerRow {
  let value = strOrNull(row.value);
  const textState = strOrNull(row.text_state);
  // Teksten følger tilstanden når den finnes (sannheten for tekst).
  if (textState && FIELD_TYPES.get(str(row.field_key)) === "text") {
    const text = safeTextOf(textState);
    if (text !== null) value = JSON.stringify(text);
  }
  return {
    id: str(row.id),
    trialFormId: str(row.trial_form_id),
    fieldKey: str(row.field_key),
    value,
    textState,
    deviceId: str(row.device_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    deletedAt: strOrNull(row.deleted_at),
  };
}

function toPhotoRow(row: LocalRow): TrialPhotoRow {
  return {
    id: str(row.id),
    trialFormId: str(row.trial_form_id),
    fieldKey: str(row.field_key),
    name: str(row.name),
    sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes ?? 0),
    sha256: strOrNull(row.sha256),
    uploadedAt: strOrNull(row.uploaded_at),
    deviceId: strOrNull(row.device_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    deletedAt: strOrNull(row.deleted_at),
  };
}

const byCreated = (a: LocalRow, b: LocalRow) =>
  str(a.created_at).localeCompare(str(b.created_at)) || str(a.id).localeCompare(str(b.id));

const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/** Kolonnene klienten sender for hver tabell (serverstyrte kolonner er aldri med). */
function outboxData(table: TrialTableName, row: LocalRow): LocalRow {
  const pick = (...columns: string[]) =>
    Object.fromEntries(columns.filter((c) => row[c] !== undefined).map((c) => [c, row[c]]));
  switch (table) {
    case "trial_forms":
      return pick("name", "created_at", "updated_at");
    case "trial_answers":
      return pick(
        "trial_form_id",
        "field_key",
        "value",
        "text_state",
        "device_id",
        "created_at",
        "updated_at",
      );
    case "trial_photos":
      return pick(
        "trial_form_id",
        "field_key",
        "name",
        "size_bytes",
        "device_id",
        "created_at",
        "updated_at",
      );
  }
}

export const createLocalTrialStore: CreateLocalTrialStore = async ({
  db,
  deviceId,
  organizationId,
  reader,
}: LocalTrialStoreOptions): Promise<LocalTrialStore> => {
  const stateStoreName = db.options.stateStore.name;
  const stateKeyPath = db.options.stateStore.keyPath;

  // --- Køen i minnet, lest fra `outbox` ved åpning. Lagres i samme transaksjon som radene. ---
  const [storedEntries, storedStates] = await Promise.all([
    db.readAll<OutboxEntry>(LOCAL_OUTBOX_STORE),
    db.readAll<Record<string, unknown>>(stateStoreName),
  ]);
  const meta = storedStates.find((state) => state[stateKeyPath] === OUTBOX_META_KEY);
  let outbox: OutboxState = createOutboxState(
    storedEntries,
    typeof meta?.nextSeq === "number" ? meta.nextSeq : 1,
  );
  /** Nøkler bekreftet med 200 som venter på ekkoet fra serveren (avgjørelse 2), med tidspunkt. */
  const confirmed = new Map<string, number>();
  /** Lyttere som kalles etter hver bunt serveren har svart 200 på (leseren). */
  const ackListeners = new Set<() => void>();
  let closed = false;

  // --- Skrivinger etter hverandre, så to samtidige endringer aldri regnes fra samme kø. ---
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  /** Bilder fra denne enheten som venter på opplasting (uten `uploaded_at`, ikke bekreftet). */
  async function waitingPhotos(): Promise<LocalRow[]> {
    const [photos, confirmedPhotos] = await Promise.all([
      db.readAll<LocalRow>(LOCAL_SYNCED_STORES.trial_photos),
      listConfirmedPhotoIds(),
    ]);
    return photos.filter((row) => isPhotoWaiting(row, deviceId, confirmedPhotos));
  }

  // --- Lyttere. Varslene samles og sendes etter at skrivingen er ferdig. ---
  const formListeners = new Set<(forms: TrialFormSummary[]) => void>();
  const snapshotListeners = new Map<(snapshot: TrialFormSnapshot) => void, string>();
  const statusListeners = new Set<() => void>();
  let pendingNotify: { forms: boolean; rows: boolean; status: boolean } | null = null;

  function notify(what: { forms?: boolean; rows?: boolean; status?: boolean }) {
    if (!pendingNotify) {
      pendingNotify = { forms: false, rows: false, status: false };
      setTimeout(flushNotify, 0);
    }
    pendingNotify.forms ||= Boolean(what.forms);
    pendingNotify.rows ||= Boolean(what.rows) || Boolean(what.forms);
    pendingNotify.status ||= Boolean(what.status);
  }

  function flushNotify() {
    const what = pendingNotify;
    pendingNotify = null;
    if (!what || closed) return;
    if (what.forms) for (const listener of formListeners) void sendForms(listener);
    if (what.rows) {
      for (const [listener, formId] of snapshotListeners) void sendSnapshot(formId, listener);
    }
    if (what.status) for (const listener of statusListeners) listener();
  }

  async function sendForms(listener: (forms: TrialFormSummary[]) => void) {
    try {
      const forms = await readForms();
      if (formListeners.has(listener)) listener(forms);
    } catch (error) {
      console.warn("Lagring: kunne ikke lese listen.", error);
    }
  }

  async function sendSnapshot(formId: string, listener: (snapshot: TrialFormSnapshot) => void) {
    try {
      const snapshot = await readSnapshot(formId);
      if (snapshotListeners.get(listener) === formId) listener(snapshot);
    } catch (error) {
      console.warn("Lagring: kunne ikke lese skjemaet.", error);
    }
  }

  // --- Lesing fra den lokale lagringen. ---
  async function readForms(): Promise<TrialFormSummary[]> {
    const rows = await db.readAll<LocalRow>(LOCAL_SYNCED_STORES.trial_forms);
    return rows
      .filter((row) => row.deleted_at == null)
      .sort((a, b) => byCreated(b, a))
      .map(toFormSummary);
  }

  async function readSnapshot(formId: string): Promise<TrialFormSnapshot> {
    return db.inTransaction(
      [
        LOCAL_SYNCED_STORES.trial_forms,
        LOCAL_SYNCED_STORES.trial_answers,
        LOCAL_SYNCED_STORES.trial_photos,
      ],
      "readonly",
      async (tx) => {
        const answerRange = IDBKeyRange.bound([formId, ""], [formId, "￿"]);
        const [form, answers, photos] = await Promise.all([
          requestResult(tx.objectStore(LOCAL_SYNCED_STORES.trial_forms).get(formId)),
          requestResult(
            tx
              .objectStore(LOCAL_SYNCED_STORES.trial_answers)
              .index(ANSWER_FORM_FIELD_INDEX)
              .getAll(answerRange),
          ),
          requestResult(
            tx.objectStore(LOCAL_SYNCED_STORES.trial_photos).index(PHOTO_FORM_INDEX).getAll(formId),
          ),
        ]);
        const formRow = form as LocalRow | undefined;
        return {
          form: formRow && formRow.deleted_at == null ? toFormSummary(formRow) : null,
          answers: (answers as LocalRow[]).map(toAnswerRow),
          photos: (photos as LocalRow[]).map(toPhotoRow),
        };
      },
    );
  }

  async function findAnswer(tx: IDBTransaction, formId: string, fieldKey: string) {
    const found = await requestResult(
      tx
        .objectStore(LOCAL_SYNCED_STORES.trial_answers)
        .index(ANSWER_FORM_FIELD_INDEX)
        .get([formId, fieldKey]),
    );
    return found as LocalRow | undefined;
  }

  // --- Lokal skriving: raden og køen i samme transaksjon. ---

  /** Skriver raden lokalt og legger den i køen. `build` får transaksjonen og gir raden. */
  function writeLocal(
    table: TrialTableName,
    build: (tx: IDBTransaction) => Promise<LocalRow>,
  ): Promise<LocalRow> {
    return serial(async () => {
      let next = outbox;
      const row = await db.inTransaction(
        [db.syncedStoreOf(table), LOCAL_OUTBOX_STORE, stateStoreName],
        "readwrite",
        async (tx) => {
          const built = await build(tx);
          next = enqueue(outbox, {
            op: "PUT",
            table,
            id: str(built.id),
            data: outboxData(table, built),
          });
          const changed = next.entries.find(
            (entry) =>
              entry.table === table &&
              entry.id === built.id &&
              !(next.inFlight ?? []).includes(entry.seq),
          );
          await requestResult(tx.objectStore(db.syncedStoreOf(table)).put(built));
          if (changed) await requestResult(tx.objectStore(LOCAL_OUTBOX_STORE).put(changed));
          await requestResult(
            tx
              .objectStore(stateStoreName)
              .put({ [stateKeyPath]: OUTBOX_META_KEY, nextSeq: next.nextSeq }),
          );
          return built;
        },
      );
      outbox = next;
      notify({ forms: table === "trial_forms", rows: true, status: true });
      scheduleSend(0);
      return row;
    });
  }

  async function writeValue(formId: string, fieldKey: string, value: TrialValue) {
    await writeLocal("trial_answers", async (tx) => {
      const now = new Date().toISOString();
      const existing = await findAnswer(tx, formId, fieldKey);
      const json = JSON.stringify(value);
      if (existing) return { ...existing, value: json, device_id: deviceId, updated_at: now };
      return {
        id: uuidv7(),
        trial_form_id: formId,
        field_key: fieldKey,
        value: json,
        text_state: null,
        device_id: deviceId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
    });
  }

  /** Siste tekst-tilstand denne enheten skrev, per skjema og felt. */
  const ownTextStates = new Map<string, string>();
  const pendingText = new Map<string, PendingText>();

  async function writeText(formId: string, fieldKey: string, text: string) {
    const key = `${formId}:${fieldKey}`;
    const row = await writeLocal("trial_answers", async (tx) => {
      const now = new Date().toISOString();
      const existing = await findAnswer(tx, formId, fieldKey);
      const state = nextTextState(
        strOrNull(existing?.text_state),
        ownTextStates.get(key) ?? null,
        text,
      );
      const json = JSON.stringify(textOf(state));
      if (existing) {
        return {
          ...existing,
          value: json,
          text_state: state,
          device_id: deviceId,
          updated_at: now,
        };
      }
      return {
        id: uuidv7(),
        trial_form_id: formId,
        field_key: fieldKey,
        value: json,
        text_state: state,
        device_id: deviceId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
    });
    ownTextStates.set(key, str(row.text_state));
  }

  async function flushOne(key: string) {
    const pending = pendingText.get(key);
    if (!pending) return;
    pendingText.delete(key);
    clearTimeout(pending.timer);
    try {
      await writeText(pending.formId, pending.fieldKey, pending.text);
      for (const waiter of pending.waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of pending.waiters) waiter.reject(error);
    }
  }

  async function flush() {
    await Promise.all([...pendingText.keys()].map((key) => flushOne(key)));
  }

  function scheduleText(formId: string, fieldKey: string, text: string): Promise<void> {
    const key = `${formId}:${fieldKey}`;
    const existing = pendingText.get(key);
    if (existing) clearTimeout(existing.timer);
    return new Promise<void>((resolve, reject) => {
      const waiters = existing?.waiters ?? [];
      waiters.push({ resolve, reject });
      pendingText.set(key, {
        formId,
        fieldKey,
        text,
        waiters,
        timer: setTimeout(() => void flushOne(key), TEXT_WRITE_DELAY_MS),
      });
    });
  }

  // --- Sending av køen. ---
  let sending = false;
  let sendAttempt = 0;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let retryWaiting = false;

  function scheduleSend(delay: number, force = false) {
    if (closed) return;
    // Ventetiden etter en feil holdes, også når nye endringer kommer (høyst ett kall per 5 s).
    if (retryWaiting && !force) return;
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = null;
      retryWaiting = false;
      void sendBatches();
    }, delay);
  }

  async function sendBatches() {
    if (sending || closed) return;
    sending = true;
    try {
      while (!closed && isOnline()) {
        // Uttak og tilbakelegging går i samme rekke som skrivingene, så en endring som kommer
        // mens bunten er underveis, aldri flettes inn i den (den får ny seq).
        const taken = await serial(async () => {
          const result = takeBatch(outbox, MAX_OPERATIONS_PER_BATCH);
          if (result) outbox = result.state;
          return result;
        });
        if (!taken) return;
        let status: number | undefined;
        try {
          const response = await fetch(CHANGES_ROUTE, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(outboxBatchBody(organizationId, taken.batch)),
          });
          status = response.status;
        } catch {
          status = undefined;
        }
        if (shouldAckBatch(status)) {
          await serial(async () => {
            const sent = outbox.inFlight ?? [];
            await db.inTransaction([LOCAL_OUTBOX_STORE], "readwrite", async (tx) => {
              const objectStore = tx.objectStore(LOCAL_OUTBOX_STORE);
              for (const seq of sent) await requestResult(objectStore.delete(seq));
            });
            const now = Date.now();
            for (const entry of taken.batch) {
              confirmed.set(localRowKey(entry.table, { ...entry.data, id: entry.id }), now);
            }
            outbox = ackBatch(outbox);
          });
          sendAttempt = 0;
          notify({ status: true });
          for (const listener of ackListeners) listener();
          continue;
        }
        await serial(async () => {
          outbox = keepBatch(outbox);
        });
        // Bare status og antall i loggen, aldri innholdet (fritekst fra skjemaet).
        console.warn(
          `Synk: serveren svarte ${status ?? "ikke"} på ${taken.batch.length} endringer. Prøver igjen senere.`,
        );
        const delay = retryDelayMs(sendAttempt);
        sendAttempt++;
        retryWaiting = true;
        if (sendTimer) clearTimeout(sendTimer);
        sendTimer = setTimeout(() => {
          sendTimer = null;
          retryWaiting = false;
          void sendBatches();
        }, delay);
        return;
      }
    } finally {
      sending = false;
    }
  }

  // --- Innfletting av rader fra serveren. ---

  function currentPendingKeys(): Set<string> {
    const keys = outboxPendingKeys(outbox, localRowKey);
    const now = Date.now();
    for (const [key, at] of confirmed) {
      if (now - at > CONFIRMED_TTL_MS) confirmed.delete(key);
      else keys.add(key);
    }
    return keys;
  }

  /**
   * Fletter endringer for én tabell inn i `synced_*`. `stateRow` (synkposisjonen) skrives i samme
   * transaksjon, etter radene. `useConfirmed = false` brukes av testkroken (bare køen beskytter da).
   */
  function mergeIncoming(
    table: TrialTableName,
    changes: readonly IncomingChange[],
    stateRow: Record<string, unknown> | null,
    useConfirmed = true,
  ): Promise<void> {
    if (changes.length === 0 && !stateRow) return Promise.resolve();
    return serial(async () => {
      const storeName = db.syncedStoreOf(table);
      const pending = useConfirmed ? currentPendingKeys() : outboxPendingKeys(outbox, localRowKey);
      let resolvedKeys: string[] = [];
      await db.inTransaction([storeName, stateStoreName], "readwrite", async (tx) => {
        const objectStore = tx.objectStore(storeName);
        if (changes.length > 0) {
          const localRows = (await requestResult(objectStore.getAll())) as LocalRow[];
          const { rows, skippedKeys } = applyIncoming(table, localRows, changes, pending);
          resolvedKeys = skippedKeys;
          // Svaret fikk en annen id på serveren: id-en tas over, innholdet står (ikke brukerdata).
          if (table === "trial_answers") adoptServerIds(rows, changes, new Set(skippedKeys));
          const before = new Map(localRows.map((row) => [str(row.id), row]));
          const after = new Set(rows.map((row) => str(row.id)));
          // Slett før skriv, så den unike indeksen på (skjema, felt) aldri kolliderer.
          for (const id of before.keys()) {
            if (!after.has(id)) await requestResult(objectStore.delete(id));
          }
          for (const row of rows) {
            const old = before.get(str(row.id));
            if (!old || JSON.stringify(old) !== JSON.stringify(row)) {
              await requestResult(objectStore.put(row));
            }
          }
        }
        if (stateRow) {
          await requestResult(tx.objectStore(stateStoreName).put(stateRow));
        }
      });
      if (useConfirmed) {
        // Første melding for en bekreftet nøkkel er ekkoet av vår egen skriving.
        for (const key of resolvedKeys) confirmed.delete(key);
      }
      if (changes.length > 0) {
        notify({ forms: table === "trial_forms", rows: true, status: table === "trial_photos" });
      }
    });
  }

  function adoptServerIds(
    rows: LocalRow[],
    changes: readonly IncomingChange[],
    skipped: ReadonlySet<string>,
  ) {
    for (const change of changes) {
      if (change.kind === "delete" || !skipped.has(change.key)) continue;
      const serverId = change.row.id;
      if (typeof serverId !== "string") continue;
      const row = rows.find((candidate) => localRowKey("trial_answers", candidate) === change.key);
      if (row && row.id !== serverId && !rows.some((other) => other.id === serverId)) {
        row.id = serverId;
      }
    }
  }

  /** Alt for tabellen hentes på nytt (Electric: 409 eller `must-refetch`). Køen og usendte rader står. */
  function resetTable(table: TrialTableName, stateKey: string): Promise<void> {
    return serial(async () => {
      const storeName = db.syncedStoreOf(table);
      const keep = currentPendingKeys();
      await db.inTransaction([storeName, stateStoreName], "readwrite", async (tx) => {
        await requestResult(tx.objectStore(stateStoreName).delete(stateKey));
        const objectStore = tx.objectStore(storeName);
        const rows = (await requestResult(objectStore.getAll())) as LocalRow[];
        for (const row of rows) {
          if (!keep.has(localRowKey(table, row))) {
            await requestResult(objectStore.delete(str(row.id)));
          }
        }
      });
      notify({ forms: table === "trial_forms", rows: true, status: table === "trial_photos" });
    });
  }

  /** Sletter én rad i tilstandslageret (f.eks. en ugyldig markør). Rader og kø røres ikke. */
  function deleteState(key: string): Promise<void> {
    return serial(async () => {
      await db.inTransaction([stateStoreName], "readwrite", async (tx) => {
        await requestResult(tx.objectStore(stateStoreName).delete(key));
      });
    });
  }

  // --- Nett av og på. ---
  const onOnline = () => {
    sendAttempt = 0;
    scheduleSend(0, true);
    reader.wake();
    notify({ status: true });
  };
  const onOffline = () => notify({ status: true });
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  reader.start({
    organizationId,
    storedState: storedStates.filter((state) => state[stateKeyPath] !== OUTBOX_META_KEY),
    isClosed: () => closed,
    isOnline,
    mergeIncoming: (table, changes, stateRow) => mergeIncoming(table, changes, stateRow),
    resetTable,
    deleteState,
    notifyStatus: () => notify({ status: true }),
    afterAck: (listener) => {
      ackListeners.add(listener);
    },
  });
  scheduleSend(0);

  async function readRows(table: string, formId?: string): Promise<LocalRow[]> {
    if (table === "outbox") return db.readAll<LocalRow>(LOCAL_OUTBOX_STORE);
    if (table === stateStoreName) {
      const rows = await db.readAll<LocalRow>(stateStoreName);
      return rows.filter((row) => row[stateKeyPath] !== OUTBOX_META_KEY);
    }
    if (!isTrialTableName(table)) throw new Error("Ukjent lager.");
    const rows = await db.readAll<LocalRow>(db.syncedStoreOf(table));
    if (formId === undefined) return rows;
    return rows.filter((row) =>
      table === "trial_forms" ? row.id === formId : row.trial_form_id === formId,
    );
  }

  return {
    flush,

    async close() {
      await flush();
      closed = true;
      if (sendTimer) clearTimeout(sendTimer);
      reader.stop();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
      formListeners.clear();
      snapshotListeners.clear();
      statusListeners.clear();
      ackListeners.clear();
      await chain;
      await db.close();
    },

    listForms: readForms,

    subscribeForms(listener) {
      formListeners.add(listener);
      void sendForms(listener);
      return () => {
        formListeners.delete(listener);
      };
    },

    async createForm(name: string): Promise<string> {
      const id = uuidv7();
      // Skjemaet legges alltid i køen før første svar (lavere seq), så serveren kjenner det.
      await writeLocal("trial_forms", async (tx) => {
        let formName = name.trim();
        if (formName === "") {
          const rows = (await requestResult(
            tx.objectStore(LOCAL_SYNCED_STORES.trial_forms).getAll(),
          )) as LocalRow[];
          formName = `Testskjema ${rows.filter((row) => row.deleted_at == null).length + 1}`;
        }
        const now = new Date().toISOString();
        return { id, name: formName, created_at: now, updated_at: now, deleted_at: null };
      });
      return id;
    },

    async setAnswer(formId: string, fieldKey: string, value: TrialValue): Promise<void> {
      const type = FIELD_TYPES.get(fieldKey);
      if (!type || type === "photo") return;
      if (type === "text") {
        return scheduleText(formId, fieldKey, typeof value === "string" ? value : "");
      }
      // Tekst som venter skrives først, så rekkefølgen i køen følger det brukeren gjorde.
      await flush();
      await writeValue(formId, fieldKey, value);
    },

    async addPhoto(formId: string, fieldKey: string, file: Blob, photo: TrialPhoto) {
      // Filen først: finnes raden, skal filen også finnes (ingenting går tapt).
      await putLocalPhoto(photo.id, file);
      await writeLocal("trial_photos", async () => {
        const now = new Date().toISOString();
        return {
          id: photo.id,
          trial_form_id: formId,
          field_key: fieldKey,
          name: photo.name,
          size_bytes: photo.sizeBytes,
          sha256: null,
          uploaded_at: null,
          device_id: deviceId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
      });
    },

    subscribe(formId, listener) {
      snapshotListeners.set(listener, formId);
      void sendSnapshot(formId, listener);
      return () => {
        snapshotListeners.delete(listener);
        void flush();
      };
    },

    async status(): Promise<TrialSyncStatus> {
      const photos = await waitingPhotos();
      return {
        online: isOnline(),
        pendingChanges: outbox.entries.length,
        pendingPhotos: photos.length,
      };
    },

    onStatusChange(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    async listPendingPhotos(): Promise<TrialPhotoRow[]> {
      const photos = await waitingPhotos();
      return photos.sort(byCreated).map(toPhotoRow);
    },

    markPhotoUploaded(id: string, sha256: string): Promise<void> {
      // Bare i bildelageret, aldri i køen eller de synkede radene (småfunn 6): serveren eier
      // `uploaded_at` og `sha256` og setter dem selv.
      return serial(async () => {
        await confirmLocalPhoto(id, sha256);
        notify({ status: true });
      });
    },

    async applySyncedRows(table, rows) {
      const changes: IncomingChange[] = [];
      for (const raw of rows) {
        const row = normalizeLocalRow(table, raw);
        if (typeof row.id !== "string") continue;
        changes.push({ table, kind: "insert", key: localRowKey(table, row), row });
      }
      await mergeIncoming(table, changes, null, false);
    },

    readRows,
  };
};
