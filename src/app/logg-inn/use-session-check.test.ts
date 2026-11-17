import { describe, expect, it, vi } from "vitest";
import { createSessionWatcher, SESSION_CHECK_INTERVAL_MS } from "./use-session-check";

/*
 * Sjekk av økten når siden får fokus igjen (testplan 1h, tillegg F2). Falsk `document`, falsk
 * klokke og nett styrt i testen. Støtter hovedmål: de ansatte (de ser at de er logget ut før de
 * skriver). Kallet sender ingen persondata.
 */

class FakeDocument extends EventTarget {
  visibilityState = "visible";
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners += 1;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners -= 1;
    super.removeEventListener(...args);
  }
  show(state: "visible" | "hidden") {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function setup(answer: () => Promise<boolean | null>) {
  const target = new FakeDocument();
  let now = 1_000_000;
  let online = true;
  const hasSession = vi.fn(answer);
  const watcher = createSessionWatcher({
    target,
    isOnline: () => online,
    hasSession,
    now: () => now,
  });
  const onSignedOut = vi.fn();
  const stop = watcher.subscribe(onSignedOut);
  return {
    target,
    watcher,
    hasSession,
    onSignedOut,
    stop,
    tick: (ms: number) => {
      now += ms;
    },
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

/** Lar sjekken som hendelsen startet, bli ferdig. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSessionWatcher", () => {
  it("synlig igjen og økten er ute: «logget ut»", async () => {
    const { target, onSignedOut, hasSession } = setup(async () => false);
    target.show("visible");
    await settle();
    expect(hasSession).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("synlig igjen og økten gjelder: ingen melding", async () => {
    const { target, onSignedOut } = setup(async () => true);
    target.show("visible");
    await settle();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("høyst ett kall per 60 sekunder", async () => {
    const { target, hasSession, tick } = setup(async () => true);
    target.show("visible");
    tick(30_000);
    target.show("visible");
    await settle();
    expect(hasSession).toHaveBeenCalledTimes(1);
    tick(SESSION_CHECK_INTERVAL_MS);
    target.show("visible");
    await settle();
    expect(hasSession).toHaveBeenCalledTimes(2);
  });

  it("uten nett: ingen kall og ingen melding", async () => {
    const { target, hasSession, onSignedOut, setOnline } = setup(async () => false);
    setOnline(false);
    target.show("visible");
    await settle();
    expect(hasSession).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("kallet feiler eller svaret er ukjent: ingen melding og ingen feil", async () => {
    const failing = setup(async () => {
      throw new Error("tidsavbrudd");
    });
    failing.target.show("visible");
    await settle();
    expect(failing.onSignedOut).not.toHaveBeenCalled();

    const unknown = setup(async () => null);
    unknown.target.show("visible");
    await settle();
    expect(unknown.onSignedOut).not.toHaveBeenCalled();
  });

  it("skjult: ingen kall", async () => {
    const { target, hasSession } = setup(async () => false);
    target.show("hidden");
    await settle();
    expect(hasSession).not.toHaveBeenCalled();
  });

  it("lytteren fjernes når siste skjema tas bort", async () => {
    const { target, watcher, stop, hasSession } = setup(async () => false);
    const second = watcher.subscribe(() => {});
    expect(target.listeners).toBe(1);
    stop();
    expect(target.listeners).toBe(1);
    second();
    expect(target.listeners).toBe(0);
    target.show("visible");
    await settle();
    expect(hasSession).not.toHaveBeenCalled();
  });
});
