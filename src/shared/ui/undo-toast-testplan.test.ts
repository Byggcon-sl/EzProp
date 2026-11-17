import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Angre-meldingen (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 9, designet i
 * docs/funksjoner/fase2a-papirkurv-design.md avsnitt 3). Enhetstest med falske tidtakere.
 *
 * Vitest har ikke DOM her (som use-sticky-scroll-padding.test.ts), så testene går mot den rene
 * logikken bak `UndoToastProvider` og `useUndoToast`. Kontrakten er tilpasset det ferdige API-et i
 * `src/shared/ui/undo-toast.tsx` ved sammenslåingen:
 *
 * - `UNDO_TOAST_DURATION_MS` = 10 000.
 * - `createUndoToastStore()` gir en tilstandsmaskin uten React:
 *   - `show({ target: { type, id, label }, message, failureMessage, undo })`: type er
 *     "room" | "floor" | "building" | "party", `label` er visningsnavnet, `undo` kaller kjernen
 *     og gir et `UndoOutcome`;
 *   - `undo()`, `close()`, `canUndo()`, `setPaused(reason, paused)` (reason: "hover" | "focus");
 *   - `getSnapshot()` gir `null` (ingen melding) eller
 *     `{ target, message, detail, showMore, phase, error }`, der phase er
 *     "removed" | "pending" | "error" | "result".
 * - Hurtigtasten ligger i provideren: `isUndoShortcut(event) && !isEditableTarget(target) &&
 *   store.canUndo()` gir `store.undo()`. Hjelperen `onKeyDown` under gjør det samme.
 *
 * Tekstene er fasit fra kortet og designet (de samme som hjelperne i
 * `src/app/(ansatt)/oppdrag/[id]/trash-texts.ts` lager), ikke importert: `src/shared` kan ikke
 * importere fra `src/app`. Testdata er oppdiktet («Bad», «Soverom»).
 *
 * Støtter hovedmål: de ansatte (ett trykk på «Angre» retter et feiltrykk; tiden står mens man
 * leser) og færre reklamasjoner (ingenting ser gjenopprettet ut før serveren har svart).
 */

const mocks = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));

type Phase = "removed" | "pending" | "error" | "result";

type State = {
  target: { type: string; id: string; label: string } | null;
  message: string;
  detail: string | null;
  showMore: boolean;
  phase: Phase;
  error: string | null;
} | null;

type Outcome = { ok: true; message: string; focus: string | null } | { ok: false };

type Entry = {
  target: { type: "room" | "floor" | "building" | "party"; id: string; label: string };
  message: string;
  failureMessage: string;
  undo: () => Promise<Outcome>;
};

type Store = {
  show(entry: Entry): void;
  undo(): Promise<void>;
  close(): void;
  canUndo(): boolean;
  setPaused(reason: "hover" | "focus", paused: boolean): void;
  getSnapshot(): State;
};

type KeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

type Target = { tagName?: string; isContentEditable?: boolean } | null;

type Module = {
  UNDO_TOAST_DURATION_MS: number;
  UNDO_TOAST_TEXTS: { close: string };
  createUndoToastStore: () => Store;
  isUndoShortcut: (event: Required<KeyEvent>) => boolean;
  isEditableTarget: (target: Target) => boolean;
};

const MODULE_PATH = "./undo-toast";

async function load(): Promise<Module> {
  const mod = (await import(/* @vite-ignore */ MODULE_PATH)) as Partial<Module>;
  expect(mod.createUndoToastStore, "createUndoToastStore finnes").toBeTypeOf("function");
  expect(mod.isUndoShortcut, "isUndoShortcut finnes").toBeTypeOf("function");
  expect(mod.isEditableTarget, "isEditableTarget finnes").toBeTypeOf("function");
  return mod as Module;
}

/** Det provideren gjør ved tastetrykk: gir `true` når «Angre» ble utløst. */
function onKeyDown(mod: Module, store: Store, event: KeyEvent & { target: Target }): boolean {
  const keys = { altKey: false, shiftKey: false, ...event };
  if (!mod.isUndoShortcut(keys) || mod.isEditableTarget(event.target) || !store.canUndo()) {
    return false;
  }
  void store.undo();
  return true;
}

const ROOM_ID = "0190a000-0000-7000-8000-000000000053";
const OTHER_ROOM_ID = "0190a000-0000-7000-8000-000000000054";

const REMOVED = "Rommet «Bad» er fjernet.";
const HINT = "Du finner det også i papirkurven.";
const FAILED = "Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.";

