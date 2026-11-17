import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUndoToastStore,
  isEditableTarget,
  isUndoShortcut,
  UNDO_TOAST_DURATION_MS,
  UndoToast,
  type UndoOutcome,
  type UndoToastShowOptions,
  type UndoToastView,
} from "./undo-toast";

/*
 * Angre-meldingen (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 9). Tilstanden og tiden
 * testes uten nettleser med falske tidtakere; markupen med `renderToStaticMarkup`. Navnene er
 * oppdiktet. Støtter hovedmål: de ansatte (et feiltrykk rettes med ett trykk, og meldingen
 * forsvinner ikke mens man leser den).
 */

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({ logger }));
vi.mock("next/navigation", () => ({ usePathname: () => "/oppdrag/x/bygninger" }));

const ROOM_ID = "0190a000-0000-7000-8000-000000000053";
const OTHER_ID = "0190a000-0000-7000-8000-000000000054";
const REMOVED = "Rommet «Bad» er fjernet.";
const DETAIL = "Du finner det også i papirkurven.";
const FAILED = "Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.";
const RESTORED = "Rommet «Bad» er hentet tilbake.";

function options(overrides: Partial<UndoToastShowOptions> = {}): UndoToastShowOptions {
  return {
    target: { type: "room", id: ROOM_ID, label: "Bad" },
    message: REMOVED,
    failureMessage: FAILED,
    trashId: "papirkurv-bygninger",
    undo: vi.fn(async (): Promise<UndoOutcome> => ({
      ok: true,
      message: RESTORED,
      focus: `room:${ROOM_ID}`,
    })),
    ...overrides,
  };
}

function render(view: UndoToastView | null): string {
  return renderToStaticMarkup(
    createElement(UndoToast, {
      view,
      onUndo: () => {},
      onClose: () => {},
      onMore: () => {},
      onPause: () => {},
    }),
  );
}

