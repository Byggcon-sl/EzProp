import { describe, expect, it, vi } from "vitest";
import type { ReportFieldChange, RoomRefresh, SaveFieldResult } from "@/core/reports/types";
import {
  displayStatus,
  FieldSaveStore,
  type ChangeBuilder,
  type SendResult,
} from "./field-save-store";
import { ROOM_ACTION_MESSAGES } from "./room-messages";

/*
 * Lagringskøen per felt for badet (docs/funksjoner/fase2a-badet-pc.md Omfang 8, design avsnitt 10
 * og 17, testplanen B6.7–B6.9). Ren TypeScript: serveren er byttet ut med en falsk `send`, og
 * tidtakeren med en manuell. Testdata er oppdiktet.
 * Støtter hovedmål: de ansatte (ingen tekst går tapt, ingen stille overskriving).
 */

const DEVIATION = "0190a000-0000-7000-8000-0000000000d1";
const REFRESH: RoomRefresh = { checkpoints: [], suggestions: [], progress: { done: 0, total: 8 } };

const build: ChangeBuilder = (value, base) => ({
  table: "deviations",
  id: DEVIATION,
  field: "cause_text",
  value: value as string | null,
  base: base as string | null,
});

function saved(id = DEVIATION): SaveFieldResult {
  return { status: "saved", id, rowVersion: 2, refresh: REFRESH };
}

type Deferred = { resolve(value: SendResult): void; reject(error: unknown): void };

