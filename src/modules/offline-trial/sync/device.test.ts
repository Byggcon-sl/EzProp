import { describe, expect, it } from "vitest";
import { isUuid } from "@/shared/lib/uuid";
import { getTrialDeviceId } from "./device";

// Fast id per nettleser-installasjon, bare for varselet i prøve B
// (docs/funksjoner/fase1-kandidat-powersync.md pkt. 6). Testplan avsnitt 2.6.

/** Falsk `Storage` bygget på en Map (Vitest har ingen DOM). */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

describe("getTrialDeviceId", () => {
  it("getTrialDeviceId lager en uuid og gir den samme neste gang", () => {
    const storage = fakeStorage();
    const first = getTrialDeviceId(storage);
    expect(isUuid(first)).toBe(true);
    expect(getTrialDeviceId(storage)).toBe(first);
    expect(storage.getItem("trial_device_id")).toBe(first);
    expect(storage.length).toBe(1);

    // En annen installasjon får en annen id
    expect(getTrialDeviceId(fakeStorage())).not.toBe(first);
  });

  it("getTrialDeviceId respekterer en id som allerede ligger lagret", () => {
    const stored = "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
    const storage = fakeStorage({ trial_device_id: stored });
    expect(getTrialDeviceId(storage)).toBe(stored);
    expect(storage.getItem("trial_device_id")).toBe(stored);
  });
});
