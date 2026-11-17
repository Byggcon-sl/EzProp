import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNED_OUT_ON_FOCUS_MESSAGE } from "@/shared/forms/messages";

/*
 * Rett T-0070, tillegg F2: sjekk av innloggingen når siden får fokus igjen (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1h). Falsk `getSession` med samme
 * svarform som `authClient.getSession`, falsk klokke, og nett styrt i testen.
 *
 * Støtter hovedmål: de ansatte (takstmannen på iPad får vite at han er logget ut før han
 * begynner å skrive) og personvern (kallet bærer ingen persondata).
 */

vi.mock("@/core/auth/auth-client", () => ({ authClient: { getSession: vi.fn() } }));

const { createSessionWatcher, SESSION_CHECK_INTERVAL_MS } = await import("./use-session-check");

type SessionAnswer = { data: unknown; error: unknown };

/** Et falskt `document`: synlighet og `visibilitychange`. */
class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  show() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
  hide() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let doc: FakeDocument;
let online: boolean;
let getSession: ReturnType<typeof vi.fn<() => Promise<SessionAnswer>>>;

/** Samme tolkning som i hjelperen: feil gir ukjent svar (ingen melding). */
async function hasSession(): Promise<boolean | null> {
  const { data, error } = await getSession();
  if (error) return null;
  return data !== null;
}

function watcher() {
  return createSessionWatcher({
    target: doc,
    isOnline: () => online,
    hasSession,
    now: () => Date.now(),
  });
}

/** Lar løftene i sjekken bli ferdige. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
  doc = new FakeDocument();
  online = true;
  getSession = vi.fn(async () => ({ data: { user: { id: "u" } }, error: null }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1h sjekk når siden får fokus igjen", () => {
  it("meldingen er «Du er logget ut. Logg inn før du lagrer.»", () => {
    expect(SIGNED_OUT_ON_FOCUS_MESSAGE).toBe("Du er logget ut. Logg inn før du lagrer.");
  });

  it("synlig igjen og økten er ute: tilstanden blir «logget ut»", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    const onSignedOut = vi.fn();
    watcher().subscribe(onSignedOut);
    doc.show();
    await flush();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("synlig igjen og økten gjelder: ingen melding", async () => {
    const onSignedOut = vi.fn();
    watcher().subscribe(onSignedOut);
    doc.show();
    await flush();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("høyst ett kall per 60 sekunder; etter 60 s gir neste ett nytt kall", async () => {
    expect(SESSION_CHECK_INTERVAL_MS).toBe(60_000);
    watcher().subscribe(vi.fn());
    doc.show();
    await flush();
    vi.advanceTimersByTime(30_000);
    doc.show();
    await flush();
    expect(getSession).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    doc.show();
    await flush();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("uten nett: ingen kall og ingen melding", async () => {
    online = false;
    getSession.mockResolvedValue({ data: null, error: null });
    const onSignedOut = vi.fn();
    watcher().subscribe(onSignedOut);
    doc.show();
    await flush();
    expect(getSession).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("kallet avvises: ingen melding og ingen feil kastet", async () => {
    getSession.mockRejectedValue(new TypeError("Failed to fetch"));
    const onSignedOut = vi.fn();
    const w = watcher();
    w.subscribe(onSignedOut);
    await expect(w.check()).resolves.toBeUndefined();
    doc.show();
    await flush();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("svaret har feil: ingen melding", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 500 } });
    const onSignedOut = vi.fn();
    watcher().subscribe(onSignedOut);
    doc.show();
    await flush();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("tidsavbrudd (svaret kommer aldri): ingen melding", async () => {
    getSession.mockImplementation(() => new Promise<SessionAnswer>(() => {}));
    const onSignedOut = vi.fn();
    watcher().subscribe(onSignedOut);
    doc.show();
    await flush();
    vi.advanceTimersByTime(120_000);
    await flush();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("skjult (hidden): ingen kall", async () => {
    watcher().subscribe(vi.fn());
    doc.hide();
    await flush();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("lytteren fjernes når komponenten tas bort", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    const add = vi.spyOn(doc, "addEventListener");
    const remove = vi.spyOn(doc, "removeEventListener");
    const onSignedOut = vi.fn();
    const unsubscribe = watcher().subscribe(onSignedOut);
    expect(add).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    unsubscribe();
    expect(remove).toHaveBeenCalledWith("visibilitychange", add.mock.calls[0]![1]);
    doc.show();
    await flush();
    expect(getSession).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
