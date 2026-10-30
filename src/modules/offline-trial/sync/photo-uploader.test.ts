import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/shared/lib/uuid";
import { makeDisplayCopy } from "./display-copy";
import {
  confirmLocalPhoto,
  deleteLocalPhoto,
  listConfirmedPhotoIds,
  listLocalDisplayCopyIds,
  markDisplayCopyFailed,
  putLocalPhoto,
} from "./photo-store";
import {
  originalUrl,
  photoUploadTimeoutMs,
  sendPhoto,
  uploadPendingPhotos,
} from "./photo-uploader";
import type { TrialPhotoRow, TrialSyncStore } from "./types";

// Lageret for bildefiler i minnet (Vitest har ingen IndexedDB, og vi legger ikke til en
// avhengighet for det). Brukes bare av testene for visningskopien nederst; testene for
// `sendPhoto` og `photoUploadTimeoutMs` rører det ikke.
const photoState = vi.hoisted(() => ({
  photos: new Map<string, Blob>(),
  confirmed: new Set<string>(),
  /** Merknadene om endelig feilet kopi: bilde-id til fast kode. */
  failed: new Map<string, string>(),
  calls: [] as string[],
  lastCopySource: undefined as Blob | undefined,
}));

vi.mock("./photo-store", () => ({
  TRIAL_PHOTO_DB_NAME: "offline-trial-photos",
  displayCopyKey: (photoId: string) => `${photoId}:display`,
  getLocalPhoto: vi.fn(async (key: string) => photoState.photos.get(key)),
  putLocalPhoto: vi.fn(async (key: string, blob: Blob) => {
    photoState.calls.push(`put:${key}`);
    photoState.photos.set(key, blob);
  }),
  deleteLocalPhoto: vi.fn(async (key: string) => {
    photoState.calls.push(`delete:${key}`);
    photoState.photos.delete(key);
  }),
  listLocalDisplayCopyIds: vi.fn(async () =>
    [...photoState.photos.keys()]
      .filter((key) => key.endsWith(":display"))
      .map((key) => key.slice(0, -":display".length)),
  ),
  confirmLocalPhoto: vi.fn(async (id: string) => {
    photoState.calls.push(`confirm:${id}`);
    photoState.photos.delete(id);
    photoState.confirmed.add(id);
  }),
  listConfirmedPhotoIds: vi.fn(async () => new Set(photoState.confirmed)),
  markDisplayCopyFailed: vi.fn(async (id: string, reason: string) => {
    photoState.calls.push(`failed:${id}`);
    photoState.photos.delete(`${id}:display`);
    photoState.failed.set(id, reason);
  }),
  hasDisplayCopyFailed: vi.fn(async (id: string) => photoState.failed.has(id)),
  listDisplayFailedPhotoIds: vi.fn(async () => new Set(photoState.failed.keys())),
  onDisplayFailedChange: vi.fn(() => () => {}),
  clearLocalPhotos: vi.fn(async () => {
    photoState.photos.clear();
    photoState.confirmed.clear();
    photoState.failed.clear();
  }),
}));

vi.mock("./display-copy", () => ({
  DISPLAY_MAX_EDGE_PX: 2000,
  DISPLAY_JPEG_QUALITY: 0.8,
  displaySize: vi.fn(),
  makeDisplayCopy: vi.fn(async () => null),
}));

// Bildekøen skal aldri stå fast for godt: en opplasting som aldri svarer, avbrytes etter en
// tidsgrense, filen blir liggende lokalt og prøves igjen på neste runde (oppgavekortet pkt. 22).

const PHOTO: TrialPhotoRow = {
  id: "01a18792-c5a6-7029-8e96-598c9d361b10",
  trialFormId: "01a18792-c208-731f-9948-75ec90baf064",
  fieldKey: "cover_photo",
  name: "testbilde.png",
  sizeBytes: 3,
  sha256: null,
  uploadedAt: null,
  deviceId: null,
  createdAt: "2026-10-29T10:00:00.000Z",
  updatedAt: "2026-10-29T10:00:00.000Z",
  deletedAt: null,
};
const ORGANIZATION_ID = "2adb0101-5420-4c16-bf95-076fbf8b8ea2";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("photoUploadTimeoutMs", () => {
  it("gir minst 30 sekunder, også for ugyldig størrelse", () => {
    expect(photoUploadTimeoutMs(0)).toBe(30_000);
    expect(photoUploadTimeoutMs(Number.NaN)).toBe(30_000);
    expect(photoUploadTimeoutMs(-5)).toBe(30_000);
  });

  it("gir mer tid til store filer", () => {
    expect(photoUploadTimeoutMs(25_000_000)).toBe(30_000 + 1_000_000);
  });
});

