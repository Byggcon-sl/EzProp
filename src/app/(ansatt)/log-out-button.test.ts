import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Utlogging tømmer KI-køen (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 7, K7.1–K7.3).
 * Rene tester av `logOutAndClear` (log-out.ts), som `LogOutButton` kaller. Teksten er oppdiktet.
 * Støtter hovedmål: de ansatte (på en delt iPad ser neste person aldri teksten i køen, og
 * utloggingen stopper aldri på grunn av køen).
 */

vi.mock("@/core/auth/auth-client", () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const { logOutAndClear } = await import("./log-out");

const here = path.dirname(fileURLToPath(import.meta.url));
const TEXT = "Fukt i kjellervegg ved sluk";

afterEach(() => {
  vi.restoreAllMocks();
});

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => {}),
  );
}

describe("K7.1 rekkefølge", () => {
  it("clearQueue kalles før signOut, og begge én gang", async () => {
    const order: string[] = [];
    const clearQueue = vi.fn(async () => {
      order.push("clear");
      return { cleared: true };
    });
    const signOut = vi.fn(async () => {
      order.push("signOut");
    });
    await logOutAndClear({ clearQueue, signOut });
    expect(order).toEqual(["clear", "signOut"]);
    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signOut venter til tømmingen er ferdig", async () => {
    let finished = false;
    const clearQueue = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      finished = true;
      return { cleared: true };
    });
    const signOut = vi.fn(async () => {
      expect(finished).toBe(true);
    });
    await logOutAndClear({ clearQueue, signOut });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("K7.2 feil ved tømming stopper ikke utloggingen", () => {
  it.each<[string, () => Promise<unknown>]>([
    [
      "clearQueue kaster",
      async () => {
        throw new Error(`IndexedDB feilet med «${TEXT}»`);
      },
    ],
    ["clearQueue avviser", () => Promise.reject(new DOMException(TEXT, "InvalidStateError"))],
    ["clearQueue sier at den ikke tømte", async () => ({ cleared: false })],
  ])("%s: signOut kalles likevel, og ingen tekst logges", async (_name, failing) => {
    const spies = consoleSpies();
    const clearQueue = vi.fn(failing);
    const signOut = vi.fn(async () => {});
    // Kaster ikke videre
    await logOutAndClear({ clearQueue, signOut });
    expect(signOut).toHaveBeenCalledTimes(1);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TEXT);
    }
  });
});

describe("K7.3 statisk", () => {
  it("log-out-button.tsx henter køen bare med dynamisk import", () => {
    const source = readFileSync(path.join(here, "log-out-button.tsx"), "utf8");
    expect(source).toMatch(/import\(\s*["']@\/core\/ai\/client["']\s*\)/);
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+["']@\/core\/ai\/client(\/[^"']*)?["']/m);
    expect(source).not.toMatch(/^\s*export\s[^;]*from\s+["']@\/core\/ai\/client/m);
  });
});
