import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/shared/lib/logger";
import { logRejectedOperationsCall } from "./index";

/* Rydding av innloggingsdata (ADR 0014), testplan E9: avvist kall logges bare med ruten. */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRejectedOperationsCall", () => {
  it("logger én advarsel med bare ruten", () => {
    const warn = vi.spyOn(logger, "warn");
    logRejectedOperationsCall("/api/intern/rydd-innloggingsdata");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Avvist kall til driftsendepunkt", {
      route: "/api/intern/rydd-innloggingsdata",
    });
  });
});