describe("sendPhoto", () => {
  it("avbryter en opplasting som aldri svarer, og gir undefined (filen blir liggende)", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("avbrutt")));
        });
      }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const result = sendPhoto(originalUrl(ORGANIZATION_ID, PHOTO, blob), blob, "image/png");
    await vi.advanceTimersByTimeAsync(photoUploadTimeoutMs(blob.size) - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(signal?.aborted).toBe(true);
    await expect(result).resolves.toBeUndefined();
  });

  it("gir status og fingeravtrykk når serveren svarer", async () => {
    const sha256 = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ sha256 }), { status: 200 })),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    await expect(
      sendPhoto(originalUrl(ORGANIZATION_ID, PHOTO, blob), blob, "image/png"),
    ).resolves.toEqual({
      status: 200,
      body: { sha256 },
    });
  });

  // U7
  it("sendPhoto sender til adressen den får", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sha256: "b".repeat(64) }));
    vi.stubGlobal("fetch", fetchMock);
    const url = "/api/prove/bilder/oppdiktet-id/oppdiktet?a=1";
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    await sendPhoto(url, blob, "image/webp");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("content-type")).toBe("image/webp");
    expect(init.body).toBe(blob);
  });
});

// --- Prøve D – bilder: visningskopien i bildekøen (docs/funksjoner/fase1-prove-d-bilder.md
// pkt. 2, AK 7). Testplan avsnitt 2.3. `photo-store` er lageret i minnet øverst, og
// `display-copy` styres av testen. Fingeravtrykket i svaret regnes med `crypto.subtle` fra de
// samme bytene som ble sendt, så «likt» er ekte. Alle data er oppdiktet.

const DISPLAY_SUFFIX = ":display";

/** JPEG-bytene til den oppdiktede visningskopien (`FF D8`, `APP0`, `FF DA`, noen bytes, `FF D9`). */
const COPY_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
]);

function originalBlob(seed: number): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2])], {
    type: "image/png",
  });
}

function copyBlob(): Blob {
  return new Blob([COPY_BYTES], { type: "image/jpeg" });
}

function row(id: string, minute = 0): TrialPhotoRow {
  const at = `2026-10-30T10:0${minute}:00.000Z`;
  return { ...PHOTO, id, createdAt: at, updatedAt: at };
}

type Reply = 200 | "other-sha" | 400 | 401 | 403 | 404 | 500 | "reject" | "hang";
type Kind = "original" | "display";

interface SentRequest {
  kind: Kind;
  id: string;
  url: URL;
  init: RequestInit;
}

async function hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const queue = {
  rows: [] as TrialPhotoRow[],
  replies: { original: [] as Reply[], display: [] as Reply[] },
  sent: [] as SentRequest[],
};

/**
 * Fetch som svarer per adresse (original eller `/visning`) med køen av svar. Standard er 200 med
 * fingeravtrykket av bytene som ble sendt.
 */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const match = /^\/api\/prove\/bilder\/([^/]+)(\/visning)?$/.exec(url.pathname);
      if (!match) throw new Error(`Uventet adresse ${url.pathname}`);
      const kind: Kind = match[2] ? "display" : "original";
      const id = decodeURIComponent(match[1]!);
      photoState.calls.push(`fetch:${kind}:${id}`);
      queue.sent.push({ kind, id, url, init });
      const reply = queue.replies[kind].shift() ?? 200;
      if (reply === "reject") throw new TypeError("Failed to fetch");
      if (reply === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("avbrutt", "AbortError")),
          );
        });
      }
      const body = init.body;
      const sha = body instanceof Blob ? await hex(body) : "0".repeat(64);
      if (reply === 200) return Response.json({ sha256: sha });
      if (reply === "other-sha") {
        return Response.json({ sha256: sha === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64) });
      }
      return Response.json({ feil: "Oppdiktet feil, hemmelig-svar." }, { status: reply });
    }),
  );
}

