import type { ReportFieldChange, RoomRefresh, SaveFieldResult } from "@/core/reports/types";
import { isActionError, ROOM_ACTION_MESSAGES, type ActionError } from "./room-messages";

/*
 * Lagringskøen per felt for badet (docs/funksjoner/fase2a-badet-pc.md Omfang 8, design avsnitt 10
 * og 17). Én kø for hele rommet, så bytte av punkt aldri mister tekst: feltene registrerer seg
 * her, og verdien de viser står her, ikke i komponenten. Ingenting lagres i localStorage eller
 * IndexedDB (2b).
 *
 * Hver endring er én endring av ett felt med verdien klienten så (`base`). Serveren svarer
 * `saved` (med det som er regnet på nytt) eller `conflict` («Endret av andre») med nyeste verdi.
 * Ingenting overskrives før takstmannen har valgt. Feiler nettet, beholdes verdien, og lagringen
 * prøves igjen når nettet er tilbake.
 *
 * Ren TypeScript uten React, så den kan testes for seg (field-save-store.test.ts).
 * Støtter hovedmål: de ansatte (ingen «Lagre»-knapp, ingen tekst går tapt).
 */

/** Status per felt. `pending` er venting før lagring (vises som «Lagrer …»). */
export type FieldStatus =
  "idle" | "pending" | "saving" | "saved" | "failed" | "offline" | "conflict" | "invalid";

/** Lager endringen som sendes. `rowId` er raden serveren sist svarte med (nye svar). */
export type ChangeBuilder = (
  value: unknown,
  base: unknown,
  rowId: string | null,
) => ReportFieldChange;

/** Kontroll i nettleseren før lagring. Gir norsk melding, eller `null` når verdien kan lagres. */
export type FieldValidator = (value: unknown) => string | null;

export type FieldEntry = {
  key: string;
  value: unknown;
  /** Verdien serveren sist bekreftet (det klienten «så»). */
  base: unknown;
  status: FieldStatus;
  /** Når feltet sist ble lagret (ms siden 1970). */
  savedAt: number | null;
  /** Nyeste verdi fra serveren ved «Endret av andre». */
  conflictValue: unknown;
  /** Melding ved `invalid` og `failed` (fra kontrollen eller serveren). */
  error: string | null;
  rowId: string | null;
};

export type SendResult = SaveFieldResult | ActionError;

type Timer = ReturnType<typeof setTimeout>;

export type FieldSaveStoreOptions = {
  send(change: ReportFieldChange): Promise<SendResult>;
  /** Kalles med det serveren regnet på nytt etter hver lagring. */
  onRefresh(refresh: RoomRefresh): void;
  isOnline(): boolean;
  now?(): number;
  setTimer?(run: () => void, ms: number): Timer;
  clearTimer?(timer: Timer): void;
};

type Internal = {
  entry: FieldEntry;
  build: ChangeBuilder;
  validate: FieldValidator | null;
  timer: Timer | null;
  inFlight: Promise<void> | null;
  /**
   * Siste verdi serveren sendte for feltet (fra visningen eller det som er regnet på nytt). Bare
   * en ny serververdi tas inn; samme gamle verdi fra første visning overskriver aldri det som er
   * lagret siden.
   */
  serverSeen: unknown;
};

/** Statusene som betyr at noe ikke er lagret ennå. */
const UNSAVED: readonly FieldStatus[] = [
  "pending",
  "saving",
  "failed",
  "offline",
  "conflict",
  "invalid",
];

/** Statusene som teller som «ikke lagret – prøv igjen» i toppen. */
const NOT_SAVED: readonly FieldStatus[] = ["failed", "conflict", "invalid"];

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type SaveSummary = {
  status: "saved" | "saving" | "failed" | "offline";
  failedCount: number;
  savedAt: number | null;
};

export type FlushResult = { ok: true } | { ok: false; failedKeys: string[] };