const RESTORED: Outcome = { ok: true, message: "Rommet «Bad» er hentet tilbake.", focus: null };

function room(undo: () => Promise<Outcome> = async () => RESTORED): Entry {
  return {
    target: { type: "room", id: ROOM_ID, label: "Bad" },
    message: REMOVED,
    failureMessage: FAILED,
    undo,
  };
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
    expect(store.getSnapshot()).toBeNull();
    store.show(room());
    const state = store.getSnapshot()!;
    expect(state.message).toBe(REMOVED);
    expect(state.detail).toBe(HINT);
    expect(state.phase).toBe("removed");
    expect(state.showMore).toBe(false);
    expect(state.error).toBeNull();
    expect(store.canUndo(), "«Angre» kan brukes").toBe(true);
  });

  it("9.2 lukkes etter 10 000 ms, ikke ved 9 999 ms", async () => {
    const { createUndoToastStore, UNDO_TOAST_DURATION_MS } = await load();
    expect(UNDO_TOAST_DURATION_MS).toBe(10_000);
    const store = createUndoToastStore();
    store.show(room());
    vi.advanceTimersByTime(9_999);
    expect(store.getSnapshot()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toBeNull();
  });

  it.each(["hover", "focus"] as const)(
    "9.3 %s stopper tiden; tiden går videre fra der den stoppet",
    async (reason) => {
      const { createUndoToastStore } = await load();
      const store = createUndoToastStore();
      store.show(room());
      vi.advanceTimersByTime(4_000);
      store.setPaused(reason, true);
      vi.advanceTimersByTime(60_000);
      expect(store.getSnapshot(), "står mens tiden er stoppet").not.toBeNull();
      store.setPaused(reason, false);
      vi.advanceTimersByTime(5_999);
      expect(store.getSnapshot(), "6 000 ms igjen etter pausen").not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(store.getSnapshot()).toBeNull();
    },
  );

  it("9.3 hover og fokus samtidig: tiden står til begge er borte", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    store.show(room());
    store.setPaused("hover", true);
    store.setPaused("focus", true);
    store.setPaused("hover", false);
    vi.advanceTimersByTime(30_000);
    expect(store.getSnapshot()).not.toBeNull();
    store.setPaused("focus", false);
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot()).toBeNull();
  });

  it("9.4 ny sletting erstatter meldingen; «Angre» gjelder bare den nye, og «Mer i papirkurven» vises", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    const first = vi.fn(async (): Promise<Outcome> => RESTORED);
    const second = vi.fn(async (): Promise<Outcome> => RESTORED);
    store.show(room(first));
    vi.advanceTimersByTime(8_000);
    store.show({
      target: { type: "room", id: OTHER_ROOM_ID, label: "Soverom" },
      message: "Rommet «Soverom» er fjernet.",
      failureMessage: FAILED,
      undo: second,
    });

    const state = store.getSnapshot()!;
    expect(state.target?.id).toBe(OTHER_ROOM_ID);
    expect(state.message).toBe("Rommet «Soverom» er fjernet.");
    expect(state.showMore).toBe(true);

    // Tiden starter på nytt for den nye meldingen.
    vi.advanceTimersByTime(9_999);
    expect(store.getSnapshot()).not.toBeNull();

    await store.undo();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it.each([
    ["Cmd+Z", { key: "z", metaKey: true, ctrlKey: false }],
    ["Ctrl+Z", { key: "z", metaKey: false, ctrlKey: true }],
  ] as const)("9.5 %s utløser «Angre»", async (_name, keys) => {
    const mod = await load();
    const store = mod.createUndoToastStore();
    const undo = vi.fn(async (): Promise<Outcome> => RESTORED);
    store.show(room(undo));
    const handled = onKeyDown(mod, store, { ...keys, target: { tagName: "BODY" } });
    await vi.runAllTimersAsync();
    expect(handled).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ] as const)("9.5 Cmd/Ctrl+%s+Z utløser ikke «Angre»", async (_name, extra) => {
    const mod = await load();
    const store = mod.createUndoToastStore();
    const undo = vi.fn(async (): Promise<Outcome> => RESTORED);
    store.show(room(undo));
    for (const keys of [
      { key: "z", metaKey: true, ctrlKey: false },
      { key: "z", metaKey: false, ctrlKey: true },
    ]) {
      expect(onKeyDown(mod, store, { ...keys, ...extra, target: { tagName: "BODY" } })).toBe(false);
    }
    expect(undo).not.toHaveBeenCalled();
  });

  it.each([
    ["input", { tagName: "INPUT" }],
    ["textarea", { tagName: "TEXTAREA" }],
    ["select", { tagName: "SELECT" }],
    ["contenteditable", { tagName: "DIV", isContentEditable: true }],
  ] as const)("9.5 Cmd/Ctrl+Z gjør ingenting når fokus står i %s", async (_name, target) => {
    const mod = await load();
    const store = mod.createUndoToastStore();
    const undo = vi.fn(async (): Promise<Outcome> => RESTORED);
    store.show(room(undo));
    for (const keys of [
      { key: "z", metaKey: true, ctrlKey: false },
      { key: "z", metaKey: false, ctrlKey: true },
    ]) {
      expect(onKeyDown(mod, store, { ...keys, target })).toBe(false);
    }
    expect(undo).not.toHaveBeenCalled();
  });

  it("9.5 Cmd+Z uten melding gjør ingenting", async () => {
    const mod = await load();
    const store = mod.createUndoToastStore();
    expect(onKeyDown(mod, store, { key: "z", metaKey: true, ctrlKey: false, target: null })).toBe(
      false,
    );
    expect(store.getSnapshot()).toBeNull();
  });

  it("9.6 feil fra handlingen: meldingen står med feilteksten og ny «Angre»; ingenting er gjenopprettet før svaret", async () => {
    const mod = await load();
    const store = mod.createUndoToastStore();
    let reject: (error: unknown) => void = () => {};
    const undo = vi.fn(
      () =>
        new Promise<Outcome>((_resolve, rej) => {
          reject = rej;
        }),
    );
    store.show(room(undo));

    const pending = store.undo();
    expect(store.getSnapshot()!.phase, "venter på serveren").toBe("pending");
    // Gjentatt trykk mens kallet går gjør ingenting.
    void store.undo();
    onKeyDown(mod, store, { key: "z", metaKey: true, ctrlKey: false, target: { tagName: "BODY" } });
    expect(undo).toHaveBeenCalledTimes(1);
    // Tiden står mens kallet går.
    vi.advanceTimersByTime(30_000);
    expect(store.getSnapshot()).not.toBeNull();

    reject(new Error("nettet falt (test)"));
    await pending;
    const state = store.getSnapshot()!;
    expect(state.phase).toBe("error");
    expect(state.error).toBe(FAILED);
    // Feilen står til den lukkes; ingen tidsgrense.
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()!.phase).toBe("error");

    // Ny «Angre» virker.
    undo.mockImplementationOnce(async () => RESTORED);
    await store.undo();
    expect(undo).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()?.phase ?? "result").toBe("result");
  });

  it("9.6 vellykket «Angre» gir fasen «result» først etter svaret", async () => {
    const { createUndoToastStore } = await load();
    const store = createUndoToastStore();
    let resolve: (value: Outcome) => void = () => {};
    store.show(
      room(
        () =>
          new Promise<Outcome>((res) => {
            resolve = res;
          }),
      ),
    );
    const pending = store.undo();
    expect(store.getSnapshot()!.phase).toBe("pending");
    resolve(RESTORED);
    await pending;
    expect(store.getSnapshot()?.phase ?? "result").toBe("result");
  });

  it('9.7 meldingen har role="status" og en lukkeknapp med tilgjengelig navn; close() lukker', async () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "undo-toast.tsx"),
      "utf8",
    );
    expect(source).toContain('role="status"');
    expect(source).toContain("aria-label={UNDO_TOAST_TEXTS.close}");
    expect(source).toMatch(/aria-keyshortcuts="Meta\+Z Control\+Z"/);

    const { createUndoToastStore, UNDO_TOAST_TEXTS } = await load();
    expect(UNDO_TOAST_TEXTS.close).toBe("Lukk meldingen");
    const store = createUndoToastStore();
    store.show(room());
    store.close();
    expect(store.getSnapshot()).toBeNull();
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
    store.show(
      room(async () => {
        throw new Error("feilet (test)");
      }),
    );
    await store.undo();
    store.close();
    store.show({
      target: { type: "party", id: ROOM_ID, label: "Ola Testmann" },
      message: "Parten «Ola Testmann» er fjernet.",
      failureMessage: "Fikk ikke hentet tilbake parten. Prøv igjen, eller bruk papirkurven.",
      undo: async () => {
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
    expect(logged).not.toContain("Bad");
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