/** Et falskt `TrialSyncStore` med bare det bildekøen bruker. */
function fakeStore() {
  return {
    listPendingPhotos: vi.fn(async () =>
      queue.rows.filter((entry) => !photoState.confirmed.has(entry.id)),
    ),
    markPhotoUploaded: vi.fn(async (id: string, sha256: string) => {
      await confirmLocalPhoto(id, sha256);
    }),
    onStatusChange: vi.fn(() => () => {}),
  };
}

function asStore(store: ReturnType<typeof fakeStore>): TrialSyncStore {
  return store as unknown as TrialSyncStore;
}

function sentFor(kind: Kind, id: string): SentRequest[] {
  return queue.sent.filter((entry) => entry.kind === kind && entry.id === id);
}

/**
 * Venter til betingelsen holder, med `setImmediate` (ikke falsk), så fetch er sendt før klokken
 * flyttes (fingeravtrykket regnes med ekte asynkron `crypto.subtle`).
 */
async function until(condition: () => boolean) {
  for (let i = 0; i < 1000 && !condition(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error("Betingelsen ble aldri sann");
}

function displayKey(id: string): string {
  return `${id}${DISPLAY_SUFFIX}`;
}

describe("bildekøen med visningskopi", () => {
  beforeEach(() => {
    photoState.photos.clear();
    photoState.confirmed.clear();
    photoState.failed.clear();
    photoState.calls.length = 0;
    photoState.lastCopySource = undefined;
    queue.rows = [];
    queue.replies = { original: [], display: [] };
    queue.sent = [];
    vi.mocked(makeDisplayCopy).mockReset();
    vi.mocked(makeDisplayCopy).mockImplementation(async (original: Blob) => {
      photoState.calls.push("makeDisplayCopy");
      photoState.lastCopySource = original;
      return copyBlob();
    });
    vi.mocked(listLocalDisplayCopyIds).mockClear();
    vi.mocked(deleteLocalPhoto).mockClear();
    vi.mocked(putLocalPhoto).mockClear();
    vi.mocked(confirmLocalPhoto).mockClear();
    vi.mocked(markDisplayCopyFailed).mockClear();
    vi.stubGlobal("navigator", { onLine: true });
    stubFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Obligatorisk
  it("kopien lages fra originalen før originalen sendes, og originalen sendes før kopien", async () => {
    const id = uuidv7();
    const original = originalBlob(1);
    photoState.photos.set(id, original);
    queue.rows = [row(id)];

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(makeDisplayCopy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(makeDisplayCopy).mock.calls[0]![0]).toBe(original);
    const watched = [
      "makeDisplayCopy",
      `put:${displayKey(id)}`,
      `fetch:original:${id}`,
      `fetch:display:${id}`,
    ];
    expect(photoState.calls.filter((call) => watched.includes(call))).toEqual(watched);
    const [originalPut] = sentFor("original", id);
    expect(originalPut!.url.searchParams.get("organisasjon")).toBe(ORGANIZATION_ID);
    const [displayPut] = sentFor("display", id);
    expect(displayPut!.url.pathname).toBe(`/api/prove/bilder/${id}/visning`);
    expect(displayPut!.url.searchParams.get("organisasjon")).toBe(ORGANIZATION_ID);
  });

  // Obligatorisk
  it("kopien slettes lokalt bare ved likt fingeravtrykk", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(2));
    queue.rows = [row(id)];

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(deleteLocalPhoto).toHaveBeenCalledWith(displayKey(id));
    expect(photoState.photos.has(displayKey(id))).toBe(false);
    expect(photoState.photos.has(id)).toBe(false);
    expect(photoState.confirmed.has(id)).toBe(true);
    expect(photoState.confirmed.has(displayKey(id))).toBe(false);
  });

  // Obligatorisk
  // U4
  it.each([["other-sha"], [500], ["reject"], ["hang"], [401], [403]] as const)(
    "ulikt fingeravtrykk, 500, nettfeil, tidsavbrudd, 401 og 403 gir nytt forsøk neste runde og ingen merknad (%s)",
    async (reply) => {
      const id = uuidv7();
      photoState.photos.set(id, originalBlob(3));
      queue.rows = [row(id)];
      queue.replies.display = [reply];
      const store = asStore(fakeStore());

      if (reply === "hang") {
        // `sendPhoto` gir undefined etter tidsavbruddet, som for originalen
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const round = uploadPendingPhotos(store, ORGANIZATION_ID);
        await until(() => sentFor("display", id).length === 1);
        await vi.advanceTimersByTimeAsync(photoUploadTimeoutMs(COPY_BYTES.byteLength) + 1);
        await round;
        vi.useRealTimers();
      } else {
        await uploadPendingPhotos(store, ORGANIZATION_ID);
      }

      // Runde 1: originalen er bekreftet, kopien ligger fortsatt
      expect(photoState.confirmed.has(id)).toBe(true);
      expect(photoState.photos.has(displayKey(id))).toBe(true);
      expect(deleteLocalPhoto).not.toHaveBeenCalledWith(displayKey(id));
      expect(sentFor("original", id)).toHaveLength(1);
      expect(sentFor("display", id)).toHaveLength(1);
      expect(photoState.failed.size).toBe(0);
      expect(markDisplayCopyFailed).not.toHaveBeenCalled();

      // Runde 2: originalen er bekreftet og sendes ikke; bare kopien sendes igjen
      await uploadPendingPhotos(store, ORGANIZATION_ID);
      expect(sentFor("display", id)).toHaveLength(2);
      expect(sentFor("original", id)).toHaveLength(1);
      expect(photoState.photos.has(displayKey(id))).toBe(false);
    },
  );

  // Obligatorisk (AK 7), U1
  it("kopi som får 400 lages og sendes én gang over tre runder, og får merknad", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(4));
    queue.rows = [row(id)];
    queue.replies.display = [400];
    const store = asStore(fakeStore());
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await uploadPendingPhotos(store, ORGANIZATION_ID);
    await uploadPendingPhotos(store, ORGANIZATION_ID);
    await uploadPendingPhotos(store, ORGANIZATION_ID);

    expect(makeDisplayCopy).toHaveBeenCalledTimes(1);
    expect(sentFor("display", id)).toHaveLength(1);
    expect(markDisplayCopyFailed).toHaveBeenCalledWith(id, "400");
    expect(photoState.failed.get(id)).toBe("400");
    expect(photoState.photos.has(displayKey(id))).toBe(false);
    // Originalen er bekreftet og påvirkes ikke
    expect(photoState.confirmed.has(id)).toBe(true);
    expect(sentFor("original", id)).toHaveLength(1);
  });

  // U3
  it("kopi som får 404 får merknad og sendes ikke i runde 2 og 3", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(11));
    queue.rows = [row(id)];
    queue.replies.display = [404];
    const store = asStore(fakeStore());
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await uploadPendingPhotos(store, ORGANIZATION_ID);
    expect(markDisplayCopyFailed).toHaveBeenCalledWith(id, "404");
    expect(photoState.failed.get(id)).toBe("404");
    expect(photoState.photos.has(displayKey(id))).toBe(false);

    await uploadPendingPhotos(store, ORGANIZATION_ID);
    await uploadPendingPhotos(store, ORGANIZATION_ID);
    expect(sentFor("display", id)).toHaveLength(1);
    expect(makeDisplayCopy).toHaveBeenCalledTimes(1);
    expect(photoState.confirmed.has(id)).toBe(true);
  });

  // U2
  it("kopien sendes ikke før originalen er bekreftet", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(12));
    queue.rows = [row(id)];
    queue.replies.original = ["reject"];
    const store = asStore(fakeStore());

    // Runde 1: originalen får nettfeil
    await uploadPendingPhotos(store, ORGANIZATION_ID);
    expect(photoState.confirmed.has(id)).toBe(false);
    expect(sentFor("display", id)).toHaveLength(0);
    expect(photoState.failed.size).toBe(0);
    expect(markDisplayCopyFailed).not.toHaveBeenCalled();
    expect(photoState.photos.has(displayKey(id))).toBe(true);

    // Runde 2: originalen får 200 med likt fingeravtrykk; kopien sendes etter den
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await uploadPendingPhotos(store, ORGANIZATION_ID);
    expect(photoState.confirmed.has(id)).toBe(true);
    expect(sentFor("display", id)).toHaveLength(1);
    const urls = fetchMock.mock.calls.slice(before).map((call) => String(call[0]));
    const order = fetchMock.mock.invocationCallOrder.slice(before);
    const originalAt = urls.findIndex((url) => !url.includes("/visning"));
    const displayAt = urls.findIndex((url) => url.includes("/visning"));
    expect(originalAt).toBeGreaterThanOrEqual(0);
    expect(displayAt).toBeGreaterThanOrEqual(0);
    expect(order[originalAt]!).toBeLessThan(order[displayAt]!);
    expect(photoState.photos.has(displayKey(id))).toBe(false);
  });

  // U5
  it("merknaden påvirker aldri originalen", async () => {
    const a = uuidv7();
    const b = uuidv7();
    photoState.confirmed.add(a);
    photoState.failed.set(a, "400");
    photoState.photos.set(b, originalBlob(13));
    queue.rows = [row(a, 0), row(b, 1)];

    const released = await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(released).toBe(1);
    expect(photoState.confirmed.has(a)).toBe(true);
    expect(photoState.confirmed.has(b)).toBe(true);
    expect(sentFor("original", a)).toHaveLength(0);
    expect(sentFor("display", a)).toHaveLength(0);
    expect(sentFor("original", b)).toHaveLength(1);
    expect(sentFor("display", b)).toHaveLength(1);
    expect(photoState.failed.get(a)).toBe("400");
    expect(photoState.failed.has(b)).toBe(false);
  });

  // U6
  it.each([[400], [404]] as const)("loggen ved %s har bare fast tekst", async (reply) => {
    const id = uuidv7();
    const photo = { ...row(id), name: "kjokken-oppdiktet.jpg" };
    photoState.photos.set(id, originalBlob(14));
    queue.rows = [photo];
    queue.replies.display = [reply];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(photoState.failed.get(id)).toBe(String(reply));
    expect(warn).toHaveBeenCalled();
    for (const args of warn.mock.calls) {
      for (const arg of args) {
        expect(typeof arg).toBe("string");
        const text = String(arg);
        expect(text).not.toContain(id);
        expect(text).not.toContain(photo.name);
        expect(text).not.toContain(ORGANIZATION_ID);
        expect(text).not.toContain("hemmelig-svar");
      }
    }
  });

  // U11
  it("ensureDisplayCopy lager ikke kopien når merknaden finnes", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(15));
    photoState.failed.set(id, "404");
    queue.rows = [row(id)];

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(makeDisplayCopy).not.toHaveBeenCalled();
    expect(photoState.photos.has(displayKey(id))).toBe(false);
    expect(sentFor("display", id)).toHaveLength(0);
    // Originalen sendes og bekreftes som før
    expect(sentFor("original", id)).toHaveLength(1);
    expect(photoState.confirmed.has(id)).toBe(true);
  });

  // Obligatorisk
  it("makeDisplayCopy som gir null stopper ikke originalen eller neste bilde", async () => {
    const first = uuidv7();
    const second = uuidv7();
    const firstBlob = originalBlob(5);
    photoState.photos.set(first, firstBlob);
    photoState.photos.set(second, originalBlob(6));
    queue.rows = [row(first, 0), row(second, 1)];
    vi.mocked(makeDisplayCopy).mockImplementation(async (original: Blob) =>
      original === firstBlob ? null : copyBlob(),
    );

    const released = await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(released).toBe(2);
    expect(photoState.confirmed.has(first)).toBe(true);
    expect(photoState.confirmed.has(second)).toBe(true);
    expect(sentFor("original", first)).toHaveLength(1);
    expect(sentFor("original", second)).toHaveLength(1);
    expect(sentFor("display", first)).toHaveLength(0);
    expect(sentFor("display", second)).toHaveLength(1);
    expect(photoState.photos.has(displayKey(first))).toBe(false);
    expect(putLocalPhoto).not.toHaveBeenCalledWith(displayKey(first), expect.anything());
  });

  it("makeDisplayCopy som kaster stopper ikke originalen eller neste bilde", async () => {
    const first = uuidv7();
    const second = uuidv7();
    const firstBlob = originalBlob(7);
    photoState.photos.set(first, firstBlob);
    photoState.photos.set(second, originalBlob(8));
    queue.rows = [row(first, 0), row(second, 1)];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(makeDisplayCopy).mockImplementation(async (original: Blob) => {
      if (original === firstBlob) throw new Error("x");
      return copyBlob();
    });

    await expect(uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID)).resolves.toBe(2);

    expect(photoState.confirmed.has(first)).toBe(true);
    expect(photoState.confirmed.has(second)).toBe(true);
    expect(sentFor("display", first)).toHaveLength(0);
    expect(sentFor("display", second)).toHaveLength(1);
    expect(photoState.photos.has(displayKey(first))).toBe(false);
  });

  it("kopien lages ikke på nytt når den finnes", async () => {
    const id = uuidv7();
    const existing = copyBlob();
    photoState.photos.set(id, originalBlob(9));
    photoState.photos.set(displayKey(id), existing);
    queue.rows = [row(id)];

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(makeDisplayCopy).toHaveBeenCalledTimes(0);
    const [displayPut] = sentFor("display", id);
    expect(displayPut).toBeDefined();
    expect(await hex(displayPut!.init.body as Blob)).toBe(await hex(existing));
  });

  it("bekreftet original uten kopi gir ingen ny kopi", async () => {
    const id = uuidv7();
    photoState.confirmed.add(id);

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(makeDisplayCopy).toHaveBeenCalledTimes(0);
    expect(queue.sent).toHaveLength(0);
  });

  it("visningskopien er aldri en rad og telles ikke som ventende", async () => {
    const id = uuidv7();
    photoState.photos.set(displayKey(id), copyBlob());
    const store = fakeStore();

    const released = await uploadPendingPhotos(asStore(store), ORGANIZATION_ID);

    expect(released).toBe(0);
    expect(await store.listPendingPhotos()).toEqual([]);
    expect(store.markPhotoUploaded).not.toHaveBeenCalled();
    // Originalen er ikke bekreftet på enheten, så kopien blir liggende
    expect(sentFor("display", id)).toHaveLength(0);
    expect(sentFor("original", id)).toHaveLength(0);
    expect(photoState.photos.has(displayKey(id))).toBe(true);
  });

  it("visningskopien havner aldri i confirmed", async () => {
    const id = uuidv7();
    photoState.photos.set(id, originalBlob(10));
    queue.rows = [row(id)];

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    const confirmed = await listConfirmedPhotoIds();
    expect(confirmed.has(id)).toBe(true);
    expect([...confirmed].filter((key) => key.includes(DISPLAY_SUFFIX))).toEqual([]);
    expect(confirmLocalPhoto).not.toHaveBeenCalledWith(displayKey(id), expect.anything());
  });

  it("kopiene sendes ikke uten nett", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const id = uuidv7();
    photoState.photos.set(displayKey(id), copyBlob());

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(fetch).not.toHaveBeenCalled();
    expect(photoState.photos.has(displayKey(id))).toBe(true);
  });

  it("nøkkel med ugyldig id sendes ikke", async () => {
    photoState.photos.set(displayKey("ikke-en-uuid"), copyBlob());
    vi.mocked(listLocalDisplayCopyIds).mockResolvedValue(["ikke-en-uuid"]);

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(listLocalDisplayCopyIds).mockReset();
    vi.mocked(listLocalDisplayCopyIds).mockImplementation(async () =>
      [...photoState.photos.keys()]
        .filter((key) => key.endsWith(DISPLAY_SUFFIX))
        .map((key) => key.slice(0, -DISPLAY_SUFFIX.length)),
    );
  });

  it("sendPhoto til visningsruten sender JPEG og samme tidsavbrudd", async () => {
    const id = uuidv7();
    photoState.confirmed.add(id);
    photoState.photos.set(displayKey(id), copyBlob());

    await uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);

    const [put] = sentFor("display", id);
    expect(put).toBeDefined();
    expect(put!.url.pathname).toBe(`/api/prove/bilder/${id}/visning`);
    expect([...put!.url.searchParams.keys()]).toEqual(["organisasjon"]);
    expect(put!.url.searchParams.get("organisasjon")).toBe(ORGANIZATION_ID);
    expect(put!.init.method).toBe("PUT");
    expect(put!.init.credentials).toBe("same-origin");
    expect(new Headers(put!.init.headers).get("content-type")).toBe("image/jpeg");

    // Tidsavbruddet: avbrytes etter samme grense som originalen, og kopien blir liggende
    photoState.photos.set(displayKey(id), copyBlob());
    queue.replies.display = ["hang"];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const round = uploadPendingPhotos(asStore(fakeStore()), ORGANIZATION_ID);
    await until(() => sentFor("display", id).length === 2);
    await vi.advanceTimersByTimeAsync(photoUploadTimeoutMs(COPY_BYTES.byteLength) - 1);
    const hanging = sentFor("display", id)[1];
    expect(hanging).toBeDefined();
    expect(hanging!.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hanging!.init.signal?.aborted).toBe(true);
    await expect(round).resolves.toBe(0);
    vi.useRealTimers();
    expect(photoState.photos.has(displayKey(id))).toBe(true);
  });
});
