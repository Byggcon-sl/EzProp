import { describe, expect, it } from "vitest";
import { appVersion } from "@/core/health";
import { GET } from "./route";

describe("GET /api/helse", () => {
  it("svarer 200 med status, versjon og database ok, uten innlogging og uten hurtiglager", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      versjon: appVersion(),
      database: "ok",
    });
  });
});
