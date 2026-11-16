import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Angre-meldingen (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 9, designet i
 * docs/funksjoner/fase2a-papirkurv-design.md avsnitt 3). Enhetstest med falske tidtakere.
 *
 * Vitest har ikke DOM her (som use-sticky-scroll-padding.test.ts), så testene går mot den rene
 * logikken bak `UndoToastProvider` og `useUndoToast`. Kontrakten testene forventer av
 * `src/shared/ui/undo-toast.tsx` (navnet avgjøres av utvikler; avvik rettes her ved
 * sammenslåingen):
 *
 * - `UNDO_TOAST_MS` = 10 000.
 * - `createUndoToastStore()` gir en tilstandsmaskin uten React:
 *   - `show({ type, id, label, onUndo })`: type er "room" | "floor" | "building" | "party",
 *     `label` er visningsnavnet, `onUndo` kaller kjernen (gir et løfte);
 *   - `undo()`, `close()`, `pause(reason)`, `resume(reason)` (reason: "hover" | "focus");
 *   - `onKeyDown({ key, metaKey, ctrlKey, target })` gir `true` når «Angre» ble utløst;
 *   - `getState()` gir `null` (ingen melding) eller
 *     `{ id, type, message, hint, moreInTrash, status, error }`, der status er
 *     "removed" | "pending" | "error" | "restored".
 *
 * Tekstene er fasit fra kortet og designet, ikke importert. Testdata er oppdiktet («Bad»,
 * «Soverom»).
 *
 * Støtter hovedmål: de ansatte (ett trykk på «Angre» retter et feiltrykk; tiden står mens man
 * leser) og færre reklamasjoner (ingenting ser gjenopprettet ut før serveren har svart).
 */

const mocks = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));

type State = {
  id: string;
  type: string;
  message: string;
  hint: string;
  moreInTrash: boolean;
  status: "removed" | "pending" | "error" | "restored";
  error: string | null;
} | null;

type Entry = { type: string; id: string; label: string; onUndo: () => Promise<unknown> };

type Store = {
  show(entry: Entry): void;
  undo(): Promise<void> | void;
  close(): void;
  pause(reason: "hover" | "focus"): void;
  resume(reason: "hover" | "focus"): void;
  onKeyDown(event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    target: { tagName: string; isContentEditable?: boolean } | null;
  }): boolean;
  getState(): State;
};

type Module = { UNDO_TOAST_MS: number; createUndoToastStore: () => Store };

const MODULE_PATH = "./undo-toast";

async function load(): Promise<Module> {
  const mod = (await import(/* @vite-ignore */ MODULE_PATH)) as Partial<Module>;
  expect(mod.createUndoToastStore, "createUndoToastStore finnes").toBeTypeOf("function");
  return mod as Module;
}

const ROOM_ID = "0190a000-0000-7000-8000-000000000053";
const OTHER_ROOM_ID = "0190a000-0000-7000-8000-000000000054";

const REMOVED = "Rommet «Bad» er fjernet.";
const HINT = "Du finner det også i papirkurven.";
const FAILED = "Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.";

