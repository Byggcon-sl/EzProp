/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * `TrialSyncStore` for ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 5–6,
 * avgjørelse D og «Avgjørelser før bygging» 1–4). Electric synker bare lesing; resten eier vi:
 * - Skriving: lokalt først i `synced_*` og i `outbox` i samme transaksjon. Buntene sendes i
 *   `seq`-rekkefølge til `POST /api/prove/synk/endringer` og tas ut av køen bare ved 200.
 * - Lesing: én `fetch`-løkke per tabell mot proxy-ruten (`TRIAL_SHAPE_ROUTE`). Synkposisjonen
 *   (`shape_state`) skrives i samme transaksjon som radene, altså aldri før de er flettet inn.
 *   Feil prøves igjen etter `retryDelayMs` (aldri tettere enn 5 s per tabell). 409 eller
 *   `must-refetch`: synkposisjon og synkede rader for tabellen slettes og alt hentes på nytt;
 *   køen røres aldri, og rader med usendte endringer blir stående.
 * - Henting blokkerer aldri skriving; skrivingene går i kø etter hverandre (`serial`).
 *
 * Valgt bort: `ShapeStream` fra `@electric-sql/client` (holdt ikke 5-sekundersregelen, se
 * resultatfilen). Én fane sender køen (ingen `navigator.locks`, kjent svakhet).
 */
import { uuidv7 } from "@/shared/lib/uuid";
import type { TrialPhoto, TrialValue } from "../../answers";
import { textOf } from "../../text-merge";
import { listTrialFields, trialForm, type TrialFieldType } from "../../trial-form";
import { TRIAL_TABLE_NAMES, type TrialTableName } from "../local-columns";
import { putLocalPhoto } from "../photo-store";
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
  TrialSyncStore,
  TrialSyncTestable,
} from "../types";
import { applyIncoming } from "./apply-incoming";
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
  nextShapeParams,
  normalizeShapeRow,
  parseShapeMessages,
  readShapeHeaders,
  shapeSearchParams,
} from "./shape-messages";
import {
  ANSWER_FORM_FIELD_INDEX,
  closeElectricDb,
  inTransaction,
  PHOTO_FORM_INDEX,
  readAll,
  requestResult,
  syncedStoreOf,
} from "./storage";
import { ELECTRIC_STORES, TRIAL_SHAPE_ROUTE, type ShapeState } from "./types";

const CHANGES_ROUTE = "/api/prove/synk/endringer";
/** Nøkkelen i `shape_state` der neste `seq` for køen ligger (ingen tabell heter dette). */
const OUTBOX_META_KEY = "outbox_next_seq";
/**
 * Hvor lenge en bekreftet nøkkel venter på sitt ekko fra Electric. Kommer ekkoet aldri (svaret
 * fikk en annen `id` på serveren), slippes nøkkelen etter dette, så nye endringer vises igjen.
 */
const CONFIRMED_TTL_MS = 120_000;

const FIELD_TYPES = new Map<string, TrialFieldType>(
  listTrialFields(trialForm).map((field) => [field.key, field.type]),
);

type ElectricReadable = TrialTableName | "shape_state" | "outbox";

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

