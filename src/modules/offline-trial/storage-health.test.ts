import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isQuotaError,
  LOW_STORAGE_FREE_BYTES,
  LOW_STORAGE_WARNING_TEXT,
  readStorageHealth,
  requestPersistentStorage,
  resetPersistRequestForTests,
  storageErrorLog,
  storageErrorMessage,
  storageHealthText,
  storageLevel,
} from "./storage-health";

// Prøve C – lagring i Safari (docs/funksjoner/fase1-prove-c-lagring.md pkt. 1 og 4).
// Testplan: docs/funksjoner/fase1-prove-c-lagring-testplan.md avsnitt 2.1. Ingen database, ingen
// DOM: `navigator` stubbes per test og fjernes etterpå. Grensen for lite plass er en teknisk
// innstilling og testes som data (tabell). Alle svar og filnavn er oppdiktet.

const MB = 1024 * 1024;
const GB = 1024 * MB;
const SECRET_ANSWER = "Oppdiktet-svar-7391";
const SECRET_PHOTO = "oppdiktet-bilde-7391.jpg";
const FULL = "Plassen på iPaden er brukt opp.";

type Failure = Parameters<typeof storageErrorMessage>[0][number];

/** Ett svar som ikke ble lagret (feltnavnet er etiketten takstmannen ser). */
function answerFailure(label: string, error: unknown = new Error("x")): Failure {
  return { kind: "answer", fieldLabel: label, error } as Failure;
}

/** Ett bilde som ikke ble lagret. */
function photoFailure(label: string, error: unknown = new Error("x")): Failure {
  return { kind: "photo", fieldLabel: label, error } as Failure;
}

function quotaError(message = "Kvoten er full"): DOMException {
  return new DOMException(message, "QuotaExceededError");
}

interface FakeStorage {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

function stubStorage(storage: FakeStorage | undefined) {
  vi.stubGlobal("navigator", storage === undefined ? {} : { storage });
}

beforeEach(() => {
  resetPersistRequestForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storageLevel (storage-health.ts)", () => {
  it("LOW_STORAGE_FREE_BYTES er 500 MB", () => {
    expect(LOW_STORAGE_FREE_BYTES).toBe(500 * 1024 * 1024);
  });

  // Obligatorisk
  it.each<[string, number, number, "ok" | "low"]>([
    ["ledig = grense − 1 byte", 1 * GB, 1 * GB + 500 * MB - 1, "low"],
    ["499,99 MB ledig", 1 * GB, 1 * GB + Math.round(499.99 * MB), "low"],
    ["nøyaktig 500 MB ledig", 1 * GB, 1 * GB + 500 * MB, "ok"],
    ["2 GB ledig", 100 * MB, 100 * MB + 2 * GB, "ok"],
    ["usage = quota (0 ledig)", 2 * GB, 2 * GB, "low"],
    ["usage > quota", 2 * GB + MB, 2 * GB, "low"],
  ])("storageLevel følger grensen på 500 MB ledig: %s", (_name, usage, quota, expected) => {
    expect(storageLevel({ usage, quota })).toBe(expected);
  });

  it.each<[string, { usage?: number; quota?: number }]>([
    ["usage mangler", { quota: 2 * GB }],
    ["quota mangler", { usage: 100 * MB }],
    ["begge mangler", {}],
    ["quota 0", { usage: 0, quota: 0 }],
  ])("storageLevel uten tall gir unknown: %s", (_name, estimate) => {
    expect(storageLevel(estimate)).toBe("unknown");
  });
});

describe("readStorageHealth (storage-health.ts)", () => {
  it("readStorageHealth med fullt API", async () => {
    stubStorage({
      estimate: async () => ({ usage: 100 * MB, quota: 2148 * MB }),
      persisted: async () => true,
      persist: async () => true,
    });
    const yes = await readStorageHealth();
    expect(yes).toMatchObject({ usage: 100 * MB, quota: 2148 * MB, persisted: "yes", level: "ok" });

    stubStorage({
      estimate: async () => ({ usage: 1948 * MB, quota: 2048 * MB }),
      persisted: async () => false,
      persist: async () => false,
    });
    const no = await readStorageHealth();
    expect(no).toMatchObject({ usage: 1948 * MB, quota: 2048 * MB, persisted: "no", level: "low" });
  });

  it("readStorageHealth uten persisted()", async () => {
    stubStorage({ estimate: async () => ({ usage: 100 * MB, quota: 2148 * MB }) });
    const health = await readStorageHealth();
    expect(health).toMatchObject({ persisted: "unsupported", level: "ok" });
  });

  // Obligatorisk
  it("readStorageHealth uten navigator.storage", async () => {
    stubStorage(undefined);
    await expect(readStorageHealth()).resolves.toMatchObject({
      persisted: "unsupported",
      level: "unknown",
    });
  });

  // Obligatorisk
  it("readStorageHealth når estimate() kaster eller avviser", async () => {
    stubStorage({
      estimate: () => {
        throw new Error("synkron feil");
      },
      persisted: async () => false,
    });
    await expect(readStorageHealth()).resolves.toMatchObject({ level: "unknown" });

    stubStorage({
      estimate: () => Promise.reject(new Error("avvist")),
      persisted: async () => false,
    });
    await expect(readStorageHealth()).resolves.toMatchObject({ level: "unknown" });
  });

  it("readStorageHealth når persisted() avviser", async () => {
    stubStorage({
      estimate: async () => ({ usage: 100 * MB, quota: 2148 * MB }),
      persisted: () => Promise.reject(new Error("avvist")),
    });
    await expect(readStorageHealth()).resolves.toMatchObject({ persisted: "unsupported" });
  });
});

describe("storageHealthText (storage-health.ts)", () => {
  it("storageHealthText viser MB avrundet og varig lagring", async () => {
    stubStorage({
      estimate: async () => ({ usage: 123.4 * MB, quota: 2048 * MB }),
      persisted: async () => true,
    });
    const yes = storageHealthText(await readStorageHealth());
    expect(yes).toContain("123");
    expect(yes).toContain("2048");
    expect(yes).not.toContain("123.4");
    expect(yes).not.toContain("123,4");
    expect(yes).toContain("Varig lagring: ja");

    stubStorage({
      estimate: async () => ({ usage: 123.4 * MB, quota: 2048 * MB }),
      persisted: async () => false,
    });
    expect(storageHealthText(await readStorageHealth())).toContain("Varig lagring: nei");
  });

  it("storageHealthText uten API gir ikke støttet", async () => {
    stubStorage(undefined);
    const text = storageHealthText(await readStorageHealth());
    expect(text).toContain("Varig lagring: ikke støttet");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });
});

describe("requestPersistentStorage (storage-health.ts)", () => {
  it("requestPersistentStorage kaller persist() når persisted() er false", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    expect(await requestPersistentStorage()).toBe("yes");
    expect(persist).toHaveBeenCalledTimes(1);

    resetPersistRequestForTests();
    const refused = vi.fn(async () => false);
    stubStorage({ persisted: async () => false, persist: refused });
    expect(await requestPersistentStorage()).toBe("no");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("requestPersistentStorage kaller ikke persist() når persisted() er true", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });
    expect(await requestPersistentStorage()).toBe("yes");
    expect(persist).toHaveBeenCalledTimes(0);
  });