export class FieldSaveStore {
  private readonly fields = new Map<string, Internal>();
  private readonly listeners = new Set<() => void>();
  private summaryCache: SaveSummary = { status: "saved", failedCount: 0, savedAt: null };

  constructor(private readonly options: FieldSaveStoreOptions) {}

  // --- Lesing ------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(key: string): FieldEntry | undefined {
    return this.fields.get(key)?.entry;
  }

  /** Samlet status til toppfeltet. Samme objekt til noe endrer seg (for `useSyncExternalStore`). */
  getSummary = (): SaveSummary => this.summaryCache;

  /** Om noe ikke er lagret ennå (`beforeunload`). */
  hasUnsaved(): boolean {
    for (const field of this.fields.values()) {
      if (UNSAVED.includes(field.entry.status)) return true;
    }
    return false;
  }

  /** Om noe venter eller er på vei til serveren. */
  hasPending(): boolean {
    for (const field of this.fields.values()) {
      if (field.entry.status === "pending" || field.entry.status === "saving") return true;
    }
    return false;
  }

  // --- Registrering ------------------------------------------------------------------------

  /**
   * Feltet finnes i køen fra første visning. Finnes det alt (takstmannen har vært på punktet før),
   * beholdes verdien og statusen; bare hvordan endringen bygges, oppdateres. Varsler ingen, så den
   * kan kalles mens komponenten tegnes.
   */
  ensure(
    key: string,
    serverValue: unknown,
    build: ChangeBuilder,
    options: { rowId?: string | null; validate?: FieldValidator | null } = {},
  ): FieldEntry {
    const existing = this.fields.get(key);
    if (existing) {
      existing.build = build;
      existing.validate = options.validate ?? null;
      return existing.entry;
    }
    const entry: FieldEntry = {
      key,
      value: serverValue,
      base: serverValue,
      status: "idle",
      savedAt: null,
      conflictValue: null,
      error: null,
      rowId: options.rowId ?? null,
    };
    this.fields.set(key, {
      entry,
      build,
      validate: options.validate ?? null,
      timer: null,
      inFlight: null,
      serverSeen: serverValue,
    });
    return entry;
  }

  /**
   * Ny verdi fra serveren (etter en handling). Tas bare inn når feltet ikke har ulagrede endringer,
   * slik at takstmannens tekst aldri overskrives.
   */
  syncServer(key: string, serverValue: unknown, rowId?: string | null): void {
    const field = this.fields.get(key);
    if (!field) return;
    const { entry } = field;
    const sameRow = rowId === undefined || rowId === entry.rowId;
    if (sameValue(field.serverSeen, serverValue) && sameRow) return;
    field.serverSeen = serverValue;
    if (entry.status !== "idle" && entry.status !== "saved") return;
    if (!sameValue(entry.value, entry.base)) return;
    if (sameValue(entry.base, serverValue) && (rowId === undefined || rowId === entry.rowId)) {
      return;
    }
    this.update(field, {
      value: serverValue,
      base: serverValue,
      rowId: rowId === undefined ? entry.rowId : rowId,
    });
  }

  /** Glemmer feltene med denne starten (for eksempel et avvik som er fjernet). */
  drop(prefix: string): void {
    let changed = false;
    for (const [key, field] of this.fields) {
      if (!key.startsWith(prefix)) continue;
      if (field.timer) this.clear(field.timer);
      this.fields.delete(key);
      changed = true;
    }
    if (changed) this.emit();
  }

  // --- Endring og lagring ------------------------------------------------------------------

  /** Ny verdi fra feltet. Lagres etter `delayMs` uten ny endring (0 = med en gang). */
  edit(key: string, value: unknown, delayMs: number): void {
    const field = this.fields.get(key);
    if (!field) return;
    if (field.timer) this.clear(field.timer);
    field.timer = null;
    const error = field.validate ? field.validate(value) : null;
    if (error) {
      this.update(field, { value, status: "invalid", error });
      return;
    }
    if (field.entry.status === "conflict") {
      this.update(field, { value });
      return;
    }
    if (sameValue(value, field.entry.base) && !field.inFlight) {
      const status = field.entry.savedAt === null ? "idle" : "saved";
      this.update(field, { value, status, error: null });
      return;
    }
    this.update(field, { value, status: field.inFlight ? "saving" : "pending", error: null });
    if (delayMs <= 0) {
      void this.save(key);
    } else {
      field.timer = this.setTimer(() => {
        field.timer = null;
        void this.save(key);
      }, delayMs);
    }
  }

  /** Lagrer feltet nå (feltet forlates). */
  commit(key: string): Promise<void> {
    const field = this.fields.get(key);
    if (!field || field.entry.status !== "pending") return field?.inFlight ?? Promise.resolve();
    return this.save(key);
  }

  /** «Prøv igjen» på ett felt. */
  retry(key: string): Promise<void> {
    const field = this.fields.get(key);
    if (!field) return Promise.resolve();
    if (field.entry.status === "failed" || field.entry.status === "offline") {
      this.update(field, { status: "pending", error: null });
      return this.save(key);
    }
    return field.inFlight ?? Promise.resolve();
  }

  /** «Prøv igjen» i toppen, og når nettet er tilbake. */
  retryAll(): Promise<void> {
    const keys = [...this.fields.values()]
      .filter((f) => f.entry.status === "failed" || f.entry.status === "offline")
      .map((f) => f.entry.key);
    return Promise.all(keys.map((key) => this.retry(key))).then(() => undefined);
  }

  /** Nettet er borte: det som venter, står som «Uten nett». */
  markOffline(): void {
    for (const field of this.fields.values()) {
      if (field.entry.status === "pending" && !field.inFlight) {
        if (field.timer) this.clear(field.timer);
        field.timer = null;
        this.update(field, { status: "offline" });
      }
    }
  }

  /**
   * Lagrer alt som venter, og venter på svarene («Ferdig med punktet», design avsnitt 17).
   * Gir feltene som ikke ble lagret.
   */
  async flush(): Promise<FlushResult> {
    const waiting: Promise<void>[] = [];
    for (const field of this.fields.values()) {
      const { status } = field.entry;
      if (status === "pending" || status === "offline" || status === "failed") {
        if (status !== "pending") this.update(field, { status: "pending", error: null });
        waiting.push(this.save(field.entry.key));
      } else if (field.inFlight) {
        waiting.push(field.inFlight);
      }
    }
    await Promise.all(waiting);
    // Ble noe endret mens svarene kom, lagres det også (én runde til er nok: ingen ny tasting nå).
    const again = [...this.fields.values()].filter(
      (f) => f.inFlight || f.entry.status === "pending",
    );
    if (again.length > 0) {
      await Promise.all(again.map((f) => (f.inFlight ? f.inFlight : this.save(f.entry.key))));
    }
    const failedKeys = [...this.fields.values()]
      .filter((f) => UNSAVED.includes(f.entry.status))
      .map((f) => f.entry.key);
    return failedKeys.length === 0 ? { ok: true } : { ok: false, failedKeys };
  }

  /** «Bruk nyeste» ved «Endret av andre». */
  takeLatest(key: string): void {
    const field = this.fields.get(key);
    if (!field || field.entry.status !== "conflict") return;
    const latest = field.entry.conflictValue;
    this.update(field, {
      value: latest,
      base: latest,
      status: "saved",
      conflictValue: null,
      savedAt: this.now(),
    });
  }

  /** «Behold min og lagre» ved «Endret av andre». */
  keepMine(key: string): Promise<void> {
    const field = this.fields.get(key);
    if (!field || field.entry.status !== "conflict") return Promise.resolve();
    this.update(field, { base: field.entry.conflictValue, status: "pending", conflictValue: null });
    return this.save(key);
  }

  // --- Internt -----------------------------------------------------------------------------

  private save(key: string): Promise<void> {
    const field = this.fields.get(key);
    if (!field) return Promise.resolve();
    if (field.timer) this.clear(field.timer);
    field.timer = null;
    if (field.inFlight) {
      // Én lagring om gangen per felt: neste starter når svaret er kommet.
      return field.inFlight.then(() => this.saveAgainIfPending(key));
    }
    if (field.entry.status !== "pending") return Promise.resolve();
    if (!this.options.isOnline()) {
      this.update(field, { status: "offline" });
      return Promise.resolve();
    }
    const value = field.entry.value;
    const base = field.entry.base;
    if (sameValue(value, base)) {
      this.update(field, { status: field.entry.savedAt === null ? "idle" : "saved" });
      return Promise.resolve();
    }
    this.update(field, { status: "saving" });
    const run = async () => {
      let result: SendResult;
      try {
        result = await this.options.send(field.build(value, base, field.entry.rowId));
      } catch {
        this.update(field, {
          status: this.options.isOnline() ? "failed" : "offline",
          error: this.options.isOnline() ? ROOM_ACTION_MESSAGES.network : null,
        });
        return;
      }
      if (this.fields.get(key) !== field) return;
      if (isActionError(result)) {
        this.update(field, { status: "failed", error: result.message });
        return;
      }
      if (result.status === "conflict") {
        this.update(field, {
          status: "conflict",
          conflictValue: result.current,
          rowId: result.id,
        });
        return;
      }
      const changedMeanwhile = !sameValue(field.entry.value, value);
      this.update(field, {
        base: value,
        rowId: result.id,
        savedAt: this.now(),
        status: changedMeanwhile ? "pending" : "saved",
        error: null,
      });
      this.options.onRefresh(result.refresh);
    };
    field.inFlight = run().finally(() => {
      field.inFlight = null;
    });
    return field.inFlight.then(() => this.saveAgainIfPending(key));
  }

  private saveAgainIfPending(key: string): Promise<void> {
    const field = this.fields.get(key);
    if (!field || field.inFlight || field.timer || field.entry.status !== "pending") {
      return Promise.resolve();
    }
    return this.save(key);
  }

  private update(field: Internal, patch: Partial<FieldEntry>): void {
    field.entry = { ...field.entry, ...patch };
    this.emit();
  }

  private emit(): void {
    this.summaryCache = this.computeSummary(this.summaryCache);
    for (const listener of [...this.listeners]) listener();
  }

  private computeSummary(previous: SaveSummary): SaveSummary {
    let failedCount = 0;
    let offline = false;
    let saving = false;
    let savedAt: number | null = null;
    for (const { entry } of this.fields.values()) {
      if (NOT_SAVED.includes(entry.status)) failedCount++;
      if (entry.status === "offline") offline = true;
      if (entry.status === "pending" || entry.status === "saving") saving = true;
      if (entry.savedAt !== null && (savedAt === null || entry.savedAt > savedAt)) {
        savedAt = entry.savedAt;
      }
    }
    const status: SaveSummary["status"] =
      failedCount > 0 ? "failed" : offline ? "offline" : saving ? "saving" : "saved";
    if (
      previous.status === status &&
      previous.failedCount === failedCount &&
      previous.savedAt === savedAt
    ) {
      return previous;
    }
    return { status, failedCount, savedAt };
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private setTimer(run: () => void, ms: number): Timer {
    return this.options.setTimer ? this.options.setTimer(run, ms) : setTimeout(run, ms);
  }

  private clear(timer: Timer): void {
    if (this.options.clearTimer) this.options.clearTimer(timer);
    else clearTimeout(timer);
  }
}

/** Statusen slik `SaveState` viser den per felt, eller `null` før første endring. */
export function displayStatus(
  status: FieldStatus,
): "saved" | "saving" | "failed" | "offline" | null {
  switch (status) {
    case "idle":
      return null;
    case "pending":
    case "saving":
      return "saving";
    case "saved":
      return "saved";
    case "offline":
      return "offline";
    case "failed":
    case "invalid":
    case "conflict":
      return "failed";
  }
}