/** Teksten i knappene. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T13:02:00Z"));
  logger.error.mockClear();
  logger.warn.mockClear();
  logger.info.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("9.1 meldingen etter «Fjern»", () => {
  it("viser teksten, «Angre» og «Du finner det også i papirkurven.»", () => {
    const store = createUndoToastStore();
    store.show(options());
    const view = store.getSnapshot()!;
    expect(view.phase).toBe("removed");
    expect(view.message).toBe(REMOVED);
    expect(view.detail).toBe(DETAIL);
    const html = render(view);
    expect(html).toContain(REMOVED);
    expect(html).toContain(DETAIL);
    expect(buttons(html)).toContain("Angre");
    expect(html).toContain('aria-keyshortcuts="Meta+Z Control+Z"');
  });
});

describe("9.2 tiden", () => {
  it("lukkes etter 10 000 ms, ikke ved 9 999 ms", () => {
    const store = createUndoToastStore();
    store.show(options());
    expect(UNDO_TOAST_DURATION_MS).toBe(10_000);
    vi.advanceTimersByTime(9_999);
    expect(store.getSnapshot()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toBeNull();
  });
});

describe("9.3 pause ved hover, fokus og skjult fane", () => {
  it.each(["hover", "focus", "hidden"] as const)(
    "%s stopper tiden, og den går videre fra der den stoppet",
    (reason) => {
      const store = createUndoToastStore();
      store.show(options());
      vi.advanceTimersByTime(4_000);
      store.setPaused(reason, true);
      vi.advanceTimersByTime(60_000);
      expect(store.getSnapshot(), "står mens tiden er stoppet").not.toBeNull();
      store.setPaused(reason, false);
      vi.advanceTimersByTime(5_999);
      expect(store.getSnapshot()).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(store.getSnapshot()).toBeNull();
    },
  );

  it("to grunner: tiden går først når begge er borte", () => {
    const store = createUndoToastStore();
    store.show(options());
    store.setPaused("hover", true);
    store.setPaused("focus", true);
    store.setPaused("hover", false);
    vi.advanceTimersByTime(30_000);
    expect(store.getSnapshot()).not.toBeNull();
    store.setPaused("focus", false);
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot()).toBeNull();
  });

  it("tiden står mens kallet går", async () => {
    let resolve: (outcome: UndoOutcome) => void = () => {};
    const store = createUndoToastStore();
    store.show(options({ undo: () => new Promise((r) => (resolve = r)) }));
    const pending = store.undo();
    expect(store.getSnapshot()!.phase).toBe("pending");
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).not.toBeNull();
    expect(buttons(render(store.getSnapshot()))).toContain("Henter tilbake …");
    resolve({ ok: true, message: RESTORED, focus: null });
    await pending;
    expect(store.getSnapshot()!.message).toBe(RESTORED);
  });
});

describe("9.4 ny sletting erstatter", () => {
  it("én melding, «Angre» gjelder bare den nye, og «Mer i papirkurven» vises", async () => {
    const store = createUndoToastStore();
    const first = options();
    const second = options({
      target: { type: "room", id: OTHER_ID, label: "Soverom" },
      message: "Rommet «Soverom» er fjernet.",
    });
    store.show(first);
    vi.advanceTimersByTime(8_000);
    store.show(second);
    const view = store.getSnapshot()!;
    expect(view.message).toBe("Rommet «Soverom» er fjernet.");
    expect(view.showMore).toBe(true);
    expect(buttons(render(view))).toContain("Mer i papirkurven");
    expect(render(view).match(/role="status"/g)).toHaveLength(1);

    // Tiden starter på nytt for den nye meldingen
    vi.advanceTimersByTime(9_999);
    expect(store.getSnapshot()).not.toBeNull();

    await store.undo();
    expect(first.undo).not.toHaveBeenCalled();
    expect(second.undo).toHaveBeenCalledTimes(1);
  });

  it("første melding har ikke «Mer i papirkurven»", () => {
    const store = createUndoToastStore();
    store.show(options());
    expect(store.getSnapshot()!.showMore).toBe(false);
    expect(buttons(render(store.getSnapshot()))).not.toContain("Mer i papirkurven");
  });

  it("et svar på en gammel «Angre» endrer ikke den nye meldingen", async () => {
    let resolve: (outcome: UndoOutcome) => void = () => {};
    const store = createUndoToastStore();
    store.show(options({ undo: () => new Promise((r) => (resolve = r)) }));
    const pending = store.undo();
    store.show(options({ message: "Etasjen «Loft» er fjernet." }));
    resolve({ ok: true, message: RESTORED, focus: null });
    await pending;
    expect(store.getSnapshot()!.message).toBe("Etasjen «Loft» er fjernet.");
    expect(store.getSnapshot()!.phase).toBe("removed");
  });
});

describe("9.5 Cmd/Ctrl+Z", () => {
  const key = (patch: Partial<Parameters<typeof isUndoShortcut>[0]>) => ({
    key: "z",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...patch,
  });

  it("Cmd+Z og Ctrl+Z er hurtigtasten; Shift, Alt og Z alene er det ikke", () => {
    expect(isUndoShortcut(key({ metaKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true, key: "Z" }))).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUndoShortcut(key({}))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: "y" }))).toBe(false);
  });

  it("ikke i input, textarea, select eller contenteditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("«Angre» går bare mens meldingen har «Angre»: ikke under kallet og ikke etter svaret", async () => {
    const store = createUndoToastStore();
    const opts = options();
    store.show(opts);
    expect(store.canUndo()).toBe(true);
    const first = store.undo();
    expect(store.canUndo()).toBe(false);
    await store.undo();
    await first;
    expect(store.canUndo()).toBe(false);
    expect(opts.undo).toHaveBeenCalledTimes(1);
  });
});

describe("9.6 feil fra handlingen", () => {
  it.each([
    ["avslag", async (): Promise<UndoOutcome> => ({ ok: false })],
    [
      "nettet faller",
      async (): Promise<UndoOutcome> => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ] as const)("%s: meldingen står med feilteksten og ny «Angre»", async (_name, undo) => {
    const focus = vi.fn();
    const store = createUndoToastStore();
    store.setFocusHandler(focus);
    store.show(options({ undo }));
    await store.undo();
    const view = store.getSnapshot()!;
    expect(view.phase).toBe("error");
    expect(view.error).toBe(FAILED);
    expect(view.message).toBe(REMOVED);
    const html = render(view);
    expect(html).toContain(FAILED);
    expect(html).toContain('role="alert"');
    expect(buttons(html)).toContain("Angre");
    expect(focus, "ingenting ser gjenopprettet ut").not.toHaveBeenCalled();
    // Feilen står uten tidsgrense
    vi.advanceTimersByTime(120_000);
    expect(store.getSnapshot()!.phase).toBe("error");
    expect(store.canUndo()).toBe(true);
  });

  it("uten nett: «Du er uten nett.» foran", async () => {
    const store = createUndoToastStore({ isOffline: () => true });
    store.show(options({ undo: async () => ({ ok: false }) }));
    await store.undo();
    expect(store.getSnapshot()!.error).toBe(`Du er uten nett. ${FAILED}`);
  });

  it("nytt forsøk som lykkes: svaret vises og fokus flyttes til det som kom tilbake", async () => {
    const focus = vi.fn();
    const undo = vi
      .fn<() => Promise<UndoOutcome>>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, message: RESTORED, focus: `room:${ROOM_ID}` });
    const store = createUndoToastStore();
    store.setFocusHandler(focus);
    store.show(options({ undo }));
    await store.undo();
    await store.undo();
    const view = store.getSnapshot()!;
    expect(view.phase).toBe("result");
    expect(view.message).toBe(RESTORED);
    expect(view.error).toBeNull();
    expect(buttons(render(view))).not.toContain("Angre");
    expect(focus).toHaveBeenCalledWith(`room:${ROOM_ID}`);
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot()).toBeNull();
  });
});

describe("9.7 skjermleser og lukkeknapp", () => {
  it("linjene står i role=status (polite, atomic); knappene står utenfor", () => {
    const store = createUndoToastStore();
    store.show(options());
    const html = render(store.getSnapshot());
    const status =
      /<div role="status" aria-live="polite" aria-atomic="true">([\s\S]*?)<\/div>/.exec(html);
    expect(status).not.toBeNull();
    expect(status![1]).toContain(REMOVED);
    expect(status![1]).not.toContain("<button");
  });

  it("lukkeknappen heter «Lukk meldingen» og er 44 × 44 px", () => {
    const store = createUndoToastStore();
    store.show(options());
    const html = render(store.getSnapshot());
    expect(html).toMatch(/<button[^>]*aria-label="Lukk meldingen"[^>]*class="[^"]*size-11/);
  });

  it("«Angre» er hovedknapp i stor størrelse (56 px)", () => {
    const store = createUndoToastStore();
    store.show(options());
    const html = render(store.getSnapshot());
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-14[^"]*"[^>]*>Angre<\/button>/);
  });

  it("uten melding finnes statusfeltet, tomt, så endringen leses opp", () => {
    const html = render(null);
    expect(html).toContain('role="status"');
    expect(buttons(html)).toEqual([]);
  });

  it("lukk: × lukker med en gang", () => {
    const store = createUndoToastStore();
    store.show(options());
    store.close();
    expect(store.getSnapshot()).toBeNull();
  });
});

describe("9.8 ingen lagring", () => {
  it("localStorage og sessionStorage brukes ikke, og loggeren får ikke navn", async () => {
    const writes: string[] = [];
    const fakeStorage = () => ({
      setItem: (key: string, value: string) => writes.push(`${key}=${value}`),
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("sessionStorage", fakeStorage());
    try {
      const store = createUndoToastStore();
      store.show(options());
      await store.undo();
      store.show(options({ undo: async () => ({ ok: false }) }));
      await store.undo();
      store.close();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(writes).toEqual([]);
    const logged = JSON.stringify([
      logger.error.mock.calls,
      logger.warn.mock.calls,
      logger.info.mock.calls,
    ]);
    expect(logged).not.toContain("Bad");
  });

  it("kildekoden bruker verken nettleserlagring, adressen eller loggeren", () => {
    // Uten kommentarene: der står det at lagringen ikke brukes.
    const source = readFileSync(new URL("./undo-toast.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const banned of [
      "localStorage",
      "sessionStorage",
      "@/shared/lib/logger",
      "history.pushState",
      "history.replaceState",
      "useRouter",
      "useSearchParams",
    ]) {
      expect(source, banned).not.toContain(banned);
    }
  });
});

describe("9.9 ingen ny avhengighet", () => {
  it("meldingen og den sammenfoldede delen importerer bare React, Next og egne filer", () => {
    for (const file of ["./undo-toast.tsx", "./disclosure.tsx", "../lib/use-restored-focus.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
      for (const name of imports) {
        expect(
          name === "react" ||
            name === "next/navigation" ||
            name.startsWith("@/") ||
            name.startsWith("."),
          `${file}: ${name}`,
        ).toBe(true);
      }
    }
  });
});
