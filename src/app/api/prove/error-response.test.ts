import { describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  isUnstorableValueError,
  TrialChangeRejectedError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";
import { trialErrorResponse } from "./error-response";

// Funn T-0001: en verdi databasen ikke tar, gir 400 med endringen, ikke 500.
// Testplan docs/agenter/oppgaver/rett-t0001-synkko-testplan.md, test 11-15.

const ROUTE = "/api/prove/synk/endringer";
const USER = "00000000-0000-7000-8000-000000000001";

/** Slik postgres-js lager feilen, og slik Drizzle pakker den inn. */
function dbError(code: string | undefined, wrapped = false) {
  const inner = Object.assign(new Error("verdi «Fukt\u0000 i kjeller» ble avvist"), { code });
  return wrapped ? new Error("Failed query", { cause: inner }) : inner;
}

describe("isUnstorableValueError", () => {
  it.each(["22003", "22P02", "22021", "22P05", "23514"])(
    "%s gir true, også pakket i cause",
    (code) => {
      expect(isUnstorableValueError(dbError(code))).toBe(true);
      expect(isUnstorableValueError(dbError(code, true))).toBe(true);
    },
  );

  it.each(["23505", "08006", "40001", undefined])("%s gir false", (code) => {
    expect(isUnstorableValueError(dbError(code))).toBe(false);
    expect(isUnstorableValueError(dbError(code, true))).toBe(false);
  });

  it("annet enn feil gir false", () => {
    expect(isUnstorableValueError(null)).toBe(false);
    expect(isUnstorableValueError("22003")).toBe(false);
    expect(isUnstorableValueError({ code: 22003 })).toBe(false);
  });
});

describe("trialErrorResponse", () => {
  it.each(["22003", "22P02", "22021", "23514"])("SQLSTATE %s gir 400", async (code) => {
    expect(trialErrorResponse(dbError(code), ROUTE, USER).status).toBe(400);
    expect(trialErrorResponse(dbError(code, true), ROUTE, USER).status).toBe(400);
  });

  it.each(["23505", "08006", "40001", undefined])("andre databasefeil (%s) gir 500", (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(trialErrorResponse(dbError(code, true), ROUTE, USER).status).toBe(500);
    vi.restoreAllMocks();
  });

  it("svaret på 400 har feil og endring, aldri teksten", async () => {
    const error = new TrialChangeRejectedError({
      id: "0190f0a0-0000-7000-8000-000000000002",
      table: "trial_answers",
      field_key: "general_description",
    });
    const spies = (["info", "warn", "error"] as const).map((method) =>
      vi.spyOn(logger, method).mockImplementation(() => undefined),
    );
    const response = trialErrorResponse(error, ROUTE, USER);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as unknown;
    expect(body).toEqual({
      feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
      endring: {
        id: "0190f0a0-0000-7000-8000-000000000002",
        table: "trial_answers",
        field_key: "general_description",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Fukt");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("uendret for tilgang, konflikt og bildefeil", () => {
    expect(trialErrorResponse(new AccessDeniedError(), ROUTE, USER).status).toBe(403);
    expect(trialErrorResponse(new TrialIdConflictError(), ROUTE, USER).status).toBe(409);
    expect(trialErrorResponse(new TrialPhotoTooLargeError(), ROUTE, USER).status).toBe(413);
    expect(trialErrorResponse(new TrialPhotoNotFoundError(), ROUTE, USER).status).toBe(404);
  });
});