function setup(options: { online?: boolean } = {}) {
  let online = options.online ?? true;
  const sent: ReportFieldChange[] = [];
  const pending: Deferred[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const onRefresh = vi.fn();
  const store = new FieldSaveStore({
    send: (change) => {
      sent.push(change);
      return new Promise<SendResult>((resolve, reject) => pending.push({ resolve, reject }));
    },
    onRefresh,
    isOnline: () => online,
    now: () => 1_700_000_000_000,
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => {
      (timer as unknown as { cleared: boolean }).cleared = true;
    },
  });
  const runTimers = () => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.run();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store,
    sent,
    pending,
    onRefresh,
    runTimers,
    settle,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

describe("FieldSaveStore", () => {
  it("registrerer feltet med serverens verdi, uten status før første endring", () => {
    const { store } = setup();
    const entry = store.ensure("deviation:x:cause_text", "Lekkasje ved sluk", build);
    expect(entry).toMatchObject({
      value: "Lekkasje ved sluk",
      base: "Lekkasje ved sluk",
      status: "idle",
    });
    expect(displayStatus(entry.status)).toBeNull();
    expect(store.hasUnsaved()).toBe(false);
  });

  it("lagrer etter ventetiden, med verdien klienten så som base, og tar inn det serveren regnet", async () => {
    const { store, sent, pending, onRefresh, runTimers, settle } = setup();
    store.ensure("k", "", build);
    store.edit("k", "Riss i fuge", 800);
    expect(store.get("k")?.status).toBe("pending");
    expect(displayStatus(store.get("k")!.status)).toBe("saving");
    expect(sent).toHaveLength(0);
    runTimers();
    expect(sent).toEqual([
      { table: "deviations", id: DEVIATION, field: "cause_text", value: "Riss i fuge", base: "" },
    ]);
    pending[0]!.resolve(saved());
    await settle();
    expect(store.get("k")).toMatchObject({ status: "saved", base: "Riss i fuge" });
    expect(onRefresh).toHaveBeenCalledWith(REFRESH);
    expect(store.getSummary()).toMatchObject({ status: "saved", failedCount: 0 });
  });

  it("nettfeil gir «Ikke lagret – prøv igjen», teksten står, og «Prøv igjen» lagrer", async () => {
    const { store, sent, pending, settle } = setup();
    store.ensure("k", "", build);
    store.edit("k", "Fukt i vegg", 0);
    pending[0]!.reject(new TypeError("Failed to fetch"));
    await settle();
    expect(store.get("k")).toMatchObject({
      status: "failed",
      value: "Fukt i vegg",
      error: ROOM_ACTION_MESSAGES.network,
    });
    expect(store.getSummary()).toMatchObject({ status: "failed", failedCount: 1 });
    expect(store.hasUnsaved()).toBe(true);
    void store.retry("k");
    expect(sent).toHaveLength(2);
    pending[1]!.resolve(saved());
    await settle();
    expect(store.get("k")?.status).toBe("saved");
  });

  it("uten nett sendes ingenting; feltet står som «Uten nett» og lagres når nettet er tilbake", async () => {
    const { store, sent, pending, settle, setOnline } = setup({ online: false });
    store.ensure("k", "", build);
    store.edit("k", "Skrevet uten nett", 0);
    expect(sent).toHaveLength(0);
    expect(store.get("k")?.status).toBe("offline");
    expect(store.getSummary().status).toBe("offline");
    setOnline(true);
    void store.retryAll();
    expect(sent).toHaveLength(1);
    pending[0]!.resolve(saved());
    await settle();
    expect(store.get("k")?.status).toBe("saved");
  });

  it("«Endret av andre»: ingenting overskrives før et valg er tatt", async () => {
    const { store, sent, pending, settle } = setup();
    store.ensure("k", "Gammel tekst", build);
    store.edit("k", "Min tekst", 0);
    pending[0]!.resolve({
      status: "conflict",
      id: DEVIATION,
      rowVersion: 3,
      current: "Andres tekst",
    });
    await settle();
    expect(store.get("k")).toMatchObject({
      status: "conflict",
      value: "Min tekst",
      conflictValue: "Andres tekst",
    });
    // Ny verdi fra serveren tas ikke inn mens konflikten står.
    store.syncServer("k", "Andres tekst");
    expect(store.get("k")?.value).toBe("Min tekst");

    void store.keepMine("k");
    expect(sent[1]).toMatchObject({ value: "Min tekst", base: "Andres tekst" });
    pending[1]!.resolve(saved());
    await settle();
    expect(store.get("k")?.status).toBe("saved");
  });

  it("«Bruk nyeste» tar serverens verdi uten å sende noe", async () => {
    const { store, sent, pending, settle } = setup();
    store.ensure("k", "A", build);
    store.edit("k", "B", 0);
    pending[0]!.resolve({ status: "conflict", id: DEVIATION, rowVersion: 3, current: "C" });
    await settle();
    store.takeLatest("k");
    expect(store.get("k")).toMatchObject({ value: "C", base: "C", status: "saved" });
    expect(sent).toHaveLength(1);
  });

  it("kontrollen i nettleseren stopper lagring og beholder teksten", () => {
    const { store, sent } = setup();
    store.ensure("k", "", build, { validate: (v) => (String(v).length > 3 ? "For lang" : null) });
    store.edit("k", "Altfor lang", 0);
    expect(sent).toHaveLength(0);
    expect(store.get("k")).toMatchObject({
      status: "invalid",
      value: "Altfor lang",
      error: "For lang",
    });
    expect(store.hasUnsaved()).toBe(true);
  });

  it("feilmelding fra serveren vises ved feltet", async () => {
    const { store, pending, settle } = setup();
    store.ensure("k", "", build);
    store.edit("k", "Tekst", 0);
    pending[0]!.resolve({ status: "error", message: "Teksten er for lang." });
    await settle();
    expect(store.get("k")).toMatchObject({ status: "failed", error: "Teksten er for lang." });
  });

  it("én lagring om gangen per felt; endring mens svaret kommer lagres etterpå med ny base", async () => {
    const { store, sent, pending, settle } = setup();
    store.ensure("k", "", build);
    store.edit("k", "En", 0);
    store.edit("k", "En to", 0);
    expect(sent).toHaveLength(1);
    pending[0]!.resolve(saved());
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ value: "En to", base: "En" });
    pending[1]!.resolve(saved());
    await settle();
    expect(store.get("k")).toMatchObject({ status: "saved", value: "En to", base: "En to" });
  });

  it("flush lagrer det som venter og sier hvilke felt som ikke ble lagret («Ferdig» med ventende lagring)", async () => {
    const { store, pending, settle } = setup();
    store.ensure("a", "", build);
    store.ensure("b", "", build);
    store.edit("a", "Årsak", 800);
    store.edit("b", "Konsekvens", 800);
    const result = store.flush();
    await settle();
    pending[0]!.resolve(saved());
    pending[1]!.reject(new TypeError("Failed to fetch"));
    await expect(result).resolves.toEqual({ ok: false, failedKeys: ["b"] });
    expect(store.get("a")?.status).toBe("saved");
    expect(store.get("b")?.value).toBe("Konsekvens");
  });

  it("flush uten noe som venter er ok", async () => {
    const { store } = setup();
    store.ensure("a", "x", build);
    await expect(store.flush()).resolves.toEqual({ ok: true });
  });

  it("ny verdi fra serveren tas inn når feltet ikke har ulagrede endringer", () => {
    const { store } = setup();
    store.ensure("k", "Bør-tiltak", build);
    store.syncServer("k", "Må-tiltak");
    expect(store.get("k")).toMatchObject({ value: "Må-tiltak", base: "Må-tiltak" });
    store.edit("k", "Egen tekst", 800);
    store.syncServer("k", "Annen servertekst");
    expect(store.get("k")?.value).toBe("Egen tekst");
  });

  it("verdien står i køen når feltet registreres på nytt (bytte av punkt)", () => {
    const { store } = setup();
    store.ensure("k", "", build);
    store.edit("k", "Ulagret tekst", 800);
    const again = store.ensure("k", "", build);
    expect(again.value).toBe("Ulagret tekst");
    expect(again.status).toBe("pending");
  });

  it("drop glemmer feltene til et avvik som er fjernet", () => {
    const { store } = setup({ online: false });
    store.ensure(`deviation:${DEVIATION}:cause_text`, "", build);
    store.edit(`deviation:${DEVIATION}:cause_text`, "x", 0);
    store.drop(`deviation:${DEVIATION}:`);
    expect(store.get(`deviation:${DEVIATION}:cause_text`)).toBeUndefined();
    expect(store.hasUnsaved()).toBe(false);
  });

  it("tilbake til lagret verdi før lagring sender ingenting", () => {
    const { store, sent, runTimers } = setup();
    store.ensure("k", "Lik", build);
    store.edit("k", "Ulik", 800);
    store.edit("k", "Lik", 800);
    runTimers();
    expect(sent).toHaveLength(0);
    expect(store.hasUnsaved()).toBe(false);
  });

  it("markOffline flytter det som venter til «Uten nett»", () => {
    const { store } = setup();
    store.ensure("k", "", build);
    store.edit("k", "Tekst", 800);
    store.markOffline();
    expect(store.get("k")?.status).toBe("offline");
  });
});
