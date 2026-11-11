import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_FIELD_MAX_LENGTH } from "../limits";
import {
  AI_QUEUE_MAX_AGE_MS,
  AI_QUEUE_MAX_ENTRIES,
  clearAiQueue,
  createAiQueue,
  createIndexedDbAiQueueStore,
  createMemoryAiQueueStore,
  type AiQueueDeps,
  type AiQueueEnqueueInput,
  type AiQueueEntry,
  type AiQueueOwner,
  type AiQueueStore,
} from ".";

/*
 * KI-køen på enheten, minneutgaven av lageret (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 1,
 * K1.1–K1.11). Rene tester uten database og uten nettleser. Teksten er oppdiktet.
 * Støtter hovedmål: de ansatte (ett trykk uten nett, ingen ser en annens tekst på delt iPad) og
 * KI i bunnen (køen er grunnmuren for KI på iPaden i fase 2b).
 */

const OWNER: AiQueueOwner = { organizationId: randomUUID(), employeeId: randomUUID() };
const TEXT = "Fukt i kjellervegg ved sluk";
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

afterEach(() => {
  vi.restoreAllMocks();
});

function input(overrides: Partial<AiQueueEnqueueInput> = {}): AiQueueEnqueueInput {
  return {
    feature: "language_polish",
    targetType: "ai_trial",
    targetId: randomUUID(),
    fieldKey: "text",
    assignmentId: null,
    fields: { text: TEXT },
    ...overrides,
  };
}

/** En gyldig, rå post slik den ligger i lageret. */
function rawEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: randomUUID(),
    feature: "language_polish",
    targetType: "ai_trial",
    targetId: randomUUID(),
    fieldKey: "text",
    assignmentId: null,
    organizationId: OWNER.organizationId,
    employeeId: OWNER.employeeId,
    fields: { text: TEXT },
    queuedAt: NOW - HOUR,
    attempts: 0,
    ...overrides,
  };
}

function queueWith(store: AiQueueStore, deps: Partial<AiQueueDeps> = {}) {
  return createAiQueue({ store, owner: OWNER, now: () => NOW, isOnline: () => true, ...deps });
}

/** Det som faktisk ligger i lageret, uten validering. */
async function stored(store: AiQueueStore): Promise<Record<string, unknown>[]> {
  return store.update((rows) => ({
    put: [],
    remove: [],
    result: rows as Record<string, unknown>[],
  }));
}

async function listed(queue: ReturnType<typeof queueWith>): Promise<AiQueueEntry[]> {
  const result = await queue.list();
  if (result.kind !== "listed") throw new Error(`ventet listed, fikk ${result.kind}`);
  return result.entries;
}

async function queued(queue: ReturnType<typeof queueWith>, data = input()) {
  const result = await queue.enqueue(data);
  if (result.kind !== "queued") throw new Error(`ventet queued, fikk ${result.reason}`);
  return result;
}

describe("K1.1 enqueue, list, remove og clear", () => {
  it("enqueue gir en post, list gir den, remove fjerner bare den, clear tømmer alt", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);

    const first = await queued(queue);
    expect(first.replacedRequestId).toBeNull();
    expect(first.entry).toMatchObject({
      feature: "language_polish",
      targetType: "ai_trial",
      fieldKey: "text",
      assignmentId: null,
      fields: { text: TEXT },
      organizationId: OWNER.organizationId,
      employeeId: OWNER.employeeId,
      queuedAt: NOW,
      attempts: 0,
    });
    expect(await listed(queue)).toEqual([first.entry]);

    const second = await queued(queue);
    const third = await queued(queue);
    await queue.remove(second.entry.requestId);
    // Samme `now` gir lik `queuedAt`, så rekkefølgen avgjøres av tilfeldig `requestId` (K1.x om
    // rekkefølge prøver den). Her gjelder bare hvilke poster som står igjen.
    expect((await listed(queue)).map((e) => e.requestId).sort()).toEqual(
      [first.entry.requestId, third.entry.requestId].sort(),
    );

    expect(await clearAiQueue(store)).toEqual({ cleared: true });
    expect(await listed(queue)).toEqual([]);
    expect(await stored(store)).toEqual([]);
  });

  it("remove på ukjent requestId endrer ingenting", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const entry = (await queued(queue)).entry;
    await queue.remove(randomUUID());
    expect(await listed(queue)).toEqual([entry]);
  });
});

