import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  isUnstorableValueError,
  TrialChangeRejectedError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";
import { trialErrorResponse } from "./error-response";

// Funn T-0001: oversetting av feil til statuskoder. Testplan avsnitt 1b (11–15).

const ROUTE = "/api/prove/synk/endringer";
const USER = "0190a1b2-c3d4-7e5f-8a6b-000000000001";

function dbError(code: string | undefined, wrapped = false): Error {
  const driver = Object.assign(new Error("verdien kan ikke lagres"), code ? { code } : {});
  return wrapped ? new Error("Failed query", { cause: driver }) : driver;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trialErrorResponse", () => {
  it.each(["22003", "22P02", "22021"])("SQLSTATE %s (klasse 22) gir 400, også i cause", (code) => {
    expect(isUnstorableValueError(dbError(code))).toBe(true);
    expect(isUnstorableValueError(dbError(code, true))).toBe(true);
    expect(trialErrorResponse(dbError(code), ROUTE, USER).status).toBe(400);
    expect(trialErrorResponse(dbError(code, true), ROUTE, USER).status).toBe(400);
  });

  it("23514 (sjekkregel) gir 400", () => {
    expect(isUnstorableValueError(dbError("23514", true))).toBe(true);
    expect(trialErrorResponse(dbError("23514"), ROUTE, USER).status).toBe(400);
  });

  it.each(["23505", "08006", "40001", undefined])("annen databasefeil (%s) gir 500", (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(isUnstorableValueError(dbError(code, true))).toBe(false);
    expect(trialErrorResponse(dbError(code), ROUTE, USER).status).toBe(500);
    expect(trialErrorResponse(dbError(code, true), ROUTE, USER).status).toBe(500);
  });

  it("svaret på 400 har feil og endring, aldri teksten", async () => {
    const error = new TrialChangeRejectedError({
      id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
      table: "trial_answers",
      field_key: "general_description",
    });
    const errorLog = vi.spyOn(logger, "error");
    const response = trialErrorResponse(error, ROUTE, USER);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body: unknown = await response.json();
    expect(body).toEqual({
      feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
      endring: {
        id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
        table: "trial_answers",
        field_key: "general_description",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Fukt");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("uten felt har endring bare id og tabell; InvalidTrialChangeError uten endring som før", async () => {
    const form = new TrialChangeRejectedError({
      id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
      table: "trial_forms",
    });
    expect(await trialErrorResponse(form, ROUTE, USER).json()).toEqual({
      feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
      endring: { id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c", table: "trial_forms" },
    });
    const plain = trialErrorResponse(new InvalidTrialChangeError(), ROUTE, USER);
    expect(plain.status).toBe(400);
    expect(await plain.json()).toEqual({
      feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
    });
  });

  it("uendret for tilgang, konflikt og bildefeil", () => {
    expect(trialErrorResponse(new AccessDeniedError(), ROUTE, USER).status).toBe(403);
    expect(trialErrorResponse(new TrialIdConflictError(), ROUTE, USER).status).toBe(409);
    expect(trialErrorResponse(new TrialPhotoTooLargeError(), ROUTE, USER).status).toBe(413);
    expect(trialErrorResponse(new TrialPhotoNotFoundError(), ROUTE, USER).status).toBe(404);
  });
});
