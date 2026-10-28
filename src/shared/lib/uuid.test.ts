import { describe, expect, it } from "vitest";
import { isUuid, uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("lager gyldige id-er med versjon 7 som sorterer etter tid", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(a[19]);
    expect(a < b).toBe(true);
    expect(uuidv7()).not.toBe(uuidv7());
  });

  it("avviser id-er med feil format", () => {
    expect(isUuid("123")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });
});