function room(onUndo: () => Promise<unknown> = async () => ({ changed: true })): Entry {
  return { type: "room", id: ROOM_ID, label: "Bad", onUndo };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("9. angre-meldingen", () => {
  it("9.1 vises med «Rommet «Bad» er fjernet.», «Angre»-status og «Du finner det også i papirkurven.»", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    expect(store.getState()).toBeNull();
    store.show(room());
    const state = store.getState()!;
    expect(state.message).toBe(REMOVED);
    expect(state.hint).toBe(HINT);
    expect(state.status).toBe("removed");
    expect(state.moreInTrash).toBe(false);
    expect(state.error).toBeNull();
  });

  it("9.2 lukkes etter 10 000 ms, ikke ved 9 999 ms", async () => {
    const { createUndoToastStore, UNDO_TOAST_MS } = await load();
    expect(UNDO_TOAST_MS).toBe(10_000);
    const store = createUndoToastStore();
    store.show(room());
    vi.advanceTimersByTime(9_999);
    expect(store.getState()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getState()).toBeNull();
  });

  it.each(["hover", "focus"] as const)(
    "9.3 %s stopper tiden; tiden går videre fra der den stoppet",
    async (reason) => {
      const { createUndoToastStore } = await load();
      const store = createUndoToastStore();
      store.show(room());
      vi.advanceTimersByTime(4_000);
      store.pause(reason);
      vi.advanceTimersByTime(60_000);
      expect(store.getState(), "står mens tiden er stoppet").not.toBeNull();
      store.resume(reason);
      vi.advanceTimersByTime(5_999);
      expect(store.getState(), "6 000 ms igjen etter pausen").not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(store.getState()).toBeNull();
    },
  );

  it("9.3 hover og fokus samtidig: tiden står til begge er borte", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    store.show(room());
    store.pause("hover");
    store.pause("focus");
    store.resume("hover");
    vi.advanceTimersByTime(30_000);
    expect(store.getState()).not.toBeNull();
    store.resume("focus");
    vi.advanceTimersByTime(10_000);
    expect(store.getState()).toBeNull();
  });

  it("9.4 ny sletting erstatter meldingen; «Angre» gjelder bare den nye, og «Mer i papirkurven» vises", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    const first = vi.fn(async () => ({ changed: true }));
    const second = vi.fn(async () => ({ changed: true }));
    store.show(room(first));
    vi.advanceTimersByTime(8_000);
    store.show({ type: "room", id: OTHER_ROOM_ID, label: "Soverom", onUndo: second });

    const state = store.getState()!;
    expect(state.id).toBe(OTHER_ROOM_ID);
    expect(state.message).toBe("Rommet «Soverom» er fjernet.");
    expect(state.moreInTrash).toBe(true);

    // Tiden starter på nytt for den nye meldingen.
    vi.advanceTimersByTime(9_999);
    expect(store.getState()).not.toBeNull();

    await store.undo();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it.each([
    ["Cmd+Z", { key: "z", metaKey: true, ctrlKey: false }],
    ["Ctrl+Z", { key: "z", metaKey: false, ctrlKey: true }],
  ] as const)("9.5 %s utløser «Angre»", async (_name, keys) => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    const onUndo = vi.fn(async () => ({ changed: true }));
    store.show(room(onUndo));
    const handled = store.onKeyDown({ ...keys, target: { tagName: "BODY" } });
    await vi.runAllTimersAsync();
    expect(handled).toBe(true);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["input", { tagName: "INPUT" }],
    ["textarea", { tagName: "TEXTAREA" }],
    ["select", { tagName: "SELECT" }],
    ["contenteditable", { tagName: "DIV", isContentEditable: true }],
  ] as const)("9.5 Cmd/Ctrl+Z gjør ingenting når fokus står i %s", async (_name, target) => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    const onUndo = vi.fn(async () => ({ changed: true }));
    store.show(room(onUndo));
    for (const keys of [
      { key: "z", metaKey: true, ctrlKey: false },
      { key: "z", metaKey: false, ctrlKey: true },
    ]) {
      expect(store.onKeyDown({ ...keys, target })).toBe(false);
    }
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("9.5 Cmd+Z uten melding gjør ingenting", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    expect(store.onKeyDown({ key: "z", metaKey: true, ctrlKey: false, target: null })).toBe(false);
  });

  it("9.6 feil fra handlingen: meldingen står med feilteksten og ny «Angre»; ingenting er gjenopprettet før svaret", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    let reject: (error: unknown) => void = () => {};
    const onUndo = vi.fn(
      () =>
        new Promise((_resolve, rej) => {
          reject = rej;
        }),
    );
    store.show(room(onUndo));

    const pending = store.undo();
    expect(store.getState()!.status, "venter på serveren").toBe("pending");
    // Gjentatt trykk mens kallet går gjør ingenting.
    void store.undo();
    store.onKeyDown({ key: "z", metaKey: true, ctrlKey: false, target: { tagName: "BODY" } });
    expect(onUndo).toHaveBeenCalledTimes(1);
    // Tiden står mens kallet går.
    vi.advanceTimersByTime(30_000);
    expect(store.getState()).not.toBeNull();

    reject(new Error("nettet falt (test)"));
    await pending;
    const state = store.getState()!;
    expect(state.status).toBe("error");
    expect(state.error).toBe(FAILED);
    // Feilen står til den lukkes; ingen tidsgrense.
    vi.advanceTimersByTime(60_000);
    expect(store.getState()!.status).toBe("error");

    // Ny «Angre» virker.
    onUndo.mockImplementationOnce(async () => ({ changed: true }));
    await store.undo();
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(store.getState()?.status ?? "restored").toBe("restored");
  });

  it("9.6 vellykket «Angre» gir status «restored» først etter svaret", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    let resolve: (value: unknown) => void = () => {};
    store.show(
      room(
        () =>
          new Promise((res) => {
            resolve = res;
          }),
      ),
    );
    const pending = store.undo();
    expect(store.getState()!.status).toBe("pending");
    resolve({ changed: true, restored: [{ type: "room", id: ROOM_ID }], notices: [] });
    await pending;
    expect(store.getState()?.status ?? "restored").toBe("restored");
  });

  it('9.7 meldingen har role="status" og en lukkeknapp med tilgjengelig navn; close() lukker', async () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "undo-toast.tsx"),
      "utf8",
    );
    expect(source).toContain('role="status"');
    expect(source).toMatch(/aria-label="Lukk meldingen"/);
    expect(source).toMatch(/aria-keyshortcuts="Meta\+Z Control\+Z"/);

    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    store.show(room());
    store.close();
    expect(store.getState()).toBeNull();
  });

  it("9.8 ingen lagring: localStorage og sessionStorage er tomme, og loggeren får ikke navnet", async () => {
    const stores = { local: new Map<string, string>(), session: new Map<string, string>() };
    const fake = (map: Map<string, string>) => ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    });
    vi.stubGlobal("localStorage", fake(stores.local));
    vi.stubGlobal("sessionStorage", fake(stores.session));

    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    store.show({
      type: "party",
      id: ROOM_ID,
      label: "Ola Testmann",
      onUndo: async () => {
        throw new Error("feilet (test)");
      },
    });
    await store.undo();
    store.close();

    expect(stores.local.size).toBe(0);
    expect(stores.session.size).toBe(0);
    const logged = JSON.stringify([
      mocks.log.error.mock.calls,
      mocks.log.warn.mock.calls,
      mocks.log.info.mock.calls,
      mocks.log.debug.mock.calls,
    ]);
    expect(logged).not.toContain("Ola Testmann");
    expect(logged).not.toContain("Testmann");
  });

  it("9.9 ingen ny avhengighet i package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    // Ingen pakke for meldinger, angre eller tidtakere (designet: «Ingen ny avhengighet»).
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
    expect(
      names.filter((name) => /toast|sonner|snackbar|notif|undo|jsdom|testing-library/i.test(name)),
    ).toEqual([]);
  });
});