  // Obligatorisk («én gang per sideinnlasting», også når React kjører effekter to ganger)
  it("requestPersistentStorage gir ett persist() ved to kall i samme innlasting", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    const [first, second] = await Promise.all([
      requestPersistentStorage(),
      requestPersistentStorage(),
    ]);
    const third = await requestPersistentStorage();
    const fourth = await requestPersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fourth).toBe(first);
  });

  it("resetPersistRequestForTests nullstiller vakten", async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persisted: async () => false, persist });
    await requestPersistentStorage();
    resetPersistRequestForTests();
    await requestPersistentStorage();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("requestPersistentStorage uten API gir unsupported", async () => {
    stubStorage(undefined);
    await expect(requestPersistentStorage()).resolves.toBe("unsupported");

    resetPersistRequestForTests();
    stubStorage({ persisted: async () => false });
    await expect(requestPersistentStorage()).resolves.toBe("unsupported");
  });

  it("requestPersistentStorage når persist() avviser", async () => {
    stubStorage({
      persisted: async () => false,
      persist: () => Promise.reject(new Error("persist() avviser")),
    });
    await expect(requestPersistentStorage()).resolves.toBe("no");
  });
});

describe("isQuotaError (storage-health.ts)", () => {
  it.each<[string, unknown]>([
    ["DOMException QuotaExceededError", new DOMException("x", "QuotaExceededError")],
    ["NS_ERROR_DOM_QUOTA_REACHED", { name: "NS_ERROR_DOM_QUOTA_REACHED" }],
  ])("isQuotaError gjenkjenner full plass: %s", (_name, error) => {
    expect(isQuotaError(error)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["Error", new Error("x")],
    ["DOMException NotFoundError", new DOMException("x", "NotFoundError")],
    ["null", null],
    ["undefined", undefined],
    ["tekst", "QuotaExceededError"],
    ["tomt objekt", {}],
  ])("isQuotaError avviser andre feil: %s", (_name, error) => {
    expect(isQuotaError(error)).toBe(false);
  });
});

describe("storageErrorMessage (storage-health.ts)", () => {
  it("storageErrorMessage ett svar", () => {
    expect(storageErrorMessage([answerFailure("Generell beskrivelse")])).toBe(
      "Svaret i «Generell beskrivelse» ble ikke lagret på iPaden. Lukk ikke appen. Trykk «Prøv igjen».",
    );
  });

  it("storageErrorMessage flere svar", () => {
    const text = storageErrorMessage([
      answerFailure("Generell beskrivelse"),
      answerFailure("Tak – beskrivelse"),
      answerFailure("Generell beskrivelse"),
      answerFailure("Samlet kommentar"),
    ]);
    expect(text).toBe(
      "3 svar ble ikke lagret på iPaden, sist «Samlet kommentar». Lukk ikke appen. Trykk «Prøv igjen».",
    );
  });

  it("storageErrorMessage bilde", () => {
    const text = storageErrorMessage([photoFailure("Forsidebilde")]);
    expect(text).toBe("Bildet i «Forsidebilde» ble ikke lagret på iPaden. Ta bildet på nytt.");
    expect(text).not.toContain("Prøv igjen");
  });

  it("storageErrorMessage svar og bilde blandet", () => {
    const text = storageErrorMessage([
      answerFailure("Generell beskrivelse"),
      photoFailure("Forsidebilde"),
    ]);
    expect(text).toContain("«Generell beskrivelse»");
    expect(text).toContain("«Forsidebilde»");
    expect(text.toLowerCase()).toContain("svar");
    expect(text.toLowerCase()).toContain("bilde");
  });

  // Obligatorisk
  it("storageErrorMessage sier at plassen er brukt opp bare ved full plass", () => {
    const withQuota = [
      storageErrorMessage([answerFailure("Generell beskrivelse", quotaError())]),
      storageErrorMessage([photoFailure("Forsidebilde", quotaError())]),
      storageErrorMessage([
        answerFailure("Generell beskrivelse", new Error("x")),
        answerFailure("Samlet kommentar", quotaError()),
      ]),
    ];
    for (const text of withQuota) expect(text.endsWith(FULL), text).toBe(true);

    const without = [
      storageErrorMessage([answerFailure("Generell beskrivelse", new Error("x"))]),
      storageErrorMessage([photoFailure("Forsidebilde", new Error("x"))]),
      storageErrorMessage([
        answerFailure("Generell beskrivelse", new Error("x")),
        photoFailure("Forsidebilde", new TypeError("y")),
      ]),
    ];
    for (const text of without) expect(text, text).not.toContain(FULL);
  });

  // Obligatorisk
  it("storageErrorMessage har aldri verdien", () => {
    const answerError = Object.assign(quotaError(SECRET_ANSWER), { value: SECRET_ANSWER });
    const photoError = Object.assign(new Error(SECRET_PHOTO), {
      file: { name: SECRET_PHOTO },
      name: "QuotaExceededError",
    });
    const texts = [
      storageErrorMessage([answerFailure("Generell beskrivelse", answerError)]),
      storageErrorMessage([photoFailure("Forsidebilde", photoError)]),
      storageErrorMessage([
        answerFailure("Generell beskrivelse", answerError),
        answerFailure("Samlet kommentar", answerError),
        photoFailure("Forsidebilde", photoError),
      ]),
    ];
    for (const text of texts) {
      expect(text).not.toContain(SECRET_ANSWER);
      expect(text).not.toContain(SECRET_PHOTO);
    }
  });
});

describe("storageErrorLog (storage-health.ts)", () => {
  // Obligatorisk
  it("storageErrorLog gir bare navnet", () => {
    expect(storageErrorLog(new DOMException("x", "QuotaExceededError"))).toStrictEqual({
      name: "QuotaExceededError",
    });
  });

  // Obligatorisk
  it("storageErrorLog tar ikke med svarverdien fra meldingen", () => {
    const error = Object.assign(new Error(SECRET_ANSWER), {
      value: SECRET_ANSWER,
      file: { name: SECRET_PHOTO, content: SECRET_ANSWER },
      blob: SECRET_ANSWER,
      cause: { value: SECRET_ANSWER },
    });
    const result = storageErrorLog(error);
    expect(result).toStrictEqual({ name: "Error" });
    expect(JSON.stringify(result)).not.toContain(SECRET_ANSWER);
    expect(JSON.stringify(result)).not.toContain(SECRET_PHOTO);
  });

  it.each<[string, unknown]>([
    ["tekst", SECRET_ANSWER],
    ["null", null],
    ["objekt med verdi", { value: SECRET_ANSWER }],
  ])("storageErrorLog for noe som ikke er Error: %s", (_name, error) => {
    const result = storageErrorLog(error);
    expect(result).toStrictEqual({ name: "ukjent feil" });
    expect(JSON.stringify(result)).not.toContain(SECRET_ANSWER);
  });
});

describe("tekstene (storage-health.ts)", () => {
  it("ingen gjetteord i tekstene", () => {
    const texts = [LOW_STORAGE_WARNING_TEXT];
    for (const persisted of ["yes", "no"] as const) {
      texts.push(
        storageHealthText({ usage: 1948 * MB, quota: 2048 * MB, level: "low", persisted }),
      );
    }
    texts.push(storageHealthText({ level: "unknown", persisted: "unsupported" }));
    for (const error of [new Error("x"), quotaError()]) {
      texts.push(
        storageErrorMessage([answerFailure("Generell beskrivelse", error)]),
        storageErrorMessage([answerFailure("A", error), answerFailure("B", error)]),
        storageErrorMessage([photoFailure("Forsidebilde", error)]),
        storageErrorMessage([answerFailure("A", error), photoFailure("Forsidebilde", error)]),
      );
    }
    expect(texts).toHaveLength(12);
    for (const text of texts) {
      for (const word of ["antas", "trolig", "sannsynligvis", "frigjør", "rydd"]) {
        expect(text.toLowerCase(), text).not.toContain(word);
      }
    }
  });
});
