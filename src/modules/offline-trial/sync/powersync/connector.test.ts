import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSyncNow } from "../sync-now";
import { TrialSyncConnector } from "./connector";

// «Synk nå» for PowerSync (docs/funksjoner/fase1-synkstatus.md pkt. 3, testplan 2.4, krav K3).
// Uten PowerSync-tjenesten (som i e2e) må `syncNow` selv kalle opplastingen i koblingen. Her vises
// det koblingen gjør når den kalles direkte: én POST til skriveruten, transaksjonen fullføres bare
// ved 200, og en feil blir `"failed"` gjennom den felles runden uten å kaste. Falsk database og
// falsk `fetch`; SDK-en lastes ikke (bare typer). Alle data er oppdiktet.

const ORG = "0192d3a0-0000-7000-8000-0000000000f1";
const FORM = "0192d3a0-0000-7000-8000-000000000001";

function fakeDb() {
  const complete = vi.fn(async () => {});
  const transaction = {
    crud: [{ table: "trial_forms", op: "PUT", id: FORM, opData: { name: "Testskjema 1" } }],
    complete,
  };
  const db = {
    getNextCrudTransaction: vi.fn(async () => transaction),
    getOptional: vi.fn(async () => null),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, complete };
}

function stubFetch(status: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TrialSyncConnector.uploadData (powersync/connector.ts)", () => {
  it("PowerSync: syncNow kaller opplastingen direkte, uten tjenesten", async () => {
    const calls = stubFetch(200);
    const { db, complete } = fakeDb();
    const connector = new TrialSyncConnector(ORG);

    const result = await runSyncNow({
      isOnline: () => true,
      round: () => connector.uploadData(db),
    });

    expect(result).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/prove/synk/endringer");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      organizationId: string;
      operations: { op: string; table: string; id: string }[];
    };
    expect(body.organizationId).toBe(ORG);
    expect(body.operations).toEqual([
      expect.objectContaining({ op: "PUT", table: "trial_forms", id: FORM }),
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("PowerSync: 500 fullfører ikke transaksjonen og gir failed uten å kaste", async () => {
    const calls = stubFetch(500);
    const { db, complete } = fakeDb();
    const connector = new TrialSyncConnector(ORG);

    const result = await runSyncNow({
      isOnline: () => true,
      round: () => connector.uploadData(db),
    });

    expect(result).toBe("failed");
    expect(calls).toHaveLength(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it("PowerSync: uten nett sendes ingenting", async () => {
    const calls = stubFetch(200);
    const { db, complete } = fakeDb();
    const connector = new TrialSyncConnector(ORG);

    const result = await runSyncNow({
      isOnline: () => false,
      round: () => connector.uploadData(db),
    });

    expect(result).toBe("offline");
    expect(calls).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
  });
});
