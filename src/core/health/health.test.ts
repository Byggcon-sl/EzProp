import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json";
import { appVersion, checkHealth } from "./index";

describe("helsesjekk", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("svarer ok med versjonen fra package.json når databasen svarer", async () => {
    const result = await checkHealth();
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ status: "ok", versjon: packageJson.version, database: "ok" });
    expect(appVersion()).toBe(packageJson.version);
  });

  it("svarer 503 når databasen feiler", async () => {
    const result = await checkHealth(() => Promise.reject(new Error("nede")));
    expect(result.httpStatus).toBe(503);
    expect(result.body.database).toBe("feil");
  });

  it("viser commit etter versjonen når APP_VERSION er satt", () => {
    vi.stubEnv("APP_VERSION", "abc1234");
    expect(appVersion()).toBe(`${packageJson.version} (abc1234)`);
  });

  it("ignorerer tom APP_VERSION", () => {
    vi.stubEnv("APP_VERSION", "  ");
    expect(appVersion()).toBe(packageJson.version);
  });
});