describe("K1.2 rekkefølge", () => {
  it("poster kommer etter queuedAt, uansett rekkefølge de ble lagt inn i", async () => {
    const times = [NOW - 1 * MINUTE, NOW - 3 * MINUTE, NOW - 2 * MINUTE];
    let i = 0;
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store, { now: () => times[i++] ?? NOW });
    const a = (await queued(queue)).entry;
    const b = (await queued(queue)).entry;
    const c = (await queued(queue)).entry;
    expect((await listed(queue)).map((e) => e.requestId)).toEqual([
      b.requestId,
      c.requestId,
      a.requestId,
    ]);
  });

  it("lik queuedAt sorteres på requestId", async () => {
    const ids = [
      "c0000000-0000-4000-8000-000000000000",
      "a0000000-0000-4000-8000-000000000000",
      "b0000000-0000-4000-8000-000000000000",
    ];
    let i = 0;
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store, { newRequestId: () => ids[i++]! });
    await queued(queue);
    await queued(queue);
    await queued(queue);
    expect((await listed(queue)).map((e) => e.requestId)).toEqual([...ids].sort());
  });
});

describe("K1.3 én post per mål og felt", () => {
  it("ny forespørsel på samme mål og felt erstatter den gamle med ny tekst og ny requestId", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const target = randomUUID();
    const first = await queued(queue, input({ targetId: target }));
    const second = await queued(
      queue,
      input({ targetId: target, fields: { text: `${TEXT} og i hjørnet` } }),
    );

    expect(second.replacedRequestId).toBe(first.entry.requestId);
    expect(second.entry.requestId).not.toBe(first.entry.requestId);
    const entries = await listed(queue);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: second.entry.requestId,
      fields: { text: `${TEXT} og i hjørnet` },
    });
    expect(await stored(store)).toHaveLength(1);
  });

  it("annen fieldKey på samme mål gir to poster", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const target = randomUUID();
    await queued(queue, input({ targetId: target, fieldKey: "text" }));
    // Feltkoden på målet er ikke feltkoden i `fields`; den er bare en del av målet
    await queued(queue, input({ targetId: target, fieldKey: "description" }));
    expect(await listed(queue)).toHaveLength(2);
  });

  it("annen targetType på samme id gir to poster", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const target = randomUUID();
    await queued(queue, input({ targetId: target, targetType: "ai_trial" }));
    await queued(queue, input({ targetId: target, targetType: "deviation" }));
    expect(await listed(queue)).toHaveLength(2);
  });
});

describe("K1.4 erstatning ved full kø", () => {
  it("med 50 poster går erstatning, og køen har fortsatt 50", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const entries: AiQueueEntry[] = [];
    for (let n = 0; n < AI_QUEUE_MAX_ENTRIES; n++) entries.push((await queued(queue)).entry);
    const victim = entries[17]!;

    const result = await queue.enqueue(
      input({ targetId: victim.targetId, fields: { text: `${TEXT} ny` } }),
    );
    expect(result).toMatchObject({ kind: "queued", replacedRequestId: victim.requestId });
    const after = await listed(queue);
    expect(after).toHaveLength(AI_QUEUE_MAX_ENTRIES);
    expect(after.map((e) => e.requestId)).not.toContain(victim.requestId);
  });
});

describe("K1.5 grense på antall", () => {
  it("grensen er 50", () => {
    expect(AI_QUEUE_MAX_ENTRIES).toBe(50);
  });

  it.each<[string, number, boolean]>([
    ["post nr. 49 går", 48, true],
    ["post nr. 50 går", 49, true],
    ["post nr. 51 (nytt mål) avvises", 50, false],
  ])("%s", async (_name, before, accepted) => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    for (let n = 0; n < before; n++) await queued(queue);
    const snapshot = await stored(store);

    const result = await queue.enqueue(input());
    if (accepted) {
      expect(result.kind).toBe("queued");
      expect(await listed(queue)).toHaveLength(before + 1);
    } else {
      expect(result).toEqual({ kind: "rejected", reason: "full" });
      // Ingen stille tap: køen er nøyaktig som før
      expect(await stored(store)).toEqual(snapshot);
    }
  });
});