export async function createElectricTrialStore(
  deviceId: string,
  organizationId: string,
): Promise<TrialSyncStore & TrialSyncTestable> {
  // --- Køen i minnet, lest fra `outbox` ved åpning. Lagres i samme transaksjon som radene. ---
  const [storedEntries, storedStates] = await Promise.all([
    readAll<OutboxEntry>(ELECTRIC_STORES.outbox),
    readAll<Record<string, unknown>>(ELECTRIC_STORES.shapeState),
  ]);
  const meta = storedStates.find((state) => state.table === OUTBOX_META_KEY);
  let outbox: OutboxState = createOutboxState(
    storedEntries,
    typeof meta?.nextSeq === "number" ? meta.nextSeq : 1,
  );
  /** Nøkler bekreftet med 200 som venter på ekkoet fra Electric (avgjørelse 2), med tidspunkt. */
  const confirmed = new Map<string, number>();
  let closed = false;

  // --- Skrivinger etter hverandre, så to samtidige endringer aldri regnes fra samme kø. ---
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
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
    const rows = await readAll<LocalRow>(ELECTRIC_STORES.trial_forms);
    return rows
      .filter((row) => row.deleted_at == null)
      .sort((a, b) => byCreated(b, a))
      .map(toFormSummary);
  }

  async function readSnapshot(formId: string): Promise<TrialFormSnapshot> {
    return inTransaction(
      [ELECTRIC_STORES.trial_forms, ELECTRIC_STORES.trial_answers, ELECTRIC_STORES.trial_photos],
      "readonly",
      async (tx) => {
        const answerRange = IDBKeyRange.bound([formId, ""], [formId, "￿"]);
        const [form, answers, photos] = await Promise.all([
          requestResult(tx.objectStore(ELECTRIC_STORES.trial_forms).get(formId)),
          requestResult(
            tx
              .objectStore(ELECTRIC_STORES.trial_answers)
              .index(ANSWER_FORM_FIELD_INDEX)
              .getAll(answerRange),
          ),
          requestResult(
            tx.objectStore(ELECTRIC_STORES.trial_photos).index(PHOTO_FORM_INDEX).getAll(formId),
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
        .objectStore(ELECTRIC_STORES.trial_answers)
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
      const row = await inTransaction(
        [syncedStoreOf(table), ELECTRIC_STORES.outbox, ELECTRIC_STORES.shapeState],
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
          await requestResult(tx.objectStore(syncedStoreOf(table)).put(built));
          if (changed) await requestResult(tx.objectStore(ELECTRIC_STORES.outbox).put(changed));
          await requestResult(
            tx
              .objectStore(ELECTRIC_STORES.shapeState)
              .put({ table: OUTBOX_META_KEY, nextSeq: next.nextSeq }),
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
            await inTransaction([ELECTRIC_STORES.outbox], "readwrite", async (tx) => {
              const objectStore = tx.objectStore(ELECTRIC_STORES.outbox);
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
   * Fletter endringer for én tabell inn i `synced_*`. `shapeState` skrives i samme transaksjon,
   * etter radene. `useConfirmed = false` brukes av testkroken (bare køen beskytter da).
   */
  function mergeIncoming(
    table: TrialTableName,
    changes: readonly IncomingChange[],
    shapeState: ShapeState | null,
    useConfirmed = true,
  ): Promise<void> {
    if (changes.length === 0 && !shapeState) return Promise.resolve();
    return serial(async () => {
      const storeName = syncedStoreOf(table);
      const pending = useConfirmed ? currentPendingKeys() : outboxPendingKeys(outbox, localRowKey);
      let resolvedKeys: string[] = [];
      await inTransaction([storeName, ELECTRIC_STORES.shapeState], "readwrite", async (tx) => {
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
        if (shapeState) {
          await requestResult(tx.objectStore(ELECTRIC_STORES.shapeState).put(shapeState));
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

  /** 409 eller `must-refetch`: alt for tabellen hentes på nytt. Køen og usendte rader står. */
  function resetTable(table: TrialTableName): Promise<void> {
    return serial(async () => {
      const storeName = syncedStoreOf(table);
      const keep = currentPendingKeys();
      await inTransaction([storeName, ELECTRIC_STORES.shapeState], "readwrite", async (tx) => {
        await requestResult(tx.objectStore(ELECTRIC_STORES.shapeState).delete(table));
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

  // --- Henting av shapes, én løkke per tabell. ---
  const controllers = new Map<TrialTableName, AbortController>();
  const wakeups = new Map<TrialTableName, () => void>();

  /** Venter `ms`, eller til nettet kommer tilbake / lageret lukkes. */
  function sleep(table: TrialTableName, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wakeups.delete(table);
        resolve();
      }
      wakeups.set(table, done);
    });
  }

  async function shapeLoop(table: TrialTableName) {
    let state = (storedStates.find((row) => row.table === table) as ShapeState | undefined) ?? null;
    let cursor: string | undefined;
    let attempt = 0;
    let lastCall = 0;

    async function failed() {
      const delay = retryDelayMs(attempt);
      attempt++;
      await sleep(table, delay);
    }

    while (!closed) {
      if (!isOnline()) {
        await sleep(table, 60_000);
        continue;
      }
      // Aldri to kall for samme tabell tettere enn 5 s etter en feil (attempt > 0).
      if (attempt > 0) {
        const wait = lastCall + retryDelayMs(attempt - 1) - Date.now();
        if (wait > 0) await sleep(table, wait);
        if (closed) return;
      }
      const params = nextShapeParams(
        organizationId,
        table,
        state,
        state?.upToDate ?? false,
        cursor,
      );
      const controller = new AbortController();
      controllers.set(table, controller);
      lastCall = Date.now();
      let response: Response;
      try {
        response = await fetch(`${TRIAL_SHAPE_ROUTE}?${shapeSearchParams(params)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        if (closed) return;
        await failed();
        continue;
      } finally {
        controllers.delete(table);
      }

      if (response.status === 409) {
        await response.text().catch(() => undefined);
        await resetTable(table);
        state = null;
        cursor = undefined;
        await failed();
        continue;
      }
      if (response.status !== 200 && response.status !== 204) {
        await response.text().catch(() => undefined);
        await failed();
        continue;
      }

      const headers = readShapeHeaders(response.headers);
      let body: unknown = [];
      if (response.status === 200) {
        try {
          body = await response.json();
        } catch {
          if (closed) return;
          await failed();
          continue;
        }
      }
      const parsed = parseShapeMessages(table, body);
      if (parsed.mustRefetch) {
        await resetTable(table);
        state = null;
        cursor = undefined;
        await failed();
        continue;
      }
      const nextState: ShapeState | null =
        headers.handle && headers.offset
          ? {
              table,
              handle: headers.handle,
              offset: headers.offset,
              upToDate: Boolean(state?.upToDate) || parsed.upToDate || headers.upToDate,
            }
          : state;
      try {
        await mergeIncoming(table, parsed.changes, nextState === state ? null : nextState);
      } catch (error) {
        console.warn("Synk: kunne ikke legge inn rader fra serveren.", error);
        await failed();
        continue;
      }
      state = nextState;
      cursor = headers.cursor ?? cursor;
      attempt = 0;
      notify({ status: true });
    }
  }

  // --- Nett av og på. ---
  const onOnline = () => {
    sendAttempt = 0;
    scheduleSend(0, true);
    for (const wake of [...wakeups.values()]) wake();
    notify({ status: true });
  };
  const onOffline = () => notify({ status: true });
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  for (const table of TRIAL_TABLE_NAMES) void shapeLoop(table);
  scheduleSend(0);

  async function readRows(table: ElectricReadable, formId?: string): Promise<LocalRow[]> {
    if (table === "outbox") return readAll<LocalRow>(ELECTRIC_STORES.outbox);
    if (table === "shape_state") {
      const rows = await readAll<LocalRow>(ELECTRIC_STORES.shapeState);
      return rows.filter((row) => row.table !== OUTBOX_META_KEY);
    }
    const rows = await readAll<LocalRow>(syncedStoreOf(table));
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
      for (const controller of controllers.values()) controller.abort();
      for (const wake of [...wakeups.values()]) wake();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
      formListeners.clear();
      snapshotListeners.clear();
      statusListeners.clear();
      await chain;
      await closeElectricDb();
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
            tx.objectStore(ELECTRIC_STORES.trial_forms).getAll(),
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
      const photos = await readAll<LocalRow>(ELECTRIC_STORES.trial_photos);
      return {
        online: isOnline(),
        pendingChanges: outbox.entries.length,
        pendingPhotos: photos.filter(
          (row) => row.uploaded_at == null && row.device_id === deviceId && row.deleted_at == null,
        ).length,
      };
    },

    onStatusChange(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    async listPendingPhotos(): Promise<TrialPhotoRow[]> {
      const photos = await readAll<LocalRow>(ELECTRIC_STORES.trial_photos);
      return photos
        .filter(
          (row) => row.uploaded_at == null && row.device_id === deviceId && row.deleted_at == null,
        )
        .sort(byCreated)
        .map(toPhotoRow);
    },

    markPhotoUploaded(id: string, sha256: string): Promise<void> {
      // Bare lokalt, aldri i køen: serveren eier `uploaded_at` og `sha256`.
      return serial(async () => {
        await inTransaction([ELECTRIC_STORES.trial_photos], "readwrite", async (tx) => {
          const objectStore = tx.objectStore(ELECTRIC_STORES.trial_photos);
          const row = (await requestResult(objectStore.get(id))) as LocalRow | undefined;
          if (!row) return;
          await requestResult(
            objectStore.put({ ...row, uploaded_at: new Date().toISOString(), sha256 }),
          );
        });
        notify({ rows: true, status: true });
      });
    },

    async applySyncedRows(table, rows) {
      const changes: IncomingChange[] = [];
      for (const raw of rows) {
        const row = normalizeShapeRow(table, raw);
        if (typeof row.id !== "string") continue;
        changes.push({ table, kind: "insert", key: localRowKey(table, row), row });
      }
      await mergeIncoming(table, changes, null, false);
    },

    readRows,
  };
}
