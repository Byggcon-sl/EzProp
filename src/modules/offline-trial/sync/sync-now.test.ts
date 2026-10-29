import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSyncNow, singleFlight, SYNC_NOW_TIMEOUT_MS } from "./sync-now";
import type { TrialSyncRoundResult } from "./types";

// Felles runde for «Synk nå» for alle tre kandidatene (docs/funksjoner/fase1-synkstatus.md
// pkt. 3–5 og 8, avgjørelse A2–A3). Testplan avsnitt 2.2. Falske funksjoner og falske tidtakere.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Et løfte som løses eller avvises utenfra. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runSyncNow (sync/sync-now.ts)", () => {
  // Obligatorisk
  it("uten nett gir offline straks og kaller ikke runden", async () => {
    const round = vi.fn(async () => {});
    const result = runSyncNow({ isOnline: () => false, round });
    // Ingen tidtaker for tidsavbruddet er startet
    expect(vi.getTimerCount()).toBe(0);
    await expect(result).resolves.toBe("offline");
    expect(round).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("vellykket runde gir ok", async () => {
    const round = vi.fn(async () => {});
    await expect(runSyncNow({ isOnline: () => true, round })).resolves.toBe("ok");
    expect(round).toHaveBeenCalledTimes(1);
    // Tidtakeren for tidsavbruddet ryddes bort
    expect(vi.getTimerCount()).toBe(0);
  });

  // Obligatorisk
  it("feil i runden gir failed og kaster ikke", async () => {
    const round = vi.fn(async () => {
      throw new Error("Serveren svarte 500");
    });
    await expect(runSyncNow({ isOnline: () => true, round })).resolves.toBe("failed");
    expect(round).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runden kaster synkront gir failed og kaster ikke", async () => {
    const round = vi.fn((): Promise<void> => {
      throw new Error("Kastet før løftet");
    });
    await expect(runSyncNow({ isOnline: () => true, round })).resolves.toBe("failed");
  });

  it("tidsavbrudd etter 15 s gir failed", async () => {
    const never = deferred();
    let settled: TrialSyncRoundResult | null = null;
    void runSyncNow({ isOnline: () => true, round: () => never.promise }).then((result) => {
      settled = result;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("failed");
  });

  it("tidsavbrudd er 15 000 ms", () => {
    expect(SYNC_NOW_TIMEOUT_MS).toBe(15_000);
  });

  it("isOnline leses ved hvert kall, ikke én gang", async () => {
    let online = false;
    const round = vi.fn(async () => {});
    await expect(runSyncNow({ isOnline: () => online, round })).resolves.toBe("offline");
    online = true;
    await expect(runSyncNow({ isOnline: () => online, round })).resolves.toBe("ok");
    expect(round).toHaveBeenCalledTimes(1);
  });
});

describe("singleFlight (sync/sync-now.ts)", () => {
  // Obligatorisk
  it("to kall rett etter hverandre gir én runde", async () => {
    const gate = deferred<TrialSyncRoundResult>();
    const round = vi.fn(() => gate.promise);
    const once = singleFlight(round);
    const first = once();
    const second = once();
    expect(round).toHaveBeenCalledTimes(1);
    gate.resolve("ok");
    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
    expect(round).toHaveBeenCalledTimes(1);
  });

  it("nytt kall etter ferdig runde gir ny runde", async () => {
    const round = vi.fn(async (): Promise<TrialSyncRoundResult> => "ok");
    const once = singleFlight(round);
    await once();
    await once();
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("nytt kall etter feil gir ny runde", async () => {
    const round = vi
      .fn<() => Promise<TrialSyncRoundResult>>()
      .mockRejectedValueOnce(new Error("Feil i første runde"))
      .mockResolvedValueOnce("ok");
    const once = singleFlight(round);
    await expect(once()).rejects.toThrow("Feil i første runde");
    await expect(once()).resolves.toBe("ok");
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("nytt kall etter tidsavbrudd gir ny runde", async () => {
    const never = deferred();
    const round = vi.fn(() => never.promise);
    const once = singleFlight(() => runSyncNow({ isOnline: () => true, round }));
    const first = once();
    await vi.advanceTimersByTimeAsync(SYNC_NOW_TIMEOUT_MS);
    await expect(first).resolves.toBe("failed");
    const second = once();
    expect(round).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_NOW_TIMEOUT_MS);
    await expect(second).resolves.toBe("failed");
  });
});
