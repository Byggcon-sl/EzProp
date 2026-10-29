import { afterEach, describe, expect, it, vi } from "vitest";
import { photoUploadTimeoutMs, sendPhoto } from "./photo-uploader";
import type { TrialPhotoRow } from "./types";

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

    const result = sendPhoto(ORGANIZATION_ID, PHOTO, blob);
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

    await expect(sendPhoto(ORGANIZATION_ID, PHOTO, blob)).resolves.toEqual({
      status: 200,
      body: { sha256 },
    });
  });
});
