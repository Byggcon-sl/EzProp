import { describe, expect, it, vi } from "vitest";
import { logOutAndClear } from "./log-out";

/*
 * Utlogging tømmer KI-køen først (docs/funksjoner/fase2a-ki-ko.md Omfang 6). Ren test uten
 * nettleser. Teksten i feilen er oppdiktet.
 * Støtter hovedmål: de ansatte (ingen ser en annens tekst på en delt iPad).
 */

describe("logOutAndClear", () => {
  it("tømmer køen før utlogging, én gang hver", async () => {
    const calls: string[] = [];
    await logOutAndClear({
      clearQueue: async () => void calls.push("clear"),
      signOut: async () => void calls.push("signOut"),
    });
    expect(calls).toEqual(["clear", "signOut"]);
  });

  it.each([
    ["avviser", () => Promise.reject(new Error("taket lekker i hjørnet"))],
    [
      "kaster synkront",
      () => {
        throw new Error("taket lekker i hjørnet");
      },
    ],
  ])("feil ved tømming (%s) stopper ikke utloggingen og logges ikke", async (_name, clearQueue) => {
    const signOut = vi.fn(async () => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await logOutAndClear({ clearQueue: clearQueue as () => Promise<unknown>, signOut });
      expect(signOut).toHaveBeenCalledTimes(1);
      expect([...error.mock.calls, ...warn.mock.calls, ...log.mock.calls]).toEqual([]);
    } finally {
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