describe("K1.6 grense på lengde", () => {
  it("tekst på nøyaktig AI_FIELD_MAX_LENGTH tegn går", async () => {
    const queue = queueWith(createMemoryAiQueueStore());
    const result = await queue.enqueue(
      input({ fields: { text: "a".repeat(AI_FIELD_MAX_LENGTH) } }),
    );
    expect(result.kind).toBe("queued");
  });

  it("én over gir fast kode, ingen post, og svaret har ikke teksten", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const long = `${TEXT} ${"x".repeat(AI_FIELD_MAX_LENGTH)}`.slice(0, AI_FIELD_MAX_LENGTH + 1);
    const result = await queue.enqueue(input({ fields: { text: long } }));
    expect(result).toEqual({ kind: "rejected", reason: "too_long" });
    expect(JSON.stringify(result)).not.toContain(TEXT);
    expect(await stored(store)).toEqual([]);
  });

  it.each<[string, Record<string, string>]>([
    ["ukjent feltkode", { text: TEXT, notes: "oppdiktet" }],
    ["ingen felt", {}],
  ])("%s gir invalid og ingen post", async (_name, fields) => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    expect(await queue.enqueue(input({ fields }))).toEqual({ kind: "rejected", reason: "invalid" });
    expect(await stored(store)).toEqual([]);
  });

  it("ukjent funksjon gir invalid og ingen post", async () => {
    const store = createMemoryAiQueueStore();
    const queue = queueWith(store);
    const result = await queue.enqueue(
      input({ feature: "photo_to_draft" as unknown as AiQueueEnqueueInput["feature"] }),
    );
    expect(result).toEqual({ kind: "rejected", reason: "invalid" });
    expect(await stored(store)).toEqual([]);
  });
});

describe("K1.7 requestId uten tid i seg", () => {
  it("ny post har UUID v4 (versjonssifferet er 4), og to poster har ulike id-er", async () => {
    // Uten `newRequestId`: standarden skal brukes
    const queue = createAiQueue({
      store: createMemoryAiQueueStore(),
      owner: OWNER,
      now: () => NOW,
      isOnline: () => true,
    });
    const a = (await queued(queue)).entry.requestId;
    const b = (await queued(queue)).entry.requestId;
    for (const id of [a, b]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(id.charAt(14)).toBe("4");
    }
    expect(a).not.toBe(b);
  });
});

describe("K1.8 og K1.9 lesesjekken sletter ugyldige poster og lar gyldige stå", () => {
  const cases: [string, () => Record<string, unknown>][] = [
    ["feil form (mangler text)", () => rawEntry({ fields: {} as Record<string, string> })],
    [
      "feil form (mangler requestId)",
      () => {
        const { requestId: _drop, ...rest } = rawEntry();
        return rest;
      },
    ],
    ["feil form (fields er tekst)", () => rawEntry({ fields: TEXT })],
    ["ukjent feature", () => rawEntry({ feature: "photo_to_draft" })],
    ["ukjent feltkode i fields", () => rawEntry({ fields: { text: TEXT, notes: "oppdiktet" } })],
    [
      "__proto__ som nøkkel i fields",
      () => rawEntry({ fields: JSON.parse(`{"text":"${TEXT}","__proto__":"oppdiktet"}`) }),
    ],
    ["for lang tekst", () => rawEntry({ fields: { text: "a".repeat(AI_FIELD_MAX_LENGTH + 1) } })],
    ["annen organizationId", () => rawEntry({ organizationId: randomUUID() })],
    ["annen employeeId", () => rawEntry({ employeeId: randomUUID() })],
    ["queuedAt 7 dager og 1 minutt gammel", () => rawEntry({ queuedAt: NOW - 7 * DAY - MINUTE })],
    ["queuedAt mer enn ett døgn fram i tid", () => rawEntry({ queuedAt: NOW + DAY + MINUTE })],
    ["requestId er et tall", () => rawEntry({ requestId: 42 as unknown as string })],
  ];

  it("levetiden er 7 dager", () => {
    expect(AI_QUEUE_MAX_AGE_MS).toBe(7 * DAY);
  });

  it.each(cases)("%s: borte fra lageret ved lesing og sendes aldri", async (_name, make) => {
    const bad = make();
    const good = rawEntry({ queuedAt: NOW - 6 * DAY - 23 * HOUR });
    const store = createMemoryAiQueueStore([bad, good]);
    const queue = queueWith(store);

    const entries = await listed(queue);
    expect(entries.map((e) => e.requestId)).toEqual([good.requestId]);
    // Slettet fra lageret, ikke bare skjult
    const left = await stored(store);
    expect(left).toHaveLength(1);
    expect(left[0]?.requestId).toBe(good.requestId);

    // Og aldri sendt, heller ikke når den ligger der fra før ved behandling
    const store2 = createMemoryAiQueueStore([make()]);
    const send = vi.fn(async () => ({ kind: "suggestion" as const }));
    await queueWith(store2).processQueue(send, () => {});
    expect(send).not.toHaveBeenCalled();
    expect(await stored(store2)).toEqual([]);
  });

  it("post på 6 dager og 23 timer beholdes", async () => {
    const entry = rawEntry({ queuedAt: NOW - 6 * DAY - 23 * HOUR });
    const store = createMemoryAiQueueStore([entry]);
    expect((await listed(queueWith(store))).map((e) => e.requestId)).toEqual([entry.requestId]);
    expect(await stored(store)).toHaveLength(1);
  });

  it("K1.9 flere gyldige og ugyldige i samme lesing: alle gyldige står", async () => {
    const goods = [rawEntry(), rawEntry(), rawEntry()];
    const bads = [
      rawEntry({ employeeId: randomUUID() }),
      rawEntry({ feature: "x" }),
      null,
      "tekst",
    ];
    const store = createMemoryAiQueueStore([
      bads[0],
      goods[0],
      bads[1],
      goods[1],
      bads[2],
      goods[2],
      bads[3],
    ]);
    const entries = await listed(queueWith(store));
    expect(entries.map((e) => e.requestId).sort()).toEqual(
      goods.map((g) => g.requestId as string).sort(),
    );
    expect(await stored(store)).toHaveLength(3);
  });

  it("enqueue rydder også: annen eiers post er borte etter at en ny post er lagt inn", async () => {
    const foreign = rawEntry({ employeeId: randomUUID() });
    const store = createMemoryAiQueueStore([foreign]);
    await queued(queueWith(store));
    const left = await stored(store);
    expect(left).toHaveLength(1);
    expect(left[0]?.employeeId).toBe(OWNER.employeeId);
  });
});

