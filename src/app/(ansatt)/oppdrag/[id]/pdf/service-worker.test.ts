import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/*
 * Service workeren mellomlagrer aldri PDF-ene (docs/funksjoner/fase2a-pdf-badet-testplan.md 6.5
 * og 11.7). `public/sw.js` kjøres i en sandkasse med en falsk `self`, og fetch-hendelser for begge
 * rutene sendes inn: ingen av dem går til `respondWith`. Til sammenligning går en statisk fil dit.
 */

const ORIGIN = "https://app.example.test";
const ID = "0190f3c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f";
const RELEASE_ID = "0190f3c4-7a1b-7c2d-8e3f-4a5b6c7d8ea0";

type FetchListener = (event: unknown) => void;

function loadServiceWorker(): FetchListener {
  const listeners = new Map<string, FetchListener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: FetchListener) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const code = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(code, {
    self,
    URL,
    Response,
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => undefined }),
      keys: async () => [],
    },
    fetch: async () => new Response(null),
  });
  const listener = listeners.get("fetch");
  if (!listener) throw new Error("sw.js har ingen fetch-lytter");
  return listener;
}

function dispatch(listener: FetchListener, pathAndQuery: string, mode = "navigate") {
  const respondWith = vi.fn();
  listener({
    request: { method: "GET", url: `${ORIGIN}${pathAndQuery}`, mode, headers: new Headers() },
    respondWith,
    waitUntil: vi.fn(),
  });
  return respondWith;
}

describe("public/sw.js og PDF-rutene", () => {
  const listener = loadServiceWorker();

  it.each([
    `/oppdrag/${ID}/pdf`,
    `/oppdrag/${ID}/pdf/`,
    `/oppdrag/${ID}/pdf?x=1`,
    `/oppdrag/${ID}/utgivelser/${RELEASE_ID}/pdf`,
    `/oppdrag/${ID}/utgivelser/${RELEASE_ID}/pdf?_rsc=abc`,
  ])("%s går aldri til respondWith", (address) => {
    expect(dispatch(listener, address)).not.toHaveBeenCalled();
    expect(dispatch(listener, address, "no-cors")).not.toHaveBeenCalled();
  });

  it("sammenligning: en statisk fil går til respondWith (lytteren virker i sandkassen)", () => {
    expect(dispatch(listener, "/_next/static/chunks/app.js", "no-cors")).toHaveBeenCalledTimes(1);
  });

  it("PDF-rutene står som unntak i filen", () => {
    const code = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(code).toMatch(/PDF_PATHS/);
    expect(code).toContain("utgivelser");
  });
});
