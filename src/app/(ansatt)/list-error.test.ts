import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { logger } from "@/shared/lib/logger";
import { loadListOrError } from "./list-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadListOrError", () => {
  it.each(["/ordre", "/arbeidskoe"])(
    "listesiden logger ikke søketeksten ved databasefeil (%s)",
    async (route) => {
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const result = await loadListOrError(route, "user-1", async () => {
        throw new Error("select ... ilike %Storgata Hansen%");
      });

      expect(result).toEqual({ ok: false, message: "Kunne ikke hente listen. Prøv igjen." });
      expect(spy).toHaveBeenCalledTimes(1);
      const fields = spy.mock.calls[0]?.[1] ?? {};
      expect(Object.keys(fields).sort()).toEqual(["errorName", "route", "userId"]);
      expect(fields).toEqual({ route, userId: "user-1", errorName: "Error" });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("Storgata");
      expect(logged).not.toContain("Hansen");
    },
  );

  it("AccessDeniedError fanges ikke som databasefeil", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const denied = new AccessDeniedError();
    await expect(
      loadListOrError("/ordre", "user-1", async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
    expect(spy).not.toHaveBeenCalled();
  });

  it("gir verdien når listen hentes", async () => {
    await expect(loadListOrError("/ordre", "user-1", async () => [1, 2])).resolves.toEqual({
      ok: true,
      value: [1, 2],
    });
  });
});