describe("K1.10 ingen tekst ut når lageret feiler", () => {
  function throwingStore(): AiQueueStore {
    return {
      async update() {
        throw new DOMException(`Lagring feilet for «${TEXT}»`, "QuotaExceededError");
      },
      async clear() {
        throw new DOMException(`Tømming feilet for «${TEXT}»`, "InvalidStateError");
      },
    };
  }

  function consoleSpies() {
    return (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
  }

  it("enqueue gir unavailable uten teksten, og ingenting skrives til konsollen", async () => {
    const spies = consoleSpies();
    const result = await queueWith(throwingStore()).enqueue(input());
    expect(result).toEqual({ kind: "rejected", reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain(TEXT);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("list gir unavailable, ikke unntak", async () => {
    const spies = consoleSpies();
    expect(await queueWith(throwingStore()).list()).toEqual({ kind: "unavailable" });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("processQueue stopper med unavailable, ikke unntak", async () => {
    const spies = consoleSpies();
    const send = vi.fn(async () => ({ kind: "suggestion" as const }));
    const result = await queueWith(throwingStore()).processQueue(send, () => {});
    expect(result).toMatchObject({ kind: "stopped", reason: "unavailable" });
    expect(send).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("remove kaster ikke teksten videre", async () => {
    const spies = consoleSpies();
    let thrown: unknown = null;
    try {
      await queueWith(throwingStore()).remove(randomUUID());
    } catch (error) {
      thrown = error;
    }
    if (thrown !== null) {
      expect(String(thrown)).not.toContain(TEXT);
      expect(JSON.stringify(thrown)).not.toContain(TEXT);
      expect(thrown instanceof Error ? thrown.message : "").not.toContain(TEXT);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("clearAiQueue kaster aldri (utloggingen skal gå videre)", async () => {
    const spies = consoleSpies();
    await expect(clearAiQueue(throwingStore())).resolves.toEqual({ cleared: false });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("K1.11 IndexedDB mangler", () => {
  it("IndexedDB-utgaven uten globalThis.indexedDB gir fast kode fra enqueue og tom liste, ikke unntak", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      expect(globalThis.indexedDB).toBeUndefined();
      const queue = queueWith(createIndexedDbAiQueueStore());
      expect(await queue.enqueue(input())).toEqual({ kind: "rejected", reason: "unavailable" });
      expect(await queue.list()).toEqual({ kind: "unavailable" });
      await expect(clearAiQueue(createIndexedDbAiQueueStore())).resolves.toEqual({
        cleared: false,
      });
      // Uten argument brukes IndexedDB-utgaven; heller ikke den kaster
      await expect(clearAiQueue()).resolves.toEqual({ cleared: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
